"use client";

// Live-updating Dashboard blocks: each distributor's current order value
// (+ grand total), and packaging/label items that have gone into shortage
// (negative remaining — the same "need to order" signal used on the
// Inventory & Allocation page). All three read from the same current-week
// data and stay in sync via Supabase Realtime, so they update automatically
// as allocations, prices, or on-hand counts change elsewhere in the app —
// no page reload needed.
//
// Renders as a Fragment (no wrapping grid div) so the parent page can lay
// these 3 cards out in one shared grid alongside the Purchase Orders card —
// see app/(app)/dashboard/page.tsx for the grid that arranges all 4.
//
// 2026-10-22 (Chad): delivered orders show their delivery date before the
// Delivered tag (distributor_pos.delivery_date — auto-set when the PO is
// marked Delivered on Inventory & Allocation, editable there), and every
// order row is clickable → a pop-up listing that order's items (this week's
// allocations for that distributor × that distributor's price), with the same
// total as the row. New! badge: feature:dashboard-order-popup.

import { Fragment, useEffect, useMemo, useState, useCallback } from "react";
import { createClient } from "@/lib/supabase/client";
import type {
  Product,
  Distributor,
  DistributorPrice,
  PackagingInventoryRow,
  LabelInventoryRow,
  PoStatus,
} from "@/lib/types/db";
import { PO_STATUS_LABELS, PO_STATUS_COLORS } from "@/lib/types/db";
import { PACKAGING_ITEMS, derivePackaging, computeConsumption } from "@/lib/packaging";
import { chipText } from "@/lib/appearance";
import { Modal } from "@/components/SalesDashboardHome";
import { useNewFeature } from "@/lib/newFeatures";
import NewBadge from "@/components/NewBadge";

const currencyFormatter = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
});

// delivery_date is a plain date ("2026-10-19") — format it as 10/19/26
// without going through Date(), so it never shifts a day for time zone.
function formatShortDate(iso: string | null | undefined) {
  if (!iso) return "";
  const [y, m, d] = iso.slice(0, 10).split("-");
  if (!y || !m || !d) return "";
  return `${Number(m)}/${Number(d)}/${y.slice(2)}`;
}

export default function DashboardLiveBlocks({ weekId, weekLabel }: { weekId: string | null; weekLabel?: string | null }) {
  const supabase = useMemo(() => createClient(), []);

  const [distributors, setDistributors] = useState<Distributor[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [allocationQty, setAllocationQty] = useState<Record<string, number>>({}); // key: productId:distributorId
  const [prices, setPrices] = useState<Record<string, number>>({}); // key: productId:distributorId
  const [packaging, setPackaging] = useState<Record<string, number>>({}); // key: item_key
  const [labels, setLabels] = useState<Record<string, number>>({}); // key: productId
  const [poStatus, setPoStatus] = useState<Record<string, PoStatus>>({}); // key: distributorId
  const [poInfo, setPoInfo] = useState<Record<string, { poNumber: string | null; deliveryDate: string | null }>>({}); // key: distributorId
  const [openOrderId, setOpenOrderId] = useState<string | null>(null); // distributorId whose order pop-up is open
  const orderPopupNew = useNewFeature("feature:dashboard-order-popup");
  const closeOrder = useCallback(() => setOpenOrderId(null), []);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    if (!weekId) {
      setLoading(false);
      return;
    }

    const [distributorsRes, productsRes, allocationsRes, pricesRes, packagingRes, labelsRes, posRes] =
      await Promise.all([
        supabase.from("distributors").select("*").eq("active", true).order("name"),
        supabase.from("products").select("*").eq("active", true),
        supabase.from("allocations").select("product_id, distributor_id, quantity").eq("week_id", weekId),
        supabase.from("distributor_prices").select("product_id, distributor_id, price"),
        supabase.from("packaging_inventory").select("item_key, on_hand_qty").eq("week_id", weekId),
        supabase.from("label_inventory").select("product_id, on_hand_qty").eq("week_id", weekId),
        supabase.from("distributor_pos").select("distributor_id, po_status, po_number, delivery_date").eq("week_id", weekId),
      ]);

    setDistributors((distributorsRes.data as Distributor[]) ?? []);
    setProducts((productsRes.data as Product[]) ?? []);

    const allocMap: Record<string, number> = {};
    for (const row of allocationsRes.data ?? []) {
      allocMap[`${row.product_id}:${row.distributor_id}`] = row.quantity;
    }
    setAllocationQty(allocMap);

    const priceMap: Record<string, number> = {};
    for (const row of (pricesRes.data as DistributorPrice[]) ?? []) {
      priceMap[`${row.product_id}:${row.distributor_id}`] = row.price;
    }
    setPrices(priceMap);

    const packagingMap: Record<string, number> = {};
    for (const row of (packagingRes.data as PackagingInventoryRow[]) ?? []) {
      packagingMap[row.item_key] = row.on_hand_qty;
    }
    setPackaging(packagingMap);

    const labelMap: Record<string, number> = {};
    for (const row of (labelsRes.data as LabelInventoryRow[]) ?? []) {
      labelMap[row.product_id] = row.on_hand_qty;
    }
    setLabels(labelMap);

    const poStatusMap: Record<string, PoStatus> = {};
    const poInfoMap: Record<string, { poNumber: string | null; deliveryDate: string | null }> = {};
    for (const row of posRes.data ?? []) {
      poStatusMap[row.distributor_id] = row.po_status as PoStatus;
      poInfoMap[row.distributor_id] = {
        poNumber: (row.po_number as string | null) ?? null,
        deliveryDate: (row.delivery_date as string | null) ?? null,
      };
    }
    setPoStatus(poStatusMap);
    setPoInfo(poInfoMap);

    setLoading(false);
  }, [supabase, weekId]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- intentional fetch-on-mount
    load();

    if (!weekId) return;

    // Any change to allocations, prices, or on-hand counts affects at least
    // one of these blocks, so a single shared channel just reloads everything
    // rather than trying to patch state per event type/table.
    const channel = supabase
      .channel(`dashboard-live-${weekId}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "allocations", filter: `week_id=eq.${weekId}` },
        load
      )
      .on("postgres_changes", { event: "*", schema: "public", table: "distributor_prices" }, load)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "packaging_inventory", filter: `week_id=eq.${weekId}` },
        load
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "label_inventory", filter: `week_id=eq.${weekId}` },
        load
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "distributor_pos", filter: `week_id=eq.${weekId}` },
        load
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [supabase, weekId, load]);

  if (!weekId) {
    return (
      <p className="text-sm text-neutral-500">
        No week started yet — these will populate once a week is started.
      </p>
    );
  }

  function orderValueFor(distributorId: string) {
    return products.reduce((sum, p) => {
      const qty = allocationQty[`${p.id}:${distributorId}`] ?? 0;
      const price = prices[`${p.id}:${distributorId}`] ?? 0;
      return sum + price * qty;
    }, 0);
  }

  // One order's lines for the pop-up: every product with a quantity this
  // week for that distributor, in the same order as Inventory & Allocation.
  function orderLinesFor(distributorId: string) {
    return [...products]
      .sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0) || a.name.localeCompare(b.name))
      .map((p) => {
        const qty = allocationQty[`${p.id}:${distributorId}`] ?? 0;
        const price = prices[`${p.id}:${distributorId}`] ?? 0;
        return { id: p.id, name: p.name, qty, price, total: qty * price };
      })
      .filter((line) => line.qty !== 0);
  }

  const grandOrderValue = distributors.reduce((sum, d) => sum + orderValueFor(d.id), 0);

  // Distributor Order Values sort: Delivered -> Approved -> Pending -> no
  // status, alphabetical within each group. Renders from this sorted copy;
  // `distributors` itself stays in its original (alphabetical) order since
  // other blocks below don't care about PO status.
  const STATUS_SORT_RANK: Record<string, number> = { delivered: 0, approved: 1, pending: 2 };
  function statusRankFor(status: PoStatus) {
    return status ? (STATUS_SORT_RANK[status] ?? 3) : 3;
  }
  const sortedDistributors = [...distributors].sort((a, b) => {
    const rankDiff = statusRankFor(poStatus[a.id] ?? null) - statusRankFor(poStatus[b.id] ?? null);
    if (rankDiff !== 0) return rankDiff;
    return a.name.localeCompare(b.name);
  });

  function totalForStatus(status: PoStatus) {
    return distributors.reduce((sum, d) => {
      const s = poStatus[d.id] ?? null;
      return s === status ? sum + orderValueFor(d.id) : sum;
    }, 0);
  }
  const deliveredTotal = totalForStatus("delivered");
  const approvedTotal = totalForStatus("approved");
  const pendingTotal = totalForStatus("pending");
  const noStatusTotal = totalForStatus(null);

  function totalAllocatedFor(productId: string) {
    return distributors.reduce((sum, d) => sum + (allocationQty[`${productId}:${d.id}`] ?? 0), 0);
  }

  const consumption = computeConsumption(products, totalAllocatedFor);

  const packagingShortages = PACKAGING_ITEMS.map((item) => ({
    ...item,
    remaining: (packaging[item.key] ?? 0) - (consumption.packagingConsumed[item.key] ?? 0),
  })).filter((item) => item.remaining <= 0);

  const labelShortages = products
    .filter((p) => derivePackaging(p.name).kind === "can")
    .map((p) => ({
      product: p,
      remaining: (labels[p.id] ?? 0) - (consumption.labelConsumed[p.id] ?? 0),
    }))
    .filter((row) => row.remaining <= 0);

  return (
    <Fragment>
      <div className="flex flex-col rounded-lg border border-neutral-800 bg-neutral-950 p-3">
        <h2 className="mb-2 flex shrink-0 items-center text-xs font-semibold uppercase tracking-wide text-neutral-400">
          Distributor Order Values
          {orderPopupNew.isNew && <NewBadge inline />}
          {orderPopupNew.isNew && (
            <span className="ml-2 text-[10px] font-normal normal-case tracking-normal text-neutral-500">
              Click an order to see its items
            </span>
          )}
        </h2>
        <div className="min-h-0 max-h-80 flex-1 overflow-y-auto">
          {loading ? (
            <p className="text-sm text-neutral-500">Loading…</p>
          ) : (
            <div className="divide-y divide-neutral-900">
              {sortedDistributors.map((d) => {
                const status = poStatus[d.id] ?? null;
                const deliveryDate = status === "delivered" ? formatShortDate(poInfo[d.id]?.deliveryDate) : "";
                return (
                  <button
                    type="button"
                    key={d.id}
                    onClick={() => {
                      setOpenOrderId(d.id);
                      orderPopupNew.dismiss();
                    }}
                    title={`See ${d.name}'s order`}
                    className="flex w-full cursor-pointer items-center justify-between gap-2 rounded px-1.5 py-1.5 text-left text-sm hover:bg-neutral-900"
                  >
                    <span className="truncate text-neutral-300" style={{ color: d.color ? chipText(d.color) : undefined }}>
                      {d.name}
                    </span>
                    <div className="flex shrink-0 items-center gap-2">
                      {/* Delivery date slot (fixed width, before the tag) so
                          the tags stay lined up whether or not a row has one. */}
                      <span className="w-14 shrink-0 whitespace-nowrap text-right text-xs text-neutral-400">
                        {deliveryDate}
                      </span>
                      {/* Fixed-width slot so the badge lines up in a vertical
                          column regardless of this row's dollar total width. */}
                      <div className="flex w-20 shrink-0 justify-center">
                        {status ? (
                          <span
                            className="whitespace-nowrap rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide"
                            style={{ backgroundColor: PO_STATUS_COLORS[status], color: "#000000" }}
                          >
                            {PO_STATUS_LABELS[status]}
                          </span>
                        ) : (
                          <span className="whitespace-nowrap text-[10px] uppercase tracking-wide text-neutral-600">
                            —
                          </span>
                        )}
                      </div>
                      <span className="w-24 shrink-0 whitespace-nowrap text-right font-semibold text-neutral-100">
                        {currencyFormatter.format(orderValueFor(d.id))}
                      </span>
                    </div>
                  </button>
                );
              })}
            </div>
          )}
        </div>
        <div className="mt-2 flex shrink-0 flex-wrap items-center gap-x-4 gap-y-1 border-t border-neutral-800 px-1.5 pt-2 text-sm">
          <span className="font-semibold text-neutral-200">Combined Total</span>
          <span className="whitespace-nowrap font-semibold text-white">
            {loading ? "…" : currencyFormatter.format(grandOrderValue)}
          </span>
          <span className="whitespace-nowrap" style={{ color: PO_STATUS_COLORS.delivered }}>
            Delivered Total{" "}
            <span className="font-semibold">{loading ? "…" : currencyFormatter.format(deliveredTotal)}</span>
          </span>
          <span className="whitespace-nowrap" style={{ color: PO_STATUS_COLORS.approved }}>
            Approved Total{" "}
            <span className="font-semibold">{loading ? "…" : currencyFormatter.format(approvedTotal)}</span>
          </span>
          <span className="whitespace-nowrap" style={{ color: PO_STATUS_COLORS.pending }}>
            Pending Total{" "}
            <span className="font-semibold">{loading ? "…" : currencyFormatter.format(pendingTotal)}</span>
          </span>
          <span className="whitespace-nowrap text-neutral-500">
            No Status{" "}
            <span className="font-semibold text-neutral-300">
              {loading ? "…" : currencyFormatter.format(noStatusTotal)}
            </span>
          </span>
        </div>
      </div>

      {openOrderId && (() => {
        const d = distributors.find((x) => x.id === openOrderId);
        if (!d) return null;
        const status = poStatus[d.id] ?? null;
        const info = poInfo[d.id];
        const lines = orderLinesFor(d.id);
        const total = orderValueFor(d.id);
        const sub = [
          weekLabel ?? null,
          info?.poNumber ? `PO ${info.poNumber}` : "No PO number yet",
        ]
          .filter(Boolean)
          .join(" · ");
        return (
          <Modal title={`${d.name} order`} sub={sub} onClose={closeOrder}>
            <div className="mb-3 flex flex-wrap items-center gap-2 text-sm">
              {status ? (
                <span
                  className="whitespace-nowrap rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide"
                  style={{ backgroundColor: PO_STATUS_COLORS[status], color: "#000000" }}
                >
                  {PO_STATUS_LABELS[status]}
                </span>
              ) : (
                <span className="text-xs text-neutral-500">No status yet</span>
              )}
              {status === "delivered" && info?.deliveryDate && (
                <span className="text-xs text-neutral-400">Delivered {formatShortDate(info.deliveryDate)}</span>
              )}
            </div>
            {lines.length === 0 ? (
              <p className="text-sm text-neutral-500">No items on this order yet.</p>
            ) : (
              <div className="max-h-[60vh] overflow-y-auto rounded-lg border border-neutral-800">
                <table className="w-full text-sm">
                  <thead className="sticky top-0 bg-neutral-900 text-[11px] uppercase tracking-wide text-neutral-400">
                    <tr>
                      <th className="px-3 py-2 text-left font-semibold">Item</th>
                      <th className="px-3 py-2 text-right font-semibold">Qty</th>
                      <th className="px-3 py-2 text-right font-semibold">Price</th>
                      <th className="px-3 py-2 text-right font-semibold">Total</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-neutral-900">
                    {lines.map((line) => (
                      <tr key={line.id}>
                        <td className="px-3 py-1.5 text-neutral-200">{line.name}</td>
                        <td className="px-3 py-1.5 text-right text-neutral-200">{line.qty}</td>
                        <td className="px-3 py-1.5 text-right text-neutral-400">
                          {line.price ? currencyFormatter.format(line.price) : "No price"}
                        </td>
                        <td className="px-3 py-1.5 text-right font-semibold text-neutral-100">
                          {currencyFormatter.format(line.total)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            <div className="mt-3 flex items-center justify-between border-t border-neutral-800 px-1 pt-2 text-sm">
              <span className="text-neutral-400">
                {lines.length} {lines.length === 1 ? "item" : "items"} ·{" "}
                {lines.reduce((sum, l) => sum + l.qty, 0)} total qty
              </span>
              <span className="font-semibold text-white">Order total {currencyFormatter.format(total)}</span>
            </div>
          </Modal>
        );
      })()}

      <div className="flex flex-col rounded-lg border border-neutral-800 bg-neutral-950 p-3">
        <h2 className="mb-2 shrink-0 text-xs font-semibold uppercase tracking-wide text-neutral-400">
          Packaging Shortages
        </h2>
        <div className="min-h-0 max-h-80 flex-1 overflow-y-auto">
          {loading ? (
            <p className="text-sm text-neutral-500">Loading…</p>
          ) : packagingShortages.length === 0 ? (
            <p className="text-sm text-neutral-500">Nothing needs ordering right now.</p>
          ) : (
            <div className="divide-y divide-neutral-900">
              {packagingShortages.map((item) => (
                <div key={item.key} className="flex items-center justify-between gap-2 px-1.5 py-1.5 text-sm">
                  <span className="truncate text-neutral-300">{item.label}</span>
                  <span className="whitespace-nowrap font-semibold text-red-400">{item.remaining}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      <div className="flex flex-col rounded-lg border border-neutral-800 bg-neutral-950 p-3">
        <h2 className="mb-2 shrink-0 text-xs font-semibold uppercase tracking-wide text-neutral-400">
          Label Shortages
        </h2>
        <div className="min-h-0 max-h-80 flex-1 overflow-y-auto">
          {loading ? (
            <p className="text-sm text-neutral-500">Loading…</p>
          ) : labelShortages.length === 0 ? (
            <p className="text-sm text-neutral-500">Nothing needs ordering right now.</p>
          ) : (
            <div className="divide-y divide-neutral-900">
              {labelShortages.map((row) => (
                <div key={row.product.id} className="flex items-center justify-between gap-2 px-1.5 py-1.5 text-sm">
                  <span className="truncate text-neutral-300">{row.product.name}</span>
                  <span className="whitespace-nowrap font-semibold text-red-400">{row.remaining}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </Fragment>
  );
}
