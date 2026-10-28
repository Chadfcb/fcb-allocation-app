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
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${WIDTH} ${HEIGHT}" width="${WIDTH * 3}" height="${HEIGHT * 3}" shape-rendering="crispEdges">` +
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

/**
 * Download the barcode as a PNG. 8 px per module ≈ 600 dpi at the standard
 * UPC size (1.47" wide), so it stays sharp when printed at 100%.
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
  const url = URL.createObjectURL(blob);
  triggerDownload(url, `${fileName}.png`);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
