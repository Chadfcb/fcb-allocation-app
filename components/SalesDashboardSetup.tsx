"use client";

// Sales Dashboard → Chain setup (added 2026-10-08, per Chad).
//   Chains        — the automatic groupings (from "NAME #123" store names):
//                   rename (giving two the same name merges them), mark "not
//                   a chain", move single stores in / out of a chain.
//   Item matching — which of our chains each Chain Mandates / Chain
//                   Authorizations chain is, and which product + size each of
//                   their hand-typed items is. Unsaved rows show the best
//                   guess (tagged "guess"); picking anything saves it.
// Every change goes to the Audit Log. Tables: sql/sales_dashboard.sql.

import { useEffect, useMemo, useState } from "react";
import { SEL, audit, type Supa } from "@/components/SalesDashboardClient";
import { PRODUCT_SIZES } from "@/lib/salesAccounts";
import type { DashOverview, GapByStoreResult, ListType, resolveLists } from "@/lib/salesDashboard";

type Resolved = ReturnType<typeof resolveLists>;
const BTN = "rounded border border-neutral-700 px-2 py-0.5 text-xs text-neutral-300 hover:bg-neutral-800 disabled:opacity-50";

export default function SalesDashboardSetup({
  supabase,
  ov,
  resolved,
  userId,
  onChanged,
}: {
  supabase: Supa;
  ov: DashOverview;
  resolved: Resolved;
  userId: string | null;
  onChanged: () => void;
}) {
  const [sub, setSub] = useState<"chains" | "items">("chains");
  return (
    <div className="flex flex-col gap-3">
      <div className="flex overflow-hidden self-start rounded-md border border-neutral-700">
        {(
          [
            ["chains", "Chains"],
            ["items", "Item matching (Chain Mandates / Authorizations)"],
          ] as const
        ).map(([k, label]) => (
          <button
            key={k}
            id={`setup-${k}`}
            type="button"
            onClick={() => setSub(k)}
            className={`px-3 py-1.5 text-sm ${sub === k ? "bg-[#6abc46]/20 text-neutral-100" : "text-neutral-400 hover:bg-neutral-800"}`}
          >
            {label}
          </button>
        ))}
      </div>
      {sub === "chains" ? (
        <ChainsSetup supabase={supabase} ov={ov} userId={userId} onChanged={onChanged} />
      ) : (
        <ItemsSetup supabase={supabase} ov={ov} resolved={resolved} userId={userId} onChanged={onChanged} />
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Chains
// ---------------------------------------------------------------------------
function ChainsSetup({ supabase, ov, userId, onChanged }: { supabase: Supa; ov: DashOverview; userId: string | null; onChanged: () => void }) {
  const [q, setQ] = useState("");
  const [open, setOpen] = useState<string | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const [newName, setNewName] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const nameRow = useMemo(() => new Map(ov.names.map((n) => [n.auto_name, n])), [ov]);

  const chains = useMemo(() => {
    const qq = q.trim().toUpperCase();
    return ov.chains.filter((c) => !qq || c.chain.includes(qq) || c.auto_names.some((a) => a.includes(qq)));
  }, [ov, q]);

  // Writes one sales_chain_names row per automatic group.
  async function saveName(auto: string, patch: { chain_name?: string | null; not_chain?: boolean }) {
    const prev = nameRow.get(auto);
    const { data, error } = await supabase
      .from("sales_chain_names")
      .upsert({ auto_name: auto, chain_name: prev?.chain_name ?? null, not_chain: prev?.not_chain ?? false, ...patch, updated_by: userId, updated_at: new Date().toISOString() }, { onConflict: "auto_name" })
      .select("id")
      .single();
    if (error) return error.message;
    if ("chain_name" in patch) await audit(supabase, userId, "sales_chain_names", data.id as string, `chain name (${auto})`, prev?.chain_name ?? auto, patch.chain_name ?? auto);
    if ("not_chain" in patch) await audit(supabase, userId, "sales_chain_names", data.id as string, `not a chain (${auto})`, String(prev?.not_chain ?? false), String(patch.not_chain));
    return null;
  }

  async function rename(chain: string, autos: string[]) {
    const name = newName.trim().toUpperCase();
    if (!name || name === chain) return setEditing(null);
    setErr(null);
    for (const a of autos) {
      const e = await saveName(a, { chain_name: name === a ? null : name });
      if (e) return setErr(e);
    }
    // Stores moved into this chain by hand follow the new name too.
    const { data: moved } = await supabase.from("sales_chain_store").select("id,outlet_id").eq("chain_name", chain);
    for (const m of moved ?? []) {
      await supabase.from("sales_chain_store").update({ chain_name: name, updated_by: userId, updated_at: new Date().toISOString() }).eq("id", m.id);
      await audit(supabase, userId, "sales_chain_store", m.id as string, `chain (${m.outlet_id})`, chain, name);
    }
    setEditing(null);
    onChanged();
  }

  async function notAChain(autos: string[]) {
    setErr(null);
    for (const a of autos) {
      const e = await saveName(a, { not_chain: true });
      if (e) return setErr(e);
    }
    onChanged();
  }

  return (
    <div className="flex flex-col gap-3">
      <p className="text-sm text-neutral-400">
        Chains are grouped automatically from store names (&quot;SAFEWAY #667&quot; → SAFEWAY); a group needs 2+ stores. Rename a chain to fix it — giving two
        chains the same name merges them.
      </p>
      {err && <p className="text-sm text-red-300">{err}</p>}
      <input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder={`Search ${ov.chains.length} chains`} className={`${SEL} w-72`} />
      <datalist id="chain-names">
        {ov.chains.map((c) => (
          <option key={c.chain} value={c.chain} />
        ))}
      </datalist>
      <div className="overflow-hidden rounded-lg border border-neutral-800">
        <table className="w-full text-sm">
          <thead className="bg-neutral-950 text-left text-xs text-neutral-500">
            <tr>
              <th className="px-3 py-2 font-medium">Chain</th>
              <th className="px-3 py-2 text-right font-medium">Stores</th>
              <th className="px-3 py-2 font-medium">From store names</th>
              <th className="px-3 py-2" />
            </tr>
          </thead>
          <tbody>
            {chains.map((c) => (
              <ChainRow
                key={c.chain}
                supabase={supabase}
                userId={userId}
                chain={c.chain}
                stores={c.stores}
                autos={c.auto_names}
                isOpen={open === c.chain}
                onToggle={() => setOpen(open === c.chain ? null : c.chain)}
                editing={editing === c.chain}
                newName={newName}
                setNewName={setNewName}
                startEdit={() => {
                  setEditing(c.chain);
                  setNewName(c.chain);
                }}
                cancelEdit={() => setEditing(null)}
                onRename={() => rename(c.chain, c.auto_names)}
                onNotChain={() => notAChain(c.auto_names)}
                onChanged={onChanged}
              />
            ))}
          </tbody>
        </table>
      </div>
      {ov.not_chains.length > 0 && (
        <div className="rounded-lg border border-neutral-800 bg-neutral-900 p-3">
          <h3 className="mb-2 text-sm font-semibold text-neutral-200">Marked &quot;not a chain&quot; ({ov.not_chains.length})</h3>
          <div className="flex flex-wrap gap-2">
            {ov.not_chains.map((a) => (
              <span key={a} className="flex items-center gap-2 rounded border border-neutral-700 px-2 py-1 text-xs text-neutral-300">
                {a}
                <button
                  type="button"
                  onClick={async () => {
                    const e = await saveName(a, { not_chain: false });
                    if (e) setErr(e);
                    else onChanged();
                  }}
                  className="text-[#9be07a] hover:underline"
                >
                  Make it a chain again
                </button>
              </span>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

interface StoreSearchRow {
  outlet_id: string;
  name: string;
  city: string | null;
  distributor: string | null;
  chain: string | null;
  is_off: boolean;
}

function ChainRow(props: {
  supabase: Supa;
  userId: string | null;
  chain: string;
  stores: number;
  autos: string[];
  isOpen: boolean;
  onToggle: () => void;
  editing: boolean;
  newName: string;
  setNewName: (s: string) => void;
  startEdit: () => void;
  cancelEdit: () => void;
  onRename: () => void;
  onNotChain: () => void;
  onChanged: () => void;
}) {
  const { supabase, userId, chain } = props;
  const [data, setData] = useState<GapByStoreResult | null>(null);
  const [moveTo, setMoveTo] = useState<Record<string, string>>({});
  const [q, setQ] = useState("");
  const [found, setFound] = useState<StoreSearchRow[]>([]);
  const [err, setErr] = useState<string | null>(null);
  const [reload, setReload] = useState(0);

  useEffect(() => {
    if (!props.isOpen) return;
    (async () => {
      const { data: d, error } = await supabase.rpc("sales_gap_by_store", { p_chain: chain, p_distributor: null });
      if (error) setErr(error.message);
      else setData(d as GapByStoreResult);
    })();
  }, [supabase, chain, props.isOpen, reload]);

  useEffect(() => {
    if (q.trim().length < 2) return;
    const t = setTimeout(async () => {
      const { data: d } = await supabase.rpc("sales_dash_search", { p_q: q.trim() });
      setFound(((d ?? []) as StoreSearchRow[]).filter((r) => r.chain !== chain && !r.is_off));
    }, 250);
    return () => clearTimeout(t);
  }, [supabase, q, chain]);

  async function setStoreChain(outletId: string, from: string | null, to: string | null) {
    setErr(null);
    const { data: row, error } = await supabase
      .from("sales_chain_store")
      .upsert({ outlet_id: outletId, chain_name: to, updated_by: userId, updated_at: new Date().toISOString() }, { onConflict: "outlet_id" })
      .select("id")
      .single();
    if (error) return setErr(error.message);
    await audit(supabase, userId, "sales_chain_store", row.id as string, `chain (${outletId})`, from ?? "(none)", to ?? "(not in a chain)");
    setReload((r) => r + 1);
    props.onChanged();
  }

  return (
    <>
      <tr className="border-t border-neutral-800">
        <td className="px-3 py-1.5">
          {props.editing ? (
            <span className="flex items-center gap-1.5">
              <input
                autoFocus
                list="chain-names"
                value={props.newName}
                onChange={(e) => props.setNewName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") props.onRename();
                  if (e.key === "Escape") props.cancelEdit();
                }}
                className={`${SEL} w-56 py-0.5`}
              />
              <button type="button" onClick={props.onRename} className={BTN}>
                Save
              </button>
              <button type="button" onClick={props.cancelEdit} className="text-xs text-neutral-400">
                Cancel
              </button>
            </span>
          ) : (
            <button type="button" onClick={props.onToggle} className="text-left font-medium text-neutral-100 hover:underline" aria-expanded={props.isOpen}>
              {props.isOpen ? "▾ " : "▸ "}
              {chain}
            </button>
          )}
        </td>
        <td className="px-3 py-1.5 text-right tabular-nums text-neutral-300">{props.stores}</td>
        <td className="px-3 py-1.5 text-xs text-neutral-500">{props.autos.join(", ") || "(set up by hand)"}</td>
        <td className="px-3 py-1.5 text-right">
          {!props.editing && (
            <span className="flex justify-end gap-1.5">
              <button type="button" onClick={props.startEdit} className={BTN}>
                Rename / merge
              </button>
              {props.autos.length > 0 && (
                <button type="button" onClick={props.onNotChain} className={BTN}>
                  Not a chain
                </button>
              )}
            </span>
          )}
        </td>
      </tr>
      {props.isOpen && (
        <tr className="border-t border-neutral-800 bg-neutral-900/60">
          <td colSpan={4} className="px-3 py-2">
            {err && <p className="mb-2 text-sm text-red-300">{err}</p>}
            <div className="mb-2 flex items-center gap-2">
              <input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder={`Add a store to ${chain}: search name, city or Outlet ID`} className={`${SEL} w-96 py-1`} />
            </div>
            {q.trim().length >= 2 && found.length > 0 && (
              <div className="mb-2 flex flex-col rounded border border-neutral-800">
                {found.slice(0, 10).map((f) => (
                  <div key={f.outlet_id} className="flex items-center gap-2 px-2 py-1 text-xs">
                    <span className="flex-1 text-neutral-200">
                      {f.name} <span className="text-neutral-500">{[f.city, f.distributor, f.chain ? `now in ${f.chain}` : null].filter(Boolean).join(" · ")}</span>
                    </span>
                    <button
                      type="button"
                      onClick={async () => {
                        await setStoreChain(f.outlet_id, f.chain, chain);
                        setQ("");
                      }}
                      className={BTN}
                    >
                      Add to {chain}
                    </button>
                  </div>
                ))}
              </div>
            )}
            {!data ? (
              <p className="text-xs text-neutral-500">Loading stores…</p>
            ) : (
              <table className="w-full text-xs">
                <tbody>
                  {data.stores.map((s) => (
                    <tr key={s.outlet_id} className="border-t border-neutral-800/60">
                      <td className="py-1 pr-2 text-neutral-200">{s.name}</td>
                      <td className="py-1 pr-2 text-neutral-500">{[s.address, s.city].filter(Boolean).join(", ")}</td>
                      <td className="py-1 pr-2 text-neutral-500">{s.distributor}</td>
                      <td className="py-1 text-right">
                        <span className="flex justify-end gap-1.5">
                          <input
                            list="chain-names"
                            placeholder="Move to chain…"
                            value={moveTo[s.outlet_id] ?? ""}
                            onChange={(e) => setMoveTo({ ...moveTo, [s.outlet_id]: e.target.value })}
                            className={`${SEL} w-40 py-0.5 text-xs`}
                          />
                          <button
                            type="button"
                            disabled={!moveTo[s.outlet_id]?.trim()}
                            onClick={() => setStoreChain(s.outlet_id, chain, moveTo[s.outlet_id].trim().toUpperCase())}
                            className={BTN}
                          >
                            Move
                          </button>
                          <button type="button" onClick={() => setStoreChain(s.outlet_id, chain, null)} className={BTN}>
                            Remove from chain
                          </button>
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </td>
        </tr>
      )}
    </>
  );
}

// ---------------------------------------------------------------------------
// Item matching
// ---------------------------------------------------------------------------
function ItemsSetup({ supabase, ov, resolved, userId, onChanged }: { supabase: Supa; ov: DashOverview; resolved: Resolved; userId: string | null; onChanged: () => void }) {
  const [err, setErr] = useState<string | null>(null);
  const [onlyOpen, setOnlyOpen] = useState(false);
  const products = useMemo(() => [...new Set(ov.products.map((p) => p.product))].sort(), [ov]);
  const sizesFor = useMemo(() => {
    const m = new Map<string, string[]>();
    for (const p of ov.products) m.set(p.product, [...(m.get(p.product) ?? []), p.size]);
    for (const [k, v] of m) m.set(k, PRODUCT_SIZES.filter((s) => v.includes(s)));
    return m;
  }, [ov]);
  const savedChain = useMemo(() => new Map(ov.list_links.map((l) => [`${l.list_type}:${l.list_chain_id}`, l])), [ov]);
  const savedItem = useMemo(() => new Map(ov.item_links.map((l) => [`${l.list_type}:${l.list_item_id}`, l])), [ov]);

  async function saveChainLink(type: ListType, listChainId: string, listName: string, chain: string | null) {
    setErr(null);
    const prev = resolved.chainOf.get(`${type}:${listChainId}`)?.chain ?? null;
    const { data, error } = await supabase
      .from("sales_chain_list_link")
      .upsert({ list_type: type, list_chain_id: listChainId, chain_name: chain, updated_by: userId, updated_at: new Date().toISOString() }, { onConflict: "list_type,list_chain_id" })
      .select("id")
      .single();
    if (error) return setErr(error.message);
    await audit(supabase, userId, "sales_chain_list_link", data.id as string, `${type === "mandate" ? "Chain Mandates" : "Chain Authorizations"}: ${listName}`, prev, chain ?? "(not one of our chains)");
    onChanged();
  }

  async function saveItemLink(type: ListType, itemId: string, text: string, product: string | null, size: string | null) {
    setErr(null);
    const prev = resolved.links.get(`${type}:${itemId}`);
    const { data, error } = await supabase
      .from("sales_chain_item_link")
      .upsert({ list_type: type, list_item_id: itemId, product, size, updated_by: userId, updated_at: new Date().toISOString() }, { onConflict: "list_type,list_item_id" })
      .select("id")
      .single();
    if (error) return setErr(error.message);
    await audit(
      supabase,
      userId,
      "sales_chain_item_link",
      data.id as string,
      `item: ${text}`,
      prev?.product ? `${prev.product} · ${prev.size}` : null,
      product ? `${product} · ${size}` : "(not one of our products)",
    );
    onChanged();
  }

  const lists: { type: ListType; label: string; chains: { id: string; name: string }[]; items: { id: string; chain_id: string; text: string; extra?: string }[] }[] = [
    {
      type: "mandate",
      label: "Chain Mandates → Mandate",
      chains: ov.mandate_chains,
      items: ov.mandate_items.map((i) => ({ id: i.id, chain_id: i.chain_id, text: i.text, extra: i.stores.length ? `${i.stores.length} stores` : "whole chain" })),
    },
    { type: "auth", label: "Chain Authorizations → Flex", chains: ov.auth_chains, items: ov.auth_items },
  ];
  const unmatched = [...resolved.links.values()].filter((l) => !l.product).length;

  return (
    <div className="flex flex-col gap-4">
      <p className="text-sm text-neutral-400">
        The Chain Mandates and Chain Authorizations pages are typed by hand, so each chain and item is matched to our chains and products here. Rows tagged{" "}
        <span className="rounded bg-sky-500/20 px-1 text-sky-300">guess</span> were matched automatically — pick from the list to fix or confirm.{" "}
        {unmatched > 0 && <b className="text-amber-300">{unmatched} items aren&apos;t matched to a product yet.</b>}
      </p>
      <label className="flex items-center gap-2 text-sm text-neutral-300">
        <input type="checkbox" checked={onlyOpen} onChange={(e) => setOnlyOpen(e.target.checked)} />
        Only show items not matched yet
      </label>
      {err && <p className="text-sm text-red-300">{err}</p>}
      {lists.map((list) => (
        <div key={list.type} className="flex flex-col gap-3">
          <h2 className="text-sm font-semibold text-neutral-200">{list.label}</h2>
          {list.chains.map((lc) => {
            const ck = `${list.type}:${lc.id}`;
            const cur = resolved.chainOf.get(ck);
            const items = list.items.filter((i) => i.chain_id === lc.id && (!onlyOpen || !resolved.links.get(`${list.type}:${i.id}`)?.product));
            if (onlyOpen && items.length === 0) return null;
            return (
              <div key={lc.id} className="rounded-lg border border-neutral-800 bg-neutral-900 p-3">
                <div className="mb-2 flex flex-wrap items-center gap-2 text-sm">
                  <span className="font-semibold text-neutral-100">{lc.name}</span>
                  <span className="text-neutral-500">is our chain</span>
                  <select
                    aria-label={`Our chain for ${lc.name}`}
                    value={cur?.chain ?? ""}
                    onChange={(e) => saveChainLink(list.type, lc.id, lc.name, e.target.value || null)}
                    className={`${SEL} py-0.5`}
                  >
                    <option value="">(not one of our chains)</option>
                    {ov.chains.map((c) => (
                      <option key={c.chain} value={c.chain}>
                        {c.chain} ({c.stores})
                      </option>
                    ))}
                  </select>
                  {!savedChain.has(ck) && cur?.chain && <span className="rounded bg-sky-500/20 px-1 text-xs text-sky-300">guess</span>}
                </div>
                <table className="w-full text-sm">
                  <tbody>
                    {items.map((it) => {
                      const k = `${list.type}:${it.id}`;
                      const l = resolved.links.get(k);
                      const guessed = !savedItem.has(k);
                      return (
                        <tr key={it.id} className="border-t border-neutral-800/60">
                          <td className="py-1 pr-2 text-neutral-300">
                            {it.text}
                            {it.extra && <span className="ml-2 text-xs text-neutral-500">({it.extra})</span>}
                          </td>
                          <td className="w-[26rem] py-1">
                            <span className="flex items-center justify-end gap-1.5">
                              {guessed && l?.product && <span className="rounded bg-sky-500/20 px-1 text-xs text-sky-300">guess</span>}
                              {!l?.product && <span className="text-xs text-amber-300">not matched</span>}
                              <select
                                aria-label={`Product for ${it.text}`}
                                value={l?.product ?? ""}
                                onChange={(e) => {
                                  const p = e.target.value || null;
                                  const sizes = p ? (sizesFor.get(p) ?? []) : [];
                                  const size = p ? (l?.size && sizes.includes(l.size) ? l.size : (sizes[0] ?? null)) : null;
                                  saveItemLink(list.type, it.id, it.text, p, size);
                                }}
                                className={`${SEL} w-56 py-0.5 text-xs`}
                              >
                                <option value="">(not one of our products)</option>
                                {products.map((p) => (
                                  <option key={p} value={p}>
                                    {p}
                                  </option>
                                ))}
                              </select>
                              <select
                                aria-label={`Size for ${it.text}`}
                                value={l?.size ?? ""}
                                disabled={!l?.product}
                                onChange={(e) => saveItemLink(list.type, it.id, it.text, l?.product ?? null, e.target.value || null)}
                                className={`${SEL} w-24 py-0.5 text-xs`}
                              >
                                {!l?.size && <option value="">—</option>}
                                {(l?.product ? (sizesFor.get(l.product) ?? []) : []).map((s) => (
                                  <option key={s} value={s}>
                                    {s}
                                  </option>
                                ))}
                              </select>
                            </span>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            );
          })}
        </div>
      ))}
    </div>
  );
}
