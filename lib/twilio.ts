import { createHmac, timingSafeEqual } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";

// Twilio texting — shared settings and helpers (added 2026-10-29, per Chad).
// Plan + decisions: claude/twilio-texting-notes.md in the project.
//
// Server-only (uses node:crypto) — never import into a "use client" file.
// The wording below is what Twilio's campaign registration was told, and what
// the public Privacy / Terms / sign-up pages show — keep them in sync here,
// in one place.

export const TWILIO = {
  brand: "Full Circle Brewing",
  legalName: "Full Circle Brewing Co. Ltd. LLC",
  number: "+15594780269",
  numberDisplay: "(559) 478-0269",
  messagingService: "FCB New Items",
  complianceProfileSid: "BU413a0fca74db515783ffae5aff02d3db",
  address: "620 F St., Fresno, CA 93706",
  website: "https://fullcirclebrewing.com",
  joinKeyword: "JOIN",
} as const;

// Sent back right away when someone texts JOIN.
export const JOIN_CONFIRMATION =
  `${TWILIO.brand}: You're signed up for new-item texts. Msg frequency varies. ` +
  `Msg & data rates may apply. Reply HELP for help, STOP to opt out.`;

// What the web sign-up form's (unchecked) consent box says.
export const WEB_CONSENT_TEXT =
  `By checking this box, I agree to receive recurring marketing text messages from ${TWILIO.brand} ` +
  `about new beer releases, seasonal products and availability at the mobile number provided. ` +
  `Consent is not a condition of purchase. Msg frequency varies. Msg & data rates may apply. ` +
  `Reply HELP for help, STOP to opt out.`;

// Carrier / Twilio standard keywords. Twilio's messaging service already
// handles STOP / HELP / START itself (blocks the number and sends its own
// reply), so the webhook only RECORDS these — it never replies to them, or
// the person would get two texts.
const STOP_WORDS = ["STOP", "STOPALL", "UNSUBSCRIBE", "CANCEL", "END", "QUIT", "OPTOUT", "REVOKE"];
const HELP_WORDS = ["HELP", "INFO"];
// Twilio's own re-subscribe words are START, UNSTOP and YES. YES is left out
// on purpose: buyers answering a new-item text with "yes" is a reply for
// their rep, not a sign-up (the webhook still re-subscribes someone who had
// opted out and then says YES, since Twilio itself does).
const START_WORDS = ["START", "UNSTOP"];
const JOIN_WORDS = [TWILIO.joinKeyword, "JOIN FCB", "FCB"];

export type InboundKind = "join" | "start" | "stop" | "help" | "reply";

/** What kind of text this is, from its body. Only an exact keyword counts —
 *  "stop by Friday with 2 cases" is a reply, not an opt-out. */
export function classifyInbound(body: string): InboundKind {
  const word = body.trim().toUpperCase().replace(/[.!\s]+$/g, "").replace(/\s+/g, " ");
  if (STOP_WORDS.includes(word)) return "stop";
  if (HELP_WORDS.includes(word)) return "help";
  if (JOIN_WORDS.includes(word)) return "join";
  if (START_WORDS.includes(word)) return "start";
  return "reply";
}

/** US phone → E.164 (+1XXXXXXXXXX). Returns null if it isn't a 10-digit US number. */
export function toE164(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const digits = raw.replace(/\D/g, "");
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length === 11 && digits.startsWith("1")) return `+${digits}`;
  return null;
}

/** +15595551234 → (559) 555-1234 */
export function formatPhone(e164: string | null | undefined): string {
  const d = (e164 ?? "").replace(/\D/g, "").replace(/^1(?=\d{10}$)/, "");
  if (d.length !== 10) return e164 ?? "";
  return `(${d.slice(0, 3)}) ${d.slice(3, 6)}-${d.slice(6)}`;
}

/** TwiML reply. Empty message = "got it, don't text back". */
export function twiml(message?: string): Response {
  const esc = (s: string) =>
    s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  const xml = message
    ? `<?xml version="1.0" encoding="UTF-8"?><Response><Message>${esc(message)}</Message></Response>`
    : `<?xml version="1.0" encoding="UTF-8"?><Response></Response>`;
  return new Response(xml, { status: 200, headers: { "Content-Type": "text/xml" } });
}

/** Checks Twilio's X-Twilio-Signature (HMAC-SHA1 of the full URL + the sorted
 *  form fields, keyed with the account's Auth Token). This is what proves a
 *  request really came from Twilio and not someone faking sign-ups. */
export function validTwilioSignature(
  authToken: string,
  signature: string | null,
  url: string,
  params: Record<string, string>,
): boolean {
  if (!signature) return false;
  const data = Object.keys(params)
    .sort()
    .reduce((acc, key) => acc + key + params[key], url);
  const expected = createHmac("sha1", authToken).update(Buffer.from(data, "utf-8")).digest("base64");
  const a = Buffer.from(expected);
  const b = Buffer.from(signature);
  return a.length === b.length && timingSafeEqual(a, b);
}

/** Finds the account a phone number belongs to: a contact's mobile/phone
 *  first, then the account's main phone. Returns null if none or more than
 *  one account matches (better to leave it for a person to link than guess). */
export async function matchAccount(
  supabase: SupabaseClient,
  e164: string,
): Promise<{ outlet_id: string; name: string | null; contact_name: string | null } | null> {
  const ten = e164.replace(/\D/g, "").slice(-10);
  // Phones are stored in whatever format the import had ("559-555-1234",
  // "(559) 555-1234", …) — match on the last 4 digits in the database, then
  // compare all 10 digits here.
  const last4 = ten.slice(-4);
  const same = (p: string | null) => !!p && p.replace(/\D/g, "").slice(-10) === ten;

  const { data: contacts } = await supabase
    .from("sales_account_contacts")
    .select("outlet_id, name, phone, mobile")
    .or(`mobile.ilike.%${last4},phone.ilike.%${last4}`)
    .limit(200);
  const contactHits = (contacts ?? []).filter((c) => same(c.mobile) || same(c.phone));
  const contactOutlets = [...new Set(contactHits.map((c) => c.outlet_id as string))];
  if (contactOutlets.length === 1) {
    const { data: acct } = await supabase
      .from("sales_accounts")
      .select("outlet_id, name")
      .eq("outlet_id", contactOutlets[0])
      .maybeSingle();
    return { outlet_id: contactOutlets[0], name: acct?.name ?? null, contact_name: contactHits[0]?.name ?? null };
  }
  if (contactOutlets.length > 1) return null;

  const { data: accounts } = await supabase
    .from("sales_accounts")
    .select("outlet_id, name, phone")
    .ilike("phone", `%${last4}`)
    .limit(200);
  const acctHits = (accounts ?? []).filter((a) => same(a.phone));
  if (acctHits.length === 1) return { outlet_id: acctHits[0].outlet_id, name: acctHits[0].name, contact_name: null };
  return null;
}

/** Sends one text through the "FCB New Items" messaging service. Returns the
 *  Twilio message SID, or null if Twilio isn't set up yet / the send failed
 *  (texts to US numbers are blocked by the carriers until the A2P campaign is
 *  approved — a failure here is expected before then).
 *  Env: TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_MESSAGING_SERVICE_SID. */
export async function sendSms(to: string, body: string): Promise<string | null> {
  const sid = process.env.TWILIO_ACCOUNT_SID;
  const token = process.env.TWILIO_AUTH_TOKEN;
  const service = process.env.TWILIO_MESSAGING_SERVICE_SID;
  if (!sid || !token || !service) return null;
  try {
    const res = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`, {
      method: "POST",
      headers: {
        Authorization: `Basic ${Buffer.from(`${sid}:${token}`).toString("base64")}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({ To: to, MessagingServiceSid: service, Body: body }),
    });
    const json = (await res.json()) as { sid?: string; message?: string };
    if (!res.ok) {
      console.error("[twilio] send failed", res.status, json.message);
      return null;
    }
    return json.sid ?? null;
  } catch (err) {
    console.error("[twilio] send failed", err);
    return null;
  }
}
