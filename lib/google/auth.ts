// Google sign-in for FCB-Data (added 2026-09-23).
//
// PRIMARY: the app acts as Ernie's own Google account
// (ernie@fullcirclebrewing.com). Someone signs in as ernie@ once via
// "Connect Google" on the Events page (app/api/google-calendar/oauth/*);
// the long-lived refresh token is stored server-only in
// google_oauth_connection (sql/google_oauth_connection.sql) and traded for
// short-lived access tokens here. Needs Vercel env vars
//   GOOGLE_OAUTH_CLIENT_ID / GOOGLE_OAUTH_CLIENT_SECRET
// (the "FCB-Data web" OAuth client in the FCB-Data Google Cloud project).
// Why not the service account: FCB's Workspace blocks giving outside
// addresses (…@iam.gserviceaccount.com) calendar edit access, and changing
// that needs a Super Admin. Ernie's account is a normal FCB account.
//
// FALLBACK: a service account (GOOGLE_SERVICE_ACCOUNT_EMAIL /
// GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY), used only if those are set and no
// Ernie connection exists. Kept so it can be switched to later if a Super
// Admin ever allows it.

import crypto from "node:crypto";
import { createAdminClient } from "@/lib/supabase/admin";

const TOKEN_URL = "https://oauth2.googleapis.com/token";

export const GOOGLE_OAUTH_REDIRECT_URI = "https://www.fcb-data.com/api/google-calendar/oauth/callback";
export const ERNIE_GOOGLE_ACCOUNT = "ernie@fullcirclebrewing.com";
export const FCB_GOOGLE_DOMAIN = "fullcirclebrewing.com";
// Calendar now; drive.file (only files the app itself creates) is asked for
// up front so Ernie's Google Docs/Sheets ability later won't need a
// reconnect.
export const GOOGLE_OAUTH_SCOPES = [
  "openid",
  "email",
  "https://www.googleapis.com/auth/calendar",
  "https://www.googleapis.com/auth/drive.file",
];

let cached: { key: string; token: string; expiresAt: number } | null = null;

function b64url(input: Buffer | string): string {
  return Buffer.from(input).toString("base64").replace(/=+$/, "").replace(/\+/g, "-").replace(/\//g, "_");
}

export function oauthClientConfigured(): boolean {
  return !!(process.env.GOOGLE_OAUTH_CLIENT_ID && process.env.GOOGLE_OAUTH_CLIENT_SECRET);
}

function serviceAccountConfigured(): boolean {
  return !!(process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL && process.env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY);
}

export interface GoogleConnectionInfo {
  account_email: string;
  connected_at: string;
}

export async function getGoogleConnection(): Promise<(GoogleConnectionInfo & { refresh_token: string }) | null> {
  const admin = createAdminClient();
  const { data } = await admin
    .from("google_oauth_connection")
    .select("account_email, refresh_token, connected_at")
    .eq("connection_key", "default")
    .maybeSingle();
  return (data as (GoogleConnectionInfo & { refresh_token: string }) | null) ?? null;
}

// Is the app able to talk to Google at all right now?
export async function googleCredentialsConfigured(): Promise<boolean> {
  if (oauthClientConfigured() && (await getGoogleConnection())) return true;
  return serviceAccountConfigured();
}

export function googleServiceAccountEmail(): string | null {
  return process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL?.trim() || null;
}

async function tokenRequest(body: URLSearchParams): Promise<{ access_token: string; expires_in?: number }> {
  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body,
  });
  const data = (await res.json().catch(() => ({}))) as {
    access_token?: string;
    expires_in?: number;
    error?: string;
    error_description?: string;
  };
  if (!res.ok || !data.access_token) {
    if (data.error === "invalid_grant") {
      throw new Error("Google sign-in has expired or was removed — click Connect Google on the Events page and sign in as ernie@ again.");
    }
    throw new Error(`Google sign-in failed: ${data.error_description || data.error || res.status}`);
  }
  return { access_token: data.access_token, expires_in: data.expires_in };
}

export async function getGoogleAccessToken(scopes: string[]): Promise<string> {
  // 1. Ernie's connected account.
  if (oauthClientConfigured()) {
    const conn = await getGoogleConnection();
    if (conn) {
      const key = `oauth:${conn.account_email}`;
      if (cached && cached.key === key && cached.expiresAt > Date.now() + 60_000) return cached.token;
      const data = await tokenRequest(
        new URLSearchParams({
          grant_type: "refresh_token",
          refresh_token: conn.refresh_token,
          client_id: process.env.GOOGLE_OAUTH_CLIENT_ID!.trim(),
          client_secret: process.env.GOOGLE_OAUTH_CLIENT_SECRET!.trim(),
        }),
      );
      cached = { key, token: data.access_token, expiresAt: Date.now() + (data.expires_in ?? 3600) * 1000 };
      return data.access_token;
    }
  }

  // 2. Service account fallback.
  const email = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL?.trim();
  const rawKey = process.env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY;
  if (!email || !rawKey) {
    throw new Error("Google isn't connected yet — click Connect Google on the Events page and sign in as ernie@fullcirclebrewing.com.");
  }
  const privateKey = rawKey.replace(/\\n/g, "\n").replace(/^"|"$/g, "").trim();
  const scopeKey = scopes.slice().sort().join(" ");
  const key = `sa:${scopeKey}`;
  if (cached && cached.key === key && cached.expiresAt > Date.now() + 60_000) return cached.token;

  const now = Math.floor(Date.now() / 1000);
  const header = b64url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const claims = b64url(JSON.stringify({ iss: email, scope: scopeKey, aud: TOKEN_URL, iat: now, exp: now + 3600 }));
  const signer = crypto.createSign("RSA-SHA256");
  signer.update(`${header}.${claims}`);
  const assertion = `${header}.${claims}.${b64url(signer.sign(privateKey))}`;
  const data = await tokenRequest(new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion }));
  cached = { key, token: data.access_token, expiresAt: Date.now() + (data.expires_in ?? 3600) * 1000 };
  return data.access_token;
}

export function clearGoogleTokenCache() {
  cached = null;
}
