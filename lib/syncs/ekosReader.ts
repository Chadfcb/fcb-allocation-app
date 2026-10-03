import type { Browser, Frame, HTTPRequest, Page } from "puppeteer-core";
import { launchBrowser } from "@/lib/ernie/browser";
import type { EkosPurchaseOrder, EkosPoItem } from "@/lib/syncs/ekosPurchaseOrders";
import type { EkosInventoryRow } from "@/lib/syncs/ekosNameMap";

// Ekos reader for the Automatic Syncs (Admin → Ekos Sync) — added
// 2026-10-03, Phase 2 of claude/ekos-auto-sync-plan.md.
//
// The app's own server opens a hidden Chromium (same one Ernie's browser
// uses), signs into Ekos with EKOS_USERNAME / EKOS_PASSWORD (set by Chad in
// Vercel — never stored anywhere else), and READS two things:
//   1. Open Purchase Orders (+ each PO's comments and line items)
//   2. Distributor Inventory (every page of the report)
// Page layout was read from Ekos on 2026-10-03 (with Chad signed in, read
// only) and is written down in claude/ekos-sync-reference.md. If Ekos
// changes its pages, this stops with a clear error and Chad gets an email —
// it never writes partial data.
//
// READ-ONLY IN EKOS, enforced here: the only request that isn't a plain
// page/data read is the sign-in itself. After sign-in, every non-GET
// request to Ekos is blocked unless it's a data lookup (get/search/list/
// layout); the reader never clicks Edit/Delete/Save, only page arrows.

const EKOS_ORIGIN = "https://app.goekos.com";
const OPEN_PO_LIST_URL = `${EKOS_ORIGIN}/03.00/Purchase_Order?filter=b3a0331c-1e9d-4304-93c0-e2950d2e362b`;
const PO_DETAIL_URL = (guid: string) => `${EKOS_ORIGIN}/03.00/Purchase_Order/${guid}`;
const DISTRIBUTOR_INVENTORY_URL = `${EKOS_ORIGIN}/03.00/distributor_inventory`;
const NAV_TIMEOUT_MS = 45_000;

interface EkosSession {
  browser: Browser;
  page: Page;
}

// What went wrong inside the hidden browser — added to a "Timed out"
// error so a failed run says WHY (first live run 2026-10-03 timed out with
// no clue). Only page paths, never query strings or cookies.
const diag = { errors: [] as string[], blocked: [] as string[], httpErrors: [] as string[] };
function pushDiag(list: string[], item: string) {
  if (list.length < 8 && !list.includes(item)) list.push(item);
}

// A normal desktop Chrome identity — some sites refuse to draw their pages
// for a browser that announces itself as "HeadlessChrome".
const USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/139.0.0.0 Safari/537.36";

let current: Promise<EkosSession> | null = null;

// One signed-in browser shared by both Ekos sources in a run.
export function getEkosSession(): Promise<EkosSession> {
  // A failed sign-in is remembered for the rest of the run (not retried by
  // the second source) so a wrong password can't trigger repeated attempts.
  if (!current) current = openSession();
  return current;
}

export async function closeEkosSession(): Promise<void> {
  const s = current;
  current = null;
  if (!s) return;
  try {
    (await s).browser.close().catch(() => {});
  } catch {
    // never opened — nothing to close
  }
}

async function openSession(): Promise<EkosSession> {
  const username = process.env.EKOS_USERNAME?.trim();
  const password = process.env.EKOS_PASSWORD;
  if (!username || !password) {
    throw new Error("Ekos sign-in isn't set up: EKOS_USERNAME and EKOS_PASSWORD need to be added in Vercel.");
  }

  const browser = await launchBrowser();
  try {
    const page = (await browser.pages())[0] ?? (await browser.newPage());
    page.setDefaultNavigationTimeout(NAV_TIMEOUT_MS);
    page.setDefaultTimeout(NAV_TIMEOUT_MS);
    await page.setViewport({ width: 1568, height: 900 });

    await page.setUserAgent(USER_AGENT);
    diag.errors.length = 0;
    diag.blocked.length = 0;
    diag.httpErrors.length = 0;

    let signedIn = false;
    await page.setRequestInterception(true);
    page.on("request", (req: HTTPRequest) => {
      if (!isAllowedRequest(req, signedIn)) {
        try {
          const u = new URL(req.url());
          if (isEkosHost(u.hostname)) pushDiag(diag.blocked, `${req.method()} ${u.hostname}${safePath(u.pathname)}`);
        } catch {
          // ignore
        }
        req.abort("blockedbyclient").catch(() => {});
        return;
      }
      req.continue().catch(() => {});
    });
    page.on("pageerror", (err) => pushDiag(diag.errors, String((err as Error)?.message ?? err).slice(0, 160)));
    page.on("response", (res) => {
      try {
        const u = new URL(res.url());
        if (res.status() >= 400 && isEkosHost(u.hostname)) pushDiag(diag.httpErrors, `${res.status()} ${safePath(u.pathname)}`);
      } catch {
        // ignore
      }
    });
    page.on("dialog", (d) => d.dismiss().catch(() => {}));

    await page.goto(`${EKOS_ORIGIN}/`, { waitUntil: "networkidle2" });
    const hasForm = await page.$("#txtUsername");
    if (!hasForm || !(await page.$("#txtPassword")) || !(await page.$("#btnLogin"))) {
      throw new Error("Ekos's sign-in page looks different than expected — the reader needs an update.");
    }
    await page.$eval("#txtUsername", (el) => ((el as HTMLInputElement).value = ""));
    await page.type("#txtUsername", username);
    await page.type("#txtPassword", password);
    await Promise.all([
      page.waitForNavigation({ waitUntil: "networkidle2" }).catch(() => null),
      page.click("#btnLogin"),
    ]);
    // Give a slow sign-in a few more seconds to land on the app.
    for (let i = 0; i < 20 && !page.url().includes("/03.00/"); i++) await sleep(500);
    if (!page.url().includes("/03.00/")) {
      const stillLogin = await page.$("#txtPassword");
      throw new Error(
        stillLogin
          ? "Ekos sign-in failed — check EKOS_USERNAME / EKOS_PASSWORD in Vercel (password changed?)."
          : `Ekos sign-in landed somewhere unexpected (${new URL(page.url()).pathname}) — the reader needs an update.`,
      );
    }
    signedIn = true;
    // Sign-in is only finished once Ekos's app has its session key (the
    // "token" cookie) — wait for it so the first page read isn't bounced
    // back to the sign-in page.
    const tokenDeadline = Date.now() + 25_000;
    while (Date.now() < tokenDeadline) {
      const cookies = await page.cookies().catch(() => []);
      if (cookies.some((c) => c.name === "token" && c.value)) break;
      await sleep(500);
    }
    if (!(await page.cookies().catch(() => [])).some((c) => c.name === "token" && c.value)) {
      throw new Error(`Ekos sign-in didn't finish (no session from Ekos).${await describePage(page)}`);
    }
    return { browser, page };
  } catch (err) {
    await browser.close().catch(() => {});
    throw err;
  }
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
  // Ekos's pages load scripts from other sites (analytics, help widget) and
  // break if those are missing, so plain loads from anywhere are allowed.
  // Anything that SENDS data elsewhere (tracking beacons) is not.
  if (!isEkosHost(url.hostname)) return isRead;
  if (isRead) return true;
  // Finishing sign-in: right after the sign-in page, Ekos's app trades a
  // one-time code for its session key (POST /API/api/Auth/Code/...). Found
  // from the first live run 2026-10-03 — blocking it left the reader signed
  // out. It's part of signing in, not a change to Ekos data.
  if (url.hostname === "app.goekos.com" && /^\/api\/api\/auth\//i.test(url.pathname)) return true;
  // The sign-in post itself (before signing in only).
  if (!signedIn && url.hostname === "app.goekos.com" && (url.pathname === "/" || /default|login/i.test(url.pathname))) {
    return true;
  }
  // Data lookups some Ekos screens make with POST.
  if (signedIn && /(get|search|list|query|layout|report|filter)/i.test(url.pathname)) return true;
  return false;
}

// Hide one-time sign-in codes from anything written to the run log.
function safePath(path: string): string {
  return /\/auth\//i.test(path) ? path.replace(/(\/auth\/[^/]+\/).*/i, "$1…") : path;
}

function isEkosHost(host: string): boolean {
  return host === "app.goekos.com" || host.endsWith(".goekos-tech.net") || host.endsWith(".goekos.com");
}

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

function num(text: string | null | undefined): number {
  const t = (text ?? "").replace(/[$,\s]/g, "");
  if (!t || t === "-") return 0;
  const n = Number(t);
  return Number.isFinite(n) ? n : 0;
}

function datePart(v: unknown): string | null {
  return typeof v === "string" && v.length >= 10 ? v.slice(0, 10) : null;
}

// ---------------------------------------------------------------------------
// Open Purchase Orders
// ---------------------------------------------------------------------------

interface PoListRecord {
  Number?: string;
  PODate?: string;
  ExpectedDeliveryDate?: string;
  TotalCost?: number;
  RowGUID?: string;
  Status?: { DefaultField?: string };
  Vendor?: { DefaultField?: string; Name?: string };
  LastModifiedByID?: { DefaultField?: string };
}

interface PoListPayload {
  totalCount?: number;
  records?: PoListRecord[];
}

export async function readEkosOpenPurchaseOrders(): Promise<EkosPurchaseOrder[]> {
  const { page } = await getEkosSession();

  // The list's data comes from Ekos's own API (GET /API/api/Purchase_Order).
  // The same address serves "All" and "Open", so keep every reply and pick
  // the one that matches what the Open list actually shows on screen.
  const payloads: PoListPayload[] = [];
  const onResponse = async (res: import("puppeteer-core").HTTPResponse) => {
    try {
      const u = new URL(res.url());
      if (u.pathname.toLowerCase() !== "/api/api/purchase_order" || res.status() !== 200) return;
      const body = (await res.json()) as { success?: boolean; responseObject?: PoListPayload };
      if (body?.success && Array.isArray(body.responseObject?.records)) payloads.push(body.responseObject!);
    } catch {
      // not JSON / body unavailable — ignore
    }
  };
  page.on("response", onResponse);
  try {
    await page.goto(OPEN_PO_LIST_URL, { waitUntil: "networkidle2" });
    await waitFor(async () => (await shownPoNumbers(page)) !== null, "the Open Purchase Orders list");
  } finally {
    page.off("response", onResponse);
  }

  const shown = (await shownPoNumbers(page)) ?? { numbers: [], total: 0 };
  if (shown.total === 0) {
    throw new Error(
      "Ekos showed no open purchase orders — nothing was changed (an empty list would move every PO to Holding). If that's really right, sync from the paste box.",
    );
  }
  const match = payloads.find(
    (p) => (p.totalCount ?? -1) === shown.total && shown.numbers.every((n) => p.records!.some((r) => r.Number === n)),
  );
  if (!match) throw new Error("Couldn't match Ekos's Open Purchase Orders data to the list on screen — the reader needs an update.");
  const records = match.records ?? [];
  if (records.length !== shown.total) {
    throw new Error(
      `Ekos has ${shown.total} open POs but only ${records.length} came through in one page — nothing was changed (the reader needs paging added).`,
    );
  }

  const out: EkosPurchaseOrder[] = [];
  for (const r of records) {
    if (!r.Number || !r.RowGUID) throw new Error("An Ekos PO came through without a number — nothing was changed.");
    const detail = await readPoDetail(page, r.RowGUID, r.Number);
    out.push({
      ekosPoNumber: r.Number,
      supplier: r.Vendor?.Name || r.Vendor?.DefaultField || detail.fields["Supplier"] || "",
      poDate: datePart(r.PODate),
      expectedDeliveryDate: datePart(r.ExpectedDeliveryDate),
      totalCost: typeof r.TotalCost === "number" ? r.TotalCost : num(detail.fields["Total Cost"]),
      status: r.Status?.DefaultField ?? detail.fields["Status"] ?? null,
      ekosLastModifiedBy: r.LastModifiedByID?.DefaultField ?? null,
      comments: detail.fields["Comments"]?.trim() || null,
      items: detail.items,
    });
  }
  return out;
}

// Numbers visible in the Open list + its "1-4 of 4" total. (On the PO list
// that count is a <span>; on Distributor Inventory it is a <p> — read both.)
async function shownPoNumbers(page: Page): Promise<{ numbers: string[]; total: number } | null> {
  return page.evaluate(() => {
    const range = [...document.querySelectorAll("p, span")]
      .map((p) => (p.textContent || "").trim())
      .find((t) => /^\d+-\d+ of \d+$/.test(t) || /^0 of 0$/.test(t));
    const table = document.querySelector("table");
    if (!range || !table) return null;
    const numbers = [...table.querySelectorAll("tbody tr")]
      .map((tr) => ((tr as HTMLTableRowElement).cells[0]?.textContent || "").trim())
      .filter(Boolean);
    return { numbers, total: Number(range.split(" of ")[1]) };
  });
}

// A PO's own page shows Ekos's older ("classic") screen inside a frame:
// label/value rows (Supplier, Comments, Status…) and the PO Items table.
async function readPoDetail(
  page: Page,
  guid: string,
  number: string,
): Promise<{ fields: Record<string, string>; items: EkosPoItem[] }> {
  await page.goto(PO_DETAIL_URL(guid), { waitUntil: "networkidle2" });
  let frame: Frame | undefined;
  await waitFor(async () => {
    frame = page
      .frames()
      .find((f) => /default\.aspx/i.test(f.url()) && f.url().toLowerCase().includes(guid.toLowerCase()));
    if (!frame) return false;
    return frame.evaluate(() => !!document.querySelector("table[id*='po_items']")).catch(() => false);
  }, `PO ${number}'s page`);

  const data = await frame!.evaluate(() => {
    const fields: Record<string, string> = {};
    for (const tr of document.querySelectorAll("tr")) {
      const cells = (tr as HTMLTableRowElement).cells;
      if (cells.length === 2 && !cells[0].querySelector("table")) {
        const label = (cells[0].textContent || "").replace(/\s+/g, " ").replace(/[:*]/g, "").trim();
        const full = (cells[1].innerText || "").trim();
        // Dates show a helper line under them ("Yesterday") — keep the first
        // line only; Comments keep every line.
        if (label && !(label in fields)) fields[label] = label === "Comments" ? full : full.split("\n")[0].trim();
      }
    }
    const table = document.querySelector("table[id*='po_items']") as HTMLTableElement | null;
    const headers = table ? [...table.rows[0].cells].map((c) => (c.textContent || "").trim().toUpperCase()) : [];
    const rows = table ? [...table.rows].slice(1).map((r) => [...r.cells].map((c) => (c.textContent || "").trim())) : [];
    const countText = (document.body.innerText.match(/\((\d+) items?\)/) || [])[1] ?? null;
    return { fields, headers, rows, itemCount: countText === null ? null : Number(countText) };
  });

  const col = (name: string) => data.headers.indexOf(name);
  const iItem = col("ITEM");
  const iQty = col("QUANTITY ORDERED");
  const iTotal = col("TOTAL ITEM COST");
  if (iItem < 0 || iQty < 0 || iTotal < 0) {
    throw new Error(`PO ${number}'s item list looks different than expected — the reader needs an update. Nothing was changed.`);
  }
  const rows = data.rows.filter((r) => r.length > iTotal && r[iItem]);
  if (data.itemCount !== null && data.itemCount !== rows.length) {
    throw new Error(
      `PO ${number} has ${data.itemCount} items but only ${rows.length} were readable (more than one page) — nothing was changed.`,
    );
  }
  const items: EkosPoItem[] = rows.map((r) => {
    const quantity = num(r[iQty]);
    const lineTotal = num(r[iTotal]);
    return {
      itemName: r[iItem],
      quantity,
      lineTotal,
      unitCost: quantity > 0 ? Math.round((lineTotal / quantity) * 10000) / 10000 : null,
    };
  });
  return { fields: data.fields, items };
}

// ---------------------------------------------------------------------------
// Distributor Inventory (Sales & Distribution → Distributor Inventory)
// ---------------------------------------------------------------------------

export async function readEkosDistributorInventory(): Promise<EkosInventoryRow[]> {
  const { page } = await getEkosSession();
  await page.goto(DISTRIBUTOR_INVENTORY_URL, { waitUntil: "networkidle2" });
  await waitFor(
    () => page.evaluate(() => !!document.querySelector("table tbody tr") && /\d+ of \d+/.test(document.body.innerText)),
    "the Distributor Inventory report",
  );

  // The report remembers the last page viewed — go back to page 1 first.
  for (let i = 0; i < 50; i++) {
    const moved = await page.evaluate(clickPager, "prev");
    if (!moved) break;
    await sleep(700);
  }

  const all: string[][] = [];
  let headers: string[] = [];
  let total = 0;
  for (let i = 0; i < 100; i++) {
    const pageData = await page.evaluate(() => {
      const table = document.querySelector("table") as HTMLTableElement;
      const headers = [...table.querySelectorAll("thead th")].map((th) => (th.textContent || "").trim());
      const rows = [...table.querySelectorAll("tbody tr")].map((r) =>
        [...(r as HTMLTableRowElement).cells].map((c) => (c as HTMLElement).innerText.trim()),
      );
      const range = [...document.querySelectorAll("p, span")]
        .map((p) => (p.textContent || "").trim())
        .filter((t) => /^\d+-\d+ of \d+$/.test(t))
        .pop();
      return { headers, rows, range: range ?? "" };
    });
    headers = pageData.headers;
    total = Number(pageData.range.split(" of ")[1] || 0);
    all.push(...pageData.rows);
    const moved = await page.evaluate(clickPager, "next");
    if (!moved) break;
    await sleep(800);
  }

  const iDist = headers.indexOf("Distributor");
  const iItem = headers.indexOf("Item");
  const iOnHand = headers.indexOf("On Hand");
  const iRate = headers.indexOf("Projected Daily Rate of Sales");
  if (iDist < 0 || iItem < 0 || iOnHand < 0 || iRate < 0) {
    throw new Error("Ekos's Distributor Inventory report columns look different than expected — the reader needs an update.");
  }
  if (total === 0 || all.length !== total) {
    throw new Error(`Read ${all.length} of ${total} Distributor Inventory rows from Ekos — nothing was changed.`);
  }
  return all.map((r) => ({
    distributor: r[iDist],
    item: r[iItem],
    onHand: num(r[iOnHand]),
    rateOfSale: num(r[iRate]),
  }));
}

// Runs in the page: clicks the report's previous/next arrow (the first /
// last arrow button next to "1-25 of 95"). Returns false when it's disabled.
function clickPager(direction: string): boolean {
  const label = [...document.querySelectorAll("p, span")]
    .filter((p) => /^\d+-\d+ of \d+$/.test((p.textContent || "").trim()))
    .pop();
  if (!label) return false;
  let box: HTMLElement | null = label.parentElement;
  while (box && box.querySelectorAll("button").length < 3) box = box.parentElement;
  if (!box) return false;
  const arrows = [...box.querySelectorAll("button")].filter((b) => b.querySelector("svg"));
  const btn = (direction === "prev" ? arrows[0] : arrows[arrows.length - 1]) as HTMLButtonElement | undefined;
  if (!btn || btn.disabled) return false;
  btn.click();
  return true;
}

async function waitFor(check: () => Promise<boolean>, what: string, timeoutMs = NAV_TIMEOUT_MS): Promise<void> {
  const until = Date.now() + timeoutMs;
  while (Date.now() < until) {
    if (await check().catch(() => false)) return;
    await sleep(500);
  }
  throw new Error(`Timed out waiting for ${what} in Ekos — nothing was changed.${await describePage()}`);
}

// Where the hidden browser was stuck, for the run log.
async function describePage(onPage?: Page): Promise<string> {
  const parts: string[] = [];
  try {
    // During sign-in the session isn't finished yet, so the page is passed in.
    const page = onPage ?? (current ? (await current).page : null);
    if (page) {
      const u = new URL(page.url());
      parts.push(`page ${u.pathname}`);
      const text = await page
        .evaluate(() => (document.body?.innerText || "").replace(/\s+/g, " ").trim().slice(0, 160))
        .catch(() => "");
      parts.push(text ? `showing "${text}"` : "page was blank");
    }
  } catch {
    // ignore
  }
  if (diag.errors.length) parts.push(`page errors: ${diag.errors.join(" | ")}`);
  if (diag.httpErrors.length) parts.push(`Ekos refused: ${diag.httpErrors.join(", ")}`);
  if (diag.blocked.length) parts.push(`blocked by the reader: ${diag.blocked.join(", ")}`);
  return parts.length ? ` [Details: ${parts.join("; ")}]` : "";
}
