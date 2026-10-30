import { createAdminClient } from "@/lib/supabase/admin";

// Open tracking pixel for Email Studio sends (added 2026-10-30). Public (no
// login — exempt in proxy.ts). Returns a 1×1 transparent GIF and records the
// first time this email's images were loaded. ?s = the email_sends row id.
export const dynamic = "force-dynamic";

const GIF = Buffer.from("R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7", "base64");
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function GET(request: Request) {
  const s = new URL(request.url).searchParams.get("s");
  if (s && UUID.test(s)) {
    try {
      await createAdminClient().from("email_sends").update({ opened_at: new Date().toISOString() }).eq("id", s).is("opened_at", null);
    } catch {
      // never break the image
    }
  }
  return new Response(GIF, {
    headers: { "Content-Type": "image/gif", "Cache-Control": "no-store, no-cache, must-revalidate, max-age=0" },
  });
}
