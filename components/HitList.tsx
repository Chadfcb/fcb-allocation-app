"use client";

// Hit lists (2026-11-24, per Chad): call lists built from three spreadsheets
// (SF Off Prem, Off Prem Ryan, rep plan) with every number taken live from the
// sales data instead of the spreadsheets' June / April numbers. Plan:
// claude/hit-lists-plan.md. Data: hit_list(list) / hit_list_account(outlet) —
// sql/hit_lists.sql.
//
//   Distributors → Matagrano / Valley Wide / Mussetter → Today's priorities →
//   "Hit list" button (DistributorPageClient uses useHitList + HitListBody).
//   Sales Dashboard → "Top 100 rep plan" block (RepPlanBlock, one tab per rep).
//
// Status is worked out from the last order: Buying (60 days or less), Slipping
// (61–90), Lapsed (91 days – 1 year), Dormant (over a year). An account that was
// lapsed on the spreadsheet and has ordered since the spreadsheet's date is
// "Won back" — it stays on the list, at the bottom.

import { useEffect, useMemo, useState } from "react";
import type { createClient } from "@/lib/supabase/client";
import { useNewFeature } from "@/lib/newFeatures";
import NewBadge from "@/components/NewBadge";
import { CARD, Dot, ExportButton, MUTED, Pill, exportSheets } from "@/components/SalesDashboardHome";
import { fmtDay, fmtN } from "@/lib/salesDashHome";

type Supa = ReturnType<typeof createClient>;

export interface HitAccount {
  outlet_id: string;
  sort: number;
  section: string | null;
  priority: string | null;
  rep: string | null;
  list_name: string;
  list_distributor: string | null;
  list_city: string | null;
  play: string | null;
  why: string | null;
  peak_skus: number | null;
  current_skus: number | null;
  sheet_status: string | null;
  sheet_last_buy: string | null;
  name: string;
  city: string | null;
  address: string | null;
  phone: string | null;
  premise: string | null;
  distributor: string | null;
  last_buy: string | null;
  last_dist: string | null;
  ce_12mo: number;
  ce_since: number;
  bought_since: string | null;
  last_checkin: string | null;
  last_checkin_rep: string | null;
  contacts: number;
}
export interface HitData {
  as_of: string | null;
  list: { key: string; title: string; distributor: string | null; data_through: string; source: string | null };
  accounts: HitAccount[];
}

// Which distributor page shows which list.
export const HIT_LIST_BY_DIST: Record<string, string> = {
  Matagrano: "matagrano-sf",
  "Valley Wide": "valley-wide-cv",
  Mussetter: "mussetter-cv",
};
export const REP_PLAN_LIST = "rep-plan-top100";
export const REP_PLAN_REPS = ["Lance", "Steve", "Ryan", "Eric"] as const;

export function useHitList(supabase: Supa, listKey: string | null, version: number, onError?: (m: string) => void) {
  const [data, setData] = useState<HitData | null>(null);
  useEffect(() => {
    if (!listKey) return;
    let cancelled = false;
    supabase.rpc("hit_list", { p_list: listKey }).then(({ data: d, error }) => {
      if (cancelled) return;
      if (error) onError?.(error.message);
      else setData(d as HitData);
    });
    return () => {
      cancelled = true;
    };
    // onError is a plain callback from the page; reload only on list / version.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [supabase, listKey, version]);
  return data;
}

const daysBetween = (a: string, b: string) => Math.round((Date.parse(`${b.slice(0, 10)}T12:00:00Z`) - Date.parse(`${a.slice(0, 10)}T12:00:00Z`)) / 86400000);
// "Apr 2026" from "2026-04-30"
const monthYear = (iso: string) => new Date(Date.parse(`${iso.slice(0, 10)}T12:00:00Z`)).toLocaleDateString("en-US", { month: "short", year: "numeric", timeZone: "UTC" });

// Lapsed on the spreadsheet (not "Buying …") and ordered since its date.
export const isWonBack = (a: HitAccount) => !!a.bought_since && !(a.sheet_status ?? "").startsWith("Buying");

export function hitStatus(a: HitAccount, asOf: string | null): { label: string; color: string } {
  if (isWonBack(a)) return { label: `Won back ${fmtDay(a.bought_since)}`, color: "#6abc46" };
  if (!a.last_buy) return { label: "Never ordered", color: "#9ca3af" };
  const d = asOf ? daysBetween(a.last_buy, asOf) : 0;
  if (d <= 60) return { label: "Buying", color: "#6abc46" };
  if (d <= 90) return { label: "Slipping", color: "#f0a63c" };
  if (d <= 365) return { label: "Lapsed", color: "#ef6a55" };
  return { label: "Dormant", color: "#b45a4f" };
}

// Not-won-back first (in the spreadsheet's order), won back at the bottom.
export function sortHit(list: HitAccount[]): HitAccount[] {
  return [...list].sort((x, y) => Number(isWonBack(x)) - Number(isWonBack(y)) || x.sort - y.sort);
}

function HitRow({ a, asOf, pageDist, showRep, onOpen, href }: { a: HitAccount; asOf: string | null; pageDist: string | null; showRep?: boolean; onOpen?: () => void; href?: string }) {
  const st = hitStatus(a, asOf);
  // Account filed under another distributor than this page / the plan says.
  const expected = pageDist ?? a.list_distributor;
  const other = a.distributor && expected && a.distributor !== expected ? ` · ${a.distributor} account` : "";
  const items = a.peak_skus != null ? ` · carried ${a.peak_skus} items at most, ${a.current_skus ?? 0} in April` : "";
  const line1 = `${a.last_buy ? `Last order ${fmtDay(a.last_buy)}${a.last_dist ? ` from ${a.last_dist}` : ""}` : "No orders on record"}${other}${
    a.last_checkin ? ` · last check-in ${fmtDay(a.last_checkin)}${a.last_checkin_rep ? ` (${a.last_checkin_rep})` : ""}` : " · no check-in on record"
  }`;
  const inner = (
    <>
      <span className="flex w-12 shrink-0 flex-col items-center gap-1 pt-0.5">
        {a.priority ? <span className="text-[12px] leading-none tracking-tight text-[#f7c27a]">{a.priority}</span> : <span className="font-mono text-[12px] text-neutral-400">#{a.sort}</span>}
        <Dot color={st.color} />
      </span>
      <span className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="truncate text-sm font-semibold text-neutral-100">
          {a.name}
          {a.city ? ` · ${a.city}` : ""}
        </span>
        <span className="text-[12.5px]">
          <span className="font-semibold" style={{ color: st.color }}>
            {st.label}
          </span>
          <span className={MUTED}>
            {showRep && a.rep ? ` · ${a.rep} (${a.list_distributor})` : ""} · {line1}
          </span>
        </span>
        {(a.play || a.why) && (
          <span className="line-clamp-2 text-[12px] text-neutral-500">
            {a.play ? `${a.play}${items}. ` : ""}
            {a.why ?? ""}
          </span>
        )}
      </span>
      <span className="flex flex-col items-end text-right">
        <span className="font-mono text-[15px] text-neutral-50">{fmtN(Number(a.ce_12mo) || 0)}</span>
        <span className="text-[11px] text-neutral-500">CEs last 12 mo</span>
      </span>
    </>
  );
  const cls = "flex w-full items-start gap-3 rounded-lg border-t border-neutral-800/70 px-2.5 py-3 text-left first:border-t-0";
  if (href)
    return (
      <a href={href} className={cls}>
        {inner}
      </a>
    );
  return (
    <button type="button" onClick={onOpen} className={cls}>
      {inner}
    </button>
  );
}

// ---------------------------------------------------------------------------
// Export
// ---------------------------------------------------------------------------
export async function exportHitList(data: HitData, list: HitAccount[], fileLabel: string) {
  const isRep = data.list.key === REP_PLAN_LIST;
  const cols = [
    ...(isRep ? [{ header: "Rank", key: "rank", width: 6 }, { header: "Rep", key: "rep", width: 10 }] : [{ header: "Priority", key: "pri", width: 8 }]),
    { header: "Account", key: "name", width: 32 },
    { header: "City", key: "city" },
    { header: "Address", key: "address", width: 28 },
    { header: "Phone", key: "phone" },
    { header: "Status now", key: "status", width: 16 },
    { header: "Last order", key: "lb" },
    { header: "Last bought from", key: "from", width: 20 },
    { header: "CEs last 12 mo", key: "ce12", width: 10 },
    { header: `CEs since ${monthYear(data.list.data_through)}`, key: "since", width: 10 },
    { header: "Last check-in", key: "checkin" },
    { header: "Checked in by", key: "ckrep", width: 14 },
    { header: "Contacts on file", key: "contacts", width: 10 },
    ...(isRep
      ? [
          { header: "Play", key: "play", width: 22 },
          { header: "Most items carried", key: "peak", width: 10 },
          { header: "Items in April", key: "cur", width: 10 },
        ]
      : [{ header: "Group on the list", key: "section", width: 16 }]),
    { header: "Status on the spreadsheet", key: "sheet", width: 18 },
    { header: "Why it's on the list", key: "why", width: 60 },
    { header: "Name on the spreadsheet", key: "lname", width: 30 },
    { header: "Account's distributor", key: "dist", width: 18 },
    { header: "Outlet ID", key: "id", width: 12 },
  ];
  const rows = list.map((a) => ({
    rank: a.sort,
    rep: a.rep ?? "",
    pri: a.priority ?? "",
    name: a.name,
    city: a.city ?? "",
    address: a.address ?? "",
    phone: a.phone ?? "",
    status: hitStatus(a, data.as_of).label,
    lb: a.last_buy ?? "",
    from: a.last_dist ?? "",
    ce12: Number(a.ce_12mo) || 0,
    since: Number(a.ce_since) || 0,
    checkin: a.last_checkin ?? "",
    ckrep: a.last_checkin_rep ?? "",
    contacts: a.contacts,
    play: a.play ?? "",
    peak: a.peak_skus ?? "",
    cur: a.current_skus ?? "",
    section: a.section ?? "",
    sheet: `${a.sheet_status ?? ""}${a.sheet_last_buy ? ` (last buy ${a.sheet_last_buy})` : ""}`,
    why: a.why ?? "",
    lname: a.list_name,
    dist: a.distributor ?? "",
    id: a.outlet_id,
  }));
  await exportSheets(`${fileLabel} - ${data.as_of ?? ""}.xlsx`, [
    { name: data.list.title.slice(0, 31), title: `${fileLabel} · live numbers through ${fmtDay(data.as_of)} · spreadsheet: ${data.list.source ?? ""}`, cols, rows },
  ]);
}

// ---------------------------------------------------------------------------
// Distributor page: the list inside Today's priorities ("Hit list" button).
// ---------------------------------------------------------------------------
export const HIT_RULE =
  "Accounts to go after, from the re-engagement spreadsheets (June 2026). Status, last order and CEs are live from the sales data — an account that orders again shows as Won back and moves to the bottom. Click an account for its full history.";

export function HitListBody({ data, view, setView, onOpen }: { data: HitData | null; view: "todo" | "won"; setView: (v: "todo" | "won") => void; onOpen: (id: string) => void }) {
  if (!data) return <p className={`py-4 text-sm ${MUTED}`}>Loading…</p>;
  const won = sortHit(data.accounts.filter(isWonBack));
  const todo = sortHit(data.accounts.filter((a) => !isWonBack(a)));
  const shown = view === "won" ? won : todo;
  return (
    <>
      <div className="flex flex-wrap items-center gap-2">
        <Pill on={view === "todo"} onClick={() => setView("todo")}>
          To go after <span className="font-mono opacity-80">{todo.length}</span>
        </Pill>
        <Pill on={view === "won"} onClick={() => setView("won")}>
          Won back <span className="font-mono opacity-80">{won.length}</span>
        </Pill>
        <span className="text-[11px] text-neutral-500">Export follows this choice</span>
      </div>
      <div className="flex max-h-[380px] flex-col overflow-y-auto pr-1">
        {shown.length ? (
          shown.map((a) => <HitRow key={a.outlet_id} a={a} asOf={data.as_of} pageDist={data.list.distributor} onOpen={() => onOpen(a.outlet_id)} />)
        ) : (
          <p className={`py-4 text-sm ${MUTED}`}>{view === "won" ? "None won back yet." : "Nothing here right now."}</p>
        )}
      </div>
    </>
  );
}
export const hitShown = (data: HitData | null, view: "todo" | "won") => sortHit((data?.accounts ?? []).filter((a) => (view === "won" ? isWonBack(a) : !isWonBack(a))));

// ---------------------------------------------------------------------------
// Sales Dashboard: Top 100 rep plan block, one tab per rep.
// ---------------------------------------------------------------------------
export function RepPlanBlock({ supabase, version }: { supabase: Supa; version: number }) {
  const [err, setErr] = useState<string | null>(null);
  const data = useHitList(supabase, REP_PLAN_LIST, version, setErr);
  const [rep, setRep] = useState<string>("all");
  const [busy, setBusy] = useState(false);
  const isNew = useNewFeature("feature:sales-rep-plan");
  const shown = useMemo(() => (data?.accounts ?? []).filter((a) => rep === "all" || a.rep === rep).sort((x, y) => x.sort - y.sort), [data, rep]);
  const count = (r: string) => (data ? data.accounts.filter((a) => r === "all" || a.rep === r).length : null);
  const buying = shown.filter((a) => hitStatus(a, data?.as_of ?? null).label === "Buying" || isWonBack(a)).length;
  return (
    <section className={`${CARD} flex flex-col gap-3`}>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-[15px] font-semibold text-neutral-100">
            <button type="button" onClick={() => isNew.dismiss()} className="flex items-center gap-2 text-left">
              Top 100 rep plan {isNew.isNew && <NewBadge inline />}
            </button>
          </h2>
          <p className={`text-[12.5px] ${MUTED}`}>
            Each rep&apos;s best off-premise accounts to grow or win back (Top 100 Off-Premise Attack Plan) — status, last order and CEs are live
            {data?.as_of ? ` through ${fmtDay(data.as_of)}` : ""}. Click an account for its details.
          </p>
        </div>
        <ExportButton
          busy={busy}
          onClick={async () => {
            if (!data) return;
            setBusy(true);
            try {
              await exportHitList(data, shown, `Top 100 rep plan${rep === "all" ? "" : ` - ${rep}`}`);
            } finally {
              setBusy(false);
            }
          }}
        />
      </div>
      <div className="flex flex-wrap gap-2">
        {(["all", ...REP_PLAN_REPS] as string[]).map((r) => {
          const d = data?.accounts.find((a) => a.rep === r)?.list_distributor;
          return (
            <Pill
              key={r}
              on={rep === r}
              onClick={() => {
                setRep(r);
                isNew.dismiss();
              }}
            >
              {r === "all" ? "All reps" : `${r}${d ? ` · ${d}` : ""}`} <span className="font-mono opacity-80">{count(r) ?? "…"}</span>
            </Pill>
          );
        })}
      </div>
      {data && (
        <p className="text-xs text-neutral-500">
          {buying} of {shown.length} ordered in the last 60 days. Ranked best opportunity first (the plan&apos;s ranking). &quot;Items in April&quot; and the play are from the
          plan (VIP data through April 2026).
        </p>
      )}
      {err && <p className="text-sm text-red-300">{err}</p>}
      <div className="flex max-h-[460px] flex-col overflow-y-auto pr-1">
        {!data && !err ? (
          <p className={`py-4 text-sm ${MUTED}`}>Loading…</p>
        ) : (
          shown.map((a) => <HitRow key={a.outlet_id} a={a} asOf={data?.as_of ?? null} pageDist={null} showRep={rep === "all"} href={`/sales/accounts?${new URLSearchParams({ open: a.outlet_id }).toString()}`} />)
        )}
      </div>
    </section>
  );
}
