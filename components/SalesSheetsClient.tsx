"use client";

// POS > Sales Sheets (added 2026-11-10, per Chad: "clicking on it will open the
// page that has FCB, Speakeasy, and Sonoma Cider. Inside those will look and
// operate just like the football POS section, with previews and download
// links"). Copied from FootballPosFilesClient.tsx — same cards, preview pop-up,
// download, upload, delete and audit log — plus the three brand buttons on top.
// Each file is saved with its brand; storage paths start with "<brand>/".
//
// Folders (added 2026-11-11, Eddie: "maybe we can give it that same folder to
// file set up? so we can create a file for distros, chains, and so on"; Chad:
// "execute"). Same as Email Studio's folders: one shared folder list for all
// three brands; All · each folder · No folder · + New folder; a 📁 menu on
// each card; uploads go into the folder being looked at; deleting a folder
// moves its sheets to No folder (nothing deleted).

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { logChange } from "@/lib/audit";
import type { PosSalesSheetFile, PosSalesSheetFolder } from "@/lib/types/db";
import NewBadge from "@/components/NewBadge";
import { useNewFeature } from "@/lib/newFeatures";
import {
  fileIcon,
  formatBytes,
  isImageFile,
  storageFileName,
} from "@/lib/events";
import { POS_SALES_SHEETS_BUCKET, SALES_SHEET_BRANDS, type SalesSheetBrand } from "@/lib/posSalesSheets";

export default function SalesSheetsClient() {
  const supabase = useMemo(() => createClient(), []);

  const [brand, setBrand] = useState<SalesSheetBrand>("fcb");
  const [files, setFiles] = useState<PosSalesSheetFile[]>([]);
  const [userId, setUserId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [signedUrls, setSignedUrls] = useState<Record<string, string>>({});
  const [previewFile, setPreviewFile] = useState<PosSalesSheetFile | null>(null);
  const [downloadingPath, setDownloadingPath] = useState<string | null>(null);
  const [folders, setFolders] = useState<PosSalesSheetFolder[]>([]);
  // "all" | "none" | a folder id. Stays picked when switching brands.
  const [folderPick, setFolderPick] = useState<string>("all");
  const [msg, setMsg] = useState<string | null>(null);
  const pickedFolderId = folderPick !== "all" && folderPick !== "none" ? folderPick : null;
  const inPick = (folderId: string | null | undefined) =>
    folderPick === "all" ? true : folderPick === "none" ? !folderId : folderId === folderPick;
  const shownFiles = files.filter((f) => inPick(f.folder_id));
  const countFor = (pick: string) =>
    pick === "all"
      ? files.length
      : pick === "none"
        ? files.filter((f) => !f.folder_id).length
        : files.filter((f) => f.folder_id === pick).length;

  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const brandLabel = SALES_SHEET_BRANDS.find((b) => b.key === brand)?.label ?? "";

  function previewSourcePath(f: PosSalesSheetFile): string | null {
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
      .from("pos_sales_sheet_files")
      .select("*")
      .eq("brand", brand)
      .order("uploaded_at", { ascending: false });

    setFiles((data as PosSalesSheetFile[]) ?? []);
    setLoading(false);
  }, [supabase, brand]);

  const loadFolders = useCallback(async () => {
    const { data } = await supabase
      .from("pos_sales_sheet_folders")
      .select("id, name, created_at")
      .order("name");
    const list = ((data as PosSalesSheetFolder[]) ?? []).sort((a, b) => a.name.localeCompare(b.name));
    setFolders(list);
    // If the folder being looked at was deleted by someone else, go back to All.
    setFolderPick((p) => (p === "all" || p === "none" || list.some((f) => f.id === p) ? p : "all"));
  }, [supabase]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- intentional fetch-on-mount
    loadFolders();
    const channel = supabase
      .channel("pos-sales-sheet-folders")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "pos_sales_sheet_folders" },
        () => loadFolders(),
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [supabase, loadFolders]);

  // ---- Folders ----
  async function createFolder(name: string): Promise<boolean> {
    const clean = name.trim();
    if (!clean) return false;
    if (folders.some((f) => f.name.trim().toLowerCase() === clean.toLowerCase())) {
      setMsg(`There's already a folder called "${clean}".`);
      return false;
    }
    const { data, error } = await supabase
      .from("pos_sales_sheet_folders")
      .insert({ name: clean, created_by: userId })
      .select("id, name, created_at")
      .single();
    if (error || !data) {
      setMsg(`Couldn't make the folder: ${error?.message ?? "unknown error"}`);
      return false;
    }
    setMsg(null);
    setFolders((prev) =>
      [...prev.filter((f) => f.id !== data.id), data as PosSalesSheetFolder].sort((a, b) => a.name.localeCompare(b.name)),
    );
    setFolderPick(data.id);
    if (userId) {
      await logChange(supabase, {
        weekId: null,
        tableName: "pos_sales_sheet_folders",
        recordId: data.id,
        fieldName: "sales_sheets",
        oldValue: null,
        newValue: `Folder added: ${clean}`,
        changedBy: userId,
      });
    }
    return true;
  }

  async function renameFolder(id: string, name: string): Promise<boolean> {
    const clean = name.trim();
    if (!clean) return false;
    if (folders.some((f) => f.id !== id && f.name.trim().toLowerCase() === clean.toLowerCase())) {
      setMsg(`There's already a folder called "${clean}".`);
      return false;
    }
    const old = folders.find((f) => f.id === id)?.name ?? null;
    const { error } = await supabase.from("pos_sales_sheet_folders").update({ name: clean }).eq("id", id);
    if (error) {
      setMsg(`Couldn't rename the folder: ${error.message}`);
      return false;
    }
    setMsg(null);
    setFolders((prev) =>
      prev.map((f) => (f.id === id ? { ...f, name: clean } : f)).sort((a, b) => a.name.localeCompare(b.name)),
    );
    if (userId) {
      await logChange(supabase, {
        weekId: null,
        tableName: "pos_sales_sheet_folders",
        recordId: id,
        fieldName: "sales_sheets",
        oldValue: old ? `Folder: ${old}` : null,
        newValue: `Folder: ${clean}`,
        changedBy: userId,
      });
    }
    return true;
  }

  async function deleteFolder(id: string) {
    const old = folders.find((f) => f.id === id)?.name ?? "";
    const { error } = await supabase.from("pos_sales_sheet_folders").delete().eq("id", id);
    if (error) {
      setMsg(`Couldn't delete the folder: ${error.message}`);
      return;
    }
    setMsg(null);
    // The database moves its sheets to "No folder"; match that here.
    setFolders((prev) => prev.filter((f) => f.id !== id));
    setFiles((prev) => prev.map((f) => (f.folder_id === id ? { ...f, folder_id: null } : f)));
    setFolderPick("all");
    if (userId) {
      await logChange(supabase, {
        weekId: null,
        tableName: "pos_sales_sheet_folders",
        recordId: id,
        fieldName: "sales_sheets",
        oldValue: `Folder: ${old}`,
        newValue: "Folder deleted (its sheets moved to No folder)",
        changedBy: userId,
      });
    }
  }

  async function moveFile(f: PosSalesSheetFile, folderId: string | null) {
    const { error } = await supabase
      .from("pos_sales_sheet_files")
      .update({ folder_id: folderId })
      .eq("id", f.id);
    if (error) {
      setMsg(`Couldn't move it: ${error.message}`);
      return;
    }
    setMsg(null);
    setFiles((prev) => prev.map((x) => (x.id === f.id ? { ...x, folder_id: folderId } : x)));
  }

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- intentional fetch-on-mount
    load();
    const channel = supabase
      .channel("pos-sales-sheet-files")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "pos_sales_sheet_files" },
        () => load(),
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [supabase, load]);

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
            .from(POS_SALES_SHEETS_BUCKET)
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
      .from(POS_SALES_SHEETS_BUCKET)
      .createSignedUrl(path, 300);
    const url = data?.signedUrl ?? "";
    if (url) setSignedUrls((prev) => ({ ...prev, [path]: url }));
    return url;
  }

  async function handleUpload(fileList: FileList) {
    if (!userId || !fileList.length) return;
    setUploading(true);
    for (const file of Array.from(fileList)) {
      const path = `${brand}/${storageFileName(file.name)}`;
      const { error: uploadError } = await supabase.storage
        .from(POS_SALES_SHEETS_BUCKET)
        .upload(path, file);
      if (uploadError) continue;
      await supabase.from("pos_sales_sheet_files").insert({
        brand,
        file_name: file.name,
        storage_path: path,
        mime_type: file.type || null,
        size_bytes: file.size,
        uploaded_by: userId,
        folder_id: pickedFolderId,
      });
    }
    await logChange(supabase, {
      weekId: null,
      tableName: "pos_sales_sheet_files",
      recordId: userId,
      fieldName: "sales_sheets",
      oldValue: null,
      newValue: `${brandLabel}: ${fileList.length} file(s) added`,
      changedBy: userId,
    });
    setUploading(false);
    await load();
  }

  async function handleDelete(f: PosSalesSheetFile) {
    if (!userId) return;
    if (!window.confirm(`Delete "${f.file_name}"? This can't be undone.`))
      return;
    if (f.storage_path) {
      await supabase.storage
        .from(POS_SALES_SHEETS_BUCKET)
        .remove([f.storage_path]);
    }
    await supabase.from("pos_sales_sheet_files").delete().eq("id", f.id);
    await logChange(supabase, {
      weekId: null,
      tableName: "pos_sales_sheet_files",
      recordId: f.id,
      fieldName: "sales_sheets",
      oldValue: `${brandLabel}: ${f.file_name}`,
      newValue: null,
      changedBy: userId,
    });
    if (previewFile?.id === f.id) setPreviewFile(null);
    await load();
  }

  async function handleDownload(f: PosSalesSheetFile) {
    if (!f.storage_path) {
      if (f.external_url) window.open(f.external_url, "_blank", "noopener,noreferrer");
      return;
    }
    setDownloadingPath(f.storage_path);
    try {
      const url = await ensureSignedUrl(f.storage_path);
      if (!url) return;
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

  async function openPreview(f: PosSalesSheetFile) {
    setPreviewFile(f);
    const path = previewSourcePath(f);
    if (path) await ensureSignedUrl(path);
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-lg font-semibold text-neutral-100">Sales Sheets</h1>
          <p className="text-sm text-neutral-500">
            {brandLabel}
            {pickedFolderId ? ` · 📁 ${folders.find((f) => f.id === pickedFolderId)?.name ?? ""}` : folderPick === "none" ? " · No folder" : ""}
            {" · "}
            {loading ? "…" : `${shownFiles.length} file${shownFiles.length === 1 ? "" : "s"}`}
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

      <div className="flex flex-wrap gap-2">
        {SALES_SHEET_BRANDS.map((b) => (
          <button
            key={b.key}
            type="button"
            onClick={() => {
              if (b.key === brand) return;
              setLoading(true);
              setFiles([]);
              setPreviewFile(null);
              setBrand(b.key);
            }}
            className={`rounded-lg border px-4 py-2 text-sm font-semibold ${
              b.key === brand
                ? "border-[#6abc46] bg-[#6abc46]/20 text-neutral-100"
                : "border-neutral-700 text-neutral-300 hover:bg-neutral-900"
            }`}
          >
            {b.label}
          </button>
        ))}
      </div>

      <SalesSheetFolderBar
        folders={folders}
        pick={folderPick}
        onPick={(p) => {
          setFolderPick(p);
          setMsg(null);
        }}
        counts={countFor}
        onCreate={createFolder}
        onRename={renameFolder}
        onDelete={deleteFolder}
      />

      {msg && <p className="text-sm text-red-300">{msg}</p>}

      {loading ? (
        <p className="text-sm text-neutral-400">Loading…</p>
      ) : files.length === 0 ? (
        <p className="py-10 text-center text-sm text-neutral-500">
          No {brandLabel} sales sheets yet.
        </p>
      ) : shownFiles.length === 0 ? (
        <p className="py-10 text-center text-sm text-neutral-500">
          {folderPick === "none"
            ? `Every ${brandLabel} sales sheet is in a folder.`
            : `No ${brandLabel} sales sheets in this folder yet — click + Upload Files to add some here, or use the 📁 menu on a sheet to move it in.`}
        </p>
      ) : (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5">
          {shownFiles.map((f) => (
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
                <label className="mt-1.5 flex items-center gap-1.5 text-[11px] text-neutral-500">
                  <span aria-hidden>📁</span>
                  <select
                    value={f.folder_id ?? ""}
                    onChange={(e) => moveFile(f, e.target.value || null)}
                    aria-label="Folder"
                    title="Move to a folder"
                    className="min-w-0 flex-1 truncate rounded-md border border-neutral-800 bg-neutral-900 px-1.5 py-0.5 text-neutral-300"
                  >
                    <option value="">No folder</option>
                    {folders.map((fo) => (
                      <option key={fo.id} value={fo.id}>
                        {fo.name}
                      </option>
                    ))}
                  </select>
                </label>
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

// The folder row under the brand buttons (added 2026-11-11, copied from Email
// Studio's FolderBar). All · each folder · No folder · + New folder. The
// folder being looked at can be renamed or deleted (its sheets go to No folder).
function SalesSheetFolderBar({
  folders,
  pick,
  onPick,
  counts,
  onCreate,
  onRename,
  onDelete,
}: {
  folders: PosSalesSheetFolder[];
  pick: string;
  onPick: (p: string) => void;
  counts: (p: string) => number;
  onCreate: (name: string) => Promise<boolean>;
  onRename: (id: string, name: string) => Promise<boolean>;
  onDelete: (id: string) => void;
}) {
  const foldersNew = useNewFeature("feature:sales-sheets-folders");
  const [adding, setAdding] = useState(false);
  const [newName, setNewName] = useState("");
  const [renaming, setRenaming] = useState(false);
  const [renameTo, setRenameTo] = useState("");
  const [confirmDelete, setConfirmDelete] = useState(false);
  const current = folders.find((f) => f.id === pick) ?? null;

  const chip = (id: string, label: string) => (
    <button
      key={id}
      type="button"
      onClick={() => {
        onPick(id);
        setRenaming(false);
        setConfirmDelete(false);
      }}
      className={`rounded-full px-3 py-1 text-xs font-semibold ${
        pick === id ? "bg-brand/20 text-neutral-100" : "text-neutral-400 hover:text-neutral-200"
      }`}
    >
      {id !== "all" && id !== "none" ? "📁 " : ""}
      {label} <span className="text-neutral-500">{counts(id)}</span>
    </button>
  );
  const field = "rounded-full border border-neutral-700 bg-neutral-900 px-3 py-1 text-xs text-neutral-100";
  const small = "rounded-full border border-neutral-700 px-3 py-1 text-xs text-neutral-200 hover:border-neutral-500";

  return (
    <div className="space-y-2 rounded-2xl border border-neutral-800 bg-neutral-900/30 px-3 py-2">
      <div className="flex flex-wrap items-center gap-1.5">
        <span className="mr-1 text-xs font-semibold text-neutral-400">Folders</span>
        {chip("all", "All")}
        {folders.map((f) => chip(f.id, f.name))}
        {folders.length > 0 && chip("none", "No folder")}
        {adding ? (
          <form
            className="flex items-center gap-1.5"
            onSubmit={(e) => {
              e.preventDefault();
              void onCreate(newName).then((ok) => {
                if (ok) {
                  setAdding(false);
                  setNewName("");
                }
              });
            }}
          >
            <input
              autoFocus
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              placeholder="Folder name (e.g. Chains)"
              className={field}
            />
            <button
              type="submit"
              disabled={!newName.trim()}
              className="rounded-full bg-brand px-3 py-1 text-xs font-semibold text-black disabled:opacity-50"
            >
              Add
            </button>
            <button type="button" onClick={() => setAdding(false)} className="text-xs text-neutral-400 underline">
              Cancel
            </button>
          </form>
        ) : (
          <button
            type="button"
            onClick={() => {
              setAdding(true);
              foldersNew.dismiss();
            }}
            className={small}
          >
            + New folder
            {foldersNew.isNew && <NewBadge inline />}
          </button>
        )}
      </div>
      {folders.length === 0 && !adding && (
        <p className="text-xs text-neutral-500">
          Make folders (like Distributors or Chains) to group sales sheets. Folders show under FCB, Speakeasy and Sonoma Cider.
        </p>
      )}
      {current && (
        <div className="flex flex-wrap items-center gap-2 text-xs text-neutral-400">
          {renaming ? (
            <form
              className="flex items-center gap-1.5"
              onSubmit={(e) => {
                e.preventDefault();
                void onRename(current.id, renameTo).then((ok) => ok && setRenaming(false));
              }}
            >
              <input
                autoFocus
                value={renameTo}
                onChange={(e) => setRenameTo(e.target.value)}
                className={field}
                aria-label="New folder name"
              />
              <button
                type="submit"
                disabled={!renameTo.trim()}
                className="rounded-full bg-brand px-3 py-1 text-xs font-semibold text-black disabled:opacity-50"
              >
                Save
              </button>
              <button type="button" onClick={() => setRenaming(false)} className="underline">
                Cancel
              </button>
            </form>
          ) : confirmDelete ? (
            <span className="text-red-300">
              Delete the &ldquo;{current.name}&rdquo; folder? Its sales sheets stay — they move to No folder.{" "}
              <button
                type="button"
                onClick={() => {
                  setConfirmDelete(false);
                  onDelete(current.id);
                }}
                className="font-semibold underline"
              >
                Yes, delete the folder
              </button>{" "}
              <button type="button" onClick={() => setConfirmDelete(false)} className="underline">
                No
              </button>
            </span>
          ) : (
            <>
              <span>
                Looking at <strong className="text-neutral-200">📁 {current.name}</strong> — new uploads go in this folder.
              </span>
              <button
                type="button"
                onClick={() => {
                  setRenameTo(current.name);
                  setRenaming(true);
                }}
                className="underline"
              >
                Rename
              </button>
              <button type="button" onClick={() => setConfirmDelete(true)} className="text-neutral-500 underline">
                Delete folder
              </button>
            </>
          )}
        </div>
      )}
    </div>
  );
}
