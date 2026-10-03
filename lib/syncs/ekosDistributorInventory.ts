import type { SupabaseClient } from "@supabase/supabase-js";

// Shared Ekos → Distributor Inventory sync logic (moved here 2026-10-03 from
// app/api/distributor-inventory/sync/route.ts, unchanged in behavior) so the
// "Sync from Ekos" paste box AND the Automatic Syncs job run the exact same
// rules.
//
// CORE DISTRIBUTORS ONLY (2026-10-02, per Chad): only the Core distributors
// — Matagrano, Markstein, Valley Wide, Coast, Guardian, Mussetter, Superior
// (distributors.is_core_distributor, changeable only in Supabase, see
// sql/distributors_core_lockdown.sql) — get inventory updated. Nothing
// prevents a Core distributor from being updated (not `active`, not
// `track_inventory`). Any other name is rejected and reported, never
// written. Each entry goes into the CURRENT week only. A product must be
// active. Rules: claude/ekos-sync-reference.md.
export interface DistributorInventoryEntry {
  distributor: string;
  product: string;
  onHand: number;
  rateOfSale?: number | null;
}

export interface DistributorInventorySyncResult {
  syncedCount: number;
  errors: string[];
}

export async function syncEkosDistributorInventory(
  supabase: SupabaseClient,
  entries: DistributorInventoryEntry[],
  // The signed-in admin for a paste-box sync; null for an automatic run.
  actorUserId: string | null,
): Promise<DistributorInventorySyncResult> {
  const { data: week } = await supabase
    .from("weeks")
    .select("id")
    .order("week_start", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (!week) {
    return { syncedCount: 0, errors: ["No week has been started yet."] };
  }

  const [{ data: distributors }, { data: products }] = await Promise.all([
    supabase.from("distributors").select("id, name").eq("is_core_distributor", true),
    supabase.from("products").select("id, name").eq("active", true),
  ]);

  const distributorByName = new Map(
    (distributors ?? []).map((d) => [String(d.name).trim().toLowerCase(), d.id as string]),
  );
  const productByName = new Map(
    (products ?? []).map((p) => [String(p.name).trim().toLowerCase(), p.id as string]),
  );

  const coreNames = (distributors ?? []).map((d) => d.name).sort().join(", ");
  const errors: string[] = [];
  let syncedCount = 0;

  for (const entry of entries) {
    const distributorId = distributorByName.get((entry.distributor ?? "").trim().toLowerCase());
    const productId = productByName.get((entry.product ?? "").trim().toLowerCase());

    if (!distributorId) {
      errors.push(`"${entry.distributor}" isn't one of the Core distributors (${coreNames}) — skipped.`);
      continue;
    }
    if (!productId) {
      errors.push(`Unknown product "${entry.product}" (${entry.distributor}) — skipped.`);
      continue;
    }

    const { error } = await supabase.from("distributor_inventory").upsert(
      {
        week_id: week.id,
        distributor_id: distributorId,
        product_id: productId,
        on_hand_qty: entry.onHand ?? 0,
        rate_of_sale: entry.rateOfSale ?? 0,
        source: "ekos",
        imported_at: new Date().toISOString(),
        updated_by: actorUserId,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "week_id,distributor_id,product_id" },
    );

    if (error) {
      errors.push(`${entry.distributor} / ${entry.product}: ${error.message}`);
      continue;
    }

    syncedCount += 1;
  }

  const { error: syncStatusError } = await supabase
    .from("ekos_sync_status")
    .upsert({ id: 1, last_synced_at: new Date().toISOString() });
  if (syncStatusError) {
    errors.push(`Dashboard "Last Ekos sync" timestamp not updated: ${syncStatusError.message}`);
  }

  return { syncedCount, errors };
}
