"use client";

// James Effectiveness — Distributors → Markstein, next to Today's priorities
// (added 2026-10-29, per Chad: "its a very important block"). The measures
// Chad tracked on his spreadsheet's Leadsheet tab, checked against what the
// stores actually bought (LilyPad / VIP sales) rather than what James (CMC)
// reports. Math: lib/jamesEffectiveness.ts. Data: james_effectiveness()
// (sql/james_effectiveness.sql). Plan: claude/james-effectiveness-plan.md.

import { useEffect, useMemo, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { useNewFeature } from "@/lib/newFeatures";
import NewBadge from "@/components/NewBadge";
import { CARD, MUTED, ExportButton, Pill, exportSheets, type Col } from "@/components/SalesDashboardHome";
import { computeJe, type JeData, type WeekRow } from "@/lib/jamesEffectiveness";

type Tab = "summary" | "weeks" | "compare";

const todayPacific = () => new Date().toLocaleDateString("en-CA", { timeZone: "America/Los_Angeles" });
const fmtDate = (iso: string | null) => {
  if (!iso) return "—";
  const [y, m, d] = iso.split("-").map(Number);
  return `${m}/${d}/${String(y).slice(2)}`;
};
const monthName = (iso: string) => new Date(iso + "T12:00:00Z").toLocaleDateString("en-US", { month: "short", timeZone: "UTC" });
const cell = (row: WeekRow, v: number | null) => {
  if (v === null || v === undefined) return "—";
  if (row.pct) return `${Math.round(v * 100)}%`;
  if (row.dec) return v === 0 ? "0" : v.toFixed(1);
  return String(Math.round(v));
};
const change = (ty: number, ly: number) => (ly > 0 ? Math.round(((ty - ly) / ly) * 100) : null);

export default function JamesEffectiveness({ version }: { version: number }) {
  const supabase = useMemo(() => createClient(), []);
  const isNew = useNewFeature("feature:james-effectiveness");
  const [data, setData] = useState<JeData | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>("summary");
  const [busy, setBusy] = useState(false);
  const weeksBox = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const { data: d, error } = await supabase.rpc("james_effectiveness");
      if (cancelled) return;
      if (error) setErr(error.message);
      else {
        setErr(null);
        setData(d as JeData);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [supabase, version]);

  const res = useMemo(() => (data ? computeJe(data, todayPacific()) : null), [data]);

  // Week by week opens on the newest weeks (scrolled to the right).
  useEffect(() => {
    if (tab === "weeks" && weeksBox.current) weeksBox.current.scrollLeft = weeksBox.current.scrollWidth;
  }, [tab, res]);

  const groups = useMemo(() => {
    const g: { name: string; rows: WeekRow[] }[] = [];
    for (const r of res?.rows ?? []) {
      const last = g[g.length - 1];
      if (last && last.name === r.group) last.rows.push(r);
      else g.push({ name: r.group, rows: [r] });
    }
    return g;
  }, [res]);

  const doExport = async () => {
    if (!res) return;
    setBusy(true);
    try {
      const weekCols: Col[] = [{ header: "Measure", key: "label", width: 38 }, ...res.weeks.map((w, i) => ({ header: w.label, key: `w${i}`, width: 11 })), { header: "Total", key: "total", width: 11 }];
      const weekRows = res.rows.map((r) => {
        const o: Record<string, unknown> = { label: `${r.group} — ${r.label}`, total: cell(r, r.total) };
        r.values.forEach((v, i) => (o[`w${i}`] = cell(r, v)));
        return o;
      });
      const FILL: Record<string, string> = { all: "Got everything", some: "Got some", unlisted: "Bought (products not written down)", none: "Got none", pending: "Too soon to tell" };
      await exportSheets(`James Effectiveness - ${data?.as_of ?? todayPacific()}.xlsx`, [
        { name: "Week by week", title: "James Effectiveness — week by week (Sun–Sat)", cols: weekCols, rows: weekRows },
        {
          name: "Commitments",
          title: "James's commitments vs what the store bought (30 days)",
          cols: [
            { header: "Date", key: "date", width: 11 },
            { header: "Store", key: "name", width: 34 },
            { header: "City", key: "city", width: 16 },
            { header: "Committed to", key: "items", width: 48 },
            { header: "Bought?", key: "bought", width: 9 },
            { header: "CEs bought", key: "ce", width: 11 },
            { header: "Result", key: "fill", width: 30 },
          ],
          rows: res.commitments.map((c) => ({
            date: c.date,
            name: c.name,
            city: c.city ?? "",
            items: c.items.join("; "),
            bought: c.delivered ? "Yes" : "No",
            ce: Math.round(c.ce * 100) / 100,
            fill: FILL[c.fill] ?? c.fill,
          })),
        },
        {
          name: "vs other stores",
          title: "Markstein CEs by month — stores James visited vs every other Markstein store, vs last year",
          cols: [
            { header: "Month", key: "month", width: 10 },
            { header: "James's stores", key: "jt", width: 14 },
            { header: "Same stores last year", key: "jl", width: 18 },
            { header: "Other Markstein stores", key: "ot", width: 20 },
            { header: "Other stores last year", key: "ol", width: 20 },
          ],
          rows: res.compare.map((m) => ({
            month: m.month.slice(0, 7),
            jt: Math.round(m.jamesTy * 10) / 10,
            jl: Math.round(m.jamesLy * 10) / 10,
            ot: Math.round(m.otherTy * 10) / 10,
            ol: Math.round(m.otherLy * 10) / 10,
          })),
        },
      ]);
    } finally {
      setBusy(false);
    }
  };

  const t = res?.totals;
  const tiles: [string, string, string?][] = t
    ? [
        ["Check-ins", t.checkins.toLocaleString()],
        ["Committed accounts", t.committed.toLocaleString()],
        ["Actually bought", t.delivered.toLocaleString(), t.conversion !== null ? `${Math.round(t.conversion * 100)}% of committed` : undefined],
        ["CEs bought", t.ce.toFixed(1), "within 30 days of committing"],
        ["Rebuy accounts", t.rebuys.toLocaleString(), "bought 2+ times after his visit"],
        ["Targets hit", `${t.targetsHit} / ${t.targets}`],
      ]
    : [];

  return (
    <section
      className={`${CARD} flex min-w-0 flex-[1_1_560px] flex-col gap-3`}
      onClick={() => isNew.dismiss()}
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="flex items-center gap-2 text-[17px] font-bold text-neutral-100">
            James Effectiveness
            {isNew.isNew && <NewBadge inline />}
          </h2>
          <p className={`text-[12.5px] ${MUTED}`}>
            James Mendoza (CMC) since 5/31 · his visits checked against actual sales (LilyPad, through {fmtDate(data?.as_of ?? null)})
          </p>
        </div>
        <ExportButton onClick={doExport} busy={busy} />
      </div>

      {err && <p className="rounded-md border border-red-500/40 bg-red-500/10 px-3 py-2 text-sm text-red-300">{err}</p>}
      {!res && !err && <p className={`text-sm ${MUTED}`}>Loading…</p>}

      {res && (
        <>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
            {tiles.map(([label, value, sub]) => (
              <div key={label} className="rounded-lg border border-neutral-800 bg-neutral-900/60 px-3 py-2">
                <div className="text-[11.5px] text-neutral-400">{label}</div>
                <div className="font-mono text-lg font-semibold text-neutral-100">{value}</div>
                {sub && <div className="text-[11px] text-neutral-500">{sub}</div>}
              </div>
            ))}
          </div>

          <div className="flex flex-wrap gap-2">
            <Pill on={tab === "summary"} onClick={() => setTab("summary")}>
              Totals
            </Pill>
            <Pill on={tab === "weeks"} onClick={() => setTab("weeks")}>
              Week by week
            </Pill>
            <Pill on={tab === "compare"} onClick={() => setTab("compare")}>
              vs other Markstein stores
            </Pill>
          </div>

          {tab === "summary" && (
            <div className="max-h-[380px] overflow-y-auto pr-1">
              {groups.map((g) => (
                <div key={g.name} className="mb-2">
                  <div className="py-1 text-[11.5px] font-semibold uppercase tracking-wide text-neutral-500">{g.name}</div>
                  {g.rows.map((r) => (
                    <div key={r.key} className="flex justify-between gap-3 border-b border-neutral-900 py-1 text-[13px]">
                      <span className="text-neutral-300">{r.label}</span>
                      <span className="font-mono text-neutral-100">{cell(r, r.total)}</span>
                    </div>
                  ))}
                </div>
              ))}
            </div>
          )}

          {tab === "weeks" && (
            <div ref={weeksBox} className="max-h-[380px] overflow-auto rounded-lg border border-neutral-800">
              <table className="min-w-max border-collapse text-[12.5px]">
                <thead>
                  <tr>
                    <th className="sticky left-0 top-0 z-20 bg-neutral-950 px-2 py-1.5 text-left font-semibold text-neutral-400">Measure</th>
                    {res.weeks.map((w) => (
                      <th key={w.from} className="sticky top-0 z-10 whitespace-nowrap bg-neutral-950 px-2 py-1.5 text-right font-semibold text-neutral-400">
                        {w.label}
                      </th>
                    ))}
                    <th className="sticky top-0 z-10 bg-neutral-950 px-2 py-1.5 text-right font-semibold text-neutral-200">Total</th>
                  </tr>
                </thead>
                <tbody>
                  {groups.map((g) => (
                    <FragmentRows key={g.name} name={g.name} rows={g.rows} n={res.weeks.length} />
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {tab === "compare" && (
            <div className="flex flex-col gap-2">
              <p className={`text-[12.5px] ${MUTED}`}>Markstein CEs by month: stores James has visited vs every other Markstein store, each against the same month last year.</p>
              <div className="overflow-x-auto">
                <table className="w-full border-collapse text-[13px]">
                  <thead>
                    <tr className="text-[11.5px] text-neutral-400">
                      <th className="px-2 py-1 text-left font-semibold">Month</th>
                      <th className="px-2 py-1 text-right font-semibold">James&apos;s stores</th>
                      <th className="px-2 py-1 text-right font-semibold">vs last year</th>
                      <th className="px-2 py-1 text-right font-semibold">Other stores</th>
                      <th className="px-2 py-1 text-right font-semibold">vs last year</th>
                    </tr>
                  </thead>
                  <tbody>
                    {res.compare.map((m) => {
                      const a = change(m.jamesTy, m.jamesLy);
                      const b = change(m.otherTy, m.otherLy);
                      return (
                        <tr key={m.month} className="border-t border-neutral-900">
                          <td className="px-2 py-1 text-neutral-300">{monthName(m.month)}</td>
                          <td className="px-2 py-1 text-right font-mono text-neutral-100">{m.jamesTy.toFixed(1)}</td>
                          <td className={`px-2 py-1 text-right font-mono ${a === null ? "text-neutral-500" : a >= 0 ? "text-[#6abc46]" : "text-[#ffab9c]"}`}>{a === null ? "—" : `${a > 0 ? "+" : ""}${a}%`}</td>
                          <td className="px-2 py-1 text-right font-mono text-neutral-100">{m.otherTy.toFixed(1)}</td>
                          <td className={`px-2 py-1 text-right font-mono ${b === null ? "text-neutral-500" : b >= 0 ? "text-[#6abc46]" : "text-[#ffab9c]"}`}>{b === null ? "—" : `${b > 0 ? "+" : ""}${b}%`}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              {data?.as_of && <p className="text-[11.5px] text-neutral-500">This month is partial (sales through {fmtDate(data.as_of)}).</p>}
            </div>
          )}
        </>
      )}
    </section>
  );
}

function FragmentRows({ name, rows, n }: { name: string; rows: WeekRow[]; n: number }) {
  return (
    <>
      <tr>
        <td className="sticky left-0 z-10 whitespace-nowrap bg-neutral-950 px-2 pb-0.5 pt-2.5 text-[11px] font-semibold uppercase tracking-wide text-neutral-500">{name}</td>
        <td colSpan={n + 1} className="bg-neutral-950" />
      </tr>
      {rows.map((r) => (
        <tr key={r.key} className="border-t border-neutral-900">
          <td className="sticky left-0 z-10 whitespace-nowrap bg-neutral-950 px-2 py-1 text-neutral-300">{r.label}</td>
          {r.values.map((v, i) => (
            <td key={i} className="px-2 py-1 text-right font-mono text-neutral-200">
              {cell(r, v)}
            </td>
          ))}
          <td className="px-2 py-1 text-right font-mono font-semibold text-neutral-100">{cell(r, r.total)}</td>
        </tr>
      ))}
    </>
  );
}
