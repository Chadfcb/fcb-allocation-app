import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { createAdminClient } from "@/lib/supabase/admin";

// ---------------------------------------------------------------------------
// Ernie in Slack runs AS the person who @-mentioned him (added 2026-10-03).
//
// Why: Slack has no signed-in browser session, so Slack Ernie used to talk to
// the database with the service-role (master) key. That key ignores every
// Row Level Security rule, so his general search (run_read_only_query) and a
// few other tools had to be left out of Slack, and the search itself refused
// every time (ernie_readonly_query needs auth.uid(), which is empty under the
// master key — "the query tool is erroring"). Chad, 2026-10-03: "he needs
// access to everything, i cant be adding a new lookup everytime someone asks
// him to find something he has never found before."
//
// How: the server signs the mapped FCB-Data user in through Supabase's own
// Auth — admin.generateLink (no email is sent) + verifyOtp with the hashed
// token — and gets a normal session for that person, signed by the project's
// current JWT signing key. Ernie's tools then run with a client carrying that
// session, so the database applies that person's exact access, the same as
// on the website. The legacy HS256 secret is NOT used (it's only a "previous
// key" in this project and could be retired).
//
// The session lives only in server memory (never sent anywhere), reused until
// 5 minutes before it expires. If anything here fails, the caller falls back
// to the old master-key behavior with the old limited Slack tool list, so a
// sign-in problem can never make Ernie worse than before.
// ---------------------------------------------------------------------------

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SUPABASE_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

const sessionCache = new Map<string, { accessToken: string; expiresAtMs: number }>();
const REUSE_MARGIN_MS = 5 * 60 * 1000;

function plainClient(accessToken?: string): SupabaseClient {
  return createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    ...(accessToken ? { global: { headers: { Authorization: `Bearer ${accessToken}` } } } : {}),
  });
}

async function signInAs(
  admin: ReturnType<typeof createAdminClient>,
  userId: string,
): Promise<{ accessToken: string; expiresAtMs: number }> {
  const { data: userData, error: userErr } = await admin.auth.admin.getUserById(userId);
  const email = userData?.user?.email;
  if (userErr || !email) throw new Error(`no auth user/email for ${userId}: ${userErr?.message ?? "no email"}`);

  const { data: link, error: linkErr } = await admin.auth.admin.generateLink({ type: "magiclink", email });
  const tokenHash = link?.properties?.hashed_token;
  if (linkErr || !tokenHash) throw new Error(`generateLink failed: ${linkErr?.message ?? "no token"}`);

  const anon = plainClient();
  let { data: verified, error: verifyErr } = await anon.auth.verifyOtp({ type: "email", token_hash: tokenHash });
  if (verifyErr || !verified?.session) {
    // Older Auth servers only accept the "magiclink" type name here.
    ({ data: verified, error: verifyErr } = await anon.auth.verifyOtp({ type: "magiclink", token_hash: tokenHash }));
  }
  const session = verified?.session;
  if (verifyErr || !session?.access_token) throw new Error(`verifyOtp failed: ${verifyErr?.message ?? "no session"}`);
  if (session.user?.id !== userId) throw new Error("signed-in user did not match the mapped user");

  const expiresAtMs = (session.expires_at ?? Math.floor(Date.now() / 1000) + 3600) * 1000;
  return { accessToken: session.access_token, expiresAtMs };
}

/**
 * A Supabase client that acts as this FCB-Data user (their own access rules
 * apply), or null if signing them in failed — the caller then keeps the old
 * master-key behavior. Failures are logged as "[slack/events] user-session".
 */
export async function getSlackUserClient(
  admin: ReturnType<typeof createAdminClient>,
  userId: string,
): Promise<SupabaseClient | null> {
  try {
    let cached = sessionCache.get(userId);
    if (!cached || cached.expiresAtMs - REUSE_MARGIN_MS < Date.now()) {
      cached = await signInAs(admin, userId);
      sessionCache.set(userId, cached);
    }
    return plainClient(cached.accessToken);
  } catch (err) {
    sessionCache.delete(userId);
    console.error("[slack/events] user-session", err instanceof Error ? err.message : String(err));
    return null;
  }
}
