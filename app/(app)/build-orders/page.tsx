"use client";

// Operations > Build Orders — turns Par Level + On Hand into a recommended
// order per distributor, and lets you push that recommendation straight
// into Inventory & Allocation's allocation quantities for the current
// week, instead of retyping numbers you just calculated.
//
// Same layout as Distributor Inventory: distributors as column groups,
// products as rows, same distributor set/order (track_inventory
// distributors, in inventory_sort_order). Each distributor gets three
// sub-columns:
//   - On Hand: read-only mirror of Distributor Inventory. That page is the
//     only place on-hand gets edited, so this is always just a display.
//   - Par Level: a standing target per distributor/product (like
//     Distributor Pricing — one number, not tied to a week). Editable here.
//   - Recommended Order: defaults to max(par level - on hand, 0) until
//     someone edits it by hand, at which point it's a normal saved value
//     (same computed-until-edited pattern Distributor Inventory uses for
//     on-hand). Editable here.
//
// The button under each distributor's name pushes that distributor's
// Recommended Order column into `allocations` for the current week. If the
// distributor already has a non-zero order sitting on Inventory &
// Allocation, a confirm dialog offers two paths: overwrite that order in
// place, or create a new distributor row (e.g. "Coast 2" — same pattern as
// the existing "Matagrano 2") and push into that instead, leaving the
// original order untouched.

import { useEffect, useMemo, useState, useCallback, Fragment } from "react";
import { createClient } from "@/lib/supabase/client";
import { logChange } from "@/lib/audit";
import { derivePackaging } from "@/lib/packaging";
import {
  TANK_PACKAGE_ROWS,
  tankBblsRemaining,
  type TankQtyField,
} from "@/lib/tankAllocations";
import type {
  Week,
  Product,
  Distributor,
  DistributorInventory,
  DistributorParLevel,
  BuildOrderRecommendation,
  Allocation,
  SectionDivider,
  PricingBrand,
  TankAllocation,
} from "@/lib/types/db";

type TankNumericField = "bbls_available" | TankQtyField;

type CombinedRow =
  | { kind: "product"; item: Product }
  | { kind: "divider"; item: SectionDivider };

function rowSortOrder(row: CombinedRow): number {
  if (row.kind === "divider") return row.item.sort_order;
  return row.item.sort_order ?? Number.MAX_SAFE_INTEGER;
}

type ConfirmState = {
  distributor: Distributor;
  existingByProduct: Record<string, Allocation>;
};

type PushResult = { distributorId: string; text: string; isError: boolean };

export default function BuildOrdersPage() {
  const supabase = useMemo(() => createClient(), []);

  const [week, setWeek] = useState<Week | null>(null);
  const [products, setProducts] = useState<Product[]>([]);
  const [dividers, setDividers] = useState<SectionDivider[]>([]);
  const [distributors, setDistributors] = useState<Distributor[]>([]);
  const [onHand, setOnHand] = useState<Record<string, number>>({}); // key: productId:distributorId
  const [parLevels, setParLevels] = useState<
    Record<string, DistributorParLevel>
  >({});
  const [recommended, setRecommended] = useState<
    Record<string, BuildOrderRecommendation>
  >({});
  const [brands, setBrands] = useState<PricingBrand[]>([]);
  const [tankAllocations, setTankAllocations] = useState<
    Record<string, TankAllocation>
  >({}); // key: brandId
  const [userId, setUserId] = useState<string | null>(null);
  const [isAdmin, setIsAdmin] = useState(false);
  const [loading, setLoading] = useState(true);
  const [savingKey, setSavingKey] = useState<string | null>(null);

  const [pushingId, setPushingId] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<ConfirmState | null>(null);
  const [pushResult, setPushResult] = useState<PushResult | null>(null);

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
      // Section access replaces the old admin-only gate — see
      // lib/permissions.ts. An admin still always gets in; a Basic user
      // needs the "build_orders" section granted from Users > Edit.
      if (profile?.role === "admin") {
        setIsAdmin(true);
      } else {
        const { data: grant } = await supabase
          .from("user_section_access")
          .select("section_key")
          .eq("user_id", user.id)
          .eq("section_key", "build_orders")
          .maybeSingle();
        setIsAdmin(!!grant);
      }
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
    const activeProducts = ((productData as Product[]) ?? []).filter(
      (p) => derivePackaging(p.name).kind !== "tap_handle",
    );
    setProducts(activeProducts);

    const { data: dividerData } = await supabase
      .from("section_dividers")
      .select("*");
    setDividers((dividerData as SectionDivider[]) ?? []);

    // Same distributor set/order as Distributor Inventory.
    const { data: distributorData } = await supabase
      .from("distributors")
      .select("*")
      .eq("active", true)
      .eq("track_inventory", true)
      .order("inventory_sort_order", { ascending: true, nullsFirst: false })
      .order("name");
    setDistributors((distributorData as Distributor[]) ?? []);

    const { data: parData } = await supabase
      .from("distributor_par_levels")
      .select("*");
    const parMap: Record<string, DistributorParLevel> = {};
    (parData as DistributorParLevel[] | null)?.forEach((row) => {
      parMap[`${row.product_id}:${row.distributor_id}`] = row;
    });
    setParLevels(parMap);

    // Tank Allocations — standing, same brand list as Sales > Price List,
    // independent of the current week.
    const { data: brandData } = await supabase
      .from("pricing_brands")
      .select("*")
      .eq("active", true)
      .order("sort_order", { ascending: true, nullsFirst: false })
      .order("name");
    setBrands((brandData as PricingBrand[]) ?? []);

    const { data: tankData } = await supabase
      .from("tank_allocations")
      .select("*");
    const tankMap: Record<string, TankAllocation> = {};
    (tankData as TankAllocation[] | null)?.forEach((row) => {
      tankMap[row.brand_id] = row;
    });
    setTankAllocations(tankMap);

    if (weekData) {
      const week_ = weekData as Week;

      const { data: invData } = await supabase
        .from("distributor_inventory")
        .select("product_id, distributor_id, on_hand_qty")
        .eq("week_id", week_.id);
      const onHandMap: Record<string, number> = {};
      (
        invData as
          | Pick<
              DistributorInventory,
              "product_id" | "distributor_id" | "on_hand_qty"
            >[]
          | null
      )?.forEach((row) => {
        onHandMap[`${row.product_id}:${row.distributor_id}`] = row.on_hand_qty;
      });
      setOnHand(onHandMap);

      const { data: recData } = await supabase
        .from("build_order_recommendations")
        .select("*")
        .eq("week_id", week_.id);
      const recMap: Record<string, BuildOrderRecommendation> = {};
      (recData as BuildOrderRecommendation[] | null)?.forEach((row) => {
        recMap[`${row.product_id}:${row.distributor_id}`] = row;
      });
      setRecommended(recMap);
    }

    setLoading(false);
  }, [supabase]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- intentional fetch-on-mount
    load();
  }, [load]);

  function effectiveRecommended(productId: string, distributorId: string) {
    const key = `${productId}:${distributorId}`;
    const stored = recommended[key];
    if (stored) return stored.recommended_qty;
    const par = parLevels[key]?.par_level ?? 0;
    const oh = onHand[key] ?? 0;
    return Math.max(par - oh, 0);
  }

  async function handleParChange(
    productId: string,
    distributorId: string,
    value: number,
  ) {
    if (!userId) return;
    const key = `${productId}:${distributorId}`;
    setSavingKey(`par:${key}`);

    const oldValue = parLevels[key]?.par_level ?? 0;

    const { data: updated, error } = await supabase
      .from("distributor_par_levels")
      .upsert(
        {
          distributor_id: distributorId,
          product_id: productId,
          par_level: value,
          updated_by: userId,
          updated_at: new Date().toISOString(),
        },
        { onConflict: "distributor_id,product_id" },
      )
      .select()
      .single();

    if (!error && updated) {
      setParLevels((prev) => ({
        ...prev,
        [key]: updated as DistributorParLevel,
      }));
      await logChange(supabase, {
        weekId: null,
        tableName: "distributor_par_levels",
        recordId: updated.id,
        fieldName: "par_level",
        oldValue,
        newValue: value,
        changedBy: userId,
      });
    }

    setSavingKey(null);
  }

  async function handleRecChange(
    productId: string,
    distributorId: string,
    value: number,
  ) {
    if (!week || !userId) return;
    const key = `${productId}:${distributorId}`;
    setSavingKey(`rec:${key}`);

    const oldValue = effectiveRecommended(productId, distributorId);

    const { data: updated, error } = await supabase
      .from("build_order_recommendations")
      .upsert(
        {
          week_id: week.id,
          distributor_id: distributorId,
          product_id: productId,
          recommended_qty: value,
          updated_by: userId,
          updated_at: new Date().toISOString(),
        },
        { onConflict: "week_id,distributor_id,product_id" },
      )
      .select()
      .single();

    if (!error && updated) {
      setRecommended((prev) => ({
        ...prev,
        [key]: updated as BuildOrderRecommendation,
      }));
      await logChange(supabase, {
        weekId: week.id,
        tableName: "build_order_recommendations",
        recordId: updated.id,
        fieldName: "recommended_qty",
        oldValue,
        newValue: value,
        changedBy: userId,
      });
    }

    setSavingKey(null);
  }

  async function handleTankNumericChange(
    brandId: string,
    field: TankNumericField,
    value: number,
  ) {
    if (!userId) return;
    const key = `tank:${brandId}:${field}`;
    setSavingKey(key);

    const existing = tankAllocations[brandId];
    const oldValue = existing ? existing[field] : 0;

    const { data: updated, error } = await supabase
      .from("tank_allocations")
      .upsert(
        {
          brand_id: brandId,
          [field]: value,
          updated_by: userId,
          updated_at: new Date().toISOString(),
        },
        { onConflict: "brand_id" },
      )
      .select()
      .single();

    if (!error && updated) {
      setTankAllocations((prev) => ({
        ...prev,
        [brandId]: updated as TankAllocation,
      }));
      await logChange(supabase, {
        weekId: null,
        tableName: "tank_allocations",
        recordId: updated.id,
        fieldName: field,
        oldValue,
        newValue: value,
        changedBy: userId,
      });
    }

    setSavingKey(null);
  }

  async function handleTankFvChange(brandId: string, value: string) {
    if (!userId) return;
    const key = `tank:${brandId}:fv_number`;
    setSavingKey(key);

    const existing = tankAllocations[brandId];
    const oldValue = existing?.fv_number ?? null;
    const newValue = value.trim() === "" ? null : value;

    const { data: updated, error } = await supabase
      .from("tank_allocations")
      .upsert(
        {
          brand_id: brandId,
          fv_number: newValue,
          updated_by: userId,
          updated_at: new Date().toISOString(),
        },
        { onConflict: "brand_id" },
      )
      .select()
      .single();

    if (!error && updated) {
      setTankAllocations((prev) => ({
        ...prev,
        [brandId]: updated as TankAllocation,
      }));
      await logChange(supabase, {
        weekId: null,
        tableName: "tank_allocations",
        recordId: updated.id,
        fieldName: "fv_number",
        oldValue,
        newValue,
        changedBy: userId,
      });
    }

    setSavingKey(null);
  }

  async function handleAddTankBrand(brandId: string) {
    if (!userId || !brandId) return;
    setSavingKey(`tank:${brandId}:add`);

    const { data: created, error } = await supabase
      .from("tank_allocations")
      .upsert(
        {
          brand_id: brandId,
          updated_by: userId,
          updated_at: new Date().toISOString(),
        },
        { onConflict: "brand_id" },
      )
      .select()
      .single();

    if (!error && created) {
      setTankAllocations((prev) => ({
        ...prev,
        [brandId]: created as TankAllocation,
      }));
    }

    setSavingKey(null);
  }

  async function handleRemoveTankBrand(brand: PricingBrand) {
    const row = tankAllocations[brand.id];
    if (!row) return;
    if (
      !window.confirm(
        `Remove ${brand.name} from Tank Allocations? This clears its FV #, BBLs Available, and quantities.`,
      )
    ) {
      return;
    }

    setSavingKey(`tank:${brand.id}:remove`);

    const { error } = await supabase
      .from("tank_allocations")
      .delete()
      .eq("id", row.id);

    if (!error) {
      setTankAllocations((prev) => {
        const next = { ...prev };
        delete next[brand.id];
        return next;
      });
      if (userId) {
        await logChange(supabase, {
          weekId: null,
          tableName: "tank_allocations",
          recordId: row.id,
          fieldName: "brand_id",
          oldValue: brand.name,
          newValue: null,
          changedBy: userId,
        });
      }
    }

    setSavingKey(null);
  }

  async function handlePushClick(distributor: Distributor) {
    if (!week) return;
    setPushResult(null);
    setPushingId(distributor.id);

    const { data: existingRows } = await supabase
      .from("allocations")
      .select("*")
      .eq("week_id", week.id)
      .eq("distributor_id", distributor.id);

    const existingByProduct: Record<string, Allocation> = {};
    (existingRows as Allocation[] | null)?.forEach((row) => {
      existingByProduct[row.product_id] = row;
    });

    const hasExisting = Object.values(existingByProduct).some(
      (row) => Number(row.quantity) !== 0,
    );

    if (hasExisting) {
      setPushingId(null);
      setConfirm({ distributor, existingByProduct });
      return;
    }

    await doPush(distributor, distributor.id, false, existingByProduct);
    setPushingId(null);
  }

  async function nextDuplicateName(baseName: string) {
    const { data } = await supabase
      .from("distributors")
      .select("name")
      .ilike("name", `${baseName} %`);

    const pattern = new RegExp(
      `^${baseName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")} (\\d+)$`,
    );
    let max = 1;
    (data ?? []).forEach((row: { name: string }) => {
      const match = row.name.match(pattern);
      if (match) max = Math.max(max, parseInt(match[1], 10));
    });
    return `${baseName} ${max + 1}`;
  }

  async function doPush(
    sourceDistributor: Distributor,
    targetDistributorIdIn: string | null,
    isNew: boolean,
    existingByProduct: Record<string, Allocation>,
  ) {
    if (!week || !userId) return;

    let targetDistributorId = targetDistributorIdIn;
    let targetName = sourceDistributor.name;

    if (isNew) {
      const newName = await nextDuplicateName(sourceDistributor.name);
      const { data: created, error } = await supabase
        .from("distributors")
        .insert({
          name: newName,
          color: sourceDistributor.color,
          active: true,
          track_inventory: false,
        })
        .select()
        .single();

      if (error || !created) {
        setPushResult({
          distributorId: sourceDistributor.id,
          text: `Couldn't create "${newName}": ${error?.message ?? "unknown error"}`,
          isError: true,
        });
        return;
      }

      targetDistributorId = created.id;
      targetName = newName;
      await logChange(supabase, {
        weekId: week.id,
        tableName: "distributors",
        recordId: created.id,
        fieldName: "name",
        oldValue: null,
        newValue: newName,
        changedBy: userId,
      });
    }

    if (!targetDistributorId) return;

    const rows = products.map((p) => ({
      week_id: week.id,
      distributor_id: targetDistributorId as string,
      product_id: p.id,
      quantity: effectiveRecommended(p.id, sourceDistributor.id),
      status_flag: existingByProduct[p.id]?.status_flag ?? null,
      updated_by: userId,
      updated_at: new Date().toISOString(),
    }));

    const { data: upserted, error: upsertError } = await supabase
      .from("allocations")
      .upsert(rows, { onConflict: "week_id,distributor_id,product_id" })
      .select();

    if (upsertError) {
      setPushResult({
        distributorId: sourceDistributor.id,
        text: `Push failed: ${upsertError.message}`,
        isError: true,
      });
      return;
    }

    let changedCount = 0;
    for (const row of (upserted as Allocation[] | null) ?? []) {
      const oldValue = existingByProduct[row.product_id]?.quantity ?? 0;
      if (Number(oldValue) === Number(row.quantity)) continue;
      changedCount += 1;
      await logChange(supabase, {
        weekId: week.id,
        tableName: "allocations",
        recordId: row.id,
        fieldName: "quantity",
        oldValue,
        newValue: row.quantity,
        changedBy: userId,
      });
    }

    setPushResult({
      distributorId: sourceDistributor.id,
      text: isNew
        ? `Pushed to a new distributor: "${targetName}". Find it on Inventory & Allocation, Purchase Orders, and Pricing.`
        : `Pushed — updated ${changedCount} product${changedCount === 1 ? "" : "s"} on ${targetName}'s order.`,
      isError: false,
    });
  }

  async function handleConfirmChoice(choice: "overwrite" | "new") {
    if (!confirm) return;
    const { distributor, existingByProduct } = confirm;
    setConfirm(null);
    setPushingId(distributor.id);
    if (choice === "overwrite") {
      await doPush(distributor, distributor.id, false, existingByProduct);
    } else {
      await doPush(distributor, null, true, {});
    }
    setPushingId(null);
  }

  const combined: CombinedRow[] = [
    ...products.map((p): CombinedRow => ({ kind: "product", item: p })),
    ...dividers.map((d): CombinedRow => ({ kind: "divider", item: d })),
  ].sort((a, b) => rowSortOrder(a) - rowSortOrder(b));

  // Tank Allocations only shows brands that have been explicitly added
  // (i.e. have a tank_allocations row) — not every Price List brand.
  const tankBrands = brands.filter((b) => tankAllocations[b.id]);
  const addableBrands = brands.filter((b) => !tankAllocations[b.id]);

  if (loading) return <p className="text-sm text-neutral-400">Loading…</p>;

  if (!isAdmin) {
    return (
      <p className="text-sm text-neutral-400">
        You don&apos;t have access to Build Orders. Ask an admin to grant
        it from Users.
      </p>
    );
  }

  return (
    <div className="flex flex-col space-y-3">
      <div>
        <h1 className="text-lg font-semibold text-neutral-100">Build Orders</h1>
        <p className="text-sm text-neutral-400">
          {week
            ? `${week.label} — Recommended Order is Par Level minus On Hand (never below zero). Push a distributor's column straight into their allocation quantities on Inventory & Allocation.`
            : "No week has been started yet — Recommended Order needs an active week."}
        </p>
      </div>

      <div>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-base font-semibold text-neutral-100">
            Tank Allocations
          </h2>
          {addableBrands.length > 0 && (
            <select
              className="rounded border border-neutral-700 bg-neutral-900 px-2 py-1 text-xs text-neutral-300"
              value=""
              onChange={(e) => {
                if (e.target.value) handleAddTankBrand(e.target.value);
              }}
            >
              <option value="">+ Add brand…</option>
              {addableBrands.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.name}
                </option>
              ))}
            </select>
          )}
        </div>
        <p className="text-sm text-neutral-400">
          Standing, per brand — carries forward week to week until you change
          it. BBLs Remaining is BBLs Available minus each package quantity
          converted to BBLs (1 bbl = 31 gal). Only brands added here appear
          below.
        </p>
      </div>

      <div className="overflow-x-auto rounded-lg border border-neutral-800 bg-neutral-950">
        <table className="w-full border-collapse text-sm">
          <thead>
            <tr className="text-xs uppercase tracking-wide text-neutral-500">
              <th className="sticky left-0 z-10 whitespace-nowrap bg-neutral-900 px-3 py-2 text-left">
                Brand
              </th>
              {tankBrands.map((b) => (
                <th
                  key={b.id}
                  className="whitespace-nowrap border-l border-neutral-800 bg-neutral-900 px-3 py-2 text-center"
                >
                  <div className="flex items-center justify-center gap-1.5">
                    <span>{b.name}</span>
                    <button
                      type="button"
                      onClick={() => handleRemoveTankBrand(b)}
                      title={`Remove ${b.name} from Tank Allocations`}
                      className="rounded border border-neutral-700 px-1 text-[10px] font-normal normal-case text-neutral-500 hover:border-red-800 hover:text-red-400"
                    >
                      ✕
                    </button>
                  </div>
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-neutral-900">
            {tankBrands.length === 0 ? (
              <tr>
                <td
                  colSpan={1}
                  className="px-3 py-6 text-center text-neutral-500"
                >
                  No brands added yet — use “+ Add brand” above.
                </td>
              </tr>
            ) : (
              <>
                <tr>
                  <td className="sticky left-0 z-10 whitespace-nowrap bg-neutral-950 px-3 py-1.5 font-medium text-neutral-300">
                    FV #
                  </td>
                  {tankBrands.map((b) => (
                    <td
                      key={b.id}
                      className="border-l border-neutral-900 px-2 py-1.5 text-center"
                    >
                      <input
                        type="text"
                        className="w-20 rounded border border-neutral-700 bg-neutral-900 px-1.5 py-0.5 text-center text-neutral-100"
                        value={tankAllocations[b.id]?.fv_number ?? ""}
                        onChange={(e) =>
                          handleTankFvChange(b.id, e.target.value)
                        }
                      />
                    </td>
                  ))}
                </tr>
                <tr>
                  <td className="sticky left-0 z-10 whitespace-nowrap bg-neutral-950 px-3 py-1.5 font-medium text-neutral-300">
                    BBLs Available
                  </td>
                  {tankBrands.map((b) => (
                    <td
                      key={b.id}
                      className="border-l border-neutral-900 px-2 py-1.5 text-center"
                    >
                      <input
                        type="number"
                        className="w-20 rounded border border-neutral-700 bg-neutral-900 px-1.5 py-0.5 text-center text-neutral-100"
                        value={tankAllocations[b.id]?.bbls_available ?? 0}
                        onChange={(e) =>
                          handleTankNumericChange(
                            b.id,
                            "bbls_available",
                            Number(e.target.value) || 0,
                          )
                        }
                      />
                    </td>
                  ))}
                </tr>
                {TANK_PACKAGE_ROWS.map(({ field, label }) => (
                  <tr key={field}>
                    <td className="sticky left-0 z-10 whitespace-nowrap bg-neutral-950 px-3 py-1.5 font-medium text-neutral-300">
                      {label}
                    </td>
                    {tankBrands.map((b) => (
                      <td
                        key={b.id}
                        className="border-l border-neutral-900 px-2 py-1.5 text-center"
                      >
                        <input
                          type="number"
                          className="w-20 rounded border border-neutral-700 bg-neutral-900 px-1.5 py-0.5 text-center text-neutral-100"
                          value={tankAllocations[b.id]?.[field] ?? 0}
                          onChange={(e) =>
                            handleTankNumericChange(
                              b.id,
                              field,
                              Number(e.target.value) || 0,
                            )
                          }
                        />
                      </td>
                    ))}
                  </tr>
                ))}
                <tr className="bg-neutral-900/50">
                  <td className="sticky left-0 z-10 whitespace-nowrap bg-neutral-900/50 px-3 py-1.5 font-semibold text-neutral-200">
                    BBLs Remaining
                  </td>
                  {tankBrands.map((b) => {
                    const remaining = tankBblsRemaining(tankAllocations[b.id]);
                    return (
                      <td
                        key={b.id}
                        className={`border-l border-neutral-900 px-2 py-1.5 text-center font-semibold ${
                          remaining < 0 ? "text-red-400" : "text-emerald-400"
                        }`}
                      >
                        {remaining.toFixed(2)}
                      </td>
                    );
                  })}
                </tr>
              </>
            )}
          </tbody>
        </table>
      </div>

      {!week ? (
        <p className="text-sm text-neutral-400">
          Start a week to see and push Recommended Orders per distributor.
        </p>
      ) : (
        <>
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
                    >
                      <div style={{ color: d.color ?? undefined }}>
                        {d.name}
                      </div>
                      <button
                        type="button"
                        onClick={() => handlePushClick(d)}
                        disabled={pushingId === d.id}
                        className="mt-1 rounded border border-neutral-700 px-2 py-0.5 text-[10px] font-normal normal-case text-neutral-300 hover:bg-neutral-800 disabled:opacity-50"
                      >
                        {pushingId === d.id
                          ? "Pushing…"
                          : "Push to Allocations"}
                      </button>
                      {pushResult && pushResult.distributorId === d.id && (
                        <div
                          className={`mt-1 max-w-[220px] whitespace-normal text-[10px] font-normal normal-case ${
                            pushResult.isError
                              ? "text-red-400"
                              : "text-emerald-400"
                          }`}
                        >
                          {pushResult.text}
                        </div>
                      )}
                    </th>
                  ))}
                </tr>
                <tr className="h-8 text-[10px] uppercase tracking-wide text-neutral-500">
                  {distributors.map((d) => (
                    <Fragment key={d.id}>
                      <th className="sticky top-6 z-10 h-8 whitespace-nowrap border-l border-neutral-800 bg-neutral-900 px-2 text-right font-normal">
                        On Hand
                      </th>
                      <th className="sticky top-6 z-10 h-8 whitespace-nowrap bg-neutral-900 px-2 text-right font-normal">
                        Par Level
                      </th>
                      <th
                        className="sticky top-6 z-10 h-8 whitespace-nowrap bg-neutral-900 px-2 text-right font-normal"
                        title="Recommended Order"
                      >
                        Rec. Order
                      </th>
                    </Fragment>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-neutral-900">
                {distributors.length === 0 ? (
                  <tr>
                    <td
                      colSpan={1}
                      className="px-3 py-6 text-center text-neutral-500"
                    >
                      No active distributors.
                    </td>
                  </tr>
                ) : (
                  combined.map((row) => {
                    if (row.kind === "divider") {
                      return (
                        <tr
                          key={`divider:${row.item.id}`}
                          className="bg-neutral-900/70"
                        >
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
                          const key = `${p.id}:${d.id}`;
                          const oh = onHand[key] ?? 0;
                          const par = parLevels[key]?.par_level ?? 0;
                          const rec = effectiveRecommended(p.id, d.id);
                          return (
                            <Fragment key={d.id}>
                              <td className="border-l border-neutral-900 px-2 py-1.5 text-right text-neutral-400">
                                {oh}
                              </td>
                              <td className="px-2 py-1.5 text-right">
                                <input
                                  type="number"
                                  className="w-16 rounded border border-neutral-700 bg-neutral-900 px-1.5 py-0.5 text-right text-neutral-100"
                                  value={par}
                                  onChange={(e) =>
                                    handleParChange(
                                      p.id,
                                      d.id,
                                      Number(e.target.value) || 0,
                                    )
                                  }
                                />
                              </td>
                              <td className="px-2 py-1.5 text-right">
                                <input
                                  type="number"
                                  className="w-16 rounded border border-neutral-700 bg-neutral-900 px-1.5 py-0.5 text-right font-medium text-amber-400"
                                  value={rec}
                                  onChange={(e) =>
                                    handleRecChange(
                                      p.id,
                                      d.id,
                                      Number(e.target.value) || 0,
                                    )
                                  }
                                />
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
            {savingKey ? "Saving…" : " "} On Hand mirrors Distributor Inventory
            (edit it there). Par Level is a standing target — set it once, it
            applies to every future week until changed. Recommended Order
            recalculates automatically until you edit a cell by hand; after that
            it stays put.
          </p>
        </>
      )}

      {confirm && (
        <div className="fixed inset-0 z-30 flex items-center justify-center bg-black/60 p-4">
          <div className="w-full max-w-md rounded-lg border border-neutral-700 bg-neutral-950 p-5">
            <h2 className="text-base font-semibold text-neutral-100">
              {confirm.distributor.name} already has an order this week
            </h2>
            <p className="mt-2 text-sm text-neutral-400">
              Inventory &amp; Allocation already has non-zero allocation
              quantities for {confirm.distributor.name} this week. Overwrite
              that order with the Recommended Order numbers, or create a new
              distributor column (e.g. &quot;
              {confirm.distributor.name} 2&quot;) and push the recommendation
              there instead, leaving the existing order untouched.
            </p>
            <div className="mt-4 flex flex-wrap justify-end gap-2">
              <button
                type="button"
                onClick={() => setConfirm(null)}
                className="rounded-md border border-neutral-700 px-3 py-1.5 text-sm text-neutral-300 hover:bg-neutral-900"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => handleConfirmChoice("new")}
                className="rounded-md border border-neutral-700 px-3 py-1.5 text-sm text-neutral-300 hover:bg-neutral-900"
              >
                Create new column
              </button>
              <button
                type="button"
                onClick={() => handleConfirmChoice("overwrite")}
                className="rounded-md bg-white px-3 py-1.5 text-sm font-medium text-black hover:bg-neutral-200"
              >
                Overwrite existing order
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
