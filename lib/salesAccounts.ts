// Sales > Accounts (added 2026-10-07) — shared rules for the Accounts page.
// Project docs: claude/sales-system-build-plan.md (Feature 1),
// claude/sales-reps-territories.md, claude/accounts-preview.md.
//
// Stages are worked out from each account's summary columns (filled by
// sales_accounts_refresh() after an import) and the data's "as of" date —
// the last buy date in the imported data, not today — so an old import
// never makes every account look lost.

export type AccountStage = "active" | "new" | "plost" | "lost" | "prospect" | "lead" | "former";

export interface SalesAccountRow {
  outlet_id: string;
  name: string;
  address: string | null;
  city: string | null;
  zip: string | null;
  phone: string | null;
  distributor: string | null;
  premise: string | null;
  best_day: string | null;
  last_buy_date: string | null;
  lifetime_ce: number;
  ce_12mo: number;
  buy_months_6: number;
  contact_count: number;
  report_buy_date: string | null;
  report_note: string | null;
}

export interface SalesAccountSaleRow {
  month: string;
  product: string;
  package: string | null;
  distributor: string | null;
  ce: number;
  last_buy_date: string | null;
}

export interface SalesAccountContactRow {
  id: string;
  name: string | null;
  title: string | null;
  phone: string | null;
  mobile: string | null;
  email: string | null;
  notes: string | null;
  source: string | null;
}

// Territory = distributor (Chad, 2026-10-07).
export const REP_BY_DISTRIBUTOR: Record<string, string> = {
  Matagrano: "Steve",
  Guardian: "Eric",
  "Valley Wide": "Ryan",
  Mussetter: "Lance",
  Saccani: "Lance",
  Markstein: "James",
};

// Current distributors. Coast and Superior have no FCB rep. Anything else
// is a former distributor (Geyser, Eagle, Donaghy, Chrissa, Classic,
// SF Naturals, Breakthru, Beauchamp, …).
export const CURRENT_DISTRIBUTORS = [
  "Matagrano",
  "Guardian",
  "Valley Wide",
  "Mussetter",
  "Saccani",
  "Markstein",
  "Coast",
  "Superior",
];
export const NO_REP_DISTRIBUTORS = ["Coast", "Superior"];

export const REPS: { rep: string; territory: string }[] = [
  { rep: "Steve", territory: "Matagrano" },
  { rep: "Eric", territory: "Guardian" },
  { rep: "Ryan", territory: "Valley Wide" },
  { rep: "Lance", territory: "Mussetter + Saccani" },
  { rep: "James", territory: "Markstein (CMC)" },
];
export const NO_REP_KEY = "__none";

export const BIG_LOST_CE = 50;

export const STAGE_INFO: Record<AccountStage, { label: string; color: string; rule: string }> = {
  active: { label: "Active", color: "#6abc46", rule: "Bought in the last 60 days, and in 3+ of the last 6 months" },
  new: { label: "New", color: "#5aa9f0", rule: "Bought in the last 60 days, in 1–2 of the last 6 months" },
  plost: { label: "Potential lost", color: "#f0a63c", rule: "61–90 days since the last buy" },
  lost: { label: "Lost", color: "#ef6a55", rule: "90+ days since the last buy" },
  // Lead vs Prospect (Chad, 2026-10-07): a Lead is any account in the full
  // account list that has never bought and we know nothing about yet; once we
  // have contact info for it or someone checks in with it, it becomes a
  // Prospect (automatic).
  prospect: { label: "Prospect", color: "#e0c45a", rule: "Never bought, but we have contact info or someone has checked in" },
  lead: { label: "Lead", color: "#a08cf0", rule: "Never bought, no contact info, never visited or contacted" },
  former: { label: "Former distributor", color: "#7d8782", rule: "Last bought through a distributor we no longer use" },
};
export const STAGE_ORDER: AccountStage[] = ["active", "new", "plost", "lost", "prospect", "lead", "former"];

export function repFor(distributor: string | null): string | null {
  return distributor ? (REP_BY_DISTRIBUTOR[distributor] ?? null) : null;
}

export function isFormerDistributor(distributor: string | null): boolean {
  return !!distributor && !CURRENT_DISTRIBUTORS.includes(distributor);
}

const DAY_MS = 24 * 60 * 60 * 1000;
export function daysBetween(fromIso: string, toIso: string): number {
  return Math.round((Date.parse(toIso + "T00:00:00Z") - Date.parse(fromIso + "T00:00:00Z")) / DAY_MS);
}

// hasInfo = the account has at least one contact on file or at least one
// check-in (that's what turns a Lead into a Prospect).
export function stageFor(
  a: Pick<SalesAccountRow, "distributor" | "last_buy_date" | "buy_months_6">,
  asOf: string,
  hasInfo = false,
): AccountStage {
  if (isFormerDistributor(a.distributor)) return "former";
  if (!a.last_buy_date) return hasInfo ? "prospect" : "lead";
  const days = daysBetween(a.last_buy_date, asOf);
  if (days <= 60) return a.buy_months_6 >= 3 ? "active" : "new";
  if (days <= 90) return "plost";
  return "lost";
}

export function isLostBig(stage: AccountStage, lifetimeCe: number): boolean {
  return (stage === "plost" || stage === "lost") && lifetimeCe >= BIG_LOST_CE;
}

// ---- Import file (made from Chad's spreadsheets; see the Import panel) ----
// accounts:  {id, n, a, c, st, z, ph, d, pr, bd, rd, rn}
// sales:     [outlet_id, "YYYY-MM", product, package, distributor, ce, last_buy "YYYY-MM-DD", size]
// contacts:  [outlet_id, name, title, phone, mobile, email, notes, source]
export interface ImportAccount {
  id: string;
  n: string;
  a?: string | null;
  c?: string | null;
  st?: string | null;
  z?: string | null;
  ph?: string | null;
  d?: string | null;
  pr?: string | null;
  bd?: string | null;
  rd?: string | null;
  rn?: string | null;
}
export type ImportSale = [string, string, string, string | null, string | null, number, string | null, (string | null)?];
export type ImportContact = [string, string | null, string | null, string | null, string | null, string | null, string | null, string | null];
// buddies: accounts on a distributor target list → start as Buddy accounts
// [outlet_id, target list, distributor rep name, phone, email]
export type ImportBuddy = [string, string | null, string | null, string | null, string | null];
// checkins: [outlet_id, "YYYY-MM-DD", rep, activity, outcome, notes, brands sampled, contact, source]
export type ImportCheckin = [
  string,
  string,
  string | null,
  string | null,
  string | null,
  string | null,
  string | null,
  string | null,
  string,
];
export interface ImportFile {
  format: "fcb-sales-accounts-v1";
  as_of: string;
  accounts: ImportAccount[];
  sales: ImportSale[];
  contacts: ImportContact[];
  buddies?: ImportBuddy[];
  checkins?: ImportCheckin[];
}

// Check-ins (visits, emails/texts, calls) with their notes —
// sales_account_checkins. Imported rows have source "Sales Ops: …" or
// "Lilypad: …"; a re-import replaces only those.
export interface SalesAccountCheckinRow {
  id: string;
  outlet_id: string;
  checkin_date: string;
  rep: string | null;
  activity: string | null;
  outcome: string | null;
  notes: string | null;
  brands: string | null;
  contact: string | null;
  source: string | null;
}

// ---- Classifications (Feature 2, added 2026-10-07) ----
// Stored in sales_account_class (sql/sales_account_classification.sql),
// apart from the imported sales data so a re-import never wipes them.
export type OwnerType = "fcb" | "buddy" | "distributor" | "cadence";
export type OwnerShown = OwnerType | "former";
export type Tier = "A" | "B" | "C";
export type HandledBy = "fcb_rep" | "distributor_rep" | "back_office";

export interface SalesAccountClassRow {
  id: string;
  outlet_id: string;
  owner_type: OwnerType | null;
  tier: Tier | null;
  handled_by: HandledBy | null;
  tags: string;
  buddy_list: string | null;
  buddy_rep_name: string | null;
  buddy_rep_phone: string | null;
  buddy_rep_email: string | null;
  updated_at: string;
  updated_by: string | null;
}

export const OWNER_INFO: Record<OwnerShown, { label: string; color: string; rule: string }> = {
  fcb: { label: "FCB Account", color: "#6abc46", rule: "We own the relationship" },
  buddy: { label: "Buddy Account", color: "#5aa9f0", rule: "Shared account we review with the distributor rep" },
  distributor: { label: "Distributor Account", color: "#a3a3a3", rule: "The distributor owns it" },
  cadence: { label: "Cadence Account", color: "#d08cf0", rule: "Never on permanently, buys a few kegs a year when asked" },
  former: { label: "Former distributor", color: "#7d8782", rule: "Bought through a distributor we no longer use" },
};
export const OWNER_ORDER: OwnerShown[] = ["fcb", "buddy", "distributor", "cadence", "former"];
export const OWNER_CHOICES: OwnerType[] = ["fcb", "buddy", "distributor", "cadence"];
export const TIERS: Tier[] = ["A", "B", "C"];
export const HANDLED_LABEL: Record<HandledBy, string> = {
  fcb_rep: "FCB Rep",
  distributor_rep: "Distributor Rep",
  back_office: "Back Office",
};
export const HANDLED_CHOICES: HandledBy[] = ["fcb_rep", "distributor_rep", "back_office"];
// The old Zoho SOP's follow-up tags.
export const TAGS: { key: string; rule: string }[] = [
  { key: "SCRUB", rule: "Missing or unverified contact info — needs cleanup" },
  { key: "NOFOLLOWUP", rule: "Not worth pursuing for now" },
  { key: "POLITIC", rule: "Needs approval before anyone engages" },
  { key: "EXEC", rule: "Needs an executive follow-up" },
  { key: "COMMITTED", rule: "Verbal or written purchase commitment" },
  { key: "POTENTIAL", rule: "Interested, not committed yet" },
  { key: "SOCIAL", rule: "Social media engagement" },
  { key: "EMAIL ONLY", rule: "Passive updates only" },
];

export function parseTags(tags: string | null | undefined): string[] {
  return (tags ?? "")
    .split(",")
    .map((t) => t.trim())
    .filter(Boolean);
}
export function joinTags(tags: string[]): string {
  return TAGS.map((t) => t.key).filter((k) => tags.includes(k)).join(",");
}

// What the page shows as the owner: Former distributor wins (automatic),
// then whatever was set, else Distributor.
export function ownerShown(stage: AccountStage, owner: OwnerType | null | undefined): OwnerShown {
  if (stage === "former") return "former";
  return owner ?? "distributor";
}

// ---- Product Lookup (added 2026-10-08) ----
// Whole months only (Chad). Sizes are cleaned up in the import file; cases are
// worked out from CE by size in SQL (sql/sales_product_lookup.sql).
export const PRODUCT_SIZES = ["12oz", "16oz", "19.2oz", "22oz bottle", "1/2 bbl", "1/6 bbl", "13.2 gal keg", "Other"];

export interface ProductLookupRow {
  ce: number;
  cases: number;
  accounts: number;
}
export interface ProductLookupResult {
  totals: ProductLookupRow & { months: number };
  by_month: (ProductLookupRow & { month: string })[];
  by_distributor: (ProductLookupRow & { distributor: string })[];
  by_product: (ProductLookupRow & { product: string; size: string })[];
  by_account: { outlet_id: string; name: string | null; city: string | null; distributor: string | null; ce: number; cases: number; last_month: string; last_ce: number; last_cases: number }[];
}
