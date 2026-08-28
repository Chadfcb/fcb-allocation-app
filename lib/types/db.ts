export type Role = "admin" | "basic";

export interface Profile {
  id: string;
  email: string;
  full_name: string | null;
  role: Role;
  // True until this person has been through the account-setup flow (set
  // their own password + name) — forces a redirect to /account-setup on
  // every page in the (app) group until they complete it. Defaults true for
  // new profiles; existing users who'd already signed in before this
  // feature shipped were retroactively set to false so they aren't forced
  // through it.
  must_change_password: boolean;
  created_at: string;
}

export interface Distributor {
  id: string;
  name: string;
  color: string | null;
  active: boolean;
  // Lets admins reorder/add/remove distributor columns on Inventory &
  // Allocation, same as products. Null (the original seeded distributors)
  // sorts after any explicitly ordered ones, then falls back to name.
  sort_order: number | null;
  // False for a distributor row that isn't a separate physical location
  // (e.g. "Matagrano 2" — a second order against the same distributor).
  // Excluded from the Distributor Inventory page and its Ekos sync only;
  // still fully active everywhere else.
  track_inventory: boolean;
  // Column order on the Distributor Inventory page only — independent of
  // `sort_order`, which drives every other page's distributor columns.
  inventory_sort_order: number | null;
}

export interface Product {
  id: string;
  name: string;
  sku: string | null;
  avg_price: number | null;
  active: boolean;
  sort_order: number | null;
}

// A labeled break row in the Inventory & Allocation grid (e.g. "Sonoma
// Cider") that groups products by brand, matching the original spreadsheet.
// Shares the same sort_order numbering space as products.
export interface SectionDivider {
  id: string;
  label: string;
  sort_order: number;
}

export type WeekStatus = "draft" | "open" | "closed";

export interface Week {
  id: string;
  label: string;
  week_start: string;
  previous_week_id: string | null;
  status: WeekStatus;
  created_by: string | null;
  created_at: string;
}

export type StatusFlag =
  | "good_confirmed"
  | "dont_have"
  | "have_some"
  | "need_to_package"
  | "need_pakteks"
  | "need_labels"
  | "need_cans"
  | "need_kegs"
  | null;

export interface InventoryWithRemaining {
  id: string;
  week_id: string;
  product_id: string;
  on_hand: number;
  unlabeled: number;
  to_be_packaged: number;
  total: number;
  remaining: number;
  status_flag: StatusFlag;
  updated_by: string | null;
  updated_at: string;
}

export type InventorySource = "vip" | "ekos" | "distributor";

export interface DistributorInventory {
  id: string;
  week_id: string;
  distributor_id: string;
  product_id: string;
  on_hand_qty: number;
  rate_of_sale: number;
  source: InventorySource;
  imported_at: string | null;
  updated_by: string | null;
  updated_at: string;
}

export interface Allocation {
  id: string;
  week_id: string;
  distributor_id: string;
  product_id: string;
  quantity: number;
  status_flag: StatusFlag;
  updated_by: string | null;
  updated_at: string;
}

export type PoStatus = "approved" | "pending" | "delivered" | null;

// One PO number per distributor per week — used to find the order in Ekos.
export interface DistributorPO {
  id: string;
  week_id: string;
  distributor_id: string;
  po_number: string | null;
  // Whether the distributor has approved this PO. Blank until set; admin-only
  // to change (enforced in the database, not just the UI).
  po_status: PoStatus;
  updated_by: string | null;
  updated_at: string;
}

export const PO_STATUS_LABELS: Record<NonNullable<PoStatus>, string> = {
  approved: "Approved",
  pending: "Pending",
  delivered: "Delivered",
};

export const PO_STATUS_COLORS: Record<NonNullable<PoStatus>, string> = {
  approved: "#00ff00",
  pending: "#ff9900",
  delivered: "#3399ff",
};

// Each distributor's own actual price per product (not an average — every
// distributor can be charged differently for the same item). Not tied to a
// week; it's standing catalog pricing, edited on the Distributor Pricing
// page and used to compute Order Value totals on the Inventory &
// Allocation page.
export interface DistributorPrice {
  id: string;
  distributor_id: string;
  product_id: string;
  price: number;
  updated_by: string | null;
  updated_at: string;
}

// Operations > Build Orders. Par Level is a standing target per
// distributor/product, same lifecycle as DistributorPrice (not tied to a
// week).
export interface DistributorParLevel {
  id: string;
  distributor_id: string;
  product_id: string;
  par_level: number;
  updated_by: string | null;
  updated_at: string;
}

// Recommended Order for a given week — defaults to (par level - on hand),
// floored at 0, until someone edits the cell or pushes it to Inventory &
// Allocation, at which point a row exists here with the effective value.
export interface BuildOrderRecommendation {
  id: string;
  week_id: string;
  distributor_id: string;
  product_id: string;
  recommended_qty: number;
  updated_by: string | null;
  updated_at: string;
}

// =========================================================
// Sales > Price List — brand-level price-to-retailer/distributor by
// package format (6-pack, 4-pack, single, 1/6 bbl keg, 1/2 bbl keg). This is
// the first piece of the old FCB Pricing desktop app being folded into the
// Sales section here; Margin Analysis, Cost Per Case, and Contribution
// Margin will build on top of the same brand list later.
//
// NOTE: distinct from DistributorPrice above (which drives Order Value
// totals on Inventory & Allocation) — these two things happened to share
// the name "Distributor Pricing" in the old desktop app, so this one is
// called "Price List" here to keep them apart.
// =========================================================
export type PriceListPackageKey = "6pk" | "4pack" | "single" | "sixth" | "half";

export const PRICE_LIST_PACKAGE_KEYS: PriceListPackageKey[] = [
  "6pk",
  "4pack",
  "single",
  "sixth",
  "half",
];

export const PRICE_LIST_PACKAGE_LABELS: Record<PriceListPackageKey, string> = {
  "6pk": "6pk 12oz",
  "4pack": "4pk 16oz",
  single: "Single 19.2oz",
  sixth: "1/6 bbl",
  half: "1/2 bbl",
};

export interface PricingBrand {
  id: string;
  name: string;
  sort_order: number | null;
  active: boolean;
  // Which parent company a brand rolls up under — only used by
  // Contribution Margin's company-grouped table below. Null for brands
  // outside that feature's scope (e.g. Mango Bomb, which never had
  // Contribution Margin figures in the old desktop app).
  company: string | null;
  created_at: string;
}

export interface BrandPriceListRow {
  id: string;
  brand_id: string;
  package_key: PriceListPackageKey;
  price: number;
  updated_by: string | null;
  updated_at: string;
}

// =========================================================
// Operations > Build Orders > Tank Allocations — standing (not week-scoped)
// per-brand block: which fermentation vessel it's in, BBLs available, and
// how those BBLs are committed across package formats. BBLs Remaining is
// computed client-side, not stored — see lib/tankAllocations.ts.
// =========================================================
export interface TankAllocation {
  id: string;
  brand_id: string;
  fv_number: string | null;
  bbls_available: number;
  qty_single: number;
  qty_4pack: number;
  qty_6pk: number;
  qty_sixth: number;
  qty_half: number;
  updated_by: string | null;
  updated_at: string;
}

// =========================================================
// Sales > Margin Analysis — per-brand batch cost + per-package-format
// pricing (PTR/PTD), used to work out gross profit and full batch
// economics (revenue, cost, profit, margin). Second piece of folding the
// old FCB Pricing desktop app in, building on the same pricing_brands list
// as Price List above.
// =========================================================
export interface MarginAnalysis {
  id: string;
  brand_id: string;
  batch_cost: number;
  yield_bbls: number;
  updated_by: string | null;
  updated_at: string;
  created_at: string;
}

export interface MarginAnalysisPackage {
  id: string;
  analysis_id: string;
  package_key: PriceListPackageKey;
  enabled: boolean;
  ptr: number | null;
  ptd: number | null;
  // null means "use the standard default for this package format" — see
  // PKG_META in lib/marginAnalysis.ts.
  pack_cost: number | null;
  labor: number | null;
  yield_amt: number | null;
  updated_by: string | null;
  updated_at: string;
}

// =========================================================
// Sales > Cost Per Case — third piece of folding the old FCB Pricing
// desktop app in. These are the underlying prices Margin Analysis falls
// back to when a brand doesn't set its own packaging-cost/labor override
// (see lib/costPerCase.ts for the fixed recipe/composition data these
// prices get multiplied through).
// =========================================================
export interface PackagingComponentRow {
  component_key: string;
  label: string;
  category: string;
  price: number;
  updated_by: string | null;
  updated_at: string;
}

export interface IngredientCostRow {
  id: string;
  category_key: string;
  ingredient_key: string;
  name: string;
  unit: string;
  price: number;
  updated_by: string | null;
  updated_at: string;
}

export interface PackageLaborCostRow {
  package_key: PriceListPackageKey;
  labor: number;
  updated_by: string | null;
  updated_at: string;
}

// =========================================================
// Sales > Contribution Margin — fourth and final piece of folding the old
// FCB Pricing desktop app in. revenue_per_ce is the only figure here that's
// user-editable; everything else that goes into the Contribution Margin
// table is computed live from the Cost Per Case / Margin Analysis tables
// above (see lib/contributionMargin.ts).
// =========================================================
export interface ContributionMarginLineRow {
  id: string;
  brand_id: string;
  package_key: PriceListPackageKey;
  revenue_per_ce: number;
  updated_by: string | null;
  updated_at: string;
}

export interface AuditLogEntry {
  id: string;
  week_id: string | null;
  table_name: string;
  record_id: string;
  field_name: string;
  old_value: string | null;
  new_value: string | null;
  changed_by: string | null;
  changed_at: string;
  reverted: boolean;
  reverted_at: string | null;
  reverted_by: string | null;
}

export const STATUS_FLAG_LABELS: Record<NonNullable<StatusFlag>, string> = {
  good_confirmed: "On Hand",
  dont_have: "Don't Have",
  have_some: "Have Some",
  need_to_package: "Need to Package",
  need_pakteks: "Need Pakteks",
  need_labels: "Need Labels",
  need_cans: "Need Cans",
  need_kegs: "Need Kegs",
};

export const STATUS_FLAG_COLORS: Record<NonNullable<StatusFlag>, string> = {
  good_confirmed: "#00ff00",
  dont_have: "#f85149",
  have_some: "#ff9900",
  need_to_package: "#ff00ff",
  need_pakteks: "#4a86e8",
  need_labels: "#00ffff",
  need_cans: "#cccccc",
  need_kegs: "#ffff00",
};

// =========================================================
// Packaging & label inventory — manual on-hand counts that get depleted
// automatically as allocations are entered on the Inventory & Allocation
// page (see lib/packaging.ts for the consumption recipes).
// =========================================================
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

export interface PackagingInventoryRow {
  id: string;
  week_id: string;
  item_key: PackagingItemKey;
  on_hand_qty: number;
  updated_by: string | null;
  updated_at: string;
}

// Labels are unique per product (each beer's label is different artwork),
// unlike cans/trays/pakteks/lids which are shared across any product of the
// same size — so this is tracked one row per product, not per size bucket.
export interface LabelInventoryRow {
  id: string;
  week_id: string;
  product_id: string;
  on_hand_qty: number;
  updated_by: string | null;
  updated_at: string;
}

// =========================================================
// Custom Packaging/Label Inventory items — freeform items an admin can
// add/rename/reorder/remove from the "Edit Packaging Inventory Item" /
// "Edit Label Item" menu on Inventory & Allocation, separate from the
// fixed, code-driven PACKAGING_ITEMS list above (which has automatic
// consumption math tied to it via lib/packaging.ts). These are simple
// manually-tracked counts — no automation.
// =========================================================
export interface CustomPackagingItem {
  id: string;
  name: string;
  sort_order: number | null;
  active: boolean;
  created_at: string;
}

export interface CustomPackagingInventoryRow {
  id: string;
  week_id: string;
  item_id: string;
  on_hand_qty: number;
  updated_by: string | null;
  updated_at: string;
}

export interface CustomLabelItem {
  id: string;
  name: string;
  sort_order: number | null;
  active: boolean;
  created_at: string;
}

export interface CustomLabelInventoryRow {
  id: string;
  week_id: string;
  item_id: string;
  on_hand_qty: number;
  updated_by: string | null;
  updated_at: string;
}

// =========================================================
// Operations > Purchase Orders — vendor POs (buying ingredients/supplies
// from suppliers, e.g. MoreBeer, Briess Malt) synced in from Ekos. Not the
// same thing as distributor_pos above (which tracks a distributor's PO
// *to* FCB for finished beer) — these are FCB's own outgoing orders to its
// vendors. Admin-only, full stop, matching Sales.
//
// There's no live Ekos API, so this data arrives via an on-demand sync:
// Chad drives a live Claude-in-Chrome session against his own logged-in
// Ekos tab, and the current "Open - Purchase Orders" list (header info,
// comments, and each PO's line items) gets posted to
// /api/purchase-orders/sync, which replaces the table's contents with
// whatever's currently open in Ekos.
// =========================================================
// FCB's own tracking of whether a vendor PO has been paid — distinct from
// `status` above (Ekos's own field, which is always "Open" since we only
// ever sync the open list), and independent from PoOrderedStatus below (a
// PO can be ordered but not yet paid, for instance). Always one of these
// 2; no blank state, defaults to "pending" for every PO (including ones
// synced in before this field existed).
export type PoPaymentStatus = "pending" | "paid";

export const PO_PAYMENT_STATUS_LABELS: Record<PoPaymentStatus, string> = {
  pending: "Pending",
  paid: "Paid",
};

export const PO_PAYMENT_STATUS_COLORS: Record<PoPaymentStatus, string> = {
  pending: "#ff9900",
  paid: "#00ff00",
};

// FCB's own tracking of whether we've actually placed the order with the
// vendor yet — tracked separately from payment above (its own dropdown,
// its own column). Always one of these 2; no blank state, defaults to
// "not_ordered".
export type PoOrderedStatus = "ordered" | "not_ordered";

export const PO_ORDERED_STATUS_LABELS: Record<PoOrderedStatus, string> = {
  ordered: "Ordered",
  not_ordered: "Not Ordered",
};

export const PO_ORDERED_STATUS_COLORS: Record<PoOrderedStatus, string> = {
  ordered: "#3399ff",
  not_ordered: "#525252",
};

export interface PurchaseOrder {
  id: string;
  ekos_po_number: string;
  supplier: string;
  po_date: string | null;
  expected_delivery_date: string | null;
  total_cost: number | null;
  status: string | null;
  // Our own "have we paid this" tracker — see PoPaymentStatus above.
  payment_status: PoPaymentStatus;
  // Our own "have we ordered this" tracker — see PoOrderedStatus above.
  ordered_status: PoOrderedStatus;
  // The freeform note Chad (or whoever) typed onto the PO in Ekos itself —
  // this is the whole reason this feature exists, so it needs to travel
  // along with everything else and surface on both the Purchase Orders page
  // and the Dashboard card.
  comments: string | null;
  // Ekos's own "Last Modified By" field (a person's name as Ekos records
  // it) — distinct from synced_by below, which is which of our own admins
  // ran the sync.
  ekos_last_modified_by: string | null;
  synced_by: string | null;
  synced_at: string;
  created_at: string;
}

export interface PurchaseOrderItem {
  id: string;
  purchase_order_id: string;
  item_name: string;
  quantity: number | null;
  unit_cost: number | null;
  line_total: number | null;
  sort_order: number;
}

export type EventType =
  "festival" | "tasting" | "donation" | "work-with" | "other";

// Named CalendarEvent (not Event) to avoid colliding with the DOM's global
// Event type.
export interface CalendarEvent {
  id: string;
  title: string;
  start_date: string;
  end_date: string | null;
  time_label: string | null;
  type: EventType;
  location: string | null;
  distributor_id: string | null;
  rep: string | null;
  notes: string | null;
  created_by: string | null;
  updated_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface EventMaterial {
  id: string;
  event_id: string;
  file_name: string;
  storage_path: string;
  mime_type: string | null;
  size_bytes: number | null;
  uploaded_by: string | null;
  uploaded_at: string;
}

export interface PosLibraryFile {
  id: string;
  file_name: string;
  storage_path: string;
  mime_type: string | null;
  size_bytes: number | null;
  uploaded_by: string | null;
  uploaded_at: string;
}
