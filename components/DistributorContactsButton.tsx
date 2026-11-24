"use client";

// Contacts button on every distributor page (2026-11-24, per Chad: "add a
// contacts button in each distributor, that shows first, the distributor
// contacts, then the account contacts"). Plan + source list:
// claude/account-contacts-source-2026-11-24.md.
//
// Pop-up, top to bottom:
//   1. <Distributor>'s people — the distributor's own staff (distributor_contacts).
//      Anyone who can see this distributor's page can add / edit / remove them.
//   2. Account contacts — every contact on this distributor's accounts
//      (distributor_account_contacts(dist)), searchable; click one → the account.
// Export: both lists in one Excel file. Data: sql/account_contacts.sql.

import { useCallback, useEffect, useMemo, useState } from "react";
import type { createClient } from "@/lib/supabase/client";
import { logChange } from "@/lib/audit";
import { useNewFeature } from "@/lib/newFeatures";
import NewBadge from "@/components/NewBadge";
import { ExportButton, MUTED, Modal, exportSheets } from "@/components/SalesDashboardHome";
import { fmtDay } from "@/lib/salesDashHome";

type Supa = ReturnType<typeof createClient>;

interface DistContact {
  id: string;
  distributor: string;
  name: string | null;
  title: string | null;
  phone: string | null;
  email: string | null;
  notes: string | null;
  sort: number;
}
interface AcctContact {
  outlet_id: string;
  account: string;
  city: string | null;
  premise: string | null;
  last_buy: string | null;
  name: string | null;
  title: string | null;
  phone: string | null;
  mobile: string | null;
  email: string | null;
  source: string | null;
}
type Draft = { name: string; title: string; phone: string; email: string; notes: string };
const EMPTY: Draft = { name: "", title: "", phone: "", email: "", notes: "" };
const clean = (s: string) => (s.trim() === "" ? null : s.trim());

const INPUT = "min-h-9 w-full rounded-lg border border-neutral-700 bg-neutral-900 px-2.5 text-[13px] text-neutral-100 placeholder:text-neutral-500";
const BTN = "inline-flex min-h-8 items-center rounded-full border border-neutral-700 px-3 text-xs font-semibold text-neutral-300 hover:border-[#6abc46]/40 hover:text-neutral-100 disabled:opacity-50";
const BTN_GREEN = "inline-flex min-h-8 items-center rounded-full border border-[#6abc46]/45 bg-[#6abc46]/15 px-3 text-xs font-semibold text-neutral-50 hover:bg-[#6abc46]/25 disabled:opacity-50";

function ContactLine({ phone, mobile, email }: { phone?: string | null; mobile?: string | null; email?: string | null }) {
  return (
    <span className="flex flex-wrap gap-x-3 gap-y-0.5 text-[12.5px]">
      {phone && (
        <a href={`tel:${phone}`} className="text-[#9edc7f] hover:underline">
          {phone}
        </a>
      )}
      {mobile && mobile !== phone && (
        <a href={`tel:${mobile}`} className="text-[#9edc7f] hover:underline">
          {mobile} (cell)
        </a>
      )}
      {email && (
        <a href={`mailto:${email}`} className="break-all text-[#9edc7f] hover:underline">
          {email}
        </a>
      )}
    </span>
  );
}

function DraftForm({ draft, setDraft, onSave, onCancel, busy, saveLabel }: { draft: Draft; setDraft: (d: Draft) => void; onSave: () => void; onCancel: () => void; busy: boolean; saveLabel: string }) {
  return (
    <div className="grid gap-2 rounded-xl border border-[#6abc46]/30 bg-neutral-900/60 p-3 sm:grid-cols-2">
      <input className={INPUT} placeholder="Name" value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} />
      <input className={INPUT} placeholder="Title (e.g. Sales Manager)" value={draft.title} onChange={(e) => setDraft({ ...draft, title: e.target.value })} />
      <input className={INPUT} placeholder="Phone" value={draft.phone} onChange={(e) => setDraft({ ...draft, phone: e.target.value })} />
      <input className={INPUT} placeholder="Email" value={draft.email} onChange={(e) => setDraft({ ...draft, email: e.target.value })} />
      <input className={`${INPUT} sm:col-span-2`} placeholder="Notes" value={draft.notes} onChange={(e) => setDraft({ ...draft, notes: e.target.value })} />
      <div className="flex gap-2 sm:col-span-2">
        <button type="button" className={BTN_GREEN} disabled={busy || (!draft.name.trim() && !draft.email.trim() && !draft.phone.trim())} onClick={onSave}>
          {busy ? "Saving…" : saveLabel}
        </button>
        <button type="button" className={BTN} onClick={onCancel} disabled={busy}>
          Cancel
        </button>
      </div>
    </div>
  );
}

export default function DistributorContactsButton({ supabase, dist, slug, onOpenAccount }: { supabase: Supa; dist: string; slug: string; onOpenAccount: (outletId: string) => void }) {
  const [open, setOpen] = useState(false);
  const isNew = useNewFeature(`feature:dist-contacts-${slug}`);
  return (
    <>
      <button
        type="button"
        onClick={() => {
          setOpen(true);
          isNew.dismiss();
        }}
        className="flex items-center gap-1.5 rounded-lg border border-[#6abc46]/40 bg-[#6abc46]/10 px-3.5 py-2 text-sm font-semibold text-neutral-100 hover:bg-[#6abc46]/20"
      >
        Contacts
        {isNew.isNew && <NewBadge inline />}
      </button>
      {open && (
        <ContactsModal
          supabase={supabase}
          dist={dist}
          onClose={() => setOpen(false)}
          onOpenAccount={(id) => {
            setOpen(false);
            onOpenAccount(id);
          }}
        />
      )}
    </>
  );
}

function ContactsModal({ supabase, dist, onClose, onOpenAccount }: { supabase: Supa; dist: string; onClose: () => void; onOpenAccount: (id: string) => void }) {
  const [people, setPeople] = useState<DistContact[] | null>(null);
  const [accts, setAccts] = useState<AcctContact[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [q, setQ] = useState("");
  const [adding, setAdding] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [draft, setDraft] = useState<Draft>(EMPTY);
  const [busy, setBusy] = useState(false);
  const [exporting, setExporting] = useState(false);

  const loadPeople = useCallback(async () => {
    const { data, error } = await supabase.from("distributor_contacts").select("id,distributor,name,title,phone,email,notes,sort").eq("distributor", dist).order("sort").order("name");
    if (error) setErr(error.message);
    else setPeople((data ?? []) as DistContact[]);
  }, [supabase, dist]);

  useEffect(() => {
    let cancelled = false;
    supabase
      .from("distributor_contacts")
      .select("id,distributor,name,title,phone,email,notes,sort")
      .eq("distributor", dist)
      .order("sort")
      .order("name")
      .then(({ data, error }) => {
        if (cancelled) return;
        if (error) setErr(error.message);
        else setPeople((data ?? []) as DistContact[]);
      });
    supabase.rpc("distributor_account_contacts", { p_dist: dist }).then(({ data, error }) => {
      if (cancelled) return;
      if (error) setErr(error.message);
      else setAccts((data ?? []) as AcctContact[]);
    });
    // Someone else adds / edits a distributor contact → show it.
    const ch = supabase
      .channel(`distributor-contacts-${dist}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "distributor_contacts", filter: `distributor=eq.${dist}` }, () => void loadPeople())
      .subscribe();
    return () => {
      cancelled = true;
      void supabase.removeChannel(ch);
    };
  }, [supabase, dist, loadPeople]);

  const userId = async () => (await supabase.auth.getUser()).data.user?.id ?? "";

  const save = async () => {
    setBusy(true);
    setErr(null);
    try {
      const row = { name: clean(draft.name), title: clean(draft.title), phone: clean(draft.phone), email: clean(draft.email), notes: clean(draft.notes) };
      const who = await userId();
      if (editId) {
        const before = people?.find((p) => p.id === editId);
        const { error } = await supabase.from("distributor_contacts").update({ ...row, updated_at: new Date().toISOString() }).eq("id", editId);
        if (error) throw error;
        await logChange(supabase, {
          weekId: null,
          tableName: "distributor_contacts",
          recordId: editId,
          fieldName: "contact",
          oldValue: before ? `${dist}: ${[before.name, before.title, before.phone, before.email].filter(Boolean).join(" · ")}` : null,
          newValue: `${dist}: ${[row.name, row.title, row.phone, row.email].filter(Boolean).join(" · ")}`,
          changedBy: who,
        });
      } else {
        const sort = (people ?? []).reduce((m, p) => Math.max(m, p.sort), 0) + 1;
        const { data, error } = await supabase.from("distributor_contacts").insert({ ...row, distributor: dist, sort }).select("id").single();
        if (error) throw error;
        await logChange(supabase, {
          weekId: null,
          tableName: "distributor_contacts",
          recordId: (data as { id: string }).id,
          fieldName: "contact",
          oldValue: null,
          newValue: `${dist}: added ${[row.name, row.title, row.email].filter(Boolean).join(" · ")}`,
          changedBy: who,
        });
      }
      setAdding(false);
      setEditId(null);
      setDraft(EMPTY);
      await loadPeople();
    } catch (e) {
      setErr(e instanceof Error ? e.message : String((e as { message?: string })?.message ?? e));
    } finally {
      setBusy(false);
    }
  };

  const remove = async (p: DistContact) => {
    if (!window.confirm(`Remove ${p.name ?? p.email ?? "this contact"} from ${dist}'s contacts?`)) return;
    setBusy(true);
    setErr(null);
    const { error } = await supabase.from("distributor_contacts").delete().eq("id", p.id);
    if (error) setErr(error.message);
    else {
      await logChange(supabase, {
        weekId: null,
        tableName: "distributor_contacts",
        recordId: p.id,
        fieldName: "contact",
        oldValue: `${dist}: ${[p.name, p.title, p.phone, p.email].filter(Boolean).join(" · ")}`,
        newValue: "removed",
        changedBy: await userId(),
      });
      await loadPeople();
    }
    setBusy(false);
  };

  // Account contacts grouped by account, filtered by the search box.
  const groups = useMemo(() => {
    const t = q.trim().toLowerCase();
    const m = new Map<string, { outlet_id: string; account: string; city: string | null; premise: string | null; last_buy: string | null; rows: AcctContact[] }>();
    for (const c of accts ?? []) {
      if (t && ![c.account, c.city, c.name, c.title, c.email, c.phone, c.mobile].some((v) => (v ?? "").toLowerCase().includes(t))) continue;
      const g = m.get(c.outlet_id) ?? { outlet_id: c.outlet_id, account: c.account, city: c.city, premise: c.premise, last_buy: c.last_buy, rows: [] };
      g.rows.push(c);
      m.set(c.outlet_id, g);
    }
    return [...m.values()];
  }, [accts, q]);
  const shownContacts = groups.reduce((n, g) => n + g.rows.length, 0);

  const doExport = async () => {
    setExporting(true);
    try {
      await exportSheets(`${dist} - contacts.xlsx`, [
        {
          name: `${dist} people`.slice(0, 31),
          title: `${dist} — distributor contacts`,
          cols: [
            { header: "Name", key: "name", width: 24 },
            { header: "Title", key: "title", width: 22 },
            { header: "Phone", key: "phone", width: 16 },
            { header: "Email", key: "email", width: 30 },
            { header: "Notes", key: "notes", width: 40 },
          ],
          rows: (people ?? []).map((p) => ({ name: p.name ?? "", title: p.title ?? "", phone: p.phone ?? "", email: p.email ?? "", notes: p.notes ?? "" })),
        },
        {
          name: "Account contacts",
          title: `${dist} — account contacts${q.trim() ? ` matching "${q.trim()}"` : ""}`,
          cols: [
            { header: "Account", key: "account", width: 32 },
            { header: "City", key: "city", width: 16 },
            { header: "Premise", key: "premise", width: 10 },
            { header: "Contact", key: "name", width: 22 },
            { header: "Title", key: "title", width: 18 },
            { header: "Phone", key: "phone", width: 16 },
            { header: "Cell", key: "mobile", width: 16 },
            { header: "Email", key: "email", width: 30 },
            { header: "Source", key: "source", width: 18 },
            { header: "Last buy", key: "lb", width: 12 },
            { header: "Outlet ID", key: "id", width: 12 },
          ],
          rows: groups.flatMap((g) =>
            g.rows.map((c) => ({
              account: g.account,
              city: g.city ?? "",
              premise: g.premise ?? "",
              name: c.name ?? "",
              title: c.title ?? "",
              phone: c.phone ?? "",
              mobile: c.mobile ?? "",
              email: c.email ?? "",
              source: c.source ?? "",
              lb: g.last_buy ?? "",
              id: g.outlet_id,
            })),
          ),
        },
      ]);
    } finally {
      setExporting(false);
    }
  };

  return (
    <Modal title={`${dist} contacts`} sub="The distributor's own people first, then every contact on its accounts" onClose={onClose} actions={<ExportButton onClick={doExport} busy={exporting} />}>
      {err && <p className="mb-3 rounded-md border border-red-500/40 bg-red-500/10 px-3 py-2 text-sm text-red-300">{err}</p>}

      {/* 1. Distributor's own people */}
      <section className="flex flex-col gap-2">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 className="text-[14px] font-semibold text-neutral-100">
            {dist}&apos;s people <span className="font-mono text-neutral-400">{people ? people.length : "…"}</span>
          </h3>
          {!adding && !editId && (
            <button
              type="button"
              className={BTN_GREEN}
              onClick={() => {
                setDraft(EMPTY);
                setAdding(true);
              }}
            >
              + Add a contact
            </button>
          )}
        </div>
        {adding && <DraftForm draft={draft} setDraft={setDraft} onSave={save} onCancel={() => setAdding(false)} busy={busy} saveLabel="Add" />}
        {!people ? (
          <p className={`text-sm ${MUTED}`}>Loading…</p>
        ) : people.length === 0 && !adding ? (
          <p className={`text-sm ${MUTED}`}>No {dist} contacts yet — use “+ Add a contact” to add their reps, managers or office.</p>
        ) : (
          <div className="flex flex-col">
            {people.map((p) =>
              editId === p.id ? (
                <DraftForm key={p.id} draft={draft} setDraft={setDraft} onSave={save} onCancel={() => setEditId(null)} busy={busy} saveLabel="Save" />
              ) : (
                <div key={p.id} className="flex items-start gap-3 border-t border-neutral-800/70 px-1 py-2.5 first:border-t-0">
                  <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                    <span className="text-sm font-semibold text-neutral-100">
                      {p.name ?? "—"}
                      {p.title && <span className="font-normal text-neutral-400"> · {p.title}</span>}
                    </span>
                    <ContactLine phone={p.phone} email={p.email} />
                    {p.notes && <span className="text-[12px] text-neutral-500">{p.notes}</span>}
                  </span>
                  <span className="flex shrink-0 gap-1.5">
                    <button
                      type="button"
                      className={BTN}
                      disabled={busy || adding}
                      onClick={() => {
                        setDraft({ name: p.name ?? "", title: p.title ?? "", phone: p.phone ?? "", email: p.email ?? "", notes: p.notes ?? "" });
                        setEditId(p.id);
                      }}
                    >
                      Edit
                    </button>
                    <button type="button" className={BTN} disabled={busy || adding} onClick={() => remove(p)}>
                      Remove
                    </button>
                  </span>
                </div>
              ),
            )}
          </div>
        )}
      </section>

      {/* 2. Account contacts */}
      <section className="mt-5 flex flex-col gap-2 border-t border-neutral-800 pt-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 className="text-[14px] font-semibold text-neutral-100">
            Account contacts{" "}
            <span className="font-mono text-neutral-400">
              {accts ? `${shownContacts}${q.trim() ? ` of ${accts.length}` : ""}` : "…"}
            </span>
          </h3>
          <input className={`${INPUT} max-w-[260px]`} placeholder="Search account, city, name, email" value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
        <p className="text-[11.5px] text-neutral-500">Every contact on {dist}&apos;s accounts. Click an account for its details. Export follows the search.</p>
        <div className="flex max-h-[420px] flex-col overflow-y-auto pr-1">
          {!accts ? (
            <p className={`py-3 text-sm ${MUTED}`}>Loading…</p>
          ) : groups.length === 0 ? (
            <p className={`py-3 text-sm ${MUTED}`}>{q.trim() ? "No contacts match that search." : `No account contacts for ${dist} yet.`}</p>
          ) : (
            groups.map((g) => (
              <div key={g.outlet_id} className="border-t border-neutral-800/70 py-2.5 first:border-t-0">
                <button type="button" onClick={() => onOpenAccount(g.outlet_id)} className="text-left text-sm font-semibold text-neutral-100 hover:text-[#9edc7f]">
                  {g.account}
                  {g.city ? ` · ${g.city}` : ""}
                  <span className="ml-2 text-[11.5px] font-normal text-neutral-500">
                    {g.premise === "On" ? "On-premise" : g.premise === "Off" ? "Off-premise" : ""}
                    {g.last_buy ? `${g.premise ? " · " : ""}last buy ${fmtDay(g.last_buy)}` : ""}
                  </span>
                </button>
                <div className="mt-1 flex flex-col gap-1.5 pl-3">
                  {g.rows.map((c, i) => (
                    <span key={i} className="flex flex-col">
                      <span className="text-[13px] text-neutral-200">
                        {c.name ?? "—"}
                        {c.title && <span className="text-neutral-400"> · {c.title}</span>}
                      </span>
                      <ContactLine phone={c.phone} mobile={c.mobile} email={c.email} />
                    </span>
                  ))}
                </div>
              </div>
            ))
          )}
        </div>
      </section>
    </Modal>
  );
}
