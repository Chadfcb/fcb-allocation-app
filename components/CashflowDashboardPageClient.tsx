"use client";

// Finance > Cash Flow Dashboard — the web-app version of the Batch to Cash
// spreadsheet's Dashboard tab. Styled to match the rest of the app (dark
// theme, FCB green #6ABC46 accent), not the spreadsheet's own look — per
// Chad's correction, 2026-09-09.
//
// Data wired in so far:
//   - Realized Revenue: for every (week, distributor) marked Delivered on
//     Inventory & Allocation, the same Order Value math that page already
//     uses (quantity * distributor price, summed across every product) —
//     see orderValueFor() in app/(app)/inventory/page.tsx, mirrored here.
//   - Vendor PO Spend: purchase_orders.total_cost, split by our own
//     payment_status (pending/paid).
// Not wired in yet: Planned Batch Expenses — that needs a Brew Planner
// (planned batches with their own raw-material/packaging cost) that
// doesn't exist yet. Shown as a clearly-marked "not yet tracked" line so
// the Net figure below it is never mistaken for a complete picture.
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
  return <span className={className}>{currency.format(value)}</span>;
}

export default function CashflowDashboardPageClient() {
  const [supabase] = useState(() => createClient());
  const [loading, setLoading] = useState(true);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const [weeklyRevenue, setWeeklyRevenue] = useState<
    { week: WeekRow; revenue: number; distributors: { name: string; value: number }[] }[]
  >([]);
  const [poPending, setPoPending] = useState(0);
  const [poPaid, setPoPaid] = useState(0);
  const [recentPos, setRecentPos] = useState<
    { supplier: string; po_date: string | null; total_cost: number | null; payment_status: string }[]
  >([]);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      setLoading(true);
      setErrorMsg(null);
      try {
        const [
          { data: weeks, error: weeksErr },
          { data: distributors, error: distErr },
          { data: distributorPos, error: dposErr },
          { data: allocations, error: allocErr },
          { data: prices, error: pricesErr },
          { data: purchaseOrders, error: poErr },
        ] = await Promise.all([
          supabase.from("weeks").select("id, label, week_start").order("week_start", { ascending: false }),
          supabase.from("distributors").select("id, name"),
          supabase.from("distributor_pos").select("week_id, distributor_id, po_status"),
          supabase.from("allocations").select("week_id, distributor_id, product_id, quantity"),
          supabase.from("distributor_prices").select("distributor_id, product_id, price"),
          supabase
            .from("purchase_orders")
            .select("supplier, po_date, total_cost, payment_status")
            .order("po_date", { ascending: false }),
        ]);

        const firstError = weeksErr ?? distErr ?? dposErr ?? allocErr ?? pricesErr ?? poErr;
        if (firstError) throw firstError;
        if (cancelled) return;

        const distributorsById = new Map<string, DistributorRow>(
          (distributors ?? []).map((d) => [d.id, d as DistributorRow]),
        );

        const priceFor = new Map<string, number>();
        for (const p of prices ?? []) {
          priceFor.set(`${p.product_id}:${p.distributor_id}`, p.price ?? 0);
        }

        const allocationsByWeekDist = new Map<string, { product_id: string; quantity: number }[]>();
        for (const a of allocations ?? []) {
          const key = `${a.week_id}:${a.distributor_id}`;
          const list = allocationsByWeekDist.get(key) ?? [];
          list.push({ product_id: a.product_id, quantity: a.quantity ?? 0 });
          allocationsByWeekDist.set(key, list);
        }

        function orderValueFor(weekId: string, distributorId: string): number {
          const rows = allocationsByWeekDist.get(`${weekId}:${distributorId}`) ?? [];
          return rows.reduce((sum, r) => {
            const price = priceFor.get(`${r.product_id}:${distributorId}`) ?? 0;
            return sum + price * r.quantity;
          }, 0);
        }

        const deliveredByWeek = new Map<string, string[]>();
        for (const dp of distributorPos ?? []) {
          if (dp.po_status !== "delivered") continue;
          const list = deliveredByWeek.get(dp.week_id) ?? [];
          list.push(dp.distributor_id);
          deliveredByWeek.set(dp.week_id, list);
        }

        const rows = (weeks ?? [])
          .map((w) => {
            const week = w as WeekRow;
            const deliveredDistributorIds = deliveredByWeek.get(week.id) ?? [];
            const distributorBreakdown = deliveredDistributorIds
              .map((id) => ({
                name: distributorsById.get(id)?.name ?? "Unknown distributor",
                value: orderValueFor(week.id, id),
              }))
              .filter((d) => d.value > 0)
              .sort((a, b) => b.value - a.value);
            const revenue = distributorBreakdown.reduce((sum, d) => sum + d.value, 0);
            return { week, revenue, distributors: distributorBreakdown };
          })
          .filter((r) => r.revenue > 0);

        let pending = 0;
        let paid = 0;
        for (const po of purchaseOrders ?? []) {
          const cost = po.total_cost ?? 0;
          if (po.payment_status === "paid") paid += cost;
          else pending += cost;
        }

        setWeeklyRevenue(rows);
        setPoPending(pending);
        setPoPaid(paid);
        setRecentPos(
          (purchaseOrders ?? []).slice(0, 8).map((po) => ({
            supplier: po.supplier,
            po_date: po.po_date,
            total_cost: po.total_cost,
            payment_status: po.payment_status,
          })),
        );
      } catch (err) {
        if (!cancelled) {
          setErrorMsg(
            err instanceof Error
              ? err.message
              : "Couldn't load Cash Flow Dashboard data.",
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

  const totalRealizedRevenue = useMemo(
    () => weeklyRevenue.reduce((sum, r) => sum + r.revenue, 0),
    [weeklyRevenue],
  );
  const totalVendorSpend = poPending + poPaid;
  const netPosition = totalRealizedRevenue - totalVendorSpend;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-lg font-semibold text-neutral-100">Cash Flow Dashboard</h1>
        <p className="text-sm text-neutral-400">
          Realized revenue from Delivered distributor orders, vendor purchase order spend, and
          the running net position — the web-app version of the Batch to Cash spreadsheet&apos;s
          Dashboard tab.
        </p>
      </div>

      {errorMsg && (
        <div className="rounded-lg border border-red-900 bg-red-950/30 px-4 py-3 text-sm text-red-300">
          {errorMsg}
        </div>
      )}

      {loading ? (
        <p className="text-sm text-neutral-400">Loading…</p>
      ) : (
        <>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <div className="rounded-lg border border-neutral-800 bg-neutral-950 p-4">
              <p className="text-xs font-medium uppercase tracking-wide text-neutral-500">
                Realized Revenue
              </p>
              <p className="mt-1 text-2xl font-semibold text-[#6ABC46]">
                <Money value={totalRealizedRevenue} />
              </p>
              <p className="mt-1 text-xs text-neutral-500">Delivered distributor orders, all weeks</p>
            </div>
            <div className="rounded-lg border border-neutral-800 bg-neutral-950 p-4">
              <p className="text-xs font-medium uppercase tracking-wide text-neutral-500">
                Vendor PO Spend
              </p>
              <p className="mt-1 text-2xl font-semibold text-neutral-100">
                <Money value={totalVendorSpend} />
              </p>
              <p className="mt-1 text-xs text-neutral-500">
                <Money value={poPending} className="text-amber-400" /> pending ·{" "}
                <Money value={poPaid} className="text-neutral-400" /> paid
              </p>
            </div>
            <div className="rounded-lg border border-neutral-800 bg-neutral-950 p-4">
              <p className="text-xs font-medium uppercase tracking-wide text-neutral-500">
                Net Position
              </p>
              <p
                className={`mt-1 text-2xl font-semibold ${
                  netPosition >= 0 ? "text-[#6ABC46]" : "text-red-400"
                }`}
              >
                <Money value={netPosition} />
              </p>
              <p className="mt-1 text-xs text-neutral-500">
                Realized Revenue minus Vendor PO Spend — doesn&apos;t yet include Planned Batch
                Expenses (see below)
              </p>
            </div>
          </div>

          <div className="rounded-lg border border-dashed border-amber-900 bg-amber-950/20 px-4 py-3">
            <p className="text-sm font-medium text-amber-300">Planned Batch Expenses: not yet tracked</p>
            <p className="mt-1 text-xs text-neutral-400">
              Raw-material and packaging cost for batches that haven&apos;t brewed yet isn&apos;t
              wired in here — that needs a Brew Planner, which doesn&apos;t exist yet. Net Position
              above is Realized Revenue and Vendor PO Spend only.
            </p>
          </div>

          <div className="rounded-lg border border-neutral-800 bg-neutral-950">
            <div className="border-b border-neutral-900 px-4 py-3">
              <h2 className="text-sm font-semibold text-neutral-100">Realized Revenue by Week</h2>
              <p className="text-xs text-neutral-500">
                Order Value for each distributor marked Delivered that week
              </p>
            </div>
            {weeklyRevenue.length === 0 ? (
              <p className="px-4 py-6 text-center text-sm text-neutral-500">
                No delivered orders yet.
              </p>
            ) : (
              <table className="min-w-full divide-y divide-neutral-900 text-sm">
                <thead className="text-xs uppercase tracking-wide text-neutral-500">
                  <tr>
                    <th className="px-4 py-2 text-left">Week</th>
                    <th className="px-4 py-2 text-left">Distributors Delivered</th>
                    <th className="px-4 py-2 text-right">Revenue</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-neutral-900">
                  {weeklyRevenue.map((r) => (
                    <tr key={r.week.id}>
                      <td className="px-4 py-2 text-neutral-200">{r.week.label}</td>
                      <td className="px-4 py-2 text-neutral-400">
                        {r.distributors.map((d) => d.name).join(", ")}
                      </td>
                      <td className="px-4 py-2 text-right text-neutral-100">
                        <Money value={r.revenue} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>

          <div className="rounded-lg border border-neutral-800 bg-neutral-950">
            <div className="border-b border-neutral-900 px-4 py-3">
              <h2 className="text-sm font-semibold text-neutral-100">Recent Vendor Purchase Orders</h2>
              <p className="text-xs text-neutral-500">Most recent 8, from Purchase Orders</p>
            </div>
            {recentPos.length === 0 ? (
              <p className="px-4 py-6 text-center text-sm text-neutral-500">No purchase orders on file.</p>
            ) : (
              <table className="min-w-full divide-y divide-neutral-900 text-sm">
                <thead className="text-xs uppercase tracking-wide text-neutral-500">
                  <tr>
                    <th className="px-4 py-2 text-left">Supplier</th>
                    <th className="px-4 py-2 text-left">PO Date</th>
                    <th className="px-4 py-2 text-left">Status</th>
                    <th className="px-4 py-2 text-right">Total Cost</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-neutral-900">
                  {recentPos.map((po, i) => (
                    <tr key={i}>
                      <td className="px-4 py-2 text-neutral-200">{po.supplier}</td>
                      <td className="px-4 py-2 text-neutral-400">
                        {po.po_date ? new Date(po.po_date).toLocaleDateString() : "—"}
                      </td>
                      <td className="px-4 py-2">
                        <span
                          className={`rounded-full px-2 py-0.5 text-xs font-medium ${
                            po.payment_status === "paid"
                              ? "bg-neutral-800 text-neutral-300"
                              : "bg-amber-950 text-amber-300"
                          }`}
                        >
                          {po.payment_status === "paid" ? "Paid" : "Pending"}
                        </span>
                      </td>
                      <td className="px-4 py-2 text-right text-neutral-100">
                        <Money value={po.total_cost ?? 0} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </>
      )}
    </div>
  );
}
