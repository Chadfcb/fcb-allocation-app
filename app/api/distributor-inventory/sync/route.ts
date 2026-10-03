import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { syncEkosDistributorInventory, type DistributorInventoryEntry } from "@/lib/syncs/ekosDistributorInventory";
import { recordSyncRun } from "@/lib/syncs/runLog";

// Syncs distributor on-hand inventory from Ekos's own "Distributor
// Inventory" report into the app's Distributor Inventory grid.
//
// There's no live Ekos API, so — same pattern as Purchase Orders — this is
// driven on demand: a live Claude-in-Chrome session (or Chad by hand) reads
// Ekos's Distributor Inventory report and posts the numbers here, already
// matched up to FCB Data's own distributor/product names (the matching
// happens at read time against whatever's actually in Ekos, since Ekos's
// own company/item names don't line up 1:1 with ours — e.g. Ekos's "Donaghy
// Sales || Coastal" is FCB's "Coast").
//
// Semantics: each entry is upserted into distributor_inventory for the
// CURRENT week (most recently started) only — this never touches past
// weeks. A product match requires active. A name that doesn't match is
// skipped and reported back in `errors` rather than silently dropped.
//
// CORE DISTRIBUTORS ONLY (2026-10-02, per Chad): the sync updates ONLY the
// Core distributors — Matagrano, Markstein, Valley Wide, Coast, Guardian,
// Mussetter, Superior (distributors.is_core_distributor, which can only be
// changed in Supabase — see sql/distributors_core_lockdown.sql). Nothing
// prevents a Core distributor from being updated: not its `active` toggle,
// not `track_inventory`, not other rows with similar names. Any other
// distributor name ("Markstein C", "Valleywide", ...) is rejected and
// reported back, never written. Rules: claude/ekos-sync-reference.md.
export async function POST(req: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  }

  const { data: profile } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", user.id)
    .single();

  if (profile?.role !== "admin") {
    return NextResponse.json({ error: "Admins only" }, { status: 403 });
  }

  let body: { entries?: DistributorInventoryEntry[] };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Malformed JSON" }, { status: 400 });
  }

  const entries = body.entries;
  if (!Array.isArray(entries)) {
    return NextResponse.json({ error: "Expected { entries: [...] }" }, { status: 400 });
  }

  // Rules live in lib/syncs/ekosDistributorInventory.ts (2026-10-03) so
  // the Automatic Syncs job uses the exact same logic.
  const startedAt = new Date();
  const result = await syncEkosDistributorInventory(supabase, entries, user.id);
  await recordSyncRun({
    source: "ekos_distributor_inventory",
    trigger: "paste",
    status: result.errors.length > 0 ? "issues" : "ok",
    startedAt,
    syncedCount: result.syncedCount,
    issues: result.errors,
    summary: `${result.syncedCount} inventory rows synced`,
    runBy: user.id,
  });

  return NextResponse.json(result);
}
