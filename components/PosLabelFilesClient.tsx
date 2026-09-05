"use client";

// POS > Labels > <brand> > <size> — a per-brand, per-size file library for
// can/bottle label artwork. Admin-only, standing data (not week-scoped).
// Same file-library concept as the Events Calendar POS Library, just scoped
// to one brand+size combination instead of one shared pool, and with an
// explicit inline preview + forced download (not just "open in a new tab").

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { logChange } from "@/lib/audit";
import type { PosLabelBrand, PosLabelFile, PosLabelSize } from "@/lib/types/db";
import {
  fileIcon,
  formatBytes,
  isImageFile,
  storageFileName,
} from "@/lib/events";
import {
  POS_LABEL_BRAND_LABELS,
  POS_LABEL_FILES_BUCKET,
  POS_LABEL_SIZE_LABELS,
} from "@/lib/posLabels";

export default function PosLabelFilesClient({
  brand,
  size,
}: {
  brand: PosLabelBrand;
  size: PosLabelSize;
}) {
  const supabase = useMemo(() => createClient(), []);

  const [files, setFiles] = useState<PosLabelFile[]>([]);
  const [userId, setUserId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [signedUrls, setSignedUrls] = useState<Record<string, string>>({});
  const [previewFile, setPreviewFile] = useState<PosLabelFile | null>(null);
  const [downloadingPath, setDownloadingPath] = useState<string | null>(null);

  const fileInputRef = useRef<HTMLInputElement | null>(null);

  // The path to actually show as a thumbnail/preview image for a file.
  // Prefers the generated preview JPG (works for .psd and anything else
  // browsers can't render directly, and exists even for Drive-link
  // entries); falls back to the original file itself only when it's
  // already a browser-displayable image type with no separate preview.
  function previewSourcePath(f: PosLabelFile): string | null {
    if (f.preview_path) return f.preview_path;
    if (f.storage_path && isImageFile(f.file_name)) return f.storage_path;
    return null;
  }

  const load = useCallback(async () => {
    const {
      data: { user },
    } = await supabase.auth.getUser();
    setUserId(user?.id ?? null);

    const { data } = await supabase
      .from("pos_label_files")
      .select("*")
      .eq("brand", brand)
      .eq("size", size)
      .order("uploaded_at", { ascending: false });

    setFiles((data as PosLabelFile[]) ?? []);
    setLoading(false);
  }, [supabase, brand, size]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- intentional fetch-on-mount
    load();
    const channel = supabase
      .channel(`pos-label-files-${brand}-${size}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "pos_label_files" },
        () => load(),
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [supabase, load, brand, size]);

  // Lazily fetch signed URLs only for files currently on screen (image
  // thumbnails + whatever's open in the preview modal), same approach as
  // the Events Calendar library.
  useEffect(() => {
    const paths = new Set(
      files
        .map((f) => previewSourcePath(f))
        .filter((p): p is string => !!p),
    );
    const previewFilePath = previewFile ? previewSourcePath(previewFile) : null;
    if (previewFilePath) paths.add(previewFilePath);
    const missing = Array.from(paths).filter((p) => !signedUrls[p]);
    if (!missing.length) return;
    (async () => {
      const entries = await Promise.all(
        missing.map(async (p) => {
          const { data } = await supabase.storage
            .from(POS_LABEL_FILES_BUCKET)
            .createSignedUrl(p, 300);
          return [p, data?.signedUrl ?? ""] as const;
        }),
      );
      setSignedUrls((prev) => {
        const next = { ...prev };
        for (const [p, url] of entries) if (url) next[p] = url;
        return next;
      });
    })();
  }, [files, previewFile, signedUrls, supabase]);

  async function ensureSignedUrl(path: string): Promise<string> {
    if (signedUrls[path]) return signedUrls[path];
    const { data } = await supabase.storage
      .from(POS_LABEL_FILES_BUCKET)
      .createSignedUrl(path, 300);
    const url = data?.signedUrl ?? "";
    if (url) setSignedUrls((prev) => ({ ...prev, [path]: url }));
    return url;
  }

  async function handleUpload(fileList: FileList) {
    if (!userId || !fileList.length) return;
    setUploading(true);
    for (const file of Array.from(fileList)) {
      const path = `${brand}/${size}/${storageFileName(file.name)}`;
      const { error: uploadError } = await supabase.storage
        .from(POS_LABEL_FILES_BUCKET)
        .upload(path, file);
      if (uploadError) continue;
      await supabase.from("pos_label_files").insert({
        brand,
        size,
        file_name: file.name,
        storage_path: path,
        mime_type: file.type || null,
        size_bytes: file.size,
        uploaded_by: userId,
      });
    }
    await logChange(supabase, {
      weekId: null,
      tableName: "pos_label_files",
      recordId: userId,
      fieldName: `${brand}/${size}`,
      oldValue: null,
      newValue: `${fileList.length} file(s) added`,
      changedBy: userId,
    });
    setUploading(false);
    await load();
  }

  async function handleDelete(f: PosLabelFile) {
    if (!userId) return;
    if (!window.confirm(`Delete "${f.file_name}"? This can't be undone.`))
      return;
    if (f.storage_path) {
      await supabase.storage
        .from(POS_LABEL_FILES_BUCKET)
        .remove([f.storage_path]);
    }
    await supabase.from("pos_label_files").delete().eq("id", f.id);
    await logChange(supabase, {
      weekId: null,
      tableName: "pos_label_files",
      recordId: f.id,
      fieldName: `${brand}/${size}`,
      oldValue: f.file_name,
      newValue: null,
      changedBy: userId,
    });
    if (previewFile?.id === f.id) setPreviewFile(null);
    await load();
  }

  async function handleDownload(f: PosLabelFile) {
    if (!f.storage_path) {
      // External link (file too large to store directly) — just open it.
      if (f.external_url) window.open(f.external_url, "_blank", "noopener,noreferrer");
      return;
    }
    setDownloadingPath(f.storage_path);
    try {
      const url = await ensureSignedUrl(f.storage_path);
      if (!url) return;
      // Fetch as a blob and trigger the save via an object URL rather than
      // just navigating to the signed URL — a plain link can end up just
      // opening the file in-tab (images/PDFs) instead of downloading it.
      const res = await fetch(url);
      const blob = await res.blob();
      const objectUrl = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = objectUrl;
      a.download = f.file_name;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(objectUrl);
    } finally {
      setDownloadingPath(null);
    }
  }

  async function openPreview(f: PosLabelFile) {
    setPreviewFile(f);
    const path = previewSourcePath(f);
    if (path) await ensureSignedUrl(path);
  }

  if (loading) return <p className="text-sm text-neutral-400">Loading…</p>;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-lg font-semibold text-neutral-100">
            {POS_LABEL_BRAND_LABELS[brand]} — {POS_LABEL_SIZE_LABELS[size]}
          </h1>
          <p className="text-sm text-neutral-500">
            {files.length} file{files.length === 1 ? "" : "s"}
          </p>
        </div>
        <input
          ref={fileInputRef}
          type="file"
          multiple
          className="hidden"
          onChange={(e) => {
            if (e.target.files?.length) handleUpload(e.target.files);
            e.target.value = "";
          }}
        />
        <button
          type="button"
          onClick={() => fileInputRef.current?.click()}
          disabled={uploading}
          className="rounded-md bg-white px-3 py-1.5 text-sm font-medium text-black hover:bg-neutral-200 disabled:opacity-50"
        >
          {uploading ? "Uploading…" : "+ Upload Files"}
        </button>
      </div>

      {files.length === 0 ? (
        <p className="py-10 text-center text-sm text-neutral-500">
          No label files yet for {POS_LABEL_BRAND_LABELS[brand]} —{" "}
          {POS_LABEL_SIZE_LABELS[size]}. Upload some to get started.
        </p>
      ) : (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5">
          {files.map((f) => (
            <div
              key={f.id}
              className="flex flex-col overflow-hidden rounded-lg border border-neutral-800 bg-neutral-950"
            >
              <button
                type="button"
                onClick={() => openPreview(f)}
                className="flex h-28 items-center justify-center overflow-hidden bg-neutral-900 text-3xl"
              >
                {previewSourcePath(f) && signedUrls[previewSourcePath(f) as string] ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={signedUrls[previewSourcePath(f) as string]}
                    alt=""
                    className="h-full w-full object-cover"
                  />
                ) : (
                  fileIcon(f.file_name)
                )}
              </button>
              <div className="p-2">
                <div
                  className="truncate text-xs text-neutral-200"
                  title={f.file_name}
                >
                  {f.file_name}
                </div>
                <div className="text-[10px] uppercase tracking-wide text-neutral-500">
                  {f.storage_path
                    ? formatBytes(f.size_bytes)
                    : "Too large — Drive link"}
                </div>
              </div>
              <div className="flex border-t border-neutral-800 text-[11px] font-semibold uppercase tracking-wide">
                <button
                  type="button"
                  onClick={() => openPreview(f)}
                  className="flex-1 border-r border-neutral-800 py-1.5 text-neutral-400 hover:bg-neutral-900 hover:text-white"
                >
                  Preview
                </button>
                <button
                  type="button"
                  onClick={() => handleDownload(f)}
                  disabled={
                    !!f.storage_path && downloadingPath === f.storage_path
                  }
                  className="flex-1 border-r border-neutral-800 py-1.5 text-neutral-400 hover:bg-neutral-900 hover:text-white disabled:opacity-50"
                >
                  {f.storage_path
                    ? downloadingPath === f.storage_path
                      ? "…"
                      : "Download"
                    : "Drive Link"}
                </button>
                <button
                  type="button"
                  onClick={() => handleDelete(f)}
                  className="flex-1 py-1.5 text-neutral-400 hover:bg-neutral-900 hover:text-red-400"
                >
                  ✕
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {previewFile && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-8"
          onClick={() => setPreviewFile(null)}
        >
          <div
            className="flex max-h-full w-full max-w-3xl flex-col overflow-hidden rounded-lg border border-neutral-700 bg-neutral-950"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between border-b border-neutral-800 px-4 py-3">
              <span
                className="truncate text-sm font-medium text-neutral-100"
                title={previewFile.file_name}
              >
                {previewFile.file_name}
              </span>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => handleDownload(previewFile)}
                  className="rounded-md border border-neutral-700 px-2 py-1 text-xs text-neutral-300 hover:bg-neutral-900"
                >
                  {previewFile.storage_path ? "Download" : "Open Drive Link"}
                </button>
                <button
                  type="button"
                  onClick={() => setPreviewFile(null)}
                  className="rounded-md border border-neutral-700 px-2 py-1 text-xs text-neutral-300 hover:bg-neutral-900"
                >
                  Close
                </button>
              </div>
            </div>
            <div className="flex flex-1 items-center justify-center overflow-auto bg-neutral-900 p-4">
              {(() => {
                const path = previewSourcePath(previewFile);
                if (path) {
                  return signedUrls[path] ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={signedUrls[path]}
                      alt={previewFile.file_name}
                      className="max-h-[70vh] max-w-full object-contain"
                    />
                  ) : (
                    <p className="text-sm text-neutral-500">Loading preview…</p>
                  );
                }
                if (!previewFile.storage_path) {
                  return (
                    <div className="flex flex-col items-center gap-3 py-10 text-center">
                      <span className="text-5xl">
                        {fileIcon(previewFile.file_name)}
                      </span>
                      <p className="text-sm text-neutral-400">
                        This file is too large to store directly — it lives on
                        Google Drive instead. Use &quot;Open Drive Link&quot;
                        above to view or download it.
                      </p>
                    </div>
                  );
                }
                if (
                  previewFile.file_name.toLowerCase().endsWith(".pdf") &&
                  signedUrls[previewFile.storage_path]
                ) {
                  return (
                    <iframe
                      src={signedUrls[previewFile.storage_path]}
                      title={previewFile.file_name}
                      className="h-[70vh] w-full"
                    />
                  );
                }
                return (
                  <div className="flex flex-col items-center gap-3 py-10 text-center">
                    <span className="text-5xl">
                      {fileIcon(previewFile.file_name)}
                    </span>
                    <p className="text-sm text-neutral-400">
                      No inline preview for this file type — use Download to
                      open it.
                    </p>
                  </div>
                );
              })()}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
