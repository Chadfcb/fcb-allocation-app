// Sales Dashboard (Main → Sales Dashboard), added 2026-10-08, per Chad.
// Project doc: claude/sales-dashboard-plan.md. Data comes from the functions
// in sql/sales_dashboard.sql; the gap math happens here so it's easy to read.
//
// Rules Chad approved (2026-10-08, "yes to all"):
//   * Carried = the store bought the item (product + size) in the 90 days
//     before the data's as-of date.
//   * Gap = the store doesn't carry an item that is Mandate for it, or that
//     at least one other store in the same chain (same distributor) carries.
//   * Flex / Mandate is per chain + item, the same for every distributor.
//     Starting point: items on Sales → Chain Mandates are Mandate, items on
//     Sales → Chain Authorizations are Flex. A pick made on the dashboard wins.
//     When the Chain Mandates page lists specific store numbers for an item,
//     it's Mandate for those stores, and Flex for the rest of the chain.
//   * Items are product + size. Hidden products are left out.

export const CARRIED_DAYS = 90;

export type ItemStatus = "mandate" | "flex" | "none";
export type ListType = "mandate" | "auth";

export const STATUS_INFO: Record<ItemStatus, { label: string; color: string; short: string }> = {
  mandate: { label: "Mandate", short: "M", color: "#ef4444" },
  flex: { label: "Flex", short: "F", color: "#f59e0b" },
  none: { label: "Not set", short: "–", color: "#737373" },
};

export interface DashChain {
  chain: string;
  stores: number;
  by_distributor: Record<string, number>;
  auto_names: string[];
}
export interface DashProduct {
  product: string;
  size: string;
  ce: number;
  last_buy: string | null;
}
export interface ListChain {
  id: string;
  name: string;
}
export interface MandateItem {
  id: string;
  chain_id: string;
  text: string;
  package: string | null;
  stores: string[];
}
export interface AuthItem {
  id: string;
  chain_id: string;
  text: string;
}
export interface ListLink {
  id: string;
  list_type: ListType;
  list_chain_id: string;
  chain_name: string | null;
}
export interface ItemLink {
  id: string;
  list_type: ListType;
  list_item_id: string;
  product: string | null;
  size: string | null;
}
export interface StatusRow {
  id: string;
  chain_name: string;
  product: string;
  size: string;
  status: ItemStatus;
}
export interface NameRow {
  id: string;
  auto_name: string;
  chain_name: string | null;
  not_chain: boolean;
}
export interface DashOverview {
  as_of: string | null;
  chains: DashChain[];
  not_chains: string[];
  distributors: { distributor: string; stores: number }[];
  products: DashProduct[];
  mandate_chains: ListChain[];
  mandate_items: MandateItem[];
  auth_chains: ListChain[];
  auth_items: AuthItem[];
  list_links: ListLink[];
  item_links: ItemLink[];
  statuses: StatusRow[];
  names: NameRow[];
}

export interface GapStore {
  outlet_id: string;
  name: string;
  address: string | null;
  city: string | null;
  zip: string | null;
  distributor: string;
  premise: string | null;
  last_buy_date: string | null;
  store_no: string | null;
}
export interface GapBuy {
  outlet_id: string;
  product: string;
  size: string;
  last_buy: string;
  ce90: number;
  ce12: number;
}
export interface GapByStoreResult {
  as_of: string;
  stores: GapStore[];
  buys: GapBuy[];
}
export interface GapByItemResult {
  as_of: string;
  chains: { chain: string; stores: number; store_nos: string[] }[];
  cells: { chain: string; product: string; size: string; carried: number; ce: number; store_nos: string[] }[];
}

export const itemKey = (product: string, size: string) => `${product}\u0001${size}`;
export const splitKey = (key: string) => {
  const [product, size] = key.split("\u0001");
  return { product, size };
};
export const itemLabel = (product: string, size: string) => `${product} · ${size}`;

// ---------------------------------------------------------------------------
// Matching the hand-typed items on Chain Mandates / Chain Authorizations to
// our product + size names. Best guess only — anything it can't tell apart is
// left for Chad to pick on the Chain setup tab.
// ---------------------------------------------------------------------------

// Size from text like "4PKC", "4/16", "16FZ CAN 4PK", "19C", "19.2Z", "6/12C",
// "6PK CAN", "12oz 6-Pack", "1/2 BBL".
export function guessSize(text: string): string | null {
  const t = ` ${text.toUpperCase()} `;
  if (/1\/2\s*(BBL|KEG)|HALF\s*BARREL/.test(t)) return "1/2 bbl";
  if (/1\/6\s*(BBL|KEG)|SIXTEL/.test(t)) return "1/6 bbl";
  if (/19(\.2)?\s*(OZ|Z|C|FZ)?\b|19OZ/.test(t)) return "19.2oz";
  if (/22\s*OZ/.test(t)) return "22oz bottle";
  if (/\b4\s*\/\s*16|16\s*(OZ|FZ|C)?\b|\b4\s*-?\s*P(K|ACK)?\s*(C|CN|CAN)?\b|4PKC/.test(t)) return "16oz";
  if (/\b6\s*\/\s*12|12\s*(OZ|FZ|C)\b|\b6\s*-?\s*P(K|ACK)?\b|6PKC|6PACK/.test(t)) return "12oz";
  return null;
}

// Words that don't tell products apart.
const GENERIC = new Set([
  "FULL", "CIRCLE", "CRICLE", "SPEAKEASY", "SONOMA", "BREWING", "BREW", "CO", "COMPANY", "IPA", "ALE", "NE", "WC",
  "THE", "OF", "A", "AN", "CIDER", "CAN", "CANS", "CN", "C", "PK", "PACK", "FZ", "OZ", "Z", "CASE", "BEER", "AND",
  "LAGER", "STYLE", "SERIES", "ROTATING", "ROTAT", "SERI", "DOUBLE", "IMPERIA", "MILKS", "LACTOSE", "SOUR",
  "WEST", "COAST", "PALE",
]);

function tokens(text: string): string[] {
  return text
    .toUpperCase()
    .replace(/[^A-Z0-9 ]+/g, " ")
    .split(/\s+/)
    .filter((w) => w && !/\d/.test(w) && !GENERIC.has(w) && !/^\d*PKC?S?$/.test(w));
}

// "CAP" ~ "CAPTAIN", "TGR" ~ "TIGER", "APRCT" ~ "APRICOT", "VIBE" ~ "VIBES".
function wordMatch(a: string, b: string): boolean {
  if (a === b) return true;
  const [s, l] = a.length <= b.length ? [a, b] : [b, a];
  if (s.length < 3 || s[0] !== l[0]) return false;
  if (l.startsWith(s)) return true;
  let i = 0;
  for (const ch of l) if (ch === s[i]) i++;
  if (i === s.length) return true;
  // one typo in a longer word: "NECTERINE" ~ "NECTARINE"
  if (a.length === b.length && a.length >= 5) {
    let diff = 0;
    for (let k = 0; k < a.length; k++) if (a[k] !== b[k]) diff++;
    return diff <= 1;
  }
  return false;
}

export interface MatchGuess {
  product: string;
  size: string | null;
}

// Picks the product whose name best fits the text. Unmatched words on either
// side count against a product (words in the product's own name count half).
// Returns null when nothing fits well or two products tie.
export function guessProduct(text: string, productNames: string[]): MatchGuess | null {
  const want = tokens(text);
  if (!want.length) return null;
  let best: { p: string; score: number } | null = null;
  let second = 0;
  for (const p of productNames) {
    const have = [...new Set(tokens(p))];
    if (!have.length) continue;
    const matchedHave = have.filter((h) => want.some((w) => wordMatch(w, h))).length;
    const unmatchedWant = want.filter((w) => !have.some((h) => wordMatch(w, h))).length;
    if (!matchedHave) continue;
    const score = matchedHave / (matchedHave + 0.5 * (have.length - matchedHave) + unmatchedWant);
    if (!best || score > best.score) {
      second = best?.score ?? 0;
      best = { p, score };
    } else if (score > second) second = score;
  }
  if (!best || best.score < 0.65 || Math.abs(best.score - second) < 0.001) return null;
  return { product: best.p, size: guessSize(text) };
}

// Which dashboard chain a Chain Mandates / Chain Authorizations chain is, by
// name: "Raley's" → RALEYS, "TotalWine" → TOTAL WINE & MORE, "World Market" →
// COST PLUS WORLD MARKET. Biggest chain wins when several fit.
export function guessChain(listName: string, chains: DashChain[]): string | null {
  const c = (s: string) => s.toUpperCase().replace(/[^A-Z0-9]/g, "");
  const want = c(listName);
  if (!want) return null;
  const exact = chains.find((ch) => c(ch.chain) === want);
  if (exact) return exact.chain;
  const fits = chains.filter((ch) => {
    const have = c(ch.chain);
    return have.startsWith(want) || want.startsWith(have) || (want.length >= 5 && have.includes(want));
  });
  fits.sort((a, b) => b.stores - a.stores);
  return fits[0]?.chain ?? null;
}

// ---------------------------------------------------------------------------
// Flex / Mandate per chain + item
// ---------------------------------------------------------------------------

export interface ChainRules {
  // item key → status picked on the dashboard (wins over everything)
  picked: Map<string, StatusRow>;
  // item key → from the Chain Mandates page: null = whole chain, else store numbers
  mandate: Map<string, Set<string> | null>;
  // item keys on the Chain Authorizations page
  flex: Set<string>;
}

export interface Resolved {
  links: Map<string, { product: string | null; size: string | null; guessed: boolean }>; // `${type}:${itemId}`
  chainOf: Map<string, { chain: string | null; guessed: boolean }>; // `${type}:${listChainId}`
  rules: Map<string, ChainRules>; // chain name → rules
}

export function resolveLists(ov: DashOverview): Resolved {
  const productNames = [...new Set(ov.products.map((p) => p.product))];
  const sizesFor = new Map<string, Set<string>>();
  for (const p of ov.products) {
    if (!sizesFor.has(p.product)) sizesFor.set(p.product, new Set());
    sizesFor.get(p.product)!.add(p.size);
  }
  const savedItem = new Map(ov.item_links.map((l) => [`${l.list_type}:${l.list_item_id}`, l]));
  const savedChain = new Map(ov.list_links.map((l) => [`${l.list_type}:${l.list_chain_id}`, l]));

  const links: Resolved["links"] = new Map();
  const linkFor = (type: ListType, id: string, text: string) => {
    const k = `${type}:${id}`;
    const saved = savedItem.get(k);
    if (saved) {
      links.set(k, { product: saved.product, size: saved.size, guessed: false });
    } else {
      const g = guessProduct(text, productNames);
      // Only keep a guessed size the product is actually sold in.
      const size = g?.size && sizesFor.get(g.product)?.has(g.size) ? g.size : null;
      links.set(k, { product: g && size ? g.product : null, size: g && size ? size : null, guessed: true });
    }
    return links.get(k)!;
  };

  const chainOf: Resolved["chainOf"] = new Map();
  const chainFor = (type: ListType, c: ListChain) => {
    const k = `${type}:${c.id}`;
    const saved = savedChain.get(k);
    chainOf.set(k, saved ? { chain: saved.chain_name, guessed: false } : { chain: guessChain(c.name, ov.chains), guessed: true });
    return chainOf.get(k)!.chain;
  };

  const rules: Resolved["rules"] = new Map();
  const rulesFor = (chain: string) => {
    if (!rules.has(chain)) rules.set(chain, { picked: new Map(), mandate: new Map(), flex: new Set() });
    return rules.get(chain)!;
  };

  const mChain = new Map(ov.mandate_chains.map((c) => [c.id, chainFor("mandate", c)]));
  for (const it of ov.mandate_items) {
    const l = linkFor("mandate", it.id, `${it.text} ${it.package ?? ""}`);
    const chain = mChain.get(it.chain_id);
    if (!chain || !l.product || !l.size) continue;
    const r = rulesFor(chain);
    const key = itemKey(l.product, l.size);
    const prev = r.mandate.get(key);
    if (!it.stores.length || prev === null) r.mandate.set(key, null);
    else r.mandate.set(key, new Set([...(prev ?? []), ...it.stores]));
  }
  const aChain = new Map(ov.auth_chains.map((c) => [c.id, chainFor("auth", c)]));
  for (const it of ov.auth_items) {
    const l = linkFor("auth", it.id, it.text);
    const chain = aChain.get(it.chain_id);
    if (!chain || !l.product || !l.size) continue;
    rulesFor(chain).flex.add(itemKey(l.product, l.size));
  }
  for (const s of ov.statuses) rulesFor(s.chain_name).picked.set(itemKey(s.product, s.size), s);
  return { links, chainOf, rules };
}

// Status of one item for one store of a chain (storeNo null = the chain as a whole).
export function statusFor(rules: ChainRules | undefined, key: string, storeNo: string | null): ItemStatus {
  if (!rules) return "none";
  const picked = rules.picked.get(key);
  if (picked) return picked.status;
  if (rules.mandate.has(key)) {
    const stores = rules.mandate.get(key);
    if (stores === null || stores === undefined) return "mandate";
    if (storeNo === null) return "mandate";
    if (stores.has(storeNo)) return "mandate";
    return "flex";
  }
  if (rules.flex.has(key)) return "flex";
  return "none";
}

// Where a chain-level status came from, for the Items strip.
export function statusSource(rules: ChainRules | undefined, key: string): string {
  if (!rules) return "";
  if (rules.picked.has(key)) return "set on the dashboard";
  if (rules.mandate.has(key)) {
    const s = rules.mandate.get(key);
    return s ? `Chain Mandates (${s.size} store${s.size === 1 ? "" : "s"})` : "Chain Mandates";
  }
  if (rules.flex.has(key)) return "Chain Authorizations";
  return "";
}

// ---------------------------------------------------------------------------
// Gap math, By store
// ---------------------------------------------------------------------------

export interface StoreLine {
  key: string;
  product: string;
  size: string;
  status: ItemStatus;
  carried: boolean;
  lastBuy: string | null;
  ce90: number;
  ce12: number;
  othersCarry: number; // other stores in the chain (same distributor) carrying it
}
export interface StoreReport {
  store: GapStore;
  carried: StoreLine[];
  gaps: StoreLine[];
  mandateGaps: number;
}

export function addDays(iso: string, days: number): string {
  const d = new Date(`${iso.slice(0, 10)}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

export function buildStoreReports(data: GapByStoreResult, rules: ChainRules | undefined): StoreReport[] {
  const cutoff = addDays(data.as_of, -CARRIED_DAYS); // carried = last buy after this date
  const byStore = new Map<string, Map<string, GapBuy>>();
  for (const b of data.buys) {
    if (!byStore.has(b.outlet_id)) byStore.set(b.outlet_id, new Map());
    byStore.get(b.outlet_id)!.set(itemKey(b.product, b.size), { ...b, ce90: Number(b.ce90) || 0, ce12: Number(b.ce12) || 0 });
  }
  const isCarried = (b: GapBuy | undefined) => !!b && b.last_buy > cutoff && b.ce90 > 0;

  // Per distributor: item key → stores carrying it
  const carriers = new Map<string, Map<string, Set<string>>>();
  for (const s of data.stores) {
    if (!carriers.has(s.distributor)) carriers.set(s.distributor, new Map());
    const m = carriers.get(s.distributor)!;
    for (const [k, b] of byStore.get(s.outlet_id) ?? []) {
      if (!isCarried(b)) continue;
      if (!m.has(k)) m.set(k, new Set());
      m.get(k)!.add(s.outlet_id);
    }
  }
  // Items this chain should be checked for: anything carried + every Mandate item.
  const mandateKeys = new Set<string>();
  if (rules) {
    for (const k of rules.mandate.keys()) mandateKeys.add(k);
    for (const [k, r] of rules.picked) if (r.status === "mandate") mandateKeys.add(k);
  }

  return data.stores.map((store) => {
    const buys = byStore.get(store.outlet_id) ?? new Map<string, GapBuy>();
    const distCarriers = carriers.get(store.distributor) ?? new Map<string, Set<string>>();
    const keys = new Set<string>([...distCarriers.keys(), ...mandateKeys, ...buys.keys()]);
    const carried: StoreLine[] = [];
    const gaps: StoreLine[] = [];
    for (const k of keys) {
      const { product, size } = splitKey(k);
      const b = buys.get(k);
      const status = statusFor(rules, k, store.store_no);
      const set = distCarriers.get(k);
      const othersCarry = set ? set.size - (set.has(store.outlet_id) ? 1 : 0) : 0;
      const line: StoreLine = {
        key: k,
        product,
        size,
        status,
        carried: isCarried(b),
        lastBuy: b?.last_buy ?? null,
        ce90: b?.ce90 ?? 0,
        ce12: b?.ce12 ?? 0,
        othersCarry,
      };
      if (line.carried) carried.push(line);
      else if (status === "mandate" || othersCarry > 0) gaps.push(line);
    }
    const order = (l: StoreLine) => (l.status === "mandate" ? 0 : l.status === "flex" ? 1 : 2);
    carried.sort((a, b) => order(a) - order(b) || b.ce90 - a.ce90);
    gaps.sort((a, b) => order(a) - order(b) || b.othersCarry - a.othersCarry || a.product.localeCompare(b.product));
    return { store, carried, gaps, mandateGaps: gaps.filter((g) => g.status === "mandate").length };
  });
}
