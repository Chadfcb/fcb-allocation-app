"use client";

// Effectiveness — Distributors → Markstein, next to Today's priorities
// (added 2026-10-29, per Chad: "its a very important block"; renamed from
// "James Effectiveness" the same day). One-line verdict on top, then the measures
// Chad tracked on his spreadsheet's Leadsheet tab, checked against what the
// stores actually bought (LilyPad / VIP sales) rather than what James (CMC)
// reports. Math: lib/jamesEffectiveness.ts. Data: james_effectiveness()
// (sql/james_effectiveness.sql). Plan: claude/james-effectiveness-plan.md.

import { useEffect, useMemo, useRef, useState } from "react";
import { useNewFeature } from "@/lib/newFeatures";
import NewBadge from "@/components/NewBadge";
import { CARD, MUTED, ExportButton, Pill, exportSheets, type Col } from "@/components/SalesDashboardHome";
import { computeJe, verdictFor, type WeekRow } from "@/lib/jamesEffectiveness";
import { useJamesData } from "@/components/useJamesData";

type Tab = "summary" | "weeks" | "impact";

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
const GRADE = {
  Strong: { box: "border-[#6abc46]/50 bg-[#6abc46]/10", text: "text-[#6abc46]" },
  Working: { box: "border-[#facc15]/40 bg-[#facc15]/5", text: "text-[#facc15]" },
  "Needs work": { box: "border-[#fb923c]/50 bg-[#fb923c]/10", text: "text-[#fb923c]" },
} as const;

export default function JamesEffectiveness({ version }: { version: number }) {
  const isNew = useNewFeature("feature:james-effectiveness");
  const { data, err } = useJamesData(version);
  const [tab, setTab] = useState<Tab>("summary");
  const [busy, setBusy] = useState(false);
  const weeksBox = useRef<HTMLDivElement>(null);

  const res = useMemo(() => (data ? computeJe(data, todayPacific()) : null), [data]);
  const verdict = useMemo(() => (res && data ? verdictFor(res, data) : null), [res, data]);

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
      await exportSheets(`Effectiveness - James (Markstein) - ${data?.as_of ?? todayPacific()}.xlsx`, [
        { name: "Week by week", title: "Effectiveness — James (CMC) at Markstein — week by week (Sun–Sat)", cols: weekCols, rows: weekRows },
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
          name: "vs last year",
          title: "Accounts James visited — CEs bought since he started visiting them vs the same time last year",
          cols: [
            { header: "Month", key: "month", width: 10 },
            { header: "This year", key: "a", width: 12 },
            { header: "Same time last year", key: "l", width: 20 },
          ],
          rows: res.impact.months.map((m) => ({ month: m.month.slice(0, 7), a: Math.round(m.after * 10) / 10, l: Math.round(m.lastYear * 10) / 10 })),
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
            Effectiveness
            {isNew.isNew && <NewBadge inline />}
          </h2>
          <p className="text-[13.5px] text-neutral-200">
            James Mendoza (CMC) since 5/31 · visits checked against actual sales (LilyPad, through {fmtDate(data?.as_of ?? null)})
          </p>
        </div>
        <ExportButton onClick={doExport} busy={busy} />
      </div>

      {err && <p className="rounded-md border border-red-500/40 bg-red-500/10 px-3 py-2 text-sm text-red-300">{err}</p>}
      {!res && !err && <p className={`text-sm ${MUTED}`}>Loading…</p>}

      {res && (
        <>
          {verdict && (
            <div className={`rounded-lg border px-3 py-2.5 ${GRADE[verdict.grade].box}`}>
              <div className={`text-[15px] font-bold ${GRADE[verdict.grade].text}`}>{verdict.grade}</div>
              <ul className="mt-1 flex flex-col gap-1">
                {verdict.checks.map((c) => (
                  <li key={c.key} className="flex gap-2 text-[13px] leading-snug text-neutral-200">
                    <span className={`shrink-0 font-bold ${c.good === true ? "text-[#6abc46]" : c.good === false ? "text-[#fb923c]" : "text-neutral-500"}`}>
                      {c.good === true ? "✓" : c.good === false ? "✗" : "–"}
                    </span>
                    <span>{c.text}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}

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
            <Pill on={tab === "impact"} onClick={() => setTab("impact")}>
              vs last year
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

          {tab === "impact" && (
            <div className="flex flex-col gap-3">
              {/* Plain-English version (2026-10-29, Chad: "this is incredibly
                  confusing to me and mark our sales manager … fix it so it
                  makes sense"). Each account counts from the day James first
                  visited it, against the same days a year earlier. */}
              <div className="flex flex-col gap-2 rounded-lg border-l-[3px] border-[#6abc46] bg-[#6abc46]/10 px-3 py-2.5 text-[14px] leading-snug text-neutral-100">
                <p>
                  Since James started visiting them, these <b>{res.impact.accounts.toLocaleString()} accounts</b> have bought <b>{res.impact.after.toFixed(0)} CEs</b>.
                  During the same weeks last year, they bought <b>{res.impact.lastYear.toFixed(0)}</b>.
                  {res.impact.lastYear > 0 && (
                    <>
                      {" "}
                      That&apos;s{" "}
                      <b className={res.impact.after >= res.impact.lastYear ? "text-[#9edc7f]" : "text-[#ffab9c]"}>
                        {res.impact.after >= res.impact.lastYear
                          ? `${(res.impact.after / res.impact.lastYear).toFixed(1)} times as much (+${change(res.impact.after, res.impact.lastYear)}%)`
                          : `${change(res.impact.after, res.impact.lastYear)}% less`}
                      </b>
                      .
                    </>
                  )}
                </p>
                {res.impact.newBuyers > 0 && (
                  <p>
                    <b>{res.impact.newBuyers} of them are new buyers</b>: they bought nothing in the year before James visited, and they&apos;ve bought{" "}
                    <b>{res.impact.newBuyersCe.toFixed(0)} CEs</b> since.
                  </p>
                )}
              </div>
              <div className="overflow-x-auto">
                <table className="w-full border-collapse text-[13px]">
                  <thead>
                    <tr className="text-[11.5px] text-neutral-400">
                      <th className="px-2 py-1 text-left font-semibold">Month</th>
                      <th className="px-2 py-1 text-right font-semibold">This year</th>
                      <th className="px-2 py-1 text-right font-semibold">Same time last year</th>
                      <th className="px-2 py-1 text-right font-semibold">Change</th>
                    </tr>
                  </thead>
                  <tbody>
                    {res.impact.months.map((m) => {
                      const c = change(m.after, m.lastYear);
                      return (
                        <tr key={m.month} className="border-t border-neutral-900">
                          <td className="px-2 py-1 text-neutral-300">{monthName(m.month)}</td>
                          <td className="px-2 py-1 text-right font-mono text-neutral-100">{m.after.toFixed(1)}</td>
                          <td className="px-2 py-1 text-right font-mono text-neutral-300">{m.lastYear.toFixed(1)}</td>
                          <td className={`px-2 py-1 text-right font-mono ${c === null ? "text-neutral-500" : c >= 0 ? "text-[#6abc46]" : "text-[#ffab9c]"}`}>
                            {c === null ? "—" : `${c > 0 ? "+" : ""}${c}%`}
                          </td>
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
