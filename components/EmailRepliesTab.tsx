"use client";

// Email Studio → Replies (added 2026-11-25, per Chad: "we need an alert when
// one of these accounts replies to our emails … i want the email checked for
// replies, us notified, so we can act" — once an hour, in the app).
// Every reply from someone we emailed, newest first: Needs action / Handled,
// filter by distributor, ✓ Mark handled (records who), and a link to the
// account on its distributor page. The red number in the menu
// (components/Sidebar.tsx) counts the ones not handled yet.
// Data: sql/email_replies.sql (email_studio_replies, email_reply_set_handled,
// email_reply_state). Inbox reading: lib/email/replies.ts.

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import { DISTRIBUTOR_PAGES, distributorHref } from "@/lib/distributorPages";
import { prettyAccountName } from "@/lib/email/mergeTags";
import { ReplyDetail, fmtWhen, type ReplyRow } from "@/components/DistributorEmailButtons";

const chip = (on: boolean) =>
  `rounded-full px-3 py-1 text-xs font-semibold ${on ? "bg-brand text-on-brand" : "border border-neutral-700 text-neutral-300 hover:bg-neutral-800"}`;

export default function EmailRepliesTab({ onCountChange }: { onCountChange?: (open: number) => void }) {
  const [supabase] = useState(() => createClient());
  const [rows, setRows] = useState<ReplyRow[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [view, setView] = useState<"open" | "handled">("open");
  const [dist, setDist] = useState("");
  const [sel, setSel] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [checking, setChecking] = useState(false);
  const [state, setState] = useState<{ last_checked_at: string | null; last_result: string | null } | null>(null);

  const load = useCallback(async () => {
    const [r, st] = await Promise.all([
      supabase.rpc("email_studio_replies"),
      supabase.from("email_reply_state").select("last_checked_at, last_result").eq("id", 1).maybeSingle(),
    ]);
    if (r.error) {
      setErr(r.error.message);
      setRows([]);
      return;
    }
    setErr(null);
    const list = (r.data as ReplyRow[]) ?? [];
    setRows(list);
    setState((st.data as { last_checked_at: string | null; last_result: string | null } | null) ?? null);
    onCountChange?.(list.filter((x) => !x.handled_at).length);
  }, [supabase, onCountChange]);

  useEffect(() => {
    void Promise.resolve().then(load);
  }, [load]);

  const dists = useMemo(() => [...new Set((rows ?? []).map((r) => r.distributor || "No account"))].sort(), [rows]);
  const shown = useMemo(
    () =>
      (rows ?? []).filter(
        (r) => (view === "open" ? !r.handled_at : !!r.handled_at) && (!dist || (r.distributor || "No account") === dist),
      ),
    [rows, view, dist],
  );
  const openCount = (rows ?? []).filter((r) => !r.handled_at).length;
  const handledCount = (rows ?? []).length - openCount;
  const current = shown.find((r) => r.id === sel) ?? shown[0] ?? null;

  async function toggle(r: ReplyRow) {
    setBusy(true);
    const { data, error } = await supabase.rpc("email_reply_set_handled", { p_id: r.id, p_handled: !r.handled_at });
    setBusy(false);
    if (error) {
      setErr(error.message);
      return;
    }
    const d = data as { handled: boolean; by: string | null };
    setRows((prev) => {
      const next = (prev ?? []).map((x) => (x.id === r.id ? { ...x, handled_at: d.handled ? new Date().toISOString() : null, handled_by_name: d.by } : x));
      onCountChange?.(next.filter((x) => !x.handled_at).length);
      return next;
    });
    window.dispatchEvent(new Event("fcb-replies-changed"));
  }

  async function checkNow() {
    setChecking(true);
    try {
      const res = await fetch("/api/email-studio/replies/check", { method: "POST" });
      const j = (await res.json()) as { note?: string; error?: string };
      if (!res.ok) setErr(j.error ?? "Couldn't check the inbox.");
      await load();
      window.dispatchEvent(new Event("fcb-replies-changed"));
    } catch {
      setErr("Couldn't check the inbox.");
    } finally {
      setChecking(false);
    }
  }

  const pageFor = (name: string | null) => DISTRIBUTOR_PAGES.find((p) => p.name === name) ?? null;

  if (rows === null) return <p className="text-sm text-neutral-500">Loading replies…</p>;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <button type="button" className={chip(view === "open")} onClick={() => setView("open")}>
          Needs action ({openCount})
        </button>
        <button type="button" className={chip(view === "handled")} onClick={() => setView("handled")}>
          Handled ({handledCount})
        </button>
        {dists.length > 1 && (
          <select value={dist} onChange={(e) => setDist(e.target.value)} className="rounded-full border border-neutral-700 bg-neutral-900 px-3 py-1 text-xs text-neutral-200">
            <option value="">All distributors</option>
            {dists.map((d) => (
              <option key={d} value={d}>
                {d}
              </option>
            ))}
          </select>
        )}
        <span className="ml-auto text-xs text-neutral-500">
          {state?.last_checked_at ? `Ernie's inbox checked ${fmtWhen(state.last_checked_at)} · checks once an hour` : "Ernie's inbox is checked once an hour"}
        </span>
        <button
          type="button"
          disabled={checking}
          onClick={() => void checkNow()}
          className="rounded-full border border-neutral-700 px-3 py-1 text-xs text-neutral-200 hover:bg-neutral-800 disabled:opacity-50"
        >
          {checking ? "Checking…" : "Check now"}
        </button>
      </div>
      {state?.last_result && /couldn't|could not|isn't set up/i.test(state.last_result) && (
        <p className="rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-sm text-amber-200">{state.last_result}</p>
      )}
      {err && <p className="text-sm text-red-300">{err}</p>}

      {shown.length === 0 ? (
        <p className="py-10 text-center text-neutral-500">
          {view === "open" ? "No replies waiting. New ones show up here within an hour." : "Nothing marked handled yet."}
        </p>
      ) : (
        <div className="flex flex-col gap-4 lg:flex-row">
          <div className="max-h-[75vh] w-full shrink-0 space-y-2 overflow-auto lg:w-[26rem]">
            {shown.map((r) => (
              <button
                type="button"
                key={r.id}
                onClick={() => setSel(r.id)}
                className={`block w-full rounded-xl border p-3 text-left ${
                  current?.id === r.id ? "border-[#6abc46] bg-neutral-900" : "border-neutral-800 hover:bg-neutral-900"
                }`}
              >
                <div className="flex items-center gap-2">
                  <span className="truncate font-semibold text-neutral-100">{prettyAccountName(r.account) || r.account}</span>
                  {!r.handled_at ? (
                    <span className="rounded-full bg-red-500 px-2 text-[10px] font-bold text-white">NEW</span>
                  ) : (
                    <span className="truncate text-xs text-green-400">✓ Handled{r.handled_by_name ? ` by ${r.handled_by_name.split(" ")[0]}` : ""}</span>
                  )}
                  <span className="ml-auto shrink-0 text-xs text-neutral-400">{fmtWhen(r.received_at)}</span>
                </div>
                <div className="text-xs text-neutral-400">
                  {[r.distributor, r.city, r.campaign_subject || r.campaign].filter(Boolean).join(" · ")}
                </div>
                <div className="mt-1 truncate text-sm text-neutral-300">“{(r.body ?? "").replace(/\s+/g, " ").slice(0, 120)}”</div>
              </button>
            ))}
          </div>
          <div className="min-w-0 flex-1 space-y-2">
            {current && (
              <>
                <ReplyDetail r={current} busy={busy} onToggleHandled={() => void toggle(current)} />
                {pageFor(current.distributor) && (
                  <Link
                    href={`${distributorHref(pageFor(current.distributor)!.slug)}?replies=1&reply=${current.id}`}
                    className="inline-block text-sm text-brand underline"
                  >
                    Open on the {current.distributor} page (full account card) →
                  </Link>
                )}
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
