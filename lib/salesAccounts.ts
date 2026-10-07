// Sales > Accounts (added 2026-10-07) — shared rules for the Accounts page.
// Project docs: claude/sales-system-build-plan.md (Feature 1),
// claude/sales-reps-territories.md, claude/accounts-preview.md.
//
// Stages are worked out from each account's summary columns (filled by
// sales_accounts_refresh() after an import) and the data's "as of" date —
// the last buy date in the imported data, not today — so an old import
// never makes every account look lost.

export type AccountStage = "active" | "new" | "plost" | "lost" | "lead" | "former";

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
  lead: { label: "Lead", color: "#a08cf0", rule: "In the account list, never bought" },
  former: { label: "Former distributor", color: "#7d8782", rule: "Last bought through a distributor we no longer use" },
};
export const STAGE_ORDER: AccountStage[] = ["active", "new", "plost", "lost", "lead", "former"];

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

export function stageFor(a: Pick<SalesAccountRow, "distributor" | "last_buy_date" | "buy_months_6">, asOf: string): AccountStage {
  if (isFormerDistributor(a.distributor)) return "former";
  if (!a.last_buy_date) return "lead";
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
// sales:     [outlet_id, "YYYY-MM", product, package, distributor, ce, last_buy "YYYY-MM-DD"]
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
export type ImportSale = [string, string, string, string | null, string | null, number, string | null];
export type ImportContact = [string, string | null, string | null, string | null, string | null, string | null, string | null, string | null];
export interface ImportFile {
  format: "fcb-sales-accounts-v1";
  as_of: string;
  accounts: ImportAccount[];
  sales: ImportSale[];
  contacts: ImportContact[];
}
