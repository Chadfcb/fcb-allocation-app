"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import type { CreativeAsset } from "@/lib/creativeAssets";
import type { EmailContent, EmailScope } from "@/components/ErnieStudioPanel";

// Email Studio → Ernie → Chat (added 2026-11-20, per Chad / Eddie: "can we
// have ernie chat in there, so he can work with ernie directly in that
// section"). Plan: claude/email-studio-ernie-chat-plan.md.
//
// A back-and-forth chat with Ernie inside the email designer. Each email
// keeps its own chat (ernie_conversations.email_design_id): reopen the email
// and the chat is still there; "New chat" starts over. Every message sends
// the open email (and what's selected) along, so Ernie knows what Eddie is
// looking at. Runs through the normal Ernie chat (/api/ernie/chat) with the
// email tools from lib/email/ernieEmailChat.ts:
//   email_edit  → put into the designer right away (Undo, same as Edit email)
//   email_asset → a new Creative Library picture with "Put it in the email"
// Only the typed messages and Ernie's answers are saved; the change/picture
// cards below a reply are live only (the pictures stay in the Creative Library).

type Action =
  | { kind: "edit"; id: string; note: string; swaps: number; ok: boolean; undone: boolean }
  | { kind: "image"; id: string; asset: CreativeAsset };

type Msg = { role: "user" | "assistant"; text: string; actions?: Action[] };

export type EmailMeta = { name: string; subject: string; preheader: string };

export default function ErnieStudioChat({
  designId,
  getEmailContent,
  getMeta,
  selectedLabel,
  onApplyEmail,
  onUndoEmail,
  onNewAsset,
  onInsertImage,
  onUsageChanged,
}: {
  designId: string;
  getEmailContent: (scope: EmailScope) => EmailContent | null;
  getMeta: () => EmailMeta;
  selectedLabel: string | null;
  onApplyEmail: (html: string, scope: EmailScope) => boolean;
  onUndoEmail: () => void;
  onNewAsset: (a: CreativeAsset) => void;
  onInsertImage: (a: CreativeAsset) => void;
  onUsageChanged: () => void;
}) {
  const [supabase] = useState(() => createClient());
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [messages, setMessages] = useState<Msg[]>([]);
  const [loadingHistory, setLoadingHistory] = useState(true);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  // Only Ernie's most recent change to the email can be undone.
  const [lastEditId, setLastEditId] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  // This email's chat (the most recent one), if there is one.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const { data: conv } = await supabase
        .from("ernie_conversations")
        .select("id")
        .eq("email_design_id", designId)
        .order("updated_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (cancelled) return;
      if (conv?.id) {
        const { data: rows } = await supabase
          .from("ernie_messages")
          .select("role, content")
          .eq("conversation_id", conv.id)
          .order("created_at", { ascending: true });
        if (cancelled) return;
        setConversationId(conv.id);
        setMessages((rows ?? []).map((r) => ({ role: r.role as "user" | "assistant", text: r.content as string })));
      }
      setLoadingHistory(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [supabase, designId]);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [messages, status]);

  const addAction = useCallback((action: Action) => {
    setMessages((prev) => {
      const copy = [...prev];
      const last = copy[copy.length - 1];
      if (last && last.role === "assistant" && last.text === "") {
        copy[copy.length - 1] = { ...last, actions: [...(last.actions ?? []), action] };
      }
      return copy;
    });
  }, []);

  async function send() {
    const text = input.trim();
    if (!text || busy) return;
    const full = getEmailContent("email");
    if (!full) {
      setErr("The designer isn't ready yet — try again in a moment.");
      return;
    }
    const sel = selectedLabel ? getEmailContent("selection") : null;
    const meta = getMeta();

    setInput("");
    setErr(null);
    setBusy(true);
    setStatus("Ernie is thinking…");
    // The empty assistant message collects this reply's change/picture cards
    // until the text arrives.
    setMessages((prev) => [...prev, { role: "user", text }, { role: "assistant", text: "" }]);

    let gotDone = false;
    try {
      const res = await fetch("/api/ernie/chat", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          conversationId: conversationId ?? undefined,
          message: text,
          email: {
            designId,
            name: meta.name,
            subject: meta.subject,
            preheader: meta.preheader,
            html: full.html,
            selectionHtml: sel?.html ?? null,
            selectionCss: sel?.css ?? null,
            selectedLabel,
          },
        }),
      });
      const isStream = (res.headers.get("content-type") ?? "").includes("text/event-stream");
      if (!res.ok || !isStream || !res.body) {
        const data = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(data.error ?? "Something went wrong talking to Ernie.");
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        let cut: number;
        while ((cut = buffer.indexOf("\n\n")) !== -1) {
          const raw = buffer.slice(0, cut);
          buffer = buffer.slice(cut + 2);
          const line = raw.split("\n").find((l) => l.startsWith("data: "));
          if (!line) continue;
          let ev: Record<string, unknown>;
          try {
            ev = JSON.parse(line.slice(6));
          } catch {
            continue;
          }
          if (ev.type === "status") {
            setStatus(`${String(ev.label ?? "Working")}…`);
          } else if (ev.type === "email_edit") {
            const ok = onApplyEmail(String(ev.html ?? ""), (ev.scope as EmailScope) ?? "email");
            const id = crypto.randomUUID();
            if (ok) setLastEditId(id);
            addAction({ kind: "edit", id, note: String(ev.note ?? "Changed the email."), swaps: Number(ev.swaps) || 0, ok, undone: false });
          } else if (ev.type === "email_asset") {
            const asset = ev.asset as CreativeAsset;
            onNewAsset(asset);
            addAction({ kind: "image", id: asset.id, asset });
          } else if (ev.type === "done") {
            gotDone = true;
            if (typeof ev.conversationId === "string") setConversationId(ev.conversationId);
            const reply = String(ev.text ?? "");
            setMessages((prev) => {
              const copy = [...prev];
              const last = copy[copy.length - 1];
              if (last && last.role === "assistant" && last.text === "") copy[copy.length - 1] = { ...last, text: reply || "(no reply)" };
              else copy.push({ role: "assistant", text: reply });
              return copy;
            });
          } else if (ev.type === "error") {
            throw new Error(String(ev.error ?? "Something went wrong talking to Ernie."));
          }
        }
      }
      if (!gotDone) throw new Error("Ernie's reply got cut off — try again.");
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
      // Drop the empty reply bubble unless it holds a change/picture card.
      setMessages((prev) => {
        const last = prev[prev.length - 1];
        if (last && last.role === "assistant" && last.text === "" && !(last.actions?.length)) return prev.slice(0, -1);
        return prev;
      });
    } finally {
      setBusy(false);
      setStatus(null);
      onUsageChanged();
    }
  }

  function undo(actionId: string) {
    onUndoEmail();
    setLastEditId(null);
    setMessages((prev) =>
      prev.map((m) =>
        m.actions
          ? { ...m, actions: m.actions.map((a) => (a.kind === "edit" && a.id === actionId ? { ...a, undone: true } : a)) }
          : m,
      ),
    );
  }

  function newChat() {
    if (busy) return;
    setConversationId(null);
    setMessages([]);
    setLastEditId(null);
    setErr(null);
  }

  const btn = "rounded-full border border-neutral-700 px-3 py-1 text-xs text-neutral-200 hover:border-neutral-500";

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex items-center justify-between border-b border-neutral-800 px-4 py-2 text-xs text-neutral-500">
        <span>
          {selectedLabel ? `Selected: ${selectedLabel}` : "Nothing selected"} · Ernie sees this email
        </span>
        <button type="button" className={btn} onClick={newChat} disabled={busy || messages.length === 0}>
          New chat
        </button>
      </div>

      <div ref={scrollRef} className="min-h-0 flex-1 space-y-3 overflow-y-auto px-4 py-4 text-sm">
        {loadingHistory ? (
          <p className="text-neutral-500">Loading…</p>
        ) : messages.length === 0 ? (
          <div className="space-y-2 text-neutral-400">
            <p className="text-neutral-200">Talk with Ernie about this email.</p>
            <p className="text-xs">
              Ernie sees the email and whatever you&apos;ve clicked on. He can suggest subject lines and wording, change the email
              (Undo puts it back), make pictures for the Creative Library, and look up real FCB info like what&apos;s selling.
            </p>
            <p className="text-xs text-neutral-500">
              e.g. &ldquo;Give me 5 subject lines for this&rdquo; · &ldquo;Make the selected headline punchier&rdquo; · &ldquo;Add a
              section with our 3 best sellers&rdquo; · &ldquo;Make a wide banner of a cold can on a bar top&rdquo;
            </p>
          </div>
        ) : (
          messages.map((m, i) =>
            m.role === "user" ? (
              <div key={i} className="flex justify-end">
                <div className="max-w-[85%] whitespace-pre-wrap rounded-2xl rounded-tr-sm bg-brand/20 px-3 py-2 text-neutral-100">{m.text}</div>
              </div>
            ) : (
              <div key={i} className="space-y-2">
                {(m.actions ?? []).map((a) =>
                  a.kind === "edit" ? (
                    <div key={a.id} className="space-y-1.5 rounded-xl border border-neutral-800 p-3">
                      {!a.ok ? (
                        <p className="text-red-300">Ernie made a change but it couldn&apos;t be put into the email — ask him to try again.</p>
                      ) : a.undone ? (
                        <p className="text-neutral-400">Undone — the email is back the way it was.</p>
                      ) : (
                        <>
                          <p className="text-neutral-100">✓ {a.note}</p>
                          {a.swaps > 0 && (
                            <p className="rounded-lg border border-amber-800 bg-amber-950/40 px-2 py-1 text-xs text-amber-200">
                              {a.swaps === 1 ? "1 gray “Swap this picture” box" : `${a.swaps} gray “Swap this picture” boxes`} to swap before
                              sending — double-click each one.
                            </p>
                          )}
                          {lastEditId === a.id && (
                            <button type="button" className={btn} onClick={() => undo(a.id)}>
                              Undo this change
                            </button>
                          )}
                        </>
                      )}
                    </div>
                  ) : (
                    <div key={a.id} className="space-y-1.5 rounded-xl border border-neutral-800 p-3">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={a.asset.public_url} alt={a.asset.name} className="w-full rounded-md" />
                      <p className="text-xs text-neutral-500">Saved to the Creative Library.</p>
                      <button type="button" className={btn} onClick={() => onInsertImage(a.asset)}>
                        Put it in the email
                      </button>
                    </div>
                  ),
                )}
                {m.text && (
                  <div className="max-w-[95%] whitespace-pre-wrap rounded-2xl rounded-tl-sm border border-neutral-800 bg-neutral-900 px-3 py-2 text-neutral-200">
                    {m.text}
                  </div>
                )}
              </div>
            ),
          )
        )}
        {status && <p className="text-xs text-neutral-500">{status}</p>}
        {err && <p className="text-sm text-red-300">{err}</p>}
      </div>

      <div className="border-t border-neutral-800 px-3 py-3">
        <textarea
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              void send();
            }
          }}
          rows={3}
          disabled={busy || loadingHistory}
          placeholder="Message Ernie… (Enter to send, Shift+Enter for a new line)"
          className="w-full resize-none rounded-lg border border-neutral-700 bg-neutral-900 px-3 py-2 text-sm text-neutral-100"
        />
        <div className="mt-2 flex items-center justify-between">
          <span className="text-xs text-neutral-500">A few cents a message · changes 2–5¢ · pictures about 13¢</span>
          <button
            type="button"
            disabled={busy || !input.trim() || loadingHistory}
            onClick={() => void send()}
            className="rounded-full bg-brand px-4 py-1.5 text-sm font-semibold text-black disabled:opacity-50"
          >
            {busy ? "Working…" : "Send"}
          </button>
        </div>
      </div>
    </div>
  );
}
