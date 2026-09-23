"use client";

// "Google Calendar" button on the Events Calendar page (added 2026-09-23) —
// status + controls for the two-way sync with Google's "Outside/Off Site
// Events Calendar" (lib/google/calendarSync.ts). Shows New! until clicked
// (lib/newFeatures.ts). Before the first sync has run, it previews exactly
// what the first sync would do — which events get linked (already on both
// sides), which exist only in Google, which only in the app — and nothing
// is written until someone approves it.

import { useCallback, useEffect, useState } from "react";
import NewBadge from "@/components/NewBadge";
import { useNewFeature } from "@/lib/newFeatures";

interface Status {
  credentials: boolean;
  serviceAccountEmail: string | null;
  setUp: boolean;
  initialSyncDone: boolean;
  lastPullAt: string | null;
  lastPushAt: string | null;
  lastError: string | null;
  canRunInitial: boolean;
}

interface Item {
  title: string;
  start_date: string;
  end_date: string | null;
  time?: string | null;
}

interface Preview {
  matched: { app: Item; google: Item }[];
  googleOnly: Item[];
  appOnly: Item[];
  windowNote: string;
}

function fmtDate(iso: string) {
  const d = new Date(`${iso}T12:00:00`);
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

function fmtWhen(iso: string | null) {
  if (!iso) return "never";
  return new Date(iso).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}

function ItemList({ items }: { items: Item[] }) {
  if (!items.length) return <p className="text-xs text-neutral-500">None.</p>;
  return (
    <ul className="max-h-48 space-y-1 overflow-y-auto pr-1">
      {items.map((it, i) => (
        <li key={`${it.title}-${it.start_date}-${i}`} className="flex gap-2 text-xs text-neutral-300">
          <span className="w-24 shrink-0 text-neutral-500">{fmtDate(it.start_date)}</span>
          <span className="min-w-0 flex-1 truncate">
            {it.title}
            {it.time ? <span className="text-neutral-500"> · {it.time}</span> : null}
          </span>
        </li>
      ))}
    </ul>
  );
}

export default function GoogleCalendarSyncButton({ onChanged }: { onChanged: () => void }) {
  const isNew = useNewFeature("feature:events-google-sync");
  const [open, setOpen] = useState(false);
  const [status, setStatus] = useState<Status | null>(null);
  const [access, setAccess] = useState<{ ok: boolean; message: string } | null>(null);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const loadStatus = useCallback(async () => {
    try {
      const res = await fetch("/api/google-calendar/sync");
      if (res.ok) setStatus(await res.json());
    } catch {
      // leave as unknown
    }
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- one-time status fetch on mount
    loadStatus();
  }, [loadStatus]);

  async function act(action: string) {
    setBusy(action);
    setError(null);
    setNotice(null);
    try {
      const res = await fetch("/api/google-calendar/sync", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Something went wrong.");
      if (action === "check") setAccess(data);
      if (action === "preview") setPreview(data);
      if (action === "initial") {
        setPreview(null);
        setNotice(
          `First sync done: ${data.linked} linked, ${data.addedToApp} added to the app from Google, ${data.addedToGoogle} added to Google from the app.`,
        );
        onChanged();
      }
      if (action === "sync_now") {
        setNotice(`Up to date: ${data.created} added, ${data.updated} updated, ${data.deleted} removed from Google's side.`);
        onChanged();
      }
      await loadStatus();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong.");
    } finally {
      setBusy(null);
    }
  }

  const synced = !!status?.initialSyncDone;
  const label = synced ? (status?.lastError ? "Google Calendar ⚠" : "Google Calendar ✓ Synced") : "Google Calendar";

  return (
    <>
      <button
        type="button"
        onClick={() => {
          isNew.dismiss();
          setOpen(true);
          if (status?.credentials && status.setUp && !synced) act("check");
        }}
        className="inline-flex items-center rounded-md border border-neutral-800 px-3 py-1.5 text-sm font-medium text-neutral-300 hover:bg-neutral-900"
        title="Two-way sync with Google's Outside/Off Site Events Calendar"
      >
        {label}
        {isNew.isNew && <NewBadge inline />}
      </button>

      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" onClick={() => setOpen(false)}>
          <div
            className="flex max-h-[88vh] w-full max-w-2xl flex-col rounded-xl border border-neutral-800 bg-neutral-950 shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between border-b border-neutral-800 px-5 py-4">
              <h2 className="text-base font-semibold text-neutral-100">Google Calendar sync</h2>
              <button type="button" onClick={() => setOpen(false)} className="text-neutral-500 hover:text-neutral-200" aria-label="Close">
                ✕
              </button>
            </div>

            <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-5 py-4 text-sm text-neutral-300">
              <p className="text-xs text-neutral-400">
                Two-way sync between this calendar and Google&apos;s <b>Outside/Off Site Events Calendar</b>. Adds, edits, and deletes
                on either side show up on the other within seconds.
              </p>

              {!status && <p className="text-xs text-neutral-500">Loading…</p>}

              {status && !status.setUp && (
                <p className="rounded-md border border-amber-600/40 bg-amber-500/10 p-3 text-xs text-amber-300">
                  Not set up yet — the database step (sql/google_calendar_sync.sql) hasn&apos;t been run.
                </p>
              )}

              {status && status.setUp && !status.credentials && (
                <p className="rounded-md border border-amber-600/40 bg-amber-500/10 p-3 text-xs text-amber-300">
                  Google isn&apos;t connected yet — the app&apos;s Google robot account key still needs to be added in Vercel.
                </p>
              )}

              {status?.serviceAccountEmail && (
                <p className="text-xs text-neutral-400">
                  App&apos;s Google robot account: <span className="select-all text-neutral-200">{status.serviceAccountEmail}</span>
                  <br />
                  The Google calendar must be shared with this address (&ldquo;Make changes to events&rdquo;).
                </p>
              )}

              {access && (
                <p className={`text-xs ${access.ok ? "text-green-400" : "text-amber-300"}`}>
                  {access.ok ? "✓ " : "⚠ "}
                  {access.message}
                </p>
              )}

              {status && synced && (
                <div className="space-y-1 text-xs text-neutral-400">
                  <p>
                    Last change from Google: <span className="text-neutral-200">{fmtWhen(status.lastPullAt)}</span>
                  </p>
                  <p>
                    Last change sent to Google: <span className="text-neutral-200">{fmtWhen(status.lastPushAt)}</span>
                  </p>
                  {status.lastError && <p className="text-amber-300">⚠ Last problem: {status.lastError}</p>}
                </div>
              )}

              {status && status.setUp && status.credentials && !synced && !preview && (
                <p className="text-xs text-neutral-400">
                  Before anything syncs, preview the first sync: events already on both sides get linked (no copies), and you&apos;ll see
                  exactly which events exist only in Google or only here.
                </p>
              )}

              {preview && (
                <div className="space-y-4">
                  <p className="text-xs text-neutral-500">{preview.windowNote}</p>
                  <div>
                    <p className="mb-1 font-medium text-neutral-200">
                      Already on both sides — will be linked, no copies ({preview.matched.length})
                    </p>
                    <ItemList items={preview.matched.map((m) => m.app)} />
                  </div>
                  <div>
                    <p className="mb-1 font-medium text-neutral-200">
                      Only in Google — will be added to this calendar ({preview.googleOnly.length})
                    </p>
                    <ItemList items={preview.googleOnly} />
                  </div>
                  <div>
                    <p className="mb-1 font-medium text-neutral-200">
                      Only in the app — will be added to Google ({preview.appOnly.length})
                    </p>
                    <ItemList items={preview.appOnly} />
                  </div>
                </div>
              )}

              {notice && <p className="text-xs text-green-400">{notice}</p>}
              {error && <p className="text-xs text-red-400">{error}</p>}
            </div>

            <div className="flex items-center justify-end gap-2 border-t border-neutral-800 px-5 py-3">
              {status && status.setUp && status.credentials && !synced && !preview && (
                <button
                  type="button"
                  disabled={!!busy}
                  onClick={() => act("preview")}
                  className="rounded-md border border-neutral-700 px-3 py-1.5 text-sm text-neutral-200 hover:bg-neutral-900 disabled:opacity-50"
                >
                  {busy === "preview" ? "Checking Google…" : "Preview first sync"}
                </button>
              )}
              {preview && status?.canRunInitial && (
                <button
                  type="button"
                  disabled={!!busy}
                  onClick={() => act("initial")}
                  className="rounded-md bg-[#6ABC46] px-3 py-1.5 text-sm font-semibold text-black hover:opacity-90 disabled:opacity-50"
                >
                  {busy === "initial" ? "Syncing… (can take a minute)" : "Approve & run first sync"}
                </button>
              )}
              {preview && !status?.canRunInitial && (
                <p className="text-xs text-neutral-500">An Administrator or Manager needs to approve the first sync.</p>
              )}
              {synced && (
                <button
                  type="button"
                  disabled={!!busy}
                  onClick={() => act("sync_now")}
                  className="rounded-md border border-neutral-700 px-3 py-1.5 text-sm text-neutral-200 hover:bg-neutral-900 disabled:opacity-50"
                >
                  {busy === "sync_now" ? "Syncing…" : "Sync now"}
                </button>
              )}
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="rounded-md border border-neutral-800 px-3 py-1.5 text-sm text-neutral-400 hover:bg-neutral-900"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
