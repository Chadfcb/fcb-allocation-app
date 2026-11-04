// Beer Finder — shared types and rules (added 2026-11-04 —
// claude/beer-finder-plan.md). Data: beer_finder_data() in sql/beer_finder.sql.
//
// A location is LIVE (on the finder) when:
//   - it isn't taken off the lists (Remove from lists / turned off),
//   - it isn't set to "hide" on the Control tab,
//   - its distributor is included, and
//   - it's set to "always", OR it bought a shown beer within the days setting
//     (default 60) of the sales data's as-of date.
// No taproom anywhere — FCB doesn't have one (Chad, 2026-11-04).

export interface BfItem {
  product: string;
  size: string; // "16oz", "12oz", "19.2oz", "1/6 bbl", "1/2 bbl", "" …
  last_buy: string | null;
  ce90: number | null;
}
export interface BfLocation {
  outlet_id: string;
  name: string;
  display_name: string | null;
  address: string | null;
  city: string | null;
  state: string | null;
  zip: string | null;
  phone: string | null;
  premise: string | null; // "On" | "Off"
  distributor: string | null;
  lat: number | null;
  lng: number | null;
  pin: "ok" | "nomatch" | "manual" | null;
  mode: "auto" | "hide" | "always";
  is_off: boolean;
  last_buy: string | null;
  items: BfItem[];
}
export interface BfBeer {
  product: string;
  public_name: string | null;
  show: boolean;
  label_path: string | null;
  label_front: number | null; // where the label's front is across the wrap (0–1); null = usual spot
}
export interface BfData {
  as_of: string;
  settings: { days: number; public_on: boolean } | null;
  beers: BfBeer[];
  distributors: { distributor: string; show: boolean }[];
  locations: BfLocation[];
}
export interface BfLabel {
  path: string;
  brand: string;
  size: string;
  name: string;
  url: string | null;
}

export type Status = "live" | "always" | "dropped" | "hidden" | "off" | "dist";

export const isDraft = (size: string) => /bbl|keg|gal/i.test(size);
export function packageLabel(size: string): string {
  const s = (size ?? "").trim();
  if (!s) return "Package not recorded";
  if (/oz$/i.test(s)) return `${s} cans`;
  if (/bbl$/i.test(s)) return `${s} keg`;
  return s;
}

// "FIG GARDEN LIQUOR 2" → "Fig Garden Liquor 2"; keeps #, &, store numbers.
export function tidyName(name: string): string {
  const small = new Set(["and", "of", "the", "at", "on", "in", "de", "la"]);
  return name
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim()
    .split(" ")
    .map((w, i) => {
      if (i > 0 && small.has(w)) return w;
      if (/^(bbq|ipa|usa|llc|ii|iii|iv|ampm|cvs)$/.test(w)) return w.toUpperCase();
      return w.replace(/(^|[-/(])([a-z])/g, (_m, p: string, c: string) => p + c.toUpperCase()).replace(/'S\b/g, "'s");
    })
    .join(" ");
}
export const shownName = (l: BfLocation) => l.display_name?.trim() || tidyName(l.name);
export const beerName = (b: BfBeer | undefined, product: string) => b?.public_name?.trim() || product;

export function daysBetween(a: string, b: string): number {
  return Math.round((Date.parse(a) - Date.parse(b)) / 86400000);
}

export interface Ctx {
  asOf: string;
  days: number;
  beers: Map<string, BfBeer>;
  distShown: Map<string, boolean>;
}
export function makeCtx(d: BfData): Ctx {
  return {
    asOf: d.as_of,
    days: d.settings?.days ?? 60,
    beers: new Map(d.beers.map((b) => [b.product, b])),
    distShown: new Map(d.distributors.map((x) => [x.distributor, x.show])),
  };
}
const beerShown = (c: Ctx, product: string) => c.beers.get(product)?.show ?? true;

// What this location shows: shown beers bought within the days setting
// (an "always" location with none → everything it bought in the last year).
export function liveItems(c: Ctx, l: BfLocation): BfItem[] {
  const inWindow = l.items.filter((i) => beerShown(c, i.product) && i.last_buy && daysBetween(c.asOf, i.last_buy) <= c.days);
  if (inWindow.length || l.mode !== "always") return inWindow;
  return l.items.filter((i) => beerShown(c, i.product));
}

export function statusOf(c: Ctx, l: BfLocation): Status {
  if (l.is_off) return "off";
  if (l.mode === "hide") return "hidden";
  if (l.distributor && c.distShown.get(l.distributor) === false) return "dist";
  if (l.mode === "always") return "always";
  return liveItems(c, l).length ? "live" : "dropped";
}
export const isLive = (s: Status) => s === "live" || s === "always";

export function milesBetween(a: [number, number], b: [number, number]): number {
  const R = 3958.8;
  const t = (x: number) => (x * Math.PI) / 180;
  const dLa = t(b[0] - a[0]);
  const dLo = t(b[1] - a[1]);
  const h = Math.sin(dLa / 2) ** 2 + Math.cos(t(a[0])) * Math.cos(t(b[0])) * Math.sin(dLo / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

export const directionsUrl = (l: BfLocation) =>
  `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent([shownName(l), l.address, l.city, l.state || "CA", l.zip].filter(Boolean).join(" "))}`;
