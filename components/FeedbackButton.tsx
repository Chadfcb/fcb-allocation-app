"use client";

import { useState } from "react";
import { usePathname } from "next/navigation";

// Floating "Report an issue" button, present on every page via app/(app)/
// layout.tsx. Lets anyone signed in flag a bug or suggest an improvement
// without leaving the page they're on -- posts to /api/feedback, which
// saves it and emails Chad. (2026-09-14, per Chad's request.)
export default function FeedbackButton() {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const [category, setCategory] = useState<"bug" | "suggestion">("bug");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<"idle" | "sent" | "error">("idle");
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  function closeAndReset() {
    setOpen(false);
    setCategory("bug");
    setMessage("");
    setStatus("idle");
    setErrorMsg(null);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setErrorMsg(null);

    try {
      const res = await fetch("/api/feedback", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ category, message, pagePath: pathname }),
      });
      const data = await res.json().catch(() => ({}));

      if (!res.ok) {
        setStatus("error");
        setErrorMsg(data?.error ?? "Something went wrong submitting this.");
      } else {
        setStatus("sent");
        setMessage("");
      }
    } catch {
      setStatus("error");
      setErrorMsg("Something went wrong submitting this. Check your connection and try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="fixed bottom-5 right-5 z-40 rounded-full border border-neutral-700 bg-neutral-900 px-4 py-2 text-sm font-medium text-neutral-200 shadow-lg hover:bg-neutral-800"
      >
        Report an issue
      </button>

      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 px-4">
          <div className="w-full max-w-md rounded-lg border border-neutral-800 bg-neutral-950 p-5">
            {status === "sent" ? (
              <div className="space-y-4">
                <p className="text-sm text-neutral-200">
                  Thanks -- that's been sent to Chad.
                </p>
                <button
                  type="button"
                  onClick={closeAndReset}
                  className="rounded-md bg-white px-4 py-1.5 text-sm font-medium text-black hover:bg-neutral-200"
                >
                  Close
                </button>
              </div>
            ) : (
              <form onSubmit={handleSubmit} className="space-y-4">
                <div>
                  <h2 className="text-sm font-semibold text-neutral-100">Report an issue or suggestion</h2>
                  <p className="mt-1 text-xs text-neutral-500">
                    This page ({pathname}) is included automatically.
                  </p>
                </div>

                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={() => setCategory("bug")}
                    className={`flex-1 rounded-md border px-3 py-1.5 text-sm ${
                      category === "bug"
                        ? "border-white bg-white text-black"
                        : "border-neutral-700 bg-neutral-900 text-neutral-300"
                    }`}
                  >
                    Bug
                  </button>
                  <button
                    type="button"
                    onClick={() => setCategory("suggestion")}
                    className={`flex-1 rounded-md border px-3 py-1.5 text-sm ${
                      category === "suggestion"
                        ? "border-white bg-white text-black"
                        : "border-neutral-700 bg-neutral-900 text-neutral-300"
                    }`}
                  >
                    Suggestion
                  </button>
                </div>

                <textarea
                  required
                  value={message}
                  onChange={(e) => setMessage(e.target.value)}
                  placeholder={
                    category === "bug"
                      ? "What happened, and what did you expect instead?"
                      : "What would you like to see changed or added?"
                  }
                  rows={5}
                  className="w-full rounded-md border border-neutral-700 bg-neutral-900 px-3 py-2 text-sm text-neutral-100"
                />

                {errorMsg && <p className="text-sm text-red-400">{errorMsg}</p>}

                <div className="flex justify-end gap-2">
                  <button
                    type="button"
                    onClick={closeAndReset}
                    className="rounded-md border border-neutral-700 px-4 py-1.5 text-sm text-neutral-300 hover:bg-neutral-900"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    disabled={busy}
                    className="rounded-md bg-white px-4 py-1.5 text-sm font-medium text-black hover:bg-neutral-200 disabled:opacity-50"
                  >
                    {busy ? "Sending..." : "Submit"}
                  </button>
                </div>
              </form>
            )}
          </div>
        </div>
      )}
    </>
  );
}
