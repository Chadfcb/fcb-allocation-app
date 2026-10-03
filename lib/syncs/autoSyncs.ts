import { createAdminClient } from "@/lib/supabase/admin";
import { sendMail } from "@/lib/email/sendMail";
import { recordSyncRun, type SyncTrigger } from "@/lib/syncs/runLog";
import { syncEkosPurchaseOrders } from "@/lib/syncs/ekosPurchaseOrders";
import { syncEkosDistributorInventory } from "@/lib/syncs/ekosDistributorInventory";
import { translateEkosInventory } from "@/lib/syncs/ekosNameMap";
import {
  closeEkosSession,
  readEkosDistributorInventory,
  readEkosOpenPurchaseOrders,
} from "@/lib/syncs/ekosReader";

// Automatic Syncs (Admin → Ekos Sync) — added 2026-10-03.
// Plan: claude/ekos-auto-sync-plan.md.
//
// Built as a general system, per Chad ("there will be other things I will
// want to add to that sync... in the future"): each data source is one
// entry in SYNC_SOURCES below with its own `run` step. Scheduling, the run
// log, "Run now", the on/off switch and failure emails are shared, so a new
// source only needs its own `run`.
//
// Phase 1: the system itself. Phase 2 (2026-10-03): the two Ekos sources
// now read Ekos themselves (lib/syncs/ekosReader.ts — the server signs in
// with EKOS_USERNAME / EKOS_PASSWORD from Vercel) and push the result
// through the SAME sync rules the paste boxes use. Ekos names are matched
// with the Ekos name lists (lib/syncs/ekosNameMap.ts), never guessed.

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
    run: async () => {
      const pos = await readEkosOpenPurchaseOrders();
      const result = await syncEkosPurchaseOrders(createAdminClient(), pos, null);
      return {
        syncedCount: result.syncedCount,
        issues: result.errors,
        summary: `${result.syncedCount} POs synced, ${result.movedToHoldingCount} moved to Holding`,
      };
    },
  },
  {
    key: "ekos_distributor_inventory",
    label: "Ekos — Distributor Inventory",
    description: "On-hand and rate of sale per Core distributor → Operations → Distributor Inventory.",
    run: async () => {
      const admin = createAdminClient();
      const rows = await readEkosDistributorInventory();
      const { entries, issues } = await translateEkosInventory(admin, rows);
      const result = await syncEkosDistributorInventory(admin, entries, null);
      return {
        syncedCount: result.syncedCount,
        issues: [...issues, ...result.errors],
        summary: `${rows.length} Ekos rows read, ${result.syncedCount} inventory rows synced`,
      };
    },
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

  // Sign out of Ekos / close the hidden browser.
  await closeEkosSession();

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
