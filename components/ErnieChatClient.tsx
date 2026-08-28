"use client";

// Ernie AI — the in-app assistant admins can ask about inventory,
// allocations, distributors, events, purchase orders, and pricing.
// Read-only: Ernie has no way to change anything in the app.
//
// Deliberately not boxed into a bordered card like the rest of the app's
// pages — Chad wanted this one floating directly over the page's own dark
// background instead.
//
// A plain <img> (not next/image) is used for the thinking gif so its
// animation isn't touched by Next's image optimizer.

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
    <div className="flex h-full flex-col p-6">
      <h1 className="mb-4 text-xl font-semibold text-neutral-100">Ernie AI</h1>

      <div className="flex flex-1 flex-col overflow-hidden">
        <div className="flex-1 space-y-4 overflow-y-auto">
          {messages.length === 0 && (
            <div className="flex h-full flex-col items-center justify-center">
              <p className="text-lg text-neutral-300">
                Hi {firstName}, what can I help you with?
              </p>
            </div>
          )}

          {messages.map((m, i) => (
            <div
              key={i}
              className={`flex ${m.role === "user" ? "justify-end" : "justify-start"}`}
            >
              <div
                className={`max-w-[75%] whitespace-pre-wrap rounded-lg px-3 py-2 text-sm ${
                  m.role === "user"
                    ? "bg-white text-black"
                    : "border border-neutral-800 bg-neutral-900 text-neutral-100"
                }`}
              >
                {m.text}
              </div>
            </div>
          ))}

          {loading && (
            <div className="flex justify-start">
              <div className="flex items-center gap-2 rounded-lg border border-neutral-800 bg-neutral-900 px-3 py-2">
                {/* eslint-disable-next-line @next/next/no-img-element -- plain img keeps gif animation intact */}
                <img src="/ernie/thinking.gif" alt="Ernie is thinking" className="h-8 w-8 object-contain" />
                <span className="text-sm text-neutral-400">Ernie is thinking…</span>
              </div>
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
    </div>
  );
}
