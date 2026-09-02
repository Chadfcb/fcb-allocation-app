import type { SupabaseClient } from "@supabase/supabase-js";
import type { Role } from "@/lib/types/db";

// Single source of truth for the per-user, per-section access system that
// replaces the old binary admin/basic split for anything that used to be
// "admin-only, full stop." Keep this list in sync with
// sql/user_section_access.sql's comment block — the section_key values here
// are exactly the strings stored in that table.
//
// Checking a section grants routine, everyday use of that page. It does
// NOT hand over the handful of structural/destructive actions that already
// sit apart from "can you see this page" today (adding/deleting
// distributors, products, dividers, or custom packaging/label items;
// starting or closing a week; undoing an audit log entry) — those stay
// hard admin-only regardless of any section grant, unchanged from how the
// app already works.
export type SectionKey =
  | "purchase_orders"
  | "inventory_allocation"
  | "distributor_inventory"
  | "build_orders"
  | "distributor_pricing"
  | "weeks"
  | "audit_log"
  | "price_list"
  | "margin_analysis"
  | "cost_per_case"
  | "contribution_margin"
  | "events_calendar"
  | "pos_labels";

// Ernie AI is deliberately its own grantable section, separate from every
// page section above — an admin may want someone to have, say, Purchase
// Orders access without Ernie, or vice versa.
export const ERNIE_SECTION = "ernie_ai" as const;
export type ErnieSectionKey = typeof ERNIE_SECTION;

export type AnySectionKey = SectionKey | ErnieSectionKey;

export interface SectionInfo {
  key: SectionKey;
  label: string;
  group: "Operations" | "Sales" | "Other";
}

// Order here is also the display order in the Users > Edit checklist.
export const SECTION_GROUPS: { label: "Operations" | "Sales" | "Other"; items: SectionInfo[] }[] = [
  {
    label: "Operations",
    items: [
      { key: "purchase_orders", label: "Purchase Orders", group: "Operations" },
      { key: "inventory_allocation", label: "Inventory & Allocation", group: "Operations" },
      { key: "distributor_inventory", label: "Distributor Inventory", group: "Operations" },
      { key: "build_orders", label: "Build Orders", group: "Operations" },
      { key: "distributor_pricing", label: "Distributor Pricing", group: "Operations" },
      { key: "weeks", label: "Weeks", group: "Operations" },
      { key: "audit_log", label: "Audit Log", group: "Operations" },
    ],
  },
  {
    label: "Sales",
    items: [
      { key: "price_list", label: "Price List", group: "Sales" },
      { key: "margin_analysis", label: "Margin Analysis", group: "Sales" },
      { key: "cost_per_case", label: "Cost Per Case", group: "Sales" },
      { key: "contribution_margin", label: "Contribution Margin", group: "Sales" },
    ],
  },
  {
    label: "Other",
    items: [
      { key: "events_calendar", label: "Events Calendar", group: "Other" },
      { key: "pos_labels", label: "POS Labels", group: "Other" },
    ],
  },
];

export const ALL_SECTION_KEYS: SectionKey[] = SECTION_GROUPS.flatMap((g) =>
  g.items.map((i) => i.key),
);

export const SECTION_LABEL: Record<SectionKey, string> = Object.fromEntries(
  ALL_SECTION_KEYS.map((k) => [k, SECTION_GROUPS.flatMap((g) => g.items).find((i) => i.key === k)!.label]),
) as Record<SectionKey, string>;

// True if this person can use the given section — admins always can;
// a Basic user needs the matching row in user_section_access.
export function hasSection(
  role: Role | undefined,
  sections: AnySectionKey[] | undefined,
  key: AnySectionKey,
): boolean {
  if (role === "admin") return true;
  return !!sections?.includes(key);
}

// True if this person can use ANY of the given sections — for the handful
// of pages/tools backed by data shared across more than one section.
export function hasAnySection(
  role: Role | undefined,
  sections: AnySectionKey[] | undefined,
  keys: AnySectionKey[],
): boolean {
  if (role === "admin") return true;
  return keys.some((k) => sections?.includes(k));
}

// Fetches one user's granted section keys (Ernie included, since it's a row
// in the same table). Returns [] for an admin — admins don't need rows,
// hasSection()/hasAnySection() already short-circuit true for them.
export async function getUserSections(
  supabase: SupabaseClient,
  userId: string,
): Promise<AnySectionKey[]> {
  const { data } = await supabase
    .from("user_section_access")
    .select("section_key")
    .eq("user_id", userId);

  return (data ?? []).map((row) => row.section_key as AnySectionKey);
}
