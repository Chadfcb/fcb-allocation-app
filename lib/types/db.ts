export type Role = "admin" | "basic";

export interface Profile {
  id: string;
  email: string;
  full_name: string | null;
  role: Role;
  created_at: string;
}

export interface Distributor {
  id: string;
  name: string;
  color: string | null;
  active: boolean;
}

export interface Product {
  id: string;
  name: string;
  sku: string | null;
  avg_price: number | null;
  active: boolean;
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
  | "dont_have"
  | "have_some"
  | "need_to_package"
  | "need_pakteks"
  | "need_labels"
  | "need_cans"
  | "old_product"
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

// One PO number per distributor per week — used to find the order in Ekos.
export interface DistributorPO {
  id: string;
  week_id: string;
  distributor_id: string;
  po_number: string | null;
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
  dont_have: "Don't Have",
  have_some: "Have Some",
  need_to_package: "Need to Package",
  need_pakteks: "Need Pakteks",
  need_labels: "Need Labels",
  need_cans: "Need Cans",
  old_product: "Old Product",
};

export const STATUS_FLAG_COLORS: Record<NonNullable<StatusFlag>, string> = {
  dont_have: "#f85149",
  have_some: "#ff9900",
  need_to_package: "#ff00ff",
  need_pakteks: "#4a86e8",
  need_labels: "#00ffff",
  need_cans: "#cccccc",
  old_product: "#ffff00",
};
