"use client";

// My Territory (Main → My Territory), added 2026-10-21, per Chad: "a Matagrano
// dashboard specifically for Steve … with information pertaining just to
// matagrano, for him to look at each day and be able to make decisions."
// Plan: claude/rep-dashboard-plan.md.
//
// One page for every rep: it shows only the distributor(s) set as the
// person's Territory on Admin → Users (rep_territories). Admins pick any
// distributor to see what that rep sees.
//
// Top to bottom: today's priorities (must-carry gaps, slipping accounts, big
// losses) + stock at the distributor (inventory, weeks of supply, this week's
// order) · follow-ups (win backs, new accounts) · headline numbers · cases by
// month · what's selling + the rep's activity. Click an account → its details
// in a pop-up (reps don't have Sales → Accounts). Lists export to Excel.
//
// Live: numbers come from the database on every open, and reload when a
// LilyPad sync finishes (sales_data_meta). Data: sales_dash_home (same as the
// Sales Dashboard home, one distributor), sales_territory_stock,
// sales_territory_account, and the Action Items gap check — sql/my_territory.sql.

import { useCallback, useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { useActionItems, type ActionRow } from "@/components/SalesActionItems";
import {
  CARD,
  COLS_ACCOUNTS,
  COLS_GAPS,
  COLS_WB,
  CasesByMonth,
  Change,
  Dot,
  ExportButton,
  MUTED,
  Modal,
  Pill,
  Row,
  Stat,
  Tag,
  accountRows,
  exportSheets,
  fmtChecked,
  fmtWeekdayDay,
  gapRows,
  wbRows,
} from "@/components/SalesDashboardHome";
import { BIG_LOST_CE, CURRENT_DISTRIBUTORS, REP_BY_DISTRIBUTOR } from "@/lib/salesAccounts";
import { resolveLists, type DashOverview } from "@/lib/salesDashboard";
import { PERIODS, brands, distColor, fmtDay, fmtN, kpis, pctChange, winbacksIn, type HomeData, type Period } from "@/lib/salesDashHome";

const PREF_KEY = "fcb-my-territory";

interface StockData {
  inventory_week: { label: string; week_start: string } | null;
  inventory: { product: string; on_hand: number; per_week: number; weeks_left: number | null; imported_at: string | null }[];
  order_week: { label: string; week_start: string } | null;
  order: { distributor: string; product: string; quantity: number; status_flag: string | null }[];
  order_status: { distributor: string; po_number: string | null; po_status: string | null }[];
}
interface NewAccount {
  outlet_id: string;
  name: string;
  city: string | null;
  dist: string;
  fb: string;
  lb: string | null;
  ce12: number;
}
interface AccountDetail {
  account: {
    outlet_id: string;
    name: string;
    address: string | null;
    city: string | null;
    zip: string | null;
    phone: string | null;
    distributor: string | null;
    premise: string | null;
    last_buy: string | null;
    first_buy: string | null;
    ce_12mo: number;
    lifetime_ce: number;
  } | null;
  as_of: string | null;
  sales: { month: string; product: string; size: string; ce: number; last_buy: string | null }[];
  checkins: { checkin_date: string; rep: string | null; activity: string | null; notes: string | null; brands: string | null }[];
}

const PO_LABEL: Record<string, string> = { approved: "Approved", pending: "Pending", delivered: "Delivered" };

export default function MyTerritoryClient({ isAdmin, viewerName }: { isAdmin: boolean; viewerName: string | null }) {
  const supabase = useMemo(() => createClient(), []);
  const [mine, setMine] = useState<string[] | null>(null);
  const [dist, setDist] = useState("");
  const [period, setPeriod] = useState<Exclude<Period, "custom">>("30");
  const [ov, setOv] = useState<DashOverview | null>(null);
  const [home, setHome] = useState<HomeData | null>(null);
  const [stock, setStock] = useState<StockData | null>(null);
  const [checkedAt, setCheckedAt] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [version, setVersion] = useState(0);
  const [att, setAtt] = useState<"gaps" | "slip" | "lost">("gaps");
  const [follow, setFollow] = useState<"won" | "new">("won");
  const [openId, setOpenId] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  // Which distributor(s) this person covers. Admins can look at any.
  useEffect(() => {
    supabase.rpc("my_territories").then(({ data }) => {
      const list = ((data as string[] | null) ?? []).filter(Boolean);
      setMine(list);
      let saved = "";
      try {
        saved = localStorage.getItem(PREF_KEY) ?? "";
      } catch {
        // ignore
      }
      const options = isAdmin ? CURRENT_DISTRIBUTORS : list;
      setDist(options.includes(saved) ? saved : (list[0] ?? (isAdmin ? "Matagrano" : "")));
    });
  }, [supabase, isAdmin]);
  const options = isAdmin ? CURRENT_DISTRIBUTORS.filter((d) => d !== "Coast" && d !== "Superior") : (mine ?? []);

  const load = useCallback(async () => {
    if (!dist) return;
    const [h, s, o, m] = await Promise.all([
      supabase.rpc("sales_dash_home", { p_current: [dist], p_big: BIG_LOST_CE, p_from: null, p_to: null }),
      supabase.rpc("sales_territory_stock", { p_dist: dist }),
      supabase.rpc("sales_dash_overview"),
      supabase.from("sales_data_meta").select("imported_at").eq("id", 1).maybeSingle(),
    ]);
    const e = h.error ?? s.error ?? o.error;
    if (e) {
      setErr(e.message);
      return;
    }
    setErr(null);
    setHome(h.data as HomeData);
    setStock(s.data as StockData);
    setOv(o.data as DashOverview);
    setCheckedAt((m.data?.imported_at as string | null) ?? null);
    setVersion((v) => v + 1);
  }, [supabase, dist]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- load from the database
    load();
  }, [load]);

  // Live: a LilyPad sync stamps sales_data_meta when it finishes → reload.
  useEffect(() => {
    let t: ReturnType<typeof setTimeout> | null = null;
    const ch = supabase
      .channel("my-territory")
      .on("postgres_changes", { event: "*", schema: "public", table: "sales_data_meta" }, () => {
        if (t) clearTimeout(t);
        t = setTimeout(() => load(), 800);
      })
      .subscribe();
    return () => {
      if (t) clearTimeout(t);
      supabase.removeChannel(ch);
    };
  }, [supabase, load]);

  const resolved = useMemo(() => (ov ? resolveLists(ov) : null), [ov]);
  const actions = useActionItems(supabase, ov, resolved, version, dist || null);

  if (mine && !isAdmin && mine.length === 0) {
    return (
      <div className="p-6">
        <h1 className="text-2xl font-bold text-neutral-100">My Territory</h1>
        <p className={`mt-2 text-sm ${MUTED}`}>No territory is set for you yet — ask an admin to set it on Admin → Users.</p>
      </div>
    );
  }

  const rep = REP_BY_DISTRIBUTOR[dist] ?? null;
  const hello = viewerName?.split(/\s+/)[0] ?? null;
  const gaps = (actions.rows ?? []).filter((r) => r.store.distributor === dist).sort((a, b) => b.impact - a.impact);
  const attention = (home?.attention ?? []).filter((a) => a.dist === dist);
  const slip = attention.filter((a) => a.stage === "plost");
  const lost = attention.filter((a) => a.stage === "lost");
  const k = home?.as_of ? kpis(home, period, dist) : null;
  const wins = home?.as_of ? winbacksIn(home, period, dist) : [];
  const newAccts = (((home as (HomeData & { new_accounts?: NewAccount[] }) | null)?.new_accounts ?? []) as NewAccount[]).filter((a) => a.dist === dist);
  const pLabel = PERIODS.find((p) => p.key === period)!.long;
  const topBrands = home?.as_of ? brands(home, period, dist, 8) : [];
  const myCheckins =
    home?.checkins && rep
      ? home.checkins.filter((c) => c.p === period && (c.rep ?? "").trim().toLowerCase().split(/\s+/)[0] === rep.toLowerCase()).reduce((t, c) => t + (Number(c.n) || 0), 0)
      : null;

  const low = (stock?.inventory ?? []).filter((i) => i.per_week > 0 && (i.on_hand <= 0 || (i.weeks_left ?? 99) < 2));

  const ATT = {
    gaps: { label: "Must-carry gaps", count: actions.rows ? gaps.length : null, rule: "Stores not buying an item their chain says they must carry. Biggest first." },
    slip: { label: "Slipping now", count: slip.length, rule: "61–90 days since their last order — still saveable. Biggest 12-month buyers first." },
    lost: { label: "Win back", count: lost.length, rule: `Lost in the last year (90+ days quiet), ${BIG_LOST_CE}+ cases all time. Biggest first.` },
  } as const;

  const exportAtt = async () => {
    setBusy("att");
    try {
      if (att === "gaps") await exportSheets(`${dist} - must-carry gaps - ${home?.as_of}.xlsx`, [{ name: "Must-carry gaps", title: `${dist} — must-carry gaps`, cols: COLS_GAPS, rows: gapRows(gaps) }]);
      else
        await exportSheets(`${dist} - ${ATT[att].label} - ${home?.as_of}.xlsx`, [
          { name: ATT[att].label, title: `${dist} — ${ATT[att].label} · ${ATT[att].rule}`, cols: COLS_ACCOUNTS, rows: accountRows(att === "slip" ? slip : lost) },
        ]);
    } finally {
      setBusy(null);
    }
  };
  const exportFollow = async () => {
    setBusy("follow");
    try {
      if (follow === "won") await exportSheets(`${dist} - win backs - ${pLabel} - ${home?.as_of}.xlsx`, [{ name: "Win backs", title: `${dist} — win backs — ${pLabel}`, cols: COLS_WB, rows: wbRows(wins) }]);
      else
        await exportSheets(`${dist} - new accounts - ${home?.as_of}.xlsx`, [
          {
            name: "New accounts",
            title: `${dist} — new accounts this year`,
            cols: [
              { header: "Account", key: "name", width: 32 },
              { header: "City", key: "city" },
              { header: "First order", key: "fb" },
              { header: "Last order", key: "lb" },
              { header: "Cases last 12 months", key: "ce12" },
            ],
            rows: newAccts.map((a) => ({ name: a.name, city: a.city ?? "", fb: fmtDay(a.fb), lb: fmtDay(a.lb), ce12: Math.round(Number(a.ce12) || 0) })),
          },
        ]);
    } finally {
      setBusy(null);
    }
  };
  const exportStock = async () => {
    setBusy("stock");
    try {
      await exportSheets(`${dist} - stock - ${stock?.inventory_week?.week_start ?? ""}.xlsx`, [
        {
          name: "Inventory",
          title: `${dist} inventory — ${stock?.inventory_week?.label ?? ""}`,
          cols: [
            { header: "Product", key: "product", width: 44 },
            { header: "On hand", key: "on_hand" },
            { header: "Sells per week", key: "per_week" },
            { header: "Weeks left", key: "weeks_left" },
          ],
          rows: (stock?.inventory ?? []).map((i) => ({ ...i, weeks_left: i.weeks_left ?? "" })),
        },
        {
          name: "This week's order",
          title: `${dist} order — ${stock?.order_week?.label ?? ""}`,
          cols: [
            { header: "Order", key: "distributor", width: 16 },
            { header: "Product", key: "product", width: 44 },
            { header: "Quantity", key: "quantity" },
          ],
          rows: stock?.order ?? [],
        },
      ]);
    } finally {
      setBusy(null);
    }
  };

  const gapRowsView = gaps.slice(0, 6).map((r: ActionRow) => (
    <Row
      key={r.store.outlet_id}
      left={<Dot color="#ef6a55" />}
      title={`${r.store.name}${r.store.city ? ` · ${r.store.city}` : ""}`}
      sub={`Not buying ${r.missing.map((m) => `${m.product} ${m.size}`).join(", ")} (${r.chain} must-carry)`}
      value={fmtN(r.impact)}
      valueLabel="cases / yr at stake"
      onClick={() => setOpenId(r.store.outlet_id)}
    />
  ));
  const acctRowsView = (att === "slip" ? slip : lost).slice(0, 6).map((a) => (
    <Row
      key={a.outlet_id}
      left={<Dot color={att === "slip" ? "#f0a63c" : "#ef6a55"} />}
      title={`${a.name}${a.city ? ` · ${a.city}` : ""}`}
      sub={`${a.dark} days since the last order (${fmtDay(a.lb)})${a.checkin ? ` · last check-in ${fmtDay(a.checkin.date)}` : " · no check-in on record"}`}
      value={fmtN(a.ce12)}
      valueLabel="cases last 12 mo"
      onClick={() => setOpenId(a.outlet_id)}
    />
  ));

  return (
    <div className="flex flex-col gap-5 p-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="flex flex-col gap-1.5">
          <h1 className="flex items-center gap-2.5 text-2xl font-bold text-neutral-100">
            <Dot color={distColor(dist)} glow />
            {dist || "My Territory"}
            {rep && <span className="text-base font-normal text-neutral-500">· {rep}</span>}
          </h1>
          <p className={`text-[13px] ${MUTED}`}>
            {hello ? `Good to see you, ${hello}. ` : ""}Latest sales in LilyPad: <span className="text-neutral-200">{fmtWeekdayDay(home?.as_of ?? null)}</span>
            {checkedAt && (
              <>
                {" "}
                · Last checked for new sales: <span className="text-neutral-200">{fmtChecked(checkedAt)}</span>
              </>
            )}
          </p>
        </div>
        {options.length > 1 && (
          <div className="flex flex-wrap gap-2">
            {options.map((d) => (
              <Pill
                key={d}
                on={dist === d}
                onClick={() => {
                  setDist(d);
                  try {
                    localStorage.setItem(PREF_KEY, d);
                  } catch {
                    // ignore
                  }
                }}
              >
                <Dot color={distColor(d)} />
                {d}
              </Pill>
            ))}
          </div>
        )}
      </div>

      {err && <p className="rounded-md border border-red-500/40 bg-red-500/10 px-3 py-2 text-sm text-red-300">{err}</p>}
      {!home && !err && <p className={`text-sm ${MUTED}`}>Loading…</p>}

      {home && (
        <>
          {/* Today's priorities + stock */}
          <div className="flex flex-wrap gap-4">
            <section className={`${CARD} flex min-w-0 flex-[1_1_560px] flex-col gap-3`}>
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <h2 className="text-[15px] font-semibold text-neutral-100">Today&apos;s priorities</h2>
                  <p className={`text-[12.5px] ${MUTED}`}>Biggest first — click an account for its details</p>
                </div>
                <ExportButton onClick={exportAtt} busy={busy === "att"} />
              </div>
              <div className="flex flex-wrap gap-2">
                {(Object.keys(ATT) as (keyof typeof ATT)[]).map((key) => (
                  <Pill key={key} on={att === key} onClick={() => setAtt(key)}>
                    {ATT[key].label} <span className="font-mono opacity-80">{ATT[key].count ?? "…"}</span>
                  </Pill>
                ))}
              </div>
              <p className="text-xs text-neutral-500">{ATT[att].rule}</p>
              <div className="flex flex-col">
                {att === "gaps" && !actions.rows ? (
                  <p className={`py-4 text-sm ${MUTED}`}>Checking chain stores…</p>
                ) : (att === "gaps" ? gapRowsView : acctRowsView).length ? (
                  att === "gaps" ? gapRowsView : acctRowsView
                ) : (
                  <p className={`py-4 text-sm ${MUTED}`}>Nothing here right now.</p>
                )}
              </div>
              {(att === "gaps" ? gaps.length : att === "slip" ? slip.length : lost.length) > 6 && (
                <p className="text-xs text-neutral-500">Top 6 shown — Export has all {att === "gaps" ? gaps.length : att === "slip" ? slip.length : lost.length}.</p>
              )}
            </section>

            <section className={`${CARD} flex min-w-0 flex-[1_1_420px] flex-col gap-3`}>
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <h2 className="text-[15px] font-semibold text-neutral-100">Stock at {dist}</h2>
                  <p className={`text-[12.5px] ${MUTED}`}>
                    {stock?.inventory_week ? `Their inventory · ${stock.inventory_week.label}` : "No inventory report for this distributor yet"}
                  </p>
                </div>
                <ExportButton onClick={exportStock} busy={busy === "stock"} />
              </div>
              {low.length > 0 && (
                <div className="flex flex-col gap-1.5 rounded-xl border border-red-500/30 bg-red-500/5 p-3">
                  <span className="text-xs font-semibold text-[#ffab9c]">Running low or out ({low.length})</span>
                  {low.map((i) => (
                    <span key={i.product} className="flex justify-between gap-3 text-[13px]">
                      <span className="min-w-0 truncate text-neutral-200">{i.product}</span>
                      <span className="whitespace-nowrap font-mono text-neutral-300">{i.on_hand <= 0 ? "Out" : `${i.weeks_left} wks`}</span>
                    </span>
                  ))}
                </div>
              )}
              <div className="max-h-64 overflow-y-auto">
                <div className="grid grid-cols-[minmax(0,1fr)_auto_auto_auto] gap-x-4 gap-y-1.5 text-[13px]">
                  <span className="text-[11px] text-neutral-500">Product</span>
                  <span className="text-right text-[11px] text-neutral-500">On hand</span>
                  <span className="text-right text-[11px] text-neutral-500">Per week</span>
                  <span className="text-right text-[11px] text-neutral-500">Weeks</span>
                  {(stock?.inventory ?? []).map((i) => (
                    <span key={i.product} className="contents">
                      <span className="min-w-0 truncate text-neutral-200">{i.product}</span>
                      <span className="text-right font-mono">{fmtN(i.on_hand)}</span>
                      <span className="text-right font-mono text-neutral-400">{fmtN(i.per_week)}</span>
                      <span className={`text-right font-mono ${i.weeks_left !== null && i.weeks_left < 2 ? "text-[#ffab9c]" : "text-neutral-300"}`}>{i.weeks_left ?? "—"}</span>
                    </span>
                  ))}
                </div>
              </div>
              <div className="flex flex-col gap-1.5 border-t border-neutral-800/70 pt-3">
                <span className="flex flex-wrap items-center gap-2 text-xs text-neutral-500">
                  This week&apos;s order{stock?.order_week ? ` · ${stock.order_week.label}` : ""}
                  {(stock?.order_status ?? []).map((s) => (
                    <span key={s.distributor} className="rounded-full bg-neutral-800 px-2 py-0.5 text-[11px] text-neutral-200">
                      {s.distributor}
                      {s.po_number ? ` PO ${s.po_number}` : ""} · {s.po_status ? PO_LABEL[s.po_status] ?? s.po_status : "Not ordered"}
                    </span>
                  ))}
                </span>
                {(stock?.order ?? []).length ? (
                  (stock?.order ?? []).map((o) => (
                    <span key={`${o.distributor}|${o.product}`} className="flex justify-between gap-3 text-[13px]">
                      <span className="min-w-0 truncate text-neutral-200">
                        {o.product}
                        {o.distributor !== dist ? <span className="text-neutral-500"> · {o.distributor}</span> : null}
                      </span>
                      <span className="font-mono">{fmtN(o.quantity)}</span>
                    </span>
                  ))
                ) : (
                  <span className={`text-[13px] ${MUTED}`}>Nothing on order this week yet.</span>
                )}
              </div>
            </section>
          </div>

          {/* Period + follow-ups */}
          <div className="flex flex-wrap items-center gap-2">
            {PERIODS.map((p) => (
              <Pill key={p.key} on={period === p.key} onClick={() => setPeriod(p.key)}>
                {p.label}
              </Pill>
            ))}
          </div>

          <div className="flex flex-wrap gap-4">
            <section className={`${CARD} flex min-w-0 flex-[1_1_560px] flex-col gap-3`}>
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <h2 className="text-[15px] font-semibold text-neutral-100">Follow up</h2>
                  <p className={`text-[12.5px] ${MUTED}`}>Accounts that came back or just started — keep them buying</p>
                </div>
                <ExportButton onClick={exportFollow} busy={busy === "follow"} />
              </div>
              <div className="flex flex-wrap gap-2">
                <Pill on={follow === "won"} onClick={() => setFollow("won")}>
                  Won back · {pLabel} <span className="font-mono opacity-80">{wins.length}</span>
                </Pill>
                <Pill on={follow === "new"} onClick={() => setFollow("new")}>
                  New this year <span className="font-mono opacity-80">{newAccts.length}</span>
                </Pill>
              </div>
              <div className="flex flex-col">
                {follow === "won"
                  ? wins.slice(0, 6).map((w) => (
                      <Row
                        key={`${w.outlet_id}-${w.d}`}
                        left={<Tag kind={w.gap > 90 ? "wl" : "wp"}>{w.gap > 90 ? "From Lost" : "From Pot. lost"}</Tag>}
                        title={`${w.name}${w.city ? ` · ${w.city}` : ""}`}
                        sub={`Back ${fmtDay(w.d)}${w.items ? ` with ${w.items}` : ""}`}
                        value={String(w.gap)}
                        valueLabel="days gone"
                        onClick={() => setOpenId(w.outlet_id)}
                      />
                    ))
                  : newAccts.slice(0, 6).map((a) => (
                      <Row
                        key={a.outlet_id}
                        left={<Tag kind="wp">New</Tag>}
                        title={`${a.name}${a.city ? ` · ${a.city}` : ""}`}
                        sub={`First order ${fmtDay(a.fb)} · last order ${fmtDay(a.lb)}`}
                        value={fmtN(Number(a.ce12) || 0)}
                        valueLabel="cases so far"
                        onClick={() => setOpenId(a.outlet_id)}
                      />
                    ))}
                {(follow === "won" ? wins.length : newAccts.length) === 0 && <p className={`py-4 text-sm ${MUTED}`}>None yet.</p>}
              </div>
            </section>

            {k && (
              <section className={`${CARD} flex min-w-0 flex-[1_1_420px] flex-col gap-4`}>
                <div>
                  <h2 className="text-[15px] font-semibold text-neutral-100">{dist} at a glance</h2>
                  <p className={`text-[12.5px] ${MUTED}`}>{pLabel} · vs the same days last year</p>
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div className="flex flex-col gap-1">
                    <span className="font-mono text-[28px] font-light leading-tight text-neutral-50">{fmtN(k.cases)}</span>
                    <span className="flex items-center gap-2 text-xs text-neutral-500">
                      Cases sold <Change value={pctChange(k.cases, k.casesLy)} />
                    </span>
                  </div>
                  <div className="flex flex-col gap-1">
                    <span className="font-mono text-[28px] font-light leading-tight text-neutral-50">{fmtN(k.buying)}</span>
                    <span className="flex items-center gap-2 text-xs text-neutral-500">
                      Buying accounts <Change value={pctChange(k.buying, k.buyingLy)} />
                    </span>
                  </div>
                  <Stat value={fmtN(k.newA)} label="New accounts" color="#5aa9f0" />
                  <Stat value={fmtN(k.won)} label="Won back" color="#7fe0cd" />
                  <Stat value={fmtN(k.atRisk)} label={`At risk · ${fmtN(k.atRiskCe)} cases a year`} color="#f7c27a" />
                  <Stat value={fmtN(k.wentLost)} label="Went lost" color="#ff9a8a" />
                </div>
                {rep && (
                  <div className="flex flex-wrap gap-6 border-t border-neutral-800/70 pt-3">
                    <Stat value={myCheckins === null ? "—" : fmtN(myCheckins)} label={`${rep}'s check-ins · ${pLabel}`} />
                  </div>
                )}
              </section>
            )}
          </div>

          {/* Trend + what's selling */}
          <div className="flex flex-wrap gap-4">
            <CasesByMonth home={home} dist={dist} scope={dist} />
            <section className={`${CARD} flex min-w-0 flex-[1_1_360px] flex-col gap-3`}>
              <div>
                <h2 className="text-[15px] font-semibold text-neutral-100">What&apos;s selling</h2>
                <p className={`text-[12.5px] ${MUTED}`}>Cases by brand · {pLabel} · vs same days last year</p>
              </div>
              {topBrands.map((b) => (
                <div key={b.product} className="flex flex-col gap-1.5">
                  <div className="flex items-center justify-between gap-2.5 text-[13.5px]">
                    <span className="min-w-0 truncate font-medium text-neutral-200">{b.product}</span>
                    <span className="flex items-center gap-2">
                      <span className="font-mono">{fmtN(b.ce)}</span>
                      <Change value={b.chg} />
                    </span>
                  </div>
                  <div className="h-2 overflow-hidden rounded-full bg-neutral-800/70">
                    <div className="h-full rounded-full bg-gradient-to-r from-[#4f9a33] to-[#8fd16f]" style={{ width: `${(b.ce / (topBrands[0]?.ce || 1)) * 100}%` }} />
                  </div>
                </div>
              ))}
              {!topBrands.length && <p className={`text-sm ${MUTED}`}>No sales in this period.</p>}
            </section>
          </div>
        </>
      )}

      {openId && <AccountPopup supabase={supabase} outletId={openId} onClose={() => setOpenId(null)} />}
    </div>
  );
}

// One account's details (reps don't have Sales → Accounts).
function AccountPopup({ supabase, outletId, onClose }: { supabase: ReturnType<typeof createClient>; outletId: string; onClose: () => void }) {
  const [d, setD] = useState<AccountDetail | null>(null);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    supabase.rpc("sales_territory_account", { p_outlet: outletId }).then(({ data, error }) => {
      if (cancelled) return;
      if (error) setErr(error.message);
      else setD(data as AccountDetail);
    });
    return () => {
      cancelled = true;
    };
  }, [supabase, outletId]);

  // Items they buy: total cases in the last 13 months + last bought.
  const items = useMemo(() => {
    const m = new Map<string, { item: string; ce: number; last: string | null }>();
    for (const s of d?.sales ?? []) {
      const key = `${s.product} ${s.size}`.trim();
      const cur = m.get(key) ?? { item: key, ce: 0, last: null };
      cur.ce += Number(s.ce) || 0;
      const lb = s.last_buy ?? s.month;
      if (!cur.last || lb > cur.last) cur.last = lb;
      m.set(key, cur);
    }
    return [...m.values()].sort((a, b) => b.ce - a.ce);
  }, [d]);

  const a = d?.account;
  return (
    <Modal title={a?.name ?? "Account"} sub={a ? [a.address, a.city, a.zip].filter(Boolean).join(", ") : undefined} onClose={onClose}>
      {err && <p className="text-sm text-red-300">{err}</p>}
      {!d && !err && <p className={`text-sm ${MUTED}`}>Loading…</p>}
      {a && (
        <div className="flex flex-col gap-4">
          <div className="flex flex-wrap gap-6">
            <Stat value={fmtDay(a.last_buy)} label="Last order" />
            <Stat value={fmtN(Number(a.ce_12mo) || 0)} label="Cases last 12 months" />
            <Stat value={fmtN(Number(a.lifetime_ce) || 0)} label="Cases all time" />
            {a.phone && (
              <div className="flex flex-col gap-0.5">
                <a href={`tel:${a.phone}`} className="font-mono text-2xl font-light text-[#9edc7f]">
                  {a.phone}
                </a>
                <span className="text-[11px] text-neutral-500">Phone</span>
              </div>
            )}
          </div>
          <div>
            <h3 className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-neutral-500">What they buy · last 13 months</h3>
            {items.length ? (
              <div className="grid grid-cols-[minmax(0,1fr)_auto_auto] gap-x-4 gap-y-1 text-[13px]">
                {items.map((i) => (
                  <span key={i.item} className="contents">
                    <span className="min-w-0 truncate text-neutral-200">{i.item}</span>
                    <span className="text-right font-mono">{fmtN(i.ce)}</span>
                    <span className="text-right text-neutral-500">{fmtDay(i.last)}</span>
                  </span>
                ))}
              </div>
            ) : (
              <p className={`text-sm ${MUTED}`}>No orders in the last 13 months.</p>
            )}
          </div>
          <div>
            <h3 className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-neutral-500">Last check-ins</h3>
            {d.checkins.length ? (
              <div className="flex flex-col">
                {d.checkins.map((c, i) => (
                  <div key={i} className="border-t border-neutral-800/70 py-2 text-[13px] first:border-t-0">
                    <div className="flex flex-wrap gap-2 text-neutral-400">
                      <span className="text-neutral-200">{fmtDay(c.checkin_date)}</span>
                      {c.activity && <span>· {c.activity}</span>}
                      {c.rep && <span>· {c.rep}</span>}
                    </div>
                    {c.notes && <p className="mt-0.5 text-neutral-300">{c.notes}</p>}
                    {c.brands && <p className="text-[12px] text-neutral-500">Sampled: {c.brands}</p>}
                  </div>
                ))}
              </div>
            ) : (
              <p className={`text-sm ${MUTED}`}>No check-ins on record.</p>
            )}
          </div>
        </div>
      )}
    </Modal>
  );
}
