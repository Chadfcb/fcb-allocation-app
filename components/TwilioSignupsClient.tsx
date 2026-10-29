"use client";

import { useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";

// Twilio → Text Sign-ups (added 2026-10-29). Everyone who opted in or out of
// FCB new-item texts. Phone, status and the consent record (how / when / the
// exact wording) are read-only — only Twilio and the sign-up form set them.
// Editable: name, business, rep, notes, and the linked account.

export type SmsContactRow = {
  id: string;
  phone: string;
  name: string | null;
  business: string | null;
  outlet_id: string | null;
  rep_name: string | null;
  status: "opted_in" | "opted_out";
  opt_in_method: "keyword" | "web_form" | null;
  opt_in_keyword: string | null;
  opt_in_at: string | null;
  consent_text: string | null;
  opt_out_at: string | null;
  opt_out_keyword: string | null;
  notes: string | null;
  created_at: string;
};

type Filter = "all" | "opted_in" | "opted_out" | "unlinked";

function fmtPhone(e164: string) {
  const d = e164.replace(/\D/g, "").replace(/^1(?=\d{10}$)/, "");
  return d.length === 10 ? `(${d.slice(0, 3)}) ${d.slice(3, 6)}-${d.slice(6)}` : e164;
}

function fmtWhen(iso: string | null) {
  if (!iso) return "—";
  return new Date(iso).toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZone: "America/Los_Angeles",
  });
}

function howJoined(c: SmsContactRow) {
  if (c.opt_in_method === "keyword") return `Texted ${c.opt_in_keyword ?? "JOIN"}`;
  if (c.opt_in_method === "web_form") return "Sign-up form";
  return "—";
}

export default function TwilioSignupsClient({
  initial,
  accountNames: initialNames,
  loadError,
}: {
  initial: SmsContactRow[];
  accountNames: Record<string, string>;
  loadError: string | null;
}) {
  const [supabase] = useState(() => createClient());
  const [rows, setRows] = useState(initial);
  const [accountNames, setAccountNames] = useState(initialNames);
  const [filter, setFilter] = useState<Filter>("all");
  const [search, setSearch] = useState("");
  const [openId, setOpenId] = useState<string | null>(null);

  const counts = useMemo(
    () => ({
      all: rows.length,
      opted_in: rows.filter((r) => r.status === "opted_in").length,
      opted_out: rows.filter((r) => r.status === "opted_out").length,
      unlinked: rows.filter((r) => r.status === "opted_in" && !r.outlet_id).length,
    }),
    [rows],
  );

  const shown = useMemo(() => {
    const q = search.trim().toLowerCase();
    const qDigits = q.replace(/\D/g, "");
    return rows.filter((r) => {
      if (filter === "opted_in" && r.status !== "opted_in") return false;
      if (filter === "opted_out" && r.status !== "opted_out") return false;
      if (filter === "unlinked" && (r.status !== "opted_in" || r.outlet_id)) return false;
      if (!q) return true;
      const hay = [r.name, r.business, r.rep_name, r.notes, r.outlet_id ? accountNames[r.outlet_id] : ""]
        .join(" ")
        .toLowerCase();
      return hay.includes(q) || (qDigits.length >= 3 && r.phone.includes(qDigits));
    });
  }, [rows, filter, search, accountNames]);

  function patchLocal(id: string, patch: Partial<SmsContactRow>) {
    setRows((prev) => prev.map((r) => (r.id === id ? { ...r, ...patch } : r)));
  }

  const tab = (key: Filter, label: string) => (
    <button
      key={key}
      type="button"
      onClick={() => setFilter(key)}
      className={`rounded-full px-3 py-1 text-xs font-semibold ${
        filter === key ? "bg-brand/20 text-neutral-100" : "text-neutral-400 hover:text-neutral-200"
      }`}
    >
      {label} <span className="text-neutral-500">{counts[key]}</span>
    </button>
  );

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-lg font-semibold text-neutral-100">Twilio — Text Sign-ups</h1>
        <p className="text-sm text-neutral-400">
          Everyone who agreed to FCB new-item texts (texted JOIN to (559) 478-0269 or used the sign-up form), and
          anyone who opted out with STOP. Only people shown as opted in will ever be texted. Click a row to link the
          account, set the rep, or see the exact consent record.
        </p>
      </div>

      {loadError && (
        <p className="rounded-lg border border-red-900 bg-red-950/40 px-3 py-2 text-sm text-red-300">
          Couldn&apos;t load sign-ups: {loadError}. (Has sql/twilio_sms.sql been run in Supabase?)
        </p>
      )}

      <div className="flex flex-wrap items-center gap-2">
        {tab("all", "All")}
        {tab("opted_in", "Opted in")}
        {tab("opted_out", "Opted out")}
        {tab("unlinked", "Needs account")}
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search name, business, rep, phone…"
          className="ml-auto w-full rounded-full border border-neutral-800 bg-neutral-900 px-4 py-1.5 text-sm text-neutral-100 sm:w-72"
        />
      </div>

      <div className="overflow-x-auto rounded-lg border border-neutral-800">
        <table className="min-w-full text-sm">
          <thead className="bg-neutral-900 text-xs uppercase tracking-wide text-neutral-500">
            <tr>
              <th className="px-3 py-2 text-left">Mobile</th>
              <th className="px-3 py-2 text-left">Name</th>
              <th className="px-3 py-2 text-left">Business / account</th>
              <th className="px-3 py-2 text-left">Rep</th>
              <th className="px-3 py-2 text-left">Status</th>
              <th className="px-3 py-2 text-left">How</th>
              <th className="px-3 py-2 text-left">When</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-neutral-900">
            {shown.length === 0 && (
              <tr>
                <td colSpan={7} className="px-3 py-8 text-center text-neutral-500">
                  {rows.length === 0
                    ? "No sign-ups yet. When a buyer texts JOIN to (559) 478-0269 they'll show up here."
                    : "Nothing matches."}
                </td>
              </tr>
            )}
            {shown.map((r) => (
              <Row
                key={r.id}
                row={r}
                open={openId === r.id}
                onToggle={() => setOpenId(openId === r.id ? null : r.id)}
                accountName={r.outlet_id ? accountNames[r.outlet_id] ?? r.outlet_id : null}
                supabase={supabase}
                onSaved={(patch, linkedName) => {
                  patchLocal(r.id, patch);
                  if (patch.outlet_id && linkedName) setAccountNames((p) => ({ ...p, [patch.outlet_id as string]: linkedName }));
                }}
              />
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function Row({
  row,
  open,
  onToggle,
  accountName,
  supabase,
  onSaved,
}: {
  row: SmsContactRow;
  open: boolean;
  onToggle: () => void;
  accountName: string | null;
  supabase: ReturnType<typeof createClient>;
  onSaved: (patch: Partial<SmsContactRow>, linkedName?: string) => void;
}) {
  const statusPill =
    row.status === "opted_in" ? (
      <span className="rounded-full bg-green-500/15 px-2 py-0.5 text-xs font-semibold text-green-300">Opted in</span>
    ) : (
      <span className="rounded-full bg-red-500/15 px-2 py-0.5 text-xs font-semibold text-red-300">Opted out</span>
    );

  return (
    <>
      <tr onClick={onToggle} className="cursor-pointer hover:bg-neutral-900/40">
        <td className="whitespace-nowrap px-3 py-2 text-neutral-200">{fmtPhone(row.phone)}</td>
        <td className="px-3 py-2 text-neutral-300">{row.name || <span className="text-neutral-600">—</span>}</td>
        <td className="px-3 py-2 text-neutral-300">
          {accountName ? (
            <span>{accountName}</span>
          ) : row.business ? (
            <span>
              {row.business} <span className="text-xs text-amber-400">(not linked)</span>
            </span>
          ) : (
            <span className="text-xs text-amber-400">Needs account</span>
          )}
        </td>
        <td className="px-3 py-2 text-neutral-300">{row.rep_name || <span className="text-neutral-600">—</span>}</td>
        <td className="px-3 py-2">{statusPill}</td>
        <td className="whitespace-nowrap px-3 py-2 text-neutral-400">{row.status === "opted_out" ? `Replied ${row.opt_out_keyword ?? "STOP"}` : howJoined(row)}</td>
        <td className="whitespace-nowrap px-3 py-2 text-neutral-400">
          {fmtWhen(row.status === "opted_out" ? row.opt_out_at : row.opt_in_at)}
        </td>
      </tr>
      {open && (
        <tr className="bg-neutral-950/60">
          <td colSpan={7} className="px-3 py-4">
            <Editor row={row} accountName={accountName} supabase={supabase} onSaved={onSaved} />
          </td>
        </tr>
      )}
    </>
  );
}

function Editor({
  row,
  accountName,
  supabase,
  onSaved,
}: {
  row: SmsContactRow;
  accountName: string | null;
  supabase: ReturnType<typeof createClient>;
  onSaved: (patch: Partial<SmsContactRow>, linkedName?: string) => void;
}) {
  const [name, setName] = useState(row.name ?? "");
  const [business, setBusiness] = useState(row.business ?? "");
  const [rep, setRep] = useState(row.rep_name ?? "");
  const [notes, setNotes] = useState(row.notes ?? "");
  const [outletId, setOutletId] = useState<string | null>(row.outlet_id);
  const [linkedName, setLinkedName] = useState<string | null>(accountName);
  const [q, setQ] = useState("");
  const [results, setResults] = useState<{ outlet_id: string; name: string; city: string | null; distributor: string | null }[]>([]);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  async function searchAccounts() {
    const term = q.trim();
    if (term.length < 2) return;
    const { data } = await supabase
      .from("sales_accounts")
      .select("outlet_id, name, city, distributor")
      .ilike("name", `%${term}%`)
      .order("name")
      .limit(15);
    setResults(data ?? []);
  }

  async function save() {
    setBusy(true);
    setMsg(null);
    const patch = {
      name: name.trim() || null,
      business: business.trim() || null,
      rep_name: rep.trim() || null,
      notes: notes.trim() || null,
      outlet_id: outletId,
      updated_at: new Date().toISOString(),
    };
    const { error } = await supabase.from("sms_contacts").update(patch).eq("id", row.id);
    setBusy(false);
    if (error) {
      setMsg(`Couldn't save: ${error.message}`);
      return;
    }
    onSaved(patch, linkedName ?? undefined);
    setMsg("Saved.");
  }

  const input = "w-full rounded border border-neutral-700 bg-neutral-900 px-2 py-1.5 text-sm text-neutral-100";

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <div className="space-y-3">
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="block text-xs text-neutral-400">
            Name
            <input className={input} value={name} onChange={(e) => setName(e.target.value)} />
          </label>
          <label className="block text-xs text-neutral-400">
            Business (as they gave it)
            <input className={input} value={business} onChange={(e) => setBusiness(e.target.value)} />
          </label>
          <label className="block text-xs text-neutral-400">
            Rep (gets their replies)
            <input className={input} value={rep} onChange={(e) => setRep(e.target.value)} />
          </label>
          <label className="block text-xs text-neutral-400">
            Notes
            <input className={input} value={notes} onChange={(e) => setNotes(e.target.value)} />
          </label>
        </div>

        <div className="space-y-2">
          <p className="text-xs text-neutral-400">
            Linked account:{" "}
            {outletId ? (
              <span className="text-neutral-200">
                {linkedName ?? outletId}{" "}
                <button
                  type="button"
                  className="ml-1 text-xs text-red-300 underline"
                  onClick={() => {
                    setOutletId(null);
                    setLinkedName(null);
                  }}
                >
                  unlink
                </button>
              </span>
            ) : (
              <span className="text-amber-400">none</span>
            )}
          </p>
          <div className="flex gap-2">
            <input
              className={input}
              value={q}
              onChange={(e) => setQ(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  void searchAccounts();
                }
              }}
              placeholder="Find account by name…"
            />
            <button
              type="button"
              onClick={() => void searchAccounts()}
              className="rounded border border-neutral-700 px-3 text-sm text-neutral-200 hover:bg-neutral-800"
            >
              Find
            </button>
          </div>
          {results.length > 0 && (
            <ul className="max-h-48 overflow-y-auto rounded border border-neutral-800">
              {results.map((a) => (
                <li key={a.outlet_id}>
                  <button
                    type="button"
                    onClick={() => {
                      setOutletId(a.outlet_id);
                      setLinkedName(a.name);
                      setResults([]);
                      setQ("");
                    }}
                    className="w-full px-3 py-1.5 text-left text-sm text-neutral-200 hover:bg-neutral-800"
                  >
                    {a.name}{" "}
                    <span className="text-xs text-neutral-500">
                      {[a.city, a.distributor].filter(Boolean).join(" · ")}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="flex items-center gap-3">
          <button
            type="button"
            disabled={busy}
            onClick={() => void save()}
            className="rounded-full bg-brand px-4 py-1.5 text-sm font-semibold text-black disabled:opacity-60"
          >
            {busy ? "Saving…" : "Save"}
          </button>
          {msg && <span className="text-xs text-neutral-400">{msg}</span>}
        </div>
      </div>

      <div className="space-y-2 rounded-lg border border-neutral-800 p-3 text-xs text-neutral-400">
        <p className="font-semibold uppercase tracking-wide text-neutral-500">Consent record (can&apos;t be edited)</p>
        <p>Mobile: <span className="text-neutral-200">{fmtPhone(row.phone)}</span></p>
        <p>How they joined: <span className="text-neutral-200">{howJoined(row)}</span></p>
        <p>Joined: <span className="text-neutral-200">{fmtWhen(row.opt_in_at)}</span></p>
        {row.consent_text && (
          <p>
            Wording: <span className="text-neutral-300">&ldquo;{row.consent_text}&rdquo;</span>
          </p>
        )}
        {row.status === "opted_out" && (
          <p className="text-red-300">
            Opted out {fmtWhen(row.opt_out_at)} (replied {row.opt_out_keyword ?? "STOP"}). They will not be texted.
          </p>
        )}
      </div>
    </div>
  );
}
