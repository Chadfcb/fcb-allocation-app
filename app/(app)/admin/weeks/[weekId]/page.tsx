"use client";

// Read-only snapshot of a single past week — everything Inventory &
// Allocation shows (on hand/unlabeled/to-package/total/remaining per
// product, allocations per distributor, order values, PO #/status,
// packaging & label inventory), rendered with no inputs and no edit
// controls. Reached by clicking a week in the Weeks list. Nothing here
// writes to the database, and nothing here is live/Realtime — it's a fixed
// look back at what a closed week's numbers were.
//
// Archived products/distributors/custom items are included (tagged
// "archived") whenever they actually have data for this week, so history
// stays intact even after something's since been removed from the live
// grid — a plain "active only" filter would otherwise silently drop rows
// that mattered at the time.

import { useEffect, useMemo, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import type {
  Week,
  Product,
  Distributor,
  InventoryWithRemaining,
  Allocation,
  DistributorPO,
  SectionDivider,
  PackagingInventoryRow,
  LabelInventoryRow,
  CustomPackagingItem,
  CustomPackagingInventoryRow,
  CustomLabelItem,
  CustomLabelInventoryRow,
  DistributorPrice,
} from "@/lib/types/db";
import { STATUS_FLAG_COLORS, PO_STATUS_LABELS, PO_STATUS_COLORS } from "@/lib/types/db";
import { PACKAGING_ITEMS, derivePackaging, computeConsumption } from "@/lib/packaging";
import { computePalletsForDistributor } from "@/lib/pallets";

type CombinedRow =
  | { kind: "product"; item: Product }
  | { kind: "divider"; item: SectionDivider };

function rowKey(row: CombinedRow): string {
  return row.kind === "product" ? `product:${row.item.id}` : `divider:${row.item.id}`;
}

function rowSortOrder(row: CombinedRow): number {
  if (row.kind === "divider") return row.item.sort_order;
  return row.item.sort_order ?? Number.MAX_SAFE_INTEGER;
}

const currencyFormatter = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
});

const PALLET_SUMMARY_DIVIDER_LABEL = "full circle brewing";

export default function WeekDetailPage() {
  const params = useParams<{ weekId: string }>();
  const weekId = params.weekId;
  const supabase = useMemo(() => createClient(), []);

  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [week, setWeek] = useState<Week | null>(null);
  const [rolledFromLabel, setRolledFromLabel] = useState<string | null>(null);
  const [products, setProducts] = useState<Product[]>([]);
  const [dividers, setDividers] = useState<SectionDivider[]>([]);
  const [distributors, setDistributors] = useState<Distributor[]>([]);
  const [inventory, setInventory] = useState<Record<string, InventoryWithRemaining>>({});
  const [allocations, setAllocations] = useState<Allocation[]>([]);
  const [pos, setPos] = useState<Record<string, DistributorPO>>({});
  const [packaging, setPackaging] = useState<Record<string, PackagingInventoryRow>>({});
  const [labelInventory, setLabelInventory] = useState<Record<string, LabelInventoryRow>>({});
  const [distributorPrices, setDistributorPrices] = useState<Record<string, DistributorPrice>>({});
  const [customPackagingItems, setCustomPackagingItems] = useState<CustomPackagingItem[]>([]);
  const [customPackagingInventory, setCustomPackagingInventory] = useState<
    Record<string, CustomPackagingInventoryRow>
  >({});
  const [customLabelItems, setCustomLabelItems] = useState<CustomLabelItem[]>([]);
  const [customLabelInventory, setCustomLabelInventory] = useState<
    Record<string, CustomLabelInventoryRow>
  >({});

  useEffect(() => {
    let cancelled = false;

    async function load() {
      setLoading(true);
      setNotFound(false);

      const { data: weekData } = await supabase
        .from("weeks")
        .select("*")
        .eq("id", weekId)
        .maybeSingle();

      if (cancelled) return;

      if (!weekData) {
        setNotFound(true);
        setLoading(false);
        return;
      }
      setWeek(weekData as Week);

      if ((weekData as Week).previous_week_id) {
        const { data: prevWeek } = await supabase
          .from("weeks")
          .select("label")
          .eq("id", (weekData as Week).previous_week_id as string)
          .maybeSingle();
        if (!cancelled) setRolledFromLabel((prevWeek as { label: string } | null)?.label ?? null);
      } else {
        setRolledFromLabel(null);
      }

      // Reference lists are fetched WITHOUT the "active only" filter the
      // live Inventory & Allocation page uses — this is a look back at
      // history, so anything that had data this week should still show up
      // even if it's since been archived. The relevance filters below (once
      // this week's actual data comes back) decide what's actually shown.
      const [
        { data: productData },
        { data: dividerData },
        { data: distributorData },
        { data: priceData },
        { data: customPkgItemData },
        { data: customLabelItemData },
        { data: invData },
        { data: allocData },
        { data: poData },
        { data: packagingData },
        { data: labelData },
        { data: customPkgInvData },
        { data: customLabelInvData },
      ] = await Promise.all([
        supabase.from("products").select("*").order("sort_order", { ascending: true, nullsFirst: false }).order("name"),
        supabase.from("section_dividers").select("*"),
        supabase.from("distributors").select("*").order("sort_order", { ascending: true, nullsFirst: false }).order("name"),
        supabase.from("distributor_prices").select("*"),
        supabase.from("custom_packaging_items").select("*").order("sort_order", { ascending: true, nullsFirst: false }).order("name"),
        supabase.from("custom_label_items").select("*").order("sort_order", { ascending: true, nullsFirst: false }).order("name"),
        supabase.from("inventory_with_remaining").select("*").eq("week_id", weekId),
        supabase.from("allocations").select("*").eq("week_id", weekId),
        supabase.from("distributor_pos").select("*").eq("week_id", weekId),
        supabase.from("packaging_inventory").select("*").eq("week_id", weekId),
        supabase.from("label_inventory").select("*").eq("week_id", weekId),
        supabase.from("custom_packaging_inventory").select("*").eq("week_id", weekId),
        supabase.from("custom_label_inventory").select("*").eq("week_id", weekId),
      ]);

      if (cancelled) return;

      setProducts((productData as Product[]) ?? []);
      setDividers((dividerData as SectionDivider[]) ?? []);
      setDistributors((distributorData as Distributor[]) ?? []);

      const priceMap: Record<string, DistributorPrice> = {};
      (priceData as DistributorPrice[] | null)?.forEach((row) => {
        priceMap[`${row.product_id}:${row.distributor_id}`] = row;
      });
      setDistributorPrices(priceMap);

      setCustomPackagingItems((customPkgItemData as CustomPackagingItem[]) ?? []);
      setCustomLabelItems((customLabelItemData as CustomLabelItem[]) ?? []);

      const invMap: Record<string, InventoryWithRemaining> = {};
      (invData as InventoryWithRemaining[] | null)?.forEach((row) => {
        invMap[row.product_id] = row;
      });
      setInventory(invMap);

      setAllocations((allocData as Allocation[]) ?? []);

      const poMap: Record<string, DistributorPO> = {};
      (poData as DistributorPO[] | null)?.forEach((row) => {
        poMap[row.distributor_id] = row;
      });
      setPos(poMap);

      const pkgMap: Record<string, PackagingInventoryRow> = {};
      (packagingData as PackagingInventoryRow[] | null)?.forEach((row) => {
        pkgMap[row.item_key] = row;
      });
      setPackaging(pkgMap);

      const lblMap: Record<string, LabelInventoryRow> = {};
      (labelData as LabelInventoryRow[] | null)?.forEach((row) => {
        lblMap[row.product_id] = row;
      });
      setLabelInventory(lblMap);

      const customPkgInvMap: Record<string, CustomPackagingInventoryRow> = {};
      (customPkgInvData as CustomPackagingInventoryRow[] | null)?.forEach((row) => {
        customPkgInvMap[row.item_id] = row;
      });
      setCustomPackagingInventory(customPkgInvMap);

      const customLabelInvMap: Record<string, CustomLabelInventoryRow> = {};
      (customLabelInvData as CustomLabelInventoryRow[] | null)?.forEach((row) => {
        customLabelInvMap[row.item_id] = row;
      });
      setCustomLabelInventory(customLabelInvMap);

      setLoading(false);
    }

    load();
    return () => {
      cancelled = true;
    };
  }, [supabase, weekId]);

  const allocationMap: Record<string, Allocation> = {};
  allocations.forEach((a) => {
    allocationMap[`${a.product_id}:${a.distributor_id}`] = a;
  });

  // Keep anything currently active, plus anything archived that still has
  // real data for this specific week — so a since-removed product or
  // distributor doesn't just vanish from its own history.
  const relevantProducts = products.filter(
    (p) =>
      p.active ||
      !!inventory[p.id] ||
      !!labelInventory[p.id] ||
      allocations.some((a) => a.product_id === p.id)
  );
  const relevantDistributors = distributors.filter(
    (d) => d.active || !!pos[d.id] || allocations.some((a) => a.distributor_id === d.id)
  );
  const relevantCustomPackagingItems = customPackagingItems.filter(
    (i) => i.active || !!customPackagingInventory[i.id]
  );
  const relevantCustomLabelItems = customLabelItems.filter(
    (i) => i.active || !!customLabelInventory[i.id]
  );

  function totalFor(productId: string) {
    const inv = inventory[productId];
    if (!inv) return 0;
    return inv.on_hand + inv.unlabeled + inv.to_be_packaged;
  }

  function allocatedFor(productId: string) {
    return relevantDistributors.reduce(
      (sum, d) => sum + (allocationMap[`${productId}:${d.id}`]?.quantity ?? 0),
      0
    );
  }

  function remainingFor(productId: string) {
    return totalFor(productId) - allocatedFor(productId);
  }

  function orderValueFor(distributorId: string) {
    return relevantProducts.reduce((sum, p) => {
      const qty = allocationMap[`${p.id}:${distributorId}`]?.quantity ?? 0;
      const price = distributorPrices[`${p.id}:${distributorId}`]?.price ?? 0;
      return sum + price * qty;
    }, 0);
  }

  const grandOrderValue = relevantDistributors.reduce((sum, d) => sum + orderValueFor(d.id), 0);

  function palletsFor(distributorId: string): number {
    return computePalletsForDistributor(
      relevantProducts,
      (productId) => allocationMap[`${productId}:${distributorId}`]?.quantity ?? 0
    );
  }

  const consumption = computeConsumption(relevantProducts, allocatedFor);

  const labelProducts = relevantProducts
    .filter((p) => derivePackaging(p.name).kind === "can")
    .sort((a, b) => (a.sort_order ?? Number.MAX_SAFE_INTEGER) - (b.sort_order ?? Number.MAX_SAFE_INTEGER));

  const combined: CombinedRow[] = [
    ...relevantProducts.map((p): CombinedRow => ({ kind: "product", item: p })),
    ...dividers.map((d): CombinedRow => ({ kind: "divider", item: d })),
  ].sort((a, b) => rowSortOrder(a) - rowSortOrder(b));

  if (loading) {
    return <p className="text-sm text-neutral-400">Loading…</p>;
  }

  if (notFound || !week) {
    return (
      <div className="space-y-3">
        <p className="text-sm text-neutral-400">That week couldn&apos;t be found.</p>
        <Link href="/admin/weeks" className="text-sm text-blue-400 hover:underline">
          ← Back to Weeks
        </Link>
      </div>
    );
  }

  return (
    <div className="flex flex-col space-y-3">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <div>
          <Link href="/admin/weeks" className="text-xs text-blue-400 hover:underline">
            ← Back to Weeks
          </Link>
          <h1 className="mt-1 text-lg font-semibold text-neutral-100">{week.label}</h1>
          <p className="text-sm text-neutral-400">
            Week of {week.week_start} · <span className="capitalize">{week.status}</span>
            {rolledFromLabel && <> · rolled forward from {rolledFromLabel}</>}
          </p>
        </div>
        <span className="rounded-md border border-neutral-700 bg-neutral-900 px-2 py-1 text-xs text-neutral-400">
          Read-only snapshot — nothing here can be edited
        </span>
      </div>

      <div className="flex flex-wrap gap-3">
        <div className="min-w-[380px] flex-1 shrink-0 self-start rounded-lg border border-neutral-800 bg-neutral-950 p-3">
          <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-neutral-400">
            Packaging Inventory
          </h2>
          <table className="w-full text-xs">
            <thead>
              <tr className="text-neutral-500">
                <th className="px-1.5 py-1 text-left">Item</th>
                <th className="px-1.5 py-1 text-right">On Hand</th>
                <th className="px-1.5 py-1 text-right">Consumed</th>
                <th className="px-1.5 py-1 text-right">Remaining</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-neutral-900">
              {PACKAGING_ITEMS.map((item) => {
                const onHand = packaging[item.key]?.on_hand_qty ?? 0;
                const consumed = consumption.packagingConsumed[item.key] ?? 0;
                const remaining = onHand - consumed;
                return (
                  <tr key={item.key}>
                    <td className="px-1.5 py-1 text-neutral-300">{item.label}</td>
                    <td className="px-1.5 py-1 text-right text-neutral-200">{onHand}</td>
                    <td className="px-1.5 py-1 text-right text-neutral-400">{consumed}</td>
                    <td
                      className={`px-1.5 py-1 text-right font-semibold ${
                        remaining < 0 ? "text-red-400" : "text-neutral-200"
                      }`}
                    >
                      {remaining}
                    </td>
                  </tr>
                );
              })}
              {relevantCustomPackagingItems.map((item) => {
                const onHand = customPackagingInventory[item.id]?.on_hand_qty ?? 0;
                return (
                  <tr key={item.id}>
                    <td className="px-1.5 py-1 text-neutral-300">
                      {item.name}
                      {!item.active && (
                        <span className="ml-1.5 text-[10px] uppercase tracking-wide text-neutral-600">
                          archived
                        </span>
                      )}
                    </td>
                    <td className="px-1.5 py-1 text-right text-neutral-200">{onHand}</td>
                    <td className="px-1.5 py-1 text-right text-neutral-600">—</td>
                    <td className="px-1.5 py-1 text-right text-neutral-600">—</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        <div className="flex min-h-0 min-w-[380px] flex-1 flex-col rounded-lg border border-neutral-800 bg-neutral-950 p-3">
          <h2 className="mb-2 shrink-0 text-xs font-semibold uppercase tracking-wide text-neutral-400">
            Label Inventory
          </h2>
          <div className="min-h-0 max-h-96 flex-1 overflow-y-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="text-neutral-500">
                  <th className="sticky top-0 bg-neutral-950 px-1.5 py-1 text-left">Product</th>
                  <th className="sticky top-0 bg-neutral-950 px-1.5 py-1 text-right">On Hand</th>
                  <th className="sticky top-0 bg-neutral-950 px-1.5 py-1 text-right">Consumed</th>
                  <th className="sticky top-0 bg-neutral-950 px-1.5 py-1 text-right">Remaining</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-neutral-900">
                {labelProducts.map((p) => {
                  const onHand = labelInventory[p.id]?.on_hand_qty ?? 0;
                  const consumed = consumption.labelConsumed[p.id] ?? 0;
                  const remaining = onHand - consumed;
                  return (
                    <tr key={p.id}>
                      <td className="whitespace-nowrap px-1.5 py-1 text-neutral-300">
                        {p.name}
                        {!p.active && (
                          <span className="ml-1.5 text-[10px] uppercase tracking-wide text-neutral-600">
                            archived
                          </span>
                        )}
                      </td>
                      <td className="px-1.5 py-1 text-right text-neutral-200">{onHand}</td>
                      <td className="px-1.5 py-1 text-right text-neutral-400">{consumed}</td>
                      <td
                        className={`px-1.5 py-1 text-right font-semibold ${
                          remaining < 0 ? "text-red-400" : "text-neutral-200"
                        }`}
                      >
                        {remaining}
                      </td>
                    </tr>
                  );
                })}
                {relevantCustomLabelItems.map((item) => {
                  const onHand = customLabelInventory[item.id]?.on_hand_qty ?? 0;
                  return (
                    <tr key={item.id}>
                      <td className="whitespace-nowrap px-1.5 py-1 text-neutral-300">
                        {item.name}
                        {!item.active && (
                          <span className="ml-1.5 text-[10px] uppercase tracking-wide text-neutral-600">
                            archived
                          </span>
                        )}
                      </td>
                      <td className="px-1.5 py-1 text-right text-neutral-200">{onHand}</td>
                      <td className="px-1.5 py-1 text-right text-neutral-600">—</td>
                      <td className="px-1.5 py-1 text-right text-neutral-600">—</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      {consumption.unrecognizedProducts.length > 0 && (
        <div className="rounded-lg border border-amber-700/60 bg-amber-950/30 px-3 py-2 text-xs text-amber-300">
          {consumption.unrecognizedProducts.length} product name(s) didn&apos;t clearly state a
          can/keg size, so they&apos;re not included in the packaging/label totals above:{" "}
          {consumption.unrecognizedProducts.join(", ")}.
        </div>
      )}

      <div className="overflow-x-auto rounded-lg border border-neutral-800 bg-neutral-950">
        <table className="w-full border-collapse text-sm">
          <thead>
            <tr className="h-8 text-xs uppercase tracking-wide text-neutral-500">
              <th className="sticky top-0 left-0 z-20 h-8 whitespace-nowrap bg-neutral-900 px-3 text-left">
                Product
              </th>
              <th className="sticky top-0 z-10 h-8 whitespace-nowrap bg-neutral-900 px-2 text-right">
                On Hand
              </th>
              <th className="sticky top-0 z-10 h-8 whitespace-nowrap bg-neutral-900 px-2 text-right">
                Unlabeled
              </th>
              <th className="sticky top-0 z-10 h-8 whitespace-nowrap bg-neutral-900 px-2 text-right">
                To Package
              </th>
              <th className="sticky top-0 z-10 h-8 whitespace-nowrap bg-neutral-900 px-2 text-right font-semibold">
                Total
              </th>
              {relevantDistributors.map((d) => (
                <th
                  key={d.id}
                  className="sticky top-0 z-10 h-8 whitespace-nowrap bg-neutral-900 px-2 text-right"
                  style={{ color: d.color ?? undefined }}
                >
                  {d.name}
                  {!d.active && <span className="ml-1 text-[10px] normal-case text-neutral-600">(archived)</span>}
                </th>
              ))}
              <th className="sticky top-0 right-0 z-10 h-8 whitespace-nowrap bg-neutral-900 px-2 text-right font-semibold">
                Remaining
              </th>
            </tr>
            <tr className="h-7 text-[10px] uppercase tracking-wide text-neutral-400">
              <th className="sticky top-8 left-0 z-20 h-7 whitespace-nowrap bg-neutral-900 px-3 text-left font-semibold">
                Order Value
              </th>
              <th className="sticky top-8 z-10 h-7 whitespace-nowrap bg-neutral-900 px-2"></th>
              <th className="sticky top-8 z-10 h-7 whitespace-nowrap bg-neutral-900 px-2"></th>
              <th className="sticky top-8 z-10 h-7 whitespace-nowrap bg-neutral-900 px-2"></th>
              <th className="sticky top-8 z-10 h-7 whitespace-nowrap bg-neutral-900 px-2"></th>
              {relevantDistributors.map((d) => (
                <th
                  key={d.id}
                  className="sticky top-8 z-10 h-7 whitespace-nowrap bg-neutral-900 px-2 text-right font-semibold text-neutral-200"
                >
                  {currencyFormatter.format(orderValueFor(d.id))}
                </th>
              ))}
              <th className="sticky top-8 right-0 z-10 h-7 whitespace-nowrap bg-neutral-900 px-2 text-right font-semibold text-neutral-100">
                Total: {currencyFormatter.format(grandOrderValue)}
              </th>
            </tr>
            <tr className="h-7 text-[10px] uppercase tracking-wide text-neutral-600">
              <th className="sticky top-[60px] left-0 z-20 h-7 whitespace-nowrap bg-neutral-900 px-3 text-left font-normal">
                PO # (Ekos)
              </th>
              <th className="sticky top-[60px] z-10 h-7 whitespace-nowrap bg-neutral-900 px-2"></th>
              <th className="sticky top-[60px] z-10 h-7 whitespace-nowrap bg-neutral-900 px-2"></th>
              <th className="sticky top-[60px] z-10 h-7 whitespace-nowrap bg-neutral-900 px-2"></th>
              <th className="sticky top-[60px] z-10 h-7 whitespace-nowrap bg-neutral-900 px-2"></th>
              {relevantDistributors.map((d) => (
                <th
                  key={d.id}
                  className="sticky top-[60px] z-10 h-7 whitespace-nowrap bg-neutral-900 px-2 text-right font-normal normal-case text-neutral-300"
                >
                  {pos[d.id]?.po_number || "—"}
                </th>
              ))}
              <th className="sticky top-[60px] right-0 z-10 h-7 whitespace-nowrap bg-neutral-900 px-2"></th>
            </tr>
            <tr className="h-7 text-[10px] uppercase tracking-wide text-neutral-600">
              <th className="sticky top-[88px] left-0 z-20 h-7 whitespace-nowrap bg-neutral-900 px-3 text-left font-normal">
                PO Status
              </th>
              <th className="sticky top-[88px] z-10 h-7 whitespace-nowrap bg-neutral-900 px-2"></th>
              <th className="sticky top-[88px] z-10 h-7 whitespace-nowrap bg-neutral-900 px-2"></th>
              <th className="sticky top-[88px] z-10 h-7 whitespace-nowrap bg-neutral-900 px-2"></th>
              <th className="sticky top-[88px] z-10 h-7 whitespace-nowrap bg-neutral-900 px-2"></th>
              {relevantDistributors.map((d) => {
                const status = pos[d.id]?.po_status ?? null;
                const bgColor = status ? PO_STATUS_COLORS[status] : undefined;
                return (
                  <th
                    key={d.id}
                    className="sticky top-[88px] z-10 h-7 whitespace-nowrap bg-neutral-900 px-2 text-right"
                  >
                    <span
                      className="inline-block rounded px-1.5 py-0.5 text-[10px] font-semibold normal-case"
                      style={{
                        backgroundColor: bgColor ?? "#171717",
                        color: bgColor ? "#000000" : "#737373",
                      }}
                    >
                      {status ? PO_STATUS_LABELS[status] : "—"}
                    </span>
                  </th>
                );
              })}
              <th className="sticky top-[88px] right-0 z-10 h-7 whitespace-nowrap bg-neutral-900 px-2"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-neutral-900">
            {combined.map((row) => {
              if (row.kind === "divider") {
                const d = row.item;
                const labelRow = (
                  <span className="text-xs font-semibold uppercase tracking-wide text-neutral-300">
                    {d.label}
                  </span>
                );

                if (d.label.trim().toLowerCase() === PALLET_SUMMARY_DIVIDER_LABEL) {
                  return (
                    <tr key={rowKey(row)} className="bg-neutral-900/70">
                      <td colSpan={5} className="px-3 py-1.5">
                        <div className="flex items-center justify-between gap-2">
                          {labelRow}
                          <span className="whitespace-nowrap text-[10px] normal-case text-neutral-500">
                            Total Pallets (all products, all brands) —
                          </span>
                        </div>
                      </td>
                      {relevantDistributors.map((dist) => (
                        <td
                          key={dist.id}
                          title="Total pallets for this distributor's whole order (kegs + cans, all brands)"
                          className="px-2 py-1.5 text-right text-xs font-semibold text-neutral-200"
                        >
                          {palletsFor(dist.id)}
                        </td>
                      ))}
                      <td className="px-2 py-1.5"></td>
                    </tr>
                  );
                }

                return (
                  <tr key={rowKey(row)} className="bg-neutral-900/70">
                    <td colSpan={6 + relevantDistributors.length} className="px-3 py-1.5">
                      {labelRow}
                    </td>
                  </tr>
                );
              }

              const p = row.item;
              const remaining = remainingFor(p.id);
              return (
                <tr key={rowKey(row)} className="hover:bg-neutral-900/60">
                  <td className="sticky left-0 z-10 whitespace-nowrap bg-neutral-950 px-3 py-1.5 font-medium text-neutral-200">
                    {p.name}
                    {!p.active && (
                      <span className="ml-1.5 text-[10px] uppercase tracking-wide text-neutral-600">
                        archived
                      </span>
                    )}
                  </td>
                  <td className="px-2 py-1.5 text-right text-neutral-200">{inventory[p.id]?.on_hand ?? 0}</td>
                  <td className="px-2 py-1.5 text-right text-neutral-200">{inventory[p.id]?.unlabeled ?? 0}</td>
                  <td className="px-2 py-1.5 text-right text-neutral-200">
                    {inventory[p.id]?.to_be_packaged ?? 0}
                  </td>
                  <td className="px-2 py-1.5 text-right font-semibold text-neutral-300">
                    {totalFor(p.id)}
                  </td>
                  {relevantDistributors.map((d) => {
                    const cell = allocationMap[`${p.id}:${d.id}`];
                    const flag = cell?.status_flag ?? null;
                    const flagColor = flag ? STATUS_FLAG_COLORS[flag] : null;
                    return (
                      <td key={d.id} className="px-2 py-1.5 text-right">
                        <span
                          className="inline-block min-w-[3rem] rounded px-1.5 py-0.5 text-right"
                          style={{
                            backgroundColor: flagColor ?? "transparent",
                            color: flagColor ? "#000000" : "#f5f5f5",
                          }}
                        >
                          {cell?.quantity ?? 0}
                        </span>
                      </td>
                    );
                  })}
                  <td
                    className={`sticky right-0 z-10 bg-neutral-950 px-2 py-1.5 text-right font-semibold ${
                      remaining < 0 ? "text-red-400" : "text-neutral-200"
                    }`}
                  >
                    {remaining}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <p className="text-xs text-neutral-500">
        This is a fixed snapshot of {week.label} — none of these numbers update, and nothing on
        this page can be changed. Go to Inventory &amp; Allocation to edit the current week.
      </p>
    </div>
  );
}
