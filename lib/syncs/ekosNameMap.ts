import type { SupabaseClient } from "@supabase/supabase-js";
import type { DistributorInventoryEntry } from "@/lib/syncs/ekosDistributorInventory";

// Ekos name lists (table ekos_name_map, sql/ekos_name_map.sql) — added
// 2026-10-03 for the automatic Ekos sync. Turns the names Ekos shows into
// the app's names, exactly — never guessed. Rules:
// claude/ekos-sync-reference.md.
//
// - Known + matched → translated.
// - Known + "skip"  → left out on purpose (e.g. Saccani, Illa Vanilla).
// - Unknown         → left out, saved as "Needs a decision" for Chad on
//                     Admin → Ekos Sync, and listed in the run's issues.

export type EkosNameKind = "distributor" | "item";

interface NameMapRow {
  kind: EkosNameKind;
  ekos_name: string;
  app_name: string | null;
  skip: boolean;
}

// Raw row from Ekos's Distributor Inventory report.
export interface EkosInventoryRow {
  distributor: string; // Ekos "Distributor" column
  item: string; // Ekos "Item" column
  onHand: number;
  rateOfSale: number;
}

export async function translateEkosInventory(
  admin: SupabaseClient,
  rows: EkosInventoryRow[],
): Promise<{ entries: DistributorInventoryEntry[]; issues: string[] }> {
  const { data, error } = await admin.from("ekos_name_map").select("kind, ekos_name, app_name, skip");
  if (error) throw new Error(`Couldn't load the Ekos name lists: ${error.message}`);

  // Match on Ekos's own spelling (typos included). Runs of spaces count as
  // one, because how a page displays "Peachy  Vibes" (two spaces) can vary.
  const norm = (s: string) => s.replace(/\s+/g, " ").trim();
  const map = new Map<string, NameMapRow>();
  for (const r of (data as NameMapRow[] | null) ?? []) map.set(`${r.kind}|${norm(r.ekos_name)}`, r);

  const issues: string[] = [];
  const newNames = new Map<string, { kind: EkosNameKind; ekos_name: string }>();
  const pending = new Set<string>();

  const resolve = (kind: EkosNameKind, ekosName: string): string | null => {
    const hit = map.get(`${kind}|${norm(ekosName)}`);
    if (hit?.skip) return null;
    if (hit?.app_name) return hit.app_name;
    // Unknown, or saved earlier but still waiting on a decision.
    if (!hit) newNames.set(`${kind}|${norm(ekosName)}`, { kind, ekos_name: ekosName });
    pending.add(`${kind === "distributor" ? "Distributor" : "Item"} "${ekosName}"`);
    return null;
  };

  // Two Ekos items can map to the same app product (e.g. "Nectarine Pie
  // 6/4/16oz" and "Nectarine Pie of the Tiger 6/4/16oz") — add them
  // together so neither overwrites the other.
  const totals = new Map<string, DistributorInventoryEntry>();
  for (const row of rows) {
    const distributor = resolve("distributor", row.distributor);
    if (!distributor) continue;
    const product = resolve("item", row.item);
    if (!product) continue;
    const key = `${distributor}|${product}`;
    const prev = totals.get(key);
    if (prev) {
      prev.onHand += row.onHand;
      prev.rateOfSale = Math.round(((prev.rateOfSale ?? 0) + row.rateOfSale) * 1000) / 1000;
    } else {
      totals.set(key, { distributor, product, onHand: row.onHand, rateOfSale: row.rateOfSale });
    }
  }

  if (newNames.size > 0) {
    await admin
      .from("ekos_name_map")
      .upsert([...newNames.values()].map((n) => ({ ...n, app_name: null, skip: false })), {
        onConflict: "kind,ekos_name",
        ignoreDuplicates: true,
      });
  }
  for (const p of pending) {
    issues.push(`${p} isn't on the Ekos name list yet — not synced. Pick its match (or Skip) on Admin → Ekos Sync.`);
  }

  return { entries: [...totals.values()], issues };
}
