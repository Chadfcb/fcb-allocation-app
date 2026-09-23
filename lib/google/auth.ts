// Google service-account sign-in for FCB-Data (added 2026-09-23).
//
// The app talks to Google as its own "robot" Google account (a service
// account), never as any person. Each Google calendar/folder it should
// touch is shared with that robot's email address, the same way you'd
// share with a coworker. Two Vercel environment variables:
//   GOOGLE_SERVICE_ACCOUNT_EMAIL        e.g. fcb-data@<project>.iam.gserviceaccount.com
//   GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY  the "private_key" value from the key file
// No Google SDK needed — this signs the standard OAuth JWT with Node's own
// crypto and trades it for a short-lived access token.

import crypto from "node:crypto";

const TOKEN_URL = "https://oauth2.googleapis.com/token";

let cached: { scopeKey: string; token: string; expiresAt: number } | null = null;

function b64url(input: Buffer | string): string {
  return Buffer.from(input).toString("base64").replace(/=+$/, "").replace(/\+/g, "-").replace(/\//g, "_");
}

export function googleCredentialsConfigured(): boolean {
  return !!(process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL && process.env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY);
}

export function googleServiceAccountEmail(): string | null {
  return process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL?.trim() || null;
}

export async function getGoogleAccessToken(scopes: string[]): Promise<string> {
  const email = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL?.trim();
  // Vercel stores multi-line values fine, but a pasted key sometimes comes
  // through with literal "\n" sequences — normalize either way.
  const rawKey = process.env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY;
  if (!email || !rawKey) {
    throw new Error("Google isn't connected yet — the service account key hasn't been added in Vercel.");
  }
  const privateKey = rawKey.replace(/\\n/g, "\n").replace(/^"|"$/g, "").trim();

  const scopeKey = scopes.slice().sort().join(" ");
  if (cached && cached.scopeKey === scopeKey && cached.expiresAt > Date.now() + 60_000) {
    return cached.token;
  }

  const now = Math.floor(Date.now() / 1000);
  const header = b64url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const claims = b64url(
    JSON.stringify({ iss: email, scope: scopeKey, aud: TOKEN_URL, iat: now, exp: now + 3600 }),
  );
  const signer = crypto.createSign("RSA-SHA256");
  signer.update(`${header}.${claims}`);
  const signature = b64url(signer.sign(privateKey));
  const assertion = `${header}.${claims}.${signature}`;

  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion }),
  });
  const data = (await res.json().catch(() => ({}))) as { access_token?: string; expires_in?: number; error_description?: string; error?: string };
  if (!res.ok || !data.access_token) {
    throw new Error(`Google sign-in failed: ${data.error_description || data.error || res.status}`);
  }
  cached = { scopeKey, token: data.access_token, expiresAt: Date.now() + (data.expires_in ?? 3600) * 1000 };
  return data.access_token;
}
