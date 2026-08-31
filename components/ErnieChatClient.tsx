"use client";

// Ernie AI — the in-app assistant admins can ask about inventory,
// allocations, distributors, events, purchase orders, and pricing.
// Read-only: Ernie has no way to change anything in the app.
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

import { useEffect, useLayoutEffect, useRef, useState } from "react";

interface ChatMessage {
  role: "user" | "assistant";
  text: string;
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

  const scrollRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const [panelHeight, setPanelHeight] = useState<number | null>(null);

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

  async function send(text: string) {
    const trimmed = text.trim();
    if (!trimmed || loading) return;

    setMessages((prev) => [...prev, { role: "user", text: trimmed }]);
    setInput("");
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

          let event: { type?: string; label?: string; text?: string; conversationId?: string; error?: string };
          try {
            event = JSON.parse(dataLine.slice("data: ".length));
          } catch {
            continue;
          }

          if (event.type === "status" && event.label) {
            setStatusLabel(event.label);
          } else if (event.type === "done") {
            settled = true;
            setMessages((prev) => [...prev, { role: "assistant", text: event.text ?? "" }]);
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

  return (
    <div
      ref={panelRef}
      style={panelHeight != null ? { height: panelHeight } : undefined}
      className="mx-auto flex w-full max-w-3xl flex-col p-6"
    >
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
                <div key={i} className="flex justify-end">
                  <div className="max-w-[75%] whitespace-pre-wrap rounded-lg bg-white px-3 py-2 text-sm text-black">
                    {m.text}
                  </div>
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
                  <div className="whitespace-pre-wrap pt-1 text-sm text-neutral-100">{m.text}</div>
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

      <form onSubmit={handleSubmit} className="flex gap-2 border-t border-neutral-800 pt-3">
        <input
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="Ask Ernie something…"
          className="flex-1 rounded-md border border-neutral-700 bg-neutral-900 px-3 py-2 text-sm text-neutral-100 focus:border-neutral-500 focus:outline-none"
        />
        <button
          type="submit"
          disabled={loading || !input.trim()}
          className="rounded-md bg-white px-4 py-2 text-sm font-medium text-black hover:bg-neutral-200 disabled:opacity-50"
        >
          Send
        </button>
      </form>
    </div>
  );
}
