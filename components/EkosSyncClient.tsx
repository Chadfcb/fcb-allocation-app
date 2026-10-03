"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import EkosNameLists from "@/components/EkosNameLists";

// Admin → Ekos Sync (added 2026-10-03): the Automatic Syncs status page —
// each source's on/off switch, a "Run now" button, and the run history
// (automatic runs, "Run now", and pasted "Sync from Ekos" syncs alike).
// Plan: claude/ekos-auto-sync-plan.md.

interface SourceMeta {
  key: string;
  label: string;
  description: string;
  built: boolean;
}

interface SyncRunRow {
  id: string;
  source: string;
  trigger: "scheduled" | "run_now" | "paste";
  status: "ok" | "issues" | "failed" | "skipped";
  started_at: string;
  synced_count: number | null;
  issues: string[] | null;
  summary: string | null;
  run_by: string | null;
}

const TRIGGER_LABEL: Record<SyncRunRow["trigger"], string> = {
  scheduled: "Automatic",
  run_now: "Run now",
  paste: "Pasted in",
};

const STATUS_STYLE: Record<SyncRunRow["status"], { label: string; cls: string }> = {
  ok: { label: "OK", cls: "bg-emerald-950 text-emerald-300" },
  issues: { label: "Needs a look", cls: "bg-amber-950 text-amber-300" },
  failed: { label: "Failed", cls: "bg-red-950 text-red-300" },
  skipped: { label: "Skipped", cls: "bg-neutral-800 text-neutral-400" },
};

export default function EkosSyncClient({ sources }: { sources: SourceMeta[] }) {
  const supabase = useMemo(() => createClient(), []);
  const [enabled, setEnabled] = useState<Record<string, boolean>>({});
  const [runs, setRuns] = useState<SyncRunRow[]>([]);
  const [names, setNames] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [running, setRunning] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [openRunId, setOpenRunId] = useState<string | null>(null);

  const labelFor = useCallback((key: string) => sources.find((s) => s.key === key)?.label ?? key, [sources]);

  const load = useCallback(async () => {
    const [{ data: srcRows, error: srcErr }, { data: runRows }, { data: profiles }] = await Promise.all([
      supabase.from("sync_sources").select("key, enabled"),
      supabase.from("sync_runs").select("*").order("started_at", { ascending: false }).limit(100),
      supabase.from("profiles").select("id, full_name, email"),
    ]);
    if (srcErr) {
      setError("Couldn't load the sync settings — has sql/sync_runs.sql been run in Supabase?");
    }
    const map: Record<string, boolean> = {};
    for (const r of srcRows ?? []) map[r.key as string] = !!r.enabled;
    setEnabled(map);
    setRuns((runRows as SyncRunRow[] | null) ?? []);
    const n: Record<string, string> = {};
    for (const p of (profiles as { id: string; full_name: string | null; email: string }[] | null) ?? []) {
      n[p.id] = p.full_name || p.email;
    }
    setNames(n);
    setLoading(false);
  }, [supabase]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- intentional fetch-on-mount
    load();
  }, [load]);

  async function post(body: Record<string, unknown>) {
    const res = await fetch("/api/admin/auto-syncs", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error ?? "Something went wrong.");
    return data;
  }

  async function toggle(source: SourceMeta) {
    setError(null);
    setMessage(null);
    const next = !enabled[source.key];
    try {
      await post({ action: "set_enabled", key: source.key, enabled: next });
      setEnabled((prev) => ({ ...prev, [source.key]: next }));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  async function runNow() {
    setError(null);
    setMessage(null);
    setRunning(true);
    try {
      const data = (await post({ action: "run_now" })) as {
        ran: { label: string; status: string; syncedCount: number }[];
        skipped: { label: string; reason: string }[];
      };
      if (data.ran.length === 0) {
        setMessage("Nothing ran — no automatic sources are switched on yet.");
      } else {
        setMessage(
          data.ran
            .map((r) => `${r.label}: ${r.status === "ok" ? "OK" : r.status === "issues" ? "needs a look" : "failed"} (${r.syncedCount} synced)`)
            .join(" · "),
        );
      }
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setRunning(false);
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold text-neutral-100">Ekos Sync</h1>
          <p className="mt-1 max-w-2xl text-sm text-neutral-400">
            Automatic syncs from Ekos into FCB Data. Each source can be switched on or off. Every sync — automatic,
            Run now, or pasted into a &ldquo;Sync from Ekos&rdquo; box — is listed below. You only get an email when
            something needs a look.
          </p>
        </div>
        <button
          type="button"
          onClick={runNow}
          disabled={running}
          className="flex items-center gap-2 rounded-md bg-brand px-3 py-2 text-sm font-medium text-on-brand hover:bg-brand-hover disabled:opacity-50"
        >
          {running ? "Running…" : "Run now"}
        </button>
      </div>

      {message && <p className="rounded-md border border-neutral-800 bg-neutral-900 px-3 py-2 text-sm text-neutral-200">{message}</p>}
      {error && <p className="rounded-md border border-red-900 bg-red-950/40 px-3 py-2 text-sm text-red-300">{error}</p>}

      <section className="flex flex-col gap-2">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-neutral-500">Sources</h2>
        {sources.map((s) => {
          const on = !!enabled[s.key];
          return (
            <div key={s.key} className="flex items-center justify-between gap-4 rounded-lg border border-neutral-800 bg-neutral-950 p-3">
              <div className="min-w-0">
                <p className="text-sm font-medium text-neutral-100">{s.label}</p>
                <p className="text-xs text-neutral-500">{s.description}</p>
                {!s.built && <p className="mt-1 text-xs text-amber-400">Automatic reading from Ekos is the next step — not built yet.</p>}
              </div>
              {/* Slider switch (Chad, 2026-10-03): left = Off, click slides right = On. */}
              <div className="flex shrink-0 items-center gap-2">
                <span className={`text-xs font-medium ${on ? "text-emerald-300" : "text-neutral-500"}`}>{on ? "On" : "Off"}</span>
                <button
                  type="button"
                  role="switch"
                  aria-checked={on}
                  aria-label={`${s.label}: ${on ? "on" : "off"}`}
                  onClick={() => toggle(s)}
                  disabled={!s.built && !on}
                  title={!s.built ? "Can't switch on until the automatic reading step is built" : on ? "Switch off" : "Switch on"}
                  className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
                    on ? "bg-emerald-500" : "bg-neutral-700"
                  } disabled:opacity-50`}
                >
                  <span
                    className={`inline-block h-5 w-5 rounded-full bg-[#ffffff] shadow transition-transform ${
                      on ? "translate-x-[22px]" : "translate-x-0.5"
                    }`}
                  />
                </button>
              </div>
            </div>
          );
        })}
      </section>

      <EkosNameLists />

      <section className="flex flex-col gap-2">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-neutral-500">Sync history</h2>
        {loading ? (
          <p className="text-sm text-neutral-500">Loading…</p>
        ) : runs.length === 0 ? (
          <p className="text-sm text-neutral-500">No syncs recorded yet. The next sync — automatic or pasted — will show up here.</p>
        ) : (
          <div className="overflow-x-auto rounded-lg border border-neutral-800">
            <table className="w-full text-sm">
              <thead className="bg-neutral-950 text-left text-xs text-neutral-500">
                <tr>
                  <th className="px-3 py-2 font-medium">When</th>
                  <th className="px-3 py-2 font-medium">Source</th>
                  <th className="px-3 py-2 font-medium">How</th>
                  <th className="px-3 py-2 font-medium">Result</th>
                  <th className="px-3 py-2 font-medium">Synced</th>
                  <th className="px-3 py-2 font-medium">Issues</th>
                </tr>
              </thead>
              <tbody>
                {runs.map((r) => {
                  const st = STATUS_STYLE[r.status];
                  const issues = Array.isArray(r.issues) ? r.issues : [];
                  const open = openRunId === r.id;
                  return (
                    <tr key={r.id} className="border-t border-neutral-800 align-top">
                      <td className="whitespace-nowrap px-3 py-2 text-neutral-300">
                        {new Date(r.started_at).toLocaleString()}
                      </td>
                      <td className="px-3 py-2 text-neutral-200">{labelFor(r.source)}</td>
                      <td className="whitespace-nowrap px-3 py-2 text-neutral-400">
                        {TRIGGER_LABEL[r.trigger]}
                        {r.run_by && names[r.run_by] ? ` · ${names[r.run_by]}` : ""}
                      </td>
                      <td className="px-3 py-2">
                        <span className={`rounded px-2 py-0.5 text-xs ${st.cls}`}>{st.label}</span>
                      </td>
                      <td className="px-3 py-2 text-neutral-300">{r.synced_count ?? "—"}</td>
                      <td className="px-3 py-2 text-neutral-400">
                        {issues.length === 0 ? (
                          "—"
                        ) : (
                          <div>
                            <button
                              type="button"
                              onClick={() => setOpenRunId(open ? null : r.id)}
                              className="text-amber-300 hover:underline"
                            >
                              {issues.length} {issues.length === 1 ? "issue" : "issues"} {open ? "▴" : "▾"}
                            </button>
                            {open && (
                              <ul className="mt-1 list-disc space-y-0.5 pl-4 text-xs text-neutral-300">
                                {issues.map((i, idx) => (
                                  <li key={idx} className="break-words">{i}</li>
                                ))}
                              </ul>
                            )}
                          </div>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
