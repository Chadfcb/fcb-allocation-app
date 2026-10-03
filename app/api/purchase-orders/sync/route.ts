import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { syncEkosPurchaseOrders, type EkosPurchaseOrder } from "@/lib/syncs/ekosPurchaseOrders";
import { recordSyncRun } from "@/lib/syncs/runLog";

// Syncs the current "Open - Purchase Orders" list from Ekos into the app.
//
// There's no live Ekos API, so this is driven on demand: Chad runs a live
// Claude-in-Chrome session against his own already-logged-in Ekos tab, reads
// the current open PO list (header info, comments, and each PO's line
// items), and posts it here — mirroring manual data entry through the
// site's own fields rather than a raw database write from outside the app.
//
// Semantics (updated 2026-09-09): a PO currently marked 'open' that's no
// longer in the payload moves to 'holding' instead of being deleted — it's
// no longer open in Ekos (closed, received, or otherwise resolved since the
// last sync), but nothing gets removed automatically anymore; a person
// decides from the Holding section whether to delete it for real or mark
// it Completed. Every PO in the payload is upserted by its Ekos PO number
// and always set back to 'open' (so a PO that had drifted into Holding or
// Completed and shows back up as open in Ekos returns to Open
// automatically), with its line items fully replaced each time so they
// always match whatever's currently on the PO in Ekos. A PO already
// sitting in Holding or Completed is left alone if it's simply missing
// from the payload — that's expected, not a new event.
// The actual sync rules now live in lib/syncs/ekosPurchaseOrders.ts
// (2026-10-03) so the Automatic Syncs job (Admin → Ekos Sync) uses the
// exact same logic. This route is the "Sync from Ekos" paste box.
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

  let body: { purchaseOrders?: EkosPurchaseOrder[] };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Malformed JSON" }, { status: 400 });
  }

  const purchaseOrders = body.purchaseOrders;
  if (!Array.isArray(purchaseOrders)) {
    return NextResponse.json({ error: "Expected { purchaseOrders: [...] }" }, { status: 400 });
  }

  const startedAt = new Date();
  const result = await syncEkosPurchaseOrders(supabase, purchaseOrders, user.id);
  await recordSyncRun({
    source: "ekos_purchase_orders",
    trigger: "paste",
    status: result.errors.length > 0 ? "issues" : "ok",
    startedAt,
    syncedCount: result.syncedCount,
    issues: result.errors,
    summary: `${result.syncedCount} POs synced, ${result.movedToHoldingCount} moved to Holding`,
    runBy: user.id,
  });

  return NextResponse.json(result);
}
