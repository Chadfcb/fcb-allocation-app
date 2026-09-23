import { NextRequest, NextResponse } from "next/server";
import { getProfile } from "@/lib/getProfile";
import { hasSection } from "@/lib/permissions";
import { createAdminClient } from "@/lib/supabase/admin";
import { googleCredentialsConfigured, googleServiceAccountEmail } from "@/lib/google/auth";
import {
  checkCalendarAccess,
  ensureWatch,
  loadSyncConfig,
  previewInitialSync,
  pullChanges,
  recordSyncError,
  runInitialSync,
} from "@/lib/google/calendarSync";

// Events page <-> Google Calendar sync controls (signed-in, Events Calendar
// access required). GET = status for the "Google Calendar" button. POST
// actions:
//   check    — can the app reach the Google calendar yet?
//   preview  — first-sync preview: matched / Google-only / app-only lists
//   initial  — run the approved first sync (Administrators/Managers only)
//   sync_now — pull Google's latest changes right now
export const maxDuration = 300;

async function authorize() {
  const profile = await getProfile();
  if (!profile || !hasSection(profile.role, profile.sections, "events_calendar")) return null;
  return profile;
}

export async function GET() {
  const profile = await authorize();
  if (!profile) return NextResponse.json({ error: "Not allowed" }, { status: 403 });
  const admin = createAdminClient();
  const cfg = await loadSyncConfig(admin, "events");
  return NextResponse.json({
    credentials: googleCredentialsConfigured(),
    serviceAccountEmail: googleServiceAccountEmail(),
    setUp: !!cfg,
    initialSyncDone: cfg?.initial_sync_done ?? false,
    lastPullAt: cfg?.last_pull_at ?? null,
    lastPushAt: cfg?.last_push_at ?? null,
    lastError: cfg?.last_error ?? null,
    canRunInitial: profile.role === "admin",
  });
}

export async function POST(req: NextRequest) {
  const profile = await authorize();
  if (!profile) return NextResponse.json({ error: "Not allowed" }, { status: 403 });
  const { action } = ((await req.json().catch(() => ({}))) as { action?: string }) ?? {};
  const admin = createAdminClient();
  const cfg = await loadSyncConfig(admin, "events");
  if (!cfg) {
    return NextResponse.json({ error: "Google sync isn't set up yet — run sql/google_calendar_sync.sql in Supabase first." }, { status: 400 });
  }
  if (!googleCredentialsConfigured()) {
    return NextResponse.json({ error: "Google isn't connected yet — the service account key hasn't been added in Vercel." }, { status: 400 });
  }

  try {
    switch (action) {
      case "check":
        return NextResponse.json(await checkCalendarAccess(cfg));
      case "preview": {
        const access = await checkCalendarAccess(cfg);
        if (!access.ok) return NextResponse.json({ error: access.message }, { status: 400 });
        return NextResponse.json(await previewInitialSync(admin, cfg));
      }
      case "initial": {
        if (profile.role !== "admin") return NextResponse.json({ error: "Only an Administrator or Manager can run the first sync." }, { status: 403 });
        if (cfg.initial_sync_done) return NextResponse.json({ error: "The first sync has already been done." }, { status: 400 });
        return NextResponse.json(await runInitialSync(admin, cfg));
      }
      case "sync_now": {
        if (!cfg.initial_sync_done) return NextResponse.json({ error: "Run the first sync first." }, { status: 400 });
        await ensureWatch(admin, cfg);
        const fresh = (await loadSyncConfig(admin, "events")) ?? cfg;
        return NextResponse.json(await pullChanges(admin, fresh));
      }
      default:
        return NextResponse.json({ error: "Unknown action" }, { status: 400 });
    }
  } catch (err) {
    await recordSyncError(admin, cfg.calendar_key, err);
    return NextResponse.json({ error: err instanceof Error ? err.message : "Sync failed" }, { status: 500 });
  }
}
