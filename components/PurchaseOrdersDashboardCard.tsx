"use client";

// Dashboard card: open vendor Purchase Orders synced from Ekos, including
// any comment typed onto the PO — same live-via-Realtime pattern as the
// other Dashboard cards in DashboardLiveBlocks, kept as its own component
// since purchase_orders isn't week-scoped.
//
// 2026-10-22 (Chad): click a PO → pop-up with its header (supplier, PO date,
// expected delivery, Ordered / Paid tags), the line items the Ekos sync saves
// (purchase_order_items — same as the Purchase Orders page), the total and
// the Ekos comment. View only. New! badge: feature:dashboard-po-popup.

import { useEffect, useMemo, useState, useCallback } from "react";
import { createClient } from "@/lib/supabase/client";
import type { PurchaseOrder, PurchaseOrderItem } from "@/lib/types/db";
import { Modal } from "@/components/SalesDashboardHome";
import { useNewFeature } from "@/lib/newFeatures";
import NewBadge from "@/components/NewBadge";
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

// Unit costs can be fractions of a cent (cans, lids — e.g. $0.225), so the
// pop-up shows up to 4 decimals there instead of rounding to $0.23.
const unitCostFormatter = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  minimumFractionDigits: 2,
  maximumFractionDigits: 4,
});

// Full date for the pop-up: "2026-10-19" → 10/19/26 (no time-zone shift).
function formatFullDate(value: string | null): string {
  if (!value) return "—";
  const [year, month, day] = value.slice(0, 10).split("-");
  if (!year || !month || !day) return value;
  return `${Number(month)}/${Number(day)}/${year.slice(2)}`;
}

function PoTag({ label, color }: { label: string; color: string }) {
  return (
    <span
      className="whitespace-nowrap rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide"
      style={{ backgroundColor: color, color: "#000000" }}
    >
      {label}
    </span>
  );
}

function PoPopup({
  supabase,
  po,
  onClose,
}: {
  supabase: ReturnType<typeof createClient>;
  po: PurchaseOrder;
  onClose: () => void;
}) {
  const [items, setItems] = useState<PurchaseOrderItem[] | null>(null);

  useEffect(() => {
    let cancelled = false;
    supabase
      .from("purchase_order_items")
      .select("*")
      .eq("purchase_order_id", po.id)
      .order("sort_order", { ascending: true })
      .then(({ data }) => {
        if (!cancelled) setItems((data as PurchaseOrderItem[]) ?? []);
      });
    return () => {
      cancelled = true;
    };
  }, [supabase, po.id, po.synced_at]);

  const itemsTotal = (items ?? []).reduce(
    (sum, i) => sum + (i.line_total ?? (i.quantity ?? 0) * (i.unit_cost ?? 0)),
    0
  );
  const total = po.total_cost ?? itemsTotal;

  return (
    <Modal
      title={`${po.supplier} · PO ${po.ekos_po_number}`}
      sub={`PO date ${formatFullDate(po.po_date)} · Expected delivery ${formatFullDate(po.expected_delivery_date)}`}
      onClose={onClose}
    >
      <div className="mb-3 flex flex-wrap items-center gap-2 text-sm">
        <PoTag label={PO_ORDERED_STATUS_LABELS[po.ordered_status]} color={PO_ORDERED_STATUS_COLORS[po.ordered_status]} />
        <PoTag label={PO_PAYMENT_STATUS_LABELS[po.payment_status]} color={PO_PAYMENT_STATUS_COLORS[po.payment_status]} />
        {po.payment_status === "paid" && po.paid_date && (
          <span className="text-xs text-neutral-400">Paid {formatFullDate(po.paid_date)}</span>
        )}
      </div>
      {items === null ? (
        <p className="text-sm text-neutral-500">Loading…</p>
      ) : items.length === 0 ? (
        <p className="text-sm text-neutral-500">No items saved for this PO yet.</p>
      ) : (
        <div className="max-h-[60vh] overflow-y-auto rounded-lg border border-neutral-800">
          <table className="w-full text-sm">
            <thead className="sticky top-0 bg-neutral-900 text-[11px] uppercase tracking-wide text-neutral-400">
              <tr>
                <th className="px-3 py-2 text-left font-semibold">Item</th>
                <th className="px-3 py-2 text-right font-semibold">Qty</th>
                <th className="px-3 py-2 text-right font-semibold">Unit cost</th>
                <th className="px-3 py-2 text-right font-semibold">Total</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-neutral-900">
              {items.map((item) => (
                <tr key={item.id}>
                  <td className="px-3 py-1.5 text-neutral-200">{item.item_name}</td>
                  <td className="px-3 py-1.5 text-right text-neutral-200">{item.quantity != null ? item.quantity.toLocaleString("en-US") : "—"}</td>
                  <td className="px-3 py-1.5 text-right text-neutral-400">
                    {item.unit_cost != null ? unitCostFormatter.format(item.unit_cost) : "—"}
                  </td>
                  <td className="px-3 py-1.5 text-right font-semibold text-neutral-100">
                    {item.line_total != null ? currencyFormatter.format(item.line_total) : "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <div className="mt-3 flex items-center justify-between border-t border-neutral-800 px-1 pt-2 text-sm">
        <span className="text-neutral-400">
          {items ? `${items.length} ${items.length === 1 ? "item" : "items"}` : ""}
        </span>
        <span className="font-semibold text-white">PO total {currencyFormatter.format(total)}</span>
      </div>
      {po.comments && (
        <div className="mt-3 rounded-lg border border-neutral-800 bg-neutral-900/50 p-3">
          <p className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-neutral-400">Comment</p>
          <p className="whitespace-pre-wrap text-sm text-neutral-200">{po.comments}</p>
        </div>
      )}
    </Modal>
  );
}

export default function PurchaseOrdersDashboardCard() {
  const supabase = useMemo(() => createClient(), []);
  const [orders, setOrders] = useState<PurchaseOrder[]>([]);
  const [loading, setLoading] = useState(true);
  const [openPoId, setOpenPoId] = useState<string | null>(null);
  const poPopupNew = useNewFeature("feature:dashboard-po-popup");
  const closePo = useCallback(() => setOpenPoId(null), []);

  const load = useCallback(async () => {
    // Holding/Completed POs (added 2026-09-09) stay out of this card —
    // it's specifically "what's currently open," matching its own title.
    const { data } = await supabase
      .from("purchase_orders")
      .select("*")
      .eq("record_status", "open")
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
      <h2 className="mb-2 flex shrink-0 items-center text-xs font-semibold uppercase tracking-wide text-neutral-400">
        Open Purchase Orders
        {poPopupNew.isNew && <NewBadge inline />}
        {poPopupNew.isNew && (
          <span className="ml-2 text-[10px] font-normal normal-case tracking-normal text-neutral-500">
            Click a PO to see its items
          </span>
        )}
      </h2>
      <div className="min-h-0 max-h-80 flex-1 overflow-y-auto">
        {loading ? (
          <p className="text-sm text-neutral-500">Loading…</p>
        ) : orders.length === 0 ? (
          <p className="text-sm text-neutral-500">No open purchase orders.</p>
        ) : (
          <div className="divide-y divide-neutral-900">
            {sortedOrders.map((po) => (
              <button
                type="button"
                key={po.id}
                onClick={() => {
                  setOpenPoId(po.id);
                  poPopupNew.dismiss();
                }}
                title={`See PO ${po.ekos_po_number}`}
                className="block w-full cursor-pointer rounded px-1.5 py-1.5 text-left text-sm hover:bg-neutral-900"
              >
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
              </button>
            ))}
          </div>
        )}
      </div>
      {openPoId &&
        (() => {
          const po = orders.find((o) => o.id === openPoId);
          return po ? <PoPopup supabase={supabase} po={po} onClose={closePo} /> : null;
        })()}
    </div>
  );
}
