import { createAdminClient } from "@/lib/supabase/admin";
import {
  TWILIO,
  JOIN_CONFIRMATION,
  classifyInbound,
  matchAccount,
  toE164,
  twiml,
  validTwilioSignature,
} from "@/lib/twilio";

// Twilio's "A message comes in" webhook for (559) 478-0269 (added
// 2026-10-29, per Chad). Twilio has no login session, so this route is
// exempt from the sign-in redirect in proxy.ts — instead it checks Twilio's
// own signature (TWILIO_AUTH_TOKEN) before doing anything.
//
// What it does today:
//   JOIN           → adds / re-subscribes them as opted_in (method "keyword"),
//                    links the account when the phone matches one, and texts
//                    back the confirmation (the wording Twilio registered).
//   START / UNSTOP → re-subscribes (Twilio sends its own reply).
//   STOP & co.     → marks them opted_out (Twilio blocks + replies itself).
//   HELP           → logged only (Twilio sends the HELP reply).
//   anything else  → logged as a reply. Forwarding replies to the account's
//                    rep is the next phase — not built yet.
//
// Every incoming text is saved in sms_messages either way.
//
// Setup (Vercel env vars):
//   TWILIO_AUTH_TOKEN   — required. From the Twilio Console home page.
//   TWILIO_WEBHOOK_URL  — optional. The exact URL entered in Twilio, if it
//                         differs from what this server sees (it shouldn't on
//                         Vercel: https://www.fcb-data.com/api/twilio/incoming).
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const authToken = process.env.TWILIO_AUTH_TOKEN;
  if (!authToken) {
    console.error("[twilio/incoming] TWILIO_AUTH_TOKEN is not set");
    return new Response("Not configured", { status: 503 });
  }

  const form = await request.formData();
  const params: Record<string, string> = {};
  form.forEach((value, key) => {
    if (typeof value === "string") params[key] = value;
  });

  const url = process.env.TWILIO_WEBHOOK_URL || request.url;
  if (!validTwilioSignature(authToken, request.headers.get("x-twilio-signature"), url, params)) {
    console.warn("[twilio/incoming] bad signature for", url);
    return new Response("Forbidden", { status: 403 });
  }

  const from = toE164(params.From) ?? params.From ?? "";
  const to = params.To ?? TWILIO.number;
  const body = params.Body ?? "";
  const kind = classifyInbound(body);
  const now = new Date().toISOString();
  const supabase = createAdminClient();

  const { data: existing } = await supabase
    .from("sms_contacts")
    .select("id, status, outlet_id")
    .eq("phone", from)
    .maybeSingle();

  let contactId: string | null = existing?.id ?? null;
  let reply: string | undefined;
  // A "yes" from someone who had opted out re-subscribes them (Twilio treats
  // YES as a re-subscribe word too); a "yes" from anyone else is a reply.
  const resubscribeYes = kind === "reply" && existing?.status === "opted_out" && /^\s*yes\W*$/i.test(body);

  try {
    if (kind === "join" || kind === "start" || resubscribeYes) {
      const fields = {
        status: "opted_in",
        opt_in_method: "keyword",
        opt_in_keyword: body.trim().toUpperCase().slice(0, 40),
        opt_in_at: now,
        consent_text: JOIN_CONFIRMATION,
        opt_out_at: null,
        opt_out_keyword: null,
        updated_at: now,
      };
      if (existing) {
        await supabase.from("sms_contacts").update(fields).eq("id", existing.id);
      } else {
        const match = await matchAccount(supabase, from);
        const { data: created } = await supabase
          .from("sms_contacts")
          .insert({
            phone: from,
            ...fields,
            outlet_id: match?.outlet_id ?? null,
            business: match?.name ?? null,
            name: match?.contact_name ?? null,
          })
          .select("id")
          .single();
        contactId = created?.id ?? null;
      }
      // Only JOIN gets our confirmation — Twilio already answers START / YES.
      if (kind === "join") reply = JOIN_CONFIRMATION;
    } else if (kind === "stop") {
      if (existing) {
        await supabase
          .from("sms_contacts")
          .update({ status: "opted_out", opt_out_at: now, opt_out_keyword: body.trim().toUpperCase().slice(0, 40), updated_at: now })
          .eq("id", existing.id);
      } else {
        // Never signed up but said STOP — keep a record so they're never texted.
        const { data: created } = await supabase
          .from("sms_contacts")
          .insert({ phone: from, status: "opted_out", opt_out_at: now, opt_out_keyword: body.trim().toUpperCase().slice(0, 40) })
          .select("id")
          .single();
        contactId = created?.id ?? null;
      }
    }

    await supabase.from("sms_messages").insert({
      direction: "inbound",
      from_phone: from,
      to_phone: to,
      body,
      twilio_sid: params.MessageSid ?? null,
      kind: resubscribeYes ? "start" : kind,
      contact_id: contactId,
    });

    if (reply) {
      await supabase.from("sms_messages").insert({
        direction: "outbound",
        from_phone: to,
        to_phone: from,
        body: reply,
        kind: "signup_confirm",
        contact_id: contactId,
      });
    }
  } catch (err) {
    // Still answer Twilio (and still confirm a JOIN) even if saving failed —
    // the error shows in Vercel's logs.
    console.error("[twilio/incoming] save failed", err);
  }

  return twiml(reply);
}
