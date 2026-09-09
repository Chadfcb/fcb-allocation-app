"use client";

// Finance > Distributor Data — added 2026-09-09 per Chad, who wanted
// distributor-level finance settings living in Finance rather than
// Operations or Sales. Today this holds each distributor's payment
// Terms (in days) — 0 for due-on-delivery/COD, 30 for net-30, etc. —
// which the Cash Flow Dashboard's Revenue In uses (Delivery Date + Terms)
// to decide which week a delivered order's revenue actually lands in.
// This page is also just the home for whatever other distributor-level
// finance data comes up later; it doesn't need to stay just Terms.
//
// Shows EVERY distributor on file, not just `active` ones — fixed
// 2026-09-09 per Chad's correction. `active` is the weekly toggle for
// who's currently shown on the Inventory & Allocations grid (who FCB is
// delivering to that particular week) — a distributor's payment Terms is
// a property of the distributor itself, not of any one week, so it needs
// to stay visible/editable here even in a week they're toggled off.
//
// Live via Supabase Realtime, same as the rest of the app.

import { useCallback, useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { logChange } from "@/lib/audit";
import type { Distributor } from "@/lib/types/db";

export default function DistributorDataPageClient() {
  const supabase = useMemo(() => createClient(), []);
  const [distributors, setDistributors] = useState<Distributor[]>([]);
  const [userId, setUserId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    const {
      data: { user },
    } = await supabase.auth.getUser();
    setUserId(user?.id ?? null);

    const { data } = await supabase
      .from("distributors")
      .select("*")
      .order("sort_order", { ascending: true, nullsFirst: false })
      .order("name");
    setDistributors((data as Distributor[]) ?? []);
    setLoading(false);
  }, [supabase]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- intentional fetch-on-mount
    load();

    const channel = supabase
      .channel("distributor-data-live")
      .on("postgres_changes", { event: "*", schema: "public", table: "distributors" }, load)
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [supabase, load]);

  async function handleTermsChange(distributorId: string, value: string) {
    if (!userId) return;

    const trimmed = value.trim();
    const parsed = trimmed === "" ? 0 : Number(trimmed);
    if (Number.isNaN(parsed) || parsed < 0) return;

    const existing = distributors.find((d) => d.id === distributorId);
    const oldValue = existing?.payment_terms_days ?? 0;
    setDistributors((prev) =>
      prev.map((d) => (d.id === distributorId ? { ...d, payment_terms_days: parsed } : d)),
    );

    const { data, error } = await supabase
      .from("distributors")
      .update({ payment_terms_days: parsed })
      .eq("id", distributorId)
      .select()
      .single();

    if (!error && data) {
      setDistributors((prev) => prev.map((d) => (d.id === distributorId ? (data as Distributor) : d)));
      await logChange(supabase, {
        weekId: null,
        tableName: "distributors",
        recordId: distributorId,
        fieldName: "payment_terms_days",
        oldValue,
        newValue: parsed,
        changedBy: userId,
      });
    } else {
      await load();
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-lg font-semibold text-neutral-100">Distributor Data</h1>
        <p className="text-sm text-neutral-400">
          Each distributor&apos;s payment terms — how many days after a delivered order&apos;s
          Delivery Date its revenue actually lands, on the Cash Flow Dashboard. 0 means due on
          delivery.
        </p>
      </div>

      <div className="overflow-x-auto rounded-lg border border-neutral-800">
        <table className="min-w-full text-sm">
          <thead className="bg-neutral-900 text-xs uppercase tracking-wide text-neutral-500">
            <tr>
              <th className="px-3 py-2 text-left">Distributor</th>
              <th className="px-3 py-2 text-right">Terms (days)</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-neutral-900">
            {loading ? (
              <tr>
                <td colSpan={2} className="px-3 py-6 text-center text-neutral-500">
                  Loading…
                </td>
              </tr>
            ) : distributors.length === 0 ? (
              <tr>
                <td colSpan={2} className="px-3 py-6 text-center text-neutral-500">
                  No distributors on file.
                </td>
              </tr>
            ) : (
              distributors.map((d) => (
                <tr key={d.id} className="hover:bg-neutral-900/40">
                  <td className="px-3 py-2 text-neutral-300">{d.name}</td>
                  <td className="px-3 py-2 text-right">
                    <input
                      type="number"
                      min={0}
                      step={1}
                      defaultValue={d.payment_terms_days}
                      onBlur={(e) => handleTermsChange(d.id, e.target.value)}
                      className="w-20 rounded border border-neutral-700 bg-neutral-900 px-2 py-1 text-right text-neutral-100"
                    />
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
