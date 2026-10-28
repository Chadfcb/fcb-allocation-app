"use client";

// Sales Dashboard → Distributor Inventory tab (added 2026-10-28, per Chad —
// see lib/distInventory.ts). Read-only, built for the sales manager:
//   1. Running low or out — every distributor, out of stock first.
//   2. One card per distributor (name · rep, last updated, "N out · N low");
//      click → that distributor's full stock list.
//   3. Click any product → its sales at that distributor (cases last 30 / 90
//      days and year to date vs last year, cases by month, who's buying it and
//      who stopped). Click an account → the usual account pop-up.
// The Operations → Distributor Inventory page (editable grid) is unchanged.

import { useCallback, useEffect, useMemo, useState } from "react";
import type { Supa } from "@/components/SalesDashboardClient";
import { AccountPopup } from "@/components/DistributorPageClient";
import { CARD, MUTED, Change, Dot, ExportButton, Modal, Pill, Row, Stat, exportSheets } from "@/components/SalesDashboardHome";
import { DISTRIBUTOR_PAGES, FILE_INVENTORY_DISTRIBUTORS, NO_INVENTORY_DISTRIBUTORS } from "@/lib/distributorPages";
import { REP_BY_DISTRIBUTOR } from "@/lib/salesAccounts";
import { distColor, fmtDay, fmtN, pctChange } from "@/lib/salesDashHome";
import { daysBetween, isLow, isOut, lilyProductsOf, sizeOfProduct, type ProductSales, type StockData, type StockItem } from "@/lib/distInventory";

const DISTS = DISTRIBUTOR_PAGES.map((d) => d.name);
const repOf = (d: string) => REP_BY_DISTRIBUTOR[d] ?? "No FCB rep";

// "Thu 10/22/26, 4:12 AM" — Pacific time (same as the distributor pages).
function fmtStamp(ts: string): string {
  const tz = "America/Los_Angeles";
  const d = new Date(ts);
  const day = d.toLocaleDateString("en-US", { weekday: "short", month: "numeric", day: "numeric", year: "2-digit", timeZone: tz }).replace(",", "");
  const time = d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", timeZone: tz });
  return `${day}, ${time}`;
}

function stockLine(dist: string, s: StockData | undefined): string {
  if (!s?.updated_at) {
    if (NO_INVENTORY_DISTRIBUTORS.includes(dist)) return `${dist} doesn't report inventory yet`;
    if (FILE_INVENTORY_DISTRIBUTORS.includes(dist)) return "No inventory file uploaded yet";
    return "No inventory report yet";
  }
  return `${s.source === "ekos" ? "Updated from Ekos" : "Imported from file"}: ${fmtStamp(s.updated_at)}`;
}

const fmt1 = (n: number) => n.toLocaleString("en-US", { maximumFractionDigits: 1 });
const leftText = (i: StockItem) => (isOut(i) ? "Out" : `${i.weeks_left} wks`);

type Pick = { dist: string; item: StockItem };

export default function SalesDistInventory({ supabase }: { supabase: Supa }) {
  const [stock, setStock] = useState<Record<string, StockData>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [openDist, setOpenDist] = useState<string | null>(null);
  const [pick, setPick] = useState<Pick | null>(null);
  const [account, setAccount] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const res = await Promise.all(DISTS.map((d) => Promise.resolve(supabase.rpc("sales_territory_stock", { p_dist: d })).then((r) => [d, r] as const)));
    const s: Record<string, StockData> = {};
    const e: Record<string, string> = {};
    for (const [d, r] of res) {
      if (r.error) e[d] = r.error.message;
      else s[d] = r.data as StockData;
    }
    setStock(s);
    setErrors(e);
    setLoading(false);
  }, [supabase]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- first load from the database
    load();
  }, [load]);

  // Live: a new inventory report (the morning Ekos sync, or a Superior file) reloads.
  useEffect(() => {
    let t: ReturnType<typeof setTimeout> | null = null;
    const ch = supabase
      .channel("sales-dist-inventory")
      .on("postgres_changes", { event: "*", schema: "public", table: "distributor_inventory" }, () => {
        if (t) clearTimeout(t);
        t = setTimeout(() => load(), 1500);
      })
      .subscribe();
    return () => {
      if (t) clearTimeout(t);
      supabase.removeChannel(ch);
    };
  }, [supabase, load]);

  // Every distributor's low / out items, out of stock first, then fewest weeks left.
  const low = useMemo(() => {
    const out: Pick[] = [];
    for (const d of DISTS) for (const i of stock[d]?.inventory ?? []) if (isOut(i) || isLow(i)) out.push({ dist: d, item: i });
    return out.sort((a, b) => Number(isOut(b.item)) - Number(isOut(a.item)) || (a.item.weeks_left ?? 0) - (b.item.weeks_left ?? 0) || a.dist.localeCompare(b.dist));
  }, [stock]);

  const exportLow = async () => {
    setBusy(true);
    try {
      await exportSheets("Distributors - running low or out.xlsx", [
        {
          name: "Running low or out",
          title: `Running low or out — every distributor (under 2 weeks of stock, or out)`,
          cols: [
            { header: "Distributor", key: "dist", width: 16 },
            { header: "Rep", key: "rep", width: 12 },
            { header: "Product", key: "product", width: 44 },
            { header: "On hand", key: "on_hand" },
            { header: "Sells per week", key: "per_week" },
            { header: "Weeks on hand", key: "weeks" },
          ],
          rows: low.map((l) => ({ dist: l.dist, rep: repOf(l.dist), product: l.item.product, on_hand: l.item.on_hand, per_week: l.item.per_week, weeks: isOut(l.item) ? "Out" : (l.item.weeks_left ?? "") })),
        },
      ]);
    } finally {
      setBusy(false);
    }
  };

  if (loading) return <p className={`text-sm ${MUTED}`}>Loading distributor inventory…</p>;

  return (
    <div className="flex flex-col gap-4">
      <p className={`text-[12.5px] ${MUTED}`}>
        What each distributor has of our beer in their warehouse. Updated every weekday morning from Ekos (Superior from their Monday file). Click a distributor for its full list, or any product for its sales.
      </p>

      {/* 1. Running low or out */}
      <section className={`${CARD} flex min-w-0 flex-col gap-3`} style={{ borderColor: "rgba(239,68,68,0.35)" }}>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-[15px] font-semibold text-[#ffab9c]">Running low or out ({low.length})</h2>
            <p className={`text-[12.5px] ${MUTED}`}>Out of stock, or under 2 weeks left at the rate it&apos;s selling · every distributor</p>
          </div>
          {low.length > 0 && <ExportButton onClick={exportLow} busy={busy} />}
        </div>
        {low.length === 0 ? (
          <p className={`text-sm ${MUTED}`}>Nothing is running low right now.</p>
        ) : (
          <div className="max-h-[340px] overflow-y-auto pr-1">
            <div className="grid grid-cols-[auto_minmax(0,1fr)_auto_auto] items-center gap-x-4 gap-y-0.5 text-[13px]">
              <span className="text-[11px] text-neutral-500">Distributor</span>
              <span className="text-[11px] text-neutral-500">Product</span>
              <span className="text-right text-[11px] text-neutral-500">On hand</span>
              <span className="text-right text-[11px] text-neutral-500">Left</span>
              {low.map((l) => (
                <button
                  key={`${l.dist}|${l.item.product}`}
                  type="button"
                  onClick={() => setPick(l)}
                  className="col-span-4 grid grid-cols-subgrid items-center rounded-md py-1 text-left hover:bg-white/[0.03]"
                >
                  <span className="flex items-center gap-2 whitespace-nowrap text-neutral-200">
                    <Dot color={distColor(l.dist)} />
                    {l.dist}
                  </span>
                  <span className="min-w-0 truncate text-neutral-100">{l.item.product}</span>
                  <span className="text-right font-mono text-neutral-300">{fmtN(l.item.on_hand)}</span>
                  <span className={`text-right font-mono font-semibold ${isOut(l.item) ? "text-red-400" : "text-[#ffab9c]"}`}>{leftText(l.item)}</span>
                </button>
              ))}
            </div>
          </div>
        )}
      </section>

      {/* 2. One card per distributor */}
      <section className="flex flex-col gap-2">
        <h2 className="text-[15px] font-semibold text-neutral-100">Inventory by distributor</h2>
        <div className="grid grid-cols-[repeat(auto-fill,minmax(260px,1fr))] gap-3">
          {DISTS.map((d) => {
            const s = stock[d];
            const items = s?.inventory ?? [];
            const nOut = items.filter(isOut).length;
            const nLow = items.filter(isLow).length;
            const cases = items.reduce((t, i) => t + (Number(i.on_hand) || 0), 0);
            return (
              <button
                key={d}
                type="button"
                onClick={() => setOpenDist(d)}
                className={`${CARD} flex flex-col gap-2 text-left transition hover:border-[#6abc46]/40`}
              >
                <span className="flex items-center gap-2">
                  <Dot color={distColor(d)} glow />
                  <span className="text-[15px] font-semibold text-neutral-100">{d}</span>
                  <span className={`text-[12.5px] ${MUTED}`}>· {repOf(d)}</span>
                </span>
                <span className="text-[12px] text-neutral-500">{errors[d] ?? stockLine(d, s)}</span>
                <span className="flex items-end justify-between gap-2">
                  <span className="flex flex-col">
                    <span className="font-mono text-xl font-light text-neutral-50">{items.length ? fmtN(cases) : "—"}</span>
                    <span className="text-[11px] text-neutral-500">{items.length ? `on hand · ${items.length} product${items.length === 1 ? "" : "s"}` : "nothing reported"}</span>
                  </span>
                  {items.length > 0 &&
                    (nOut + nLow > 0 ? (
                      <span className="rounded-full bg-red-500/15 px-2.5 py-0.5 text-[11px] font-semibold text-[#ffab9c]">
                        {[nOut ? `${nOut} out` : null, nLow ? `${nLow} low` : null].filter(Boolean).join(" · ")}
                      </span>
                    ) : (
                      <span className="rounded-full bg-[#6abc46]/15 px-2.5 py-0.5 text-[11px] font-semibold text-[#9edc7f]">Stocked</span>
                    ))}
                </span>
              </button>
            );
          })}
        </div>
      </section>

      {openDist && !pick && !account && (
        <DistStockPopup dist={openDist} data={stock[openDist]} onClose={() => setOpenDist(null)} onPick={(item) => setPick({ dist: openDist, item })} />
      )}
      {pick && !account && (
        <ProductSalesPopup supabase={supabase} pick={pick} onClose={() => setPick(null)} onOpenAccount={(id) => setAccount(id)} />
      )}
      {account && <AccountPopup supabase={supabase} outletId={account} onClose={() => setAccount(null)} />}
    </div>
  );
}

// ---------------------------------------------------------------------------
// One distributor's full stock list
// ---------------------------------------------------------------------------
function DistStockPopup({ dist, data, onClose, onPick }: { dist: string; data: StockData | undefined; onClose: () => void; onPick: (i: StockItem) => void }) {
  const [busy, setBusy] = useState(false);
  const items = data?.inventory ?? [];
  const line = stockLine(dist, data);
  const exportStock = async () => {
    setBusy(true);
    try {
      await exportSheets(`${dist} - inventory.xlsx`, [
        {
          name: "Inventory",
          title: `${dist} inventory — ${line}`,
          cols: [
            { header: "Product", key: "product", width: 44 },
            { header: "On hand", key: "on_hand" },
            { header: "Sells per week", key: "per_week" },
            { header: "Weeks on hand", key: "weeks_left" },
          ],
          rows: items.map((i) => ({ ...i, weeks_left: isOut(i) ? "Out" : (i.weeks_left ?? "") })),
        },
      ]);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal title={`Stock at ${dist} · ${repOf(dist)}`} sub={`Their inventory · ${line} · click a product for its sales`} onClose={onClose} actions={items.length ? <ExportButton onClick={exportStock} busy={busy} /> : undefined}>
      {items.length === 0 ? (
        <p className={`text-sm ${MUTED}`}>Nothing to show yet.</p>
      ) : (
        <div className="max-h-[60vh] overflow-y-auto pr-1">
          <div className="grid grid-cols-[minmax(0,1fr)_auto_auto_auto] items-center gap-x-4 gap-y-0.5 text-[13px]">
            <span className="text-[11px] text-neutral-500">Product</span>
            <span className="text-right text-[11px] text-neutral-500">On hand</span>
            <span className="text-right text-[11px] text-neutral-500">Per week</span>
            <span className="text-right text-[11px] text-neutral-500">Weeks on hand</span>
            {items.map((i) => {
              const bad = isOut(i) || isLow(i);
              return (
                <button key={i.product} type="button" onClick={() => onPick(i)} className="col-span-4 grid grid-cols-subgrid items-center rounded-md py-1 text-left hover:bg-white/[0.03]">
                  <span className="min-w-0 truncate text-neutral-100">{i.product}</span>
                  <span className="text-right font-mono">{fmtN(i.on_hand)}</span>
                  <span className="text-right font-mono text-neutral-400">{fmt1(i.per_week)}</span>
                  <span className={`text-right font-mono ${bad ? "font-semibold text-[#ffab9c]" : "text-neutral-300"}`}>{isOut(i) ? "Out" : (i.weeks_left ?? "—")}</span>
                </button>
              );
            })}
          </div>
        </div>
      )}
    </Modal>
  );
}

// ---------------------------------------------------------------------------
// One product at one distributor: its sales
// ---------------------------------------------------------------------------
const PERIODS = [
  { p: "30", label: "Last 30 days" },
  { p: "90", label: "Last 90 days" },
  { p: "ytd", label: "Year to date" },
] as const;

function monthKey(iso: string) {
  return iso.slice(0, 7);
}
function addMonths(ym: string, n: number) {
  const [y, m] = ym.split("-").map(Number);
  const d = new Date(Date.UTC(y, m - 1 + n, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}
const MONTH_NAMES = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function ProductSalesPopup({ supabase, pick, onClose, onOpenAccount }: { supabase: Supa; pick: Pick; onClose: () => void; onOpenAccount: (id: string) => void }) {
  const { dist, item } = pick;
  const lily = useMemo(() => lilyProductsOf(item.product), [item.product]);
  const size = useMemo(() => sizeOfProduct(item.product), [item.product]);
  const [data, setData] = useState<ProductSales | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [list, setList] = useState<"buying" | "stopped">("buying");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!lily.length) return;
    let cancelled = false;
    supabase.rpc("sales_dist_product_sales", { p_dist: dist, p_products: lily, p_size: size }).then(({ data: d, error }) => {
      if (cancelled) return;
      if (error) setErr(error.message);
      else setData(d as ProductSales);
    });
    return () => {
      cancelled = true;
    };
  }, [supabase, dist, lily, size]);

  const asOf = data?.as_of ?? null;
  const period = (p: string, yr: "ty" | "ly") => Number(data?.periods.find((x) => x.p === p && x.yr === yr)?.cases ?? 0);

  // Last 12 months (as-of month last) and the same months last year.
  const months = useMemo(() => {
    if (!data?.as_of) return [];
    const byM = new Map(data.months.map((m) => [monthKey(m.month), Number(m.cases) || 0]));
    const last = monthKey(data.as_of);
    return Array.from({ length: 12 }, (_, i) => {
      const ym = addMonths(last, i - 11);
      return { ym, ty: byM.get(ym) ?? 0, ly: byM.get(addMonths(ym, -12)) ?? 0, partial: ym === last };
    });
  }, [data]);
  const maxM = Math.max(1, ...months.map((m) => Math.max(m.ty, m.ly)));

  // Buying = ordered it in the last 90 days. Stopped = ordered it in the last
  // 12 months, but not in the last 90 days.
  const { buying, stopped } = useMemo(() => {
    const b: ProductSales["accounts"] = [];
    const s: ProductSales["accounts"] = [];
    if (!asOf) return { buying: b, stopped: s };
    for (const a of data?.accounts ?? []) {
      if (!a.last_buy) continue;
      const dark = daysBetween(a.last_buy, asOf);
      if (dark <= 89) b.push(a);
      else if (dark <= 365) s.push(a);
    }
    b.sort((x, y) => (Number(y.cases_12) || 0) - (Number(x.cases_12) || 0));
    s.sort((x, y) => (y.last_buy ?? "").localeCompare(x.last_buy ?? ""));
    return { buying: b, stopped: s };
  }, [data, asOf]);
  const rows = list === "buying" ? buying : stopped;

  const exportAccounts = async () => {
    setBusy(true);
    try {
      const cols = [
        { header: "Account", key: "name", width: 40 },
        { header: "City", key: "city", width: 16 },
        { header: "Premise", key: "premise", width: 10 },
        { header: "Last order", key: "last_buy", width: 12 },
        { header: "Cases last 3 months", key: "cases_90" },
        { header: "Cases last 12 months", key: "cases_12" },
      ];
      const r = (xs: ProductSales["accounts"]) => xs.map((a) => ({ ...a, last_buy: fmtDay(a.last_buy), cases_90: a.cases_90 ?? 0, cases_12: a.cases_12 ?? 0 }));
      await exportSheets(`${dist} - ${item.product} - accounts.xlsx`, [
        { name: "Buying", title: `${item.product} at ${dist} — buying (ordered in the last 90 days, sales through ${fmtDay(asOf)})`, cols, rows: r(buying) },
        { name: "Stopped", title: `${item.product} at ${dist} — stopped (ordered in the last 12 months, not in the last 90 days)`, cols, rows: r(stopped) },
      ]);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      title={`${item.product} · ${dist}`}
      sub={`On hand ${fmtN(item.on_hand)} · sells ${fmt1(item.per_week)} a week · ${isOut(item) ? "OUT" : item.weeks_left !== null ? `${item.weeks_left} weeks left` : "no recent sales rate"}${asOf ? ` · sales through ${fmtDay(asOf)} (LilyPad)` : ""}`}
      onClose={onClose}
      actions={data && (buying.length || stopped.length) ? <ExportButton onClick={exportAccounts} busy={busy} /> : undefined}
    >
      {!lily.length ? (
        <p className={`text-sm ${MUTED}`}>LilyPad doesn&apos;t have sales for this product, so there&apos;s no sales history to show.</p>
      ) : err ? (
        <p className="text-sm text-red-300">{err}</p>
      ) : !data ? (
        <p className={`text-sm ${MUTED}`}>Loading sales…</p>
      ) : (
        <div className="flex flex-col gap-5">
          {/* Cases sold vs last year */}
          <div className="flex flex-wrap gap-x-10 gap-y-3">
            {PERIODS.map(({ p, label }) => {
              const ty = period(p, "ty");
              const ly = period(p, "ly");
              return (
                <div key={p} className="flex flex-col gap-1">
                  <Stat value={fmt1(ty)} label={`Cases · ${label}`} />
                  <span className="flex items-center gap-1.5 text-[11px] text-neutral-500">
                    <Change value={pctChange(ty, ly)} title={`Same days last year: ${fmt1(ly)} cases`} /> vs {fmt1(ly)} last year
                  </span>
                </div>
              );
            })}
          </div>

          {/* Cases by month */}
          <div className="flex flex-col gap-2">
            <h3 className="text-xs font-semibold uppercase tracking-wide text-neutral-500">Cases by month</h3>
            <div className="flex h-32 items-end gap-1.5">
              {months.map((m) => (
                <div
                  key={m.ym}
                  className="flex h-full min-w-0 flex-1 flex-col justify-end"
                  title={`${MONTH_NAMES[+m.ym.slice(5) - 1]} ${m.ym.slice(0, 4)}${m.partial ? " (so far)" : ""}: ${fmt1(m.ty)} cases · same month last year: ${fmt1(m.ly)}`}
                >
                  <div className="flex h-full items-end gap-[2px]">
                    <div className="flex-1 rounded-t-sm bg-neutral-700/70" style={{ height: `${(m.ly / maxM) * 100}%` }} />
                    <div className={`flex-1 rounded-t-sm ${m.partial ? "bg-[#6abc46]/50" : "bg-[#6abc46]"}`} style={{ height: `${(m.ty / maxM) * 100}%` }} />
                  </div>
                </div>
              ))}
            </div>
            <div className="flex gap-1.5">
              {months.map((m) => (
                <span key={m.ym} className="min-w-0 flex-1 text-center text-[10px] text-neutral-500">
                  {MONTH_NAMES[+m.ym.slice(5) - 1]}
                </span>
              ))}
            </div>
            <span className="flex items-center gap-3 text-[11px] text-neutral-500">
              <span className="flex items-center gap-1">
                <span className="inline-block h-2 w-2 rounded-sm bg-[#6abc46]" /> This year
              </span>
              <span className="flex items-center gap-1">
                <span className="inline-block h-2 w-2 rounded-sm bg-neutral-700" /> Last year
              </span>
              <span>· hover a month for numbers</span>
            </span>
          </div>

          {/* Accounts */}
          <div className="flex flex-col gap-2">
            <div className="flex flex-wrap gap-2">
              <Pill on={list === "buying"} onClick={() => setList("buying")}>
                Buying <span className="font-mono opacity-80">{buying.length}</span>
              </Pill>
              <Pill on={list === "stopped"} onClick={() => setList("stopped")}>
                Stopped buying <span className="font-mono opacity-80">{stopped.length}</span>
              </Pill>
            </div>
            <p className="text-xs text-neutral-500">
              {list === "buying" ? "Ordered it in the last 90 days · most cases first" : "Ordered it in the last 12 months, but not in the last 90 days · most recent first"} · click an account for its details
            </p>
            <div className="flex max-h-[340px] flex-col overflow-y-auto pr-1">
              {rows.length === 0 ? (
                <p className={`py-3 text-sm ${MUTED}`}>None.</p>
              ) : (
                rows.map((a) => (
                  <Row
                    key={a.outlet_id}
                    title={a.name}
                    sub={[a.city, a.premise === "On" ? "On-premise" : a.premise === "Off" ? "Off-premise" : null, `last order ${fmtDay(a.last_buy)}`].filter(Boolean).join(" · ")}
                    value={fmt1(Number(a.cases_12) || 0)}
                    valueLabel="cases · 12 mo"
                    onClick={() => onOpenAccount(a.outlet_id)}
                  />
                ))
              )}
            </div>
          </div>
        </div>
      )}
    </Modal>
  );
}
