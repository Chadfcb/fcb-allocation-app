"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

// Email Studio → "Send…" (added 2026-10-30, per Chad — Phase 5). Pick who
// gets the email, see exactly how many people that is, then send now or
// schedule. Sends from ernie@fullcirclebrewing.com's Gmail (reworked
// 2026-10-30, per Chad: no paid service, "capped at 1800 a day") in small
// batches every 5 minutes, 7am–6pm Pacific; big lists finish over several
// days. Everyone on the do-not-email list is always left out automatically.

type Audience = {
  accounts: { enabled: boolean; distributors: string[]; premises: string[]; boughtWithinDays: number | null };
  listIds: string[];
  extraEmails: string[];
};
type Options = {
  distributors: string[];
  premises: string[];
  lists: { id: string; name: string; source: string }[];
  ready: boolean;
  fromAddress: string;
  dailyCap: number;
  sentToday: number;
};
type Counts = { fromAccounts: number; fromLists: number; fromExtra: number; suppressed: number; invalid: number; total: number };
type Sample = { email: string; name: string | null; business: string | null };

const BOUGHT_OPTIONS: { label: string; days: number | null }[] = [
  { label: "Any time", days: null },
  { label: "Last 30 days", days: 30 },
  { label: "Last 90 days", days: 90 },
  { label: "Last 6 months", days: 182 },
  { label: "Last 12 months", days: 365 },
];

function toggle(list: string[], v: string): string[] {
  return list.includes(v) ? list.filter((x) => x !== v) : [...list, v];
}

export default function EmailSendDialog({
  designId,
  subject,
  onClose,
  beforeSend,
}: {
  designId: string;
  subject: string;
  onClose: () => void;
  /** Saves the email first; returns false if saving failed. */
  beforeSend: () => Promise<boolean>;
}) {
  const [opts, setOpts] = useState<Options | null>(null);
  const [loadErr, setLoadErr] = useState<string | null>(null);
  const [aud, setAud] = useState<Audience>({
    accounts: { enabled: true, distributors: [], premises: [], boughtWithinDays: null },
    listIds: [],
    extraEmails: [],
  });
  const [extraText, setExtraText] = useState("");
  const [counts, setCounts] = useState<Counts | null>(null);
  const [sample, setSample] = useState<Sample[]>([]);
  const [counting, setCounting] = useState(false);
  const [showSample, setShowSample] = useState(false);
  const [fromName, setFromName] = useState("Full Circle Brewing");
  const [replyTo, setReplyTo] = useState("ernie@fullcirclebrewing.com");
  const [when, setWhen] = useState<"now" | "later">("now");
  const [sendAt, setSendAt] = useState("");
  const [tested, setTested] = useState(false);
  const [sending, setSending] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; text: string } | null>(null);
  // Limit the schedule picker to the next 60 days (worked out once, when the dialog opens).
  const [{ minLocal, maxLocal }] = useState(() => {
    const now = Date.now();
    const tz = new Date().getTimezoneOffset() * 60000;
    return {
      minLocal: new Date(now + 5 * 60000 - tz).toISOString().slice(0, 16),
      maxLocal: new Date(now + 60 * 86400000 - tz).toISOString().slice(0, 16),
    };
  });

  useEffect(() => {
    fetch("/api/email-studio/audience")
      .then(async (r) => {
        const j = await r.json();
        if (!r.ok) throw new Error(j.error ?? "Couldn't load");
        setOpts(j as Options);
      })
      .catch((e) => setLoadErr(e instanceof Error ? e.message : String(e)));
  }, []);

  const audience = useMemo<Audience>(
    () => ({ ...aud, extraEmails: extraText.split(/[\s,;]+/).map((x) => x.trim()).filter(Boolean) }),
    [aud, extraText],
  );

  const count = useCallback(async () => {
    setCounting(true);
    try {
      const r = await fetch("/api/email-studio/audience", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ audience }),
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error ?? "Couldn't count");
      setCounts(j.counts as Counts);
      setSample(j.sample as Sample[]);
    } catch (e) {
      setCounts(null);
      setLoadErr(e instanceof Error ? e.message : String(e));
    } finally {
      setCounting(false);
    }
  }, [audience]);

  // Recount shortly after any change.
  useEffect(() => {
    if (!opts) return;
    const t = setTimeout(() => void count(), 500);
    return () => clearTimeout(t);
  }, [opts, count]);

  async function send() {
    if (!counts?.total) return;
    setSending(true);
    setResult(null);
    if (!(await beforeSend())) {
      setSending(false);
      return;
    }
    try {
      const r = await fetch("/api/email-studio/send", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          designId,
          audience,
          fromName,
          replyTo,
          sendAt: when === "later" && sendAt ? new Date(sendAt).toISOString() : null,
          expectedCount: counts.total,
        }),
      });
      const j = (await r.json().catch(() => ({}))) as {
        ok?: boolean;
        status?: string;
        queued?: number;
        firstBatch?: number;
        days?: number;
        inHours?: boolean;
        error?: string;
      };
      if (r.ok && j.ok) {
        const n = (j.queued ?? counts.total).toLocaleString();
        const span = j.days && j.days > 1 ? ` It will finish over about ${j.days} days.` : "";
        setResult({
          ok: true,
          text:
            j.status === "scheduled"
              ? `Scheduled for ${n} people.${span} Track it under Email Studio → Sent.`
              : j.inHours
                ? `Sending to ${n} people — the first ${j.firstBatch ?? 0} just went out, the rest go out a few at a time.${span} Track it under Email Studio → Sent.`
                : `Lined up for ${n} people. Sending starts at 7am Pacific.${span} Track it under Email Studio → Sent.`,
        });
      } else {
        setResult({ ok: false, text: j.error ?? "Couldn't send." });
      }
    } catch {
      setResult({ ok: false, text: "Couldn't send." });
    } finally {
      setSending(false);
    }
  }

  const chip = (on: boolean) =>
    `rounded-full border px-2.5 py-1 text-xs ${on ? "border-brand bg-brand/20 text-neutral-100" : "border-neutral-700 text-neutral-400 hover:text-neutral-200"}`;
  const field = "w-full rounded-lg border border-neutral-700 bg-neutral-900 px-3 py-1.5 text-sm text-neutral-100";


  const canSend = !!opts?.ready && !!counts?.total && tested && !sending && !result?.ok && (when === "now" || !!sendAt);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4" onClick={onClose}>
      <div
        className="flex max-h-[92vh] w-full max-w-[760px] flex-col overflow-hidden rounded-2xl border border-neutral-800 bg-neutral-950"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-neutral-800 px-5 py-3">
          <div>
            <h2 className="text-base font-semibold text-neutral-100">Send email</h2>
            <p className="text-xs text-neutral-400">{subject || "(no subject)"}</p>
          </div>
          <button type="button" onClick={onClose} className="text-sm text-neutral-400 hover:text-neutral-100">
            Close
          </button>
        </div>

        <div className="space-y-5 overflow-y-auto px-5 py-4 text-sm text-neutral-300">
          {loadErr && <p className="text-red-300">{loadErr}</p>}
          {opts && !opts.ready && (
            <p className="rounded-lg border border-amber-800 bg-amber-950/40 px-3 py-2 text-amber-200">
              Email sending isn&apos;t connected (the ernie@ Gmail login is missing in Vercel). You can pick the audience
              and see the count, but the Send button stays off until it&apos;s fixed.
            </p>
          )}

          <section className="space-y-2">
            <label className="flex items-center gap-2 font-semibold text-neutral-100">
              <input
                type="checkbox"
                checked={aud.accounts.enabled}
                onChange={(e) => setAud((a) => ({ ...a, accounts: { ...a.accounts, enabled: e.target.checked } }))}
                className="h-4 w-4"
              />
              Account contacts (emails on file in Accounts)
            </label>
            {aud.accounts.enabled && opts && (
              <div className="space-y-3 pl-6">
                <div>
                  <p className="mb-1 text-xs text-neutral-500">Distributor (none picked = all)</p>
                  <div className="flex flex-wrap gap-1.5">
                    {opts.distributors.map((d) => (
                      <button
                        key={d}
                        type="button"
                        className={chip(aud.accounts.distributors.includes(d))}
                        onClick={() => setAud((a) => ({ ...a, accounts: { ...a.accounts, distributors: toggle(a.accounts.distributors, d) } }))}
                      >
                        {d}
                      </button>
                    ))}
                  </div>
                </div>
                {opts.premises.length > 0 && (
                  <div>
                    <p className="mb-1 text-xs text-neutral-500">Premise (none picked = all)</p>
                    <div className="flex flex-wrap gap-1.5">
                      {opts.premises.map((p) => (
                        <button
                          key={p}
                          type="button"
                          className={chip(aud.accounts.premises.includes(p))}
                          onClick={() => setAud((a) => ({ ...a, accounts: { ...a.accounts, premises: toggle(a.accounts.premises, p) } }))}
                        >
                          {p}
                        </button>
                      ))}
                    </div>
                  </div>
                )}
                <div>
                  <p className="mb-1 text-xs text-neutral-500">Bought from us</p>
                  <div className="flex flex-wrap gap-1.5">
                    {BOUGHT_OPTIONS.map((b) => (
                      <button
                        key={b.label}
                        type="button"
                        className={chip(aud.accounts.boughtWithinDays === b.days)}
                        onClick={() => setAud((a) => ({ ...a, accounts: { ...a.accounts, boughtWithinDays: b.days } }))}
                      >
                        {b.label}
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            )}
          </section>

          {opts && opts.lists.length > 0 && (
            <section className="space-y-2">
              <p className="font-semibold text-neutral-100">Lists</p>
              <div className="flex flex-wrap gap-1.5">
                {opts.lists.map((l) => (
                  <button key={l.id} type="button" className={chip(aud.listIds.includes(l.id))} onClick={() => setAud((a) => ({ ...a, listIds: toggle(a.listIds, l.id) }))}>
                    {l.name}
                    {l.source === "mailchimp" ? " (Mailchimp)" : ""}
                  </button>
                ))}
              </div>
            </section>
          )}

          <section className="space-y-1">
            <p className="font-semibold text-neutral-100">Also send to</p>
            <textarea
              value={extraText}
              onChange={(e) => setExtraText(e.target.value)}
              rows={2}
              placeholder="Extra email addresses, separated by commas or new lines"
              className={field}
            />
          </section>

          <section className="rounded-xl border border-neutral-800 bg-neutral-900/50 px-4 py-3">
            {counting && !counts ? (
              <p>Counting…</p>
            ) : counts ? (
              <>
                <p className="text-2xl font-light text-neutral-100">
                  {counts.total.toLocaleString()} {counts.total === 1 ? "person" : "people"}
                  {counting && <span className="ml-2 text-xs text-neutral-500">updating…</span>}
                </p>
                <p className="text-xs text-neutral-500">
                  {counts.fromAccounts} from accounts · {counts.fromLists} from lists · {counts.fromExtra} added by hand
                  {counts.suppressed ? ` · ${counts.suppressed} left out (unsubscribed / bounced)` : ""}
                  {counts.invalid ? ` · ${counts.invalid} invalid addresses skipped` : ""}
                </p>
                {sample.length > 0 && (
                  <button type="button" onClick={() => setShowSample((v) => !v)} className="mt-1 text-xs text-brand underline">
                    {showSample ? "Hide" : "Show"} who&apos;s included{counts.total > sample.length ? ` (first ${sample.length})` : ""}
                  </button>
                )}
                {showSample && (
                  <ul className="mt-2 max-h-40 overflow-y-auto text-xs text-neutral-400">
                    {sample.map((r) => (
                      <li key={r.email}>
                        {r.email}
                        {r.name ? ` — ${r.name}` : ""}
                        {r.business ? ` (${r.business})` : ""}
                      </li>
                    ))}
                  </ul>
                )}
              </>
            ) : (
              <p className="text-neutral-500">Pick who should get it.</p>
            )}
          </section>

          <section className="grid gap-3 sm:grid-cols-2">
            <label className="block text-xs text-neutral-400">
              From name
              <input value={fromName} onChange={(e) => setFromName(e.target.value)} className={field} />
            </label>
            <label className="block text-xs text-neutral-400">
              Replies go to
              <input value={replyTo} onChange={(e) => setReplyTo(e.target.value)} className={field} />
            </label>
            <p className="text-xs text-neutral-500 sm:col-span-2">Sent from {opts?.fromAddress ?? "ernie@fullcirclebrewing.com"}.</p>
          </section>

          <section className="space-y-2">
            <div className="flex gap-4">
              <label className="flex items-center gap-2">
                <input type="radio" checked={when === "now"} onChange={() => setWhen("now")} /> Send now
              </label>
              <label className="flex items-center gap-2">
                <input type="radio" checked={when === "later"} onChange={() => setWhen("later")} /> Schedule
              </label>
            </div>
            {when === "later" && (
              <input
                type="datetime-local"
                value={sendAt}
                min={minLocal}
                max={maxLocal}
                onChange={(e) => setSendAt(e.target.value)}
                className={`${field} max-w-xs`}
              />
            )}
            <p className="text-xs text-neutral-500">
              Goes out a few at a time, 7am–6pm Pacific, up to {(opts?.dailyCap ?? 1800).toLocaleString()} a day
              {opts ? ` (${opts.sentToday.toLocaleString()} sent so far today)` : ""}.
              {counts && counts.total > (opts?.dailyCap ?? 1800)
                ? ` This one will take about ${Math.ceil(counts.total / (opts?.dailyCap ?? 1800))} days to finish.`
                : ""}
            </p>
          </section>

          <label className="flex items-start gap-2 text-sm">
            <input type="checkbox" checked={tested} onChange={(e) => setTested(e.target.checked)} className="mt-0.5 h-4 w-4" />
            I sent myself a test and it looks right.
          </label>

          {result && <p className={result.ok ? "font-semibold text-green-300" : "font-semibold text-red-300"}>{result.text}</p>}
        </div>

        <div className="flex items-center justify-end gap-2 border-t border-neutral-800 px-5 py-3">
          <button type="button" onClick={onClose} className="rounded-full border border-neutral-700 px-4 py-1.5 text-sm text-neutral-200">
            {result?.ok ? "Done" : "Cancel"}
          </button>
          <button
            type="button"
            disabled={!canSend}
            onClick={() => void send()}
            className="rounded-full bg-brand px-4 py-1.5 text-sm font-semibold text-black disabled:opacity-50"
          >
            {sending
              ? "Sending…"
              : counts?.total
                ? `${when === "later" ? "Schedule for" : "Send to"} ${counts.total.toLocaleString()} ${counts.total === 1 ? "person" : "people"}`
                : "Send"}
          </button>
        </div>
      </div>
    </div>
  );
}
