"use client";

import { useRef, useState } from "react";
import Papa from "papaparse";
import { createClient } from "@/lib/supabase/client";

// Email Studio → Audience (added 2026-10-30, Phase 5). Lists you can send to
// besides account contacts (which come straight from Accounts at send time):
//   * Import from Mailchimp — subscribed contacts become a list;
//     unsubscribed / cleaned exports go on the do-not-email list.
//   * Make a list by pasting addresses.
// The do-not-email list is never emailed (unsubscribes, bounces, spam
// reports, Mailchimp unsubscribes). Nothing can be removed from it here.

export type ListRow = { id: string; name: string; source: "manual" | "mailchimp"; created_at: string; member_count: number };

const EMAIL_RE = /^[^\s@,;<>()]+@[^\s@,;<>()]+\.[a-z]{2,}$/i;
const norm = (s: unknown) => {
  const e = String(s ?? "").trim().toLowerCase().replace(/^mailto:/, "");
  return EMAIL_RE.test(e) ? e : null;
};

type Parsed = { email: string; name: string | null; business: string | null };

function parseCsv(text: string): Parsed[] {
  const res = Papa.parse<Record<string, string>>(text, { header: true, skipEmptyLines: true });
  const fields = res.meta.fields ?? [];
  const find = (...names: string[]) => fields.find((f) => names.some((n) => f.trim().toLowerCase() === n)) ?? null;
  const emailCol = find("email address", "email", "e-mail", "email_address") ?? fields.find((f) => /e-?mail/i.test(f)) ?? null;
  const firstCol = find("first name", "fname", "first");
  const lastCol = find("last name", "lname", "last");
  const nameCol = find("name", "full name");
  const bizCol = find("company", "business", "company name", "account");
  if (!emailCol) return [];
  const out = new Map<string, Parsed>();
  for (const row of res.data) {
    const email = norm(row[emailCol]);
    if (!email) continue;
    const name =
      [firstCol ? row[firstCol] : "", lastCol ? row[lastCol] : ""].map((x) => (x ?? "").trim()).filter(Boolean).join(" ") ||
      (nameCol ? (row[nameCol] ?? "").trim() : "") ||
      null;
    out.set(email, { email, name, business: bizCol ? (row[bizCol] ?? "").trim() || null : null });
  }
  return [...out.values()];
}

export default function EmailAudienceTab({
  lists: initialLists,
  suppressionCount: initialSuppressed,
  accountEmailCount,
}: {
  lists: ListRow[];
  suppressionCount: number;
  accountEmailCount: number | null;
}) {
  const [supabase] = useState(() => createClient());
  const [lists, setLists] = useState(initialLists);
  const [suppressed, setSuppressed] = useState(initialSuppressed);
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ text: string; bad?: boolean } | null>(null);
  const [importKind, setImportKind] = useState<"subscribed" | "unsubscribed">("subscribed");
  const [importName, setImportName] = useState("Mailchimp import");
  const fileRef = useRef<HTMLInputElement>(null);
  const [pasteName, setPasteName] = useState("");
  const [pasteText, setPasteText] = useState("");
  const [dneText, setDneText] = useState("");
  const [confirmId, setConfirmId] = useState<string | null>(null);

  async function me() {
    const {
      data: { user },
    } = await supabase.auth.getUser();
    return user?.id ?? null;
  }

  async function createListWith(name: string, source: "manual" | "mailchimp", rows: Parsed[]) {
    const { data: list, error } = await supabase
      .from("email_lists")
      .insert({ name: name.trim() || "Untitled list", source, created_by: await me() })
      .select("id, name, source, created_at")
      .single();
    if (error || !list) throw new Error(error?.message ?? "Couldn't create the list");
    for (let i = 0; i < rows.length; i += 500) {
      setBusy(`Saving ${Math.min(i + 500, rows.length)} of ${rows.length}…`);
      const { error: e2 } = await supabase
        .from("email_list_members")
        .upsert(rows.slice(i, i + 500).map((r) => ({ list_id: list.id, ...r })), { onConflict: "list_id,email", ignoreDuplicates: true });
      if (e2) throw new Error(e2.message);
    }
    setLists((prev) => [{ ...(list as Omit<ListRow, "member_count">), member_count: rows.length }, ...prev]);
  }

  async function addSuppressions(emails: string[], reason: "mailchimp_unsubscribed" | "manual", source: string) {
    for (let i = 0; i < emails.length; i += 500) {
      setBusy(`Saving ${Math.min(i + 500, emails.length)} of ${emails.length}…`);
      const { error } = await supabase
        .from("email_suppressions")
        .upsert(emails.slice(i, i + 500).map((email) => ({ email, reason, source })), { onConflict: "email", ignoreDuplicates: true });
      if (error) throw new Error(error.message);
    }
    const { count } = await supabase.from("email_suppressions").select("email", { count: "exact", head: true });
    setSuppressed(count ?? suppressed + emails.length);
  }

  async function importFile(file: File) {
    setMsg(null);
    setBusy("Reading the file…");
    try {
      const rows = parseCsv(await file.text());
      if (!rows.length) throw new Error("No email addresses found. Use the CSV file Mailchimp exports (it has an \"Email Address\" column).");
      if (importKind === "subscribed") {
        await createListWith(importName, "mailchimp", rows);
        setMsg({ text: `Imported ${rows.length} contacts into "${importName}".` });
      } else {
        await addSuppressions(rows.map((r) => r.email), "mailchimp_unsubscribed", `Mailchimp import: ${file.name}`);
        setMsg({ text: `Added ${rows.length} unsubscribed addresses to the do-not-email list.` });
      }
    } catch (e) {
      setMsg({ text: e instanceof Error ? e.message : String(e), bad: true });
    } finally {
      setBusy(null);
    }
  }

  async function savePasted() {
    const emails = [...new Set(pasteText.split(/[\s,;]+/).map(norm).filter(Boolean) as string[])];
    if (!emails.length) {
      setMsg({ text: "Paste at least one email address.", bad: true });
      return;
    }
    setMsg(null);
    try {
      await createListWith(pasteName || "New list", "manual", emails.map((email) => ({ email, name: null, business: null })));
      setMsg({ text: `Saved "${pasteName || "New list"}" with ${emails.length} addresses.` });
      setPasteName("");
      setPasteText("");
    } catch (e) {
      setMsg({ text: e instanceof Error ? e.message : String(e), bad: true });
    } finally {
      setBusy(null);
    }
  }

  async function saveDne() {
    const emails = [...new Set(dneText.split(/[\s,;]+/).map(norm).filter(Boolean) as string[])];
    if (!emails.length) return;
    try {
      await addSuppressions(emails, "manual", "Added by hand in Email Studio");
      setMsg({ text: `Added ${emails.length} to the do-not-email list.` });
      setDneText("");
    } catch (e) {
      setMsg({ text: e instanceof Error ? e.message : String(e), bad: true });
    } finally {
      setBusy(null);
    }
  }

  async function deleteList(id: string) {
    const { error } = await supabase.from("email_lists").delete().eq("id", id);
    if (error) {
      setMsg({ text: error.message, bad: true });
      return;
    }
    setLists((prev) => prev.filter((l) => l.id !== id));
    setConfirmId(null);
  }

  const field = "rounded-lg border border-neutral-700 bg-neutral-900 px-3 py-1.5 text-sm text-neutral-100";
  const card = "rounded-2xl border border-neutral-800 bg-neutral-900/40 p-4";

  return (
    <div className="space-y-4">
      <div className="grid gap-3 md:grid-cols-3">
        <div className={card}>
          <p className="text-xs font-semibold uppercase tracking-wide text-neutral-500">Account contacts</p>
          <p className="text-2xl font-light text-neutral-100">{accountEmailCount ?? "—"}</p>
          <p className="text-xs text-neutral-500">contacts with an email in Accounts — pick distributors etc. when sending</p>
        </div>
        <div className={card}>
          <p className="text-xs font-semibold uppercase tracking-wide text-neutral-500">Lists</p>
          <p className="text-2xl font-light text-neutral-100">{lists.length}</p>
          <p className="text-xs text-neutral-500">imported or pasted lists</p>
        </div>
        <div className={card}>
          <p className="text-xs font-semibold uppercase tracking-wide text-neutral-500">Do not email</p>
          <p className="text-2xl font-light text-neutral-100">{suppressed}</p>
          <p className="text-xs text-neutral-500">unsubscribed, bounced or spam reports — always left out</p>
        </div>
      </div>

      {(busy || msg) && (
        <p className={`text-sm font-semibold ${msg?.bad ? "text-red-300" : "text-green-300"}`}>{busy ?? msg?.text}</p>
      )}

      <div className={card}>
        <h3 className="mb-2 font-semibold text-neutral-100">Import from Mailchimp</h3>
        <p className="mb-3 text-xs text-neutral-400">
          In Mailchimp: Audience → All contacts → Export Audience. The download has separate files for subscribed,
          unsubscribed and cleaned contacts. Import subscribed as a list, and import unsubscribed and cleaned so those
          people are never emailed.
        </p>
        <div className="flex flex-wrap items-center gap-2">
          <select value={importKind} onChange={(e) => setImportKind(e.target.value as "subscribed" | "unsubscribed")} className={field}>
            <option value="subscribed">Subscribed contacts → new list</option>
            <option value="unsubscribed">Unsubscribed / cleaned → do not email</option>
          </select>
          {importKind === "subscribed" && (
            <input value={importName} onChange={(e) => setImportName(e.target.value)} className={field} placeholder="List name" />
          )}
          <button
            type="button"
            disabled={!!busy}
            onClick={() => fileRef.current?.click()}
            className="rounded-full bg-brand px-4 py-1.5 text-sm font-semibold text-black disabled:opacity-60"
          >
            Choose CSV file…
          </button>
          <input
            ref={fileRef}
            type="file"
            accept=".csv,text/csv"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) void importFile(f);
              e.target.value = "";
            }}
          />
        </div>
      </div>

      <div className={card}>
        <h3 className="mb-2 font-semibold text-neutral-100">Lists</h3>
        {lists.length === 0 ? (
          <p className="text-sm text-neutral-500">No lists yet.</p>
        ) : (
          <table className="min-w-full text-sm">
            <thead className="text-xs uppercase tracking-wide text-neutral-500">
              <tr>
                <th className="py-1 text-left">Name</th>
                <th className="py-1 text-left">From</th>
                <th className="py-1 text-right">Addresses</th>
                <th />
              </tr>
            </thead>
            <tbody className="divide-y divide-neutral-800">
              {lists.map((l) => (
                <tr key={l.id}>
                  <td className="py-1.5 text-neutral-200">{l.name}</td>
                  <td className="py-1.5 text-neutral-400">{l.source === "mailchimp" ? "Mailchimp" : "Pasted"}</td>
                  <td className="py-1.5 text-right text-neutral-300">{l.member_count.toLocaleString()}</td>
                  <td className="py-1.5 text-right text-xs">
                    {confirmId === l.id ? (
                      <span className="text-red-300">
                        Delete list?{" "}
                        <button type="button" className="font-semibold underline" onClick={() => void deleteList(l.id)}>
                          Yes
                        </button>{" "}
                        <button type="button" className="underline" onClick={() => setConfirmId(null)}>
                          No
                        </button>
                      </span>
                    ) : (
                      <button type="button" className="text-neutral-500 underline" onClick={() => setConfirmId(l.id)}>
                        Delete
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <div className="grid gap-3 md:grid-cols-2">
        <div className={card}>
          <h3 className="mb-2 font-semibold text-neutral-100">New list from pasted addresses</h3>
          <input value={pasteName} onChange={(e) => setPasteName(e.target.value)} className={`${field} mb-2 w-full`} placeholder="List name" />
          <textarea value={pasteText} onChange={(e) => setPasteText(e.target.value)} rows={4} className={`${field} w-full`} placeholder="Email addresses, separated by commas or new lines" />
          <button type="button" disabled={!!busy} onClick={() => void savePasted()} className="mt-2 rounded-full border border-neutral-700 px-4 py-1.5 text-sm text-neutral-200 hover:bg-neutral-800">
            Save list
          </button>
        </div>
        <div className={card}>
          <h3 className="mb-2 font-semibold text-neutral-100">Add to do-not-email</h3>
          <textarea value={dneText} onChange={(e) => setDneText(e.target.value)} rows={4} className={`${field} w-full`} placeholder="Addresses that should never get emails" />
          <button type="button" disabled={!!busy} onClick={() => void saveDne()} className="mt-2 rounded-full border border-neutral-700 px-4 py-1.5 text-sm text-neutral-200 hover:bg-neutral-800">
            Add
          </button>
          <p className="mt-2 text-xs text-neutral-500">People who unsubscribe are added automatically. Nobody can be removed from this list here.</p>
        </div>
      </div>
    </div>
  );
}
