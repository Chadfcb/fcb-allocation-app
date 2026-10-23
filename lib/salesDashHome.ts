// Sales Dashboard home (added 2026-10-21, per Chad) — the at-a-glance page.
// Plan + approved mockup: claude/sales-dashboard-plan.md in the project.
// Numbers come from sales_dash_home() (sql/sales_dashboard_home.sql); this
// file turns them into what each block shows for the chosen period and
// distributor, so the page itself stays simple.

import { BIG_LOST_CE, CURRENT_DISTRIBUTORS, REP_BY_DISTRIBUTOR, REPS } from "@/lib/salesAccounts";

// "60" added 2026-10-22 for the distributor pages' per-block buttons (the Sales
// Dashboard itself still offers 30 / 90 / YTD / custom — PERIODS below).
export type Period = "30" | "60" | "90" | "ytd" | "custom";
// The quick picks; "custom" (a From–To range, added 2026-10-21) is its own control.
export const PERIODS: { key: Exclude<Period, "custom">; label: string; long: string }[] = [
  { key: "30", label: "30 days", long: "Last 30 days" },
  { key: "90", label: "90 days", long: "Last 90 days" },
  { key: "ytd", label: "Year to date", long: "Year to date" },
];

// Distributor dot colors (same family as the rest of the app's sales pages).
export const DIST_COLORS: Record<string, string> = {
  Matagrano: "#5aa9f0",
  Guardian: "#e0c45a",
  "Valley Wide": "#3fc9b0",
  Mussetter: "#a08cf0",
  Saccani: "#f0a63c",
  Markstein: "#ef8fb0",
  Coast: "#7d8782",
  Superior: "#7d8782",
};
export const distColor = (d: string | null | undefined) => (d && DIST_COLORS[d]) || "#7d8782";

export const STAGE_COLORS = {
  active: "#6abc46",
  new: "#5aa9f0",
  reactivated: "#3fc9b0",
  plost: "#f0a63c",
  lost: "#ef6a55",
} as const;

// ---- What sales_dash_home() returns ----
type Yr = "ty" | "ly";
export interface HomeCheckin {
  date: string;
  rep: string | null;
}
export interface HomeWinback {
  outlet_id: string;
  name: string;
  city: string | null;
  dist: string;
  d: string; // the day they ordered again
  prev: string; // their order before that
  gap: number; // days without an order
  ce_since: number | null;
  items: string | null;
  checkin: HomeCheckin | null;
}
export interface HomeAttention {
  outlet_id: string;
  name: string;
  city: string | null;
  dist: string;
  stage: "plost" | "lost";
  lb: string;
  dark: number;
  ce12: number;
  phone: string | null;
  checkin: HomeCheckin | null;
}
export interface HomeChainQuiet {
  chain: string;
  dist: string;
  stores: number;
  quiet: number;
  quiet_ce: number;
  quiet_names: string[];
}
export interface HomeData {
  as_of: string | null;
  has_accounts: boolean;
  periods: { p: Period; yr: Yr; from: string; to: string }[];
  cases: { p: Period; yr: Yr; dist: string; ce: number }[];
  brands: { p: Period; yr: Yr; dist: string; product: string; ce: number }[];
  sizes: { p: Period; dist: string; size: string; ce: number }[];
  monthly: { month: string; dist: string; ce: number }[];
  stages: { dist: string; stage: keyof typeof STAGE_COLORS; n: number; ce12: number }[];
  buying_ly: { dist: string; n: number }[];
  new_counts: { p: Period; yr: Yr; dist: string; n: number }[];
  won_counts: { p: Period; yr: Yr; dist: string; n: number; from_lost: number }[];
  lost_counts: { p: Period; yr: Yr; dist: string; n: number }[];
  winbacks: HomeWinback[];
  attention: HomeAttention[];
  chain_quiet: HomeChainQuiet[];
  checkins: { p: Period; rep: string; n: number }[] | null;
}

export interface DateRange {
  from: string; // YYYY-MM-DD
  to: string;
}
export function loadArgs(custom: DateRange | null) {
  return { p_current: CURRENT_DISTRIBUTORS, p_big: BIG_LOST_CE, p_from: custom?.from ?? null, p_to: custom?.to ?? null };
}
export function addDaysIso(iso: string, days: number): string {
  const d = new Date(`${iso.slice(0, 10)}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

// ---- small helpers ----
const num = (v: unknown) => Number(v) || 0;
export const fmtN = (n: number) => Math.round(n).toLocaleString("en-US");
export function pctChange(now: number, before: number): number | null {
  if (!before) return null;
  return ((now - before) / before) * 100;
}
export const fmtPct = (p: number | null) => (p === null ? "new" : `${p > 0 ? "+" : ""}${p.toFixed(1)}%`);
export function fmtDay(iso: string | null | undefined): string {
  if (!iso) return "—";
  const [y, m, d] = iso.slice(0, 10).split("-");
  return `${+m}/${+d}/${y.slice(2)}`;
}
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
export const monthLabel = (iso: string) => MONTHS[+iso.slice(5, 7) - 1];

// The rep for a distributor ("No FCB rep" for Coast / Superior).
export const repName = (d: string) => REP_BY_DISTRIBUTOR[d] ?? "No FCB rep";

// Distributors that have store-level sales (cards); the rest are named in a note.
export function distributorsWithData(h: HomeData): { withData: string[]; without: string[] } {
  const seen = new Set<string>();
  for (const m of h.monthly) if (num(m.ce) > 0) seen.add(m.dist);
  for (const s of h.stages) seen.add(s.dist);
  return {
    withData: CURRENT_DISTRIBUTORS.filter((d) => seen.has(d)),
    without: CURRENT_DISTRIBUTORS.filter((d) => !seen.has(d)),
  };
}

export function periodRange(h: HomeData, p: Period): { from: string; to: string } | null {
  const r = h.periods.find((x) => x.p === p && x.yr === "ty");
  return r ? { from: r.from, to: r.to } : null;
}

// ---- Headline numbers for one period + distributor filter ----
export interface Kpis {
  cases: number;
  casesLy: number;
  buying: number;
  buyingLy: number;
  newA: number;
  newLy: number;
  won: number;
  wonLy: number;
  wonFromLost: number;
  atRisk: number;
  atRiskCe: number;
  wentLost: number;
  wentLostLy: number;
}

export function kpis(h: HomeData, p: Period, dist: string): Kpis {
  const f = (d: string) => !dist || d === dist;
  const sum = <T extends { dist: string }>(rows: T[], pick: (r: T) => number, keep: (r: T) => boolean) =>
    rows.filter((r) => f(r.dist) && keep(r)).reduce((t, r) => t + num(pick(r)), 0);
  const stage = (s: string) => sum(h.stages, (r) => r.n, (r) => r.stage === s);
  return {
    cases: sum(h.cases, (r) => r.ce, (r) => r.p === p && r.yr === "ty"),
    casesLy: sum(h.cases, (r) => r.ce, (r) => r.p === p && r.yr === "ly"),
    buying: stage("active") + stage("new") + stage("reactivated"),
    buyingLy: sum(h.buying_ly, (r) => r.n, () => true),
    newA: sum(h.new_counts, (r) => r.n, (r) => r.p === p && r.yr === "ty"),
    newLy: sum(h.new_counts, (r) => r.n, (r) => r.p === p && r.yr === "ly"),
    won: sum(h.won_counts, (r) => r.n, (r) => r.p === p && r.yr === "ty"),
    wonLy: sum(h.won_counts, (r) => r.n, (r) => r.p === p && r.yr === "ly"),
    wonFromLost: sum(h.won_counts, (r) => r.from_lost, (r) => r.p === p && r.yr === "ty"),
    atRisk: stage("plost"),
    atRiskCe: sum(h.stages, (r) => r.ce12, (r) => r.stage === "plost"),
    wentLost: sum(h.lost_counts, (r) => r.n, (r) => r.p === p && r.yr === "ty"),
    wentLostLy: sum(h.lost_counts, (r) => r.n, (r) => r.p === p && r.yr === "ly"),
  };
}

export function stageCounts(h: HomeData, dist: string) {
  const out: Record<keyof typeof STAGE_COLORS, { n: number; ce12: number }> = {
    active: { n: 0, ce12: 0 },
    new: { n: 0, ce12: 0 },
    reactivated: { n: 0, ce12: 0 },
    plost: { n: 0, ce12: 0 },
    lost: { n: 0, ce12: 0 },
  };
  for (const s of h.stages) {
    if (dist && s.dist !== dist) continue;
    if (!(s.stage in out)) continue;
    out[s.stage].n += num(s.n);
    out[s.stage].ce12 += num(s.ce12);
  }
  return out;
}

// ---- Cases by month: the last 12 months vs the 12 before ----
export interface Trend {
  months: string[]; // YYYY-MM-01, oldest first (12)
  ty: number[];
  ly: number[];
  partial: boolean; // the newest month is still going
}
export function trend(h: HomeData, dist: string): Trend {
  const by = new Map<string, number>();
  for (const m of h.monthly) {
    if (dist && m.dist !== dist) continue;
    const k = m.month.slice(0, 10);
    by.set(k, (by.get(k) ?? 0) + num(m.ce));
  }
  const asOf = h.as_of ?? new Date().toISOString().slice(0, 10);
  const y = +asOf.slice(0, 4);
  const mo = +asOf.slice(5, 7);
  const key = (yy: number, mm: number) => {
    while (mm <= 0) {
      mm += 12;
      yy -= 1;
    }
    return `${yy}-${String(mm).padStart(2, "0")}-01`;
  };
  const months: string[] = [];
  const ty: number[] = [];
  const ly: number[] = [];
  for (let i = 11; i >= 0; i--) {
    const k = key(y, mo - i);
    months.push(k);
    ty.push(by.get(k) ?? 0);
    ly.push(by.get(key(y - 1, mo - i)) ?? 0);
  }
  const lastDay = new Date(Date.UTC(y, mo, 0)).getUTCDate();
  return { months, ty, ly, partial: +asOf.slice(8, 10) < lastDay };
}

// ---- Brands and package sizes ----
export function brands(h: HomeData, p: Period, dist: string, top = 6) {
  const ty = new Map<string, number>();
  const ly = new Map<string, number>();
  for (const b of h.brands) {
    if (b.p !== p || (dist && b.dist !== dist)) continue;
    const m = b.yr === "ty" ? ty : ly;
    m.set(b.product, (m.get(b.product) ?? 0) + num(b.ce));
  }
  return [...ty.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, top)
    .map(([product, ce]) => ({ product, ce, chg: pctChange(ce, ly.get(product) ?? 0) }));
}
export function sizes(h: HomeData, p: Period, dist: string) {
  const m = new Map<string, number>();
  for (const s of h.sizes) {
    if (s.p !== p || (dist && s.dist !== dist)) continue;
    m.set(s.size, (m.get(s.size) ?? 0) + num(s.ce));
  }
  const total = [...m.values()].reduce((a, b) => a + b, 0) || 1;
  return [...m.entries()].sort((a, b) => b[1] - a[1]).map(([size, ce]) => ({ size, ce, share: ce / total }));
}

// ---- Win backs in the period ----
export function winbacksIn(h: HomeData, p: Period, dist: string): HomeWinback[] {
  const r = periodRange(h, p);
  if (!r) return [];
  return h.winbacks
    .filter((w) => (!dist || w.dist === dist) && w.d >= r.from && w.d <= r.to)
    .sort((a, b) => (a.d < b.d ? 1 : a.d > b.d ? -1 : b.gap - a.gap));
}

// ---- Rep activity ----
export interface RepRow {
  rep: string;
  territory: string;
  checkins: number | null;
  newA: number;
  won: number;
}
export function repActivity(h: HomeData, p: Period, dist: string): RepRow[] {
  const repsShown = REPS.filter((r) => !dist || REP_BY_DISTRIBUTOR[dist] === r.rep);
  return repsShown.map((r) => {
    const dists = Object.entries(REP_BY_DISTRIBUTOR)
      .filter(([, rep]) => rep === r.rep)
      .map(([d]) => d)
      .filter((d) => !dist || d === dist);
    const inD = (d: string) => dists.includes(d);
    const first = r.rep.toLowerCase();
    const chk = h.checkins
      ? h.checkins
          .filter((c) => c.p === p && (c.rep ?? "").trim().toLowerCase().split(/\s+/)[0] === first)
          .reduce((t, c) => t + num(c.n), 0)
      : null;
    return {
      rep: r.rep,
      territory: r.territory,
      checkins: chk,
      newA: h.new_counts.filter((c) => c.p === p && c.yr === "ty" && inD(c.dist)).reduce((t, c) => t + num(c.n), 0),
      won: h.won_counts.filter((c) => c.p === p && c.yr === "ty" && inD(c.dist)).reduce((t, c) => t + num(c.n), 0),
    };
  });
}
