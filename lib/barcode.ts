// UPC barcodes, drawn by the app itself (added 2026-10-28, per Chad: "in the
// UPC section, i need a preview and download link of the actual barcodes of
// the UPC's"). No add-on library — UPC-A / EAN-13 are a fixed, public
// pattern table, so the bars are built here and drawn as an SVG.
//
// - 12 digits → UPC-A (the normal US retail barcode).
// - 13 digits → EAN-13; a 13-digit code starting with 0 is the same UPC-A
//   with a leading 0, so it's drawn as UPC-A.
// - Anything else, or a wrong check digit, → no barcode, just the reason
//   (a scanner would reject a code with a bad check digit).

export type BarcodeKind = "UPC-A" | "EAN-13";
export type BarcodeCheck =
  | { ok: true; kind: BarcodeKind; digits: string }
  | { ok: false; reason: string };

// Bar patterns (1 = black module). R = L inverted, G = R reversed.
const L_CODES = ["0001101", "0011001", "0010011", "0111101", "0100011", "0110001", "0101111", "0111011", "0110111", "0001011"];
const R_CODES = L_CODES.map((c) => c.replace(/[01]/g, (b) => (b === "0" ? "1" : "0")));
const G_CODES = R_CODES.map((c) => c.split("").reverse().join(""));
// EAN-13: the first digit isn't drawn as bars — it sets which of the left
// six digits use L or G patterns.
const EAN_PARITY = ["LLLLLL", "LLGLGG", "LLGGLG", "LLGGGL", "LGLLGG", "LGGLLG", "LGGGLL", "LGLGLG", "LGLGGL", "LGGLGL"];

/** Check digit for the data digits (everything but the last digit). */
export function checkDigit(data: string): number {
  let sum = 0;
  const rev = data.split("").reverse();
  rev.forEach((d, i) => {
    sum += Number(d) * (i % 2 === 0 ? 3 : 1);
  });
  return (10 - (sum % 10)) % 10;
}

/** Is this a UPC we can draw? Spaces and dashes are ignored. */
export function checkUpc(raw: string): BarcodeCheck {
  const s = (raw ?? "").replace(/[\s-]/g, "");
  if (!s) return { ok: false, reason: "No UPC entered" };
  if (!/^\d+$/.test(s)) return { ok: false, reason: "UPC has letters or symbols in it" };
  if (s.length === 11) {
    return {
      ok: false,
      reason: `Only 11 digits — a UPC needs 12 (with its check digit it would be ${s}${checkDigit(s)})`,
    };
  }
  if (s.length !== 12 && s.length !== 13) {
    return { ok: false, reason: `${s.length} digits — a UPC needs 12` };
  }
  const want = checkDigit(s.slice(0, -1));
  if (Number(s[s.length - 1]) !== want) {
    return { ok: false, reason: `Check digit is wrong — the last digit should be ${want}` };
  }
  if (s.length === 13 && s[0] === "0") return { ok: true, kind: "UPC-A", digits: s.slice(1) };
  return { ok: true, kind: s.length === 12 ? "UPC-A" : "EAN-13", digits: s };
}

// Layout, in modules (one module = the thinnest bar).
const QUIET = 11; // white space each side (spec minimum is 9; room for the outside digits)
const TOP = 4;
const BAR_H = 62; // normal bars
const GUARD_H = 70; // guard bars run down between the digits
const WIDTH = QUIET + 95 + QUIET;
const HEIGHT = TOP + GUARD_H + 8;
const FONT = "Helvetica, Arial, sans-serif";

// Actual size (added 2026-10-28, Chad: "downloading the upc is printing it
// across an entire page, it needs to print actual size"). The standard
// (100%) UPC bar width is 0.013 in, so the whole barcode incl. its white
// margins is 117 × 0.013 = 1.52 in wide by 82 × 0.013 = 1.07 in tall.
// The SVG says its size in inches, the PNG carries its print resolution
// (DPI), and Print sends it to the printer at exactly this size.
const MODULE_IN = 0.013;
export const BARCODE_WIDTH_IN = WIDTH * MODULE_IN;
export const BARCODE_HEIGHT_IN = HEIGHT * MODULE_IN;

/** The barcode as an SVG string (black bars on white). Only call with ok digits. */
export function barcodeSvg(kind: BarcodeKind, digits: string): string {
  const d = digits.split("").map(Number);
  // Which modules are bars, and which bars run long (guards — plus, on
  // UPC-A, the first and last digit's bars).
  let mods = "101";
  const tall: boolean[] = [true, true, true];
  const push = (code: string, isTall: boolean) => {
    mods += code;
    for (let i = 0; i < code.length; i++) tall.push(isTall);
  };
  if (kind === "UPC-A") {
    for (let i = 0; i < 6; i++) push(L_CODES[d[i]], i === 0);
  } else {
    const parity = EAN_PARITY[d[0]];
    for (let i = 0; i < 6; i++) push((parity[i] === "L" ? L_CODES : G_CODES)[d[i + 1]], false);
  }
  push("01010", true);
  const right = kind === "UPC-A" ? d.slice(6) : d.slice(7);
  right.forEach((n, i) => push(R_CODES[n], kind === "UPC-A" && i === 5));
  push("101", true);

  // Merge runs of black modules into rectangles.
  const rects: string[] = [];
  let i = 0;
  while (i < mods.length) {
    if (mods[i] !== "1") {
      i++;
      continue;
    }
    let j = i;
    while (j < mods.length && mods[j] === "1" && tall[j] === tall[i]) j++;
    rects.push(`<rect x="${QUIET + i}" y="${TOP}" width="${j - i}" height="${tall[i] ? GUARD_H : BAR_H}"/>`);
    i = j;
  }

  // Human-readable digits.
  const textY = TOP + BAR_H + 9;
  const txt = (x: number, s: string, size: number) =>
    `<text x="${x}" y="${textY}" font-size="${size}" text-anchor="middle">${s}</text>`;
  const texts: string[] = [];
  if (kind === "UPC-A") {
    texts.push(txt(QUIET - 5, String(d[0]), 8));
    for (let k = 0; k < 5; k++) texts.push(txt(QUIET + 10 + k * 7 + 3.5, String(d[k + 1]), 10.5));
    for (let k = 0; k < 5; k++) texts.push(txt(QUIET + 50 + k * 7 + 3.5, String(d[k + 6]), 10.5));
    texts.push(txt(QUIET + 95 + 5, String(d[11]), 8));
  } else {
    texts.push(txt(QUIET - 5, String(d[0]), 10.5));
    for (let k = 0; k < 6; k++) texts.push(txt(QUIET + 3 + k * 7 + 3.5, String(d[k + 1]), 10.5));
    for (let k = 0; k < 6; k++) texts.push(txt(QUIET + 50 + k * 7 + 3.5, String(d[k + 7]), 10.5));
  }

  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${WIDTH} ${HEIGHT}" width="${BARCODE_WIDTH_IN.toFixed(3)}in" height="${BARCODE_HEIGHT_IN.toFixed(3)}in" shape-rendering="crispEdges">` +
    `<rect width="${WIDTH}" height="${HEIGHT}" fill="#ffffff"/>` +
    `<g fill="#000000">${rects.join("")}</g>` +
    `<g fill="#000000" font-family="${FONT}">${texts.join("")}</g>` +
    `</svg>`
  );
}

/** Safe file name, e.g. "Juicy 16oz-4pk - UPC 850382001108". */
export function barcodeFileName(product: string, digits: string): string {
  const name = `${product} - UPC ${digits}`.replace(/[\\/:*?"<>|]+/g, "-").replace(/\s+/g, " ").trim();
  return name.slice(0, 150);
}

function triggerDownload(href: string, fileName: string) {
  const a = document.createElement("a");
  a.href = href;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  a.remove();
}

/** Download the barcode as an SVG (vector — any size, for designers/printers). */
export function downloadBarcodeSvg(svg: string, fileName: string) {
  const url = URL.createObjectURL(new Blob([svg], { type: "image/svg+xml" }));
  triggerDownload(url, `${fileName}.svg`);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

// CRC-32 (PNG chunk checksum).
const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();
function crc32(bytes: Uint8Array): number {
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

/**
 * Stamp the PNG's print resolution (its "pHYs" chunk) so Word, label
 * software, image viewers etc. place it at actual size instead of
 * stretching it. Browsers don't write this on their own.
 */
function setPngDpi(png: Uint8Array, pxPerInch: number): Uint8Array {
  const view = new DataView(png.buffer, png.byteOffset, png.byteLength);
  const chunks: Uint8Array[] = [png.subarray(0, 8)]; // PNG signature
  let pos = 8;
  while (pos < png.length) {
    const len = view.getUint32(pos);
    const type = String.fromCharCode(...png.subarray(pos + 4, pos + 8));
    const end = pos + 12 + len;
    if (type !== "pHYs") chunks.push(png.subarray(pos, end)); // drop any old one
    if (type === "IHDR") {
      const ppm = Math.round(pxPerInch / 0.0254); // pixels per meter
      const c = new Uint8Array(21);
      const cv = new DataView(c.buffer);
      cv.setUint32(0, 9);
      c.set([0x70, 0x48, 0x59, 0x73], 4); // "pHYs"
      cv.setUint32(8, ppm);
      cv.setUint32(12, ppm);
      c[16] = 1; // unit = meter
      cv.setUint32(17, crc32(c.subarray(4, 17)));
      chunks.push(c);
    }
    pos = end;
  }
  const out = new Uint8Array(chunks.reduce((n, c) => n + c.length, 0));
  let o = 0;
  for (const c of chunks) {
    out.set(c, o);
    o += c.length;
  }
  return out;
}

/**
 * Download the barcode as a PNG at actual size (1.52 × 1.07 in). 8 px per
 * bar width = 615 dpi, so it stays sharp; the DPI is stamped in the file.
 */
export async function downloadBarcodePng(svg: string, fileName: string, pxPerModule = 8) {
  const img = new Image();
  const src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
  await new Promise<void>((resolve, reject) => {
    img.onload = () => resolve();
    img.onerror = () => reject(new Error("Could not draw the barcode"));
    img.src = src;
  });
  const canvas = document.createElement("canvas");
  canvas.width = WIDTH * pxPerModule;
  canvas.height = HEIGHT * pxPerModule;
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/png"));
  if (!blob) return;
  const png = setPngDpi(new Uint8Array(await blob.arrayBuffer()), pxPerModule / MODULE_IN);
  const url = URL.createObjectURL(new Blob([png as BlobPart], { type: "image/png" }));
  triggerDownload(url, `${fileName}.png`);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/**
 * Print the barcode at actual size (1.52 × 1.07 in) — no pop-up window, the
 * browser's print dialog opens straight away. Printing at 100% / "Actual
 * size" (the browser default) keeps it true to size.
 */
export function printBarcode(svg: string, caption: string) {
  const frame = document.createElement("iframe");
  frame.style.position = "fixed";
  frame.style.width = "0";
  frame.style.height = "0";
  frame.style.border = "0";
  frame.style.right = "0";
  frame.style.bottom = "0";
  document.body.appendChild(frame);
  const doc = frame.contentDocument;
  const win = frame.contentWindow;
  if (!doc || !win) {
    frame.remove();
    return;
  }
  const esc = (t: string) => t.replace(/[&<>"]/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[ch] as string);
  doc.open();
  doc.write(
    `<!doctype html><html><head><title>${esc(caption)}</title><style>` +
      `@page{size:auto;margin:0.5in}html,body{margin:0;padding:0;background:#fff}` +
      `svg{display:block;width:${BARCODE_WIDTH_IN.toFixed(3)}in;height:${BARCODE_HEIGHT_IN.toFixed(3)}in}` +
      `</style></head><body>${svg}</body></html>`,
  );
  doc.close();
  setTimeout(() => {
    win.focus();
    win.print();
    setTimeout(() => frame.remove(), 1000);
  }, 100);
}
