"use client";

import { useEffect, useMemo, useState, useCallback } from "react";
import { createClient } from "@/lib/supabase/client";
import type { Week } from "@/lib/types/db";

export default function WeeksPage() {
  const supabase = useMemo(() => createClient(), []);
  const [weeks, setWeeks] = useState<Week[]>([]);
  const [label, setLabel] = useState("");
  const [weekStart, setWeekStart] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    const { data } = await supabase
      .from("weeks")
      .select("*")
      .order("week_start", { ascending: false });
    setWeeks((data as Week[]) ?? []);
  }, [supabase]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- intentional fetch-on-mount
    load();
  }, [load]);

  async function handleStartNewWeek(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);

    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      setError("Not signed in.");
      setBusy(false);
      return;
    }

    const previousWeekId = weeks[0]?.id ?? null;

    const { error: rpcError } = await supabase.rpc("start_new_week", {
      p_label: label,
      p_week_start: weekStart,
      p_previous_week_id: previousWeekId,
      p_created_by: user.id,
    });

    if (rpcError) {
      setError(rpcError.message);
    } else {
      setLabel("");
      setWeekStart("");
      await load();
    }

    setBusy(false);
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-lg font-semibold text-neutral-100">Weeks</h1>
        <p className="text-sm text-neutral-400">
          Starting a new week automatically carries forward remaining inventory from the most
          recent week as the new week&apos;s opening On Hand balance. Distributor data and
          allocations always start fresh.
        </p>
      </div>

      <form onSubmit={handleStartNewWeek} className="flex flex-wrap items-end gap-3 rounded-lg border border-neutral-800 bg-neutral-950 p-4">
        <div>
          <label className="mb-1 block text-xs font-medium text-neutral-400">Label</label>
          <input
            required
            placeholder="e.g. Delivery Week of Aug 18"
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            className="w-64 rounded-md border border-neutral-700 bg-neutral-900 px-3 py-1.5 text-sm text-neutral-100"
          />
        </div>
        <div>
          <label className="mb-1 block text-xs font-medium text-neutral-400">Week start date</label>
          <input
            required
            type="date"
            value={weekStart}
            onChange={(e) => setWeekStart(e.target.value)}
            className="rounded-md border border-neutral-700 bg-neutral-900 px-3 py-1.5 text-sm text-neutral-100"
          />
        </div>
        <button
          type="submit"
          disabled={busy}
          className="rounded-md bg-white px-4 py-1.5 text-sm font-medium text-black hover:bg-neutral-200 disabled:opacity-50"
        >
          {busy ? "Starting…" : "Start New Week"}
        </button>
        {error && <p className="w-full text-sm text-red-400">{error}</p>}
      </form>

      <div className="overflow-hidden rounded-lg border border-neutral-800 bg-neutral-950">
        <table className="min-w-full divide-y divide-neutral-900 text-sm">
          <thead className="bg-neutral-900 text-xs uppercase tracking-wide text-neutral-500">
            <tr>
              <th className="px-3 py-2 text-left">Label</th>
              <th className="px-3 py-2 text-left">Week Start</th>
              <th className="px-3 py-2 text-left">Status</th>
              <th className="px-3 py-2 text-left">Rolled forward from</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-neutral-900">
            {weeks.map((w) => (
              <tr key={w.id} className="hover:bg-neutral-900/60">
                <td className="px-3 py-2 font-medium text-neutral-200">{w.label}</td>
                <td className="px-3 py-2 text-neutral-400">{w.week_start}</td>
                <td className="px-3 py-2 capitalize text-neutral-400">{w.status}</td>
                <td className="px-3 py-2 text-neutral-500">
                  {w.previous_week_id ? weeks.find((x) => x.id === w.previous_week_id)?.label ?? "—" : "—"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
