"use client";

// Distributor Files (2026-11-12, per Chad: "in the localist section, id like a
// button at the top, that looks different from the others, where we can drag
// and drop files into it ... lets do that for all distributors").
// A wide dashed drop box at the top of every distributor page. Drop files on
// it (or on the pop-up) to save them to that distributor; click it to open the
// pop-up list with Preview / Download / Delete. Each distributor keeps its own
// files. Same storage pattern as POS → Sales Sheets.
// SQL: sql/distributor_files.sql (table distributor_files, bucket distributor-files).
//
// Sales Dashboard Files (2026-11-12, per Chad: "can we add the same thing to
// the sales dashboard, id like to throw files in there too"). Same box with
// dist = "Sales Dashboard", storage folder sales-dashboard/, gated by Sales
// Dashboard access. SQL: sql/sales_dashboard_files.sql.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { logChange } from "@/lib/audit";
import type { DistributorFile } from "@/lib/types/db";
import NewBadge from "@/components/NewBadge";
import { useNewFeature } from "@/lib/newFeatures";
import { fileExtension, fileIcon, formatBytes, isImageFile, storageFileName } from "@/lib/events";

export const DISTRIBUTOR_FILES_BUCKET = "distributor-files";
const PREVIEW_ROWS = 500;

type SheetPreview = { rows: string[][]; total: number };

function fmtWhen(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

function cellText(v: unknown): string {
  if (v === null || v === undefined) return "";
  if (v instanceof Date) return v.toLocaleDateString("en-US");
  if (typeof v === "object") {
    const o = v as Record<string, unknown>;
    if ("result" in o) return cellText(o.result);
    if ("text" in o) return String(o.text ?? "");
    if ("richText" in o && Array.isArray(o.richText)) return (o.richText as { text?: string }[]).map((r) => r.text ?? "").join("");
    if ("hyperlink" in o) return String(o.hyperlink ?? "");
    return "";
  }
  return String(v);
}

// Reads the first sheet of an .xlsx or a .csv into rows for the preview.
async function readSheet(blob: Blob, name: string): Promise<SheetPreview> {
  const ext = fileExtension(name);
  let rows: string[][] = [];
  if (ext === "csv") {
    const Papa = (await import("papaparse")).default;
    const parsed = Papa.parse<string[]>(await blob.text(), { skipEmptyLines: true });
    rows = parsed.data.map((r) => r.map((c) => String(c ?? "")));
  } else {
    const ExcelJS = (await import("exceljs")).default;
    const wb = new ExcelJS.Workbook();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await wb.xlsx.load((await blob.arrayBuffer()) as any);
    const ws = wb.worksheets[0];
    if (ws) {
      let width = 0;
      ws.eachRow((row) => {
        const vals = (row.values as unknown[]).slice(1).map(cellText);
        while (vals.length && !vals[vals.length - 1].trim()) vals.pop();
        if (!vals.some((v) => v.trim())) return;
        width = Math.max(width, vals.length);
        rows.push(vals);
      });
      rows = rows.map((r) => [...r, ...Array(Math.max(0, width - r.length)).fill("")]);
    }
  }
  return { rows: rows.slice(0, PREVIEW_ROWS + 1), total: Math.max(0, rows.length - 1) };
}

export default function DistributorFilesBox({
  dist,
  slug,
  viewerName,
  featureId,
}: {
  dist: string; // whose files: a distributor name, or "Sales Dashboard"
  slug: string; // storage folder: the page slug (the-localist, sales-dashboard)
  viewerName: string | null;
  featureId?: string; // New! tag id (default: feature:dist-files-<slug>)
}) {
  const supabase = useMemo(() => createClient(), []);
  const [files, setFiles] = useState<DistributorFile[]>([]);
  const [loading, setLoading] = useState(true);
  const [userId, setUserId] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [uploading, setUploading] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ text: string; bad: boolean } | null>(null);
  const [preview, setPreview] = useState<DistributorFile | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [sheet, setSheet] = useState<SheetPreview | null>(null);
  const [previewErr, setPreviewErr] = useState<string | null>(null);
  const [downloadingId, setDownloadingId] = useState<string | null>(null);
  const dragDepth = useRef(0);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const isNew = useNewFeature(featureId ?? `feature:dist-files-${slug}`);

  const load = useCallback(async () => {
    const {
      data: { user },
    } = await supabase.auth.getUser();
    setUserId(user?.id ?? null);
    const { data } = await supabase
      .from("distributor_files")
      .select("*")
      .eq("dist", dist)
      .order("uploaded_at", { ascending: false });
    setFiles((data as DistributorFile[]) ?? []);
    setLoading(false);
  }, [supabase, dist]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- intentional fetch-on-mount
    load();
    const channel = supabase
      .channel(`distributor-files-${slug}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "distributor_files" }, () => load())
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [supabase, load, slug]);

  async function upload(list: FileList | File[]) {
    const all = Array.from(list);
    if (!all.length || !userId) return;
    isNew.dismiss();
    setMsg(null);
    const failed: string[] = [];
    let saved = 0;
    for (let i = 0; i < all.length; i++) {
      const file = all[i];
      setUploading(all.length > 1 ? `Uploading ${i + 1} of ${all.length}…` : `Uploading ${file.name}…`);
      const path = `${slug}/${storageFileName(file.name)}`;
      const { error: upErr } = await supabase.storage.from(DISTRIBUTOR_FILES_BUCKET).upload(path, file);
      if (upErr) {
        failed.push(`${file.name} (${upErr.message})`);
        continue;
      }
      const { error: rowErr } = await supabase.from("distributor_files").insert({
        dist,
        file_name: file.name,
        storage_path: path,
        mime_type: file.type || null,
        size_bytes: file.size,
        uploaded_by: userId,
        uploaded_by_name: viewerName,
      });
      if (rowErr) {
        await supabase.storage.from(DISTRIBUTOR_FILES_BUCKET).remove([path]);
        failed.push(`${file.name} (${rowErr.message})`);
        continue;
      }
      saved++;
    }
    if (saved) {
      await logChange(supabase, {
        weekId: null,
        tableName: "distributor_files",
        recordId: userId,
        fieldName: "distributor_files",
        oldValue: null,
        newValue: `${dist}: ${saved} file(s) added`,
        changedBy: userId,
      });
    }
    setUploading(null);
    setMsg(
      failed.length
        ? { text: `Couldn't save: ${failed.join(", ")}`, bad: true }
        : { text: `Saved ${saved} file${saved === 1 ? "" : "s"} to ${dist}.`, bad: false },
    );
    await load();
  }

  async function signedUrl(path: string): Promise<string | null> {
    const { data } = await supabase.storage.from(DISTRIBUTOR_FILES_BUCKET).createSignedUrl(path, 300);
    return data?.signedUrl ?? null;
  }

  async function download(f: DistributorFile) {
    setDownloadingId(f.id);
    try {
      const { data, error } = await supabase.storage.from(DISTRIBUTOR_FILES_BUCKET).download(f.storage_path);
      if (error || !data) {
        setMsg({ text: `Couldn't download ${f.file_name}: ${error?.message ?? "unknown error"}`, bad: true });
        return;
      }
      const objectUrl = URL.createObjectURL(data);
      const a = document.createElement("a");
      a.href = objectUrl;
      a.download = f.file_name;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(objectUrl);
    } finally {
      setDownloadingId(null);
    }
  }

  async function remove(f: DistributorFile) {
    if (!userId) return;
    if (!window.confirm(`Delete "${f.file_name}" from ${dist}? This can't be undone.`)) return;
    await supabase.storage.from(DISTRIBUTOR_FILES_BUCKET).remove([f.storage_path]);
    const { error } = await supabase.from("distributor_files").delete().eq("id", f.id);
    if (error) {
      setMsg({ text: `Couldn't delete ${f.file_name}: ${error.message}`, bad: true });
      return;
    }
    await logChange(supabase, {
      weekId: null,
      tableName: "distributor_files",
      recordId: f.id,
      fieldName: "distributor_files",
      oldValue: `${dist}: ${f.file_name}`,
      newValue: null,
      changedBy: userId,
    });
    if (preview?.id === f.id) closePreview();
    setMsg(null);
    await load();
  }

  async function openPreview(f: DistributorFile) {
    setPreview(f);
    setPreviewUrl(null);
    setSheet(null);
    setPreviewErr(null);
    const ext = fileExtension(f.file_name);
    try {
      if (ext === "xlsx" || ext === "csv") {
        const { data, error } = await supabase.storage.from(DISTRIBUTOR_FILES_BUCKET).download(f.storage_path);
        if (error || !data) throw new Error(error?.message ?? "couldn't load the file");
        setSheet(await readSheet(data, f.file_name));
      } else if (isImageFile(f.file_name) || ext === "pdf") {
        const url = await signedUrl(f.storage_path);
        if (!url) throw new Error("couldn't load the file");
        setPreviewUrl(url);
      }
    } catch (e) {
      setPreviewErr(e instanceof Error ? e.message : String(e));
    }
  }

  function closePreview() {
    setPreview(null);
    setPreviewUrl(null);
    setSheet(null);
    setPreviewErr(null);
  }

  // Drag-and-drop handlers, shared by the box and the pop-up.
  const dropProps = {
    onDragEnter: (e: React.DragEvent) => {
      if (!e.dataTransfer.types.includes("Files")) return;
      e.preventDefault();
      dragDepth.current++;
      setDragging(true);
    },
    onDragOver: (e: React.DragEvent) => {
      if (!e.dataTransfer.types.includes("Files")) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = "copy";
    },
    onDragLeave: () => {
      dragDepth.current = Math.max(0, dragDepth.current - 1);
      if (!dragDepth.current) setDragging(false);
    },
    onDrop: (e: React.DragEvent) => {
      e.preventDefault();
      dragDepth.current = 0;
      setDragging(false);
      if (e.dataTransfer.files?.length) upload(e.dataTransfer.files);
    },
  };

  const count = files.length;
  const ext = preview ? fileExtension(preview.file_name) : "";

  return (
    <>
      <input
        ref={inputRef}
        type="file"
        multiple
        className="hidden"
        onChange={(e) => {
          if (e.target.files?.length) upload(e.target.files);
          e.target.value = "";
        }}
      />
      <div className="flex flex-col gap-1.5">
        <button
          type="button"
          {...(open ? {} : dropProps)}
          onClick={() => {
            setOpen(true);
            isNew.dismiss();
          }}
          className={`flex w-full flex-wrap items-center justify-center gap-x-3 gap-y-1 rounded-xl border-2 border-dashed px-4 py-3.5 text-sm transition-colors ${
            dragging && !open
              ? "border-sky-400 bg-sky-400/15 text-sky-100"
              : "border-sky-500/50 bg-sky-500/5 text-neutral-200 hover:border-sky-400 hover:bg-sky-500/10"
          }`}
        >
          <span className="text-xl" aria-hidden>
            📂
          </span>
          {uploading ? (
            <span className="font-semibold">{uploading}</span>
          ) : dragging && !open ? (
            <span className="font-semibold">Drop to save to {dist}</span>
          ) : (
            <>
              <span className="font-semibold text-neutral-100">{dist} Files</span>
              <span className="text-neutral-400">Drag files here, or click to see them</span>
              <span className="rounded-full bg-sky-500/20 px-2 py-0.5 text-xs font-semibold text-sky-200">
                {loading ? "…" : `${count} file${count === 1 ? "" : "s"}`}
              </span>
            </>
          )}
          {isNew.isNew && <NewBadge inline />}
        </button>
        {msg && !open && (
          <p className={`text-[13px] ${msg.bad ? "text-red-300" : "text-[#9be07c]"}`}>{msg.text}</p>
        )}
      </div>

      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-6" onClick={() => setOpen(false)}>
          <div
            {...dropProps}
            className={`flex max-h-[85vh] w-full max-w-3xl flex-col overflow-hidden rounded-xl border bg-neutral-950 ${
              dragging ? "border-sky-400 ring-2 ring-sky-400/50" : "border-neutral-700"
            }`}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between gap-3 border-b border-neutral-800 px-4 py-3">
              <div>
                <h2 className="text-base font-semibold text-neutral-100">📂 {dist} Files</h2>
                <p className="text-xs text-neutral-500">
                  {count} file{count === 1 ? "" : "s"} · drag files onto this window to add more
                </p>
              </div>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => inputRef.current?.click()}
                  disabled={!!uploading}
                  className="rounded-md bg-white px-3 py-1.5 text-sm font-medium text-black hover:bg-neutral-200 disabled:opacity-50"
                >
                  {uploading ?? "+ Add files"}
                </button>
                <button
                  type="button"
                  onClick={() => setOpen(false)}
                  className="rounded-md border border-neutral-700 px-3 py-1.5 text-sm text-neutral-300 hover:bg-neutral-900"
                >
                  Close
                </button>
              </div>
            </div>
            {msg && <p className={`border-b border-neutral-800 px-4 py-2 text-[13px] ${msg.bad ? "text-red-300" : "text-[#9be07c]"}`}>{msg.text}</p>}
            <div className="flex-1 overflow-y-auto">
              {dragging ? (
                <p className="py-16 text-center text-sm font-semibold text-sky-200">Drop to save to {dist}</p>
              ) : loading ? (
                <p className="p-4 text-sm text-neutral-400">Loading…</p>
              ) : !count ? (
                <p className="py-16 text-center text-sm text-neutral-500">No {dist} files yet.</p>
              ) : (
                <ul className="divide-y divide-neutral-800">
                  {files.map((f) => (
                    <li key={f.id} className="flex items-center gap-3 px-4 py-2.5">
                      <span className="text-2xl" aria-hidden>
                        {fileIcon(f.file_name)}
                      </span>
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-sm text-neutral-100" title={f.file_name}>
                          {f.file_name}
                        </div>
                        <div className="text-xs text-neutral-500">
                          {formatBytes(f.size_bytes)} · {f.uploaded_by_name ? `${f.uploaded_by_name} · ` : ""}
                          {fmtWhen(f.uploaded_at)}
                        </div>
                      </div>
                      <div className="flex shrink-0 gap-1.5 text-xs">
                        <button
                          type="button"
                          onClick={() => openPreview(f)}
                          className="rounded-md border border-neutral-700 px-2.5 py-1 text-neutral-300 hover:bg-neutral-900"
                        >
                          Preview
                        </button>
                        <button
                          type="button"
                          onClick={() => download(f)}
                          disabled={downloadingId === f.id}
                          className="rounded-md border border-neutral-700 px-2.5 py-1 text-neutral-300 hover:bg-neutral-900 disabled:opacity-50"
                        >
                          {downloadingId === f.id ? "…" : "Download"}
                        </button>
                        <button
                          type="button"
                          onClick={() => remove(f)}
                          className="rounded-md border border-neutral-700 px-2.5 py-1 text-neutral-400 hover:bg-neutral-900 hover:text-red-400"
                        >
                          Delete
                        </button>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        </div>
      )}

      {preview && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/80 p-6" onClick={closePreview}>
          <div
            className="flex max-h-full w-full max-w-5xl flex-col overflow-hidden rounded-lg border border-neutral-700 bg-neutral-950"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between gap-3 border-b border-neutral-800 px-4 py-3">
              <span className="truncate text-sm font-medium text-neutral-100" title={preview.file_name}>
                {preview.file_name}
              </span>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => download(preview)}
                  className="rounded-md border border-neutral-700 px-2 py-1 text-xs text-neutral-300 hover:bg-neutral-900"
                >
                  Download
                </button>
                <button
                  type="button"
                  onClick={closePreview}
                  className="rounded-md border border-neutral-700 px-2 py-1 text-xs text-neutral-300 hover:bg-neutral-900"
                >
                  Close
                </button>
              </div>
            </div>
            <div className="flex-1 overflow-auto bg-neutral-900">
              {previewErr ? (
                <p className="p-6 text-sm text-red-300">Couldn&apos;t show a preview: {previewErr}</p>
              ) : ext === "xlsx" || ext === "csv" ? (
                !sheet ? (
                  <p className="p-6 text-sm text-neutral-500">Loading preview…</p>
                ) : !sheet.rows.length ? (
                  <p className="p-6 text-sm text-neutral-500">This sheet is empty.</p>
                ) : (
                  <div className="p-3">
                    <p className="mb-2 text-xs text-neutral-500">
                      {sheet.total > PREVIEW_ROWS
                        ? `First ${PREVIEW_ROWS} of ${sheet.total} rows — download for the rest`
                        : `${sheet.total} row${sheet.total === 1 ? "" : "s"}`}
                    </p>
                    <table className="w-full border-collapse text-left text-[13px]">
                      <thead>
                        <tr>
                          {sheet.rows[0].map((h, i) => (
                            <th key={i} className="sticky top-0 bg-neutral-800 px-2 py-1.5 font-semibold text-neutral-200">
                              {h}
                            </th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {sheet.rows.slice(1).map((r, i) => (
                          <tr key={i} className="odd:bg-neutral-950/40">
                            {r.map((c, j) => (
                              <td key={j} className="px-2 py-1 text-neutral-300">
                                {c}
                              </td>
                            ))}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )
              ) : isImageFile(preview.file_name) ? (
                previewUrl ? (
                  <div className="flex items-center justify-center p-4">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={previewUrl} alt={preview.file_name} className="max-h-[75vh] max-w-full object-contain" />
                  </div>
                ) : (
                  <p className="p-6 text-sm text-neutral-500">Loading preview…</p>
                )
              ) : ext === "pdf" ? (
                previewUrl ? (
                  <iframe src={previewUrl} title={preview.file_name} className="h-[75vh] w-full bg-white" />
                ) : (
                  <p className="p-6 text-sm text-neutral-500">Loading preview…</p>
                )
              ) : (
                <div className="flex flex-col items-center gap-3 py-14 text-center">
                  <span className="text-5xl">{fileIcon(preview.file_name)}</span>
                  <p className="text-sm text-neutral-400">No preview for this kind of file — Download to open it.</p>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </>
  );
}
