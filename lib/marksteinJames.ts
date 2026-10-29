// James's history import for Markstein (added 2026-10-29, per Chad). Server
// only: the API route imports this, and the page never does.
//
// James Mendoza (CMC) is Markstein's field rep. He isn't in LilyPad, so none
// of his visits ever reached sales_account_checkins. This holds his history
// from two places, already cleaned into one list
// (lib/data/markstein-james-history.json):
//   - Chad's tracking spreadsheet, 6/1–8/9/2026 ("spreadsheet"). It has the
//     Pass / Interested / Follow-Up / Committed / Delivered outcome, On/Off
//     premise, and sometimes the VIP outlet id.
//   - James's 11 Monday "Weekly Recap" emails, 8/9–10/25/2026 ("recap"),
//     taken from the WR .docx (visit log) and CC .xlsx (commitments) files.
//     These have no Pass/Follow-Up tag, so a visit is "Committed" or
//     "Visited".
// Project docs: claude/markstein-james-import-plan.md,
// claude/markstein-cmc-james-tracking-2026-10-29.md,
// claude/markstein-james-recaps-8.9-10.25.md.
//
// Matching a visit to an account, per store (same street number + street name
// + city):
//   1. VIP outlet id from the spreadsheet, when that account exists
//   2. address → one Markstein account (or one clear best name among several)
//   3. address → only other-distributor accounts, or several Markstein
//      accounts with no clear winner → "unsure" (Chad picks)
//   4. same city + close name → "unsure"
//   5. nothing → "none" (default: add as a new Markstein prospect)

import history from "@/lib/data/markstein-james-history.json";

export const JAMES_REP = "James";
export const JAMES_SOURCES = { spreadsheet: "CMC: James spreadsheet", recap: "CMC: James weekly recap" } as const;
// The history ends with the 10/18–10/25 recap. Re-running the import only
// replaces James's check-ins up to here, so later weekly uploads stay.
export const JAMES_HISTORY_END = "2026-10-25";
export const NEW_ACCOUNT_PREFIX = "CMC-";

export interface JamesVisit {
  d: string; // YYYY-MM-DD
  n: string; // store name as James wrote it
  a: string | null; // street address
  c: string | null; // city
  o: string | null; // VIP outlet id (spreadsheet only)
  p: string | null; // "ON" / "OFF" (spreadsheet only)
  r: string | null; // outcome
  x: string | null; // notes
  b: string | null; // products sampled / committed
  k: string | null; // spoke with
  s: "spreadsheet" | "recap";
}

export const JAMES_VISITS = history as JamesVisit[];

export interface AccountLite {
  outlet_id: string;
  name: string;
  address: string | null;
  city: string | null;
  distributor: string | null;
  premise: string | null;
}

export interface Candidate {
  outlet_id: string;
  name: string;
  address: string | null;
  city: string | null;
  distributor: string | null;
}

export interface StoreMatch {
  key: string; // store key
  name: string;
  address: string | null;
  city: string | null;
  premise: string | null; // "On" / "Off" from the spreadsheet, if any
  visits: number;
  first: string;
  last: string;
  status: "matched" | "unsure" | "none";
  why: string;
  pick: string | null; // suggested outlet_id ("new" when none)
  candidates: Candidate[];
}

const SUFFIX: Record<string, string> = {
  street: "st", avenue: "ave", av: "ave", boulevard: "blvd", road: "rd", drive: "dr", lane: "ln",
  court: "ct", place: "pl", parkway: "pkwy", highway: "hwy", way: "way", circle: "cir", square: "sq",
};
const norm = (s: string | null | undefined) =>
  (s ?? "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9 ]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();

// "5859 Lone Tree Way Ste C" + "Antioch" → "5859|lone|antioch". Directions
// (N, S, E, W) are skipped so "100 N San Tomas" and "100 San Tomas" match.
export function addressKey(address: string | null, city: string | null): string | null {
  const words = norm(address).split(" ").filter(Boolean);
  if (!words.length || !/^\d+[a-z]?$/.test(words[0])) return null;
  const rest = words.slice(1).filter((w) => !["n", "s", "e", "w", "north", "south", "east", "west"].includes(w));
  const street = rest[0] ? SUFFIX[rest[0]] ?? rest[0] : "";
  if (!street) return null;
  return `${words[0].replace(/[a-z]$/, "")}|${street}|${norm(city)}`;
}

const STOP = new Set(["the", "and", "of", "inc", "llc", "co", "company", "store", "market", "markets", "liquor", "liquors", "ca"]);
function nameWords(name: string, city: string | null): Set<string> {
  const cityWords = new Set(norm(city).split(" "));
  return new Set(norm(name).split(" ").filter((w) => w && !STOP.has(w) && !cityWords.has(w)));
}
function nameScore(a: string, b: string, city: string | null): number {
  const x = nameWords(a, city);
  const y = nameWords(b, city);
  if (!x.size || !y.size) return 0;
  let both = 0;
  x.forEach((w) => {
    if (y.has(w)) both++;
  });
  return both / Math.min(x.size, y.size);
}

const storeKeyOf = (v: JamesVisit) => addressKey(v.a, v.c) ?? `name|${norm(v.n)}|${norm(v.c)}`;

export function premiseOf(p: string | null | undefined): string | null {
  if (!p) return null;
  if (/off/i.test(p)) return "Off";
  if (/on/i.test(p)) return "On";
  return null;
}

// Group the visits by store and match each store to an account.
export function matchStores(accounts: AccountLite[]): StoreMatch[] {
  const byId = new Map(accounts.map((a) => [a.outlet_id, a]));
  const byAddr = new Map<string, AccountLite[]>();
  for (const a of accounts) {
    const k = addressKey(a.address, a.city);
    if (!k) continue;
    const list = byAddr.get(k);
    if (list) list.push(a);
    else byAddr.set(k, [a]);
  }
  const marksteinByCity = new Map<string, AccountLite[]>();
  for (const a of accounts) {
    if (a.distributor !== "Markstein") continue;
    const c = norm(a.city);
    const list = marksteinByCity.get(c);
    if (list) list.push(a);
    else marksteinByCity.set(c, [a]);
  }
  const cand = (a: AccountLite): Candidate => ({ outlet_id: a.outlet_id, name: a.name, address: a.address, city: a.city, distributor: a.distributor });

  const stores = new Map<string, JamesVisit[]>();
  for (const v of JAMES_VISITS) {
    const k = storeKeyOf(v);
    const list = stores.get(k);
    if (list) list.push(v);
    else stores.set(k, [v]);
  }

  const out: StoreMatch[] = [];
  stores.forEach((visits, key) => {
    const v0 = visits.find((v) => v.s === "spreadsheet") ?? visits[0];
    const dates = visits.map((v) => v.d).sort();
    const base = {
      key,
      name: v0.n,
      address: v0.a,
      city: v0.c,
      premise: premiseOf(visits.find((v) => v.p)?.p),
      visits: visits.length,
      first: dates[0],
      last: dates[dates.length - 1],
    };
    // 1. VIP outlet id
    const ids = Array.from(new Set(visits.map((v) => v.o).filter((o): o is string => !!o && byId.has(o))));
    if (ids.length === 1) {
      const a = byId.get(ids[0])!;
      out.push({ ...base, status: "matched", why: "VIP outlet id from your spreadsheet", pick: a.outlet_id, candidates: [cand(a)] });
      return;
    }
    // 2–3. address
    const atAddr = key.startsWith("name|") ? [] : byAddr.get(key) ?? [];
    const mk = atAddr.filter((a) => a.distributor === "Markstein");
    if (mk.length === 1) {
      out.push({ ...base, status: "matched", why: "Same address", pick: mk[0].outlet_id, candidates: atAddr.map(cand) });
      return;
    }
    if (mk.length > 1) {
      const ranked = mk.map((a) => ({ a, s: nameScore(v0.n, a.name, v0.c) })).sort((x, y) => y.s - x.s);
      const clear = ranked[0].s >= 0.5 && ranked[0].s - ranked[1].s >= 0.34;
      out.push({
        ...base,
        status: clear ? "matched" : "unsure",
        why: clear ? "Same address, closest name" : `${mk.length} Markstein accounts at this address`,
        pick: ranked[0].a.outlet_id,
        candidates: ranked.map((r) => cand(r.a)),
      });
      return;
    }
    if (atAddr.length) {
      out.push({
        ...base,
        status: "unsure",
        why: `Same address, but listed under ${Array.from(new Set(atAddr.map((a) => a.distributor ?? "no distributor"))).join(", ")}`,
        pick: atAddr[0].outlet_id,
        candidates: atAddr.map(cand),
      });
      return;
    }
    // 4. name in the same city
    const near = (marksteinByCity.get(norm(v0.c)) ?? [])
      .map((a) => ({ a, s: nameScore(v0.n, a.name, v0.c) }))
      .filter((r) => r.s >= 0.67)
      .sort((x, y) => y.s - x.s)
      .slice(0, 5);
    if (near.length) {
      out.push({ ...base, status: "unsure", why: "Similar name in the same city (address didn't match)", pick: near[0].a.outlet_id, candidates: near.map((r) => cand(r.a)) });
      return;
    }
    // 5. nothing
    out.push({ ...base, status: "none", why: "Not in the account list", pick: "new", candidates: [] });
  });
  const order = { unsure: 0, none: 1, matched: 2 };
  return out.sort((a, b) => order[a.status] - order[b.status] || a.name.localeCompare(b.name));
}

export function visitsForStore(key: string): JamesVisit[] {
  return JAMES_VISITS.filter((v) => storeKeyOf(v) === key);
}

// A short, stable id for a store added as a new account: "CMC-" + 8 hex.
export function newAccountId(key: string): string {
  let h = 2166136261;
  for (let i = 0; i < key.length; i++) {
    h ^= key.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return NEW_ACCOUNT_PREFIX + (h >>> 0).toString(16).padStart(8, "0").toUpperCase();
}

export function activityFor(premise: string | null): string {
  if (premise === "On") return "On Premise Visit";
  if (premise === "Off") return "Off Premise Visit";
  return "Field Visit";
}
