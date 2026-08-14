"use client";

// Live-updating Dashboard blocks: each distributor's current order value
// (+ grand total), and packaging/label items that have gone into shortage
// (negative remaining — the same "need to order" signal used on the
// Inventory & Allocation page). All three read from the same current-week
// data and stay in sync via Supabase Realtime, so they update automatically
// as allocations, prices, or on-hand counts change elsewhere in the app —
// no page reload needed.

import { useEffect, useMemo, useState, useCallback } from "react";
import { createClient } from "@/lib/supabase/client";
import type { Product, Distributor, DistributorPrice, PackagingInventoryRow, LabelInventoryRow } from "@/lib/types/db";
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
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    if (!weekId) {
      setLoading(false);
      return;
    }

    const [distributorsRes, productsRes, allocationsRes, pricesRes, packagingRes, labelsRes] =
      await Promise.all([
        supabase.from("distributors").select("*").eq("active", true).order("name"),
        supabase.from("products").select("*").eq("active", true),
        supabase.from("allocations").select("product_id, distributor_id, quantity").eq("week_id", weekId),
        supabase.from("distributor_prices").select("product_id, distributor_id, price"),
        supabase.from("packaging_inventory").select("item_key, on_hand_qty").eq("week_id", weekId),
        supabase.from("label_inventory").select("product_id, on_hand_qty").eq("week_id", weekId),
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
    <div className="space-y-6">
      <div>
        <h2 className="mb-2 text-sm font-semibold text-neutral-100">Distributor Order Values</h2>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
          {distributors.map((d) => (
            <div key={d.id} className="rounded-lg border border-neutral-800 bg-neutral-950 p-4">
              <p
                className="truncate text-xs uppercase tracking-wide text-neutral-500"
                style={{ color: d.color ?? undefined }}
              >
                {d.name}
              </p>
              <p className="mt-1 text-xl font-semibold text-neutral-100">
                {loading ? "…" : currencyFormatter.format(orderValueFor(d.id))}
              </p>
            </div>
          ))}
          <div className="rounded-lg border border-neutral-700 bg-neutral-900 p-4">
            <p className="text-xs uppercase tracking-wide text-neutral-400">Combined Total</p>
            <p className="mt-1 text-xl font-semibold text-white">
              {loading ? "…" : currencyFormatter.format(grandOrderValue)}
            </p>
          </div>
        </div>
      </div>

      <div>
        <h2 className="mb-2 text-sm font-semibold text-neutral-100">Packaging Shortages</h2>
        {loading ? (
          <p className="text-sm text-neutral-500">Loading…</p>
        ) : packagingShortages.length === 0 ? (
          <p className="text-sm text-neutral-500">Nothing needs ordering right now.</p>
        ) : (
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
            {packagingShortages.map((item) => (
              <div key={item.key} className="rounded-lg border border-red-900/60 bg-neutral-950 p-4">
                <p className="text-xs uppercase tracking-wide text-neutral-500">{item.label}</p>
                <p className="mt-1 text-xl font-semibold text-red-400">{item.remaining}</p>
              </div>
            ))}
          </div>
        )}
      </div>

      <div>
        <h2 className="mb-2 text-sm font-semibold text-neutral-100">Label Shortages</h2>
        {loading ? (
          <p className="text-sm text-neutral-500">Loading…</p>
        ) : labelShortages.length === 0 ? (
          <p className="text-sm text-neutral-500">Nothing needs ordering right now.</p>
        ) : (
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
            {labelShortages.map((row) => (
              <div key={row.product.id} className="rounded-lg border border-red-900/60 bg-neutral-950 p-4">
                <p className="truncate text-xs uppercase tracking-wide text-neutral-500">{row.product.name}</p>
                <p className="mt-1 text-xl font-semibold text-red-400">{row.remaining}</p>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
