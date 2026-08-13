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
        <h1 className="text-lg font-semibold text-neutral-900">Weeks</h1>
        <p className="text-sm text-neutral-500">
          Starting a new week automatically carries forward remaining inventory from the most
          recent week as the new week&apos;s opening On Hand balance. Distributor data and
          allocations always start fresh.
        </p>
      </div>

      <form onSubmit={handleStartNewWeek} className="flex flex-wrap items-end gap-3 rounded-lg border border-neutral-200 bg-white p-4">
        <div>
          <label className="mb-1 block text-xs font-medium text-neutral-600">Label</label>
          <input
            required
            placeholder="e.g. Delivery Week of Aug 18"
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            className="w-64 rounded-md border border-neutral-300 px-3 py-1.5 text-sm"
          />
        </div>
        <div>
          <label className="mb-1 block text-xs font-medium text-neutral-600">Week start date</label>
          <input
            required
            type="date"
            value={weekStart}
            onChange={(e) => setWeekStart(e.target.value)}
            className="rounded-md border border-neutral-300 px-3 py-1.5 text-sm"
          />
        </div>
        <button
          type="submit"
          disabled={busy}
          className="rounded-md bg-neutral-900 px-4 py-1.5 text-sm font-medium text-white hover:bg-neutral-800 disabled:opacity-50"
        >
          {busy ? "Starting…" : "Start New Week"}
        </button>
        {error && <p className="w-full text-sm text-red-600">{error}</p>}
      </form>

      <div className="overflow-hidden rounded-lg border border-neutral-200 bg-white">
        <table className="min-w-full divide-y divide-neutral-200 text-sm">
          <thead className="bg-neutral-50 text-xs uppercase tracking-wide text-neutral-500">
            <tr>
              <th className="px-3 py-2 text-left">Label</th>
              <th className="px-3 py-2 text-left">Week Start</th>
              <th className="px-3 py-2 text-left">Status</th>
              <th className="px-3 py-2 text-left">Rolled forward from</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-neutral-100">
            {weeks.map((w) => (
              <tr key={w.id}>
                <td className="px-3 py-2 font-medium text-neutral-800">{w.label}</td>
                <td className="px-3 py-2 text-neutral-600">{w.week_start}</td>
                <td className="px-3 py-2 capitalize text-neutral-600">{w.status}</td>
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
