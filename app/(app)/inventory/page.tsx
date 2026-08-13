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
  SectionDivider,
} from "@/lib/types/db";
import { STATUS_FLAG_LABELS, STATUS_FLAG_COLORS } from "@/lib/types/db";

type InventoryEditableField = "on_hand" | "unlabeled" | "to_be_packaged";

type AllocationCell = {
  id: string;
  quantity: number;
  status_flag: StatusFlag;
};

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

function rowLabel(row: CombinedRow): string {
  return row.kind === "product" ? row.item.name : `— ${row.item.label} —`;
}

const currencyFormatter = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
});

export default function InventoryPage() {
  const supabase = useMemo(() => createClient(), []);

  const [week, setWeek] = useState<Week | null>(null);
  const [products, setProducts] = useState<Product[]>([]);
  const [dividers, setDividers] = useState<SectionDivider[]>([]);
  const [distributors, setDistributors] = useState<Distributor[]>([]);
  const [inventory, setInventory] = useState<Record<string, InventoryWithRemaining>>({});
  const [allocations, setAllocations] = useState<Record<string, AllocationCell>>({}); // key: productId:distributorId
  const [pos, setPos] = useState<Record<string, DistributorPO>>({}); // key: distributorId
  const [userId, setUserId] = useState<string | null>(null);
  const [isAdmin, setIsAdmin] = useState(false);
  const [loading, setLoading] = useState(true);
  const [savingKey, setSavingKey] = useState<string | null>(null);
  const [newProductName, setNewProductName] = useState("");
  const [newProductAfter, setNewProductAfter] = useState("__end__");
  const [addingProduct, setAddingProduct] = useState(false);
  const [addProductError, setAddProductError] = useState<string | null>(null);
  const [newDividerLabel, setNewDividerLabel] = useState("");
  const [newDividerAfter, setNewDividerAfter] = useState("__end__");
  const [addingDivider, setAddingDivider] = useState(false);

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
      .order("sort_order", { ascending: true, nullsFirst: false })
      .order("name");
    setProducts((productData as Product[]) ?? []);

    const { data: dividerData } = await supabase.from("section_dividers").select("*");
    setDividers((dividerData as SectionDivider[]) ?? []);

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

  // Products and brand dividers share one ordering, sorted together so the
  // grid can be grouped by brand like the original spreadsheet was.
  const combined: CombinedRow[] = [
    ...products.map((p): CombinedRow => ({ kind: "product", item: p })),
    ...dividers.map((d): CombinedRow => ({ kind: "divider", item: d })),
  ].sort((a, b) => rowSortOrder(a) - rowSortOrder(b));

  // Used by the "insert after" pickers when adding a new product or divider,
  // and by the up/down move buttons — finds the sort_order value that lands
  // a row at a specific spot without having to renumber anything else.
  function computeInsertSortOrder(afterKey: string): number {
    const maxOrder = combined.reduce((max, r) => Math.max(max, rowSortOrder(r)), 0);
    if (afterKey === "__end__") return maxOrder + 1;
    if (afterKey === "__start__") {
      const minOrder = combined.reduce((min, r) => Math.min(min, rowSortOrder(r)), maxOrder);
      return minOrder - 1;
    }
    const idx = combined.findIndex((r) => rowKey(r) === afterKey);
    if (idx === -1) return maxOrder + 1;
    const anchor = rowSortOrder(combined[idx]);
    const next = idx + 1 < combined.length ? rowSortOrder(combined[idx + 1]) : anchor + 1;
    return (anchor + next) / 2;
  }

  async function handleMoveRow(index: number, direction: "up" | "down") {
    if (!userId) return;
    const targetIndex = direction === "up" ? index - 1 : index + 1;
    if (targetIndex < 0 || targetIndex >= combined.length) return;

    const row = combined[index];
    const newOrder =
      direction === "up"
        ? (() => {
            const above = targetIndex - 1 >= 0 ? rowSortOrder(combined[targetIndex - 1]) : rowSortOrder(combined[targetIndex]) - 1;
            return (above + rowSortOrder(combined[targetIndex])) / 2;
          })()
        : (() => {
            const below =
              targetIndex + 1 < combined.length
                ? rowSortOrder(combined[targetIndex + 1])
                : rowSortOrder(combined[targetIndex]) + 1;
            return (rowSortOrder(combined[targetIndex]) + below) / 2;
          })();

    if (row.kind === "product") {
      setProducts((prev) => prev.map((p) => (p.id === row.item.id ? { ...p, sort_order: newOrder } : p)));
      await supabase.from("products").update({ sort_order: newOrder }).eq("id", row.item.id);
    } else {
      setDividers((prev) => prev.map((d) => (d.id === row.item.id ? { ...d, sort_order: newOrder } : d)));
      await supabase.from("section_dividers").update({ sort_order: newOrder }).eq("id", row.item.id);
    }
  }

  async function handleAddDivider() {
    const label = newDividerLabel.trim();
    if (!label || !userId) return;
    setAddingDivider(true);

    const sortOrder = computeInsertSortOrder(newDividerAfter);
    const { data, error } = await supabase
      .from("section_dividers")
      .insert({ label, sort_order: sortOrder })
      .select()
      .single();

    if (!error && data) {
      setDividers((prev) => [...prev, data as SectionDivider]);
      setNewDividerLabel("");
      setNewDividerAfter("__end__");
    }
    setAddingDivider(false);
  }

  async function handleDeleteDivider(dividerId: string) {
    const { error } = await supabase.from("section_dividers").delete().eq("id", dividerId);
    if (!error) {
      setDividers((prev) => prev.filter((d) => d.id !== dividerId));
    }
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

  async function handleAddProduct() {
    const name = newProductName.trim();
    if (!name || !userId) return;
    setAddingProduct(true);
    setAddProductError(null);

    // Defaults to the very end of the list, but can be placed anywhere via
    // the "insert after" picker next to the input.
    const sortOrder = computeInsertSortOrder(newProductAfter);

    const { data, error } = await supabase
      .from("products")
      .insert({ name, active: true, sort_order: sortOrder })
      .select()
      .single();

    if (error) {
      // Most common case: a product with this exact name already exists
      // (products.name has a unique index).
      setAddProductError(
        error.code === "23505" ? "A product with that name already exists." : error.message
      );
      setAddingProduct(false);
      return;
    }

    setProducts((prev) => [...prev, data as Product]);
    setNewProductName("");
    setNewProductAfter("__end__");
    setAddingProduct(false);

    await logChange(supabase, {
      weekId: week?.id ?? null,
      tableName: "products",
      recordId: data.id,
      fieldName: "name",
      oldValue: null,
      newValue: name,
      changedBy: userId,
    });
  }

  async function handleArchiveProduct(productId: string) {
    if (!userId) return;

    const key = `archive:${productId}`;
    setSavingKey(key);

    const { error } = await supabase.from("products").update({ active: false }).eq("id", productId);

    if (!error) {
      setProducts((prev) => prev.filter((p) => p.id !== productId));
      await logChange(supabase, {
        weekId: week?.id ?? null,
        tableName: "products",
        recordId: productId,
        fieldName: "active",
        oldValue: true,
        newValue: false,
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
            {combined.map((row, index) => {
              const moveButtons = isAdmin && (
                <span className="flex shrink-0 flex-col leading-none">
                  <button
                    onClick={() => handleMoveRow(index, "up")}
                    disabled={index === 0}
                    title="Move up"
                    className="text-neutral-600 hover:text-neutral-200 disabled:opacity-30"
                  >
                    ▲
                  </button>
                  <button
                    onClick={() => handleMoveRow(index, "down")}
                    disabled={index === combined.length - 1}
                    title="Move down"
                    className="text-neutral-600 hover:text-neutral-200 disabled:opacity-30"
                  >
                    ▼
                  </button>
                </span>
              );

              if (row.kind === "divider") {
                const d = row.item;
                return (
                  <tr key={rowKey(row)} className="bg-neutral-900/70">
                    <td colSpan={7 + distributors.length} className="px-3 py-1.5">
                      <div className="flex items-center gap-2">
                        {moveButtons}
                        <span className="text-xs font-semibold uppercase tracking-wide text-neutral-300">
                          {d.label}
                        </span>
                        {isAdmin && (
                          <button
                            onClick={() => handleDeleteDivider(d.id)}
                            title="Remove this divider"
                            className="ml-auto shrink-0 rounded text-neutral-600 hover:text-red-400"
                          >
                            ✕
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              }

              const p = row.item;
              const remaining = remainingFor(p.id);
              return (
                <tr key={rowKey(row)} className="group hover:bg-neutral-900/60">
                  <td className="sticky left-0 z-10 whitespace-nowrap bg-neutral-950 px-3 py-1.5 font-medium text-neutral-200 group-hover:bg-neutral-900">
                    <div className="flex items-center gap-1.5">
                      {moveButtons}
                      {isAdmin && (
                        <button
                          onClick={() => handleArchiveProduct(p.id)}
                          disabled={savingKey === `archive:${p.id}`}
                          title="Remove this product from the grid (archives it — doesn't erase history)"
                          className="shrink-0 rounded text-neutral-600 hover:text-red-400 disabled:opacity-50"
                        >
                          ✕
                        </button>
                      )}
                      <span>{p.name}</span>
                    </div>
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
            {isAdmin && (
              <tr className="border-t border-neutral-800">
                <td colSpan={7 + distributors.length} className="bg-neutral-950 px-3 py-2">
                  <div className="flex flex-wrap items-center gap-2">
                    <input
                      type="text"
                      placeholder="New product name…"
                      className="w-56 rounded border border-neutral-700 bg-neutral-900 px-2 py-1 text-sm text-neutral-100"
                      value={newProductName}
                      onChange={(e) => setNewProductName(e.target.value)}
                      onKeyDown={(e) => e.key === "Enter" && handleAddProduct()}
                    />
                    <span className="text-xs text-neutral-500">position:</span>
                    <select
                      className="rounded border border-neutral-700 bg-neutral-900 px-2 py-1 text-xs text-neutral-100"
                      value={newProductAfter}
                      onChange={(e) => setNewProductAfter(e.target.value)}
                    >
                      <option value="__start__">At the very top</option>
                      <option value="__end__">At the end (bottom)</option>
                      {combined.map((r) => (
                        <option key={rowKey(r)} value={rowKey(r)}>
                          After: {rowLabel(r)}
                        </option>
                      ))}
                    </select>
                    <button
                      onClick={handleAddProduct}
                      disabled={addingProduct || !newProductName.trim()}
                      className="shrink-0 rounded-md bg-white px-3 py-1 text-xs font-medium text-black hover:bg-neutral-200 disabled:opacity-50"
                    >
                      {addingProduct ? "Adding…" : "+ Add Product"}
                    </button>
                    {addProductError && (
                      <span className="whitespace-nowrap text-xs text-red-400">{addProductError}</span>
                    )}
                  </div>
                </td>
              </tr>
            )}
            {isAdmin && (
              <tr>
                <td colSpan={7 + distributors.length} className="bg-neutral-950 px-3 py-2">
                  <div className="flex flex-wrap items-center gap-2">
                    <input
                      type="text"
                      placeholder="New divider label (e.g. &quot;Sonoma Cider&quot;)…"
                      className="w-56 rounded border border-neutral-700 bg-neutral-900 px-2 py-1 text-sm text-neutral-100"
                      value={newDividerLabel}
                      onChange={(e) => setNewDividerLabel(e.target.value)}
                      onKeyDown={(e) => e.key === "Enter" && handleAddDivider()}
                    />
                    <span className="text-xs text-neutral-500">position:</span>
                    <select
                      className="rounded border border-neutral-700 bg-neutral-900 px-2 py-1 text-xs text-neutral-100"
                      value={newDividerAfter}
                      onChange={(e) => setNewDividerAfter(e.target.value)}
                    >
                      <option value="__start__">At the very top</option>
                      <option value="__end__">At the end (bottom)</option>
                      {combined.map((r) => (
                        <option key={rowKey(r)} value={rowKey(r)}>
                          After: {rowLabel(r)}
                        </option>
                      ))}
                    </select>
                    <button
                      onClick={handleAddDivider}
                      disabled={addingDivider || !newDividerLabel.trim()}
                      className="shrink-0 rounded-md border border-neutral-600 px-3 py-1 text-xs font-medium text-neutral-200 hover:bg-neutral-800 disabled:opacity-50"
                    >
                      {addingDivider ? "Adding…" : "+ Add Divider"}
                    </button>
                  </div>
                </td>
              </tr>
            )}
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
