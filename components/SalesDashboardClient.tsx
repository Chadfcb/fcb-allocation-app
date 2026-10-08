"use client";

// Sales Dashboard (Main → Sales Dashboard), added 2026-10-08, per Chad.
// Three tabs:
//   Gap Report  — pick a chain + distributor. By store: each store's carried
//                 items (CE in the last 90 days, last sold) and gaps. By item:
//                 each item's store count across every chain for a distributor.
//                 Items are color coded Mandate (red) / Flex (amber) / Not set.
//                 Excel export of either view.
//   Chain setup — fix the automatic chain groupings, match the Chain Mandates /
//                 Chain Authorizations lists to our chains and products
//                 (components/SalesDashboardSetup.tsx).
//   Turned off  — turn any account off (it disappears here and from Sales →
//                 Accounts) or back on.
// Every change goes to the Audit Log and shows up for everyone right away.
// Rules and gap math: lib/salesDashboard.ts. SQL: sql/sales_dashboard.sql.

import { useCallback, useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import SalesDashboardSetup from "@/components/SalesDashboardSetup";
import { isFormerDistributor } from "@/lib/salesAccounts";
import {
  CARRIED_DAYS,
  STATUS_INFO,
  buildStoreReports,
  itemKey,
  itemLabel,
  resolveLists,
  splitKey,
  statusFor,
  statusSource,
  type ChainRules,
  type DashOverview,
  type GapByItemResult,
  type GapByStoreResult,
  type ItemStatus,
  type StoreLine,
  type StoreReport,
} from "@/lib/salesDashboard";

export type Supa = ReturnType<typeof createClient>;

export const SEL = "rounded-md border border-neutral-700 bg-neutral-950 px-2 py-1.5 text-sm text-neutral-100";
const BTN = "rounded-md border border-neutral-700 px-3 py-1.5 text-sm text-neutral-200 hover:bg-neutral-800 disabled:opacity-50";
const fmt = (n: number) => n.toLocaleString("en-US", { maximumFractionDigits: 1 });
export const fdate = (s: string | null | undefined) => {
  if (!s) return "—";
  const [y, m, d] = s.slice(0, 10).split("-");
  return `${+m}/${+d}/${y}`;
};
const DIST_KEY = "fcb-sales-dash-dist";
const CHAIN_KEY = "fcb-sales-dash-chain";

// One audit row (record_id must be the changed row's uuid).
export async function audit(supabase: Supa, userId: string | null, table: string, id: string, field: string, oldV: string | null, newV: string | null) {
  if (!userId || (oldV ?? "") === (newV ?? "")) return;
  await supabase.from("audit_log").insert({
    week_id: null,
    table_name: table,
    record_id: id,
    field_name: field,
    old_value: oldV,
    new_value: newV,
    changed_by: userId,
  });
}

export function StatusPill({ status, small }: { status: ItemStatus; small?: boolean }) {
  const c = STATUS_INFO[status].color;
  return (
    <span
      className={`inline-flex items-center gap-1 whitespace-nowrap rounded font-semibold text-neutral-100 ${small ? "px-1.5 py-px text-[10px]" : "px-2 py-0.5 text-xs"}`}
      style={{ background: `${c}2e`, border: `1px solid ${c}80` }}
    >
      <span className="h-1.5 w-1.5 rounded-full" style={{ background: c }} />
      {STATUS_INFO[status].label}
    </span>
  );
}

export default function SalesDashboardClient() {
  const supabase = useMemo(() => createClient(), []);
  const [ov, setOv] = useState<DashOverview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [userId, setUserId] = useState<string | null>(null);
  const [tab, setTab] = useState<"gap" | "setup" | "off">("gap");
  const [version, setVersion] = useState(0); // bumps when anything changes → reports reload

  const loadOverview = useCallback(async () => {
    const { data, error: e } = await supabase.rpc("sales_dash_overview");
    if (e) {
      setError(e.message);
      return;
    }
    setError(null);
    setOv(data as DashOverview);
    setVersion((v) => v + 1);
  }, [supabase]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- first load from the database
    loadOverview();
    supabase.auth.getUser().then(({ data }) => setUserId(data.user?.id ?? null));
  }, [supabase, loadOverview]);

  // Live: any change by anyone reloads (short pause so a bulk change reloads once).
  useEffect(() => {
    let t: ReturnType<typeof setTimeout> | null = null;
    const bump = () => {
      if (t) clearTimeout(t);
      t = setTimeout(() => loadOverview(), 600);
    };
    let ch = supabase.channel("sales-dashboard");
    for (const table of ["sales_account_off", "sales_chain_names", "sales_chain_store", "sales_chain_list_link", "sales_chain_item_link", "sales_chain_item_status"]) {
      ch = ch.on("postgres_changes", { event: "*", schema: "public", table }, bump);
    }
    ch.subscribe();
    return () => {
      if (t) clearTimeout(t);
      supabase.removeChannel(ch);
    };
  }, [supabase, loadOverview]);

  const resolved = useMemo(() => (ov ? resolveLists(ov) : null), [ov]);

  const TABS = [
    ["gap", "Gap Report"],
    ["setup", "Chain setup"],
    ["off", "Turned off accounts"],
  ] as const;

  return (
    <div className="flex flex-col gap-4 p-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-neutral-100">Sales Dashboard</h1>
          <p className="text-sm text-neutral-500">
            {ov?.as_of ? `Sales data as of ${fdate(ov.as_of)} · carried = bought in the last ${CARRIED_DAYS} days` : "Loading…"}
          </p>
        </div>
      </div>
      <div className="flex gap-1 border-b border-neutral-800">
        {TABS.map(([k, label]) => (
          <button
            key={k}
            id={`dash-tab-${k}`}
            type="button"
            onClick={() => setTab(k)}
            className={`-mb-px border-b-2 px-4 py-2 text-sm font-medium ${tab === k ? "border-[#6abc46] text-neutral-100" : "border-transparent text-neutral-400 hover:text-neutral-200"}`}
          >
            {label}
          </button>
        ))}
      </div>
      {error && <p className="rounded-md border border-red-500/40 bg-red-500/10 px-3 py-2 text-sm text-red-300">{error}</p>}
      {ov && resolved && tab === "gap" && (
        <GapReport supabase={supabase} ov={ov} resolved={resolved} userId={userId} version={version} onChanged={loadOverview} />
      )}
      {ov && resolved && tab === "setup" && (
        <SalesDashboardSetup supabase={supabase} ov={ov} resolved={resolved} userId={userId} onChanged={loadOverview} />
      )}
      {ov && tab === "off" && <TurnedOff supabase={supabase} userId={userId} version={version} onChanged={loadOverview} />}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Turn an account off (shared by the gap report and the Turned off tab)
// ---------------------------------------------------------------------------
export async function turnOff(supabase: Supa, userId: string | null, outletId: string, name: string): Promise<string | null> {
  const { data, error } = await supabase
    .from("sales_account_off")
    .insert({ outlet_id: outletId, name, turned_off_by: userId })
    .select("id")
    .single();
  if (error) return error.message;
  await audit(supabase, userId, "sales_account_off", data.id as string, "account", name, "turned off");
  return null;
}

function TurnOffButton({ supabase, userId, outletId, name, onDone }: { supabase: Supa; userId: string | null; outletId: string; name: string; onDone: () => void }) {
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  if (!confirm)
    return (
      <button type="button" onClick={() => setConfirm(true)} className="rounded border border-neutral-700 px-2 py-0.5 text-xs text-neutral-400 hover:border-red-500/60 hover:text-red-300">
        Turn off
      </button>
    );
  return (
    <span className="flex items-center gap-1.5 text-xs">
      <span className="text-neutral-400">Turn off everywhere?</span>
      <button
        type="button"
        disabled={busy}
        onClick={async () => {
          setBusy(true);
          const e = await turnOff(supabase, userId, outletId, name);
          setBusy(false);
          if (e) setErr(e);
          else onDone();
        }}
        className="rounded bg-red-600 px-2 py-0.5 font-semibold text-white hover:bg-red-500 disabled:opacity-50"
      >
        Yes, turn off
      </button>
      <button type="button" onClick={() => setConfirm(false)} className="px-1 text-neutral-400 hover:text-neutral-100">
        Cancel
      </button>
      {err && <span className="text-red-300">{err}</span>}
    </span>
  );
}

// ---------------------------------------------------------------------------
// Gap Report
// ---------------------------------------------------------------------------
function GapReport({
  supabase,
  ov,
  resolved,
  userId,
  version,
  onChanged,
}: {
  supabase: Supa;
  ov: DashOverview;
  resolved: ReturnType<typeof resolveLists>;
  userId: string | null;
  version: number;
  onChanged: () => void;
}) {
  const [view, setView] = useState<"store" | "item">("store");
  const [dist, setDist] = useState("");
  const [chain, setChain] = useState("");
  const [byStore, setByStore] = useState<GapByStoreResult | null>(null);
  const [byStoreFor, setByStoreFor] = useState(""); // which chain + distributor byStore belongs to
  const [byItem, setByItem] = useState<GapByItemResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    try {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- remembered picks (per browser), read after load
      setDist(localStorage.getItem(DIST_KEY) ?? "");
      setChain(localStorage.getItem(CHAIN_KEY) ?? "");
    } catch {
      // ignore
    }
  }, []);
  const pickDist = (d: string) => {
    setDist(d);
    try {
      localStorage.setItem(DIST_KEY, d);
    } catch {
      // ignore
    }
  };
  const pickChain = (c: string) => {
    setChain(c);
    try {
      localStorage.setItem(CHAIN_KEY, c);
    } catch {
      // ignore
    }
  };

  const distOptions = useMemo(() => {
    const cur = ov.distributors.filter((d) => d.distributor !== "(none)" && !isFormerDistributor(d.distributor));
    const former = ov.distributors.filter((d) => d.distributor === "(none)" || isFormerDistributor(d.distributor));
    return { cur, former };
  }, [ov]);
  const chainOptions = useMemo(
    () =>
      ov.chains
        .map((c) => ({ chain: c.chain, n: dist ? (c.by_distributor[dist] ?? 0) : c.stores }))
        .filter((c) => c.n > 0)
        .sort((a, b) => b.n - a.n || a.chain.localeCompare(b.chain)),
    [ov, dist],
  );
  const chainOk = chainOptions.some((c) => c.chain === chain);

  useEffect(() => {
    if (view !== "store" || !chain || !chainOk) return;
    let cancelled = false;
    (async () => {
      setBusy(true);
      const { data, error } = await supabase.rpc("sales_gap_by_store", { p_chain: chain, p_distributor: dist || null });
      if (cancelled) return;
      setBusy(false);
      if (error) setErr(error.message);
      else {
        setErr(null);
        setByStore(data as GapByStoreResult);
        setByStoreFor(`${chain}\u0002${dist}`);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [supabase, view, chain, chainOk, dist, version]);

  useEffect(() => {
    if (view !== "item") return;
    let cancelled = false;
    (async () => {
      setBusy(true);
      const { data, error } = await supabase.rpc("sales_gap_by_item", { p_distributor: dist || null });
      if (cancelled) return;
      setBusy(false);
      if (error) setErr(error.message);
      else {
        setErr(null);
        setByItem(data as GapByItemResult);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [supabase, view, dist, version]);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-end gap-3 rounded-lg border border-neutral-800 bg-neutral-900 p-3">
        <div className="flex overflow-hidden rounded-md border border-neutral-700">
          {(
            [
              ["store", "By store"],
              ["item", "By item"],
            ] as const
          ).map(([k, label]) => (
            <button
              key={k}
              id={`gap-view-${k}`}
              type="button"
              onClick={() => setView(k)}
              className={`px-3 py-1.5 text-sm ${view === k ? "bg-[#6abc46]/20 text-neutral-100" : "text-neutral-400 hover:bg-neutral-800"}`}
            >
              {label}
            </button>
          ))}
        </div>
        <label className="flex flex-col gap-1 text-xs text-neutral-500">
          Distributor
          <select id="gap-dist" value={dist} onChange={(e) => pickDist(e.target.value)} className={SEL}>
            <option value="">All distributors</option>
            <optgroup label="Current">
              {distOptions.cur.map((d) => (
                <option key={d.distributor} value={d.distributor}>
                  {d.distributor} ({d.stores} chain stores)
                </option>
              ))}
            </optgroup>
            <optgroup label="Former / none">
              {distOptions.former.map((d) => (
                <option key={d.distributor} value={d.distributor}>
                  {d.distributor} ({d.stores})
                </option>
              ))}
            </optgroup>
          </select>
        </label>
        {view === "store" && (
          <label className="flex flex-col gap-1 text-xs text-neutral-500">
            Chain
            <select id="gap-chain" value={chainOk ? chain : ""} onChange={(e) => pickChain(e.target.value)} className={`${SEL} min-w-64`}>
              <option value="">Pick a chain…</option>
              {chainOptions.map((c) => (
                <option key={c.chain} value={c.chain}>
                  {c.chain} ({c.n} store{c.n === 1 ? "" : "s"})
                </option>
              ))}
            </select>
          </label>
        )}
        <div className="ml-auto flex items-center gap-3 text-xs text-neutral-400">
          {(["mandate", "flex", "none"] as const).map((s) => (
            <StatusPill key={s} status={s} small />
          ))}
          {busy && <span>Loading…</span>}
        </div>
      </div>
      {err && <p className="rounded-md border border-red-500/40 bg-red-500/10 px-3 py-2 text-sm text-red-300">{err}</p>}
      {view === "store" &&
        (!chain || !chainOk ? (
          <p className="text-sm text-neutral-500">Pick a chain to see its stores, what they carry and their gaps.</p>
        ) : (
          byStore &&
          byStoreFor === `${chain}\u0002${dist}` && (
            <ByStoreView
              supabase={supabase}
              userId={userId}
              data={byStore}
              chain={chain}
              dist={dist}
              rules={resolved.rules.get(chain)}
              onChanged={onChanged}
            />
          )
        ))}
      {view === "item" && byItem && <ByItemView data={byItem} dist={dist} resolved={resolved} />}
    </div>
  );
}

// ---------------------------------------------------------------------------
// By store
// ---------------------------------------------------------------------------
function ByStoreView({
  supabase,
  userId,
  data,
  chain,
  dist,
  rules,
  onChanged,
}: {
  supabase: Supa;
  userId: string | null;
  data: GapByStoreResult;
  chain: string;
  dist: string;
  rules: ChainRules | undefined;
  onChanged: () => void;
}) {
  const reports = useMemo(() => buildStoreReports(data, rules), [data, rules]);
  const [sort, setSort] = useState<"gaps" | "name" | "ce">("gaps");
  const [q, setQ] = useState("");
  const [open, setOpen] = useState<Set<string>>(new Set());
  const [statusErr, setStatusErr] = useState<string | null>(null);

  const shown = useMemo(() => {
    const qq = q.trim().toLowerCase();
    const list = reports.filter((r) => !qq || `${r.store.name} ${r.store.city ?? ""} ${r.store.address ?? ""} ${r.store.outlet_id}`.toLowerCase().includes(qq));
    const ce = (r: StoreReport) => r.carried.reduce((t, l) => t + l.ce90, 0);
    list.sort((a, b) =>
      sort === "name"
        ? a.store.name.localeCompare(b.store.name, undefined, { numeric: true })
        : sort === "ce"
          ? ce(b) - ce(a)
          : b.mandateGaps - a.mandateGaps || b.gaps.length - a.gaps.length || a.store.name.localeCompare(b.store.name, undefined, { numeric: true }),
    );
    return list;
  }, [reports, sort, q]);

  // Every item that shows up for this chain, with how many stores carry it.
  const items = useMemo(() => {
    const m = new Map<string, { key: string; carried: number; gaps: number }>();
    for (const r of reports) {
      for (const l of r.carried) {
        const x = m.get(l.key) ?? { key: l.key, carried: 0, gaps: 0 };
        x.carried++;
        m.set(l.key, x);
      }
      for (const l of r.gaps) {
        const x = m.get(l.key) ?? { key: l.key, carried: 0, gaps: 0 };
        x.gaps++;
        m.set(l.key, x);
      }
    }
    if (rules) for (const k of [...rules.flex, ...rules.picked.keys()]) if (!m.has(k)) m.set(k, { key: k, carried: 0, gaps: 0 });
    const order = (k: string) => ({ mandate: 0, flex: 1, none: 2 })[statusFor(rules, k, null)];
    return [...m.values()].sort((a, b) => order(a.key) - order(b.key) || b.carried - a.carried);
  }, [reports, rules]);

  const totals = useMemo(
    () => ({
      stores: reports.length,
      withMandateGaps: reports.filter((r) => r.mandateGaps > 0).length,
      gaps: reports.reduce((t, r) => t + r.gaps.length, 0),
      carriedAvg: reports.length ? reports.reduce((t, r) => t + r.carried.length, 0) / reports.length : 0,
      ce: reports.reduce((t, r) => t + r.carried.reduce((s, l) => s + l.ce90, 0), 0),
    }),
    [reports],
  );

  async function setStatus(key: string, value: ItemStatus | "auto") {
    setStatusErr(null);
    const { product, size } = splitKey(key);
    const before = statusFor(rules, key, null);
    const existing = rules?.picked.get(key);
    if (value === "auto") {
      if (!existing) return;
      const { error } = await supabase.from("sales_chain_item_status").delete().eq("id", existing.id);
      if (error) return setStatusErr(error.message);
      await audit(supabase, userId, "sales_chain_item_status", existing.id, `${chain} · ${itemLabel(product, size)}`, existing.status, "auto");
    } else {
      const { data: row, error } = await supabase
        .from("sales_chain_item_status")
        .upsert({ chain_name: chain, product, size, status: value, updated_by: userId, updated_at: new Date().toISOString() }, { onConflict: "chain_name,product,size" })
        .select("id")
        .single();
      if (error) return setStatusErr(error.message);
      await audit(supabase, userId, "sales_chain_item_status", row.id as string, `${chain} · ${itemLabel(product, size)}`, existing?.status ?? `auto (${before})`, value);
    }
    onChanged();
  }

  async function exportExcel() {
    const ExcelJS = (await import("exceljs")).default;
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet("Gap by store");
    ws.columns = [
      { header: "Distributor", key: "dist", width: 14 },
      { header: "Store", key: "store", width: 30 },
      { header: "Store #", key: "no", width: 9 },
      { header: "Address", key: "addr", width: 28 },
      { header: "City", key: "city", width: 16 },
      { header: "Outlet ID", key: "id", width: 11 },
      { header: "Item", key: "item", width: 32 },
      { header: "Size", key: "size", width: 9 },
      { header: "Flex / Mandate", key: "status", width: 14 },
      { header: "Carried / Gap", key: "cg", width: 13 },
      { header: `CE (last ${CARRIED_DAYS} days)`, key: "ce", width: 16 },
      { header: "Last sold", key: "last", width: 12 },
      { header: "Other stores carrying", key: "others", width: 20 },
    ];
    ws.getRow(1).font = { bold: true };
    const fill: Record<ItemStatus, string> = { mandate: "FFFCA5A5", flex: "FFFDE68A", none: "FFE5E5E5" };
    for (const r of shown) {
      for (const [lines, cg] of [
        [r.carried, "Carried"],
        [r.gaps, "Gap"],
      ] as [StoreLine[], string][]) {
        for (const l of lines) {
          const row = ws.addRow({
            dist: r.store.distributor,
            store: r.store.name,
            no: r.store.store_no ?? "",
            addr: r.store.address ?? "",
            city: r.store.city ?? "",
            id: r.store.outlet_id,
            item: l.product,
            size: l.size,
            status: STATUS_INFO[l.status].label,
            cg,
            ce: Math.round(l.ce90 * 100) / 100,
            last: l.lastBuy ? fdate(l.lastBuy) : "Never",
            others: l.othersCarry,
          });
          row.getCell("status").fill = { type: "pattern", pattern: "solid", fgColor: { argb: fill[l.status] } };
          if (cg === "Gap") row.getCell("cg").font = { bold: true, color: { argb: "FFB91C1C" } };
        }
      }
    }
    ws.views = [{ state: "frozen", ySplit: 1 }];
    ws.autoFilter = { from: "A1", to: "M1" };
    downloadWorkbook(await wb.xlsx.writeBuffer(), `Gap report - ${chain} - ${dist || "All distributors"} - ${data.as_of}.xlsx`);
  }

  const allOpen = shown.length > 0 && shown.every((r) => open.has(r.store.outlet_id));

  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
        {[
          ["Stores", fmt(totals.stores)],
          ["Stores missing a Mandate item", fmt(totals.withMandateGaps)],
          ["Total gaps", fmt(totals.gaps)],
          ["Items carried per store", fmt(totals.carriedAvg)],
          [`CE, last ${CARRIED_DAYS} days`, fmt(totals.ce)],
        ].map(([label, v]) => (
          <div key={label} className="rounded-lg border border-neutral-800 bg-neutral-900 px-3 py-2">
            <div className="text-xs text-neutral-500">{label}</div>
            <div className="text-xl font-semibold text-neutral-100">{v}</div>
          </div>
        ))}
      </div>

      <div className="rounded-lg border border-neutral-800 bg-neutral-900 p-3">
        <div className="mb-2 flex items-center justify-between gap-2">
          <h2 className="text-sm font-semibold text-neutral-200">
            Items for {chain} <span className="font-normal text-neutral-500">· set Flex / Mandate for this chain (all distributors)</span>
          </h2>
        </div>
        {statusErr && <p className="mb-2 text-sm text-red-300">{statusErr}</p>}
        {items.length === 0 ? (
          <p className="text-sm text-neutral-500">No items bought by these stores.</p>
        ) : (
          <div className="grid gap-x-4 gap-y-1.5 md:grid-cols-2 xl:grid-cols-3">
            {items.map((it) => {
              const { product, size } = splitKey(it.key);
              const st = statusFor(rules, it.key, null);
              const picked = rules?.picked.get(it.key);
              const src = statusSource(rules, it.key);
              return (
                <div key={it.key} className="flex items-center gap-2 border-l-2 pl-2 text-sm" style={{ borderColor: STATUS_INFO[st].color }}>
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-neutral-200" title={itemLabel(product, size)}>
                      {product} <span className="text-neutral-500">· {size}</span>
                    </div>
                    <div className="text-[11px] text-neutral-500">
                      {it.carried} of {totals.stores} stores carry{src ? ` · ${src}` : ""}
                    </div>
                  </div>
                  <select
                    aria-label={`Flex or Mandate for ${itemLabel(product, size)}`}
                    value={picked ? picked.status : "auto"}
                    onChange={(e) => setStatus(it.key, e.target.value as ItemStatus | "auto")}
                    className="rounded border border-neutral-700 bg-neutral-950 px-1.5 py-0.5 text-xs text-neutral-100"
                    style={{ color: STATUS_INFO[st].color }}
                  >
                    <option value="auto">{picked ? "Auto" : `Auto (${STATUS_INFO[st].label})`}</option>
                    <option value="mandate">Mandate</option>
                    <option value="flex">Flex</option>
                    <option value="none">Not set</option>
                  </select>
                </div>
              );
            })}
          </div>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search store, city, address" className={`${SEL} w-64`} />
        <label className="flex items-center gap-1.5 text-xs text-neutral-500">
          Sort
          <select id="gap-sort" value={sort} onChange={(e) => setSort(e.target.value as typeof sort)} className={SEL}>
            <option value="gaps">Most gaps first</option>
            <option value="name">Store name</option>
            <option value="ce">Most CE first</option>
          </select>
        </label>
        <button type="button" onClick={() => setOpen(allOpen ? new Set() : new Set(shown.map((r) => r.store.outlet_id)))} className={BTN}>
          {allOpen ? "Collapse all" : "Expand all"}
        </button>
        <button id="gap-export" type="button" onClick={exportExcel} className={`${BTN} ml-auto`}>
          Export to Excel
        </button>
      </div>

      <div className="flex flex-col gap-2">
        {shown.map((r) => {
          const isOpen = open.has(r.store.outlet_id);
          return (
            <div key={r.store.outlet_id} className="rounded-lg border border-neutral-800 bg-neutral-900">
              <div className="flex flex-wrap items-center gap-3 px-3 py-2">
                <button
                  type="button"
                  onClick={() => {
                    const n = new Set(open);
                    if (isOpen) n.delete(r.store.outlet_id);
                    else n.add(r.store.outlet_id);
                    setOpen(n);
                  }}
                  className="flex min-w-0 flex-1 items-center gap-2 text-left"
                  aria-expanded={isOpen}
                >
                  <span className="text-neutral-500">{isOpen ? "▾" : "▸"}</span>
                  <span className="min-w-0">
                    <span className="block truncate font-medium text-neutral-100">{r.store.name}</span>
                    <span className="block truncate text-xs text-neutral-500">
                      {[r.store.address, r.store.city, !dist ? r.store.distributor : null, `Outlet ${r.store.outlet_id}`].filter(Boolean).join(" · ")}
                    </span>
                  </span>
                </button>
                <span className="text-xs text-neutral-400">
                  Carries <b className="text-neutral-100">{r.carried.length}</b>
                </span>
                <span className="text-xs text-neutral-400">
                  Gaps <b className={r.gaps.length ? "text-amber-300" : "text-neutral-100"}>{r.gaps.length}</b>
                  {r.mandateGaps > 0 && <span className="ml-1 font-semibold text-red-400">({r.mandateGaps} Mandate)</span>}
                </span>
                <span className="text-xs text-neutral-500">Last buy {fdate(r.store.last_buy_date)}</span>
                <TurnOffButton supabase={supabase} userId={userId} outletId={r.store.outlet_id} name={r.store.name} onDone={onChanged} />
              </div>
              {isOpen && (
                <div className="grid gap-3 border-t border-neutral-800 p-3 lg:grid-cols-2">
                  <LineTable title="Carried" lines={r.carried} kind="carried" />
                  <LineTable title="Gaps" lines={r.gaps} kind="gap" />
                </div>
              )}
            </div>
          );
        })}
        {shown.length === 0 && <p className="text-sm text-neutral-500">No stores.</p>}
      </div>
    </div>
  );
}

function LineTable({ title, lines, kind }: { title: string; lines: StoreLine[]; kind: "carried" | "gap" }) {
  return (
    <div>
      <h3 className="mb-1 text-xs font-semibold uppercase tracking-wide text-neutral-500">
        {title} ({lines.length})
      </h3>
      {lines.length === 0 ? (
        <p className="text-sm text-neutral-500">{kind === "gap" ? "No gaps." : "Nothing bought in the last 90 days."}</p>
      ) : (
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-xs text-neutral-500">
              <th className="py-1 font-medium">Item</th>
              <th className="py-1 font-medium" />
              {kind === "carried" ? <th className="py-1 text-right font-medium">CE (90 days)</th> : <th className="py-1 text-right font-medium">Other stores carry</th>}
              <th className="py-1 text-right font-medium">Last sold</th>
            </tr>
          </thead>
          <tbody>
            {lines.map((l) => (
              <tr key={l.key} className="border-t border-neutral-800/70">
                <td className="py-1 pr-2 text-neutral-200">
                  {l.product} <span className="text-neutral-500">· {l.size}</span>
                </td>
                <td className="py-1 pr-2">
                  <StatusPill status={l.status} small />
                </td>
                <td className="py-1 text-right tabular-nums text-neutral-300">{kind === "carried" ? fmt(l.ce90) : l.othersCarry}</td>
                <td className="py-1 text-right tabular-nums text-neutral-400">{l.lastBuy ? fdate(l.lastBuy) : "Never"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// By item: rows = items, columns = chains, cells = stores carrying / stores
// ---------------------------------------------------------------------------
function ByItemView({ data, dist, resolved }: { data: GapByItemResult; dist: string; resolved: ReturnType<typeof resolveLists> }) {
  const [showAll, setShowAll] = useState(false);
  const [minStores, setMinStores] = useState(3);
  // Chains that carry the most of our items first, then by size.
  const chains = useMemo(() => {
    const carried = new Map<string, number>();
    for (const c of data.cells) carried.set(c.chain, (carried.get(c.chain) ?? 0) + c.carried);
    const list = data.chains
      .filter((c) => c.stores >= minStores)
      .sort((a, b) => (carried.get(b.chain) ?? 0) - (carried.get(a.chain) ?? 0) || b.stores - a.stores);
    return showAll ? list : list.slice(0, 15);
  }, [data, showAll, minStores]);
  const totalChains = data.chains.filter((c) => c.stores >= minStores).length;
  const cell = useMemo(() => new Map(data.cells.map((c) => [`${c.chain}\u0002${itemKey(c.product, c.size)}`, c])), [data]);
  const rows = useMemo(() => {
    const m = new Map<string, number>();
    for (const c of data.cells) m.set(itemKey(c.product, c.size), (m.get(itemKey(c.product, c.size)) ?? 0) + c.carried);
    // Mandate / Flex items for the shown chains appear even when nobody carries them.
    for (const ch of chains) {
      const r = resolved.rules.get(ch.chain);
      if (!r) continue;
      for (const k of [...r.mandate.keys(), ...r.flex, ...r.picked.keys()]) if (!m.has(k)) m.set(k, 0);
    }
    return [...m.entries()].sort((a, b) => b[1] - a[1]).map(([k]) => k);
  }, [data, chains, resolved]);

  async function exportExcel() {
    const ExcelJS = (await import("exceljs")).default;
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet("Gap by item");
    ws.addRow(["Item", "Size", ...chains.map((c) => `${c.chain} (${c.stores})`)]).font = { bold: true };
    const fill: Record<ItemStatus, string> = { mandate: "FFFCA5A5", flex: "FFFDE68A", none: "FFFFFFFF" };
    for (const k of rows) {
      const { product, size } = splitKey(k);
      const row = ws.addRow([
        product,
        size,
        ...chains.map((c) => {
          const x = cell.get(`${c.chain}\u0002${k}`);
          return `${x?.carried ?? 0} of ${c.stores}`;
        }),
      ]);
      chains.forEach((c, i) => {
        const st = statusFor(resolved.rules.get(c.chain), k, null);
        if (st !== "none") row.getCell(i + 3).fill = { type: "pattern", pattern: "solid", fgColor: { argb: fill[st] } };
      });
    }
    ws.getColumn(1).width = 32;
    ws.getColumn(2).width = 9;
    for (let i = 0; i < chains.length; i++) ws.getColumn(i + 3).width = 16;
    ws.views = [{ state: "frozen", xSplit: 2, ySplit: 1 }];
    downloadWorkbook(await wb.xlsx.writeBuffer(), `Gap by item - ${dist || "All distributors"} - ${data.as_of}.xlsx`);
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-3 text-sm text-neutral-400">
        <span>
          Each cell = stores in that chain{dist ? ` (${dist})` : ""} that carry the item, out of all its stores. Colored = Mandate / Flex for that chain.
        </span>
        <label className="flex items-center gap-1.5 text-xs">
          Chains with at least
          <select value={minStores} onChange={(e) => setMinStores(Number(e.target.value))} className={SEL}>
            {[1, 2, 3, 5, 10].map((n) => (
              <option key={n} value={n}>
                {n}
              </option>
            ))}
          </select>
          stores
        </label>
        {totalChains > 15 && (
          <button type="button" onClick={() => setShowAll((v) => !v)} className={BTN}>
            {showAll ? "Show top 15 chains" : `Show all ${totalChains} chains`}
          </button>
        )}
        <button id="gap-export" type="button" onClick={exportExcel} className={`${BTN} ml-auto`}>
          Export to Excel
        </button>
      </div>
      <div className="max-h-[70vh] overflow-auto rounded-lg border border-neutral-800">
        <table className="text-sm">
          <thead>
            <tr>
              <th className="sticky left-0 top-0 z-20 bg-neutral-950 px-3 py-2 text-left font-semibold text-neutral-300">Item</th>
              {chains.map((c) => (
                <th key={c.chain} className="sticky top-0 z-10 min-w-24 bg-neutral-950 px-2 py-2 text-center text-xs font-semibold text-neutral-300">
                  {c.chain}
                  <div className="font-normal text-neutral-500">{c.stores} stores</div>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((k) => {
              const { product, size } = splitKey(k);
              return (
                <tr key={k} className="border-t border-neutral-800">
                  <td className="sticky left-0 z-10 whitespace-nowrap bg-neutral-900 px-3 py-1.5 text-neutral-200">
                    {product} <span className="text-neutral-500">· {size}</span>
                  </td>
                  {chains.map((c) => {
                    const x = cell.get(`${c.chain}\u0002${k}`);
                    const n = x?.carried ?? 0;
                    const st = statusFor(resolved.rules.get(c.chain), k, null);
                    const pct = c.stores ? Math.round((n / c.stores) * 100) : 0;
                    const color = STATUS_INFO[st].color;
                    return (
                      <td
                        key={c.chain}
                        title={`${c.chain}: ${n} of ${c.stores} stores carry ${itemLabel(product, size)} (${STATUS_INFO[st].label})`}
                        className="px-2 py-1.5 text-center tabular-nums"
                        style={st !== "none" ? { background: `${color}${n === 0 ? "40" : "1f"}`, boxShadow: `inset 3px 0 0 ${color}` } : undefined}
                      >
                        {n === 0 ? (
                          <span className={st !== "none" ? "font-semibold text-red-300" : "text-neutral-700"}>0</span>
                        ) : (
                          <span className="text-neutral-100">
                            {n}
                            <span className="text-neutral-500">/{c.stores}</span>
                            <span className="ml-1 text-[10px] text-neutral-500">{pct}%</span>
                          </span>
                        )}
                      </td>
                    );
                  })}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export function downloadWorkbook(buf: ArrayBuffer | Uint8Array, filename: string) {
  const blob = new Blob([buf as BlobPart], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename.replace(/[\\/:*?"<>|]/g, "-");
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

// ---------------------------------------------------------------------------
// Turned off accounts
// ---------------------------------------------------------------------------
interface OffRow {
  id: string;
  outlet_id: string;
  name: string | null;
  city: string | null;
  distributor: string | null;
  turned_off_at: string;
  turned_off_by: string | null;
}
interface SearchRow {
  outlet_id: string;
  name: string;
  city: string | null;
  distributor: string | null;
  chain: string | null;
  is_off: boolean;
}

function TurnedOff({ supabase, userId, version, onChanged }: { supabase: Supa; userId: string | null; version: number; onChanged: () => void }) {
  const [rows, setRows] = useState<OffRow[] | null>(null);
  const [q, setQ] = useState("");
  const [found, setFound] = useState<SearchRow[]>([]);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      const { data, error } = await supabase.rpc("sales_dash_off_list");
      if (error) setErr(error.message);
      else setRows((data ?? []) as OffRow[]);
    })();
  }, [supabase, version]);

  useEffect(() => {
    if (q.trim().length < 2) return;
    const t = setTimeout(async () => {
      const { data, error } = await supabase.rpc("sales_dash_search", { p_q: q.trim() });
      if (error) setErr(error.message);
      else setFound((data ?? []) as SearchRow[]);
    }, 250);
    return () => clearTimeout(t);
  }, [supabase, q, version]);

  async function turnOn(r: OffRow) {
    const { error } = await supabase.from("sales_account_off").delete().eq("id", r.id);
    if (error) return setErr(error.message);
    await audit(supabase, userId, "sales_account_off", r.id, "account", r.name, "turned back on");
    onChanged();
  }

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <div className="rounded-lg border border-neutral-800 bg-neutral-900 p-3">
        <h2 className="mb-1 text-sm font-semibold text-neutral-200">Turn an account off</h2>
        <p className="mb-2 text-xs text-neutral-500">
          A turned-off account disappears from this dashboard and from Sales → Accounts (lists, counts, stage boxes, Product Lookup) until it&apos;s turned back on.
        </p>
        <input
          id="off-search"
          type="search"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search account name, city, address or Outlet ID"
          className={`${SEL} w-full`}
        />
        <div className="mt-2 flex flex-col">
          {(q.trim().length < 2 ? [] : found).map((f) => (
            <div key={f.outlet_id} className="flex items-center gap-2 border-t border-neutral-800 py-1.5 text-sm">
              <div className="min-w-0 flex-1">
                <div className="truncate text-neutral-200">{f.name}</div>
                <div className="truncate text-xs text-neutral-500">{[f.city, f.distributor, f.chain ? `Chain: ${f.chain}` : null, `Outlet ${f.outlet_id}`].filter(Boolean).join(" · ")}</div>
              </div>
              {f.is_off ? (
                <span className="text-xs text-neutral-500">Already off</span>
              ) : (
                <TurnOffButton supabase={supabase} userId={userId} outletId={f.outlet_id} name={f.name} onDone={onChanged} />
              )}
            </div>
          ))}
        </div>
      </div>
      <div className="rounded-lg border border-neutral-800 bg-neutral-900 p-3">
        <h2 className="mb-2 text-sm font-semibold text-neutral-200">Turned off ({rows?.length ?? "…"})</h2>
        {err && <p className="mb-2 text-sm text-red-300">{err}</p>}
        {rows && rows.length === 0 && <p className="text-sm text-neutral-500">No accounts are turned off.</p>}
        {rows?.map((r) => (
          <div key={r.id} className="flex items-center gap-2 border-t border-neutral-800 py-1.5 text-sm">
            <div className="min-w-0 flex-1">
              <div className="truncate text-neutral-200">{r.name ?? r.outlet_id}</div>
              <div className="truncate text-xs text-neutral-500">
                {[r.city, r.distributor, `Outlet ${r.outlet_id}`, `off ${fdate(r.turned_off_at)}${r.turned_off_by ? ` by ${r.turned_off_by}` : ""}`].filter(Boolean).join(" · ")}
              </div>
            </div>
            <button type="button" onClick={() => turnOn(r)} className="rounded border border-[#6abc46]/60 px-2 py-0.5 text-xs text-[#9be07a] hover:bg-[#6abc46]/15">
              Turn back on
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}
