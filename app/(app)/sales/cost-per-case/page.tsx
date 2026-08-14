"use client";

import { useEffect, useMemo, useState, useCallback } from "react";
import { createClient } from "@/lib/supabase/client";
import type {
  PricingBrand,
  PackagingComponentRow,
  IngredientCostRow,
  PackageLaborCostRow,
} from "@/lib/types/db";
import { PRICE_LIST_PACKAGE_KEYS } from "@/lib/types/db";
import { PKG_META } from "@/lib/marginAnalysis";
import {
  PACKAGING_CATEGORIES,
  PACKAGE_COMPOSITION,
  INGREDIENT_CATEGORY_ORDER,
  calcPackagingCost,
  OVERVIEW_PACKAGE_YIELDS,
  OVERVIEW_BATCH_BBLS,
} from "@/lib/costPerCase";

interface BatchRecipeRow {
  id: string;
  brand_id: string;
  ingredient_key: string;
  qty_per_bbl: number;
  unit: string;
  sort_order: number;
}

const currencyFormatter = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" });

function fmt2(n: number): string {
  return "$" + n.toFixed(2);
}

type Tab = "overview" | "packaging" | "ingredients" | "labor" | "batch";

const TABS: { key: Tab; label: string }[] = [
  { key: "overview", label: "Overview" },
  { key: "packaging", label: "Packaging Cost" },
  { key: "ingredients", label: "Ingredient Cost" },
  { key: "labor", label: "Labor Cost" },
  { key: "batch", label: "Batch Ingredients" },
];

const CAN_FORMAT_LABELS: Record<string, string> = {
  "6pk": "12oz (6pk)",
  "4pack": "16oz (4pack)",
  single: "19.2oz (single)",
};

const ALL_FORMAT_LABELS: Record<string, string> = {
  "6pk": "12oz (6pk)",
  "4pack": "16oz (4pack)",
  single: "19.2oz (single)",
  sixth: "1/6 bbl",
  half: "1/2 bbl",
};

export default function CostPerCasePage() {
  const supabase = useMemo(() => createClient(), []);

  const [tab, setTab] = useState<Tab>("overview");
  const [brands, setBrands] = useState<PricingBrand[]>([]);
  const [components, setComponents] = useState<PackagingComponentRow[]>([]);
  const [ingredients, setIngredients] = useState<IngredientCostRow[]>([]);
  const [laborCosts, setLaborCosts] = useState<PackageLaborCostRow[]>([]);
  const [recipeItems, setRecipeItems] = useState<BatchRecipeRow[]>([]);
  const [userId, setUserId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [savingKey, setSavingKey] = useState<string | null>(null);

  const [selectedBrandId, setSelectedBrandId] = useState<string | null>(null);
  const [expandedRow, setExpandedRow] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);

    const {
      data: { user },
    } = await supabase.auth.getUser();
    setUserId(user?.id ?? null);

    const { data: brandData } = await supabase
      .from("pricing_brands")
      .select("*")
      .eq("active", true)
      .order("sort_order", { ascending: true, nullsFirst: false })
      .order("name");
    const brandList = (brandData as PricingBrand[]) ?? [];
    setBrands(brandList);
    setSelectedBrandId((prev) => prev ?? brandList[0]?.id ?? null);

    const { data: componentData } = await supabase
      .from("packaging_components")
      .select("*")
      .order("category")
      .order("component_key");
    setComponents((componentData as PackagingComponentRow[]) ?? []);

    const { data: ingredientData } = await supabase
      .from("ingredient_costs")
      .select("*")
      .order("category_key")
      .order("name");
    setIngredients((ingredientData as IngredientCostRow[]) ?? []);

    const { data: laborData } = await supabase
      .from("package_labor_costs")
      .select("*")
      .order("package_key");
    setLaborCosts((laborData as PackageLaborCostRow[]) ?? []);

    const { data: recipeData } = await supabase
      .from("batch_recipe_items")
      .select("*")
      .order("sort_order");
    setRecipeItems((recipeData as BatchRecipeRow[]) ?? []);

    setLoading(false);
  }, [supabase]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- intentional fetch-on-mount
    load();
  }, [load]);

  const componentPriceMap = useMemo(() => {
    const map: Record<string, number> = {};
    components.forEach((c) => {
      map[c.component_key] = c.price;
    });
    return map;
  }, [components]);

  const laborMap = useMemo(() => {
    const map: Record<string, number> = {};
    laborCosts.forEach((l) => {
      map[l.package_key] = l.labor;
    });
    return map;
  }, [laborCosts]);

  const ingredientPriceMap = useMemo(() => {
    const map: Record<string, { price: number; name: string; unit: string }> = {};
    ingredients.forEach((i) => {
      map[i.ingredient_key] = { price: i.price, name: i.name, unit: i.unit };
    });
    return map;
  }, [ingredients]);

  async function handleComponentPriceChange(componentKey: string, value: number) {
    if (!userId) return;
    const key = `component:${componentKey}`;
    setSavingKey(key);
    setComponents((prev) =>
      prev.map((c) => (c.component_key === componentKey ? { ...c, price: value } : c))
    );
    await supabase
      .from("packaging_components")
      .update({ price: value, updated_by: userId, updated_at: new Date().toISOString() })
      .eq("component_key", componentKey);
    setSavingKey(null);
  }

  async function handleIngredientPriceChange(id: string, value: number) {
    if (!userId) return;
    const key = `ingredient:${id}`;
    setSavingKey(key);
    setIngredients((prev) => prev.map((i) => (i.id === id ? { ...i, price: value } : i)));
    await supabase
      .from("ingredient_costs")
      .update({ price: value, updated_by: userId, updated_at: new Date().toISOString() })
      .eq("id", id);
    setSavingKey(null);
  }

  async function handleLaborChange(packageKey: string, value: number) {
    if (!userId) return;
    const key = `labor:${packageKey}`;
    setSavingKey(key);
    setLaborCosts((prev) =>
      prev.map((l) => (l.package_key === packageKey ? { ...l, labor: value } : l))
    );
    await supabase
      .from("package_labor_costs")
      .update({ labor: value, updated_by: userId, updated_at: new Date().toISOString() })
      .eq("package_key", packageKey);
    setSavingKey(null);
  }

  if (loading) return <p className="text-sm text-neutral-400">Loading…</p>;

  const selectedBrand = brands.find((b) => b.id === selectedBrandId) ?? brands[0] ?? null;
  const selectedRecipe = selectedBrand
    ? recipeItems.filter((r) => r.brand_id === selectedBrand.id)
    : [];
  const ingredientCostPerBatch = selectedRecipe.reduce((sum, item) => {
    const price = ingredientPriceMap[item.ingredient_key]?.price ?? 0;
    return sum + item.qty_per_bbl * OVERVIEW_BATCH_BBLS * price;
  }, 0);

  return (
    <div className="flex flex-col space-y-3">
      <div>
        <h1 className="text-lg font-semibold text-neutral-100">Cost Per Case</h1>
        <p className="text-sm text-neutral-400">
          Packaging, ingredient, and labor costs that feed Margin Analysis&apos;s defaults when a
          brand doesn&apos;t set its own override.
        </p>
      </div>

      <div className="flex flex-wrap gap-1 rounded-lg border border-neutral-800 bg-neutral-950 p-1">
        {TABS.map((t) => (
          <button
            key={t.key}
            type="button"
            onClick={() => {
              setTab(t.key);
              setExpandedRow(null);
            }}
            className={`rounded-md px-3 py-1.5 text-sm font-medium ${
              tab === t.key
                ? "bg-neutral-800 text-neutral-100"
                : "text-neutral-400 hover:bg-neutral-900 hover:text-neutral-200"
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === "overview" && (
        <div className="flex flex-col space-y-6">
          <div>
            <div className="mb-2 text-sm font-semibold text-neutral-300">
              Packaging Cost Per Case
            </div>
            <div className="flex flex-col gap-2">
              {Object.keys(CAN_FORMAT_LABELS).map((key) => {
                const cost = calcPackagingCost(key, componentPriceMap);
                const rowKey = `pkg:${key}`;
                const composition = Object.entries(PACKAGE_COMPOSITION[key] ?? {});
                return (
                  <div key={key}>
                    <button
                      type="button"
                      onClick={() => setExpandedRow(expandedRow === rowKey ? null : rowKey)}
                      className="flex w-full max-w-md items-center justify-between rounded-md bg-neutral-900 px-3 py-2 text-sm hover:bg-neutral-800"
                    >
                      <span className="text-neutral-300">{CAN_FORMAT_LABELS[key]} case:</span>
                      <span className="font-semibold text-neutral-100">{fmt2(cost)}</span>
                    </button>
                    {expandedRow === rowKey && (
                      <div className="mt-1 max-w-md rounded-md border border-neutral-800 bg-neutral-950 p-3 text-xs">
                        {composition.map(([componentKey, qty]) => (
                          <div key={componentKey} className="flex justify-between py-0.5">
                            <span className="text-neutral-400">
                              {qty} ×{" "}
                              {components.find((c) => c.component_key === componentKey)?.label ??
                                componentKey}
                            </span>
                            <span className="text-neutral-200">
                              {fmt2((componentPriceMap[componentKey] ?? 0) * qty)}
                            </span>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
            <p className="mt-1 text-xs text-neutral-500">Click any to see component breakdown.</p>
          </div>

          <div>
            <div className="mb-2 text-sm font-semibold text-neutral-300">
              Ingredient Cost Per Case ({OVERVIEW_BATCH_BBLS} BBL Batch)
            </div>
            <select
              value={selectedBrandId ?? ""}
              onChange={(e) => setSelectedBrandId(e.target.value)}
              className="mb-2 w-full max-w-md rounded-md border border-neutral-700 bg-neutral-900 px-3 py-2 text-sm text-neutral-100 focus:border-neutral-500 focus:outline-none"
            >
              {brands.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.name}
                </option>
              ))}
            </select>
            <div className="flex flex-col gap-2">
              {PRICE_LIST_PACKAGE_KEYS.map((key) => {
                const yieldAmt = OVERVIEW_PACKAGE_YIELDS[key];
                const perCase = yieldAmt > 0 ? ingredientCostPerBatch / yieldAmt : 0;
                const rowKey = `ing:${key}`;
                return (
                  <div key={key}>
                    <button
                      type="button"
                      onClick={() => setExpandedRow(expandedRow === rowKey ? null : rowKey)}
                      className="flex w-full max-w-md items-center justify-between rounded-md bg-neutral-900 px-3 py-2 text-sm hover:bg-neutral-800"
                    >
                      <span className="text-neutral-300">
                        {ALL_FORMAT_LABELS[key]} - {yieldAmt} {PKG_META[key].isKeg ? "kegs" : "cases"}:
                      </span>
                      <span className="font-semibold text-emerald-400">{fmt2(perCase)}</span>
                    </button>
                    {expandedRow === rowKey && (
                      <div className="mt-1 max-w-md rounded-md border border-neutral-800 bg-neutral-950 p-3 text-xs">
                        {selectedRecipe.length === 0 ? (
                          <p className="text-neutral-500">
                            No recipe on file for {selectedBrand?.name ?? "this brand"}.
                          </p>
                        ) : (
                          selectedRecipe.map((item) => {
                            const ing = ingredientPriceMap[item.ingredient_key];
                            const qty = item.qty_per_bbl * OVERVIEW_BATCH_BBLS;
                            return (
                              <div key={item.id} className="flex justify-between py-0.5">
                                <span className="text-neutral-400">
                                  {ing?.name ?? item.ingredient_key} — {qty.toFixed(2)} {item.unit}
                                </span>
                                <span className="text-neutral-200">
                                  {fmt2(qty * (ing?.price ?? 0))}
                                </span>
                              </div>
                            );
                          })
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
            <p className="mt-1 text-xs text-neutral-500">
              Click any to see ingredient breakdown. This is a rough per-case reference always
              based on a {OVERVIEW_BATCH_BBLS} BBL batch — an individual brand&apos;s actual batch
              size (set in Margin Analysis) may differ.
            </p>
          </div>

          <div>
            <div className="mb-2 text-sm font-semibold text-neutral-300">
              Labor Cost (Allocated Per Case)
            </div>
            <div className="flex flex-col gap-2">
              {PRICE_LIST_PACKAGE_KEYS.map((key) => {
                const yieldAmt = OVERVIEW_PACKAGE_YIELDS[key];
                const labor = laborMap[key] ?? PKG_META[key].labor;
                const perCase = yieldAmt > 0 ? labor / yieldAmt : 0;
                return (
                  <div
                    key={key}
                    className="flex w-full max-w-md items-center justify-between rounded-md bg-neutral-900 px-3 py-2 text-sm"
                  >
                    <span className="text-neutral-300">
                      {ALL_FORMAT_LABELS[key]} - {yieldAmt} {PKG_META[key].isKeg ? "kegs" : "cases"}{" "}
                      per batch:
                    </span>
                    <span className="font-semibold text-sky-400">{fmt2(perCase)}</span>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}

      {tab === "packaging" && (
        <div className="flex flex-col space-y-5">
          {PACKAGING_CATEGORIES.map((cat) => (
            <div key={cat.name}>
              <div className="mb-2 border-b border-neutral-800 pb-1 text-sm font-semibold text-neutral-300">
                {cat.name}
              </div>
              <div className="grid max-w-md gap-2">
                {cat.keys.map((key) => {
                  const comp = components.find((c) => c.component_key === key);
                  if (!comp) return null;
                  return (
                    <div
                      key={key}
                      className="flex items-center justify-between gap-3 rounded-md bg-neutral-900 px-3 py-2"
                    >
                      <span className="text-sm text-neutral-300">{comp.label}</span>
                      <div className="flex items-center gap-1">
                        <span className="text-neutral-500">$</span>
                        <input
                          type="number"
                          step="0.01"
                          min="0"
                          value={comp.price}
                          onChange={(e) =>
                            handleComponentPriceChange(key, Number(e.target.value) || 0)
                          }
                          className="w-20 rounded border border-neutral-700 bg-neutral-950 px-1.5 py-1 text-right text-sm text-neutral-100"
                        />
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      )}

      {tab === "ingredients" && (
        <div className="flex flex-col space-y-5">
          {INGREDIENT_CATEGORY_ORDER.map((cat) => (
            <div key={cat.key}>
              <div className="mb-2 border-b border-neutral-800 pb-1 text-sm font-semibold text-neutral-300">
                {cat.label}
              </div>
              <div className="grid max-w-md gap-2">
                {ingredients
                  .filter((i) => i.category_key === cat.key)
                  .map((ing) => (
                    <div
                      key={ing.id}
                      className="flex items-center justify-between gap-3 rounded-md bg-neutral-900 px-3 py-2"
                    >
                      <div>
                        <div className="text-sm text-neutral-300">{ing.name}</div>
                        <div className="text-xs text-neutral-500">per {ing.unit}</div>
                      </div>
                      <div className="flex items-center gap-1">
                        <span className="text-neutral-500">$</span>
                        <input
                          type="number"
                          step="0.01"
                          min="0"
                          value={ing.price}
                          onChange={(e) =>
                            handleIngredientPriceChange(ing.id, Number(e.target.value) || 0)
                          }
                          className="w-20 rounded border border-neutral-700 bg-neutral-950 px-1.5 py-1 text-right text-sm text-neutral-100"
                        />
                      </div>
                    </div>
                  ))}
              </div>
            </div>
          ))}
        </div>
      )}

      {tab === "labor" && (
        <div className="grid max-w-md gap-2">
          {PRICE_LIST_PACKAGE_KEYS.map((key) => {
            const labor = laborCosts.find((l) => l.package_key === key);
            if (!labor) return null;
            return (
              <div
                key={key}
                className="flex items-center justify-between gap-3 rounded-md bg-neutral-900 px-3 py-2"
              >
                <div>
                  <div className="text-sm text-neutral-300">{ALL_FORMAT_LABELS[key]}</div>
                  <div className="text-xs text-neutral-500">per batch</div>
                </div>
                <div className="flex items-center gap-1">
                  <span className="text-neutral-500">$</span>
                  <input
                    type="number"
                    step="0.01"
                    min="0"
                    value={labor.labor}
                    onChange={(e) => handleLaborChange(key, Number(e.target.value) || 0)}
                    className="w-20 rounded border border-neutral-700 bg-neutral-950 px-1.5 py-1 text-right text-sm text-neutral-100"
                  />
                </div>
              </div>
            );
          })}
        </div>
      )}

      {tab === "batch" && (
        <div className="flex flex-col space-y-3">
          <select
            value={selectedBrandId ?? ""}
            onChange={(e) => setSelectedBrandId(e.target.value)}
            className="w-full max-w-md rounded-md border border-neutral-700 bg-neutral-900 px-3 py-2 text-sm text-neutral-100 focus:border-neutral-500 focus:outline-none"
          >
            {brands.map((b) => (
              <option key={b.id} value={b.id}>
                {b.name}
              </option>
            ))}
          </select>

          {selectedRecipe.length === 0 ? (
            <p className="text-sm text-neutral-500">
              No recipe on file for {selectedBrand?.name ?? "this brand"}.
            </p>
          ) : (
            <>
              <div className="rounded-lg border border-neutral-800 bg-neutral-950">
                <table className="w-full border-collapse text-sm">
                  <thead>
                    <tr className="h-8 text-xs uppercase tracking-wide text-neutral-500">
                      <th className="bg-neutral-900 px-3 py-1 text-left">Ingredient</th>
                      <th className="bg-neutral-900 px-2 py-1 text-right">
                        Qty ({OVERVIEW_BATCH_BBLS} BBL)
                      </th>
                      <th className="bg-neutral-900 px-2 py-1 text-center">Unit</th>
                      <th className="bg-neutral-900 px-2 py-1 text-right">Unit Price</th>
                      <th className="bg-neutral-900 px-2 py-1 text-right">Total</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-neutral-900">
                    {selectedRecipe.map((item) => {
                      const ing = ingredientPriceMap[item.ingredient_key];
                      const qty = item.qty_per_bbl * OVERVIEW_BATCH_BBLS;
                      const lineCost = qty * (ing?.price ?? 0);
                      return (
                        <tr key={item.id}>
                          <td className="px-3 py-1.5 text-neutral-300">
                            {ing?.name ?? item.ingredient_key}
                          </td>
                          <td className="px-2 py-1.5 text-right text-neutral-400">
                            {qty.toFixed(2)}
                          </td>
                          <td className="px-2 py-1.5 text-center text-neutral-400">
                            {item.unit}
                          </td>
                          <td className="px-2 py-1.5 text-right text-neutral-400">
                            {fmt2(ing?.price ?? 0)}
                          </td>
                          <td className="px-2 py-1.5 text-right font-medium text-neutral-100">
                            {fmt2(lineCost)}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              <div className="flex max-w-md items-center justify-between border-t border-neutral-800 pt-2">
                <span className="font-semibold text-neutral-300">
                  Total Ingredient Cost Per Batch:
                </span>
                <span className="text-base font-bold text-neutral-100">
                  {currencyFormatter.format(ingredientCostPerBatch)}
                </span>
              </div>
            </>
          )}
        </div>
      )}

      {savingKey && <p className="text-xs text-neutral-500">Saving…</p>}
    </div>
  );
}
