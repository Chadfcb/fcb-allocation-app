// Email Studio — Export a design (added 2026-11-16, per Chad: "execute", after
// Eddie asked for a way to hand a design to an outside company to edit in
// their own tools: "Add an export option to Email Studio that downloads a
// design as a standalone HTML file (with images packaged in or linked)").
//
// Two choices, both downloaded in the browser (nothing is saved or sent):
//   * Zip with pictures — email.html + an images/ folder with every picture
//     the email uses (the HTML points at those local copies) + README.txt.
//   * HTML only — one email.html; pictures stay linked where they're stored
//     online (our public Creative Library storage).
// The FCB address + unsubscribe footer is NOT included — our app adds it when
// WE send; the other company's email service adds its own. Designs with
// Ernie's gray "Swap this picture" boxes can't be exported (same as Send).
// Browser-only (uses fetch, Blob, document) — import from "use client" files.

import JSZip from "jszip";
import { hasSwapPictures } from "@/lib/email/erniePlaceholder";

export type ExportInput = {
  name: string;
  subject: string | null;
  preheader: string | null;
  /** The designer's finished HTML (styles inlined) — email_designs.html. */
  bodyHtml: string;
};

export const SWAP_BLOCKS_EXPORT =
  "This email still has gray “Swap this picture” boxes from Ernie. Swap in real pictures (or delete those boxes) before exporting.";

function esc(s: string) {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

/** "Oobli Holiday Email!" → "oobli-holiday-email" */
export function fileSlug(name: string): string {
  return (
    name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 60) || "email"
  );
}

/** A complete standalone email document — same wrapper as a real send, minus
 *  our footer. */
export function exportDocument(input: ExportInput, bodyHtml = input.bodyHtml): string {
  const title = (input.subject || input.name || "Email").trim();
  const pre = input.preheader?.trim()
    ? `<div style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent;">${esc(input.preheader.trim())}</div>`
    : "";
  return (
    `<!doctype html>\n<html lang="en">\n<head>\n<meta charset="utf-8">\n` +
    `<meta name="viewport" content="width=device-width, initial-scale=1">\n` +
    `<meta http-equiv="X-UA-Compatible" content="IE=edge">\n` +
    `<title>${esc(title)}</title>\n</head>\n` +
    `<body style="margin:0;padding:0;background-color:#f4f4f4;">\n${pre}${bodyHtml}\n</body>\n</html>\n`
  );
}

/** Every web picture address the email uses: <img src>, background="…", and
 *  url(…) inside inline styles. data: pictures are already inside the file. */
export function findImageUrls(html: string): string[] {
  const found = new Set<string>();
  const add = (u: string) => {
    const url = u.trim().replace(/&amp;/g, "&");
    if (/^https?:\/\//i.test(url)) found.add(url);
  };
  for (const m of html.matchAll(/<img\b[^>]*?\ssrc\s*=\s*["']([^"']+)["']/gi)) add(m[1]);
  for (const m of html.matchAll(/\sbackground\s*=\s*["']([^"']+)["']/gi)) add(m[1]);
  for (const m of html.matchAll(/url\(\s*(?:&quot;|["'])?([^"')&]+?)(?:&quot;|["'])?\s*\)/gi)) add(m[1]);
  return [...found];
}

const EXT_BY_TYPE: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/gif": "gif",
  "image/webp": "webp",
  "image/svg+xml": "svg",
};

function pictureFileName(url: string, type: string, n: number, used: Set<string>): string {
  let base = "picture";
  try {
    base = decodeURIComponent(new URL(url).pathname.split("/").pop() || "picture");
  } catch {
    // keep "picture"
  }
  base = base
    .replace(/\.[a-z0-9]{2,5}$/i, "")
    .replace(/^[0-9a-f]{8}-[0-9a-f-]{27,}-/i, "") // drop the storage id in front of Creative Library names
    .replace(/[^a-z0-9._-]+/gi, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 50) || "picture";
  const fromUrl = (url.split("?")[0].match(/\.([a-z0-9]{2,5})$/i) || [])[1]?.toLowerCase();
  const ext = EXT_BY_TYPE[type] || (fromUrl === "jpeg" ? "jpg" : fromUrl) || "png";
  let name = `${String(n).padStart(2, "0")}-${base}.${ext}`;
  while (used.has(name)) name = `${String(n).padStart(2, "0")}-${base}-${used.size}.${ext}`;
  used.add(name);
  return name;
}

async function pictureSize(blob: Blob): Promise<string> {
  try {
    const bmp = await createImageBitmap(blob);
    const s = `${bmp.width} × ${bmp.height} px`;
    bmp.close();
    return s;
  } catch {
    return "size unknown";
  }
}

function kb(bytes: number) {
  return bytes >= 1024 * 1024 ? `${(bytes / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

function downloadBlob(blob: Blob, fileName: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** Downloads just email.html (pictures stay linked online). */
export function exportHtmlOnly(input: ExportInput): { ok: true } | { ok: false; error: string } {
  if (!input.bodyHtml?.trim()) return { ok: false, error: "This email is empty — nothing to export yet." };
  if (hasSwapPictures(input.bodyHtml)) return { ok: false, error: SWAP_BLOCKS_EXPORT };
  downloadBlob(new Blob([exportDocument(input)], { type: "text/html;charset=utf-8" }), `${fileSlug(input.name)}.html`);
  return { ok: true };
}

/** Downloads <name>.zip: email.html + images/ + README.txt. */
export async function exportZip(
  input: ExportInput,
): Promise<{ ok: true; pictures: number; linked: string[] } | { ok: false; error: string }> {
  if (!input.bodyHtml?.trim()) return { ok: false, error: "This email is empty — nothing to export yet." };
  if (hasSwapPictures(input.bodyHtml)) return { ok: false, error: SWAP_BLOCKS_EXPORT };

  const zip = new JSZip();
  const slug = fileSlug(input.name);
  const root = zip.folder(slug) ?? zip;
  const images = root.folder("images") ?? root;
  const used = new Set<string>();
  const packed: { name: string; url: string; size: string; bytes: number }[] = [];
  const linked: string[] = [];
  let html = input.bodyHtml;

  const urls = findImageUrls(input.bodyHtml); // in the order they appear in the email
  const swaps: [string, string][] = [];
  let n = 0;
  for (const url of urls) {
    try {
      const res = await fetch(url, { mode: "cors", cache: "no-store" });
      if (!res.ok) throw new Error(String(res.status));
      const blob = await res.blob();
      n += 1;
      const name = pictureFileName(url, blob.type, n, used);
      images.file(name, blob);
      packed.push({ name, url, size: await pictureSize(blob), bytes: blob.size });
      swaps.push([url, `images/${name}`]);
    } catch {
      linked.push(url);
    }
  }
  // Point the HTML at the local copies — longest address first, so one that
  // starts the same as another is replaced whole. Covers "&" written as "&amp;".
  for (const [url, local] of swaps.sort((a, b) => b[0].length - a[0].length)) {
    html = html.split(url).join(local).split(url.replace(/&/g, "&amp;")).join(local);
  }

  root.file("email.html", exportDocument(input, html));

  const when = new Date().toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZone: "America/Los_Angeles",
  });
  const readme = [
    `${input.name}`,
    `Exported from Full Circle Brewing's Email Studio on ${when} (Pacific).`,
    ``,
    `Subject line:  ${input.subject?.trim() || "(none yet)"}`,
    `Preview text:  ${input.preheader?.trim() || "(none)"}`,
    ``,
    `WHAT'S IN HERE`,
    `  email.html  - the finished email. Built for email programs: layout tables and`,
    `                inline styles. Open it in a browser to see it, or in any email`,
    `                tool / code editor to edit it.`,
    `  images/     - every picture the email uses. email.html points at these files,`,
    `                so keep the folder next to email.html. Most email services want`,
    `                pictures uploaded to them and the addresses swapped in.`,
    ``,
    `PICTURES (${packed.length})`,
    ...(packed.length ? packed.map((p) => `  images/${p.name}  -  ${p.size}, ${kb(p.bytes)}`) : ["  (none)"]),
    ...(linked.length
      ? [
          ``,
          `STILL LINKED ONLINE (${linked.length}) - couldn't be downloaded, so email.html still uses the web address:`,
          ...linked.map((u) => `  ${u}`),
        ]
      : []),
    ``,
    `NOTES`,
    `  - No footer / unsubscribe link is included. Your email service must add its own`,
    `    (business address + unsubscribe), as the law requires for marketing email.`,
    `  - Content is about beer: send only to people 21 or older.`,
    ``,
  ].join("\r\n");
  root.file("README.txt", readme);

  const blob = await zip.generateAsync({ type: "blob", compression: "DEFLATE" });
  downloadBlob(blob, `${slug}.zip`);
  return { ok: true, pictures: packed.length, linked };
}
