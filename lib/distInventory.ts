// Sales Dashboard → Distributor Inventory (added 2026-10-28, per Chad: the old
// Distributor Inventory page is "way too confusing for our sales manager, it
// needs to be more like the distributor inventories we have in the
// distributors section, What they are low or out of stock on, and then their
// actual inventory, clicking on them will give even more sales data").
//
// Inventory rows come from sales_territory_stock (one call per distributor,
// same as each distributor page's "Stock at" block). Clicking a product asks
// sales_dist_product_sales for its LilyPad sales at that distributor — this
// file turns the inventory product name ("Juicy 16oz …") into LilyPad's
// product name(s) + size, using the Brew Planner's brand list (the one that's
// already matched against the live product names).

import { BASES } from "@/lib/brewPlanner";

export interface StockItem {
  product: string;
  on_hand: number;
  per_week: number;
  weeks_left: number | null;
}
export interface StockData {
  updated_at: string | null;
  source: string | null; // 'ekos' | 'distributor' (uploaded file / typed in)
  inventory: StockItem[];
}

// Same rule as the distributor pages: selling, and out or under 2 weeks left.
export const LOW_WEEKS = 2;
export const isOut = (i: StockItem) => i.per_week > 0 && i.on_hand <= 0;
export const isLow = (i: StockItem) => i.per_week > 0 && i.on_hand > 0 && (i.weeks_left ?? 99) < LOW_WEEKS;

// LilyPad size from the package in an app product name.
export function sizeOfProduct(name: string): string | null {
  const n = name.toLowerCase();
  if (/1\/2/.test(n)) return "1/2 bbl";
  if (/1\/6/.test(n)) return "1/6 bbl";
  if (/19\.2/.test(n)) return "19.2oz";
  if (/16\s*oz/.test(n)) return "16oz";
  if (/12\s*oz|4x6/.test(n)) return "12oz";
  return null;
}

// LilyPad product name(s) for an app product, or [] when LilyPad doesn't
// carry that brand (Lime 30, Metropolis, most ciders …).
export function lilyProductsOf(name: string): string[] {
  for (const b of BASES) for (const br of b.brands) if (br.app.test(name)) return br.lily;
  return [];
}

export interface ProductSales {
  as_of: string | null;
  months: { month: string; cases: number }[];
  periods: { p: "30" | "90" | "ytd"; yr: "ty" | "ly"; cases: number }[];
  accounts: {
    outlet_id: string;
    name: string;
    city: string | null;
    premise: string | null;
    last_buy: string | null;
    cases_90: number | null;
    cases_12: number | null;
  }[];
}

// Days between two YYYY-MM-DD dates (b − a).
export function daysBetween(a: string, b: string): number {
  return Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86400000);
}
