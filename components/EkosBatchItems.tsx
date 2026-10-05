"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import NewBadge from "@/components/NewBadge";

// Admin → Ekos Sync → "Ekos batch items" (added 2026-10-05, Tanks → "See
// Batch Details" — claude/batch-details-plan.md). Which popup button each
// Ekos item goes under. Table ekos_batch_item_kinds (sql/ekos_batch_details.sql).
// The tank sync fills this list with every item it sees in a batch's Bill of
// Materials: malts → Grain Bill, "… Hops" → Hops (kettle/whirlpool vs dry hop
// is decided by the Ekos task that used it), yeasts/cultures → Yeast,
// fruit/vanilla → Fruit Additions; anything else (packaging, lactic acid,
// finings…) is "Leave out". Any name can be changed here.

type Stage = "grain" | "hops" | "fruit" | "yeast" | "none";

interface Row {
  task_title: string;
  stage: Stage | null; // the item's button (column "kind")
  first_seen_at: string;
}

const STAGES: { value: Stage; label: string }[] = [
  { value: "grain", label: "Grain Bill" },
  { value: "hops", label: "Hops (kettle / whirlpool or dry hop)" },
  { value: "fruit", label: "Fruit Additions" },
  { value: "yeast", label: "Yeast" },
  { value: "none", label: "Leave out" },
];

export default function EkosBatchItems() {
  const supabase = useMemo(() => createClient(), []);
  const [rows, setRows] = useState<Row[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState<string | null>(null);
  const [showAll, setShowAll] = useState(false);

  const load = useCallback(async () => {
    const { data, error: err } = await supabase
      .from("ekos_batch_item_kinds")
      .select("item_title, kind, first_seen_at")
      .order("item_title");
    if (err) setError("Couldn't load the Ekos batch items — has sql/ekos_batch_details.sql been run in Supabase?");
    setRows(
      ((data as { item_title: string; kind: Stage; first_seen_at: string }[] | null) ?? []).map((r) => ({
        task_title: r.item_title,
        stage: r.kind,
        first_seen_at: r.first_seen_at,
      })),
    );
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
      .from("ekos_batch_item_kinds")
      .update({ kind: stage, updated_at: new Date().toISOString(), updated_by: auth.user?.id ?? null })
      .eq("item_title", title);
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
      {!r.stage && <option value="">Pick a button…</option>}
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
        Ekos batch items
        <NewBadge inline />
      </h2>
      <p className="max-w-2xl text-xs text-neutral-500">
        Which button each Ekos item goes under in the Tanks page&apos;s &ldquo;See Batch Details&rdquo; popup. The tank
        sync adds every item it sees in a batch&apos;s Bill of Materials. Items that don&apos;t match the starting rules
        (packaging, lactic acid…) are saved as &ldquo;Leave out&rdquo; — change any of them here.
      </p>
      {error && <p className="rounded-md border border-red-900 bg-red-950/40 px-3 py-2 text-sm text-red-300">{error}</p>}

      {rows.length === 0 && !error && (
        <p className="text-sm text-neutral-500">Nothing yet — the list fills in the next time the Ekos — Tanks sync runs.</p>
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
                <th className="px-3 py-2 font-medium">Ekos item</th>
                <th className="px-3 py-2 font-medium">Popup button</th>
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
          {showAll ? "Hide" : "Show"} the {notStage.length} item{notStage.length === 1 ? "" : "s"} marked &ldquo;Leave out&rdquo;
        </button>
      )}
    </section>
  );
}
