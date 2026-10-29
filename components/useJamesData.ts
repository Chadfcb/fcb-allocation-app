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
      const { data, error } = await createClient().rpc("james_effectiveness");
      if (error) throw new Error(error.message);
      return data as JeData;
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
