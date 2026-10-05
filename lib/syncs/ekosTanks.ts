import type { SupabaseClient } from "@supabase/supabase-js";

// Ekos Tank Sync ("Ekos — Tanks" on Admin → Ekos Sync) — added 2026-10-05.
// Plan: claude/tank-sync-plan.md. Tables: sql/ekos_tanks.sql.
//
// lib/syncs/ekosReader.ts reads three things from Ekos (read-only):
//   1. the tank map (Home → Facility View): bbl, product code, batch
//      (Ekos's red dashed border is read but NOT used — Chad, 2026-10-05: "i
//      dont want to follow ekos red dashes, i want it by task date")
//   2. the In-Progress batch list: product name, start date, which tank
//   3. for each batch in a tank: its tasks + its Fermentation Log readings
// This file turns that into one row per tank (table ekos_tanks) that the
// Tanks page shows.
//
// Stage = the furthest stage whose task is marked Completed in Ekos. Which
// task names count is the task-stage list (ekos_task_stage_map, Admin →
// Ekos Sync). A task name the list doesn't know yet is matched with the
// rules Chad confirmed on 2026-10-05 (STAGE_RULES below); if none match it
// is saved as "Not a stage" (Chad, 2026-10-05: none of the other 83 task
// names were stages — "go do it"). Any name can still be changed on that list.

export interface EkosTankMapItem {
  name: string;
  volumeBbl: number;
  productCode: string | null;
  batchTitle: string | null;
  color: string | null;
  overdue: boolean;
}

export interface EkosBatchTask {
  title: string;
  status: string; // Planned / In-Progress / Completed
  date: string | null; // YYYY-MM-DD — when the task starts (for "Day N")
  due: string | null; // YYYY-MM-DD — when it's due (Ekos end date, else start)
  overdue: boolean; // Ekos's own flag — not used; overdue is worked out from the due date
}

export interface EkosBatch {
  title: string;
  productName: string;
  startDate: string | null; // YYYY-MM-DD
  locations: string[]; // tank names
  volumeBbl: number;
  tasks: EkosBatchTask[];
  fermLogs: { at: string | null; tempF: number | null }[]; // newest first
}

export interface EkosTanksRead {
  map: EkosTankMapItem[];
  batches: EkosBatch[];
}

export type TaskStage = "dump_yeast" | "dry_hop" | "cold_crash" | "carbonating" | "ready" | "none";

// Chad, 2026-10-05: "that all looks good".
const STAGE_RULES: { stage: TaskStage; test: RegExp }[] = [
  { stage: "ready", test: /ready\s+(to|for)\s+packag|transition\s+to\b.*\bbrite/i },
  { stage: "carbonating", test: /\bcarb(onate|onating|onation)?\b/i },
  { stage: "cold_crash", test: /\b(hard|cold)\s+crash/i },
  { stage: "dry_hop", test: /dry\s*hop/i },
  { stage: "dump_yeast", test: /dump\s+cone/i },
];

const STAGE_ORDER: Record<TaskStage, number> = { none: 0, dump_yeast: 1, dry_hop: 2, cold_crash: 3, carbonating: 4, ready: 5 };
const STAGE_LABEL: Record<number, string> = {
  2: "Dry Hopping",
  3: "Cold Crashing",
  4: "Carbonating",
  5: "Ready For Packaging",
};

const norm = (s: string) => s.replace(/\s+/g, " ").trim();

export async function syncEkosTanks(
  admin: SupabaseClient,
  read: EkosTanksRead,
): Promise<{ syncedCount: number; issues: string[]; summary: string }> {
  if (read.map.length === 0) throw new Error("Ekos's tank map came back empty — nothing was changed.");
  const issues: string[] = [];

  // --- task names → stages -------------------------------------------------
  const { data: mapRows, error: mapErr } = await admin.from("ekos_task_stage_map").select("task_title, stage");
  if (mapErr) throw new Error(`Couldn't load the Ekos task-stage list (has sql/ekos_tanks.sql been run?): ${mapErr.message}`);
  const stageOf = new Map<string, TaskStage | null>();
  for (const r of (mapRows as { task_title: string; stage: TaskStage | null }[] | null) ?? []) {
    stageOf.set(norm(r.task_title), r.stage);
  }
  const newRows: { task_title: string; stage: TaskStage | null }[] = [];
  const resolve = (title: string): TaskStage | null => {
    const key = norm(title);
    if (stageOf.has(key)) return stageOf.get(key) ?? null;
    const rule = STAGE_RULES.find((r) => r.test.test(key));
    const stage: TaskStage = rule ? rule.stage : "none";
    stageOf.set(key, stage);
    newRows.push({ task_title: key, stage });
    return stage;
  };

  // --- one row per tank on the map -----------------------------------------
  const batchFor = new Map<string, EkosBatch>();
  for (const b of read.batches) for (const loc of b.locations) batchFor.set(norm(loc).toUpperCase(), b);

  const now = new Date().toISOString();
  // Overdue = a task in the tank's batch that isn't Completed and whose due
  // date is before today (brewery time) — Chad, 2026-10-05.
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Los_Angeles" }).format(new Date()); // YYYY-MM-DD
  const isLate = (t: EkosBatchTask) => t.status !== "Completed" && !!t.due && t.due < today;
  const rows = read.map.map((m) => {
    const b = batchFor.get(norm(m.name).toUpperCase()) ?? null;
    const full = m.volumeBbl > 0.05;
    if (full && !b) {
      issues.push(`${m.name} has ${m.volumeBbl.toFixed(2)} bbl in Ekos, but no In-Progress batch lists that tank — shown without stage, tasks or temperature.`);
    }
    let furthest = 0;
    let dumped = false;
    for (const t of b?.tasks ?? []) {
      if (t.status !== "Completed") continue;
      const s = resolve(t.title);
      if (!s) continue;
      furthest = Math.max(furthest, STAGE_ORDER[s]);
      if (s !== "none" && s !== "dry_hop") dumped = true; // dump / crash / carb / ready all mean the yeast is out
    }
    // Make sure every task name is on the list (open ones too), so the
    // list is complete before a task is ever checked off.
    for (const t of b?.tasks ?? []) resolve(t.title);

    const stage = !full ? null : (STAGE_LABEL[furthest] ?? "Fermenting");
    const latest = b?.fermLogs.find((f) => typeof f.tempF === "number" && Number.isFinite(f.tempF)) ?? null;
    const left = (b?.tasks ?? [])
      .filter((t) => t.status !== "Completed")
      .sort((x, y) => (x.date ?? "9999").localeCompare(y.date ?? "9999"))
      .slice(0, 40)
      .map((t) => ({ title: norm(t.title), date: t.date, overdue: isLate(t) }));

    return {
      tank_name: m.name,
      volume_bbl: Math.round(m.volumeBbl * 1000) / 1000,
      product_code: m.productCode,
      batch_title: b?.title ?? m.batchTitle,
      product_name: b?.productName ?? null,
      color: m.color,
      start_date: b?.startDate ?? null,
      stage,
      yeast_in_cone: full && !!b && !dumped,
      dry_hop: full && furthest === STAGE_ORDER.dry_hop,
      temp_f: full && latest ? latest.tempF : null,
      temp_at: full && latest ? latest.at : null,
      overdue: full && left.some((t) => t.overdue),
      tasks_left: full ? left : [],
      synced_at: now,
    };
  });

  if (newRows.length > 0) {
    const { error } = await admin.from("ekos_task_stage_map").upsert(newRows, { onConflict: "task_title", ignoreDuplicates: true });
    if (error) issues.push(`Couldn't save new task names to the task-stage list: ${error.message}`);
  }
  // Names saved before 2026-10-05's change that are still waiting on a
  // decision → "Not a stage" too (they already counted as no stage).
  const { error: fillErr } = await admin
    .from("ekos_task_stage_map")
    .update({ stage: "none", updated_at: now })
    .is("stage", null);
  if (fillErr) issues.push(`Couldn't mark the waiting task names as "Not a stage": ${fillErr.message}`);

  const { error: upErr } = await admin.from("ekos_tanks").upsert(rows, { onConflict: "tank_name" });
  if (upErr) throw new Error(`Couldn't save the tanks: ${upErr.message}`);
  // Spots that are no longer on Ekos's map.
  const names = rows.map((r) => r.tank_name);
  const { error: delErr } = await admin.from("ekos_tanks").delete().not("tank_name", "in", `(${names.map((n) => `"${n.replace(/"/g, '""')}"`).join(",")})`);
  if (delErr) issues.push(`Couldn't clear old tank-map spots: ${delErr.message}`);

  const fullCount = rows.filter((r) => r.volume_bbl > 0.05).length;
  return {
    syncedCount: rows.length,
    issues,
    summary: `${rows.length} tank-map spots read (${fullCount} with beer), ${read.batches.length} In-Progress batches, ${rows.filter((r) => r.overdue).length} tanks with overdue tasks`,
  };
}
