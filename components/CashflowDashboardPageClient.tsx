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
// Revenue In / Expenses Out / Net / Running Total ARE wired to real data:
//   - Revenue: for every week a distributor's PO is marked Delivered, the
//     same Order Value math (quantity × that distributor's price, summed
//     across every product) the Inventory & Allocation page itself uses.
//   - Expenses: purchase_orders.total_cost, bucketed into whichever week
//     each PO's po_date falls in, grouped by supplier (the spreadsheet's
//     "vendor" rows).
//
// Access to the tables this reads (allocations, distributor_pos,
// purchase_orders) is granted either by their own usual section
// (inventory_allocation / purchase_orders) OR by cashflow_dashboard itself
// (see sql/is_super_admin.sql) — so this works standalone for someone who
// has ONLY been granted Finance.

import { useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";

interface WeekRow {
  id: string;
  label: string;
  week_start: string;
}

interface DistributorRow {
  id: string;
  name: string;
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

export default function CashflowDashboardPageClient() {
  const [supabase] = useState(() => createClient());
  const [loading, setLoading] = useState(true);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const [weeks, setWeeks] = useState<WeekRow[]>([]);
  const [distributors, setDistributors] = useState<DistributorRow[]>([]);
  const [revenueGrid, setRevenueGrid] = useState<Map<string, Map<string, number>>>(new Map());
  const [vendors, setVendors] = useState<string[]>([]);
  const [expenseGrid, setExpenseGrid] = useState<Map<string, Map<string, number>>>(new Map());

  useEffect(() => {
    let cancelled = false;

    async function load() {
      setLoading(true);
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
            .select("id, name, active, sort_order")
            .eq("active", true)
            .order("sort_order", { ascending: true, nullsFirst: false }),
          supabase.from("distributor_pos").select("week_id, distributor_id, po_status"),
          supabase.from("allocations").select("week_id, distributor_id, product_id, quantity"),
          supabase.from("distributor_prices").select("distributor_id, product_id, price"),
          supabase.from("purchase_orders").select("supplier, po_date, total_cost"),
        ]);

        const firstError = weeksErr ?? distErr ?? dposErr ?? allocErr ?? pricesErr ?? poErr;
        if (firstError) throw firstError;
        if (cancelled) return;

        const weekRows = (weeksData ?? []) as WeekRow[];
        const distributorRows = (distributorsData ?? []) as DistributorRow[];

        // --- Revenue In: distributor x week, Order Value where Delivered ---
        const priceFor = new Map<string, number>();
        for (const p of prices ?? []) priceFor.set(`${p.product_id}:${p.distributor_id}`, p.price ?? 0);

        const allocationsByWeekDist = new Map<string, { product_id: string; quantity: number }[]>();
        for (const a of allocations ?? []) {
          const key = `${a.week_id}:${a.distributor_id}`;
          const list = allocationsByWeekDist.get(key) ?? [];
          list.push({ product_id: a.product_id, quantity: a.quantity ?? 0 });
          allocationsByWeekDist.set(key, list);
        }
        function orderValueFor(weekId: string, distributorId: string): number {
          const rows = allocationsByWeekDist.get(`${weekId}:${distributorId}`) ?? [];
          return rows.reduce((sum, r) => sum + (priceFor.get(`${r.product_id}:${distributorId}`) ?? 0) * r.quantity, 0);
        }
        const deliveredSet = new Set<string>();
        for (const dp of distributorPos ?? []) {
          if (dp.po_status === "delivered") deliveredSet.add(`${dp.week_id}:${dp.distributor_id}`);
        }
        const revGrid = new Map<string, Map<string, number>>();
        for (const d of distributorRows) {
          const byWeek = new Map<string, number>();
          for (const w of weekRows) {
            const key = `${w.id}:${d.id}`;
            byWeek.set(w.id, deliveredSet.has(key) ? orderValueFor(w.id, d.id) : 0);
          }
          revGrid.set(d.id, byWeek);
        }

        // --- Expenses Out: vendor (supplier) x week, by po_date ---
        const vendorNames = Array.from(
          new Set((purchaseOrders ?? []).map((po) => po.supplier).filter(Boolean)),
        ).sort((a, b) => a.localeCompare(b));

        // Bucket each PO into whichever week its po_date falls in — a
        // week's window is [week_start, next week's week_start), or
        // [week_start, week_start+7d) for the very last week on file.
        function weekIdForDate(dateStr: string | null): string | null {
          if (!dateStr) return null;
          const d = new Date(dateStr).getTime();
          for (let i = 0; i < weekRows.length; i++) {
            const start = new Date(weekRows[i].week_start).getTime();
            const end =
              i + 1 < weekRows.length
                ? new Date(weekRows[i + 1].week_start).getTime()
                : start + 7 * 24 * 60 * 60 * 1000;
            if (d >= start && d < end) return weekRows[i].id;
          }
          return null;
        }

        const expGrid = new Map<string, Map<string, number>>();
        for (const vendor of vendorNames) {
          const byWeek = new Map<string, number>();
          for (const w of weekRows) byWeek.set(w.id, 0);
          expGrid.set(vendor, byWeek);
        }
        for (const po of purchaseOrders ?? []) {
          const weekId = weekIdForDate(po.po_date);
          if (!weekId) continue;
          const byWeek = expGrid.get(po.supplier);
          if (!byWeek) continue;
          byWeek.set(weekId, (byWeek.get(weekId) ?? 0) + (po.total_cost ?? 0));
        }

        setWeeks(weekRows);
        setDistributors(distributorRows);
        setRevenueGrid(revGrid);
        setVendors(vendorNames);
        setExpenseGrid(expGrid);
      } catch (err) {
        if (!cancelled) {
          setErrorMsg(
            err instanceof Error ? err.message : "Couldn't load Cash Flow Dashboard data.",
          );
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    load();
    return () => {
      cancelled = true;
    };
  }, [supabase]);

  const totalRevenueByWeek = useMemo(() => {
    const totals = new Map<string, number>();
    for (const w of weeks) {
      let sum = 0;
      for (const byWeek of revenueGrid.values()) sum += byWeek.get(w.id) ?? 0;
      totals.set(w.id, sum);
    }
    return totals;
  }, [weeks, revenueGrid]);

  const totalExpensesByWeek = useMemo(() => {
    const totals = new Map<string, number>();
    for (const w of weeks) {
      let sum = 0;
      for (const byWeek of expenseGrid.values()) sum += byWeek.get(w.id) ?? 0;
      totals.set(w.id, sum);
    }
    return totals;
  }, [weeks, expenseGrid]);

  const netByWeek = useMemo(() => {
    const net = new Map<string, number>();
    for (const w of weeks) {
      net.set(w.id, (totalRevenueByWeek.get(w.id) ?? 0) - (totalExpensesByWeek.get(w.id) ?? 0));
    }
    return net;
  }, [weeks, totalRevenueByWeek, totalExpensesByWeek]);

  const runningTotalByWeek = useMemo(() => {
    const running = new Map<string, number>();
    let cumulative = 0;
    for (const w of weeks) {
      cumulative += netByWeek.get(w.id) ?? 0;
      running.set(w.id, cumulative);
    }
    return running;
  }, [weeks, netByWeek]);

  const timingWeeks = useMemo(
    () => buildTimingSummaryWeeks(weeks.length ? weeks[weeks.length - 1].week_start : null),
    [weeks],
  );

  const rowLabelCellClass =
    "sticky left-0 z-10 whitespace-nowrap bg-neutral-950 px-3 py-1.5 text-left text-neutral-300";
  const weekHeaderCellClass =
    "sticky top-0 z-10 whitespace-nowrap bg-neutral-900 px-3 py-1.5 text-right text-xs font-semibold uppercase tracking-wide text-neutral-400";
  const valueCellClass = "whitespace-nowrap px-3 py-1.5 text-right text-neutral-200";

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
                Order Value for each distributor, weeks where that order is marked Delivered
              </p>
            </div>
            <div className="max-h-[420px] overflow-auto">
              <table className="min-w-full border-collapse text-sm">
                <thead>
                  <tr>
                    <th className={`${weekHeaderCellClass} sticky left-0 z-20 text-left`}>Distributor</th>
                    {weeks.map((w) => (
                      <th key={w.id} className={weekHeaderCellClass}>
                        {w.label}
                        <br />
                        <span className="font-normal normal-case text-neutral-500">{shortDate(w.week_start)}</span>
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-neutral-900">
                  {distributors.map((d) => (
                    <tr key={d.id} className="hover:bg-neutral-900/40">
                      <td className={rowLabelCellClass}>{d.name}</td>
                      {weeks.map((w) => (
                        <td key={w.id} className={valueCellClass}>
                          <Money value={revenueGrid.get(d.id)?.get(w.id) ?? 0} />
                        </td>
                      ))}
                    </tr>
                  ))}
                  <tr className="border-t-2 border-neutral-800 font-semibold text-neutral-100">
                    <td className={`${rowLabelCellClass} bg-neutral-900`}>Total Revenue</td>
                    {weeks.map((w) => (
                      <td key={w.id} className={`${valueCellClass} bg-neutral-900`}>
                        <Money value={totalRevenueByWeek.get(w.id) ?? 0} className="text-[#6ABC46]" />
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
              <p className="text-xs text-neutral-500">Vendor purchase orders, bucketed by PO date</p>
            </div>
            <div className="max-h-[420px] overflow-auto">
              <table className="min-w-full border-collapse text-sm">
                <thead>
                  <tr>
                    <th className={`${weekHeaderCellClass} sticky left-0 z-20 text-left`}>Vendor</th>
                    {weeks.map((w) => (
                      <th key={w.id} className={weekHeaderCellClass}>
                        {w.label}
                        <br />
                        <span className="font-normal normal-case text-neutral-500">{shortDate(w.week_start)}</span>
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-neutral-900">
                  {vendors.length === 0 ? (
                    <tr>
                      <td colSpan={weeks.length + 1} className="px-4 py-4 text-center text-neutral-500">
                        No vendor purchase orders on file.
                      </td>
                    </tr>
                  ) : (
                    vendors.map((vendor) => (
                      <tr key={vendor} className="hover:bg-neutral-900/40">
                        <td className={rowLabelCellClass}>{vendor}</td>
                        {weeks.map((w) => (
                          <td key={w.id} className={valueCellClass}>
                            <Money value={expenseGrid.get(vendor)?.get(w.id) ?? 0} />
                          </td>
                        ))}
                      </tr>
                    ))
                  )}
                  <tr className="border-t-2 border-neutral-800 font-semibold text-neutral-100">
                    <td className={`${rowLabelCellClass} bg-neutral-900`}>Total Expenses</td>
                    {weeks.map((w) => (
                      <td key={w.id} className={`${valueCellClass} bg-neutral-900`}>
                        <Money value={totalExpensesByWeek.get(w.id) ?? 0} />
                      </td>
                    ))}
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
                    {weeks.map((w) => (
                      <th key={w.id} className={weekHeaderCellClass}>
                        {w.label}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-neutral-900">
                  <tr className="font-semibold">
                    <td className={rowLabelCellClass}>Net Cash Flow</td>
                    {weeks.map((w) => (
                      <td key={w.id} className={valueCellClass}>
                        <Money value={netByWeek.get(w.id) ?? 0} className="text-[#6ABC46]" />
                      </td>
                    ))}
                  </tr>
                  <tr className="font-semibold">
                    <td className={rowLabelCellClass}>Running Total</td>
                    {weeks.map((w) => (
                      <td key={w.id} className={valueCellClass}>
                        <Money value={runningTotalByWeek.get(w.id) ?? 0} className="text-[#6ABC46]" />
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
