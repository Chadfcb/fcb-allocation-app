import { createAdminClient } from "@/lib/supabase/admin";
import {
  TWILIO,
  AGE_DENIED,
  AGE_MAX_ASKS,
  AGE_QUESTION,
  AGE_RETRY,
  JOIN_CONFIRMATION,
  MIN_TEXT_AGE,
  ageFromText,
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
// What it does (21+ age step added 2026-11-13 for the new campaign — the
// carriers require an age check in every way to sign up):
//   JOIN / START / UNSTOP → if they've already confirmed they're 21+, signs
//                    them (back) up right away. Otherwise they're NOT signed
//                    up yet: status "pending_age" and we text back asking
//                    for their birth date.
//   birth date reply (while pending_age) → 21+: signed up (opted_in) + the
//                    confirmation text. Under 21: "under_21", "Sorry" text,
//                    never signed up from that number. Not a date: asked
//                    again, up to 3 times in a row (so an auto-reply can't loop).
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
    .select("id, status, outlet_id, age_verified_at, age_asks")
    .eq("phone", from)
    .maybeSingle();

  let contactId: string | null = existing?.id ?? null;
  let reply: string | undefined;
  let replyKind = "signup_confirm";
  let logKind: string = kind;
  // A "yes" from someone who had opted out re-subscribes them (Twilio treats
  // YES as a re-subscribe word too); a "yes" from anyone else is a reply.
  const resubscribeYes = kind === "reply" && existing?.status === "opted_out" && /^\s*yes\W*$/i.test(body);
  const keyword = body.trim().toUpperCase().slice(0, 40);

  try {
    if (kind === "join" || kind === "start" || resubscribeYes) {
      if (resubscribeYes) logKind = "start";
      if (existing?.status === "under_21") {
        // Already told us they're under 21 — never sign this number up.
        if (kind === "join") {
          reply = AGE_DENIED;
          replyKind = "age_denied";
        }
      } else if (existing?.age_verified_at) {
        // Already confirmed 21+ before — straight back in.
        await supabase
          .from("sms_contacts")
          .update({
            status: "opted_in",
            opt_in_method: "keyword",
            opt_in_keyword: keyword,
            opt_in_at: now,
            consent_text: JOIN_CONFIRMATION,
            opt_out_at: null,
            opt_out_keyword: null,
            age_asks: 0,
            updated_at: now,
          })
          .eq("id", existing.id);
        // Only JOIN gets our confirmation — Twilio already answers START / YES.
        if (kind === "join") reply = JOIN_CONFIRMATION;
      } else {
        // Not signed up yet — ask for their birth date first.
        const fields = {
          status: "pending_age",
          opt_in_method: "keyword",
          opt_in_keyword: keyword,
          opt_in_at: null,
          consent_text: null,
          opt_out_at: null,
          opt_out_keyword: null,
          age_asks: 1,
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
        reply = AGE_QUESTION;
        replyKind = "age_question";
      }
    } else if (kind === "stop") {
      if (existing) {
        await supabase
          .from("sms_contacts")
          .update({ status: "opted_out", opt_out_at: now, opt_out_keyword: keyword, age_asks: 0, updated_at: now })
          .eq("id", existing.id);
      } else {
        // Never signed up but said STOP — keep a record so they're never texted.
        const { data: created } = await supabase
          .from("sms_contacts")
          .insert({ phone: from, status: "opted_out", opt_out_at: now, opt_out_keyword: keyword })
          .select("id")
          .single();
        contactId = created?.id ?? null;
      }
    } else if (kind === "reply" && existing?.status === "pending_age") {
      // Their answer to "reply with your birth date".
      const age = ageFromText(body);
      if (age === null) {
        logKind = "age_unreadable";
        const asks = (existing.age_asks ?? 0) + 1;
        if ((existing.age_asks ?? 0) < AGE_MAX_ASKS) {
          await supabase.from("sms_contacts").update({ age_asks: asks, updated_at: now }).eq("id", existing.id);
          reply = AGE_RETRY;
          replyKind = "age_question";
        }
      } else if (age >= MIN_TEXT_AGE) {
        logKind = "age_ok";
        await supabase
          .from("sms_contacts")
          .update({
            status: "opted_in",
            opt_in_at: now,
            consent_text: JOIN_CONFIRMATION,
            age_verified_at: now,
            age_method: "keyword",
            age_asks: 0,
            updated_at: now,
          })
          .eq("id", existing.id);
        reply = JOIN_CONFIRMATION;
      } else {
        logKind = "age_under";
        await supabase
          .from("sms_contacts")
          .update({ status: "under_21", opt_in_at: null, consent_text: null, age_asks: 0, updated_at: now })
          .eq("id", existing.id);
        reply = AGE_DENIED;
        replyKind = "age_denied";
      }
    }

    await supabase.from("sms_messages").insert({
      direction: "inbound",
      from_phone: from,
      to_phone: to,
      body,
      twilio_sid: params.MessageSid ?? null,
      kind: logKind,
      contact_id: contactId,
    });

    if (reply) {
      await supabase.from("sms_messages").insert({
        direction: "outbound",
        from_phone: to,
        to_phone: from,
        body: reply,
        kind: replyKind,
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
