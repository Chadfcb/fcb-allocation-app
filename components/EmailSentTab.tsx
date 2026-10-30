"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

// Email Studio → Sent (added 2026-10-30, Phase 5; reworked the same day for
// ernie@ Gmail sending). Every email that went out, is going out, or is
// scheduled, with how it did. Sends go out a few at a time, 7am–6pm
// Pacific, up to 1,800 a day — "Waiting" is how many are still in line.
// Opens are approximate (Apple Mail and some others count every email as
// opened; some apps block images so opens never show). Bounces come back
// as bounce emails to the ernie@ inbox — add those addresses to
// do-not-email by hand on the Audience tab.

export type CampaignRow = {
  id: string;
  name: string;
  subject: string;
  status: "scheduled" | "sending" | "paused" | "cancelled" | "sent" | "partial" | "failed";
  scheduled_for: string | null;
  recipient_count: number;
  sent_count: number;
  failed_count: number;
  created_at: string;
  created_by_name: string | null;
  stats: {
    accepted: number;
    failed: number;
    opened: number;
    clicked: number;
    unsubscribed: number;
    waiting: number;
    skipped: number;
  } | null;
};

function fmt(iso: string) {
  return new Date(iso).toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZone: "America/Los_Angeles",
  });
}

const pct = (n: number, d: number) => (d > 0 ? `${Math.round((n / d) * 100)}%` : "—");

const STATUS: Record<CampaignRow["status"], { label: string; cls: string }> = {
  scheduled: { label: "Scheduled", cls: "bg-violet-500/15 text-violet-300" },
  sending: { label: "Sending", cls: "bg-sky-500/15 text-sky-300" },
  paused: { label: "Paused", cls: "bg-amber-500/15 text-amber-300" },
  cancelled: { label: "Cancelled", cls: "bg-neutral-500/15 text-neutral-300" },
  sent: { label: "Sent", cls: "bg-green-500/15 text-green-300" },
  partial: { label: "Partly sent", cls: "bg-amber-500/15 text-amber-300" },
  failed: { label: "Failed", cls: "bg-red-500/15 text-red-300" },
};

export default function EmailSentTab({
  campaigns,
  sentToday,
  dailyCap,
}: {
  campaigns: CampaignRow[];
  sentToday: number;
  dailyCap: number;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [confirmCancel, setConfirmCancel] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  async function act(campaignId: string, action: "pause" | "resume" | "cancel") {
    setBusy(campaignId);
    setErr(null);
    try {
      const r = await fetch("/api/email-studio/campaign", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ campaignId, action }),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) setErr(j.error ?? "Couldn't update that send.");
      setConfirmCancel(null);
      router.refresh();
    } finally {
      setBusy(null);
    }
  }

  const header = (
    <p className="mb-3 text-xs text-neutral-500">
      Sent today: <span className="text-neutral-300">{sentToday.toLocaleString()}</span> of {dailyCap.toLocaleString()} · emails go out a few
      at a time, 7am–6pm Pacific. Bounced addresses come back to the ernie@ inbox — add them to Do Not Email on the Audience tab.
    </p>
  );

  if (campaigns.length === 0) {
    return (
      <>
        {header}
        <p className="rounded-2xl border border-neutral-800 px-4 py-10 text-center text-sm text-neutral-500">
          Nothing sent yet. Open an email and click &ldquo;Send…&rdquo;.
        </p>
      </>
    );
  }
  const btn = "rounded-full border border-neutral-700 px-2.5 py-0.5 text-xs text-neutral-200 hover:border-neutral-500 disabled:opacity-50";
  return (
    <>
      {header}
      {err && <p className="mb-2 text-sm text-red-300">{err}</p>}
      <div className="overflow-x-auto rounded-lg border border-neutral-800">
        <table className="min-w-full text-sm">
          <thead className="bg-neutral-900 text-xs uppercase tracking-wide text-neutral-500">
            <tr>
              <th className="px-3 py-2 text-left">Email</th>
              <th className="px-3 py-2 text-left">Status</th>
              <th className="px-3 py-2 text-right">Recipients</th>
              <th className="px-3 py-2 text-right">Sent</th>
              <th className="px-3 py-2 text-right">Waiting</th>
              <th className="px-3 py-2 text-right">Opened</th>
              <th className="px-3 py-2 text-right">Clicked</th>
              <th className="px-3 py-2 text-right">Unsubscribed</th>
              <th className="px-3 py-2 text-right" />
            </tr>
          </thead>
          <tbody className="divide-y divide-neutral-900">
            {campaigns.map((c) => {
              const s = c.stats;
              const sent = s?.accepted ?? c.sent_count;
              const waiting = s?.waiting ?? 0;
              const open = c.status === "scheduled" || c.status === "sending" || c.status === "paused";
              return (
                <tr key={c.id}>
                  <td className="px-3 py-2">
                    <p className="font-semibold text-neutral-200">{c.subject}</p>
                    <p className="text-xs text-neutral-500">
                      {c.name} · {c.status === "scheduled" && c.scheduled_for ? `for ${fmt(c.scheduled_for)}` : fmt(c.created_at)}
                      {c.created_by_name ? ` · by ${c.created_by_name}` : ""}
                    </p>
                  </td>
                  <td className="px-3 py-2">
                    <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${STATUS[c.status].cls}`}>{STATUS[c.status].label}</span>
                    {(s?.failed ?? c.failed_count) > 0 && <p className="mt-0.5 text-xs text-red-300">{s?.failed ?? c.failed_count} failed</p>}
                    {(s?.skipped ?? 0) > 0 && <p className="mt-0.5 text-xs text-neutral-500">{s?.skipped} skipped</p>}
                  </td>
                  <td className="px-3 py-2 text-right text-neutral-200">{c.recipient_count.toLocaleString()}</td>
                  <td className="px-3 py-2 text-right text-neutral-300">{sent.toLocaleString()}</td>
                  <td className="px-3 py-2 text-right text-neutral-300">{waiting.toLocaleString()}</td>
                  <td className="px-3 py-2 text-right text-neutral-300">
                    {(s?.opened ?? 0).toLocaleString()} <span className="text-xs text-neutral-500">{pct(s?.opened ?? 0, sent)}</span>
                  </td>
                  <td className="px-3 py-2 text-right text-neutral-300">
                    {(s?.clicked ?? 0).toLocaleString()} <span className="text-xs text-neutral-500">{pct(s?.clicked ?? 0, sent)}</span>
                  </td>
                  <td className="px-3 py-2 text-right text-neutral-300">{(s?.unsubscribed ?? 0).toLocaleString()}</td>
                  <td className="whitespace-nowrap px-3 py-2 text-right">
                    {open && (
                      <div className="flex justify-end gap-1.5">
                        {c.status === "paused" ? (
                          <button type="button" className={btn} disabled={busy === c.id} onClick={() => void act(c.id, "resume")}>
                            Resume
                          </button>
                        ) : (
                          <button type="button" className={btn} disabled={busy === c.id} onClick={() => void act(c.id, "pause")}>
                            Pause
                          </button>
                        )}
                        {confirmCancel === c.id ? (
                          <button
                            type="button"
                            className="rounded-full border border-red-700 px-2.5 py-0.5 text-xs text-red-300 disabled:opacity-50"
                            disabled={busy === c.id}
                            onClick={() => void act(c.id, "cancel")}
                          >
                            Yes, cancel the rest
                          </button>
                        ) : (
                          <button type="button" className={btn} onClick={() => setConfirmCancel(c.id)}>
                            Cancel
                          </button>
                        )}
                      </div>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        <p className="px-3 py-2 text-xs text-neutral-500">
          Opens are approximate — some email apps count every email as opened, and some block images so opens never show. Clicks are
          the better signal.
        </p>
      </div>
    </>
  );
}
