"use client";

// Operations > Open Purchase Orders — FCB's own outgoing vendor purchase
// orders (buying ingredients/supplies from suppliers), synced in from Ekos.
// Live via Supabase Realtime, same as the rest of the app.
//
// New data arrives from the automatic Ekos sync (Admin → Ekos Sync): the
// app's server reads Ekos's Open - Purchase Orders list (lib/syncs/). The
// "Sync from Ekos" paste box was removed 2026-10-03 at Chad's request once
// the automatic sync was proven.
//
// Lifecycle (added 2026-09-09) — every PO has a record_status:
//   open      — currently open in Ekos (what the table above used to be,
//               full stop, before this existed).
//   holding   — dropped off the most recent Ekos sync (closed/received in
//               Ekos), waiting on a decision. NOTHING gets auto-deleted on
//               sync anymore — a PO that's no longer open just moves here.
//   completed — moved here on purpose from Holding, once its Total Cost and
//               Paid Date (if needed) are correct. An archive, not a queue.
// From Holding, each row can be Deleted (a real, permanent delete — no
// undo, confirmed before it fires) or Completed (moves it down). If a PO
// that's sitting in Holding or Completed shows back up as open in a later
// Ekos sync, it automatically moves back to Open.
//
// Paid Date (added 2026-09-09) — sits between Paid and Ordered. Flipping a
// PO to Paid auto-fills today's date; flipping back to Pending clears it.
// It's always editable/backdatable by hand too. This is what the Cash Flow
// Dashboard's Expenses Out grid uses to bucket a paid expense into the week
// it actually got paid, instead of the week it was ordered.
//
// Total Cost is read-only in Open (it's what Ekos reports) but editable in
// Holding and Completed, since a vendor's final invoice can differ from the
// PO total by the time it's actually settled.
//
// Completed POs add to inventory (added 2026-11-20, sql/po_receiving_inventory.sql):
// moving a PO to Completed adds its cans / lids / trays / Pak-Techs / kegs /
// labels to the newest week's Packaging Inventory and Label Inventory On Hand
// (the database does it — trigger on record_status). PO item names are
// matched through po_inventory_item_map; a packaging item with no match shows
// in "Needs a decision" at the top, and picking a row there adds it. Each
// expanded line item shows what it added ("Added to inventory" column).
// New! (feature:po-adds-inventory) sits on the Completed heading; clicking the
// heading, opening any PO, or clicking Complete clears it (2026-11-20, Chad).

import { Fragment, useCallback, useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { logChange } from "@/lib/audit";
import { PACKAGING_ITEMS, derivePackaging } from "@/lib/packaging";
import { useNewFeature } from "@/lib/newFeatures";
import NewBadge from "@/components/NewBadge";
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

// Same as public.po_inventory_name_key() in the database.
function nameKey(name: string): string {
  return name.trim().replace(/\s+/g, " ").toLowerCase();
}

const qtyFormatter = new Intl.NumberFormat("en-US", { maximumFractionDigits: 2 });

const PACKAGING_LABELS: Record<string, string> = Object.fromEntries(
  PACKAGING_ITEMS.map((item) => [item.key, item.label]),
);

interface NeedsDecisionRow {
  item_id: string;
  purchase_order_id: string;
  ekos_po_number: string;
  supplier: string;
  item_name: string;
  quantity: number | null;
}

interface ReceiptRow {
  purchase_order_id: string | null;
  name_key: string;
  target: "packaging" | "label";
  item_key: string | null;
  product_id: string | null;
  qty: number;
}

interface LabelProduct {
  id: string;
  name: string;
}

function todayIsoDate(): string {
  return new Date().toISOString().slice(0, 10);
}

export default function PurchaseOrdersPageClient() {
  const supabase = useMemo(() => createClient(), []);
  const [orders, setOrders] = useState<PurchaseOrder[]>([]);
  const [itemsByPo, setItemsByPo] = useState<Record<string, PurchaseOrderItem[]>>({});
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [userId, setUserId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [needsDecision, setNeedsDecision] = useState<NeedsDecisionRow[]>([]);
  const [receipts, setReceipts] = useState<ReceiptRow[]>([]);
  const [labelProducts, setLabelProducts] = useState<LabelProduct[]>([]);
  const [picks, setPicks] = useState<Record<string, string>>({});
  const [savingPick, setSavingPick] = useState<string | null>(null);
  const [pickError, setPickError] = useState<string | null>(null);
  const inventoryFeature = useNewFeature("feature:po-adds-inventory");

  const load = useCallback(async () => {
    const {
      data: { user },
    } = await supabase.auth.getUser();
    setUserId(user?.id ?? null);

    const [ordersRes, itemsRes, needsRes, receiptsRes, productsRes] = await Promise.all([
      supabase.from("purchase_orders").select("*").order("po_date", { ascending: false }),
      supabase.from("purchase_order_items").select("*").order("sort_order", { ascending: true }),
      supabase.from("po_inventory_needs_decision").select("*"),
      supabase
        .from("po_inventory_receipts")
        .select("purchase_order_id, name_key, target, item_key, product_id, qty"),
      supabase.from("products").select("id, name, active").order("sort_order", { ascending: true }),
    ]);

    setOrders((ordersRes.data as PurchaseOrder[]) ?? []);
    setNeedsDecision((needsRes.data as NeedsDecisionRow[]) ?? []);
    setReceipts((receiptsRes.data as ReceiptRow[]) ?? []);
    setLabelProducts(
      ((productsRes.data as (LabelProduct & { active: boolean })[]) ?? [])
        .filter((p) => p.active && derivePackaging(p.name).kind === "can")
        .map((p) => ({ id: p.id, name: p.name })),
    );

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
      .on("postgres_changes", { event: "*", schema: "public", table: "po_inventory_item_map" }, load)
      .on("postgres_changes", { event: "*", schema: "public", table: "po_inventory_receipts" }, load)
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [supabase, load]);

  function toggleExpanded(id: string) {
    if (inventoryFeature.isNew) inventoryFeature.dismiss();
    setExpanded((prev) => ({ ...prev, [id]: !prev[id] }));
  }

  // Saves a "Needs a decision" pick to the name list; the database then adds
  // that item (on every completed PO that has it) to inventory.
  async function handleSavePick(row: NeedsDecisionRow) {
    if (!userId) return;
    const choice = picks[row.item_id];
    if (!choice) return;

    setSavingPick(row.item_id);
    setPickError(null);

    const [kind, value] = choice.split(":");
    const record =
      kind === "packaging"
        ? { target: "packaging", item_key: value, product_id: null }
        : kind === "label"
          ? { target: "label", item_key: null, product_id: value }
          : { target: "skip", item_key: null, product_id: null };

    const { error } = await supabase
      .from("po_inventory_item_map")
      .insert({ name_key: nameKey(row.item_name), item_name: row.item_name, ...record });

    setSavingPick(null);
    if (error) {
      setPickError(error.message);
      return;
    }

    const newValue =
      record.target === "packaging"
        ? PACKAGING_LABELS[record.item_key ?? ""] ?? record.item_key
        : record.target === "label"
          ? `${labelProducts.find((p) => p.id === record.product_id)?.name ?? "label"} labels`
          : "Not packaging";
    await logChange(supabase, {
      weekId: null,
      tableName: "po_inventory_item_map",
      recordId: row.item_id,
      fieldName: "inventory_match",
      oldValue: row.item_name,
      newValue,
      changedBy: userId,
    });
    await load();
  }

  // What one PO line item added to inventory (net), for the expanded table.
  function addedToInventory(po: PurchaseOrder, itemName: string): string {
    if (!po.adds_to_inventory) return "—";
    const key = nameKey(itemName);
    const rows = receipts.filter((r) => r.purchase_order_id === po.id && r.name_key === key);
    const byTarget = new Map<string, number>();
    for (const r of rows) {
      const label =
        r.target === "packaging"
          ? PACKAGING_LABELS[r.item_key ?? ""] ?? r.item_key ?? ""
          : `${labelProducts.find((p) => p.id === r.product_id)?.name ?? "Label"} labels`;
      byTarget.set(label, (byTarget.get(label) ?? 0) + Number(r.qty));
    }
    const parts = [...byTarget.entries()]
      .filter(([, qty]) => qty !== 0)
      .map(([label, qty]) => `${qty > 0 ? "+" : ""}${qtyFormatter.format(qty)} · ${label}`);
    if (parts.length > 0) return parts.join(", ");
    if (needsDecision.some((n) => n.purchase_order_id === po.id && nameKey(n.item_name) === key)) {
      return "Needs a decision";
    }
    return "—";
  }

  async function handlePaymentStatusChange(poId: string, value: PoPaymentStatus) {
    if (!userId) return;

    const existing = orders.find((po) => po.id === poId);
    const oldPayment = existing?.payment_status ?? "pending";
    const oldPaidDate = existing?.paid_date ?? null;
    const newPaidDate = value === "paid" ? oldPaidDate ?? todayIsoDate() : null;

    setOrders((prev) =>
      prev.map((po) => (po.id === poId ? { ...po, payment_status: value, paid_date: newPaidDate } : po)),
    );

    const { data, error } = await supabase
      .from("purchase_orders")
      .update({ payment_status: value, paid_date: newPaidDate })
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
        oldValue: oldPayment,
        newValue: value,
        changedBy: userId,
      });
      if (oldPaidDate !== newPaidDate) {
        await logChange(supabase, {
          weekId: null,
          tableName: "purchase_orders",
          recordId: poId,
          fieldName: "paid_date",
          oldValue: oldPaidDate,
          newValue: newPaidDate,
          changedBy: userId,
        });
      }
    }
  }

  async function handlePaidDateChange(poId: string, value: string) {
    if (!userId) return;

    const existing = orders.find((po) => po.id === poId);
    const oldValue = existing?.paid_date ?? null;
    const newValue = value || null;
    setOrders((prev) => prev.map((po) => (po.id === poId ? { ...po, paid_date: newValue } : po)));

    const { data, error } = await supabase
      .from("purchase_orders")
      .update({ paid_date: newValue })
      .eq("id", poId)
      .select()
      .single();

    if (!error && data) {
      setOrders((prev) => prev.map((po) => (po.id === poId ? (data as PurchaseOrder) : po)));
      await logChange(supabase, {
        weekId: null,
        tableName: "purchase_orders",
        recordId: poId,
        fieldName: "paid_date",
        oldValue,
        newValue,
        changedBy: userId,
      });
    }
  }

  async function handleTotalCostChange(poId: string, value: string) {
    if (!userId) return;

    const trimmed = value.trim();
    const parsed = trimmed === "" ? null : Number(trimmed);
    if (parsed !== null && Number.isNaN(parsed)) return;

    const existing = orders.find((po) => po.id === poId);
    const oldValue = existing?.total_cost ?? null;
    setOrders((prev) => prev.map((po) => (po.id === poId ? { ...po, total_cost: parsed } : po)));

    const { data, error } = await supabase
      .from("purchase_orders")
      .update({ total_cost: parsed })
      .eq("id", poId)
      .select()
      .single();

    if (!error && data) {
      setOrders((prev) => prev.map((po) => (po.id === poId ? (data as PurchaseOrder) : po)));
      await logChange(supabase, {
        weekId: null,
        tableName: "purchase_orders",
        recordId: poId,
        fieldName: "total_cost",
        oldValue,
        newValue: parsed,
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

  async function handleCompletePo(poId: string) {
    if (!userId) return;

    const existing = orders.find((po) => po.id === poId);
    const oldValue = existing?.record_status ?? "holding";
    inventoryFeature.dismiss();
    setOrders((prev) => prev.map((po) => (po.id === poId ? { ...po, record_status: "completed" } : po)));

    const { data, error } = await supabase
      .from("purchase_orders")
      .update({ record_status: "completed" })
      .eq("id", poId)
      .select()
      .single();

    if (!error && data) {
      setOrders((prev) => prev.map((po) => (po.id === poId ? (data as PurchaseOrder) : po)));
      await logChange(supabase, {
        weekId: null,
        tableName: "purchase_orders",
        recordId: poId,
        fieldName: "record_status",
        oldValue,
        newValue: "completed",
        changedBy: userId,
      });
    } else {
      await load();
    }
  }

  async function handleDeletePo(poId: string) {
    if (!userId) return;
    const po = orders.find((o) => o.id === poId);
    if (!po) return;

    const confirmed = window.confirm(
      `Permanently delete PO ${po.ekos_po_number} (${po.supplier})? This can't be undone.`,
    );
    if (!confirmed) return;

    setOrders((prev) => prev.filter((o) => o.id !== poId));

    const { error } = await supabase.from("purchase_orders").delete().eq("id", poId);

    if (!error) {
      await logChange(supabase, {
        weekId: null,
        tableName: "purchase_orders",
        recordId: poId,
        fieldName: "deleted",
        oldValue: `${po.ekos_po_number} (${po.supplier})`,
        newValue: null,
        changedBy: userId,
      });
    } else {
      await load();
    }
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
  function sortPos(list: PurchaseOrder[]): PurchaseOrder[] {
    return [...list].sort((a, b) => {
      const paidDiff = Number(b.payment_status === "paid") - Number(a.payment_status === "paid");
      if (paidDiff !== 0) return paidDiff;
      return Number(b.ordered_status === "ordered") - Number(a.ordered_status === "ordered");
    });
  }

  const openOrders = sortPos(orders.filter((po) => po.record_status === "open"));
  const holdingOrders = sortPos(orders.filter((po) => po.record_status === "holding"));
  const completedOrders = sortPos(orders.filter((po) => po.record_status === "completed"));

  const paymentSelectClass = "w-24 rounded border border-neutral-700 px-1.5 py-0.5 text-[11px] font-semibold";
  const orderedSelectClass = "w-28 rounded border border-neutral-700 px-1.5 py-0.5 text-[11px] font-semibold";
  const paidDateInputClass =
    "w-32 rounded border border-neutral-700 bg-neutral-900 px-1.5 py-0.5 text-[11px] text-neutral-100";
  const totalCostInputClass =
    "w-24 rounded border border-neutral-700 bg-neutral-900 px-1.5 py-0.5 text-right text-[11px] text-neutral-100";

  function renderHeaderRow(withActions: boolean) {
    return (
      <tr>
        <th className="w-8 px-2 py-2" />
        <th className="px-3 py-2 text-left">Number</th>
        <th className="px-3 py-2 text-left">Supplier</th>
        <th className="px-3 py-2 text-left">PO Date</th>
        <th className="px-3 py-2 text-left">Expected Delivery</th>
        <th className="px-3 py-2 text-right">Total Cost</th>
        <th className="px-3 py-2 text-left">Status</th>
        <th className="px-3 py-2 text-left">Paid</th>
        <th className="px-3 py-2 text-left">Paid Date</th>
        <th className="px-3 py-2 text-left">Ordered</th>
        <th className="px-3 py-2 text-left">Comments</th>
        {withActions && <th className="px-3 py-2 text-left">Actions</th>}
      </tr>
    );
  }

  function renderOrderRow(po: PurchaseOrder, opts: { costEditable: boolean; actions?: React.ReactNode }) {
    const items = itemsByPo[po.id] ?? [];
    const isExpanded = expanded[po.id] ?? false;
    const columnCount = opts.actions !== undefined ? 11 : 10;

    return (
      <Fragment key={po.id}>
        <tr onClick={() => toggleExpanded(po.id)} className="cursor-pointer hover:bg-neutral-900/60">
          <td className="px-2 py-2 text-center text-neutral-500">{isExpanded ? "▾" : "▸"}</td>
          <td className="px-3 py-2 font-medium text-neutral-100">{po.ekos_po_number}</td>
          <td className="px-3 py-2 text-neutral-300">{po.supplier}</td>
          <td className="px-3 py-2 text-neutral-400">{formatDate(po.po_date)}</td>
          <td className="px-3 py-2 text-neutral-400">{formatDate(po.expected_delivery_date)}</td>
          <td className="px-3 py-2 text-right text-neutral-100" onClick={(e) => e.stopPropagation()}>
            {opts.costEditable ? (
              <input
                type="number"
                step="0.01"
                defaultValue={po.total_cost ?? ""}
                onBlur={(e) => handleTotalCostChange(po.id, e.target.value)}
                className={totalCostInputClass}
              />
            ) : po.total_cost != null ? (
              currencyFormatter.format(po.total_cost)
            ) : (
              "—"
            )}
          </td>
          <td className="px-3 py-2 text-neutral-400">{po.status ?? "—"}</td>
          <td className="px-3 py-2" onClick={(e) => e.stopPropagation()}>
            <select
              value={po.payment_status}
              onChange={(e) => handlePaymentStatusChange(po.id, e.target.value as PoPaymentStatus)}
              className={paymentSelectClass}
              style={{ backgroundColor: PO_PAYMENT_STATUS_COLORS[po.payment_status], color: "#000000" }}
            >
              {(Object.keys(PO_PAYMENT_STATUS_LABELS) as PoPaymentStatus[]).map((s) => (
                <option key={s} value={s} style={{ backgroundColor: PO_PAYMENT_STATUS_COLORS[s], color: "#000000" }}>
                  {PO_PAYMENT_STATUS_LABELS[s]}
                </option>
              ))}
            </select>
          </td>
          <td className="px-3 py-2" onClick={(e) => e.stopPropagation()}>
            <input
              type="date"
              value={po.paid_date ?? ""}
              onChange={(e) => handlePaidDateChange(po.id, e.target.value)}
              className={paidDateInputClass}
            />
          </td>
          <td className="px-3 py-2" onClick={(e) => e.stopPropagation()}>
            <select
              value={po.ordered_status}
              onChange={(e) => handleOrderedStatusChange(po.id, e.target.value as PoOrderedStatus)}
              className={orderedSelectClass}
              style={{ backgroundColor: PO_ORDERED_STATUS_COLORS[po.ordered_status], color: "#000000" }}
            >
              {(Object.keys(PO_ORDERED_STATUS_LABELS) as PoOrderedStatus[]).map((s) => (
                <option key={s} value={s} style={{ backgroundColor: PO_ORDERED_STATUS_COLORS[s], color: "#000000" }}>
                  {PO_ORDERED_STATUS_LABELS[s]}
                </option>
              ))}
            </select>
          </td>
          <td className="px-3 py-2 text-neutral-300">{po.comments ?? "—"}</td>
          {opts.actions !== undefined && (
            <td className="px-3 py-2" onClick={(e) => e.stopPropagation()}>
              {opts.actions}
            </td>
          )}
        </tr>
        {isExpanded && (
          <tr className="bg-neutral-950/60">
            <td />
            <td colSpan={columnCount} className="px-3 py-3">
              {items.length === 0 ? (
                <p className="text-sm text-neutral-500">No line items captured.</p>
              ) : (
                <table className="w-full max-w-4xl text-xs">
                  <thead className="text-neutral-500">
                    <tr>
                      <th className="px-2 py-1 text-left">Item</th>
                      <th className="px-2 py-1 text-right">Quantity</th>
                      <th className="px-2 py-1 text-right">Unit Cost</th>
                      <th className="px-2 py-1 text-right">Line Total</th>
                      {po.adds_to_inventory && <th className="px-2 py-1 text-left">Added to inventory</th>}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-neutral-900">
                    {items.map((item) => (
                      <tr key={item.id}>
                        <td className="px-2 py-1 text-neutral-300">{item.item_name}</td>
                        <td className="px-2 py-1 text-right text-neutral-300">{item.quantity ?? "—"}</td>
                        <td className="px-2 py-1 text-right text-neutral-400">
                          {item.unit_cost != null ? currencyFormatter.format(item.unit_cost) : "—"}
                        </td>
                        <td className="px-2 py-1 text-right text-neutral-400">
                          {item.line_total != null ? currencyFormatter.format(item.line_total) : "—"}
                        </td>
                        {po.adds_to_inventory && (
                          <td className="px-2 py-1 text-neutral-300">{addedToInventory(po, item.item_name)}</td>
                        )}
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
  }

  return (
    <div className="space-y-8">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-lg font-semibold text-neutral-100">Open Purchase Orders</h1>
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
      </div>

      {needsDecision.length > 0 && (
        <div className="rounded-lg border border-amber-500/40 bg-amber-500/5 p-4">
          <h2 className="text-sm font-semibold text-amber-300">Needs a decision — inventory</h2>
          <p className="mb-3 text-xs text-neutral-400">
            Packaging or label items on completed POs that don&apos;t match a Packaging Inventory or
            Label Inventory row yet, so they haven&apos;t been added. Once saved, the same item name
            is matched automatically on future POs.
          </p>
          {pickError && <p className="mb-2 text-xs text-red-400">{pickError}</p>}
          <table className="w-full text-xs">
            <thead className="text-neutral-500">
              <tr>
                <th className="px-2 py-1 text-left">PO</th>
                <th className="px-2 py-1 text-left">Supplier</th>
                <th className="px-2 py-1 text-left">Item</th>
                <th className="px-2 py-1 text-right">Quantity</th>
                <th className="px-2 py-1 text-left">Goes to</th>
                <th className="px-2 py-1" />
              </tr>
            </thead>
            <tbody className="divide-y divide-neutral-900">
              {needsDecision.map((row) => (
                <tr key={row.item_id}>
                  <td className="px-2 py-1 text-neutral-100">{row.ekos_po_number}</td>
                  <td className="px-2 py-1 text-neutral-300">{row.supplier}</td>
                  <td className="px-2 py-1 text-neutral-300">{row.item_name}</td>
                  <td className="px-2 py-1 text-right text-neutral-300">
                    {row.quantity != null ? qtyFormatter.format(row.quantity) : "—"}
                  </td>
                  <td className="px-2 py-1">
                    <select
                      value={picks[row.item_id] ?? ""}
                      onChange={(e) => setPicks((prev) => ({ ...prev, [row.item_id]: e.target.value }))}
                      className="w-72 rounded border border-neutral-700 bg-neutral-900 px-1.5 py-0.5 text-[11px] text-neutral-100"
                    >
                      <option value="">Pick one…</option>
                      <optgroup label="Packaging Inventory">
                        {PACKAGING_ITEMS.map((item) => (
                          <option key={item.key} value={`packaging:${item.key}`}>
                            {item.label}
                          </option>
                        ))}
                      </optgroup>
                      <optgroup label="Label Inventory">
                        {labelProducts.map((p) => (
                          <option key={p.id} value={`label:${p.id}`}>
                            {p.name} labels
                          </option>
                        ))}
                      </optgroup>
                      <optgroup label="Other">
                        <option value="skip:">Not packaging — don&apos;t add</option>
                      </optgroup>
                    </select>
                  </td>
                  <td className="px-2 py-1 text-right">
                    <button
                      type="button"
                      disabled={!picks[row.item_id] || savingPick === row.item_id}
                      onClick={() => handleSavePick(row)}
                      className="rounded border border-brand/50 px-2 py-1 text-[11px] font-medium text-brand hover:bg-brand/10 disabled:opacity-40"
                    >
                      {savingPick === row.item_id ? "Saving…" : "Save"}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div className="overflow-x-auto rounded-lg border border-neutral-800">
        <table className="min-w-full text-sm">
          <thead className="bg-neutral-900 text-xs uppercase tracking-wide text-neutral-500">
            {renderHeaderRow(false)}
          </thead>
          <tbody className="divide-y divide-neutral-900">
            {loading ? (
              <tr>
                <td colSpan={11} className="px-3 py-6 text-center text-neutral-500">
                  Loading…
                </td>
              </tr>
            ) : openOrders.length === 0 ? (
              <tr>
                <td colSpan={11} className="px-3 py-6 text-center text-neutral-500">
                  No open purchase orders — the automatic Ekos sync (Admin → Ekos Sync) pulls them
                  in.
                </td>
              </tr>
            ) : (
              openOrders.map((po) => renderOrderRow(po, { costEditable: false }))
            )}
          </tbody>
        </table>
      </div>

      <div>
        <div className="mb-2">
          <h2 className="text-sm font-semibold text-neutral-100">Holding</h2>
          <p className="text-xs text-neutral-500">
            Dropped off the latest Ekos sync (closed/received there) — pick Delete or Complete for
            each one. Total Cost and Paid Date are editable here.
          </p>
        </div>
        <div className="overflow-x-auto rounded-lg border border-neutral-800">
          <table className="min-w-full text-sm">
            <thead className="bg-neutral-900 text-xs uppercase tracking-wide text-neutral-500">
              {renderHeaderRow(true)}
            </thead>
            <tbody className="divide-y divide-neutral-900">
              {loading ? (
                <tr>
                  <td colSpan={12} className="px-3 py-6 text-center text-neutral-500">
                    Loading…
                  </td>
                </tr>
              ) : holdingOrders.length === 0 ? (
                <tr>
                  <td colSpan={12} className="px-3 py-6 text-center text-neutral-500">
                    Nothing waiting on a decision.
                  </td>
                </tr>
              ) : (
                holdingOrders.map((po) =>
                  renderOrderRow(po, {
                    costEditable: true,
                    actions: (
                      <div className="flex items-center gap-2">
                        <button
                          type="button"
                          onClick={() => handleCompletePo(po.id)}
                          className="rounded border border-brand/50 px-2 py-1 text-[11px] font-medium text-brand hover:bg-brand/10"
                        >
                          Complete
                        </button>
                        <button
                          type="button"
                          onClick={() => handleDeletePo(po.id)}
                          className="rounded border border-red-500/50 px-2 py-1 text-[11px] font-medium text-red-400 hover:bg-red-500/10"
                        >
                          Delete
                        </button>
                      </div>
                    ),
                  }),
                )
              )}
            </tbody>
          </table>
        </div>
      </div>

      <div>
        <div className="mb-2">
          <h2 className="text-sm font-semibold text-neutral-100">
            <button
              type="button"
              onClick={() => inventoryFeature.isNew && inventoryFeature.dismiss()}
              className={`flex items-center ${inventoryFeature.isNew ? "cursor-pointer" : "cursor-default"}`}
            >
              Completed Purchase Orders
              {inventoryFeature.isNew && <NewBadge inline />}
            </button>
          </h2>
          <p className="text-xs text-neutral-500">
            The archive. Completing a PO adds its cans, lids, trays, Pak-Techs, kegs and labels to
            the current week&apos;s Packaging Inventory and Label Inventory On Hand (open a PO to see
            what it added). Total Cost and Paid Date stay editable in case a final invoice differs
            from what Ekos originally reported.
          </p>
        </div>
        <div className="overflow-x-auto rounded-lg border border-neutral-800">
          <table className="min-w-full text-sm">
            <thead className="bg-neutral-900 text-xs uppercase tracking-wide text-neutral-500">
              {renderHeaderRow(false)}
            </thead>
            <tbody className="divide-y divide-neutral-900">
              {loading ? (
                <tr>
                  <td colSpan={11} className="px-3 py-6 text-center text-neutral-500">
                    Loading…
                  </td>
                </tr>
              ) : completedOrders.length === 0 ? (
                <tr>
                  <td colSpan={11} className="px-3 py-6 text-center text-neutral-500">
                    Nothing completed yet.
                  </td>
                </tr>
              ) : (
                completedOrders.map((po) => renderOrderRow(po, { costEditable: true }))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
