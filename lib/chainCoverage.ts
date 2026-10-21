"use client";

// Chain coverage for the Sales Dashboard home (added 2026-10-21): for every
// item on a chain's lists (Chain Mandates = Mandate, Chain Authorizations =
// Flex, or a pick made on the Gap Report), how many of the chain's stores it
// applies to and how many are buying it. Same rules as the Gap Report
// (lib/salesDashboard.ts → buildStoreReports / statusFor). Per distributor,
// so the dashboard's distributor filter works.

import { useEffect, useMemo, useState } from "react";
import type { createClient } from "@/lib/supabase/client";
import { buildStoreReports, splitKey, statusFor, type DashOverview, type GapByStoreResult, type resolveLists } from "@/lib/salesDashboard";

type Supa = ReturnType<typeof createClient>;
type Resolved = ReturnType<typeof resolveLists>;

export interface CoverageRow {
  chain: string;
  status: "mandate" | "flex";
  product: string;
  size: string;
  byDist: Record<string, { stores: number; buying: number }>;
}

export function useChainCoverage(supabase: Supa, ov: DashOverview | null, resolved: Resolved | null, version: number) {
  const chains = useMemo(() => {
    if (!ov || !resolved) return [];
    const ours = new Set(ov.chains.map((c) => c.chain));
    return [...resolved.rules.entries()]
      .filter(([c, r]) => ours.has(c) && (r.mandate.size > 0 || r.flex.size > 0 || [...r.picked.values()].some((p) => p.status !== "none")))
      .map(([c]) => c)
      .sort();
  }, [ov, resolved]);
  const chainsKey = chains.join("\u0001");
  const [rows, setRows] = useState<CoverageRow[] | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (!resolved) return;
    let cancelled = false;
    (async () => {
      const list = chainsKey ? chainsKey.split("\u0001") : [];
      const out: CoverageRow[] = [];
      // A few chains at a time.
      for (let i = 0; i < list.length; i += 4) {
        const part = list.slice(i, i + 4);
        const results = await Promise.all(part.map((chain) => supabase.rpc("sales_gap_by_store", { p_chain: chain, p_distributor: null })));
        if (cancelled) return;
        for (let j = 0; j < part.length; j++) {
          const { data, error } = results[j];
          if (error) {
            setErr(error.message);
            continue;
          }
          const chain = part[j];
          const rules = resolved.rules.get(chain);
          if (!rules) continue;
          const keys = new Set<string>([...rules.mandate.keys(), ...rules.flex, ...rules.picked.keys()]);
          const reports = buildStoreReports(data as GapByStoreResult, rules);
          const acc = new Map<string, CoverageRow>();
          for (const r of reports) {
            const carried = new Set(r.carried.map((l) => l.key));
            for (const k of keys) {
              const st = statusFor(rules, k, r.store.store_no);
              if (st === "none") continue;
              const id = `${st}\u0001${k}`;
              if (!acc.has(id)) {
                const { product, size } = splitKey(k);
                acc.set(id, { chain, status: st, product, size, byDist: {} });
              }
              const row = acc.get(id)!;
              const d = (row.byDist[r.store.distributor] ??= { stores: 0, buying: 0 });
              d.stores += 1;
              if (carried.has(k)) d.buying += 1;
            }
          }
          out.push(...acc.values());
        }
      }
      if (!cancelled) setRows(out);
    })();
    return () => {
      cancelled = true;
    };
  }, [supabase, resolved, chainsKey, version]);

  return { rows, err };
}

// Totals for one distributor ("" = all).
export function coverageFor(rows: CoverageRow[], dist: string) {
  return rows
    .map((r) => {
      let stores = 0;
      let buying = 0;
      for (const [d, v] of Object.entries(r.byDist)) {
        if (dist && d !== dist) continue;
        stores += v.stores;
        buying += v.buying;
      }
      return { ...r, stores, buying };
    })
    .filter((r) => r.stores > 0)
    .sort((a, b) => (a.status === b.status ? a.buying / a.stores - b.buying / b.stores : a.status === "mandate" ? -1 : 1));
}
