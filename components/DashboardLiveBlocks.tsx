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

const currencyFormatter = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
});

export default function DashboardLiveBlocks({ weekId }: { weekId: string | null }) {
  const supabase = useMemo(() => createClient(), []);

  const [distributors, setDistributors] = useState<Distributor[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [allocationQty, setAllocationQty] = useState<Record<string, number>>({}); // key: productId:distributorId
  const [prices, setPrices] = useState<Record<string, number>>({}); // key: productId:distributorId
  const [packaging, setPackaging] = useState<Record<string, number>>({}); // key: item_key
  const [labels, setLabels] = useState<Record<string, number>>({}); // key: productId
  const [poStatus, setPoStatus] = useState<Record<string, PoStatus>>({}); // key: distributorId
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
        supabase.from("distributor_pos").select("distributor_id, po_status").eq("week_id", weekId),
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
    for (const row of posRes.data ?? []) {
      poStatusMap[row.distributor_id] = row.po_status as PoStatus;
    }
    setPoStatus(poStatusMap);

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

  const grandOrderValue = distributors.reduce((sum, d) => sum + orderValueFor(d.id), 0);

  function totalAllocatedFor(productId: string) {
    return distributors.reduce((sum, d) => sum + (allocationQty[`${productId}:${d.id}`] ?? 0), 0);
  }

  const consumption = computeConsumption(products, totalAllocatedFor);

  const packagingShortages = PACKAGING_ITEMS.map((item) => ({
    ...item,
    remaining: (packaging[item.key] ?? 0) - (consumption.packagingConsumed[item.key] ?? 0),
  })).filter((item) => item.remaining < 0);

  const labelShortages = products
    .filter((p) => derivePackaging(p.name).kind === "can")
    .map((p) => ({
      product: p,
      remaining: (labels[p.id] ?? 0) - (consumption.labelConsumed[p.id] ?? 0),
    }))
    .filter((row) => row.remaining < 0);

  return (
    <Fragment>
      <div className="flex flex-col rounded-lg border border-neutral-800 bg-neutral-950 p-3">
        <h2 className="mb-2 shrink-0 text-xs font-semibold uppercase tracking-wide text-neutral-400">
          Distributor Order Values
        </h2>
        <div className="min-h-0 max-h-80 flex-1 overflow-y-auto">
          {loading ? (
            <p className="text-sm text-neutral-500">Loading…</p>
          ) : (
            <div className="divide-y divide-neutral-900">
              {distributors.map((d) => {
                const status = poStatus[d.id] ?? null;
                return (
                  <div key={d.id} className="flex items-center justify-between gap-2 px-1.5 py-1.5 text-sm">
                    <span className="truncate text-neutral-300" style={{ color: d.color ?? undefined }}>
                      {d.name}
                    </span>
                    <div className="flex shrink-0 items-center gap-2">
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
                      <span className="whitespace-nowrap font-semibold text-neutral-100">
                        {currencyFormatter.format(orderValueFor(d.id))}
                      </span>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
        <div className="mt-2 flex shrink-0 items-center justify-between gap-2 border-t border-neutral-800 px-1.5 pt-2 text-sm">
          <span className="font-semibold text-neutral-200">Combined Total</span>
          <span className="whitespace-nowrap font-semibold text-white">
            {loading ? "…" : currencyFormatter.format(grandOrderValue)}
          </span>
        </div>
      </div>

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
