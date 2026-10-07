"use client";

// Sales > Accounts (added 2026-10-07, per Chad + Art). Built from the approved
// "FCB Accounts Preview" (project doc claude/accounts-preview.md): stage
// boxes, a by-rep table, search + filters, a sortable account list, and a
// side panel per account with its purchase history chart, products and
// contacts. Admins get an Import data panel (full replace from the import
// file made from Chad's spreadsheets — later, Lilypad exports).
//
// Stages come from lib/salesAccounts.ts, measured as of the data's own
// "as of" date (last buy date in the import), not today.
//
// Classifications (Feature 2, added 2026-10-07): owner type (FCB / Buddy /
// Distributor / Cadence, Former is automatic), tier A/B/C, handled by, and
// the SOP tags. Stored in sales_account_class — separate from the imported
// data so a re-import never wipes them — edited in the account panel or in
// bulk (check rows → bulk bar), live for everyone via Supabase Realtime, and
// every change goes to the Audit Log.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import {
  BIG_LOST_CE,
  HANDLED_CHOICES,
  HANDLED_LABEL,
  OWNER_CHOICES,
  OWNER_INFO,
  OWNER_ORDER,
  TAGS,
  TIERS,
  joinTags,
  ownerShown,
  parseTags,
  type HandledBy,
  type OwnerShown,
  type OwnerType,
  type SalesAccountCheckinRow,
  type SalesAccountClassRow,
  type Tier,
  NO_REP_DISTRIBUTORS,
  NO_REP_KEY,
  REPS,
  STAGE_INFO,
  STAGE_ORDER,
  daysBetween,
  isLostBig,
  repFor,
  stageFor,
  type AccountStage,
  type ImportFile,
  type SalesAccountContactRow,
  type SalesAccountRow,
  type SalesAccountSaleRow,
} from "@/lib/salesAccounts";

type Account = SalesAccountRow & {
  stage: AccountStage;
  rep: string | null;
  repKey: string | null;
  big: boolean;
  daysDark: number | null;
  search: string;
  owner: OwnerShown;
  tier: Tier | null;
  handled: HandledBy | null;
  tags: string[];
  cls: SalesAccountClassRow | null;
  lastCheckin: string | null;
};

type SortKey =
  | "name"
  | "distributor"
  | "rep"
  | "stage"
  | "owner"
  | "tier"
  | "handled"
  | "lastCheckin"
  | "last_buy_date"
  | "daysDark"
  | "ce_12mo"
  | "lifetime_ce"
  | "premise";

interface Filters {
  stage: AccountStage | null;
  owner: OwnerShown | null;
  rep: string;
  dist: string;
  prem: string;
  tier: string;
  handled: string;
  tag: string;
  big: boolean;
  hasContact: boolean;
  sort: SortKey;
  asc: boolean;
}

const DEFAULT_FILTERS: Filters = {
  stage: null,
  owner: null,
  rep: "",
  dist: "",
  prem: "",
  tier: "",
  handled: "",
  tag: "",
  big: false,
  hasContact: false,
  sort: "ce_12mo",
  asc: false,
};
type ClassPatch = Partial<Pick<SalesAccountClassRow, "owner_type" | "tier" | "handled_by" | "tags">>;
const CLASS_FIELDS: (keyof ClassPatch)[] = ["owner_type", "tier", "handled_by", "tags"];
const STORAGE_KEY = "fcb-sales-accounts-filters";
const VIEW_KEY = "fcb-sales-accounts-view";
const PAGE_SIZE = 100;
const FETCH_SIZE = 1000;
const COLUMNS =
  "outlet_id,name,address,city,zip,phone,distributor,premise,best_day,last_buy_date,lifetime_ce,ce_12mo,buy_months_6,contact_count,report_buy_date,report_note";

const fmt = (n: number | null | undefined) =>
  n == null ? "—" : Number(n).toLocaleString("en-US", { maximumFractionDigits: 1 });
const fdate = (s: string | null | undefined) => {
  if (!s) return "—";
  const [y, m, d] = s.slice(0, 10).split("-");
  return `${+m}/${+d}/${y}`;
};
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function StagePill({ stage }: { stage: AccountStage }) {
  const c = STAGE_INFO[stage].color;
  return (
    <span
      className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-semibold text-neutral-100"
      style={{ background: `${c}2e`, border: `1px solid ${c}73` }}
    >
      <span className="h-1.5 w-1.5 rounded-full" style={{ background: c }} />
      {STAGE_INFO[stage].label}
    </span>
  );
}

function BigTag() {
  return (
    <span className="ml-1.5 rounded border border-red-500/50 px-1.5 py-px text-[10px] font-bold tracking-wide text-red-400">BIG</span>
  );
}

function OwnerPill({ owner }: { owner: OwnerShown }) {
  const c = OWNER_INFO[owner].color;
  return (
    <span className="inline-flex items-center gap-1.5 whitespace-nowrap rounded px-2 py-0.5 text-xs font-medium text-neutral-100" style={{ background: `${c}24`, border: `1px solid ${c}66` }}>
      {OWNER_INFO[owner].label.replace(" Account", "")}
    </span>
  );
}

// Saves classification changes for one or many accounts, then writes each
// changed field to the Audit Log (one insert for the whole batch).
async function saveClassChanges(
  supabase: ReturnType<typeof createClient>,
  userId: string | null,
  changes: { account: Account; patch: ClassPatch }[],
): Promise<string | null> {
  const now = new Date().toISOString();
  const rows = changes.map(({ account, patch }) => ({ outlet_id: account.outlet_id, ...patch, updated_at: now, updated_by: userId }));
  for (let i = 0; i < rows.length; i += 500) {
    const { data, error } = await supabase
      .from("sales_account_class")
      .upsert(rows.slice(i, i + 500), { onConflict: "outlet_id" })
      .select("id,outlet_id");
    if (error) return error.message;
    if (userId) {
      const idByOutlet = new Map((data ?? []).map((d) => [d.outlet_id as string, d.id as string]));
      const audit: Record<string, unknown>[] = [];
      for (const { account, patch } of changes.slice(i, i + 500)) {
        const id = idByOutlet.get(account.outlet_id);
        if (!id) continue;
        for (const f of CLASS_FIELDS) {
          if (!(f in patch)) continue;
          const oldV = account.cls ? account.cls[f] : null;
          const newV = patch[f];
          if (String(oldV ?? "") === String(newV ?? "")) continue;
          audit.push({
            week_id: null,
            table_name: "sales_account_class",
            record_id: id,
            field_name: f,
            old_value: oldV == null ? null : String(oldV),
            new_value: newV == null ? null : String(newV),
            changed_by: userId,
          });
        }
      }
      if (audit.length) await supabase.from("audit_log").insert(audit);
    }
  }
  return null;
}

export default function SalesAccountsClient({ isAdmin }: { isAdmin: boolean }) {
  const supabase = useMemo(() => createClient(), []);
  const [rows, setRows] = useState<SalesAccountRow[]>([]);
  const [asOf, setAsOf] = useState<string | null>(null);
  const [importedAt, setImportedAt] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadMsg, setLoadMsg] = useState("Loading accounts…");
  const [error, setError] = useState<string | null>(null);

  const [filters, setFilters] = useState<Filters>(DEFAULT_FILTERS);
  const [query, setQuery] = useState("");
  const [page, setPage] = useState(0);
  const [openId, setOpenId] = useState<string | null>(null);
  const [showImport, setShowImport] = useState(false);
  const [classes, setClasses] = useState<Map<string, SalesAccountClassRow>>(new Map());
  const [lastCheckins, setLastCheckins] = useState<Map<string, string>>(new Map());
  const [userId, setUserId] = useState<string | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulkMsg, setBulkMsg] = useState<string | null>(null);
  const closePanel = useCallback(() => setOpenId(null), []);
  // Two views (Chad, 2026-10-07: "lets put the classification part in its own
  // area in there, its making the main screen too cluttered"):
  //   overview  — stages, by-rep table, sales columns (the original screen)
  //   classify  — owner / tier / handled by / tags / last check-in + bulk edit
  const [view, setView] = useState<"overview" | "classify">("overview");
  useEffect(() => {
    try {
      if (localStorage.getItem(VIEW_KEY) === "classify") setView("classify");
    } catch {
      // ignore
    }
  }, []);
  const switchView = (v: "overview" | "classify") => {
    setView(v);
    setPage(0);
    try {
      localStorage.setItem(VIEW_KEY, v);
    } catch {
      // ignore
    }
  };
  const isC = view === "classify";

  // Remembered filters (per browser)
  useEffect(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved) setFilters({ ...DEFAULT_FILTERS, ...(JSON.parse(saved) as Partial<Filters>) });
    } catch {
      // ignore
    }
  }, []);
  const updateFilters = useCallback((patch: Partial<Filters>) => {
    setFilters((prev) => {
      const next = { ...prev, ...patch };
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
      } catch {
        // ignore
      }
      return next;
    });
    setPage(0);
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    const { data: meta } = await supabase.from("sales_data_meta").select("as_of,imported_at").eq("id", 1).maybeSingle();
    setAsOf((meta?.as_of as string | null) ?? null);
    setImportedAt((meta?.imported_at as string | null) ?? null);
    const { count, error: countError } = await supabase.from("sales_accounts").select("outlet_id", { count: "exact", head: true });
    if (countError) {
      setError(countError.message);
      setLoading(false);
      return;
    }
    const total = count ?? 0;
    const all: SalesAccountRow[] = [];
    const pages = Math.ceil(total / FETCH_SIZE);
    for (let start = 0; start < pages; start += 6) {
      const batch = await Promise.all(
        Array.from({ length: Math.min(6, pages - start) }, (_, i) => {
          const from = (start + i) * FETCH_SIZE;
          return supabase.from("sales_accounts").select(COLUMNS).order("outlet_id").range(from, from + FETCH_SIZE - 1);
        }),
      );
      for (const res of batch) {
        if (res.error) {
          setError(res.error.message);
          setLoading(false);
          return;
        }
        all.push(...((res.data ?? []) as unknown as SalesAccountRow[]));
      }
      setLoadMsg(`Loading accounts… ${all.length.toLocaleString()} of ${total.toLocaleString()}`);
    }
    // Classifications (separate table, survives re-imports)
    const cls = new Map<string, SalesAccountClassRow>();
    for (let from = 0; ; from += FETCH_SIZE) {
      const { data, error: clsError } = await supabase
        .from("sales_account_class")
        .select("*")
        .order("outlet_id")
        .range(from, from + FETCH_SIZE - 1);
      if (clsError) {
        setError(clsError.message);
        break;
      }
      for (const r of (data ?? []) as SalesAccountClassRow[]) cls.set(r.outlet_id, r);
      if (!data || data.length < FETCH_SIZE) break;
    }
    // Last check-in date per account (the panel loads the notes)
    const last = new Map<string, string>();
    for (let from = 0; ; from += FETCH_SIZE) {
      const { data, error: ckError } = await supabase
        .from("sales_account_checkins")
        .select("outlet_id,checkin_date")
        .order("id")
        .range(from, from + FETCH_SIZE - 1);
      if (ckError) break;
      for (const r of (data ?? []) as { outlet_id: string; checkin_date: string }[]) {
        const cur = last.get(r.outlet_id);
        if (!cur || r.checkin_date > cur) last.set(r.outlet_id, r.checkin_date);
      }
      if (!data || data.length < FETCH_SIZE) break;
    }
    setLastCheckins(last);
    const {
      data: { user },
    } = await supabase.auth.getUser();
    setUserId(user?.id ?? null);
    setClasses(cls);
    setRows(all);
    setLoading(false);
  }, [supabase]);

  useEffect(() => {
    load();
  }, [load]);

  // Live: a classification change by anyone shows up here right away.
  useEffect(() => {
    const channel = supabase
      .channel("sales-account-class")
      .on("postgres_changes", { event: "*", schema: "public", table: "sales_account_class" }, (payload) => {
        setClasses((prev) => {
          const next = new Map(prev);
          if (payload.eventType === "DELETE") {
            const old = payload.old as Partial<SalesAccountClassRow>;
            for (const [k, v] of next) if (v.id === old.id) next.delete(k);
          } else {
            const row = payload.new as SalesAccountClassRow;
            next.set(row.outlet_id, row);
          }
          return next;
        });
      })
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [supabase]);

  const accounts: Account[] = useMemo(() => {
    if (!asOf) return [];
    return rows.map((r) => {
      const lifetime = Number(r.lifetime_ce) || 0;
      const stage = stageFor({ ...r, buy_months_6: Number(r.buy_months_6) || 0 }, asOf, (Number(r.contact_count) || 0) > 0 || lastCheckins.has(r.outlet_id));
      const rep = repFor(r.distributor);
      const repKey = rep ?? (r.distributor && NO_REP_DISTRIBUTORS.includes(r.distributor) ? NO_REP_KEY : null);
      const cls = classes.get(r.outlet_id) ?? null;
      return {
        ...r,
        lifetime_ce: lifetime,
        ce_12mo: Number(r.ce_12mo) || 0,
        stage,
        rep,
        repKey,
        big: isLostBig(stage, lifetime),
        daysDark: r.last_buy_date ? daysBetween(r.last_buy_date, asOf) : null,
        search: `${r.name} ${r.city ?? ""} ${r.zip ?? ""} ${r.outlet_id} ${r.address ?? ""} ${cls?.buddy_list ?? ""}`.toLowerCase(),
        owner: ownerShown(stage, cls?.owner_type),
        tier: cls?.tier ?? null,
        handled: cls?.handled_by ?? null,
        tags: parseTags(cls?.tags),
        cls,
        lastCheckin: lastCheckins.get(r.outlet_id) ?? null,
      };
    });
  }, [rows, asOf, classes, lastCheckins]);

  const ownerCounts = useMemo(() => {
    const c: Record<string, number> = {};
    for (const a of accounts) c[a.owner] = (c[a.owner] ?? 0) + 1;
    return c;
  }, [accounts]);

  const tierCounts = useMemo(() => {
    const c: Record<string, number> = {};
    for (const a of accounts) if (a.tier) c[a.tier] = (c[a.tier] ?? 0) + 1;
    return c;
  }, [accounts]);

  const stageCounts = useMemo(() => {
    const c: Record<string, number> = {};
    for (const a of accounts) c[a.stage] = (c[a.stage] ?? 0) + 1;
    return c;
  }, [accounts]);

  const repSummary = useMemo(
    () =>
      [...REPS.map((r) => ({ key: r.rep, name: r.rep, territory: r.territory })), { key: NO_REP_KEY, name: "No FCB rep", territory: "Coast + Superior" }].map(
        (r) => {
          const list = accounts.filter((a) => a.repKey === r.key);
          const n = (s: AccountStage) => list.filter((a) => a.stage === s).length;
          return {
            ...r,
            buying: list.filter((a) => a.stage !== "lead" && a.stage !== "prospect" && a.stage !== "former").length,
            active: n("active"),
            fresh: n("new"),
            plost: n("plost"),
            lost: n("lost"),
            big: list.filter((a) => a.big).length,
            prospects: n("prospect"),
            leads: n("lead"),
          };
        },
      ),
    [accounts],
  );

  const distributors = useMemo(() => {
    const c = new Map<string, number>();
    for (const a of accounts) if (a.distributor) c.set(a.distributor, (c.get(a.distributor) ?? 0) + 1);
    return [...c.entries()].sort((x, y) => y[1] - x[1]).map(([d]) => d);
  }, [accounts]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    const f = filters;
    let list = accounts.filter(
      (a) =>
        (!f.stage || a.stage === f.stage) &&
        (!isC || !f.owner || a.owner === f.owner) &&
        (!isC || !f.tier || (f.tier === "none" ? !a.tier : a.tier === f.tier)) &&
        (!isC || !f.handled || (f.handled === "none" ? !a.handled : a.handled === f.handled)) &&
        (!isC || !f.tag || (f.tag === "none" ? a.tags.length === 0 : a.tags.includes(f.tag))) &&
        (!f.rep || (f.rep === "__unassigned" ? !a.repKey : a.repKey === f.rep)) &&
        (!f.dist || a.distributor === f.dist) &&
        (isC || !f.prem || a.premise === f.prem) &&
        (isC || !f.big || a.big) &&
        (isC || !f.hasContact || a.contact_count > 0) &&
        (!q || a.search.includes(q)),
    );
    const order = STAGE_ORDER;
    const val = (a: Account): string | number | null => {
      switch (f.sort) {
        case "stage":
          return order.indexOf(a.stage);
        case "rep":
          return a.rep;
        case "owner":
          return OWNER_ORDER.indexOf(a.owner);
        case "tier":
          return a.tier;
        case "handled":
          return a.handled ? HANDLED_LABEL[a.handled] : null;
        case "daysDark":
          return a.daysDark;
        default:
          return a[f.sort] as string | number | null;
      }
    };
    const dir = f.asc ? 1 : -1;
    list = list.slice().sort((x, y) => {
      const a = val(x);
      const b = val(y);
      if (a == null && b == null) return 0;
      if (a == null) return 1;
      if (b == null) return -1;
      return (a > b ? 1 : a < b ? -1 : 0) * dir;
    });
    return list;
  }, [accounts, filters, query, isC]);

  const pages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const curPage = Math.min(page, pages - 1);
  const shown = filtered.slice(curPage * PAGE_SIZE, curPage * PAGE_SIZE + PAGE_SIZE);
  const openAccount = openId ? accounts.find((a) => a.outlet_id === openId) ?? null : null;
  const selectedAccounts = accounts.filter((a) => selected.has(a.outlet_id));
  const pageAllSelected = shown.length > 0 && shown.every((a) => selected.has(a.outlet_id));

  const toggleSelect = (id: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  const togglePage = () =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (pageAllSelected) for (const a of shown) next.delete(a.outlet_id);
      else for (const a of shown) next.add(a.outlet_id);
      return next;
    });

  async function applyBulk(make: (a: Account) => ClassPatch | null, what: string) {
    const changes = selectedAccounts
      .filter((a) => a.owner !== "former" || !("owner_type" in (make(a) ?? {})))
      .map((a) => ({ account: a, patch: make(a) }))
      .filter((c): c is { account: Account; patch: ClassPatch } => !!c.patch);
    if (!changes.length) return;
    setBulkMsg(`Saving ${changes.length} accounts…`);
    const err = await saveClassChanges(supabase, userId, changes);
    if (err) {
      setBulkMsg(`Couldn't save: ${err}`);
      return;
    }
    setClasses((prev) => {
      const next = new Map(prev);
      for (const { account, patch } of changes) {
        const base: SalesAccountClassRow = account.cls ?? {
          id: "",
          outlet_id: account.outlet_id,
          owner_type: null,
          tier: null,
          handled_by: null,
          tags: "",
          buddy_list: null,
          buddy_rep_name: null,
          buddy_rep_phone: null,
          buddy_rep_email: null,
          updated_at: new Date().toISOString(),
          updated_by: userId,
        };
        next.set(account.outlet_id, { ...base, ...patch, updated_at: new Date().toISOString(), updated_by: userId });
      }
      return next;
    });
    setBulkMsg(`${what} on ${changes.length} account${changes.length === 1 ? "" : "s"}.`);
  }

  const sortBy = (k: SortKey) =>
    updateFilters(
      filters.sort === k ? { asc: !filters.asc } : { sort: k, asc: ["name", "distributor", "rep", "premise", "daysDark", "stage", "owner", "tier", "handled"].includes(k) },
    );

  const th = (k: SortKey, label: string, right = false) => (
    <th className={`sticky top-0 z-[1] bg-neutral-950 px-3 py-2 ${right ? "text-right" : "text-left"}`}>
      <button
        type="button"
        onClick={() => sortBy(k)}
        className={`text-[11px] font-semibold uppercase tracking-wider ${filters.sort === k ? "text-neutral-100" : "text-neutral-500 hover:text-neutral-200"}`}
      >
        {label}
        {filters.sort === k ? (filters.asc ? " ↑" : " ↓") : ""}
      </button>
    </th>
  );

  if (loading) return <p className="text-sm text-neutral-400">{loadMsg}</p>;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex flex-col gap-1">
          <h1 className="text-lg font-semibold text-neutral-100">Accounts</h1>
          <p className="max-w-3xl text-sm text-neutral-500">
            {asOf ? (
              <>
                Stages are figured as of <span className="text-neutral-300">{fdate(asOf)}</span>, the last buy date in the data
                {importedAt ? <> (imported {new Date(importedAt).toLocaleDateString("en-US")})</> : null}. Rep comes from the distributor&apos;s territory.
              </>
            ) : (
              <>No account data yet.{isAdmin ? " Use Import data to load it." : " An admin needs to import it."}</>
            )}
          </p>
        </div>
        {isAdmin && (
          <button
            type="button"
            onClick={() => setShowImport((v) => !v)}
            className="rounded-md border border-neutral-700 px-3 py-1.5 text-sm text-neutral-200 hover:bg-neutral-900"
          >
            {showImport ? "Close import" : "Import data"}
          </button>
        )}
      </div>

      {error && <p className="rounded-md border border-red-500/40 bg-red-500/10 px-3 py-2 text-sm text-red-300">Couldn&apos;t load accounts: {error}</p>}

      {isAdmin && showImport && (
        <ImportPanel
          onDone={() => {
            setShowImport(false);
            load();
          }}
        />
      )}

      {accounts.length > 0 && (
        <>
          <div role="tablist" aria-label="Accounts view" className="flex gap-1 border-b border-neutral-800">
            {(
              [
                ["overview", "Overview"],
                ["classify", "Classification"],
              ] as const
            ).map(([v, label]) => (
              <button
                key={v}
                type="button"
                role="tab"
                aria-selected={view === v}
                onClick={() => switchView(v)}
                className={`-mb-px border-b-2 px-4 py-2 text-sm font-medium ${view === v ? "border-[#6abc46] text-neutral-100" : "border-transparent text-neutral-500 hover:text-neutral-200"}`}
              >
                {label}
              </button>
            ))}
          </div>

          {!isC && (
          <div className="grid grid-cols-2 gap-2.5 md:grid-cols-3 xl:grid-cols-7">
            {STAGE_ORDER.map((s) => {
              const on = filters.stage === s;
              const c = STAGE_INFO[s].color;
              return (
                <button
                  key={s}
                  type="button"
                  aria-pressed={on}
                  onClick={() => updateFilters({ stage: on ? null : s })}
                  className={`relative flex flex-col gap-0.5 rounded-lg border bg-neutral-900 py-3 pl-4 pr-3 text-left hover:bg-neutral-800/70 ${on ? "" : "border-neutral-800"}`}
                  style={on ? { borderColor: c } : undefined}
                >
                  <span className="absolute bottom-3 left-0 top-3 w-[3px] rounded-r" style={{ background: c }} />
                  <span className="text-xs font-medium text-neutral-400">{STAGE_INFO[s].label}</span>
                  <span className="text-2xl font-bold tabular-nums text-neutral-100">{fmt(stageCounts[s] ?? 0)}</span>
                  <span className="text-[11px] leading-snug text-neutral-500">{STAGE_INFO[s].rule}</span>
                </button>
              );
            })}
          </div>
          )}

          {isC && (
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs font-semibold uppercase tracking-wider text-neutral-500">Owner</span>
            {OWNER_ORDER.map((o) => {
              const on = filters.owner === o;
              const c = OWNER_INFO[o].color;
              return (
                <button
                  key={o}
                  type="button"
                  aria-pressed={on}
                  title={OWNER_INFO[o].rule}
                  onClick={() => updateFilters({ owner: on ? null : o })}
                  className={`inline-flex items-center gap-2 rounded-full border px-3 py-1 text-sm hover:bg-neutral-900 ${on ? "bg-neutral-900 text-neutral-100" : "border-neutral-800 text-neutral-300"}`}
                  style={on ? { borderColor: c } : undefined}
                >
                  <span className="h-2 w-2 rounded-full" style={{ background: c }} />
                  {OWNER_INFO[o].label}
                  <span className="tabular-nums text-neutral-500">{fmt(ownerCounts[o] ?? 0)}</span>
                </button>
              );
            })}
            <span className="ml-2 text-xs font-semibold uppercase tracking-wider text-neutral-500">Tier</span>
            {TIERS.map((t) => {
              const on = filters.tier === t;
              return (
                <button
                  key={t}
                  type="button"
                  aria-pressed={on}
                  onClick={() => updateFilters({ tier: on ? "" : t })}
                  className={`rounded-full border px-3 py-1 text-sm hover:bg-neutral-900 ${on ? "border-[#6abc46] bg-neutral-900 text-neutral-100" : "border-neutral-800 text-neutral-300"}`}
                >
                  {t} <span className="tabular-nums text-neutral-500">{fmt(tierCounts[t] ?? 0)}</span>
                </button>
              );
            })}
          </div>
          )}

          {!isC && (
          <div className="overflow-x-auto rounded-lg border border-neutral-800">
            <div className="flex flex-wrap items-baseline justify-between gap-2 border-b border-neutral-800 bg-neutral-900 px-3 py-2">
              <span className="text-sm font-semibold text-neutral-100">By rep</span>
              <span className="text-xs text-neutral-500">Click a rep to filter the list. Leads, prospects and former-distributor accounts aren&apos;t counted as buying.</span>
            </div>
            <table className="w-full text-sm">
              <thead>
                <tr className="text-[11px] uppercase tracking-wider text-neutral-500">
                  <th className="px-3 py-2 text-left font-semibold">Rep · territory</th>
                  <th className="px-3 py-2 text-right font-semibold">Buying</th>
                  <th className="px-3 py-2 text-right font-semibold">Active</th>
                  <th className="px-3 py-2 text-right font-semibold">New</th>
                  <th className="px-3 py-2 text-right font-semibold">Potential lost</th>
                  <th className="px-3 py-2 text-right font-semibold">Lost</th>
                  <th className="px-3 py-2 text-right font-semibold">Lost big</th>
                  <th className="px-3 py-2 text-right font-semibold">Prospects</th>
                  <th className="px-3 py-2 text-right font-semibold">Leads</th>
                </tr>
              </thead>
              <tbody>
                {repSummary.map((r) => (
                  <tr
                    key={r.key}
                    tabIndex={0}
                    onClick={() => updateFilters({ rep: filters.rep === r.key ? "" : r.key })}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") updateFilters({ rep: filters.rep === r.key ? "" : r.key });
                    }}
                    className={`cursor-pointer border-t border-neutral-800 hover:bg-neutral-900 ${filters.rep === r.key ? "bg-[#6abc46]/10" : ""}`}
                  >
                    <td className="whitespace-nowrap px-3 py-2 text-neutral-100">
                      <span className="font-semibold">{r.name}</span> <span className="text-xs text-neutral-500">{r.territory}</span>
                    </td>
                    {[r.buying, r.active, r.fresh, r.plost, r.lost, r.big, r.prospects, r.leads].map((v, i) => (
                      <td key={i} className="px-3 py-2 text-right tabular-nums text-neutral-200">
                        {fmt(v)}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          )}

          <div className="flex flex-wrap items-center gap-2">
            <input
              id="accounts-search"
              type="search"
              value={query}
              onChange={(e) => {
                setQuery(e.target.value);
                setPage(0);
              }}
              placeholder="Search account, city, zip or Outlet ID"
              className="min-w-0 flex-[1_1_240px] rounded-md border border-neutral-700 bg-neutral-950 px-3 py-1.5 text-sm text-neutral-100"
            />
            <select
              id="accounts-rep"
              value={filters.rep}
              onChange={(e) => updateFilters({ rep: e.target.value })}
              className="rounded-md border border-neutral-700 bg-neutral-950 px-2 py-1.5 text-sm text-neutral-100"
            >
              <option value="">All reps</option>
              {REPS.map((r) => (
                <option key={r.rep} value={r.rep}>
                  {r.rep}
                </option>
              ))}
              <option value={NO_REP_KEY}>No FCB rep</option>
              <option value="__unassigned">Unassigned / former</option>
            </select>
            <select
              id="accounts-dist"
              value={filters.dist}
              onChange={(e) => updateFilters({ dist: e.target.value })}
              className="rounded-md border border-neutral-700 bg-neutral-950 px-2 py-1.5 text-sm text-neutral-100"
            >
              <option value="">All distributors</option>
              {distributors.map((d) => (
                <option key={d} value={d}>
                  {d}
                </option>
              ))}
            </select>
            {!isC && (
            <select
              id="accounts-prem"
              value={filters.prem}
              onChange={(e) => updateFilters({ prem: e.target.value })}
              className="rounded-md border border-neutral-700 bg-neutral-950 px-2 py-1.5 text-sm text-neutral-100"
            >
              <option value="">On + Off premise</option>
              <option value="On">On premise</option>
              <option value="Off">Off premise</option>
            </select>
            )}
            {isC && (
              <>
            <select id="accounts-owner" value={filters.owner ?? ""} onChange={(e) => updateFilters({ owner: (e.target.value || null) as OwnerShown | null })} className="rounded-md border border-neutral-700 bg-neutral-950 px-2 py-1.5 text-sm text-neutral-100">
              <option value="">All owners</option>
              {OWNER_ORDER.map((o) => (
                <option key={o} value={o}>
                  {OWNER_INFO[o].label}
                </option>
              ))}
            </select>
            <select id="accounts-tier" value={filters.tier} onChange={(e) => updateFilters({ tier: e.target.value })} className="rounded-md border border-neutral-700 bg-neutral-950 px-2 py-1.5 text-sm text-neutral-100">
              <option value="">All tiers</option>
              {TIERS.map((t) => (
                <option key={t} value={t}>
                  Tier {t}
                </option>
              ))}
              <option value="none">No tier yet</option>
            </select>
            <select id="accounts-handled" value={filters.handled} onChange={(e) => updateFilters({ handled: e.target.value })} className="rounded-md border border-neutral-700 bg-neutral-950 px-2 py-1.5 text-sm text-neutral-100">
              <option value="">Handled by: anyone</option>
              {HANDLED_CHOICES.map((h) => (
                <option key={h} value={h}>
                  {HANDLED_LABEL[h]}
                </option>
              ))}
              <option value="none">Not set yet</option>
            </select>
            <select id="accounts-tag" value={filters.tag} onChange={(e) => updateFilters({ tag: e.target.value })} className="rounded-md border border-neutral-700 bg-neutral-950 px-2 py-1.5 text-sm text-neutral-100">
              <option value="">All tags</option>
              {TAGS.map((t) => (
                <option key={t.key} value={t.key}>
                  {t.key}
                </option>
              ))}
              <option value="none">No tags</option>
            </select>
              </>
            )}
            {!isC && (
              <>
            <label className="flex cursor-pointer items-center gap-1.5 text-sm text-neutral-400">
              <input id="accounts-big" type="checkbox" checked={filters.big} onChange={(e) => updateFilters({ big: e.target.checked })} className="accent-[#6abc46]" />
              Lost big only ({BIG_LOST_CE}+ CE)
            </label>
            <label className="flex cursor-pointer items-center gap-1.5 text-sm text-neutral-400">
              <input
                id="accounts-contact"
                type="checkbox"
                checked={filters.hasContact}
                onChange={(e) => updateFilters({ hasContact: e.target.checked })}
                className="accent-[#6abc46]"
              />
              Has a contact
            </label>
              </>
            )}
            <button
              type="button"
              onClick={() => {
                setQuery("");
                updateFilters({ ...DEFAULT_FILTERS });
              }}
              className="rounded-md border border-neutral-700 px-3 py-1.5 text-sm text-neutral-300 hover:bg-neutral-900"
            >
              Clear filters
            </button>
          </div>

          {isC && selected.size > 0 && (
            <BulkBar
              count={selected.size}
              message={bulkMsg}
              onClear={() => {
                setSelected(new Set());
                setBulkMsg(null);
              }}
              onOwner={(o) => applyBulk(() => ({ owner_type: o }), `Owner set to ${OWNER_INFO[o].label}`)}
              onTier={(t) => applyBulk(() => ({ tier: t }), t ? `Tier set to ${t}` : "Tier cleared")}
              onHandled={(h) => applyBulk(() => ({ handled_by: h }), h ? `Handled by set to ${HANDLED_LABEL[h]}` : "Handled by cleared")}
              onTag={(tag, add) =>
                applyBulk(
                  (a) => {
                    const has = a.tags.includes(tag);
                    if (add === has) return null;
                    return { tags: joinTags(add ? [...a.tags, tag] : a.tags.filter((t) => t !== tag)) };
                  },
                  `${tag} ${add ? "added" : "removed"}`,
                )
              }
            />
          )}

          <div className="overflow-hidden rounded-lg border border-neutral-800">
            <div className="max-h-[70vh] overflow-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-neutral-800">
                    {isC && (
                      <th className="sticky top-0 z-[1] w-8 bg-neutral-950 px-3 py-2">
                        <input
                          type="checkbox"
                          aria-label="Select every account on this page"
                          checked={pageAllSelected}
                          onChange={togglePage}
                          className="accent-[#6abc46]"
                        />
                      </th>
                    )}
                    {th("name", "Account")}
                    {th("distributor", "Distributor")}
                    {th("rep", "Rep")}
                    {th("stage", "Stage")}
                    {isC ? (
                      <>
                        {th("owner", "Owner")}
                        {th("tier", "Tier")}
                        {th("handled", "Handled by")}
                        {th("lastCheckin", "Last check-in", true)}
                        <th className="sticky top-0 z-[1] bg-neutral-950 px-3 py-2 text-left text-[11px] font-semibold uppercase tracking-wider text-neutral-500">Tags</th>
                      </>
                    ) : (
                      <>
                        {th("last_buy_date", "Last buy", true)}
                        {th("daysDark", "Days dark", true)}
                        {th("ce_12mo", "Last 12 mo CE", true)}
                        {th("lifetime_ce", "Lifetime CE", true)}
                        {th("premise", "Premise")}
                      </>
                    )}
                  </tr>
                </thead>
                <tbody>
                  {shown.length === 0 ? (
                    <tr>
                      <td colSpan={isC ? 10 : 9} className="px-3 py-8 text-center text-neutral-500">
                        No accounts match these filters. Clear a filter to see more.
                      </td>
                    </tr>
                  ) : (
                    shown.map((a) => (
                      <tr
                        key={a.outlet_id}
                        tabIndex={0}
                        onClick={() => setOpenId(a.outlet_id)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") setOpenId(a.outlet_id);
                        }}
                        className="cursor-pointer border-b border-neutral-800 last:border-b-0 hover:bg-neutral-900"
                      >
                        {isC && (
                          <td className="px-3 py-2" onClick={(e) => e.stopPropagation()}>
                            <input
                              type="checkbox"
                              aria-label={`Select ${a.name}`}
                              checked={selected.has(a.outlet_id)}
                              onChange={() => toggleSelect(a.outlet_id)}
                              className="accent-[#6abc46]"
                            />
                          </td>
                        )}
                        <td className="max-w-[300px] px-3 py-2">
                          <div className="truncate font-medium text-neutral-100">{a.name}</div>
                          <div className="truncate text-xs text-neutral-500">{[a.city, a.zip].filter(Boolean).join(" · ") || "—"}</div>
                        </td>
                        <td className="whitespace-nowrap px-3 py-2 text-neutral-200">{a.distributor ?? "—"}</td>
                        <td className="whitespace-nowrap px-3 py-2 text-neutral-200">{a.rep ?? <span className="text-neutral-600">—</span>}</td>
                        <td className="whitespace-nowrap px-3 py-2">
                          <StagePill stage={a.stage} />
                          {a.big && <BigTag />}
                        </td>
                        {isC ? (
                          <>
                        <td className="whitespace-nowrap px-3 py-2">
                          <OwnerPill owner={a.owner} />
                        </td>
                        <td className="whitespace-nowrap px-3 py-2 font-semibold text-neutral-100">{a.tier ?? <span className="font-normal text-neutral-600">—</span>}</td>
                        <td className="whitespace-nowrap px-3 py-2 text-neutral-200">{a.handled ? HANDLED_LABEL[a.handled] : <span className="text-neutral-600">—</span>}</td>
                        <td className="whitespace-nowrap px-3 py-2 text-right tabular-nums text-neutral-200">{a.lastCheckin ? fdate(a.lastCheckin) : <span className="text-neutral-600">—</span>}</td>
                        <td className="whitespace-nowrap px-3 py-2">
                          <div className="flex gap-1">
                            {a.tags.map((t) => (
                              <span key={t} className="rounded border border-neutral-700 px-1.5 py-px text-[10px] font-semibold tracking-wide text-neutral-300">
                                {t}
                              </span>
                            ))}
                          </div>
                        </td>
                          </>
                        ) : (
                          <>
                        <td className="whitespace-nowrap px-3 py-2 text-right tabular-nums text-neutral-200">
                          {fdate(a.last_buy_date)}
                          {a.report_buy_date && (!a.last_buy_date || a.report_buy_date > a.last_buy_date) && (
                            <span className="ml-1 text-sky-400" title="A later buy shows up in a Sales Ops report">
                              ●
                            </span>
                          )}
                        </td>
                        <td className="whitespace-nowrap px-3 py-2 text-right tabular-nums text-neutral-200">{fmt(a.daysDark)}</td>
                        <td className="whitespace-nowrap px-3 py-2 text-right tabular-nums text-neutral-200">{a.last_buy_date ? fmt(a.ce_12mo) : "—"}</td>
                        <td className="whitespace-nowrap px-3 py-2 text-right tabular-nums text-neutral-200">{a.last_buy_date ? fmt(a.lifetime_ce) : "—"}</td>
                        <td className="whitespace-nowrap px-3 py-2 text-neutral-300">{a.premise ?? "—"}</td>
                          </>
                        )}
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
            <div className="flex flex-wrap items-center justify-end gap-3 border-t border-neutral-800 bg-neutral-900/50 px-3 py-2 text-sm">
              <span className="mr-auto text-neutral-400">
                {fmt(filtered.length)} {filtered.length === 1 ? "account" : "accounts"}
              </span>
              <button
                type="button"
                disabled={curPage === 0}
                onClick={() => setPage(curPage - 1)}
                className="rounded-md border border-neutral-700 px-3 py-1 text-neutral-300 hover:bg-neutral-900 disabled:opacity-40"
              >
                Previous
              </button>
              <span className="tabular-nums text-neutral-500">
                Page {curPage + 1} of {pages}
              </span>
              <button
                type="button"
                disabled={curPage >= pages - 1}
                onClick={() => setPage(curPage + 1)}
                className="rounded-md border border-neutral-700 px-3 py-1 text-neutral-300 hover:bg-neutral-900 disabled:opacity-40"
              >
                Next
              </button>
            </div>
          </div>
          {!isC && (
          <p className="text-xs text-neutral-500">
            CE = case equivalents · Days dark = days since the last buy, as of {fdate(asOf)} ·{" "}
            <span className="text-sky-400">●</span> = a later buy shows up in a Sales Ops report
          </p>
          )}
          {isC && (
            <p className="text-xs text-neutral-500">
              Tick accounts to change several at once. Click an account to change it on its own. Every change is in the Audit Log.
            </p>
          )}
        </>
      )}

      {openAccount && asOf && (
        <AccountPanel
          account={openAccount}
          asOf={asOf}
          onClose={closePanel}
          onSave={async (patch) => {
            const err = await saveClassChanges(supabase, userId, [{ account: openAccount, patch }]);
            if (err) return err;
            setClasses((prev) => {
              const next = new Map(prev);
              const base = openAccount.cls ?? {
                id: "",
                outlet_id: openAccount.outlet_id,
                owner_type: null,
                tier: null,
                handled_by: null,
                tags: "",
                buddy_list: null,
                buddy_rep_name: null,
                buddy_rep_phone: null,
                buddy_rep_email: null,
                updated_at: "",
                updated_by: userId,
              };
              next.set(openAccount.outlet_id, { ...base, ...patch, updated_at: new Date().toISOString(), updated_by: userId });
              return next;
            });
            return null;
          }}
        />
      )}
    </div>
  );
}

function AccountPanel({
  account: a,
  asOf,
  onClose,
  onSave,
}: {
  account: Account;
  asOf: string;
  onClose: () => void;
  onSave: (patch: ClassPatch) => Promise<string | null>;
}) {
  const supabase = useMemo(() => createClient(), []);
  const [sales, setSales] = useState<SalesAccountSaleRow[] | null>(null);
  const [contacts, setContacts] = useState<SalesAccountContactRow[] | null>(null);
  const [checkins, setCheckins] = useState<SalesAccountCheckinRow[] | null>(null);
  const [saveMsg, setSaveMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [showAllCheckins, setShowAllCheckins] = useState(false);
  const closeRef = useRef<HTMLButtonElement>(null);

  const save = async (patch: ClassPatch, what: string) => {
    setSaveMsg({ ok: true, text: "Saving…" });
    const err = await onSave(patch);
    setSaveMsg(err ? { ok: false, text: `Couldn't save: ${err}` } : { ok: true, text: `${what} saved.` });
  };

  useEffect(() => {
    let alive = true;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- reset while the next account loads
    setSales(null);
    setContacts(null);
    setCheckins(null);
    setSaveMsg(null);
    setShowAllCheckins(false);
    (async () => {
      const [s, c, k] = await Promise.all([
        supabase.from("sales_account_sales").select("month,product,package,distributor,ce,last_buy_date").eq("outlet_id", a.outlet_id).limit(5000),
        supabase.from("sales_account_contacts").select("id,name,title,phone,mobile,email,notes,source").eq("outlet_id", a.outlet_id),
        supabase
          .from("sales_account_checkins")
          .select("id,outlet_id,checkin_date,rep,activity,outcome,notes,brands,contact,source")
          .eq("outlet_id", a.outlet_id)
          .order("checkin_date", { ascending: false })
          .limit(200),
      ]);
      if (!alive) return;
      setSales(((s.data ?? []) as SalesAccountSaleRow[]).map((r) => ({ ...r, ce: Number(r.ce) || 0 })));
      setContacts((c.data ?? []) as SalesAccountContactRow[]);
      setCheckins((k.data ?? []) as SalesAccountCheckinRow[]);
    })();
    return () => {
      alive = false;
    };
  }, [a.outlet_id, supabase]);

  useEffect(() => {
    closeRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const products = useMemo(() => {
    const m = new Map<string, { ce: number; last: string | null }>();
    for (const r of sales ?? []) {
      const k = [r.product, r.package].filter(Boolean).join(" · ");
      const cur = m.get(k) ?? { ce: 0, last: null };
      cur.ce += r.ce;
      const lb = r.last_buy_date ?? r.month;
      if (!cur.last || lb > cur.last) cur.last = lb;
      m.set(k, cur);
    }
    return [...m.entries()].sort((x, y) => y[1].ce - x[1].ce);
  }, [sales]);

  const why = (() => {
    if (a.stage === "lead") return "In the account list with no buys in the sales history. No contact info or check-ins yet; it becomes a Prospect as soon as it gets either.";
    if (a.stage === "prospect")
      return "No buys in the sales history yet, but we have contact info or someone has checked in, so it's a Prospect.";
    if (a.stage === "former")
      return `Last bought through ${a.distributor ?? "an unknown distributor"}, which isn't a current FCB distributor. History is kept, with no rep or reminders.`;
    let s = `Last buy ${fdate(a.last_buy_date)}, ${fmt(a.daysDark)} days before ${fdate(asOf)}. Bought in ${a.buy_months_6} of the last 6 months.`;
    if (a.big) s += ` Lifetime ${fmt(a.lifetime_ce)} CE, so it's flagged lost big (${BIG_LOST_CE}+ CE).`;
    return s;
  })();

  return (
    <>
      <div className="fixed inset-0 z-40 bg-black/60" onClick={onClose} />
      <aside
        role="dialog"
        aria-modal="true"
        aria-label={a.name}
        className="fixed bottom-0 right-0 top-0 z-50 flex w-full max-w-[640px] flex-col gap-4 overflow-y-auto border-l border-neutral-800 bg-neutral-950 p-5"
      >
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2 className="text-xl font-bold text-neutral-100">{a.name}</h2>
            <p className="text-sm text-neutral-400">{[a.address, a.city, a.zip].filter(Boolean).join(", ") || "No address on file"}</p>
          </div>
          <button
            ref={closeRef}
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="h-8 w-8 flex-none rounded-md border border-neutral-700 text-neutral-400 hover:text-neutral-100"
          >
            ✕
          </button>
        </div>
        <div>
          <StagePill stage={a.stage} />
          {a.big && <BigTag />}
        </div>
        <div className="rounded-lg border border-neutral-800 bg-neutral-900 px-3 py-2 text-sm text-neutral-300">
          {why}
          {a.report_buy_date && (
            <div className="mt-1 text-sky-300">
              {a.report_note ?? "Sales Ops report"}: buy dated {fdate(a.report_buy_date)}.
            </div>
          )}
        </div>

        <section className="flex flex-col gap-2">
          <h3 className="text-xs font-semibold uppercase tracking-widest text-neutral-400">Last check-in</h3>
          {checkins === null ? (
            <p className="text-sm text-neutral-500">Loading…</p>
          ) : checkins.length === 0 ? (
            <p className="text-sm text-neutral-500">No check-ins on file yet. They&apos;ll come in from Lilypad and from check-ins logged here.</p>
          ) : (
            <div className="flex flex-col gap-2">
              {(showAllCheckins ? checkins : checkins.slice(0, 1)).map((k, i) => (
                <CheckinCard key={k.id} checkin={k} latest={i === 0} />
              ))}
              {checkins.length > 1 && (
                <button
                  type="button"
                  onClick={() => setShowAllCheckins((v) => !v)}
                  className="self-start text-sm text-[#8fd16e] hover:underline"
                >
                  {showAllCheckins ? "Show only the last check-in" : `Show all ${checkins.length} check-ins`}
                </button>
              )}
            </div>
          )}
        </section>

        <section className="flex flex-col gap-3 rounded-lg border border-neutral-800 bg-neutral-900 p-3">
          <div className="flex items-baseline justify-between gap-2">
            <h3 className="text-xs font-semibold uppercase tracking-widest text-neutral-400">Classification</h3>
            {saveMsg && <span className={`text-xs ${saveMsg.ok ? "text-[#8fd16e]" : "text-red-300"}`}>{saveMsg.text}</span>}
          </div>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <label className="flex flex-col gap-1 text-xs text-neutral-500">
              Owner
              {a.owner === "former" ? (
                <span className="py-1.5 text-sm text-neutral-300">Former distributor (automatic)</span>
              ) : (
                <select
                  id="panel-owner"
                  value={a.cls?.owner_type ?? "distributor"}
                  onChange={(e) => save({ owner_type: e.target.value as OwnerType }, "Owner")}
                  className="rounded-md border border-neutral-700 bg-neutral-950 px-2 py-1.5 text-sm text-neutral-100"
                >
                  {OWNER_CHOICES.map((o) => (
                    <option key={o} value={o}>
                      {OWNER_INFO[o].label}
                    </option>
                  ))}
                </select>
              )}
            </label>
            <label className="flex flex-col gap-1 text-xs text-neutral-500">
              Tier
              <select
                id="panel-tier"
                value={a.tier ?? ""}
                onChange={(e) => save({ tier: (e.target.value || null) as Tier | null }, "Tier")}
                className="rounded-md border border-neutral-700 bg-neutral-950 px-2 py-1.5 text-sm text-neutral-100"
              >
                <option value="">Not set</option>
                {TIERS.map((t) => (
                  <option key={t} value={t}>
                    Tier {t}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex flex-col gap-1 text-xs text-neutral-500">
              Handled by
              <select
                id="panel-handled"
                value={a.handled ?? ""}
                onChange={(e) => save({ handled_by: (e.target.value || null) as HandledBy | null }, "Handled by")}
                className="rounded-md border border-neutral-700 bg-neutral-950 px-2 py-1.5 text-sm text-neutral-100"
              >
                <option value="">Not set</option>
                {HANDLED_CHOICES.map((h) => (
                  <option key={h} value={h}>
                    {HANDLED_LABEL[h]}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <div className="flex flex-col gap-1">
            <span className="text-xs text-neutral-500">Tags</span>
            <div className="flex flex-wrap gap-1.5">
              {TAGS.map((t) => {
                const on = a.tags.includes(t.key);
                return (
                  <button
                    key={t.key}
                    type="button"
                    aria-pressed={on}
                    title={t.rule}
                    onClick={() =>
                      save({ tags: joinTags(on ? a.tags.filter((x) => x !== t.key) : [...a.tags, t.key]) }, `${t.key} ${on ? "removed" : "added"}`)
                    }
                    className={`rounded-full border px-2.5 py-0.5 text-xs font-semibold tracking-wide ${on ? "border-[#6abc46] bg-[#6abc46]/15 text-neutral-100" : "border-neutral-700 text-neutral-400 hover:text-neutral-200"}`}
                  >
                    {t.key}
                  </button>
                );
              })}
            </div>
          </div>
          {a.cls?.buddy_list && (
            <div className="text-sm text-neutral-300">
              Target list: <span className="text-neutral-100">{a.cls.buddy_list}</span>
              {a.cls.buddy_rep_name && (
                <>
                  {" "}
                  · Distributor rep: <span className="text-neutral-100">{a.cls.buddy_rep_name}</span>
                </>
              )}
              {[a.cls.buddy_rep_phone, a.cls.buddy_rep_email].filter(Boolean).length > 0 && (
                <div className="text-neutral-400">{[a.cls.buddy_rep_phone, a.cls.buddy_rep_email].filter(Boolean).join(" · ")}</div>
              )}
            </div>
          )}
          {a.cls?.updated_at && <p className="text-xs text-neutral-500">Last changed {new Date(a.cls.updated_at).toLocaleString("en-US")}. Every change is in the Audit Log.</p>}
        </section>

        <dl className="grid grid-cols-2 gap-px overflow-hidden rounded-lg border border-neutral-800 bg-neutral-800 sm:grid-cols-3">
          {[
            ["Distributor", a.distributor ?? "—"],
            ["FCB rep", a.rep ?? (a.repKey === NO_REP_KEY ? "No FCB rep" : "—")],
            ["Premise", a.premise ?? "—"],
            ["Last buy", fdate(a.last_buy_date)],
            ["Last 12 mo", a.last_buy_date ? `${fmt(a.ce_12mo)} CE` : "—"],
            ["Lifetime", a.last_buy_date ? `${fmt(a.lifetime_ce)} CE` : "—"],
            ["VIP Outlet ID", a.outlet_id],
            ["Phone", a.phone ?? "—"],
            ["Best day", a.best_day ?? "—"],
          ].map(([k, v]) => (
            <div key={k} className="min-w-0 bg-neutral-900 px-3 py-2">
              <dt className="text-[11px] uppercase tracking-wider text-neutral-500">{k}</dt>
              <dd className="mt-0.5 break-words font-semibold text-neutral-100">{v}</dd>
            </div>
          ))}
        </dl>

        <section className="flex flex-col gap-2">
          <h3 className="text-xs font-semibold uppercase tracking-widest text-neutral-400">Cases bought by month</h3>
          {sales === null ? (
            <p className="text-sm text-neutral-500">Loading…</p>
          ) : sales.length === 0 ? (
            <p className="text-sm text-neutral-500">No purchases in the sales history.</p>
          ) : (
            <MonthlyChart sales={sales} asOf={asOf} />
          )}
        </section>

        <section className="flex flex-col gap-2">
          <h3 className="text-xs font-semibold uppercase tracking-widest text-neutral-400">What they buy</h3>
          {sales === null ? null : products.length === 0 ? (
            <p className="text-sm text-neutral-500">Nothing yet.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-[11px] uppercase tracking-wider text-neutral-500">
                    <th className="px-2 py-1.5 text-left font-semibold">Product · package</th>
                    <th className="px-2 py-1.5 text-right font-semibold">Lifetime CE</th>
                    <th className="px-2 py-1.5 text-right font-semibold">Last buy</th>
                  </tr>
                </thead>
                <tbody>
                  {products.slice(0, 15).map(([k, v]) => (
                    <tr key={k} className="border-t border-neutral-800">
                      <td className="px-2 py-1.5 text-neutral-200">{k}</td>
                      <td className="px-2 py-1.5 text-right tabular-nums text-neutral-200">{fmt(v.ce)}</td>
                      <td className="px-2 py-1.5 text-right tabular-nums text-neutral-200">{fdate(v.last)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>

        <section className="flex flex-col gap-2">
          <h3 className="text-xs font-semibold uppercase tracking-widest text-neutral-400">Contacts</h3>
          {contacts === null ? (
            <p className="text-sm text-neutral-500">Loading…</p>
          ) : contacts.length === 0 ? (
            <p className="text-sm text-neutral-500">No contacts on file. This account would go on the cleanup (SCRUB) list.</p>
          ) : (
            <div className="flex flex-col gap-2">
              {contacts.map((k) => (
                <div key={k.id} className="flex flex-col gap-0.5 rounded-lg border border-neutral-800 bg-neutral-900 px-3 py-2 text-sm">
                  <span className="font-semibold text-neutral-100">
                    {k.name ?? "(no name)"}
                    {k.title && <span className="font-normal text-neutral-400"> · {k.title}</span>}
                  </span>
                  {[k.phone, k.mobile].filter(Boolean).map((p) => (
                    <span key={p} className="tabular-nums text-neutral-300">
                      {p}
                    </span>
                  ))}
                  {k.email && <span className="break-all text-neutral-300">{k.email}</span>}
                  {k.notes && <span className="text-neutral-400">{k.notes}</span>}
                  <span className="text-xs text-neutral-500">Source: {k.source ?? "—"}</span>
                </div>
              ))}
            </div>
          )}
        </section>
      </aside>
    </>
  );
}

function CheckinCard({ checkin: k, latest }: { checkin: SalesAccountCheckinRow; latest: boolean }) {
  return (
    <div className={`flex flex-col gap-1 rounded-lg border px-3 py-2 text-sm ${latest ? "border-[#6abc46]/50 bg-[#6abc46]/10" : "border-neutral-800 bg-neutral-900"}`}>
      <div className="flex flex-wrap items-baseline gap-x-2">
        <span className="font-semibold tabular-nums text-neutral-100">{fdate(k.checkin_date)}</span>
        <span className="text-neutral-300">{[k.activity, k.rep].filter(Boolean).join(" · ")}</span>
        {k.outcome && <span className="rounded border border-neutral-700 px-1.5 text-xs text-neutral-300">{k.outcome}</span>}
      </div>
      {k.notes ? <p className="whitespace-pre-wrap text-neutral-200">{k.notes}</p> : <p className="text-neutral-500">No notes on this check-in.</p>}
      {(k.contact || (k.brands && k.brands !== "DID NOT SAMPLE")) && (
        <p className="text-xs text-neutral-400">
          {[k.contact && `Spoke with ${k.contact}`, k.brands && k.brands !== "DID NOT SAMPLE" && `Sampled: ${k.brands}`].filter(Boolean).join(" · ")}
        </p>
      )}
      <p className="text-xs text-neutral-500">From {k.source ?? "—"}</p>
    </div>
  );
}

function BulkBar({
  count,
  message,
  onClear,
  onOwner,
  onTier,
  onHandled,
  onTag,
}: {
  count: number;
  message: string | null;
  onClear: () => void;
  onOwner: (o: OwnerType) => void;
  onTier: (t: Tier | null) => void;
  onHandled: (h: HandledBy | null) => void;
  onTag: (tag: string, add: boolean) => void;
}) {
  const cls = "rounded-md border border-neutral-700 bg-neutral-950 px-2 py-1 text-sm text-neutral-100";
  return (
    <div className="sticky top-0 z-10 flex flex-wrap items-center gap-2 rounded-lg border border-[#6abc46]/50 bg-neutral-900 px-3 py-2 text-sm">
      <span className="font-semibold text-neutral-100">{count.toLocaleString()} selected</span>
      <select
        id="bulk-owner"
        value=""
        onChange={(e) => e.target.value && onOwner(e.target.value as OwnerType)}
        className={cls}
      >
        <option value="">Set owner…</option>
        {OWNER_CHOICES.map((o) => (
          <option key={o} value={o}>
            {OWNER_INFO[o].label}
          </option>
        ))}
      </select>
      <select
        id="bulk-tier"
        value=""
        onChange={(e) => e.target.value && onTier(e.target.value === "none" ? null : (e.target.value as Tier))}
        className={cls}
      >
        <option value="">Set tier…</option>
        {TIERS.map((t) => (
          <option key={t} value={t}>
            Tier {t}
          </option>
        ))}
        <option value="none">Clear tier</option>
      </select>
      <select
        id="bulk-handled"
        value=""
        onChange={(e) => e.target.value && onHandled(e.target.value === "none" ? null : (e.target.value as HandledBy))}
        className={cls}
      >
        <option value="">Set handled by…</option>
        {HANDLED_CHOICES.map((h) => (
          <option key={h} value={h}>
            {HANDLED_LABEL[h]}
          </option>
        ))}
        <option value="none">Clear handled by</option>
      </select>
      <select
        id="bulk-tag"
        value=""
        onChange={(e) => {
          const [op, tag] = e.target.value.split("|");
          if (tag) onTag(tag, op === "add");
        }}
        className={cls}
      >
        <option value="">Tags…</option>
        {TAGS.map((t) => (
          <option key={`add${t.key}`} value={`add|${t.key}`}>
            Add {t.key}
          </option>
        ))}
        {TAGS.map((t) => (
          <option key={`rem${t.key}`} value={`remove|${t.key}`}>
            Remove {t.key}
          </option>
        ))}
      </select>
      <button type="button" onClick={onClear} className="rounded-md border border-neutral-700 px-2.5 py-1 text-neutral-300 hover:bg-neutral-800">
        Clear selection
      </button>
      {message && <span className="text-neutral-400">{message}</span>}
      <span className="w-full text-xs text-neutral-500">Former-distributor accounts keep their automatic owner. Every change is in the Audit Log.</span>
    </div>
  );
}

function MonthlyChart({ sales, asOf }: { sales: SalesAccountSaleRow[]; asOf: string }) {
  const [hover, setHover] = useState<number | null>(null);
  const startYear = Math.min(2020, ...sales.map((r) => +r.month.slice(0, 4)));
  const endIdx = (+asOf.slice(0, 4) - startYear) * 12 + (+asOf.slice(5, 7) - 1);
  const N = endIdx + 1;
  const vals = new Array<number>(N).fill(0);
  for (const r of sales) {
    const i = (+r.month.slice(0, 4) - startYear) * 12 + (+r.month.slice(5, 7) - 1);
    if (i >= 0 && i < N) vals[i] += r.ce;
  }
  const W = 600, H = 180, L = 34, R = 8, T = 12, B = 26;
  const bw = (W - L - R) / N;
  const max = Math.max(...vals, 1);
  const p = Math.pow(10, Math.floor(Math.log10(max)));
  const f = max / p;
  const nice = (f <= 1 ? 1 : f <= 2 ? 2 : f <= 5 ? 5 : 10) * p;
  const y = (v: number) => T + (H - T - B) * (1 - v / nice);
  const years = Math.ceil(N / 12);
  return (
    <div className="relative">
      <svg viewBox={`0 0 ${W} ${H}`} className="block h-auto w-full" role="img" aria-label="Cases bought by month" onMouseLeave={() => setHover(null)}>
        {[0, 0.5, 1].map((t) => (
          <g key={t}>
            <line x1={L} x2={W - R} y1={y(nice * t)} y2={y(nice * t)} stroke="#262626" />
            <text x={L - 6} y={y(nice * t) + 4} textAnchor="end" fontSize="10" fill="#737373">
              {fmt(nice * t)}
            </text>
          </g>
        ))}
        {Array.from({ length: years }, (_, i) => (
          <g key={i}>
            <line x1={L + i * 12 * bw} x2={L + i * 12 * bw} y1={T} y2={H - B} stroke="#262626" strokeDasharray="2 3" />
            <text x={L + i * 12 * bw + 2} y={H - 8} fontSize="10" fill="#737373">
              {startYear + i}
            </text>
          </g>
        ))}
        <line x1={L} x2={W - R} y1={H - B} y2={H - B} stroke="#404040" />
        {vals.map((v, i) =>
          v > 0 ? (
            <rect
              key={i}
              x={L + i * bw + 1}
              y={y(v)}
              width={Math.max(1, bw - 2)}
              height={Math.max(2, H - B - y(v))}
              rx={1.5}
              fill={hover === i ? "#8fd16e" : "#6abc46"}
            />
          ) : null,
        )}
        {vals.map((_, i) => (
          <rect key={`h${i}`} x={L + i * bw} y={T} width={bw} height={H - T - B} fill="transparent" onMouseEnter={() => setHover(i)} />
        ))}
      </svg>
      {hover !== null && (
        <div
          className="pointer-events-none absolute -translate-x-1/2 -translate-y-full whitespace-nowrap rounded-md border border-neutral-700 bg-black px-2 py-1 text-xs text-neutral-200"
          style={{ left: `${((L + (hover + 0.5) * bw) / W) * 100}%`, top: `${(y(vals[hover]) / H) * 100}%` }}
        >
          {MONTHS[hover % 12]} {startYear + Math.floor(hover / 12)}: <b className="tabular-nums">{fmt(vals[hover])} CE</b>
        </div>
      )}
    </div>
  );
}

function ImportPanel({ onDone }: { onDone: () => void }) {
  const [file, setFile] = useState<File | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<{ step: string; done: number; total: number } | null>(null);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);

  async function readFile(f: File): Promise<ImportFile> {
    let text: string;
    if (f.name.endsWith(".gz")) {
      const stream = f.stream().pipeThrough(new DecompressionStream("gzip"));
      text = await new Response(stream).text();
    } else {
      text = await f.text();
    }
    const data = JSON.parse(text) as ImportFile;
    if (data.format !== "fcb-sales-accounts-v1" || !Array.isArray(data.accounts)) {
      throw new Error("This isn't an FCB accounts import file.");
    }
    return data;
  }

  async function send(action: string, extra: Record<string, unknown> = {}) {
    const res = await fetch("/api/sales-accounts/import", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action, ...extra }),
    });
    const json = (await res.json().catch(() => ({}))) as { error?: string };
    if (!res.ok) throw new Error(json.error ?? `Import step "${action}" failed (${res.status}).`);
  }

  async function run() {
    if (!file) return;
    setBusy(true);
    setConfirming(false);
    setMessage(null);
    try {
      setProgress({ step: "Reading file", done: 0, total: 1 });
      const data = await readFile(file);
      await send("start");
      const parts: [string, unknown[], number][] = [
        ["accounts", data.accounts, 2000],
        ["sales", data.sales, 4000],
        ["contacts", data.contacts ?? [], 2000],
        ["buddies", data.buddies ?? [], 2000],
        ["checkins", data.checkins ?? [], 2000],
      ];
      const total = parts.reduce((s, [, rows, size]) => s + Math.ceil(rows.length / size), 0) + 1;
      let done = 0;
      const label: Record<string, string> = {
        accounts: "Accounts",
        sales: "Purchase history",
        contacts: "Contacts",
        buddies: "Target-list (Buddy) accounts",
        checkins: "Check-ins",
      };
      for (const [action, rows, size] of parts) {
        if (action === "checkins" && rows.length) await send("checkins_clear");
        for (let i = 0; i < rows.length; i += size) {
          setProgress({ step: label[action], done, total });
          await send(action, { rows: rows.slice(i, i + size) });
          done++;
        }
      }
      setProgress({ step: "Working out each account's summary", done, total });
      await send("finish", { as_of: data.as_of });
      setProgress({ step: "Done", done: total, total });
      setMessage({
        ok: true,
        text: `Imported ${data.accounts.length.toLocaleString()} accounts, ${data.sales.length.toLocaleString()} purchase rows and ${(data.contacts ?? []).length.toLocaleString()} contacts (data as of ${fdate(data.as_of)}).`,
      });
      onDone();
    } catch (e) {
      setMessage({ ok: false, text: `${e instanceof Error ? e.message : String(e)} Nothing else was changed after this step; run the import again to finish.` });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-3 rounded-lg border border-neutral-800 bg-neutral-900 p-3">
      <div>
        <h2 className="text-sm font-semibold text-neutral-100">Import account data</h2>
        <p className="text-xs text-neutral-500">
          Upload an accounts import file (.json.gz). This <b className="text-neutral-300">replaces all account data</b> — accounts, purchase history and contacts — with what&apos;s in the file.
        </p>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <input
          id="accounts-import-file"
          type="file"
          accept=".gz,.json,application/gzip,application/json"
          disabled={busy}
          onChange={(e) => {
            setFile(e.target.files?.[0] ?? null);
            setConfirming(false);
            setMessage(null);
          }}
          className="text-sm text-neutral-300 file:mr-3 file:rounded-md file:border file:border-neutral-700 file:bg-neutral-950 file:px-3 file:py-1.5 file:text-neutral-200"
        />
        {!confirming ? (
          <button
            type="button"
            disabled={!file || busy}
            onClick={() => setConfirming(true)}
            className="rounded-md bg-white px-3 py-1.5 text-sm font-medium text-black hover:bg-neutral-200 disabled:opacity-50"
          >
            Import
          </button>
        ) : (
          <div className="flex flex-wrap items-center gap-2 rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-1.5 text-sm text-amber-200">
            Replace all account data with this file?
            <button type="button" onClick={run} className="rounded-md bg-white px-2.5 py-1 text-xs font-medium text-black hover:bg-neutral-200">
              Yes, replace
            </button>
            <button type="button" onClick={() => setConfirming(false)} className="rounded-md border border-neutral-600 px-2.5 py-1 text-xs text-neutral-200">
              Cancel
            </button>
          </div>
        )}
      </div>
      {progress && busy && (
        <div className="flex flex-col gap-1">
          <div className="h-1.5 overflow-hidden rounded-full bg-neutral-800">
            <div className="h-full bg-[#6abc46] transition-all" style={{ width: `${(progress.done / Math.max(1, progress.total)) * 100}%` }} />
          </div>
          <span className="text-xs text-neutral-400">
            {progress.step}… ({progress.done} of {progress.total} steps)
          </span>
        </div>
      )}
      {message && <p className={`text-sm ${message.ok ? "text-[#8fd16e]" : "text-red-300"}`}>{message.text}</p>}
    </div>
  );
}
