import { createAdminClient } from "@/lib/supabase/admin";
import { verifyUnsubscribe } from "@/lib/email/unsubscribe";

// Unsubscribe (added 2026-10-30). Public — no login (exempt in proxy.ts).
// Two callers, same result:
//   * Gmail/Yahoo/Apple "Unsubscribe" buttons (one-click, RFC 8058): POST to
//     the List-Unsubscribe header URL with ?e=…&s=… in the address.
//   * Our /email/unsubscribe page's button: POST with the same e/s.
// The e/s pair is signed (lib/email/unsubscribe.ts), so nobody can
// unsubscribe someone else. Adds them to the do-not-email list.
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const url = new URL(request.url);
  let e = url.searchParams.get("e");
  let s = url.searchParams.get("s");
  if (!e || !s) {
    try {
      const j = (await request.clone().json()) as { e?: string; s?: string };
      e = j.e ?? null;
      s = j.s ?? null;
    } catch {
      // one-click posts a form body; e/s come from the URL
    }
  }
  const email = verifyUnsubscribe(e, s);
  if (!email) return Response.json({ error: "That unsubscribe link isn't valid." }, { status: 400 });

  const admin = createAdminClient();
  await admin
    .from("email_suppressions")
    .upsert({ email, reason: "unsubscribed", source: "unsubscribe link" }, { onConflict: "email", ignoreDuplicates: true });
  // Mark their most recent send as the one they unsubscribed from.
  const { data: last } = await admin
    .from("email_sends")
    .select("id")
    .eq("email", email)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (last) await admin.from("email_sends").update({ unsubscribed_at: new Date().toISOString() }).eq("id", last.id).is("unsubscribed_at", null);

  return Response.json({ ok: true, email });
}
