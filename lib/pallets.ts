// Pallet math for the "Full Circle Brewing" divider row's per-distributor
// pallet totals on Inventory & Allocation — how many physical pallets a
// distributor's whole order (every product, every brand) works out to.
//
// Kegs and cans are physically different pallet types — can cases don't
// sit on a keg pallet — so each is rounded up to a whole pallet separately,
// then added together. Tap handles and any product whose name doesn't
// clearly state a can/keg size aren't counted at all, same as they're
// already left out of packaging/label consumption elsewhere on this page.
//
// Keg math: a 1/2 bbl keg takes up 1/8 of a pallet, a 1/6 bbl (sixtel)
// takes up 1/20 of a pallet — the two sizes mix freely on one pallet, so
// their fractions just add together before rounding up.
//
// Can math: cans stack 7 layers high per pallet. A layer is 10 cases,
// except 19.2oz cans, which stack 20 cases per layer. Any can size/brand
// can mix on the same pallet — what matters is total layers used.
import type { Product } from "@/lib/types/db";
import { derivePackaging } from "@/lib/packaging";

const HALF_BBL_PER_PALLET = 8;
const SIXTEL_PER_PALLET = 20;
const CAN_LAYERS_PER_PALLET = 7;
const CASES_PER_LAYER_19_2OZ = 20;
const CASES_PER_LAYER_STANDARD = 10;

export function computePalletsForDistributor(
  products: Product[],
  quantityFor: (productId: string) => number
): number {
  let halfBbl = 0;
  let sixtel = 0;
  let canLayers = 0;

  for (const p of products) {
    const qty = quantityFor(p.id);
    if (!qty) continue;

    const info = derivePackaging(p.name);

    if (info.kind === "keg") {
      if (info.size === "1_2bbl") halfBbl += qty;
      else if (info.size === "1_6bbl") sixtel += qty;
      continue;
    }

    if (info.kind === "can") {
      const casesPerLayer =
        info.size === "19_2oz" ? CASES_PER_LAYER_19_2OZ : CASES_PER_LAYER_STANDARD;
      canLayers += qty / casesPerLayer;
    }

    // tap_handle / unrecognized: not counted.
  }

  const kegPallets = Math.ceil(halfBbl / HALF_BBL_PER_PALLET + sixtel / SIXTEL_PER_PALLET);
  const canPallets = Math.ceil(canLayers / CAN_LAYERS_PER_PALLET);

  return kegPallets + canPallets;
}
