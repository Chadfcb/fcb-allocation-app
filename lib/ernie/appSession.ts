import { createClient } from "@supabase/supabase-js";
import { createServerClient } from "@supabase/ssr";
import { createAdminClient } from "@/lib/supabase/admin";

// ---------------------------------------------------------------------------
// Signing a person into FCB-Data from the server, for Ernie (added 2026-10-03).
//
// Used two ways:
//   1. Slack Ernie runs his data tools AS the person who @-mentioned him
//      (lib/ernie/slackUserSession.ts).
//   2. Ernie's browser opens FCB-Data pages signed in AS the person asking
//      (open_app_page in lib/ernie/tools.ts + lib/ernie/browser.ts), so he
//      reads exactly what that person would see on the page — every page,
//      including numbers the page works out on screen. Chad, 2026-10-03:
//      "i want him to be able to find anything in the app."
//
// How: Supabase's own Auth — admin.generateLink (type magiclink; NO email is
// sent) then verifyOtp with the hashed token — returns a normal session for
// that person, signed by the project's current JWT signing key. Nothing here
// uses the legacy HS256 secret (only a "previous key" in this project). The
// session never leaves the server / Ernie's own headless browser.
// ---------------------------------------------------------------------------

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SUPABASE_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

export interface UserSession {
  accessToken: string;
  refreshToken: string;
  expiresAtMs: number;
}

/** A fresh signed-in session for this FCB-Data user. Throws on failure. */
export async function createUserSession(userId: string): Promise<UserSession> {
  const admin = createAdminClient();
  const { data: userData, error: userErr } = await admin.auth.admin.getUserById(userId);
  const email = userData?.user?.email;
  if (userErr || !email) throw new Error(`no auth user/email for ${userId}: ${userErr?.message ?? "no email"}`);

  const { data: link, error: linkErr } = await admin.auth.admin.generateLink({ type: "magiclink", email });
  const tokenHash = link?.properties?.hashed_token;
  if (linkErr || !tokenHash) throw new Error(`generateLink failed: ${linkErr?.message ?? "no token"}`);

  const anon = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
  let { data: verified, error: verifyErr } = await anon.auth.verifyOtp({ type: "email", token_hash: tokenHash });
  if (verifyErr || !verified?.session) {
    // Older Auth servers only accept the "magiclink" type name here.
    ({ data: verified, error: verifyErr } = await anon.auth.verifyOtp({ type: "magiclink", token_hash: tokenHash }));
  }
  const session = verified?.session;
  if (verifyErr || !session?.access_token || !session.refresh_token) {
    throw new Error(`verifyOtp failed: ${verifyErr?.message ?? "no session"}`);
  }
  if (session.user?.id !== userId) throw new Error("signed-in user did not match the requested user");

  return {
    accessToken: session.access_token,
    refreshToken: session.refresh_token,
    expiresAtMs: (session.expires_at ?? Math.floor(Date.now() / 1000) + 3600) * 1000,
  };
}

export interface AppAuthCookie {
  name: string;
  value: string;
}

/**
 * The exact login cookie(s) the FCB-Data website uses for this session —
 * written by the same @supabase/ssr library the site itself uses, so the
 * format always matches (name, base64 encoding, splitting into chunks).
 */
export async function appAuthCookies(session: UserSession): Promise<AppAuthCookie[]> {
  const jar = new Map<string, string>();
  const ssr = createServerClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    cookies: {
      getAll() {
        return Array.from(jar, ([name, value]) => ({ name, value }));
      },
      setAll(list) {
        for (const { name, value } of list) {
          if (value) jar.set(name, value);
          else jar.delete(name);
        }
      },
    },
  });
  const { error } = await ssr.auth.setSession({
    access_token: session.accessToken,
    refresh_token: session.refreshToken,
  });
  if (error) throw new Error(`setSession failed: ${error.message}`);
  const cookies = Array.from(jar, ([name, value]) => ({ name, value })).filter((c) => c.name.includes("auth-token"));
  if (!cookies.length) throw new Error("no login cookie was produced");
  return cookies;
}
