// POS > Sales Sheets (added 2026-11-10, per Chad: "add another sub category to
// POS, called Sales sheets, clicking on it will open the page that has FCB,
// Speakeasy, and Sonoma Cider. Inside those will look and operate just like
// the football POS section, with previews and download links").
// One file library per brand, same cards / preview / download as Football POS.

export const POS_SALES_SHEETS_BUCKET = "pos-sales-sheet-files";

export const SALES_SHEET_BRANDS = [
  { key: "fcb", label: "FCB" },
  { key: "speakeasy", label: "Speakeasy" },
  { key: "sonoma-cider", label: "Sonoma Cider" },
] as const;

export type SalesSheetBrand = (typeof SALES_SHEET_BRANDS)[number]["key"];
