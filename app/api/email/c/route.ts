import { createAdminClient } from "@/lib/supabase/admin";
import { verifyClick } from "@/lib/email/tracking";

// Click tracking for Email Studio sends (added 2026-10-30). Public (no login
// — exempt in proxy.ts). Records the first click (and counts it as opened
// too, since images may have been blocked), then forwards to the real link.
// Links are signed (lib/email/tracking.ts), so this can't be used to send
// people to any other site.
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const sp = new URL(request.url).searchParams;
  const sendId = sp.get("s");
  const url = verifyClick(sendId, sp.get("u"), sp.get("k"));
  if (!url || !sendId) return new Response("That link isn't valid.", { status: 400 });

  try {
    const admin = createAdminClient();
    const now = new Date().toISOString();
    await admin.from("email_sends").update({ clicked_at: now }).eq("id", sendId).is("clicked_at", null);
    await admin.from("email_sends").update({ opened_at: now }).eq("id", sendId).is("opened_at", null);
  } catch {
    // still forward them
  }
  return Response.redirect(url, 302);
}
