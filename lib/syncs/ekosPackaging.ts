import type { SupabaseClient } from "@supabase/supabase-js";

// Ekos Packaging sync ("Ekos — Packaging" on Admin → Ekos Sync) — added
// 2026-10-26. Plan: claude/ekos-packaging-inventory-plan.md. SQL:
// sql/inventory_running_record.sql.
//
// lib/syncs/ekosReader.ts → readEkosPackaging() reads every packaging run
// (the PACKAGING panel on a batch: Date | Item | Quantity | Status) of every
// In-Progress batch and every recently Completed batch. This file saves them
// (table ekos_packaging, one row per run — Ekos's own run id, so a run is
// never counted twice). The database does the rest:
//   - our beer On Hand: the running record adds Completed runs from the day
//     after the count (inventory_record_level)
//   - supplies: cans, lids, trays, Pak-Techs, labels and kegs used by the
//     runs (inventory_supplies_used)
// Ekos item names are matched with the Ekos name list (kind "item") —
// never guessed. A new name is saved as "Needs a decision" and listed in the
// run's issues; its runs count as soon as Chad picks the match.

export interface EkosPackagingRun {
  taskRowguid: string;
  batchGuid: string;
  batchTitle: string;
  itemTitle: string;
  typeTitle: string | null;
  status: string; // Completed / In-Progress / Planned
  packagedOn: string | null; // YYYY-MM-DD
  units: number; // cases or kegs
  wipBbl: number | null;
  isPlanned: boolean;
}

export interface EkosPackagingRead {
  runs: EkosPackagingRun[];
  batchesRead: string[]; // Ekos batch ids whose packaging list was read in full
  inProgressCount: number;
  completedCount: number;
}

// First day whose packaging counts (keep in step with
// public.inventory_record_start() in the SQL).
export const RECORD_START = "2026-10-27";
// Runs older than this aren't saved at all (nothing they could change).
const KEEP_FROM = "2026-10-13";

const norm = (s: string) => s.replace(/\s+/g, " ").trim();

export async function syncEkosPackaging(
  admin: SupabaseClient,
  read: EkosPackagingRead,
): Promise<{ syncedCount: number; issues: string[]; summary: string }> {
  const issues: string[] = [];
  const now = new Date().toISOString();

  const kept = read.runs.filter((r) => !!r.packagedOn && r.packagedOn >= KEEP_FROM);
  const rows = kept.map((r) => ({
    task_rowguid: r.taskRowguid,
    batch_guid: r.batchGuid,
    batch_title: r.batchTitle,
    item_title: r.itemTitle,
    type_title: r.typeTitle,
    status_title: r.status,
    packaged_on: r.packagedOn,
    units: r.units,
    wip_bbl: r.wipBbl,
    is_planned: r.isPlanned,
    synced_at: now,
  }));

  if (rows.length > 0) {
    const { error } = await admin.from("ekos_packaging").upsert(rows, { onConflict: "task_rowguid" });
    if (error) throw new Error(`Couldn't save the packaging runs (has sql/inventory_running_record.sql been run?): ${error.message}`);
  }

  // A run deleted in Ekos (on a batch read in full this time) is removed here
  // too, so it stops counting.
  let removed = 0;
  if (read.batchesRead.length > 0) {
    const keepIds = new Set(rows.map((r) => r.task_rowguid));
    const { data: existing, error: exErr } = await admin
      .from("ekos_packaging")
      .select("task_rowguid, batch_guid")
      .in("batch_guid", read.batchesRead);
    if (exErr) {
      issues.push(`Couldn't check for runs removed in Ekos: ${exErr.message}`);
    } else {
      const gone = ((existing ?? []) as { task_rowguid: string }[]).map((r) => r.task_rowguid).filter((id) => !keepIds.has(id));
      if (gone.length > 0) {
        const { error } = await admin.from("ekos_packaging").delete().in("task_rowguid", gone);
        if (error) issues.push(`Couldn't remove runs that were deleted in Ekos: ${error.message}`);
        else removed = gone.length;
      }
    }
  }

  // Ekos item names the name list doesn't know yet (only runs that count).
  const { data: mapRows, error: mapErr } = await admin.from("ekos_name_map").select("ekos_name, app_name, skip").eq("kind", "item");
  if (mapErr) {
    issues.push(`Couldn't load the Ekos name list: ${mapErr.message}`);
  } else {
    const known = new Map<string, { app_name: string | null; skip: boolean }>();
    for (const r of (mapRows ?? []) as { ekos_name: string; app_name: string | null; skip: boolean }[]) {
      const k = norm(r.ekos_name);
      const prev = known.get(k);
      if (!prev || (!prev.app_name && r.app_name)) known.set(k, { app_name: r.app_name, skip: r.skip });
    }
    const newNames = new Set<string>();
    const pending = new Set<string>();
    for (const r of kept) {
      if (r.isPlanned || (r.packagedOn ?? "") < RECORD_START) continue;
      const k = norm(r.itemTitle);
      const hit = known.get(k);
      if (hit?.skip || hit?.app_name) continue;
      if (!hit) newNames.add(k);
      pending.add(r.itemTitle);
    }
    if (newNames.size > 0) {
      const { error } = await admin
        .from("ekos_name_map")
        .upsert([...newNames].map((n) => ({ kind: "item", ekos_name: n, app_name: null, skip: false })), {
          onConflict: "kind,ekos_name",
          ignoreDuplicates: true,
        });
      if (error) issues.push(`Couldn't save new Ekos item names to the name list: ${error.message}`);
    }
    for (const p of pending) {
      issues.push(`Item "${p}" (packaged in Ekos) isn't on the Ekos name list yet — not counted in our inventory until its match is picked on Admin → Ekos Sync.`);
    }
  }

  const counting = kept.filter((r) => !r.isPlanned && /^completed$/i.test(r.status) && (r.packagedOn ?? "") >= RECORD_START);
  const units = counting.reduce((a, r) => a + r.units, 0);
  return {
    syncedCount: rows.length,
    issues,
    summary:
      `${read.inProgressCount} In-Progress + ${read.completedCount} recently Completed batches read, ` +
      `${rows.length} packaging runs saved (${counting.length} completed since ${RECORD_START}: ${units} cases/kegs)` +
      (removed ? `, ${removed} removed (deleted in Ekos)` : ""),
  };
}
