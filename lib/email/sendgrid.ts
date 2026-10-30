import { createPublicKey, verify as cryptoVerify } from "node:crypto";

// SendGrid (Twilio's email service) — Email Studio's real sending (added
// 2026-10-30, per Chad). Server-only. Plain fetch to SendGrid's v3 API, no
// new npm package.
//
// Vercel env vars:
//   SENDGRID_API_KEY             — required to send (SendGrid → Settings → API Keys, "Mail Send" access).
//   EMAIL_FROM_ADDRESS           — optional, default ernie@fullcirclebrewing.com. Must be verified in SendGrid
//                                  (Sender Authentication — domain authentication for fullcirclebrewing.com).
//   SENDGRID_WEBHOOK_PUBLIC_KEY  — the Event Webhook's verification key (Mail Settings → Event Webhook →
//                                  Signed Event Webhook), so delivery/open/click events can't be faked.

export const DEFAULT_FROM_ADDRESS = "ernie@fullcirclebrewing.com";
export const UNSUB_PLACEHOLDER = "-fcb-unsubscribe-url-";

export function sendgridConfigured(): boolean {
  return !!process.env.SENDGRID_API_KEY;
}

export function fromAddress(): string {
  return process.env.EMAIL_FROM_ADDRESS || DEFAULT_FROM_ADDRESS;
}

export type SgRecipient = {
  email: string;
  name?: string | null;
  sendId: string;
  campaignId: string;
  unsubscribePageUrl: string;
  oneClickUrl: string;
};

/** Sends one batch (max 1000) of the same email. Each recipient gets their
 *  own unsubscribe link (UNSUB_PLACEHOLDER in the html/text is swapped per
 *  person) and one-click List-Unsubscribe headers. sendAt = unix seconds,
 *  up to 72 hours ahead (SendGrid's own scheduling). */
export async function sendgridSendBatch(opts: {
  recipients: SgRecipient[];
  subject: string;
  html: string;
  text: string;
  fromName: string;
  replyTo?: string | null;
  sendAt?: number | null;
}): Promise<{ ok: true; messageId: string | null } | { ok: false; error: string }> {
  const key = process.env.SENDGRID_API_KEY;
  if (!key) return { ok: false, error: "SendGrid isn't connected yet (SENDGRID_API_KEY missing)." };

  const body = {
    from: { email: fromAddress(), name: opts.fromName },
    ...(opts.replyTo ? { reply_to: { email: opts.replyTo } } : {}),
    subject: opts.subject,
    content: [
      { type: "text/plain", value: opts.text },
      { type: "text/html", value: opts.html },
    ],
    personalizations: opts.recipients.map((r) => ({
      to: [{ email: r.email, ...(r.name ? { name: r.name.slice(0, 100) } : {}) }],
      substitutions: { [UNSUB_PLACEHOLDER]: r.unsubscribePageUrl },
      headers: {
        "List-Unsubscribe": `<${r.oneClickUrl}>`,
        "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
      },
      custom_args: { send_id: r.sendId, campaign_id: r.campaignId },
    })),
    ...(opts.sendAt ? { send_at: opts.sendAt } : {}),
    tracking_settings: {
      click_tracking: { enable: true, enable_text: false },
      open_tracking: { enable: true },
      // Our own unsubscribe link/footer is used instead of SendGrid's.
      subscription_tracking: { enable: false },
    },
  };

  try {
    const res = await fetch("https://api.sendgrid.com/v3/mail/send", {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (res.status === 202 || res.ok) return { ok: true, messageId: res.headers.get("x-message-id") };
    const errText = await res.text().catch(() => "");
    let msg = errText.slice(0, 400);
    try {
      const j = JSON.parse(errText) as { errors?: { message?: string }[] };
      if (j.errors?.length) msg = j.errors.map((e) => e.message).filter(Boolean).join("; ");
    } catch {
      // keep raw text
    }
    return { ok: false, error: `SendGrid HTTP ${res.status}: ${msg}` };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Couldn't reach SendGrid." };
  }
}

/** Verifies SendGrid's Signed Event Webhook (ECDSA P-256 over timestamp + raw body). */
export function verifySendgridWebhook(publicKeyB64: string, signatureB64: string | null, timestamp: string | null, rawBody: string): boolean {
  if (!signatureB64 || !timestamp) return false;
  try {
    const pem = `-----BEGIN PUBLIC KEY-----\n${publicKeyB64.replace(/\s+/g, "").match(/.{1,64}/g)?.join("\n")}\n-----END PUBLIC KEY-----`;
    const key = createPublicKey(pem);
    return cryptoVerify("sha256", Buffer.from(timestamp + rawBody, "utf-8"), { key, dsaEncoding: "der" }, Buffer.from(signatureB64, "base64"));
  } catch {
    return false;
  }
}
