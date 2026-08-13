"use client";

import { useEffect, useMemo, useState, useCallback } from "react";
import { createClient } from "@/lib/supabase/client";
import { logChange } from "@/lib/audit";
import type {
  Week,
  Product,
  Distributor,
  InventoryWithRemaining,
  Allocation,
  DistributorPO,
  StatusFlag,
} from "@/lib/types/db";
import { STATUS_FLAG_LABELS, STATUS_FLAG_COLORS } from "@/lib/types/db";

type InventoryEditableField = "on_hand" | "unlabeled" | "to_be_packaged";

type AllocationCell = {
  id: string;
  quantity: number;
  status_flag: StatusFlag;
};

const currencyFormatter = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
});

export default function InventoryPage() {
  const supabase = useMemo(() => createClient(), []);

  const [week, setWeek] = useState<Week | null>(null);
  const [products, setProducts] = useState<Product[]>([]);
  const [distributors, setDistributors] = useState<Distributor[]>([]);
  const [inventory, setInventory] = useState<Record<string, InventoryWithRemaining>>({});
  const [allocations, setAllocations] = useState<Record<string, AllocationCell>>({}); // key: productId:distributorId
  const [pos, setPos] = useState<Record<string, DistributorPO>>({}); // key: distributorId
  const [userId, setUserId] = useState<string | null>(null);
  const [isAdmin, setIsAdmin] = useState(false);
  const [loading, setLoading] = useState(true);
  const [savingKey, setSavingKey] = useState<string | null>(null);

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

    const { data: productData } = await supabase
      .from("products")
      .select("*")
      .eq("active", true)
      .order("name");
    setProducts((productData as Product[]) ?? []);

    const { data: distributorData } = await supabase
      .from("distributors")
      .select("*")
      .eq("active", true)
      .order("name");
    setDistributors((distributorData as Distributor[]) ?? []);

    if (weekData) {
      const { data: invData } = await supabase
        .from("inventory_with_remaining")
        .select("*")
        .eq("week_id", weekData.id);

      const invMap: Record<string, InventoryWithRemaining> = {};
      (invData as InventoryWithRemaining[] | null)?.forEach((row) => {
        invMap[row.product_id] = row;
      });
      setInventory(invMap);

      const { data: allocData } = await supabase
        .from("allocations")
        .select("*")
        .eq("week_id", weekData.id);

      const allocMap: Record<string, AllocationCell> = {};
      (allocData as Allocation[] | null)?.forEach((row) => {
        allocMap[`${row.product_id}:${row.distributor_id}`] = {
          id: row.id,
          quantity: row.quantity,
          status_flag: row.status_flag,
        };
      });
      setAllocations(allocMap);

      const { data: poData } = await supabase
        .from("distributor_pos")
        .select("*")
        .eq("week_id", weekData.id);

      const poMap: Record<string, DistributorPO> = {};
      (poData as DistributorPO[] | null)?.forEach((row) => {
        poMap[row.distributor_id] = row;
      });
      setPos(poMap);
    }

    setLoading(false);
  }, [supabase]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- intentional fetch-on-mount
    load();
  }, [load]);

  function totalFor(productId: string) {
    const inv = inventory[productId];
    if (!inv) return 0;
    return inv.on_hand + inv.unlabeled + inv.to_be_packaged;
  }

  function allocatedFor(productId: string) {
    return distributors.reduce(
      (sum, d) => sum + (allocations[`${productId}:${d.id}`]?.quantity ?? 0),
      0
    );
  }

  function remainingFor(productId: string) {
    return totalFor(productId) - allocatedFor(productId);
  }

  function orderValueFor(distributorId: string) {
    return products.reduce((sum, p) => {
      const qty = allocations[`${p.id}:${distributorId}`]?.quantity ?? 0;
      return sum + (p.avg_price ?? 0) * qty;
    }, 0);
  }

  const grandOrderValue = distributors.reduce((sum, d) => sum + orderValueFor(d.id), 0);

  async function handleInventoryChange(
    productId: string,
    field: InventoryEditableField,
    value: number
  ) {
    if (!week || !userId) return;
    const key = `inv:${productId}:${field}`;
    setSavingKey(key);

    const existing = inventory[productId];
    const oldValue = existing?.[field] ?? 0;

    const updated: InventoryWithRemaining = {
      id: existing?.id ?? "",
      week_id: week.id,
      product_id: productId,
      on_hand: field === "on_hand" ? value : existing?.on_hand ?? 0,
      unlabeled: field === "unlabeled" ? value : existing?.unlabeled ?? 0,
      to_be_packaged: field === "to_be_packaged" ? value : existing?.to_be_packaged ?? 0,
      total: 0,
      remaining: 0,
      status_flag: existing?.status_flag ?? null,
      updated_by: userId,
      updated_at: new Date().toISOString(),
    };
    updated.total = updated.on_hand + updated.unlabeled + updated.to_be_packaged;
    setInventory((prev) => ({ ...prev, [productId]: updated }));

    const { data, error } = await supabase
      .from("inventory_snapshots")
      .upsert(
        {
          week_id: week.id,
          product_id: productId,
          on_hand: updated.on_hand,
          unlabeled: updated.unlabeled,
          to_be_packaged: updated.to_be_packaged,
          status_flag: updated.status_flag,
          updated_by: userId,
          updated_at: new Date().toISOString(),
        },
        { onConflict: "week_id,product_id" }
      )
      .select()
      .single();

    if (!error && data) {
      await logChange(supabase, {
        weekId: week.id,
        tableName: "inventory_snapshots",
        recordId: data.id,
        fieldName: field,
        oldValue,
        newValue: value,
        changedBy: userId,
      });
    }

    setSavingKey(null);
  }

  async function handleAllocationChange(productId: string, distributorId: string, value: number) {
    if (!week || !userId) return;
    const key = `alloc:${productId}:${distributorId}`;
    setSavingKey(key);

    const mapKey = `${productId}:${distributorId}`;
    const existing = allocations[mapKey];
    const oldValue = existing?.quantity ?? 0;
    setAllocations((prev) => ({
      ...prev,
      [mapKey]: { id: existing?.id ?? "", quantity: value, status_flag: existing?.status_flag ?? null },
    }));

    const { data, error } = await supabase
      .from("allocations")
      .upsert(
        {
          week_id: week.id,
          product_id: productId,
          distributor_id: distributorId,
          quantity: value,
          status_flag: existing?.status_flag ?? null,
          updated_by: userId,
          updated_at: new Date().toISOString(),
        },
        { onConflict: "week_id,product_id,distributor_id" }
      )
      .select()
      .single();

    if (!error && data) {
      setAllocations((prev) => ({
        ...prev,
        [mapKey]: { ...prev[mapKey], id: data.id },
      }));
      await logChange(supabase, {
        weekId: week.id,
        tableName: "allocations",
        recordId: data.id,
        fieldName: "quantity",
        oldValue,
        newValue: value,
        changedBy: userId,
      });
    }

    setSavingKey(null);
  }

  async function handleAllocationFlagChange(
    productId: string,
    distributorId: string,
    value: StatusFlag
  ) {
    if (!week || !userId) return;
    const mapKey = `${productId}:${distributorId}`;
    const key = `flag:${mapKey}`;
    setSavingKey(key);

    const existing = allocations[mapKey];
    const oldValue = existing?.status_flag ?? null;
    setAllocations((prev) => ({
      ...prev,
      [mapKey]: { id: existing?.id ?? "", quantity: existing?.quantity ?? 0, status_flag: value },
    }));

    const { data, error } = await supabase
      .from("allocations")
      .upsert(
        {
          week_id: week.id,
          product_id: productId,
          distributor_id: distributorId,
          quantity: existing?.quantity ?? 0,
          status_flag: value,
          updated_by: userId,
          updated_at: new Date().toISOString(),
        },
        { onConflict: "week_id,product_id,distributor_id" }
      )
      .select()
      .single();

    if (!error && data) {
      setAllocations((prev) => ({
        ...prev,
        [mapKey]: { ...prev[mapKey], id: data.id },
      }));
      await logChange(supabase, {
        weekId: week.id,
        tableName: "allocations",
        recordId: data.id,
        fieldName: "status_flag",
        oldValue,
        newValue: value,
        changedBy: userId,
      });
    }

    setSavingKey(null);
  }

  async function handleAvgPriceChange(productId: string, value: number) {
    if (!userId) return;
    const key = `price:${productId}`;
    setSavingKey(key);

    const existing = products.find((p) => p.id === productId);
    const oldValue = existing?.avg_price ?? 0;
    setProducts((prev) => prev.map((p) => (p.id === productId ? { ...p, avg_price: value } : p)));

    const { error } = await supabase
      .from("products")
      .update({ avg_price: value })
      .eq("id", productId);

    if (!error) {
      await logChange(supabase, {
        weekId: week?.id ?? null,
        tableName: "products",
        recordId: productId,
        fieldName: "avg_price",
        oldValue,
        newValue: value,
        changedBy: userId,
      });
    }

    setSavingKey(null);
  }

  async function handlePoNumberChange(distributorId: string, value: string) {
    if (!week || !userId) return;
    const key = `po:${distributorId}`;
    setSavingKey(key);

    const existing = pos[distributorId];
    const oldValue = existing?.po_number ?? "";
    setPos((prev) => ({
      ...prev,
      [distributorId]: {
        id: existing?.id ?? "",
        week_id: week.id,
        distributor_id: distributorId,
        po_number: value,
        updated_by: userId,
        updated_at: new Date().toISOString(),
      },
    }));

    const { data, error } = await supabase
      .from("distributor_pos")
      .upsert(
        {
          week_id: week.id,
          distributor_id: distributorId,
          po_number: value,
          updated_by: userId,
          updated_at: new Date().toISOString(),
        },
        { onConflict: "week_id,distributor_id" }
      )
      .select()
      .single();

    if (!error && data) {
      setPos((prev) => ({ ...prev, [distributorId]: data as DistributorPO }));
      await logChange(supabase, {
        weekId: week.id,
        tableName: "distributor_pos",
        recordId: data.id,
        fieldName: "po_number",
        oldValue,
        newValue: value,
        changedBy: userId,
      });
    }

    setSavingKey(null);
  }

  if (loading) {
    return <p className="text-sm text-neutral-400">Loading…</p>;
  }

  if (!week) {
    return (
      <p className="text-sm text-neutral-400">
        No week has been started yet. An admin needs to start one from the Weeks page.
      </p>
    );
  }

  return (
    <div className="flex h-[calc(100vh-7rem)] flex-col space-y-3">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <div>
          <h1 className="text-lg font-semibold text-neutral-100">Inventory & Allocation</h1>
          <p className="text-sm text-neutral-400">{week.label}</p>
        </div>
        {savingKey && <p className="text-xs text-neutral-500">Saving…</p>}
      </div>

      <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 rounded-lg border border-neutral-800 bg-neutral-950 px-3 py-2 text-xs">
        <span className="text-neutral-500">Cell colors (click a distributor cell&apos;s swatch):</span>
        {Object.entries(STATUS_FLAG_LABELS).map(([value, label]) => (
          <div key={value} className="flex items-center gap-1.5">
            <span
              className="h-3 w-3 shrink-0 rounded-sm"
              style={{ backgroundColor: STATUS_FLAG_COLORS[value as keyof typeof STATUS_FLAG_COLORS] }}
            />
            <span className="text-neutral-400">{label}</span>
          </div>
        ))}
      </div>

      <div className="min-h-0 flex-1 overflow-auto rounded-lg border border-neutral-800 bg-neutral-950">
        <table className="w-full border-collapse text-sm">
          <thead>
            <tr className="h-8 text-xs uppercase tracking-wide text-neutral-500">
              <th className="sticky top-0 left-0 z-20 h-8 whitespace-nowrap bg-neutral-900 px-3 text-left">
                Product
              </th>
              <th className="sticky top-0 z-10 h-8 whitespace-nowrap bg-neutral-900 px-2 text-right">
                Avg Price ($)
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
              {distributors.map((d) => (
                <th
                  key={d.id}
                  className="sticky top-0 z-10 h-8 whitespace-nowrap bg-neutral-900 px-2 text-right"
                  style={{ color: d.color ?? undefined }}
                >
                  {d.name}
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
              <th className="sticky top-8 z-10 h-7 whitespace-nowrap bg-neutral-900 px-2"></th>
              {distributors.map((d) => (
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
              <th className="sticky top-[60px] z-10 h-7 whitespace-nowrap bg-neutral-900 px-2"></th>
              {distributors.map((d) => (
                <th key={d.id} className="sticky top-[60px] z-10 h-7 whitespace-nowrap bg-neutral-900 px-2">
                  <input
                    type="text"
                    placeholder="PO #"
                    className="w-20 rounded border border-neutral-700 bg-neutral-900 px-1.5 py-0.5 text-right text-[11px] font-normal normal-case text-neutral-100"
                    value={pos[d.id]?.po_number ?? ""}
                    onChange={(e) => handlePoNumberChange(d.id, e.target.value)}
                  />
                </th>
              ))}
              <th className="sticky top-[60px] right-0 z-10 h-7 whitespace-nowrap bg-neutral-900 px-2"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-neutral-900">
            {products.map((p) => {
              const remaining = remainingFor(p.id);
              return (
                <tr key={p.id} className="group hover:bg-neutral-900/60">
                  <td className="sticky left-0 z-10 whitespace-nowrap bg-neutral-950 px-3 py-1.5 font-medium text-neutral-200 group-hover:bg-neutral-900">
                    {p.name}
                  </td>
                  <td className="px-2 py-1.5 text-right">
                    <div className="flex items-center justify-end gap-0.5">
                      <span className="text-neutral-500">$</span>
                      <input
                        type="number"
                        step="0.01"
                        disabled={!isAdmin}
                        className="w-16 rounded border border-amber-700/60 bg-neutral-900 px-1.5 py-0.5 text-right text-neutral-100 disabled:border-neutral-700 disabled:opacity-60"
                        value={p.avg_price ?? 0}
                        title={
                          isAdmin
                            ? "Set this product's average price per item — drives the Order Value totals above"
                            : "Only admins can edit price"
                        }
                        onChange={(e) => handleAvgPriceChange(p.id, Number(e.target.value) || 0)}
                      />
                    </div>
                  </td>
                  {(["on_hand", "unlabeled", "to_be_packaged"] as const).map((field) => (
                    <td key={field} className="px-2 py-1.5 text-right">
                      <input
                        type="number"
                        className="w-16 rounded border border-neutral-700 bg-neutral-900 px-1.5 py-0.5 text-right text-neutral-100"
                        value={inventory[p.id]?.[field] ?? 0}
                        onChange={(e) =>
                          handleInventoryChange(p.id, field, Number(e.target.value) || 0)
                        }
                      />
                    </td>
                  ))}
                  <td className="px-2 py-1.5 text-right font-semibold text-neutral-300">
                    {totalFor(p.id)}
                  </td>
                  {distributors.map((d) => {
                    const cell = allocations[`${p.id}:${d.id}`];
                    const flag = cell?.status_flag ?? null;
                    const flagColor = flag ? STATUS_FLAG_COLORS[flag] : null;
                    return (
                      <td key={d.id} className="px-2 py-1.5 text-right">
                        <div className="relative inline-block">
                          <input
                            type="number"
                            className="w-16 rounded border border-neutral-700 px-1.5 py-0.5 text-right"
                            style={{
                              backgroundColor: flagColor ?? "#171717",
                              color: flagColor ? "#000000" : "#f5f5f5",
                            }}
                            value={cell?.quantity ?? 0}
                            onChange={(e) =>
                              handleAllocationChange(p.id, d.id, Number(e.target.value) || 0)
                            }
                          />
                          {/* Tiny corner swatch — click to color-code this cell. Kept small and
                              overlapping the input's corner instead of a separate control, since
                              the cell itself (the input's background) is what shows the color. */}
                          <select
                            aria-label="Color code this cell"
                            className="absolute -right-1 -top-1 h-3 w-3 cursor-pointer appearance-none overflow-hidden rounded-full border border-neutral-950 p-0 text-xs leading-none"
                            style={{ backgroundColor: flagColor ?? "#525252" }}
                            value={flag ?? ""}
                            title={flag ? STATUS_FLAG_LABELS[flag] : "Color code this cell"}
                            onChange={(e) =>
                              handleAllocationFlagChange(
                                p.id,
                                d.id,
                                (e.target.value || null) as StatusFlag
                              )
                            }
                          >
                            <option value="" style={{ backgroundColor: "#404040", color: "#f5f5f5" }}>
                              — (no color)
                            </option>
                            {Object.entries(STATUS_FLAG_LABELS).map(([value, label]) => (
                              <option
                                key={value}
                                value={value}
                                style={{
                                  backgroundColor:
                                    STATUS_FLAG_COLORS[value as keyof typeof STATUS_FLAG_COLORS],
                                  color: "#000000",
                                }}
                              >
                                {label}
                              </option>
                            ))}
                          </select>
                        </div>
                      </td>
                    );
                  })}
                  <td
                    className={`sticky right-0 z-10 bg-neutral-950 px-2 py-1.5 text-right font-semibold group-hover:bg-neutral-900 ${
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
        Remaining updates live as you type — it&apos;s Total minus everything allocated across
        distributors. A negative number means you&apos;ve allocated more than you actually have.
        Click the small dot in the corner of a distributor cell to color-code it against the
        legend above — the cell itself changes color.
      </p>
    </div>
  );
}
