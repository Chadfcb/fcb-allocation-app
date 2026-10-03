import { randomUUID } from "crypto";
import type { HTTPResponse, Page } from "puppeteer-core";
import { createAdminClient } from "@/lib/supabase/admin";

// Snapshot runs (Admin → Ekos Sync → "Run now + snapshots") — added
// 2026-10-03. Records what the hidden browser saw at every step of ONE run:
// a screenshot, the page text, every inner frame (path, loading state,
// text, tables with their first rows) and the Ekos requests made since the
// last step. Saved to table sync_snapshots + private bucket "sync-snapshots"
// (sql/sync_snapshots.sql). Viewed at /admin/ekos-sync/snapshots.
// Normal runs record nothing.

interface NetEntry {
  method: string;
  url: string;
  status: number;
  type: string;
  sample?: string;
}

interface Recorder {
  group: string;
  step: number;
  net: NetEntry[];
  watched: WeakSet<Page>;
}

let rec: Recorder | null = null;

export function startSnapshots(): string {
  rec = { group: randomUUID(), step: 0, net: [], watched: new WeakSet() };
  return rec.group;
}

export function stopSnapshots(): void {
  rec = null;
}

export function snapshotsOn(): boolean {
  return rec !== null;
}

function isEkos(host: string) {
  return host === "app.goekos.com" || host.endsWith(".goekos-tech.net") || host.endsWith(".goekos.com");
}

// Hide one-time sign-in codes; keep query strings off.
function cleanUrl(raw: string): string {
  try {
    const u = new URL(raw);
    const path = /\/auth\//i.test(u.pathname) ? u.pathname.replace(/(\/auth\/[^/]+\/).*/i, "$1…") : u.pathname;
    return `${u.hostname}${path}${u.search ? " (+query)" : ""}`;
  } catch {
    return raw.slice(0, 120);
  }
}

// Called once per page: logs every Ekos response (not static files).
export function watchPage(page: Page): void {
  if (!rec || rec.watched.has(page)) return;
  rec.watched.add(page);
  page.on("response", async (res: HTTPResponse) => {
    const r = rec;
    if (!r) return;
    try {
      const u = new URL(res.url());
      if (!isEkos(u.hostname)) return;
      if (/\.(js|css|png|gif|jpg|svg|woff2?|ico|map)$/i.test(u.pathname)) return;
      const type = res.headers()["content-type"] ?? "";
      const entry: NetEntry = {
        method: res.request().method(),
        url: cleanUrl(res.url()),
        status: res.status(),
        type: type.split(";")[0],
      };
      if (/json/i.test(type) && !/\/auth\//i.test(u.pathname)) {
        const text = await res.text().catch(() => "");
        entry.sample = text.slice(0, 600);
      }
      if (r.net.length < 400) r.net.push(entry);
    } catch {
      // ignore
    }
  });
}

// Takes one snapshot of where the page is right now.
export async function snap(page: Page, label: string): Promise<void> {
  const r = rec;
  if (!r) return;
  r.step += 1;
  const step = r.step;
  const net = r.net.splice(0, r.net.length);
  try {
    const frames = [];
    for (const f of page.frames().slice(0, 8)) {
      const info = await f
        .evaluate(() => ({
          readyState: document.readyState,
          title: document.title,
          text: (document.body?.innerText || "").replace(/\s+/g, " ").trim().slice(0, 1500),
          tables: [...document.querySelectorAll("table")].slice(0, 12).map((t) => ({
            id: t.id || null,
            rows: (t as HTMLTableElement).rows.length,
            firstRows: [...(t as HTMLTableElement).rows]
              .slice(0, 3)
              .map((row) => [...row.cells].map((c) => (c.textContent || "").replace(/\s+/g, " ").trim().slice(0, 40))),
          })),
        }))
        .catch((e) => ({ error: String(e).slice(0, 200) }));
      frames.push({ url: cleanUrl(f.url()), ...info });
    }
    let imagePath: string | null = null;
    const admin = createAdminClient();
    const shot = await page.screenshot({ type: "jpeg", quality: 55 }).catch(() => null);
    if (shot) {
      imagePath = `${r.group}/${String(step).padStart(2, "0")}.jpg`;
      const { error } = await admin.storage
        .from("sync-snapshots")
        .upload(imagePath, Buffer.from(shot), { contentType: "image/jpeg", upsert: true });
      if (error) imagePath = null;
    }
    await admin.from("sync_snapshots").insert({
      run_group: r.group,
      step,
      label,
      image_path: imagePath,
      details: { url: cleanUrl(page.url()), frames, network: net },
    });
  } catch {
    // A snapshot must never break the sync itself.
  }
}
