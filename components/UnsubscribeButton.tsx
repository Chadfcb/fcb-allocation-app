"use client";

import { useState } from "react";

// The button on the public /email/unsubscribe page (added 2026-10-30).
export default function UnsubscribeButton({ e, s }: { e: string; s: string }) {
  const [state, setState] = useState<"idle" | "busy" | "done" | "error">("idle");

  async function go() {
    setState("busy");
    try {
      const res = await fetch("/api/email/unsubscribe", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ e, s }),
      });
      setState(res.ok ? "done" : "error");
    } catch {
      setState("error");
    }
  }

  if (state === "done") {
    return (
      <p className="rounded-lg border border-green-300 bg-green-50 px-4 py-3 font-semibold text-green-900">
        You&apos;re unsubscribed. You won&apos;t get any more emails from Full Circle Brewing.
      </p>
    );
  }
  return (
    <div className="space-y-2">
      <button
        type="button"
        onClick={() => void go()}
        disabled={state === "busy"}
        className="rounded-lg bg-neutral-900 px-5 py-3 font-semibold text-white disabled:opacity-60"
      >
        {state === "busy" ? "Unsubscribing…" : "Unsubscribe"}
      </button>
      {state === "error" && <p className="text-sm font-semibold text-red-700">Something went wrong. Please try again.</p>}
    </div>
  );
}
