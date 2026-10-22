"use client";

// Gap Report "By store" data for several chains in ONE database call
// (sales_gap_by_store_many — sql/sales_dashboard_speed.sql, 2026-10-22).
//
// Why: the Sales Dashboard used to call sales_gap_by_store once per chain for
// Chain coverage AND again per chain for Action Items — ~15 heavy calls at
// once, which piled up on the database and made the dashboard fail to load
// at times (8-second limit). Now each asks for all its chains at once, and
// if both ask at the same moment for the same chain, they share one request.

import type { createClient } from "@/lib/supabase/client";
import type { GapByStoreResult } from "@/lib/salesDashboard";

type Supa = ReturnType<typeof createClient>;
export type GapOne = { data: GapByStoreResult | null; error: string | null };

// Requests in flight (kept a few seconds so two blocks loading together share).
const inFlight = new Map<string, Promise<GapOne>>();
const SHARE_MS = 10_000;

export async function loadGapStores(
  supabase: Supa,
  chains: string[],
  distributor: string | null,
): Promise<Record<string, GapOne>> {
  const key = (c: string) => `${distributor ?? ""}\u0001${c}`;
  const missing = [...new Set(chains)].filter((c) => !inFlight.has(key(c)));
  if (missing.length) {
    const req = Promise.resolve(supabase.rpc("sales_gap_by_store_many", { p_chains: missing, p_distributor: distributor })).then(
      ({ data, error }) => ({
        data: (data as Record<string, GapByStoreResult> | null) ?? null,
        error: error ? error.message : null,
      }),
      (e: unknown) => ({ data: null, error: e instanceof Error ? e.message : "Couldn't load the chain stores." }),
    );
    for (const c of missing) {
      const one = req.then((r): GapOne => ({ data: r.data?.[c] ?? null, error: r.error }));
      inFlight.set(key(c), one);
      void one.then(() => setTimeout(() => inFlight.delete(key(c)), SHARE_MS));
    }
  }
  const out: Record<string, GapOne> = {};
  for (const c of chains) out[c] = await inFlight.get(key(c))!;
  return out;
}
