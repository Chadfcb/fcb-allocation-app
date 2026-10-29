import type { SupabaseClient } from "@supabase/supabase-js";

// Email Studio's Creative Library — upload helper shared by the library page
// and the email designer (added 2026-10-29). Files go to the public
// "creative-assets" storage bucket (so images show inside sent emails) and
// get a row in creative_assets. Browser-side only (uses File / Image).

export const CREATIVE_BUCKET = "creative-assets";
export const MAX_ASSET_BYTES = 50 * 1024 * 1024; // Supabase's default per-file limit

export type CreativeAsset = {
  id: string;
  name: string;
  storage_path: string;
  public_url: string;
  mime_type: string | null;
  size_bytes: number | null;
  width: number | null;
  height: number | null;
  source: string;
  created_by: string | null;
  created_at: string;
};

const IMAGE_TYPES = ["image/png", "image/jpeg", "image/gif", "image/webp", "image/svg+xml"];

export function isWebImage(a: { mime_type: string | null; name: string }): boolean {
  if (a.mime_type && IMAGE_TYPES.includes(a.mime_type)) return true;
  return /\.(png|jpe?g|gif|webp|svg)$/i.test(a.name);
}

export function kindOf(a: { mime_type: string | null; name: string }): "image" | "gif" | "psd" | "video" | "pdf" | "file" {
  const n = a.name.toLowerCase();
  if (a.mime_type === "image/gif" || n.endsWith(".gif")) return "gif";
  if (isWebImage(a)) return "image";
  if (n.endsWith(".psd") || a.mime_type === "image/vnd.adobe.photoshop") return "psd";
  if (a.mime_type?.startsWith("video/") || /\.(mp4|mov|webm)$/.test(n)) return "video";
  if (a.mime_type === "application/pdf" || n.endsWith(".pdf")) return "pdf";
  return "file";
}

export function formatBytes(n: number | null): string {
  if (!n && n !== 0) return "";
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${Math.round(n / 1024)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

function safeName(name: string): string {
  const dot = name.lastIndexOf(".");
  const base = (dot > 0 ? name.slice(0, dot) : name).replace(/[^a-zA-Z0-9-_]+/g, "-").replace(/-+/g, "-").slice(0, 60) || "file";
  const ext = dot > 0 ? name.slice(dot + 1).replace(/[^a-zA-Z0-9]/g, "").toLowerCase().slice(0, 8) : "";
  return ext ? `${base}.${ext}` : base;
}

async function imageSize(file: File): Promise<{ width: number; height: number } | null> {
  if (!file.type.startsWith("image/") || file.type === "image/vnd.adobe.photoshop") return null;
  return new Promise((resolve) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      resolve({ width: img.naturalWidth, height: img.naturalHeight });
      URL.revokeObjectURL(url);
    };
    img.onerror = () => {
      resolve(null);
      URL.revokeObjectURL(url);
    };
    img.src = url;
  });
}

/** Uploads one file to the Creative Library and returns its new row. */
export async function uploadCreativeAsset(supabase: SupabaseClient, file: File): Promise<CreativeAsset> {
  if (file.size > MAX_ASSET_BYTES) throw new Error(`${file.name} is over 50 MB.`);
  const now = new Date();
  const path = `${now.getFullYear()}/${String(now.getMonth() + 1).padStart(2, "0")}/${crypto.randomUUID()}-${safeName(file.name)}`;

  const { error: upErr } = await supabase.storage.from(CREATIVE_BUCKET).upload(path, file, {
    contentType: file.type || undefined,
    cacheControl: "31536000",
    upsert: false,
  });
  if (upErr) throw new Error(`${file.name}: ${upErr.message}`);

  const publicUrl = supabase.storage.from(CREATIVE_BUCKET).getPublicUrl(path).data.publicUrl;
  const size = await imageSize(file);
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { data, error } = await supabase
    .from("creative_assets")
    .insert({
      name: file.name,
      storage_path: path,
      public_url: publicUrl,
      mime_type: file.type || (file.name.toLowerCase().endsWith(".psd") ? "image/vnd.adobe.photoshop" : null),
      size_bytes: file.size,
      width: size?.width ?? null,
      height: size?.height ?? null,
      source: "upload",
      created_by: user?.id ?? null,
    })
    .select("*")
    .single();
  if (error || !data) {
    await supabase.storage.from(CREATIVE_BUCKET).remove([path]);
    throw new Error(`${file.name}: ${error?.message ?? "couldn't save"}`);
  }
  return data as CreativeAsset;
}
