"use client";

// Shared loader for the Markstein Effectiveness + Direction for James blocks
// (2026-10-29): one james_effectiveness() call per page load / refresh, used
// by both blocks.

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import type { JeData } from "@/lib/jamesEffectiveness";

const cache = new Map<number, Promise<JeData>>();

function load(version: number): Promise<JeData> {
  let p = cache.get(version);
  if (!p) {
    p = (async () => {
      const supabase = createClient();
      const [je, rm] = await Promise.all([supabase.rpc("james_effectiveness"), supabase.rpc("sales_removed_accounts", { p_outlet: null })]);
      if (je.error) throw new Error(je.error.message);
      const data = je.data as JeData;
      // Remove from lists (2026-11-02): accounts taken off the lists (e.g. Plank,
      // closed) drop out of James's targets and every Direction list. Their
      // past check-ins and sales still count in the Effectiveness history.
      const removed = rm.error ? [] : ((rm.data ?? []) as { outlet_id: string }[]).map((r) => r.outlet_id);
      const off = new Set(removed);
      return { ...data, targets: data.targets.filter((t) => !t.outlet_id || !off.has(t.outlet_id)), removed };
    })();
    p.catch(() => cache.delete(version));
    cache.set(version, p);
  }
  return p;
}

export function useJamesData(version: number): { data: JeData | null; err: string | null } {
  const [state, setState] = useState<{ data: JeData | null; err: string | null }>({ data: null, err: null });
  useEffect(() => {
    let cancelled = false;
    load(version).then(
      (data) => !cancelled && setState({ data, err: null }),
      (e: unknown) => !cancelled && setState({ data: null, err: e instanceof Error ? e.message : String(e) }),
    );
    return () => {
      cancelled = true;
    };
  }, [version]);
  return state;
}
