"use client";

// "James's weekly recaps" box on Distributors → Markstein (added 2026-10-29,
// per Chad). Administrators only (the page passes isAdmin; the API checks it
// too). Step 1: a one-time import of James's (CMC) history, 6/2–10/25/2026,
// with a review list before anything is saved. Later, the Monday upload for
// James's weekly attachments goes in this same box. Plan:
// claude/markstein-james-import-plan.md. API: app/api/markstein-james.

import { useMemo, useState } from "react";
import { useNewFeature } from "@/lib/newFeatures";
import NewBadge from "@/components/NewBadge";
import { CARD, MUTED, Modal, Pill } from "@/components/SalesDashboardHome";
import type { StoreMatch } from "@/lib/marksteinJames";

type Review = { stores: StoreMatch[]; imported: number; visits: number };
type Tab = "unsure" | "none" | "matched";

const TABS: { key: Tab; label: string; help: string }[] = [
  { key: "unsure", label: "Unsure", help: "Pick the right account, or add it as a new prospect." },
  { key: "none", label: "Not in the account list", help: "Never bought and not in the account list. They're added as Markstein Prospects unless you choose Skip." },
  { key: "matched", label: "Matched", help: "Matched to a Markstein account. You can still change any of them." },
];

const fmt = (iso: string) => {
  const [y, m, d] = iso.split("-").map(Number);
  return `${m}/${d}/${String(y).slice(2)}`;
};

export default function MarksteinJamesBox({ onImported }: { onImported: () => void }) {
  const isNew = useNewFeature("feature:markstein-james-import");
  const [review, setReview] = useState<Review | null>(null);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>("unsure");
  const [picks, setPicks] = useState<Record<string, string>>({});

  const openReview = async () => {
    isNew.dismiss();
    setErr(null);
    setDone(null);
    setLoading(true);
    try {
      const res = await fetch("/api/markstein-james");
      const j = await res.json();
      if (!res.ok) throw new Error(j.error ?? "Couldn't load the review list.");
      setReview(j as Review);
      const p: Record<string, string> = {};
      for (const s of (j as Review).stores) p[s.key] = s.pick ?? "new";
      setPicks(p);
      setTab((j as Review).stores.some((s) => s.status === "unsure") ? "unsure" : "none");
      setOpen(true);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  };

  const counts = useMemo(() => {
    const c = { unsure: 0, none: 0, matched: 0, checkins: 0, newAccts: 0, skipped: 0 };
    for (const s of review?.stores ?? []) {
      c[s.status]++;
      const p = picks[s.key];
      if (p === "skip") c.skipped += s.visits;
      else {
        c.checkins += s.visits;
        if (p === "new") c.newAccts++;
      }
    }
    return c;
  }, [review, picks]);

  const doImport = async () => {
    setSaving(true);
    setErr(null);
    try {
      const res = await fetch("/api/markstein-james", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ picks }),
      });
      const j = await res.json();
      if (!res.ok) throw new Error(j.error ?? "The import didn't finish.");
      setDone(
        `Imported ${j.checkins.toLocaleString()} check-ins` +
          (j.newAccounts ? `, added ${j.newAccounts} new Markstein prospect${j.newAccounts === 1 ? "" : "s"}` : "") +
          (j.skipped ? `, skipped ${j.skipped}` : "") +
          ".",
      );
      setOpen(false);
      setReview(null);
      onImported();
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  };

  const list = (review?.stores ?? []).filter((s) => s.status === tab);

  return (
    <section className={`${CARD} flex min-w-0 flex-col gap-3`}>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="flex items-center gap-2 text-[15px] font-semibold text-neutral-100">
            James&apos;s weekly recaps
            <span className="rounded-full border border-neutral-700 px-2 py-0.5 text-[11px] font-medium text-neutral-400">Administrators only</span>
          </h2>
          <p className={`text-[12.5px] ${MUTED}`}>
            James (CMC) isn&apos;t in LilyPad, so his visits come from your tracking spreadsheet (6/2–8/9) and his Monday recap emails (8/9–10/25).
          </p>
        </div>
        <button
          type="button"
          onClick={openReview}
          disabled={loading}
          className="flex items-center gap-1.5 rounded-lg border border-[#6abc46]/40 bg-[#6abc46]/10 px-3.5 py-2 text-sm font-semibold text-neutral-100 hover:bg-[#6abc46]/20 disabled:opacity-50"
        >
          {loading ? "Matching stores…" : "Import James's history"}
          {isNew.isNew && <NewBadge inline />}
        </button>
      </div>
      {err && !open && <p className="rounded-md border border-red-500/40 bg-red-500/10 px-3 py-2 text-sm text-red-300">{err}</p>}
      {done && <p className="rounded-md border border-[#6abc46]/40 bg-[#6abc46]/10 px-3 py-2 text-sm text-neutral-100">{done}</p>}

      {open && review && (
        <Modal
          title="Import James's history — review"
          sub={`${review.visits.toLocaleString()} visits at ${review.stores.length} stores, 6/2–10/25/2026${
            review.imported ? ` · already imported: ${review.imported.toLocaleString()} (importing again replaces them)` : ""
          }`}
          onClose={() => setOpen(false)}
        >
          <div className="flex flex-col gap-3">
            <div className="flex flex-wrap gap-2">
              {TABS.map((t) => (
                <Pill key={t.key} on={tab === t.key} onClick={() => setTab(t.key)}>
                  {t.label} ({counts[t.key]})
                </Pill>
              ))}
            </div>
            <p className={`text-[12.5px] ${MUTED}`}>{TABS.find((t) => t.key === tab)?.help}</p>
            <div className="max-h-[55vh] overflow-y-auto rounded-lg border border-neutral-800">
              {list.length === 0 && <p className={`p-3 text-[13px] ${MUTED}`}>None.</p>}
              {list.map((s) => (
                <div key={s.key} className="flex flex-wrap items-center gap-3 border-b border-neutral-800 px-3 py-2.5 last:border-b-0">
                  <div className="flex min-w-[220px] flex-1 flex-col gap-0.5">
                    <span className="text-[13.5px] font-semibold text-neutral-100">{s.name}</span>
                    <span className={`text-[12px] ${MUTED}`}>
                      {[s.address, s.city].filter(Boolean).join(", ")} · {s.visits} visit{s.visits === 1 ? "" : "s"} ({fmt(s.first)}
                      {s.last !== s.first ? `–${fmt(s.last)}` : ""}) · {s.why}
                    </span>
                  </div>
                  <select
                    value={picks[s.key] ?? ""}
                    onChange={(e) => setPicks((p) => ({ ...p, [s.key]: e.target.value }))}
                    aria-label={`Account for ${s.name}`}
                    className="min-w-[280px] max-w-full rounded-md border border-neutral-700 bg-neutral-900 px-2 py-1.5 text-[13px] text-neutral-100"
                  >
                    {s.candidates.map((c) => (
                      <option key={c.outlet_id} value={c.outlet_id}>
                        {c.name} — {[c.address, c.city].filter(Boolean).join(", ")} ({c.distributor ?? "no distributor"} · {c.outlet_id})
                      </option>
                    ))}
                    <option value="new">Add as a new Markstein prospect</option>
                    <option value="skip">Skip — don&apos;t import these visits</option>
                  </select>
                </div>
              ))}
            </div>
            {err && <p className="rounded-md border border-red-500/40 bg-red-500/10 px-3 py-2 text-sm text-red-300">{err}</p>}
            <div className="flex flex-wrap items-center justify-between gap-3">
              <p className="text-[13px] text-neutral-300">
                Will import <span className="font-semibold text-neutral-100">{counts.checkins.toLocaleString()}</span> check-ins
                {counts.newAccts ? ` · add ${counts.newAccts} new prospect${counts.newAccts === 1 ? "" : "s"}` : ""}
                {counts.skipped ? ` · skip ${counts.skipped}` : ""}
              </p>
              <button
                type="button"
                onClick={doImport}
                disabled={saving}
                className="rounded-lg border border-[#6abc46]/60 bg-[#6abc46]/20 px-4 py-2 text-sm font-semibold text-neutral-100 hover:bg-[#6abc46]/30 disabled:opacity-50"
              >
                {saving ? "Importing…" : "Import"}
              </button>
            </div>
          </div>
        </Modal>
      )}
    </section>
  );
}
