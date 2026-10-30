import { createAdminClient } from "@/lib/supabase/admin";
import { emailStudioProfile } from "@/lib/email/studioAccess";

// Pause / resume / cancel a send that's still going out (added 2026-10-30).
// Emails already sent can't be pulled back; cancelling skips everyone still
// waiting.
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  if (!(await emailStudioProfile())) return Response.json({ error: "No access" }, { status: 403 });
  let body: { campaignId?: string; action?: "pause" | "resume" | "cancel" };
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Bad request" }, { status: 400 });
  }
  if (!body.campaignId || !body.action) return Response.json({ error: "Bad request" }, { status: 400 });

  const admin = createAdminClient();
  const { data: c } = await admin.from("email_campaigns").select("id, status, scheduled_for").eq("id", body.campaignId).maybeSingle();
  if (!c) return Response.json({ error: "Not found" }, { status: 404 });
  const open = ["scheduled", "sending", "paused"].includes(c.status);
  if (!open) return Response.json({ error: "That send is already finished." }, { status: 400 });

  if (body.action === "pause") {
    await admin.from("email_campaigns").update({ status: "paused" }).eq("id", c.id);
  } else if (body.action === "resume") {
    const future = c.scheduled_for && Date.parse(c.scheduled_for) > Date.now();
    await admin.from("email_campaigns").update({ status: future ? "scheduled" : "sending" }).eq("id", c.id);
  } else if (body.action === "cancel") {
    await admin.from("email_campaigns").update({ status: "cancelled", finished_at: new Date().toISOString() }).eq("id", c.id);
    await admin.from("email_sends").update({ status: "skipped", claimed_at: null }).eq("campaign_id", c.id).eq("status", "queued");
    const { data: st } = await admin.from("email_campaign_stats").select("accepted, failed").eq("campaign_id", c.id).maybeSingle();
    if (st) await admin.from("email_campaigns").update({ sent_count: st.accepted, failed_count: st.failed }).eq("id", c.id);
  } else {
    return Response.json({ error: "Bad request" }, { status: 400 });
  }
  return Response.json({ ok: true });
}
