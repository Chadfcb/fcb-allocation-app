import { createHmac, timingSafeEqual } from "node:crypto";

// Signed unsubscribe links for Email Studio sends (added 2026-10-30). Each
// recipient gets a link containing their email + a signature, so nobody can
// unsubscribe someone else by editing the link. Server-only.
//
// Secret: EMAIL_UNSUBSCRIBE_SECRET (any long random string, set in Vercel).
// Falls back to the Supabase service role key so links work before it's set
// — but once emails have gone out, don't change whichever one is in use or
// older unsubscribe links stop working. The same secret signs the click-
// tracking links (lib/email/tracking.ts).

export const APP_BASE_URL = "https://www.fcb-data.com";

export function emailLinkSecret(): string {
  const s = process.env.EMAIL_UNSUBSCRIBE_SECRET || process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!s) throw new Error("Missing EMAIL_UNSUBSCRIBE_SECRET");
  return s;
}

const b64url = (b: Buffer) => b.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const fromB64url = (s: string) => Buffer.from(s.replace(/-/g, "+").replace(/_/g, "/"), "base64");

function sign(email: string): string {
  return b64url(createHmac("sha256", emailLinkSecret()).update(`unsub:${email.toLowerCase()}`).digest()).slice(0, 32);
}

function params(email: string): string {
  return `e=${b64url(Buffer.from(email.toLowerCase(), "utf-8"))}&s=${sign(email)}`;
}

/** The link in the email footer — a page with an Unsubscribe button. */
export function unsubscribePageUrl(email: string): string {
  return `${APP_BASE_URL}/email/unsubscribe?${params(email)}`;
}

/** The List-Unsubscribe header link (Gmail/Yahoo one-click unsubscribe). */
export function unsubscribeOneClickUrl(email: string): string {
  return `${APP_BASE_URL}/api/email/unsubscribe?${params(email)}`;
}

/** Returns the email if the e/s pair is genuine, else null. */
export function verifyUnsubscribe(e: string | null, s: string | null): string | null {
  if (!e || !s) return null;
  let email: string;
  try {
    email = fromB64url(e).toString("utf-8").trim().toLowerCase();
  } catch {
    return null;
  }
  if (!email.includes("@")) return null;
  const expected = Buffer.from(sign(email));
  const given = Buffer.from(s);
  return expected.length === given.length && timingSafeEqual(expected, given) ? email : null;
}
