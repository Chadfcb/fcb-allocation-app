"use client";

// Ernie AI — the in-app assistant every signed-in user can ask about
// inventory, allocations, distributors, events, purchase orders, pricing,
// and (since 2026-08-31) files they attach directly in this chat. Ernie
// itself is still read-only against the app's own data — the one thing it
// CAN produce is a new/edited copy of a file the user attached (e.g. an
// edited spreadsheet), never a change to the app's own database.
//
// Visual redesign (2026-09-05, per Chad — "it looks super basic and
// unappealing"): a green-tinted dark panel using FCB's own brand colors
// (black/white/#6ABC46, the same green used for the active item in the left
// sidebar) plus Archivo/IBM Plex type, in place of the previous plain
// black-and-white look. This is scoped ENTIRELY to this component via
// next/font/google + literal Tailwind arbitrary-value classes — it
// deliberately does not touch app/globals.css or app/layout.tsx, since
// those apply to every other page. Approved via an iterative HTML preview
// before being built here; nothing about the underlying behavior below
// changed, only markup/classes.
//
// A plain <img> (not next/image) is used for the thinking gif so its
// animation isn't touched by Next's image optimizer. The skeleton mascot
// appears next to only the most recent one of Ernie's replies — the static
// first-frame PNG once that reply is showing, swapped for the real animated
// GIF only for the transient "Ernie is thinking…" row while a reply is
// being generated (GIFs can't be paused via CSS, hence swapping src
// instead). Both image files were reprocessed to strip a baked-in solid
// black background so they sit directly on the new panel color.
//
// The app's shared (app) layout doesn't give its <main> an explicit height
// (other pages just grow with their content and let the whole page scroll),
// so a plain h-full here wouldn't reliably fill the remaining viewport —
// the input bar would sit right under the last message instead of staying
// pinned to the bottom of the screen the way Claude's own chat UI does.
// Measuring the panel's own top offset and sizing it to fill exactly the
// rest of the viewport (updated on resize) sidesteps that without having to
// change the shared layout for every other page.
//
// Conversation history now lives in the database (ernie_conversations /
// ernie_messages, via /api/ernie/chat + /api/ernie/conversations), not just
// in this component's state — that's what lets a conversation survive
// clicking over to another page and back, a full refresh, or opening Ernie
// from a different device. sessionStorage only ever holds a lightweight
// pointer to "which conversation is this tab currently looking at" so a
// remount (e.g. after navigating away and back) knows what to reload; the
// message content itself always comes from the database. A literal "new"
// sentinel value marks "the user explicitly started a fresh conversation"
// so coming back to /ernie mid-blank-conversation doesn't get overridden by
// whatever conversation happened to be most recently updated.
//
// File attachments (added 2026-08-31, "spreadsheets is important, we use so
// many, having ernie to be able to edit them and analyze them would be
// huge" — Chad): a file is uploaded straight from here to Supabase Storage
// (same direct-to-storage pattern as PosLabelFilesClient) — this component
// never sends raw file bytes through /api/ernie/chat, just the resulting
// file_id(s). Drag-and-drop onto the whole panel and a click-to-browse
// attach button both go through the same handleFiles(). Ernie's own
// produced files (e.g. an edited spreadsheet from edit_spreadsheet) arrive
// via the chat route's "done" event as outputFileIds, resolved into
// downloadable chips the same way.

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { Archivo, IBM_Plex_Mono, IBM_Plex_Sans } from "next/font/google";
import { createClient } from "@/lib/supabase/client";
import { fileIcon, formatBytes, storageFileName } from "@/lib/events";
import { ERNIE_FILES_BUCKET, ERNIE_MAX_FILE_BYTES, ERNIE_MAX_FILES_PER_MESSAGE } from "@/lib/ernie/fileLimits";

// Scoped to this component only — see the file-level comment above.
const archivo = Archivo({ subsets: ["latin"], weight: ["600", "700", "800"], variable: "--font-archivo" });
const plexSans = IBM_Plex_Sans({ subsets: ["latin"], weight: ["400", "500", "600"], variable: "--font-plex-sans" });
const plexMono = IBM_Plex_Mono({ subsets: ["latin"], weight: ["400", "500"], variable: "--font-plex-mono" });

interface ErnieFile {
  id: string;
  file_name: string;
  mime_type: string | null;
  size_bytes: number | null;
  storage_path: string;
  // Which Storage bucket storage_path actually lives in. Null/undefined
  // means the default "ernie-files" bucket (every file the user uploads,
  // and every spreadsheet Ernie edits) — only set when Ernie fetched this
  // via get_file_for_download from some OTHER part of the app (e.g. a POS
  // label file), where the bytes were never copied, just referenced.
  source_bucket?: string | null;
}

interface ChatMessage {
  role: "user" | "assistant";
  text: string;
  files?: ErnieFile[];
}

interface ConversationSummary {
  id: string;
  title: string | null;
  created_at: string;
  updated_at: string;
}

// Ernie Projects (added 2026-09-10) — named containers with their own file
// library and their own conversation history, visible only to whoever's
// been granted access (see sql/ernie_projects.sql). A project tab isn't
// persisted across a page refresh — landing back on /ernie always starts
// on General, same as before this feature existed; switching tabs is a
// same-session action.
interface ErnieProject {
  id: string;
  name: string;
  description: string | null;
  created_by: string | null;
  created_at: string;
}

interface ProjectFile {
  id: string;
  file_name: string;
  storage_path: string;
  description: string | null;
  mime_type: string | null;
  size_bytes: number | null;
  added_by: string | null;
  created_at: string;
}

interface ProjectAccessUser {
  id: string;
  full_name: string | null;
  email: string;
  role: string;
  has_access: boolean;
}

const ACTIVE_CONVERSATION_KEY = "ernie_active_conversation_id";
const NEW_SENTINEL = "new";

// firstName can come from a full name or from the part of an email before
// the "@" (see app/(app)/ernie/page.tsx) — the latter is often all lowercase
// (e.g. "chad" from chad@fullcirclebrewing.com), so the greeting capitalizes
// it rather than trusting the source casing.
function capitalize(name: string) {
  return name ? name.charAt(0).toUpperCase() + name.slice(1) : name;
}

function formatRelative(iso: string) {
  const date = new Date(iso);
  const diffMs = Date.now() - date.getTime();
  const diffMin = Math.round(diffMs / 60000);
  if (diffMin < 1) return "just now";
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHr = Math.round(diffMin / 60);
  if (diffHr < 24) return `${diffHr}h ago`;
  const diffDay = Math.round(diffHr / 24);
  if (diffDay < 7) return `${diffDay}d ago`;
  return date.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

export default function ErnieChatClient({
  firstName,
  canManageProjects,
}: {
  firstName: string;
  // Whether this signed-in user can create Ernie Projects, manage a
  // project's access, and add/remove its files — Administrators and
  // Managers only (role === "admin", either tier). Everyone with Ernie
  // access at all can still see and use a project they've been granted.
  canManageProjects: boolean;
}) {
  const supabase = useMemo(() => createClient(), []);

  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [conversationId, setConversationId] = useState<string | null>(null);

  // --- Ernie Projects state ---------------------------------------------
  const [projects, setProjects] = useState<ErnieProject[]>([]);
  const [activeProjectId, setActiveProjectId] = useState<string | null>(null);
  const activeProject = activeProjectId ? projects.find((p) => p.id === activeProjectId) ?? null : null;

  const [createProjectOpen, setCreateProjectOpen] = useState(false);
  const [newProjectName, setNewProjectName] = useState("");
  const [newProjectDescription, setNewProjectDescription] = useState("");
  const [creatingProject, setCreatingProject] = useState(false);
  const [createProjectError, setCreateProjectError] = useState<string | null>(null);

  const [projectFiles, setProjectFiles] = useState<ProjectFile[]>([]);
  const [projectFilesLoading, setProjectFilesLoading] = useState(false);
  const [filesOpen, setFilesOpen] = useState(false);
  const [projectFileUploading, setProjectFileUploading] = useState(false);
  const [projectFileUploadError, setProjectFileUploadError] = useState<string | null>(null);
  const projectFileInputRef = useRef<HTMLInputElement | null>(null);

  const [manageAccessOpen, setManageAccessOpen] = useState(false);
  const [accessUsers, setAccessUsers] = useState<ProjectAccessUser[]>([]);
  const [accessLoading, setAccessLoading] = useState(false);
  const [accessSavingId, setAccessSavingId] = useState<string | null>(null);
  const [accessError, setAccessError] = useState<string | null>(null);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  // Live "what Ernie is doing right now" label (e.g. "Checking inventory &
  // allocations"), driven by status events streamed from /api/ernie/chat —
  // purely a live UI thing, never persisted with the conversation.
  const [statusLabel, setStatusLabel] = useState<string | null>(null);
  const [initializing, setInitializing] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [history, setHistory] = useState<ConversationSummary[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);

  // "What Ernie knows about you" — private per-user notes Ernie builds up
  // on its own (see lib/ernie/tools.ts's update_person_notes tool and
  // sql/ernie_user_notes.sql). RLS scopes every query here to the
  // signed-in user's own row automatically — nobody else, not even an
  // admin, can read or write it, so this panel never needs a user id
  // filter or a server route of its own.
  const [notesOpen, setNotesOpen] = useState(false);
  const [notesText, setNotesText] = useState("");
  const [notesLoading, setNotesLoading] = useState(false);
  const [notesSaving, setNotesSaving] = useState(false);
  const [notesError, setNotesError] = useState<string | null>(null);
  const [notesSavedAt, setNotesSavedAt] = useState<number | null>(null);

  async function openNotes() {
    setNotesOpen(true);
    setNotesError(null);
    setNotesLoading(true);
    const { data, error: notesErr } = await supabase
      .from("ernie_user_notes")
      .select("notes")
      .maybeSingle();
    setNotesLoading(false);
    if (notesErr) {
      setNotesError("Couldn't load your notes — try again in a moment.");
      return;
    }
    setNotesText(data?.notes ?? "");
  }

  async function saveNotes() {
    setNotesSaving(true);
    setNotesError(null);
    const trimmed = notesText.trim();
    const { error: saveErr } = trimmed
      ? await supabase
          .from("ernie_user_notes")
          .upsert({ user_id: userId, notes: trimmed, updated_at: new Date().toISOString() }, { onConflict: "user_id" })
      : await supabase.from("ernie_user_notes").delete().eq("user_id", userId ?? "");
    setNotesSaving(false);
    if (saveErr) {
      setNotesError("Couldn't save — try again.");
      return;
    }
    setNotesText(trimmed);
    setNotesSavedAt(Date.now());
  }

  // Pop-out window support (added 2026-09-10, Chad: "if i ask him something
  // then want to go look in the app, i cant do both at once, i have to swap
  // back and forth"). window.opener is only set on a window that was itself
  // opened via window.open from another window/tab of this same app, so it
  // doubles as a reliable "am I the popup right now" flag — no separate
  // route or query param needed. Conversation history already lives in the
  // database (see the load-on-mount effect above), and sessionStorage is
  // shared between an opener and the popup it spawns, so the popup picks up
  // the exact same conversation you were already in rather than starting a
  // blank one.
  const [isPopup, setIsPopup] = useState(false);
  useEffect(() => {
    setIsPopup(typeof window !== "undefined" && !!window.opener);
  }, []);

  function openPopout() {
    window.open(
      "/ernie",
      "ernie-popup",
      "width=440,height=760,resizable=yes,menubar=no,toolbar=no,location=no,status=no",
    );
  }

  const [userId, setUserId] = useState<string | null>(null);
  const [pendingFiles, setPendingFiles] = useState<ErnieFile[]>([]);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [dragActive, setDragActive] = useState(false);
  const [downloadingId, setDownloadingId] = useState<string | null>(null);
  const dragCounter = useRef(0);

  const scrollRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [panelHeight, setPanelHeight] = useState<number | null>(null);

  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => setUserId(data.user?.id ?? null));
  }, [supabase]);

  useEffect(() => {
    scrollRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, loading]);

  useLayoutEffect(() => {
    function updateHeight() {
      if (!panelRef.current) return;
      const top = panelRef.current.getBoundingClientRect().top;
      // The shared (app) layout's <main> wraps every page in "py-6", so
      // there's padding below this panel too — without subtracting it, the
      // panel's bottom (and the input bar in it) always sat just far enough
      // past the viewport's bottom edge to force a page-level scrollbar.
      const parentPaddingBottom = panelRef.current.parentElement
        ? parseFloat(getComputedStyle(panelRef.current.parentElement).paddingBottom || "0")
        : 0;
      setPanelHeight(window.innerHeight - top - parentPaddingBottom);
    }
    updateHeight();
    window.addEventListener("resize", updateHeight);
    return () => window.removeEventListener("resize", updateHeight);
  }, []);

  // Restore whichever conversation this tab was last looking at (or the
  // most recently updated one, for a brand-new tab/session) so navigating
  // back to /ernie — or opening it fresh on another device — doesn't drop
  // you into a blank conversation you didn't ask to start.
  useEffect(() => {
    let cancelled = false;

    async function loadConversation(id: string): Promise<boolean> {
      try {
        const res = await fetch(`/api/ernie/conversations/${id}`);
        if (!res.ok) return false;
        const data = await res.json();
        if (cancelled) return true;
        setMessages(data.messages ?? []);
        setConversationId(data.conversation.id);
        return true;
      } catch {
        return false;
      }
    }

    async function init() {
      const stored =
        typeof window !== "undefined" ? sessionStorage.getItem(ACTIVE_CONVERSATION_KEY) : null;

      if (stored === NEW_SENTINEL) {
        setInitializing(false);
        return;
      }

      if (stored) {
        const ok = await loadConversation(stored);
        if (ok) {
          setInitializing(false);
          return;
        }
        // Stale pointer (conversation deleted, or from a browser that's no
        // longer signed in as this admin) — fall through to "most recent".
      }

      try {
        const listRes = await fetch("/api/ernie/conversations");
        if (listRes.ok) {
          const listData = await listRes.json();
          const mostRecent: ConversationSummary | undefined = listData.conversations?.[0];
          if (mostRecent && !cancelled) {
            const ok = await loadConversation(mostRecent.id);
            if (ok) sessionStorage.setItem(ACTIVE_CONVERSATION_KEY, mostRecent.id);
          }
        }
      } catch {
        // Ernie still works with a blank conversation — it just won't have
        // restored history this time.
      } finally {
        if (!cancelled) setInitializing(false);
      }
    }

    init();
    return () => {
      cancelled = true;
    };
  }, []);

  // Load the sidebar's conversation list once on mount — it's always
  // visible now (no more click-to-open History dropdown), so it needs its
  // own data as soon as the page loads rather than waiting to be opened.
  // Scoped to whichever Project (if any) is currently active — see
  // refreshHistory below.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      setHistoryLoading(true);
      try {
        const res = await fetch("/api/ernie/conversations");
        if (res.ok && !cancelled) {
          const data = await res.json();
          setHistory(data.conversations ?? []);
        }
      } finally {
        if (!cancelled) setHistoryLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // Every Project this signed-in user has access to (RLS on ernie_projects
  // already limits this — see sql/ernie_projects.sql), for the tab row
  // above the header. Loaded once on mount; refreshed after creating one.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/ernie/projects");
        if (res.ok && !cancelled) {
          const data = await res.json();
          setProjects(data.projects ?? []);
        }
      } catch {
        // Tabs just won't show up this load — General still works fine.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // Conversation list for the right-hand sidebar — loaded on mount, after
  // every reply, and whenever the active Project tab changes, rather than
  // only when a dropdown is opened, since the sidebar is on-screen at all
  // times now. Omitting projectId scopes to the general (non-Project)
  // history; passing one scopes to that Project's own history — the two
  // never mix (see app/api/ernie/conversations/route.ts).
  async function refreshHistory(projectId?: string | null) {
    const scopedTo = projectId !== undefined ? projectId : activeProjectId;
    try {
      const res = await fetch(
        scopedTo ? `/api/ernie/conversations?projectId=${scopedTo}` : "/api/ernie/conversations",
      );
      if (res.ok) {
        const data = await res.json();
        setHistory(data.conversations ?? []);
      }
    } catch {
      // leave the stale list showing rather than erroring the whole panel
    }
  }

  async function loadProjectFiles(projectId: string) {
    setProjectFilesLoading(true);
    try {
      const res = await fetch(`/api/ernie/projects/${projectId}/files`);
      if (res.ok) {
        const data = await res.json();
        setProjectFiles(data.files ?? []);
      }
    } finally {
      setProjectFilesLoading(false);
    }
  }

  // Switching tabs (General <-> a Project, or between two Projects) starts
  // a blank conversation in that context and loads its own file list and
  // its own conversation history — deliberately does not try to auto-open
  // whatever conversation was last open there; "New Conversation"/the
  // history list handle picking one up again.
  async function switchToProject(projectId: string | null) {
    if (projectId === activeProjectId) return;
    setActiveProjectId(projectId);
    setMessages([]);
    setConversationId(null);
    setError(null);
    setFilesOpen(false);
    setProjectFiles([]);
    setHistoryLoading(true);
    await refreshHistory(projectId);
    setHistoryLoading(false);
    if (projectId) await loadProjectFiles(projectId);
  }

  async function createProject() {
    const name = newProjectName.trim();
    if (!name) {
      setCreateProjectError("Give it a name.");
      return;
    }
    setCreatingProject(true);
    setCreateProjectError(null);
    try {
      const res = await fetch("/api/ernie/projects", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name, description: newProjectDescription.trim() || undefined }),
      });
      const data = await res.json();
      if (!res.ok) {
        setCreateProjectError(data.error ?? "Couldn't create that Project.");
        return;
      }
      setProjects((prev) => [...prev, data.project].sort((a, b) => a.name.localeCompare(b.name)));
      setCreateProjectOpen(false);
      setNewProjectName("");
      setNewProjectDescription("");
      switchToProject(data.project.id);
    } catch {
      setCreateProjectError("Couldn't reach the server — try again.");
    } finally {
      setCreatingProject(false);
    }
  }

  async function openManageAccess() {
    if (!activeProjectId) return;
    setManageAccessOpen(true);
    setAccessError(null);
    setAccessLoading(true);
    try {
      const res = await fetch(`/api/ernie/projects/${activeProjectId}/access`);
      const data = await res.json();
      if (!res.ok) {
        setAccessError(data.error ?? "Couldn't load access for this Project.");
        return;
      }
      setAccessUsers(data.users ?? []);
    } catch {
      setAccessError("Couldn't reach the server — try again.");
    } finally {
      setAccessLoading(false);
    }
  }

  async function toggleUserAccess(user: ProjectAccessUser) {
    if (!activeProjectId) return;
    setAccessSavingId(user.id);
    setAccessError(null);
    try {
      const res = user.has_access
        ? await fetch(`/api/ernie/projects/${activeProjectId}/access?userId=${user.id}`, { method: "DELETE" })
        : await fetch(`/api/ernie/projects/${activeProjectId}/access`, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ userId: user.id }),
          });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}) as { error?: string });
        setAccessError(data.error ?? "Couldn't update access.");
        return;
      }
      setAccessUsers((prev) =>
        prev.map((u) => (u.id === user.id ? { ...u, has_access: !u.has_access } : u)),
      );
    } catch {
      setAccessError("Couldn't reach the server — try again.");
    } finally {
      setAccessSavingId(null);
    }
  }

  async function handleProjectFiles(fileList: FileList) {
    if (!activeProjectId) return;
    setProjectFileUploading(true);
    setProjectFileUploadError(null);
    try {
      for (const file of Array.from(fileList)) {
        const path = `${activeProjectId}/${storageFileName(file.name)}`;
        const { error: uploadErr } = await supabase.storage.from("ernie-project-files").upload(path, file);
        if (uploadErr) {
          setProjectFileUploadError(`Couldn't upload ${file.name}: ${uploadErr.message}`);
          continue;
        }
        const res = await fetch(`/api/ernie/projects/${activeProjectId}/files`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            file_name: file.name,
            storage_path: path,
            mime_type: file.type || null,
            size_bytes: file.size,
          }),
        });
        const data = await res.json();
        if (!res.ok) {
          setProjectFileUploadError(`Uploaded ${file.name} but couldn't record it: ${data.error ?? "unknown error"}`);
          continue;
        }
        setProjectFiles((prev) => [data.file, ...prev]);
      }
    } finally {
      setProjectFileUploading(false);
    }
  }

  async function removeProjectFile(f: ProjectFile) {
    if (!activeProjectId) return;
    setProjectFiles((prev) => prev.filter((p) => p.id !== f.id));
    await fetch(`/api/ernie/projects/${activeProjectId}/files?fileId=${f.id}`, { method: "DELETE" });
  }

  async function handleDownloadProjectFile(f: ProjectFile) {
    setDownloadingId(f.id);
    try {
      const { data } = await supabase.storage.from("ernie-project-files").createSignedUrl(f.storage_path, 300);
      if (!data?.signedUrl) return;
      const res = await fetch(data.signedUrl);
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
      setDownloadingId(null);
    }
  }

  // Uploads each file straight to Storage, then records it in ernie_files —
  // same direct-to-storage pattern PosLabelFilesClient uses. A file that's
  // too large, or would push this message over the attachment cap, is
  // skipped with a message rather than silently dropped.
  async function handleFiles(fileList: FileList) {
    if (!userId) {
      setUploadError("Still signing you in — try attaching again in a moment.");
      return;
    }
    const incoming = Array.from(fileList);
    const room = ERNIE_MAX_FILES_PER_MESSAGE - pendingFiles.length;
    if (room <= 0) {
      setUploadError(`You can attach up to ${ERNIE_MAX_FILES_PER_MESSAGE} files to one message.`);
      return;
    }
    const toUpload = incoming.slice(0, room);
    const tooMany = incoming.length > toUpload.length;

    const oversized = toUpload.filter((f) => f.size > ERNIE_MAX_FILE_BYTES);
    const fitsCap = toUpload.filter((f) => f.size <= ERNIE_MAX_FILE_BYTES);

    setUploadError(
      oversized.length > 0
        ? `${oversized.map((f) => f.name).join(", ")} — over the 20MB limit, not uploaded.`
        : tooMany
          ? `Only attached the first ${toUpload.length} — up to ${ERNIE_MAX_FILES_PER_MESSAGE} files per message.`
          : null,
    );

    if (fitsCap.length === 0) return;

    setUploading(true);
    try {
      for (const file of fitsCap) {
        const path = `${userId}/${storageFileName(file.name)}`;
        const { error: uploadErr } = await supabase.storage.from(ERNIE_FILES_BUCKET).upload(path, file);
        if (uploadErr) {
          setUploadError(`Couldn't upload ${file.name}: ${uploadErr.message}`);
          continue;
        }
        const { data: inserted, error: insertErr } = await supabase
          .from("ernie_files")
          .insert({
            user_id: userId,
            direction: "upload",
            file_name: file.name,
            mime_type: file.type || null,
            size_bytes: file.size,
            storage_path: path,
          })
          .select("id, file_name, mime_type, size_bytes, storage_path")
          .single();
        if (insertErr) {
          setUploadError(`Uploaded ${file.name} but couldn't record it: ${insertErr.message}`);
          continue;
        }
        setPendingFiles((prev) => [...prev, inserted as ErnieFile]);
      }
    } finally {
      setUploading(false);
    }
  }

  async function removePendingFile(f: ErnieFile) {
    setPendingFiles((prev) => prev.filter((p) => p.id !== f.id));
    // Best-effort cleanup — leaving the row/object behind if this fails is
    // harmless (just an orphaned file only this user could ever see).
    await supabase.storage.from(ERNIE_FILES_BUCKET).remove([f.storage_path]);
    await supabase.from("ernie_files").delete().eq("id", f.id);
  }

  async function handleDownloadFile(f: ErnieFile) {
    setDownloadingId(f.id);
    try {
      // A file Ernie fetched from elsewhere in the app (source_bucket set)
      // lives in that original bucket, never copied into ernie-files —
      // download from wherever it actually is.
      const bucket = f.source_bucket || ERNIE_FILES_BUCKET;
      const { data } = await supabase.storage.from(bucket).createSignedUrl(f.storage_path, 300);
      if (!data?.signedUrl) return;
      const res = await fetch(data.signedUrl);
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
      setDownloadingId(null);
    }
  }

  function handleDragEnter(e: React.DragEvent) {
    e.preventDefault();
    if (!e.dataTransfer.types.includes("Files")) return;
    dragCounter.current += 1;
    setDragActive(true);
  }
  function handleDragOver(e: React.DragEvent) {
    e.preventDefault();
  }
  function handleDragLeave(e: React.DragEvent) {
    e.preventDefault();
    dragCounter.current = Math.max(0, dragCounter.current - 1);
    if (dragCounter.current === 0) setDragActive(false);
  }
  function handleDrop(e: React.DragEvent) {
    e.preventDefault();
    dragCounter.current = 0;
    setDragActive(false);
    if (e.dataTransfer.files?.length) handleFiles(e.dataTransfer.files);
  }

  async function send(text: string) {
    const trimmed = text.trim();
    if ((!trimmed && pendingFiles.length === 0) || loading) return;

    const filesForThisMessage = pendingFiles;

    setMessages((prev) => [
      ...prev,
      { role: "user", text: trimmed, files: filesForThisMessage.length ? filesForThisMessage : undefined },
    ]);
    setInput("");
    setPendingFiles([]);
    setUploadError(null);
    setError(null);
    setStatusLabel(null);
    setLoading(true);

    try {
      const res = await fetch("/api/ernie/chat", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          conversationId: conversationId ?? undefined,
          message: trimmed,
          fileIds: filesForThisMessage.map((f) => f.id),
          projectId: activeProjectId ?? undefined,
        }),
      });

      // A handful of early failures (not signed in, no message, missing
      // server API key) come back as a plain JSON error rather than a
      // stream — everything else is Server-Sent Events, one event per line
      // prefixed "data: ", ending in a "done" or "error" event.
      const isStream = (res.headers.get("content-type") ?? "").includes("text/event-stream");
      if (!res.ok || !isStream || !res.body) {
        const data = await res.json().catch(() => ({}) as { error?: string });
        setError(data.error ?? "Something went wrong asking Ernie that.");
        return;
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let settled = false;

      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });

        let separatorIndex: number;
        while ((separatorIndex = buffer.indexOf("\n\n")) !== -1) {
          const rawEvent = buffer.slice(0, separatorIndex);
          buffer = buffer.slice(separatorIndex + 2);
          const dataLine = rawEvent.split("\n").find((line) => line.startsWith("data: "));
          if (!dataLine) continue;

          let event: {
            type?: string;
            label?: string;
            text?: string;
            conversationId?: string;
            error?: string;
            outputFileIds?: string[];
          };
          try {
            event = JSON.parse(dataLine.slice("data: ".length));
          } catch {
            continue;
          }

          if (event.type === "status" && event.label) {
            setStatusLabel(event.label);
          } else if (event.type === "done") {
            settled = true;
            let outputFiles: ErnieFile[] | undefined;
            if (event.outputFileIds && event.outputFileIds.length > 0) {
              const { data } = await supabase
                .from("ernie_files")
                .select("id, file_name, mime_type, size_bytes, storage_path, source_bucket")
                .in("id", event.outputFileIds);
              outputFiles = (data as ErnieFile[] | null) ?? undefined;
            }
            setMessages((prev) => [...prev, { role: "assistant", text: event.text ?? "", files: outputFiles }]);
            if (event.conversationId && event.conversationId !== conversationId) {
              setConversationId(event.conversationId);
              // Only the general (non-Project) conversation pointer is
              // restored on a fresh page load (see the restore effect
              // above) — a Project tab always starts blank on reload, so
              // there's nothing useful to persist for it here.
              if (!activeProjectId) sessionStorage.setItem(ACTIVE_CONVERSATION_KEY, event.conversationId);
            }
            refreshHistory();
          } else if (event.type === "error") {
            settled = true;
            setError(event.error ?? "Something went wrong asking Ernie that.");
          }
        }
      }

      if (!settled) {
        setError("Ernie stopped responding before finishing — try asking again.");
      }
    } catch {
      setError("Couldn't reach Ernie — check your connection and try again.");
    } finally {
      setStatusLabel(null);
      setLoading(false);
    }
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    send(input);
  }

  function startNewConversation() {
    setMessages([]);
    setConversationId(null);
    setError(null);
    // Only touch the general-history restore pointer when actually in
    // General — see the matching comment in the "done" handler above.
    if (!activeProjectId) sessionStorage.setItem(ACTIVE_CONVERSATION_KEY, NEW_SENTINEL);
  }

  async function openConversation(id: string) {
    if (id === conversationId) return;
    setError(null);
    setInitializing(true);
    try {
      const res = await fetch(`/api/ernie/conversations/${id}`);
      if (!res.ok) {
        setError("Couldn't load that conversation — it may have been removed.");
        return;
      }
      const data = await res.json();
      setMessages(data.messages ?? []);
      setConversationId(data.conversation.id);
      if (!activeProjectId) sessionStorage.setItem(ACTIVE_CONVERSATION_KEY, data.conversation.id);
    } catch {
      setError("Couldn't load that conversation — check your connection and try again.");
    } finally {
      setInitializing(false);
    }
  }

  function FileChip({
    f,
    onRemove,
    onDownload,
  }: {
    f: ErnieFile;
    onRemove?: () => void;
    onDownload?: () => void;
  }) {
    return (
      <div className="flex items-center gap-1.5 rounded-md border border-[#262c1f] bg-[#181c13] px-2 py-1 text-xs text-[#eef1e9]">
        <span>{fileIcon(f.file_name)}</span>
        <span className="max-w-[160px] truncate" title={f.file_name}>
          {f.file_name}
        </span>
        {f.size_bytes != null && <span className="text-[#8f9885]">{formatBytes(f.size_bytes)}</span>}
        {onDownload && (
          <button
            type="button"
            onClick={onDownload}
            disabled={downloadingId === f.id}
            className="ml-1 text-[#8f9885] hover:text-[#7fce5c] disabled:opacity-50"
          >
            {downloadingId === f.id ? "…" : "Download"}
          </button>
        )}
        {onRemove && (
          <button type="button" onClick={onRemove} className="ml-1 text-[#5d6456] hover:text-red-400">
            ✕
          </button>
        )}
      </div>
    );
  }

  return (
    <div className={`${archivo.variable} ${plexSans.variable} ${plexMono.variable} mx-auto flex w-full flex-col ${isPopup ? "max-w-full gap-2 p-3" : "max-w-[1600px] gap-3 p-6"}`}>
      {/* Ernie Project tabs — General plus one per Project this user has
          access to (RLS already limits the list — see sql/ernie_projects.sql).
          Hidden in the pop-out window, same reasoning as the history sidebar
          below: that window is sized for a narrow chat panel. */}
      {!isPopup && (
        <div className="flex flex-wrap items-center gap-1.5">
          <button
            type="button"
            onClick={() => switchToProject(null)}
            className={`rounded-full border px-3 py-1.5 font-[family-name:var(--font-plex-sans)] text-xs font-medium transition-colors ${
              activeProjectId === null
                ? "border-[#6ABC46]/60 bg-[#6ABC46] text-[#0b0e09]"
                : "border-[#262c1f] bg-[#181c13] text-[#eef1e9] hover:border-[#6ABC46]/50 hover:text-[#7fce5c]"
            }`}
          >
            General
          </button>
          {projects.map((p) => (
            <button
              key={p.id}
              type="button"
              onClick={() => switchToProject(p.id)}
              title={p.description ?? undefined}
              className={`max-w-[220px] truncate rounded-full border px-3 py-1.5 font-[family-name:var(--font-plex-sans)] text-xs font-medium transition-colors ${
                activeProjectId === p.id
                  ? "border-[#6ABC46]/60 bg-[#6ABC46] text-[#0b0e09]"
                  : "border-[#262c1f] bg-[#181c13] text-[#eef1e9] hover:border-[#6ABC46]/50 hover:text-[#7fce5c]"
              }`}
            >
              {p.name}
            </button>
          ))}
          {canManageProjects && (
            <button
              type="button"
              onClick={() => setCreateProjectOpen(true)}
              title="Create a new Ernie Project"
              className="rounded-full border border-dashed border-[#262c1f] bg-transparent px-3 py-1.5 font-[family-name:var(--font-plex-sans)] text-xs font-medium text-[#8f9885] transition-colors hover:border-[#6ABC46]/50 hover:text-[#7fce5c]"
            >
              + New Project
            </button>
          )}
        </div>
      )}

    <div
      ref={panelRef}
      style={panelHeight != null ? { height: panelHeight } : undefined}
      className="relative flex min-h-0 w-full flex-1 gap-4 overflow-hidden"
      onDragEnter={handleDragEnter}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      {dragActive && (
        <div className="pointer-events-none absolute inset-0 z-20 flex items-center justify-center rounded-2xl border-2 border-dashed border-[#6ABC46]/60 bg-[#0b0e09]/85">
          <p className="font-[family-name:var(--font-plex-sans)] text-sm font-medium text-[#eef1e9]">
            Drop files to attach them
          </p>
        </div>
      )}

      <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-2xl border border-[#262c1f] bg-[#12150f] shadow-[0_0_0_1px_rgba(0,0,0,0.4)]">
        {/* Thin brand-green gradient accent line along the top of the panel */}
        <div className="h-[3px] w-full shrink-0 bg-gradient-to-r from-[#4c8a32] via-[#6ABC46] to-[#7fce5c]" />

        <div className="flex items-center justify-between border-b border-[#1c2117] px-5 py-4">
          <div className="min-w-0">
            <h1 className="truncate font-[family-name:var(--font-archivo)] text-lg font-bold tracking-tight text-[#eef1e9]">
              {activeProject ? activeProject.name : "Ernie AI"}
            </h1>
            {activeProject?.description && (
              <p className="truncate font-[family-name:var(--font-plex-sans)] text-xs text-[#8f9885]">
                {activeProject.description}
              </p>
            )}
          </div>
          <div className="flex shrink-0 items-center gap-2">
            {activeProject && (
              <button
                type="button"
                onClick={() => setFilesOpen(true)}
                className="rounded-full border border-[#262c1f] bg-[#181c13] px-3 py-1.5 font-[family-name:var(--font-plex-sans)] text-xs font-medium text-[#eef1e9] transition-colors hover:border-[#6ABC46]/50 hover:text-[#7fce5c]"
              >
                Files ({projectFiles.length})
              </button>
            )}
            {activeProject && canManageProjects && (
              <button
                type="button"
                onClick={openManageAccess}
                className="rounded-full border border-[#262c1f] bg-[#181c13] px-3 py-1.5 font-[family-name:var(--font-plex-sans)] text-xs font-medium text-[#eef1e9] transition-colors hover:border-[#6ABC46]/50 hover:text-[#7fce5c]"
              >
                Manage Access
              </button>
            )}
            {activeProject && canManageProjects && (
              <>
                <input
                  ref={projectFileInputRef}
                  type="file"
                  multiple
                  className="hidden"
                  onChange={(e) => {
                    if (e.target.files?.length) handleProjectFiles(e.target.files);
                    e.target.value = "";
                  }}
                />
                <button
                  type="button"
                  onClick={() => projectFileInputRef.current?.click()}
                  disabled={projectFileUploading}
                  className="rounded-full border border-[#262c1f] bg-[#181c13] px-3 py-1.5 font-[family-name:var(--font-plex-sans)] text-xs font-medium text-[#eef1e9] transition-colors hover:border-[#6ABC46]/50 hover:text-[#7fce5c] disabled:opacity-50"
                >
                  {projectFileUploading ? "Uploading…" : "Add Files"}
                </button>
              </>
            )}
            {!isPopup && (
              <button
                type="button"
                onClick={openPopout}
                title="Open Ernie in a separate window you can keep alongside the rest of the app"
                className="rounded-full border border-[#262c1f] bg-[#181c13] px-3 py-1.5 font-[family-name:var(--font-plex-sans)] text-xs font-medium text-[#eef1e9] transition-colors hover:border-[#6ABC46]/50 hover:text-[#7fce5c]"
              >
                Pop Out ↗
              </button>
            )}
            {!isPopup && (
              <button
                type="button"
                onClick={openNotes}
                className="rounded-full border border-[#262c1f] bg-[#181c13] px-3 py-1.5 font-[family-name:var(--font-plex-sans)] text-xs font-medium text-[#eef1e9] transition-colors hover:border-[#6ABC46]/50 hover:text-[#7fce5c]"
              >
                What Ernie Knows About You
              </button>
            )}
            <button
              type="button"
              onClick={startNewConversation}
              className="rounded-full border border-[#262c1f] bg-[#181c13] px-3 py-1.5 font-[family-name:var(--font-plex-sans)] text-xs font-medium text-[#eef1e9] transition-colors hover:border-[#6ABC46]/50 hover:text-[#7fce5c]"
            >
              New Conversation
            </button>
          </div>
        </div>

        {notesOpen && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 px-4">
            <div className="w-full max-w-lg rounded-xl border border-[#262c1f] bg-[#12150e] p-5 shadow-xl">
              <div className="mb-3 flex items-center justify-between">
                <h2 className="font-[family-name:var(--font-archivo)] text-base font-bold text-[#eef1e9]">
                  What Ernie Knows About You
                </h2>
                <button
                  type="button"
                  onClick={() => setNotesOpen(false)}
                  className="text-[#8a9282] hover:text-[#eef1e9]"
                  aria-label="Close"
                >
                  ✕
                </button>
              </div>
              <p className="mb-3 font-[family-name:var(--font-plex-sans)] text-xs text-[#8a9282]">
                Private to you — only you can see or change this, not even an admin. Ernie updates it on its own
                as you talk (how you like it to communicate, and relevant context about your role), but you can
                edit or clear it any time.
              </p>
              {notesLoading ? (
                <p className="py-6 text-center text-sm text-[#8a9282]">Loading…</p>
              ) : (
                <>
                  <textarea
                    value={notesText}
                    onChange={(e) => setNotesText(e.target.value)}
                    rows={8}
                    placeholder="Nothing here yet — Ernie will start filling this in as you chat."
                    className="w-full resize-none rounded-lg border border-[#262c1f] bg-[#181c13] p-3 font-[family-name:var(--font-plex-sans)] text-sm text-[#eef1e9] outline-none focus:border-[#6ABC46]/50"
                  />
                  {notesError && <p className="mt-2 text-xs text-red-400">{notesError}</p>}
                  <div className="mt-3 flex items-center justify-between">
                    <button
                      type="button"
                      onClick={() => setNotesText("")}
                      className="font-[family-name:var(--font-plex-sans)] text-xs font-medium text-[#8a9282] hover:text-[#eef1e9]"
                    >
                      Clear
                    </button>
                    <div className="flex items-center gap-3">
                      {notesSavedAt && !notesSaving && (
                        <span className="font-[family-name:var(--font-plex-sans)] text-xs text-[#6ABC46]">Saved</span>
                      )}
                      <button
                        type="button"
                        onClick={saveNotes}
                        disabled={notesSaving}
                        className="rounded-full bg-[#6ABC46] px-4 py-1.5 font-[family-name:var(--font-plex-sans)] text-xs font-semibold text-[#12150e] transition-opacity hover:opacity-90 disabled:opacity-50"
                      >
                        {notesSaving ? "Saving…" : "Save"}
                      </button>
                    </div>
                  </div>
                </>
              )}
            </div>
          </div>
        )}

        {createProjectOpen && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 px-4">
            <div className="w-full max-w-md rounded-xl border border-[#262c1f] bg-[#12150e] p-5 shadow-xl">
              <div className="mb-3 flex items-center justify-between">
                <h2 className="font-[family-name:var(--font-archivo)] text-base font-bold text-[#eef1e9]">
                  New Ernie Project
                </h2>
                <button
                  type="button"
                  onClick={() => setCreateProjectOpen(false)}
                  className="text-[#8a9282] hover:text-[#eef1e9]"
                  aria-label="Close"
                >
                  ✕
                </button>
              </div>
              <label className="mb-1 block font-[family-name:var(--font-plex-sans)] text-xs font-medium text-[#8a9282]">
                Name
              </label>
              <input
                type="text"
                value={newProjectName}
                onChange={(e) => setNewProjectName(e.target.value)}
                placeholder="e.g. 2027 Distributor Contracts"
                className="mb-3 w-full rounded-lg border border-[#262c1f] bg-[#181c13] p-2.5 font-[family-name:var(--font-plex-sans)] text-sm text-[#eef1e9] outline-none focus:border-[#6ABC46]/50"
              />
              <label className="mb-1 block font-[family-name:var(--font-plex-sans)] text-xs font-medium text-[#8a9282]">
                Description (optional)
              </label>
              <textarea
                value={newProjectDescription}
                onChange={(e) => setNewProjectDescription(e.target.value)}
                rows={3}
                placeholder="What this Project is for — helps Ernie use its files well."
                className="mb-3 w-full resize-none rounded-lg border border-[#262c1f] bg-[#181c13] p-2.5 font-[family-name:var(--font-plex-sans)] text-sm text-[#eef1e9] outline-none focus:border-[#6ABC46]/50"
              />
              {createProjectError && <p className="mb-2 text-xs text-red-400">{createProjectError}</p>}
              <div className="flex justify-end">
                <button
                  type="button"
                  onClick={createProject}
                  disabled={creatingProject}
                  className="rounded-full bg-[#6ABC46] px-4 py-1.5 font-[family-name:var(--font-plex-sans)] text-xs font-semibold text-[#12150e] transition-opacity hover:opacity-90 disabled:opacity-50"
                >
                  {creatingProject ? "Creating…" : "Create Project"}
                </button>
              </div>
            </div>
          </div>
        )}

        {filesOpen && activeProject && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 px-4">
            <div className="flex max-h-[80vh] w-full max-w-lg flex-col rounded-xl border border-[#262c1f] bg-[#12150e] p-5 shadow-xl">
              <div className="mb-3 flex items-center justify-between">
                <h2 className="font-[family-name:var(--font-archivo)] text-base font-bold text-[#eef1e9]">
                  {activeProject.name} — Files
                </h2>
                <button
                  type="button"
                  onClick={() => setFilesOpen(false)}
                  className="text-[#8a9282] hover:text-[#eef1e9]"
                  aria-label="Close"
                >
                  ✕
                </button>
              </div>
              {projectFileUploadError && <p className="mb-2 text-xs text-red-400">{projectFileUploadError}</p>}
              <div className="min-h-0 flex-1 space-y-1.5 overflow-y-auto">
                {projectFilesLoading ? (
                  <p className="py-6 text-center text-sm text-[#8a9282]">Loading…</p>
                ) : projectFiles.length === 0 ? (
                  <p className="py-6 text-center text-sm text-[#8a9282]">
                    No files in this Project yet.
                    {canManageProjects && " Use “Add Files” to add some."}
                  </p>
                ) : (
                  projectFiles.map((f) => (
                    <FileChip
                      key={f.id}
                      f={{ id: f.id, file_name: f.file_name, mime_type: f.mime_type, size_bytes: f.size_bytes, storage_path: f.storage_path }}
                      onDownload={() => handleDownloadProjectFile(f)}
                      onRemove={canManageProjects ? () => removeProjectFile(f) : undefined}
                    />
                  ))
                )}
              </div>
            </div>
          </div>
        )}

        {manageAccessOpen && activeProject && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 px-4">
            <div className="flex max-h-[80vh] w-full max-w-md flex-col rounded-xl border border-[#262c1f] bg-[#12150e] p-5 shadow-xl">
              <div className="mb-1 flex items-center justify-between">
                <h2 className="font-[family-name:var(--font-archivo)] text-base font-bold text-[#eef1e9]">
                  {activeProject.name} — Manage Access
                </h2>
                <button
                  type="button"
                  onClick={() => setManageAccessOpen(false)}
                  className="text-[#8a9282] hover:text-[#eef1e9]"
                  aria-label="Close"
                >
                  ✕
                </button>
              </div>
              <p className="mb-3 font-[family-name:var(--font-plex-sans)] text-xs text-[#8a9282]">
                Checked = this person sees this Project&rsquo;s tab and can chat inside it.
              </p>
              {accessError && <p className="mb-2 text-xs text-red-400">{accessError}</p>}
              <div className="min-h-0 flex-1 space-y-0.5 overflow-y-auto">
                {accessLoading ? (
                  <p className="py-6 text-center text-sm text-[#8a9282]">Loading…</p>
                ) : (
                  accessUsers.map((u) => (
                    <label
                      key={u.id}
                      className="flex cursor-pointer items-center gap-2.5 rounded-lg px-2 py-2 hover:bg-[#181c13]"
                    >
                      <input
                        type="checkbox"
                        checked={u.has_access}
                        disabled={accessSavingId === u.id}
                        onChange={() => toggleUserAccess(u)}
                        className="h-4 w-4 accent-[#6ABC46]"
                      />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm text-[#eef1e9]">
                          {u.full_name || u.email}
                        </span>
                        <span className="block truncate font-[family-name:var(--font-plex-mono)] text-xs text-[#5d6456]">
                          {u.email}
                        </span>
                      </span>
                    </label>
                  ))
                )}
              </div>
            </div>
          </div>
        )}

        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-5 py-5 font-[family-name:var(--font-plex-sans)]">
          {initializing
            ? null
            : messages.length === 0 && (
                <div className="flex flex-col items-center gap-6 py-6 text-center">
                  {/* eslint-disable-next-line @next/next/no-img-element -- plain img keeps gif animation intact */}
                  <img
                    src="/ernie/thinking.gif"
                    alt=""
                    className="h-[96px] w-[96px] object-contain"
                  />
                  <p className="font-[family-name:var(--font-archivo)] text-xl font-semibold text-[#eef1e9]">
                    Hi {capitalize(firstName)}, what can I help you with?
                  </p>
                </div>
              )}

          {!initializing &&
            (() => {
              let lastAssistantIndex = -1;
              messages.forEach((m, i) => {
                if (m.role === "assistant") lastAssistantIndex = i;
              });

              return messages.map((m, i) =>
                m.role === "user" ? (
                  <div key={i} className="flex flex-col items-end gap-1.5">
                    {m.files && m.files.length > 0 && (
                      <div className="flex max-w-[75%] flex-wrap justify-end gap-1.5">
                        {m.files.map((f) => (
                          <FileChip key={f.id} f={f} onDownload={() => handleDownloadFile(f)} />
                        ))}
                      </div>
                    )}
                    {m.text && (
                      <div className="max-w-[75%] whitespace-pre-wrap rounded-2xl rounded-tr-sm bg-[#6ABC46] px-3.5 py-2.5 text-sm text-[#0b0e09]">
                        {m.text}
                      </div>
                    )}
                  </div>
                ) : (
                  <div key={i} className="flex items-start gap-3">
                    {i === lastAssistantIndex ? (
                      // eslint-disable-next-line @next/next/no-img-element -- plain img keeps gif animation intact
                      <img
                        src="/ernie/thinking-static.png"
                        alt=""
                        className="h-[52px] w-[52px] shrink-0 object-contain"
                      />
                    ) : (
                      <div className="w-[52px] shrink-0" />
                    )}
                    <div className="flex flex-1 flex-col gap-1 pt-1">
                      <span className="font-[family-name:var(--font-plex-mono)] text-[11px] font-medium tracking-wide text-[#8f9885]">
                        Ernie
                      </span>
                      <div className="whitespace-pre-wrap border-l-2 border-[#6ABC46]/40 pl-3 text-sm text-[#eef1e9]">
                        {m.text}
                      </div>
                      {m.files && m.files.length > 0 && (
                        <div className="ml-3 flex flex-wrap gap-1.5">
                          {m.files.map((f) => (
                            <FileChip key={f.id} f={f} onDownload={() => handleDownloadFile(f)} />
                          ))}
                        </div>
                      )}
                    </div>
                  </div>
                ),
              );
            })()}

          {loading && (
            <div className="flex items-center gap-3">
              {/* eslint-disable-next-line @next/next/no-img-element -- plain img keeps gif animation intact, and lets the src swap between the static frame and the animated gif */}
              <img src="/ernie/thinking.gif" alt="" className="h-[52px] w-[52px] shrink-0 object-contain" />
              <p className="text-sm text-[#8f9885]">
                {statusLabel ? `${statusLabel}…` : "Ernie is thinking…"}
              </p>
            </div>
          )}

          {error && <p className="text-sm text-red-400">{error}</p>}
          <div ref={scrollRef} />
        </div>

        <div className="border-t border-[#1c2117] px-5 py-4 font-[family-name:var(--font-plex-sans)]">
          {(pendingFiles.length > 0 || uploading) && (
            <div className="mb-2 flex flex-wrap gap-1.5">
              {pendingFiles.map((f) => (
                <FileChip key={f.id} f={f} onRemove={() => removePendingFile(f)} />
              ))}
              {uploading && <span className="px-2 py-1 text-xs text-[#5d6456]">Uploading…</span>}
            </div>
          )}
          {uploadError && <p className="mb-2 text-xs text-red-400">{uploadError}</p>}

          <form onSubmit={handleSubmit} className="flex items-center gap-2 rounded-full border border-[#262c1f] bg-white py-1.5 pl-1.5 pr-2">
            <input
              ref={fileInputRef}
              type="file"
              multiple
              className="hidden"
              onChange={(e) => {
                if (e.target.files?.length) handleFiles(e.target.files);
                e.target.value = "";
              }}
            />
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              disabled={loading || uploading}
              title="Attach a file"
              className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-neutral-500 transition-colors hover:bg-neutral-100 hover:text-[#4c8a32] disabled:opacity-50"
            >
              +
            </button>
            <input
              type="text"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder="Ask Ernie something, or attach a file…"
              className="flex-1 bg-transparent text-sm text-black placeholder:text-neutral-500 focus:outline-none"
            />
            <button
              type="submit"
              disabled={loading || (!input.trim() && pendingFiles.length === 0)}
              className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-[#6ABC46] text-[#0b0e09] transition-colors hover:bg-[#7fce5c] disabled:cursor-not-allowed"
              title="Send"
            >
              <svg viewBox="0 0 20 20" fill="none" className="h-4 w-4" aria-hidden="true">
                <path d="M10 15.5V4.5M10 4.5L4.5 10M10 4.5L15.5 10" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </button>
          </form>
        </div>
      </div>

      {/* Conversation list — replaces the old History dropdown with an
          always-visible sidebar, per Chad's request. Hidden in the pop-out
          window: that window is sized for a narrow chat panel, and the full
          history is always one click away in the main window. */}
      {!isPopup && (
      <div className="flex w-72 shrink-0 flex-col overflow-hidden rounded-2xl border border-[#262c1f] bg-[#12150f] shadow-[0_0_0_1px_rgba(0,0,0,0.4)]">
        <div className="h-[3px] w-full shrink-0 bg-gradient-to-r from-[#4c8a32] via-[#6ABC46] to-[#7fce5c]" />
        <div className="border-b border-[#1c2117] px-4 py-4">
          <h2 className="font-[family-name:var(--font-archivo)] text-sm font-bold tracking-tight text-[#eef1e9]">
            {activeProject ? `${activeProject.name} — Conversations` : "Past Conversations"}
          </h2>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto font-[family-name:var(--font-plex-sans)]">
          {historyLoading ? (
            <p className="px-4 py-3 text-sm text-[#8f9885]">Loading…</p>
          ) : history.length === 0 ? (
            <p className="px-4 py-3 text-sm text-[#8f9885]">No past conversations yet.</p>
          ) : (
            <ul className="py-1">
              {history.map((c) => (
                <li key={c.id}>
                  <button
                    type="button"
                    onClick={() => openConversation(c.id)}
                    className={`flex w-full flex-col items-start gap-0.5 px-4 py-2.5 text-left transition-colors hover:bg-[#181c13] ${
                      c.id === conversationId ? "bg-[#181c13]" : ""
                    }`}
                  >
                    <span className="w-full truncate text-sm text-[#eef1e9]">
                      {c.title || "New conversation"}
                    </span>
                    <span className="font-[family-name:var(--font-plex-mono)] text-xs text-[#5d6456]">
                      {formatRelative(c.updated_at)}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
      )}
    </div>
    </div>
  );
}
