"use client";

import { useState } from "react";

// The public text sign-up form (/sms-signup) — added 2026-10-29. The consent
// box starts UNCHECKED (carrier rule) and must be checked to submit. The
// consent wording comes from lib/twilio.ts (passed in by the page) so what
// the buyer sees is exactly what gets saved with their sign-up.
export default function SmsSignupForm({ consentText }: { consentText: string }) {
  const [name, setName] = useState("");
  const [business, setBusiness] = useState("");
  const [phone, setPhone] = useState("");
  const [rep, setRep] = useState("");
  const [website, setWebsite] = useState(""); // hidden spam trap
  const [consent, setConsent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!consent) {
      setError("Please check the box to agree to receive texts.");
      return;
    }
    setBusy(true);
    try {
      const res = await fetch("/api/sms-signup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, business, phone, rep, website, consent }),
      });
      const json = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string };
      if (!res.ok || !json.ok) {
        setError(json.error ?? "Something went wrong. Please try again.");
      } else {
        setDone(true);
      }
    } catch {
      setError("Something went wrong. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  if (done) {
    return (
      <div className="rounded-lg border border-green-300 bg-green-50 px-4 py-4 text-green-900">
        <p className="font-semibold">You&apos;re signed up.</p>
        <p className="mt-1 text-sm">You&apos;ll get a confirmation text shortly. Reply STOP at any time to opt out.</p>
      </div>
    );
  }

  const input =
    "w-full rounded-lg border border-neutral-300 bg-white px-3 py-2.5 text-neutral-900 outline-none focus:border-neutral-600";

  return (
    <form onSubmit={submit} className="space-y-4 rounded-xl border border-neutral-200 p-4 sm:p-6">
      <label className="block">
        <span className="mb-1 block text-sm font-semibold">Your name</span>
        <input className={input} value={name} onChange={(e) => setName(e.target.value)} required autoComplete="name" />
      </label>
      <label className="block">
        <span className="mb-1 block text-sm font-semibold">Business name</span>
        <input className={input} value={business} onChange={(e) => setBusiness(e.target.value)} required autoComplete="organization" />
      </label>
      <label className="block">
        <span className="mb-1 block text-sm font-semibold">Mobile number</span>
        <input
          className={input}
          value={phone}
          onChange={(e) => setPhone(e.target.value)}
          required
          type="tel"
          inputMode="tel"
          autoComplete="tel"
          placeholder="(559) 555-1234"
        />
      </label>
      <label className="block">
        <span className="mb-1 block text-sm font-semibold">
          Your Full Circle Brewing rep <span className="font-normal text-neutral-500">(optional)</span>
        </span>
        <input className={input} value={rep} onChange={(e) => setRep(e.target.value)} />
      </label>
      {/* Spam trap — hidden from people, bots fill it in. */}
      <input
        type="text"
        name="website"
        value={website}
        onChange={(e) => setWebsite(e.target.value)}
        tabIndex={-1}
        autoComplete="off"
        aria-hidden="true"
        className="hidden"
      />
      <label className="flex items-start gap-3 rounded-lg bg-neutral-50 p-3 text-sm">
        <input
          type="checkbox"
          checked={consent}
          onChange={(e) => setConsent(e.target.checked)}
          className="mt-1 h-4 w-4 shrink-0"
        />
        <span>
          {consentText} See our{" "}
          <a href="/terms" className="underline">Terms &amp; Conditions</a> and{" "}
          <a href="/privacy" className="underline">Privacy Policy</a>.
        </span>
      </label>
      {error && <p className="text-sm font-semibold text-red-700">{error}</p>}
      <button
        type="submit"
        disabled={busy}
        className="w-full rounded-lg bg-neutral-900 px-4 py-3 font-semibold text-white disabled:opacity-60"
      >
        {busy ? "Signing up…" : "Sign me up"}
      </button>
    </form>
  );
}
