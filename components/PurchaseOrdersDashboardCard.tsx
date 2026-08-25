"use client";

// Dashboard card: open vendor Purchase Orders synced from Ekos, including
// any comment typed onto the PO — same live-via-Realtime pattern as the
// other Dashboard cards in DashboardLiveBlocks, kept as its own component
// since purchase_orders isn't week-scoped.

import { useEffect, useMemo, useState, useCallback } from "react";
import { createClient } from "@/lib/supabase/client";
import type { PurchaseOrder } from "@/lib/types/db";
import {
  PO_PAYMENT_STATUS_LABELS,
  PO_PAYMENT_STATUS_COLORS,
  PO_ORDERED_STATUS_LABELS,
  PO_ORDERED_STATUS_COLORS,
} from "@/lib/types/db";

const currencyFormatter = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
});

function formatDate(value: string | null): string {
  if (!value) return "—";
  const [year, month, day] = value.split("-");
  if (!year || !month || !day) return value;
  return `${month}/${day}`;
}

export default function PurchaseOrdersDashboardCard() {
  const supabase = useMemo(() => createClient(), []);
  const [orders, setOrders] = useState<PurchaseOrder[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    const { data } = await supabase
      .from("purchase_orders")
      .select("*")
      .order("po_date", { ascending: false });
    setOrders((data as PurchaseOrder[]) ?? []);
    setLoading(false);
  }, [supabase]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- intentional fetch-on-mount
    load();

    const channel = supabase
      .channel("dashboard-purchase-orders-live")
      .on("postgres_changes", { event: "*", schema: "public", table: "purchase_orders" }, load)
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [supabase, load]);

  // Paid POs float to the top; within the rest, Ordered POs float above
  // Not Ordered ones; anything still tied keeps its existing order (po_date
  // descending, from the query) — the sort is stable, so ties fall through
  // to that original order automatically.
  const sortedOrders = [...orders].sort((a, b) => {
    const paidDiff = Number(b.payment_status === "paid") - Number(a.payment_status === "paid");
    if (paidDiff !== 0) return paidDiff;
    return Number(b.ordered_status === "ordered") - Number(a.ordered_status === "ordered");
  });

  return (
    <div className="flex flex-col rounded-lg border border-neutral-800 bg-neutral-950 p-3">
      <h2 className="mb-2 shrink-0 text-xs font-semibold uppercase tracking-wide text-neutral-400">
        Open Purchase Orders
      </h2>
      <div className="min-h-0 max-h-80 flex-1 overflow-y-auto">
        {loading ? (
          <p className="text-sm text-neutral-500">Loading…</p>
        ) : orders.length === 0 ? (
          <p className="text-sm text-neutral-500">No open purchase orders.</p>
        ) : (
          <div className="divide-y divide-neutral-900">
            {sortedOrders.map((po) => (
              <div key={po.id} className="px-1.5 py-1.5 text-sm">
                <div className="flex items-center justify-between gap-2">
                  <span className="truncate text-neutral-300">
                    <span className="font-medium text-neutral-100">{po.ekos_po_number}</span>{" "}
                    · {po.supplier}
                  </span>
                  <div className="flex shrink-0 items-center gap-2">
                    {/* Fixed-width slots so dates, badges, and totals each
                        line up in their own vertical column across rows,
                        regardless of how wide any single row's text is. */}
                    <span className="w-10 shrink-0 whitespace-nowrap text-right text-[10px] uppercase tracking-wide text-neutral-600">
                      {formatDate(po.expected_delivery_date)}
                    </span>
                    <div className="flex w-16 shrink-0 justify-center">
                      <span
                        className="whitespace-nowrap rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide"
                        style={{
                          backgroundColor: PO_PAYMENT_STATUS_COLORS[po.payment_status],
                          color: "#000000",
                        }}
                      >
                        {PO_PAYMENT_STATUS_LABELS[po.payment_status]}
                      </span>
                    </div>
                    <div className="flex w-20 shrink-0 justify-center">
                      <span
                        className="whitespace-nowrap rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide"
                        style={{
                          backgroundColor: PO_ORDERED_STATUS_COLORS[po.ordered_status],
                          color: "#000000",
                        }}
                      >
                        {PO_ORDERED_STATUS_LABELS[po.ordered_status]}
                      </span>
                    </div>
                    <span className="w-20 shrink-0 whitespace-nowrap text-right font-semibold text-neutral-100">
                      {po.total_cost != null ? currencyFormatter.format(po.total_cost) : "—"}
                    </span>
                  </div>
                </div>
                {po.comments && (
                  <p className="mt-0.5 truncate text-xs italic text-neutral-500">
                    {po.comments}
                  </p>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
