import { createAdminClient } from "@/lib/supabase/admin";
import { emailStudioProfile } from "@/lib/email/studioAccess";
import { resolveAudience, type Audience } from "@/lib/email/audience";
import { buildEmailDocument, EMAIL_FROM_NAME } from "@/lib/email/studio";
import { gmailConfigured, UNSUB_PLACEHOLDER } from "@/lib/email/gmailSend";
import { estimateDays, inSendingHours, processEmailQueue } from "@/lib/email/queue";

// Email Studio → Send (added 2026-10-30; reworked the same day to send from
// ernie@ Gmail instead of SendGrid, per Chad: no separate paid service,
// "capped at 1800 a day"). This route only LINES THE EMAIL UP:
//   1. works out the recipients (do-not-email list always removed),
//   2. freezes a copy of the email as sent (email_campaigns),
//   3. records one row per recipient, waiting in line (email_sends),
//   4. if it's "send now" during sending hours, sends the first few right
//      away so the sender sees it working.
// The rest goes out in small batches every 5 minutes, 7am–6pm Pacific, up
// to 1,800 a day (lib/email/queue.ts, called by /api/email-studio/worker).
export const dynamic = "force-dynamic";
export const maxDuration = 120;

const MAX_RECIPIENTS = 20000;
const MAX_SCHEDULE_DAYS = 60;

export async function POST(request: Request) {
  const profile = await emailStudioProfile();
  if (!profile) return Response.json({ error: "No access" }, { status: 403 });
  if (!gmailConfigured()) {
    return Response.json({ error: "Email sending isn't connected (GMAIL_USER / GMAIL_APP_PASSWORD missing in Vercel)." }, { status: 503 });
  }

  let body: { designId?: string; audience?: Audience; fromName?: string; replyTo?: string; sendAt?: string | null; expectedCount?: number };
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Bad request" }, { status: 400 });
  }
  if (!body.designId || !body.audience) return Response.json({ error: "Missing email or audience" }, { status: 400 });

  let scheduledFor: string | null = null;
  if (body.sendAt) {
    const t = Date.parse(body.sendAt);
    if (Number.isNaN(t)) return Response.json({ error: "Bad schedule time" }, { status: 400 });
    if (t - Date.now() > MAX_SCHEDULE_DAYS * 86400000) {
      return Response.json({ error: `You can schedule up to ${MAX_SCHEDULE_DAYS} days ahead.` }, { status: 400 });
    }
    if (t - Date.now() > 60000) scheduledFor = new Date(t).toISOString();
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

  const subject = design.subject.trim();
  // Frozen copy; the placeholder becomes each person's own unsubscribe link at send time.
  const html = buildEmailDocument({ bodyHtml: design.html, subject, preheader: design.preheader, unsubscribeUrl: UNSUB_PLACEHOLDER });

  const { data: campaign, error: campErr } = await admin
    .from("email_campaigns")
    .insert({
      design_id: design.id,
      name: design.name,
      subject,
      preheader: design.preheader,
      from_name: body.fromName?.trim() || EMAIL_FROM_NAME,
      reply_to: body.replyTo?.trim() || null,
      html_snapshot: html,
      audience: body.audience,
      // Held as "scheduled" until every recipient is lined up, so the sender
      // can't start on half a list.
      status: "scheduled",
      scheduled_for: scheduledFor ?? new Date().toISOString(),
      recipient_count: recipients.length,
      created_by: profile.id,
    })
    .select("id")
    .single();
  if (campErr || !campaign) return Response.json({ error: `Couldn't start the send: ${campErr?.message}` }, { status: 500 });

  for (let i = 0; i < recipients.length; i += 1000) {
    const chunk = recipients.slice(i, i + 1000).map((r) => ({
      campaign_id: campaign.id,
      email: r.email,
      name: r.name,
      business: r.business,
      outlet_id: r.outlet_id,
      status: "queued",
    }));
    const { error } = await admin.from("email_sends").insert(chunk);
    if (error) {
      await admin.from("email_campaigns").update({ status: "failed", finished_at: new Date().toISOString() }).eq("id", campaign.id);
      return Response.json({ error: `Couldn't line up recipients: ${error.message}` }, { status: 500 });
    }
  }

  let firstBatch = 0;
  if (!scheduledFor) {
    await admin.from("email_campaigns").update({ status: "sending" }).eq("id", campaign.id);
    if (inSendingHours()) {
      const run = await processEmailQueue(admin);
      firstBatch = run.sent;
    }
  }

  return Response.json({
    ok: true,
    campaignId: campaign.id,
    status: scheduledFor ? "scheduled" : "sending",
    queued: recipients.length,
    firstBatch,
    days: estimateDays(recipients.length),
    inHours: inSendingHours(),
  });
}
