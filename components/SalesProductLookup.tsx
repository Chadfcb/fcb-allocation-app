"use client";

// Sales > Accounts > Product Lookup tab (added 2026-10-08, per Chad: "if i
// wanted to see how many mystic haze 12oz cases were sold to matagrano in a
// certain time period"). Whole months only (Chad). Pick products, sizes,
// distributor / rep, premise, an optional single account and a From–To month
// range; the database adds it up (sales_product_lookup in
// sql/sales_product_lookup.sql) and this shows the totals, a month-by-month
// chart, and breakdowns by distributor, product + size, and account.
//
// Hide items / Unhide items (added 2026-10-08, per Chad): one shared list of
// products we don't make anymore (sales_product_hidden, sql/sales_product_hidden.sql).
// Hidden products drop out of the product chips and out of "all products"
// totals. Anyone with Accounts access can hide or unhide; changes go to the
// Audit Log.

import { useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import NewBadge from "@/components/NewBadge";
import { useNewFeature } from "@/lib/newFeatures";
import {
  CURRENT_DISTRIBUTORS,
  PRODUCT_SIZES,
  REP_BY_DISTRIBUTOR,
  REPS,
  type ProductLookupResult,
} from "@/lib/salesAccounts";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const fmt = (n: number | null | undefined, d = 1) =>
  n == null ? "—" : Number(n).toLocaleString("en-US", { maximumFractionDigits: d });
const monthLabel = (ym: string) => `${MONTHS[+ym.slice(5, 7) - 1]} ${ym.slice(0, 4)}`;
const addMonths = (ym: string, n: number) => {
  const i = +ym.slice(0, 4) * 12 + (+ym.slice(5, 7) - 1) + n;
  return `${Math.floor(i / 12)}-${String((i % 12) + 1).padStart(2, "0")}`;
};
const FIRST_MONTH = "2020-01";
type SortKey = "last" | "cases" | "ce" | "lastCases" | "lastCe";
const SEL = "rounded-md border border-neutral-700 bg-neutral-950 px-2 py-1.5 text-sm text-neutral-100";

interface Option {
  product: string;
  size: string;
  ce: number;
}

export default function SalesProductLookup({
  asOf,
  accounts,
  onOpenAccount,
}: {
  asOf: string;
  accounts: { outlet_id: string; name: string; city: string | null }[];
  onOpenAccount: (outletId: string) => void;
}) {
  const supabase = useMemo(() => createClient(), []);
  const lastMonth = asOf.slice(0, 7);
  const allMonths = useMemo(() => {
    const out: string[] = [];
    for (let m = FIRST_MONTH; m <= lastMonth; m = addMonths(m, 1)) out.push(m);
    return out.reverse();
  }, [lastMonth]);

  const [options, setOptions] = useState<Option[] | null>(null);
  const [optError, setOptError] = useState<string | null>(null);
  const [products, setProducts] = useState<string[]>([]);
  const [sizes, setSizes] = useState<string[]>([]);
  const [dist, setDist] = useState("");
  const [rep, setRep] = useState("");
  const [premise, setPremise] = useState("");
  const [from, setFrom] = useState(addMonths(lastMonth, -2));
  const [to, setTo] = useState(lastMonth);
  const [accountQuery, setAccountQuery] = useState("");
  const [account, setAccount] = useState<{ outlet_id: string; name: string } | null>(null);
  const [productQuery, setProductQuery] = useState("");
  const [result, setResult] = useState<ProductLookupResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // product -> row id in sales_product_hidden; null until loaded
  const [hidden, setHidden] = useState<Map<string, string> | null>(null);
  const [hideMenu, setHideMenu] = useState<"hide" | "unhide" | null>(null);
  const [hideError, setHideError] = useState<string | null>(null);
  const hideNew = useNewFeature("feature:accounts-product-hide");
  // By account sort (Chad, 2026-10-08): default = last month bought, newest first.
  const [acctSort, setAcctSort] = useState<{ key: SortKey; desc: boolean }>({ key: "last", desc: true });

  useEffect(() => {
    (async () => {
      const { data, error: e } = await supabase.rpc("sales_product_options");
      if (e) setOptError(e.message);
      else setOptions(((data ?? []) as Option[]).map((o) => ({ ...o, ce: Number(o.ce) || 0 })));
    })();
  }, [supabase]);

  useEffect(() => {
    (async () => {
      const { data, error: e } = await supabase.from("sales_product_hidden").select("id,product");
      if (e) {
        // Table not there yet (SQL not run) — show everything.
        setHideError(e.message);
        setHidden(new Map());
      } else setHidden(new Map((data ?? []).map((r) => [r.product as string, r.id as string])));
    })();
  }, [supabase]);

  const allProducts = useMemo(() => {
    const m = new Map<string, number>();
    for (const o of options ?? []) m.set(o.product, (m.get(o.product) ?? 0) + o.ce);
    return [...m.entries()].sort((a, b) => b[1] - a[1]).map(([p]) => p);
  }, [options]);
  const productList = useMemo(() => allProducts.filter((p) => !hidden?.has(p)), [allProducts, hidden]);
  const hiddenList = useMemo(() => allProducts.filter((p) => hidden?.has(p)), [allProducts, hidden]);

  async function setProductHidden(product: string, hide: boolean) {
    setHideError(null);
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (hide) {
      const { data, error: e } = await supabase
        .from("sales_product_hidden")
        .insert({ product, hidden_by: user?.id ?? null })
        .select("id")
        .single();
      if (e) return setHideError(e.message);
      setHidden((h) => new Map(h ?? []).set(product, data.id as string));
      setProducts((ps) => ps.filter((p) => p !== product));
      await supabase.from("audit_log").insert({
        week_id: null,
        table_name: "sales_product_hidden",
        record_id: data.id,
        field_name: "hidden",
        old_value: product,
        new_value: "hidden",
        changed_by: user?.id ?? null,
      });
    } else {
      const id = hidden?.get(product);
      if (!id) return;
      const { error: e } = await supabase.from("sales_product_hidden").delete().eq("id", id);
      if (e) return setHideError(e.message);
      setHidden((h) => {
        const n = new Map(h ?? []);
        n.delete(product);
        return n;
      });
      await supabase.from("audit_log").insert({
        week_id: null,
        table_name: "sales_product_hidden",
        record_id: id,
        field_name: "hidden",
        old_value: product,
        new_value: "shown",
        changed_by: user?.id ?? null,
      });
    }
  }

  const distributors = useMemo(() => {
    if (dist) return [dist];
    if (rep) return Object.entries(REP_BY_DISTRIBUTOR).filter(([, r]) => r === rep).map(([d]) => d);
    return [];
  }, [dist, rep]);

  // Run the lookup whenever a filter changes (short pause so typing doesn't spam it).
  // "All products" means all products that aren't hidden.
  const lookupProducts = useMemo(() => {
    if (products.length) return products;
    if (!hidden || hidden.size === 0) return [];
    return productList.length ? productList : ["(none)"];
  }, [products, hidden, productList]);
  const ready = hidden !== null && (options !== null || optError !== null);

  useEffect(() => {
    if (!ready) return;
    const t = setTimeout(async () => {
      setBusy(true);
      setError(null);
      const lo = from <= to ? from : to;
      const hi = from <= to ? to : from;
      const { data, error: e } = await supabase.rpc("sales_product_lookup", {
        p_products: lookupProducts,
        p_sizes: sizes,
        p_distributors: distributors,
        p_outlet: account?.outlet_id ?? null,
        p_premise: premise || null,
        p_from: `${lo}-01`,
        p_to: `${hi}-01`,
      });
      setBusy(false);
      if (e) {
        setError(e.message);
        return;
      }
      setResult(data as ProductLookupResult);
    }, 250);
    return () => clearTimeout(t);
  }, [supabase, ready, lookupProducts, sizes, distributors, account, premise, from, to]);

  const setRange = (kind: "this" | "3" | "12" | "ytd" | "lastyear" | "all") => {
    const y = lastMonth.slice(0, 4);
    if (kind === "this") {
      setFrom(lastMonth);
      setTo(lastMonth);
    } else if (kind === "3") {
      setFrom(addMonths(lastMonth, -2));
      setTo(lastMonth);
    } else if (kind === "12") {
      setFrom(addMonths(lastMonth, -11));
      setTo(lastMonth);
    } else if (kind === "ytd") {
      setFrom(`${y}-01`);
      setTo(lastMonth);
    } else if (kind === "lastyear") {
      setFrom(`${+y - 1}-01`);
      setTo(`${+y - 1}-12`);
    } else {
      setFrom(FIRST_MONTH);
      setTo(lastMonth);
    }
  };

  const accountMatches = useMemo(() => {
    const q = accountQuery.trim().toLowerCase();
    if (q.length < 2) return [];
    return accounts
      .filter((a) => `${a.name} ${a.city ?? ""} ${a.outlet_id}`.toLowerCase().includes(q))
      .slice(0, 8);
  }, [accountQuery, accounts]);

  const toggle = (list: string[], v: string, set: (x: string[]) => void) =>
    set(list.includes(v) ? list.filter((x) => x !== v) : [...list, v]);

  const shownProducts = productList.filter((p) => !productQuery || p.toLowerCase().includes(productQuery.toLowerCase()));
  const t = result?.totals;
  const ACCT_SHOWN = 500;
  const sortedAccounts = useMemo(() => {
    const rows = [...(result?.by_account ?? [])];
    const val = (a: ProductLookupResult["by_account"][number]) =>
      acctSort.key === "last"
        ? a.last_month
        : acctSort.key === "cases"
          ? Number(a.cases)
          : acctSort.key === "ce"
            ? Number(a.ce)
            : acctSort.key === "lastCases"
              ? Number(a.last_cases)
              : Number(a.last_ce);
    rows.sort((a, b) => {
      const x = val(a);
      const y = val(b);
      const c = x < y ? -1 : x > y ? 1 : Number(b.cases) - Number(a.cases);
      return acctSort.key !== "last" || x !== y ? (acctSort.desc ? -c : c) : c;
    });
    return rows;
  }, [result, acctSort]);
  const sortHead = (key: SortKey, label: string) => (
    <th className="sticky top-0 bg-neutral-950 px-3 py-2 text-right font-semibold">
      <button
        type="button"
        id={`lookup-sort-${key}`}
        onClick={() => setAcctSort((s) => (s.key === key ? { key, desc: !s.desc } : { key, desc: true }))}
        className={`inline-flex items-center gap-1 uppercase tracking-wider hover:text-neutral-200 ${acctSort.key === key ? "text-neutral-100" : ""}`}
        aria-label={`Sort by ${label}`}
      >
        {label}
        <span className="text-[10px]">{acctSort.key === key ? (acctSort.desc ? "▼" : "▲") : "↕"}</span>
      </button>
    </th>
  );

  return (
    <div className="flex flex-col gap-4">
      {/* Filters */}
      <div className="flex flex-col gap-3 rounded-lg border border-neutral-800 bg-neutral-900 p-3">
        <div className="flex flex-wrap items-end gap-3">
          <label className="flex flex-col gap-1 text-xs text-neutral-500">
            From
            <select id="lookup-from" value={from} onChange={(e) => setFrom(e.target.value)} className={SEL}>
              {allMonths.map((m) => (
                <option key={m} value={m}>
                  {monthLabel(m)}
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1 text-xs text-neutral-500">
            To
            <select id="lookup-to" value={to} onChange={(e) => setTo(e.target.value)} className={SEL}>
              {allMonths.map((m) => (
                <option key={m} value={m}>
                  {monthLabel(m)}
                </option>
              ))}
            </select>
          </label>
          <div className="flex flex-wrap gap-1.5">
            {(
              [
                ["this", "This month"],
                ["3", "Last 3 months"],
                ["12", "Last 12 months"],
                ["ytd", "Year to date"],
                ["lastyear", "Last year"],
                ["all", "All time"],
              ] as const
            ).map(([k, label]) => (
              <button
                key={k}
                type="button"
                onClick={() => setRange(k)}
                className="rounded-full border border-neutral-700 px-3 py-1 text-xs text-neutral-300 hover:bg-neutral-800"
              >
                {label}
              </button>
            ))}
          </div>
        </div>

        <div className="flex flex-wrap items-end gap-3">
          <label className="flex flex-col gap-1 text-xs text-neutral-500">
            Rep
            <select
              id="lookup-rep"
              value={rep}
              onChange={(e) => {
                setRep(e.target.value);
                setDist("");
              }}
              className={SEL}
            >
              <option value="">All reps</option>
              {REPS.map((r) => (
                <option key={r.rep} value={r.rep}>
                  {r.rep} ({r.territory})
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1 text-xs text-neutral-500">
            Distributor
            <select
              id="lookup-dist"
              value={dist}
              onChange={(e) => {
                setDist(e.target.value);
                setRep("");
              }}
              className={SEL}
            >
              <option value="">All distributors</option>
              {CURRENT_DISTRIBUTORS.map((d) => (
                <option key={d} value={d}>
                  {d}
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1 text-xs text-neutral-500">
            Premise
            <select id="lookup-premise" value={premise} onChange={(e) => setPremise(e.target.value)} className={SEL}>
              <option value="">On + Off premise</option>
              <option value="On">On premise</option>
              <option value="Off">Off premise</option>
            </select>
          </label>
          <div className="relative flex min-w-0 flex-[1_1_240px] flex-col gap-1 text-xs text-neutral-500">
            <label htmlFor="lookup-account">One account (optional)</label>
            {account ? (
              <div className="flex items-center gap-2 rounded-md border border-[#6abc46]/60 bg-neutral-950 px-2 py-1.5 text-sm text-neutral-100">
                <span className="truncate">{account.name}</span>
                <button type="button" onClick={() => setAccount(null)} className="ml-auto text-neutral-400 hover:text-neutral-100" aria-label="Clear account">
                  ✕
                </button>
              </div>
            ) : (
              <input
                id="lookup-account"
                type="search"
                value={accountQuery}
                onChange={(e) => setAccountQuery(e.target.value)}
                placeholder="Search account name, city or Outlet ID"
                className="rounded-md border border-neutral-700 bg-neutral-950 px-2 py-1.5 text-sm text-neutral-100"
              />
            )}
            {!account && accountMatches.length > 0 && (
              <div className="absolute left-0 right-0 top-full z-20 mt-1 overflow-hidden rounded-md border border-neutral-700 bg-neutral-950 shadow-lg">
                {accountMatches.map((a) => (
                  <button
                    key={a.outlet_id}
                    type="button"
                    onClick={() => {
                      setAccount({ outlet_id: a.outlet_id, name: a.name });
                      setAccountQuery("");
                    }}
                    className="block w-full px-3 py-1.5 text-left text-sm text-neutral-200 hover:bg-neutral-800"
                  >
                    {a.name} <span className="text-neutral-500">{[a.city, a.outlet_id].filter(Boolean).join(" · ")}</span>
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>

        <div className="flex flex-col gap-1">
          <span className="text-xs text-neutral-500">Size {sizes.length > 0 && <span className="text-neutral-400">({sizes.length} picked)</span>}</span>
          <div className="flex flex-wrap gap-1.5">
            {PRODUCT_SIZES.map((sz) => {
              const on = sizes.includes(sz);
              return (
                <button
                  key={sz}
                  type="button"
                  aria-pressed={on}
                  onClick={() => toggle(sizes, sz, setSizes)}
                  className={`rounded-full border px-3 py-1 text-sm ${on ? "border-[#6abc46] bg-[#6abc46]/15 text-neutral-100" : "border-neutral-700 text-neutral-300 hover:bg-neutral-800"}`}
                >
                  {sz}
                </button>
              );
            })}
            {sizes.length > 0 && (
              <button type="button" onClick={() => setSizes([])} className="px-2 text-xs text-neutral-400 hover:text-neutral-100">
                All sizes
              </button>
            )}
            <div className="relative ml-auto flex gap-2">
              {(
                [
                  ["hide", "Hide items", productList.length],
                  ["unhide", "Unhide items", hiddenList.length],
                ] as const
              ).map(([k, label, n]) => (
                <button
                  key={k}
                  id={`lookup-${k}-items`}
                  type="button"
                  aria-expanded={hideMenu === k}
                  onClick={() => {
                    setHideMenu(hideMenu === k ? null : k);
                    if (k === "hide") hideNew.dismiss();
                  }}
                  className={`relative z-30 rounded-md border px-3 py-1 text-sm ${hideMenu === k ? "border-[#6abc46] bg-[#6abc46]/15 text-neutral-100" : "border-neutral-700 text-neutral-300 hover:bg-neutral-800"}`}
                >
                  {label} <span className="text-neutral-500">({n})</span>
                  {k === "hide" && hideNew.isNew && <NewBadge inline />}
                </button>
              ))}
              {hideMenu && (
                <>
                  <button type="button" aria-label="Close" className="fixed inset-0 z-20 cursor-default" onClick={() => setHideMenu(null)} />
                  <div className="absolute right-0 top-full z-30 mt-1 flex max-h-96 w-72 flex-col rounded-md border border-neutral-700 bg-neutral-950 shadow-lg">
                    <p className="border-b border-neutral-800 px-3 py-2 text-xs text-neutral-400">
                      {hideMenu === "hide"
                        ? "Click a product to hide it for everyone. Hidden products are left out of the list and the totals."
                        : "Click a product to bring it back."}
                    </p>
                    <div className="overflow-y-auto py-1">
                      {(hideMenu === "hide" ? productList : hiddenList).length === 0 ? (
                        <p className="px-3 py-2 text-sm text-neutral-500">{hideMenu === "hide" ? "Nothing left to hide." : "Nothing is hidden."}</p>
                      ) : (
                        (hideMenu === "hide" ? productList : hiddenList).map((p) => (
                          <button
                            key={p}
                            type="button"
                            onClick={() => setProductHidden(p, hideMenu === "hide")}
                            className="flex w-full items-center justify-between gap-2 px-3 py-1.5 text-left text-sm text-neutral-200 hover:bg-neutral-800"
                          >
                            <span className="truncate">{p}</span>
                            <span className="shrink-0 text-xs text-neutral-500">{hideMenu === "hide" ? "Hide" : "Unhide"}</span>
                          </button>
                        ))
                      )}
                    </div>
                  </div>
                </>
              )}
            </div>
          </div>
          {hideError && <p className="text-xs text-red-300">Couldn&apos;t update hidden products: {hideError}</p>}
        </div>

        <div className="flex flex-col gap-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs text-neutral-500">
              Product {products.length > 0 ? <span className="text-neutral-400">({products.length} picked)</span> : <span className="text-neutral-400">(all)</span>}
            </span>
            <input
              id="lookup-product-search"
              type="search"
              value={productQuery}
              onChange={(e) => setProductQuery(e.target.value)}
              placeholder="Find a product"
              className="rounded-md border border-neutral-700 bg-neutral-950 px-2 py-1 text-sm text-neutral-100"
            />
            {products.length > 0 && (
              <button type="button" onClick={() => setProducts([])} className="text-xs text-neutral-400 hover:text-neutral-100">
                All products
              </button>
            )}
          </div>
          {optError ? (
            <p className="text-sm text-red-300">Couldn&apos;t load the product list: {optError}</p>
          ) : options === null ? (
            <p className="text-sm text-neutral-500">Loading products…</p>
          ) : (
            <div className="flex max-h-40 flex-wrap gap-1.5 overflow-y-auto">
              {shownProducts.map((p) => {
                const on = products.includes(p);
                return (
                  <button
                    key={p}
                    type="button"
                    aria-pressed={on}
                    onClick={() => toggle(products, p, setProducts)}
                    className={`rounded-full border px-3 py-1 text-sm ${on ? "border-[#6abc46] bg-[#6abc46]/15 text-neutral-100" : "border-neutral-700 text-neutral-300 hover:bg-neutral-800"}`}
                  >
                    {p}
                  </button>
                );
              })}
            </div>
          )}
        </div>
      </div>

      {error && <p className="rounded-md border border-red-500/40 bg-red-500/10 px-3 py-2 text-sm text-red-300">Couldn&apos;t run the lookup: {error}</p>}

      {/* Results */}
      <div className={`flex flex-col gap-4 ${busy ? "opacity-60" : ""}`}>
        <p className="text-sm text-neutral-400">
          {products.length ? products.join(", ") : hiddenList.length ? `All products except ${hiddenList.length} hidden` : "All products"} · {sizes.length ? sizes.join(", ") : "all sizes"} ·{" "}
          {dist || (rep ? `${rep}'s distributors` : "all distributors")}
          {premise ? ` · ${premise} premise` : ""}
          {account ? ` · ${account.name}` : ""} · {monthLabel(from <= to ? from : to)} – {monthLabel(from <= to ? to : from)}
          {busy && " · updating…"}
        </p>
        <div className="grid grid-cols-2 gap-2.5 md:grid-cols-4">
          {[
            ["Cases / kegs", fmt(t?.cases)],
            ["Case equivalents (CE)", fmt(t?.ce)],
            ["Accounts that bought", fmt(t?.accounts, 0)],
            ["Months with sales", fmt(t?.months, 0)],
          ].map(([k, v]) => (
            <div key={k} className="rounded-lg border border-neutral-800 bg-neutral-900 px-4 py-3">
              <div className="text-xs text-neutral-400">{k}</div>
              <div className="text-2xl font-bold tabular-nums text-neutral-100">{v}</div>
            </div>
          ))}
        </div>

        {result && result.by_month.length > 0 && (
          <div className="rounded-lg border border-neutral-800 bg-neutral-900 p-3">
            <h3 className="mb-2 text-xs font-semibold uppercase tracking-widest text-neutral-400">Cases / kegs by month</h3>
            <LookupChart rows={result.by_month} from={from <= to ? from : to} to={from <= to ? to : from} />
          </div>
        )}

        {result && result.totals.accounts === 0 && !busy && (
          <p className="rounded-lg border border-neutral-800 px-3 py-6 text-center text-sm text-neutral-500">
            No sales match these filters. Try a wider month range or fewer filters.
          </p>
        )}

        {result && result.totals.accounts > 0 && (
          <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
            <BreakdownTable
              title="By distributor"
              head={["Distributor", "Cases / kegs", "CE", "Accounts"]}
              rows={result.by_distributor.map((r) => [r.distributor, fmt(r.cases), fmt(r.ce), fmt(r.accounts, 0)])}
            />
            <BreakdownTable
              title="By product + size"
              head={["Product · size", "Cases / kegs", "CE", "Accounts"]}
              rows={result.by_product.map((r) => [`${r.product} · ${r.size}`, fmt(r.cases), fmt(r.ce), fmt(r.accounts, 0)])}
            />
          </div>
        )}

        {result && result.by_account.length > 0 && (
          <div className="overflow-hidden rounded-lg border border-neutral-800">
            <div className="flex flex-wrap items-baseline justify-between gap-2 border-b border-neutral-800 bg-neutral-900 px-3 py-2">
              <span className="text-sm font-semibold text-neutral-100">By account</span>
              <span className="text-xs text-neutral-500">
                {sortedAccounts.length > ACCT_SHOWN ? `Showing the first ${ACCT_SHOWN} of ${fmt(sortedAccounts.length, 0)} accounts. ` : ""}
                &quot;That month&quot; = the account&apos;s last month bought. Click a column to sort; click an account to open it.
              </span>
            </div>
            <div className="max-h-[60vh] overflow-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-[11px] uppercase tracking-wider text-neutral-500">
                    <th className="sticky top-0 bg-neutral-950 px-3 py-2 text-left font-semibold">Account</th>
                    <th className="sticky top-0 bg-neutral-950 px-3 py-2 text-left font-semibold">Distributor</th>
                    {sortHead("cases", "Cases / kegs")}
                    {sortHead("ce", "CE")}
                    {sortHead("last", "Last month bought")}
                    {sortHead("lastCases", "Cases that month")}
                    {sortHead("lastCe", "CE that month")}
                  </tr>
                </thead>
                <tbody>
                  {sortedAccounts.slice(0, ACCT_SHOWN).map((a) => (
                    <tr
                      key={a.outlet_id}
                      tabIndex={0}
                      onClick={() => onOpenAccount(a.outlet_id)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") onOpenAccount(a.outlet_id);
                      }}
                      className="cursor-pointer border-t border-neutral-800 hover:bg-neutral-900"
                    >
                      <td className="max-w-[320px] px-3 py-2">
                        <div className="truncate font-medium text-neutral-100">{a.name ?? a.outlet_id}</div>
                        <div className="truncate text-xs text-neutral-500">{a.city ?? "—"}</div>
                      </td>
                      <td className="whitespace-nowrap px-3 py-2 text-neutral-200">{a.distributor ?? "—"}</td>
                      <td className="whitespace-nowrap px-3 py-2 text-right tabular-nums text-neutral-100">{fmt(a.cases)}</td>
                      <td className="whitespace-nowrap px-3 py-2 text-right tabular-nums text-neutral-300">{fmt(a.ce)}</td>
                      <td className="whitespace-nowrap px-3 py-2 text-right tabular-nums text-neutral-300">{monthLabel(a.last_month.slice(0, 7))}</td>
                      <td className="whitespace-nowrap px-3 py-2 text-right tabular-nums text-neutral-100">{fmt(a.last_cases)}</td>
                      <td className="whitespace-nowrap px-3 py-2 text-right tabular-nums text-neutral-300">{fmt(a.last_ce)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        <p className="text-xs text-neutral-500">
          Cases are worked out from CE by size: 12oz case = 1 CE, 16oz case = 1.33, 19.2oz case = 0.8, 1/2 bbl = 6.89, 1/6 bbl = 2.29. Kegs count as one each.
          Sales before 2026 come from VIP (monthly totals); 2026 on comes from Lilypad.
        </p>
      </div>
    </div>
  );
}

function BreakdownTable({ title, head, rows }: { title: string; head: string[]; rows: string[][] }) {
  return (
    <div className="overflow-hidden rounded-lg border border-neutral-800">
      <div className="border-b border-neutral-800 bg-neutral-900 px-3 py-2 text-sm font-semibold text-neutral-100">{title}</div>
      <div className="max-h-80 overflow-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-[11px] uppercase tracking-wider text-neutral-500">
              {head.map((h, i) => (
                <th key={h} className={`sticky top-0 bg-neutral-950 px-3 py-2 font-semibold ${i === 0 ? "text-left" : "text-right"}`}>
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r[0]} className="border-t border-neutral-800">
                {r.map((c, i) => (
                  <td key={i} className={`px-3 py-2 ${i === 0 ? "text-neutral-100" : "text-right tabular-nums text-neutral-200"}`}>
                    {c}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function LookupChart({ rows, from, to }: { rows: { month: string; cases: number; ce: number; accounts: number }[]; from: string; to: string }) {
  const [hover, setHover] = useState<number | null>(null);
  const months: string[] = [];
  for (let m = from; m <= to; m = addMonths(m, 1)) months.push(m);
  const byMonth = new Map(rows.map((r) => [r.month.slice(0, 7), r]));
  const vals = months.map((m) => Number(byMonth.get(m)?.cases ?? 0));
  const W = 900, H = 200, L = 44, R = 8, T = 12, B = 26;
  const N = months.length;
  const bw = (W - L - R) / N;
  const max = Math.max(...vals, 1);
  const p = Math.pow(10, Math.floor(Math.log10(max)));
  const f = max / p;
  const nice = (f <= 1 ? 1 : f <= 2 ? 2 : f <= 5 ? 5 : 10) * p;
  const y = (v: number) => T + (H - T - B) * (1 - v / nice);
  const labelEvery = N <= 12 ? 1 : N <= 36 ? 3 : 12;
  return (
    <div className="relative">
      <svg viewBox={`0 0 ${W} ${H}`} className="block h-auto w-full" role="img" aria-label="Cases by month" onMouseLeave={() => setHover(null)}>
        {[0, 0.5, 1].map((t) => (
          <g key={t}>
            <line x1={L} x2={W - R} y1={y(nice * t)} y2={y(nice * t)} stroke="#262626" />
            <text x={L - 6} y={y(nice * t) + 4} textAnchor="end" fontSize="11" fill="#737373">
              {fmt(nice * t, 0)}
            </text>
          </g>
        ))}
        <line x1={L} x2={W - R} y1={H - B} y2={H - B} stroke="#404040" />
        {months.map((m, i) =>
          i % labelEvery === 0 ? (
            <text key={m} x={L + i * bw + bw / 2} y={H - 8} textAnchor="middle" fontSize="11" fill="#737373">
              {labelEvery === 12 ? m.slice(0, 4) : `${MONTHS[+m.slice(5, 7) - 1]}${labelEvery > 1 || N > 12 ? ` ${m.slice(2, 4)}` : ""}`}
            </text>
          ) : null,
        )}
        {vals.map((v, i) =>
          v > 0 ? (
            <rect
              key={i}
              x={L + i * bw + Math.min(2, bw * 0.15)}
              y={y(v)}
              width={Math.max(1, bw - Math.min(4, bw * 0.3))}
              height={Math.max(2, H - B - y(v))}
              rx={2}
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
          {monthLabel(months[hover])}: <b className="tabular-nums">{fmt(vals[hover])} cases</b> · {fmt(byMonth.get(months[hover])?.ce ?? 0)} CE ·{" "}
          {fmt(byMonth.get(months[hover])?.accounts ?? 0, 0)} accounts
        </div>
      )}
    </div>
  );
}
