import { createAdminClient } from "@/lib/supabase/admin";

// Every sync run — automatic, "Run now", or a pasted "Sync from Ekos" — is
// recorded in sync_runs (sql/sync_runs.sql) so Admin → Ekos Sync can show
// what happened. Written with the server-only admin client; reading is
// admin-only through RLS. A logging problem never breaks the sync itself.
export type SyncTrigger = "scheduled" | "run_now" | "paste";
export type SyncRunStatus = "ok" | "issues" | "failed" | "skipped";

export async function recordSyncRun(run: {
  source: string;
  trigger: SyncTrigger;
  status: SyncRunStatus;
  startedAt: Date;
  syncedCount?: number | null;
  issues?: string[];
  summary?: string | null;
  runBy?: string | null;
}): Promise<void> {
  try {
    const admin = createAdminClient();
    await admin.from("sync_runs").insert({
      source: run.source,
      trigger: run.trigger,
      status: run.status,
      started_at: run.startedAt.toISOString(),
      finished_at: new Date().toISOString(),
      synced_count: run.syncedCount ?? null,
      issues: run.issues ?? [],
      summary: run.summary ?? null,
      run_by: run.runBy ?? null,
    });
  } catch {
    // Logging must never break a sync.
  }
}
