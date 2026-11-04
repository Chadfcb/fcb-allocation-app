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

export async function geocodeBeerFinder(admin: SupabaseClient, limit = 2000): Promise<GeocodeResult> {
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
  if (r.error && !r.placed && !r.noMatch) return `Beer Finder map pins: ${r.error}`;
  if (!r.asked) return "Beer Finder map pins: nothing new to place";
  return `Beer Finder map pins: ${r.placed} placed, ${r.noMatch} couldn't be matched${r.failed ? `, ${r.failed} to try again${r.error ? ` (${r.error})` : ""}` : ""}`;
}
