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
export interface JeCompare {
  month: string;
  worked: boolean;
  ce: number;
  accounts: number;
}
export interface JeData {
  as_of: string | null;
  checkins: JeCheckin[];
  sales: JeSale[];
  targets: JeTarget[];
  compare: JeCompare[];
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
  compare: { month: string; jamesTy: number; jamesLy: number; otherTy: number; otherLy: number }[];
  commitments: { outlet_id: string; name: string; city: string | null; date: string; items: string[]; delivered: boolean; ce: number; fill: string }[];
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
    commitOut.push({ outlet_id: cm.c.outlet_id, name: cm.c.name, city: cm.c.city, date: cm.date, items, delivered, ce, fill });
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

  // James's stores vs every other Markstein store, by month since June, vs last year.
  const cmp = new Map<string, { jamesTy: number; jamesLy: number; otherTy: number; otherLy: number }>();
  const startMonth = "2026-06-01";
  for (const m of data.compare) {
    const mo = m.month.slice(0, 10);
    const y = Number(mo.slice(0, 4));
    const isTy = mo >= startMonth;
    const isLy = !isTy && y === 2025 && mo >= "2025-06-01";
    if (!isTy && !isLy) continue;
    const key = isTy ? mo : `2026${mo.slice(4)}`;
    const cur = cmp.get(key) ?? { jamesTy: 0, jamesLy: 0, otherTy: 0, otherLy: 0 };
    const v = Number(m.ce) || 0;
    if (isTy) {
      if (m.worked) cur.jamesTy += v;
      else cur.otherTy += v;
    } else if (m.worked) cur.jamesLy += v;
    else cur.otherLy += v;
    cmp.set(key, cur);
  }
  const lastMonth = `${end.slice(0, 7)}-01`;
  const compare = Array.from(cmp.entries())
    .filter(([k]) => k <= lastMonth)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([month, v]) => ({ month, ...v }));

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
    compare,
    commitments: commitOut,
  };
}
