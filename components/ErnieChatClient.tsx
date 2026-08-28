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
// appears next to every one of Ernie's replies — the static first-frame PNG
// once a reply is showing, swapped for the real animated GIF only for the
// transient "Ernie is thinking…" row while a reply is being generated
// (GIFs can't be paused via CSS, hence swapping src instead).

import { useEffect, useRef, useState } from "react";

interface ChatMessage {
  role: "user" | "assistant";
  text: string;
}

export default function ErnieChatClient({ firstName }: { firstName: string }) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    scrollRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, loading]);

  async function send(text: string) {
    const trimmed = text.trim();
    if (!trimmed || loading) return;

    const nextMessages: ChatMessage[] = [...messages, { role: "user", text: trimmed }];
    setMessages(nextMessages);
    setInput("");
    setError(null);
    setLoading(true);

    try {
      const res = await fetch("/api/ernie/chat", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ messages: nextMessages }),
      });
      const data = await res.json();

      if (!res.ok) {
        setError(data.error ?? "Something went wrong asking Ernie that.");
        setLoading(false);
        return;
      }

      setMessages((prev) => [...prev, { role: "assistant", text: data.text }]);
    } catch {
      setError("Couldn't reach Ernie — check your connection and try again.");
    } finally {
      setLoading(false);
    }
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    send(input);
  }

  return (
    <div className="mx-auto flex h-full w-full max-w-3xl flex-col p-6">
      <h1 className="mb-4 text-xl font-semibold text-neutral-100">Ernie AI</h1>

      <div className="flex-1 space-y-4 overflow-y-auto">
        {messages.length === 0 && (
          <p className="text-lg text-neutral-300">
            Hi {firstName}, what can I help you with?
          </p>
        )}

        {messages.map((m, i) =>
          m.role === "user" ? (
            <div key={i} className="flex justify-end">
              <div className="max-w-[75%] whitespace-pre-wrap rounded-lg bg-white px-3 py-2 text-sm text-black">
                {m.text}
              </div>
            </div>
          ) : (
            <div key={i} className="flex items-start gap-2">
              {/* eslint-disable-next-line @next/next/no-img-element -- plain img keeps gif animation intact */}
              <img
                src="/ernie/thinking-static.png"
                alt=""
                className="h-[50px] w-[50px] shrink-0 object-contain"
              />
              <div className="whitespace-pre-wrap pt-1 text-sm text-neutral-100">{m.text}</div>
            </div>
          ),
        )}

        {loading && (
          <div className="flex items-center gap-2">
            {/* eslint-disable-next-line @next/next/no-img-element -- plain img keeps gif animation intact, and lets the src swap between the static frame and the animated gif */}
            <img src="/ernie/thinking.gif" alt="" className="h-[50px] w-[50px] shrink-0 object-contain" />
            <p className="text-sm text-neutral-400">Ernie is thinking…</p>
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
