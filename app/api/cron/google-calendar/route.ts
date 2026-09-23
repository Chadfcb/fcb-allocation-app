import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { ensureWatch, loadSyncConfig, pullChanges, recordSyncError } from "@/lib/google/calendarSync";

// Daily safety net for Google Calendar sync: keeps Google's change
// notifications registered (they expire) and does a catch-up pull in case a
// notification was ever missed. Scheduled in vercel.json. Same
// CRON_SECRET check as app/api/cron/task-reminders.
export const maxDuration = 300;

export async function GET(req: NextRequest) {
  const cronSecret = process.env.CRON_SECRET?.trim();
  const received = req.headers.get("authorization")?.trim().replace(/^Bearer\s+/i, "").trim();
  if (!cronSecret || received !== cronSecret) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const admin = createAdminClient();
  const { data } = await admin.from("google_calendar_sync").select("calendar_key").eq("enabled", true).eq("initial_sync_done", true);
  const results: Record<string, unknown> = {};
  for (const row of (data ?? []) as { calendar_key: string }[]) {
    const cfg = await loadSyncConfig(admin, row.calendar_key);
    if (!cfg) continue;
    try {
      await ensureWatch(admin, cfg);
      results[row.calendar_key] = await pullChanges(admin, (await loadSyncConfig(admin, row.calendar_key)) ?? cfg);
    } catch (err) {
      await recordSyncError(admin, row.calendar_key, err);
      results[row.calendar_key] = { error: err instanceof Error ? err.message : String(err) };
    }
  }
  return NextResponse.json({ ok: true, results });
}
