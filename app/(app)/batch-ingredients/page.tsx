"use client";

// Standalone Batch Ingredients page — Operations > Batch Ingredients,
// added 2026-09-16 per Chad. Full CRUD on every brand's batch recipe: edit
// qty/unit per ingredient, edit an ingredient's price (shared globally,
// same as Sales > Cost Per Case's own Ingredient Cost tab), add or remove
// ingredients from a brand's recipe, and build a brand's very first recipe
// from scratch (there's no separate "create batch" step — adding the first
// ingredient to an empty brand IS creating its batch).
//
// This intentionally duplicates some of Sales > Cost Per Case's read-only
// "Batch Ingredients" tab (same tables, same OVERVIEW_BATCH_BBLS reference
// batch size) — per Chad, that tab stays exactly as-is; this is the actual
// editable version, as its own page.
//
// Needs sql/batch_ingredients_access.sql run first — it adds the new
// "batch_ingredients" section to the RLS policies on pricing_brands,
// ingredient_costs, and batch_recipe_items (previously only gated by
// cost_per_case / margin_analysis / contribution_margin / price_list, none
// of which this page's own access grant is).

import { useEffect, useMemo, useState, useCallback } from "react";
import { createClient } from "@/lib/supabase/client";
import type { PricingBrand, IngredientCostRow } from "@/lib/types/db";
import { INGREDIENT_CATEGORY_ORDER, OVERVIEW_BATCH_BBLS } from "@/lib/costPerCase";

interface BatchRecipeRow {
  id: string;
  brand_id: string;
  ingredient_key: string;
  qty_per_bbl: number;
  unit: string;
  sort_order: number;
}

function fmt2(n: number): string {
  return "$" + n.toFixed(2);
}

const currencyFormatter = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" });

export default function BatchIngredientsPage() {
  const supabase = useMemo(() => createClient(), []);

  const [brands, setBrands] = useState<PricingBrand[]>([]);
  const [ingredients, setIngredients] = useState<IngredientCostRow[]>([]);
  const [recipeItems, setRecipeItems] = useState<BatchRecipeRow[]>([]);
  const [userId, setUserId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [savingKey, setSavingKey] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [selectedBrandId, setSelectedBrandId] = useState<string | null>(null);

  // "Add ingredient" row state.
  const [addIngredientKey, setAddIngredientKey] = useState("");
  const [addQty, setAddQty] = useState("");
  const [addUnit, setAddUnit] = useState("");

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

    const { data: ingredientData } = await supabase
      .from("ingredient_costs")
      .select("*")
      .order("category_key")
      .order("name");
    setIngredients((ingredientData as IngredientCostRow[]) ?? []);

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

  const ingredientPriceMap = useMemo(() => {
    const map: Record<string, { price: number; name: string; unit: string }> = {};
    ingredients.forEach((i) => {
      map[i.ingredient_key] = { price: i.price, name: i.name, unit: i.unit };
    });
    return map;
  }, [ingredients]);

  const selectedBrand = brands.find((b) => b.id === selectedBrandId) ?? brands[0] ?? null;
  const selectedRecipe = selectedBrand
    ? recipeItems.filter((r) => r.brand_id === selectedBrand.id).sort((a, b) => a.sort_order - b.sort_order)
    : [];
  // Ingredients already on this brand's recipe are hidden from the "add"
  // dropdown — editing an existing line's qty/unit is how you change one
  // that's already there, adding is only for ones that aren't yet.
  const usedIngredientKeys = new Set(selectedRecipe.map((r) => r.ingredient_key));
  const availableToAdd = ingredients.filter((i) => !usedIngredientKeys.has(i.ingredient_key));

  const ingredientCostPerBatch = selectedRecipe.reduce((sum, item) => {
    const price = ingredientPriceMap[item.ingredient_key]?.price ?? 0;
    return sum + item.qty_per_bbl * OVERVIEW_BATCH_BBLS * price;
  }, 0);

  async function handleQtyChange(id: string, value: number) {
    if (!userId) return;
    const key = `qty:${id}`;
    setSavingKey(key);
    setRecipeItems((prev) => prev.map((r) => (r.id === id ? { ...r, qty_per_bbl: value } : r)));
    await supabase.from("batch_recipe_items").update({ qty_per_bbl: value }).eq("id", id);
    setSavingKey(null);
  }

  async function handleUnitChange(id: string, value: string) {
    if (!userId) return;
    const key = `unit:${id}`;
    setSavingKey(key);
    setRecipeItems((prev) => prev.map((r) => (r.id === id ? { ...r, unit: value } : r)));
    await supabase.from("batch_recipe_items").update({ unit: value }).eq("id", id);
    setSavingKey(null);
  }

  async function handlePriceChange(ingredientId: string, value: number) {
    if (!userId) return;
    const key = `price:${ingredientId}`;
    setSavingKey(key);
    setIngredients((prev) => prev.map((i) => (i.id === ingredientId ? { ...i, price: value } : i)));
    await supabase
      .from("ingredient_costs")
      .update({ price: value, updated_by: userId, updated_at: new Date().toISOString() })
      .eq("id", ingredientId);
    setSavingKey(null);
  }

  async function handleRemove(id: string) {
    if (!userId) return;
    if (!confirm("Remove this ingredient from the recipe? This can't be undone.")) return;
    const key = `remove:${id}`;
    setSavingKey(key);
    const { error: delError } = await supabase.from("batch_recipe_items").delete().eq("id", id);
    if (delError) {
      setError(delError.message);
    } else {
      setRecipeItems((prev) => prev.filter((r) => r.id !== id));
    }
    setSavingKey(null);
  }

  async function handleAdd() {
    if (!userId || !selectedBrand) return;
    const qty = Number(addQty);
    if (!addIngredientKey || !addQty || Number.isNaN(qty) || qty <= 0) {
      setError("Pick an ingredient and enter a quantity greater than 0.");
      return;
    }
    setError(null);
    const key = "add";
    setSavingKey(key);
    const nextSortOrder =
      selectedRecipe.length > 0 ? Math.max(...selectedRecipe.map((r) => r.sort_order)) + 1 : 0;
    const ing = ingredientPriceMap[addIngredientKey];
    const { data, error: insError } = await supabase
      .from("batch_recipe_items")
      .insert({
        brand_id: selectedBrand.id,
        ingredient_key: addIngredientKey,
        qty_per_bbl: qty,
        unit: addUnit || ing?.unit || "",
        sort_order: nextSortOrder,
      })
      .select()
      .single();
    if (insError || !data) {
      setError(insError?.message ?? "Couldn't add that ingredient.");
    } else {
      setRecipeItems((prev) => [...prev, data as BatchRecipeRow]);
      setAddIngredientKey("");
      setAddQty("");
      setAddUnit("");
    }
    setSavingKey(null);
  }

  if (loading) return <p className="text-sm text-neutral-400">Loading…</p>;

  return (
    <div className="flex flex-col space-y-4">
      <div>
        <h1 className="text-lg font-semibold text-neutral-100">Batch Ingredients</h1>
        <p className="text-sm text-neutral-400">
          Every brand&apos;s recipe — add or remove ingredients, adjust quantities, and edit
          pricing. Ingredient prices are shared: changing one here changes it everywhere that
          ingredient is used, same as Sales &gt; Cost Per Case&apos;s Ingredient Cost tab.
        </p>
      </div>

      <select
        value={selectedBrandId ?? ""}
        onChange={(e) => {
          setSelectedBrandId(e.target.value);
          setError(null);
          setAddIngredientKey("");
          setAddQty("");
          setAddUnit("");
        }}
        className="w-full max-w-md rounded-md border border-neutral-700 bg-neutral-900 px-3 py-2 text-sm text-neutral-100 focus:border-neutral-500 focus:outline-none"
      >
        {brands.map((b) => (
          <option key={b.id} value={b.id}>
            {b.name}
          </option>
        ))}
      </select>

      {error && (
        <p className="max-w-md rounded-md border border-red-900 bg-red-950 px-3 py-2 text-sm text-red-300">
          {error}
        </p>
      )}

      {selectedRecipe.length === 0 ? (
        <p className="text-sm text-neutral-500">
          No recipe on file yet for {selectedBrand?.name ?? "this brand"} — add the first
          ingredient below to build it.
        </p>
      ) : (
        <div className="rounded-lg border border-neutral-800 bg-neutral-950">
          <table className="w-full border-collapse text-sm">
            <thead>
              <tr className="h-8 text-xs uppercase tracking-wide text-neutral-500">
                <th className="bg-neutral-900 px-3 py-1 text-left">Ingredient</th>
                <th className="bg-neutral-900 px-2 py-1 text-right">Qty ({OVERVIEW_BATCH_BBLS} BBL)</th>
                <th className="bg-neutral-900 px-2 py-1 text-center">Unit</th>
                <th className="bg-neutral-900 px-2 py-1 text-right">Unit Price</th>
                <th className="bg-neutral-900 px-2 py-1 text-right">Total</th>
                <th className="bg-neutral-900 px-2 py-1"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-neutral-900">
              {selectedRecipe.map((item) => {
                const ing = ingredientPriceMap[item.ingredient_key];
                const ingRow = ingredients.find((i) => i.ingredient_key === item.ingredient_key);
                const qty = item.qty_per_bbl * OVERVIEW_BATCH_BBLS;
                const lineCost = qty * (ing?.price ?? 0);
                return (
                  <tr key={item.id}>
                    <td className="px-3 py-1.5 text-neutral-300">{ing?.name ?? item.ingredient_key}</td>
                    <td className="px-2 py-1.5 text-right">
                      <input
                        type="number"
                        step="0.0001"
                        min="0"
                        defaultValue={qty}
                        onBlur={(e) => {
                          const total = Number(e.target.value) || 0;
                          handleQtyChange(item.id, total / OVERVIEW_BATCH_BBLS);
                        }}
                        className="w-24 rounded border border-neutral-700 bg-neutral-900 px-1.5 py-1 text-right text-sm text-neutral-100"
                      />
                    </td>
                    <td className="px-2 py-1.5 text-center">
                      <input
                        type="text"
                        defaultValue={item.unit}
                        onBlur={(e) => handleUnitChange(item.id, e.target.value)}
                        className="w-20 rounded border border-neutral-700 bg-neutral-900 px-1.5 py-1 text-center text-sm text-neutral-100"
                      />
                    </td>
                    <td className="px-2 py-1.5 text-right">
                      {ingRow ? (
                        <div className="flex items-center justify-end gap-1">
                          <span className="text-neutral-500">$</span>
                          <input
                            type="number"
                            step="0.01"
                            min="0"
                            defaultValue={ingRow.price}
                            onBlur={(e) => handlePriceChange(ingRow.id, Number(e.target.value) || 0)}
                            className="w-20 rounded border border-neutral-700 bg-neutral-900 px-1.5 py-1 text-right text-sm text-neutral-100"
                          />
                        </div>
                      ) : (
                        <span className="text-neutral-500">{fmt2(ing?.price ?? 0)}</span>
                      )}
                    </td>
                    <td className="px-2 py-1.5 text-right font-medium text-neutral-100">
                      {fmt2(lineCost)}
                    </td>
                    <td className="px-2 py-1.5 text-right">
                      <button
                        type="button"
                        onClick={() => handleRemove(item.id)}
                        disabled={savingKey === `remove:${item.id}`}
                        className="rounded border border-neutral-700 px-2 py-1 text-xs text-red-400 hover:bg-red-950 disabled:opacity-50"
                      >
                        Remove
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      <div className="flex max-w-md items-center justify-between border-t border-neutral-800 pt-2">
        <span className="font-semibold text-neutral-300">Total Ingredient Cost Per Batch:</span>
        <span className="text-base font-bold text-neutral-100">
          {currencyFormatter.format(ingredientCostPerBatch)}
        </span>
      </div>

      <div className="rounded-lg border border-neutral-800 bg-neutral-950 p-3">
        <div className="mb-2 text-sm font-semibold text-neutral-300">Add Ingredient</div>
        <div className="flex flex-wrap items-end gap-2">
          <div className="flex flex-col gap-1">
            <label className="text-xs text-neutral-500">Ingredient</label>
            <select
              value={addIngredientKey}
              onChange={(e) => {
                setAddIngredientKey(e.target.value);
                const ing = ingredientPriceMap[e.target.value];
                setAddUnit(ing?.unit ?? "");
              }}
              className="w-56 rounded-md border border-neutral-700 bg-neutral-900 px-2 py-1.5 text-sm text-neutral-100 focus:border-neutral-500 focus:outline-none"
            >
              <option value="">Select an ingredient…</option>
              {INGREDIENT_CATEGORY_ORDER.map((cat) => {
                const opts = availableToAdd.filter((i) => i.category_key === cat.key);
                if (opts.length === 0) return null;
                return (
                  <optgroup key={cat.key} label={cat.label}>
                    {opts.map((i) => (
                      <option key={i.ingredient_key} value={i.ingredient_key}>
                        {i.name}
                      </option>
                    ))}
                  </optgroup>
                );
              })}
            </select>
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-xs text-neutral-500">Qty ({OVERVIEW_BATCH_BBLS} BBL)</label>
            <input
              type="number"
              step="0.0001"
              min="0"
              value={addQty}
              onChange={(e) => setAddQty(e.target.value)}
              className="w-28 rounded border border-neutral-700 bg-neutral-900 px-2 py-1.5 text-sm text-neutral-100"
            />
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-xs text-neutral-500">Unit</label>
            <input
              type="text"
              value={addUnit}
              onChange={(e) => setAddUnit(e.target.value)}
              className="w-24 rounded border border-neutral-700 bg-neutral-900 px-2 py-1.5 text-sm text-neutral-100"
            />
          </div>
          <button
            type="button"
            onClick={handleAdd}
            disabled={savingKey === "add" || !addIngredientKey}
            className="rounded-md bg-[#6ABC46] px-3 py-1.5 text-sm font-semibold text-black hover:bg-[#5da83d] disabled:opacity-50"
          >
            Add
          </button>
        </div>
        {availableToAdd.length === 0 && (
          <p className="mt-2 text-xs text-neutral-500">
            Every ingredient on file is already in this brand&apos;s recipe.
          </p>
        )}
      </div>

      {savingKey && <p className="text-xs text-neutral-500">Saving…</p>}
    </div>
  );
}
