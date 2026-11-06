// VIP Item Codes (Sales → VIP Item Codes, right below UPC's) — added
// 2026-11-06, per Chad: "i want this added into the fcb data app, as a sub
// category of sales, under UPC's, and a download button" → "please add a
// sub category of vip item codes, one for each brand".
//
// The codes are FCB's own item codes, set up in VIP's Item Catalog
// (Supplier Item Code + VIP Item ID). Rows live in the vip_item_codes table
// (sql/vip_item_codes.sql), seeded from Chad's "VIP Item Codes.xlsx".
//
// One page per brand, each its own checkbox in Admin → Users → Edit access
// (like Distributors). The section key is "vip_codes_" + the brand's key.

export const VIP_CODE_BRANDS = [
  { slug: "full-circle", brand: "fcb", name: "Full Circle", section: "vip_codes_fcb" },
  { slug: "speakeasy", brand: "speakeasy", name: "Speakeasy", section: "vip_codes_speakeasy" },
  { slug: "sonoma-cider", brand: "sonoma-cider", name: "Sonoma Cider", section: "vip_codes_sonoma_cider" },
] as const;

export type VipCodeBrandPage = (typeof VIP_CODE_BRANDS)[number];
export type VipCodesSectionKey = VipCodeBrandPage["section"];

export const vipCodesHref = (slug: string) => `/vip-item-codes/${slug}`;

export function vipCodeBrandBySlug(slug: string): VipCodeBrandPage | null {
  return VIP_CODE_BRANDS.find((b) => b.slug === slug) ?? null;
}

export interface VipItemCode {
  id: string;
  brand: string;
  item: string;
  supplier_item_code: string;
  vip_item_id: string;
  sort_order: number;
}
