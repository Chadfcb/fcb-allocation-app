// Ernie's own internal web browser (added 2026-09-23).
//
// Per Chad: Ernie should be able to "click around on websites and find data,
// not log in, or make posts or messages" — and must use his OWN browser,
// never anyone's personal Chrome. So this runs a real headless Chromium
// right here inside the Vercel function (via @sparticuz/chromium-min, a
// build of Chromium made for serverless), driven with puppeteer-core. No
// outside browsing service, no sign-up, no extra cost beyond normal Vercel
// usage.
//
// Every browser starts brand new and signed out: no cookies, no saved
// passwords, no connection to any person's computer or accounts. It lives
// only for the length of ONE Ernie reply (keyed by that reply's requestId)
// and is closed when the reply ends — see closeBrowseSession(), called from
// the chat routes' finally blocks.
//
// READ-ONLY IS ENFORCED IN CODE, not just asked for in the prompt
// (claude/ernie-sandbox-restrictions.md: zero write access anywhere
// external). The blocks, all below:
//   1. Typing is only allowed into search / lookup boxes. Password, email,
//      phone, name, card, message/comment and similar fields are refused,
//      and so is any multi-line text box.
//   2. Form submissions: only plain GET forms (how search forms work) are
//      allowed. Any other form submit is cancelled inside the page, and any
//      non-GET page navigation (the network side of a form post) is
//      aborted before it leaves the browser.
//   3. Clicks on buttons/links whose label reads like a write action
//      (log in, sign up, submit, send, post, buy, checkout, subscribe,
//      delete, etc.) are refused, as is any submit button of a non-GET form.
//   4. Downloads are denied, pop-up dialogs are dismissed, and private /
//      internal network addresses are never reachable.
// Any website is allowed — no allow-list, per Chad.

import chromium from "@sparticuz/chromium-min";
import puppeteer, { type Browser, type Page, type HTTPRequest } from "puppeteer-core";
import type { SupabaseClient } from "@supabase/supabase-js";
import { logErnieToolExecution } from "@/lib/ernie/files";

// The Chromium build itself is downloaded once per cold start into /tmp
// (it's too big to ship inside the function bundle). Pinned to the same
// version as the @sparticuz/chromium-min package in package.json — bump
// both together.
const CHROMIUM_PACK_URL =
  process.env.ERNIE_CHROMIUM_PACK_URL ||
  "https://github.com/Sparticuz/chromium/releases/download/v153.0.0/chromium-v153.0.0-pack.x64.tar";

const ACTION_TIMEOUT_MS = 30_000;
const NAV_TIMEOUT_MS = 25_000;
const SNAPSHOT_TEXT_CHARS = 8_000;
const READ_TEXT_CHARS = 25_000;
const MAX_ELEMENTS = 180;
const SESSION_IDLE_MS = 6 * 60_000;

const USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/139.0.0.0 Safari/537.36";

interface BrowseSession {
  browser: Browser;
  page: Page;
  lastUsed: number;
  blockedNotes: string[];
}

const sessions = new Map<string, BrowseSession>();

// Words that mark a click as a write action. Checked against the visible
// label / aria-label / value of whatever Ernie tries to click.
const WRITE_ACTION_LABEL =
  /\b(log ?in|log ?on|sign ?in|sign ?up|sign ?on|register|create (an )?account|join now|subscribe|submit|send|post|publish|reply|comment|tweet|buy|purchase|check ?out|add to (cart|bag|basket)|place (your )?order|pay|donate|delete|unsubscribe|confirm (order|purchase|payment)|upload)\b/i;

// Field names/labels Ernie may never type into, even if it looks like a
// plain text box.
const SENSITIVE_FIELD =
  /(pass|pwd|user ?name|userid|login|e-?mail|phone|mobile|tel\b|card|cvv|cvc|ssn|social|account|first.?name|last.?name|full.?name|your.?name|birth|message|comment|subject|feedback|address ?line|street|captcha|challenge|answer|verif|otp|one.?time)/i;

function isDisallowedHost(hostname: string): boolean {
  const h = hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (h === "localhost" || h.endsWith(".localhost") || h === "0.0.0.0" || h === "::1") return true;
  if (h.endsWith(".internal") || h.endsWith(".local")) return true;
  if (/^127\./.test(h)) return true;
  if (/^10\./.test(h)) return true;
  if (/^192\.168\./.test(h)) return true;
  if (/^172\.(1[6-9]|2\d|3[01])\./.test(h)) return true;
  if (/^169\.254\./.test(h)) return true;
  if (/^(fc|fd)[0-9a-f]{2}:/.test(h) || /^fe80:/.test(h)) return true;
  return false;
}

function checkUrl(raw: string): URL {
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    throw new Error(`"${raw}" isn't a valid web address.`);
  }
  if (u.protocol !== "http:" && u.protocol !== "https:") {
    throw new Error("Only http:// and https:// web addresses can be opened.");
  }
  if (isDisallowedHost(u.hostname)) {
    throw new Error("That address points at a private/internal network, which Ernie's browser can't reach.");
  }
  return u;
}

async function launchBrowser(): Promise<Browser> {
  // Local development (e.g. `npm run dev` on Windows) can't use the Linux
  // serverless Chromium — point ERNIE_CHROME_PATH at a local Chrome instead.
  const localChrome = process.env.ERNIE_CHROME_PATH;
  if (localChrome) {
    return puppeteer.launch({ executablePath: localChrome, headless: true, args: ["--no-sandbox"] });
  }
  if (process.platform !== "linux") {
    throw new Error("Ernie's browser only runs on the live site (or set ERNIE_CHROME_PATH for local testing).");
  }
  const executablePath = await chromium.executablePath(CHROMIUM_PACK_URL);
  return puppeteer.launch({
    executablePath,
    headless: "shell",
    args: await puppeteer.defaultArgs({ args: chromium.args, headless: "shell" }),
    defaultViewport: { width: 1280, height: 900 },
  });
}

// Runs inside every page before the site's own scripts: cancels any form
// submit that isn't a plain GET form without sensitive fields. Capture
// phase + stopImmediatePropagation so the site's own submit handlers (the
// usual way a form posts via JavaScript) never even see the event.
const IN_PAGE_GUARD = `
(() => {
  if (window.__ernieGuard) return;
  window.__ernieGuard = true;
  window.__ernieBlocked = [];
  const isSafeForm = (form) => {
    if (!form || form.tagName !== "FORM") return true;
    const method = (form.getAttribute("method") || "get").toLowerCase();
    if (method !== "get") return false;
    for (const el of form.querySelectorAll("input, textarea")) {
      const t = (el.getAttribute("type") || "text").toLowerCase();
      if (t === "password" || t === "email" || t === "tel" || t === "file") return false;
      if (el.tagName === "TEXTAREA") return false;
    }
    return true;
  };
  window.__ernieIsSafeForm = isSafeForm;
  document.addEventListener("submit", (e) => {
    if (!isSafeForm(e.target)) {
      e.preventDefault();
      e.stopImmediatePropagation();
      window.__ernieBlocked.push("A form submission was blocked (Ernie's browser is read-only).");
    }
  }, true);
  const origSubmit = HTMLFormElement.prototype.submit;
  HTMLFormElement.prototype.submit = function () {
    if (!isSafeForm(this)) {
      window.__ernieBlocked.push("A form submission was blocked (Ernie's browser is read-only).");
      return;
    }
    return origSubmit.call(this);
  };
  const origRequestSubmit = HTMLFormElement.prototype.requestSubmit;
  if (origRequestSubmit) {
    HTMLFormElement.prototype.requestSubmit = function (s) {
      if (!isSafeForm(this)) {
        window.__ernieBlocked.push("A form submission was blocked (Ernie's browser is read-only).");
        return;
      }
      return origRequestSubmit.call(this, s);
    };
  }
})();
`;

async function preparePage(page: Page, session: BrowseSession | null) {
  await page.setUserAgent(USER_AGENT);
  await page.setViewport({ width: 1280, height: 900 });
  await page.evaluateOnNewDocument(IN_PAGE_GUARD);
  page.on("dialog", (d) => {
    d.dismiss().catch(() => {});
  });
  const cdp = await page.createCDPSession();
  await cdp.send("Browser.setDownloadBehavior", { behavior: "deny" }).catch(() => {});
  await page.setRequestInterception(true);
  page.on("request", (req: HTTPRequest) => {
    let host = "";
    try {
      host = new URL(req.url()).hostname;
    } catch {
      // data:/blob: URLs etc. — let them through, they don't leave the browser
    }
    if (host && isDisallowedHost(host)) {
      req.abort("accessdenied").catch(() => {});
      return;
    }
    const method = req.method().toUpperCase();
    if (req.isNavigationRequest() && method !== "GET" && method !== "HEAD") {
      session?.blockedNotes.push("A form submission (page post) was blocked (Ernie's browser is read-only).");
      req.abort("accessdenied").catch(() => {});
      return;
    }
    if (req.resourceType() === "media") {
      req.abort("aborted").catch(() => {});
      return;
    }
    req.continue().catch(() => {});
  });
}

async function getSession(requestId: string): Promise<BrowseSession> {
  // Tidy up anything a crashed reply left behind.
  const now = Date.now();
  for (const [id, s] of sessions) {
    if (now - s.lastUsed > SESSION_IDLE_MS) {
      sessions.delete(id);
      s.browser.close().catch(() => {});
    }
  }
  const existing = sessions.get(requestId);
  if (existing) {
    existing.lastUsed = now;
    return existing;
  }
  const browser = await launchBrowser();
  const page = (await browser.pages())[0] ?? (await browser.newPage());
  const session: BrowseSession = { browser, page, lastUsed: now, blockedNotes: [] };
  await preparePage(page, session);
  // A link that opens a new tab: follow it in that tab, with the same guards.
  browser.on("targetcreated", async (target) => {
    if (target.type() !== "page") return;
    const newPage = await target.page().catch(() => null);
    if (!newPage || newPage === session.page) return;
    await preparePage(newPage, session).catch(() => {});
    session.page = newPage;
  });
  sessions.set(requestId, session);
  return session;
}

export async function closeBrowseSession(requestId: string): Promise<void> {
  const s = sessions.get(requestId);
  if (!s) return;
  sessions.delete(requestId);
  await s.browser.close().catch(() => {});
}

async function settle(page: Page) {
  await page.waitForNetworkIdle({ idleTime: 600, timeout: 5_000 }).catch(() => {});
}

interface ElementInfo {
  tag: string;
  type: string;
  role: string;
  label: string;
  inForm: boolean;
  formSafe: boolean;
  isSubmit: boolean;
  multiline: boolean;
  fieldHints: string;
  href: string;
}

// Tags every visible clickable/typeable thing with a number and returns a
// compact text snapshot Ernie can act on ("click 12", "type into 4").
async function snapshot(page: Page, textChars: number, textOffset = 0) {
  try {
    return await snapshotOnce(page, textChars, textOffset);
  } catch (err) {
    // The page was still navigating (a redirect, a late client-side route
    // change) — let it land, then look again once.
    if (err instanceof Error && /context was destroyed|detached/i.test(err.message)) {
      await page.waitForNavigation({ waitUntil: "domcontentloaded", timeout: 5_000 }).catch(() => {});
      await settle(page);
      return await snapshotOnce(page, textChars, textOffset);
    }
    throw err;
  }
}

async function snapshotOnce(page: Page, textChars: number, textOffset = 0) {
  const data = await page.evaluate(
    (maxEls: number, chars: number, offset: number) => {
      document.querySelectorAll("[data-ernie-id]").forEach((el) => el.removeAttribute("data-ernie-id"));
      const selector =
        'a[href], button, input:not([type="hidden"]), select, textarea, summary, [role="button"], [role="link"], [role="tab"], [role="menuitem"], [role="option"], [role="checkbox"], [role="searchbox"], [role="combobox"], [onclick]';
      const lines: string[] = [];
      let n = 0;
      for (const el of Array.from(document.querySelectorAll<HTMLElement>(selector))) {
        if (n >= maxEls) break;
        const r = el.getBoundingClientRect();
        if (r.width < 2 || r.height < 2) continue;
        const cs = getComputedStyle(el);
        if (cs.visibility === "hidden" || cs.display === "none" || cs.opacity === "0") continue;
        n++;
        el.setAttribute("data-ernie-id", String(n));
        const tag = el.tagName.toLowerCase();
        const type = (el.getAttribute("type") || "").toLowerCase();
        const role = el.getAttribute("role") || "";
        let label =
          el.getAttribute("aria-label") ||
          (el as HTMLInputElement).placeholder ||
          (el.innerText || "").trim() ||
          el.getAttribute("title") ||
          (el.querySelector("img") as HTMLImageElement | null)?.alt ||
          (el as HTMLInputElement).value ||
          el.getAttribute("name") ||
          "";
        label = label.replace(/\s+/g, " ").trim().slice(0, 80);
        let kind = role || tag;
        if (tag === "a") kind = "link";
        if (tag === "input") kind = type === "submit" || type === "button" ? "button" : `input:${type || "text"}`;
        if (tag === "select") {
          const opts = Array.from((el as HTMLSelectElement).options)
            .slice(0, 12)
            .map((o) => o.text.trim())
            .join(" | ");
          label = `${label} [options: ${opts}]`.slice(0, 200);
        }
        let extra = "";
        if (tag === "a") {
          const href = (el as HTMLAnchorElement).href || "";
          extra = href && !href.startsWith("javascript:") ? ` -> ${href.slice(0, 120)}` : "";
        }
        const inView = r.bottom > 0 && r.top < window.innerHeight;
        lines.push(`[${n}] ${kind} "${label}"${extra}${inView ? "" : " (off-screen)"}`);
      }
      const fullText = (document.body?.innerText || "").replace(/[ \t]+/g, " ").replace(/\n{3,}/g, "\n\n").trim();
      const blocked = ((window as unknown as { __ernieBlocked?: string[] }).__ernieBlocked || []).splice(0);
      return {
        url: location.href,
        title: document.title,
        text: fullText.slice(offset, offset + chars),
        totalChars: fullText.length,
        elements: lines.join("\n"),
        elementCount: n,
        blocked,
        scrollY: Math.round(window.scrollY),
        pageHeight: Math.round(document.documentElement.scrollHeight),
      };
    },
    MAX_ELEMENTS,
    textChars,
    textOffset,
  );
  return data;
}

async function inspectElement(page: Page, id: number): Promise<ElementInfo | null> {
  return page.evaluate((n: number) => {
    const el = document.querySelector<HTMLElement>(`[data-ernie-id="${n}"]`);
    if (!el) return null;
    const form = (el as HTMLInputElement).form || el.closest("form");
    const isSafe = (window as unknown as { __ernieIsSafeForm?: (f: Element | null) => boolean }).__ernieIsSafeForm;
    const tag = el.tagName.toLowerCase();
    const type = (el.getAttribute("type") || "").toLowerCase();
    const isSubmit =
      (tag === "button" && (type === "" || type === "submit") && !!form) || (tag === "input" && (type === "submit" || type === "image"));
    const labelFor = el.id ? document.querySelector(`label[for="${CSS.escape(el.id)}"]`)?.textContent || "" : "";
    return {
      tag,
      type,
      role: el.getAttribute("role") || "",
      label: [el.getAttribute("aria-label"), (el.innerText || "").trim(), (el as HTMLInputElement).value, el.getAttribute("title")]
        .filter(Boolean)
        .join(" ")
        .slice(0, 200),
      inForm: !!form,
      formSafe: isSafe ? isSafe(form) : !form,
      isSubmit,
      multiline: tag === "textarea" || el.isContentEditable,
      fieldHints: [
        el.getAttribute("name"),
        el.id,
        (el as HTMLInputElement).placeholder,
        el.getAttribute("aria-label"),
        el.getAttribute("autocomplete"),
        labelFor,
      ]
        .filter(Boolean)
        .join(" "),
      href: (el as HTMLAnchorElement).href || "",
    };
  }, id);
}

function withTimeout<T>(p: Promise<T>, ms: number, what: string): Promise<T> {
  return Promise.race([
    p,
    new Promise<T>((_, reject) => setTimeout(() => reject(new Error(`${what} took too long and was stopped.`)), ms)),
  ]);
}

export type BrowseAction = "open" | "click" | "type" | "select" | "scroll" | "back" | "read" | "screenshot";

export interface BrowseInput {
  action: BrowseAction;
  url?: string;
  element?: number;
  text?: string;
  press_enter?: boolean;
  option?: string;
  direction?: "up" | "down";
  offset?: number;
}

async function runAction(session: BrowseSession, input: BrowseInput): Promise<unknown> {
  const page = () => session.page;
  const needElement = () => {
    const n = Number(input.element);
    if (!Number.isInteger(n) || n < 1) throw new Error("Give the element's number from the latest page snapshot.");
    return n;
  };

  switch (input.action) {
    case "open": {
      const u = checkUrl(String(input.url ?? "").trim());
      await page().goto(u.toString(), { waitUntil: "domcontentloaded", timeout: NAV_TIMEOUT_MS });
      await settle(page());
      break;
    }
    case "click": {
      const n = needElement();
      const info = await inspectElement(page(), n);
      if (!info) throw new Error(`Element ${n} isn't on the page anymore — take a fresh look (the page may have changed).`);
      if (info.href) {
        try {
          checkUrl(info.href);
        } catch (e) {
          if (!info.href.startsWith("javascript:") && !info.href.startsWith("#")) throw e;
        }
      }
      if (WRITE_ACTION_LABEL.test(info.label)) {
        return { blocked: `Not clicking "${info.label.slice(0, 60)}" — it looks like a login, sign-up, posting, purchase, or other write action, and Ernie's browser is read-only.` };
      }
      if (info.isSubmit && !info.formSafe) {
        return { blocked: "Not clicking that — it would submit a form that sends information to the site, and Ernie's browser is read-only." };
      }
      const el = await page().$(`[data-ernie-id="${n}"]`);
      if (!el) throw new Error(`Element ${n} isn't on the page anymore.`);
      await el.scrollIntoView().catch(() => {});
      await el.click({ delay: 30 }).catch(async () => {
        // Covered by an overlay, etc. — fall back to a script click.
        await page().evaluate((x: number) => document.querySelector<HTMLElement>(`[data-ernie-id="${x}"]`)?.click(), n);
      });
      await new Promise((r) => setTimeout(r, 400));
      await page().waitForNavigation({ waitUntil: "domcontentloaded", timeout: 3_000 }).catch(() => {});
      await settle(page());
      break;
    }
    case "type": {
      const n = needElement();
      const text = String(input.text ?? "");
      if (!text) throw new Error("No text given to type.");
      if (text.length > 200) throw new Error("Search text is limited to 200 characters.");
      const info = await inspectElement(page(), n);
      if (!info) throw new Error(`Element ${n} isn't on the page anymore — take a fresh look.`);
      const typeable =
        (info.tag === "input" && ["", "text", "search", "number", "url"].includes(info.type)) ||
        info.role === "searchbox" ||
        info.role === "combobox";
      if (!typeable || info.multiline) {
        return { blocked: "Ernie's browser can only type into search or lookup boxes — not message boxes, comment fields, or other text areas." };
      }
      if (SENSITIVE_FIELD.test(info.fieldHints) || !info.formSafe) {
        return { blocked: "Not typing there — that field looks like it's for login, contact, personal, or payment details, and Ernie's browser never fills those in." };
      }
      const el = await page().$(`[data-ernie-id="${n}"]`);
      if (!el) throw new Error(`Element ${n} isn't on the page anymore.`);
      await el.scrollIntoView().catch(() => {});
      await el.click({ count: 3 }).catch(() => {});
      await el.evaluate((node) => {
        (node as HTMLInputElement).value = "";
      });
      await el.type(text, { delay: 20 });
      if (input.press_enter) {
        await el.press("Enter");
        await page().waitForNavigation({ waitUntil: "domcontentloaded", timeout: 5_000 }).catch(() => {});
      }
      await settle(page());
      break;
    }
    case "select": {
      const n = needElement();
      const info = await inspectElement(page(), n);
      if (!info || info.tag !== "select") throw new Error(`Element ${n} isn't a dropdown.`);
      if (!info.formSafe) {
        return { blocked: "Not changing that dropdown — it's part of a form that sends information to the site." };
      }
      const wanted = String(input.option ?? "").trim().toLowerCase();
      const value = await page().evaluate(
        (x: number, w: string) => {
          const sel = document.querySelector<HTMLSelectElement>(`[data-ernie-id="${x}"]`);
          if (!sel) return null;
          const opt = Array.from(sel.options).find((o) => o.text.trim().toLowerCase() === w || o.value.toLowerCase() === w) ||
            Array.from(sel.options).find((o) => o.text.trim().toLowerCase().includes(w));
          return opt ? opt.value : null;
        },
        n,
        wanted,
      );
      if (value === null) throw new Error(`No option matching "${input.option}" in that dropdown.`);
      await page().select(`[data-ernie-id="${n}"]`, value);
      await page().waitForNavigation({ waitUntil: "domcontentloaded", timeout: 3_000 }).catch(() => {});
      await settle(page());
      break;
    }
    case "scroll": {
      const dir = input.direction === "up" ? -1 : 1;
      await page().evaluate((d: number) => window.scrollBy(0, d * window.innerHeight * 0.9), dir);
      await settle(page());
      break;
    }
    case "back": {
      await page().goBack({ waitUntil: "domcontentloaded", timeout: NAV_TIMEOUT_MS }).catch(() => {});
      await settle(page());
      break;
    }
    case "read": {
      const offset = Math.max(0, Math.floor(Number(input.offset) || 0));
      const snap = await snapshot(page(), READ_TEXT_CHARS, offset);
      return {
        url: snap.url,
        title: snap.title,
        text: snap.text,
        showing_chars: `${offset}–${offset + snap.text.length} of ${snap.totalChars}`,
        more_text: offset + snap.text.length < snap.totalChars ? `Call read again with offset ${offset + snap.text.length} for the rest.` : undefined,
      };
    }
    case "screenshot": {
      const snap = await snapshot(page(), 0);
      const b64 = await page().screenshot({ type: "jpeg", quality: 60, encoding: "base64" });
      return {
        __contentBlocks: [
          { type: "text", text: `Screenshot of ${snap.title} (${snap.url}). Visible part of the page only.` },
          { type: "image", source: { type: "base64", media_type: "image/jpeg", data: b64 } },
        ],
      };
    }
    default:
      throw new Error(`Unknown browse action "${String(input.action)}".`);
  }

  if (page().url() === "about:blank") {
    return { note: "No page is open yet in this reply — start with action \"open\" and a url." };
  }
  const snap = await snapshot(page(), SNAPSHOT_TEXT_CHARS);
  const blocked = [...session.blockedNotes.splice(0), ...snap.blocked];
  return {
    url: snap.url,
    title: snap.title,
    ...(blocked.length ? { blocked: Array.from(new Set(blocked)).join(" ") } : {}),
    page_text: snap.text,
    ...(snap.totalChars > SNAPSHOT_TEXT_CHARS
      ? { page_text_note: `Showing the first ${SNAPSHOT_TEXT_CHARS} of ${snap.totalChars} characters — use action "read" (with offset) for the rest.` }
      : {}),
    scroll_position: `${snap.scrollY}px of ${snap.pageHeight}px`,
    elements: snap.elements || "(no clickable elements found)",
  };
}

// browse_website's implementation (see lib/ernie/tools.ts).
export async function browseWebsite(requestId: string, input: BrowseInput): Promise<unknown> {
  if (!requestId) return { error: "Internal error: missing request id for the browser." };
  let session: BrowseSession;
  try {
    session = await withTimeout(getSession(requestId), 45_000, "Starting the browser");
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Couldn't start the browser." };
  }
  try {
    const result = await withTimeout(runAction(session, input), ACTION_TIMEOUT_MS, "That browser step");
    session.lastUsed = Date.now();
    return result;
  } catch (err) {
    const msg = err instanceof Error ? err.message : "The browser step failed.";
    let where = "";
    try {
      where = session.page.url();
    } catch {
      // ignore
    }
    return { error: msg, ...(where && where !== "about:blank" ? { current_url: where } : {}) };
  }
}

// Every browser step goes into the same ernie_tool_execution_log every
// web_fetch / fetch_url_as_file call already does — what Ernie did, and the
// page he ended up on — so any site he visited is traceable later.
export async function logBrowseStep(
  supabase: SupabaseClient,
  userId: string,
  conversationId: string | undefined,
  input: unknown,
  result: unknown,
): Promise<void> {
  const i = (input ?? {}) as Partial<BrowseInput>;
  const r = (result ?? {}) as { url?: unknown; current_url?: unknown; error?: unknown; blocked?: unknown };
  await logErnieToolExecution(supabase, userId, conversationId, "browse_website", {
    action: i.action,
    ...(i.url ? { requested_url: i.url } : {}),
    ...(i.action === "type" && i.text ? { typed: String(i.text).slice(0, 200) } : {}),
    page_url: typeof r.url === "string" ? r.url : typeof r.current_url === "string" ? r.current_url : undefined,
    ...(r.blocked ? { blocked: String(r.blocked).slice(0, 300) } : {}),
    ...(r.error ? { error: String(r.error).slice(0, 300) } : {}),
  });
}
