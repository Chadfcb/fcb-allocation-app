import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

// Syncs the current "Open - Purchase Orders" list from Ekos into the app.
//
// There's no live Ekos API, so this is driven on demand: Chad runs a live
// Claude-in-Chrome session against his own already-logged-in Ekos tab, reads
// the current open PO list (header info, comments, and each PO's line
// items), and posts it here — mirroring manual data entry through the
// site's own fields rather than a raw database write from outside the app.
//
// Semantics: this REPLACES the purchase_orders table's contents with
// whatever's in the payload. Any PO not the payload gets deleted (it's no
// longer open in Ekos — closed, received, or otherwise resolved since the
// last sync); every PO in the payload is upserted by its Ekos PO number,
// with its line items fully replaced each time so they always match
// whatever's currently on the PO in Ekos.
interface SyncItem {
  itemName: string;
  quantity: number | null;
  unitCost: number | null;
  lineTotal: number | null;
}

interface SyncPurchaseOrder {
  ekosPoNumber: string;
  supplier: string;
  poDate: string | null;
  expectedDeliveryDate: string | null;
  totalCost: number | null;
  status: string | null;
  ekosLastModifiedBy: string | null;
  comments: string | null;
  items: SyncItem[];
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

  let body: { purchaseOrders?: SyncPurchaseOrder[] };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Malformed JSON" }, { status: 400 });
  }

  const purchaseOrders = body.purchaseOrders;
  if (!Array.isArray(purchaseOrders)) {
    return NextResponse.json({ error: "Expected { purchaseOrders: [...] }" }, { status: 400 });
  }

  const incomingNumbers = purchaseOrders
    .map((po) => po.ekosPoNumber?.trim())
    .filter((n): n is string => Boolean(n));

  // Remove POs that are no longer open in Ekos.
  const { data: existing } = await supabase.from("purchase_orders").select("id, ekos_po_number");
  const toRemove = (existing ?? []).filter((row) => !incomingNumbers.includes(row.ekos_po_number));
  if (toRemove.length > 0) {
    await supabase
      .from("purchase_orders")
      .delete()
      .in(
        "id",
        toRemove.map((r) => r.id)
      );
  }

  const errors: string[] = [];
  let syncedCount = 0;

  for (const po of purchaseOrders) {
    const ekosPoNumber = po.ekosPoNumber?.trim();
    if (!ekosPoNumber || !po.supplier) {
      errors.push(`Skipped a PO missing its number or supplier.`);
      continue;
    }

    const { data: upserted, error } = await supabase
      .from("purchase_orders")
      .upsert(
        {
          ekos_po_number: ekosPoNumber,
          supplier: po.supplier,
          po_date: po.poDate || null,
          expected_delivery_date: po.expectedDeliveryDate || null,
          total_cost: po.totalCost ?? null,
          status: po.status ?? null,
          comments: po.comments ?? null,
          ekos_last_modified_by: po.ekosLastModifiedBy ?? null,
          synced_by: user.id,
          synced_at: new Date().toISOString(),
        },
        { onConflict: "ekos_po_number" }
      )
      .select()
      .single();

    if (error || !upserted) {
      errors.push(`PO ${ekosPoNumber}: ${error?.message ?? "unknown error"}`);
      continue;
    }

    // Replace line items wholesale — simplest way to keep them in sync with
    // whatever's currently on the PO in Ekos.
    await supabase.from("purchase_order_items").delete().eq("purchase_order_id", upserted.id);

    const items = Array.isArray(po.items) ? po.items : [];
    if (items.length > 0) {
      const { error: itemsError } = await supabase.from("purchase_order_items").insert(
        items.map((item, index) => ({
          purchase_order_id: upserted.id,
          item_name: item.itemName,
          quantity: item.quantity ?? null,
          unit_cost: item.unitCost ?? null,
          line_total: item.lineTotal ?? null,
          sort_order: index,
        }))
      );
      if (itemsError) {
        errors.push(`PO ${ekosPoNumber} items: ${itemsError.message}`);
        continue;
      }
    }

    syncedCount += 1;
  }

  return NextResponse.json({
    syncedCount,
    removedCount: toRemove.length,
    errors,
  });
}
