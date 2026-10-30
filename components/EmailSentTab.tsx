"use client";

// Email Studio → Sent (added 2026-10-30, Phase 5): every email that went out
// (or is scheduled), with how it did. Delivered / opened / clicked /
// bounced / unsubscribed come from SendGrid's Event Webhook. Opens are
// approximate (Apple Mail and some others count every email as opened).

export type CampaignRow = {
  id: string;
  name: string;
  subject: string;
  status: "sending" | "scheduled" | "sent" | "partial" | "failed";
  scheduled_for: string | null;
  recipient_count: number;
  sent_count: number;
  failed_count: number;
  created_at: string;
  created_by_name: string | null;
  stats: {
    delivered: number;
    opened: number;
    clicked: number;
    bounced: number;
    spam_reports: number;
    unsubscribed: number;
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
  sending: { label: "Sending", cls: "bg-sky-500/15 text-sky-300" },
  scheduled: { label: "Scheduled", cls: "bg-violet-500/15 text-violet-300" },
  sent: { label: "Sent", cls: "bg-green-500/15 text-green-300" },
  partial: { label: "Partly sent", cls: "bg-amber-500/15 text-amber-300" },
  failed: { label: "Failed", cls: "bg-red-500/15 text-red-300" },
};

export default function EmailSentTab({ campaigns }: { campaigns: CampaignRow[] }) {
  if (campaigns.length === 0) {
    return (
      <p className="rounded-2xl border border-neutral-800 px-4 py-10 text-center text-sm text-neutral-500">
        Nothing sent yet. Open an email and click &ldquo;Send…&rdquo;.
      </p>
    );
  }
  return (
    <div className="overflow-x-auto rounded-lg border border-neutral-800">
      <table className="min-w-full text-sm">
        <thead className="bg-neutral-900 text-xs uppercase tracking-wide text-neutral-500">
          <tr>
            <th className="px-3 py-2 text-left">Email</th>
            <th className="px-3 py-2 text-left">Status</th>
            <th className="px-3 py-2 text-right">Recipients</th>
            <th className="px-3 py-2 text-right">Delivered</th>
            <th className="px-3 py-2 text-right">Opened</th>
            <th className="px-3 py-2 text-right">Clicked</th>
            <th className="px-3 py-2 text-right">Bounced</th>
            <th className="px-3 py-2 text-right">Unsubscribed</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-neutral-900">
          {campaigns.map((c) => {
            const s = c.stats;
            const delivered = s?.delivered ?? 0;
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
                  {c.failed_count > 0 && <p className="mt-0.5 text-xs text-red-300">{c.failed_count} failed</p>}
                </td>
                <td className="px-3 py-2 text-right text-neutral-200">{c.recipient_count.toLocaleString()}</td>
                <td className="px-3 py-2 text-right text-neutral-300">{delivered.toLocaleString()}</td>
                <td className="px-3 py-2 text-right text-neutral-300">
                  {(s?.opened ?? 0).toLocaleString()} <span className="text-xs text-neutral-500">{pct(s?.opened ?? 0, delivered)}</span>
                </td>
                <td className="px-3 py-2 text-right text-neutral-300">
                  {(s?.clicked ?? 0).toLocaleString()} <span className="text-xs text-neutral-500">{pct(s?.clicked ?? 0, delivered)}</span>
                </td>
                <td className="px-3 py-2 text-right text-neutral-300">{((s?.bounced ?? 0) + (s?.spam_reports ?? 0)).toLocaleString()}</td>
                <td className="px-3 py-2 text-right text-neutral-300">{(s?.unsubscribed ?? 0).toLocaleString()}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <p className="px-3 py-2 text-xs text-neutral-500">
        Opens are approximate — some email apps (like Apple Mail) count every email as opened. Clicks are the better signal.
      </p>
    </div>
  );
}
