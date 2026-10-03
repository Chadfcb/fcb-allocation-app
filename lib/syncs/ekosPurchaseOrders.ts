import type { SupabaseClient } from "@supabase/supabase-js";

// Shared Ekos → Open Purchase Orders sync logic (moved here 2026-10-03 from
// app/api/purchase-orders/sync/route.ts, unchanged in behavior) so the
// "Sync from Ekos" paste box AND the Automatic Syncs job (Admin → Ekos
// Sync, see lib/syncs/autoSyncs.ts) run the exact same rules.
//
// Semantics (from 2026-09-09): a PO currently marked 'open' that's no
// longer in the payload moves to 'holding' instead of being deleted. Every
// PO in the payload is upserted by its Ekos PO number and always set back
// to 'open', with its line items fully replaced each time. A PO already in
// Holding or Completed is left alone if it's simply missing from the
// payload.
export interface EkosPoItem {
  itemName: string;
  quantity: number | null;
  unitCost: number | null;
  lineTotal: number | null;
}

export interface EkosPurchaseOrder {
  ekosPoNumber: string;
  supplier: string;
  poDate: string | null;
  expectedDeliveryDate: string | null;
  totalCost: number | null;
  status: string | null;
  ekosLastModifiedBy: string | null;
  comments: string | null;
  items: EkosPoItem[];
}

export interface PurchaseOrderSyncResult {
  syncedCount: number;
  movedToHoldingCount: number;
  errors: string[];
}

export async function syncEkosPurchaseOrders(
  supabase: SupabaseClient,
  purchaseOrders: EkosPurchaseOrder[],
  // The signed-in admin for a paste-box sync; null for an automatic run.
  actorUserId: string | null,
): Promise<PurchaseOrderSyncResult> {
  const incomingNumbers = purchaseOrders
    .map((po) => po.ekosPoNumber?.trim())
    .filter((n): n is string => Boolean(n));

  const { data: existingOpen } = await supabase
    .from("purchase_orders")
    .select("id, ekos_po_number")
    .eq("record_status", "open");
  const toHold = (existingOpen ?? []).filter((row) => !incomingNumbers.includes(row.ekos_po_number));
  if (toHold.length > 0) {
    await supabase
      .from("purchase_orders")
      .update({ record_status: "holding" })
      .in(
        "id",
        toHold.map((r) => r.id),
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
          synced_by: actorUserId,
          synced_at: new Date().toISOString(),
          record_status: "open",
        },
        { onConflict: "ekos_po_number" },
      )
      .select()
      .single();

    if (error || !upserted) {
      errors.push(`PO ${ekosPoNumber}: ${error?.message ?? "unknown error"}`);
      continue;
    }

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
        })),
      );
      if (itemsError) {
        errors.push(`PO ${ekosPoNumber} items: ${itemsError.message}`);
        continue;
      }
    }

    syncedCount += 1;
  }

  const { error: syncStatusError } = await supabase
    .from("ekos_sync_status")
    .upsert({ id: 1, last_synced_at: new Date().toISOString() });
  if (syncStatusError) {
    errors.push(`Dashboard "Last Ekos sync" timestamp not updated: ${syncStatusError.message}`);
  }

  return { syncedCount, movedToHoldingCount: toHold.length, errors };
}
