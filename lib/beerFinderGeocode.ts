import type { SupabaseClient } from "@supabase/supabase-js";

// Beer Finder map pins (added 2026-11-04 — claude/beer-finder-plan.md).
// Server only (service role). Asks the database which accounts still need a
// pin for their current street address (beer_finder_geocode_todo), sends them
// to the free US Census Bureau batch geocoder (no account, no key, no cost;
// up to 10,000 addresses a file — we send 1,000 at a time), and saves each
// result in beer_finder_geo. Addresses it can't match are saved as "nomatch"
// so they show on the Beer Finder Control tab's "Couldn't place on the map"
// list instead of being retried every day.
//
// Runs after the weekday LilyPad sales sync (lib/syncs/lilypadSales.ts) and
// from the Control tab's "Place pins now" button.
//
// Misses are retried automatically (2026-11-04, per Chad: "you expect me to
// fix all those myself? i dont have that time"):
//   1. Census again with the suite / unit / # part taken off the street.
//   2. OpenStreetMap's free address lookup (Nominatim), one address a second
//      as its rules ask — street + city + zip first, then the whole address as
//      one line. Each miss gets this retry once; a place neither finds is
//      marked so it isn't retried every day (it shows on "Couldn't place").
// Keeps going until everyone is looked up or the time budget runs out (the
// database hands out 1,000 at a time — the first version stopped there).

const CENSUS_BATCH = "https://geocoding.geo.census.gov/geocoder/locations/addressbatch";
const CHUNK = 1000;

interface Todo {
  outlet_id: string;
  street: string | null;
  city: string | null;
  state: string | null;
  zip: string | null;
  addr_key: string;
}

export interface GeocodeResult {
  asked: number;
  placed: number;
  noMatch: number;
  failed: number;
  error?: string;
  retried?: number; // misses retried with OpenStreetMap / without the suite
  stillMissing?: number; // places that still have no pin after every retry
}

const csvCell = (v: string | null) => `"${(v ?? "").replace(/"/g, "'").replace(/[\r\n]+/g, " ")}"`;

// Minimal CSV line parser (quoted fields, commas inside quotes).
function parseCsvLine(line: string): string[] {
  const out: string[] = [];
  let cur = "";
  let q = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (q) {
      if (c === '"' && line[i + 1] === '"') {
        cur += '"';
        i++;
      } else if (c === '"') q = false;
      else cur += c;
    } else if (c === '"') q = true;
    else if (c === ",") {
      out.push(cur);
      cur = "";
    } else cur += c;
  }
  out.push(cur);
  return out;
}

async function censusBatch(rows: Todo[]): Promise<Map<string, { lat: number; lng: number; matched: string } | null>> {
  // The Census file has no header: Unique ID, Street address, City, State, ZIP.
  // IDs are row numbers (outlet ids can hold characters the geocoder dislikes).
  const csv = rows.map((r, i) => [String(i), csvCell(r.street), csvCell(r.city), csvCell(r.state || "CA"), csvCell(r.zip)].join(",")).join("\n");
  const form = new FormData();
  form.append("addressFile", new Blob([csv], { type: "text/csv" }), "addresses.csv");
  form.append("benchmark", "Public_AR_Current");
  const res = await fetch(CENSUS_BATCH, { method: "POST", body: form });
  if (!res.ok) throw new Error(`Census geocoder answered ${res.status}`);
  const text = await res.text();
  const out = new Map<string, { lat: number; lng: number; matched: string } | null>();
  for (const line of text.split(/\r?\n/)) {
    if (!line.trim()) continue;
    const f = parseCsvLine(line);
    const idx = Number(f[0]);
    if (!Number.isInteger(idx) || !rows[idx]) continue;
    // "Match" rows: id, input, Match, Exact|Non_Exact, matched address, "lon,lat", tiger id, side
    if (f[2] === "Match" && f[5]) {
      const [lon, lat] = f[5].split(",").map(Number);
      if (Number.isFinite(lat) && Number.isFinite(lon)) {
        out.set(rows[idx].outlet_id, { lat, lng: lon, matched: f[4] ?? "" });
        continue;
      }
    }
    out.set(rows[idx].outlet_id, null);
  }
  return out;
}

// "3150 Fowler Ave Ste 107" → "3150 Fowler Ave"
export function stripUnit(street: string | null): string {
  // Only a unit word followed by a number or a single letter ("Ste 107",
  // "Unit B", "# 4") — so "500 Unit Rd" is left alone.
  return (street ?? "")
    .replace(/(?:\s*,)?\s+(?:ste|suite|unit|apt|bldg|building|spc|space|rm|room|fl|floor)\.?\s*#?\s*(?:\d[\w-]*|[a-z])\s*$/i, "")
    .replace(/(?:\s*,)?\s*#\s*[\w-]+\s*$/, "")
    .trim();
}

const OSM = "https://nominatim.openstreetmap.org/search";
const OSM_UA = "FCB-Data Beer Finder (fcb-data.com)";
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function osmOnce(params: Record<string, string>): Promise<{ lat: number; lng: number; matched: string } | null> {
  const res = await fetch(`${OSM}?${new URLSearchParams({ format: "json", limit: "1", countrycodes: "us", ...params })}`, {
    headers: { "User-Agent": OSM_UA, "Accept-Language": "en" },
  });
  if (!res.ok) throw new Error(`OpenStreetMap lookup answered ${res.status}`);
  const j = (await res.json()) as { lat: string; lon: string; display_name: string }[];
  const hit = j[0];
  if (!hit) return null;
  const lat = Number(hit.lat);
  const lng = Number(hit.lon);
  return Number.isFinite(lat) && Number.isFinite(lng) ? { lat, lng, matched: `OSM: ${hit.display_name}` } : null;
}

// One address through OpenStreetMap: structured first, then one line.
async function osmLookup(street: string, city: string, state: string, zip: string, deadline: number) {
  const s = stripUnit(street) || street;
  const a = await osmOnce({ street: s, city, state: state || "CA", ...(zip ? { postalcode: zip } : {}) });
  await sleep(1100);
  if (a || Date.now() > deadline) return a;
  const b = await osmOnce({ q: [s, city, state || "CA", zip].filter(Boolean).join(", ") });
  await sleep(1100);
  return b;
}

export async function geocodeBeerFinder(admin: SupabaseClient, limit = 2000, budgetMs = 60_000): Promise<GeocodeResult> {
  const deadline = Date.now() + budgetMs;
  const result: GeocodeResult = { asked: 0, placed: 0, noMatch: 0, failed: 0 };
  // Pass 1: everyone still without a pin for their current address (1,000 a round).
  for (let round = 0; round < 20 && Date.now() < deadline && result.asked < limit; round++) {
    const r = await geocodeRound(admin, Math.min(1000, limit - result.asked));
    result.asked += r.asked;
    result.placed += r.placed;
    result.noMatch += r.noMatch;
    result.failed += r.failed;
    if (r.error) result.error = r.error;
    if (!r.asked || r.error) break;
  }
  // Pass 2: retry the misses (suite taken off, then OpenStreetMap).
  if (Date.now() < deadline) {
    const r = await retryMisses(admin, deadline);
    result.placed += r.placed;
    result.noMatch -= Math.min(result.noMatch, r.placed);
    result.retried = r.tried;
    result.stillMissing = r.still;
    if (r.error && !result.error) result.error = r.error;
  }
  return result;
}

async function retryMisses(admin: SupabaseClient, deadline: number): Promise<{ tried: number; placed: number; still: number; error?: string }> {
  // Misses not retried yet (matched is empty until a retry has been tried).
  const { data, error } = await admin.from("beer_finder_geo").select("outlet_id, addr_key").eq("status", "nomatch").is("matched", null).limit(1000);
  if (error) return { tried: 0, placed: 0, still: 0, error: error.message };
  const rows = ((data as { outlet_id: string; addr_key: string }[]) ?? []).map((g) => {
    const [street = "", city = "", state = "CA", zip = ""] = g.addr_key.split("|");
    return { outlet_id: g.outlet_id, addr_key: g.addr_key, street, city, state, zip };
  });
  if (!rows.length) return { tried: 0, placed: 0, still: 0 };
  let placed = 0;
  let tried = 0;
  const now = () => new Date().toISOString();
  const save = async (outlet_id: string, addr_key: string, hit: { lat: number; lng: number; matched: string } | null) => {
    await admin
      .from("beer_finder_geo")
      .upsert(
        hit
          ? { outlet_id, addr_key, status: "ok", lat: hit.lat, lng: hit.lng, matched: hit.matched, geocoded_at: now() }
          : { outlet_id, addr_key, status: "nomatch", lat: null, lng: null, matched: "not found (Census + OpenStreetMap)", geocoded_at: now() },
        { onConflict: "outlet_id" },
      );
  };
  // a) Census again without the suite / unit.
  const left: typeof rows = [];
  const withUnit = rows.filter((r) => stripUnit(r.street) !== r.street.trim());
  const found = new Map<string, { lat: number; lng: number; matched: string } | null>();
  if (withUnit.length) {
    try {
      const res = await censusBatch(withUnit.map((r) => ({ outlet_id: r.outlet_id, street: stripUnit(r.street), city: r.city, state: r.state, zip: r.zip, addr_key: r.addr_key })));
      res.forEach((v, k) => found.set(k, v));
    } catch {
      // fall through to OpenStreetMap
    }
  }
  for (const r of rows) {
    const hit = found.get(r.outlet_id);
    if (hit) {
      await save(r.outlet_id, r.addr_key, hit);
      placed++;
      tried++;
    } else left.push(r);
  }
  // b) OpenStreetMap, one a second, until the time runs out (the rest next run).
  let osmError: string | undefined;
  for (const r of left) {
    if (Date.now() > deadline - 3000) break;
    tried++;
    try {
      const hit = await osmLookup(r.street, r.city, r.state, r.zip, deadline);
      await save(r.outlet_id, r.addr_key, hit);
      if (hit) placed++;
    } catch (e) {
      osmError = e instanceof Error ? e.message : String(e);
      break; // OpenStreetMap is down or said slow down — try again next run
    }
  }
  const { count } = await admin.from("beer_finder_geo").select("outlet_id", { count: "exact", head: true }).eq("status", "nomatch");
  return { tried, placed, still: count ?? 0, error: osmError };
}

async function geocodeRound(admin: SupabaseClient, limit: number): Promise<GeocodeResult> {
  const { data, error } = await admin.rpc("beer_finder_geocode_todo", { p_limit: limit });
  if (error) return { asked: 0, placed: 0, noMatch: 0, failed: 0, error: error.message };
  const todo = (data as Todo[]) ?? [];
  const result: GeocodeResult = { asked: todo.length, placed: 0, noMatch: 0, failed: 0 };
  for (let i = 0; i < todo.length; i += CHUNK) {
    const chunk = todo.slice(i, i + CHUNK);
    let found: Map<string, { lat: number; lng: number; matched: string } | null>;
    try {
      found = await censusBatch(chunk);
    } catch (e) {
      result.failed += chunk.length;
      result.error = e instanceof Error ? e.message : String(e);
      continue; // nothing saved for this chunk → tried again next run
    }
    const now = new Date().toISOString();
    const upserts = chunk
      .filter((r) => found.has(r.outlet_id))
      .map((r) => {
        const hit = found.get(r.outlet_id);
        return hit
          ? { outlet_id: r.outlet_id, addr_key: r.addr_key, status: "ok", lat: hit.lat, lng: hit.lng, matched: hit.matched, geocoded_at: now }
          : { outlet_id: r.outlet_id, addr_key: r.addr_key, status: "nomatch", lat: null, lng: null, matched: null, geocoded_at: now };
      });
    result.failed += chunk.length - upserts.length;
    if (upserts.length) {
      const { error: upErr } = await admin.from("beer_finder_geo").upsert(upserts, { onConflict: "outlet_id" });
      if (upErr) {
        result.failed += upserts.length;
        result.error = upErr.message;
        continue;
      }
    }
    for (const u of upserts) {
      if (u.status === "ok") result.placed++;
      else result.noMatch++;
    }
  }
  return result;
}

export function geocodeSummary(r: GeocodeResult): string {
  if (r.error && !r.placed && !r.noMatch && !r.retried) return `Beer Finder map pins: ${r.error}`;
  if (!r.asked && !r.retried) return "Beer Finder map pins: nothing new to place";
  const parts = [`${r.placed} placed`];
  if (r.retried) parts.push(`${r.retried} misses retried`);
  if (r.stillMissing != null) parts.push(`${r.stillMissing} still without a pin`);
  if (r.failed) parts.push(`${r.failed} to try again${r.error ? ` (${r.error})` : ""}`);
  else if (r.error) parts.push(`(${r.error}) — the rest try again next run`);
  return `Beer Finder map pins: ${parts.join(", ")}`;
}
