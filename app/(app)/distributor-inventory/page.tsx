"use client";

// Operations > Distributor Inventory — one block showing every distributor's
// on-hand inventory of FCB's own products, side by side: distributors as
// column groups left to right, products as rows underneath. Each
// distributor gets three sub-columns — On Hand, Daily Rate of Sale, and
// Projected Days on Hand — mirroring Ekos's own Distributor Inventory
// report. This replaced the old one-distributor-at-a-time Distributor Data
// page entirely.
//
// Data arrives the same way Purchase Orders does: there's no live Ekos API,
// so a live Claude-in-Chrome session (or Chad by hand) reads Ekos's own
// "Distributor Inventory" report and posts the numbers to
// /api/distributor-inventory/sync, matched up to FCB Data's distributor and
// product names. On Hand and Daily Rate of Sale are also editable by hand
// for a quick manual correction; Projected Days on Hand is always computed
// (on hand ÷ daily rate), never stored.

import { Fragment, useEffect, useMemo, useState, useCallback } from "react";
import { createClient } from "@/lib/supabase/client";
import { logChange } from "@/lib/audit";
import { derivePackaging } from "@/lib/packaging";
import type {
  Week,
  Product,
  Distributor,
  DistributorInventory,
  SectionDivider,
} from "@/lib/types/db";

type CombinedRow =
  | { kind: "product"; item: Product }
  | { kind: "divider"; item: SectionDivider };

function rowSortOrder(row: CombinedRow): number {
  if (row.kind === "divider") return row.item.sort_order;
  return row.item.sort_order ?? Number.MAX_SAFE_INTEGER;
}

export default function DistributorInventoryPage() {
  const supabase = useMemo(() => createClient(), []);

  const [week, setWeek] = useState<Week | null>(null);
  const [products, setProducts] = useState<Product[]>([]);
  const [dividers, setDividers] = useState<SectionDivider[]>([]);
  const [distributors, setDistributors] = useState<Distributor[]>([]);
  const [data, setData] = useState<Record<string, DistributorInventory>>({}); // key: productId:distributorId
  const [userId, setUserId] = useState<string | null>(null);
  const [isAdmin, setIsAdmin] = useState(false);
  const [loading, setLoading] = useState(true);
  const [savingKey, setSavingKey] = useState<string | null>(null);

  const [syncOpen, setSyncOpen] = useState(false);
  const [syncText, setSyncText] = useState("");
  const [syncing, setSyncing] = useState(false);
  const [syncResult, setSyncResult] = useState<{ syncedCount: number; errors: string[] } | null>(
    null
  );
  const [syncError, setSyncError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);

    const {
      data: { user },
    } = await supabase.auth.getUser();
    setUserId(user?.id ?? null);

    if (user) {
      const { data: profile } = await supabase
        .from("profiles")
        .select("role")
        .eq("id", user.id)
        .maybeSingle();
      setIsAdmin(profile?.role === "admin");
    }

    const { data: weekData } = await supabase
      .from("weeks")
      .select("*")
      .order("week_start", { ascending: false })
      .limit(1)
      .maybeSingle();
    setWeek(weekData as Week | null);

    // Same product list/order/brand dividers as Inventory & Allocation,
    // minus tap handles — distributors don't hold tap handle inventory.
    const { data: productData } = await supabase
      .from("products")
      .select("*")
      .eq("active", true)
      .order("sort_order", { ascending: true, nullsFirst: false })
      .order("name");
    setProducts(
      ((productData as Product[]) ?? []).filter(
        (p) => derivePackaging(p.name).kind !== "tap_handle"
      )
    );

    const { data: dividerData } = await supabase.from("section_dividers").select("*");
    setDividers((dividerData as SectionDivider[]) ?? []);

    // Ordered by inventory_sort_order (this page's own column order), NOT
    // the shared sort_order used by Inventory & Allocation / Purchase
    // Orders / Pricing / Distributor Data.
    const { data: distributorData } = await supabase
      .from("distributors")
      .select("*")
      .eq("active", true)
      .eq("track_inventory", true)
      .order("inventory_sort_order", { ascending: true, nullsFirst: false })
      .order("name");
    setDistributors((distributorData as Distributor[]) ?? []);

    if (weekData) {
      const { data: invData } = await supabase
        .from("distributor_inventory")
        .select("*")
        .eq("week_id", (weekData as Week).id);

      const map: Record<string, DistributorInventory> = {};
      (invData as DistributorInventory[] | null)?.forEach((row) => {
        map[`${row.product_id}:${row.distributor_id}`] = row;
      });
      setData(map);
    }

    setLoading(false);
  }, [supabase]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- intentional fetch-on-mount
    load();
  }, [load]);

  async function handleFieldChange(
    productId: string,
    distributorId: string,
    field: "on_hand_qty" | "rate_of_sale",
    value: number
  ) {
    if (!week || !userId) return;
    const mapKey = `${productId}:${distributorId}`;
    const key = `inv:${mapKey}:${field}`;
    setSavingKey(key);

    const existing = data[mapKey];
    const oldValue = existing?.[field] ?? 0;

    setData((prev) => ({
      ...prev,
      [mapKey]: {
        id: existing?.id ?? "",
        week_id: week.id,
        distributor_id: distributorId,
        product_id: productId,
        on_hand_qty: existing?.on_hand_qty ?? 0,
        rate_of_sale: existing?.rate_of_sale ?? 0,
        source: existing?.source ?? "distributor",
        imported_at: existing?.imported_at ?? null,
        updated_by: userId,
        updated_at: new Date().toISOString(),
        [field]: value,
      },
    }));

    const { data: updated, error } = await supabase
      .from("distributor_inventory")
      .upsert(
        {
          week_id: week.id,
          distributor_id: distributorId,
          product_id: productId,
          on_hand_qty: field === "on_hand_qty" ? value : existing?.on_hand_qty ?? 0,
          rate_of_sale: field === "rate_of_sale" ? value : existing?.rate_of_sale ?? 0,
          source: existing?.source ?? "distributor",
          updated_by: userId,
          updated_at: new Date().toISOString(),
        },
        { onConflict: "week_id,distributor_id,product_id" }
      )
      .select()
      .single();

    if (!error && updated) {
      setData((prev) => ({ ...prev, [mapKey]: updated as DistributorInventory }));
      await logChange(supabase, {
        weekId: week.id,
        tableName: "distributor_inventory",
        recordId: updated.id,
        fieldName: field,
        oldValue,
        newValue: value,
        changedBy: userId,
      });
    }

    setSavingKey(null);
  }

  // Projected Days on Hand = on hand ÷ daily rate of sale, matching Ekos's
  // own report. Null (rendered as "—") when there's no rate to divide by.
  function projectedDaysOnHand(productId: string, distributorId: string) {
    const cell = data[`${productId}:${distributorId}`];
    if (!cell || !cell.rate_of_sale) return null;
    return cell.on_hand_qty / cell.rate_of_sale;
  }

  async function handleSync() {
    setSyncing(true);
    setSyncError(null);
    setSyncResult(null);

    let payload: unknown;
    try {
      payload = JSON.parse(syncText);
    } catch {
      setSyncError("That's not valid JSON — check for a stray comma or missing bracket.");
      setSyncing(false);
      return;
    }

    const res = await fetch("/api/distributor-inventory/sync", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const json = await res.json();

    if (!res.ok) {
      setSyncError(json.error ?? "Sync failed");
      setSyncing(false);
      return;
    }

    setSyncResult(json);
    setSyncText("");
    setSyncing(false);
    await load();
  }

  const combined: CombinedRow[] = [
    ...products.map((p): CombinedRow => ({ kind: "product", item: p })),
    ...dividers.map((d): CombinedRow => ({ kind: "divider", item: d })),
  ].sort((a, b) => rowSortOrder(a) - rowSortOrder(b));

  if (loading) return <p className="text-sm text-neutral-400">Loading…</p>;

  if (!isAdmin) {
    return (
      <p className="text-sm text-neutral-400">
        Distributor Inventory is only available to admins.
      </p>
    );
  }

  if (!week) {
    return <p className="text-sm text-neutral-400">No week has been started yet.</p>;
  }

  return (
    <div className="flex flex-col space-y-3">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-lg font-semibold text-neutral-100">Distributor Inventory</h1>
          <p className="text-sm text-neutral-400">
            {week.label} — each distributor&apos;s on-hand quantity of your product, as reported
            in Ekos.
          </p>
        </div>
        <button
          type="button"
          onClick={() => setSyncOpen((prev) => !prev)}
          className="shrink-0 rounded-md border border-neutral-700 px-3 py-1.5 text-sm text-neutral-300 hover:bg-neutral-900"
        >
          {syncOpen ? "Close" : "Sync from Ekos"}
        </button>
      </div>

      {syncOpen && (
        <div className="rounded-lg border border-yellow-500/40 bg-yellow-500/[0.03] p-3">
          <p className="mb-2 text-sm text-neutral-400">
            Paste distributor on-hand entries (JSON) read from Ekos&apos;s Distributor Inventory
            report, then Sync. Each entry is matched by distributor and product name and upserted
            into this week only — anything that doesn&apos;t match an active distributor or
            product is skipped and listed below.
          </p>
          <textarea
            value={syncText}
            onChange={(e) => setSyncText(e.target.value)}
            rows={8}
            placeholder='{"entries": [{"distributor": "Matagrano", "product": "Big Daddy IPA (Keg - 1/2 bbl)", "onHand": 39, "rateOfSale": 8.4}]}'
            className="block w-full rounded-md border border-neutral-700 bg-neutral-900 px-3 py-2 font-mono text-xs text-neutral-100"
          />
          <div className="mt-2 flex items-center gap-2">
            <button
              type="button"
              onClick={handleSync}
              disabled={syncing || !syncText.trim()}
              className="rounded-md bg-white px-3 py-1.5 text-sm font-medium text-black hover:bg-neutral-200 disabled:opacity-50"
            >
              {syncing ? "Syncing…" : "Sync"}
            </button>
            {syncError && <p className="text-sm text-red-400">{syncError}</p>}
            {syncResult && (
              <p className="text-sm text-neutral-300">
                Synced {syncResult.syncedCount}
                {syncResult.errors.length > 0 && (
                  <span className="text-red-400"> — {syncResult.errors.join("; ")}</span>
                )}
              </p>
            )}
          </div>
        </div>
      )}

      <div className="overflow-x-auto rounded-lg border border-neutral-800 bg-neutral-950">
        <table className="w-full border-collapse text-sm">
          <thead>
            <tr className="text-xs uppercase tracking-wide text-neutral-500">
              <th
                rowSpan={2}
                className="sticky top-0 left-0 z-20 whitespace-nowrap bg-neutral-900 px-3 text-left align-bottom"
              >
                Product
              </th>
              {distributors.map((d) => (
                <th
                  key={d.id}
                  colSpan={3}
                  className="sticky top-0 z-10 whitespace-nowrap border-l border-neutral-800 bg-neutral-900 px-2 py-1 text-center"
                  style={{ color: d.color ?? undefined }}
                >
                  {d.name}
                </th>
              ))}
            </tr>
            <tr className="h-8 text-[10px] uppercase tracking-wide text-neutral-500">
              {distributors.map((d) => (
                <Fragment key={d.id}>
                  <th className="sticky top-6 z-10 h-8 whitespace-nowrap border-l border-neutral-800 bg-neutral-900 px-2 text-right font-normal">
                    On Hand
                  </th>
                  <th
                    className="sticky top-6 z-10 h-8 whitespace-nowrap bg-neutral-900 px-2 text-right font-normal"
                    title="Daily Rate of Sale"
                  >
                    Rate/Day
                  </th>
                  <th
                    className="sticky top-6 z-10 h-8 whitespace-nowrap bg-neutral-900 px-2 text-right font-normal"
                    title="Projected Days on Hand"
                  >
                    Days OH
                  </th>
                </Fragment>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-neutral-900">
            {distributors.length === 0 ? (
              <tr>
                <td colSpan={1} className="px-3 py-6 text-center text-neutral-500">
                  No active distributors.
                </td>
              </tr>
            ) : (
              combined.map((row) => {
                if (row.kind === "divider") {
                  return (
                    <tr key={`divider:${row.item.id}`} className="bg-neutral-900/70">
                      <td
                        colSpan={1 + distributors.length * 3}
                        className="px-3 py-1.5 text-xs font-semibold uppercase tracking-wide text-neutral-300"
                      >
                        {row.item.label}
                      </td>
                    </tr>
                  );
                }

                const p = row.item;
                return (
                  <tr key={p.id} className="group hover:bg-neutral-900/60">
                    <td className="sticky left-0 z-10 whitespace-nowrap bg-neutral-950 px-3 py-1.5 font-medium text-neutral-200 group-hover:bg-neutral-900">
                      {p.name}
                    </td>
                    {distributors.map((d) => {
                      const cell = data[`${p.id}:${d.id}`];
                      const days = projectedDaysOnHand(p.id, d.id);
                      const title = cell
                        ? `Source: ${cell.source}${
                            cell.imported_at
                              ? ` — imported ${new Date(cell.imported_at).toLocaleDateString()}`
                              : ""
                          }`
                        : undefined;
                      return (
                        <Fragment key={d.id}>
                          <td className="border-l border-neutral-900 px-2 py-1.5 text-right">
                            <input
                              type="number"
                              title={title}
                              className="w-16 rounded border border-neutral-700 bg-neutral-900 px-1.5 py-0.5 text-right text-neutral-100"
                              value={cell?.on_hand_qty ?? 0}
                              onChange={(e) =>
                                handleFieldChange(
                                  p.id,
                                  d.id,
                                  "on_hand_qty",
                                  Number(e.target.value) || 0
                                )
                              }
                            />
                          </td>
                          <td className="px-2 py-1.5 text-right">
                            <input
                              type="number"
                              step="0.1"
                              title={title}
                              className="w-14 rounded border border-neutral-700 bg-neutral-900 px-1.5 py-0.5 text-right text-neutral-100"
                              value={cell?.rate_of_sale ?? 0}
                              onChange={(e) =>
                                handleFieldChange(
                                  p.id,
                                  d.id,
                                  "rate_of_sale",
                                  Number(e.target.value) || 0
                                )
                              }
                            />
                          </td>
                          <td className="px-2 py-1.5 text-right text-neutral-400">
                            {days === null ? "—" : days.toFixed(1)}
                          </td>
                        </Fragment>
                      );
                    })}
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      <p className="text-xs text-neutral-500">
        {savingKey ? "Saving…" : " "} On Hand and Rate/Day come from Ekos (hover a value to see
        source and import date) but can be edited by hand — edits save immediately. Days OH
        (Projected Days on Hand) is calculated automatically as On Hand ÷ Rate/Day.
      </p>
    </div>
  );
}
