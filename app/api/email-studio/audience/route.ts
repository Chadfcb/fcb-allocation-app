import { createAdminClient } from "@/lib/supabase/admin";
import { emailStudioProfile } from "@/lib/email/studioAccess";
import { audienceOptions, resolveAudience, type Audience } from "@/lib/email/audience";
import { gmailConfigured, fromAddress } from "@/lib/email/gmailSend";
import { DAILY_CAP, sentToday } from "@/lib/email/queue";

// Email Studio → Send: the audience picker's options (GET) and a live
// recipient count + preview for a chosen audience (POST). Added 2026-10-30.
// Reads accounts with the server key after the Email Studio access check.
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET() {
  if (!(await emailStudioProfile())) return Response.json({ error: "No access" }, { status: 403 });
  try {
    const admin = createAdminClient();
    const opts = await audienceOptions(admin);
    return Response.json({
      ...opts,
      ready: gmailConfigured(),
      fromAddress: fromAddress(),
      dailyCap: DAILY_CAP,
      sentToday: await sentToday(admin),
    });
  } catch (err) {
    return Response.json({ error: err instanceof Error ? err.message : "Couldn't load options" }, { status: 500 });
  }
}

export async function POST(request: Request) {
  if (!(await emailStudioProfile())) return Response.json({ error: "No access" }, { status: 403 });
  let audience: Audience;
  try {
    audience = ((await request.json()) as { audience: Audience }).audience;
  } catch {
    return Response.json({ error: "Bad request" }, { status: 400 });
  }
  try {
    const result = await resolveAudience(createAdminClient(), audience);
    return Response.json({ counts: result.counts, sample: result.recipients.slice(0, 50) });
  } catch (err) {
    return Response.json({ error: err instanceof Error ? err.message : "Couldn't count recipients" }, { status: 500 });
  }
}
