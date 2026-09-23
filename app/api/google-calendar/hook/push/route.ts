import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { loadSyncConfig, pushAppEvent, pushDelete, recordSyncError } from "@/lib/google/calendarSync";
import { secretsMatch } from "@/lib/google/syncSecret";

// App -> Google. Called by the database trigger on `events`
// (sql/google_calendar_sync.sql) whenever an event is added, edited, or
// deleted — from the Events page, Ernie, or Slack Ernie alike. Not a
// signed-in request, so it lives under /api/google-calendar/hook (exempt
// from the login redirect in proxy.ts) and is trusted only if it carries
// the secret stored in google_calendar_sync.
export const maxDuration = 60;

export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => null)) as
    | { calendar_key?: string; op?: string; event_id?: string; google_event_id?: string }
    | null;
  const admin = createAdminClient();
  const cfg = await loadSyncConfig(admin, body?.calendar_key ?? "events");
  if (!cfg || !secretsMatch(req.headers.get("x-fcb-sync-secret"), cfg.secret)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  if (!cfg.enabled || !cfg.initial_sync_done) return NextResponse.json({ ok: true, skipped: "sync not active" });

  try {
    if (body?.op === "delete" && body.google_event_id) {
      await pushDelete(admin, cfg, body.google_event_id);
    } else if (body?.op === "upsert" && body.event_id) {
      await pushAppEvent(admin, cfg, body.event_id);
    }
    return NextResponse.json({ ok: true });
  } catch (err) {
    await recordSyncError(admin, cfg.calendar_key, err);
    console.error("[google-calendar/push]", err);
    return NextResponse.json({ error: err instanceof Error ? err.message : "push failed" }, { status: 500 });
  }
}
