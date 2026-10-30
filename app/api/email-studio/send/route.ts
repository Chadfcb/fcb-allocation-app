import { createAdminClient } from "@/lib/supabase/admin";
import { emailStudioProfile } from "@/lib/email/studioAccess";
import { resolveAudience, type Audience } from "@/lib/email/audience";
import { buildEmailDocument, htmlToText, EMAIL_FROM_NAME } from "@/lib/email/studio";
import { sendgridConfigured, sendgridSendBatch, UNSUB_PLACEHOLDER } from "@/lib/email/sendgrid";
import { unsubscribeOneClickUrl, unsubscribePageUrl } from "@/lib/email/unsubscribe";

// Email Studio → Send (added 2026-10-30, per Chad — email is the main
// new-item channel). Sends the SAVED version of a design to the chosen
// audience through SendGrid, from ernie@fullcirclebrewing.com:
//   1. works out the recipients (do-not-email list always removed),
//   2. freezes a copy of the email as sent (email_campaigns),
//   3. records one row per recipient (email_sends),
//   4. sends in batches of 500, each person with their own unsubscribe link,
//   5. SendGrid's Event Webhook (/api/email-studio/events) later fills in
//      delivered / opened / clicked / bounced.
// Optional sendAt (ISO time, up to 72 hours ahead) = SendGrid schedules it.
export const dynamic = "force-dynamic";
export const maxDuration = 300;

const BATCH = 500;
const MAX_RECIPIENTS = 20000;

export async function POST(request: Request) {
  const profile = await emailStudioProfile();
  if (!profile) return Response.json({ error: "No access" }, { status: 403 });
  if (!sendgridConfigured()) {
    return Response.json({ error: "SendGrid isn't connected yet — add SENDGRID_API_KEY in Vercel first." }, { status: 503 });
  }

  let body: { designId?: string; audience?: Audience; fromName?: string; replyTo?: string; sendAt?: string | null; expectedCount?: number };
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Bad request" }, { status: 400 });
  }
  if (!body.designId || !body.audience) return Response.json({ error: "Missing email or audience" }, { status: 400 });

  let sendAtUnix: number | null = null;
  if (body.sendAt) {
    const t = Date.parse(body.sendAt);
    if (Number.isNaN(t)) return Response.json({ error: "Bad schedule time" }, { status: 400 });
    const ahead = t - Date.now();
    if (ahead > 72 * 3600 * 1000) return Response.json({ error: "You can schedule up to 72 hours ahead." }, { status: 400 });
    if (ahead > 60 * 1000) sendAtUnix = Math.floor(t / 1000);
  }

  const admin = createAdminClient();
  const { data: design } = await admin
    .from("email_designs")
    .select("id, name, subject, preheader, html")
    .eq("id", body.designId)
    .maybeSingle();
  if (!design) return Response.json({ error: "Email not found" }, { status: 404 });
  if (!design.html) return Response.json({ error: "Save the email first." }, { status: 400 });
  if (!design.subject?.trim()) return Response.json({ error: "Add a subject line first." }, { status: 400 });

  const { recipients } = await resolveAudience(admin, body.audience);
  if (recipients.length === 0) return Response.json({ error: "Nobody to send to with that audience." }, { status: 400 });
  if (recipients.length > MAX_RECIPIENTS) {
    return Response.json({ error: `That's ${recipients.length} people — the limit per send is ${MAX_RECIPIENTS}.` }, { status: 400 });
  }
  // Guard against sending to a different list than the one confirmed on screen.
  if (typeof body.expectedCount === "number" && body.expectedCount !== recipients.length) {
    return Response.json(
      { error: `The recipient count changed (${body.expectedCount} → ${recipients.length}). Check the audience again and resend.` },
      { status: 409 },
    );
  }

  const fromName = body.fromName?.trim() || EMAIL_FROM_NAME;
  const replyTo = body.replyTo?.trim() || null;
  const subject = design.subject.trim();
  const html = buildEmailDocument({ bodyHtml: design.html, subject, preheader: design.preheader, unsubscribeUrl: UNSUB_PLACEHOLDER });
  // The placeholder stays in both versions; SendGrid swaps in each person's link.
  const text = htmlToText(html);

  const { data: campaign, error: campErr } = await admin
    .from("email_campaigns")
    .insert({
      design_id: design.id,
      name: design.name,
      subject,
      preheader: design.preheader,
      from_name: fromName,
      reply_to: replyTo,
      html_snapshot: html,
      audience: body.audience,
      status: sendAtUnix ? "scheduled" : "sending",
      scheduled_for: sendAtUnix ? new Date(sendAtUnix * 1000).toISOString() : null,
      recipient_count: recipients.length,
      created_by: profile.id,
    })
    .select("id")
    .single();
  if (campErr || !campaign) return Response.json({ error: `Couldn't start the send: ${campErr?.message}` }, { status: 500 });

  // One row per recipient (their id goes to SendGrid so events match back).
  const sendRows: { id: string; email: string; name: string | null }[] = [];
  for (let i = 0; i < recipients.length; i += 1000) {
    const chunk = recipients.slice(i, i + 1000).map((r) => ({
      campaign_id: campaign.id,
      email: r.email,
      name: r.name,
      business: r.business,
      outlet_id: r.outlet_id,
    }));
    const { data, error } = await admin.from("email_sends").insert(chunk).select("id, email, name");
    if (error) {
      await admin.from("email_campaigns").update({ status: "failed", finished_at: new Date().toISOString() }).eq("id", campaign.id);
      return Response.json({ error: `Couldn't record recipients: ${error.message}` }, { status: 500 });
    }
    sendRows.push(...(data ?? []));
  }

  let sent = 0;
  let failed = 0;
  const errors: string[] = [];
  for (let i = 0; i < sendRows.length; i += BATCH) {
    const batch = sendRows.slice(i, i + BATCH);
    const result = await sendgridSendBatch({
      recipients: batch.map((r) => ({
        email: r.email,
        name: r.name,
        sendId: r.id,
        campaignId: campaign.id,
        unsubscribePageUrl: unsubscribePageUrl(r.email),
        oneClickUrl: unsubscribeOneClickUrl(r.email),
      })),
      subject,
      html,
      text,
      fromName,
      replyTo,
      sendAt: sendAtUnix,
    });
    const ids = batch.map((r) => r.id);
    if (result.ok) {
      sent += batch.length;
      await admin.from("email_sends").update({ status: "accepted", sg_message_id: result.messageId }).in("id", ids);
    } else {
      failed += batch.length;
      errors.push(result.error);
      await admin.from("email_sends").update({ status: "failed", error: result.error.slice(0, 500) }).in("id", ids);
    }
  }

  const status = failed === 0 ? (sendAtUnix ? "scheduled" : "sent") : sent === 0 ? "failed" : "partial";
  await admin
    .from("email_campaigns")
    .update({ status, sent_count: sent, failed_count: failed, finished_at: new Date().toISOString() })
    .eq("id", campaign.id);

  return Response.json({ ok: failed === 0, campaignId: campaign.id, sent, failed, status, error: errors[0] ?? null });
}
