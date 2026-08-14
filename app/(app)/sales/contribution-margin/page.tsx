"use client";

import { Fragment, useEffect, useMemo, useState, useCallback } from "react";
import { createClient } from "@/lib/supabase/client";
import { logChange } from "@/lib/audit";
import type {
  PricingBrand,
  PackagingComponentRow,
  IngredientCostRow,
  PackageLaborCostRow,
  ContributionMarginLineRow,
  PriceListPackageKey,
} from "@/lib/types/db";
import { PRICE_LIST_PACKAGE_LABELS } from "@/lib/types/db";
import { PACKAGE_COMPOSITION, calcPackagingCost, OVERVIEW_BATCH_BBLS } from "@/lib/costPerCase";
import {
  computeContributionMarginLine,
  TOTAL_CES_PER_BATCH,
  TOTAL_EXCISE_TAX_PER_BATCH,
  CM_BBL_YIELD,
  type ContributionMarginResult,
} from "@/lib/contributionMargin";

interface BatchRecipeRow {
  id: string;
  brand_id: string;
  ingredient_key: string;
  qty_per_bbl: number;
  unit: string;
  sort_order: number;
}

// Fixed display order for company groups — matches the old desktop app's
// grouping order (Full Circle, Speakeasy, Sonoma Cider), just spelled out
// with the same full company names used elsewhere in the app.
const COMPANY_ORDER = ["Full Circle Brewing", "Speakeasy Ales & Lagers", "Sonoma Cider"];

function fmt2(n: number): string {
  return "$" + n.toFixed(2);
}
function fmt0(n: number): string {
  return "$" + Math.round(n).toLocaleString();
}
function fmtPct(n: number): string {
  return n.toFixed(1) + "%";
}

type SortColumn =
  | "brand"
  | "format"
  | "units"
  | "inventoryValue"
  | "pkgCost"
  | "ingCost"
  | "laborCost"
  | "shipping"
  | "exciseTax"
  | "totalBatchCost"
  | "netPossibleCM"
  | "totalCostPerCE"
  | "revenuePerCE"
  | "cm"
  | "cmPct";

interface DisplayRow {
  line: ContributionMarginLineRow;
  brand: PricingBrand;
  format: string;
  packageKey: PriceListPackageKey;
  calc: ContributionMarginResult;
  showDivider: boolean;
}

export default function ContributionMarginPage() {
  const supabase = useMemo(() => createClient(), []);

  const [brands, setBrands] = useState<PricingBrand[]>([]);
  const [lines, setLines] = useState<ContributionMarginLineRow[]>([]);
  const [components, setComponents] = useState<PackagingComponentRow[]>([]);
  const [ingredients, setIngredients] = useState<IngredientCostRow[]>([]);
  const [laborCosts, setLaborCosts] = useState<PackageLaborCostRow[]>([]);
  const [recipeItems, setRecipeItems] = useState<BatchRecipeRow[]>([]);
  const [userId, setUserId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [savingKey, setSavingKey] = useState<string | null>(null);

  const [sortColumn, setSortColumn] = useState<SortColumn | null>(null);
  const [sortDirection, setSortDirection] = useState<"asc" | "desc">("asc");
  const [expandedLineId, setExpandedLineId] = useState<string | null>(null);

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
    setBrands((brandData as PricingBrand[]) ?? []);

    const { data: lineData } = await supabase.from("contribution_margin_lines").select("*");
    setLines((lineData as ContributionMarginLineRow[]) ?? []);

    const { data: componentData } = await supabase.from("packaging_components").select("*");
    setComponents((componentData as PackagingComponentRow[]) ?? []);

    const { data: ingredientData } = await supabase.from("ingredient_costs").select("*");
    setIngredients((ingredientData as IngredientCostRow[]) ?? []);

    const { data: laborData } = await supabase.from("package_labor_costs").select("*");
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

  const ingredientPriceMap = useMemo(() => {
    const map: Record<string, { price: number; name: string; unit: string }> = {};
    ingredients.forEach((i) => {
      map[i.ingredient_key] = { price: i.price, name: i.name, unit: i.unit };
    });
    return map;
  }, [ingredients]);

  const laborMap = useMemo(() => {
    const map: Record<string, number> = {};
    laborCosts.forEach((l) => {
      map[l.package_key] = l.labor;
    });
    return map;
  }, [laborCosts]);

  const recipeByBrand = useMemo(() => {
    const map: Record<string, BatchRecipeRow[]> = {};
    recipeItems.forEach((r) => {
      (map[r.brand_id] ??= []).push(r);
    });
    return map;
  }, [recipeItems]);

  const brandById = useMemo(() => {
    const map: Record<string, PricingBrand> = {};
    brands.forEach((b) => {
      map[b.id] = b;
    });
    return map;
  }, [brands]);

  // Build one display row per contribution_margin_lines entry, joined to its
  // brand, with the full live calculation. Only brands with a company set
  // are in scope here — same as the old desktop app (Mango Bomb never had
  // Contribution Margin figures).
  const rows: DisplayRow[] = useMemo(() => {
    return lines
      .map((line) => {
        const brand = brandById[line.brand_id];
        if (!brand || !brand.company) return null;
        const recipe = (recipeByBrand[brand.id] ?? []).map((r) => ({
          ingredientKey: r.ingredient_key,
          qtyPerBbl: r.qty_per_bbl,
        }));
        const ingredientPrices: Record<string, number> = {};
        Object.entries(ingredientPriceMap).forEach(([key, v]) => {
          ingredientPrices[key] = v.price;
        });
        const calc = computeContributionMarginLine({
          packageKey: line.package_key,
          revenuePerCe: line.revenue_per_ce,
          componentPrices: componentPriceMap,
          recipeItems: recipe,
          ingredientPrices,
          laborForPackage: laborMap[line.package_key] ?? 0,
        });
        return {
          line,
          brand,
          format: PRICE_LIST_PACKAGE_LABELS[line.package_key],
          packageKey: line.package_key,
          calc,
        };
      })
      .filter((r): r is DisplayRow => r !== null);
  }, [lines, brandById, recipeByBrand, ingredientPriceMap, componentPriceMap, laborMap]);

  const sortedRows = useMemo(() => {
    let ordered: DisplayRow[];
    if (!sortColumn) {
      // Default order: company (fixed list order), then brand sort_order,
      // then package format (brand's own sort_order among its lines).
      ordered = [...rows].sort((a, b) => {
        const ac = COMPANY_ORDER.indexOf(a.brand.company ?? "");
        const bc = COMPANY_ORDER.indexOf(b.brand.company ?? "");
        if (ac !== bc) return ac - bc;
        const abo = a.brand.sort_order ?? 0;
        const bbo = b.brand.sort_order ?? 0;
        if (abo !== bbo) return abo - bbo;
        return a.line.package_key.localeCompare(b.line.package_key);
      });
    } else {
      const dir = sortDirection === "asc" ? 1 : -1;
      const getVal = (r: DisplayRow): string | number => {
        switch (sortColumn) {
          case "brand":
            return r.brand.name;
          case "format":
            return r.format;
          case "units":
            return r.calc.units;
          case "inventoryValue":
            return r.calc.inventoryValue;
          case "pkgCost":
            return r.calc.pkgCost;
          case "ingCost":
            return r.calc.ingCost;
          case "laborCost":
            return r.calc.laborCost;
          case "shipping":
            return r.calc.shipping;
          case "exciseTax":
            return r.calc.exciseTax;
          case "totalBatchCost":
            return r.calc.totalBatchCost;
          case "netPossibleCM":
            return r.calc.netPossibleCM;
          case "totalCostPerCE":
            return r.calc.totalCostPerCE;
          case "revenuePerCE":
            return r.calc.revenuePerCE;
          case "cm":
            return r.calc.cm;
          case "cmPct":
            return r.calc.cmPct;
          default:
            return 0;
        }
      };
      ordered = [...rows].sort((a, b) => {
        const av = getVal(a);
        const bv = getVal(b);
        if (typeof av === "string" || typeof bv === "string") {
          return dir * String(av).localeCompare(String(bv));
        }
        return dir * ((av as number) - (bv as number));
      });
    }

    // Compute divider flags in this same pass with a plain indexed loop
    // (rather than a closure that mutates an outer variable, which the
    // lint config here treats as an impurity risk) so the render below
    // only ever reads `showDivider`, never derives it.
    const withDividers: DisplayRow[] = [];
    for (let i = 0; i < ordered.length; i++) {
      const prevCompany = i === 0 ? null : ordered[i - 1].brand.company;
      withDividers.push({ ...ordered[i], showDivider: ordered[i].brand.company !== prevCompany });
    }
    return withDividers;
  }, [rows, sortColumn, sortDirection]);

  function handleSort(column: SortColumn) {
    if (sortColumn === column) {
      setSortDirection((prev) => (prev === "asc" ? "desc" : "asc"));
    } else {
      setSortColumn(column);
      setSortDirection("asc");
    }
  }

  async function handleRevenueChange(line: ContributionMarginLineRow, value: number) {
    if (!userId) return;
    const key = `rev:${line.id}`;
    setSavingKey(key);
    const oldValue = line.revenue_per_ce;

    setLines((prev) =>
      prev.map((l) => (l.id === line.id ? { ...l, revenue_per_ce: value } : l))
    );

    const { data, error } = await supabase
      .from("contribution_margin_lines")
      .update({ revenue_per_ce: value, updated_by: userId, updated_at: new Date().toISOString() })
      .eq("id", line.id)
      .select()
      .single();

    if (!error && data) {
      await logChange(supabase, {
        weekId: null,
        tableName: "contribution_margin_lines",
        recordId: line.id,
        fieldName: "revenue_per_ce",
        oldValue,
        newValue: value,
        changedBy: userId,
      });
    }
    setSavingKey(null);
  }

  if (loading) return <p className="text-sm text-neutral-400">Loading…</p>;

  const headers: { key: SortColumn; label: string; align?: "left" | "center" | "right" }[] = [
    { key: "brand", label: "Brand", align: "left" },
    { key: "format", label: "Format", align: "center" },
    { key: "units", label: `Units/${CM_BBL_YIELD} bbl Yield` },
    { key: "inventoryValue", label: "Inventory Value" },
    { key: "pkgCost", label: "Pkg Cost" },
    { key: "ingCost", label: "Ing Cost" },
    { key: "laborCost", label: "Labor Cost" },
    { key: "shipping", label: "Est. Shipping" },
    { key: "exciseTax", label: "Excise Tax" },
    { key: "totalBatchCost", label: "Total Batch Cost" },
    { key: "netPossibleCM", label: "Net Possible CM" },
    { key: "totalCostPerCE", label: "Total Cost/CE" },
    { key: "revenuePerCE", label: "Rev/CE" },
    { key: "cm", label: "CM/CE" },
    { key: "cmPct", label: "Margin %" },
  ];

  return (
    <div className="flex flex-col space-y-3">
      <div>
        <h1 className="text-lg font-semibold text-neutral-100">Contribution Margin</h1>
        <p className="text-sm text-neutral-400">
          Per-batch economics by brand and package format, grouped by company. Rev/CE is
          editable — everything else here is computed live from Cost Per Case and updates
          automatically when those prices change. Click a row&apos;s Total Batch Cost to see the
          full breakdown.
        </p>
      </div>

      <div className="overflow-x-auto rounded-lg border border-neutral-800 bg-neutral-950">
        <table className="w-full border-collapse text-xs">
          <thead>
            <tr className="border-b border-neutral-800 bg-neutral-900 text-neutral-400">
              {headers.map((h) => (
                <th
                  key={h.key}
                  onClick={() => handleSort(h.key)}
                  className={`cursor-pointer whitespace-nowrap px-2 py-2 font-semibold hover:text-neutral-100 ${
                    h.align === "left"
                      ? "text-left"
                      : h.align === "center"
                        ? "text-center"
                        : "text-right"
                  }`}
                >
                  {h.label} {sortColumn === h.key ? (sortDirection === "asc" ? "↑" : "↓") : "⇅"}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {sortedRows.map((row) => {
              const showDivider = row.showDivider;
              const isExpanded = expandedLineId === row.line.id;
              const cmColor = row.calc.cm >= 0 ? "text-emerald-400" : "text-red-400";
              const recipe = recipeByBrand[row.brand.id] ?? [];
              const isKeg = row.packageKey === "sixth" || row.packageKey === "half";
              const pkgPerCase = isKeg ? 0 : calcPackagingCost(row.packageKey, componentPriceMap);
              const composition = isKeg
                ? []
                : Object.entries(PACKAGE_COMPOSITION[row.packageKey] ?? {});

              return (
                <Fragment key={row.line.id}>
                  {showDivider && (
                    <tr key={`div-${row.brand.company}`}>
                      <td
                        colSpan={headers.length}
                        className="border-b-2 border-amber-600/60 bg-neutral-900 px-3 py-2 text-sm font-bold text-amber-500"
                      >
                        {row.brand.company}
                      </td>
                    </tr>
                  )}
                  <tr key={row.line.id} className="border-b border-neutral-900 hover:bg-neutral-900/60">
                    <td className="whitespace-nowrap px-2 py-1.5 text-neutral-200">
                      {row.brand.name}
                    </td>
                    <td className="whitespace-nowrap px-2 py-1.5 text-center text-neutral-300">
                      {row.format}
                    </td>
                    <td className="whitespace-nowrap px-2 py-1.5 text-right text-neutral-400">
                      {row.calc.units.toLocaleString()}
                    </td>
                    <td className="whitespace-nowrap px-2 py-1.5 text-right text-neutral-300">
                      {fmt0(row.calc.inventoryValue)}
                    </td>
                    <td className="whitespace-nowrap px-2 py-1.5 text-right text-sky-400">
                      {fmt2(row.calc.pkgCost)}
                    </td>
                    <td className="whitespace-nowrap px-2 py-1.5 text-right text-violet-400">
                      {fmt2(row.calc.ingCost)}
                    </td>
                    <td className="whitespace-nowrap px-2 py-1.5 text-right text-orange-400">
                      {fmt2(row.calc.laborCost)}
                    </td>
                    <td className="whitespace-nowrap px-2 py-1.5 text-right text-neutral-400">
                      {fmt2(row.calc.shipping)}
                    </td>
                    <td className="whitespace-nowrap px-2 py-1.5 text-right text-neutral-400">
                      {fmt2(row.calc.exciseTax)}
                    </td>
                    <td
                      onClick={() => setExpandedLineId(isExpanded ? null : row.line.id)}
                      className="cursor-pointer whitespace-nowrap px-2 py-1.5 text-right font-semibold text-neutral-200 underline decoration-dotted"
                    >
                      {fmt2(row.calc.totalBatchCost)}
                    </td>
                    <td className="whitespace-nowrap px-2 py-1.5 text-right font-semibold text-neutral-200">
                      {fmt2(row.calc.netPossibleCM)}
                    </td>
                    <td className="whitespace-nowrap px-2 py-1.5 text-right font-semibold text-neutral-200">
                      {fmt2(row.calc.totalCostPerCE)}
                    </td>
                    <td className="whitespace-nowrap px-2 py-1.5 text-right">
                      <div className="flex items-center justify-end gap-0.5">
                        <span className="text-neutral-500">$</span>
                        <input
                          type="number"
                          step="0.0001"
                          className="w-24 rounded border border-neutral-700 bg-neutral-900 px-1 py-0.5 text-right text-neutral-100"
                          value={row.line.revenue_per_ce}
                          onChange={(e) =>
                            handleRevenueChange(row.line, Number(e.target.value) || 0)
                          }
                        />
                      </div>
                    </td>
                    <td className={`whitespace-nowrap px-2 py-1.5 text-right font-semibold ${cmColor}`}>
                      {fmt2(row.calc.cm)}
                    </td>
                    <td className={`whitespace-nowrap px-2 py-1.5 text-right font-semibold ${cmColor}`}>
                      {fmtPct(row.calc.cmPct)}
                    </td>
                  </tr>
                  {isExpanded && (
                    <tr key={`expand-${row.line.id}`}>
                      <td colSpan={headers.length} className="bg-neutral-950 px-4 py-3">
                        <div className="grid grid-cols-1 gap-4 text-xs sm:grid-cols-2 lg:grid-cols-4">
                          <div>
                            <div className="mb-1 font-semibold text-neutral-300">
                              Inventory Value
                            </div>
                            <div className="text-neutral-400">
                              Rev/CE {fmt2(row.calc.revenuePerCE)} × {TOTAL_CES_PER_BATCH.toFixed(1)}{" "}
                              CEs/{CM_BBL_YIELD}bbl batch
                            </div>
                            <div className="mt-1 font-semibold text-neutral-200">
                              = {fmt0(row.calc.inventoryValue)}
                            </div>
                          </div>
                          <div>
                            <div className="mb-1 font-semibold text-neutral-300">
                              Packaging Cost ({row.calc.units.toLocaleString()} cases)
                            </div>
                            {isKeg ? (
                              <div className="text-neutral-500">Keg formats — no packaging cost.</div>
                            ) : (
                              <>
                                {composition.map(([key, qty]) => (
                                  <div key={key} className="flex justify-between text-neutral-400">
                                    <span>
                                      {qty} × {key}
                                    </span>
                                    <span>{fmt2((componentPriceMap[key] ?? 0) * qty)}</span>
                                  </div>
                                ))}
                                <div className="mt-1 flex justify-between font-semibold text-neutral-200">
                                  <span>{fmt2(pkgPerCase)}/case × units</span>
                                  <span>= {fmt2(row.calc.pkgCost)}</span>
                                </div>
                              </>
                            )}
                          </div>
                          <div>
                            <div className="mb-1 font-semibold text-neutral-300">
                              Ingredient Cost ({OVERVIEW_BATCH_BBLS} bbl batch)
                            </div>
                            <div className="max-h-32 overflow-y-auto pr-1">
                              {recipe.length === 0 ? (
                                <div className="text-neutral-500">No recipe on file.</div>
                              ) : (
                                recipe.map((item) => {
                                  const ing = ingredientPriceMap[item.ingredient_key];
                                  const qty = item.qty_per_bbl * OVERVIEW_BATCH_BBLS;
                                  return (
                                    <div key={item.id} className="flex justify-between text-neutral-400">
                                      <span>
                                        {ing?.name ?? item.ingredient_key} — {qty.toFixed(2)}{" "}
                                        {item.unit}
                                      </span>
                                      <span>{fmt2(qty * (ing?.price ?? 0))}</span>
                                    </div>
                                  );
                                })
                              )}
                            </div>
                            <div className="mt-1 font-semibold text-neutral-200">
                              = {fmt2(row.calc.ingCost)}
                            </div>
                          </div>
                          <div>
                            <div className="mb-1 font-semibold text-neutral-300">
                              Labor + Excise + Total
                            </div>
                            <div className="flex justify-between text-neutral-400">
                              <span>Labor ({row.format})</span>
                              <span>{fmt2(row.calc.laborCost)}</span>
                            </div>
                            <div className="flex justify-between text-neutral-400">
                              <span>Est. Shipping</span>
                              <span>{fmt2(row.calc.shipping)}</span>
                            </div>
                            <div className="flex justify-between text-neutral-400">
                              <span>Excise Tax (flat, 30bbl)</span>
                              <span>{fmt2(row.calc.exciseTax)}</span>
                            </div>
                            <div className="mt-1 flex justify-between border-t border-neutral-800 pt-1 font-semibold text-neutral-200">
                              <span>Total Batch Cost</span>
                              <span>{fmt2(row.calc.totalBatchCost)}</span>
                            </div>
                            <div className="mt-2 flex justify-between text-neutral-400">
                              <span>Net Possible CM</span>
                              <span>
                                {fmt0(row.calc.inventoryValue)} − {fmt2(row.calc.totalBatchCost)} ={" "}
                                {fmt2(row.calc.netPossibleCM)}
                              </span>
                            </div>
                            <div className="flex justify-between text-neutral-400">
                              <span>Total Cost/CE</span>
                              <span>
                                {fmt2(row.calc.totalBatchCost)} ÷ {TOTAL_CES_PER_BATCH.toFixed(1)} ={" "}
                                {fmt2(row.calc.totalCostPerCE)}
                              </span>
                            </div>
                            <div className="flex justify-between text-neutral-400">
                              <span>CM/CE</span>
                              <span>
                                {fmt2(row.calc.revenuePerCE)} − {fmt2(row.calc.totalCostPerCE)} ={" "}
                                {fmt2(row.calc.cm)}
                              </span>
                            </div>
                            <div className="flex justify-between text-neutral-400">
                              <span>Margin %</span>
                              <span>{fmtPct(row.calc.cmPct)}</span>
                            </div>
                          </div>
                        </div>
                      </td>
                    </tr>
                  )}
                </Fragment>
              );
            })}
          </tbody>
        </table>
      </div>

      <p className="text-xs text-neutral-500">
        {savingKey
          ? "Saving…"
          : `Excise tax (${fmt2(
              TOTAL_EXCISE_TAX_PER_BATCH
            )}) and CE yield are fixed per batch, same as the old desktop app.`}
      </p>
    </div>
  );
}
