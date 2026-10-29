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

import {
  useEffect,
  useMemo,
  useRef,
  useState,
  useCallback,
  Fragment,
} from "react";
import { createClient } from "@/lib/supabase/client";
import { logChange } from "@/lib/audit";
import { derivePackaging } from "@/lib/packaging";
import { BASES } from "@/lib/brewPlanner";
import type {
  Week,
  Product,
  Distributor,
  DistributorInventory,
  DistributorParLevel,
  BuildOrderRecommendation,
  Allocation,
  SectionDivider,
} from "@/lib/types/db";
import { chipText } from "@/lib/appearance";
import { useNewFeature } from "@/lib/newFeatures";
import NewBadge from "@/components/NewBadge";

// Total BBLs column — barrels per case/keg (standard volumetric math):
// 1 bbl = 31 gal = 3,968 fl oz.
const BBL_PER_UNIT: Record<string, number> = {
  "19_2oz": 230.4 / 3968, // 12 x 19.2oz
  "16oz": 384 / 3968, // 24 x 16oz
  "12oz": 288 / 3968, // 24 x 12oz
  "1_2bbl": 0.5,
  "1_6bbl": 1 / 6,
};

// Barrels in one unit (case or keg) of a product, from its name. null when
// the size can't be read from the name.
function bblPerUnit(productName: string): number | null {
  const info = derivePackaging(productName);
  if (info.kind === "can" || info.kind === "keg") {
    return BBL_PER_UNIT[info.size] ?? null;
  }
  return null;
}

// Beer Total column — which beer a product is, so every package of it
// (cans and kegs) adds up together. Uses the Brew Planner's product-name
// tests (lib/brewPlanner.ts BASES) so "Capt. WC" and "Capt. WC IPA", or
// "Mystic Haze" and "Mystic Haze IPA", land on the same beer; anything not
// listed there falls back to the name before the "(" (e.g. "Spartan").
function beerName(productName: string): string {
  for (const base of BASES) {
    for (const brand of base.brands) {
      if (brand.app.test(productName)) return brand.name;
    }
  }
  const cut = productName.indexOf("(");
  return (cut > 0 ? productName.slice(0, cut) : productName).trim();
}

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
  const [userId, setUserId] = useState<string | null>(null);
  const [isAdmin, setIsAdmin] = useState(false);
  const [loading, setLoading] = useState(true);
  const [savingKey, setSavingKey] = useState<string | null>(null);

  const [pushingId, setPushingId] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<ConfirmState | null>(null);
  const [pushResult, setPushResult] = useState<PushResult | null>(null);

  // Total BBLs sits pinned right next to the Product column, so it needs to
  // know how wide the Product column is (product names vary in length).
  const productThRef = useRef<HTMLTableCellElement>(null);
  const [productColWidth, setProductColWidth] = useState(0);
  // Beer Total is pinned right after Total BBLs, so it needs that width too.
  const totalBblsThRef = useRef<HTMLTableCellElement>(null);
  const [totalBblsColWidth, setTotalBblsColWidth] = useState(0);
  const totalBblsNew = useNewFeature("feature:build-orders-total-bbls");
  const beerTotalNew = useNewFeature("feature:build-orders-beer-total");

  const load = useCallback(async () => {
    setLoading(true);

    const {
      data: { user },
    } = await supabase.auth.getUser();
    setUserId(user?.id ?? null);

    // Everything below this point is independent of everything else EXCEPT
    // the two queries at the very end (invData/recData), which need
    // weekData's id first. Firing all of these off together instead of
    // awaiting them one at a time (the original pattern) turns ~9 sequential
    // round-trips to Supabase into 2 — this was the main cause of the app
    // feeling slow when switching between sections (Chad, 2026-09-07).
    const [
      profileResult,
      weekResult,
      productResult,
      dividerResult,
      distributorResult,
      parResult,
    ] = await Promise.all([
      user
        ? supabase.from("profiles").select("role").eq("id", user.id).maybeSingle()
        : Promise.resolve({ data: null }),
      supabase
        .from("weeks")
        .select("*")
        .order("week_start", { ascending: false })
        .limit(1)
        .maybeSingle(),
      supabase
        .from("products")
        .select("*")
        .eq("active", true)
        .order("sort_order", { ascending: true, nullsFirst: false })
        .order("name"),
      supabase.from("section_dividers").select("*"),
      // Same distributor set/order as Distributor Inventory.
      supabase
        .from("distributors")
        .select("*")
        .eq("active", true)
        .eq("track_inventory", true)
        .order("inventory_sort_order", { ascending: true, nullsFirst: false })
        .order("name"),
      supabase.from("distributor_par_levels").select("*"),
    ]);

    const profile = profileResult.data;
    // Section access replaces the old admin-only gate — see
    // lib/permissions.ts. An admin still always gets in; a Basic user needs
    // the "build_orders" section granted from Users > Edit.
    if (profile?.role === "admin") {
      setIsAdmin(true);
    } else if (user) {
      const { data: grant } = await supabase
        .from("user_section_access")
        .select("section_key")
        .eq("user_id", user.id)
        .eq("section_key", "build_orders")
        .maybeSingle();
      setIsAdmin(!!grant);
    }

    const weekData = weekResult.data;
    setWeek(weekData as Week | null);

    const activeProducts = ((productResult.data as Product[]) ?? []).filter(
      (p) => derivePackaging(p.name).kind !== "tap_handle",
    );
    setProducts(activeProducts);

    setDividers((dividerResult.data as SectionDivider[]) ?? []);
    setDistributors((distributorResult.data as Distributor[]) ?? []);

    const parMap: Record<string, DistributorParLevel> = {};
    (parResult.data as DistributorParLevel[] | null)?.forEach((row) => {
      parMap[`${row.product_id}:${row.distributor_id}`] = row;
    });
    setParLevels(parMap);


    if (weekData) {
      const week_ = weekData as Week;

      const [invResult, recResult] = await Promise.all([
        supabase
          .from("distributor_inventory")
          .select("product_id, distributor_id, on_hand_qty")
          .eq("week_id", week_.id),
        supabase
          .from("build_order_recommendations")
          .select("*")
          .eq("week_id", week_.id),
      ]);

      const onHandMap: Record<string, number> = {};
      (
        invResult.data as
          | Pick<
              DistributorInventory,
              "product_id" | "distributor_id" | "on_hand_qty"
            >[]
          | null
      )?.forEach((row) => {
        onHandMap[`${row.product_id}:${row.distributor_id}`] = row.on_hand_qty;
      });
      setOnHand(onHandMap);

      const recMap: Record<string, BuildOrderRecommendation> = {};
      (recResult.data as BuildOrderRecommendation[] | null)?.forEach((row) => {
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

  useEffect(() => {
    const productEl = productThRef.current;
    const totalEl = totalBblsThRef.current;
    if (!productEl || !totalEl) return;
    const observer = new ResizeObserver(() => {
      setProductColWidth(productEl.getBoundingClientRect().width);
      setTotalBblsColWidth(totalEl.getBoundingClientRect().width);
    });
    observer.observe(productEl);
    observer.observe(totalEl);
    return () => observer.disconnect();
  }, [loading, week, distributors.length]);

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

  // Total BBLs: per product, every distributor's Rec. Order added up and
  // converted to barrels; the header gets the grand total.
  // Beer Total: every package of the same beer added up (beerName). Rows of
  // the same beer that sit together share one merged cell (beerSpan = how
  // many rows the cell covers on the first row, 0 on the rows it covers).
  const productBbls: Record<string, number | null> = {};
  const beerBbls: Record<string, number | null> = {};
  const beerSpan: Record<string, number> = {};
  let grandTotalBbls = 0;
  let runStartId: string | null = null;
  let runBeer: string | null = null;
  for (const row of combined) {
    if (row.kind === "divider") {
      runStartId = null;
      runBeer = null;
      continue;
    }
    const beer = beerName(row.item.name);
    if (runStartId && runBeer === beer) {
      beerSpan[runStartId] += 1;
      beerSpan[row.item.id] = 0;
    } else {
      runStartId = row.item.id;
      runBeer = beer;
      beerSpan[row.item.id] = 1;
    }
    if (!(beer in beerBbls)) beerBbls[beer] = null;

    const per = bblPerUnit(row.item.name);
    if (per === null) {
      productBbls[row.item.id] = null;
      continue;
    }
    const units = distributors.reduce(
      (sum, d) => sum + effectiveRecommended(row.item.id, d.id),
      0,
    );
    const bbls = units * per;
    productBbls[row.item.id] = bbls;
    beerBbls[beer] = (beerBbls[beer] ?? 0) + bbls;
    grandTotalBbls += bbls;
  }

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
                    ref={productThRef}
                    rowSpan={2}
                    className="sticky top-0 left-0 z-20 whitespace-nowrap bg-neutral-900 px-3 text-left align-bottom"
                  >
                    Product
                  </th>
                  <th
                    ref={totalBblsThRef}
                    rowSpan={2}
                    onClick={() => totalBblsNew.dismiss()}
                    style={{ left: productColWidth }}
                    title="Every distributor's Rec. Order for the product, added up and converted to barrels (1 bbl = 31 gal)"
                    className="sticky top-0 z-20 whitespace-nowrap border-l border-r border-neutral-800 bg-neutral-900 px-3 pb-1 text-right align-bottom"
                  >
                    <div className="flex items-center justify-end">
                      Total BBLs
                      {totalBblsNew.isNew && <NewBadge inline />}
                    </div>
                    <div className="text-sm font-semibold normal-case tracking-normal text-amber-400">
                      {grandTotalBbls.toFixed(2)}
                    </div>
                  </th>
                  <th
                    rowSpan={2}
                    onClick={() => beerTotalNew.dismiss()}
                    style={{ left: productColWidth + totalBblsColWidth }}
                    title="Every package of the same beer (cans and kegs) added up, in barrels"
                    className="sticky top-0 z-20 whitespace-nowrap border-r border-neutral-800 bg-neutral-900 px-3 pb-1 text-right align-bottom"
                  >
                    <div className="flex items-center justify-end">
                      Beer Total
                      {beerTotalNew.isNew && <NewBadge inline />}
                    </div>
                  </th>
                  {distributors.map((d) => (
                    <th
                      key={d.id}
                      colSpan={3}
                      className="sticky top-0 z-10 whitespace-nowrap border-l border-neutral-800 bg-neutral-900 px-2 py-1 text-center"
                    >
                      <div style={{ color: d.color ? chipText(d.color) : undefined }}>
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
                      colSpan={3}
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
                          <td className="sticky left-0 z-10 whitespace-nowrap bg-neutral-900 px-3 py-1.5 text-xs font-semibold uppercase tracking-wide text-neutral-300">
                            {row.item.label}
                          </td>
                          <td
                            colSpan={2}
                            style={{ left: productColWidth }}
                            className="sticky z-10 border-l border-r border-neutral-800 bg-neutral-900"
                          />
                          {distributors.length > 0 && (
                            <td colSpan={distributors.length * 3} />
                          )}
                        </tr>
                      );
                    }

                    const p = row.item;
                    const beer = beerName(p.name);
                    const span = beerSpan[p.id] ?? 1;
                    const beerTotal = beerBbls[beer];
                    return (
                      <tr key={p.id} className="group hover:bg-neutral-900/60">
                        <td className="sticky left-0 z-10 whitespace-nowrap bg-neutral-950 px-3 py-1.5 font-medium text-neutral-200 group-hover:bg-neutral-900">
                          {p.name}
                        </td>
                        <td
                          style={{ left: productColWidth }}
                          className="sticky z-10 whitespace-nowrap border-l border-r border-neutral-800 bg-neutral-950 px-3 py-1.5 text-right font-medium text-neutral-200 group-hover:bg-neutral-900"
                        >
                          {productBbls[p.id] == null
                            ? "—"
                            : (productBbls[p.id] as number).toFixed(2)}
                        </td>
                        {span > 0 && (
                          <td
                            rowSpan={span}
                            style={{ left: productColWidth + totalBblsColWidth }}
                            title={beer}
                            className="sticky z-10 whitespace-nowrap border-r border-b border-neutral-800 bg-neutral-950 px-3 py-1.5 text-right align-middle font-semibold text-amber-400"
                          >
                            {beerTotal == null ? "—" : beerTotal.toFixed(2)}
                          </td>
                        )}
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
            it stays put. Total BBLs is every distributor&apos;s Rec. Order for
            that product added up and converted to barrels (1 bbl = 31 gal), with
            the total for everything in its header. Beer Total adds up every
            package of the same beer (cans and kegs).
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
