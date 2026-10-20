"use client";

// Sales Dashboard → Action Items (added 2026-10-20, per Chad). The first tab:
// every store, across every chain and distributor, that isn't buying an item
// it MUST carry (Mandate — from Sales → Chain Mandates, or a Mandate pick on
// the dashboard). One card per store with what's missing and who to call.
//
// Same rules as the Gap Report (lib/salesDashboard.ts → buildStoreReports):
// "carries" = bought in the 90 days before the sales data's as-of date, so a
// store that bought the item longer ago than that counts as missing (Chad:
// yes) — "Last bought it" shows how long it's been. Turned-off accounts are
// left out. No SQL: it calls sales_gap_by_store once per chain that has a
// Mandate, plus phone (sales_accounts) and last check-in
// (sales_account_checkins) — those two show "—" for anyone who can't see
// Sales → Accounts.

import { useEffect, useMemo, useState } from "react";
import { HelpButton, SEL, StatusPill, downloadWorkbook, fdate, type Supa } from "@/components/SalesDashboardClient";
import { repFor } from "@/lib/salesAccounts";
import { CARRIED_DAYS, buildStoreReports, type DashOverview, type GapStore, type StoreLine, type resolveLists } from "@/lib/salesDashboard";

type Resolved = ReturnType<typeof resolveLists>;

export interface ActionRow {
  chain: string;
  store: GapStore;
  rep: string | null;
  missing: StoreLine[]; // Mandate items this store isn't buying
  phone: string | null;
  lastCheckin: string | null;
  lastCheckinBy: string | null;
}

export interface ActionData {
  rows: ActionRow[] | null; // null = still loading
  chains: string[]; // chains that have at least one Mandate item
  asOf: string | null;
  err: string | null;
}

const BTN = "rounded-md border border-neutral-700 px-3 py-1.5 text-sm text-neutral-200 hover:bg-neutral-800 disabled:opacity-50";

// Loads the list. Lives in SalesDashboardClient so the tab name can show the count.
export function useActionItems(supabase: Supa, ov: DashOverview | null, resolved: Resolved | null, version: number): ActionData {
  const chains = useMemo(() => {
    if (!ov || !resolved) return [];
    const ours = new Set(ov.chains.map((c) => c.chain));
    return [...resolved.rules.entries()]
      .filter(([c, r]) => ours.has(c) && (r.mandate.size > 0 || [...r.picked.values()].some((p) => p.status === "mandate")))
      .map(([c]) => c)
      .sort();
  }, [ov, resolved]);
  const chainsKey = chains.join("\u0001");
  const [data, setData] = useState<Omit<ActionData, "chains">>({ rows: null, asOf: null, err: null });

  useEffect(() => {
    if (!resolved) return;
    let cancelled = false;
    (async () => {
      const rows: ActionRow[] = [];
      let asOf: string | null = null;
      for (const chain of chainsKey ? chainsKey.split("\u0001") : []) {
        const { data: res, error } = await supabase.rpc("sales_gap_by_store", { p_chain: chain, p_distributor: null });
        if (cancelled) return;
        if (error) {
          setData({ rows: [], asOf: null, err: error.message });
          return;
        }
        asOf = res.as_of;
        for (const r of buildStoreReports(res, resolved.rules.get(chain))) {
          if (r.mandateGaps === 0) continue;
          rows.push({
            chain,
            store: r.store,
            rep: repFor(r.store.distributor),
            missing: r.gaps.filter((g) => g.status === "mandate"),
            phone: null,
            lastCheckin: null,
            lastCheckinBy: null,
          });
        }
      }
      // Phone + last check-in (only for people who can see Sales → Accounts).
      const ids = [...new Set(rows.map((r) => r.store.outlet_id))];
      const phone = new Map<string, string | null>();
      const visit = new Map<string, { date: string; rep: string | null }>();
      for (let i = 0; i < ids.length; i += 100) {
        const part = ids.slice(i, i + 100);
        const [{ data: acc }, { data: chk }] = await Promise.all([
          supabase.from("sales_accounts").select("outlet_id,phone").in("outlet_id", part),
          supabase.from("sales_account_checkins").select("outlet_id,checkin_date,rep").in("outlet_id", part).order("checkin_date", { ascending: false }).limit(5000),
        ]);
        for (const a of (acc ?? []) as { outlet_id: string; phone: string | null }[]) phone.set(a.outlet_id, a.phone);
        for (const c of (chk ?? []) as { outlet_id: string; checkin_date: string; rep: string | null }[]) {
          if (!visit.has(c.outlet_id)) visit.set(c.outlet_id, { date: c.checkin_date, rep: c.rep });
        }
      }
      if (cancelled) return;
      for (const r of rows) {
        r.phone = phone.get(r.store.outlet_id) ?? null;
        r.lastCheckin = visit.get(r.store.outlet_id)?.date ?? null;
        r.lastCheckinBy = visit.get(r.store.outlet_id)?.rep ?? null;
      }
      rows.sort((a, b) => b.missing.length - a.missing.length || a.store.name.localeCompare(b.store.name, undefined, { numeric: true }));
      setData({ rows, asOf, err: null });
    })();
    return () => {
      cancelled = true;
    };
  }, [supabase, resolved, chainsKey, version]);

  return { ...data, chains };
}

export default function SalesActionItems({ data, onOpenStore }: { data: ActionData; onOpenStore: (r: ActionRow) => void }) {
  const [dist, setDist] = useState("");
  const [rep, setRep] = useState("");
  const [chain, setChain] = useState("");
  const [q, setQ] = useState("");
  const rows = useMemo(() => data.rows ?? [], [data.rows]);

  const opts = useMemo(() => {
    const u = (xs: (string | null)[]) => [...new Set(xs.filter((x): x is string => !!x))].sort();
    return { dists: u(rows.map((r) => r.store.distributor)), reps: u(rows.map((r) => r.rep)), chains: u(rows.map((r) => r.chain)) };
  }, [rows]);

  const shown = useMemo(() => {
    const qq = q.trim().toLowerCase();
    return rows.filter(
      (r) =>
        (!dist || r.store.distributor === dist) &&
        (!rep || (rep === "__none" ? !r.rep : r.rep === rep)) &&
        (!chain || r.chain === chain) &&
        (!qq || `${r.store.name} ${r.store.city ?? ""} ${r.store.address ?? ""} ${r.store.outlet_id}`.toLowerCase().includes(qq)),
    );
  }, [rows, dist, rep, chain, q]);
  const missingTotal = shown.reduce((t, r) => t + r.missing.length, 0);

  async function exportExcel() {
    const ExcelJS = (await import("exceljs")).default;
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet("Action items");
    ws.columns = [
      { header: "Chain", key: "chain", width: 14 },
      { header: "Store", key: "store", width: 30 },
      { header: "Store #", key: "no", width: 9 },
      { header: "Address", key: "addr", width: 28 },
      { header: "City", key: "city", width: 16 },
      { header: "Distributor", key: "dist", width: 14 },
      { header: "Rep", key: "rep", width: 10 },
      { header: "Phone", key: "phone", width: 14 },
      { header: "Last check-in", key: "visit", width: 13 },
      { header: "Store last bought anything", key: "anything", width: 14 },
      { header: "Missing must-carry item", key: "item", width: 32 },
      { header: "Size", key: "size", width: 9 },
      { header: "Store last bought it", key: "last", width: 14 },
      { header: "Other stores in chain (same distributor) buying it", key: "others", width: 22 },
      { header: "Outlet ID", key: "id", width: 11 },
    ];
    ws.getRow(1).font = { bold: true };
    for (const r of shown) {
      for (const l of r.missing) {
        ws.addRow({
          chain: r.chain,
          store: r.store.name,
          no: r.store.store_no ?? "",
          addr: r.store.address ?? "",
          city: r.store.city ?? "",
          dist: r.store.distributor,
          rep: r.rep ?? "",
          phone: r.phone ?? "",
          visit: r.lastCheckin ? fdate(r.lastCheckin) : "",
          anything: r.store.last_buy_date ? fdate(r.store.last_buy_date) : "Never",
          item: l.product,
          size: l.size,
          last: l.lastBuy ? fdate(l.lastBuy) : "Never",
          others: l.othersCarry,
          id: r.store.outlet_id,
        });
      }
    }
    ws.views = [{ state: "frozen", ySplit: 1 }];
    ws.autoFilter = { from: "A1", to: "O1" };
    downloadWorkbook(await wb.xlsx.writeBuffer(), `Action items - stores missing Mandate items - ${data.asOf ?? "today"}.xlsx`);
  }

  if (data.err) return <p className="rounded-md border border-red-500/40 bg-red-500/10 px-3 py-2 text-sm text-red-300">{data.err}</p>;
  if (data.rows === null) return <p className="text-sm text-neutral-500">Loading…</p>;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-end gap-3 rounded-lg border border-neutral-800 bg-neutral-900 p-3">
        <label className="flex flex-col gap-1 text-xs text-neutral-500">
          Distributor
          <select value={dist} onChange={(e) => setDist(e.target.value)} className={SEL}>
            <option value="">All distributors</option>
            {opts.dists.map((d) => (
              <option key={d} value={d}>
                {d}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-xs text-neutral-500">
          Rep
          <select value={rep} onChange={(e) => setRep(e.target.value)} className={SEL}>
            <option value="">All reps</option>
            {opts.reps.map((d) => (
              <option key={d} value={d}>
                {d}
              </option>
            ))}
            {rows.some((r) => !r.rep) && <option value="__none">No rep</option>}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-xs text-neutral-500">
          Chain
          <select value={chain} onChange={(e) => setChain(e.target.value)} className={SEL}>
            <option value="">All chains</option>
            {opts.chains.map((d) => (
              <option key={d} value={d}>
                {d}
              </option>
            ))}
          </select>
        </label>
        <input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search store, city, address" className={`${SEL} w-56`} />
        <div className="ml-auto flex items-center gap-2">
          <HelpButton id="action-help" title="How to read Action Items">
            <ul className="list-disc space-y-1.5 pl-5">
              <li>
                This list shows every store that <b>isn&apos;t buying an item it must carry</b> (a <StatusPill status="mandate" small /> item) — across every chain and
                distributor.
              </li>
              <li>
                &quot;Must carry&quot; comes from <b>Sales → Chain Mandates</b>. Right now that page covers: {data.chains.length ? data.chains.join(", ") : "no chains"}. Add a chain
                or item there and it shows up here automatically.
              </li>
              <li>
                A store counts as missing an item if it hasn&apos;t bought it in the last {CARRIED_DAYS} days{data.asOf ? ` (up to ${fdate(data.asOf)}, the newest sales data)` : ""}.{" "}
                <b>Store last bought it</b> shows how long it&apos;s been — &quot;Never&quot; means it never has.
              </li>
              <li>
                <b>Other stores buying it</b> = how many other stores in the same chain, with the same distributor, are buying that item — proof it sells there.
              </li>
              <li>Stores missing the most items are at the top. Click a store&apos;s name to open it in the Gap Report.</li>
              <li>Once a store buys the item, it drops off this list on its own after the next sales sync.</li>
            </ul>
          </HelpButton>
          <button type="button" onClick={exportExcel} disabled={!shown.length} className={BTN}>
            Export to Excel
          </button>
        </div>
      </div>

      {rows.length === 0 ? (
        <div className="rounded-lg border border-[#6abc46]/40 bg-[#6abc46]/10 px-4 py-3 text-sm text-[#b7e8a0]">
          Nothing to act on — every store is buying all of its must-carry items.
        </div>
      ) : (
        <p className="text-sm text-neutral-300">
          <b className="text-red-400">{shown.length}</b> store{shown.length === 1 ? " is" : "s are"} missing <b className="text-red-400">{missingTotal}</b> must-carry item
          {missingTotal === 1 ? "" : "s"}
          {shown.length !== rows.length ? ` (of ${rows.length} stores in all)` : ""}.
        </p>
      )}

      <div className="flex flex-col gap-2">
        {shown.map((r) => (
          <div key={`${r.chain}\u0001${r.store.outlet_id}`} className="rounded-lg border border-red-500/30 bg-neutral-900">
            <div className="flex flex-wrap items-start gap-x-6 gap-y-2 px-3 py-2">
              <div className="min-w-0 flex-1">
                <button type="button" onClick={() => onOpenStore(r)} className="text-left font-medium text-neutral-100 hover:text-[#9be07a] hover:underline" title="Open this store in the Gap Report">
                  {r.store.name}
                </button>
                <div className="text-xs text-neutral-500">
                  {[r.chain, r.store.store_no ? `Store #${r.store.store_no}` : null, r.store.address, r.store.city, `Outlet ${r.store.outlet_id}`].filter(Boolean).join(" · ")}
                </div>
              </div>
              <Info label="Distributor" value={r.store.distributor} />
              <Info label="Rep" value={r.rep ?? "—"} />
              <Info label="Phone" value={r.phone ? <a href={`tel:${r.phone.replace(/[^\d+]/g, "")}`} className="hover:underline">{r.phone}</a> : "—"} />
              <Info label="Last check-in" value={r.lastCheckin ? `${fdate(r.lastCheckin)}${r.lastCheckinBy ? ` · ${r.lastCheckinBy}` : ""}` : "—"} />
              <Info label="Last bought anything" value={r.store.last_buy_date ? fdate(r.store.last_buy_date) : "Never"} />
            </div>
            <div className="border-t border-neutral-800 px-3 py-2">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-xs text-neutral-500">
                    <th className="py-1 font-medium">
                      Missing must-carry item{r.missing.length === 1 ? "" : "s"} ({r.missing.length})
                    </th>
                    <th className="py-1 text-right font-medium">Store last bought it</th>
                    <th className="py-1 text-right font-medium">
                      Other {r.chain} stores ({r.store.distributor}) buying it
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {r.missing.map((l) => (
                    <tr key={l.key} className="border-t border-neutral-800/70">
                      <td className="py-1 pr-2 text-neutral-200">
                        {l.product} <span className="text-neutral-500">· {l.size}</span>
                      </td>
                      <td className={`py-1 text-right tabular-nums ${l.lastBuy ? "text-neutral-300" : "text-red-300"}`}>{l.lastBuy ? fdate(l.lastBuy) : "Never"}</td>
                      <td className="py-1 text-right tabular-nums text-neutral-300">{l.othersCarry}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        ))}
        {rows.length > 0 && shown.length === 0 && <p className="text-sm text-neutral-500">No stores match these filters.</p>}
      </div>
    </div>
  );
}

function Info({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="text-xs">
      <div className="text-neutral-500">{label}</div>
      <div className="text-neutral-200">{value}</div>
    </div>
  );
}
