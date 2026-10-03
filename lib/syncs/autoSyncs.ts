import { createAdminClient } from "@/lib/supabase/admin";
import { sendMail } from "@/lib/email/sendMail";
import { recordSyncRun, type SyncTrigger } from "@/lib/syncs/runLog";

// Automatic Syncs (Admin → Ekos Sync) — added 2026-10-03.
// Plan: claude/ekos-auto-sync-plan.md.
//
// Built as a general system, per Chad ("there will be other things I will
// want to add to that sync... in the future"): each data source is one
// entry in SYNC_SOURCES below with its own `run` step. Scheduling, the run
// log, "Run now", the on/off switch and failure emails are shared, so a new
// source only needs its own `run`.
//
// Phase 1 (this build): the system itself. The two Ekos sources are
// registered but have no `run` yet — reading Ekos automatically is Phase 2
// — so they show as "not built yet" and are never run.

export interface SyncSourceRunResult {
  syncedCount: number;
  issues: string[];
  summary?: string;
}

export interface SyncSourceDef {
  key: string;
  label: string;
  description: string;
  // Missing = this source's automatic reading step hasn't been built yet.
  run?: () => Promise<SyncSourceRunResult>;
}

export const SYNC_SOURCES: SyncSourceDef[] = [
  {
    key: "ekos_purchase_orders",
    label: "Ekos — Open Purchase Orders",
    description: "Every open PO in Ekos, with its line items → Operations → Purchase Orders.",
  },
  {
    key: "ekos_distributor_inventory",
    label: "Ekos — Distributor Inventory",
    description: "On-hand and rate of sale per Core distributor → Operations → Distributor Inventory.",
  },
];

// Who gets the email when an automatic run has a problem.
const ALERT_EMAILS = ["chad@fullcirclebrewing.com"];

export interface AutoSyncSummary {
  ran: { key: string; label: string; status: "ok" | "issues" | "failed"; syncedCount: number; issues: string[] }[];
  skipped: { key: string; label: string; reason: string }[];
}

export async function runAutoSyncs(trigger: SyncTrigger, runBy: string | null): Promise<AutoSyncSummary> {
  const admin = createAdminClient();
  const { data: rows } = await admin.from("sync_sources").select("key, enabled");
  const enabled = new Map((rows ?? []).map((r) => [r.key as string, !!r.enabled]));

  const summary: AutoSyncSummary = { ran: [], skipped: [] };

  for (const source of SYNC_SOURCES) {
    if (!enabled.get(source.key)) {
      summary.skipped.push({ key: source.key, label: source.label, reason: "Switched off" });
      continue;
    }
    if (!source.run) {
      summary.skipped.push({ key: source.key, label: source.label, reason: "Automatic reading not built yet" });
      continue;
    }
    const startedAt = new Date();
    try {
      const result = await source.run();
      const status = result.issues.length > 0 ? "issues" : "ok";
      await recordSyncRun({
        source: source.key,
        trigger,
        status,
        startedAt,
        syncedCount: result.syncedCount,
        issues: result.issues,
        summary: result.summary ?? null,
        runBy,
      });
      summary.ran.push({ key: source.key, label: source.label, status, syncedCount: result.syncedCount, issues: result.issues });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      await recordSyncRun({ source: source.key, trigger, status: "failed", startedAt, issues: [message], runBy });
      summary.ran.push({ key: source.key, label: source.label, status: "failed", syncedCount: 0, issues: [message] });
    }
  }

  // Email only when something actually needs attention — a clean run sends
  // nothing (Chad's standing rule for the sync).
  const problems = summary.ran.filter((r) => r.status !== "ok");
  if (problems.length > 0) {
    const lines = problems.flatMap((p) => [
      `${p.label}: ${p.status === "failed" ? "FAILED" : "finished with issues"} (${p.syncedCount} synced)`,
      ...p.issues.slice(0, 20).map((i) => `  - ${i}`),
      ...(p.issues.length > 20 ? [`  - …and ${p.issues.length - 20} more`] : []),
      "",
    ]);
    try {
      await sendMail({
        to: ALERT_EMAILS.join(","),
        subject: "Ekos Sync needs a look",
        text: [
          "The automatic Ekos sync ran but something didn't go cleanly:",
          "",
          ...lines,
          "Full details: FCB Data → Admin → Ekos Sync.",
        ].join("\n"),
      });
    } catch {
      // Email trouble shouldn't hide the result — it's still in the run log.
    }
  }

  return summary;
}
