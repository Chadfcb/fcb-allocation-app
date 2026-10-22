"use client";

// Sales Dashboard home (added 2026-10-21, per Chad): "more like a dashboard …
// something we would be proud to show off … easily gain information on
// anything high level sales related. Sales → Accounts is where we drill down."
// Approved mockup: claude/sales-dashboard-plan.md (Design canvas "Sales
// Dashboard Redesign Mockup").
//
// Top to bottom: period (30 / 90 days / Year to date / Custom dates) and
// distributor filters · Needs attention + Win backs ·
// Distributors (click one → its biggest immediate impacts) · headline numbers ·
// cases by month + account health · what's selling, chain coverage, rep
// activity. Lists you drill into export to Excel (Chad 10/21: no whole-dashboard
// export, no help button); "See all" goes to Sales → Accounts
// (filters set) or the Action Items / Gap Report tools.
//
// Live: everything is worked out from the sales data when the page opens, and
// SalesDashboardClient reloads it when a LilyPad sync finishes (sales_data_meta
// change) — `version` bumps. Numbers: sql/sales_dashboard_home.sql; block
// math: lib/salesDashHome.ts; chain coverage: lib/chainCoverage.ts.

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { downloadWorkbook, type Supa } from "@/components/SalesDashboardClient";
import type { ActionData, ActionRow } from "@/components/SalesActionItems";
import { coverageFor, useChainCoverage } from "@/lib/chainCoverage";
import { BIG_LOST_CE } from "@/lib/salesAccounts";
import { useNewFeature } from "@/lib/newFeatures";
import NewBadge from "@/components/NewBadge";
import type { DashOverview, resolveLists } from "@/lib/salesDashboard";
import {
  PERIODS,
  STAGE_COLORS,
  addDaysIso,
  brands,
  distColor,
  distributorsWithData,
  fmtDay,
  fmtN,
  fmtPct,
  kpis,
  loadArgs,
  monthLabel,
  pctChange,
  periodRange,
  repActivity,
  repName,
  sizes,
  stageCounts,
  trend,
  winbacksIn,
  type DateRange,
  type HomeAttention,
  type HomeData,
  type HomeWinback,
  type Period,
} from "@/lib/salesDashHome";

type Resolved = ReturnType<typeof resolveLists>;

export const CARD = "rounded-xl border border-neutral-800 bg-neutral-950 p-5";
export const MUTED = "text-neutral-400";
const PREF_KEY = "fcb-sales-home-view";

const accountsLink = (q: Record<string, string>) => `/sales/accounts?${new URLSearchParams(q).toString()}`;

// ---------------------------------------------------------------------------
// Small pieces
// ---------------------------------------------------------------------------
export function Pill({ on, onClick, children, id }: { on: boolean; onClick: () => void; children: React.ReactNode; id?: string }) {
  return (
    <button
      id={id}
      type="button"
      onClick={onClick}
      className={`inline-flex min-h-9 shrink-0 items-center gap-2 whitespace-nowrap rounded-full border px-3.5 text-[13px] font-medium transition ${
        on
          ? "border-[#6abc46]/45 bg-gradient-to-r from-[#6abc46]/25 to-[#6abc46]/5 text-neutral-50 shadow-[0_0_24px_rgba(106,188,70,0.14)]"
          : "border-neutral-700 text-neutral-300 hover:border-[#6abc46]/40 hover:text-neutral-100"
      }`}
    >
      {children}
    </button>
  );
}

export function Change({ value, goodWhenDown, title }: { value: number | null; goodWhenDown?: boolean; title?: string }) {
  if (value === null) return <span className="rounded-full bg-neutral-800 px-2 py-0.5 text-xs font-semibold text-neutral-300">new</span>;
  const flat = Math.abs(value) < 0.5;
  const good = goodWhenDown ? value < 0 : value > 0;
  const cls = flat ? "bg-neutral-800 text-neutral-300" : good ? "bg-[#6abc46]/15 text-[#9edc7f]" : "bg-red-500/15 text-[#ffab9c]";
  return (
    <span title={title} className={`rounded-full px-2 py-0.5 text-xs font-semibold ${cls}`}>
      {fmtPct(value)}
    </span>
  );
}

export function Dot({ color, glow }: { color: string; glow?: boolean }) {
  return <span className="inline-block h-2 w-2 shrink-0 rounded-full" style={{ background: color, boxShadow: glow ? `0 0 10px ${color}` : undefined }} />;
}

export function ExportButton({ onClick, label = "Export", busy }: { onClick: () => void; label?: string; busy?: boolean }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={busy}
      className="inline-flex min-h-8 items-center gap-1.5 rounded-full border border-neutral-700 px-3 text-xs font-semibold text-neutral-300 hover:border-[#6abc46]/40 hover:text-neutral-100 disabled:opacity-50"
    >
      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M12 3v12" />
        <path d="m7 10 5 5 5-5" />
        <path d="M5 21h14" />
      </svg>
      {busy ? "Exporting…" : label}
    </button>
  );
}

export function Modal({ title, sub, onClose, actions, children }: { title: string; sub?: string; onClose: () => void; actions?: React.ReactNode; children: React.ReactNode }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/70 p-4 pt-16" onClick={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className="w-full max-w-3xl rounded-xl border border-[#6abc46]/40 bg-neutral-950 p-5 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-3 flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="text-base font-semibold text-neutral-100">{title}</h2>
            {sub && <p className={`text-[12.5px] ${MUTED}`}>{sub}</p>}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {actions}
            <button type="button" onClick={onClose} aria-label="Close" className="rounded-full px-2.5 py-1 text-lg leading-none text-neutral-400 hover:bg-neutral-800 hover:text-neutral-100">
              ✕
            </button>
          </div>
        </div>
        {children}
      </div>
    </div>
  );
}

export function Row({ left, title, sub, value, valueLabel, href, onClick }: { left?: React.ReactNode; title: string; sub: string; value: string; valueLabel: string; href?: string; onClick?: () => void }) {
  const inner = (
    <>
      {left}
      <span className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="truncate text-sm font-semibold text-neutral-100">{title}</span>
        <span className={`text-[12.5px] ${MUTED}`}>{sub}</span>
      </span>
      <span className="flex flex-col items-end text-right">
        <span className="font-mono text-[15px] text-neutral-50">{value}</span>
        <span className="text-[11px] text-neutral-500">{valueLabel}</span>
      </span>
    </>
  );
  const cls = "flex w-full items-center gap-3 border-t border-neutral-800/70 py-3 text-left first:border-t-0 hover:bg-white/[0.02]";
  if (href)
    return (
      <Link href={href} className={cls}>
        {inner}
      </Link>
    );
  if (onClick)
    return (
      <button type="button" onClick={onClick} className={cls}>
        {inner}
      </button>
    );
  return <div className={cls}>{inner}</div>;
}

export const TAG = {
  gap: "bg-red-500/15 text-[#ffab9c]",
  slip: "bg-amber-500/15 text-[#f7c27a]",
  lost: "bg-red-500/10 text-[#ff9a8a]",
  chain: "bg-violet-400/15 text-[#b9adf7]",
  wl: "bg-teal-400/15 text-[#7fe0cd]",
  wp: "bg-[#6abc46]/15 text-[#9edc7f]",
};
export function Tag({ kind, children }: { kind: keyof typeof TAG; children: React.ReactNode }) {
  return <span className={`inline-flex min-w-[96px] shrink-0 justify-center rounded-full px-2.5 py-0.5 text-[11px] font-semibold ${TAG[kind]}`}>{children}</span>;
}

export function Spark({ values, color }: { values: number[]; color: string }) {
  if (values.length < 2) return null;
  const mx = Math.max(...values);
  const mn = Math.min(...values);
  const r = mx - mn || 1;
  const pts = values.map((v, i) => `${((i * 120) / (values.length - 1)).toFixed(1)},${(30 - ((v - mn) / r) * 26).toFixed(1)}`).join(" ");
  return (
    <svg viewBox="0 0 120 34" preserveAspectRatio="none" className="mt-1 block h-8 w-full" aria-hidden="true">
      <polyline points={pts} fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
    </svg>
  );
}

// ---------------------------------------------------------------------------
// Excel
// ---------------------------------------------------------------------------
export type Col = { header: string; key: string; width?: number };
type ExcelWorkbook = import("exceljs").Workbook;
function addSheet(wb: ExcelWorkbook, name: string, title: string, cols: Col[], rows: Record<string, unknown>[]) {
  const ws = wb.addWorksheet(name.slice(0, 31));
  ws.addRow([title]);
  ws.getRow(1).font = { bold: true };
  ws.addRow(cols.map((c) => c.header));
  ws.getRow(2).font = { bold: true };
  for (const r of rows) ws.addRow(cols.map((c) => r[c.key] ?? ""));
  cols.forEach((c, i) => (ws.getColumn(i + 1).width = c.width ?? 16));
  ws.views = [{ state: "frozen", ySplit: 2 }];
}
export async function exportSheets(fileName: string, sheets: { name: string; title: string; cols: Col[]; rows: Record<string, unknown>[] }[]) {
  const ExcelJS = (await import("exceljs")).default;
  const wb = new ExcelJS.Workbook();
  for (const s of sheets) addSheet(wb, s.name, s.title, s.cols, s.rows);
  downloadWorkbook(await wb.xlsx.writeBuffer(), fileName);
}

export const COLS_GAPS: Col[] = [
  { header: "Store", key: "store", width: 30 },
  { header: "City", key: "city" },
  { header: "Chain", key: "chain" },
  { header: "Distributor", key: "dist" },
  { header: "Rep", key: "rep", width: 10 },
  { header: "Phone", key: "phone" },
  { header: "Missing must-carry items", key: "items", width: 50 },
  { header: "Cases a year at stake", key: "impact" },
  { header: "Last check-in", key: "checkin" },
];
export const gapRows = (rows: ActionRow[]) =>
  rows.map((r) => ({
    store: r.store.name,
    city: r.store.city ?? "",
    chain: r.chain,
    dist: r.store.distributor,
    rep: r.rep ?? "",
    phone: r.phone ?? "",
    items: r.missing.map((m) => `${m.product} ${m.size}`).join(", "),
    impact: Math.round(r.impact),
    checkin: r.lastCheckin ? `${fmtDay(r.lastCheckin)}${r.lastCheckinBy ? ` (${r.lastCheckinBy})` : ""}` : "",
  }));
export const COLS_ACCOUNTS: Col[] = [
  { header: "Account", key: "name", width: 32 },
  { header: "City", key: "city" },
  { header: "Distributor", key: "dist" },
  { header: "Rep", key: "rep", width: 10 },
  { header: "Phone", key: "phone" },
  { header: "Last order", key: "lb" },
  { header: "Days since", key: "dark", width: 10 },
  { header: "Cases last 12 months", key: "ce12" },
  { header: "Last check-in", key: "checkin" },
];
export const accountRows = (rows: HomeAttention[]) =>
  rows.map((a) => ({
    name: a.name,
    city: a.city ?? "",
    dist: a.dist,
    rep: repName(a.dist),
    phone: a.phone ?? "",
    lb: fmtDay(a.lb),
    dark: a.dark,
    ce12: Math.round(a.ce12),
    checkin: a.checkin ? `${fmtDay(a.checkin.date)}${a.checkin.rep ? ` (${a.checkin.rep})` : ""}` : "",
  }));
export const COLS_WB: Col[] = [
  { header: "Account", key: "name", width: 32 },
  { header: "City", key: "city" },
  { header: "Distributor", key: "dist" },
  { header: "Rep", key: "rep", width: 10 },
  { header: "Came back", key: "d" },
  { header: "Order before that", key: "prev" },
  { header: "Days gone", key: "gap", width: 10 },
  { header: "Won back from", key: "from" },
  { header: "Came back buying", key: "items", width: 44 },
  { header: "Cases since", key: "ce" },
  { header: "Check-in before they came back", key: "checkin", width: 24 },
];
export const wbRows = (rows: HomeWinback[]) =>
  rows.map((w) => ({
    name: w.name,
    city: w.city ?? "",
    dist: w.dist,
    rep: repName(w.dist),
    d: fmtDay(w.d),
    prev: fmtDay(w.prev),
    gap: w.gap,
    from: w.gap > 90 ? "Lost (90+ days)" : "Potential lost (61–90 days)",
    items: w.items ?? "",
    ce: Math.round(Number(w.ce_since) || 0),
    checkin: w.checkin ? `${fmtDay(w.checkin.date)}${w.checkin.rep ? ` (${w.checkin.rep})` : ""}` : "",
  }));

// ---------------------------------------------------------------------------
// The page
// ---------------------------------------------------------------------------
interface Impact {
  kind: "gap" | "slip" | "lost" | "chain";
  label: string;
  title: string;
  sub: string;
  ce: number;
  href?: string;
  row?: ActionRow;
}

export default function SalesDashboardHome({
  supabase,
  ov,
  resolved,
  version,
  actions,
  onOpenStore,
  onOpenTool,
}: {
  supabase: Supa;
  ov: DashOverview | null;
  resolved: Resolved | null;
  version: number;
  actions: ActionData;
  onOpenStore: (r: ActionRow) => void;
  onOpenTool: (t: "actions" | "gap") => void;
}) {
  const [home, setHome] = useState<HomeData | null>(null);
  // Maintenance routes (2026-10-22): accounts checked in this two-month period / total, per rep.
  const [routes, setRoutes] = useState<{ rep: string; distributor: string | null; total: number; visited: number }[] | null>(null);
  const routeNew = useNewFeature("feature:rep-route-column");
  const [err, setErr] = useState<string | null>(null);
  // Retry after a failed load (2026-10-22): bumping this reloads.
  const [retry, setRetry] = useState(0);
  const [period, setPeriod] = useState<Period>("90");
  const [dist, setDist] = useState("");
  const [att, setAtt] = useState<"gaps" | "slip" | "lost">("gaps");
  const [openDist, setOpenDist] = useState<string | null>(null);
  const [allWb, setAllWb] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  // Custom dates: `custom` is the applied range (loaded from the database);
  // the From / To boxes edit `draft` until Apply.
  const [custom, setCustom] = useState<DateRange | null>(null);
  const [showCustom, setShowCustom] = useState(false);
  const [draft, setDraft] = useState<DateRange>({ from: "", to: "" });
  // When the app last pulled from LilyPad (sales_data_meta.imported_at — stamped
  // by every sync even when LilyPad had nothing newer). Chad 10/21: the as-of
  // date alone read like the data was stale.
  const [checkedAt, setCheckedAt] = useState<string | null>(null);
  const coverage = useChainCoverage(supabase, ov, resolved, version);

  // Remembered period / distributor (this browser only).
  useEffect(() => {
    try {
      const s = JSON.parse(localStorage.getItem(PREF_KEY) ?? "{}") as { period?: Period; dist?: string; custom?: DateRange };
      if (s.period === "custom" && s.custom?.from && s.custom?.to) {
        // eslint-disable-next-line react-hooks/set-state-in-effect -- restore this viewer's last choice
        setCustom(s.custom);
        setDraft(s.custom);
        setShowCustom(true);
        setPeriod("custom");
      } else if (s.period && PERIODS.some((p) => p.key === s.period)) setPeriod(s.period);
      if (typeof s.dist === "string") setDist(s.dist);
    } catch {
      // ignore
    }
  }, []);
  const remember = (p: Period, d: string, c: DateRange | null = custom) => {
    try {
      localStorage.setItem(PREF_KEY, JSON.stringify({ period: p, dist: d, custom: p === "custom" ? c : undefined }));
    } catch {
      // ignore
    }
  };

  // Load (and reload whenever the parent's version bumps — e.g. a LilyPad sync finished).
  useEffect(() => {
    let cancelled = false;
    supabase
      .from("sales_data_meta")
      .select("imported_at")
      .eq("id", 1)
      .maybeSingle()
      .then(({ data }) => {
        if (!cancelled) setCheckedAt((data?.imported_at as string | null) ?? null);
      });
    supabase.rpc("sales_route_progress").then(({ data, error }) => {
      if (!cancelled && !error) setRoutes(((data as { routes?: { rep: string; distributor: string | null; total: number; visited: number }[] } | null)?.routes ?? []));
    });
    supabase.rpc("sales_dash_home", loadArgs(custom)).then(({ data, error }) => {
      if (cancelled) return;
      if (error) setErr(error.message);
      else {
        setErr(null);
        setHome(data as HomeData);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [supabase, version, custom, retry]);

  // Custom period chosen but its numbers not loaded yet → show the last 90 days meanwhile.
  const customReady = !!home?.periods?.some((x) => x.p === "custom");
  const shown: Period = period === "custom" && !customReady ? "90" : period;
  const pLabel =
    shown === "custom" && custom ? `${fmtDay(custom.from)} – ${fmtDay(custom.to)}` : PERIODS.find((p) => p.key === shown)!.long;
  const scope = dist || "All distributors";
  const actionRows = useMemo(() => (actions.rows ?? []).filter((r) => !dist || r.store.distributor === dist).sort((a, b) => b.impact - a.impact), [actions.rows, dist]);

  const v = useMemo(() => {
    if (!home || !home.as_of) return null;
    const k = kpis(home, shown, dist);
    const t = trend(home, dist);
    const dd = distributorsWithData(home);
    const att = (home.attention ?? []).filter((a) => !dist || a.dist === dist);
    return {
      k,
      t,
      dd,
      health: stageCounts(home, dist),
      slip: att.filter((a) => a.stage === "plost"),
      lost: att.filter((a) => a.stage === "lost"),
      wins: winbacksIn(home, shown, dist),
      brands: brands(home, shown, dist),
      sizes: sizes(home, shown, dist),
      reps: repActivity(home, shown, dist),
      range: periodRange(home, shown),
    };
  }, [home, shown, dist]);

  // A failed load shows the reason + Retry. If numbers were already showing
  // (e.g. a reload after a period change failed), they stay on screen under
  // the message instead of the whole page disappearing (2026-10-22).
  const errBox = err ? (
    <div className="flex flex-wrap items-center gap-3 rounded-md border border-red-500/40 bg-red-500/10 px-3 py-2 text-sm text-red-300">
      <span>Couldn&apos;t load the dashboard numbers: {err}</span>
      <button
        type="button"
        onClick={() => {
          setErr(null);
          setRetry((r) => r + 1);
        }}
        className="rounded-md border border-red-400/50 px-2.5 py-1 text-xs font-semibold text-red-200 hover:bg-red-500/20"
      >
        Retry
      </button>
    </div>
  ) : null;
  if (err && !home) return errBox;
  if (!home || !v) return <p className={`text-sm ${MUTED}`}>{home && !home.as_of ? "No sales data yet." : "Loading the dashboard…"}</p>;

  const { k, t } = v;

  // Biggest immediate impacts for one distributor.
  const impactsFor = (d: string): Impact[] => {
    const list: Impact[] = [
      ...(actions.rows ?? [])
        .filter((r) => r.store.distributor === d)
        .map<Impact>((r) => ({
          kind: "gap",
          label: "Must-carry gap",
          title: `${r.store.name}${r.store.city ? ` · ${r.store.city}` : ""}`,
          sub: `Not buying ${r.missing.map((m) => `${m.product} ${m.size}`).join(", ")} (${r.chain} must-carry)`,
          ce: r.impact,
          row: r,
        })),
      ...home.attention
        .filter((a) => a.dist === d)
        .map<Impact>((a) => ({
          kind: a.stage === "plost" ? "slip" : "lost",
          label: a.stage === "plost" ? "Slipping" : "Lost",
          title: `${a.name}${a.city ? ` · ${a.city}` : ""}`,
          sub: `${a.dark} days since the last order (${fmtDay(a.lb)})`,
          ce: Number(a.ce12) || 0,
          href: accountsLink({ open: a.outlet_id }),
        })),
      ...home.chain_quiet
        .filter((c) => c.dist === d)
        .map<Impact>((c) => ({
          kind: "chain",
          label: "Chain",
          title: `${c.chain} — ${c.quiet} of ${c.stores} stores stopped buying`,
          sub: c.quiet_names.slice(0, 4).join(", ") + (c.quiet_names.length > 4 ? `, +${c.quiet_names.length - 4} more` : ""),
          ce: Number(c.quiet_ce) || 0,
        })),
    ];
    return list.sort((a, b) => b.ce - a.ce);
  };

  const exportDistributor = async (d: string) => {
    setBusy(`dist:${d}`);
    try {
      const imp = impactsFor(d);
      await exportSheets(`${d} - action list - ${home.as_of}.xlsx`, [
        {
          name: "Biggest impacts",
          title: `${d} (rep ${repName(d)}) — biggest immediate impacts, ranked by cases a year at stake · data as of ${fmtDay(home.as_of)}`,
          cols: [
            { header: "Type", key: "label" },
            { header: "Account / chain", key: "title", width: 44 },
            { header: "Detail", key: "sub", width: 60 },
            { header: "Cases a year at stake", key: "ce" },
          ],
          rows: imp.map((i) => ({ label: i.label, title: i.title, sub: i.sub, ce: Math.round(i.ce) })),
        },
        { name: "Must-carry gaps", title: `${d} — stores missing must-carry items`, cols: COLS_GAPS, rows: gapRows((actions.rows ?? []).filter((r) => r.store.distributor === d)) },
        { name: "Slipping", title: `${d} — 61–90 days since the last order`, cols: COLS_ACCOUNTS, rows: accountRows(home.attention.filter((a) => a.dist === d && a.stage === "plost")) },
        { name: "Big losses", title: `${d} — lost in the last year, ${BIG_LOST_CE}+ cases all time`, cols: COLS_ACCOUNTS, rows: accountRows(home.attention.filter((a) => a.dist === d && a.stage === "lost")) },
      ]);
    } finally {
      setBusy(null);
    }
  };

  const ATT = {
    gaps: { label: "Must-carry gaps", count: actions.rows ? actionRows.length : null, rule: "Stores not buying an item their chain says they must carry (Sales → Chain Mandates). Biggest first." },
    slip: { label: "Slipping now", count: v.slip.length, rule: "61–90 days since their last order — still saveable. Biggest 12-month buyers first." },
    lost: { label: "Big losses", count: v.lost.length, rule: `Lost in the last year (90+ days quiet) and bought ${BIG_LOST_CE}+ cases all time. Biggest 12-month buyers first.` },
  } as const;

  const exportAttention = async () => {
    setBusy("att");
    try {
      if (att === "gaps") await exportSheets(`Must-carry gaps - ${scope} - ${home.as_of}.xlsx`, [{ name: "Must-carry gaps", title: `Must-carry gaps — ${scope}`, cols: COLS_GAPS, rows: gapRows(actionRows) }]);
      else
        await exportSheets(`${ATT[att].label} - ${scope} - ${home.as_of}.xlsx`, [
          { name: ATT[att].label, title: `${ATT[att].label} — ${scope} · ${ATT[att].rule}`, cols: COLS_ACCOUNTS, rows: accountRows(att === "slip" ? v.slip : v.lost) },
        ]);
    } finally {
      setBusy(null);
    }
  };
  const exportWins = async () => {
    setBusy("wb");
    try {
      await exportSheets(`Win backs - ${scope} - ${pLabel} - ${home.as_of}.xlsx`, [{ name: "Win backs", title: `Win backs — ${scope} — ${pLabel}`, cols: COLS_WB, rows: wbRows(v.wins) }]);
    } finally {
      setBusy(null);
    }
  };

  const cov = coverage.rows ? coverageFor(coverage.rows, dist) : null;

  const casesChg = pctChange(k.cases, k.casesLy);
  const health = [
    { key: "active", label: "Active", rule: "Bought in the last 60 days and the 90 before", stage: "active" },
    { key: "new", label: "New", rule: "First order ever, last 60 days", stage: "new" },
    { key: "reactivated", label: "Re-Activated", rule: "Back after 90+ quiet days", stage: "reactivated" },
    { key: "plost", label: "Potential lost", rule: "61–90 days quiet", stage: "plost" },
    { key: "lost", label: "Lost (last year)", rule: "91 days to a year quiet", stage: "lost" },
  ] as const;
  const healthTotal = health.reduce((tt, h) => tt + v.health[h.key].n, 0) || 1;
  const distParam = dist ? { dist } : ({} as Record<string, string>);

  const kpiCards = [
    { label: "Cases sold", value: fmtN(k.cases), chg: casesChg, sub: "vs same days last year", spark: t.ty, color: "#6abc46", href: accountsLink({ ...distParam, sort: "ce_12mo" }) },
    { label: "Buying accounts", value: fmtN(k.buying), chg: pctChange(k.buying, k.buyingLy), sub: "ordered in the last 60 days", color: "#6abc46", href: accountsLink({ ...distParam, sort: "last_buy_date" }) },
    { label: "New accounts", value: fmtN(k.newA), chg: pctChange(k.newA, k.newLy), sub: "first order ever", color: "#5aa9f0", href: accountsLink({ ...distParam, stage: "new" }) },
    { label: "Won back", value: fmtN(k.won), chg: pctChange(k.won, k.wonLy), sub: "ordered again after 61+ days", color: "#3fc9b0", onClick: () => setAllWb(true) },
    { label: "At risk", value: fmtN(k.atRisk), chg: undefined, sub: `${fmtN(k.atRiskCe)} cases a year · 61–90 days quiet`, color: "#f0a63c", href: accountsLink({ ...distParam, stage: "plost" }) },
    { label: "Went lost", value: fmtN(k.wentLost), chg: pctChange(k.wentLost, k.wentLostLy), goodWhenDown: true, sub: "hit 90+ days (fewer is better)", color: "#ef6a55", href: accountsLink({ ...distParam, stage: "lost", sort: "last_buy_date" }) },
  ];

  const tiles = v.dd.withData
    .filter((d) => !dist || d === dist)
    .map((d) => {
      const kd = kpis(home, shown, d);
      const gaps = (actions.rows ?? []).filter((r) => r.store.distributor === d).length;
      const slipping = kd.atRisk >= Math.max(3, kd.buying * 0.1);
      return {
        d,
        kd,
        gaps,
        flag: gaps ? `${gaps} must-carry gap${gaps > 1 ? "s" : ""} · fix first` : slipping ? `${kd.atRisk} accounts slipping` : "On track",
        flagCls: gaps ? "bg-red-500/15 text-[#ffab9c]" : slipping ? "bg-amber-500/15 text-[#f7c27a]" : "bg-[#6abc46]/15 text-[#9edc7f]",
      };
    });

  const attRows =
    att === "gaps"
      ? actionRows.slice(0, 5).map((r) => (
          <Row
            key={r.store.outlet_id}
            left={<Dot color={distColor(r.store.distributor)} />}
            title={`${r.store.name}${r.store.city ? ` · ${r.store.city}` : ""}`}
            sub={`${r.missing.map((m) => `${m.product} ${m.size}`).join(", ")} · ${r.store.distributor}${r.rep ? ` · rep ${r.rep}` : ""}`}
            value={fmtN(r.impact)}
            valueLabel="cases / yr at stake"
            onClick={() => onOpenStore(r)}
          />
        ))
      : (att === "slip" ? v.slip : v.lost).slice(0, 5).map((a) => (
          <Row
            key={a.outlet_id}
            left={<Dot color={distColor(a.dist)} />}
            title={`${a.name}${a.city ? ` · ${a.city}` : ""}`}
            sub={`${a.dist} · rep ${repName(a.dist)} · ${a.dark} days quiet`}
            value={fmtN(a.ce12)}
            valueLabel="cases last 12 mo"
            href={accountsLink({ open: a.outlet_id })}
          />
        ));
  const attSeeAll =
    att === "gaps" ? (
      <button type="button" onClick={() => onOpenTool("actions")} className="text-[13px] font-semibold text-[#9edc7f] hover:text-[#c3ecae]">
        See all {actionRows.length} in Action Items →
      </button>
    ) : (
      <Link href={accountsLink({ ...distParam, stage: att === "slip" ? "plost" : "lost", ...(att === "lost" ? { big: "1" } : {}) })} className="text-[13px] font-semibold text-[#9edc7f] hover:text-[#c3ecae]">
        See all in Sales → Accounts →
      </Link>
    );

  const openImpacts = openDist ? impactsFor(openDist) : [];

  return (
    <div className="flex flex-col gap-5">
      {errBox}
      {/* Data date, then the period (Chad 10/21: under the sync status, above the distributors), then distributors */}
      <p
        className={`text-[13px] ${MUTED}`}
        title="Distributors report their sales to LilyPad a few days behind, so the latest sales date usually trails today. The app checks LilyPad for new sales every weekday morning and this page updates on its own."
      >
        <span className="mr-2 inline-block h-2 w-2 rounded-full bg-[#6abc46] align-middle shadow-[0_0_10px_#6abc46]" />
        Latest sales in LilyPad: <span className="text-neutral-200">{fmtWeekdayDay(home.as_of)}</span>
        {checkedAt && (
          <>
            {" "}
            · Last checked for new sales: <span className="text-neutral-200">{fmtChecked(checkedAt)}</span>
          </>
        )}
      </p>
      {/* How to use it (Chad 10/21: instructions right under the data line, "so people understand how the dashboard works") */}
      <div className="-mt-2 flex flex-col gap-1.5">
        <Step n={1}>First, select your time frame</Step>
        <Step n={2}>Second, select your distributor</Step>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        {PERIODS.map((p) => (
          <Pill
            key={p.key}
            on={period === p.key}
            onClick={() => {
              setPeriod(p.key);
              setShowCustom(false);
              remember(p.key, dist);
            }}
          >
            {p.label}
          </Pill>
        ))}
        <Pill
          on={period === "custom" || showCustom}
          onClick={() => {
            if (!showCustom && !draft.from) {
              const to = home.as_of ?? "";
              setDraft({ from: to ? addDaysIso(to, -29) : "", to });
            }
            setShowCustom(!showCustom);
          }}
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <rect x="3" y="4" width="18" height="18" rx="2" />
            <path d="M16 2v4M8 2v4M3 10h18" />
          </svg>
          {period === "custom" && custom ? `${fmtDay(custom.from)} – ${fmtDay(custom.to)}` : "Custom dates"}
        </Pill>
        {showCustom && (
          <form
            className="flex flex-wrap items-center gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              if (!draft.from || !draft.to) return;
              const r = draft.from <= draft.to ? draft : { from: draft.to, to: draft.from };
              setDraft(r);
              setCustom(r);
              setPeriod("custom");
              remember("custom", dist, r);
            }}
          >
            <label className={`flex items-center gap-1.5 text-[13px] ${MUTED}`}>
              From
              <input
                type="date"
                value={draft.from}
                max={home.as_of ?? undefined}
                onChange={(e) => setDraft({ ...draft, from: e.target.value })}
                className="min-h-9 rounded-full border border-neutral-700 bg-neutral-950 px-3 text-[13px] text-neutral-100 [color-scheme:dark]"
              />
            </label>
            <label className={`flex items-center gap-1.5 text-[13px] ${MUTED}`}>
              To
              <input
                type="date"
                value={draft.to}
                max={home.as_of ?? undefined}
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
            {period === "custom" && !customReady && <span className={`text-xs ${MUTED}`}>Loading…</span>}
          </form>
        )}
      </div>
      <div className="flex gap-2 overflow-x-auto pb-0.5">
        {["", ...v.dd.withData].map((d) => (
          <Pill
            key={d || "all"}
            on={dist === d}
            onClick={() => {
              setDist(d);
              remember(period, d);
            }}
          >
            <Dot color={d ? distColor(d) : "#6abc46"} />
            {d || "All distributors"}
          </Pill>
        ))}
      </div>

      {/* Needs attention + Win backs */}
      <div className="flex flex-wrap gap-4">
        <section className={`${CARD} flex min-w-0 flex-[1_1_520px] flex-col gap-3`}>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="text-[15px] font-semibold text-neutral-100">Needs attention</h2>
              <p className={`text-[12.5px] ${MUTED}`}>Biggest first — hand these to the reps</p>
            </div>
            <ExportButton onClick={exportAttention} busy={busy === "att"} />
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
            {att === "gaps" && !actions.rows ? <p className={`py-4 text-sm ${MUTED}`}>Checking chain stores…</p> : attRows.length ? attRows : <p className={`py-4 text-sm ${MUTED}`}>Nothing here{dist ? ` for ${dist}` : ""}. </p>}
          </div>
          <div>{attSeeAll}</div>
        </section>

        <section className={`${CARD} flex min-w-0 flex-[1_1_520px] flex-col gap-3`}>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="text-[15px] font-semibold text-neutral-100">Win backs</h2>
              <p className={`text-[12.5px] ${MUTED}`}>Accounts that went quiet and came back · {pLabel}</p>
            </div>
            <ExportButton onClick={exportWins} busy={busy === "wb"} />
          </div>
          <div className="flex flex-wrap gap-6">
            <Stat value={fmtN(k.won)} label="Won back" />
            <Stat value={fmtN(k.wonFromLost)} label="From Lost (90+ days)" color="#7fe0cd" />
            <Stat value={fmtN(k.won - k.wonFromLost)} label="From Potential lost (61–90)" color="#9edc7f" />
            <Stat value={fmtN(v.wins.reduce((tt, w) => tt + (Number(w.ce_since) || 0), 0))} label="Cases since they came back" />
          </div>
          <div className="flex flex-col">
            {v.wins.length ? (
              v.wins.slice(0, 5).map((w) => (
                <Row
                  key={`${w.outlet_id}-${w.d}`}
                  left={<Tag kind={w.gap > 90 ? "wl" : "wp"}>{w.gap > 90 ? "From Lost" : "From Pot. lost"}</Tag>}
                  title={`${w.name}${w.city ? ` · ${w.city}` : ""}`}
                  sub={`Back ${fmtDay(w.d)}${w.items ? ` with ${w.items}` : ""} · ${w.dist}${w.checkin ? ` · ${w.checkin.rep ?? "someone"} checked in ${fmtDay(w.checkin.date)}` : ""}`}
                  value={String(w.gap)}
                  valueLabel="days gone"
                  href={accountsLink({ open: w.outlet_id })}
                />
              ))
            ) : (
              <p className={`py-4 text-sm ${MUTED}`}>No win backs{dist ? ` for ${dist}` : ""} in this period yet.</p>
            )}
          </div>
          {v.wins.length > 5 && (
            <div>
              <button type="button" onClick={() => setAllWb(true)} className="text-[13px] font-semibold text-[#9edc7f] hover:text-[#c3ecae]">
                See all {v.wins.length} win backs →
              </button>
            </div>
          )}
        </section>
      </div>

      {/* Distributors */}
      <section className={`${CARD} flex flex-col gap-3.5`}>
        <div>
          <h2 className="text-[15px] font-semibold text-neutral-100">Distributors</h2>
          <p className={`text-[12.5px] ${MUTED}`}>{pLabel} · click one to see what needs doing there first</p>
        </div>
        <div className="grid gap-3" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(250px, 1fr))" }}>
          {tiles.map((tl) => (
            <button
              key={tl.d}
              type="button"
              onClick={() => setOpenDist(tl.d)}
              className="flex min-w-0 flex-col gap-2 rounded-2xl border border-neutral-800 bg-white/[0.02] px-4 py-4 text-left hover:border-[#6abc46]/40 hover:bg-white/[0.035]"
            >
              <span className="flex items-center gap-2">
                <Dot color={distColor(tl.d)} glow />
                <span className="text-[15px] font-semibold text-neutral-100">{tl.d}</span>
                <span className="text-[13px] text-neutral-500">· {repName(tl.d)}</span>
              </span>
              <span className="flex items-baseline gap-2">
                <span className="font-mono text-2xl font-light text-neutral-50">{fmtN(tl.kd.cases)}</span>
                <span className={`text-xs ${MUTED}`}>cases</span>
                <Change value={pctChange(tl.kd.cases, tl.kd.casesLy)} title="vs the same days last year" />
              </span>
              <span className="text-[12.5px] text-neutral-300">
                {fmtN(tl.kd.buying)} accounts buying · {fmtN(tl.kd.atRisk)} at risk
              </span>
              <span className={`self-start rounded-full px-2.5 py-0.5 text-xs font-semibold ${tl.flagCls}`}>{tl.flag}</span>
            </button>
          ))}
        </div>
        {v.dd.without.length > 0 && !dist && <p className="text-xs text-neutral-500">{v.dd.without.join(" and ")} only send totals — no store-level sales to break down yet.</p>}
      </section>

      {/* Headline numbers */}
      <div className="grid gap-4" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))" }}>
        {kpiCards.map((c) => {
          const body = (
            <>
              <span className="text-[13px] font-medium text-neutral-300">{c.label}</span>
              <span className="font-mono text-[32px] font-light leading-tight tracking-tight text-neutral-50">{c.value}</span>
              <span className="flex flex-wrap items-center gap-2">
                {c.chg !== undefined && <Change value={c.chg} goodWhenDown={c.goodWhenDown} title="vs the same days last year" />}
                <span className={`text-xs ${MUTED}`}>{c.sub}</span>
              </span>
              {c.spark ? <Spark values={c.spark} color={c.color} /> : <span className="mt-1 h-[3px] w-10 rounded-full" style={{ background: c.color }} />}
            </>
          );
          const cls = `${CARD} flex min-w-0 flex-col gap-2 text-left hover:border-[#6abc46]/40`;
          return c.href ? (
            <Link key={c.label} href={c.href} className={cls}>
              {body}
            </Link>
          ) : (
            <button key={c.label} type="button" onClick={c.onClick} className={cls}>
              {body}
            </button>
          );
        })}
      </div>

      {/* Cases by month + Account health */}
      <div className="flex flex-wrap gap-4">
        <CasesByMonth home={home} dist={dist} scope={scope} />

        <section className={`${CARD} flex min-w-0 flex-[1_1_360px] flex-col gap-4`}>
          <div>
            <h2 className="text-[15px] font-semibold text-neutral-100">Account health</h2>
            <p className={`text-[12.5px] ${MUTED}`}>Every account that ordered in the last year — click a color to see those accounts</p>
          </div>
          <div className="flex h-[22px] overflow-hidden rounded-full">
            {health.map((h) => (
              <Link
                key={h.key}
                href={accountsLink({ ...distParam, stage: h.stage })}
                aria-label={`${h.label}: ${v.health[h.key].n} accounts`}
                title={`${h.label}: ${fmtN(v.health[h.key].n)}`}
                className="block h-full border-r-2 border-neutral-950 hover:brightness-125"
                style={{ flex: `${Math.max(v.health[h.key].n / healthTotal, 0.0001)} 1 0`, background: STAGE_COLORS[h.key] }}
              />
            ))}
          </div>
          <div className="flex flex-col">
            {health.map((h) => (
              <Link key={h.key} href={accountsLink({ ...distParam, stage: h.stage })} className="flex items-center justify-between gap-3 border-t border-neutral-800/70 py-1.5 first:border-t-0 hover:bg-white/[0.02]">
                <span className="flex min-w-0 items-center gap-2.5">
                  <Dot color={STAGE_COLORS[h.key]} />
                  <span className="text-sm text-neutral-200">{h.label}</span>
                  <span className="truncate text-[11.5px] text-neutral-500">{h.rule}</span>
                </span>
                <span className="font-mono text-sm text-neutral-100">{fmtN(v.health[h.key].n)}</span>
              </Link>
            ))}
          </div>
        </section>
      </div>

      {/* What's selling · Chain coverage · Rep activity */}
      <div className="flex flex-wrap gap-4">
        <section className={`${CARD} flex min-w-0 flex-[1_1_380px] flex-col gap-3.5`}>
          <div>
            <h2 className="text-[15px] font-semibold text-neutral-100">What&apos;s selling</h2>
            <p className={`text-[12.5px] ${MUTED}`}>Cases by brand · {pLabel} · vs same days last year</p>
          </div>
          <div className="flex flex-col gap-3">
            {v.brands.map((b) => (
              <div key={b.product} className="flex flex-col gap-1.5">
                <div className="flex items-center justify-between gap-2.5 text-[13.5px]">
                  <span className="min-w-0 truncate font-medium text-neutral-200">{b.product}</span>
                  <span className="flex items-center gap-2">
                    <span className="font-mono">{fmtN(b.ce)}</span>
                    <Change value={b.chg} />
                  </span>
                </div>
                <div className="h-2 overflow-hidden rounded-full bg-neutral-800/70">
                  <div className="h-full rounded-full bg-gradient-to-r from-[#4f9a33] to-[#8fd16f]" style={{ width: `${(b.ce / (v.brands[0]?.ce || 1)) * 100}%` }} />
                </div>
              </div>
            ))}
            {!v.brands.length && <p className={`text-sm ${MUTED}`}>No sales in this period.</p>}
          </div>
          {v.sizes.length > 0 && (
            <div className="flex flex-col gap-2 border-t border-neutral-800/70 pt-3">
              <span className="text-xs text-neutral-500">Package mix</span>
              <div className="flex h-3 gap-0.5 overflow-hidden rounded-full">
                {v.sizes.map((s, i) => (
                  <div key={s.size} title={`${s.size}: ${Math.round(s.share * 100)}%`} style={{ flex: `${s.share} 1 0`, background: SIZE_COLORS[i % SIZE_COLORS.length] }} />
                ))}
              </div>
              <div className="flex flex-wrap gap-3.5 text-xs">
                {v.sizes.map((s, i) => (
                  <span key={s.size} className="flex items-center gap-1.5">
                    <Dot color={SIZE_COLORS[i % SIZE_COLORS.length]} />
                    <span className={MUTED}>{s.size}</span>
                    <span className="font-mono">{Math.round(s.share * 100)}%</span>
                  </span>
                ))}
              </div>
            </div>
          )}
        </section>

        <section className={`${CARD} flex min-w-0 flex-[1_1_380px] flex-col gap-3.5`}>
          <div className="flex flex-wrap items-start justify-between gap-2.5">
            <div>
              <h2 className="text-[15px] font-semibold text-neutral-100">Chain coverage</h2>
              <p className={`text-[12.5px] ${MUTED}`}>Stores buying each listed item (last 90 days)</p>
            </div>
            <button type="button" onClick={() => onOpenTool("gap")} className="text-[13px] font-semibold text-[#9edc7f] hover:text-[#c3ecae]">
              Gap Report →
            </button>
          </div>
          <div className="flex flex-col gap-3">
            {!cov ? (
              <p className={`text-sm ${MUTED}`}>{coverage.err ?? "Checking chain stores…"}</p>
            ) : cov.length ? (
              cov.slice(0, 8).map((c) => (
                <div key={`${c.chain}|${c.status}|${c.product}|${c.size}`} className="flex flex-col gap-1.5">
                  <div className="flex items-center justify-between gap-2.5 text-[13.5px]">
                    <span className="flex min-w-0 items-center gap-2">
                      <span className={`shrink-0 rounded-full px-2 py-0.5 text-[11px] font-semibold ${c.status === "mandate" ? TAG.gap : TAG.chain}`}>{c.status === "mandate" ? "Mandate" : "Flex"}</span>
                      <span className="shrink-0 font-medium text-neutral-200">{c.chain}</span>
                      <span className={`truncate text-[12.5px] ${MUTED}`}>
                        {c.product} {c.size}
                      </span>
                    </span>
                    <span className="whitespace-nowrap font-mono">
                      {c.buying}/{c.stores}
                    </span>
                  </div>
                  <div className="h-2 overflow-hidden rounded-full bg-neutral-800/70">
                    <div className="h-full rounded-full" style={{ width: `${(c.buying / c.stores) * 100}%`, background: c.buying === c.stores ? "#6abc46" : c.status === "mandate" ? "#ef8a75" : "#a08cf0" }} />
                  </div>
                </div>
              ))
            ) : (
              <p className={`text-sm ${MUTED}`}>No Chain Mandates or Chain Authorizations items{dist ? ` for ${dist}'s stores` : ""}.</p>
            )}
          </div>
        </section>

        <section className={`${CARD} flex min-w-0 flex-[1_1_380px] flex-col gap-2.5`}>
          <div>
            <h2 className="text-[15px] font-semibold text-neutral-100">Rep activity</h2>
            <p className={`text-[12.5px] ${MUTED}`}>{pLabel}</p>
          </div>
          <div className="grid grid-cols-[minmax(0,1.6fr)_repeat(4,minmax(0,1fr))] gap-2 border-b border-neutral-800/70 pb-1.5 text-[11px] text-neutral-500">
            <span>Rep</span>
            <button
              type="button"
              onClick={routeNew.dismiss}
              title="Maintenance route: route accounts checked in this two-month period, out of all accounts on the route"
              className="flex items-center justify-end gap-1 text-right"
            >
              {routeNew.isNew && <NewBadge inline />}
              Route
            </button>
            <span className="text-right">Check-ins</span>
            <span className="text-right">New</span>
            <span className="text-right">Won back</span>
          </div>
          {v.reps.map((r) => {
            const mine = (routes ?? []).filter((x) => x.rep.trim().toLowerCase().split(/\s+/)[0] === r.rep.toLowerCase());
            const tot = mine.reduce((t, x) => t + (Number(x.total) || 0), 0);
            const vis = mine.reduce((t, x) => t + (Number(x.visited) || 0), 0);
            return (
            <div key={r.rep} className="grid grid-cols-[minmax(0,1.6fr)_repeat(4,minmax(0,1fr))] items-center gap-2 py-1.5 text-[13.5px]">
              <span className="flex min-w-0 flex-col">
                <span className="font-semibold text-neutral-100">{r.rep}</span>
                <span className="truncate text-[11.5px] text-neutral-500">{r.territory}</span>
              </span>
              <span className="text-right font-mono" title={tot ? `${Math.round((vis / tot) * 100)}% of route accounts checked in this period` : undefined}>
                {routes === null ? "…" : tot ? `${vis}/${tot}` : "—"}
              </span>
              <span className="text-right font-mono">{r.checkins === null ? "—" : fmtN(r.checkins)}</span>
              <span className="text-right font-mono">{fmtN(r.newA)}</span>
              <span className="text-right font-mono">{fmtN(r.won)}</span>
            </div>
            );
          })}
          {!home.has_accounts && <p className="text-[11px] text-neutral-500">Check-ins show for people with Sales → Accounts access.</p>}
        </section>
      </div>

      {/* Distributor pop-up */}
      {openDist && (
        <Modal
          title={`${openDist} — biggest immediate impacts`}
          sub={`Ranked by cases a year at stake · rep ${repName(openDist)}`}
          onClose={() => setOpenDist(null)}
          actions={
            <>
              <Link href={accountsLink({ dist: openDist })} className="inline-flex min-h-8 items-center rounded-full border border-neutral-700 px-3 text-xs font-semibold text-neutral-300 hover:border-[#6abc46]/40 hover:text-neutral-100">
                Open in Accounts
              </Link>
              <ExportButton label={`Export for ${openDist}`} onClick={() => exportDistributor(openDist)} busy={busy === `dist:${openDist}`} />
            </>
          }
        >
          <div className="flex flex-col">
            {openImpacts.slice(0, 5).map((it, i) => (
              <Row
                key={`${it.kind}-${it.title}`}
                left={
                  <span className="flex items-center gap-3">
                    <span className="w-5 font-mono text-[13px] text-neutral-500">{i + 1}</span>
                    <Tag kind={it.kind}>{it.label}</Tag>
                  </span>
                }
                title={it.title}
                sub={it.sub}
                value={fmtN(it.ce)}
                valueLabel="cases / yr"
                href={it.href}
                onClick={
                  it.row
                    ? () => {
                        const r = it.row!;
                        setOpenDist(null);
                        onOpenStore(r);
                      }
                    : undefined
                }
              />
            ))}
            {!openImpacts.length && <p className={`py-4 text-sm ${MUTED}`}>Nothing needs attention at {openDist} right now.</p>}
          </div>
          {openImpacts.length > 5 && <p className="mt-2 text-xs text-neutral-500">Top 5 of {openImpacts.length} — the export has all of them.</p>}
        </Modal>
      )}

      {/* All win backs */}
      {allWb && (
        <Modal
          title={`Win backs — ${scope}`}
          sub={`${pLabel} · ${v.wins.length} account${v.wins.length === 1 ? "" : "s"} ordered again after 61+ days`}
          onClose={() => setAllWb(false)}
          actions={<ExportButton onClick={exportWins} busy={busy === "wb"} />}
        >
          <div className="flex max-h-[65vh] flex-col overflow-y-auto">
            {v.wins.map((w) => (
              <Row
                key={`${w.outlet_id}-${w.d}`}
                left={<Tag kind={w.gap > 90 ? "wl" : "wp"}>{w.gap > 90 ? "From Lost" : "From Pot. lost"}</Tag>}
                title={`${w.name}${w.city ? ` · ${w.city}` : ""}`}
                sub={`Back ${fmtDay(w.d)}${w.items ? ` with ${w.items}` : ""} · ${w.dist}${w.checkin ? ` · ${w.checkin.rep ?? "someone"} checked in ${fmtDay(w.checkin.date)}` : ""}`}
                value={String(w.gap)}
                valueLabel="days gone"
                href={accountsLink({ open: w.outlet_id })}
              />
            ))}
            {!v.wins.length && <p className={`py-4 text-sm ${MUTED}`}>No win backs in this period yet.</p>}
          </div>
        </Modal>
      )}
    </div>
  );
}

// "Fri 10/16/26"
export function fmtWeekdayDay(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(`${iso.slice(0, 10)}T12:00:00Z`);
  return `${d.toLocaleDateString("en-US", { weekday: "short", timeZone: "UTC" })} ${fmtDay(iso)}`;
}

// "today, 4:12 AM" / "yesterday, 4:12 AM" / "Mon 10/19, 4:12 AM" — Pacific time.
export function fmtChecked(ts: string): string {
  const tz = "America/Los_Angeles";
  const when = new Date(ts);
  const dayKey = (d: Date) => d.toLocaleDateString("en-CA", { timeZone: tz });
  const time = when.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", timeZone: tz });
  const now = new Date();
  if (dayKey(when) === dayKey(now)) return `today, ${time}`;
  if (dayKey(when) === dayKey(new Date(now.getTime() - 86400000))) return `yesterday, ${time}`;
  const label = when.toLocaleDateString("en-US", { weekday: "short", month: "numeric", day: "numeric", timeZone: tz });
  return `${label.replace(",", "")}, ${time}`;
}

function Step({ n, children }: { n: number; children: React.ReactNode }) {
  return (
    <p className="flex items-center gap-2 text-[13px] text-neutral-300">
      <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full border border-[#6abc46]/50 bg-[#6abc46]/10 text-[11px] font-semibold text-[#9edc7f]">{n}</span>
      {children}
    </p>
  );
}

// Cases sold by month — last 12 months vs the 12 before, with the hover
// pop-up (Chad 10/21). Shared by the Sales Dashboard home and My Territory.
export function CasesByMonth({ home, dist, scope }: { home: HomeData; dist: string; scope: string }) {
  // Month under the mouse on the Cases sold by month chart (Chad 10/21: hover a
  // peak or valley to see what it is).
  const [hoverMonth, setHoverMonth] = useState<number | null>(null);
  const t = trend(home, dist);
  // Trend chart geometry.
  const W = 760;
  const H = 230;
  const mx = Math.max(1, ...t.ty, ...t.ly);
  const X = (i: number) => (i * W) / 11;
  const Y = (val: number) => 215 - (val / mx) * 190;
  const tyPts = t.ty.map((val, i) => `${X(i).toFixed(1)},${Y(val).toFixed(1)}`).join(" ");
  const lyPts = t.ly.map((val, i) => `${X(i).toFixed(1)},${Y(val).toFixed(1)}`).join(" ");
  const best = Math.max(...t.ty);
  const bestIdx = t.ty.indexOf(best);

  return (
  <section className={`${CARD} flex min-w-0 flex-[999_1_620px] flex-col gap-3.5`}>
    <div className="flex flex-wrap items-center justify-between gap-3">
      <div>
        <h2 className="text-[15px] font-semibold text-neutral-100">Cases sold by month</h2>
        <p className={`text-[12.5px] ${MUTED}`}>{scope} · last 12 months · case equivalents</p>
      </div>
      <div className="flex items-center gap-4 text-[12.5px]">
        <span className="flex items-center gap-1.5 text-neutral-200">
          <span className="inline-block h-[3px] w-4 rounded bg-[#6abc46]" />
          This year
        </span>
        <span className={`flex items-center gap-1.5 ${MUTED}`}>
          <span className="inline-block w-4 border-t-2 border-dashed border-neutral-500" />
          Last year
        </span>
      </div>
    </div>
    <div className="relative h-[230px]" onMouseLeave={() => setHoverMonth(null)}>
      <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" className="absolute inset-0 block h-[230px] w-full" role="img" aria-label={`Cases sold by month, this year versus last year, ${scope}`}>
        <defs>
          <linearGradient id="home-tyfill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="#6abc46" stopOpacity="0.28" />
            <stop offset="1" stopColor="#6abc46" stopOpacity="0" />
          </linearGradient>
        </defs>
        {[20, 85, 150].map((y) => (
          <line key={y} x1="0" y1={y} x2={W} y2={y} stroke="#1b2420" strokeWidth="1" />
        ))}
        <line x1="0" y1="215" x2={W} y2="215" stroke="#24302a" strokeWidth="1" />
        <path d={`M0,215 L${tyPts.split(" ").join(" L")} L${W},215 Z`} fill="url(#home-tyfill)" />
        <polyline points={lyPts} fill="none" stroke="#6f7f77" strokeWidth="2" strokeDasharray="5 5" vectorEffect="non-scaling-stroke" />
        <polyline points={tyPts} fill="none" stroke="#6abc46" strokeWidth="2.5" strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
        {hoverMonth !== null && <line x1={X(hoverMonth)} y1="10" x2={X(hoverMonth)} y2="215" stroke="#8fd16f" strokeOpacity="0.45" strokeWidth="1" strokeDasharray="3 4" vectorEffect="non-scaling-stroke" />}
      </svg>
      {/* Hover zones, one per month, plus the dots and the pop-up */}
      <div className="absolute inset-0 overflow-hidden">
        {t.months.map((m, i) => (
          <div
            key={m}
            className="h-full cursor-crosshair"
            style={{ position: "absolute", left: `${((i - 0.5) / 11) * 100}%`, width: `${100 / 11}%` }}
            onMouseEnter={() => setHoverMonth(i)}
            onClick={() => setHoverMonth(i)}
          />
        ))}
      </div>
      {hoverMonth !== null && (
        <>
          <span className="pointer-events-none absolute h-2.5 w-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-neutral-950 bg-[#6abc46] shadow-[0_0_10px_#6abc46]" style={{ left: `${(hoverMonth / 11) * 100}%`, top: Y(t.ty[hoverMonth]) }} />
          <span className="pointer-events-none absolute h-2 w-2 -translate-x-1/2 -translate-y-1/2 rounded-full bg-neutral-400" style={{ left: `${(hoverMonth / 11) * 100}%`, top: Y(t.ly[hoverMonth]) }} />
          <div
            className="pointer-events-none absolute top-1 z-10 w-max min-w-[190px] rounded-xl border border-[#6abc46]/40 bg-neutral-950/95 px-3.5 py-2.5 text-[12.5px] shadow-xl"
            style={{
              left: `${(hoverMonth / 11) * 100}%`,
              // Beside the point, never on top of it.
              transform: `translateX(${hoverMonth <= 5 ? "14px" : "calc(-100% - 14px)"})`,
            }}
          >
            {(() => {
              const m = t.months[hoverMonth];
              const lyMonth = `${+m.slice(0, 4) - 1}${m.slice(4)}`;
              const tyV = t.ty[hoverMonth];
              // The month still going is compared with the same days last year
              // (last year's month, split by days — it's a monthly total).
              const partial = hoverMonth === 11 && t.partial;
              const asOfDay = home.as_of ? +home.as_of.slice(8, 10) : 0;
              const monthDays = new Date(Date.UTC(+m.slice(0, 4), +m.slice(5, 7), 0)).getUTCDate();
              const lyV = partial ? (t.ly[hoverMonth] * asOfDay) / monthDays : t.ly[hoverMonth];
              const isBest = hoverMonth === bestIdx;
              const isLow = tyV === Math.min(...t.ty);
              return (
                <>
                  <div className="mb-1 flex items-center gap-2 font-semibold text-neutral-100">
                    {monthLabel(m)} {m.slice(0, 4)}
                    {hoverMonth === 11 && t.partial && <span className="font-normal text-neutral-500">so far (through {fmtDay(home.as_of)})</span>}
                  </div>
                  <div className="flex items-center justify-between gap-4">
                    <span className="flex items-center gap-1.5 text-neutral-300">
                      <span className="inline-block h-[3px] w-3 rounded bg-[#6abc46]" />
                      Cases sold
                    </span>
                    <span className="font-mono text-neutral-50">{fmtN(tyV)}</span>
                  </div>
                  <div className="flex items-center justify-between gap-4">
                    <span className="flex items-center gap-1.5 text-neutral-400">
                      <span className="inline-block w-3 border-t-2 border-dashed border-neutral-500" />
                      {partial ? `${monthLabel(lyMonth)} 1–${asOfDay}, ${lyMonth.slice(0, 4)} (est.)` : `${monthLabel(lyMonth)} ${lyMonth.slice(0, 4)}`}
                    </span>
                    <span className="font-mono text-neutral-300">{fmtN(lyV)}</span>
                  </div>
                  <div className="mt-1.5 flex items-center gap-2">
                    <Change value={pctChange(tyV, lyV)} />
                    <span className="text-neutral-500">vs last year</span>
                    {isBest && <span className="rounded-full bg-[#6abc46]/15 px-2 py-0.5 text-[11px] font-semibold text-[#9edc7f]">Best month</span>}
                    {isLow && !isBest && !partial && <span className="rounded-full bg-red-500/15 px-2 py-0.5 text-[11px] font-semibold text-[#ffab9c]">Lowest month</span>}
                  </div>
                </>
              );
            })()}
          </div>
        </>
      )}
    </div>
    <div className="flex justify-between text-[11px] text-neutral-500">
      {t.months.map((m, i) => (
        <span key={m}>
          {monthLabel(m)}
          {i === 11 && t.partial ? "*" : ""}
        </span>
      ))}
    </div>
    <div className="flex flex-wrap gap-7 border-t border-neutral-800/70 pt-3.5">
      <Stat value={fmtN(kpis(home, "ytd", dist).cases)} label="Cases year to date" />
      <Stat value={fmtN(kpis(home, "ytd", dist).casesLy)} label="Same days last year" />
      <div className="flex flex-col gap-0.5">
        <span className="text-xl">
          <Change value={pctChange(kpis(home, "ytd", dist).cases, kpis(home, "ytd", dist).casesLy)} />
        </span>
        <span className="text-[11px] text-neutral-500">Change</span>
      </div>
      <Stat value={fmtN(best)} label={`Best month (${monthLabel(t.months[bestIdx] ?? t.months[0])})`} />
    </div>
    {t.partial && <p className="text-[11px] text-neutral-500">* {monthLabel(t.months[11])} so far (through {fmtDay(home.as_of)}).</p>}
  </section>
  );
}

const SIZE_COLORS = ["#6abc46", "#5aa9f0", "#3fc9b0", "#f0a63c", "#a08cf0", "#ef8fb0", "#e0c45a", "#7d8782"];

export function Stat({ value, label, color }: { value: string; label: string; color?: string }) {
  return (
    <div className="flex flex-col gap-0.5">
      <span className="font-mono text-2xl font-light" style={{ color: color ?? "#f2f7f0" }}>
        {value}
      </span>
      <span className="text-[11px] text-neutral-500">{label}</span>
    </div>
  );
}
