// James Effectiveness (Distributors → Markstein, added 2026-10-29 per Chad).
// Plan: claude/james-effectiveness-plan.md. Data: james_effectiveness()
// (sql/james_effectiveness.sql). This file turns that data into the
// week-by-week rows Chad tracked on his "Leadsheet" spreadsheet tab, checked
// against what the stores actually bought (LilyPad / VIP sales), not just
// what James says they committed to.
//
// Rules:
// - Weeks run Sunday–Saturday, starting 5/31/2026 (James's first week).
// - Committed account = a store James marked Committed (or Delivered) that
//   week. Delivered = that store bought within 30 days on or after the
//   commitment date. Sales come in monthly with the first and last buy date
//   of each product, so a store that buys twice in one month counts once.
// - Cases delivered = what delivered stores bought in that 30-day window,
//   in cases of each size (CE ÷ case factor) plus total CE. A sale counts
//   toward one commitment only.
// - A commitment still inside its 30 days with no sale yet is "too soon to
//   tell" and stays out of the conversion rate.
// - Fulfillment compares the products James wrote down as committed with
//   what was bought (brand + size).
// - Rebuy = a store James visited that bought on 2+ different days after his
//   first visit. Counted in the week of that second buy.
// - Targets: a target is "hit" the first week James checks in there.

export interface JeCheckin {
  outlet_id: string;
  checkin_date: string;
  activity: string | null;
  outcome: string | null;
  brands: string | null;
  name: string;
  city: string | null;
  premise: string | null;
  ce_12mo?: number | null;
  notes?: string | null;
}
export interface JeSale {
  outlet_id: string;
  month: string;
  product: string;
  size: string | null;
  ce: number;
  first_buy_in_month: string | null;
  last_buy_date: string | null;
}
export interface JeTarget {
  name: string;
  tier: string | null;
  class_of_trade: string | null;
  outlet_id: string | null;
  why: string | null;
}
// Markstein accounts that bought in the last year but not in 90+ days and
// that James has never visited (Direction: win back lapsed buyers).
export interface JeLapsed {
  outlet_id: string;
  name: string;
  city: string | null;
  premise: string | null;
  last_buy_date: string | null;
  ce_12mo: number | null;
}
// Markstein accounts buying now (last 90 days) that James has never visited,
// with what they bought in the last 12 months (2026-10-29).
export interface JeUnvisited extends JeLapsed {
  items: string[] | null; // "Big Daddy IPA (12oz)" …
}
export interface JeData {
  as_of: string | null;
  checkins: JeCheckin[];
  sales: JeSale[];
  targets: JeTarget[];
  lapsed?: JeLapsed[];
  unvisited_buyers?: JeUnvisited[];
  popular?: { premise: "On" | "Off"; item: string; accounts: number }[];
}

export const JE_START = "2026-05-31";
const WINDOW_DAYS = 30;

const CASE_FACTOR: Record<string, number> = {
  "12oz": 1,
  "16oz": 1.3333,
  "19.2oz": 0.8,
  "22oz bottle": 0.9167,
  "1/2 bbl": 6.8889,
  "1/6 bbl": 2.2933,
  "13.2 gal keg": 5.8667,
};

const DAY = 86400000;
const t = (iso: string) => Date.parse(iso + "T00:00:00Z");
const iso = (ms: number) => new Date(ms).toISOString().slice(0, 10);
export const addDays = (d: string, n: number) => iso(t(d) + n * DAY);
const weekIndex = (d: string) => Math.floor((t(d) - t(JE_START)) / (7 * DAY));

// Brand + size from a product line, e.g. "Big Daddy IPA 4/6 pack 12oz Cans",
// "Captain Save A Hop HAZY IPA (16oz)", "Big Daddy IPA 1/6 Barrel Keg".
const BRANDS: [RegExp, string][] = [
  [/big daddy/i, "BD"],
  [/hazy/i, "CH"],
  [/\bwc\b|west coast/i, "WC"],
  [/apricot/i, "AP"],
  [/nectarine/i, "NP"],
  [/peachy/i, "PV"],
  [/pitchfork/i, "PF"],
  [/mango/i, "MB"],
  [/mystic/i, "MY"],
  [/juicy/i, "JU"],
  [/prohibition/i, "PR"],
];
export function brandKey(s: string): string | null {
  for (const [re, k] of BRANDS) if (re.test(s)) return k;
  return null;
}
export function sizeKey(s: string): string | null {
  if (/19\.2|19 ?oz/i.test(s)) return "19.2oz";
  if (/1\/2|half/i.test(s)) return "1/2 bbl";
  if (/1\/6|sixth/i.test(s)) return "1/6 bbl";
  if (/16 ?oz/i.test(s)) return "16oz";
  if (/12 ?oz/i.test(s)) return "12oz";
  return null;
}

// Products James wrote down as committed ("Committed: A; B · Sampled: C").
export function committedItems(brands: string | null): string[] {
  if (!brands) return [];
  const m = brands.match(/Committed:\s*([^·]*)/i);
  if (!m) return [];
  return m[1]
    .split(";")
    .map((x) => x.trim().replace(/\s+x\d+$/i, ""))
    .filter(Boolean);
}

export interface WeekRow {
  key: string;
  label: string;
  group: string;
  values: (number | null)[]; // one per week
  total: number | null;
  pct?: boolean;
  dec?: boolean;
}

export interface JeResult {
  weeks: { from: string; to: string; label: string }[];
  rows: WeekRow[];
  totals: {
    checkins: number;
    committed: number;
    delivered: number;
    conversion: number | null;
    ce: number;
    rebuys: number;
    targets: number;
    targetsHit: number;
  };
  impact: Impact;
  commitments: Commitment[];
}

export interface Commitment {
  outlet_id: string;
  name: string;
  city: string | null;
  premise: "On" | "Off" | null;
  date: string;
  items: string[];
  delivered: boolean;
  ce: number;
  fill: string; // all | some | unlisted | none | pending
  ce12: number;
}

// What FCB's accounts bought after James's first visit, compared with the
// same days last year and with the same number of days just before his first
// visit. Every account counts from its own first-visit date.
export interface Impact {
  accounts: number; // accounts James visited
  after: number; // CE from first visit through the sales date
  lastYear: number; // same accounts, same days a year earlier
  before: number; // same accounts, same number of days before the first visit
  newBuyers: number; // bought after his visit, nothing in the 12 months before
  newBuyersCe: number;
  months: { month: string; after: number; lastYear: number }[];
  recent: { after: number; lastYear: number; from: string; to: string }; // last 90 days
}

const isCommit = (o: string | null) => o === "Committed" || o === "Delivered";
const premOf = (c: JeCheckin): "On" | "Off" | null =>
  c.activity === "On Premise Visit" ? "On" : c.activity === "Off Premise Visit" ? "Off" : c.premise && /off/i.test(c.premise) ? "Off" : c.premise && /on/i.test(c.premise) ? "On" : null;

// Buy days of a sales row (first and last buy in that month).
const buyDays = (s: JeSale) => Array.from(new Set([s.first_buy_in_month, s.last_buy_date].filter((d): d is string => !!d)));

export function computeJe(data: JeData, today: string): JeResult {
  // Weeks run through the newest James check-in or sales date (not past today),
  // so there's no empty week at the end before his next recap comes in.
  const lastCk = data.checkins.reduce((m, c) => (c.checkin_date > m ? c.checkin_date : m), JE_START);
  const newest = data.as_of && data.as_of > lastCk ? data.as_of : lastCk;
  const end = newest > today ? today : newest;
  const nWeeks = Math.max(1, weekIndex(end) + 1);
  const weeks = Array.from({ length: nWeeks }, (_, i) => {
    const from = addDays(JE_START, i * 7);
    const to = addDays(from, 6);
    const [, fm, fd] = from.split("-").map(Number);
    const [, tm, td] = to.split("-").map(Number);
    return { from, to, label: `${fm}/${fd}–${tm}/${td}` };
  });
  const z = () => Array.from({ length: nWeeks }, () => 0);

  const ck = data.checkins.filter((c) => c.checkin_date >= JE_START);
  const salesBy = new Map<string, JeSale[]>();
  for (const s of data.sales) {
    const l = salesBy.get(s.outlet_id);
    if (l) l.push(s);
    else salesBy.set(s.outlet_id, [s]);
  }

  // Activity
  const on = z(), off = z(), unk = z(), total = z();
  for (const c of ck) {
    const w = weekIndex(c.checkin_date);
    if (w < 0 || w >= nWeeks) continue;
    total[w]++;
    const p = premOf(c);
    if (p === "On") on[w]++;
    else if (p === "Off") off[w]++;
    else unk[w]++;
  }

  // Commitments: one per store per week (earliest day that week), products merged.
  const commitMap = new Map<string, { c: JeCheckin; date: string; items: Set<string> }>();
  for (const c of ck) {
    if (!isCommit(c.outcome)) continue;
    const w = weekIndex(c.checkin_date);
    const k = `${c.outlet_id}|${w}`;
    const cur = commitMap.get(k);
    if (!cur) commitMap.set(k, { c, date: c.checkin_date, items: new Set(committedItems(c.brands)) });
    else {
      if (c.checkin_date < cur.date) cur.date = c.checkin_date;
      committedItems(c.brands).forEach((x) => cur.items.add(x));
    }
  }
  const commits = Array.from(commitMap.values()).sort((a, b) => a.date.localeCompare(b.date));
  const committed = z(), delOn = z(), delOff = z(), delTot = z();
  const c12 = z(), c16 = z(), c19 = z(), k16 = z(), k12 = z(), ceDel = z();
  const fillAll = z(), fillSome = z(), fillNone = z(), fillUnlisted = z(), pending = z();
  // Sales are in through as_of; a commitment whose 30 days aren't over yet and
  // hasn't bought is "too soon to tell", not "got none".
  const salesThrough = data.as_of ?? today;
  const used = new Set<string>(); // sales row + day already counted
  const commitOut: JeResult["commitments"] = [];
  for (const cm of commits) {
    const w = weekIndex(cm.date);
    committed[w]++;
    const winEnd = addDays(cm.date, WINDOW_DAYS);
    const rows = (salesBy.get(cm.c.outlet_id) ?? []).filter((s) => buyDays(s).some((d) => d >= cm.date && d <= winEnd));
    const delivered = rows.length > 0;
    let ce = 0;
    const bought = new Set<string>();
    for (const s of rows) {
      bought.add(`${brandKey(s.product) ?? s.product}|${s.size ?? ""}`);
      const id = `${s.outlet_id}|${s.month}|${s.product}|${s.size}`;
      if (used.has(id)) continue;
      used.add(id);
      ce += Number(s.ce) || 0;
      const f = CASE_FACTOR[s.size ?? ""];
      const cases = f ? (Number(s.ce) || 0) / f : 0;
      if (s.size === "12oz") c12[w] += cases;
      else if (s.size === "16oz") c16[w] += cases;
      else if (s.size === "19.2oz") c19[w] += cases;
      else if (s.size === "1/6 bbl") k16[w] += cases;
      else if (s.size === "1/2 bbl") k12[w] += cases;
      ceDel[w] += Number(s.ce) || 0;
    }
    let fill = "none";
    const items = Array.from(cm.items);
    if (delivered) {
      delTot[w]++;
      if (premOf(cm.c) === "On") delOn[w]++;
      else delOff[w]++;
      if (!items.length) {
        fill = "unlisted";
        fillUnlisted[w]++;
      } else {
        const got = items.filter((it) => {
          const b = brandKey(it);
          const sz = sizeKey(it);
          return Array.from(bought).some((x) => {
            const [xb, xs] = x.split("|");
            return xb === b && (!sz || xs === sz);
          });
        }).length;
        if (got === items.length) {
          fill = "all";
          fillAll[w]++;
        } else {
          fill = "some";
          fillSome[w]++;
        }
      }
    } else if (winEnd > salesThrough) {
      fill = "pending";
      pending[w]++;
    } else fillNone[w]++;
    commitOut.push({ outlet_id: cm.c.outlet_id, name: cm.c.name, city: cm.c.city, premise: premOf(cm.c), date: cm.date, items, delivered, ce, fill, ce12: Number(cm.c.ce_12mo) || 0 });
  }

  // Rebuys
  const firstVisit = new Map<string, string>();
  for (const c of ck) {
    const f = firstVisit.get(c.outlet_id);
    if (!f || c.checkin_date < f) firstVisit.set(c.outlet_id, c.checkin_date);
  }
  const newRebuy = z(), ceRepeat = z();
  firstVisit.forEach((v0, outlet) => {
    const rows = salesBy.get(outlet) ?? [];
    const days = Array.from(new Set(rows.flatMap(buyDays).filter((d) => d >= v0))).sort();
    if (days.length >= 2) {
      const w = weekIndex(days[1]);
      if (w >= 0 && w < nWeeks) newRebuy[w]++;
    }
    if (days.length >= 1) {
      for (const s of rows) {
        const d = s.last_buy_date;
        if (!d || d <= days[0]) continue;
        const w = weekIndex(d);
        if (w >= 0 && w < nWeeks) ceRepeat[w] += Number(s.ce) || 0;
      }
    }
  });
  const rebuyCum = z();
  newRebuy.reduce((a, n, i) => (rebuyCum[i] = a + n), 0);

  // Targets
  const targets = data.targets;
  const universe = targets.length;
  const firstCk = new Map<string, string>();
  for (const c of ck) {
    const f = firstCk.get(c.outlet_id);
    if (!f || c.checkin_date < f) firstCk.set(c.outlet_id, c.checkin_date);
  }
  const hit = z(), hitOn = z(), hitOff = z();
  for (const tg of targets) {
    const d = tg.outlet_id ? firstCk.get(tg.outlet_id) : undefined;
    if (!d) continue;
    const w = weekIndex(d);
    if (w < 0 || w >= nWeeks) continue;
    hit[w]++;
    if (tg.class_of_trade === "On") hitOn[w]++;
    else hitOff[w]++;
  }
  const notHit = z();
  hit.reduce((a, n, i) => ((notHit[i] = universe - (a + n)), a + n), 0);

  const sum = (a: number[]) => a.reduce((x, y) => x + y, 0);
  const r = (key: string, group: string, label: string, values: number[], total: number | null = sum(values), extra: Partial<WeekRow> = {}): WeekRow => ({
    key,
    group,
    label,
    values,
    total,
    ...extra,
  });
  // Conversion leaves out commitments that are still inside their 30 days.
  const conv = committed.map((c, i) => (c - pending[i] > 0 ? delTot[i] / (c - pending[i]) : null));
  const totCommitted = sum(committed);
  const totDelivered = sum(delTot);
  const totDecided = totCommitted - sum(pending);
  const rows: WeekRow[] = [
    r("on", "Activity & Conversion", "On premise check-ins", on),
    r("off", "Activity & Conversion", "Off premise check-ins", off),
    ...(sum(unk) ? [r("unk", "Activity & Conversion", "Check-ins, premise not known", unk)] : []),
    r("tot", "Activity & Conversion", "Total check-ins", total),
    r("com", "Activity & Conversion", "Committed accounts", committed),
    r("don", "Activity & Conversion", "On premise commitments delivered", delOn),
    r("doff", "Activity & Conversion", "Off premise commitments delivered", delOff),
    r("dtot", "Activity & Conversion", "Total delivered accounts", delTot),
    { key: "conv", group: "Activity & Conversion", label: "Committed conversion rate", values: conv, total: totDecided ? totDelivered / totDecided : null, pct: true },
    r("c12", "Cases Delivered (sales-confirmed)", "12 oz cases", c12, sum(c12), { dec: true }),
    r("c16", "Cases Delivered (sales-confirmed)", "16 oz cases", c16, sum(c16), { dec: true }),
    r("c19", "Cases Delivered (sales-confirmed)", "19.2 oz cases", c19, sum(c19), { dec: true }),
    r("k16", "Cases Delivered (sales-confirmed)", "1/6 bbls", k16, sum(k16), { dec: true }),
    r("k12", "Cases Delivered (sales-confirmed)", "1/2 bbls", k12, sum(k12), { dec: true }),
    r("ce", "Cases Delivered (sales-confirmed)", "Total CEs delivered", ceDel, sum(ceDel), { dec: true }),
    r("fa", "Commitment Fulfillment", "Got everything they committed to", fillAll),
    r("fs", "Commitment Fulfillment", "Got some but not all", fillSome),
    ...(sum(fillUnlisted) ? [r("fu", "Commitment Fulfillment", "Bought — products not written down", fillUnlisted)] : []),
    r("fn", "Commitment Fulfillment", "Got none (30 days passed)", fillNone),
    ...(sum(pending) ? [r("fp", "Commitment Fulfillment", "Too soon to tell (within 30 days)", pending)] : []),
    r("rb", "Rebuy Activity", "New rebuy accounts", newRebuy),
    r("rce", "Rebuy Activity", "CEs from repeat purchases", ceRepeat, sum(ceRepeat), { dec: true }),
    r("rcum", "Rebuy Activity", "Total rebuy accounts to date", rebuyCum, rebuyCum[nWeeks - 1] ?? 0),
    r("tu", "Target Accounts", "Target accounts (total)", Array.from({ length: nWeeks }, () => universe), universe),
    r("th", "Target Accounts", "Targets hit (first visit)", hit),
    r("thon", "Target Accounts", "On premise targets hit", hitOn),
    r("thoff", "Target Accounts", "Off premise targets hit", hitOff),
    r("tn", "Target Accounts", "Targets not yet hit", notHit, notHit[nWeeks - 1] ?? universe),
  ];

  // Before / after James's first visit, account by account.
  const salesThrough2 = data.as_of ?? today;
  const yearAgo = (d: string) => addDays(d, -365);
  let after = 0, lastYear = 0, before = 0, newBuyers = 0, newBuyersCe = 0;
  let rAfter = 0, rLy = 0;
  const rFrom = addDays(salesThrough2, -89);
  const monthsMap = new Map<string, { after: number; lastYear: number }>();
  firstVisit.forEach((v0, outlet) => {
    if (v0 > salesThrough2) return;
    const span = Math.round((t(salesThrough2) - t(v0)) / DAY);
    const bStart = addDays(v0, -span - 1);
    let accAfter = 0, accPrior12 = 0;
    for (const s of salesBy.get(outlet) ?? []) {
      const d = s.last_buy_date;
      if (!d) continue;
      const ce = Number(s.ce) || 0;
      if (d >= v0 && d <= salesThrough2) {
        after += ce;
        accAfter += ce;
        const m = `${d.slice(0, 7)}-01`;
        const cur = monthsMap.get(m) ?? { after: 0, lastYear: 0 };
        cur.after += ce;
        monthsMap.set(m, cur);
        if (d >= rFrom) rAfter += ce;
      }
      if (d >= yearAgo(v0) && d <= yearAgo(salesThrough2)) {
        lastYear += ce;
        const m = `${addDays(d, 365).slice(0, 7)}-01`;
        const cur = monthsMap.get(m) ?? { after: 0, lastYear: 0 };
        cur.lastYear += ce;
        monthsMap.set(m, cur);
        if (d >= yearAgo(rFrom > v0 ? rFrom : v0)) rLy += ce;
      }
      if (d >= bStart && d < v0) before += ce;
      if (d >= yearAgo(v0) && d < v0) accPrior12 += ce;
    }
    if (accAfter > 0 && accPrior12 === 0) {
      newBuyers++;
      newBuyersCe += accAfter;
    }
  });
  const impact: Impact = {
    accounts: firstVisit.size,
    after,
    lastYear,
    before,
    newBuyers,
    newBuyersCe,
    months: Array.from(monthsMap.entries())
      .filter(([m]) => m >= "2026-05-01")
      .sort(([x], [y]) => x.localeCompare(y))
      .map(([month, v]) => ({ month, ...v })),
    recent: { after: rAfter, lastYear: rLy, from: rFrom, to: salesThrough2 },
  };

  return {
    weeks,
    rows,
    totals: {
      checkins: sum(total),
      committed: totCommitted,
      delivered: totDelivered,
      conversion: totDecided ? totDelivered / totDecided : null,
      ce: sum(ceDel),
      rebuys: rebuyCum[nWeeks - 1] ?? 0,
      targets: universe,
      targetsHit: sum(hit),
    },
    impact,
    commitments: commitOut,
  };
}

// ---------------------------------------------------------------------------
// Verdict — the one-line "how is James doing" (2026-10-29, per Chad: "its
// still not telling me in a nut shell how well James is doing"). Three
// checks; all good = Strong, two = Working, one or none = Needs work.
//   Sales:        accounts James visited, last 90 days (after his first
//                 visit) vs the same days last year — good when up.
//   Follow-through: commitments that turned into an order — good at 60%+.
//   Repeat:       accounts that bought after his visit and bought again —
//                 good at 40%+.
export const VERDICT_GOOD = { followThrough: 0.6, repeat: 0.4 };

export interface Verdict {
  grade: "Strong" | "Working" | "Needs work";
  checks: { key: string; good: boolean | null; text: string }[];
}

const pct = (x: number) => `${Math.round(x * 100)}%`;
const ce1 = (x: number) => (Math.round(x * 10) / 10).toLocaleString();

export function verdictFor(res: JeResult, data: JeData): Verdict {
  const { impact } = res;
  const checks: Verdict["checks"] = [];

  const ly = impact.recent.lastYear;
  const now = impact.recent.after;
  if (ly > 0) {
    const ch = (now - ly) / ly;
    checks.push({
      key: "sales",
      good: ch > 0,
      text: `Accounts James visited bought ${ce1(now)} CEs in the last 90 days, ${ch >= 0 ? "up" : "down"} ${pct(Math.abs(ch))} from ${ce1(ly)} the same days last year.`,
    });
  } else {
    checks.push({ key: "sales", good: now > 0 ? true : null, text: `Accounts James visited bought ${ce1(now)} CEs in the last 90 days (nothing the same days last year).` });
  }

  const decided = res.commitments.filter((c) => c.fill !== "pending");
  const bought = decided.filter((c) => c.delivered).length;
  if (decided.length) {
    const r = bought / decided.length;
    checks.push({
      key: "follow",
      good: r >= VERDICT_GOOD.followThrough,
      text: `${pct(r)} of his commitments turned into an order (${bought} of ${decided.length}); ${decided.length - bought} never did.`,
    });
  }

  // Repeat: accounts with a buy after the first visit, and how many bought again.
  const buyers = new Map<string, Set<string>>();
  const first = new Map<string, string>();
  for (const c of data.checkins) {
    const f = first.get(c.outlet_id);
    if (!f || c.checkin_date < f) first.set(c.outlet_id, c.checkin_date);
  }
  for (const s of data.sales) {
    const v0 = first.get(s.outlet_id);
    if (!v0) continue;
    for (const d of [s.first_buy_in_month, s.last_buy_date]) {
      if (!d || d < v0) continue;
      const set = buyers.get(s.outlet_id) ?? new Set<string>();
      set.add(d);
      buyers.set(s.outlet_id, set);
    }
  }
  const nBuyers = buyers.size;
  const nRepeat = Array.from(buyers.values()).filter((x) => x.size >= 2).length;
  if (nBuyers) {
    const r = nRepeat / nBuyers;
    checks.push({
      key: "repeat",
      good: r >= VERDICT_GOOD.repeat,
      text: `${pct(r)} of accounts that bought after his visit have ordered again (${nRepeat} of ${nBuyers}).`,
    });
  }

  const goods = checks.filter((c) => c.good === true).length;
  const grade: Verdict["grade"] = goods >= 3 ? "Strong" : goods === 2 ? "Working" : "Needs work";
  return { grade, checks };
}

// ---------------------------------------------------------------------------
// Direction for James (2026-10-29, per Chad: "actionable items, direction if
// you will, for james"). Each list is ranked by what's most worth his time.
export interface DirRow {
  outlet_id: string | null;
  name: string;
  city: string | null;
  detail: string;
  sub: string;
  value: string;
}
export interface DirList {
  key: string;
  title: string;
  why: string;
  rows: DirRow[];
}
export interface WorkingRow {
  label: string;
  committed: number;
  bought: number;
}

export function directionFor(res: JeResult, data: JeData): { lists: DirList[]; working: { packages: WorkingRow[]; premise: WorkingRow[] } } {
  const through = data.as_of ?? new Date().toISOString().slice(0, 10);
  const daysSince = (d: string) => Math.round((t(through) - t(d)) / DAY);
  const ck = data.checkins;
  const byOutlet = new Map<string, JeCheckin[]>();
  for (const c of ck) {
    const l = byOutlet.get(c.outlet_id);
    if (l) l.push(c);
    else byOutlet.set(c.outlet_id, [c]);
  }
  const salesBy = new Map<string, JeSale[]>();
  for (const s of data.sales) {
    const l = salesBy.get(s.outlet_id);
    if (l) l.push(s);
    else salesBy.set(s.outlet_id, [s]);
  }
  const firstVisit = (o: string) => (byOutlet.get(o) ?? []).reduce((m, c) => (!m || c.checkin_date < m ? c.checkin_date : m), "");
  const buyDaysAfter = (o: string, from: string) =>
    Array.from(new Set((salesBy.get(o) ?? []).flatMap((s) => [s.first_buy_in_month, s.last_buy_date]).filter((d): d is string => !!d && d >= from))).sort();
  const lastCk = (o: string) => (byOutlet.get(o) ?? []).reduce<JeCheckin | null>((m, c) => (!m || c.checkin_date > m.checkin_date ? c : m), null);

  // 1. Chase these commitments: said yes 30+ days ago, nothing ordered since.
  const chase: DirRow[] = [];
  const seen1 = new Set<string>();
  for (const c of [...res.commitments].sort((a, b) => b.ce12 - a.ce12 || b.date.localeCompare(a.date))) {
    if (c.fill !== "none" || seen1.has(c.outlet_id)) continue;
    if (buyDaysAfter(c.outlet_id, c.date).length) continue; // bought later after all
    seen1.add(c.outlet_id);
    chase.push({
      outlet_id: c.outlet_id,
      name: c.name,
      city: c.city,
      detail: c.items.length ? c.items.join("; ") : "Products not written down",
      sub: `Committed ${fmtShort(c.date)} · ${daysSince(c.date)} days, no order`,
      value: c.ce12 ? `${ce1(c.ce12)} CE/yr` : "",
    });
  }

  // 2. Get the reorder: one buy after his visit, 30+ days ago.
  const reorder: DirRow[] = [];
  byOutlet.forEach((list, o) => {
    const days = buyDaysAfter(o, firstVisit(o));
    if (days.length !== 1 || daysSince(days[0]) < 30) return;
    const rows = (salesBy.get(o) ?? []).filter((s) => s.last_buy_date === days[0] || s.first_buy_in_month === days[0]);
    const ce = rows.reduce((x, s) => x + (Number(s.ce) || 0), 0);
    const what = Array.from(new Set(rows.map((s) => `${s.product}${s.size ? ` (${s.size})` : ""}`))).join("; ");
    reorder.push({ outlet_id: o, name: list[0].name, city: list[0].city, detail: what || "—", sub: `Bought ${fmtShort(days[0])} · ${daysSince(days[0])} days, no reorder`, value: `${ce1(ce)} CE` });
  });
  reorder.sort((a, b) => parseFloat(b.value) - parseFloat(a.value));

  // 3 + 4. Targets.
  const notVisited: DirRow[] = [];
  const notBuying: DirRow[] = [];
  for (const tg of data.targets) {
    const visits = tg.outlet_id ? byOutlet.get(tg.outlet_id) ?? [] : [];
    if (!visits.length) {
      notVisited.push({ outlet_id: tg.outlet_id, name: tg.name, city: null, detail: tg.why ?? "", sub: `${tg.tier ?? ""} · ${tg.class_of_trade === "On" ? "On premise" : "Off premise"}`, value: tg.tier ?? "" });
      continue;
    }
    const v0 = firstVisit(tg.outlet_id!);
    if (buyDaysAfter(tg.outlet_id!, v0).length) continue;
    const last = lastCk(tg.outlet_id!);
    notBuying.push({
      outlet_id: tg.outlet_id,
      name: tg.name,
      city: visits[0].city,
      detail: lastNote(last) || tg.why || "",
      sub: `${visits.length} visit${visits.length === 1 ? "" : "s"} · last ${fmtShort(last!.checkin_date)} · no order since`,
      value: tg.tier ?? "",
    });
  }

  // 5. Win back lapsed buyers James hasn't visited.
  const lapsed: DirRow[] = (data.lapsed ?? [])
    .filter((a) => !byOutlet.has(a.outlet_id))
    .sort((a, b) => (Number(b.ce_12mo) || 0) - (Number(a.ce_12mo) || 0))
    .map((a) => ({
      outlet_id: a.outlet_id,
      name: a.name,
      city: a.city,
      detail: a.premise ? `${a.premise} premise` : "",
      sub: `Last order ${a.last_buy_date ? fmtShort(a.last_buy_date) : "—"} · ${a.last_buy_date ? daysSince(a.last_buy_date) : "?"} days ago · never visited by James`,
      value: `${ce1(Number(a.ce_12mo) || 0)} CE/yr`,
    }));

  // 5b. Buying accounts James hasn't visited (Chad, 2026-10-29): what they buy,
  // and the most-bought Markstein items (same premise) they don't carry yet.
  const popular = { On: [] as string[], Off: [] as string[] };
  for (const p of data.popular ?? []) (p.premise === "On" ? popular.On : popular.Off).push(p.item);
  const unvisited: DirRow[] = (data.unvisited_buyers ?? [])
    .filter((a) => !byOutlet.has(a.outlet_id))
    .sort((a, b) => (Number(b.ce_12mo) || 0) - (Number(a.ce_12mo) || 0))
    .map((a) => {
      const items = a.items ?? [];
      const missing = (a.premise && /on/i.test(a.premise) ? popular.On : popular.Off).filter((x) => !items.includes(x)).slice(0, 3);
      return {
        outlet_id: a.outlet_id,
        name: a.name,
        city: a.city,
        detail: `Buys: ${items.length ? items.join("; ") : "—"}${missing.length ? ` · Doesn't carry yet: ${missing.join("; ")}` : ""}`,
        sub: `Last order ${a.last_buy_date ? fmtShort(a.last_buy_date) : "—"} · ${a.last_buy_date ? daysSince(a.last_buy_date) : "?"} days ago · never visited by James`,
        value: `${ce1(Number(a.ce_12mo) || 0)} CE/yr`,
      };
    });

  // 6. Stop spending time here: 3+ visits, nothing bought since the first.
  const stop: DirRow[] = [];
  byOutlet.forEach((list, o) => {
    if (list.length < 3) return;
    if (buyDaysAfter(o, firstVisit(o)).length) return;
    const last = lastCk(o)!;
    stop.push({ outlet_id: o, name: list[0].name, city: list[0].city, detail: lastNote(last), sub: `${list.length} visits · last ${fmtShort(last.checkin_date)} · nothing ordered`, value: `${list.length} visits` });
  });
  stop.sort((a, b) => parseInt(b.value) - parseInt(a.value));

  // 7. What's working: commitments that turned into orders, by package and premise.
  const pk = new Map<string, WorkingRow>();
  const pr = new Map<string, WorkingRow>();
  const PK: Record<string, string> = { "12oz": "12 oz cans", "16oz": "16 oz 4-packs", "19.2oz": "19.2 oz singles", "1/6 bbl": "1/6 bbl kegs", "1/2 bbl": "1/2 bbl kegs" };
  for (const c of res.commitments) {
    if (c.fill === "pending") continue;
    const p = c.premise === "On" ? "On premise" : c.premise === "Off" ? "Off premise" : "Premise not known";
    const r = pr.get(p) ?? { label: p, committed: 0, bought: 0 };
    r.committed++;
    if (c.delivered) r.bought++;
    pr.set(p, r);
    const boughtSizes = new Set(
      (salesBy.get(c.outlet_id) ?? []).filter((s) => [s.first_buy_in_month, s.last_buy_date].some((d) => d && d >= c.date && d <= addDays(c.date, 30))).map((s) => s.size ?? ""),
    );
    for (const it of c.items) {
      const sz = sizeKey(it);
      if (!sz) continue;
      const w = pk.get(sz) ?? { label: PK[sz] ?? sz, committed: 0, bought: 0 };
      w.committed++;
      if (boughtSizes.has(sz)) w.bought++;
      pk.set(sz, w);
    }
  }
  const byRate = (a: WorkingRow, b: WorkingRow) => b.bought / (b.committed || 1) - a.bought / (a.committed || 1);

  return {
    lists: [
      { key: "chase", title: "Chase these commitments", why: "Said yes 30+ days ago, nothing ordered since", rows: chase },
      { key: "reorder", title: "Get the reorder", why: "Bought once after his visit, no reorder in 30+ days", rows: reorder },
      { key: "tnv", title: "Targets not visited yet", why: "On the target list, no check-in yet", rows: notVisited },
      { key: "tnb", title: "Targets visited, not buying", why: "Visited, no order since his first visit", rows: notBuying },
      { key: "lapsed", title: "Win back lapsed buyers", why: "Bought in the last year, nothing in 90+ days, never visited by James", rows: lapsed },
      { key: "unvisited", title: "Buying accounts he hasn't visited", why: "Ordered in the last 90 days, never visited by James", rows: unvisited },
      { key: "stop", title: "Stop spending time here", why: "3+ visits, nothing ordered since the first", rows: stop },
    ],
    working: { packages: Array.from(pk.values()).sort(byRate), premise: Array.from(pr.values()).sort(byRate) },
  };
}

// James's last note at an account, shortened.
function lastNote(c: JeCheckin | null): string {
  const n = (c?.notes ?? "").trim();
  if (!n) return c?.outcome ? `Last outcome: ${c.outcome}` : "";
  return `Last visit: ${n.length > 160 ? `${n.slice(0, 157)}…` : n}`;
}

function fmtShort(d: string) {
  const [, m, dd] = d.split("-").map(Number);
  return `${m}/${dd}`;
}
