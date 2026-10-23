// Brew Planner (added 2026-10-23, per Chad — EXPERIMENTAL). Plan + test
// results: claude/brew-planner-plan.md. Approved preview: the "FCB Brew
// Planner" artifact (claude/brew-planner-preview.html).
//
// Says, per base beer, whether to brew this 2-week cycle and how much, from:
//   - LilyPad store sales (sales_account_sales) for the measured distributors,
//   - delivered POs (distributor_pos + allocations) for Superior and Coast,
//   - each distributor's newest Ekos count (distributor_inventory),
//   - our warehouse (this week's Inventory & Allocation, minus delivered POs),
//   - what's in tank (ekos_tanks).
// This file holds the base-beer list and the math. app/(app)/brew-planner/
// page.tsx gathers the data on the server; components/BrewPlannerClient.tsx
// draws the page and re-runs plan() whenever a setting changes.

// ---------------------------------------------------------------------------
// Base beers. Chad (2026-10-23): "if we brew big daddy, that is also Captain
// WC. Same beer, same hops" / "Captain Hazy, is same beer same hops as Juicy,
// and Mystic Haze. Its the same base beer for mango, but we will pull off what
// we need, add mango, and can make mango" — "can it OR keg is".
// `lily` = LilyPad product names, `app` = app product name test,
// `tank` = matched against an Ekos tank's batch title first, then its product.
// ---------------------------------------------------------------------------
export interface BrandDef {
  key: string;
  name: string;
  lily: string[];
  app: RegExp;
  pullOff?: boolean; // pulled off the base batch and finished separately (Mango Bomb)
}
export interface BaseDef {
  key: string;
  name: string;
  brands: BrandDef[];
  tank: RegExp;
  lead: number; // default days brew → packaged
}

export const BASES: BaseDef[] = [
  {
    key: "HZ",
    name: "Captain Hazy base",
    tank: /hazy|juicy|mystic|mango/i,
    lead: 18,
    brands: [
      { key: "CH", name: "Capt. Hazy", lily: ["Captain Save A Hop HAZY IPA"], app: /^Capt\.\s*Hazy\s*\(/i },
      { key: "JU", name: "Juicy", lily: ["Juicy NE IPA"], app: /^Juicy/i },
      { key: "MY", name: "Mystic Haze", lily: ["Mystic Haze IPA"], app: /^Mystic Haze/i },
      { key: "MB", name: "Mango Bomb", lily: ["Mango Bomb"], app: /^Mango Bomb/i, pullOff: true },
    ],
  },
  {
    key: "BD",
    name: "Big Daddy base",
    tank: /big\s*daddy|\bWC\b/i,
    lead: 21,
    brands: [
      { key: "BD", name: "Big Daddy", lily: ["Big Daddy IPA"], app: /^Big Daddy/i },
      { key: "WC", name: "Capt. WC", lily: ["Captain Save A Hop WC IPA"], app: /^Capt\.\s*WC/i },
    ],
  },
  { key: "PR", name: "Prohibition Red Ale", tank: /prohibition/i, lead: 21, brands: [{ key: "PR", name: "Prohibition", lily: ["Prohibition Red Ale"], app: /^Prohibition/i }] },
  { key: "PV", name: "Peachy Vibes", tank: /peachy/i, lead: 21, brands: [{ key: "PV", name: "Peachy Vibes", lily: ["Peachy Vibes"], app: /^Peachy/i }] },
  { key: "NP", name: "Nectarine Pie of the Tiger", tank: /nectarine/i, lead: 21, brands: [{ key: "NP", name: "Nectarine Pie", lily: ["Nectarine Pie of the Tiger"], app: /^Nectarine/i }] },
  { key: "LM", name: "Lime 30 Lager", tank: /lime/i, lead: 35, brands: [{ key: "LM", name: "Lime 30", lily: [], app: /^Lime 30/i }] },
  { key: "ME", name: "Metropolis Lager", tank: /metropolis/i, lead: 35, brands: [{ key: "ME", name: "Metropolis", lily: [], app: /^Metropolis/i }] },
  {
    key: "CI",
    name: "Ciders",
    tank: /cider|hatchet|pitchfork|sickle|hacksaw/i,
    lead: 21,
    brands: [
      { key: "HA", name: "The Hatchet", lily: [], app: /hatchet/i },
      { key: "PF", name: "The Pitchfork", lily: ["The Pitchfork - Cider"], app: /pitchfork/i },
      { key: "SI", name: "The Sickle", lily: [], app: /sickle/i },
      { key: "HS", name: "The Hacksaw", lily: [], app: /hacksaw/i },
    ],
  },
];

// Distributors with Ekos counts + LilyPad sales ("Measured"), and the ones
// worked out from our deliveries ("Estimated"). Saccani is closed (Chad,
// 2026-10-23) — never "needs stock"; its sales only count via the
// "Saccani sales moving to Mussetter" setting.
export const MEASURED = ["Guardian", "Markstein", "Matagrano", "Mussetter", "Valley Wide"];
export const ESTIMATED = ["Superior", "Coast"];

// Distributor names in the app have split / old duplicates
// ("Markstein C", "Matagrano Cans 1", "Valleywide" …) → one name.
export function distName(name: string): string {
  const n = name.trim();
  if (/^matagrano/i.test(n)) return "Matagrano";
  if (/^markstein/i.test(n)) return "Markstein";
  if (/^valley\s*wide|^valleywide/i.test(n)) return "Valley Wide";
  return n;
}

export const CE_PER_BBL = 13.78; // 1 case-equivalent = 2.25 gal

// bbl in one unit of an app product, from the package in its name.
export function bblPerUnit(productName: string): number {
  const n = productName.toLowerCase();
  if (/1\/2/.test(n)) return 0.5;
  if (/1\/6/.test(n)) return 1 / 6;
  if (/19\.2/.test(n)) return 0.05806; // 12 × 19.2 oz
  if (/12\s*oz|4x6/.test(n)) return 0.07258; // 24 × 12 oz
  if (/16\s*oz/.test(n)) return 0.09677; // 24 × 16 oz
  return 0;
}

export function brandOfProduct(productName: string): { base: string; brand: string } | null {
  for (const b of BASES) for (const br of b.brands) if (br.app.test(productName)) return { base: b.key, brand: br.key };
  return null;
}

export function baseOfTank(batchTitle: string | null, productName: string | null): string | null {
  for (const text of [batchTitle ?? "", productName ?? ""]) {
    if (!text) continue;
    const hit = BASES.find((b) => b.tank.test(text));
    if (hit) return hit.key;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Data handed from the server to the page (all bbl unless noted).
// ---------------------------------------------------------------------------
export interface PlannerData {
  today: string; // YYYY-MM-DD (Pacific)
  lily: {
    months: string[]; // 3 full months, oldest first, + the current partial month (YYYY-MM)
    partialFactor: number; // scales the partial month to a full one
    // ce[brand][distributor] = [m1, m2, m3, partial]
    ce: Record<string, Record<string, number[]>>;
    kegCe: Record<string, number>; // per brand, weighted CE sold in kegs
    canCe: Record<string, number>;
  };
  distStock: Record<string, Record<string, number>>; // [distributor][brand]
  distCountAt: Record<string, string | null>; // newest Ekos count per measured distributor
  shipments: Record<string, { date: string; items: Record<string, number> }[]>; // delivered POs, Superior / Coast / everyone
  windowStart: string; // first day of the shipments window
  warehouse: Record<string, number>; // [brand]
  warehouseWeek: string | null;
  tanks: { tank: string; base: string; bbl: number; start: string | null; stage: string | null; label: string }[];
  emptyTanks: number;
  ignored: { what: string; bbl: number }[]; // rows left out on purpose (Superior's odd Ekos row …)
  fresh: { label: string; value: string; old: boolean }[];
}

export interface Settings {
  targetWeeks: number;
  cycleWeeks: number;
  safetyWeeks: number;
  maxDays: number;
  yieldPct: number;
  sizes: string;
  minBrew: number;
  recentWeight: number;
  saccaniPct: number;
  lead: Record<string, number>;
}

export const DEFAULT_SETTINGS: Settings = {
  targetWeeks: 4,
  cycleWeeks: 2,
  safetyWeeks: 3,
  maxDays: 60,
  yieldPct: 95,
  sizes: "7, 15, 30, 60",
  minBrew: 5,
  recentWeight: 2,
  saccaniPct: 0,
  lead: Object.fromEntries(BASES.map((b) => [b.key, b.lead])),
};

const DAY = 864e5;
const d = (s: string) => new Date(`${s}T12:00:00`);
export const addDays = (x: Date, n: number) => new Date(x.getTime() + n * DAY);

// ---------------------------------------------------------------------------
// The math (same as the approved preview).
// ---------------------------------------------------------------------------
function lilyRate(D: PlannerData, S: Settings, brand: string, dist: string): number {
  const v = D.lily.ce[brand]?.[dist];
  if (!v) return 0;
  const [m1, m2, m3, part] = v;
  let ce: number;
  if (m1 <= 0 && m2 <= 0) ce = (m3 + part * D.lily.partialFactor) / 2; // new distributor (Mussetter started Sept)
  else ce = (m1 + m2 + m3 * S.recentWeight) / (2 + S.recentWeight);
  return (Math.max(ce, 0) / CE_PER_BBL) * 12 / 52;
}

function shipList(D: PlannerData, dist: string, brand: string) {
  return (D.shipments[dist] ?? []).filter((x) => (x.items[brand] ?? 0) > 0).sort((a, b) => a.date.localeCompare(b.date));
}
function shipRate(D: PlannerData, dist: string, brand: string): number {
  const sh = shipList(D, dist, brand);
  if (sh.length >= 2) {
    const wks = (d(sh[sh.length - 1].date).getTime() - d(sh[0].date).getTime()) / DAY / 7;
    const tot = sh.slice(0, -1).reduce((a, x) => a + x.items[brand], 0);
    return wks > 0 ? tot / wks : 0;
  }
  if (sh.length === 1) {
    const wks = Math.max(1, (d(D.today).getTime() - d(D.windowStart).getTime()) / DAY / 7);
    return sh[0].items[brand] / wks;
  }
  return 0;
}
function estStock(D: PlannerData, dist: string, brand: string): number {
  const sh = shipList(D, dist, brand);
  if (!sh.length) return 0;
  const tot = sh.reduce((a, x) => a + x.items[brand], 0);
  const wks = (d(D.today).getTime() - d(sh[0].date).getTime()) / DAY / 7;
  return Math.max(0, tot - shipRate(D, dist, brand) * wks);
}

export interface DistRow { dist: string; q: "Measured" | "Estimated"; rate: number; stock: number }
export interface BrandRow { key: string; name: string; pullOff: boolean; share: number; rate: number; stock: number; weeks: number | null; kegShare: number | null; fromBatch: number }
export interface TankRow { tank: string; bbl: number; start: string | null; stage: string | null; label: string; ready: boolean; pkg: Date; out: number; days: number | null }
export interface Plan {
  base: BaseDef;
  demand: number;
  dstock: number;
  wh: number;
  inTank: number;
  cover: number | null;
  runout: Date | null;
  atLand: number;
  land: Date;
  rows: DistRow[];
  brands: BrandRow[];
  tanks: TankRow[];
  proj: { day: Date; stock: number; add: number }[];
  rec: { action: "Brew" | "Hold"; bbl: number; why: string; need?: number; sell?: number; warn?: string | null };
}

export const r1 = (x: number) => (Math.round(x * 10) / 10).toFixed(1);
export const fmtDay = (x: Date) => x.toLocaleDateString("en-US", { month: "short", day: "numeric" });

export function plan(D: PlannerData, S: Settings, base: BaseDef): Plan {
  const y = S.yieldPct / 100;
  const sizes = String(S.sizes).split(/[ ,]+/).map(Number).filter((x) => x > 0).sort((a, b) => a - b);
  const TODAY = d(D.today);
  const rowsBy = new Map<string, DistRow>();
  const brandRate: Record<string, number> = {};
  const brandStock: Record<string, number> = {};
  const add = (dist: string, q: DistRow["q"], brand: string, r: number, st: number) => {
    brandRate[brand] = (brandRate[brand] ?? 0) + r;
    brandStock[brand] = (brandStock[brand] ?? 0) + st;
    const row = rowsBy.get(dist) ?? { dist, q, rate: 0, stock: 0 };
    row.rate += r;
    row.stock += st;
    rowsBy.set(dist, row);
  };
  for (const br of base.brands) {
    for (const dist of MEASURED) {
      let r = br.lily.length ? lilyRate(D, S, br.key, dist) : shipRate(D, dist, br.key);
      if (dist === "Mussetter" && S.saccaniPct > 0) r += (lilyRate(D, S, br.key, "Saccani") * S.saccaniPct) / 100;
      const st = D.distStock[dist]?.[br.key] ?? 0;
      if (r || st) add(dist, "Measured", br.key, r, st);
    }
    for (const dist of ESTIMATED) {
      const r = shipRate(D, dist, br.key);
      const st = estStock(D, dist, br.key);
      if (r || st) add(dist, "Estimated", br.key, r, st);
    }
  }
  const rows = [...rowsBy.values()];
  const demand = rows.reduce((a, x) => a + x.rate, 0);
  const dstock = rows.reduce((a, x) => a + x.stock, 0);
  const wh = base.brands.reduce((a, br) => a + (D.warehouse[br.key] ?? 0), 0);
  const lead = S.lead[base.key] ?? base.lead;
  const tanks: TankRow[] = D.tanks
    .filter((t) => t.base === base.key)
    .map((t) => {
      const ready = /ready/i.test(t.stage ?? "");
      const pkg = ready || !t.start ? addDays(TODAY, 7) : addDays(d(t.start), lead);
      return { ...t, ready, pkg, out: t.bbl * y, days: t.start ? Math.round((TODAY.getTime() - d(t.start).getTime()) / DAY) : null };
    });

  let stock = dstock + wh;
  const proj: Plan["proj"] = [];
  let runout: Date | null = null;
  for (let w = 1; w <= 10; w++) {
    const day = addDays(TODAY, 7 * w);
    const prev = addDays(TODAY, 7 * (w - 1));
    const a = tanks.filter((t) => t.pkg <= day && t.pkg > prev).reduce((s, t) => s + t.out, 0);
    stock += a - demand;
    proj.push({ day, stock, add: a });
    if (stock < 0 && !runout) runout = day;
  }

  const land = addDays(TODAY, lead);
  const arriving = tanks.filter((t) => t.pkg <= land).reduce((s, t) => s + t.out, 0);
  const atLand = dstock + wh + arriving - (demand * lead) / 7;
  const need = (demand * (S.cycleWeeks + S.targetWeeks) - Math.max(atLand, 0)) / y;
  const nextLand = atLand - demand * S.cycleWeeks;
  let rec: Plan["rec"];
  if (demand <= 0 || nextLand >= demand * S.safetyWeeks || need < S.minBrew) {
    let why: string;
    if (demand <= 0) why = "No sales showing.";
    else if (nextLand >= demand * S.safetyWeeks)
      why = `If you wait a cycle, there's still ${r1(nextLand)} bbl (${r1(nextLand / demand)} weeks) when that batch would be ready.`;
    else why = `Short by only ${r1(Math.max(need, 0))} bbl, under the ${S.minBrew} bbl minimum.`;
    rec = { action: "Hold", bbl: 0, why };
  } else {
    let size = sizes.find((s) => s >= need) ?? sizes[sizes.length - 1];
    let sell = ((Math.max(atLand, 0) + size * y) / demand) * 7;
    let warn: string | null = null;
    if (sell > S.maxDays) {
      const smaller = sizes.filter((s) => s < size);
      const down = smaller[smaller.length - 1];
      if (down && ((Math.max(atLand, 0) + down * y) / demand) * 7 >= S.cycleWeeks * 7) {
        warn = `${size} bbl would take ${Math.round(sell)} days to sell, so it went down to ${down} bbl.`;
        size = down;
        sell = ((Math.max(atLand, 0) + size * y) / demand) * 7;
      } else warn = `Takes about ${Math.round(sell)} days to sell (limit ${S.maxDays}).`;
    }
    rec = {
      action: "Brew",
      bbl: size,
      need,
      sell,
      warn,
      why: `Brewed today it's ready about ${fmtDay(land)}. By then about ${r1(Math.max(atLand, 0))} bbl is left outside the tanks. You need ${r1(
        demand * (S.cycleWeeks + S.targetWeeks),
      )} bbl to cover ${S.cycleWeeks} weeks to the next batch plus ${S.targetWeeks} weeks of stock: ${r1(need)} bbl to brew before packaging loss.`,
    };
  }

  const batchOut = rec.action === "Brew" ? rec.bbl * y : 0;
  const brands: BrandRow[] =
    base.brands.length < 2
      ? []
      : base.brands.map((br) => {
          const rate = brandRate[br.key] ?? 0;
          const share = demand ? rate / demand : 0;
          const k = D.lily.kegCe[br.key] ?? 0;
          const c = D.lily.canCe[br.key] ?? 0;
          const st = brandStock[br.key] ?? 0;
          return {
            key: br.key,
            name: br.name,
            pullOff: !!br.pullOff,
            share,
            rate,
            stock: st,
            weeks: rate ? st / rate : null,
            kegShare: k + c > 0 ? k / (k + c) : null,
            fromBatch: batchOut * share,
          };
        });

  return {
    base,
    demand,
    dstock,
    wh,
    inTank: tanks.reduce((s, t) => s + t.bbl, 0),
    cover: demand ? (dstock + wh) / demand : null,
    runout,
    atLand,
    land,
    rows,
    brands,
    tanks,
    proj,
    rec,
  };
}
