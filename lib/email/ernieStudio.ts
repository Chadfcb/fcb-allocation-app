import { randomUUID } from "node:crypto";
import type { createAdminClient } from "@/lib/supabase/admin";

type Admin = ReturnType<typeof createAdminClient>;

// Ernie inside Email Studio (added 2026-10-30, per Chad: "we need to do ernie
// and canva now" … "execute"). Server-only. Same Google AI models and the
// same GEMINI_API_KEY Ernie's chat already uses (lib/ernie/files.ts) — no new
// account — but results go straight into the Creative Library (public
// creative-assets bucket + creative_assets row, source 'ernie') instead of
// an Ernie chat, so Eddie can drop them into an email.
//
// Every use costs real money, so there's a monthly safety cap (Chad approved
// 100 images + 10 animations a month) checked on the server before anything
// is sent to Google, and a usage counter in the panel.

export const MONTHLY_IMAGE_CAP = 100; // new + edited images together
export const MONTHLY_ANIMATION_CAP = 10;

// Estimates for the usage counter (Google's Gemini API price list, checked
// 2026-10-30: $0.134 per 1K/2K image, $0.24 per 4K image). Veo animation
// pricing wasn't confirmed — estimate $0.40 per second (an 8-second clip ≈
// $3.20); update if Google's bill says otherwise.
export const COST_IMAGE_STANDARD = 0.134;
export const COST_IMAGE_HIGH = 0.24;
export const COST_VIDEO_PER_SECOND = 0.4;

const GEMINI_IMAGE_MODEL = "gemini-3-pro-image-preview";
const GEMINI_VIDEO_MODEL = "veo-3.1-generate-preview";
const GEMINI_API_BASE = "https://generativelanguage.googleapis.com/v1beta";
const TIMEOUT_MS = 90000;
const BUCKET = "creative-assets";
const EDITABLE_TYPES = ["image/png", "image/jpeg", "image/webp"];

export const ASPECTS = ["1:1", "16:9", "4:3", "3:4", "4:5", "9:16"] as const;
export type Aspect = (typeof ASPECTS)[number];

function apiKey(): string {
  const k = process.env.GEMINI_API_KEY;
  if (!k) throw new Error("Ernie's image tools aren't set up on the server (GEMINI_API_KEY missing).");
  return k;
}

/** Start of this month in Pacific time. */
function monthStart(now = new Date()): string {
  const p = Object.fromEntries(
    new Intl.DateTimeFormat("en-US", { timeZone: "America/Los_Angeles", year: "numeric", month: "2-digit" })
      .formatToParts(now)
      .map((x) => [x.type, x.value]),
  );
  // 08:00 UTC on the 1st is midnight (PST) or 1am (PDT) in Fresno; step back
  // by whatever Pacific hour that is to land exactly on midnight.
  const guess = new Date(Date.UTC(+p.year, +p.month - 1, 1, 8, 0, 0));
  const h = +new Intl.DateTimeFormat("en-US", { timeZone: "America/Los_Angeles", hour: "2-digit", hour12: false }).format(guess) % 24;
  return new Date(guess.getTime() - h * 3600000).toISOString();
}

export type Usage = {
  images: number;
  animations: number;
  imageCap: number;
  animationCap: number;
  costEstimate: number;
};

export async function monthlyUsage(admin: Admin): Promise<Usage> {
  const { data } = await admin
    .from("creative_ernie_jobs")
    .select("kind, status, cost_estimate")
    .gte("created_at", monthStart())
    .in("status", ["pending", "done"]);
  let images = 0;
  let animations = 0;
  let cost = 0;
  for (const r of data ?? []) {
    if (r.kind === "animate") animations++;
    else images++;
    cost += Number(r.cost_estimate) || 0;
  }
  return { images, animations, imageCap: MONTHLY_IMAGE_CAP, animationCap: MONTHLY_ANIMATION_CAP, costEstimate: Math.round(cost * 100) / 100 };
}

async function loadSourceImage(admin: Admin, assetId: string): Promise<{ buffer: Buffer; mime: string; name: string; id: string }> {
  const { data: a } = await admin.from("creative_assets").select("id, name, storage_path, mime_type").eq("id", assetId).maybeSingle();
  if (!a) throw new Error("That image isn't in the Creative Library anymore.");
  const mime = a.mime_type || "";
  if (!EDITABLE_TYPES.includes(mime)) throw new Error("Ernie can only work from PNG, JPG or WebP images.");
  const { data, error } = await admin.storage.from(BUCKET).download(a.storage_path);
  if (error || !data) throw new Error("Couldn't load that image.");
  return { buffer: Buffer.from(await data.arrayBuffer()), mime, name: a.name, id: a.id };
}

function safeBase(s: string): string {
  return (
    s
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 40) || "ernie"
  );
}

async function saveToLibrary(
  admin: Admin,
  opts: { buffer: Buffer; mime: string; name: string; createdBy: string; width?: number | null; height?: number | null },
) {
  const now = new Date();
  const ext = opts.mime === "image/jpeg" ? "jpg" : opts.mime === "video/mp4" ? "mp4" : opts.mime.split("/")[1] || "png";
  const fileName = `${safeBase(opts.name)}.${ext}`;
  const path = `${now.getUTCFullYear()}/${String(now.getUTCMonth() + 1).padStart(2, "0")}/${randomUUID()}-${fileName}`;
  const { error: upErr } = await admin.storage.from(BUCKET).upload(path, opts.buffer, { contentType: opts.mime, upsert: false });
  if (upErr) throw new Error(`Made it, but couldn't save it to the Creative Library: ${upErr.message}`);
  const { data: pub } = admin.storage.from(BUCKET).getPublicUrl(path);
  const { data: row, error } = await admin
    .from("creative_assets")
    .insert({
      name: fileName,
      storage_path: path,
      public_url: pub.publicUrl,
      mime_type: opts.mime,
      size_bytes: opts.buffer.length,
      width: opts.width ?? null,
      height: opts.height ?? null,
      source: "ernie",
      created_by: opts.createdBy,
    })
    .select("*")
    .single();
  if (error || !row) {
    await admin.storage.from(BUCKET).remove([path]);
    throw new Error(`Made it, but couldn't add it to the Creative Library: ${error?.message}`);
  }
  return row;
}

/** Reads width/height from a PNG or JPEG header (no extra packages). */
function imageDims(buf: Buffer): { width: number; height: number } | null {
  if (buf.length > 24 && buf.readUInt32BE(0) === 0x89504e47) return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
  if (buf[0] === 0xff && buf[1] === 0xd8) {
    let i = 2;
    while (i < buf.length - 9) {
      if (buf[i] !== 0xff) {
        i++;
        continue;
      }
      const marker = buf[i + 1];
      const len = buf.readUInt16BE(i + 2);
      if (marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker)) {
        return { height: buf.readUInt16BE(i + 5), width: buf.readUInt16BE(i + 7) };
      }
      i += 2 + len;
    }
  }
  return null;
}

type GeminiPart = { text?: string; inlineData?: { mimeType: string; data: string } };

async function callGeminiImage(parts: GeminiPart[], aspect: Aspect | null, high: boolean): Promise<{ buffer: Buffer; mime: string }> {
  const send = async (withConfig: boolean) =>
    fetch(`${GEMINI_API_BASE}/models/${GEMINI_IMAGE_MODEL}:generateContent`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-goog-api-key": apiKey() },
      body: JSON.stringify({
        contents: [{ role: "user", parts }],
        generationConfig: {
          responseModalities: ["TEXT", "IMAGE"],
          ...(withConfig ? { imageConfig: { ...(aspect ? { aspectRatio: aspect } : {}), imageSize: high ? "4K" : "2K" } } : {}),
        },
      }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  let res: Response;
  try {
    res = await send(true);
    // If Google ever rejects the size/shape settings, try once without them.
    if (res.status === 400) {
      const t = await res.clone().text();
      if (/imageConfig|aspect|imageSize/i.test(t)) res = await send(false);
    }
  } catch (e) {
    throw new Error(e instanceof Error && e.name === "TimeoutError" ? "Ernie took too long — try again." : "Couldn't reach Ernie's image service.");
  }
  if (!res.ok) {
    const t = await res.text().catch(() => "");
    throw new Error(`Ernie couldn't make that image (HTTP ${res.status}). ${t.slice(0, 200)}`);
  }
  const json = await res.json();
  const out: GeminiPart[] = json?.candidates?.[0]?.content?.parts ?? [];
  const img = out.find((p) => p.inlineData?.data);
  if (!img?.inlineData) {
    const text = out.find((p) => p.text)?.text;
    throw new Error(text ? `Ernie didn't make an image: ${text.slice(0, 250)}` : "Ernie didn't make an image — try describing it differently.");
  }
  return { buffer: Buffer.from(img.inlineData.data, "base64"), mime: img.inlineData.mimeType || "image/png" };
}

async function assertUnderCap(admin: Admin, kind: "image" | "animation") {
  const u = await monthlyUsage(admin);
  if (kind === "image" && u.images >= u.imageCap) {
    throw new Error(`This month's limit of ${u.imageCap} Ernie images is used up. It resets on the 1st.`);
  }
  if (kind === "animation" && u.animations >= u.animationCap) {
    throw new Error(`This month's limit of ${u.animationCap} Ernie animations is used up. It resets on the 1st.`);
  }
}

/** Create a brand-new image, or edit one from the Creative Library. */
export async function ernieImage(
  admin: Admin,
  userId: string,
  opts: { prompt: string; sourceAssetId?: string | null; aspect?: Aspect | null; high?: boolean },
) {
  const prompt = opts.prompt.trim();
  if (!prompt) throw new Error("Describe what you want.");
  await assertUnderCap(admin, "image");

  const parts: GeminiPart[] = [];
  let source: Awaited<ReturnType<typeof loadSourceImage>> | null = null;
  if (opts.sourceAssetId) {
    source = await loadSourceImage(admin, opts.sourceAssetId);
    parts.push({ inlineData: { mimeType: source.mime, data: source.buffer.toString("base64") } });
  }
  parts.push({ text: prompt });

  const cost = opts.high ? COST_IMAGE_HIGH : COST_IMAGE_STANDARD;
  const { data: job } = await admin
    .from("creative_ernie_jobs")
    .insert({
      kind: source ? "edit" : "create",
      prompt,
      source_asset_id: source?.id ?? null,
      settings: { aspect: opts.aspect ?? null, high: !!opts.high },
      cost_estimate: cost,
      created_by: userId,
    })
    .select("id")
    .single();

  try {
    const img = await callGeminiImage(parts, source ? null : opts.aspect ?? null, !!opts.high);
    const dims = imageDims(img.buffer);
    const baseName = source ? `${source.name.replace(/\.[^.]+$/, "")}-ernie-edit` : `ernie-${prompt.split(/\s+/).slice(0, 5).join(" ")}`;
    const asset = await saveToLibrary(admin, { buffer: img.buffer, mime: img.mime, name: baseName, createdBy: userId, ...dims });
    if (job) await admin.from("creative_ernie_jobs").update({ status: "done", result_asset_id: asset.id, updated_at: new Date().toISOString() }).eq("id", job.id);
    return asset;
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    // A failed attempt doesn't count toward the cap (Google doesn't bill a refusal/error).
    if (job) await admin.from("creative_ernie_jobs").update({ status: "error", error: msg.slice(0, 500), cost_estimate: 0, updated_at: new Date().toISOString() }).eq("id", job.id);
    throw e;
  }
}

/** Start animating a Creative Library image. Returns the job id; check with checkAnimation. */
export async function startAnimation(
  admin: Admin,
  userId: string,
  opts: { prompt: string; sourceAssetId: string; seconds: 4 | 6 | 8; tall: boolean },
): Promise<string> {
  const prompt = opts.prompt.trim();
  if (!prompt) throw new Error("Describe the motion you want.");
  await assertUnderCap(admin, "animation");
  const source = await loadSourceImage(admin, opts.sourceAssetId);

  let res: Response;
  try {
    res = await fetch(`${GEMINI_API_BASE}/models/${GEMINI_VIDEO_MODEL}:predictLongRunning`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-goog-api-key": apiKey() },
      body: JSON.stringify({
        instances: [{ prompt, image: { bytesBase64Encoded: source.buffer.toString("base64"), mimeType: source.mime } }],
        parameters: { aspectRatio: opts.tall ? "9:16" : "16:9", durationSeconds: opts.seconds },
      }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch {
    throw new Error("Couldn't reach Ernie's animation service — try again.");
  }
  if (!res.ok) {
    const t = await res.text().catch(() => "");
    throw new Error(`Ernie couldn't start that animation (HTTP ${res.status}). ${t.slice(0, 200)}`);
  }
  const op: string | undefined = (await res.json())?.name;
  if (!op) throw new Error("Ernie's animation service didn't return a job — try again.");

  const { data: job, error } = await admin
    .from("creative_ernie_jobs")
    .insert({
      kind: "animate",
      prompt,
      source_asset_id: source.id,
      operation_name: op,
      settings: { seconds: opts.seconds, tall: opts.tall },
      cost_estimate: opts.seconds * COST_VIDEO_PER_SECOND,
      created_by: userId,
    })
    .select("id")
    .single();
  if (error || !job) throw new Error(`Started, but couldn't keep track of it: ${error?.message}`);
  return job.id;
}

/** Checks a rendering animation; when Google is done, saves the video to the Creative Library. */
export async function checkAnimation(
  admin: Admin,
  jobId: string,
): Promise<{ status: "pending" } | { status: "error"; error: string } | { status: "done"; asset: Record<string, unknown>; posterAssetId: string | null }> {
  const { data: job } = await admin
    .from("creative_ernie_jobs")
    .select("id, kind, status, operation_name, result_asset_id, source_asset_id, error, created_by, prompt")
    .eq("id", jobId)
    .maybeSingle();
  if (!job || job.kind !== "animate") return { status: "error", error: "Not found." };
  if (job.status === "error") return { status: "error", error: job.error || "That animation failed." };
  if (job.status === "done" && job.result_asset_id) {
    const { data: a } = await admin.from("creative_assets").select("*").eq("id", job.result_asset_id).maybeSingle();
    if (a) return { status: "done", asset: a, posterAssetId: job.source_asset_id };
  }

  let res: Response;
  try {
    res = await fetch(`${GEMINI_API_BASE}/${job.operation_name}`, { headers: { "x-goog-api-key": apiKey() }, signal: AbortSignal.timeout(30000) });
  } catch {
    return { status: "pending" };
  }
  if (!res.ok) return { status: "pending" };
  const json = await res.json();
  if (!json.done) return { status: "pending" };

  const uri: string | undefined = json?.response?.generateVideoResponse?.generatedSamples?.[0]?.video?.uri;
  if (!uri) {
    const msg = json?.error?.message || "The animation finished without a video.";
    await admin.from("creative_ernie_jobs").update({ status: "error", error: msg.slice(0, 500), cost_estimate: 0, updated_at: new Date().toISOString() }).eq("id", jobId);
    return { status: "error", error: msg };
  }
  let vid: Response;
  try {
    vid = await fetch(uri, { headers: { "x-goog-api-key": apiKey() } });
  } catch {
    return { status: "pending" };
  }
  if (!vid.ok) return { status: "pending" };
  const buffer = Buffer.from(await vid.arrayBuffer());

  // Another check may have saved it a moment ago — don't save twice.
  const { data: again } = await admin.from("creative_ernie_jobs").select("status, result_asset_id").eq("id", jobId).maybeSingle();
  if (again?.status === "done" && again.result_asset_id) {
    const { data: a } = await admin.from("creative_assets").select("*").eq("id", again.result_asset_id).maybeSingle();
    if (a) return { status: "done", asset: a, posterAssetId: job.source_asset_id };
  }

  const asset = await saveToLibrary(admin, {
    buffer,
    mime: "video/mp4",
    name: `ernie-animation-${job.prompt.split(/\s+/).slice(0, 4).join(" ")}`,
    createdBy: job.created_by,
  });
  await admin.from("creative_ernie_jobs").update({ status: "done", result_asset_id: asset.id, updated_at: new Date().toISOString() }).eq("id", jobId);
  return { status: "done", asset, posterAssetId: job.source_asset_id };
}
