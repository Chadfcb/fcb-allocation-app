"use client";

import { useEffect, useMemo, useState, useCallback } from "react";
import { createClient } from "@/lib/supabase/client";
import { logChange } from "@/lib/audit";
import ImportDialog from "@/components/ImportDialog";
import type { Week, Product, Distributor, DistributorInventory, InventorySource } from "@/lib/types/db";

export default function DistributorsPage() {
  const supabase = useMemo(() => createClient(), []);

  const [week, setWeek] = useState<Week | null>(null);
  const [products, setProducts] = useState<Product[]>([]);
  const [distributors, setDistributors] = useState<Distributor[]>([]);
  const [selectedDistributorId, setSelectedDistributorId] = useState<string>("");
  const [data, setData] = useState<Record<string, DistributorInventory>>({});
  const [targetWeeksOfSupply, setTargetWeeksOfSupply] = useState(2);
  const [userId, setUserId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [showImport, setShowImport] = useState(false);

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
    const dList = (distributorData as Distributor[]) ?? [];
    setDistributors(dList);
    setSelectedDistributorId((prev) => prev || dList[0]?.id || "");

    setLoading(false);
  }, [supabase]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- intentional fetch-on-mount
    load();
  }, [load]);

  const loadDistributorInventory = useCallback(async () => {
    if (!week || !selectedDistributorId) return;
    const { data: invData } = await supabase
      .from("distributor_inventory")
      .select("*")
      .eq("week_id", week.id)
      .eq("distributor_id", selectedDistributorId);

    const map: Record<string, DistributorInventory> = {};
    (invData as DistributorInventory[] | null)?.forEach((row) => {
      map[row.product_id] = row;
    });
    setData(map);
  }, [supabase, week, selectedDistributorId]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- intentional fetch-on-mount
    loadDistributorInventory();
  }, [loadDistributorInventory]);

  async function handleFieldChange(
    productId: string,
    field: "on_hand_qty" | "rate_of_sale",
    value: number,
    source: InventorySource
  ) {
    if (!week || !userId || !selectedDistributorId) return;
    const existing = data[productId];
    const oldValue = existing?.[field] ?? 0;

    setData((prev) => ({
      ...prev,
      [productId]: {
        ...(prev[productId] ?? {
          id: "",
          week_id: week.id,
          distributor_id: selectedDistributorId,
          product_id: productId,
          on_hand_qty: 0,
          rate_of_sale: 0,
          source,
          imported_at: null,
          updated_by: userId,
          updated_at: new Date().toISOString(),
        }),
        [field]: value,
      },
    }));

    const { data: updated, error } = await supabase
      .from("distributor_inventory")
      .upsert(
        {
          week_id: week.id,
          distributor_id: selectedDistributorId,
          product_id: productId,
          on_hand_qty: field === "on_hand_qty" ? value : existing?.on_hand_qty ?? 0,
          rate_of_sale: field === "rate_of_sale" ? value : existing?.rate_of_sale ?? 0,
          source: existing?.source ?? source,
          updated_by: userId,
          updated_at: new Date().toISOString(),
        },
        { onConflict: "week_id,distributor_id,product_id" }
      )
      .select()
      .single();

    if (!error && updated) {
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
  }

  function weeksOfSupply(productId: string) {
    const row = data[productId];
    if (!row || !row.rate_of_sale) return null;
    return row.on_hand_qty / row.rate_of_sale;
  }

  function suggestedOrder(productId: string) {
    const row = data[productId];
    const wos = weeksOfSupply(productId);
    if (!row || wos === null) return 0;
    const deficit = targetWeeksOfSupply - wos;
    if (deficit <= 0) return 0;
    return Math.round(deficit * row.rate_of_sale);
  }

  if (loading) return <p className="text-sm text-neutral-400">Loading…</p>;

  if (!week) {
    return <p className="text-sm text-neutral-400">No week has been started yet.</p>;
  }

  return (
    <div className="flex h-[calc(100vh-7rem)] flex-col space-y-3">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-lg font-semibold text-neutral-100">Distributor Data</h1>
          <p className="text-sm text-neutral-400">{week.label}</p>
        </div>
        <div className="flex items-end gap-3">
          <label className="text-sm text-neutral-400">
            Distributor
            <select
              value={selectedDistributorId}
              onChange={(e) => setSelectedDistributorId(e.target.value)}
              className="ml-2 rounded-md border border-neutral-700 bg-neutral-900 px-2 py-1.5 text-sm text-neutral-100"
            >
              {distributors.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.name}
                </option>
              ))}
            </select>
          </label>
          <label className="text-sm text-neutral-400">
            Target weeks of supply
            <input
              type="number"
              value={targetWeeksOfSupply}
              onChange={(e) => setTargetWeeksOfSupply(Number(e.target.value) || 0)}
              className="ml-2 w-16 rounded-md border border-neutral-700 bg-neutral-900 px-2 py-1.5 text-sm text-neutral-100"
            />
          </label>
          <button
            onClick={() => setShowImport(true)}
            className="rounded-md bg-white px-3 py-1.5 text-sm font-medium text-black hover:bg-neutral-200"
          >
            Import from file
          </button>
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-auto rounded-lg border border-neutral-800 bg-neutral-950">
        <table className="w-full border-collapse text-sm">
          <thead>
            <tr className="text-xs uppercase tracking-wide text-neutral-500">
              <th className="sticky top-0 left-0 z-20 whitespace-nowrap bg-neutral-900 px-3 py-2 text-left">
                Product
              </th>
              <th className="sticky top-0 z-10 whitespace-nowrap bg-neutral-900 px-2 py-2 text-right">
                On Hand (Distributor)
              </th>
              <th className="sticky top-0 z-10 whitespace-nowrap bg-neutral-900 px-2 py-2 text-right">
                Rate of Sale / wk
              </th>
              <th className="sticky top-0 z-10 whitespace-nowrap bg-neutral-900 px-2 py-2 text-right">
                Weeks of Supply
              </th>
              <th className="sticky top-0 z-10 whitespace-nowrap bg-neutral-900 px-2 py-2 text-left">
                Source
              </th>
              <th className="sticky top-0 right-0 z-10 whitespace-nowrap bg-neutral-900 px-2 py-2 text-right font-semibold">
                Suggested Order
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-neutral-900">
            {products.map((p) => {
              const wos = weeksOfSupply(p.id);
              const suggestion = suggestedOrder(p.id);
              return (
                <tr key={p.id} className="group hover:bg-neutral-900/60">
                  <td className="sticky left-0 z-10 whitespace-nowrap bg-neutral-950 px-3 py-1.5 font-medium text-neutral-200 group-hover:bg-neutral-900">
                    {p.name}
                  </td>
                  <td className="px-2 py-1.5 text-right">
                    <input
                      type="number"
                      className="w-20 rounded border border-neutral-700 bg-neutral-900 px-1.5 py-0.5 text-right text-neutral-100"
                      value={data[p.id]?.on_hand_qty ?? 0}
                      onChange={(e) =>
                        handleFieldChange(p.id, "on_hand_qty", Number(e.target.value) || 0, "distributor")
                      }
                    />
                  </td>
                  <td className="px-2 py-1.5 text-right">
                    <input
                      type="number"
                      className="w-20 rounded border border-neutral-700 bg-neutral-900 px-1.5 py-0.5 text-right text-neutral-100"
                      value={data[p.id]?.rate_of_sale ?? 0}
                      onChange={(e) =>
                        handleFieldChange(p.id, "rate_of_sale", Number(e.target.value) || 0, "distributor")
                      }
                    />
                  </td>
                  <td className="px-2 py-1.5 text-right text-neutral-400">
                    {wos === null ? "—" : wos.toFixed(1)}
                  </td>
                  <td className="px-2 py-1.5 text-left text-xs text-neutral-500 uppercase">
                    {data[p.id]?.source ?? "—"}
                  </td>
                  <td
                    className={`sticky right-0 z-10 bg-neutral-950 px-2 py-1.5 text-right font-semibold group-hover:bg-neutral-900 ${
                      suggestion > 0 ? "text-amber-400" : "text-neutral-500"
                    }`}
                  >
                    {suggestion}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <p className="text-xs text-neutral-500">
        Suggested Order = how many units are needed to bring this distributor back up to your
        target weeks of supply, based on their current on-hand and rate of sale. Adjust the target
        above to see it recalculate.
      </p>

      {showImport && week && selectedDistributorId && (
        <ImportDialog
          weekId={week.id}
          distributorId={selectedDistributorId}
          onImported={loadDistributorInventory}
          onClose={() => setShowImport(false)}
        />
      )}
    </div>
  );
}
