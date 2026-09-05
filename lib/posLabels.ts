// Shared constants for POS > Labels — the label-artwork file library, now
// split into 15 brand/size combinations (5 brands x 3 sizes, since Oobli
// and Ugly Fresca were added 2026-09-05). File-display helpers (icons,
// image detection, byte formatting, safe storage names) are generic and
// already live in lib/events.ts; reused from there rather than duplicated
// here.

import type { PosLabelBrand, PosLabelSize } from "@/lib/types/db";

export const POS_LABEL_FILES_BUCKET = "pos-label-files";

export const POS_LABEL_BRAND_OPTIONS: {
  value: PosLabelBrand;
  label: string;
}[] = [
  { value: "fcb", label: "FCB" },
  { value: "speakeasy", label: "Speakeasy" },
  { value: "sonoma-cider", label: "Sonoma Cider" },
  { value: "oobli", label: "Oobli" },
  { value: "ugly-fresca", label: "Ugly Fresca" },
];

export const POS_LABEL_BRAND_LABELS: Record<PosLabelBrand, string> = {
  fcb: "FCB",
  speakeasy: "Speakeasy",
  "sonoma-cider": "Sonoma Cider",
  oobli: "Oobli",
  "ugly-fresca": "Ugly Fresca",
};

export const POS_LABEL_SIZE_OPTIONS: { value: PosLabelSize; label: string }[] =
  [
    { value: "19.2oz", label: "19.2 oz Labels" },
    { value: "16oz", label: "16 oz Labels" },
    { value: "12oz", label: "12 oz Labels" },
  ];

export const POS_LABEL_SIZE_LABELS: Record<PosLabelSize, string> = {
  "19.2oz": "19.2 oz Labels",
  "16oz": "16 oz Labels",
  "12oz": "12 oz Labels",
};
