import { ImapFlow } from "imapflow";
import { simpleParser, type AddressObject } from "mailparser";
import type { SupabaseClient } from "@supabase/supabase-js";

// Email Studio — reading replies from Ernie's inbox (added 2026-11-25, per
// Chad: "i want the email checked for replies, us notified, so we can act" …
// "maybe once an hour" … notified in the app). Server-only.
// Plan: claude/email-replies-alerts-plan.md. SQL: sql/email_replies.sql.
//
// Runs from the every-5-minute sender (app/api/email-studio/worker), but only
// actually opens the inbox once an hour (CHECK_EVERY_MIN). Uses the same
// mailbox + App Password as sending (GMAIL_USER / GMAIL_APP_PASSWORD), over
// IMAP, read-only: nothing in the inbox is moved, deleted or marked read.
//
// A message counts as a reply when it comes FROM an address we sent a
// campaign email to. It's matched to that person's most recent send →
// account + email. Skipped: out-of-office / automatic replies, bounces, and
// anything from someone we never emailed. A short "unsubscribe" / "remove me"
// reply puts the address on the do-not-email list and is saved as already
// handled (no alert).

type Admin = SupabaseClient;

export const CHECK_EVERY_MIN = 60;
const LOOK_BACK_DAYS_FIRST = 3; // first ever check
const MAX_PER_RUN = 150;

export type ReplyCheckResult = { ran: boolean; checked: number; saved: number; skipped: number; note?: string };

const AUTO_SUBJECT =
  /^(automatic reply|auto(matic)?[- ]?(reply|response)|autoreply|out of (the )?office|ooo\b|away from|on vacation|i am out|i'm out|delivery status notification|undeliverable|undelivered mail|mail delivery (failed|subsystem)|returned mail|failure notice)/i;
const BOUNCE_FROM = /^(mailer-daemon|postmaster|no-?reply|noreply|do-?not-?reply)@/i;
const UNSUB_REPLY = /\b(unsubscribe|remove me|take me off|stop (emailing|sending)|opt[- ]?out|no more emails)\b/i;

function firstAddress(a: AddressObject | AddressObject[] | undefined): { email: string; name: string | null } | null {
  const list = Array.isArray(a) ? a : a ? [a] : [];
  for (const obj of list) {
    for (const v of obj.value ?? []) {
      if (v.address) return { email: v.address.trim().toLowerCase(), name: v.name?.trim() || null };
    }
  }
  return null;
}

function headerValue(h: unknown): string {
  if (h == null) return "";
  if (typeof h === "string") return h;
  if (typeof h === "object" && "value" in (h as Record<string, unknown>)) return String((h as { value: unknown }).value ?? "");
  return String(h);
}

/** Their words only: cuts the quoted original email and signatures' reply chains. */
export function trimQuoted(text: string): string {
  const lines = text.replace(/\r\n/g, "\n").split("\n");
  const out: string[] = [];
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i];
    const t = l.trim();
    if (/^>/.test(t)) break;
    if (/^On .{4,200}(wrote|écrit|escribió):?$/i.test(t)) break;
    // Gmail wraps "On … wrote:" over two lines.
    if (/^On .{4,200}$/i.test(t) && /wrote:?$/i.test((lines[i + 1] ?? "").trim())) break;
    if (/^-{2,}\s*(Original Message|Forwarded message)/i.test(t)) break;
    if (/^_{8,}$/.test(t)) break;
    if (/^From:\s.+/i.test(t) && out.length > 0) break;
    if (/^Sent from my (iPhone|iPad|Android|phone|mobile)/i.test(t)) break;
    out.push(l);
  }
  return out.join("\n").replace(/\n{3,}/g, "\n\n").trim().slice(0, 4000);
}

function isAutoReply(headers: Map<string, unknown>, subject: string, from: string): boolean {
  const auto = headerValue(headers.get("auto-submitted")).toLowerCase();
  if (auto && auto !== "no") return true;
  if (headers.has("x-autoreply") || headers.has("x-autorespond") || headers.has("x-auto-response-suppress")) {
    // x-auto-response-suppress is also sent by normal Outlook mail; only trust it with an auto subject.
    if (headers.has("x-autoreply") || headers.has("x-autorespond") || AUTO_SUBJECT.test(subject)) return true;
  }
  const prec = headerValue(headers.get("precedence")).toLowerCase();
  if (["auto_reply", "bulk", "junk", "list"].includes(prec)) return true;
  if (AUTO_SUBJECT.test(subject)) return true;
  if (BOUNCE_FROM.test(from)) return true;
  return false;
}

/** Opens Ernie's inbox and saves new replies — only if an hour has passed
 *  since the last check (or force). Never throws. */
export async function checkRepliesIfDue(admin: Admin, opts: { force?: boolean } = {}): Promise<ReplyCheckResult> {
  const result: ReplyCheckResult = { ran: false, checked: 0, saved: 0, skipped: 0 };
  const user = process.env.GMAIL_USER;
  const pass = process.env.GMAIL_APP_PASSWORD;
  if (!user || !pass) {
    result.note = "Ernie's email login isn't set up (GMAIL_USER / GMAIL_APP_PASSWORD).";
    return result;
  }

  const { data: state, error: stErr } = await admin.from("email_reply_state").select("last_checked_at").eq("id", 1).maybeSingle();
  if (stErr) {
    result.note = `Replies aren't set up yet (run sql/email_replies.sql): ${stErr.message}`;
    return result;
  }
  const last = state?.last_checked_at ? new Date(state.last_checked_at as string) : null;
  const now = new Date();
  if (!opts.force && last && now.getTime() - last.getTime() < (CHECK_EVERY_MIN - 2) * 60000) {
    result.note = "Checked less than an hour ago.";
    return result;
  }
  result.ran = true;
  // Look back a day before the last check (catches anything that arrived late).
  const since = last ? new Date(last.getTime() - 24 * 3600000) : new Date(now.getTime() - LOOK_BACK_DAYS_FIRST * 86400000);

  const client = new ImapFlow({
    host: "imap.gmail.com",
    port: 993,
    secure: true,
    auth: { user, pass },
    logger: false,
  });

  let note = "";
  try {
    await client.connect();
    const lock = await client.getMailboxLock("INBOX", { readOnly: true });
    try {
      const uids = ((await client.search({ since }, { uid: true })) || []) as number[];
      const recent = uids.slice(-MAX_PER_RUN);
      if (recent.length) {
        for await (const msg of client.fetch(recent, { uid: true, source: true, internalDate: true }, { uid: true })) {
          result.checked++;
          try {
            if (!msg.source) continue;
            const parsed = await simpleParser(msg.source);
            const from = firstAddress(parsed.from);
            const subject = (parsed.subject ?? "").trim();
            if (!from || from.email === user.toLowerCase()) {
              result.skipped++;
              continue;
            }
            if (isAutoReply(parsed.headers as Map<string, unknown>, subject, from.email)) {
              result.skipped++;
              continue;
            }
            const messageId = (parsed.messageId || `uid-${msg.uid}-${from.email}`).trim();

            // Someone we emailed? Their most recent campaign email.
            const { data: send } = await admin
              .from("email_sends")
              .select("id, campaign_id, outlet_id, status, sent_at")
              .eq("email", from.email)
              .eq("status", "accepted")
              .order("sent_at", { ascending: false, nullsFirst: false })
              .limit(1)
              .maybeSingle();
            if (!send) {
              result.skipped++;
              continue;
            }

            const received = parsed.date ?? (msg.internalDate instanceof Date ? msg.internalDate : now);
            const body = trimQuoted(parsed.text || "") || "(No message text — the reply may only have a picture or attachment.)";
            const isUnsub = body.length < 300 && UNSUB_REPLY.test(body);

            const row: Record<string, unknown> = {
              message_id: messageId,
              send_id: send.id,
              campaign_id: send.campaign_id,
              outlet_id: send.outlet_id ?? null,
              from_email: from.email,
              from_name: from.name,
              subject: subject || null,
              body,
              received_at: received.toISOString(),
            };
            if (isUnsub) {
              row.handled_at = now.toISOString();
              row.handled_by_name = "Automatic: asked to unsubscribe";
            }
            const { data: ins, error: insErr } = await admin
              .from("email_replies")
              .upsert(row, { onConflict: "message_id", ignoreDuplicates: true })
              .select("id");
            if (insErr) {
              note = `Couldn't save a reply: ${insErr.message}`;
              continue;
            }
            if (ins && ins.length) {
              result.saved++;
              if (isUnsub) {
                await admin
                  .from("email_suppressions")
                  .upsert({ email: from.email, reason: "unsubscribed", source: "replied asking to unsubscribe" }, { onConflict: "email", ignoreDuplicates: true });
                await admin.from("email_sends").update({ unsubscribed_at: now.toISOString() }).eq("id", send.id).is("unsubscribed_at", null);
              }
            }
          } catch {
            result.skipped++;
          }
        }
      }
    } finally {
      lock.release();
    }
    await client.logout();
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    note = /auth|credential|login|LOGIN|AUTHENTICATIONFAILED/i.test(msg)
      ? `Couldn't sign in to Ernie's inbox (${msg}). Gmail may need IMAP turned on for ernie@.`
      : `Couldn't read Ernie's inbox: ${msg}`;
    try {
      client.close();
    } catch {
      // already closed
    }
  }

  result.note = note || `Checked ${result.checked} message${result.checked === 1 ? "" : "s"}, ${result.saved} new repl${result.saved === 1 ? "y" : "ies"}.`;
  await admin
    .from("email_reply_state")
    .update({ last_checked_at: now.toISOString(), last_result: result.note })
    .eq("id", 1);
  return result;
}
