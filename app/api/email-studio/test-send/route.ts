import { getProfile } from "@/lib/getProfile";
import { hasSection } from "@/lib/permissions";
import { createClient } from "@/lib/supabase/server";
import { sendMail } from "@/lib/email/sendMail";
import { buildEmailDocument, htmlToText } from "@/lib/email/studio";

// Email Studio → "Send a test" (added 2026-10-29). Sends the SAVED version of
// a design to the signed-in person's own email address only (never to
// anyone else), through ernie@fullcirclebrewing.com — the same Gmail path as
// the task reminders. Real sending to account lists is Phase 5.
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const profile = await getProfile();
  if (!profile || !hasSection(profile.role, profile.sections, "email_studio", profile.is_super_admin)) {
    return Response.json({ error: "No access" }, { status: 403 });
  }

  let designId = "";
  try {
    designId = String(((await request.json()) as { designId?: unknown }).designId ?? "");
  } catch {
    return Response.json({ error: "Bad request" }, { status: 400 });
  }
  if (!designId) return Response.json({ error: "Missing design" }, { status: 400 });

  const supabase = await createClient();
  const { data: design, error } = await supabase
    .from("email_designs")
    .select("name, subject, preheader, html")
    .eq("id", designId)
    .maybeSingle();
  if (error || !design) return Response.json({ error: "Design not found" }, { status: 404 });
  if (!design.html) return Response.json({ error: "Save the email first." }, { status: 400 });

  const subject = `[TEST] ${design.subject?.trim() || design.name}`;
  const html = buildEmailDocument({
    bodyHtml: design.html,
    subject,
    preheader: design.preheader,
    // Real per-recipient unsubscribe links come with Phase 5 sending.
    unsubscribeUrl: "https://www.fcb-data.com/",
  });

  try {
    await sendMail({ to: profile.email, subject, html, text: htmlToText(html) });
  } catch (err) {
    console.error("[email-studio/test-send]", err);
    return Response.json({ error: "Couldn't send the test email." }, { status: 500 });
  }
  return Response.json({ ok: true, to: profile.email });
}
