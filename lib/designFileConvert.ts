// Photoshop / Illustrator → email-ready PNG (added 2026-10-30, per Chad: "what
// about photoshop, and or adope illustrator files, can those also be used?"
// → "yes"). Email apps can only show PNG/JPG/GIF, so when Eddie drops a .psd
// or .ai into the Creative Library, his browser makes a flat PNG copy next to
// it. Browser-only, free, nothing leaves his computer except the finished
// files. Both readers are loaded only when needed:
//   * Photoshop: ag-psd (MIT) reads the flattened picture Photoshop saves
//     inside the file when "Maximize Compatibility" is on (Photoshop's
//     default). Without it, the picture is rebuilt from the layers (normal
//     blending only — special blend modes/effects may differ a little).
//   * Illustrator: .ai files saved with "Create PDF Compatible File" (the
//     default) contain a PDF; pdf.js (Apache-2.0) draws its first page.
// It's a picture copy — layers and text aren't editable here.

export const MAX_EMAIL_WIDTH = 2400; // sharp on phones/retina without being huge

export type DesignKind = "photoshop" | "illustrator";

export function designKind(name: string, mime?: string | null): DesignKind | null {
  const n = name.toLowerCase();
  if (n.endsWith(".psd") || mime === "image/vnd.adobe.photoshop") return "photoshop";
  if (n.endsWith(".ai") || mime === "application/illustrator" || mime === "application/postscript") return "illustrator";
  return null;
}

function canvasToPng(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) =>
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("Couldn't make the PNG."))), "image/png"),
  );
}

/** Scales a canvas down so it's at most MAX_EMAIL_WIDTH wide. */
function fitWidth(src: HTMLCanvasElement): HTMLCanvasElement {
  if (src.width <= MAX_EMAIL_WIDTH) return src;
  const scale = MAX_EMAIL_WIDTH / src.width;
  const out = document.createElement("canvas");
  out.width = MAX_EMAIL_WIDTH;
  out.height = Math.max(1, Math.round(src.height * scale));
  const ctx = out.getContext("2d");
  if (!ctx) return src;
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(src, 0, 0, out.width, out.height);
  return out;
}

/** True when every sampled pixel is identical (a blank stand-in picture). */
function isBlank(canvas: HTMLCanvasElement): boolean {
  const ctx = canvas.getContext("2d");
  if (!ctx || canvas.width === 0 || canvas.height === 0) return true;
  const { data } = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const stepX = Math.max(1, Math.floor(canvas.width / 64));
  const stepY = Math.max(1, Math.floor(canvas.height / 64));
  const first = [data[0], data[1], data[2], data[3]].join(",");
  for (let y = 0; y < canvas.height; y += stepY) {
    for (let x = 0; x < canvas.width; x += stepX) {
      const i = (y * canvas.width + x) * 4;
      if (`${data[i]},${data[i + 1]},${data[i + 2]},${data[i + 3]}` !== first) return false;
    }
  }
  return true;
}

type PsdLayer = {
  hidden?: boolean;
  opacity?: number;
  left?: number;
  top?: number;
  canvas?: HTMLCanvasElement;
  children?: PsdLayer[];
};

/** Rebuilds the picture from the layers (normal blending only, so special
 *  blend modes/effects may look a little different). */
function drawLayers(ctx: CanvasRenderingContext2D, layers: PsdLayer[] | undefined, alpha: number) {
  for (const l of layers ?? []) {
    if (l.hidden) continue;
    const a = alpha * (l.opacity ?? 1);
    if (l.children) {
      drawLayers(ctx, l.children, a);
    } else if (l.canvas) {
      ctx.globalAlpha = a;
      ctx.drawImage(l.canvas, l.left ?? 0, l.top ?? 0);
    }
  }
  ctx.globalAlpha = 1;
}

async function photoshopToCanvas(data: ArrayBuffer): Promise<HTMLCanvasElement> {
  const { readPsd } = await import("ag-psd");
  const read = (withLayers: boolean) => {
    try {
      return readPsd(data, { skipLayerImageData: !withLayers, skipCompositeImageData: withLayers, skipThumbnail: true });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (/cmyk|color mode/i.test(msg)) {
        throw new Error("This Photoshop file is set up for print (CMYK). In Photoshop: Image → Mode → RGB Color, save, and upload again.");
      }
      throw new Error(`Couldn't read this Photoshop file (${msg.slice(0, 120)}).`);
    }
  };

  const psd = read(false);
  if (psd.canvas && !isBlank(psd.canvas as HTMLCanvasElement)) return psd.canvas as HTMLCanvasElement;

  // Saved without "Maximize Compatibility": no real flat picture inside.
  // Build one from the layers instead.
  const layered = read(true);
  const out = document.createElement("canvas");
  out.width = layered.width;
  out.height = layered.height;
  const ctx = out.getContext("2d");
  if (ctx && layered.children?.length) {
    drawLayers(ctx, layered.children as PsdLayer[], 1);
    if (!isBlank(out)) return out;
  }
  throw new Error(
    "Couldn't find a picture inside this Photoshop file. Re-save it with \"Maximize Compatibility\" on (or export a PNG) and upload again.",
  );
}

async function illustratorToCanvas(data: ArrayBuffer): Promise<HTMLCanvasElement> {
  const pdfjs = await import("pdfjs-dist");
  // Run pdf.js's worker code on the page itself (no separate worker file to host).
  const g = globalThis as unknown as { pdfjsWorker?: unknown };
  // @ts-expect-error -- pdf.js ships no type file for its worker bundle
  if (!g.pdfjsWorker) g.pdfjsWorker = await import("pdfjs-dist/build/pdf.worker.min.mjs");
  const task = pdfjs.getDocument({ data: new Uint8Array(data) });
  let doc;
  try {
    doc = await task.promise;
  } catch {
    throw new Error(
      "This Illustrator file was saved without \"Create PDF Compatible File\", so it can't be read here. Re-save it with that option checked (or export a PNG) and upload again.",
    );
  }
  const page = await doc.getPage(1);
  const base = page.getViewport({ scale: 1 });
  // Aim for MAX_EMAIL_WIDTH wide, but never more than 4x the artboard size.
  const scale = Math.min(4, MAX_EMAIL_WIDTH / base.width);
  const viewport = page.getViewport({ scale });
  const canvas = document.createElement("canvas");
  canvas.width = Math.ceil(viewport.width);
  canvas.height = Math.ceil(viewport.height);
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Your browser couldn't draw the Illustrator file.");
  await page.render({ canvas, canvasContext: ctx, viewport }).promise;
  await task.destroy();
  return canvas;
}

/** Makes an email-ready PNG File from a .psd or .ai, or throws a plain-English reason. */
export async function designFileToPng(file: Blob, name: string, mime?: string | null): Promise<File> {
  const kind = designKind(name, mime);
  if (!kind) throw new Error("Not a Photoshop or Illustrator file.");
  const data = await file.arrayBuffer();
  const canvas = fitWidth(kind === "photoshop" ? await photoshopToCanvas(data) : await illustratorToCanvas(data));
  const blob = await canvasToPng(canvas);
  const base = name.replace(/\.[^.]+$/, "");
  return new File([blob], `${base} (from ${kind === "photoshop" ? "Photoshop" : "Illustrator"}).png`, { type: "image/png" });
}
