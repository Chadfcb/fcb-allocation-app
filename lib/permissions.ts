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
  | "upcs"
  | "audit_log"
  | "price_list"
  | "margin_analysis"
  | "cost_per_case"
  | "contribution_margin"
  | "events_calendar"
  | "pos_labels"
  | "tasks"
  | "chain_authorizations"
  | "chain_mandates"
  | "football_pos";

// Ernie AI is deliberately its own grantable section, separate from every
// page section above — an admin may want someone to have, say, Purchase
// Orders access without Ernie, or vice versa.
export const ERNIE_SECTION = "ernie_ai" as const;
export type ErnieSectionKey = typeof ERNIE_SECTION;

export type AnySectionKey = SectionKey | ErnieSectionKey;

export interface SectionInfo {
  key: SectionKey;
  label: string;
}

// Users > Edit toggle categories (Ernie AI is a fifth toggle handled
// separately below — it doesn't belong to any group of pages).
//
// SINGLE SOURCE OF TRUTH: this is the only place that decides which
// individual pages live under which Users > Edit toggle — GROUP_KEYS,
// GROUP_LABEL, GROUP_SECTIONS, ALL_SECTION_KEYS, and SECTION_LABEL below
// are all derived from this one array, on purpose, after an earlier
// version kept a separate parallel list for the toggles and it drifted
// out of sync with this one (that's the "Other" mix-up Chad caught —
// Events Calendar and POS Labels had been lumped into one category here
// that didn't match the real app sections).
//
// Per Chad: "it also needs to add new sections to it when we add new
// sections, because i have many more sections for us to eventually add."
// Going forward: to add a brand-new PAGE to an EXISTING category — say
// another Operations report — add one SectionKey to that group's `items`
// below (plus the SectionKey union above, its RLS policy in sql/, and its
// Sidebar link); its Users > Edit toggle automatically covers it, no
// other list in this file needs to change. To add a whole NEW
// category/toggle, add a new literal to the GroupKey union just below
// AND a new `{ key, label, items }` entry here — those are the only two
// edits a new top-level category needs.
//
// Order here is also the display order in the Users > Edit checklist.
export type GroupKey = "operations" | "sales" | "events_calendar" | "pos_labels" | "tasks" | "audit_log";

export const SECTION_GROUPS: { key: GroupKey; label: string; items: SectionInfo[] }[] = [
  {
    key: "operations",
    label: "Operations",
    items: [
      { key: "purchase_orders", label: "Purchase Orders" },
      { key: "inventory_allocation", label: "Inventory & Allocation" },
      { key: "distributor_inventory", label: "Distributor Inventory" },
      { key: "build_orders", label: "Build Orders" },
      { key: "distributor_pricing", label: "Distributor Pricing" },
      { key: "weeks", label: "Weeks" },
      // Moved here from the "POS" category, just below Weeks — per Chad,
      // 2026-09-05: "Labels needs to be a sub category of Operations...
      // remove it from POS." The underlying SectionKey value is still
      // "pos_labels" (unchanged in the database/RLS/Sidebar), only which
      // top-level Users > Edit toggle grants it has changed — checking
      // Operations now also grants this page.
      { key: "pos_labels", label: "Labels" },
      // Added 2026-09-05, just above where Audit Log used to sit — per
      // Chad, right before he asked to move Audit Log out of Operations
      // entirely (see the new "audit_log" group below).
      { key: "upcs", label: "UPC's" },
    ],
  },
  {
    key: "sales",
    label: "Sales",
    items: [
      { key: "price_list", label: "Price List" },
      { key: "margin_analysis", label: "Margin Analysis" },
      { key: "cost_per_case", label: "Cost Per Case" },
      { key: "contribution_margin", label: "Contribution Margin" },
      // Added 2026-09-05, per Chad — imported from a chain
      // authorizations/mandates spreadsheet. Per Chad: "only the main
      // category is gated for access... if someone is given access to
      // Sales, they have access to all sub categories" — these are NOT
      // their own Users > Edit toggle, they just ride along with Sales,
      // same as every other item in this group.
      { key: "chain_authorizations", label: "Chain Authorizations" },
      { key: "chain_mandates", label: "Chain Mandates" },
    ],
  },
  {
    key: "events_calendar",
    // Category label shown in Users > Edit access — changed 2026-09-05
    // per Chad: "change the category from Events Calendar to Calendar in
    // the users section." Note the underlying key/SectionKey value stays
    // "events_calendar" (renaming that would mean a data migration across
    // user_section_access) — only the displayed label changed, and now
    // covers Events Calendar, Chain Calendar, and Social Media Calendar
    // together anyway, so "Calendar" reads better than the old
    // Events-Calendar-specific name.
    label: "Calendar",
    items: [{ key: "events_calendar", label: "Calendar" }],
  },
  {
    key: "pos_labels",
    // Was left empty per Chad, 2026-09-05: "remove it from POS and leave
    // POS empty for now" — Labels had moved to Operations. Now has its
    // first real item: Football POS (2026-09-05), a flat file library of
    // football-season point-of-sale art (posters, table tents, stickers,
    // distributor strips), set up just like POS > Labels' file cards
    // (preview + download) but with no brand/size nesting — it's one
    // shared pool, not per-brand artwork.
    label: "POS",
    items: [{ key: "football_pos", label: "Football POS" }],
  },
  {
    key: "tasks",
    label: "Tasks",
    items: [{ key: "tasks", label: "Tasks" }],
  },
  {
    key: "audit_log",
    // Moved out of Operations into its own top-level category — per Chad,
    // 2026-09-05: "lets move audit log to a main category, below Users,
    // and out of operations." The underlying SectionKey value is
    // unchanged ("audit_log"), so existing grants and RLS keep working —
    // only which Users > Edit toggle it lives under (and where it shows
    // up in the Sidebar) changed.
    label: "Audit Log",
    items: [{ key: "audit_log", label: "Audit Log" }],
  },
];

export const GROUP_KEYS: GroupKey[] = SECTION_GROUPS.map((g) => g.key);

export const GROUP_LABEL: Record<GroupKey, string> = Object.fromEntries(
  SECTION_GROUPS.map((g) => [g.key, g.label]),
) as Record<GroupKey, string>;

export const GROUP_SECTIONS: Record<GroupKey, SectionKey[]> = Object.fromEntries(
  SECTION_GROUPS.map((g) => [g.key, g.items.map((i) => i.key)]),
) as Record<GroupKey, SectionKey[]>;

export const ALL_SECTION_KEYS: SectionKey[] = SECTION_GROUPS.flatMap((g) =>
  g.items.map((i) => i.key),
);

export const SECTION_LABEL: Record<SectionKey, string> = Object.fromEntries(
  SECTION_GROUPS.flatMap((g) => g.items.map((i) => [i.key, i.label] as const)),
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

// Users > Edit only offers whole-category toggles (see SECTION_GROUPS
// above) plus Ernie AI — checking a category grants every page underneath
// it in one shot, per Chad: "if a user is given access to a main section,
// they auto get the sub section... we don't need to also give permissions
// for sub sections." The individual SectionKey values above are unchanged
// underneath (RLS, the Sidebar, and Ernie's tool gating all still key off
// them exactly as before) — this is purely a Users-page UX simplification:
// checking "Operations" writes all 7 of its underlying section_key rows at
// once instead of asking an admin to check each page individually.
//
// True if every page under this category is granted — the checkbox state
// for a category toggle. Admins always read as true (hasSection already
// short-circuits per-page, so this stays consistent with that).
export function hasGroup(
  role: Role | undefined,
  sections: AnySectionKey[] | undefined,
  group: GroupKey,
): boolean {
  if (role === "admin") return true;
  return GROUP_SECTIONS[group].every((k) => sections?.includes(k));
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
