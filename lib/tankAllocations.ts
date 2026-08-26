// Tank Allocations (Build Orders) — converts package-format quantities into
// BBLs so "BBLs Remaining" can be computed as BBLs Available minus what's
// been committed to each format. Standard volumetric math, independent of
// any brand's Margin Analysis batch-yield figures: 1 bbl = 31 gallons =
// 3,968 fl oz.
//
//   single (19.2oz case, 12ct):  12 * 19.2oz  = 230.4oz -> 230.4/3968 bbl
//   4pack  (16oz case, 24ct):    24 * 16oz    = 384oz   -> 384/3968 bbl
//   6pk    (12oz case, 24ct):    24 * 12oz    = 288oz   -> 288/3968 bbl
//   sixth  (1/6 bbl keg):        1/6 bbl
//   half   (1/2 bbl keg):        1/2 bbl

import type { TankAllocation } from "@/lib/types/db";

export type TankQtyField =
  "qty_single" | "qty_4pack" | "qty_6pk" | "qty_sixth" | "qty_half";

export const TANK_PACKAGE_ROWS: {
  field: TankQtyField;
  label: string;
  bblPerUnit: number;
}[] = [
  { field: "qty_single", label: "19oz", bblPerUnit: 230.4 / 3968 },
  { field: "qty_4pack", label: "16oz", bblPerUnit: 384 / 3968 },
  { field: "qty_6pk", label: "12oz", bblPerUnit: 288 / 3968 },
  { field: "qty_half", label: "1/2 bbl", bblPerUnit: 0.5 },
  { field: "qty_sixth", label: "1/6 bbl", bblPerUnit: 1 / 6 },
];

// BBLs already committed across every package format on a tank's row.
export function tankBblsUsed(
  row: Pick<TankAllocation, TankQtyField> | undefined,
): number {
  if (!row) return 0;
  return TANK_PACKAGE_ROWS.reduce(
    (sum, { field, bblPerUnit }) => sum + (row[field] ?? 0) * bblPerUnit,
    0,
  );
}

// BBLs Available minus BBLs committed. Negative means over-committed.
export function tankBblsRemaining(row: TankAllocation | undefined): number {
  const available = row?.bbls_available ?? 0;
  return available - tankBblsUsed(row);
}
