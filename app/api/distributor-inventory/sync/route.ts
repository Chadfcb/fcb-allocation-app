import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

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
// weeks. A distributor or product name that doesn't match anything active
// is skipped and reported back in `errors` rather than silently dropped.
interface SyncEntry {
  distributor: string;
  product: string;
  onHand: number;
  rateOfSale?: number | null;
}

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

  let body: { entries?: SyncEntry[] };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Malformed JSON" }, { status: 400 });
  }

  const entries = body.entries;
  if (!Array.isArray(entries)) {
    return NextResponse.json({ error: "Expected { entries: [...] }" }, { status: 400 });
  }

  const { data: week } = await supabase
    .from("weeks")
    .select("id")
    .order("week_start", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (!week) {
    return NextResponse.json({ error: "No week has been started yet." }, { status: 400 });
  }

  const [{ data: distributors }, { data: products }] = await Promise.all([
    supabase.from("distributors").select("id, name").eq("active", true),
    supabase.from("products").select("id, name").eq("active", true),
  ]);

  const distributorByName = new Map(
    (distributors ?? []).map((d) => [d.name.trim().toLowerCase(), d.id])
  );
  const productByName = new Map((products ?? []).map((p) => [p.name.trim().toLowerCase(), p.id]));

  const errors: string[] = [];
  let syncedCount = 0;

  for (const entry of entries) {
    const distributorId = distributorByName.get((entry.distributor ?? "").trim().toLowerCase());
    const productId = productByName.get((entry.product ?? "").trim().toLowerCase());

    if (!distributorId) {
      errors.push(`Unknown distributor "${entry.distributor}" — skipped.`);
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
        updated_by: user.id,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "week_id,distributor_id,product_id" }
    );

    if (error) {
      errors.push(`${entry.distributor} / ${entry.product}: ${error.message}`);
      continue;
    }

    syncedCount += 1;
  }

  return NextResponse.json({ syncedCount, errors });
}
