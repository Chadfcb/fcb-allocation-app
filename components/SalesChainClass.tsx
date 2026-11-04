"use client";

// Sales Dashboard → Chain Classification (added 2026-11-04, per Chad: "these
// chains, we classified, we need a chain classification button that has these
// listed on the sales dashboard"). Loaded from FCB_Retail_Account_Contacts.xlsx.
//
// Chains grouped by tier (T1–T4) with each tier's touch-base schedule. Click a
// chain → its buyers / corporate contacts (email + phone clickable), change its
// tier, notes, add / edit / remove contacts. Export the whole list.
// Anyone with Sales Dashboard access can see and edit (RLS in
// sql/sales_chain_classification.sql). Stands on its own — not linked to store
// accounts or Chain setup.

import { useCallback, useEffect, useMemo, useState } from "react";
import type { Supa } from "@/components/SalesDashboardClient";
import { CARD, MUTED, ExportButton, Modal, exportSheets } from "@/components/SalesDashboardHome";

interface Tier {
  tier: string;
  cadence: string | null;
  sort: number;
}
interface Contact {
  id: string;
  chain_id: string;
  name: string | null;
  title: string | null;
  email: string | null;
  phone: string | null;
  notes: string | null;
  sort: number;
}
interface Chain {
  id: string;
  chain: string;
  tier: string;
  notes: string | null;
}

const INPUT =
  "min-h-9 w-full rounded-lg border border-neutral-700 bg-neutral-950 px-3 py-1.5 text-sm text-neutral-100 placeholder:text-neutral-500 focus:border-[#6abc46] focus:outline-none";
const SMALL_BTN =
  "inline-flex min-h-8 items-center rounded-full border border-neutral-700 px-3 text-xs font-semibold text-neutral-300 hover:border-[#6abc46]/40 hover:text-neutral-100 disabled:opacity-50";
const GREEN_BTN =
  "inline-flex min-h-8 items-center rounded-full border border-[#6abc46] bg-[#6abc46] px-3 text-xs font-bold text-neutral-950 hover:brightness-110 disabled:opacity-50";

const TIER_COLOR: Record<string, string> = {
  T1: "border-[#6abc46]/45 bg-[#6abc46]/15 text-[#9edc7f]",
  T2: "border-sky-400/40 bg-sky-400/10 text-sky-300",
  T3: "border-amber-400/40 bg-amber-400/10 text-amber-300",
  T4: "border-neutral-500/50 bg-neutral-500/10 text-neutral-300",
};
const tierClass = (t: string) => TIER_COLOR[t] ?? TIER_COLOR.T4;

function TierPill({ tier }: { tier: string }) {
  return <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-bold ${tierClass(tier)}`}>{tier}</span>;
}

export default function SalesChainClass({ supabase }: { supabase: Supa }) {
  const [tiers, setTiers] = useState<Tier[] | null>(null);
  const [chains, setChains] = useState<Chain[]>([]);
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [err, setErr] = useState<string | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);
  const [q, setQ] = useState("");
  const [adding, setAdding] = useState(false);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const [t, c, k] = await Promise.all([
      supabase.from("sales_chain_tiers").select("tier, cadence, sort").order("sort"),
      supabase.from("sales_chain_class").select("id, chain, tier, notes").order("chain"),
      supabase.from("sales_chain_class_contacts").select("id, chain_id, name, title, email, phone, notes, sort").order("sort"),
    ]);
    const e = t.error || c.error || k.error;
    if (e) {
      setErr(e.message);
      setTiers([]);
      return;
    }
    setErr(null);
    setTiers((t.data as Tier[]) ?? []);
    setChains((c.data as Chain[]) ?? []);
    setContacts((k.data as Contact[]) ?? []);
  }, [supabase]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- first load from the database
    load();
  }, [load]);

  const byChain = useMemo(() => {
    const m = new Map<string, Contact[]>();
    for (const c of contacts) {
      const a = m.get(c.chain_id) ?? [];
      a.push(c);
      m.set(c.chain_id, a);
    }
    return m;
  }, [contacts]);

  const term = q.trim().toLowerCase();
  const shown = useMemo(
    () =>
      chains.filter((c) => {
        if (!term) return true;
        if (c.chain.toLowerCase().includes(term)) return true;
        return (byChain.get(c.id) ?? []).some((k) => [k.name, k.title, k.email].some((v) => v?.toLowerCase().includes(term)));
      }),
    [chains, byChain, term],
  );

  async function exportAll() {
    setBusy(true);
    try {
      const cad = new Map((tiers ?? []).map((t) => [t.tier, t.cadence ?? "Not set"]));
      const order = new Map((tiers ?? []).map((t) => [t.tier, t.sort]));
      const sorted = [...chains].sort((a, b) => (order.get(a.tier) ?? 99) - (order.get(b.tier) ?? 99) || a.chain.localeCompare(b.chain));
      const rows: Record<string, unknown>[] = [];
      for (const c of sorted) {
        const ks = byChain.get(c.id) ?? [];
        if (!ks.length) rows.push({ chain: c.chain, tier: c.tier, cadence: cad.get(c.tier), name: "Prospect - no contact on file", title: "", email: "", phone: "", notes: c.notes ?? "" });
        for (const k of ks)
          rows.push({ chain: c.chain, tier: c.tier, cadence: cad.get(c.tier), name: k.name ?? "", title: k.title ?? "", email: k.email ?? "", phone: k.phone ?? "", notes: [k.notes, c.notes].filter(Boolean).join(" · ") });
      }
      await exportSheets("Chain Classification.xlsx", [
        {
          name: "Chain Classification",
          title: `Chain Classification · ${chains.length} chains · ${contacts.length} contacts`,
          cols: [
            { header: "Chain", key: "chain", width: 26 },
            { header: "Tier", key: "tier", width: 6 },
            { header: "Touch base", key: "cadence", width: 16 },
            { header: "Contact", key: "name", width: 26 },
            { header: "Role / Title", key: "title", width: 20 },
            { header: "Email", key: "email", width: 34 },
            { header: "Phone", key: "phone", width: 16 },
            { header: "Notes", key: "notes", width: 44 },
          ],
          rows,
        },
      ]);
    } finally {
      setBusy(false);
    }
  }

  if (!tiers) return <div className={`${CARD} text-sm ${MUTED}`}>Loading…</div>;

  const open = openId ? chains.find((c) => c.id === openId) ?? null : null;

  return (
    <div className="flex flex-col gap-4">
      <div className={`${CARD} flex flex-wrap items-center justify-between gap-3`}>
        <div>
          <h2 className="text-lg font-bold text-neutral-100">Chain Classification</h2>
          <p className={`text-sm ${MUTED}`}>
            {chains.length} chains · {contacts.length} contacts · click a chain for its buyers
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search chain or contact…" aria-label="Search chains and contacts" className={`${INPUT} w-56 rounded-full`} />
          <button type="button" className={SMALL_BTN} onClick={() => setAdding(true)}>
            + Add chain
          </button>
          <ExportButton onClick={exportAll} busy={busy} />
        </div>
      </div>
      {err && <div className="rounded-md border border-red-500/40 bg-red-500/10 px-3 py-2 text-sm text-red-300">{err}</div>}

      {tiers.map((t) => {
        const list = shown.filter((c) => c.tier === t.tier);
        if (term && !list.length) return null;
        return (
          <section key={t.tier} className={CARD}>
            <TierHeader supabase={supabase} tier={t} count={chains.filter((c) => c.tier === t.tier).length} onSaved={load} />
            {list.length === 0 ? (
              <p className={`mt-3 text-sm ${MUTED}`}>No chains in this tier.</p>
            ) : (
              <div className="mt-3 grid grid-cols-[repeat(auto-fill,minmax(230px,1fr))] gap-2">
                {list.map((c) => {
                  const ks = byChain.get(c.id) ?? [];
                  return (
                    <button
                      key={c.id}
                      id={`chain-class-${c.id}`}
                      type="button"
                      onClick={() => setOpenId(c.id)}
                      className="flex flex-col gap-1 rounded-lg border border-neutral-800 bg-neutral-900/50 px-3 py-2.5 text-left hover:border-[#6abc46]/40"
                    >
                      <span className="flex items-center justify-between gap-2">
                        <span className="truncate text-sm font-semibold text-neutral-100">{c.chain}</span>
                        <TierPill tier={c.tier} />
                      </span>
                      {ks.length ? (
                        <span className={`truncate text-[12px] ${MUTED}`}>
                          {ks.length} contact{ks.length > 1 ? "s" : ""} · {ks.map((k) => k.name || k.title || k.email).filter(Boolean).join(", ")}
                        </span>
                      ) : (
                        <span className="w-fit rounded bg-amber-400/10 px-1.5 py-0.5 text-[11px] font-semibold text-amber-300">Prospect · no contact on file</span>
                      )}
                    </button>
                  );
                })}
              </div>
            )}
          </section>
        );
      })}

      {open && <ChainPopup supabase={supabase} chain={open} tiers={tiers} contacts={byChain.get(open.id) ?? []} onChanged={load} onClose={() => setOpenId(null)} />}
      {adding && (
        <AddChain
          supabase={supabase}
          tiers={tiers}
          onClose={() => setAdding(false)}
          onAdded={async (id) => {
            setAdding(false);
            await load();
            setOpenId(id);
          }}
        />
      )}
    </div>
  );
}

// "T1 · Twice a year" + Edit schedule.
function TierHeader({ supabase, tier, count, onSaved }: { supabase: Supa; tier: Tier; count: number; onSaved: () => void }) {
  const [editing, setEditing] = useState(false);
  const [val, setVal] = useState(tier.cadence ?? "");
  const [err, setErr] = useState<string | null>(null);
  async function save() {
    const { data: u } = await supabase.auth.getUser();
    const { error } = await supabase
      .from("sales_chain_tiers")
      .update({ cadence: val.trim() || null, updated_at: new Date().toISOString(), updated_by: u.user?.id ?? null })
      .eq("tier", tier.tier);
    if (error) return setErr(error.message);
    setErr(null);
    setEditing(false);
    onSaved();
  }
  return (
    <div className="flex flex-wrap items-center gap-2">
      <TierPill tier={tier.tier} />
      <span className="text-base font-bold text-neutral-100">
        {count} chain{count === 1 ? "" : "s"}
      </span>
      {editing ? (
        <span className="flex flex-wrap items-center gap-2">
          <input value={val} onChange={(e) => setVal(e.target.value)} placeholder="e.g. Once a quarter" aria-label={`${tier.tier} touch-base schedule`} className={`${INPUT} w-48`} autoFocus />
          <button type="button" className={GREEN_BTN} onClick={save}>
            Save
          </button>
          <button
            type="button"
            className={SMALL_BTN}
            onClick={() => {
              setVal(tier.cadence ?? "");
              setEditing(false);
            }}
          >
            Cancel
          </button>
        </span>
      ) : (
        <>
          <span className={`text-sm ${tier.cadence ? "text-neutral-300" : "text-neutral-500"}`}>· Touch base: {tier.cadence ?? "not set"}</span>
          <button type="button" className="text-xs font-semibold text-[#9edc7f] hover:underline" onClick={() => setEditing(true)}>
            {tier.cadence ? "Edit" : "Set schedule"}
          </button>
        </>
      )}
      {err && <span className="text-xs text-red-300">{err}</span>}
    </div>
  );
}

function AddChain({ supabase, tiers, onClose, onAdded }: { supabase: Supa; tiers: Tier[]; onClose: () => void; onAdded: (id: string) => void }) {
  const [name, setName] = useState("");
  const [tier, setTier] = useState(tiers[0]?.tier ?? "T1");
  const [err, setErr] = useState<string | null>(null);
  async function add() {
    if (!name.trim()) return setErr("Type the chain's name.");
    const { data: u } = await supabase.auth.getUser();
    const { data, error } = await supabase
      .from("sales_chain_class")
      .insert({ chain: name.trim(), tier, updated_by: u.user?.id ?? null })
      .select("id")
      .single();
    if (error) return setErr(error.code === "23505" ? "That chain is already on the list." : error.message);
    onAdded((data as { id: string }).id);
  }
  return (
    <Modal title="Add a chain" onClose={onClose}>
      <div className="flex flex-col gap-3">
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Chain name" aria-label="Chain name" className={INPUT} autoFocus />
        <select value={tier} onChange={(e) => setTier(e.target.value)} aria-label="Tier" className={INPUT}>
          {tiers.map((t) => (
            <option key={t.tier} value={t.tier}>
              {t.tier}
              {t.cadence ? ` · ${t.cadence}` : ""}
            </option>
          ))}
        </select>
        {err && <p className="text-sm text-red-300">{err}</p>}
        <div className="flex gap-2">
          <button type="button" className={GREEN_BTN} onClick={add}>
            Add chain
          </button>
          <button type="button" className={SMALL_BTN} onClick={onClose}>
            Cancel
          </button>
        </div>
      </div>
    </Modal>
  );
}

const telHref = (p: string) => `tel:${p.replace(/[^\d+]/g, "")}`;

function ChainPopup({
  supabase,
  chain,
  tiers,
  contacts,
  onChanged,
  onClose,
}: {
  supabase: Supa;
  chain: Chain;
  tiers: Tier[];
  contacts: Contact[];
  onChanged: () => Promise<void> | void;
  onClose: () => void;
}) {
  const [notes, setNotes] = useState(chain.notes ?? "");
  const [editId, setEditId] = useState<string | "new" | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [confirmDel, setConfirmDel] = useState(false);
  const cadence = tiers.find((t) => t.tier === chain.tier)?.cadence;

  async function saveChain(patch: Partial<Chain>) {
    const { data: u } = await supabase.auth.getUser();
    const { error } = await supabase
      .from("sales_chain_class")
      .update({ ...patch, updated_at: new Date().toISOString(), updated_by: u.user?.id ?? null })
      .eq("id", chain.id);
    if (error) return setErr(error.message);
    setErr(null);
    await onChanged();
  }
  async function deleteChain() {
    const { error } = await supabase.from("sales_chain_class").delete().eq("id", chain.id);
    if (error) return setErr(error.message);
    onClose();
    await onChanged();
  }
  async function deleteContact(id: string) {
    const { error } = await supabase.from("sales_chain_class_contacts").delete().eq("id", id);
    if (error) return setErr(error.message);
    await onChanged();
  }

  return (
    <Modal title={chain.chain} sub={`${chain.tier} · touch base: ${cadence ?? "not set"}`} onClose={onClose}>
      <div className="flex flex-col gap-4">
        <div className="flex flex-wrap items-center gap-2">
          <span className={`text-sm ${MUTED}`}>Tier</span>
          {tiers.map((t) => (
            <button
              key={t.tier}
              type="button"
              onClick={() => t.tier !== chain.tier && saveChain({ tier: t.tier })}
              className={`rounded-full border px-3 py-1 text-xs font-bold ${t.tier === chain.tier ? tierClass(t.tier) : "border-neutral-700 text-neutral-400 hover:text-neutral-100"}`}
            >
              {t.tier}
            </button>
          ))}
        </div>

        <div className="flex flex-col gap-2">
          <div className="flex items-center justify-between">
            <span className="text-sm font-semibold text-neutral-100">Contacts ({contacts.length})</span>
            {editId !== "new" && (
              <button type="button" className={SMALL_BTN} onClick={() => setEditId("new")}>
                + Add contact
              </button>
            )}
          </div>
          {editId === "new" && <ContactForm supabase={supabase} chainId={chain.id} sort={contacts.length + 1} onDone={async () => { setEditId(null); await onChanged(); }} onCancel={() => setEditId(null)} />}
          {contacts.length === 0 && editId !== "new" && <p className="text-sm text-amber-300">Prospect · no contact on file yet.</p>}
          {contacts.map((k) =>
            editId === k.id ? (
              <ContactForm key={k.id} supabase={supabase} chainId={chain.id} sort={k.sort} contact={k} onDone={async () => { setEditId(null); await onChanged(); }} onCancel={() => setEditId(null)} />
            ) : (
              <div key={k.id} className="flex flex-wrap items-start justify-between gap-2 rounded-lg border border-neutral-800 bg-neutral-900/50 px-3 py-2.5">
                <div className="flex min-w-0 flex-col gap-0.5 text-sm">
                  <span className="font-semibold text-neutral-100">
                    {k.name || "(no name)"}
                    {k.title && <span className={`font-normal ${MUTED}`}> · {k.title}</span>}
                  </span>
                  {k.email && (
                    <a href={`mailto:${k.email}`} className="break-all text-[#9edc7f] hover:underline">
                      {k.email}
                    </a>
                  )}
                  {k.phone && (
                    <a href={telHref(k.phone)} className="text-neutral-200 hover:underline">
                      {k.phone}
                    </a>
                  )}
                  {k.notes && <span className={`text-[12px] ${MUTED}`}>{k.notes}</span>}
                </div>
                <div className="flex gap-1.5">
                  <button type="button" className={SMALL_BTN} onClick={() => setEditId(k.id)}>
                    Edit
                  </button>
                  <button type="button" className={SMALL_BTN} onClick={() => deleteContact(k.id)}>
                    Remove
                  </button>
                </div>
              </div>
            ),
          )}
        </div>

        <label className="flex flex-col gap-1.5">
          <span className="text-sm font-semibold text-neutral-100">Notes</span>
          <textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            onBlur={() => notes !== (chain.notes ?? "") && saveChain({ notes: notes.trim() || null })}
            rows={3}
            placeholder="Anything about this chain (saves when you click away)"
            className={INPUT}
          />
        </label>

        {err && <p className="text-sm text-red-300">{err}</p>}

        <div className="flex items-center gap-2 border-t border-neutral-800 pt-3">
          {confirmDel ? (
            <>
              <span className="text-sm text-red-300">Delete {chain.chain} and its contacts?</span>
              <button type="button" className="inline-flex min-h-8 items-center rounded-full border border-red-500/60 bg-red-500/20 px-3 text-xs font-bold text-red-200" onClick={deleteChain}>
                Yes, delete
              </button>
              <button type="button" className={SMALL_BTN} onClick={() => setConfirmDel(false)}>
                Cancel
              </button>
            </>
          ) : (
            <button type="button" className="text-xs font-semibold text-neutral-500 hover:text-red-300" onClick={() => setConfirmDel(true)}>
              Delete this chain
            </button>
          )}
        </div>
      </div>
    </Modal>
  );
}

function ContactForm({
  supabase,
  chainId,
  sort,
  contact,
  onDone,
  onCancel,
}: {
  supabase: Supa;
  chainId: string;
  sort: number;
  contact?: Contact;
  onDone: () => void;
  onCancel: () => void;
}) {
  const [f, setF] = useState({
    name: contact?.name ?? "",
    title: contact?.title ?? "",
    email: contact?.email ?? "",
    phone: contact?.phone ?? "",
    notes: contact?.notes ?? "",
  });
  const [err, setErr] = useState<string | null>(null);
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement>) => setF((o) => ({ ...o, [k]: e.target.value }));
  async function save() {
    const clean = Object.fromEntries(Object.entries(f).map(([k, v]) => [k, v.trim() || null])) as Record<keyof typeof f, string | null>;
    if (!clean.name && !clean.email && !clean.phone) return setErr("Add at least a name, email or phone.");
    const { data: u } = await supabase.auth.getUser();
    const by = u.user?.id ?? null;
    const { error } = contact
      ? await supabase.from("sales_chain_class_contacts").update({ ...clean, updated_at: new Date().toISOString(), updated_by: by }).eq("id", contact.id)
      : await supabase.from("sales_chain_class_contacts").insert({ ...clean, chain_id: chainId, sort, updated_by: by });
    if (error) return setErr(error.message);
    onDone();
  }
  return (
    <div className="flex flex-col gap-2 rounded-lg border border-[#6abc46]/40 bg-neutral-900/60 p-3">
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        <input value={f.name} onChange={set("name")} placeholder="Name" aria-label="Name" className={INPUT} autoFocus />
        <input value={f.title} onChange={set("title")} placeholder="Role / title (e.g. Beer Buyer)" aria-label="Role or title" className={INPUT} />
        <input value={f.email} onChange={set("email")} placeholder="Email" aria-label="Email" type="email" className={INPUT} />
        <input value={f.phone} onChange={set("phone")} placeholder="Phone" aria-label="Phone" className={INPUT} />
      </div>
      <input value={f.notes} onChange={set("notes")} placeholder="Notes" aria-label="Notes" className={INPUT} />
      {err && <p className="text-sm text-red-300">{err}</p>}
      <div className="flex gap-2">
        <button type="button" className={GREEN_BTN} onClick={save}>
          {contact ? "Save" : "Add contact"}
        </button>
        <button type="button" className={SMALL_BTN} onClick={onCancel}>
          Cancel
        </button>
      </div>
    </div>
  );
}
