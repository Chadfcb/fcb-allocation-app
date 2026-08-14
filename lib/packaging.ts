// Packaging & label consumption logic for the Inventory & Allocation page.
//
// Every product's name encodes its can/keg size (e.g. "Capt. Hazy (Case -
// 6x4 - 16oz - Can)" or "EUREKA STOUT - 1/2 bbl keg"), and each size has a
// fixed "recipe" of packaging materials it consumes per case/keg — cans,
// trays, pakteks, lids, and (per-product) labels. This file derives a
// product's size from its name and turns allocated quantities into
// packaging/label consumption totals.

import type { Product } from "@/lib/types/db";

export type PackagingItemKey =
  | "cans_19_2oz"
  | "cans_16oz"
  | "cans_12oz"
  | "pakteks_4pack"
  | "pakteks_6pack"
  | "trays_12_16oz"
  | "trays_19oz"
  | "lids_202"
  | "kegs_1_6bbl"
  | "kegs_1_2bbl";

export const PACKAGING_ITEMS: { key: PackagingItemKey; label: string }[] = [
  { key: "cans_19_2oz", label: "19.2oz Cans" },
  { key: "cans_16oz", label: "16oz Cans" },
  { key: "cans_12oz", label: "12oz Cans" },
  { key: "pakteks_4pack", label: "4 Pack Pakteks" },
  { key: "pakteks_6pack", label: "6 Pack Pakteks" },
  { key: "trays_12_16oz", label: "12/16oz Trays" },
  { key: "trays_19oz", label: "19oz Trays" },
  { key: "lids_202", label: "202 LOE Ends (Lids)" },
  { key: "kegs_1_6bbl", label: "1/6 bbl Kegs" },
  { key: "kegs_1_2bbl", label: "1/2 bbl Kegs" },
];

type CanSizeKey = "19_2oz" | "16oz" | "12oz";
type KegSizeKey = "1_6bbl" | "1_2bbl";

export type ProductPackaging =
  | { kind: "can"; size: CanSizeKey }
  | { kind: "keg"; size: KegSizeKey }
  | { kind: "tap_handle" }
  | { kind: "unrecognized" };

interface CanRecipe {
  canItem: PackagingItemKey;
  cansPerCase: number;
  trayItem: PackagingItemKey;
  traysPerCase: number;
  paktekItem: PackagingItemKey | null;
  pakteksPerCase: number;
  lidsPerCase: number;
  labelsPerCase: number;
}

const CAN_RECIPES: Record<CanSizeKey, CanRecipe> = {
  "19_2oz": {
    canItem: "cans_19_2oz",
    cansPerCase: 12,
    trayItem: "trays_19oz",
    traysPerCase: 1,
    paktekItem: null,
    pakteksPerCase: 0,
    lidsPerCase: 12,
    labelsPerCase: 12,
  },
  "16oz": {
    canItem: "cans_16oz",
    cansPerCase: 24,
    trayItem: "trays_12_16oz",
    traysPerCase: 1,
    paktekItem: "pakteks_4pack",
    pakteksPerCase: 6,
    lidsPerCase: 24,
    labelsPerCase: 24,
  },
  "12oz": {
    canItem: "cans_12oz",
    cansPerCase: 24,
    trayItem: "trays_12_16oz",
    traysPerCase: 1,
    paktekItem: "pakteks_6pack",
    pakteksPerCase: 4,
    lidsPerCase: 24,
    labelsPerCase: 24,
  },
};

const KEG_ITEMS: Record<KegSizeKey, PackagingItemKey> = {
  "1_2bbl": "kegs_1_2bbl",
  "1_6bbl": "kegs_1_6bbl",
};

// Determines a product's can/keg size from its name. Tap handles are
// explicitly excluded (no packaging/label tracking at all). Anything that
// doesn't match a known pattern comes back "unrecognized" rather than being
// silently guessed at, so it can be surfaced to the user instead of quietly
// throwing off the totals.
export function derivePackaging(name: string): ProductPackaging {
  const lower = name.toLowerCase();

  if (lower.includes("tap handle")) return { kind: "tap_handle" };

  if (/1\s*\/\s*2\s*bbl/.test(lower)) return { kind: "keg", size: "1_2bbl" };
  if (/1\s*\/\s*6\s*bbl/.test(lower)) return { kind: "keg", size: "1_6bbl" };

  // Check 19.2oz before 16oz/12oz since it's the most specific pattern.
  if (/19\.?2?\s*oz/.test(lower)) return { kind: "can", size: "19_2oz" };
  if (/16\s*oz/.test(lower)) return { kind: "can", size: "16oz" };
  if (/12\s*oz/.test(lower)) return { kind: "can", size: "12oz" };

  return { kind: "unrecognized" };
}

export interface ConsumptionResult {
  packagingConsumed: Record<PackagingItemKey, number>;
  labelConsumed: Record<string, number>; // product_id -> labels consumed
  unrecognizedProducts: string[]; // product names that didn't match any size
}

// Turns each product's total allocated quantity (across all distributors)
// into packaging/label consumption, using the recipes above.
export function computeConsumption(
  products: Product[],
  totalAllocatedFor: (productId: string) => number
): ConsumptionResult {
  const packagingConsumed = Object.fromEntries(
    PACKAGING_ITEMS.map((item) => [item.key, 0])
  ) as Record<PackagingItemKey, number>;
  const labelConsumed: Record<string, number> = {};
  const unrecognizedProducts: string[] = [];

  for (const p of products) {
    const info = derivePackaging(p.name);
    if (info.kind === "tap_handle") continue;
    if (info.kind === "unrecognized") {
      unrecognizedProducts.push(p.name);
      continue;
    }

    const qty = totalAllocatedFor(p.id);

    if (info.kind === "keg") {
      packagingConsumed[KEG_ITEMS[info.size]] += qty;
      continue;
    }

    const recipe = CAN_RECIPES[info.size];
    packagingConsumed[recipe.canItem] += qty * recipe.cansPerCase;
    packagingConsumed[recipe.trayItem] += qty * recipe.traysPerCase;
    if (recipe.paktekItem) {
      packagingConsumed[recipe.paktekItem] += qty * recipe.pakteksPerCase;
    }
    packagingConsumed.lids_202 += qty * recipe.lidsPerCase;
    labelConsumed[p.id] = (labelConsumed[p.id] ?? 0) + qty * recipe.labelsPerCase;
  }

  return { packagingConsumed, labelConsumed, unrecognizedProducts };
}
