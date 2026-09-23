import crypto from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { getProfile } from "@/lib/getProfile";
import { hasSection } from "@/lib/permissions";
import {
  ERNIE_GOOGLE_ACCOUNT,
  FCB_GOOGLE_DOMAIN,
  GOOGLE_OAUTH_REDIRECT_URI,
  GOOGLE_OAUTH_SCOPES,
  oauthClientConfigured,
} from "@/lib/google/auth";

// "Connect Google" (Events page) — sends the browser to Google's sign-in,
// pre-filled with ernie@fullcirclebrewing.com. Administrators/Managers with
// Events Calendar access only. See lib/google/auth.ts for why the app acts
// as Ernie's account.
export async function GET(req: NextRequest) {
  const canonical = new URL(GOOGLE_OAUTH_REDIRECT_URI);
  // The anti-forgery cookie must live on the same host Google sends us back
  // to, so always start from www.fcb-data.com.
  if (req.nextUrl.host !== canonical.host && !req.nextUrl.hostname.startsWith("localhost")) {
    return NextResponse.redirect(`${canonical.origin}/api/google-calendar/oauth/start`);
  }

  const profile = await getProfile();
  if (!profile || profile.role !== "admin" || !hasSection(profile.role, profile.sections, "events_calendar")) {
    return NextResponse.redirect(`${canonical.origin}/events?google=not_allowed`);
  }
  if (!oauthClientConfigured()) {
    return NextResponse.redirect(`${canonical.origin}/events?google=missing_client`);
  }

  const state = crypto.randomBytes(24).toString("hex");
  const params = new URLSearchParams({
    client_id: process.env.GOOGLE_OAUTH_CLIENT_ID!.trim(),
    redirect_uri: GOOGLE_OAUTH_REDIRECT_URI,
    response_type: "code",
    scope: GOOGLE_OAUTH_SCOPES.join(" "),
    access_type: "offline",
    prompt: "consent select_account",
    include_granted_scopes: "true",
    login_hint: ERNIE_GOOGLE_ACCOUNT,
    hd: FCB_GOOGLE_DOMAIN,
    state,
  });
  const res = NextResponse.redirect(`https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`);
  res.cookies.set("fcb_google_oauth_state", state, {
    httpOnly: true,
    secure: true,
    sameSite: "lax",
    path: "/api/google-calendar/oauth",
    maxAge: 600,
  });
  return res;
}
