import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { loadSyncConfig, pullChanges, recordSyncError } from "@/lib/google/calendarSync";
import { secretsMatch } from "@/lib/google/syncSecret";

// Google -> App. Google calls this the moment the synced calendar changes
// (a "watch" channel set up by ensureWatch in lib/google/calendarSync.ts).
// Google's notification carries no event details — just "something
// changed" — so we pull the changes ourselves with the saved sync token.
// Trusted only if Google echoes back our secret (X-Goog-Channel-Token) on
// the channel we registered.
export const maxDuration = 300;

export async function POST(req: NextRequest) {
  const token = req.headers.get("x-goog-channel-token");
  const channelId = req.headers.get("x-goog-channel-id");
  const state = req.headers.get("x-goog-resource-state");

  const admin = createAdminClient();
  const { data } = await admin.from("google_calendar_sync").select("calendar_key").eq("channel_id", channelId ?? "").maybeSingle();
  const cfg = data ? await loadSyncConfig(admin, (data as { calendar_key: string }).calendar_key) : null;
  if (!cfg || !secretsMatch(token, cfg.secret)) {
    // Unknown/old channel — tell Google we got it so it stops retrying.
    return new NextResponse(null, { status: 200 });
  }
  if (state === "sync") return new NextResponse(null, { status: 200 }); // Google's "channel created" ping

  try {
    await pullChanges(admin, cfg);
  } catch (err) {
    await recordSyncError(admin, cfg.calendar_key, err);
    console.error("[google-calendar/webhook]", err);
  }
  return new NextResponse(null, { status: 200 });
}
