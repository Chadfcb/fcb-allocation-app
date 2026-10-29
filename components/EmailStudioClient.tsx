"use client";

import { useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import {
  CREATIVE_BUCKET,
  formatBytes,
  isWebImage,
  kindOf,
  uploadCreativeAsset,
  type CreativeAsset,
} from "@/lib/creativeAssets";

// Admin → Email Studio (added 2026-10-29, per Chad — Phase 1 of
// claude/email-designer-plan.md). Two tabs:
//   Emails           — saved email designs; New email opens the designer.
//   Creative Library — every image / GIF / PSD / video / PDF Eddie uses.
//                      Images here also show up in the designer's image picker.

export type DesignRow = {
  id: string;
  name: string;
  subject: string | null;
  status: "draft" | "ready" | "archived";
  updated_at: string;
  updated_by: string | null;
  updated_by_name: string | null;
};
export type AssetRow = CreativeAsset;

type Tab = "emails" | "library";
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
  loadError,
}: {
  designs: DesignRow[];
  assets: AssetRow[];
  loadError: string | null;
}) {
  const router = useRouter();
  const [supabase] = useState(() => createClient());
  const [tab, setTab] = useState<Tab>("emails");
  const [designs, setDesigns] = useState(initialDesigns);
  const [assets, setAssets] = useState(initialAssets);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  async function newEmail(copyFrom?: DesignRow) {
    setBusy(true);
    setMsg(null);
    const {
      data: { user },
    } = await supabase.auth.getUser();
    let row: Record<string, unknown> = { name: "Untitled email", created_by: user?.id, updated_by: user?.id };
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

  const tabBtn = (key: Tab, label: string, count: number) => (
    <button
      type="button"
      onClick={() => setTab(key)}
      className={`rounded-full px-4 py-1.5 text-sm font-semibold ${
        tab === key ? "bg-brand/20 text-neutral-100" : "text-neutral-400 hover:text-neutral-200"
      }`}
    >
      {label} <span className="text-neutral-500">{count}</span>
    </button>
  );

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-lg font-semibold text-neutral-100">Email Studio</h1>
          <p className="text-sm text-neutral-400">
            Design FCB&apos;s emails with drag-and-drop, and keep every image, GIF, Photoshop file and video in the
            Creative Library. Test emails send from ernie@fullcirclebrewing.com to you only.
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

      <div className="flex gap-2">
        {tabBtn("emails", "Emails", designs.length)}
        {tabBtn("library", "Creative Library", assets.length)}
      </div>

      {tab === "emails" ? (
        <EmailsGrid designs={designs} onDuplicate={(d) => void newEmail(d)} onArchive={(d) => void archive(d)} />
      ) : (
        <CreativeLibrary supabase={supabase} assets={assets} setAssets={setAssets} />
      )}
    </div>
  );
}

function EmailsGrid({
  designs,
  onDuplicate,
  onArchive,
}: {
  designs: DesignRow[];
  onDuplicate: (d: DesignRow) => void;
  onArchive: (d: DesignRow) => void;
}) {
  const [confirmId, setConfirmId] = useState<string | null>(null);
  if (designs.length === 0) {
    return (
      <p className="rounded-2xl border border-neutral-800 px-4 py-10 text-center text-sm text-neutral-500">
        No emails yet. Click &ldquo;New email&rdquo; to start one.
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
}: {
  supabase: ReturnType<typeof createClient>;
  assets: AssetRow[];
  setAssets: React.Dispatch<React.SetStateAction<AssetRow[]>>;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [kind, setKind] = useState<KindFilter>("all");
  const [search, setSearch] = useState("");
  const [uploading, setUploading] = useState<string | null>(null);
  const [errors, setErrors] = useState<string[]>([]);
  const [dragOver, setDragOver] = useState(false);
  const [copied, setCopied] = useState<string | null>(null);
  const [confirmId, setConfirmId] = useState<string | null>(null);

  const shown = useMemo(() => {
    const q = search.trim().toLowerCase();
    return assets.filter((a) => {
      const k = kindOf(a);
      if (kind === "other" && ["image", "gif", "psd", "video"].includes(k)) return false;
      if (kind !== "all" && kind !== "other" && k !== kind) return false;
      return !q || a.name.toLowerCase().includes(q);
    });
  }, [assets, kind, search]);

  async function upload(files: FileList | File[]) {
    const list = Array.from(files);
    if (!list.length) return;
    const errs: string[] = [];
    for (let i = 0; i < list.length; i++) {
      setUploading(`Uploading ${i + 1} of ${list.length}: ${list[i].name}`);
      try {
        const row = await uploadCreativeAsset(supabase, list[i]);
        setAssets((prev) => [row, ...prev]);
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
          Images, GIFs, Photoshop (.psd), videos, PDFs — up to 50 MB each. Images here can be used in any email.
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
        {chip("psd", "Photoshop")}
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
                      {k === "psd" ? "PSD" : k === "pdf" ? "PDF" : (a.name.split(".").pop() ?? "file").slice(0, 4)}
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
                  <div className="flex flex-wrap gap-2 text-[11px]">
                    <button type="button" onClick={() => void copyLink(a)} className="text-brand underline">
                      {copied === a.id ? "Copied!" : "Copy link"}
                    </button>
                    <a href={a.public_url} download={a.name} target="_blank" rel="noreferrer" className="text-neutral-300 underline">
                      Download
                    </a>
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
