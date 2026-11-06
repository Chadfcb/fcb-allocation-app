"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import {
  CREATIVE_BUCKET,
  formatBytes,
  isWebImage,
  kindOf,
  uploadCreativeFiles,
  makeEmailCopy,
  type CreativeAsset,
} from "@/lib/creativeAssets";
import EmailAudienceTab, { type ListRow } from "@/components/EmailAudienceTab";
import EmailSentTab, { type CampaignRow } from "@/components/EmailSentTab";
import EmailStudioGuide from "@/components/EmailStudioGuide";
import NewBadge from "@/components/NewBadge";
import { useNewFeature } from "@/lib/newFeatures";

// Admin → Email Studio (added 2026-10-29, per Chad — Phase 1 of
// claude/email-designer-plan.md). Two tabs:
//   Emails           — saved email designs; New email opens the designer.
//   Creative Library — every image / GIF / PSD / video / PDF Eddie uses.
//                      Images here also show up in the designer's image picker.
//   Audience         — lists (Mailchimp import, pasted) + the do-not-email list
//                      (Phase 5, 2026-10-30).
//   Sent             — every email sent or scheduled, with delivered / opened /
//                      clicked / bounced / unsubscribed (Phase 5).
//   How to use       — step-by-step guide (2026-10-30), plus a one-time
//                      welcome box pointing new users to the Quick start.
// Folders (added 2026-11-06, Eddie: "a file system … so we can put all the
// oobli emails in one folder"): one shared folder list on the Emails and
// Creative Library tabs (email_folders; folder_id on email_designs and
// creative_assets). Picking a folder applies to both tabs. Deleting a folder
// never deletes what's in it — it goes back to "No folder".

export type DesignRow = {
  id: string;
  name: string;
  subject: string | null;
  status: "draft" | "ready" | "archived";
  updated_at: string;
  updated_by: string | null;
  updated_by_name: string | null;
  folder_id: string | null;
};
export type AssetRow = CreativeAsset;
export type FolderRow = { id: string; name: string; created_at: string };
// "all" = everything, "none" = not in a folder, otherwise a folder id.
type FolderPick = string;

type Tab = "emails" | "library" | "audience" | "sent" | "guide";
const WELCOME_KEY = "fcb-email-studio-welcome-dismissed";
type KindFilter = "all" | "image" | "gif" | "psd" | "video" | "other";

function fmtWhen(iso: string) {
  return new Date(iso).toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZone: "America/Los_Angeles",
  });
}

export default function EmailStudioClient({
  designs: initialDesigns,
  assets: initialAssets,
  folders: initialFolders,
  loadError,
  lists,
  suppressionCount,
  accountEmailCount,
  campaigns,
  sentToday,
  dailyCap,
}: {
  designs: DesignRow[];
  assets: AssetRow[];
  folders: FolderRow[];
  loadError: string | null;
  lists: ListRow[];
  suppressionCount: number;
  accountEmailCount: number | null;
  campaigns: CampaignRow[];
  sentToday: number;
  dailyCap: number;
}) {
  const router = useRouter();
  const [supabase] = useState(() => createClient());
  const [tab, setTab] = useState<Tab>("emails");
  // First-visit welcome (remembered per browser; shows again if storage is blocked).
  const [showWelcome, setShowWelcome] = useState(false);
  useEffect(() => {
    let seen = false;
    try {
      seen = window.localStorage.getItem(WELCOME_KEY) === "1";
    } catch {
      // storage blocked — just show it
    }
    // eslint-disable-next-line react-hooks/set-state-in-effect -- read once after mount (localStorage isn't available during server render)
    if (!seen) setShowWelcome(true);
  }, []);
  function dismissWelcome() {
    setShowWelcome(false);
    try {
      window.localStorage.setItem(WELCOME_KEY, "1");
    } catch {
      // ignore
    }
  }
  const [designs, setDesigns] = useState(initialDesigns);
  const [assets, setAssets] = useState(initialAssets);
  const [folders, setFolders] = useState(initialFolders);
  const [folderPick, setFolderPick] = useState<FolderPick>("all");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const pickedFolderId = folderPick !== "all" && folderPick !== "none" ? folderPick : null;
  const inPick = (folderId: string | null | undefined) =>
    folderPick === "all" ? true : folderPick === "none" ? !folderId : folderId === folderPick;

  // ---- Folders ----
  async function createFolder(name: string): Promise<boolean> {
    const clean = name.trim();
    if (!clean) return false;
    if (folders.some((f) => f.name.trim().toLowerCase() === clean.toLowerCase())) {
      setMsg(`There's already a folder called "${clean}".`);
      return false;
    }
    const {
      data: { user },
    } = await supabase.auth.getUser();
    const { data, error } = await supabase
      .from("email_folders")
      .insert({ name: clean, created_by: user?.id ?? null })
      .select("id, name, created_at")
      .single();
    if (error || !data) {
      setMsg(`Couldn't make the folder: ${error?.message ?? "unknown error"}`);
      return false;
    }
    setMsg(null);
    setFolders((prev) => [...prev, data as FolderRow].sort((a, b) => a.name.localeCompare(b.name)));
    setFolderPick(data.id);
    return true;
  }

  async function renameFolder(id: string, name: string): Promise<boolean> {
    const clean = name.trim();
    if (!clean) return false;
    if (folders.some((f) => f.id !== id && f.name.trim().toLowerCase() === clean.toLowerCase())) {
      setMsg(`There's already a folder called "${clean}".`);
      return false;
    }
    const { error } = await supabase.from("email_folders").update({ name: clean }).eq("id", id);
    if (error) {
      setMsg(`Couldn't rename the folder: ${error.message}`);
      return false;
    }
    setMsg(null);
    setFolders((prev) => prev.map((f) => (f.id === id ? { ...f, name: clean } : f)).sort((a, b) => a.name.localeCompare(b.name)));
    return true;
  }

  async function deleteFolder(id: string) {
    const { error } = await supabase.from("email_folders").delete().eq("id", id);
    if (error) {
      setMsg(`Couldn't delete the folder: ${error.message}`);
      return;
    }
    // The database moves its emails/files to "No folder"; match that here.
    setFolders((prev) => prev.filter((f) => f.id !== id));
    setDesigns((prev) => prev.map((d) => (d.folder_id === id ? { ...d, folder_id: null } : d)));
    setAssets((prev) => prev.map((a) => (a.folder_id === id ? { ...a, folder_id: null } : a)));
    setFolderPick("all");
  }

  async function moveDesign(d: DesignRow, folderId: string | null) {
    const { error } = await supabase.from("email_designs").update({ folder_id: folderId }).eq("id", d.id);
    if (error) {
      setMsg(`Couldn't move it: ${error.message}`);
      return;
    }
    setDesigns((prev) => prev.map((x) => (x.id === d.id ? { ...x, folder_id: folderId } : x)));
  }

  async function moveAsset(a: AssetRow, folderId: string | null) {
    const { error } = await supabase.from("creative_assets").update({ folder_id: folderId }).eq("id", a.id);
    if (error) {
      setMsg(`Couldn't move it: ${error.message}`);
      return;
    }
    setAssets((prev) => prev.map((x) => (x.id === a.id ? { ...x, folder_id: folderId } : x)));
  }

  async function newEmail(copyFrom?: DesignRow) {
    setBusy(true);
    setMsg(null);
    const {
      data: { user },
    } = await supabase.auth.getUser();
    // A new email goes in the folder being looked at; a copy stays in the original's folder.
    let row: Record<string, unknown> = {
      name: "Untitled email",
      created_by: user?.id,
      updated_by: user?.id,
      folder_id: copyFrom ? copyFrom.folder_id : pickedFolderId,
    };
    if (copyFrom) {
      const { data: src } = await supabase
        .from("email_designs")
        .select("name, subject, preheader, project_data, html")
        .eq("id", copyFrom.id)
        .single();
      if (src) row = { ...row, ...src, name: `${src.name} (copy)` };
    }
    const { data, error } = await supabase.from("email_designs").insert(row).select("id").single();
    setBusy(false);
    if (error || !data) {
      setMsg(`Couldn't create the email: ${error?.message ?? "unknown error"}`);
      return;
    }
    router.push(`/admin/email/${data.id}`);
  }

  async function archive(d: DesignRow) {
    const { error } = await supabase
      .from("email_designs")
      .update({ status: "archived", updated_at: new Date().toISOString() })
      .eq("id", d.id);
    if (error) {
      setMsg(`Couldn't remove it: ${error.message}`);
      return;
    }
    setDesigns((prev) => prev.filter((x) => x.id !== d.id));
  }

  const tabBtn = (key: Tab, label: string, count: number | null) => (
    <button
      type="button"
      onClick={() => setTab(key)}
      className={`rounded-full px-4 py-1.5 text-sm font-semibold ${
        tab === key ? "bg-brand/20 text-neutral-100" : "text-neutral-400 hover:text-neutral-200"
      }`}
    >
      {label} {count !== null && <span className="text-neutral-500">{count}</span>}
    </button>
  );

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-lg font-semibold text-neutral-100">Email Studio</h1>
          <p className="text-sm text-neutral-400">
            Design FCB&apos;s emails with drag-and-drop, keep every image, GIF, Photoshop file and video in the Creative
            Library, and send to account contacts and lists from ernie@fullcirclebrewing.com.
          </p>
        </div>
        <button
          type="button"
          disabled={busy}
          onClick={() => void newEmail()}
          className="rounded-full bg-brand px-4 py-2 text-sm font-semibold text-black disabled:opacity-60"
        >
          + New email
        </button>
      </div>

      {loadError && (
        <p className="rounded-lg border border-red-900 bg-red-950/40 px-3 py-2 text-sm text-red-300">
          Couldn&apos;t load Email Studio: {loadError}. (Has sql/email_studio.sql been run in Supabase?)
        </p>
      )}
      {msg && <p className="text-sm text-amber-300">{msg}</p>}

      {showWelcome && (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-brand/40 bg-brand/10 px-4 py-3 text-sm text-neutral-200">
          <p>
            <strong className="text-neutral-100">New to Email Studio?</strong> The Quick start walks you through your first email in 6
            steps. You can always find it under <strong>How to use</strong>.
          </p>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => {
                setTab("guide");
                dismissWelcome();
              }}
              className="rounded-full bg-brand px-4 py-1.5 text-sm font-semibold text-black"
            >
              Open the Quick start
            </button>
            <button type="button" onClick={dismissWelcome} className="rounded-full border border-neutral-700 px-4 py-1.5 text-sm text-neutral-200">
              Got it
            </button>
          </div>
        </div>
      )}

      <div className="flex flex-wrap gap-2">
        {tabBtn("emails", "Emails", designs.length)}
        {tabBtn("library", "Creative Library", assets.length)}
        {tabBtn("audience", "Audience", lists.length)}
        {tabBtn("sent", "Sent", campaigns.length)}
        {tabBtn("guide", "How to use", null)}
      </div>

      {tab === "emails" ? (
        <>
          <FolderBar
            folders={folders}
            pick={folderPick}
            onPick={setFolderPick}
            counts={(id) => designs.filter((d) => (id === "all" ? true : id === "none" ? !d.folder_id : d.folder_id === id)).length}
            onCreate={createFolder}
            onRename={renameFolder}
            onDelete={(id) => void deleteFolder(id)}
          />
          <EmailsGrid
            designs={designs.filter((d) => inPick(d.folder_id))}
            folders={folders}
            emptyText={
              folderPick === "all"
                ? null
                : `No emails in ${folderPick === "none" ? "No folder" : `"${folders.find((f) => f.id === folderPick)?.name ?? ""}"`} yet. Click "New email" to start one here, or move one in with its Folder menu.`
            }
            onDuplicate={(d) => void newEmail(d)}
            onArchive={(d) => void archive(d)}
            onMove={(d, f) => void moveDesign(d, f)}
          />
        </>
      ) : tab === "library" ? (
        <>
          <CanvaHowTo />
          <FolderBar
            folders={folders}
            pick={folderPick}
            onPick={setFolderPick}
            counts={(id) => assets.filter((a) => (id === "all" ? true : id === "none" ? !a.folder_id : a.folder_id === id)).length}
            onCreate={createFolder}
            onRename={renameFolder}
            onDelete={(id) => void deleteFolder(id)}
          />
          <CreativeLibrary
            supabase={supabase}
            assets={assets}
            setAssets={setAssets}
            folders={folders}
            inPick={inPick}
            uploadFolderId={pickedFolderId}
            onMove={(a, f) => void moveAsset(a, f)}
          />
        </>
      ) : tab === "guide" ? (
        <EmailStudioGuide />
      ) : tab === "audience" ? (
        <EmailAudienceTab lists={lists} suppressionCount={suppressionCount} accountEmailCount={accountEmailCount} />
      ) : (
        <EmailSentTab campaigns={campaigns} sentToday={sentToday} dailyCap={dailyCap} />
      )}
    </div>
  );
}

function EmailsGrid({
  designs,
  folders,
  emptyText,
  onDuplicate,
  onArchive,
  onMove,
}: {
  designs: DesignRow[];
  folders: FolderRow[];
  emptyText: string | null;
  onDuplicate: (d: DesignRow) => void;
  onArchive: (d: DesignRow) => void;
  onMove: (d: DesignRow, folderId: string | null) => void;
}) {
  const [confirmId, setConfirmId] = useState<string | null>(null);
  if (designs.length === 0) {
    return (
      <p className="rounded-2xl border border-neutral-800 px-4 py-10 text-center text-sm text-neutral-500">
        {emptyText ?? "No emails yet. Click “New email” to start one."}
      </p>
    );
  }
  return (
    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
      {designs.map((d) => (
        <div key={d.id} className="flex flex-col gap-2 rounded-2xl border border-neutral-800 bg-neutral-900/40 p-4">
          <div className="flex items-start justify-between gap-2">
            <Link href={`/admin/email/${d.id}`} className="font-semibold text-neutral-100 hover:underline">
              {d.name}
            </Link>
            <span
              className={`shrink-0 rounded-full px-2 py-0.5 text-xs font-semibold ${
                d.status === "ready" ? "bg-green-500/15 text-green-300" : "bg-neutral-700/40 text-neutral-300"
              }`}
            >
              {d.status === "ready" ? "Ready" : "Draft"}
            </span>
          </div>
          <p className="text-sm text-neutral-400">{d.subject || <span className="text-neutral-600">No subject yet</span>}</p>
          <p className="text-xs text-neutral-500">
            Edited {fmtWhen(d.updated_at)}
            {d.updated_by_name ? ` by ${d.updated_by_name}` : ""}
          </p>
          <FolderSelect folders={folders} value={d.folder_id} onChange={(f) => onMove(d, f)} />
          <div className="mt-1 flex flex-wrap gap-3 text-xs">
            <Link href={`/admin/email/${d.id}`} className="text-brand underline">
              Open
            </Link>
            <button type="button" onClick={() => onDuplicate(d)} className="text-neutral-300 underline">
              Duplicate
            </button>
            {confirmId === d.id ? (
              <span className="text-red-300">
                Remove it?{" "}
                <button type="button" onClick={() => onArchive(d)} className="font-semibold underline">
                  Yes
                </button>{" "}
                <button type="button" onClick={() => setConfirmId(null)} className="underline">
                  No
                </button>
              </span>
            ) : (
              <button type="button" onClick={() => setConfirmId(d.id)} className="text-neutral-500 underline">
                Remove
              </button>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}

function CreativeLibrary({
  supabase,
  assets,
  setAssets,
  folders,
  inPick,
  uploadFolderId,
  onMove,
}: {
  supabase: ReturnType<typeof createClient>;
  assets: AssetRow[];
  setAssets: React.Dispatch<React.SetStateAction<AssetRow[]>>;
  folders: FolderRow[];
  inPick: (folderId: string | null | undefined) => boolean;
  /** Folder being looked at — new uploads go into it. */
  uploadFolderId: string | null;
  onMove: (a: AssetRow, folderId: string | null) => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [kind, setKind] = useState<KindFilter>("all");
  const [search, setSearch] = useState("");
  const [uploading, setUploading] = useState<string | null>(null);
  const [errors, setErrors] = useState<string[]>([]);
  const [dragOver, setDragOver] = useState(false);
  const [copied, setCopied] = useState<string | null>(null);
  const [confirmId, setConfirmId] = useState<string | null>(null);
  const [converting, setConverting] = useState<string | null>(null);

  // Photoshop/Illustrator files uploaded before 2026-10-30 (or re-tries).
  async function emailCopy(a: AssetRow) {
    setConverting(a.id);
    setErrors([]);
    try {
      let row = await makeEmailCopy(supabase, null, a);
      // The PNG copy goes in the same folder as the original.
      if (a.folder_id) {
        const { error } = await supabase.from("creative_assets").update({ folder_id: a.folder_id }).eq("id", row.id);
        if (!error) row = { ...row, folder_id: a.folder_id };
      }
      setAssets((prev) => [row, ...prev]);
    } catch (e) {
      setErrors([`${a.name}: ${e instanceof Error ? e.message : String(e)}`]);
    } finally {
      setConverting(null);
    }
  }

  const shown = useMemo(() => {
    const q = search.trim().toLowerCase();
    return assets.filter((a) => {
      if (!inPick(a.folder_id)) return false;
      const k = kindOf(a);
      if (kind === "other" && ["image", "gif", "psd", "video"].includes(k)) return false;
      if (kind !== "all" && kind !== "other" && k !== kind) return false;
      return !q || a.name.toLowerCase().includes(q);
    });
  }, [assets, kind, search, inPick]);

  async function upload(files: FileList | File[]) {
    const list = Array.from(files);
    if (!list.length) return;
    const errs: string[] = [];
    for (let i = 0; i < list.length; i++) {
      setUploading(`Uploading ${i + 1} of ${list.length}: ${list[i].name}`);
      try {
        const { rows: uploaded, note } = await uploadCreativeFiles(supabase, list[i]);
        let rows = uploaded;
        // Uploading while looking at a folder puts the file in that folder.
        if (uploadFolderId && rows.length) {
          const { error } = await supabase
            .from("creative_assets")
            .update({ folder_id: uploadFolderId })
            .in(
              "id",
              rows.map((r) => r.id),
            );
          if (!error) rows = rows.map((r) => ({ ...r, folder_id: uploadFolderId }));
        }
        setAssets((prev) => [...rows.slice().reverse(), ...prev]);
        if (note) errs.push(note);
      } catch (e) {
        errs.push(e instanceof Error ? e.message : String(e));
      }
    }
    setUploading(null);
    setErrors(errs);
  }

  async function remove(a: AssetRow) {
    await supabase.storage.from(CREATIVE_BUCKET).remove([a.storage_path]);
    const { error } = await supabase.from("creative_assets").delete().eq("id", a.id);
    if (error) {
      setErrors([`Couldn't delete ${a.name}: ${error.message}`]);
      return;
    }
    setAssets((prev) => prev.filter((x) => x.id !== a.id));
    setConfirmId(null);
  }

  async function copyLink(a: AssetRow) {
    try {
      await navigator.clipboard.writeText(a.public_url);
      setCopied(a.id);
      setTimeout(() => setCopied((c) => (c === a.id ? null : c)), 1500);
    } catch {
      setErrors(["Couldn't copy — your browser blocked it."]);
    }
  }

  const chip = (key: KindFilter, label: string) => (
    <button
      key={key}
      type="button"
      onClick={() => setKind(key)}
      className={`rounded-full px-3 py-1 text-xs font-semibold ${
        kind === key ? "bg-brand/20 text-neutral-100" : "text-neutral-400 hover:text-neutral-200"
      }`}
    >
      {label}
    </button>
  );

  return (
    <div className="space-y-4">
      <div
        onDragOver={(e) => {
          e.preventDefault();
          setDragOver(true);
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragOver(false);
          void upload(e.dataTransfer.files);
        }}
        onClick={() => inputRef.current?.click()}
        className={`cursor-pointer rounded-2xl border-2 border-dashed px-4 py-8 text-center text-sm ${
          dragOver ? "border-brand bg-brand/10 text-neutral-100" : "border-neutral-700 text-neutral-400"
        }`}
      >
        <p className="font-semibold text-neutral-200">Drop files here, or click to choose</p>
        <p className="mt-1 text-xs">
          Images, GIFs, Photoshop (.psd), Illustrator (.ai), videos, PDFs — up to 50 MB each. Images here can be used in any
          email. Photoshop and Illustrator files get an email-ready PNG copy made automatically.
        </p>
        <input
          ref={inputRef}
          type="file"
          multiple
          className="hidden"
          onChange={(e) => {
            if (e.target.files) void upload(e.target.files);
            e.target.value = "";
          }}
        />
      </div>
      {uploading && <p className="text-sm text-neutral-300">{uploading}</p>}
      {errors.map((e, i) => (
        <p key={i} className="text-sm text-red-300">
          {e}
        </p>
      ))}

      <div className="flex flex-wrap items-center gap-2">
        {chip("all", "All")}
        {chip("image", "Images")}
        {chip("gif", "GIFs")}
        {chip("psd", "Photoshop / Illustrator")}
        {chip("video", "Videos")}
        {chip("other", "Other")}
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search file names…"
          className="ml-auto w-full rounded-full border border-neutral-800 bg-neutral-900 px-4 py-1.5 text-sm text-neutral-100 sm:w-64"
        />
      </div>

      {shown.length === 0 ? (
        <p className="rounded-2xl border border-neutral-800 px-4 py-10 text-center text-sm text-neutral-500">
          {assets.length === 0 ? "No files yet." : "Nothing matches."}
        </p>
      ) : (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 2xl:grid-cols-6">
          {shown.map((a) => {
            const k = kindOf(a);
            return (
              <div key={a.id} className="flex flex-col overflow-hidden rounded-xl border border-neutral-800 bg-neutral-900/40">
                <div className="flex aspect-square items-center justify-center bg-neutral-950">
                  {isWebImage(a) ? (
                    // eslint-disable-next-line @next/next/no-img-element -- user-uploaded files from storage, any size
                    <img src={a.public_url} alt={a.name} className="max-h-full max-w-full object-contain" loading="lazy" />
                  ) : k === "video" ? (
                    <video src={a.public_url} className="max-h-full max-w-full" muted preload="metadata" />
                  ) : (
                    <span className="rounded-lg bg-neutral-800 px-3 py-2 text-sm font-bold uppercase text-neutral-300">
                      {k === "psd" ? (a.name.toLowerCase().endsWith(".ai") ? "AI" : "PSD") : k === "pdf" ? "PDF" : (a.name.split(".").pop() ?? "file").slice(0, 4)}
                    </span>
                  )}
                </div>
                <div className="space-y-1 p-2">
                  <p className="truncate text-xs font-semibold text-neutral-200" title={a.name}>
                    {a.name}
                  </p>
                  <p className="text-[11px] text-neutral-500">
                    {[a.width && a.height ? `${a.width}×${a.height}` : null, formatBytes(a.size_bytes)]
                      .filter(Boolean)
                      .join(" · ")}
                  </p>
                  <FolderSelect folders={folders} value={a.folder_id ?? null} onChange={(f) => onMove(a, f)} small />
                  <div className="flex flex-wrap gap-2 text-[11px]">
                    <button type="button" onClick={() => void copyLink(a)} className="text-brand underline">
                      {copied === a.id ? "Copied!" : "Copy link"}
                    </button>
                    <a href={a.public_url} download={a.name} target="_blank" rel="noreferrer" className="text-neutral-300 underline">
                      Download
                    </a>
                    {k === "psd" && (
                      <button
                        type="button"
                        disabled={converting === a.id}
                        onClick={() => void emailCopy(a)}
                        className="text-brand underline disabled:opacity-60"
                      >
                        {converting === a.id ? "Making PNG…" : "Make email copy"}
                      </button>
                    )}
                    {confirmId === a.id ? (
                      <span className="text-red-300">
                        Delete?{" "}
                        <button type="button" onClick={() => void remove(a)} className="font-semibold underline">
                          Yes
                        </button>{" "}
                        <button type="button" onClick={() => setConfirmId(null)} className="underline">
                          No
                        </button>
                      </span>
                    ) : (
                      <button type="button" onClick={() => setConfirmId(a.id)} className="text-neutral-500 underline">
                        Delete
                      </button>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// Folder menu on each email / file card (added 2026-11-06).
function FolderSelect({
  folders,
  value,
  onChange,
  small,
}: {
  folders: FolderRow[];
  value: string | null;
  onChange: (folderId: string | null) => void;
  small?: boolean;
}) {
  return (
    <label className={`flex items-center gap-1.5 ${small ? "text-[11px]" : "text-xs"} text-neutral-500`}>
      <span aria-hidden>📁</span>
      <select
        value={value ?? ""}
        onChange={(e) => onChange(e.target.value || null)}
        aria-label="Folder"
        className="min-w-0 flex-1 truncate rounded-md border border-neutral-800 bg-neutral-900 px-1.5 py-0.5 text-neutral-300"
      >
        <option value="">No folder</option>
        {folders.map((f) => (
          <option key={f.id} value={f.id}>
            {f.name}
          </option>
        ))}
      </select>
    </label>
  );
}

// The folder row above the Emails grid and the Creative Library (added
// 2026-11-06). All · each folder · No folder · + New folder. The folder being
// looked at can be renamed or deleted (what's inside goes to "No folder").
function FolderBar({
  folders,
  pick,
  onPick,
  counts,
  onCreate,
  onRename,
  onDelete,
}: {
  folders: FolderRow[];
  pick: FolderPick;
  onPick: (p: FolderPick) => void;
  counts: (id: FolderPick) => number;
  onCreate: (name: string) => Promise<boolean>;
  onRename: (id: string, name: string) => Promise<boolean>;
  onDelete: (id: string) => void;
}) {
  const foldersNew = useNewFeature("feature:email-studio-folders");
  const [adding, setAdding] = useState(false);
  const [newName, setNewName] = useState("");
  const [renaming, setRenaming] = useState(false);
  const [renameTo, setRenameTo] = useState("");
  const [confirmDelete, setConfirmDelete] = useState(false);
  const current = folders.find((f) => f.id === pick) ?? null;

  const chip = (id: FolderPick, label: string) => (
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
            <input autoFocus value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="Folder name (e.g. Oobli)" className={field} />
            <button type="submit" disabled={!newName.trim()} className="rounded-full bg-brand px-3 py-1 text-xs font-semibold text-black disabled:opacity-50">
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
              <input autoFocus value={renameTo} onChange={(e) => setRenameTo(e.target.value)} className={field} aria-label="New folder name" />
              <button type="submit" disabled={!renameTo.trim()} className="rounded-full bg-brand px-3 py-1 text-xs font-semibold text-black disabled:opacity-50">
                Save
              </button>
              <button type="button" onClick={() => setRenaming(false)} className="underline">
                Cancel
              </button>
            </form>
          ) : confirmDelete ? (
            <span className="text-red-300">
              Delete the &ldquo;{current.name}&rdquo; folder? Its emails and files stay — they move to No folder.{" "}
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
                Looking at <strong className="text-neutral-200">📁 {current.name}</strong> — new emails and uploads go in this folder.
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

// Canva → Creative Library how-to (added 2026-10-30, per Chad: "we need to do
// ernie and canva now"). A direct Canva connection needs Canva Enterprise
// (company-only apps) or Canva's public app review, so for now designs come
// in as exported files. Collapsed by default.
function CanvaHowTo() {
  const [open, setOpen] = useState(false);
  return (
    <div className="mb-4 rounded-2xl border border-neutral-800 bg-neutral-900/40 px-4 py-3 text-sm text-neutral-300">
      <button type="button" onClick={() => setOpen((v) => !v)} className="flex w-full items-center justify-between font-semibold text-neutral-100">
        <span>Bringing in Canva designs</span>
        <span className="text-xs text-neutral-500">{open ? "Hide" : "Show how"}</span>
      </button>
      {open && (
        <ol className="mt-2 list-decimal space-y-1 pl-5">
          <li>In Canva, open the design and click <strong>Share</strong> → <strong>Download</strong>.</li>
          <li>
            Pick the file type: <strong>PNG</strong> or <strong>JPG</strong> for pictures, <strong>GIF</strong> for a moving picture that
            plays inside the email. (MP4 videos can&apos;t play inside most email apps — use GIF for motion.)
          </li>
          <li>For email, set the width to about <strong>1200 px</strong> (sharp on phones, still loads fast). Keep GIFs under ~5 MB.</li>
          <li>Click <strong>Download</strong>, then drag the file onto this Creative Library (or click Upload).</li>
          <li>In the email designer, double-click an image (or drag in an Image block) and pick it from the library.</li>
          <li>Made a change in Canva? Download it again and upload it — the new version shows up next to the old one.</li>
        </ol>
      )}
    </div>
  );
}
