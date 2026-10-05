"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import NewBadge from "@/components/NewBadge";

// Admin → Ekos Sync → "Ekos task stages" (added 2026-10-05, Ekos tank sync —
// claude/tank-sync-plan.md). Which Ekos batch-task names move a tank to a
// new stage on the Tanks page. Table ekos_task_stage_map (sql/ekos_tanks.sql).
// The tank sync fills this list with every task name it sees: names that
// match the stage rules Chad confirmed (Dump Cone, DRYHOP, Hard/Cold Crash,
// Carb/Carbonate, READY TO/FOR PACKAG…, Transition to … Brite) get their
// stage automatically; anything else lands under "Needs a decision" and
// counts as "no stage" until a stage (or "Not a stage") is picked here.

type Stage = "dump_yeast" | "dry_hop" | "cold_crash" | "carbonating" | "ready" | "none";

interface Row {
  task_title: string;
  stage: Stage | null;
  first_seen_at: string;
}

const STAGES: { value: Stage; label: string }[] = [
  { value: "dump_yeast", label: "Yeast dumped (yeast leaves the cone)" },
  { value: "dry_hop", label: "Dry Hopping" },
  { value: "cold_crash", label: "Cold Crashing" },
  { value: "carbonating", label: "Carbonating" },
  { value: "ready", label: "Ready For Packaging" },
  { value: "none", label: "Not a stage" },
];

export default function EkosTaskStages() {
  const supabase = useMemo(() => createClient(), []);
  const [rows, setRows] = useState<Row[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState<string | null>(null);
  const [showAll, setShowAll] = useState(false);

  const load = useCallback(async () => {
    const { data, error: err } = await supabase
      .from("ekos_task_stage_map")
      .select("task_title, stage, first_seen_at")
      .order("task_title");
    if (err) setError("Couldn't load the Ekos task stages — has sql/ekos_tanks.sql been run in Supabase?");
    setRows((data as Row[] | null) ?? []);
  }, [supabase]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- intentional fetch-on-mount
    load();
  }, [load]);

  async function save(title: string, stage: string) {
    if (!stage) return;
    setError(null);
    setSaving(title);
    const { data: auth } = await supabase.auth.getUser();
    const { error: err } = await supabase
      .from("ekos_task_stage_map")
      .update({ stage, updated_at: new Date().toISOString(), updated_by: auth.user?.id ?? null })
      .eq("task_title", title);
    setSaving(null);
    if (err) {
      setError(err.message);
      return;
    }
    await load();
  }

  const pending = rows.filter((r) => !r.stage);
  const stageTasks = rows.filter((r) => r.stage && r.stage !== "none");
  const notStage = rows.filter((r) => r.stage === "none");

  const picker = (r: Row) => (
    <select
      value={r.stage ?? ""}
      disabled={saving === r.task_title}
      onChange={(e) => save(r.task_title, e.target.value)}
      className="max-w-full rounded-md border border-neutral-700 bg-neutral-900 px-2 py-1 text-sm text-neutral-100"
    >
      {!r.stage && <option value="">Pick a stage…</option>}
      {STAGES.map((s) => (
        <option key={s.value} value={s.value}>
          {s.label}
        </option>
      ))}
    </select>
  );

  return (
    <section className="flex flex-col gap-2">
      <h2 className="flex items-center text-sm font-semibold uppercase tracking-wide text-neutral-500">
        Ekos task stages
        <NewBadge inline />
      </h2>
      <p className="max-w-2xl text-xs text-neutral-500">
        Which Ekos batch tasks move a tank to its next stage on the Tanks page once they&apos;re marked Completed in
        Ekos. The tank sync adds every task name it sees. Names it can&apos;t place are never guessed — they show up
        under &ldquo;Needs a decision&rdquo; and count as no stage until you pick one.
      </p>
      {error && <p className="rounded-md border border-red-900 bg-red-950/40 px-3 py-2 text-sm text-red-300">{error}</p>}

      {rows.length === 0 && !error && (
        <p className="text-sm text-neutral-500">Nothing yet — the list fills in the first time the Ekos — Tanks sync runs.</p>
      )}

      {pending.length > 0 && (
        <div className="flex flex-col gap-2 rounded-lg border border-amber-800 bg-amber-950/30 p-3">
          <p className="text-sm font-medium text-amber-300">Needs a decision ({pending.length})</p>
          {pending.map((r) => (
            <div key={r.task_title} className="flex flex-wrap items-center gap-2 text-sm">
              <span className="break-words text-neutral-100">{r.task_title}</span>
              <span className="text-neutral-500">→</span>
              {picker(r)}
            </div>
          ))}
        </div>
      )}

      {stageTasks.length > 0 && (
        <div className="overflow-x-auto rounded-lg border border-neutral-800">
          <table className="w-full text-sm">
            <thead className="bg-neutral-950 text-left text-xs text-neutral-500">
              <tr>
                <th className="px-3 py-2 font-medium">Ekos task</th>
                <th className="px-3 py-2 font-medium">When completed</th>
              </tr>
            </thead>
            <tbody>
              {(showAll ? [...stageTasks, ...notStage] : stageTasks).map((r) => (
                <tr key={r.task_title} className="border-t border-neutral-800">
                  <td className="break-words px-3 py-2 text-neutral-200">{r.task_title}</td>
                  <td className="px-3 py-2">{picker(r)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {notStage.length > 0 && (
        <button
          type="button"
          onClick={() => setShowAll((v) => !v)}
          className="self-start text-xs text-neutral-500 hover:text-neutral-300"
        >
          {showAll ? "Hide" : "Show"} the {notStage.length} task{notStage.length === 1 ? "" : "s"} marked &ldquo;Not a stage&rdquo;
        </button>
      )}
    </section>
  );
}
