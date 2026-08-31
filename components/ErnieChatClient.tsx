"use client";

// Ernie AI — the in-app assistant every signed-in user can ask about
// inventory, allocations, distributors, events, purchase orders, pricing,
// and (since 2026-08-31) files they attach directly in this chat. Ernie
// itself is still read-only against the app's own data — the one thing it
// CAN produce is a new/edited copy of a file the user attached (e.g. an
// edited spreadsheet), never a change to the app's own database.
//
// Deliberately not boxed into a bordered card like the rest of the app's
// pages — Chad wanted this one floating directly over the page's own dark
// background instead. Content is constrained to a centered max-w column
// (Claude.ai-style) rather than stretching full width, with the input box
// anchored at the bottom and messages flowing from the top.
//
// A plain <img> (not next/image) is used for the thinking gif so its
// animation isn't touched by Next's image optimizer. The skeleton mascot
// appears next to only the most recent one of Ernie's replies — the static
// first-frame PNG once that reply is showing, swapped for the real animated
// GIF only for the transient "Ernie is thinking…" row while a reply is
// being generated (GIFs can't be paused via CSS, hence swapping src
// instead).
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
import { createClient } from "@/lib/supabase/client";
import { fileIcon, formatBytes, storageFileName } from "@/lib/events";
import { ERNIE_FILES_BUCKET, ERNIE_MAX_FILE_BYTES, ERNIE_MAX_FILES_PER_MESSAGE } from "@/lib/ernie/fileLimits";

interface ErnieFile {
  id: string;
  file_name: string;
  mime_type: string | null;
  size_bytes: number | null;
  storage_path: string;
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

const ACTIVE_CONVERSATION_KEY = "ernie_active_conversation_id";
const NEW_SENTINEL = "new";

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

export default function ErnieChatClient({ firstName }: { firstName: string }) {
  const supabase = useMemo(() => createClient(), []);

  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  // Live "what Ernie is doing right now" label (e.g. "Checking inventory &
  // allocations"), driven by status events streamed from /api/ernie/chat —
  // purely a live UI thing, never persisted with the conversation.
  const [statusLabel, setStatusLabel] = useState<string | null>(null);
  const [initializing, setInitializing] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [historyOpen, setHistoryOpen] = useState(false);
  const [history, setHistory] = useState<ConversationSummary[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);

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
      setPanelHeight(window.innerHeight - top);
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

  async function refreshHistoryIfOpen() {
    if (!historyOpen) return;
    try {
      const res = await fetch("/api/ernie/conversations");
      if (res.ok) {
        const data = await res.json();
        setHistory(data.conversations ?? []);
      }
    } catch {
      // leave the stale list showing rather than erroring the whole panel
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
      const { data } = await supabase.storage.from(ERNIE_FILES_BUCKET).createSignedUrl(f.storage_path, 300);
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
                .select("id, file_name, mime_type, size_bytes, storage_path")
                .in("id", event.outputFileIds);
              outputFiles = (data as ErnieFile[] | null) ?? undefined;
            }
            setMessages((prev) => [...prev, { role: "assistant", text: event.text ?? "", files: outputFiles }]);
            if (event.conversationId && event.conversationId !== conversationId) {
              setConversationId(event.conversationId);
              sessionStorage.setItem(ACTIVE_CONVERSATION_KEY, event.conversationId);
            }
            refreshHistoryIfOpen();
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
    setHistoryOpen(false);
    sessionStorage.setItem(ACTIVE_CONVERSATION_KEY, NEW_SENTINEL);
  }

  async function toggleHistory() {
    const opening = !historyOpen;
    setHistoryOpen(opening);
    if (!opening) return;

    setHistoryLoading(true);
    try {
      const res = await fetch("/api/ernie/conversations");
      if (res.ok) {
        const data = await res.json();
        setHistory(data.conversations ?? []);
      }
    } finally {
      setHistoryLoading(false);
    }
  }

  async function openConversation(id: string) {
    if (id === conversationId) {
      setHistoryOpen(false);
      return;
    }
    setHistoryOpen(false);
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
      sessionStorage.setItem(ACTIVE_CONVERSATION_KEY, data.conversation.id);
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
      <div className="flex items-center gap-1.5 rounded-md border border-neutral-700 bg-neutral-900 px-2 py-1 text-xs text-neutral-200">
        <span>{fileIcon(f.file_name)}</span>
        <span className="max-w-[160px] truncate" title={f.file_name}>
          {f.file_name}
        </span>
        {f.size_bytes != null && <span className="text-neutral-500">{formatBytes(f.size_bytes)}</span>}
        {onDownload && (
          <button
            type="button"
            onClick={onDownload}
            disabled={downloadingId === f.id}
            className="ml-1 text-neutral-400 hover:text-white disabled:opacity-50"
          >
            {downloadingId === f.id ? "…" : "Download"}
          </button>
        )}
        {onRemove && (
          <button type="button" onClick={onRemove} className="ml-1 text-neutral-500 hover:text-red-400">
            ✕
          </button>
        )}
      </div>
    );
  }

  return (
    <div
      ref={panelRef}
      style={panelHeight != null ? { height: panelHeight } : undefined}
      className="relative mx-auto flex w-full max-w-3xl flex-col p-6"
      onDragEnter={handleDragEnter}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      {dragActive && (
        <div className="pointer-events-none absolute inset-0 z-20 flex items-center justify-center rounded-lg border-2 border-dashed border-neutral-400 bg-neutral-950/80">
          <p className="text-sm font-medium text-neutral-200">Drop files to attach them</p>
        </div>
      )}

      <div className="mb-4 flex items-center justify-between">
        <h1 className="text-xl font-semibold text-neutral-100">Ernie AI</h1>
        <div className="relative flex items-center gap-2">
          <button
            type="button"
            onClick={startNewConversation}
            className="rounded-md border border-neutral-700 px-3 py-1.5 text-xs font-medium text-neutral-300 hover:border-neutral-500 hover:text-neutral-100"
          >
            New Conversation
          </button>
          <button
            type="button"
            onClick={toggleHistory}
            className="rounded-md border border-neutral-700 px-3 py-1.5 text-xs font-medium text-neutral-300 hover:border-neutral-500 hover:text-neutral-100"
          >
            History
          </button>

          {historyOpen && (
            <div className="absolute right-0 top-full z-10 mt-2 w-80 rounded-md border border-neutral-700 bg-neutral-900 shadow-lg">
              {historyLoading ? (
                <p className="px-3 py-3 text-sm text-neutral-400">Loading…</p>
              ) : history.length === 0 ? (
                <p className="px-3 py-3 text-sm text-neutral-400">No past conversations yet.</p>
              ) : (
                <ul className="max-h-80 overflow-y-auto py-1">
                  {history.map((c) => (
                    <li key={c.id}>
                      <button
                        type="button"
                        onClick={() => openConversation(c.id)}
                        className={`flex w-full flex-col items-start gap-0.5 px-3 py-2 text-left hover:bg-neutral-800 ${
                          c.id === conversationId ? "bg-neutral-800" : ""
                        }`}
                      >
                        <span className="w-full truncate text-sm text-neutral-100">
                          {c.title || "New conversation"}
                        </span>
                        <span className="text-xs text-neutral-500">
                          {formatRelative(c.updated_at)}
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
        </div>
      </div>

      <div className="min-h-0 flex-1 space-y-4 overflow-y-auto">
        {initializing ? null : messages.length === 0 && (
          <p className="text-lg text-neutral-300">
            Hi {firstName}, what can I help you with?
          </p>
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
                    <div className="max-w-[75%] whitespace-pre-wrap rounded-lg bg-white px-3 py-2 text-sm text-black">
                      {m.text}
                    </div>
                  )}
                </div>
              ) : (
                <div key={i} className="flex items-start gap-2">
                  {i === lastAssistantIndex ? (
                    // eslint-disable-next-line @next/next/no-img-element -- plain img keeps gif animation intact
                    <img
                      src="/ernie/thinking-static.png"
                      alt=""
                      className="h-[75px] w-[75px] shrink-0 object-contain"
                    />
                  ) : (
                    <div className="w-[75px] shrink-0" />
                  )}
                  <div className="flex flex-col gap-1.5 pt-1">
                    <div className="whitespace-pre-wrap text-sm text-neutral-100">{m.text}</div>
                    {m.files && m.files.length > 0 && (
                      <div className="flex flex-wrap gap-1.5">
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
          <div className="flex items-center gap-2">
            {/* eslint-disable-next-line @next/next/no-img-element -- plain img keeps gif animation intact, and lets the src swap between the static frame and the animated gif */}
            <img src="/ernie/thinking.gif" alt="" className="h-[75px] w-[75px] shrink-0 object-contain" />
            <p className="text-sm text-neutral-400">
              {statusLabel ? `${statusLabel}…` : "Ernie is thinking…"}
            </p>
          </div>
        )}

        {error && <p className="text-sm text-red-400">{error}</p>}
        <div ref={scrollRef} />
      </div>

      <div className="border-t border-neutral-800 pt-3">
        {(pendingFiles.length > 0 || uploading) && (
          <div className="mb-2 flex flex-wrap gap-1.5">
            {pendingFiles.map((f) => (
              <FileChip key={f.id} f={f} onRemove={() => removePendingFile(f)} />
            ))}
            {uploading && <span className="px-2 py-1 text-xs text-neutral-500">Uploading…</span>}
          </div>
        )}
        {uploadError && <p className="mb-2 text-xs text-red-400">{uploadError}</p>}

        <form onSubmit={handleSubmit} className="flex gap-2">
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
            className="rounded-md border border-neutral-700 px-3 py-2 text-sm text-neutral-300 hover:border-neutral-500 hover:text-neutral-100 disabled:opacity-50"
          >
            +
          </button>
          <input
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="Ask Ernie something, or attach a file…"
            className="flex-1 rounded-md border border-neutral-700 bg-neutral-900 px-3 py-2 text-sm text-neutral-100 focus:border-neutral-500 focus:outline-none"
          />
          <button
            type="submit"
            disabled={loading || (!input.trim() && pendingFiles.length === 0)}
            className="rounded-md bg-white px-4 py-2 text-sm font-medium text-black hover:bg-neutral-200 disabled:opacity-50"
          >
            Send
          </button>
        </form>
      </div>
    </div>
  );
}
