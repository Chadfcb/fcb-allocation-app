"use client";

// "Didn't buy" button — inside the Actually bought tile of the Effectiveness
// block (Distributors → Markstein). Added 2026-11-03, per Chad: "theres 191
// committed accounts, and actually bought is 101, wheres the remaining 90
// accounts at? … i need a button there, that i can click on and see them, and
// export". Same day, Actually bought became ALL TIME ("we dont want to just
// focus on 30 days, we want all time"), so this lists every commitment with
// no order at all since the account committed (through the latest sales
// date). Count = Committed accounts − Actually bought.
//
// Committed accounts count once per account per WEEK, so one account can show
// more than once; the summary line gives the number of different accounts.
// Click a name → the account pop-up. Export → one sheet.

import { useMemo, useState } from "react";
import { useNewFeature } from "@/lib/newFeatures";
import NewBadge from "@/components/NewBadge";
import { ExportButton, Modal, exportSheets } from "@/components/SalesDashboardHome";
import type { Commitment, JeData } from "@/lib/jamesEffectiveness";

const DAY = 86400000;
const daysBetween = (a: string, b: string) => Math.round((Date.parse(b + "T00:00:00Z") - Date.parse(a + "T00:00:00Z")) / DAY);
const fmt = (iso: string | null) => {
  if (!iso) return "";
  const [y, m, d] = iso.split("-").map(Number);
  return `${m}/${d}/${String(y).slice(2)}`;
};

export default function JamesNotBought({
  commitments,
  data,
  today,
  onOpen,
}: {
  commitments: Commitment[];
  data: JeData;
  today: string;
  onOpen?: (outletId: string) => void;
}) {
  const isNew = useNewFeature("feature:james-not-bought");
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  const rows = useMemo(() => {
    const removed = new Set(data.removed ?? []);
    return commitments
      .filter((c) => !c.boughtEver)
      .map((c) => ({ c, daysSince: daysBetween(c.date, today), removed: removed.has(c.outlet_id) }))
      .sort((a, b) => a.c.date.localeCompare(b.c.date) || a.c.name.localeCompare(b.c.name));
  }, [commitments, data, today]);

  const accounts = new Set(rows.map((r) => r.c.outlet_id)).size;
  const through = fmt(data.as_of ?? today);

  const doExport = async () => {
    setBusy(true);
    try {
      await exportSheets(`Effectiveness - didn't buy - James (Markstein) - ${data.as_of ?? today}.xlsx`, [
        {
          name: "Didn't buy",
          title: `Commitments with no order since — ${rows.length} commitments at ${accounts} accounts (sales through ${through})`,
          cols: [
            { header: "Account", key: "name", width: 34 },
            { header: "City", key: "city", width: 16 },
            { header: "Premise", key: "prem", width: 9 },
            { header: "Committed", key: "date", width: 11 },
            { header: "Committed to", key: "items", width: 48 },
            { header: "Days since", key: "since", width: 10 },
            { header: "Removed from lists", key: "removed", width: 10 },
            { header: "Outlet ID", key: "outlet", width: 14 },
          ],
          rows: rows.map((r) => ({
            name: r.c.name,
            city: r.c.city ?? "",
            prem: r.c.premise ?? "",
            date: r.c.date,
            items: r.c.items.length ? r.c.items.join("; ") : "Not written down",
            since: r.daysSince,
            removed: r.removed ? "Yes" : "",
            outlet: r.c.outlet_id,
          })),
        },
      ]);
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <button
        type="button"
        onClick={() => {
          setOpen(true);
          isNew.dismiss();
        }}
        className="mt-1 flex items-center gap-1.5 rounded-md border border-neutral-600 bg-neutral-800/60 px-2 py-0.5 text-[12px] font-semibold text-neutral-100 hover:border-neutral-400"
      >
        Didn&apos;t buy
        <span className="rounded-full bg-neutral-700 px-1.5 font-mono text-[11.5px] leading-tight">{rows.length}</span>
        {isNew.isNew && <NewBadge inline />}
      </button>
      {open && (
        <Modal
          title="Commitments with no order since"
          sub={`${rows.length} commitments at ${accounts} different accounts · no Markstein sale to the account since it committed · sales through ${through}`}
          onClose={() => setOpen(false)}
          actions={rows.length > 0 ? <ExportButton onClick={doExport} busy={busy} /> : undefined}
        >
          <p className="mb-3 text-[12.5px] text-neutral-400">
            Committed accounts count once per account per week, so an account that committed in more than one week shows once for each week.
          </p>
          {rows.length === 0 && <p className="py-2 text-sm text-neutral-500">Every committed account has ordered since.</p>}
          <div className="max-h-[62vh] overflow-y-auto pr-1">
            {rows.map((r, i) => (
              <div key={`${r.c.outlet_id}|${r.c.date}|${i}`} className="flex flex-wrap items-start gap-x-3 gap-y-0.5 border-t border-neutral-800 py-2 first:border-t-0">
                <button
                  type="button"
                  disabled={!onOpen}
                  onClick={() => {
                    if (!onOpen) return;
                    setOpen(false);
                    onOpen(r.c.outlet_id);
                  }}
                  className="flex min-w-0 flex-1 flex-col gap-0.5 text-left enabled:hover:opacity-80"
                >
                  <span className="text-[13.5px] font-semibold text-neutral-100">
                    {r.c.name}
                    {r.c.city ? <span className="font-normal text-neutral-500"> · {r.c.city}</span> : null}
                    {r.c.premise ? <span className="font-normal text-neutral-500"> · {r.c.premise} premise</span> : null}
                    {r.removed && <span className="ml-2 rounded bg-amber-500/15 px-1.5 py-0.5 text-[11px] font-normal text-amber-200">Removed from lists</span>}
                  </span>
                  <span className="text-[12.5px] text-neutral-300">
                    Committed {fmt(r.c.date)}: {r.c.items.length ? r.c.items.join("; ") : <span className="text-neutral-500">products not written down</span>}
                  </span>
                </button>
                <span className="shrink-0 text-right text-[12px] text-neutral-400">{r.daysSince} days ago</span>
              </div>
            ))}
          </div>
        </Modal>
      )}
    </>
  );
}
