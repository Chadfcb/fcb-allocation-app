import { createAdminClient } from "@/lib/supabase/admin";
import { JOIN_CONFIRMATION, MIN_TEXT_AGE, TWILIO, WEB_CONSENT_TEXT, ageFromParts, matchAccount, sendSms, toE164 } from "@/lib/twilio";

// Public text sign-up form (/sms-signup) posts here — added 2026-10-29, per
// Chad. The backup to text-to-join. No login (buyers aren't app users), so
// it's exempt from the sign-in redirect in proxy.ts. Saves the consent
// record with the service role (nobody in the app can insert sign-ups), then
// sends the same confirmation text a JOIN gets.
// 21+ check (added 2026-11-13, for the new campaign): the form sends a birth
// date; it's checked again here so it can't be skipped. Under 21 → nothing is
// saved. The birth date itself isn't stored — only that age was confirmed and when.
export const dynamic = "force-dynamic";

const clean = (v: unknown, max: number) => (typeof v === "string" ? v.trim().slice(0, max) : "");

export async function POST(request: Request) {
  let data: Record<string, unknown>;
  try {
    data = (await request.json()) as Record<string, unknown>;
  } catch {
    return Response.json({ error: "Bad request" }, { status: 400 });
  }

  // Hidden field real people never fill in — quietly "succeed" for bots.
  if (clean(data.website, 200)) return Response.json({ ok: true });

  const name = clean(data.name, 120);
  const business = clean(data.business, 160);
  const rep = clean(data.rep, 120);
  const phone = toE164(clean(data.phone, 40));
  if (!name || !business) return Response.json({ error: "Please enter your name and business." }, { status: 400 });
  if (!phone) return Response.json({ error: "Please enter a 10-digit US mobile number." }, { status: 400 });
  const age = ageFromParts(data.dobMonth, data.dobDay, data.dobYear);
  if (age === null) return Response.json({ error: "Please enter your full birth date (MM / DD / YYYY)." }, { status: 400 });
  if (age < MIN_TEXT_AGE) {
    return Response.json({ error: "Sorry, you must be 21 or older to sign up for our texts." }, { status: 400 });
  }
  if (data.consent !== true) {
    return Response.json({ error: "Please check the box to agree to receive texts." }, { status: 400 });
  }

  const supabase = createAdminClient();
  const now = new Date().toISOString();
  const { data: existing } = await supabase.from("sms_contacts").select("id, outlet_id, status").eq("phone", phone).maybeSingle();
  // This number already told us (by text) that they're under 21.
  if (existing?.status === "under_21") {
    return Response.json({ error: "Sorry, this number can't be signed up for our texts." }, { status: 400 });
  }

  const fields = {
    name,
    business,
    rep_name: rep || null,
    status: "opted_in",
    opt_in_method: "web_form",
    opt_in_keyword: null,
    opt_in_at: now,
    consent_text: WEB_CONSENT_TEXT,
    opt_out_at: null,
    opt_out_keyword: null,
    age_verified_at: now,
    age_method: "web_form",
    age_asks: 0,
    updated_at: now,
  };

  let contactId: string | null = existing?.id ?? null;
  if (existing) {
    const { error } = await supabase.from("sms_contacts").update(fields).eq("id", existing.id);
    if (error) return Response.json({ error: "Something went wrong. Please try again." }, { status: 500 });
  } else {
    const match = await matchAccount(supabase, phone);
    const { data: created, error } = await supabase
      .from("sms_contacts")
      .insert({ phone, ...fields, outlet_id: match?.outlet_id ?? null })
      .select("id")
      .single();
    if (error) return Response.json({ error: "Something went wrong. Please try again." }, { status: 500 });
    contactId = created?.id ?? null;
  }

  const sid = await sendSms(phone, JOIN_CONFIRMATION);
  await supabase.from("sms_messages").insert({
    direction: "outbound",
    from_phone: TWILIO.number,
    to_phone: phone,
    body: JOIN_CONFIRMATION,
    twilio_sid: sid,
    kind: "signup_confirm",
    contact_id: contactId,
  });

  return Response.json({ ok: true });
}
