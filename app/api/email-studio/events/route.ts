import { createAdminClient } from "@/lib/supabase/admin";
import { verifySendgridWebhook } from "@/lib/email/sendgrid";

// SendGrid Event Webhook (added 2026-10-30): SendGrid calls this as emails
// are delivered, opened, clicked, bounced, reported as spam or unsubscribed.
// Each event carries the send_id we attached, so it updates that
// recipient's row in email_sends. Bounces and spam reports also go on the
// do-not-email list so they're never sent to again.
//
// No login (SendGrid's servers call it) — exempt in proxy.ts; it checks
// SendGrid's signature with SENDGRID_WEBHOOK_PUBLIC_KEY instead.
// Set up in SendGrid: Settings → Mail Settings → Event Webhook →
//   URL https://www.fcb-data.com/api/email-studio/events, events: Delivered,
//   Opened, Clicked, Bounced, Dropped, Spam Reports, Unsubscribes; turn on
//   Signed Event Webhook and copy its Verification Key into Vercel.
export const dynamic = "force-dynamic";

type SgEvent = {
  event?: string;
  email?: string;
  timestamp?: number;
  send_id?: string;
  campaign_id?: string;
  reason?: string;
  type?: string;
};

export async function POST(request: Request) {
  const key = process.env.SENDGRID_WEBHOOK_PUBLIC_KEY;
  if (!key) return new Response("Not configured", { status: 503 });

  const raw = await request.text();
  const ok = verifySendgridWebhook(
    key,
    request.headers.get("x-twilio-email-event-webhook-signature"),
    request.headers.get("x-twilio-email-event-webhook-timestamp"),
    raw,
  );
  if (!ok) return new Response("Forbidden", { status: 403 });

  let events: SgEvent[];
  try {
    events = JSON.parse(raw) as SgEvent[];
  } catch {
    return new Response("Bad request", { status: 400 });
  }

  const admin = createAdminClient();
  for (const ev of Array.isArray(events) ? events : []) {
    const at = new Date((ev.timestamp ?? Date.now() / 1000) * 1000).toISOString();
    const email = ev.email?.trim().toLowerCase();
    const col =
      ev.event === "delivered"
        ? "delivered_at"
        : ev.event === "open"
          ? "opened_at"
          : ev.event === "click"
            ? "clicked_at"
            : ev.event === "bounce" || ev.event === "dropped"
              ? "bounced_at"
              : ev.event === "spamreport"
                ? "spam_at"
                : ev.event === "unsubscribe" || ev.event === "group_unsubscribe"
                  ? "unsubscribed_at"
                  : null;
    try {
      if (col && ev.send_id) {
        // First time only — keep the earliest open/click.
        await admin.from("email_sends").update({ [col]: at }).eq("id", ev.send_id).is(col, null);
      }
      // Hard bounces and spam complaints: never email again.
      const hardBounce = ev.event === "bounce" && ev.type !== "blocked";
      if (email && (hardBounce || ev.event === "spamreport" || ev.event === "unsubscribe" || ev.event === "group_unsubscribe")) {
        await admin
          .from("email_suppressions")
          .upsert(
            {
              email,
              reason: ev.event === "spamreport" ? "spam_report" : ev.event === "bounce" ? "bounced" : "unsubscribed",
              source: `sendgrid:${ev.event}${ev.reason ? ` — ${ev.reason.slice(0, 200)}` : ""}`,
            },
            { onConflict: "email", ignoreDuplicates: true },
          );
      }
    } catch (err) {
      console.error("[email-studio/events]", err);
    }
  }
  return new Response("ok", { status: 200 });
}
