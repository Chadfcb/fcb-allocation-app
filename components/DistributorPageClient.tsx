"use client";

// Distributors → <distributor> (added 2026-10-22, per Chad; was the 10/21 My
// Territory page): one distributor's daily dashboard — first for Steve /
// Matagrano. Each distributor is its own page with its own access checkbox
// (Admin → Users → Edit access → Distributors); no switcher. Plan:
// claude/rep-dashboard-plan.md.
//
// Top to bottom: today's priorities (must-carry gaps, slipping accounts, big
// losses) + the distributor's inventory (on hand, per week, weeks left, and
// when it was last updated — from Ekos, or the uploaded file for Superior) ·
// account search · check-ins (overall, maintenance route progress, accounts
// checked in with notes, route accounts not checked in yet) · follow-ups (win
// backs, new accounts) · at a glance · cases by month · what's selling. Click
// an account → its details in a pop-up. Lists export to Excel.
//
// Live: numbers come from the database on every open, and reload when a
// LilyPad sync finishes (sales_data_meta). Data: sales_dash_home (same as the
// Sales Dashboard home, one distributor), sales_territory_stock,
// sales_territory_checkins, sales_territory_account, and the Action Items gap
// check — sql/distributors.sql.

import { useCallback, useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { useNewFeature } from "@/lib/newFeatures";
import NewBadge from "@/components/NewBadge";
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
import { REP_BY_DISTRIBUTOR } from "@/lib/salesAccounts";
import { FILE_INVENTORY_DISTRIBUTORS, NO_INVENTORY_DISTRIBUTORS } from "@/lib/distributorPages";
import { CARRIED_DAYS, buildStoreReports, resolveLists, splitKey, statusFor, type DashOverview, type GapStore } from "@/lib/salesDashboard";
import { loadGapStores } from "@/lib/salesGapMany";
import { addDaysIso, brands, distColor, fmtDay, fmtN, kpis, pctChange, periodRange, winbacksIn, type DateRange, type HomeData, type Period } from "@/lib/salesDashHome";

interface StockData {
  updated_at: string | null;
  source: string | null; // 'ekos' | 'distributor' (uploaded file / typed in) | 'vip'
  inventory: { product: string; on_hand: number; per_week: number; weeks_left: number | null }[];
}
interface CheckinRow {
  checkin_date: string;
  rep: string | null;
  activity: string | null;
  notes: string | null;
  brands: string | null;
  contact: string | null;
  outlet_id: string;
  name: string;
  city: string | null;
  on_route: boolean;
}
interface RouteAccount {
  outlet_id: string;
  name: string | null;
  city: string | null;
  last_in_period: string | null;
  last_ever: string | null;
  visited: boolean;
}
interface CheckinData {
  from: string;
  to: string;
  total: number;
  accounts: number;
  with_notes: number;
  by_rep: { rep: string; n: number }[];
  checkins: CheckinRow[];
  route_period: { start: string; end: string; today: string };
  routes: { list_id: string; name: string; rep: string; synced_at: string; accounts: RouteAccount[] }[];
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
  checkins: { checkin_date: string; rep: string | null; activity: string | null; notes: string | null; brands: string | null; contact?: string | null }[];
  contacts?: { name: string | null; title: string | null; phone: string | null; mobile: string | null; email: string | null; notes: string | null }[];
}

// "Thu 10/22/26, 4:12 AM" — Pacific time.
function fmtStamp(ts: string): string {
  const tz = "America/Los_Angeles";
  const d = new Date(ts);
  const day = d.toLocaleDateString("en-US", { weekday: "short", month: "numeric", day: "numeric", year: "2-digit", timeZone: tz }).replace(",", "");
  const time = d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", timeZone: tz });
  return `${day}, ${time}`;
}

// First day of a period, counted back from today (Pacific).
function periodStart(p: Exclude<Period, "custom">): string {
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Los_Angeles" }).format(new Date());
  if (p === "ytd") return `${today.slice(0, 4)}-01-01`;
  const back = p === "30" ? 29 : p === "60" ? 59 : 89;
  return new Date(Date.parse(`${today}T12:00:00Z`) - back * 86400000).toISOString().slice(0, 10);
}
const daysBetween = (a: string, b: string) => Math.round((Date.parse(`${b}T12:00:00Z`) - Date.parse(`${a}T12:00:00Z`)) / 86400000);

// ---------------------------------------------------------------------------
// Per-block date buttons (2026-10-22, per Chad: "move the date selector into
// each block, and have each block change with those buttons, instead of one
// button for all" — "30 60 90 year to date custom"). Each block (Check-ins,
// Follow up, At a glance, What's selling) has its own choice, remembered per
// browser per page per block. 30 / 60 / 90 / YTD come with the page's main
// sales load; a custom range in a sales block loads its own numbers.
// ---------------------------------------------------------------------------
type BlockKey = "ck" | "fu" | "gl" | "ws";
interface BlockPeriod {
  period: Period;
  custom: DateRange | null;
}
const DIST_PERIODS: { key: Exclude<Period, "custom">; label: string; long: string }[] = [
  { key: "30", label: "30 days", long: "Last 30 days" },
  { key: "60", label: "60 days", long: "Last 60 days" },
  { key: "90", label: "90 days", long: "Last 90 days" },
  { key: "ytd", label: "Year to date", long: "Year to date" },
];
const DEFAULT_BP: BlockPeriod = { period: "30", custom: null };

function useBlockPeriod(dist: string, block: BlockKey): [BlockPeriod, (bp: BlockPeriod) => void] {
  const key = `fcb-dist-period-${dist}-${block}`;
  const [bp, setBp] = useState<BlockPeriod>(DEFAULT_BP);
  useEffect(() => {
    try {
      const s = JSON.parse(localStorage.getItem(key) ?? "{}") as Partial<BlockPeriod>;
      if (s.period === "custom" && s.custom?.from && s.custom?.to) {
        // eslint-disable-next-line react-hooks/set-state-in-effect -- restore the remembered choice
        setBp({ period: "custom", custom: s.custom });
      } else if (s.period && DIST_PERIODS.some((p) => p.key === s.period)) setBp({ period: s.period, custom: null });
    } catch {
      // ignore
    }
  }, [key]);
  const set = (next: BlockPeriod) => {
    setBp(next);
    try {
      localStorage.setItem(key, JSON.stringify(next));
    } catch {
      // ignore
    }
  };
  return [bp, set];
}

function periodLabel(bp: BlockPeriod): string {
  if (bp.period === "custom" && bp.custom) return `${fmtDay(bp.custom.from)} – ${fmtDay(bp.custom.to)}`;
  return DIST_PERIODS.find((p) => p.key === bp.period)?.long ?? "Last 30 days";
}

// Sales numbers for a block's custom range (null while loading / not custom).
// Blocks asking for the same range at the same moment share one request.
const customHomeInFlight = new Map<string, Promise<HomeData | null>>();
function useCustomHome(supabase: ReturnType<typeof createClient>, dist: string, bp: BlockPeriod, version: number): HomeData | null {
  const [state, setState] = useState<{ key: string; data: HomeData | null } | null>(null);
  const c = bp.period === "custom" ? bp.custom : null;
  const key = c ? `${dist}|${c.from}|${c.to}|${version}` : "";
  useEffect(() => {
    if (!key || !c) return;
    let cancelled = false;
    let req = customHomeInFlight.get(key);
    if (!req) {
      req = Promise.resolve(supabase.rpc("sales_dash_home", { p_current: [dist], p_big: 0, p_from: c.from, p_to: c.to })).then(
        ({ data, error }) => (error ? null : (data as HomeData)),
        () => null,
      );
      customHomeInFlight.set(key, req);
      void req.then(() => setTimeout(() => customHomeInFlight.delete(key), 10_000));
    }
    void req.then((data) => {
      if (!cancelled) setState({ key, data });
    });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- key covers dist + range + version
  }, [supabase, key]);
  return state && state.key === key ? state.data : null;
}

// The buttons drawn in each block's header.
function PeriodPicker({ value, onChange, asOf, salesNote }: { value: BlockPeriod; onChange: (bp: BlockPeriod) => void; asOf: string | null; salesNote?: boolean }) {
  const [showCustom, setShowCustom] = useState(false);
  const [draft, setDraft] = useState<DateRange>(value.custom ?? { from: "", to: "" });
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {DIST_PERIODS.map((p) => (
        <Pill
          key={p.key}
          on={value.period === p.key && !showCustom}
          onClick={() => {
            setShowCustom(false);
            onChange({ period: p.key, custom: null });
          }}
        >
          {p.label}
        </Pill>
      ))}
      <Pill
        on={value.period === "custom" || showCustom}
        onClick={() => {
          if (!showCustom && !draft.from) {
            const to = asOf ?? "";
            setDraft({ from: to ? addDaysIso(to, -29) : "", to });
          }
          setShowCustom(!showCustom);
        }}
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <rect x="3" y="4" width="18" height="18" rx="2" />
          <path d="M16 2v4M8 2v4M3 10h18" />
        </svg>
        {value.period === "custom" && value.custom ? `${fmtDay(value.custom.from)} – ${fmtDay(value.custom.to)}` : "Custom dates"}
      </Pill>
      {showCustom && (
        <form
          className="flex basis-full flex-wrap items-center gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            if (!draft.from || !draft.to) return;
            const r = draft.from <= draft.to ? draft : { from: draft.to, to: draft.from };
            setDraft(r);
            setShowCustom(false);
            onChange({ period: "custom", custom: r });
          }}
        >
          <label className={`flex items-center gap-1.5 text-[13px] ${MUTED}`}>
            From
            <input
              type="date"
              value={draft.from}
              onChange={(e) => setDraft({ ...draft, from: e.target.value })}
              className="min-h-9 rounded-full border border-neutral-700 bg-neutral-950 px-3 text-[13px] text-neutral-100 [color-scheme:dark]"
            />
          </label>
          <label className={`flex items-center gap-1.5 text-[13px] ${MUTED}`}>
            To
            <input
              type="date"
              value={draft.to}
              onChange={(e) => setDraft({ ...draft, to: e.target.value })}
              className="min-h-9 rounded-full border border-neutral-700 bg-neutral-950 px-3 text-[13px] text-neutral-100 [color-scheme:dark]"
            />
          </label>
          <button
            type="submit"
            disabled={!draft.from || !draft.to}
            className="inline-flex min-h-9 items-center rounded-full border border-[#6abc46]/45 bg-[#6abc46]/15 px-3.5 text-[13px] font-semibold text-neutral-50 hover:bg-[#6abc46]/25 disabled:opacity-50"
          >
            Apply
          </button>
        </form>
      )}
      {salesNote && value.period === "custom" && value.custom && asOf && value.custom.to > asOf && (
        <span className="basis-full text-[11.5px] text-neutral-500">Sales numbers go through {fmtDay(asOf)} (latest sales in LilyPad).</span>
      )}
    </div>
  );
}

export default function DistributorPageClient({ dist, viewerName }: { dist: string; viewerName: string | null }) {
  const supabase = useMemo(() => createClient(), []);
  // Each block's own date buttons (2026-10-22).
  const [ckP, setCkP] = useBlockPeriod(dist, "ck");
  const [fuP, setFuP] = useBlockPeriod(dist, "fu");
  const [glP, setGlP] = useBlockPeriod(dist, "gl");
  const [wsP, setWsP] = useBlockPeriod(dist, "ws");
  const [ov, setOv] = useState<DashOverview | null>(null);
  const [home, setHome] = useState<HomeData | null>(null);
  const [stock, setStock] = useState<StockData | null>(null);
  // outlet_id → "On" / "Off" premise (2026-10-22, per Chad).
  const [premise, setPremise] = useState<Record<string, string>>({});
  const [checkedAt, setCheckedAt] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [version, setVersion] = useState(0);
  const [att, setAtt] = useState<"gaps" | "slip" | "lost">("gaps");
  const [follow, setFollow] = useState<"won" | "new">("won");
  const [openId, setOpenId] = useState<string | null>(null);
  // Chain list pop-ups (2026-10-22, per Chad): All Chain Mandates / Chain Authorizations.
  const [chainList, setChainList] = useState<"mandate" | "flex" | null>(null);
  const chainListsNew = useNewFeature(`feature:dist-chain-lists-${dist.toLowerCase().trim().replace(/\s+/g, "-")}`);
  const [busy, setBusy] = useState<string | null>(null);

  const [checkins, setCheckins] = useState<CheckinData | null>(null);
  const [ckTab, setCkTab] = useState<"in" | "not">("in");

  const load = useCallback(async () => {
    // p_big 0: Must win back lists EVERY account lost in the last year (Chad,
    // 2026-10-22: "90+ day lost, all accounts"), not just 50+ case ones.
    const [h, s, o, m, pr] = await Promise.all([
      supabase.rpc("sales_dash_home", { p_current: [dist], p_big: 0, p_from: null, p_to: null }),
      supabase.rpc("sales_territory_stock", { p_dist: dist }),
      supabase.rpc("sales_dash_overview"),
      supabase.from("sales_data_meta").select("imported_at").eq("id", 1).maybeSingle(),
      supabase.rpc("sales_territory_premise", { p_dist: dist }),
    ]);
    const e = h.error ?? s.error ?? o.error;
    if (e) {
      setErr(e.message);
      return;
    }
    setErr(null);
    setHome(h.data as HomeData);
    setStock(s.data as StockData);
    setPremise(((pr.data as Record<string, string> | null) ?? {}));
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
      .channel(`distributor-${dist}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "sales_data_meta" }, () => {
        if (t) clearTimeout(t);
        t = setTimeout(() => load(), 800);
      })
      .subscribe();
    return () => {
      if (t) clearTimeout(t);
      supabase.removeChannel(ch);
    };
  }, [supabase, load, dist]);

  // Check-ins follow their own block's buttons (counted back from today).
  const loadCheckins = useCallback(async () => {
    if (ckP.period === "custom" && !ckP.custom) return;
    const args =
      ckP.period === "custom" && ckP.custom
        ? { p_dist: dist, p_from: ckP.custom.from, p_to: ckP.custom.to }
        : { p_dist: dist, p_from: periodStart(ckP.period as Exclude<Period, "custom">), p_to: null };
    const { data, error } = await supabase.rpc("sales_territory_checkins", args);
    if (error) setErr(error.message);
    else setCheckins(data as CheckinData);
  }, [supabase, dist, ckP]);
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- load from the database
    loadCheckins();
  }, [loadCheckins, version]);

  const resolved = useMemo(() => (ov ? resolveLists(ov) : null), [ov]);
  const actions = useActionItems(supabase, ov, resolved, version, dist);

  const rep = REP_BY_DISTRIBUTOR[dist] ?? null;
  const hello = viewerName?.split(/\s+/)[0] ?? null;
  const gaps = (actions.rows ?? []).filter((r) => r.store.distributor === dist).sort((a, b) => b.impact - a.impact);
  const attention = (home?.attention ?? []).filter((a) => a.dist === dist);
  const slip = attention.filter((a) => a.stage === "plost");
  const lost = attention.filter((a) => a.stage === "lost");
  // Each sales block: its own period; a custom range uses its own loaded
  // numbers (null = still loading → the block says "Loading these dates…").
  const fuCustom = useCustomHome(supabase, dist, fuP, version);
  const glCustom = useCustomHome(supabase, dist, glP, version);
  const wsCustom = useCustomHome(supabase, dist, wsP, version);
  const homeFor = (bp: BlockPeriod, c: HomeData | null) => (bp.period === "custom" ? (c?.as_of ? c : null) : home?.as_of ? home : null);
  const fuHome = homeFor(fuP, fuCustom);
  const glHome = homeFor(glP, glCustom);
  const wsHome = homeFor(wsP, wsCustom);
  const ckLabel = periodLabel(ckP);
  const fuLabel = periodLabel(fuP);
  const glLabel = periodLabel(glP);
  const wsLabel = periodLabel(wsP);
  const k = glHome ? kpis(glHome, glP.period, dist) : null;
  const wins = fuHome ? winbacksIn(fuHome, fuP.period, dist) : [];
  // New accounts whose first order falls in Follow up's period.
  const fuRange = fuHome ? periodRange(fuHome, fuP.period) : null;
  const newAccts = (((fuHome as (HomeData & { new_accounts?: NewAccount[] }) | null)?.new_accounts ?? []) as NewAccount[]).filter(
    (a) => a.dist === dist && (!fuRange || (a.fb >= fuRange.from && a.fb <= fuRange.to)),
  );
  const topBrands = wsHome ? brands(wsHome, wsP.period, dist, 999) : [];
  const myCheckins =
    glHome?.checkins && rep
      ? glHome.checkins.filter((c) => c.p === glP.period && (c.rep ?? "").trim().toLowerCase().split(/\s+/)[0] === rep.toLowerCase()).reduce((t, c) => t + (Number(c.n) || 0), 0)
      : null;

  const low = (stock?.inventory ?? []).filter((i) => i.per_week > 0 && (i.on_hand <= 0 || (i.weeks_left ?? 99) < 2));

  const ATT = {
    gaps: { label: "Must-carry gaps", desc: "Chain stores not buying a must-carry item", count: actions.rows ? gaps.length : null, rule: "Stores not buying an item their chain says they must carry. Biggest first." },
    slip: { label: "Slipping now", desc: "61–90 day non-buy, all accounts", count: slip.length, rule: "61–90 days since their last order — still saveable. Biggest 12-month buyers first." },
    lost: { label: "Must win back", desc: "90+ day lost, all accounts", count: lost.length, rule: "Lost in the last year (90+ days quiet). Biggest 12-month buyers first." },
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
      if (follow === "won") await exportSheets(`${dist} - win backs - ${fuLabel} - ${home?.as_of}.xlsx`, [{ name: "Win backs", title: `${dist} — win backs — ${fuLabel}`, cols: COLS_WB, rows: wbRows(wins) }]);
      else
        await exportSheets(`${dist} - new accounts - ${fuLabel} - ${home?.as_of}.xlsx`, [
          {
            name: "New accounts",
            title: `${dist} — new accounts — ${fuLabel}`,
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
  const stockLine = !stock?.updated_at
    ? NO_INVENTORY_DISTRIBUTORS.includes(dist)
      ? `${dist} doesn't report inventory yet`
      : FILE_INVENTORY_DISTRIBUTORS.includes(dist)
        ? "No inventory file uploaded yet"
        : "No inventory report for this distributor yet"
    : `${stock.source === "ekos" ? "Updated from Ekos" : "Imported from file"}: ${fmtStamp(stock.updated_at)}`;

  const exportStock = async () => {
    setBusy("stock");
    try {
      await exportSheets(`${dist} - inventory.xlsx`, [
        {
          name: "Inventory",
          title: `${dist} inventory — ${stockLine}`,
          cols: [
            { header: "Product", key: "product", width: 44 },
            { header: "On hand", key: "on_hand" },
            { header: "Sells per week", key: "per_week" },
            { header: "Weeks on hand", key: "weeks_left" },
          ],
          rows: (stock?.inventory ?? []).map((i) => ({ ...i, weeks_left: i.weeks_left ?? "" })),
        },
      ]);
    } finally {
      setBusy(null);
    }
  };

  // Check-ins block
  const rp = checkins?.route_period ?? null;
  const routes = checkins?.routes ?? [];
  const notVisited = routes.flatMap((r) => r.accounts.filter((a) => !a.visited).map((a) => ({ ...a, rep: r.rep })));
  const exportCheckins = async () => {
    if (!checkins) return;
    setBusy("ck");
    try {
      const sheets: Parameters<typeof exportSheets>[1] = [
        {
          name: "Check-ins",
          title: `${dist} check-ins — ${ckLabel} (${fmtDay(checkins.from)} – ${fmtDay(checkins.to)})`,
          cols: [
            { header: "Date", key: "date", width: 11 },
            { header: "Account", key: "name", width: 32 },
            { header: "City", key: "city" },
            { header: "Rep", key: "rep" },
            { header: "Activity", key: "activity", width: 18 },
            { header: "On route", key: "route", width: 9 },
            { header: "Notes", key: "notes", width: 60 },
            { header: "Brands sampled", key: "brands", width: 30 },
          ],
          rows: checkins.checkins.map((c) => ({
            date: fmtDay(c.checkin_date),
            name: c.name,
            city: c.city ?? "",
            rep: c.rep ?? "",
            activity: c.activity ?? "",
            route: c.on_route ? "Yes" : "",
            notes: c.notes ?? "",
            brands: c.brands ?? "",
          })),
        },
      ];
      for (const r of routes) {
        sheets.push({
          name: `Route - ${r.rep.split(" ")[0]}`.slice(0, 31),
          title: `${r.name} — ${r.rep} — ${fmtDay(rp?.start)} – ${fmtDay(rp?.end)}`,
          cols: [
            { header: "Account", key: "name", width: 32 },
            { header: "City", key: "city" },
            { header: "Checked in this period", key: "visited", width: 12 },
            { header: "Last check-in this period", key: "last", width: 14 },
            { header: "Last check-in ever", key: "ever", width: 14 },
          ],
          rows: r.accounts.map((a) => ({
            name: a.name ?? a.outlet_id,
            city: a.city ?? "",
            visited: a.visited ? "Yes" : "No",
            last: fmtDay(a.last_in_period),
            ever: a.last_ever ? fmtDay(a.last_ever) : "Never",
          })),
        });
      }
      await exportSheets(`${dist} - check-ins - ${ckLabel}.xlsx`, sheets);
    } finally {
      setBusy(null);
    }
  };

  const prem = (id: string) => (premise[id] === "On" ? "On-premise · " : premise[id] === "Off" ? "Off-premise · " : "");
  const gapRowsView = gaps.map((r: ActionRow) => (
    <Row
      key={r.store.outlet_id}
      left={<Dot color="#ef6a55" />}
      title={`${r.store.name}${r.store.city ? ` · ${r.store.city}` : ""}`}
      sub={`${prem(r.store.outlet_id)}Not buying ${r.missing.map((m) => `${m.product} ${m.size}`).join(", ")} (${r.chain} must-carry)`}
      value={fmtN(r.impact)}
      valueLabel="cases / yr at stake"
      onClick={() => setOpenId(r.store.outlet_id)}
    />
  ));
  const acctRowsView = (att === "slip" ? slip : lost).map((a) => (
    <Row
      key={a.outlet_id}
      left={<Dot color={att === "slip" ? "#f0a63c" : "#ef6a55"} />}
      title={`${a.name}${a.city ? ` · ${a.city}` : ""}`}
      sub={`${prem(a.outlet_id)}${a.dark} days since the last order (${fmtDay(a.lb)})${a.checkin ? ` · last check-in ${fmtDay(a.checkin.date)}` : " · no check-in on record"}`}
      value={fmtN(a.ce12)}
      valueLabel="cases last 12 mo"
      onClick={() => setOpenId(a.outlet_id)}
    />
  ));

  return (
    <div className="flex flex-col gap-5 p-6">
      <div className="flex flex-wrap items-end gap-x-12 gap-y-3">
        <div className="flex flex-col gap-1.5">
          <h1 className="flex items-center gap-2.5 text-2xl font-bold text-neutral-100">
            <Dot color={distColor(dist)} glow />
            {dist}
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
        {/* All Chain Mandates / Chain Authorizations (2026-10-22, per Chad — spots
            marked on his screenshot: right of the greeting line). */}
        <div className="flex flex-wrap items-center gap-2.5">
          {(["mandate", "flex"] as const).map((k) => (
            <button
              key={k}
              type="button"
              onClick={() => {
                setChainList(k);
                chainListsNew.dismiss();
              }}
              className="flex items-center gap-1.5 rounded-lg border border-[#6abc46]/40 bg-[#6abc46]/10 px-3.5 py-2 text-sm font-semibold text-neutral-100 hover:bg-[#6abc46]/20"
            >
              {k === "mandate" ? "All Chain Mandates" : "Chain Authorizations"}
              {k === "mandate" && chainListsNew.isNew && <NewBadge inline />}
            </button>
          ))}
        </div>
      </div>

      {err && <p className="rounded-md border border-red-500/40 bg-red-500/10 px-3 py-2 text-sm text-red-300">{err}</p>}
      {!home && !err && <p className={`text-sm ${MUTED}`}>Loading…</p>}
      {home?.as_of && !(home.cases ?? []).some((c) => c.dist === dist && Number(c.ce) > 0) && (
        <p className="rounded-md border border-neutral-700 bg-neutral-900 px-3 py-2 text-[13px] text-neutral-300">
          No sales for {dist} in LilyPad yet — sales, accounts at risk and must-carry gaps fill in here once {dist}&apos;s sales show up in LilyPad.
        </p>
      )}

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
                    <span className="flex flex-col items-start py-1 leading-tight">
                      <span>
                        {ATT[key].label} <span className="font-mono opacity-80">{ATT[key].count ?? "…"}</span>
                      </span>
                      <span className="text-[10.5px] font-normal opacity-70">{ATT[key].desc}</span>
                    </span>
                  </Pill>
                ))}
              </div>
              <p className="text-xs text-neutral-500">{ATT[att].rule}</p>
              <div className="flex max-h-[380px] flex-col overflow-y-auto pr-1">
                {att === "gaps" && !actions.rows ? (
                  <p className={`py-4 text-sm ${MUTED}`}>Checking chain stores…</p>
                ) : (att === "gaps" ? gapRowsView : acctRowsView).length ? (
                  att === "gaps" ? gapRowsView : acctRowsView
                ) : (
                  <p className={`py-4 text-sm ${MUTED}`}>Nothing here right now.</p>
                )}
              </div>
            </section>

            <section className={`${CARD} flex min-w-0 flex-[1_1_420px] flex-col gap-3`}>
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <h2 className="text-[15px] font-semibold text-neutral-100">Stock at {dist}</h2>
                  <p className={`text-[12.5px] ${MUTED}`}>Their inventory · {stockLine}</p>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  {FILE_INVENTORY_DISTRIBUTORS.includes(dist) && <UploadInventory dist={dist} onDone={load} />}
                  <ExportButton onClick={exportStock} busy={busy === "stock"} />
                </div>
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
                  <span className="text-right text-[11px] text-neutral-500">Weeks on hand</span>
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
              {!(stock?.inventory ?? []).length && <p className={`text-[13px] ${MUTED}`}>Nothing to show yet.</p>}
            </section>
          </div>

          {/* Account search (the shared date buttons that sat here moved into
              each block, 2026-10-22). */}
          <div className="w-full">
            <AccountSearch supabase={supabase} dist={dist} onPick={(id) => setOpenId(id)} />
          </div>

          {/* Check-ins (2026-10-22): overall + maintenance route */}
          <section className={`${CARD} flex min-w-0 flex-col gap-4`}>
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <h2 className="text-[15px] font-semibold text-neutral-100">Check-ins</h2>
                <p className={`text-[12.5px] ${MUTED}`}>
                  {ckLabel}
                  {checkins ? ` · ${fmtDay(checkins.from)} – ${fmtDay(checkins.to)}` : ""} · visits, calls and emails logged in LilyPad at {dist} accounts
                </p>
              </div>
              <ExportButton onClick={exportCheckins} busy={busy === "ck"} />
            </div>
            <PeriodPicker value={ckP} onChange={setCkP} asOf={home.as_of ?? null} />
            {!checkins ? (
              <p className={`text-sm ${MUTED}`}>Loading…</p>
            ) : (
              <>
                <div className="flex flex-wrap gap-x-8 gap-y-3">
                  <Stat value={fmtN(checkins.total)} label="Total check-ins" />
                  <div className="flex flex-col gap-0.5">
                    <span className="font-mono text-2xl font-light text-[#f2f7f0]">{fmtN(checkins.accounts)}</span>
                    <span className="text-[11px] text-neutral-500">Unique accounts</span>
                    {checkins.total > checkins.accounts && (
                      <span className="text-[11px] text-neutral-500">
                        {fmtN(checkins.total - checkins.accounts)} were repeat check-ins at the same accounts
                      </span>
                    )}
                  </div>
                  <Stat value={fmtN(checkins.with_notes)} label="With notes" />
                  {checkins.by_rep.slice(0, 4).map((r) => (
                    <Stat key={r.rep} value={fmtN(r.n)} label={r.rep} color="#9edc7f" />
                  ))}
                </div>

                {rp && routes.length > 0 ? (
                  routes.map((r) => {
                    const total = r.accounts.length;
                    const done = r.accounts.filter((a) => a.visited).length;
                    const pct = total ? Math.round((done / total) * 100) : 0;
                    const left = Math.max(0, daysBetween(rp.today, rp.end));
                    return (
                      <div key={r.list_id} className="flex flex-col gap-2 rounded-xl border border-neutral-800 p-3.5">
                        <div className="flex flex-wrap items-baseline justify-between gap-2">
                          <span className="text-[13.5px] font-semibold text-neutral-100">
                            Maintenance route · {r.rep}
                            <span className="ml-2 font-normal text-neutral-500">
                              {fmtDay(rp.start)} – {fmtDay(rp.end)}
                            </span>
                          </span>
                          <span className="font-mono text-[13.5px] text-neutral-200">
                            {done} of {total} · {pct}% · {left} days left
                          </span>
                        </div>
                        <div className="h-2.5 overflow-hidden rounded-full bg-neutral-800/70">
                          <div className="h-full rounded-full bg-gradient-to-r from-[#4f9a33] to-[#8fd16f]" style={{ width: `${pct}%` }} />
                        </div>
                        <p className="text-[11.5px] text-neutral-500">
                          Every account on the route needs a visit, call or email/text at least once every two months. This period resets on {fmtDay(new Date(Date.parse(`${rp.end}T12:00:00Z`) + 86400000).toISOString().slice(0, 10))}.
                        </p>
                      </div>
                    );
                  })
                ) : (
                  <p className="text-[12.5px] text-neutral-500">No maintenance route for {dist}.</p>
                )}

                <div className="flex flex-wrap gap-2">
                  <Pill on={ckTab === "in"} onClick={() => setCkTab("in")}>
                    Checked in · {ckLabel} <span className="font-mono opacity-80">{checkins.checkins.length}</span>
                  </Pill>
                  {routes.length > 0 && (
                    <Pill on={ckTab === "not"} onClick={() => setCkTab("not")}>
                      Route — not checked in yet <span className="font-mono opacity-80">{notVisited.length}</span>
                    </Pill>
                  )}
                </div>

                <div className="max-h-[460px] overflow-y-auto">
                  {ckTab === "in" || !routes.length ? (
                    checkins.checkins.length ? (
                      checkins.checkins.map((c, i) => (
                        <button
                          key={`${c.outlet_id}-${c.checkin_date}-${i}`}
                          type="button"
                          onClick={() => setOpenId(c.outlet_id)}
                          className="flex w-full flex-col gap-0.5 border-t border-neutral-800/70 py-2.5 text-left first:border-t-0 hover:bg-neutral-900/50"
                        >
                          <span className="flex flex-wrap items-center gap-2 text-[13.5px]">
                            <span className="font-semibold text-neutral-100">
                              {c.name}
                              {c.city ? ` · ${c.city}` : ""}
                            </span>
                            {c.on_route && <span className="rounded-full bg-[#6abc46]/15 px-2 py-0.5 text-[10.5px] font-semibold text-[#9edc7f]">Route</span>}
                          </span>
                          <span className="text-[12px] text-neutral-400">
                            {fmtWeekdayDay(c.checkin_date)}
                            {c.activity ? ` · ${c.activity}` : ""}
                            {c.rep ? ` · ${c.rep}` : ""}
                            {c.contact ? ` · spoke with ${c.contact}` : ""}
                          </span>
                          {c.notes ? <span className="text-[13px] text-neutral-300">{c.notes}</span> : <span className="text-[12px] text-neutral-600">No notes</span>}
                          {c.brands && <span className="text-[12px] text-neutral-500">Sampled: {c.brands}</span>}
                        </button>
                      ))
                    ) : (
                      <p className={`py-4 text-sm ${MUTED}`}>No check-ins in this period.</p>
                    )
                  ) : notVisited.length ? (
                    notVisited.map((a) => (
                      <Row
                        key={a.outlet_id}
                        left={<Dot color="#f0a63c" />}
                        title={`${a.name ?? a.outlet_id}${a.city ? ` · ${a.city}` : ""}`}
                        sub={a.last_ever ? `Last check-in ${fmtDay(a.last_ever)}` : "No check-in on record"}
                        value={a.last_ever ? String(daysBetween(a.last_ever, rp?.today ?? a.last_ever)) : "—"}
                        valueLabel="days since"
                        onClick={() => setOpenId(a.outlet_id)}
                      />
                    ))
                  ) : (
                    <p className={`py-4 text-sm ${MUTED}`}>Every route account has been checked in this period.</p>
                  )}
                </div>
              </>
            )}
          </section>

          <div className="flex flex-wrap gap-4">
            <section className={`${CARD} flex min-w-0 flex-[1_1_560px] flex-col gap-3`}>
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <h2 className="text-[15px] font-semibold text-neutral-100">Follow up</h2>
                  <p className={`text-[12.5px] ${MUTED}`}>{fuLabel} · accounts that came back or just started — keep them buying</p>
                </div>
                <ExportButton onClick={exportFollow} busy={busy === "follow"} />
              </div>
              <PeriodPicker value={fuP} onChange={setFuP} asOf={home.as_of ?? null} salesNote />
              <div className="flex flex-wrap gap-2">
                <Pill on={follow === "won"} onClick={() => setFollow("won")}>
                  Won back <span className="font-mono opacity-80">{wins.length}</span>
                </Pill>
                <Pill on={follow === "new"} onClick={() => setFollow("new")}>
                  New accounts <span className="font-mono opacity-80">{newAccts.length}</span>
                </Pill>
              </div>
              <div className="flex max-h-[380px] flex-col overflow-y-auto pr-1">
                {follow === "won"
                  ? wins.map((w) => (
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
                  : newAccts.map((a) => (
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
                {!fuHome ? (
                  <p className={`py-4 text-sm ${MUTED}`}>Loading these dates…</p>
                ) : (
                  (follow === "won" ? wins.length : newAccts.length) === 0 && <p className={`py-4 text-sm ${MUTED}`}>None in this period.</p>
                )}
              </div>
            </section>

            <section className={`${CARD} flex min-w-0 flex-[1_1_420px] flex-col gap-4`}>
                <div className="flex flex-col gap-3">
                  <div>
                    <h2 className="text-[15px] font-semibold text-neutral-100">{dist} at a glance</h2>
                    <p className={`text-[12.5px] ${MUTED}`}>{glLabel} · vs the same days last year</p>
                  </div>
                  <PeriodPicker value={glP} onChange={setGlP} asOf={home.as_of ?? null} salesNote />
                </div>
                {!k ? (
                  <p className={`text-sm ${MUTED}`}>Loading these dates…</p>
                ) : (
                <>
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
                    <Stat value={myCheckins === null ? "—" : fmtN(myCheckins)} label={`${rep}'s check-ins · ${glLabel}`} />
                  </div>
                )}
                </>
                )}
              </section>
          </div>

          {/* Trend + what's selling */}
          <div className="flex flex-wrap gap-4">
            <CasesByMonth home={home} dist={dist} scope={dist} />
            <section className={`${CARD} flex min-w-0 flex-[1_1_360px] flex-col gap-3`}>
              <div>
                <h2 className="text-[15px] font-semibold text-neutral-100">What&apos;s selling</h2>
                <p className={`text-[12.5px] ${MUTED}`}>Cases by brand · {wsLabel} · vs same days last year</p>
              </div>
              <PeriodPicker value={wsP} onChange={setWsP} asOf={home.as_of ?? null} salesNote />
              <div className="flex max-h-[380px] flex-col gap-3 overflow-y-auto pr-1">
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
              </div>
              {!wsHome ? (
                <p className={`text-sm ${MUTED}`}>Loading these dates…</p>
              ) : (
                !topBrands.length && <p className={`text-sm ${MUTED}`}>No sales in this period.</p>
              )}
            </section>
          </div>
        </>
      )}

      {chainList && (
        <ChainListPopup
          supabase={supabase}
          dist={dist}
          kind={chainList}
          ov={ov}
          resolved={resolved}
          premise={premise}
          onOpen={(id) => setOpenId(id)}
          onClose={() => setChainList(null)}
        />
      )}
      {openId && <AccountPopup supabase={supabase} outletId={openId} onClose={() => setOpenId(null)} />}
    </div>
  );
}

// One account's details (reps don't have Sales → Accounts).
// All Chain Mandates / Chain Authorizations (2026-10-22, per Chad): every one
// of this distributor's chain stores that has items on that kind of list
// (Mandate = Chain Mandates must-carry, Flex = Chain Authorizations), how many
// it's buying (last 90 days — the Gap Report rule) and which are missing.
// Same rules and numbers as the Gap Report / Chain coverage; one database call
// for all chains (lib/salesGapMany.ts), limited to this distributor.
interface ChainListLine {
  product: string;
  size: string;
  buying: boolean;
  lastBuy: string | null;
  ce90: number;
  ce12: number;
}
interface ChainListRow {
  chain: string;
  store: GapStore;
  lines: ChainListLine[];
  buying: number;
}

function ChainListPopup({
  supabase,
  dist,
  kind,
  ov,
  resolved,
  premise,
  onOpen,
  onClose,
}: {
  supabase: ReturnType<typeof createClient>;
  dist: string;
  kind: "mandate" | "flex";
  ov: DashOverview | null;
  resolved: ReturnType<typeof resolveLists> | null;
  premise: Record<string, string>;
  onOpen: (outletId: string) => void;
  onClose: () => void;
}) {
  const title = kind === "mandate" ? "All Chain Mandates" : "Chain Authorizations";
  const what = kind === "mandate" ? "must-carry (Chain Mandates)" : "authorized (Chain Authorizations)";
  const [rows, setRows] = useState<ChainListRow[] | null>(null);
  const [asOf, setAsOf] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!ov || !resolved) return;
    let cancelled = false;
    (async () => {
      const ours = new Set(ov.chains.map((c) => c.chain));
      const chains = [...resolved.rules.keys()].filter((c) => ours.has(c)).sort();
      const all = chains.length ? await loadGapStores(supabase, chains, dist) : {};
      if (cancelled) return;
      const out: ChainListRow[] = [];
      let as: string | null = null;
      for (const chain of chains) {
        const { data, error } = all[chain] ?? { data: null, error: null };
        if (error) {
          setErr(error);
          setRows([]);
          return;
        }
        if (!data) continue;
        as = data.as_of;
        const rules = resolved.rules.get(chain);
        if (!rules) continue;
        const keys = new Set<string>([...rules.mandate.keys(), ...rules.flex, ...rules.picked.keys()]);
        for (const r of buildStoreReports(data, rules)) {
          const byKey = new Map([...r.carried, ...r.gaps].map((l) => [l.key, l]));
          const lines: ChainListLine[] = [];
          for (const k of keys) {
            if (statusFor(rules, k, r.store.store_no) !== kind) continue;
            const l = byKey.get(k);
            const { product, size } = splitKey(k);
            lines.push({ product, size, buying: !!l?.carried, lastBuy: l?.lastBuy ?? null, ce90: l?.ce90 ?? 0, ce12: l?.ce12 ?? 0 });
          }
          if (!lines.length) continue;
          lines.sort((a, b) => Number(a.buying) - Number(b.buying) || a.product.localeCompare(b.product));
          out.push({ chain, store: r.store, lines, buying: lines.filter((l) => l.buying).length });
        }
      }
      out.sort((a, b) => b.lines.length - b.buying - (a.lines.length - a.buying) || a.store.name.localeCompare(b.store.name));
      setErr(null);
      setAsOf(as);
      setRows(out);
    })();
    return () => {
      cancelled = true;
    };
  }, [supabase, dist, kind, ov, resolved]);

  const prem = (id: string) => (premise[id] === "On" ? "On-premise" : premise[id] === "Off" ? "Off-premise" : "");
  const totalItems = (rows ?? []).reduce((t, r) => t + r.lines.length, 0);
  const totalBuying = (rows ?? []).reduce((t, r) => t + r.buying, 0);

  const doExport = async () => {
    if (!rows) return;
    setBusy(true);
    try {
      await exportSheets(`${dist} - ${title} - ${asOf ?? ""}.xlsx`, [
        {
          name: title,
          title: `${dist} — ${title} (buying = bought in the last ${CARRIED_DAYS} days${asOf ? `, sales through ${asOf}` : ""})`,
          cols: [
            { header: "Chain", key: "chain", width: 18 },
            { header: "Store", key: "store", width: 32 },
            { header: "City", key: "city", width: 18 },
            { header: "Premise", key: "premise", width: 12 },
            { header: "Item", key: "item", width: 34 },
            { header: "Status", key: "status", width: 10 },
            { header: "Last buy", key: "last_buy", width: 12 },
            { header: "Cases last 90 days", key: "ce90" },
            { header: "Cases last 12 months", key: "ce12" },
          ],
          rows: rows.flatMap((r) =>
            r.lines.map((l) => ({
              chain: r.chain,
              store: r.store.name,
              city: r.store.city ?? "",
              premise: prem(r.store.outlet_id),
              item: `${l.product} ${l.size}`.trim(),
              status: l.buying ? "Buying" : "Missing",
              last_buy: l.lastBuy ?? "",
              ce90: l.ce90,
              ce12: l.ce12,
            })),
          ),
        },
      ]);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      title={`${title} · ${dist}`}
      sub={`${dist} chain stores with ${what} items — buying = bought in the last ${CARRIED_DAYS} days. Click a store for its details.`}
      onClose={onClose}
      actions={rows && rows.length > 0 ? <ExportButton onClick={doExport} busy={busy} /> : undefined}
    >
      {err ? (
        <p className="rounded-md border border-red-500/40 bg-red-500/10 px-3 py-2 text-sm text-red-300">{err}</p>
      ) : !rows ? (
        <p className={`py-4 text-sm ${MUTED}`}>Checking chain stores…</p>
      ) : rows.length === 0 ? (
        <p className={`py-4 text-sm ${MUTED}`}>No {dist} chain stores have {what} items.</p>
      ) : (
        <div className="flex flex-col gap-2">
          <p className="text-[13px] text-neutral-300">
            {rows.length} {rows.length === 1 ? "store" : "stores"} · buying {totalBuying} of {totalItems} listed items · missing {totalItems - totalBuying}
          </p>
          <div className="flex max-h-[60vh] flex-col divide-y divide-neutral-900 overflow-y-auto rounded-lg border border-neutral-800">
            {rows.map((r) => {
              const missing = r.lines.filter((l) => !l.buying);
              return (
                <button
                  key={`${r.chain}|${r.store.outlet_id}`}
                  type="button"
                  onClick={() => onOpen(r.store.outlet_id)}
                  className="flex w-full items-start justify-between gap-3 px-3 py-2.5 text-left hover:bg-neutral-900"
                >
                  <span className="flex min-w-0 flex-col gap-0.5">
                    <span className="text-sm text-neutral-100">
                      {r.store.name}
                      {r.store.city ? <span className={MUTED}> · {r.store.city}</span> : null}
                    </span>
                    <span className={`text-[12px] ${MUTED}`}>
                      {[r.chain, prem(r.store.outlet_id)].filter(Boolean).join(" · ")}
                      {missing.length ? (
                        <>
                          {" · "}
                          <span className="text-[#ffab9c]">Missing: {missing.map((l) => `${l.product} ${l.size}`.trim()).join(", ")}</span>
                        </>
                      ) : (
                        <span className="text-[#9edc7f]"> · Buying everything listed</span>
                      )}
                    </span>
                  </span>
                  <span className="flex shrink-0 flex-col items-end">
                    <span className={`text-sm font-semibold ${missing.length ? "text-[#ffab9c]" : "text-[#9edc7f]"}`}>
                      {r.buying} / {r.lines.length}
                    </span>
                    <span className={`text-[11px] ${MUTED}`}>buying</span>
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      )}
    </Modal>
  );
}

// Account search (2026-10-22, per Chad; a slim bar in the period row since
// later that day): type part of an account name, store
// number ("#667"), city or address → this distributor's matching accounts →
// pick one → the same account pop-up as anywhere else on the page. Searches
// only this distributor's accounts (sales_territory_search checks access).
function AccountSearch({ supabase, dist, onPick }: { supabase: ReturnType<typeof createClient>; dist: string; onPick: (outletId: string) => void }) {
  const slug = dist.toLowerCase().trim().replace(/\s+/g, "-");
  const searchNew = useNewFeature(`feature:dist-account-search-${slug}`);
  const [q, setQ] = useState("");
  const [rows, setRows] = useState<SearchRow[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const [hi, setHi] = useState(0);

  useEffect(() => {
    const term = q.trim();
    // Under 2 letters: nothing to search (the list only shows from 2 letters).
    if (term.length < 2) return;
    let cancelled = false;
    const t = setTimeout(async () => {
      const { data, error } = await supabase.rpc("sales_territory_search", { p_dist: dist, p_q: term });
      if (cancelled) return;
      if (error) {
        setErr(error.message);
        setRows([]);
      } else {
        setErr(null);
        setRows((data as SearchRow[]) ?? []);
        setHi(0);
      }
    }, 250);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [supabase, dist, q]);

  const pick = (r: SearchRow) => {
    onPick(r.outlet_id);
    setOpen(false);
    searchNew.dismiss();
  };

  return (
    <div className="relative">
      <div className="relative">
        <svg viewBox="0 0 24 24" className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-neutral-500" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
          <circle cx="11" cy="11" r="7" />
          <path d="m20 20-3.5-3.5" />
        </svg>
        <input
          type="search"
          value={q}
          onChange={(e) => {
            setQ(e.target.value);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          onBlur={() => setTimeout(() => setOpen(false), 150)}
          onKeyDown={(e) => {
            if (!rows?.length) return;
            if (e.key === "ArrowDown") {
              e.preventDefault();
              setHi((h) => Math.min(h + 1, rows.length - 1));
            } else if (e.key === "ArrowUp") {
              e.preventDefault();
              setHi((h) => Math.max(h - 1, 0));
            } else if (e.key === "Enter") {
              e.preventDefault();
              if (rows[hi]) pick(rows[hi]);
            } else if (e.key === "Escape") {
              setOpen(false);
            }
          }}
          placeholder={`Search ${dist} accounts — name, #store, city or address`}
          aria-label={`Search ${dist} accounts`}
          className={`min-h-9 w-full rounded-full border border-neutral-700 bg-neutral-950 py-1.5 pl-9 text-[13px] text-neutral-100 placeholder:text-neutral-500 focus:border-[#6abc46] focus:outline-none ${searchNew.isNew ? "pr-16" : "pr-3"}`}
        />
        {searchNew.isNew && (
          <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2">
            <NewBadge inline />
          </span>
        )}
        {open && q.trim().length >= 2 && rows && (
          <div className="absolute left-0 right-0 top-full z-30 mt-1 max-h-[320px] overflow-y-auto rounded-lg border border-neutral-700 bg-neutral-950 shadow-2xl">
            {err ? (
              <p className="px-3 py-2 text-sm text-red-300">{err}</p>
            ) : rows.length === 0 ? (
              <p className={`px-3 py-2 text-sm ${MUTED}`}>No {dist} accounts match &ldquo;{q.trim()}&rdquo;.</p>
            ) : (
              rows.map((r, i) => (
                <button
                  key={r.outlet_id}
                  type="button"
                  onMouseDown={(e) => e.preventDefault()}
                  onMouseEnter={() => setHi(i)}
                  onClick={() => pick(r)}
                  className={`flex w-full flex-col gap-0.5 px-3 py-2 text-left ${i === hi ? "bg-neutral-800" : "hover:bg-neutral-900"}`}
                >
                  <span className="flex items-center gap-2 text-sm text-neutral-100">
                    {r.name}
                    {r.is_off && <span className="rounded bg-neutral-700 px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-neutral-300">turned off</span>}
                  </span>
                  <span className={`text-[12px] ${MUTED}`}>
                    {[
                      r.city,
                      r.premise === "On" ? "On-premise" : r.premise === "Off" ? "Off-premise" : null,
                      r.last_buy_date ? `last order ${fmtDay(r.last_buy_date)}` : "no orders on record",
                    ]
                      .filter(Boolean)
                      .join(" · ")}
                  </span>
                </button>
              ))
            )}
          </div>
        )}
      </div>
    </div>
  );
}

interface SearchRow {
  outlet_id: string;
  name: string;
  city: string | null;
  address: string | null;
  premise: string | null;
  last_buy_date: string | null;
  is_off: boolean;
}

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
                <span className="text-[11px] text-neutral-500">Store phone</span>
              </div>
            )}
          </div>
          {/* Contacts (2026-10-22, per Chad) — same list as Sales → Accounts. */}
          <div>
            <h3 className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-neutral-500">Contacts</h3>
            {(d.contacts ?? []).length ? (
              <div className="flex flex-col">
                {(d.contacts ?? []).map((c, i) => (
                  <div key={i} className="flex flex-col gap-0.5 border-t border-neutral-800/70 py-2 text-[13px] first:border-t-0">
                    <span className="font-semibold text-neutral-100">
                      {c.name ?? "(no name)"}
                      {c.title && <span className="font-normal text-neutral-400"> · {c.title}</span>}
                    </span>
                    <span className="flex flex-wrap gap-x-4 gap-y-0.5">
                      {c.phone && (
                        <a href={`tel:${c.phone}`} className="text-[#9edc7f]">
                          Phone {c.phone}
                        </a>
                      )}
                      {c.mobile && (
                        <a href={`tel:${c.mobile}`} className="text-[#9edc7f]">
                          Mobile {c.mobile}
                        </a>
                      )}
                      {c.email && (
                        <a href={`mailto:${c.email}`} className="text-[#9edc7f]">
                          {c.email}
                        </a>
                      )}
                    </span>
                    {c.notes && <span className="text-[12px] text-neutral-400">{c.notes}</span>}
                  </div>
                ))}
              </div>
            ) : (
              <p className={`text-sm ${MUTED}`}>No contacts on file.</p>
            )}
          </div>
          <div>
            <h3 className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-neutral-500">What they buy · last 13 months</h3>
            {items.length ? (
              <div className="grid max-h-[260px] grid-cols-[minmax(0,1fr)_auto_auto] gap-x-4 gap-y-1 overflow-y-auto pr-1 text-[13px]">
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
                      {c.contact && <span>· Spoke with: {c.contact}</span>}
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

// Upload inventory (2026-10-22) — Superior's Monday file from VIP ("SPC Full
// Circle Inventory.xlsx"). Names the app doesn't know yet get matched here
// once (saved to the same name lists as the Ekos sync); nothing is saved
// until every name is matched or skipped. Server: app/api/distributor-inventory/upload.
function UploadInventory({ dist, onDone }: { dist: string; onDone: () => void }) {
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [needs, setNeeds] = useState<{ names: string[]; products: string[] } | null>(null);
  const [picks, setPicks] = useState<Record<string, string>>({});
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const send = async (f: File, matches: Record<string, string>) => {
    setBusy(true);
    setMsg(null);
    try {
      const fd = new FormData();
      fd.append("file", f);
      fd.append("distributor", dist);
      fd.append("matches", JSON.stringify(matches));
      const res = await fetch("/api/distributor-inventory/upload", { method: "POST", body: fd });
      const j = (await res.json().catch(() => ({}))) as {
        error?: string;
        needs?: string[];
        products?: string[];
        ok?: boolean;
        saved?: number;
        skipped?: number;
        reportDate?: string | null;
      };
      if (!res.ok || j.error) {
        setMsg({ ok: false, text: j.error ?? `Upload failed (${res.status}).` });
        return;
      }
      if (j.needs?.length) {
        setNeeds({ names: j.needs, products: j.products ?? [] });
        return;
      }
      setNeeds(null);
      setPicks({});
      setFile(null);
      setMsg({ ok: true, text: `Saved ${j.saved} items${j.skipped ? ` (${j.skipped} skipped)` : ""}${j.reportDate ? ` · report from ${j.reportDate}` : ""}.` });
      onDone();
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <label className="inline-flex min-h-8 cursor-pointer items-center gap-1.5 rounded-full border border-[#6abc46]/45 bg-[#6abc46]/10 px-3 text-xs font-semibold text-neutral-100 hover:bg-[#6abc46]/20">
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M12 21V9" />
          <path d="m7 14 5-5 5 5" />
          <path d="M5 3h14" />
        </svg>
        {busy ? "Uploading…" : "Upload inventory"}
        <input
          type="file"
          accept=".xlsx,.csv"
          className="hidden"
          disabled={busy}
          onChange={(e) => {
            const f = e.target.files?.[0];
            e.target.value = "";
            if (!f) return;
            setFile(f);
            send(f, {});
          }}
        />
      </label>
      {msg && !needs && (
        <span className={`basis-full text-right text-[12px] ${msg.ok ? "text-[#9edc7f]" : "text-red-300"}`} role="status">
          {msg.text}
        </span>
      )}
      {needs && file && (
        <Modal
          title={`Match ${needs.names.length} item name${needs.names.length === 1 ? "" : "s"}`}
          sub={`${dist}'s file uses names the app doesn't know yet. Pick the app product for each (or Skip). This is saved, so next week's file goes straight in.`}
          onClose={() => setNeeds(null)}
        >
          <div className="flex flex-col gap-2">
            {needs.names.map((n) => (
              <label key={n} className="flex flex-wrap items-center justify-between gap-2 text-[13px]">
                <span className="font-mono text-neutral-200">{n}</span>
                <select
                  value={picks[n] ?? ""}
                  onChange={(e) => setPicks((p) => ({ ...p, [n]: e.target.value }))}
                  className="min-w-[280px] rounded-md border border-neutral-700 bg-neutral-900 px-2 py-1.5 text-[13px] text-neutral-100"
                >
                  <option value="">Pick a product…</option>
                  <option value="__skip">Skip (leave it out)</option>
                  {needs.products.map((p) => (
                    <option key={p} value={p}>
                      {p}
                    </option>
                  ))}
                </select>
              </label>
            ))}
            {msg && !msg.ok && <p className="text-[12.5px] text-red-300">{msg.text}</p>}
            <div className="mt-2 flex justify-end">
              <button
                type="button"
                disabled={busy || needs.names.some((n) => !picks[n])}
                onClick={() => send(file, picks)}
                className="inline-flex min-h-9 items-center rounded-full border border-[#6abc46]/45 bg-[#6abc46]/20 px-4 text-[13px] font-semibold text-neutral-50 disabled:opacity-40"
              >
                {busy ? "Saving…" : "Save matches & upload"}
              </button>
            </div>
          </div>
        </Modal>
      )}
    </>
  );
}
