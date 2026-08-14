import type { PriceListPackageKey } from "@/lib/types/db";

// =========================================================
// Sales > Cost Per Case — third piece of folding the old FCB Pricing
// desktop app in. Lets admins edit the underlying packaging component
// prices, ingredient prices, and per-package-format labor costs that feed
// Margin Analysis's defaults (when a brand doesn't set its own override)
// and, eventually, Contribution Margin.
//
// The RECIPE structures below (which components go into a case, which
// ingredient categories exist) are fixed, same as the old app — only the
// underlying unit PRICES are editable, via the packaging_components,
// ingredient_costs, and package_labor_costs tables.
// =========================================================

export interface PackagingComponentMeta {
  key: string;
  label: string;
  category: string;
}

export const PACKAGING_CATEGORIES: { name: string; keys: string[] }[] = [
  { name: "Cans", keys: ["can_12oz", "can_16oz", "can_19_2oz"] },
  { name: "Labels", keys: ["label_12oz", "label_16oz", "label_19_2oz"] },
  { name: "Lids", keys: ["lid"] },
  { name: "Pakteks", keys: ["paktek_4pk", "paktek_6pk"] },
  { name: "Trays", keys: ["tray_12_16oz", "tray_19_2oz"] },
];

export const PACKAGING_COMPONENT_LABELS: Record<string, string> = {
  can_12oz: "12oz can (per can)",
  can_16oz: "16oz can (per can)",
  can_19_2oz: "19.2oz can (per can)",
  lid: "Lid (per lid)",
  label_12oz: "Label 12oz (per label)",
  label_16oz: "Label 16oz (per label)",
  label_19_2oz: "Label 19.2oz (per label)",
  paktek_4pk: "Paktek 4pk (per unit)",
  paktek_6pk: "Paktek 6pk (per unit)",
  tray_12_16oz: "Tray 12-16oz (per tray)",
  tray_19_2oz: "Tray 19.2oz (per tray)",
};

// How many of each packaging component go into one case, per can format.
// Keg formats (sixth/half) have no packaging cost line.
export const PACKAGE_COMPOSITION: Record<string, Record<string, number>> = {
  "6pk": { can_12oz: 24, lid: 24, label_12oz: 24, paktek_6pk: 6, tray_12_16oz: 1 },
  "4pack": { can_16oz: 24, lid: 24, label_16oz: 24, paktek_6pk: 6, tray_12_16oz: 1 },
  single: { can_19_2oz: 12, lid: 12, label_19_2oz: 12, tray_19_2oz: 1 },
};

// Computes packaging cost per case for a can format, from live component
// prices (a map of component_key -> price, straight from the
// packaging_components table).
export function calcPackagingCost(
  packageKey: string,
  componentPrices: Record<string, number>
): number {
  const composition = PACKAGE_COMPOSITION[packageKey];
  if (!composition) return 0;
  let cost = 0;
  for (const [componentKey, qty] of Object.entries(composition)) {
    cost += (componentPrices[componentKey] ?? 0) * qty;
  }
  return cost;
}

export const INGREDIENT_CATEGORY_ORDER: { key: string; label: string }[] = [
  { key: "yeast", label: "Yeast" },
  { key: "grain", label: "Grain" },
  { key: "hops", label: "Hops" },
  { key: "flavoring", label: "Flavoring" },
  { key: "other", label: "Other" },
];

export interface BatchRecipeLine {
  ingredientKey: string;
  qtyPerBbl: number;
  unit: string;
}

// Per-brand ingredient recipes, quantity per BBL (barrel) of batch. Fixed
// data carried over from the old app — view-only in Cost Per Case for now,
// same as it was there (only ingredient unit prices are editable).
export const BATCH_RECIPES: Record<string, BatchRecipeLine[]> = {
  "Big Daddy": [
    { ingredientKey: "ay4", qtyPerBbl: 83.3333, unit: "g" },
    { ingredientKey: "2row", qtyPerBbl: 42.1667, unit: "lb" },
    { ingredientKey: "pilsner", qtyPerBbl: 20.1667, unit: "lb" },
    { ingredientKey: "munich_light", qtyPerBbl: 3.6667, unit: "lb" },
    { ingredientKey: "vienna", qtyPerBbl: 3.6667, unit: "lb" },
    { ingredientKey: "columbus_hot", qtyPerBbl: 0.9167, unit: "lb" },
    { ingredientKey: "chinook_hot", qtyPerBbl: 0.1833, unit: "lb" },
    { ingredientKey: "columbus_cold", qtyPerBbl: 0.3667, unit: "lb" },
    { ingredientKey: "cascade_cold", qtyPerBbl: 0.7333, unit: "lb" },
    { ingredientKey: "chinook_cold", qtyPerBbl: 0.55, unit: "lb" },
  ],
  "Capt WC IPA": [
    { ingredientKey: "ay4", qtyPerBbl: 83.3333, unit: "g" },
    { ingredientKey: "2row", qtyPerBbl: 42.1667, unit: "lb" },
    { ingredientKey: "pilsner", qtyPerBbl: 20.1667, unit: "lb" },
    { ingredientKey: "munich_light", qtyPerBbl: 3.6667, unit: "lb" },
    { ingredientKey: "vienna", qtyPerBbl: 3.6667, unit: "lb" },
    { ingredientKey: "columbus_hot", qtyPerBbl: 0.9167, unit: "lb" },
    { ingredientKey: "chinook_hot", qtyPerBbl: 0.1833, unit: "lb" },
    { ingredientKey: "columbus_cold", qtyPerBbl: 0.3667, unit: "lb" },
    { ingredientKey: "cascade_cold", qtyPerBbl: 0.7333, unit: "lb" },
    { ingredientKey: "chinook_cold", qtyPerBbl: 0.55, unit: "lb" },
  ],
  "Capt Hazy": [
    { ingredientKey: "new_e", qtyPerBbl: 83.3333, unit: "g" },
    { ingredientKey: "2row", qtyPerBbl: 56.8333, unit: "lb" },
    { ingredientKey: "pilsner", qtyPerBbl: 11.0, unit: "lb" },
    { ingredientKey: "white_wheat", qtyPerBbl: 9.1667, unit: "lb" },
    { ingredientKey: "dextrin", qtyPerBbl: 7.3333, unit: "lb" },
    { ingredientKey: "oats", qtyPerBbl: 8.3333, unit: "lb" },
    { ingredientKey: "mosaic_hot", qtyPerBbl: 0.3667, unit: "lb" },
    { ingredientKey: "citra_hot", qtyPerBbl: 0.7333, unit: "lb" },
    { ingredientKey: "mosaic_cold", qtyPerBbl: 0.9167, unit: "lb" },
    { ingredientKey: "citra_cold", qtyPerBbl: 0.7333, unit: "lb" },
  ],
  Juicy: [
    { ingredientKey: "new_e", qtyPerBbl: 83.3333, unit: "g" },
    { ingredientKey: "2row", qtyPerBbl: 56.8333, unit: "lb" },
    { ingredientKey: "pilsner", qtyPerBbl: 11.0, unit: "lb" },
    { ingredientKey: "white_wheat", qtyPerBbl: 9.1667, unit: "lb" },
    { ingredientKey: "dextrin", qtyPerBbl: 7.3333, unit: "lb" },
    { ingredientKey: "oats", qtyPerBbl: 8.3333, unit: "lb" },
    { ingredientKey: "mosaic_hot", qtyPerBbl: 0.3667, unit: "lb" },
    { ingredientKey: "citra_hot", qtyPerBbl: 0.7333, unit: "lb" },
    { ingredientKey: "mosaic_cold", qtyPerBbl: 0.9167, unit: "lb" },
    { ingredientKey: "citra_cold", qtyPerBbl: 0.7333, unit: "lb" },
  ],
  "Mystic Haze": [
    { ingredientKey: "new_e", qtyPerBbl: 83.3333, unit: "g" },
    { ingredientKey: "2row", qtyPerBbl: 56.8333, unit: "lb" },
    { ingredientKey: "pilsner", qtyPerBbl: 11.0, unit: "lb" },
    { ingredientKey: "white_wheat", qtyPerBbl: 9.1667, unit: "lb" },
    { ingredientKey: "dextrin", qtyPerBbl: 7.3333, unit: "lb" },
    { ingredientKey: "oats", qtyPerBbl: 8.3333, unit: "lb" },
    { ingredientKey: "mosaic_hot", qtyPerBbl: 0.3667, unit: "lb" },
    { ingredientKey: "citra_hot", qtyPerBbl: 0.7333, unit: "lb" },
    { ingredientKey: "mosaic_cold", qtyPerBbl: 0.9167, unit: "lb" },
    { ingredientKey: "citra_cold", qtyPerBbl: 0.7333, unit: "lb" },
  ],
  Nectarine: [
    { ingredientKey: "lacto_bbl", qtyPerBbl: 0.0333, unit: "e" },
    { ingredientKey: "2row", qtyPerBbl: 40.3333, unit: "lb" },
    { ingredientKey: "white_wheat", qtyPerBbl: 18.3333, unit: "lb" },
    { ingredientKey: "dextrin", qtyPerBbl: 7.3333, unit: "lb" },
    { ingredientKey: "melanoidin", qtyPerBbl: 3.6667, unit: "lb" },
    { ingredientKey: "munich_light", qtyPerBbl: 3.6667, unit: "lb" },
    { ingredientKey: "victory", qtyPerBbl: 3.3333, unit: "lb" },
    { ingredientKey: "nectarine_gal", qtyPerBbl: 0.0333, unit: "gal" },
    { ingredientKey: "ay4", qtyPerBbl: 83.3333, unit: "g" },
  ],
  "Mango Bomb": [
    { ingredientKey: "new_e", qtyPerBbl: 83.3333, unit: "g" },
    { ingredientKey: "2row", qtyPerBbl: 56.8333, unit: "lb" },
    { ingredientKey: "pilsner", qtyPerBbl: 11.0, unit: "lb" },
    { ingredientKey: "white_wheat", qtyPerBbl: 9.1667, unit: "lb" },
    { ingredientKey: "dextrin", qtyPerBbl: 7.3333, unit: "lb" },
    { ingredientKey: "oats", qtyPerBbl: 8.3333, unit: "lb" },
    { ingredientKey: "mosaic_hot", qtyPerBbl: 0.3667, unit: "lb" },
    { ingredientKey: "citra_hot", qtyPerBbl: 0.7333, unit: "lb" },
    { ingredientKey: "mosaic_cold", qtyPerBbl: 0.9167, unit: "lb" },
    { ingredientKey: "citra_cold", qtyPerBbl: 0.7333, unit: "lb" },
    { ingredientKey: "mango_gal", qtyPerBbl: 0.0333, unit: "gal" },
  ],
  "Peachy Vibes": [
    { ingredientKey: "ay4", qtyPerBbl: 83.3333, unit: "g" },
    { ingredientKey: "2row", qtyPerBbl: 25.6667, unit: "lb" },
    { ingredientKey: "white_wheat", qtyPerBbl: 31.1667, unit: "lb" },
    { ingredientKey: "dextrin", qtyPerBbl: 7.3333, unit: "lb" },
    { ingredientKey: "melanoidin", qtyPerBbl: 3.6667, unit: "lb" },
    { ingredientKey: "munich_light", qtyPerBbl: 3.6667, unit: "lb" },
    { ingredientKey: "victory", qtyPerBbl: 3.3333, unit: "lb" },
    { ingredientKey: "chinook_hot", qtyPerBbl: 0.1833, unit: "lb" },
    { ingredientKey: "chinook_cold", qtyPerBbl: 0.1833, unit: "lb" },
    { ingredientKey: "peach_lbs", qtyPerBbl: 0.3333, unit: "lb" },
  ],
  "The Hatchet": [
    { ingredientKey: "apple_concentrate", qtyPerBbl: 5.1987, unit: "gal" },
    { ingredientKey: "fermol_charmat", qtyPerBbl: 71.1133, unit: "g" },
    { ingredientKey: "scottzyme_hc", qtyPerBbl: 7.9611, unit: "ml" },
    { ingredientKey: "scottzyme_pec5l", qtyPerBbl: 7.8412, unit: "ml" },
    { ingredientKey: "malic_acid", qtyPerBbl: 0.0479, unit: "g" },
    { ingredientKey: "potassium_sorbate", qtyPerBbl: 0.1051, unit: "lb" },
    { ingredientKey: "potassium_metabisulfite", qtyPerBbl: 0.0, unit: "lb" },
    { ingredientKey: "cane_sugar", qtyPerBbl: 8.3357, unit: "lb" },
    { ingredientKey: "spindasol", qtyPerBbl: 0.125, unit: "g" },
  ],
  "The Pitchfork": [
    { ingredientKey: "apple_concentrate", qtyPerBbl: 5.1987, unit: "gal" },
    { ingredientKey: "fermol_charmat", qtyPerBbl: 71.1133, unit: "g" },
    { ingredientKey: "scottzyme_hc", qtyPerBbl: 7.9611, unit: "ml" },
    { ingredientKey: "scottzyme_pec5l", qtyPerBbl: 7.8412, unit: "ml" },
    { ingredientKey: "malic_acid", qtyPerBbl: 0.0479, unit: "g" },
    { ingredientKey: "potassium_sorbate", qtyPerBbl: 0.1051, unit: "lb" },
    { ingredientKey: "potassium_metabisulfite", qtyPerBbl: 0.0, unit: "lb" },
    { ingredientKey: "cane_sugar", qtyPerBbl: 8.3357, unit: "lb" },
    { ingredientKey: "imitation_vanilla", qtyPerBbl: 0.0333, unit: "gal" },
    { ingredientKey: "pear_wonf", qtyPerBbl: 0.3333, unit: "g" },
    { ingredientKey: "spindasol", qtyPerBbl: 0.125, unit: "g" },
  ],
  Prohibition: [
    { ingredientKey: "2row", qtyPerBbl: 34.8333, unit: "lb" },
    { ingredientKey: "pilsner", qtyPerBbl: 20.1667, unit: "lb" },
    { ingredientKey: "melanoidin_gold", qtyPerBbl: 3.6667, unit: "lb" },
    { ingredientKey: "red_x", qtyPerBbl: 11.0, unit: "lb" },
    { ingredientKey: "carmel_60", qtyPerBbl: 3.3333, unit: "lb" },
    { ingredientKey: "midnight_wheat", qtyPerBbl: 0.6667, unit: "lb" },
    { ingredientKey: "cascade_hot", qtyPerBbl: 0.1833, unit: "lb" },
    { ingredientKey: "chinook_hot", qtyPerBbl: 0.1467, unit: "lb" },
    { ingredientKey: "ay4", qtyPerBbl: 83.3333, unit: "g" },
  ],
};

// Package-format default yields (cases/kegs from one full batch), used to
// show the Overview tab's "ingredient cost per case" for a batch that's a
// different size than the specific brand's own Margin Analysis yield.
export const OVERVIEW_PACKAGE_YIELDS: Record<PriceListPackageKey, number> = {
  "6pk": 344,
  "4pack": 258,
  single: 431,
  sixth: 150,
  half: 50,
};

// The Overview tab's ingredient-cost figures always assume a 30-BBL batch,
// matching the old desktop app exactly (even though individual brands may
// have a different actual batch size set in Margin Analysis) — it's a
// rough per-case reference number, not tied to any one brand's real yield.
export const OVERVIEW_BATCH_BBLS = 30;
