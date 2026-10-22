import type { Browser, HTTPRequest, Page } from "puppeteer-core";
import { launchBrowser } from "@/lib/ernie/browser";
import { snap, watchPage } from "@/lib/syncs/snapshots";

// LilyPad reader for the Automatic Syncs (Admin → Ekos Sync) — added
// 2026-10-16, per Chad ("start building the lilypad sync, checkins, all sales
// data"). Plan + findings: claude/lilypad-sync-plan.md.
//
// The app's server opens the same hidden Chromium the Ekos reader uses,
// signs into the LilyPad web app (lilypad.app.fintech.com, Auth0 sign-in)
// with LILYPAD_USERNAME / LILYPAD_PASSWORD — set by Chad in Vercel, never
// stored anywhere else — and then runs LilyPad's OWN exports, exactly the way
// the Export page does when you pick "Download Now" and press Submit:
//
//   1. POST /v6/exporttasks/invoices  (or /activity) → { export_id }
//   2. GET  <exports host>/v10/exporttask/runnow/<export_id>   (starts it)
//   3. poll the Export History (/v6/exporttasks/<kind>options) until that
//      report says Completed and has its download link
//   4. download the finished .xlsx file
//
// These are LilyPad's own web-app calls (read from the Export page,
// 2026-10-16, Chad signed in, looking only — nothing was submitted). Every
// call is made from inside the signed-in page, so it carries the same session
// the web app uses. Each run leaves one entry per export in LilyPad's Export
// History, named "FCB-Data sync …".
//
// READ-ONLY IN LILYPAD, enforced here: after sign-in, the only non-GET
// requests allowed to LilyPad are creating these two kinds of export. No
// edits, deletes, or anything else.

const APP_ORIGIN = "https://lilypad.app.fintech.com";
const API_ORIGIN = "https://lilypad-platform.app.fintech.com";
const EXPORTS_ORIGIN = "https://lilypad-exports.app.fintech.com";
const NAV_TIMEOUT_MS = 45_000;
const EXPORT_TIMEOUT_MS = 150_000;

const USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/139.0.0.0 Safari/537.36";

export type LilypadExportKind = "invoices" | "activity";

interface LilypadSession {
  browser: Browser;
  page: Page;
  orgId: string;
}

let current: Promise<LilypadSession> | null = null;

// One signed-in browser shared by both LilyPad sources in a run. A failed
// sign-in is remembered for the rest of the run so a wrong password can't
// trigger repeated attempts.
export function getLilypadSession(): Promise<LilypadSession> {
  if (!current) current = openSession();
  return current;
}

export async function closeLilypadSession(): Promise<void> {
  const s = current;
  current = null;
  if (!s) return;
  try {
    (await s).browser.close().catch(() => {});
  } catch {
    // never opened
  }
}

function isLilypadHost(host: string): boolean {
  return host.endsWith(".fintech.com") || host.endsWith(".auth0.com");
}

function isAllowedRequest(req: HTTPRequest, signedIn: boolean): boolean {
  let url: URL;
  try {
    url = new URL(req.url());
  } catch {
    return false;
  }
  if (url.protocol === "data:" || url.protocol === "blob:") return true;
  const method = req.method().toUpperCase();
  const isRead = method === "GET" || method === "HEAD" || method === "OPTIONS";
  if (isRead) return true;
  if (!isLilypadHost(url.hostname)) return false; // no tracking beacons
  // Signing in: Auth0's sign-in form and its session handshake.
  if (url.hostname.endsWith(".auth0.com") || url.hostname === "kong.app.fintech.com") return true;
  if (!signedIn && url.hostname === "lilypad.app.fintech.com") return true;
  // After sign-in: only creating the two exports this sync runs.
  if (
    signedIn &&
    url.hostname === "lilypad-platform.app.fintech.com" &&
    (url.pathname === "/v6/exporttasks/invoices" || url.pathname === "/v6/exporttasks/activity")
  ) {
    return true;
  }
  return false;
}

async function openSession(): Promise<LilypadSession> {
  const username = process.env.LILYPAD_USERNAME?.trim();
  const password = process.env.LILYPAD_PASSWORD;
  if (!username || !password) {
    throw new Error("LilyPad sign-in isn't set up: LILYPAD_USERNAME and LILYPAD_PASSWORD need to be added in Vercel.");
  }

  const browser = await launchBrowser();
  try {
    const page = (await browser.pages())[0] ?? (await browser.newPage());
    page.setDefaultNavigationTimeout(NAV_TIMEOUT_MS);
    page.setDefaultTimeout(NAV_TIMEOUT_MS);
    await page.setUserAgent(USER_AGENT);
    await page.setViewport({ width: 1568, height: 900 });

    let signedIn = false;
    await page.setRequestInterception(true);
    page.on("request", (req: HTTPRequest) => {
      if (!isAllowedRequest(req, signedIn)) {
        req.abort("blockedbyclient").catch(() => {});
        return;
      }
      req.continue().catch(() => {});
    });
    page.on("dialog", (d) => d.dismiss().catch(() => {}));
    watchPage(page);

    await page.goto(`${APP_ORIGIN}/`, { waitUntil: "networkidle2" });
    await snap(page, "LilyPad first page");

    // Already signed in? (shouldn't be — fresh browser — but cheap to check)
    if (!(await hasAppSession(page))) {
      // LilyPad may show its own page with a "Log in" button before Auth0.
      if (!(await findLoginField(page))) {
        await clickByText(page, /^(log ?in|sign ?in)$/i);
        await page.waitForNavigation({ waitUntil: "networkidle2" }).catch(() => null);
      }
      const userField = await waitForSelectorAny(page, USER_FIELDS, 20_000);
      if (!userField) {
        await snap(page, "LilyPad sign-in page not found");
        throw new Error(`LilyPad's sign-in page looks different than expected (${describeUrl(page)}) — the reader needs an update.`);
      }
      await page.$eval(userField, (el) => ((el as HTMLInputElement).value = ""));
      await page.type(userField, username, { delay: 20 });

      // Auth0 can ask for the email first, then the password on a second screen.
      let passField = await waitForSelectorAny(page, PASS_FIELDS, 1_500);
      if (!passField) {
        await submitForm(page);
        passField = await waitForSelectorAny(page, PASS_FIELDS, 15_000);
      }
      if (!passField) {
        await snap(page, "LilyPad password box not found");
        throw new Error(`LilyPad sign-in didn't show a password box (${describeUrl(page)}) — the reader needs an update.`);
      }
      await page.type(passField, password, { delay: 20 });
      await snap(page, "LilyPad sign-in filled (password hidden)");
      await Promise.all([
        page.waitForNavigation({ waitUntil: "networkidle2" }).catch(() => null),
        submitForm(page),
      ]);

      const deadline = Date.now() + 40_000;
      while (Date.now() < deadline && !(await hasAppSession(page))) await sleep(500);
      if (!(await hasAppSession(page))) {
        await snap(page, "LilyPad sign-in did not finish");
        const text = await pageText(page);
        if (/wrong (email|username) or password|incorrect|invalid/i.test(text)) {
          throw new Error("LilyPad sign-in failed — check LILYPAD_USERNAME / LILYPAD_PASSWORD in Vercel (password changed?).");
        }
        if (/verif|code|authenticator|captcha|robot/i.test(text)) {
          throw new Error(
            "LilyPad asked for an extra sign-in check (verification code / CAPTCHA). The sync's LilyPad user needs that turned off — tell Claude.",
          );
        }
        throw new Error(`LilyPad sign-in didn't finish (${describeUrl(page)}).`);
      }
    }
    signedIn = true;
    await snap(page, "LilyPad signed in");

    const orgId = await apiGet<{ organization?: string; organization_id?: string; org?: string }>(page, "/v6/users/me")
      .then((me) => findOrgId(me))
      .catch(() => null);
    if (!orgId) throw new Error("Signed into LilyPad but couldn't read the organization — the reader needs an update.");
    return { browser, page, orgId };
  } catch (err) {
    await browser.close().catch(() => {});
    throw err;
  }
}

const USER_FIELDS = ["input#username", "input[name='username']", "input[name='email']", "input[type='email']", "input#email"];
const PASS_FIELDS = ["input#password", "input[name='password']", "input[type='password']"];

async function findLoginField(page: Page): Promise<string | null> {
  for (const s of USER_FIELDS) if (await page.$(s)) return s;
  return null;
}

async function waitForSelectorAny(page: Page, selectors: string[], timeoutMs: number): Promise<string | null> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    for (const s of selectors) {
      const el = await page.$(s).catch(() => null);
      if (el && (await el.isVisible().catch(() => true))) return s;
    }
    await sleep(300);
  }
  return null;
}

async function submitForm(page: Page): Promise<void> {
  const btn =
    (await page.$("button[type='submit'][name='action']")) ??
    (await page.$("button[type='submit']")) ??
    (await page.$("input[type='submit']"));
  if (btn) {
    await btn.click().catch(() => {});
  } else {
    await page.keyboard.press("Enter").catch(() => {});
  }
}

async function clickByText(page: Page, re: RegExp): Promise<boolean> {
  const handles = await page.$$("button, a");
  for (const h of handles) {
    const t = ((await h.evaluate((el) => (el as HTMLElement).innerText || "").catch(() => "")) as string).trim();
    if (re.test(t)) {
      await h.click().catch(() => {});
      return true;
    }
  }
  return false;
}

async function hasAppSession(page: Page): Promise<boolean> {
  try {
    if (new URL(page.url()).hostname !== "lilypad.app.fintech.com") return false;
    return await page.evaluate(() => !!localStorage.getItem("auth_token"));
  } catch {
    return false;
  }
}

async function pageText(page: Page): Promise<string> {
  return page.evaluate(() => (document.body?.innerText || "").slice(0, 3000)).catch(() => "");
}

function describeUrl(page: Page): string {
  try {
    const u = new URL(page.url());
    return `${u.hostname}${u.pathname}`;
  } catch {
    return "unknown page";
  }
}

function findOrgId(me: unknown): string | null {
  // /v6/users/me — the organization id sits on the user record (field name
  // varies by LilyPad version, so look for the first 24-hex id under an
  // "organization"-ish key).
  const seen = new Set<unknown>();
  const walk = (v: unknown, key = ""): string | null => {
    if (!v || typeof v !== "object" || seen.has(v)) {
      if (typeof v === "string" && /org/i.test(key) && /^[a-f0-9]{24}$/i.test(v)) return v;
      return null;
    }
    seen.add(v);
    if (/org/i.test(key) && !Array.isArray(v)) {
      const id = (v as Record<string, unknown>)._id ?? (v as Record<string, unknown>).id;
      if (typeof id === "string" && /^[a-f0-9]{24}$/i.test(id)) return id;
    }
    for (const [k, child] of Object.entries(v as Record<string, unknown>)) {
      const r = walk(child, k);
      if (r) return r;
    }
    return null;
  };
  return walk(me);
}

// ---------------------------------------------------------------------------
// LilyPad API calls, made from inside the signed-in page (same session
// headers the web app sends: auth_token + acs_token from its localStorage).
// ---------------------------------------------------------------------------

async function apiCall<T>(page: Page, method: "GET" | "POST", url: string, body?: unknown): Promise<T> {
  const full = url.startsWith("http") ? url : `${API_ORIGIN}${url}`;
  const res = await page.evaluate(
    async (m: string, u: string, b: string | null) => {
      const headers: Record<string, string> = {
        auth_token: localStorage.getItem("auth_token") || "",
        acs_token: localStorage.getItem("acs_token") || "",
        Accept: "application/json, text/plain, */*",
      };
      if (b !== null) headers["Content-Type"] = "application/json";
      const r = await fetch(u, { method: m, headers, body: b ?? undefined });
      return { status: r.status, text: await r.text() };
    },
    method,
    full,
    body === undefined ? null : JSON.stringify(body),
  );
  if (res.status >= 400) {
    throw new Error(`LilyPad ${method} ${new URL(full).pathname} answered ${res.status}: ${res.text.slice(0, 200)}`);
  }
  try {
    return JSON.parse(res.text) as T;
  } catch {
    return res.text as unknown as T;
  }
}

function apiGet<T>(page: Page, url: string): Promise<T> {
  return apiCall<T>(page, "GET", url);
}

export interface LilypadDistributor {
  id: string;
  name: string;
}

export async function readLilypadDistributors(): Promise<LilypadDistributor[]> {
  const { page, orgId } = await getLilypadSession();
  const raw = await apiGet<unknown>(page, `/cgoods/${orgId}/distributors`);
  const list = Array.isArray(raw) ? raw : ((raw as { data?: unknown[] })?.data ?? []);
  return (list as Record<string, unknown>[])
    .map((d) => ({ id: String(d.id ?? d.external_Id ?? ""), name: String(d.Name ?? d.name ?? "") }))
    .filter((d) => d.id);
}

export interface LilypadActivityDef {
  id: string;
  name: string;
  fields: { name: string; label: string }[];
}

// Every activity type (Off Premise Visit, Phone Call, …) with its form fields.
export async function readLilypadActivityDefs(): Promise<LilypadActivityDef[]> {
  const { page, orgId } = await getLilypadSession();
  const raw = await apiGet<{ items?: { activity?: Record<string, unknown> }[] }>(page, `/v6/organization/${orgId}/activities`);
  return (raw.items ?? [])
    .map((i) => i.activity)
    .filter((a): a is Record<string, unknown> => !!a && typeof a._id === "string")
    .map((a) => {
      const form = (a.form as { fields?: Record<string, unknown>[] } | undefined)?.fields ?? [];
      return {
        id: a._id as string,
        name: String(a.name ?? ""),
        fields: form
          .filter((f) => f.active !== false && typeof f.name === "string")
          .map((f) => ({
            name: f.name as string,
            label: String(f.helperLabel ?? f.hintText ?? f.name).replace(/:\s*$/, "").trim(),
          })),
      };
    });
}

export async function readLilypadTeamsAndUsers(): Promise<{ teams: string[]; users: string[] }> {
  const { page, orgId } = await getLilypadSession();
  const org = await apiGet<Record<string, unknown>>(page, `/v6/organization/${orgId}`);
  const teams = ((org.teams as unknown[]) ?? [])
    .map((t) => (typeof t === "string" ? t : String((t as Record<string, unknown>)?._id ?? (t as Record<string, unknown>)?.id ?? "")))
    .filter(Boolean);
  const usersRaw = await apiGet<unknown>(page, `/v6/organization/${orgId}/allusers`).catch(() => []);
  const list = Array.isArray(usersRaw)
    ? usersRaw
    : ((usersRaw as { items?: unknown[]; data?: unknown[] })?.items ?? (usersRaw as { data?: unknown[] })?.data ?? []);
  const users = (list as Record<string, unknown>[])
    // The user's id lives in its _link block (no top-level _id on this list).
    .map((u) => String(u._id ?? u.id ?? (u._link as Record<string, unknown> | undefined)?.selecteduser ?? ""))
    .filter((id) => /^[a-f0-9]{24}$/i.test(id));
  return { teams, users };
}

// Maintenance routes (added 2026-10-22 — claude/maintenance-routes.md): each
// rep's LilyPad target lists and the accounts on them. GET calls only, the
// same ones the Export page makes when you pick Source = Target Accounts.
export interface LilypadUser {
  id: string;
  name: string;
  active: boolean;
}
export interface LilypadTargetList {
  id: string;
  name: string;
  accountCount: number;
}
export interface LilypadTargetAccount {
  outletId: string;
  name: string | null;
  city: string | null;
  distributor: string | null;
}

export async function readLilypadUsers(): Promise<LilypadUser[]> {
  const { page, orgId } = await getLilypadSession();
  const raw = await apiGet<unknown>(page, `/v6/organization/${orgId}/allusers`);
  const list = Array.isArray(raw) ? raw : ((raw as { items?: unknown[]; data?: unknown[] })?.items ?? (raw as { data?: unknown[] })?.data ?? []);
  return (list as Record<string, unknown>[])
    .map((u) => ({
      id: String(u._id ?? u.id ?? (u._link as Record<string, unknown> | undefined)?.selecteduser ?? ""),
      name: `${String(u.first_name ?? "").trim()} ${String(u.last_name ?? "").trim()}`.trim(),
      active: String(u.status ?? "active").toLowerCase() === "active",
    }))
    .filter((u) => /^[a-f0-9]{24}$/i.test(u.id) && u.name);
}

export async function readLilypadTargetLists(userId: string): Promise<LilypadTargetList[]> {
  const { page } = await getLilypadSession();
  const raw = await apiGet<unknown>(page, `/v6/worklist/${userId}/targets`);
  const list = Array.isArray(raw) ? raw : ((raw as { items?: unknown[]; data?: unknown[] })?.items ?? (raw as { data?: unknown[] })?.data ?? []);
  return (list as Record<string, unknown>[])
    .map((l) => ({ id: String(l._id ?? l.id ?? ""), name: String(l.name ?? "").trim(), accountCount: Number(l.accountcount ?? 0) || 0 }))
    .filter((l) => l.id && l.name);
}

export async function readLilypadTargetAccounts(listId: string): Promise<LilypadTargetAccount[]> {
  const { page } = await getLilypadSession();
  const raw = await apiGet<unknown>(page, `/v6/worklist/fetch/${listId}`);
  const list = Array.isArray(raw) ? raw : ((raw as { items?: unknown[]; data?: unknown[] })?.items ?? (raw as { data?: unknown[] })?.data ?? []);
  return (list as Record<string, unknown>[])
    .map((i) => {
      const acc = (i.account ?? {}) as Record<string, unknown>;
      const addr = (acc.address ?? {}) as Record<string, unknown>;
      const dist = (i.distributor ?? {}) as Record<string, unknown>;
      return {
        outletId: String(acc.id ?? "").trim(),
        name: acc.name ? String(acc.name) : null,
        city: addr.city ? String(addr.city) : null,
        distributor: dist.name ? String(dist.name) : null,
      };
    })
    .filter((a) => a.outletId);
}

// Unix seconds for midnight / end of day in Pacific time (the Export page's
// date picker works in the browser's local time — Chad's is Pacific).
export function pacificDayStartUnix(isoDate: string): number {
  return Math.floor(zonedMidnight(isoDate) / 1000);
}
export function pacificDayEndUnix(isoDate: string): number {
  return Math.floor(zonedMidnight(isoDate) / 1000) + 86_399;
}
function zonedMidnight(isoDate: string): number {
  const guess = Date.parse(`${isoDate}T00:00:00Z`);
  const offsetMin = pacificOffsetMinutes(new Date(guess + 12 * 3600_000));
  return guess + offsetMin * 60_000;
}
// Minutes Pacific is behind UTC (420 in summer, 480 in winter) — same sign as
// Date.getTimezoneOffset() in a Pacific browser.
export function pacificOffsetMinutes(at = new Date()): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Los_Angeles",
    timeZoneName: "shortOffset",
  }).formatToParts(at);
  const tz = parts.find((p) => p.type === "timeZoneName")?.value ?? "GMT-8";
  const m = tz.match(/GMT([+-])(\d+)(?::(\d+))?/);
  if (!m) return 480;
  const mins = Number(m[2]) * 60 + Number(m[3] ?? 0);
  return m[1] === "-" ? mins : -mins;
}
export function todayPacific(): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Los_Angeles" }).format(new Date());
}

const BASE_SETTINGS = {
  style: 1, // all in one sheet (invoices) / overridden for activities
  filetype: 1, // .xlsx ("Optimize for Excel, Sheets, Numbers")
  recepients: "link",
  emails: [] as string[],
  sendfrequency: 1, // Download Now
  senddate: "",
  sendtime: "",
  ftpsettings: { hostname: "", username: "", password: "" },
  recurrence: { recurring: "", time: "", datarange: "", weekday: "", monthday: "" },
};

/**
 * Runs one LilyPad export ("Download Now") and returns the finished .xlsx
 * file. `criteria` is the Export page's report settings for that kind.
 */
export async function runLilypadExport(
  kind: LilypadExportKind,
  description: string,
  criteria: Record<string, unknown>,
  extra: Record<string, unknown> = {},
): Promise<Buffer> {
  const { page } = await getLilypadSession();
  const posted = await apiCall<{ export_id?: string; _id?: string }>(page, "POST", `/v6/exporttasks/${kind}`, {
    criteria,
    ...BASE_SETTINGS,
    sendtime: timeHHMM(),
    description,
    ...extra,
  });
  const exportId = posted?.export_id ?? posted?._id;
  if (!exportId) throw new Error(`LilyPad didn't return an export id for the ${kind} export — the reader needs an update.`);

  // Start it (the Export page does exactly this right after Submit).
  await apiCall<string>(page, "GET", `${EXPORTS_ORIGIN}/v10/exporttask/runnow/${exportId}`).catch(() => "");

  const optionsPath = kind === "invoices" ? "/v6/exporttasks/invoiceoptions" : "/v6/exporttasks/activityoptions";
  const deadline = Date.now() + EXPORT_TIMEOUT_MS;
  let lastStatus = "not started";
  while (Date.now() < deadline) {
    await sleep(4_000);
    const opts = await apiGet<{ history?: { _id?: string; history?: { status?: string; downloadlink?: string }[] }[] }>(
      page,
      optionsPath,
    );
    const item = (opts.history ?? []).find((h) => h._id === exportId);
    const run = item?.history?.[0];
    lastStatus = run?.status ?? lastStatus;
    if (run?.downloadlink && /complete/i.test(run.status ?? "")) {
      const res = await fetch(run.downloadlink);
      if (!res.ok) throw new Error(`Couldn't download LilyPad's ${kind} file (${res.status}).`);
      return Buffer.from(await res.arrayBuffer());
    }
    if (/fail|error/i.test(run?.status ?? "")) throw new Error(`LilyPad's ${kind} export failed: ${run?.status}`);
  }
  throw new Error(`LilyPad's ${kind} export didn't finish in time (last status: ${lastStatus}).`);
}

function timeHHMM(): string {
  const d = new Date(Date.now() - pacificOffsetMinutes() * 60_000);
  const h = d.getUTCHours();
  return `${h > 9 ? h : "0" + h}:${d.getUTCMinutes()}`;
}

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}
