import type { createAdminClient } from "@/lib/supabase/admin";
import { fromAddress, gmailConfigured, isGmailLimitError, sendCampaignEmail, UNSUB_PLACEHOLDER } from "@/lib/email/gmailSend";
import { personalizeEmail } from "@/lib/email/tracking";
import { htmlToText } from "@/lib/email/studio";
import { unsubscribeOneClickUrl, unsubscribePageUrl } from "@/lib/email/unsubscribe";

type Admin = ReturnType<typeof createAdminClient>;

// Email Studio's sending line (added 2026-10-30, per Chad: send from ernie@
// Gmail, "capped at 1800 a day", and big lists finish over several days:
// "2000 the first day, 2000 the second, so on and so forth" — capped at
// 1,800 to leave room for ernie@'s task reminders and test emails under
// Google's ~2,000/day limit).
//
// Supabase's scheduler calls /api/email-studio/worker every 5 minutes
// (sql/email_gmail_sending.sql). Each run:
//   1. starts any scheduled sends whose time has come,
//   2. stops if it's outside 7am–6pm Pacific or the day's 1,800 are used,
//   3. sends the next small batch (PER_RUN) — spreads a full day's 1,800
//      over the 11 sending hours instead of one blast,
//   4. marks finished sends as Sent.

export const DAILY_CAP = 1800;
export const PER_RUN = 15;
export const SEND_START_HOUR = 7; // 7am Pacific
export const SEND_END_HOUR = 18; // stops at 6pm Pacific
const TZ = "America/Los_Angeles";

function pacificParts(d: Date) {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-US", {
      timeZone: TZ,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    })
      .formatToParts(d)
      .map((p) => [p.type, p.value]),
  );
  return { y: +parts.year, m: +parts.month, d: +parts.day, h: +parts.hour % 24, min: +parts.minute };
}

/** Midnight Pacific today, as a real instant (for "sent today" counting). */
export function pacificMidnight(now = new Date()): Date {
  const p = pacificParts(now);
  // Guess UTC midnight-of-that-date + 8h, then correct by the actual offset.
  const guess = new Date(Date.UTC(p.y, p.m - 1, p.d, 8, 0, 0));
  const g = pacificParts(guess);
  const drift = (g.h * 60 + g.min) * 60000;
  return new Date(guess.getTime() - drift);
}

export function inSendingHours(now = new Date()): boolean {
  const h = pacificParts(now).h;
  return h >= SEND_START_HOUR && h < SEND_END_HOUR;
}

export async function sentToday(admin: Admin, now = new Date()): Promise<number> {
  const { count } = await admin
    .from("email_sends")
    .select("id", { count: "exact", head: true })
    .gte("sent_at", pacificMidnight(now).toISOString());
  return count ?? 0;
}

/** Plain-English estimate shown before sending. */
export function estimateDays(total: number): number {
  return Math.max(1, Math.ceil(total / DAILY_CAP));
}

type RunResult = { sent: number; failed: number; skipped: number; note: string };

export async function processEmailQueue(admin: Admin, opts: { maxThisRun?: number } = {}): Promise<RunResult> {
  const result: RunResult = { sent: 0, failed: 0, skipped: 0, note: "" };
  const now = new Date();

  // 1. Scheduled sends whose time has come.
  await admin.from("email_campaigns").update({ status: "sending" }).eq("status", "scheduled").lte("scheduled_for", now.toISOString());

  if (!gmailConfigured()) {
    result.note = "Gmail isn't connected (GMAIL_USER / GMAIL_APP_PASSWORD).";
    return result;
  }
  if (!inSendingHours(now)) {
    result.note = "Outside sending hours (7am–6pm Pacific).";
    await finishCampaigns(admin);
    return result;
  }
  const left = DAILY_CAP - (await sentToday(admin, now));
  if (left <= 0) {
    result.note = `Today's ${DAILY_CAP} are used; continuing tomorrow.`;
    await finishCampaigns(admin);
    return result;
  }

  const take = Math.min(opts.maxThisRun ?? PER_RUN, left);
  const { data: claimed, error } = await admin.rpc("claim_email_sends", { n: take });
  if (error) {
    result.note = `Couldn't pick the next emails: ${error.message}`;
    return result;
  }
  const rows = (claimed ?? []) as { id: string; campaign_id: string; email: string; name: string | null }[];
  if (rows.length === 0) {
    await finishCampaigns(admin);
    result.note = "Nothing waiting.";
    return result;
  }

  // The frozen copy of each email being sent this run.
  const campaignIds = [...new Set(rows.map((r) => r.campaign_id))];
  const { data: camps } = await admin
    .from("email_campaigns")
    .select("id, subject, from_name, reply_to, html_snapshot, status")
    .in("id", campaignIds);
  const campById = new Map((camps ?? []).map((c) => [c.id, c]));

  // Anyone who unsubscribed (or was added to do-not-email) after the send started.
  const { data: supp } = await admin
    .from("email_suppressions")
    .select("email")
    .in("email", rows.map((r) => r.email));
  const suppressed = new Set((supp ?? []).map((s) => s.email));

  let stopped = false;
  for (const r of rows) {
    if (stopped) {
      await admin.from("email_sends").update({ status: "queued", claimed_at: null }).eq("id", r.id);
      continue;
    }
    const c = campById.get(r.campaign_id);
    if (!c || c.status !== "sending" || suppressed.has(r.email)) {
      const status = !c || c.status === "cancelled" || suppressed.has(r.email) ? "skipped" : "queued";
      await admin.from("email_sends").update({ status, claimed_at: null }).eq("id", r.id);
      if (status === "skipped") result.skipped++;
      continue;
    }
    const html = personalizeEmail({
      html: c.html_snapshot,
      sendId: r.id,
      unsubscribePlaceholder: UNSUB_PLACEHOLDER,
      unsubscribeUrl: unsubscribePageUrl(r.email),
    });
    try {
      await sendCampaignEmail({
        to: r.email,
        toName: r.name,
        fromName: c.from_name,
        replyTo: c.reply_to,
        subject: c.subject,
        html,
        text: htmlToText(html),
        oneClickUnsubscribeUrl: unsubscribeOneClickUrl(r.email),
      });
      await admin.from("email_sends").update({ status: "accepted", sent_at: new Date().toISOString(), error: null }).eq("id", r.id);
      result.sent++;
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (isGmailLimitError(msg)) {
        // Gmail says slow down — put it back in line and stop this run.
        await admin.from("email_sends").update({ status: "queued", claimed_at: null }).eq("id", r.id);
        result.note = `Gmail asked us to slow down: ${msg.slice(0, 200)}`;
        stopped = true;
      } else {
        await admin.from("email_sends").update({ status: "failed", error: msg.slice(0, 500), claimed_at: null }).eq("id", r.id);
        result.failed++;
      }
    }
  }

  await finishCampaigns(admin);
  if (!result.note) result.note = `Sent ${result.sent} from ${fromAddress()}.`;
  return result;
}

/** Marks sends with nothing left waiting as Sent / Partly sent / Failed and
 *  keeps the sent/failed totals up to date. */
async function finishCampaigns(admin: Admin) {
  const { data: active } = await admin.from("email_campaigns").select("id").in("status", ["sending", "paused"]);
  for (const c of active ?? []) {
    const { data: st } = await admin.from("email_campaign_stats").select("accepted, failed, waiting").eq("campaign_id", c.id).maybeSingle();
    if (!st) continue;
    const update: Record<string, unknown> = { sent_count: st.accepted, failed_count: st.failed };
    if (st.waiting === 0) {
      update.status = st.failed === 0 ? "sent" : st.accepted === 0 ? "failed" : "partial";
      update.finished_at = new Date().toISOString();
    }
    await admin.from("email_campaigns").update(update).eq("id", c.id);
  }
}
