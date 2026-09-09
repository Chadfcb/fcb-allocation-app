"use client";

// Finance > Cash Flow Dashboard — rebuilt 2026-09-09 to match the actual
// layout of Chad's "Batch to Cash" spreadsheet's Dashboard tab (see
// claude/batch-to-cash-dashboard-layout.md in the project for the exact,
// cell-by-cell transcription Chad and Claude worked from), not a
// from-scratch redesign:
//
//   REVENUE IN     — one row per distributor, one column per week
//   EXPENSES OUT   — one row per vendor, one column per week
//   NET CASH FLOW  — per week, Total Revenue minus Total Expenses
//   RUNNING TOTAL  — cumulative Net Cash Flow across weeks (the
//                    spreadsheet's own Running Total was a plain typed
//                    number, never actually computed — this version
//                    computes a real cumulative sum)
//
//   Column range for the four rows above, per Chad 2026-09-09: built like
//   the spreadsheet — the current week (the most recent real week on
//   file, highlighted with a ★, matching the spreadsheet's own Wk37 ★),
//   the previous 3 real weeks before it, then extended forward with
//   placeholder weeks out to 18 months (no real Revenue data exists for
//   those yet — but Expenses CAN land there, see below).
//
//   CASH FLOW TIMING SUMMARY — a weekly-rows table (Week Start / Cash In /
//                    Cumulative In / Cash Out / Cumulative Out / Net Cash)
//                    running 18 months out (not 13 weeks — Chad's boss Art
//                    wants an 18-month view), plus an 18-month KPI list.
//                    Per Chad, 2026-09-09: still a PLACEHOLDER — the
//                    spreadsheet's own version of this section was never
//                    wired up either, so there's nothing to port yet. Shows
//                    the real week-start dates and column headers now;
//                    real Cash In/Out numbers are a follow-up once we
//                    decide what feeds an 18-month-out projection (planned
//                    batches, distributor terms, etc. — the Brew Planner
//                    work).
//
// Revenue In IS wired to real data: for every week a distributor's PO is
// marked Delivered, the same Order Value math (quantity × that
// distributor's price, summed across every product) the Inventory &
// Allocation page itself uses.
//
// Revenue In — TIMING rule, reworked 2026-09-09 (this used to just land in
// the week the order itself was in, gated only on po_status === 'delivered'):
//   - Still only counts once a distributor's order is marked Delivered —
//     Approved does NOT count as revenue.
//   - WHICH column it lands in is no longer "that order's own week" — it's
//     that order's Delivery Date (set on the Inventory & Allocations page
//     the moment a distributor's status flips to Delivered, editable/
//     backdatable after) plus that distributor's payment Terms (in days,
//     see Finance > Distributor Data — 0 means due on delivery/COD, 30
//     means net-30, etc.). Delivery Date + Terms is bucketed into a column
//     the same way Expenses Out buckets a PO — via columnIndexForDate — so
//     a distributor's revenue can now land in a placeholder (future)
//     column, same as a rolled-forward pending expense can.
//
// Expenses Out — bucketing rule, added 2026-09-09 (this used to just be
// po_date for every PO, regardless of paid/pending):
//   - A Paid PO lands in whichever week its Paid Date falls in (the date
//     it was actually marked Paid on the Open Purchase Orders page — see
//     PurchaseOrdersPageClient.tsx).
//   - A Pending PO lands in its PO Date's week — UNLESS that week has
//     already passed, in which case it automatically rolls forward into
//     the CURRENT real-world week instead (computed live off today's
//     actual date every time this page loads; nothing manual, and
//     completely independent of the "Start New Week" button on the
//     Inventory side). It keeps effectively "riding along" in the current
//     week until it's marked Paid.
//   - Every dollar figure carries a small color marker matching the Open
//     Purchase Orders page's own Paid/Pending colors (PO_PAYMENT_STATUS_
//     COLORS). A vendor/week cell with both paid and pending POs in it
//     splits into two stacked amounts instead of one combined total.
//   - Net Cash Flow / Running Total still combine paid + pending (same as
//     before this change) — only the Expenses Out grid's own display
//     splits them apart.
//
// Access to the tables this reads (allocations, distributor_pos,
// purchase_orders) is granted either by their own usual section
// (inventory_allocation / purchase_orders) OR by cashflow_dashboard itself
// (see sql/is_super_admin.sql) — so this works standalone for someone who
// has ONLY been granted Finance.
//
// Live via Supabase Realtime, added 2026-09-09 — this page used to only
// load once and never update again while you were looking at it, unlike
// the rest of the app. Now it reloads on any change to weeks, distributors
// (Terms), distributor_pos (status/Delivery Date), allocations,
// distributor_prices, or purchase_orders.

import { useMemo, useCallback, useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { PO_PAYMENT_STATUS_COLORS } from "@/lib/types/db";

interface WeekRow {
  id: string;
  label: string;
  week_start: string;
}

interface DistributorRow {
  id: string;
  name: string;
  payment_terms_days: number;
}

interface DistributorPoRow {
  week_id: string;
  distributor_id: string;
  po_status: string | null;
  delivery_date: string | null;
}

interface PoRow {
  supplier: string;
  po_date: string | null;
  total_cost: number | null;
  payment_status: string;
  paid_date: string | null;
}

interface GridColumn {
  key: string;
  weekId: string | null; // null for a placeholder future week
  dateIso: string;
  topLabel: string;
  isCurrent: boolean;
  isPlaceholder: boolean;
}

interface ExpenseAmounts {
  paid: number;
  pending: number;
}

const currency = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  maximumFractionDigits: 0,
});

function Money({ value, className = "" }: { value: number; className?: string }) {
  if (value === 0) return <span className="text-neutral-600">—</span>;
  return (
    <span className={`${value < 0 ? "text-red-400" : ""} ${className}`}>{currency.format(value)}</span>
  );
}

function ExpenseDot({ color }: { color: string }) {
  return <span className="inline-block h-1.5 w-1.5 shrink-0 rounded-full" style={{ backgroundColor: color }} />;
}

// Paid amount (green dot) stacked over pending amount (orange dot) —
// matching the Open Purchase Orders page's own Paid/Pending colors. Shows
// just one line when a cell is entirely one or the other, "—" when both
// are zero.
function ExpenseCell({ amounts }: { amounts: ExpenseAmounts }) {
  const { paid, pending } = amounts;
  if (paid === 0 && pending === 0) return <span className="text-neutral-600">—</span>;
  return (
    <div className="flex flex-col items-end gap-0.5">
      {paid !== 0 && (
        <span className="flex items-center gap-1 text-neutral-200">
          <ExpenseDot color={PO_PAYMENT_STATUS_COLORS.paid} />
          {currency.format(paid)}
        </span>
      )}
      {pending !== 0 && (
        <span className="flex items-center gap-1 text-neutral-200">
          <ExpenseDot color={PO_PAYMENT_STATUS_COLORS.pending} />
          {currency.format(pending)}
        </span>
      )}
    </div>
  );
}

function shortDate(iso: string) {
  return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

// 18 months, weekly — 78 rows (18 * ~30.44 days / 7 ≈ 78.3). Starts the
// Monday after the most recent real week the app knows about (or today, if
// there are no weeks yet) since these are all FUTURE placeholder rows —
// the spreadsheet's own Cash Flow Timing Summary always looked forward
// from "now", never backward.
const TIMING_SUMMARY_WEEKS = 78;

function buildTimingSummaryWeeks(mostRecentWeekStart: string | null): string[] {
  const start = mostRecentWeekStart ? new Date(mostRecentWeekStart) : new Date();
  const dates: string[] = [];
  for (let i = 1; i <= TIMING_SUMMARY_WEEKS; i++) {
    const d = new Date(start);
    d.setDate(d.getDate() + i * 7);
    dates.push(d.toISOString());
  }
  return dates;
}

// Finds which column's weekly window a date falls into — a column's
// window runs from its own date up to (but not including) the next
// column's date, or +7 days for the very last column. Used both to bucket
// a PO by its own date AND to find "today's column" for rolling pending
// POs forward. Dates before the first column or after the last one clamp
// to that end, so this never returns an out-of-range index.
function columnIndexForDate(columns: { dateIso: string }[], dateIso: string): number {
  const d = new Date(dateIso).getTime();
  for (let i = 0; i < columns.length; i++) {
    const start = new Date(columns[i].dateIso).getTime();
    const end =
      i + 1 < columns.length ? new Date(columns[i + 1].dateIso).getTime() : start + 7 * 24 * 60 * 60 * 1000;
    if (d >= start && d < end) return i;
  }
  if (columns.length === 0) return -1;
  return d < new Date(columns[0].dateIso).getTime() ? 0 : columns.length - 1;
}

export default function CashflowDashboardPageClient() {
  const [supabase] = useState(() => createClient());
  const [loading, setLoading] = useState(true);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const [weeks, setWeeks] = useState<WeekRow[]>([]);
  const [distributors, setDistributors] = useState<DistributorRow[]>([]);
  const [distributorPoRows, setDistributorPoRows] = useState<DistributorPoRow[]>([]);
  const [orderValueByWeekDist, setOrderValueByWeekDist] = useState<Map<string, number>>(new Map());
  const [purchaseOrderRows, setPurchaseOrderRows] = useState<PoRow[]>([]);

  const load = useCallback(async () => {
    setErrorMsg(null);
    try {
      const [
        { data: weeksData, error: weeksErr },
        { data: distributorsData, error: distErr },
        { data: distributorPos, error: dposErr },
        { data: allocations, error: allocErr },
        { data: prices, error: pricesErr },
        { data: purchaseOrders, error: poErr },
      ] = await Promise.all([
        supabase.from("weeks").select("id, label, week_start").order("week_start", { ascending: true }),
        supabase
          .from("distributors")
          .select("id, name, active, sort_order, payment_terms_days")
          .eq("active", true)
          .order("sort_order", { ascending: true, nullsFirst: false }),
        supabase.from("distributor_pos").select("week_id, distributor_id, po_status, delivery_date"),
        supabase.from("allocations").select("week_id, distributor_id, product_id, quantity"),
        supabase.from("distributor_prices").select("distributor_id, product_id, price"),
        supabase
          .from("purchase_orders")
          .select("supplier, po_date, total_cost, payment_status, paid_date"),
      ]);

      const firstError = weeksErr ?? distErr ?? dposErr ?? allocErr ?? pricesErr ?? poErr;
      if (firstError) throw firstError;

      const weekRows = (weeksData ?? []) as WeekRow[];
      const distributorRows = (distributorsData ?? []) as DistributorRow[];

      // Order Value per (week, distributor) — quantity × that
      // distributor's price, summed across every product. Used to look up
      // the dollar amount for a delivered order once we know which column
      // its Delivery Date + Terms lands it in.
      const priceFor = new Map<string, number>();
      for (const p of prices ?? []) priceFor.set(`${p.product_id}:${p.distributor_id}`, p.price ?? 0);

      const allocationsByWeekDist = new Map<string, { product_id: string; quantity: number }[]>();
      for (const a of allocations ?? []) {
        const key = `${a.week_id}:${a.distributor_id}`;
        const list = allocationsByWeekDist.get(key) ?? [];
        list.push({ product_id: a.product_id, quantity: a.quantity ?? 0 });
        allocationsByWeekDist.set(key, list);
      }
      const orderValueMap = new Map<string, number>();
      for (const w of weekRows) {
        for (const d of distributorRows) {
          const key = `${w.id}:${d.id}`;
          const rows = allocationsByWeekDist.get(key) ?? [];
          const value = rows.reduce(
            (sum, r) => sum + (priceFor.get(`${r.product_id}:${d.id}`) ?? 0) * r.quantity,
            0,
          );
          orderValueMap.set(key, value);
        }
      }

      setWeeks(weekRows);
      setDistributors(distributorRows);
      setDistributorPoRows((distributorPos ?? []) as DistributorPoRow[]);
      setOrderValueByWeekDist(orderValueMap);
      setPurchaseOrderRows((purchaseOrders ?? []) as PoRow[]);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : "Couldn't load Cash Flow Dashboard data.");
    } finally {
      setLoading(false);
    }
  }, [supabase]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- intentional fetch-on-mount
    load();

    const channel = supabase
      .channel("cashflow-dashboard-live")
      .on("postgres_changes", { event: "*", schema: "public", table: "weeks" }, load)
      .on("postgres_changes", { event: "*", schema: "public", table: "distributors" }, load)
      .on("postgres_changes", { event: "*", schema: "public", table: "distributor_pos" }, load)
      .on("postgres_changes", { event: "*", schema: "public", table: "allocations" }, load)
      .on("postgres_changes", { event: "*", schema: "public", table: "distributor_prices" }, load)
      .on("postgres_changes", { event: "*", schema: "public", table: "purchase_orders" }, load)
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [supabase, load]);

  const timingWeeks = useMemo(
    () => buildTimingSummaryWeeks(weeks.length ? weeks[weeks.length - 1].week_start : null),
    [weeks],
  );

  // Column set for Revenue In / Expenses Out / Net Cash Flow / Running
  // Total: the current week (most recent real week on file) plus its
  // previous 3 real weeks, then the same 18-month run of placeholder
  // future weeks used below for the Timing Summary — built like the
  // spreadsheet, current week highlighted, extended out per Chad/Art.
  const displayColumns = useMemo<GridColumn[]>(() => {
    const currentWeekId = weeks.length ? weeks[weeks.length - 1].id : null;
    const realCols: GridColumn[] = weeks.slice(Math.max(0, weeks.length - 4)).map((w) => ({
      key: w.id,
      weekId: w.id,
      dateIso: w.week_start,
      topLabel: w.label,
      isCurrent: w.id === currentWeekId,
      isPlaceholder: false,
    }));
    const placeholderCols: GridColumn[] = timingWeeks.map((iso) => ({
      key: iso,
      weekId: null,
      dateIso: iso,
      topLabel: shortDate(iso),
      isCurrent: false,
      isPlaceholder: true,
    }));
    return [...realCols, ...placeholderCols];
  }, [weeks, timingWeeks]);

  // --- Revenue In: distributor x column, Order Value for each delivered
  // order, bucketed by that order's Delivery Date + the distributor's
  // payment Terms (see file header comment for the full rule). ---
  const revenueGrid = useMemo(() => {
    const grid = new Map<string, Map<string, number>>();
    for (const d of distributors) {
      const byCol = new Map<string, number>();
      for (const col of displayColumns) byCol.set(col.key, 0);
      grid.set(d.id, byCol);
    }
    if (displayColumns.length === 0) return grid;

    for (const dp of distributorPoRows) {
      if (dp.po_status !== "delivered" || !dp.delivery_date) continue;
      const byCol = grid.get(dp.distributor_id);
      if (!byCol) continue;

      const distributor = distributors.find((d) => d.id === dp.distributor_id);
      const terms = distributor?.payment_terms_days ?? 0;
      const targetDate = new Date(dp.delivery_date);
      targetDate.setDate(targetDate.getDate() + terms);

      const colIndex = columnIndexForDate(displayColumns, targetDate.toISOString());
      const col = displayColumns[colIndex];
      if (!col) continue;

      const value = orderValueByWeekDist.get(`${dp.week_id}:${dp.distributor_id}`) ?? 0;
      byCol.set(col.key, (byCol.get(col.key) ?? 0) + value);
    }
    return grid;
  }, [distributors, displayColumns, distributorPoRows, orderValueByWeekDist]);

  // --- Expenses Out: vendor x column, paid/pending split, with pending
  // POs whose own week has passed rolling forward to the current
  // real-world week (see file header comment for the full rule). ---
  const vendors = useMemo(
    () =>
      Array.from(new Set(purchaseOrderRows.map((po) => po.supplier).filter(Boolean))).sort((a, b) =>
        a.localeCompare(b),
      ),
    [purchaseOrderRows],
  );

  const expenseGrid = useMemo(() => {
    const grid = new Map<string, Map<string, ExpenseAmounts>>();
    for (const vendor of vendors) {
      const byCol = new Map<string, ExpenseAmounts>();
      for (const col of displayColumns) byCol.set(col.key, { paid: 0, pending: 0 });
      grid.set(vendor, byCol);
    }
    if (displayColumns.length === 0) return grid;

    const todayColIndex = columnIndexForDate(displayColumns, new Date().toISOString());

    for (const po of purchaseOrderRows) {
      const byCol = grid.get(po.supplier);
      if (!byCol) continue;
      const isPaid = po.payment_status === "paid";
      const targetDate = isPaid ? po.paid_date ?? po.po_date : po.po_date;
      if (!targetDate) continue;

      let colIndex = columnIndexForDate(displayColumns, targetDate);
      if (!isPaid && todayColIndex >= 0 && colIndex < todayColIndex) colIndex = todayColIndex;
      const col = displayColumns[colIndex];
      if (!col) continue;

      const amounts = byCol.get(col.key) ?? { paid: 0, pending: 0 };
      const amount = po.total_cost ?? 0;
      if (isPaid) amounts.paid += amount;
      else amounts.pending += amount;
      byCol.set(col.key, amounts);
    }
    return grid;
  }, [vendors, displayColumns, purchaseOrderRows]);

  // Per-column revenue / expense / net / running totals — a single pass so
  // Running Total is a genuine cumulative sum across the WHOLE column
  // range (real weeks AND placeholder weeks), since a rolled-forward
  // pending expense can now legitimately land in a placeholder column.
  const columnTotals = useMemo(() => {
    let cumulative = 0;
    return displayColumns.map((col) => {
      let revenue = 0;
      for (const byCol of revenueGrid.values()) revenue += byCol.get(col.key) ?? 0;
      let expensePaid = 0;
      let expensePending = 0;
      for (const byCol of expenseGrid.values()) {
        const amounts = byCol.get(col.key);
        if (amounts) {
          expensePaid += amounts.paid;
          expensePending += amounts.pending;
        }
      }
      const net = revenue - (expensePaid + expensePending);
      cumulative += net;
      return { key: col.key, revenue, expensePaid, expensePending, net, runningTotal: cumulative };
    });
  }, [displayColumns, expenseGrid, revenueGrid]);

  const columnTotalsByKey = useMemo(() => new Map(columnTotals.map((c) => [c.key, c])), [columnTotals]);

  const rowLabelCellClass =
    "sticky left-0 z-10 whitespace-nowrap bg-neutral-950 px-3 py-1.5 text-left text-neutral-300";
  const weekHeaderCellClass =
    "sticky top-0 z-10 whitespace-nowrap bg-neutral-900 px-3 py-1.5 text-right text-xs font-semibold uppercase tracking-wide text-neutral-400";
  const valueCellClass = "whitespace-nowrap px-3 py-1.5 text-right text-neutral-200";

  function renderColumnHeader(col: GridColumn, compact = false) {
    return (
      <th
        key={col.key}
        className={`${weekHeaderCellClass} ${col.isCurrent ? "bg-[#6ABC46]/10 text-[#6ABC46]" : ""} ${col.isPlaceholder ? "text-neutral-600" : ""}`}
      >
        {col.isPlaceholder ? (
          shortDate(col.dateIso)
        ) : compact ? (
          <>
            {col.topLabel}
            {col.isCurrent && <span className="ml-1">★</span>}
          </>
        ) : (
          <>
            {col.topLabel}
            {col.isCurrent && <span className="ml-1">★</span>}
            <br />
            <span className="font-normal normal-case text-neutral-500">{shortDate(col.dateIso)}</span>
          </>
        )}
      </th>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-lg font-semibold text-neutral-100">Cash Flow Dashboard</h1>
        <p className="text-sm text-neutral-400">
          Weekly revenue by distributor, weekly expenses by vendor, and the running cash
          position — the web-app version of the Batch to Cash spreadsheet&apos;s Dashboard tab.
        </p>
      </div>

      {errorMsg && (
        <div className="rounded-lg border border-red-900 bg-red-950/30 px-4 py-3 text-sm text-red-300">
          {errorMsg}
        </div>
      )}

      {loading ? (
        <p className="text-sm text-neutral-400">Loading…</p>
      ) : weeks.length === 0 ? (
        <p className="text-sm text-neutral-500">No weeks exist yet — nothing to show.</p>
      ) : (
        <>
          <div className="rounded-lg border border-neutral-800 bg-neutral-950">
            <div className="border-b border-neutral-900 px-4 py-3">
              <h2 className="text-sm font-semibold text-neutral-100">Revenue In</h2>
              <p className="text-xs text-neutral-500">
                Order Value for each distributor&apos;s Delivered orders, landing in whichever
                week is Delivery Date + that distributor&apos;s payment Terms (see Finance &gt;
                Distributor Data)
              </p>
            </div>
            <div className="max-h-[420px] overflow-auto">
              <table className="min-w-full border-collapse text-sm">
                <thead>
                  <tr>
                    <th className={`${weekHeaderCellClass} sticky left-0 z-20 text-left`}>Distributor</th>
                    {displayColumns.map((col) => renderColumnHeader(col))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-neutral-900">
                  {distributors.map((d) => (
                    <tr key={d.id} className="hover:bg-neutral-900/40">
                      <td className={rowLabelCellClass}>{d.name}</td>
                      {displayColumns.map((col) => (
                        <td key={col.key} className={valueCellClass}>
                          <Money value={revenueGrid.get(d.id)?.get(col.key) ?? 0} />
                        </td>
                      ))}
                    </tr>
                  ))}
                  <tr className="border-t-2 border-neutral-800 font-semibold text-neutral-100">
                    <td className={`${rowLabelCellClass} bg-neutral-900`}>Total Revenue</td>
                    {displayColumns.map((col) => (
                      <td key={col.key} className={`${valueCellClass} bg-neutral-900`}>
                        <Money
                          value={columnTotalsByKey.get(col.key)?.revenue ?? 0}
                          className="text-[#6ABC46]"
                        />
                      </td>
                    ))}
                  </tr>
                </tbody>
              </table>
            </div>
          </div>

          <div className="rounded-lg border border-neutral-800 bg-neutral-950">
            <div className="border-b border-neutral-900 px-4 py-3">
              <h2 className="text-sm font-semibold text-neutral-100">Expenses Out</h2>
              <p className="text-xs text-neutral-500">
                Paid POs land in the week they were paid; pending POs land in their PO-date week,
                rolling forward to the current week once that&apos;s passed.{" "}
                <span className="inline-flex items-center gap-1">
                  <ExpenseDot color={PO_PAYMENT_STATUS_COLORS.paid} /> Paid
                </span>{" "}
                <span className="inline-flex items-center gap-1">
                  <ExpenseDot color={PO_PAYMENT_STATUS_COLORS.pending} /> Pending
                </span>
              </p>
            </div>
            <div className="max-h-[420px] overflow-auto">
              <table className="min-w-full border-collapse text-sm">
                <thead>
                  <tr>
                    <th className={`${weekHeaderCellClass} sticky left-0 z-20 text-left`}>Vendor</th>
                    {displayColumns.map((col) => renderColumnHeader(col))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-neutral-900">
                  {vendors.length === 0 ? (
                    <tr>
                      <td colSpan={displayColumns.length + 1} className="px-4 py-4 text-center text-neutral-500">
                        No vendor purchase orders on file.
                      </td>
                    </tr>
                  ) : (
                    vendors.map((vendor) => (
                      <tr key={vendor} className="hover:bg-neutral-900/40">
                        <td className={rowLabelCellClass}>{vendor}</td>
                        {displayColumns.map((col) => (
                          <td key={col.key} className={valueCellClass}>
                            <ExpenseCell
                              amounts={expenseGrid.get(vendor)?.get(col.key) ?? { paid: 0, pending: 0 }}
                            />
                          </td>
                        ))}
                      </tr>
                    ))
                  )}
                  <tr className="border-t-2 border-neutral-800 font-semibold text-neutral-100">
                    <td className={`${rowLabelCellClass} bg-neutral-900`}>Total Expenses</td>
                    {displayColumns.map((col) => {
                      const totals = columnTotalsByKey.get(col.key);
                      return (
                        <td key={col.key} className={`${valueCellClass} bg-neutral-900`}>
                          <ExpenseCell
                            amounts={{
                              paid: totals?.expensePaid ?? 0,
                              pending: totals?.expensePending ?? 0,
                            }}
                          />
                        </td>
                      );
                    })}
                  </tr>
                </tbody>
              </table>
            </div>
          </div>

          <div className="rounded-lg border border-neutral-800 bg-neutral-950">
            <div className="overflow-auto">
              <table className="min-w-full border-collapse text-sm">
                <thead>
                  <tr>
                    <th className={`${weekHeaderCellClass} sticky left-0 z-20 text-left`}></th>
                    {displayColumns.map((col) => renderColumnHeader(col, true))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-neutral-900">
                  <tr className="font-semibold">
                    <td className={rowLabelCellClass}>Net Cash Flow</td>
                    {displayColumns.map((col) => (
                      <td key={col.key} className={valueCellClass}>
                        <Money value={columnTotalsByKey.get(col.key)?.net ?? 0} className="text-[#6ABC46]" />
                      </td>
                    ))}
                  </tr>
                  <tr className="font-semibold">
                    <td className={rowLabelCellClass}>Running Total</td>
                    {displayColumns.map((col) => (
                      <td key={col.key} className={valueCellClass}>
                        <Money
                          value={columnTotalsByKey.get(col.key)?.runningTotal ?? 0}
                          className="text-[#6ABC46]"
                        />
                      </td>
                    ))}
                  </tr>
                </tbody>
              </table>
            </div>
          </div>

          <div>
            <h2 className="text-sm font-semibold text-neutral-100">Cash Flow Timing Summary</h2>
            <p className="text-xs text-neutral-500">
              18-month forward view — placeholder until this is wired to real projected data
              (planned batches, distributor terms, etc.)
            </p>
          </div>

          <div className="rounded-lg border border-dashed border-amber-900 bg-amber-950/20 px-4 py-3">
            <p className="text-sm font-medium text-amber-300">Not linked to data yet</p>
            <p className="mt-1 text-xs text-neutral-400">
              The dates below are real (every Monday for the next 18 months); Cash In / Cash Out /
              Net Cash are placeholders until we decide what feeds a real forward-looking
              projection.
            </p>
          </div>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            {["18-Mo Cash In", "18-Mo Cash Out", "18-Mo Net"].map((kpi) => (
              <div key={kpi} className="rounded-lg border border-neutral-800 bg-neutral-950 p-4">
                <p className="text-xs font-medium uppercase tracking-wide text-neutral-500">{kpi}</p>
                <p className="mt-1 text-2xl font-semibold text-neutral-600">—</p>
              </div>
            ))}
          </div>

          <div className="rounded-lg border border-neutral-800 bg-neutral-950">
            <div className="max-h-[420px] overflow-auto">
              <table className="min-w-full border-collapse text-sm">
                <thead>
                  <tr>
                    <th className={`${weekHeaderCellClass} sticky left-0 z-20 text-left`}>Week Start</th>
                    <th className={weekHeaderCellClass}>Cash In</th>
                    <th className={weekHeaderCellClass}>Cumulative In</th>
                    <th className={weekHeaderCellClass}>Cash Out</th>
                    <th className={weekHeaderCellClass}>Cumulative Out</th>
                    <th className={weekHeaderCellClass}>Net Cash</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-neutral-900">
                  {timingWeeks.map((iso) => (
                    <tr key={iso} className="hover:bg-neutral-900/40">
                      <td className={rowLabelCellClass}>
                        {new Date(iso).toLocaleDateString("en-US", {
                          year: "numeric",
                          month: "short",
                          day: "numeric",
                        })}
                      </td>
                      <td className={valueCellClass}>—</td>
                      <td className={valueCellClass}>—</td>
                      <td className={valueCellClass}>—</td>
                      <td className={valueCellClass}>—</td>
                      <td className={valueCellClass}>—</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
