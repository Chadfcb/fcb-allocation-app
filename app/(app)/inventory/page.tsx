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
  StatusFlag,
} from "@/lib/types/db";
import { STATUS_FLAG_LABELS } from "@/lib/types/db";

type InventoryEditableField = "on_hand" | "unlabeled" | "to_be_packaged";

export default function InventoryPage() {
  const supabase = useMemo(() => createClient(), []);

  const [week, setWeek] = useState<Week | null>(null);
  const [products, setProducts] = useState<Product[]>([]);
  const [distributors, setDistributors] = useState<Distributor[]>([]);
  const [inventory, setInventory] = useState<Record<string, InventoryWithRemaining>>({});
  const [allocations, setAllocations] = useState<Record<string, number>>({}); // key: productId:distributorId
  const [userId, setUserId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [savingKey, setSavingKey] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);

    const {
      data: { user },
    } = await supabase.auth.getUser();
    setUserId(user?.id ?? null);

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

      const allocMap: Record<string, number> = {};
      (allocData as Allocation[] | null)?.forEach((row) => {
        allocMap[`${row.product_id}:${row.distributor_id}`] = row.quantity;
      });
      setAllocations(allocMap);
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
    return distributors.reduce((sum, d) => sum + (allocations[`${productId}:${d.id}`] ?? 0), 0);
  }

  function remainingFor(productId: string) {
    return totalFor(productId) - allocatedFor(productId);
  }

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

  async function handleStatusFlagChange(productId: string, value: StatusFlag) {
    if (!week || !userId) return;
    const existing = inventory[productId];
    const oldValue = existing?.status_flag ?? null;

    setInventory((prev) => ({
      ...prev,
      [productId]: {
        ...(prev[productId] ?? {
          id: "",
          week_id: week.id,
          product_id: productId,
          on_hand: 0,
          unlabeled: 0,
          to_be_packaged: 0,
          total: 0,
          remaining: 0,
          updated_by: userId,
          updated_at: new Date().toISOString(),
        }),
        status_flag: value,
      },
    }));

    const { data, error } = await supabase
      .from("inventory_snapshots")
      .upsert(
        {
          week_id: week.id,
          product_id: productId,
          on_hand: existing?.on_hand ?? 0,
          unlabeled: existing?.unlabeled ?? 0,
          to_be_packaged: existing?.to_be_packaged ?? 0,
          status_flag: value,
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
        fieldName: "status_flag",
        oldValue,
        newValue: value,
        changedBy: userId,
      });
    }
  }

  async function handleAllocationChange(productId: string, distributorId: string, value: number) {
    if (!week || !userId) return;
    const key = `alloc:${productId}:${distributorId}`;
    setSavingKey(key);

    const mapKey = `${productId}:${distributorId}`;
    const oldValue = allocations[mapKey] ?? 0;
    setAllocations((prev) => ({ ...prev, [mapKey]: value }));

    const { data, error } = await supabase
      .from("allocations")
      .upsert(
        {
          week_id: week.id,
          product_id: productId,
          distributor_id: distributorId,
          quantity: value,
          updated_by: userId,
          updated_at: new Date().toISOString(),
        },
        { onConflict: "week_id,product_id,distributor_id" }
      )
      .select()
      .single();

    if (!error && data) {
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

  if (loading) {
    return <p className="text-sm text-neutral-500">Loading…</p>;
  }

  if (!week) {
    return (
      <p className="text-sm text-neutral-500">
        No week has been started yet. An admin needs to start one from the Weeks page.
      </p>
    );
  }

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-lg font-semibold text-neutral-900">Inventory & Allocation</h1>
        <p className="text-sm text-neutral-500">{week.label}</p>
      </div>

      <div className="overflow-x-auto rounded-lg border border-neutral-200 bg-white">
        <table className="min-w-full divide-y divide-neutral-200 text-sm">
          <thead className="bg-neutral-50 text-xs uppercase tracking-wide text-neutral-500">
            <tr>
              <th className="sticky left-0 z-10 bg-neutral-50 px-3 py-2 text-left">Product</th>
              <th className="px-2 py-2 text-left">Status</th>
              <th className="px-2 py-2 text-right">On Hand</th>
              <th className="px-2 py-2 text-right">Unlabeled</th>
              <th className="px-2 py-2 text-right">To Package</th>
              <th className="px-2 py-2 text-right font-semibold">Total</th>
              {distributors.map((d) => (
                <th key={d.id} className="px-2 py-2 text-right" style={{ color: d.color ?? undefined }}>
                  {d.name}
                </th>
              ))}
              <th className="px-2 py-2 text-right font-semibold">Remaining</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-neutral-100">
            {products.map((p) => {
              const remaining = remainingFor(p.id);
              return (
                <tr key={p.id} className="hover:bg-neutral-50">
                  <td className="sticky left-0 z-10 bg-white px-3 py-1.5 font-medium text-neutral-800">
                    {p.name}
                  </td>
                  <td className="px-2 py-1.5">
                    <select
                      className="rounded border border-neutral-200 bg-transparent px-1 py-0.5 text-xs"
                      value={inventory[p.id]?.status_flag ?? ""}
                      onChange={(e) =>
                        handleStatusFlagChange(p.id, (e.target.value || null) as StatusFlag)
                      }
                    >
                      <option value="">—</option>
                      {Object.entries(STATUS_FLAG_LABELS).map(([value, label]) => (
                        <option key={value} value={value}>
                          {label}
                        </option>
                      ))}
                    </select>
                  </td>
                  {(["on_hand", "unlabeled", "to_be_packaged"] as const).map((field) => (
                    <td key={field} className="px-2 py-1.5 text-right">
                      <input
                        type="number"
                        className="w-20 rounded border border-neutral-200 px-1.5 py-0.5 text-right"
                        value={inventory[p.id]?.[field] ?? 0}
                        onChange={(e) =>
                          handleInventoryChange(p.id, field, Number(e.target.value) || 0)
                        }
                      />
                    </td>
                  ))}
                  <td className="px-2 py-1.5 text-right font-semibold text-neutral-700">
                    {totalFor(p.id)}
                  </td>
                  {distributors.map((d) => (
                    <td key={d.id} className="px-2 py-1.5 text-right">
                      <input
                        type="number"
                        className="w-16 rounded border border-neutral-200 px-1.5 py-0.5 text-right"
                        value={allocations[`${p.id}:${d.id}`] ?? 0}
                        onChange={(e) =>
                          handleAllocationChange(p.id, d.id, Number(e.target.value) || 0)
                        }
                      />
                    </td>
                  ))}
                  <td
                    className={`px-2 py-1.5 text-right font-semibold ${
                      remaining < 0 ? "text-red-600" : "text-neutral-700"
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
      {savingKey && <p className="text-xs text-neutral-400">Saving…</p>}
      <p className="text-xs text-neutral-400">
        Remaining updates live as you type — it&apos;s Total minus everything allocated across
        distributors. A negative number means you&apos;ve allocated more than you actually have.
      </p>
    </div>
  );
}
