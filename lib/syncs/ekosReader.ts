import type { Browser, Frame, HTTPRequest, Page } from "puppeteer-core";
import { launchBrowser } from "@/lib/ernie/browser";
import type { EkosPurchaseOrder, EkosPoItem } from "@/lib/syncs/ekosPurchaseOrders";
import type { EkosInventoryRow } from "@/lib/syncs/ekosNameMap";
import type { EkosBatch, EkosBatchTask, EkosTankMapItem, EkosTanksRead } from "@/lib/syncs/ekosTanks";
import { snap, watchPage } from "@/lib/syncs/snapshots";

// Ekos reader for the Automatic Syncs (Admin → Ekos Sync) — added
// 2026-10-03, Phase 2 of claude/ekos-auto-sync-plan.md.
//
// The app's own server opens a hidden Chromium (same one Ernie's browser
// uses), signs into Ekos with EKOS_USERNAME / EKOS_PASSWORD (set by Chad in
// Vercel — never stored anywhere else), and READS two things:
//   1. Open Purchase Orders (+ each PO's comments and line items)
//   2. Distributor Inventory (every page of the report)
//   3. Tanks (added 2026-10-05): the tank map, the In-Progress batch list,
//      and each in-tank batch's tasks + Fermentation Log readings
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
const FACILITY_VIEW_URL = `${EKOS_ORIGIN}/03.00/?tab=Facility%20View`;
const BATCH_LIST_URL = `${EKOS_ORIGIN}/03.00/Product_Batch`;
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

// Lets one reader change what an Ekos LIST lookup asks for (e.g. "In-Progress
// batches" instead of the saved "Completed" filter) — only ever applied to
// read lookups that isAllowedRequest already lets through. Never saved in
// Ekos: it changes this one request, not the person's filter settings.
let rewriteListLookup: ((url: URL, body: string) => string | null) | null = null;

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

    await page.setUserAgent(USER_AGENT);
    // ROOT CAUSE of the PO-items failures (found from the snapshot run,
    // 2026-10-03): Ekos's sign-in page records the screen size and platform
    // (hidden fields hidScreenWidth / hidScreenHeight / hidPlatform), and
    // Ekos then serves its older screens in a small-screen "card" layout —
    // the PO Items list had no header row, one card per item. A hidden
    // browser reports a small screen and a Linux platform. Report a normal
    // 1920×1080 Windows desktop, the same as Chad's Chrome sends.
    // Screen size via Chrome's own device settings (applies to every frame);
    // platform via a small script that runs before Ekos's own scripts.
    const cdp = await page.createCDPSession();
    await cdp.send("Emulation.setDeviceMetricsOverride", {
      width: 1568,
      height: 900,
      deviceScaleFactor: 1,
      mobile: false,
      screenWidth: 1920,
      screenHeight: 1080,
    });
    await page.evaluateOnNewDocument(
      "try{Object.defineProperty(navigator,'platform',{get:()=>'Win32'});Object.defineProperty(navigator,'maxTouchPoints',{get:()=>0});}catch(e){}",
    );
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
      if (rewriteListLookup && req.method().toUpperCase() === "POST") {
        try {
          const changed = rewriteListLookup(new URL(req.url()), req.postData() ?? "");
          if (changed !== null) {
            req.continue({ postData: changed }).catch(() => {});
            return;
          }
        } catch {
          // fall through to the unchanged request
        }
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

    watchPage(page);
    await page.goto(`${EKOS_ORIGIN}/`, { waitUntil: "networkidle2" });
    await snap(page, "Ekos sign-in page");
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
    await snap(page, "Signed in");
    return { browser, page };
  } catch (err) {
    const page = (await browser.pages().catch(() => []))[0];
    if (page) await snap(page, `Sign-in FAILED: ${err instanceof Error ? err.message.slice(0, 120) : ""}`);
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
  // Ekos's older screens look data up through "_processors/*.ashx?action=…Get"
  // (e.g. the batch list's projectListGet) — only actions that end in "get".
  if (
    signedIn &&
    /\/_processors\/[a-z_]+\.ashx$/i.test(url.pathname) &&
    /get$/i.test(url.searchParams.get("action") ?? "")
  ) {
    return true;
  }
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
    await snap(page, "Open PO list — just opened");
    await waitFor(async () => (await shownPoNumbers(page)) !== null, "the Open Purchase Orders list");
    await snap(page, "Open PO list — ready");
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
  await snap(page, `PO ${number} — just opened`);
  let frame: Frame | undefined;
  await waitFor(async () => {
    frame = page
      .frames()
      .find((f) => /default\.aspx/i.test(f.url()) && f.url().toLowerCase().includes(guid.toLowerCase()));
    if (!frame) return false;
    // Ekos fills the PO Items list in after the page appears — wait until its
    // header row (Item / Quantity Ordered / Total Item Cost) is actually there.
    const state = await frame
      .evaluate(() => {
        const t = document.querySelector("table[id*='po_items']") as HTMLTableElement | null;
        if (!t || !t.rows.length) return "waiting";
        const h = [...t.rows[0].cells].map((c) => (c.textContent || "").replace(/\s+/g, " ").trim().toUpperCase());
        if (h.includes("ITEM") && h.includes("QUANTITY ORDERED") && h.includes("TOTAL ITEM COST")) return "ready";
        // Small-screen "card" layout: one cell per item, labels inside.
        if (t.rows[0].cells.length === 1 && /Item Number/i.test(t.rows[0].textContent || "")) return "cards";
        return "waiting";
      })
      .catch(() => "waiting");
    if (state === "cards") {
      throw new StopWaiting(
        `Ekos showed PO ${number}'s items in its small-screen layout, which the reader can't read — nothing was changed.`,
      );
    }
    return state === "ready";
  }, `PO ${number}'s item list`);

  await snap(page, `PO ${number} — items ready`);
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
    const headers = table
      ? [...table.rows[0].cells].map((c) => (c.textContent || "").replace(/\s+/g, " ").trim().toUpperCase())
      : [];
    const rows = table ? [...table.rows].slice(1).map((r) => [...r.cells].map((c) => (c.textContent || "").trim())) : [];
    const countText = (document.body.innerText.match(/\((\d+) items?\)/) || [])[1] ?? null;
    return { fields, headers, rows, itemCount: countText === null ? null : Number(countText) };
  });

  const col = (name: string) => data.headers.indexOf(name);
  const iItem = col("ITEM");
  const iQty = col("QUANTITY ORDERED");
  const iTotal = col("TOTAL ITEM COST");
  if (iItem < 0 || iQty < 0 || iTotal < 0) {
    throw new Error(
      `PO ${number}'s item list looks different than expected — the reader needs an update. Nothing was changed. [Details: columns seen: ${data.headers.join(" | ") || "none"}]`,
    );
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
  await snap(page, "Distributor Inventory — just opened");
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

// ---------------------------------------------------------------------------
// Tanks (added 2026-10-05) — claude/tank-sync-plan.md
// ---------------------------------------------------------------------------

export async function readEkosTanks(): Promise<EkosTanksRead> {
  const { page } = await getEkosSession();
  const map = await readTankMap(page);
  const batches = await readInProgressBatches(page, map);
  return { map, batches };
}

// Home → Facility View: Ekos's tank map, drawn in its older screen (a frame).
// Each spot: title (FV16), then lines like "18.662471 bbl", "NPT", "1295".
// (Its red dashed border is read too, but the Tanks page works out overdue
// from task due dates instead — Chad, 2026-10-05.)
async function readTankMap(page: Page): Promise<EkosTankMapItem[]> {
  await page.goto(FACILITY_VIEW_URL, { waitUntil: "networkidle2" });
  await snap(page, "Tank map — just opened");
  let frame: Frame | undefined;
  await waitFor(async () => {
    for (const f of page.frames()) {
      const n = await f.evaluate(() => document.querySelectorAll(".floorplanItemOuter").length).catch(() => 0);
      if (n >= 5) {
        frame = f;
        return true;
      }
    }
    return false;
  }, "the tank map (Facility View)");
  await snap(page, "Tank map — ready");

  const raw = await frame!.evaluate(() =>
    [...document.querySelectorAll(".floorplanItemOuter")].map((el) => {
      const titleEl = el.querySelector("div.floorplanItemTitle") ?? el.querySelector(".floorplanItemTitle");
      const lines = [...el.querySelectorAll("p")].map((p) => (p.textContent || "").replace(/\s+/g, " ").trim()).filter(Boolean);
      const border = el.querySelector(".floorplanItemBorder") as HTMLElement | null;
      const bs = border ? getComputedStyle(border) : null;
      return {
        title: (titleEl?.textContent || "").replace(/\s+/g, " ").trim(),
        lines,
        borderStyle: bs ? bs.borderTopStyle : "",
        borderColor: bs ? bs.borderTopColor : "",
        fill: bs ? bs.backgroundColor : "", // the circle's fill color lives on the border element
      };
    }),
  );

  const toHex = (rgb: string): string | null => {
    const m = rgb.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)(?:,\s*([\d.]+))?\)/);
    if (!m || (m[4] !== undefined && Number(m[4]) === 0)) return null;
    return "#" + [m[1], m[2], m[3]].map((n) => Number(n).toString(16).padStart(2, "0")).join("").toUpperCase();
  };

  const items: EkosTankMapItem[] = [];
  for (const r of raw) {
    // The title line can repeat inside the <p> list — drop it.
    const name = r.title || r.lines[0] || "";
    if (!name) continue;
    const rest = r.lines.filter((l) => l !== name && !/^empty$/i.test(l));
    const volLine = rest.find((l) => /^[\d.]+\s*bbl$/i.test(l));
    const after = volLine ? rest.slice(rest.indexOf(volLine) + 1) : [];
    items.push({
      name,
      volumeBbl: volLine ? num(volLine.replace(/bbl/i, "")) : 0,
      productCode: after[0] ?? null,
      batchTitle: after.slice(1).join(" ") || null,
      color: volLine ? toHex(r.fill) : null,
      overdue: r.borderStyle === "dashed" && /rgb\(255,\s*0,\s*0\)/.test(r.borderColor),
    });
  }
  if (!items.some((i) => /^FV/i.test(i.name))) {
    throw new Error("Ekos's tank map didn't show any FV tanks — the reader needs an update. Nothing was changed.");
  }
  return items;
}

interface ProjectListRecord {
  rowguid?: string;
  relatedObject?: string;
  relatedRecord?: string;
  title?: string;
  statusTitle?: string;
  productTitle?: string;
  startDate?: string;
  locations?: string;
  units?: number;
}

// Production → Production Batches. The list's data comes from Ekos's own
// lookup (POST _processors/projectdashboard.ashx?action=projectListGet). Its
// saved filter shows "Completed" batches, so for this one lookup the reader
// asks for In-Progress (Non-Aging + Aging) instead — the saved filter in
// Ekos is not touched.
async function readInProgressBatches(page: Page, map: EkosTankMapItem[]): Promise<EkosBatch[]> {
  let replied: { totalCount: number; records: ProjectListRecord[] } | null = null;
  const onResponse = async (res: import("puppeteer-core").HTTPResponse) => {
    try {
      const u = new URL(res.url());
      if (!/projectdashboard\.ashx$/i.test(u.pathname) || u.searchParams.get("action") !== "projectListGet") return;
      if (res.status() !== 200 || res.request().method().toUpperCase() !== "POST") return;
      const body = (await res.json()) as { projectList?: ProjectListRecord[]; projectTotalCount?: number };
      if (Array.isArray(body?.projectList)) {
        replied = { totalCount: Number(body.projectTotalCount ?? body.projectList.length), records: body.projectList };
      }
    } catch {
      // not JSON / body unavailable — ignore
    }
  };
  rewriteListLookup = (url, body) => {
    if (!/projectdashboard\.ashx$/i.test(url.pathname) || url.searchParams.get("action") !== "projectListGet") return null;
    const filter = JSON.parse(body) as { batchStatus?: { title?: string; isChecked?: boolean }[]; rowIndex?: number; rowsReturned?: number; searchString?: string };
    if (!Array.isArray(filter.batchStatus) || !filter.batchStatus.some((s) => /^In-Progress/i.test(s.title ?? ""))) return null;
    for (const s of filter.batchStatus) s.isChecked = /^In-Progress/i.test(s.title ?? "");
    filter.rowIndex = 0;
    filter.rowsReturned = 500;
    filter.searchString = "";
    return JSON.stringify(filter);
  };
  page.on("response", onResponse);
  try {
    await page.goto(BATCH_LIST_URL, { waitUntil: "networkidle2" });
    await snap(page, "Batch list — just opened");
    await waitFor(async () => replied !== null, "the In-Progress batch list");
    await snap(page, "Batch list — ready");
  } finally {
    page.off("response", onResponse);
    rewriteListLookup = null;
  }

  const list = replied as unknown as { totalCount: number; records: ProjectListRecord[] };
  if (list.records.length !== list.totalCount) {
    throw new Error(`Ekos has ${list.totalCount} In-Progress batches but only ${list.records.length} came through — nothing was changed.`);
  }
  if (list.records.some((r) => !/^In-Progress/i.test(r.statusTitle ?? ""))) {
    throw new Error("Ekos's batch list didn't switch to In-Progress batches — the reader needs an update. Nothing was changed.");
  }

  // Ekos's older-screen frame on this page, to look up each batch's details
  // the same way Ekos's own batch screen does (read-only lookups).
  const frame = page.frames().find((f) => /\/\d+\.\d+\.\d+\/default\.aspx/i.test(f.url()));
  if (!frame) throw new Error("Couldn't find Ekos's batch screen — the reader needs an update. Nothing was changed.");
  const base = new URL(frame.url()).pathname.replace(/\/default\.aspx$/i, "");
  const getJson = async (path: string): Promise<unknown> => {
    const text = await frame.evaluate(async (url: string) => {
      const r = await fetch(url, { credentials: "include" });
      return r.ok ? r.text() : `__HTTP_${r.status}`;
    }, `${base}/_processors/${path}&${Math.floor(Math.random() * 1e5)}`);
    if (text.startsWith("__HTTP_")) throw new Error(`Ekos refused a batch lookup (${text.slice(7)}) — nothing was changed.`);
    return JSON.parse(text);
  };

  const onMap = new Set(map.map((m) => m.name.toUpperCase()));
  const out: EkosBatch[] = [];
  for (const r of list.records) {
    const locations = (r.locations ?? "").split(",").map((l) => l.trim()).filter(Boolean);
    const inTank = locations.filter((l) => onMap.has(l.toUpperCase()));
    if (!inTank.length || !r.rowguid) continue; // not sitting in a tank (old/finished batches Ekos still lists)
    const g = encodeURIComponent(r.rowguid);
    const project = (await getJson(
      `project.ashx?action=project_get&projectguid=${g}&relatedobject=${encodeURIComponent(r.relatedObject ?? "")}&record=${encodeURIComponent(r.relatedRecord ?? "")}&task=null&filter=null`,
    )) as { tasks?: { title?: string; status_title?: string; start_date?: string; end_date?: string; is_overdue?: boolean; parent_task?: string }[] };
    if (!Array.isArray(project?.tasks)) {
      throw new Error(`Batch ${r.title}'s tasks came back in a shape the reader doesn't know — nothing was changed.`);
    }
    const logs = (await getJson(`projectOverview.ashx?action=fermentation_log_entries_get&project=${g}`)) as
      | { date?: string; temperature?: number | null }[]
      | null;
    const tasks: EkosBatchTask[] = project.tasks
      .filter((t) => !t.parent_task)
      .map((t) => ({
        title: (t.title ?? "").trim(),
        status: t.status_title ?? "",
        date: usDate(t.start_date) ?? usDate(t.end_date),
        due: usDate(t.end_date) ?? usDate(t.start_date),
        overdue: !!t.is_overdue,
      }))
      .filter((t) => t.title);
    const fermLogs = (Array.isArray(logs) ? logs : [])
      .map((l) => ({ at: usDateTime(l.date), tempF: typeof l.temperature === "number" ? l.temperature : null }))
      .sort((a, b) => (b.at ?? "").localeCompare(a.at ?? ""));
    out.push({
      title: r.title ?? "",
      productName: r.productTitle ?? "",
      startDate: datePart(r.startDate),
      locations: inTank,
      volumeBbl: typeof r.units === "number" ? r.units : 0,
      tasks,
      fermLogs,
    });
  }
  return out;
}

// "08/13/2026" → "2026-08-13"
function usDate(v: string | undefined | null): string | null {
  const m = (v ?? "").match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  return m ? `${m[3]}-${m[1].padStart(2, "0")}-${m[2].padStart(2, "0")}` : null;
}

// "6/26/2026 5:00:00 AM" → ISO time (Ekos shows these in Pacific time; the
// date is what matters for "as of").
function usDateTime(v: string | undefined | null): string | null {
  const m = (v ?? "").match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})(?:\s+(\d{1,2}):(\d{2})(?::(\d{2}))?\s*(AM|PM)?)?/i);
  if (!m) return null;
  let h = Number(m[4] ?? 0);
  if (m[7]) h = (h % 12) + (/pm/i.test(m[7]) ? 12 : 0);
  const pad = (n: number | string) => String(n).padStart(2, "0");
  return `${m[3]}-${pad(m[1])}-${pad(m[2])}T${pad(h)}:${pad(m[5] ?? 0)}:${pad(m[6] ?? 0)}`;
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

// Thrown from a waitFor check to stop at once with a clear reason.
class StopWaiting extends Error {}

async function waitFor(check: () => Promise<boolean>, what: string, timeoutMs = NAV_TIMEOUT_MS): Promise<void> {
  const until = Date.now() + timeoutMs;
  while (Date.now() < until) {
    try {
      if (await check()) return;
    } catch (err) {
      if (err instanceof StopWaiting) throw err;
    }
    await sleep(500);
  }
  const details = await describePage();
  try {
    const page = current ? (await current).page : null;
    if (page) await snap(page, `TIMED OUT waiting for ${what}`);
  } catch {
    // ignore
  }
  throw new Error(`Timed out waiting for ${what} in Ekos — nothing was changed.${details}`);
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
