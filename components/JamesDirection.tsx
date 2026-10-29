"use client";

// Direction for James — Distributors → Markstein, full width under the top row
// (added 2026-10-29, per Chad: "a section or block that recommends what james
// should/could be doing to improve sales … actionable items, direction"). Six
// action lists built from the sales data plus "What's working". Each list is
// ranked by what's most worth James's time and exports to Excel. Math:
// directionFor() in lib/jamesEffectiveness.ts. Data: james_effectiveness().

import { useMemo, useState } from "react";
import { useNewFeature } from "@/lib/newFeatures";
import NewBadge from "@/components/NewBadge";
import { CARD, MUTED, ExportButton, Pill, exportSheets } from "@/components/SalesDashboardHome";
import { computeJe, directionFor, type DirList } from "@/lib/jamesEffectiveness";
import { useJamesData } from "@/components/useJamesData";

const todayPacific = () => new Date().toLocaleDateString("en-CA", { timeZone: "America/Los_Angeles" });
const rate = (b: number, c: number) => (c ? `${Math.round((b / c) * 100)}%` : "—");

export default function JamesDirection({ version, onOpen }: { version: number; onOpen: (outletId: string) => void }) {
  const isNew = useNewFeature("feature:james-direction");
  const { data, err } = useJamesData(version);
  const dir = useMemo(() => (data ? directionFor(computeJe(data, todayPacific()), data) : null), [data]);
  const [tab, setTab] = useState<string>("chase");
  const [busy, setBusy] = useState(false);

  const list: DirList | undefined = dir?.lists.find((l) => l.key === tab);

  const doExport = async () => {
    if (!dir) return;
    setBusy(true);
    try {
      const cols = [
        { header: "Account", key: "name", width: 34 },
        { header: "City", key: "city", width: 16 },
        { header: "What", key: "sub", width: 44 },
        { header: "Details", key: "detail", width: 70 },
        { header: "Size", key: "value", width: 14 },
      ];
      await exportSheets(`Direction for James - ${data?.as_of ?? todayPacific()}.xlsx`, [
        ...dir.lists.map((l) => ({ name: l.title.slice(0, 31), title: `${l.title} — ${l.why}`, cols, rows: l.rows.map((r) => ({ ...r, city: r.city ?? "" })) })),
        {
          name: "What's working",
          title: "Commitments that turned into an order — by package and by premise",
          cols: [
            { header: "", key: "label", width: 22 },
            { header: "Committed", key: "c", width: 11 },
            { header: "Ordered", key: "b", width: 11 },
            { header: "Rate", key: "r", width: 9 },
          ],
          rows: [...dir.working.packages, ...dir.working.premise].map((w) => ({ label: w.label, c: w.committed, b: w.bought, r: rate(w.bought, w.committed) })),
        },
      ]);
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className={`${CARD} flex min-w-0 flex-col gap-3`} onClick={() => isNew.dismiss()}>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="flex items-center gap-2 text-[17px] font-bold text-neutral-100">
            Direction for James
            {isNew.isNew && <NewBadge inline />}
          </h2>
          <p className={`text-[12.5px] ${MUTED}`}>From the sales data, biggest opportunity first · click an account for its details</p>
        </div>
        <ExportButton onClick={doExport} busy={busy} />
      </div>

      {err && <p className="rounded-md border border-red-500/40 bg-red-500/10 px-3 py-2 text-sm text-red-300">{err}</p>}
      {!dir && !err && <p className={`text-sm ${MUTED}`}>Loading…</p>}

      {dir && (
        <div className="flex flex-wrap gap-4">
          <div className="flex min-w-0 flex-[2_1_520px] flex-col gap-3">
            <div className="flex flex-wrap gap-2">
              {dir.lists.map((l) => (
                <Pill key={l.key} on={tab === l.key} onClick={() => setTab(l.key)}>
                  {l.title} <span className="font-mono opacity-80">{l.rows.length}</span>
                </Pill>
              ))}
            </div>
            {list && <p className={`text-[12.5px] ${MUTED}`}>{list.why}</p>}
            <div className="flex max-h-[420px] flex-col overflow-y-auto rounded-lg border border-neutral-800">
              {list && list.rows.length === 0 && <p className={`p-3 text-sm ${MUTED}`}>Nothing here right now.</p>}
              {list?.rows.map((r, i) => (
                <button
                  key={`${r.outlet_id ?? r.name}-${i}`}
                  type="button"
                  disabled={!r.outlet_id}
                  onClick={() => r.outlet_id && onOpen(r.outlet_id)}
                  className="flex w-full flex-wrap items-start justify-between gap-x-4 gap-y-0.5 border-b border-neutral-900 px-3 py-2 text-left last:border-b-0 hover:bg-neutral-900/60 disabled:cursor-default disabled:hover:bg-transparent"
                >
                  <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                    <span className="text-[13.5px] font-semibold text-neutral-100">
                      {r.name}
                      {r.city ? <span className="font-normal text-neutral-500"> · {r.city}</span> : null}
                    </span>
                    <span className="text-[12px] text-neutral-400">{r.sub}</span>
                    {r.detail && <span className="text-[12px] leading-snug text-neutral-300">{r.detail}</span>}
                  </span>
                  {r.value && <span className="whitespace-nowrap font-mono text-[12.5px] text-neutral-200">{r.value}</span>}
                </button>
              ))}
            </div>
          </div>

          <div className="flex min-w-0 flex-[1_1_280px] flex-col gap-3">
            <h3 className="text-[14px] font-semibold text-neutral-100">What&apos;s working</h3>
            <p className={`text-[12.5px] ${MUTED}`}>Commitments that turned into an order within 30 days</p>
            {(
              [
                ["By package", dir.working.packages],
                ["By premise", dir.working.premise],
              ] as const
            ).map(([title, rows]) => (
              <div key={title} className="flex flex-col">
                <div className="pb-1 text-[11.5px] font-semibold uppercase tracking-wide text-neutral-500">{title}</div>
                {rows.map((w) => (
                  <div key={w.label} className="flex items-center gap-3 border-b border-neutral-900 py-1.5 text-[13px]">
                    <span className="min-w-0 flex-1 text-neutral-300">{w.label}</span>
                    <span className="whitespace-nowrap font-mono text-[12px] text-neutral-500">
                      {w.bought} of {w.committed}
                    </span>
                    <span className="w-12 text-right font-mono text-neutral-100">{rate(w.bought, w.committed)}</span>
                  </div>
                ))}
                {!rows.length && <p className={`text-[12.5px] ${MUTED}`}>Not enough commitments yet.</p>}
              </div>
            ))}
          </div>
        </div>
      )}
    </section>
  );
}
