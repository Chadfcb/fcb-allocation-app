"use client";

// Operations > Purchase Orders — FCB's own outgoing vendor purchase orders
// (buying ingredients/supplies from suppliers), synced in from Ekos. Live
// via Supabase Realtime, same as the rest of the app.
//
// The "Sync from Ekos" box is how new data actually arrives: there's no
// live Ekos API, so a live Claude-in-Chrome session (driven by Chad, using
// his own already-logged-in Ekos tab) reads the current Open - Purchase
// Orders list and posts it here as JSON, same shape this box accepts by
// hand if anyone ever needed to.

import { Fragment, useEffect, useMemo, useState, useCallback } from "react";
import { createClient } from "@/lib/supabase/client";
import { logChange } from "@/lib/audit";
import type { PurchaseOrder, PurchaseOrderItem, PoPaymentStatus, PoOrderedStatus } from "@/lib/types/db";
import {
  PO_PAYMENT_STATUS_LABELS,
  PO_PAYMENT_STATUS_COLORS,
  PO_ORDERED_STATUS_LABELS,
  PO_ORDERED_STATUS_COLORS,
} from "@/lib/types/db";

const currencyFormatter = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
});

function formatDate(value: string | null): string {
  if (!value) return "—";
  const [year, month, day] = value.split("-");
  if (!year || !month || !day) return value;
  return `${month}/${day}/${year}`;
}

export default function PurchaseOrdersPageClient() {
  const supabase = useMemo(() => createClient(), []);
  const [orders, setOrders] = useState<PurchaseOrder[]>([]);
  const [itemsByPo, setItemsByPo] = useState<Record<string, PurchaseOrderItem[]>>({});
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [userId, setUserId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const [syncOpen, setSyncOpen] = useState(false);
  const [syncText, setSyncText] = useState("");
  const [syncing, setSyncing] = useState(false);
  const [syncResult, setSyncResult] = useState<{
    syncedCount: number;
    removedCount: number;
    errors: string[];
  } | null>(null);
  const [syncError, setSyncError] = useState<string | null>(null);

  const load = useCallback(async () => {
    const {
      data: { user },
    } = await supabase.auth.getUser();
    setUserId(user?.id ?? null);

    const [ordersRes, itemsRes] = await Promise.all([
      supabase.from("purchase_orders").select("*").order("po_date", { ascending: false }),
      supabase.from("purchase_order_items").select("*").order("sort_order", { ascending: true }),
    ]);

    setOrders((ordersRes.data as PurchaseOrder[]) ?? []);

    const map: Record<string, PurchaseOrderItem[]> = {};
    for (const item of (itemsRes.data as PurchaseOrderItem[]) ?? []) {
      (map[item.purchase_order_id] ??= []).push(item);
    }
    setItemsByPo(map);

    setLoading(false);
  }, [supabase]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- intentional fetch-on-mount
    load();

    const channel = supabase
      .channel("purchase-orders-live")
      .on("postgres_changes", { event: "*", schema: "public", table: "purchase_orders" }, load)
      .on("postgres_changes", { event: "*", schema: "public", table: "purchase_order_items" }, load)
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [supabase, load]);

  function toggleExpanded(id: string) {
    setExpanded((prev) => ({ ...prev, [id]: !prev[id] }));
  }

  async function handlePaymentStatusChange(poId: string, value: PoPaymentStatus) {
    if (!userId) return;

    const existing = orders.find((po) => po.id === poId);
    const oldValue = existing?.payment_status ?? "pending";
    setOrders((prev) => prev.map((po) => (po.id === poId ? { ...po, payment_status: value } : po)));

    const { data, error } = await supabase
      .from("purchase_orders")
      .update({ payment_status: value })
      .eq("id", poId)
      .select()
      .single();

    if (!error && data) {
      setOrders((prev) => prev.map((po) => (po.id === poId ? (data as PurchaseOrder) : po)));
      await logChange(supabase, {
        weekId: null,
        tableName: "purchase_orders",
        recordId: poId,
        fieldName: "payment_status",
        oldValue,
        newValue: value,
        changedBy: userId,
      });
    }
  }

  async function handleOrderedStatusChange(poId: string, value: PoOrderedStatus) {
    if (!userId) return;

    const existing = orders.find((po) => po.id === poId);
    const oldValue = existing?.ordered_status ?? "not_ordered";
    setOrders((prev) => prev.map((po) => (po.id === poId ? { ...po, ordered_status: value } : po)));

    const { data, error } = await supabase
      .from("purchase_orders")
      .update({ ordered_status: value })
      .eq("id", poId)
      .select()
      .single();

    if (!error && data) {
      setOrders((prev) => prev.map((po) => (po.id === poId ? (data as PurchaseOrder) : po)));
      await logChange(supabase, {
        weekId: null,
        tableName: "purchase_orders",
        recordId: poId,
        fieldName: "ordered_status",
        oldValue,
        newValue: value,
        changedBy: userId,
      });
    }
  }

  async function handleSync() {
    setSyncing(true);
    setSyncError(null);
    setSyncResult(null);

    let payload: unknown;
    try {
      payload = JSON.parse(syncText);
    } catch {
      setSyncError("That's not valid JSON — check for a stray comma or missing bracket.");
      setSyncing(false);
      return;
    }

    const res = await fetch("/api/purchase-orders/sync", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const json = await res.json();

    if (!res.ok) {
      setSyncError(json.error ?? "Sync failed");
      setSyncing(false);
      return;
    }

    setSyncResult(json);
    setSyncText("");
    setSyncing(false);
    await load();
  }

  const lastSyncedAt = orders.reduce<string | null>((latest, po) => {
    if (!po.synced_at) return latest;
    if (!latest || po.synced_at > latest) return po.synced_at;
    return latest;
  }, null);

  // Paid POs float to the top; within the rest, Ordered POs float above
  // Not Ordered ones; anything still tied keeps its existing order (po_date
  // descending, from the query) — the sort is stable, so ties fall through
  // to that original order automatically.
  const sortedOrders = [...orders].sort((a, b) => {
    const paidDiff = Number(b.payment_status === "paid") - Number(a.payment_status === "paid");
    if (paidDiff !== 0) return paidDiff;
    return Number(b.ordered_status === "ordered") - Number(a.ordered_status === "ordered");
  });

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-lg font-semibold text-neutral-100">Purchase Orders</h1>
          <p className="text-sm text-neutral-400">
            Open vendor purchase orders, synced from Ekos.
            {lastSyncedAt && (
              <>
                {" "}
                Last synced{" "}
                {new Date(lastSyncedAt).toLocaleString("en-US", {
                  month: "short",
                  day: "numeric",
                  hour: "numeric",
                  minute: "2-digit",
                })}
                .
              </>
            )}
          </p>
        </div>
        <button
          type="button"
          onClick={() => setSyncOpen((prev) => !prev)}
          className="shrink-0 rounded-md border border-neutral-700 px-3 py-1.5 text-sm text-neutral-300 hover:bg-neutral-900"
        >
          {syncOpen ? "Close" : "Sync from Ekos"}
        </button>
      </div>

      {syncOpen && (
        <div className="rounded-lg border border-yellow-500/40 bg-yellow-500/[0.03] p-3">
          <p className="mb-2 text-sm text-neutral-400">
            Paste the current Open - Purchase Orders data (JSON) from Ekos, then Sync. This
            replaces the list below with exactly what&apos;s open in Ekos right now.
          </p>
          <textarea
            value={syncText}
            onChange={(e) => setSyncText(e.target.value)}
            rows={8}
            placeholder='{"purchaseOrders": [{"ekosPoNumber": "3145", "supplier": "MoreBeer", ...}]}'
            className="block w-full rounded-md border border-neutral-700 bg-neutral-900 px-3 py-2 font-mono text-xs text-neutral-100"
          />
          <div className="mt-2 flex items-center gap-2">
            <button
              type="button"
              onClick={handleSync}
              disabled={syncing || !syncText.trim()}
              className="rounded-md bg-white px-3 py-1.5 text-sm font-medium text-black hover:bg-neutral-200 disabled:opacity-50"
            >
              {syncing ? "Syncing…" : "Sync"}
            </button>
            {syncError && <p className="text-sm text-red-400">{syncError}</p>}
            {syncResult && (
              <p className="text-sm text-neutral-300">
                Synced {syncResult.syncedCount}, removed {syncResult.removedCount}
                {syncResult.errors.length > 0 && (
                  <span className="text-red-400"> — {syncResult.errors.join("; ")}</span>
                )}
              </p>
            )}
          </div>
        </div>
      )}

      <div className="overflow-x-auto rounded-lg border border-neutral-800">
        <table className="min-w-full text-sm">
          <thead className="bg-neutral-900 text-xs uppercase tracking-wide text-neutral-500">
            <tr>
              <th className="w-8 px-2 py-2" />
              <th className="px-3 py-2 text-left">Number</th>
              <th className="px-3 py-2 text-left">Supplier</th>
              <th className="px-3 py-2 text-left">PO Date</th>
              <th className="px-3 py-2 text-left">Expected Delivery</th>
              <th className="px-3 py-2 text-right">Total Cost</th>
              <th className="px-3 py-2 text-left">Status</th>
              <th className="px-3 py-2 text-left">Paid</th>
              <th className="px-3 py-2 text-left">Ordered</th>
              <th className="px-3 py-2 text-left">Comments</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-neutral-900">
            {loading ? (
              <tr>
                <td colSpan={10} className="px-3 py-6 text-center text-neutral-500">
                  Loading…
                </td>
              </tr>
            ) : orders.length === 0 ? (
              <tr>
                <td colSpan={10} className="px-3 py-6 text-center text-neutral-500">
                  No open purchase orders yet — use &quot;Sync from Ekos&quot; above to pull them
                  in.
                </td>
              </tr>
            ) : (
              sortedOrders.map((po) => {
                const items = itemsByPo[po.id] ?? [];
                const isExpanded = expanded[po.id] ?? false;
                return (
                  <Fragment key={po.id}>
                    <tr
                      onClick={() => toggleExpanded(po.id)}
                      className="cursor-pointer hover:bg-neutral-900/60"
                    >
                      <td className="px-2 py-2 text-center text-neutral-500">
                        {isExpanded ? "▾" : "▸"}
                      </td>
                      <td className="px-3 py-2 font-medium text-neutral-100">
                        {po.ekos_po_number}
                      </td>
                      <td className="px-3 py-2 text-neutral-300">{po.supplier}</td>
                      <td className="px-3 py-2 text-neutral-400">{formatDate(po.po_date)}</td>
                      <td className="px-3 py-2 text-neutral-400">
                        {formatDate(po.expected_delivery_date)}
                      </td>
                      <td className="px-3 py-2 text-right text-neutral-100">
                        {po.total_cost != null ? currencyFormatter.format(po.total_cost) : "—"}
                      </td>
                      <td className="px-3 py-2 text-neutral-400">{po.status ?? "—"}</td>
                      <td className="px-3 py-2" onClick={(e) => e.stopPropagation()}>
                        <select
                          value={po.payment_status}
                          onChange={(e) =>
                            handlePaymentStatusChange(po.id, e.target.value as PoPaymentStatus)
                          }
                          className="w-24 rounded border border-neutral-700 px-1.5 py-0.5 text-[11px] font-semibold"
                          style={{
                            backgroundColor: PO_PAYMENT_STATUS_COLORS[po.payment_status],
                            color: "#000000",
                          }}
                        >
                          {(Object.keys(PO_PAYMENT_STATUS_LABELS) as PoPaymentStatus[]).map((s) => (
                            <option
                              key={s}
                              value={s}
                              style={{ backgroundColor: PO_PAYMENT_STATUS_COLORS[s], color: "#000000" }}
                            >
                              {PO_PAYMENT_STATUS_LABELS[s]}
                            </option>
                          ))}
                        </select>
                      </td>
                      <td className="px-3 py-2" onClick={(e) => e.stopPropagation()}>
                        <select
                          value={po.ordered_status}
                          onChange={(e) =>
                            handleOrderedStatusChange(po.id, e.target.value as PoOrderedStatus)
                          }
                          className="w-28 rounded border border-neutral-700 px-1.5 py-0.5 text-[11px] font-semibold"
                          style={{
                            backgroundColor: PO_ORDERED_STATUS_COLORS[po.ordered_status],
                            color: "#000000",
                          }}
                        >
                          {(Object.keys(PO_ORDERED_STATUS_LABELS) as PoOrderedStatus[]).map((s) => (
                            <option
                              key={s}
                              value={s}
                              style={{ backgroundColor: PO_ORDERED_STATUS_COLORS[s], color: "#000000" }}
                            >
                              {PO_ORDERED_STATUS_LABELS[s]}
                            </option>
                          ))}
                        </select>
                      </td>
                      <td className="px-3 py-2 text-neutral-300">{po.comments ?? "—"}</td>
                    </tr>
                    {isExpanded && (
                      <tr className="bg-neutral-950/60">
                        <td />
                        <td colSpan={9} className="px-3 py-3">
                          {items.length === 0 ? (
                            <p className="text-sm text-neutral-500">No line items captured.</p>
                          ) : (
                            <table className="w-full max-w-2xl text-xs">
                              <thead className="text-neutral-500">
                                <tr>
                                  <th className="px-2 py-1 text-left">Item</th>
                                  <th className="px-2 py-1 text-right">Quantity</th>
                                  <th className="px-2 py-1 text-right">Unit Cost</th>
                                  <th className="px-2 py-1 text-right">Line Total</th>
                                </tr>
                              </thead>
                              <tbody className="divide-y divide-neutral-900">
                                {items.map((item) => (
                                  <tr key={item.id}>
                                    <td className="px-2 py-1 text-neutral-300">{item.item_name}</td>
                                    <td className="px-2 py-1 text-right text-neutral-300">
                                      {item.quantity ?? "—"}
                                    </td>
                                    <td className="px-2 py-1 text-right text-neutral-400">
                                      {item.unit_cost != null
                                        ? currencyFormatter.format(item.unit_cost)
                                        : "—"}
                                    </td>
                                    <td className="px-2 py-1 text-right text-neutral-400">
                                      {item.line_total != null
                                        ? currencyFormatter.format(item.line_total)
                                        : "—"}
                                    </td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          )}
                        </td>
                      </tr>
                    )}
                  </Fragment>
                );
              })
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
