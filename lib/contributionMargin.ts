import type { PriceListPackageKey } from "@/lib/types/db";
import { OVERVIEW_PACKAGE_YIELDS, OVERVIEW_BATCH_BBLS, calcPackagingCost } from "@/lib/costPerCase";

// =========================================================
// Sales > Contribution Margin — fourth and final piece of folding the old
// FCB Pricing desktop app in. Shows, per brand + package format, what a
// full batch is worth (Inventory Value) against everything it costs to
// make and package it (packaging + ingredients + labor + excise tax), then
// backs into a per-case-equivalent contribution margin.
//
// Unlike Margin Analysis, none of this is user-editable except
// revenue_per_ce (contribution_margin_lines table) — packaging/ingredient/
// labor costs are read live from Cost Per Case's tables (same "live
// defaults" pattern used by Margin Analysis), so an edit there ripples
// through here automatically.
//
// Fixed constants below are carried over exactly from the old app, which
// never exposed them as editable anywhere — same quirk as Cost Per Case's
// Overview tab always assuming a 30-BBL batch for ingredient cost.
// =========================================================

// "Case equivalents" per BBL — a federal excise-tax accounting unit, not a
// physical case. Every brand/package line assumes a 25-BBL batch yield
// for this calculation specifically (independent of that brand's actual
// Margin Analysis batch yield).
export const CE_FACTOR = 13.78;
export const CM_BBL_YIELD = 25;
export const TOTAL_CES_PER_BATCH = CM_BBL_YIELD * CE_FACTOR; // 344.5

// Federal + CA excise tax on a 30-BBL batch, flat regardless of package
// format — same figure the old app always used.
export const TOTAL_EXCISE_TAX_PER_BATCH = 30 * 3.5 + 30 * 31 * 0.2; // 291

export interface ContributionMarginResult {
  units: number;
  inventoryValue: number;
  pkgCost: number;
  ingCost: number;
  laborCost: number;
  shipping: number;
  exciseTax: number;
  totalBatchCost: number;
  netPossibleCM: number;
  totalCostPerCE: number;
  revenuePerCE: number;
  cm: number;
  cmPct: number;
}

export function computeContributionMarginLine(params: {
  packageKey: PriceListPackageKey;
  revenuePerCe: number;
  componentPrices: Record<string, number>;
  recipeItems: { ingredientKey: string; qtyPerBbl: number }[];
  ingredientPrices: Record<string, number>;
  laborForPackage: number;
}): ContributionMarginResult {
  const { packageKey, revenuePerCe, componentPrices, recipeItems, ingredientPrices, laborForPackage } =
    params;

  const units = OVERVIEW_PACKAGE_YIELDS[packageKey] ?? 0;
  const isKeg = packageKey === "sixth" || packageKey === "half";

  const pkgCostPerCase = isKeg ? 0 : calcPackagingCost(packageKey, componentPrices);
  const totalPkgCost = pkgCostPerCase * units;

  // Ingredient cost: always a flat 30-BBL batch (same as Cost Per Case's
  // Overview tab), independent of `units` — dividing by units and
  // multiplying back by units is a no-op, so we just compute the batch
  // total directly.
  const totalIngCost = recipeItems.reduce((sum, item) => {
    const price = ingredientPrices[item.ingredientKey] ?? 0;
    return sum + item.qtyPerBbl * OVERVIEW_BATCH_BBLS * price;
  }, 0);

  // Labor is a flat per-format total (same figure Margin Analysis falls
  // back to), not a per-case rate.
  const totalLaborCost = laborForPackage;

  const totalShippingCost = 0; // Est. Shipping — old app always showed $0 here too.

  const totalBatchCost =
    totalPkgCost + totalIngCost + totalLaborCost + totalShippingCost + TOTAL_EXCISE_TAX_PER_BATCH;

  const inventoryValue = revenuePerCe * TOTAL_CES_PER_BATCH;
  const netPossibleCM = inventoryValue - totalBatchCost;
  const totalCostPerCE = totalBatchCost / TOTAL_CES_PER_BATCH;
  const cm = revenuePerCe - totalCostPerCE;
  const cmPct = revenuePerCe > 0 ? (cm / revenuePerCe) * 100 : 0;

  return {
    units,
    inventoryValue,
    pkgCost: totalPkgCost,
    ingCost: totalIngCost,
    laborCost: totalLaborCost,
    shipping: totalShippingCost,
    exciseTax: TOTAL_EXCISE_TAX_PER_BATCH,
    totalBatchCost,
    netPossibleCM,
    totalCostPerCE,
    revenuePerCE: revenuePerCe,
    cm,
    cmPct,
  };
}
