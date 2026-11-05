"use client";

import "grapesjs/dist/css/grapes.min.css";
import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import type { Editor } from "grapesjs";
import { createClient } from "@/lib/supabase/client";
import { isWebImage, uploadCreativeFiles, type CreativeAsset } from "@/lib/creativeAssets";
import { buildEmailDocument } from "@/lib/email/studio";
import EmailSendDialog from "@/components/EmailSendDialog";
import ErnieStudioPanel, { type EmailContent, type EmailScope } from "@/components/ErnieStudioPanel";
import { hasSwapPictures } from "@/lib/email/erniePlaceholder";
import NewBadge from "@/components/NewBadge";
import { useNewFeature } from "@/lib/newFeatures";
import EmailStudioGuide from "@/components/EmailStudioGuide";

// Email Studio's drag-and-drop email designer (added 2026-10-29, per Chad —
// Phase 1 of claude/email-designer-plan.md). Built on GrapesJS + its
// newsletter preset (both free, open source, BSD-3) — chosen over Unlayer's
// free plan because Unlayer charges for keeping uploads in our own storage,
// and our Creative Library needs to BE the image library here.
//
// - Blocks (sections, text, images, buttons, columns…) drag in from the right.
// - Desktop / tablet / phone view: the screen icons at the designer's top left.
// - Images: the image picker shows the Creative Library; files uploaded from
//   inside the picker go straight into the Creative Library too.
// - Save stores the designer's own data (reopens exactly as left) plus the
//   finished email HTML with styles inlined (what email programs need).
// - Every sent email gets the fixed footer (address + unsubscribe) added on
//   send — see lib/email/studio.ts. "Preview email" shows it too.

export type DesignFull = {
  id: string;
  name: string;
  subject: string | null;
  preheader: string | null;
  project_data: Record<string, unknown> | null;
  html: string | null;
  status: "draft" | "ready" | "archived";
  updated_at: string;
};

const LOGO_URL = "https://www.fcb-data.com/branding/fcb-logo.png";

// What a brand-new email starts with — an email-safe 600px layout Eddie can
// change or delete.
const STARTER_TEMPLATE = `
<table style="width:100%;background-color:#f4f4f4;border-collapse:collapse;" width="100%" cellpadding="0" cellspacing="0">
  <tr><td style="padding:24px 12px;" align="center">
    <table style="width:100%;max-width:600px;background-color:#ffffff;border-collapse:collapse;" width="600" cellpadding="0" cellspacing="0">
      <tr><td style="padding:24px;text-align:center;background-color:#111111;" align="center">
        <img src="${LOGO_URL}" alt="Full Circle Brewing" width="120" style="width:120px;max-width:120px;height:auto;"/>
      </td></tr>
      <tr><td style="padding:32px 24px 8px 24px;font-family:Arial,Helvetica,sans-serif;font-size:28px;line-height:34px;font-weight:bold;color:#111111;text-align:center;">
        New from Full Circle Brewing
      </td></tr>
      <tr><td style="padding:8px 24px 24px 24px;font-family:Arial,Helvetica,sans-serif;font-size:16px;line-height:24px;color:#333333;text-align:center;">
        Write your message here. Drag images, buttons and sections in from the right.
      </td></tr>
      <tr><td style="padding:0 24px 32px 24px;text-align:center;" align="center">
        <a href="https://fullcirclebrewing.com" style="display:inline-block;background-color:#6ABC46;color:#000000;padding:14px 28px;border-radius:6px;font-family:Arial,Helvetica,sans-serif;font-size:16px;font-weight:bold;text-decoration:none;">Contact your rep</a>
      </td></tr>
    </table>
  </td></tr>
</table>`;

const SWAP_FIRST = "Swap the gray “Swap this picture” boxes for real pictures first (double-click each one).";

function toAsset(a: CreativeAsset) {
  return { src: a.public_url, name: a.name, width: a.width ?? undefined, height: a.height ?? undefined };
}

export default function EmailDesignerClient({ design, assets }: { design: DesignFull; assets: CreativeAsset[] }) {
  const [supabase] = useState(() => createClient());
  const containerRef = useRef<HTMLDivElement>(null);
  const editorRef = useRef<Editor | null>(null);
  const [ready, setReady] = useState(false);
  const [name, setName] = useState(design.name);
  const [subject, setSubject] = useState(design.subject ?? "");
  const [preheader, setPreheader] = useState(design.preheader ?? "");
  const [status, setStatus] = useState(design.status === "ready" ? "ready" : "draft");
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [sending, setSending] = useState(false);
  const [msg, setMsg] = useState<{ text: string; bad?: boolean } | null>(null);
  const [previewHtml, setPreviewHtml] = useState<string | null>(null);
  const [savedAt, setSavedAt] = useState(design.updated_at);
  const [sendOpen, setSendOpen] = useState(false);
  // Ernie panel (added 2026-10-30) + the Creative Library as it grows this session.
  const [ernieOpen, setErnieOpen] = useState(false);
  // "?" — the How to use guide beside the designer (added 2026-10-30).
  const [helpOpen, setHelpOpen] = useState(false);
  const [library, setLibrary] = useState<CreativeAsset[]>(assets);
  // Ernie → Edit email (added 2026-11-05): what's selected in the canvas, and
  // the email as it was just before Ernie's last change (for Undo).
  const [selectedLabel, setSelectedLabel] = useState<string | null>(null);
  const editEmailNew = useNewFeature("feature:email-studio-ernie-edit-email");
  const beforeErnieRef = useRef<ReturnType<Editor["getProjectData"]> | null>(null);

  // Start the designer once.
  useEffect(() => {
    let cancelled = false;
    let editor: Editor | null = null;
    (async () => {
      const [{ default: grapesjs }, { default: newsletter }] = await Promise.all([
        import("grapesjs"),
        import("grapesjs-preset-newsletter"),
      ]);
      if (cancelled || !containerRef.current) return;

      editor = grapesjs.init({
        container: containerRef.current,
        height: "100%",
        width: "auto",
        fromElement: false,
        storageManager: false,
        plugins: [(ed) => newsletter(ed, { inlineCss: true })],
        assetManager: {
          assets: assets.filter(isWebImage).map(toAsset),
          upload: false,
          dropzone: false,
          // Files uploaded from the image picker go into the Creative Library.
          uploadFile: async (ev: DragEvent) => {
            const dt = ev.dataTransfer;
            const target = ev.target as HTMLInputElement | null;
            const files = Array.from(dt?.files ?? target?.files ?? []);
            for (const f of files) {
              try {
                // Photoshop/Illustrator files also get an email-ready PNG copy.
                const { rows, note } = await uploadCreativeFiles(supabase, f);
                for (const row of rows) {
                  setLibrary((list) => [row, ...list]);
                  if (isWebImage(row)) editor?.AssetManager.add(toAsset(row));
                }
                if (note) setMsg({ text: note, bad: true });
              } catch (e) {
                setMsg({ text: e instanceof Error ? e.message : String(e), bad: true });
              }
            }
          },
        },
      });

      if (design.project_data && Object.keys(design.project_data).length) {
        editor.loadProjectData(design.project_data);
      } else {
        editor.setComponents(STARTER_TEMPLATE);
      }

      editorRef.current = editor;
      setReady(true);
      const showSelected = () => {
        const sel = editor?.getSelected();
        setSelectedLabel(sel && sel !== editor?.getWrapper() ? sel.getName() || "Selected" : null);
      };
      editor.on("component:toggled", showSelected);
      editor.on("component:remove", showSelected);
      // Anything changed in the canvas after loading = unsaved changes.
      setTimeout(() => {
        editor?.on("update", () => setDirty(true));
      }, 500);
    })();
    return () => {
      cancelled = true;
      editor?.destroy();
      editorRef.current = null;
    };
    // Start once per design; assets/supabase are read only at start.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [design.id]);

  // Warn before leaving with unsaved changes.
  useEffect(() => {
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      if (!dirty) return;
      e.preventDefault();
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, [dirty]);

  // Ernie results → Creative Library list + the designer's image picker.
  const addToLibrary = useCallback((a: CreativeAsset) => {
    setLibrary((list) => (list.some((x) => x.id === a.id) ? list : [a, ...list]));
    if (isWebImage(a)) editorRef.current?.AssetManager.add(toAsset(a));
  }, []);

  // Puts a block into the email: right after whatever is selected in the
  // canvas, or at the end of the email if nothing is selected. If an image is
  // selected and we're inserting a plain image, it swaps that image instead.
  const insertBlock = useCallback((html: string, swapSrc?: string) => {
    const editor = editorRef.current;
    if (!editor) return;
    const sel = editor.getSelected();
    if (swapSrc && sel && sel.get("type") === "image") {
      sel.set("src", swapSrc);
    } else {
      const parent = sel?.parent();
      if (sel && parent) parent.append(html, { at: sel.index() + 1 });
      else editor.getWrapper()?.append(html);
    }
    setDirty(true);
    setMsg({ text: "Added to the email — drag it where you want it." });
  }, []);

  const insertImage = useCallback(
    (a: CreativeAsset) => {
      insertBlock(
        `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr><td align="center" style="padding:10px 0;">` +
          `<img src="${a.public_url}" alt="" width="600" style="display:block;width:100%;max-width:600px;height:auto;border:0;" />` +
          `</td></tr></table>`,
        a.public_url,
      );
    },
    [insertBlock],
  );

  // Video can't play inside most email apps: the still picture links to the
  // video, plus a "Watch the video" button.
  const insertVideo = useCallback(
    (video: CreativeAsset, poster: CreativeAsset | null) => {
      const pic = poster
        ? `<a href="${video.public_url}" target="_blank"><img src="${poster.public_url}" alt="Watch the video" width="600" style="display:block;width:100%;max-width:600px;height:auto;border:0;" /></a>`
        : "";
      insertBlock(
        `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr><td align="center" style="padding:10px 0;">` +
          pic +
          `<a href="${video.public_url}" target="_blank" style="display:inline-block;margin-top:10px;padding:10px 22px;background-color:#6ABC46;color:#000000;font-family:Arial,Helvetica,sans-serif;font-size:15px;font-weight:bold;text-decoration:none;border-radius:999px;">&#9654; Watch the video</a>` +
          `</td></tr></table>`,
      );
    },
    [insertBlock],
  );

  // Ernie → Edit email: what to send Ernie for each choice.
  const getEmailContent = useCallback((scope: EmailScope): EmailContent | null => {
    const editor = editorRef.current;
    if (!editor) return null;
    const full = editor.runCommand("gjs-get-inlined-html");
    const fullHtml = typeof full === "string" ? full : editor.getHtml();
    if (scope === "email") return { html: fullHtml };
    if (scope === "add") return { html: "", fullEmailHtml: fullHtml };
    const sel = editor.getSelected();
    if (!sel || sel === editor.getWrapper()) return null;
    return {
      html: editor.getHtml({ component: sel }),
      css: editor.getCss({ component: sel, onlyMatched: true }) ?? null,
      fullEmailHtml: fullHtml,
    };
  }, []);

  // Puts Ernie's change into the email, keeping a copy of the email from
  // just before so "Undo Ernie's change" can put it back.
  const applyErnieEmail = useCallback((html: string, scope: EmailScope): boolean => {
    const editor = editorRef.current;
    if (!editor || !html.trim()) return false;
    const before = editor.getProjectData();
    try {
      const sel = editor.getSelected();
      const hasSel = !!sel && sel !== editor.getWrapper();
      if (scope === "email") {
        editor.setComponents(html);
      } else if (scope === "selection") {
        if (!sel || !hasSel) return false;
        // Keep the email's tables valid: a table cell must be replaced by a
        // cell and a row by a row, whatever Ernie sent back.
        const tag = String(sel.get("tagName") || "").toLowerCase();
        const starts = (t: string) => new RegExp(`^\\s*<${t}[\\s>]`, "i").test(html);
        let fixed = html;
        if ((tag === "td" || tag === "th") && !starts("td") && !starts("th")) fixed = `<td style="padding:0;">${html}</td>`;
        else if (tag === "tr" && !starts("tr")) fixed = `<tr><td style="padding:0;">${html}</td></tr>`;
        const added = sel.replaceWith(fixed);
        if (added[0]) editor.select(added[0]);
      } else {
        // New section: as a new row right after the row the selected part is
        // in (so the email's tables stay valid), after the selected part if
        // it isn't in a table, or at the very end, centered.
        let row = hasSel ? sel : null;
        while (row && String(row.get("tagName") || "").toLowerCase() !== "tr") row = row.parent() ?? null;
        let added;
        if (row && row.parent()) {
          added = row.parent()!.append(`<tr><td style="padding:0;" align="center">${html}</td></tr>`, { at: row.index() + 1 });
        } else if (sel && hasSel && sel.parent()) {
          added = sel.parent()!.append(html, { at: sel.index() + 1 });
        } else {
          added =
            editor
              .getWrapper()
              ?.append(
                `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr><td align="center" style="padding:0 12px;">${html}</td></tr></table>`,
              ) ?? [];
        }
        if (added[0]) {
          editor.select(added[0]);
          added[0].view?.el?.scrollIntoView({ behavior: "smooth", block: "center" });
        }
      }
    } catch {
      editor.loadProjectData(before);
      return false;
    }
    beforeErnieRef.current = before;
    setDirty(true);
    setMsg({ text: "Ernie changed the email — look it over, then Save." });
    return true;
  }, []);

  const undoErnieEmail = useCallback(() => {
    const editor = editorRef.current;
    if (!editor || !beforeErnieRef.current) return;
    editor.loadProjectData(beforeErnieRef.current);
    beforeErnieRef.current = null;
    setSelectedLabel(null);
    setDirty(true);
    setMsg({ text: "Undid Ernie's change." });
  }, []);

  // Upload from inside the Ernie panel → Creative Library (+ image picker).
  const uploadFromErnie = useCallback(
    async (file: File): Promise<CreativeAsset[]> => {
      const { rows, note } = await uploadCreativeFiles(supabase, file);
      for (const row of rows) addToLibrary(row);
      if (note) setMsg({ text: note, bad: true });
      return rows;
    },
    [supabase, addToLibrary],
  );

  const inlinedHtml = useCallback((): string => {
    const editor = editorRef.current;
    if (!editor) return "";
    const out = editor.runCommand("gjs-get-inlined-html");
    return typeof out === "string" ? out : editor.getHtml();
  }, []);

  const save = useCallback(async (): Promise<boolean> => {
    const editor = editorRef.current;
    if (!editor) return false;
    setSaving(true);
    setMsg(null);
    const {
      data: { user },
    } = await supabase.auth.getUser();
    const now = new Date().toISOString();
    const { error } = await supabase
      .from("email_designs")
      .update({
        name: name.trim() || "Untitled email",
        subject: subject.trim() || null,
        preheader: preheader.trim() || null,
        status,
        project_data: editor.getProjectData(),
        html: inlinedHtml(),
        updated_by: user?.id ?? null,
        updated_at: now,
      })
      .eq("id", design.id);
    setSaving(false);
    if (error) {
      setMsg({ text: `Couldn't save: ${error.message}`, bad: true });
      return false;
    }
    setDirty(false);
    setSavedAt(now);
    setMsg({ text: "Saved." });
    return true;
  }, [supabase, name, subject, preheader, status, design.id, inlinedHtml]);

  // Ctrl/Cmd + S saves.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "s") {
        e.preventDefault();
        void save();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [save]);

  async function sendTest() {
    if (!subject.trim()) {
      setMsg({ text: "Add a subject line first.", bad: true });
      return;
    }
    if (hasSwapPictures(inlinedHtml())) {
      setMsg({ text: SWAP_FIRST, bad: true });
      return;
    }
    // Always send what's on screen — save first.
    if (!(await save())) return;
    setSending(true);
    try {
      const res = await fetch("/api/email-studio/test-send", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ designId: design.id }),
      });
      const json = (await res.json().catch(() => ({}))) as { ok?: boolean; to?: string; error?: string };
      setMsg(
        res.ok && json.ok
          ? { text: `Test sent to ${json.to}.` }
          : { text: json.error ?? "Couldn't send the test.", bad: true },
      );
    } catch {
      setMsg({ text: "Couldn't send the test.", bad: true });
    } finally {
      setSending(false);
    }
  }

  function openPreview() {
    setPreviewHtml(
      buildEmailDocument({
        bodyHtml: inlinedHtml(),
        subject: subject || name,
        preheader,
        unsubscribeUrl: "#",
      }),
    );
  }

  const field = "rounded-lg border border-neutral-700 bg-neutral-900 px-3 py-1.5 text-sm text-neutral-100";
  const btn = "rounded-full border border-neutral-700 px-3 py-1.5 text-sm text-neutral-200 hover:bg-neutral-800 disabled:opacity-50";

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <Link
          href="/admin/email"
          onClick={(e) => {
            if (dirty && !window.confirm("You have unsaved changes. Leave without saving?")) e.preventDefault();
          }}
          className="text-sm text-neutral-400 hover:text-neutral-200"
        >
          ← Email Studio
        </Link>
        <input
          value={name}
          onChange={(e) => {
            setName(e.target.value);
            setDirty(true);
          }}
          className={`${field} w-56 font-semibold`}
          aria-label="Email name"
          placeholder="Email name"
        />
        <select
          value={status}
          onChange={(e) => {
            setStatus(e.target.value as "draft" | "ready");
            setDirty(true);
          }}
          className={field}
          aria-label="Status"
        >
          <option value="draft">Draft</option>
          <option value="ready">Ready</option>
        </select>
        <div className="ml-auto flex flex-wrap items-center gap-2">
          <button
            type="button"
            className={btn}
            onClick={() => {
              setErnieOpen(false);
              setHelpOpen(true);
            }}
            title="How to use"
            aria-label="How to use"
          >
            ?
          </button>
          <button
            type="button"
            className={btn}
            disabled={!ready}
            onClick={() => {
              setHelpOpen(false);
              setErnieOpen(true);
            }}
          >
            ✨ Ernie
            {editEmailNew.isNew && <NewBadge inline />}
          </button>
          <button type="button" className={btn} disabled={!ready} onClick={openPreview}>
            Preview email
          </button>
          <button type="button" className={btn} disabled={!ready || sending || saving} onClick={() => void sendTest()}>
            {sending ? "Sending…" : "Send me a test"}
          </button>
          <button
            type="button"
            className={btn}
            disabled={!ready || saving}
            onClick={() => {
              if (!subject.trim()) {
                setMsg({ text: "Add a subject line first.", bad: true });
                return;
              }
              if (hasSwapPictures(inlinedHtml())) {
                setMsg({ text: SWAP_FIRST, bad: true });
                return;
              }
              setSendOpen(true);
            }}
          >
            Send…
          </button>
          <button
            type="button"
            disabled={!ready || saving}
            onClick={() => void save()}
            className="rounded-full bg-brand px-4 py-1.5 text-sm font-semibold text-black disabled:opacity-60"
          >
            {saving ? "Saving…" : dirty ? "Save" : "Saved"}
          </button>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <input
          value={subject}
          onChange={(e) => {
            setSubject(e.target.value);
            setDirty(true);
          }}
          className={`${field} min-w-[260px] flex-1`}
          placeholder="Subject line"
          aria-label="Subject line"
        />
        <input
          value={preheader}
          onChange={(e) => {
            setPreheader(e.target.value);
            setDirty(true);
          }}
          className={`${field} min-w-[260px] flex-1`}
          placeholder="Preview text (the grey line after the subject in most inboxes)"
          aria-label="Preview text"
        />
      </div>

      <div className="flex flex-wrap items-center gap-3 text-xs text-neutral-500">
        <span>
          Last saved{" "}
          {new Date(savedAt).toLocaleString("en-US", {
            month: "short",
            day: "numeric",
            hour: "numeric",
            minute: "2-digit",
            timeZone: "America/Los_Angeles",
          })}
          {dirty ? " · unsaved changes" : ""}
        </span>
        <span>Every email gets the FCB address + unsubscribe footer automatically when sent.</span>
        {msg && <span className={msg.bad ? "font-semibold text-red-300" : "font-semibold text-green-300"}>{msg.text}</span>}
      </div>

      <div className="h-[calc(100vh-230px)] min-h-[620px] overflow-hidden rounded-2xl border border-neutral-800 bg-white">
        {!ready && <p className="p-6 text-sm text-neutral-500">Loading the designer…</p>}
        <div ref={containerRef} className="h-full" />
      </div>

      {helpOpen && (
        <aside className="fixed inset-y-0 right-0 z-40 flex w-full max-w-[460px] flex-col border-l border-neutral-800 bg-neutral-950 shadow-2xl">
          <div className="flex items-center justify-between border-b border-neutral-800 px-4 py-3">
            <h2 className="text-base font-semibold text-neutral-100">How to use</h2>
            <button type="button" onClick={() => setHelpOpen(false)} className="text-sm text-neutral-400 hover:text-neutral-100">
              Close
            </button>
          </div>
          <div className="flex-1 overflow-y-auto px-4 py-4">
            <EmailStudioGuide compact initialOpen="designing" />
          </div>
        </aside>
      )}

      {ernieOpen && (
        <ErnieStudioPanel
          assets={library}
          onClose={() => setErnieOpen(false)}
          onNewAsset={addToLibrary}
          onInsertImage={insertImage}
          onInsertVideo={insertVideo}
          selectedLabel={selectedLabel}
          getEmailContent={getEmailContent}
          onApplyEmail={applyErnieEmail}
          onUndoEmail={undoErnieEmail}
          onUpload={uploadFromErnie}
        />
      )}

      {sendOpen && (
        <EmailSendDialog designId={design.id} subject={subject} onClose={() => setSendOpen(false)} beforeSend={save} />
      )}

      {previewHtml && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4" onClick={() => setPreviewHtml(null)}>
          <div
            className="flex h-[90vh] w-full max-w-[720px] flex-col overflow-hidden rounded-2xl bg-white"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between border-b border-neutral-200 px-4 py-2 text-sm text-neutral-700">
              <span className="truncate">
                <strong>{subject || "(no subject)"}</strong>
                {preheader ? <span className="text-neutral-500"> — {preheader}</span> : null}
              </span>
              <button type="button" onClick={() => setPreviewHtml(null)} className="text-neutral-500 hover:text-neutral-900">
                Close
              </button>
            </div>
            <iframe title="Email preview" srcDoc={previewHtml} className="h-full w-full" sandbox="" />
          </div>
        </div>
      )}
    </div>
  );
}
