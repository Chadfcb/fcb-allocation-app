import { NextRequest, NextResponse } from "next/server";
import { getProfile } from "@/lib/getProfile";
import { hasSection } from "@/lib/permissions";
import { createAdminClient } from "@/lib/supabase/admin";
import { secretsMatch } from "@/lib/google/syncSecret";
import {
  FCB_GOOGLE_DOMAIN,
  GOOGLE_OAUTH_REDIRECT_URI,
  GOOGLE_OAUTH_SCOPES,
  clearGoogleTokenCache,
  oauthClientConfigured,
} from "@/lib/google/auth";

// Google sends the browser back here after "Connect Google". We check the
// anti-forgery state, trade the one-time code for a long-lived refresh
// token, confirm it's an FCB account, and store it server-only in
// google_oauth_connection. Then back to the Events page.
export async function GET(req: NextRequest) {
  const origin = new URL(GOOGLE_OAUTH_REDIRECT_URI).origin;
  const back = (status: string) => {
    const res = NextResponse.redirect(`${origin}/events?google=${status}`);
    res.cookies.delete({ name: "fcb_google_oauth_state", path: "/api/google-calendar/oauth" });
    return res;
  };

  const profile = await getProfile();
  if (!profile || profile.role !== "admin" || !hasSection(profile.role, profile.sections, "events_calendar")) {
    return back("not_allowed");
  }
  if (!oauthClientConfigured()) return back("missing_client");

  const url = req.nextUrl;
  if (url.searchParams.get("error")) return back("cancelled");
  const code = url.searchParams.get("code");
  if (!code || !secretsMatch(url.searchParams.get("state"), req.cookies.get("fcb_google_oauth_state")?.value)) {
    return back("bad_state");
  }

  const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code,
      client_id: process.env.GOOGLE_OAUTH_CLIENT_ID!.trim(),
      client_secret: process.env.GOOGLE_OAUTH_CLIENT_SECRET!.trim(),
      redirect_uri: GOOGLE_OAUTH_REDIRECT_URI,
      grant_type: "authorization_code",
    }),
  });
  const tokens = (await tokenRes.json().catch(() => ({}))) as {
    refresh_token?: string;
    id_token?: string;
    scope?: string;
    error?: string;
  };
  if (!tokenRes.ok || !tokens.id_token) {
    console.error("[google oauth callback] token exchange failed", tokens.error);
    return back("failed");
  }

  // The id_token came straight from Google over TLS in this request, so its
  // payload can be read directly.
  let email = "";
  try {
    const payload = JSON.parse(Buffer.from(tokens.id_token.split(".")[1], "base64url").toString("utf8")) as {
      email?: string;
      email_verified?: boolean;
    };
    if (payload.email_verified) email = (payload.email ?? "").toLowerCase();
  } catch {
    // fall through
  }
  if (!email.endsWith(`@${FCB_GOOGLE_DOMAIN}`)) return back("wrong_domain");

  const granted = (tokens.scope ?? "").split(" ");
  if (!granted.includes("https://www.googleapis.com/auth/calendar")) return back("missing_calendar_permission");

  const admin = createAdminClient();
  const { data: existing } = await admin
    .from("google_oauth_connection")
    .select("refresh_token")
    .eq("connection_key", "default")
    .maybeSingle();
  const refreshToken = tokens.refresh_token ?? (existing as { refresh_token?: string } | null)?.refresh_token;
  if (!refreshToken) return back("failed");

  const { error } = await admin.from("google_oauth_connection").upsert(
    {
      connection_key: "default",
      account_email: email,
      refresh_token: refreshToken,
      scopes: (tokens.scope ?? GOOGLE_OAUTH_SCOPES.join(" ")).slice(0, 1000),
      connected_by: profile.id,
      connected_at: new Date().toISOString(),
    },
    { onConflict: "connection_key" },
  );
  if (error) {
    console.error("[google oauth callback] save failed", error.message);
    return back("failed");
  }
  clearGoogleTokenCache();
  return back("connected");
}
