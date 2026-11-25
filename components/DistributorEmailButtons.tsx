"use client";

// Distributor page → "✉️ Emails sent" and "💬 Replies" (added 2026-11-25, per Chad).
//   Emails sent: "a button on each distributor page in the app, that tells the
//     sales reps which accounts emails went out to, so when they visit the
//     account they know if the account has gotten an email or not".
//   Replies: "these replies to be on the distributors pages as well, so our
//     sales reps can see what accounts replied, what they said, and be able to
//     see all their account info". ✓ Mark handled records who handled it.
// Data: sql/email_replies.sql (distributor_email_sends, distributor_email_replies,
// email_reply_set_handled). Replies come from Ernie's inbox once an hour
// (lib/email/replies.ts). Plan: claude/email-replies-alerts-plan.md.

import { useCallback, useEffect, useMemo, useState } from "react";
import type { createClient } from "@/lib/supabase/client";
import { useNewFeature } from "@/lib/newFeatures";
import NewBadge from "@/components/NewBadge";
import { ExportButton, MUTED, exportSheets } from "@/components/SalesDashboardHome";
import { prettyAccountName } from "@/lib/email/mergeTags";

type Supa = ReturnType<typeof createClient>;

interface SendRow {
  send_id: string;
  outlet_id: string;
  account: string;
  city: string | null;
  premise: string | null;
  email: string;
  contact: string | null;
  campaign: string | null;
  subject: string | null;
  sent_at: string | null;
  status: string;
  opened_at: string | null;
  clicked_at: string | null;
  bounced_at: string | null;
  unsubscribed_at: string | null;
  replies: number;
  open_replies: number;
}

export interface ReplyRow {
  id: string;
  outlet_id: string;
  from_email: string;
  from_name: string | null;
  reply_subject: string | null;
  body: string | null;
  received_at: string;
  handled_at: string | null;
  handled_by_name: string | null;
  campaign: string | null;
  campaign_subject: string | null;
  sent_at: string | null;
  opened_at: string | null;
  clicked_at: string | null;
  account: string;
  address: string | null;
  city: string | null;
  state: string | null;
  zip: string | null;
  phone: string | null;
  premise: string | null;
  distributor: string | null;
  best_day: string | null;
  last_buy_date: string | null;
  ce_12mo: number | string | null;
  last_checkin: { date: string; rep: string | null } | null;
}

const PILL =
  "flex items-center gap-1.5 rounded-lg border border-[#6abc46]/40 bg-[#6abc46]/10 px-3.5 py-2 text-sm font-semibold text-neutral-100 hover:bg-[#6abc46]/20";

export function fmtWhen(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  const today = new Date();
  const sameDay = d.toDateString() === today.toDateString();
  const y = new Date(today);
  y.setDate(today.getDate() - 1);
  const time = d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", timeZone: "America/Los_Angeles" });
  if (sameDay) return `Today ${time}`;
  if (d.toDateString() === y.toDateString()) return `Yesterday ${time}`;
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: d.getFullYear() === today.getFullYear() ? undefined : "numeric", timeZone: "America/Los_Angeles" });
}

function fmtDate(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso.length === 10 ? `${iso}T12:00:00` : iso);
  return Number.isNaN(d.getTime()) ? "—" : d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

function WideModal({ title, sub, onClose, actions, children }: { title: string; sub?: string; onClose: () => void; actions?: React.ReactNode; children: React.ReactNode }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/70 p-4 pt-12" onClick={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className="w-full max-w-6xl rounded-xl border border-[#6abc46]/40 bg-neutral-950 p-5 shadow-2xl"
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

/** One reply's full view: what they said + the account's info. Shared with Email Studio → Replies. */
export function ReplyDetail({
  r,
  busy,
  onToggleHandled,
  onOpenAccount,
}: {
  r: ReplyRow;
  busy: boolean;
  onToggleHandled: () => void;
  onOpenAccount?: () => void;
}) {
  const addr = [r.address, [r.city, r.state].filter(Boolean).join(", "), r.zip].filter((x) => x && String(x).trim()).join(" ");
  return (
    <div className="rounded-xl border border-neutral-800 bg-neutral-900/60 p-5">
      <div className="flex flex-wrap items-start gap-3">
        <div className="min-w-0 flex-1">
          <div className="text-xl font-semibold text-neutral-100">{prettyAccountName(r.account) || r.account}</div>
          <div className="text-sm text-neutral-400">
            {[addr || null, r.phone, r.premise ? `${r.premise}-premise` : null, r.distributor].filter(Boolean).join(" · ")}
          </div>
        </div>
        <button
          type="button"
          disabled={busy}
          onClick={onToggleHandled}
          className={`rounded-full border px-3 py-1.5 text-sm disabled:opacity-50 ${
            r.handled_at ? "border-neutral-700 text-neutral-300 hover:bg-neutral-800" : "border-[#6abc46]/60 text-neutral-100 hover:bg-[#6abc46]/15"
          }`}
        >
          {r.handled_at ? "Undo handled" : "✓ Mark handled"}
        </button>
      </div>
      {r.handled_at && (
        <p className="mt-2 text-sm text-green-400">
          ✓ Handled{r.handled_by_name ? ` by ${r.handled_by_name}` : ""} · {fmtWhen(r.handled_at)}
        </p>
      )}
      <p className="mt-4 text-[11px] font-semibold uppercase tracking-wide text-neutral-500">
        Their reply · {fmtWhen(r.received_at)} · from {r.from_name ? `${r.from_name} (${r.from_email})` : r.from_email}
      </p>
      <div className="mt-1 whitespace-pre-wrap rounded-xl bg-neutral-950 px-4 py-3 text-sm text-neutral-100">{r.body || "—"}</div>
      <p className="mt-1 text-xs text-neutral-500">
        Replying to: {r.campaign_subject || r.campaign || "an email"}
        {r.sent_at ? ` (sent ${fmtWhen(r.sent_at)}` : " ("}
        {r.opened_at ? " · opened ✓" : ""}
        {r.clicked_at ? " · clicked ✓" : ""})
      </p>
      <div className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Stat label="Last buy" value={fmtDate(r.last_buy_date)} />
        <Stat label="Cases (12 mo)" value={r.ce_12mo != null && r.ce_12mo !== "" ? `${Math.round(Number(r.ce_12mo) * 10) / 10} CE` : "—"} />
        <Stat label="Last check-in" value={r.last_checkin ? `${fmtDate(r.last_checkin.date)}${r.last_checkin.rep ? ` · ${r.last_checkin.rep}` : ""}` : "—"} />
        <Stat label="Best day" value={r.best_day || "—"} />
      </div>
      {onOpenAccount && (
        <div className="mt-5">
          <button type="button" onClick={onOpenAccount} className="rounded-full bg-brand px-4 py-1.5 text-sm font-semibold text-on-brand hover:bg-brand-hover">
            Open full account card
          </button>
          <span className="ml-3 text-xs text-neutral-500">Contacts, what they buy, every check-in and more.</span>
        </div>
      )}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl bg-neutral-950 p-3">
      <div className="text-[11px] font-semibold uppercase tracking-wide text-neutral-500">{label}</div>
      <div className="text-neutral-100">{value}</div>
    </div>
  );
}

export default function DistributorEmailButtons({
  supabase,
  dist,
  slug,
  onOpenAccount,
}: {
  supabase: Supa;
  dist: string;
  slug: string;
  onOpenAccount: (outletId: string) => void;
}) {
  const sentNew = useNewFeature(`feature:dist-emails-${slug}`);
  const [sends, setSends] = useState<SendRow[] | null>(null);
  const [replies, setReplies] = useState<ReplyRow[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [open, setOpen] = useState<null | "sent" | "replies">(null);

  const load = useCallback(async () => {
    const [s, r] = await Promise.all([
      supabase.rpc("distributor_email_sends", { p_dist: dist }),
      supabase.rpc("distributor_email_replies", { p_dist: dist }),
    ]);
    if (s.error || r.error) {
      setErr((s.error ?? r.error)?.message ?? "Couldn't load emails.");
      setSends([]);
      setReplies([]);
      return;
    }
    setErr(null);
    setSends((s.data as SendRow[]) ?? []);
    setReplies((r.data as ReplyRow[]) ?? []);
  }, [supabase, dist]);

  useEffect(() => {
    void Promise.resolve().then(load);
  }, [load]);

  // ?replies=1 (link from Email Studio) opens the Replies window once loaded.
  const [askedReplies, setAskedReplies] = useState(() => {
    try {
      return typeof window !== "undefined" && new URLSearchParams(window.location.search).get("replies") === "1";
    } catch {
      return false;
    }
  });
  if (askedReplies && replies !== null && open === null) {
    setAskedReplies(false);
    setOpen("replies");
  }

  const accountsEmailed = useMemo(() => new Set((sends ?? []).map((s) => s.outlet_id)).size, [sends]);
  const openReplies = (replies ?? []).filter((r) => !r.handled_at).length;

  // Nothing ever sent to this distributor's accounts → no buttons.
  if (sends === null || (!err && sends.length === 0 && (replies ?? []).length === 0)) return null;

  return (
    <>
      <button
        type="button"
        onClick={() => {
          setOpen("sent");
          sentNew.dismiss();
        }}
        className={PILL}
        title="Which accounts got our emails"
      >
        ✉️ Emails sent <span className="text-neutral-400">({accountsEmailed})</span>
        {sentNew.isNew && <NewBadge inline />}
      </button>
      <button type="button" onClick={() => setOpen("replies")} className={PILL} title="Accounts that replied to our emails">
        💬 Replies
        {openReplies > 0 ? (
          <span className="rounded-full bg-red-500 px-1.5 text-xs font-bold text-white">{openReplies}</span>
        ) : (
          <span className="text-neutral-400">({(replies ?? []).length})</span>
        )}
      </button>

      {open === "sent" && (
        <EmailsSentModal dist={dist} rows={sends ?? []} err={err} onClose={() => setOpen(null)} onOpenAccount={onOpenAccount} />
      )}
      {open === "replies" && (
        <RepliesModal
          supabase={supabase}
          dist={dist}
          rows={replies ?? []}
          err={err}
          onClose={() => setOpen(null)}
          onOpenAccount={(id) => {
            setOpen(null);
            onOpenAccount(id);
          }}
          onChanged={() => void load()}
        />
      )}
    </>
  );
}

function EmailsSentModal({
  dist,
  rows,
  err,
  onClose,
  onOpenAccount,
}: {
  dist: string;
  rows: SendRow[];
  err: string | null;
  onClose: () => void;
  onOpenAccount: (id: string) => void;
}) {
  const [q, setQ] = useState("");
  const [campaign, setCampaign] = useState("");
  const campaigns = useMemo(() => [...new Set(rows.map((r) => r.subject || r.campaign || "Email"))], [rows]);
  const shown = useMemo(() => {
    const t = q.trim().toLowerCase();
    return rows.filter(
      (r) =>
        (!campaign || (r.subject || r.campaign || "Email") === campaign) &&
        (!t || [r.account, r.city, r.email, r.contact].some((v) => (v ?? "").toLowerCase().includes(t))),
    );
  }, [rows, q, campaign]);
  const accounts = new Set(shown.map((r) => r.outlet_id)).size;

  const doExport = () =>
    void exportSheets(`${dist} - Emails sent.xlsx`, [
      {
        name: "Emails sent",
        title: `${dist} · accounts our emails went to`,
        cols: [
          { key: "account", header: "Account", width: 32 },
          { key: "city", header: "City", width: 16 },
          { key: "premise", header: "Premise", width: 9 },
          { key: "contact", header: "Contact", width: 20 },
          { key: "email", header: "Email address", width: 30 },
          { key: "subject", header: "Email", width: 34 },
          { key: "sent", header: "Sent", width: 14 },
          { key: "opened", header: "Opened", width: 9 },
          { key: "clicked", header: "Clicked", width: 9 },
          { key: "replied", header: "Replied", width: 9 },
        ],
        rows: shown.map((r) => ({
          account: r.account,
          city: r.city ?? "",
          premise: r.premise ?? "",
          contact: r.contact ?? "",
          email: r.email,
          subject: r.subject || r.campaign || "",
          sent: r.status === "queued" ? "Waiting to send" : fmtDate(r.sent_at),
          opened: r.opened_at ? "Yes" : "",
          clicked: r.clicked_at ? "Yes" : "",
          replied: r.replies ? "Yes" : "",
        })),
      },
    ]);

  return (
    <WideModal
      title={`${dist} · Emails sent`}
      sub={`${accounts} account${accounts === 1 ? "" : "s"} · ${shown.length} email${shown.length === 1 ? "" : "s"}. Click an account to open it. Only emails to account contacts show here.`}
      onClose={onClose}
      actions={<ExportButton onClick={doExport} />}
    >
      {err && <p className="mb-3 text-sm text-red-300">{err}</p>}
      <div className="mb-3 flex flex-wrap gap-2">
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search account, city or email"
          className="min-w-[16rem] flex-1 rounded-lg border border-neutral-700 bg-neutral-900 px-3 py-2 text-sm text-neutral-100"
        />
        {campaigns.length > 1 && (
          <select value={campaign} onChange={(e) => setCampaign(e.target.value)} className="rounded-lg border border-neutral-700 bg-neutral-900 px-3 py-2 text-sm text-neutral-100">
            <option value="">All emails</option>
            {campaigns.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
        )}
      </div>
      <div className="max-h-[65vh] overflow-auto rounded-lg border border-neutral-800">
        <table className="w-full text-sm">
          <thead className="sticky top-0 bg-neutral-900 text-left text-[11px] uppercase tracking-wide text-neutral-500">
            <tr>
              <th className="px-3 py-2">Account</th>
              <th className="px-3 py-2">Sent to</th>
              <th className="px-3 py-2">Email</th>
              <th className="px-3 py-2">Sent</th>
              <th className="px-3 py-2 text-center">Opened</th>
              <th className="px-3 py-2 text-center">Clicked</th>
              <th className="px-3 py-2 text-center">Replied</th>
            </tr>
          </thead>
          <tbody>
            {shown.map((r) => (
              <tr key={r.send_id} className="cursor-pointer border-t border-neutral-800 hover:bg-neutral-900" onClick={() => onOpenAccount(r.outlet_id)}>
                <td className="px-3 py-2">
                  <div className="font-semibold text-neutral-100">{r.account}</div>
                  <div className="text-xs text-neutral-500">
                    {[r.city, r.premise ? `${r.premise}-premise` : null].filter(Boolean).join(" · ")}
                  </div>
                </td>
                <td className="px-3 py-2 text-neutral-300">
                  {r.contact && <div>{r.contact}</div>}
                  <div className="text-xs text-neutral-500">{r.email}</div>
                </td>
                <td className="px-3 py-2 text-neutral-300">{r.subject || r.campaign}</td>
                <td className="whitespace-nowrap px-3 py-2 text-neutral-300">
                  {r.status === "queued" ? <span className="text-amber-300">Waiting to send</span> : fmtWhen(r.sent_at)}
                  {r.unsubscribed_at && <div className="text-xs text-amber-300">Unsubscribed</div>}
                  {r.bounced_at && <div className="text-xs text-red-300">Bounced</div>}
                </td>
                <td className="px-3 py-2 text-center">{r.opened_at ? "✓" : ""}</td>
                <td className="px-3 py-2 text-center">{r.clicked_at ? "✓" : ""}</td>
                <td className="px-3 py-2 text-center">
                  {r.open_replies ? <span className="rounded-full bg-red-500 px-2 text-xs font-bold text-white">New</span> : r.replies ? "✓" : ""}
                </td>
              </tr>
            ))}
            {shown.length === 0 && (
              <tr>
                <td colSpan={7} className="px-3 py-6 text-center text-neutral-500">
                  No matches.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      <p className="mt-2 text-xs text-neutral-500">“Opened” counts when the person&apos;s email app loads pictures, so it&apos;s approximate.</p>
    </WideModal>
  );
}

function RepliesModal({
  supabase,
  dist,
  rows,
  err,
  onClose,
  onOpenAccount,
  onChanged,
}: {
  supabase: Supa;
  dist: string;
  rows: ReplyRow[];
  err: string | null;
  onClose: () => void;
  onOpenAccount: (id: string) => void;
  onChanged: () => void;
}) {
  // Handled changes made here show right away, before the reload comes back.
  const [overrides, setOverrides] = useState<Record<string, { handled_at: string | null; handled_by_name: string | null }>>({});
  const list = useMemo(() => rows.map((r) => (overrides[r.id] ? { ...r, ...overrides[r.id] } : r)), [rows, overrides]);
  const [sel, setSel] = useState<string | null>(() => {
    try {
      const want = new URLSearchParams(window.location.search).get("reply");
      if (want && rows.some((r) => r.id === want)) return want;
    } catch {
      // ignore
    }
    return rows[0]?.id ?? null;
  });
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const current = list.find((r) => r.id === sel) ?? null;

  async function toggle(r: ReplyRow) {
    setBusy(true);
    setMsg(null);
    const { data, error } = await supabase.rpc("email_reply_set_handled", { p_id: r.id, p_handled: !r.handled_at });
    setBusy(false);
    if (error) {
      setMsg(error.message);
      return;
    }
    const d = data as { handled: boolean; by: string | null };
    setOverrides((prev) => ({ ...prev, [r.id]: { handled_at: d.handled ? new Date().toISOString() : null, handled_by_name: d.by } }));
    window.dispatchEvent(new Event("fcb-replies-changed"));
    onChanged();
  }

  const open = list.filter((r) => !r.handled_at).length;

  return (
    <WideModal
      title={`${dist} · Replies`}
      sub={`${open} waiting · ${list.length} total. Replies to our emails, checked once an hour. Mark one handled once it's taken care of.`}
      onClose={onClose}
    >
      {err && <p className="mb-3 text-sm text-red-300">{err}</p>}
      {msg && <p className="mb-3 text-sm text-red-300">{msg}</p>}
      {list.length === 0 ? (
        <p className="py-8 text-center text-neutral-500">No replies yet. They show up here within an hour of coming in.</p>
      ) : (
        <div className="flex flex-col gap-4 lg:flex-row">
          <div className="max-h-[70vh] w-full shrink-0 space-y-2 overflow-auto lg:w-[24rem]">
            <p className="text-[11px] font-semibold uppercase tracking-wide text-neutral-500">Accounts that replied</p>
            {list.map((r) => (
              <button
                type="button"
                key={r.id}
                onClick={() => setSel(r.id)}
                className={`block w-full rounded-xl border p-3 text-left ${
                  r.id === sel ? "border-[#6abc46] bg-neutral-900" : "border-neutral-800 hover:bg-neutral-900"
                } ${r.handled_at && r.id !== sel ? "opacity-70" : ""}`}
              >
                <div className="flex items-center gap-2">
                  <span className="truncate font-semibold text-neutral-100">{prettyAccountName(r.account) || r.account}</span>
                  {!r.handled_at ? (
                    <span className="rounded-full bg-red-500 px-2 text-[10px] font-bold text-white">NEW</span>
                  ) : (
                    <span className="truncate text-xs text-green-400">✓ Handled{r.handled_by_name ? ` by ${r.handled_by_name.split(" ")[0]}` : ""}</span>
                  )}
                  <span className="ml-auto shrink-0 text-xs text-neutral-400">{fmtWhen(r.received_at)}</span>
                </div>
                <div className="text-xs text-neutral-400">
                  {[r.city, r.campaign_subject || r.campaign].filter(Boolean).join(" · ")}
                </div>
                <div className="mt-1 truncate text-sm text-neutral-300">“{(r.body ?? "").replace(/\s+/g, " ").slice(0, 120)}”</div>
              </button>
            ))}
          </div>
          <div className="min-w-0 flex-1">
            {current ? (
              <ReplyDetail r={current} busy={busy} onToggleHandled={() => void toggle(current)} onOpenAccount={() => onOpenAccount(current.outlet_id)} />
            ) : (
              <p className="text-neutral-500">Pick a reply.</p>
            )}
          </div>
        </div>
      )}
    </WideModal>
  );
}
