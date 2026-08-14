import type { PriceListPackageKey } from "@/lib/types/db";

// Standard defaults per package format, carried over exactly from the old
// FCB Pricing desktop app. packCost/labor/defaultYield here are used
// whenever a brand's analysis doesn't have its own override for that
// package. Once Cost Per Case (a later Sales phase) ships, packCost/labor
// will likely become live-editable elsewhere and feed in here instead of
// being fixed constants — for now they match what the old app always used.
export interface PackageMeta {
  label: string;
  units: number;
  vol: string;
  packCost: number;
  labor: number;
  defaultYield: number;
  isKeg: boolean;
}

export const PKG_META: Record<PriceListPackageKey, PackageMeta> = {
  "6pk": { label: "6pk", units: 4, vol: "12 oz", packCost: 9.69, labor: 637.29, defaultYield: 344, isKeg: false },
  "4pack": { label: "4pk", units: 6, vol: "16oz", packCost: 11.13, labor: 637.29, defaultYield: 258, isKeg: false },
  single: { label: "Single", units: 12, vol: "19.2oz", packCost: 5.97, labor: 637.29, defaultYield: 431, isKeg: false },
  sixth: { label: "1/6 bbl", units: 1, vol: "5.2g", packCost: 0, labor: 200, defaultYield: 150, isKeg: true },
  half: { label: "1/2 bbl", units: 1, vol: "15.5g", packCost: 0, labor: 200, defaultYield: 50, isKeg: true },
};

export const CAN_KEYS: PriceListPackageKey[] = ["6pk", "4pack", "single"];
export const KEG_KEYS: PriceListPackageKey[] = ["sixth", "half"];

export function fmtDollar(n: number | null | undefined): string {
  return n == null ? "—" : "$" + n.toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}

export function fmtRounded(n: number | null | undefined): string {
  return n == null ? "—" : "$" + Math.round(n).toLocaleString();
}

export function fmtPct(n: number | null | undefined): string {
  return n == null ? "—" : (n * 100).toFixed(1) + "%";
}

export interface PkgCalc {
  ptd: number;
  tax28: number;
  gp$: number;
  gp_pct: number;
  uPrice: number;
  ptc15: number;
  ptc20: number;
  ptc25: number;
  ptc30: number;
}

// Per-package margin math: what you charge the retailer (PTR) vs. what the
// distributor pays you (PTD), and the gross profit / suggested consumer
// pricing that implies.
export function calcPkg(ptr: number, ptd: number, units: number): PkgCalc | null {
  if (!ptr || ptr <= 0) return null;
  if (!ptd || ptd <= 0) return null;
  const tax28 = ptd * 0.28;
  const gp = ptr - ptd;
  const gpPct = gp / ptr;
  const uPrice = ptd / units;
  return {
    ptd,
    tax28,
    gp$: gp,
    gp_pct: gpPct,
    uPrice,
    ptc15: uPrice / 0.85,
    ptc20: uPrice / 0.8,
    ptc25: uPrice / 0.75,
    ptc30: uPrice / 0.7,
  };
}

export interface BatchCalc {
  revenue: number;
  total: number;
  profit: number;
  margin: number;
}

// Full-batch economics for can formats (packaging cost applies).
export function calcBatchCan(
  ptd: number,
  yieldCases: number,
  batchCost: number,
  packCost: number,
  labor: number
): BatchCalc {
  const revenue = ptd * yieldCases;
  const total = batchCost + packCost + labor;
  const profit = revenue - total;
  const margin = revenue > 0 ? profit / revenue : 0;
  return { revenue, total, profit, margin };
}

// Full-batch economics for keg formats (no packaging cost line).
export function calcBatchKeg(
  ptd: number,
  yieldKegs: number,
  batchCost: number,
  labor: number
): BatchCalc {
  const revenue = ptd * yieldKegs;
  const total = batchCost + labor;
  const profit = revenue - total;
  const margin = revenue > 0 ? profit / revenue : 0;
  return { revenue, total, profit, margin };
}
