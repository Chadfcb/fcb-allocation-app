"use client";

// "Didn't buy" button — inside the Actually bought tile of the Effectiveness
// block (Distributors → Markstein). Added 2026-11-03, per Chad: "theres 191
// committed accounts, and actually bought is 101, wheres the remaining 90
// accounts at? … i need a button there, that i can click on and see them, and
// export".
//
// Lists every commitment that has NOT turned into an order, from the same
// math as the tiles (lib/jamesEffectiveness.ts computeJe → commitments), so the
// count always equals Committed accounts − Actually bought. Two groups:
// - Didn't buy within 30 days (fill "none") + the first buy after the 30 days,
//   if there was one.
// - Too soon to tell (fill "pending") + days left in the 30-day window.
// Committed accounts count once per store per WEEK, so one account can show
// more than once; the summary line gives the number of different accounts.
// Click a name → the account pop-up. Export → one sheet.

import { useMemo, useState } from "react";
import { useNewFeature } from "@/lib/newFeatures";
import NewBadge from "@/components/NewBadge";
import { ExportButton, Modal, exportSheets } from "@/components/SalesDashboardHome";
import { addDays, type Commitment, type JeData } from "@/lib/jamesEffectiveness";

const WINDOW_DAYS = 30; // same as lib/jamesEffectiveness.ts
const DAY = 86400000;
const daysBetween = (a: string, b: string) => Math.round((Date.parse(b + "T00:00:00Z") - Date.parse(a + "T00:00:00Z")) / DAY);
const fmt = (iso: string | null) => {
  if (!iso) return "";
  const [y, m, d] = iso.split("-").map(Number);
  return `${m}/${d}/${String(y).slice(2)}`;
};

interface Row {
  c: Commitment;
  group: "none" | "pending";
  daysSince: number;
  laterBuy: string | null; // first buy day after the 30 days (none group)
  daysLeft: number | null; // pending group
  removed: boolean;
}

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

  const rows = useMemo<Row[]>(() => {
    const salesThrough = data.as_of ?? today;
    const removed = new Set(data.removed ?? []);
    const buys = new Map<string, string[]>();
    for (const s of data.sales) {
      const l = buys.get(s.outlet_id) ?? [];
      for (const d of [s.first_buy_in_month, s.last_buy_date]) if (d) l.push(d);
      buys.set(s.outlet_id, l);
    }
    return commitments
      .filter((c) => !c.delivered)
      .map((c) => {
        const winEnd = addDays(c.date, WINDOW_DAYS);
        const group: Row["group"] = c.fill === "pending" ? "pending" : "none";
        const later = (buys.get(c.outlet_id) ?? []).filter((d) => d > winEnd).sort()[0] ?? null;
        return {
          c,
          group,
          daysSince: daysBetween(c.date, today),
          laterBuy: group === "none" ? later : null,
          daysLeft: group === "pending" ? Math.max(0, daysBetween(salesThrough, winEnd)) : null,
          removed: removed.has(c.outlet_id),
        };
      })
      .sort((a, b) => b.c.date.localeCompare(a.c.date) || a.c.name.localeCompare(b.c.name));
  }, [commitments, data, today]);

  const none = rows.filter((r) => r.group === "none");
  const pending = rows.filter((r) => r.group === "pending");
  const accounts = new Set(rows.map((r) => r.c.outlet_id)).size;
  const boughtLater = none.filter((r) => r.laterBuy).length;

  const doExport = async () => {
    setBusy(true);
    try {
      await exportSheets(`Effectiveness - didn't buy - James (Markstein) - ${data.as_of ?? today}.xlsx`, [
        {
          name: "Didn't buy",
          title: `Commitments that didn't turn into an order — ${rows.length} commitments at ${accounts} accounts (sales through ${fmt(data.as_of ?? today)})`,
          cols: [
            { header: "Status", key: "status", width: 26 },
            { header: "Account", key: "name", width: 34 },
            { header: "City", key: "city", width: 16 },
            { header: "Premise", key: "prem", width: 9 },
            { header: "Committed", key: "date", width: 11 },
            { header: "Committed to", key: "items", width: 48 },
            { header: "Days since", key: "since", width: 10 },
            { header: "Bought later (after 30 days)", key: "later", width: 14 },
            { header: "Days left", key: "left", width: 9 },
            { header: "Removed from lists", key: "removed", width: 10 },
            { header: "Outlet ID", key: "outlet", width: 14 },
          ],
          rows: [...none, ...pending].map((r) => ({
            status: r.group === "none" ? "Didn't buy within 30 days" : "Too soon to tell",
            name: r.c.name,
            city: r.c.city ?? "",
            prem: r.c.premise ?? "",
            date: r.c.date,
            items: r.c.items.length ? r.c.items.join("; ") : "Not written down",
            since: r.daysSince,
            later: r.laterBuy ?? "",
            left: r.daysLeft ?? "",
            removed: r.removed ? "Yes" : "",
            outlet: r.c.outlet_id,
          })),
        },
      ]);
    } finally {
      setBusy(false);
    }
  };

  const list = (title: string, sub: string, items: Row[]) => (
    <div className="mb-4">
      <div className="mb-1 flex items-baseline justify-between gap-2">
        <h3 className="text-[13px] font-semibold uppercase tracking-wide text-neutral-300">
          {title} <span className="font-mono text-neutral-500">({items.length})</span>
        </h3>
      </div>
      <p className="mb-1 text-[12px] text-neutral-500">{sub}</p>
      {items.length === 0 && <p className="py-2 text-sm text-neutral-500">None.</p>}
      {items.map((r, i) => (
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
          <span className="shrink-0 text-right text-[12px] leading-snug">
            <span className="block text-neutral-400">{r.daysSince} days ago</span>
            {r.group === "none" &&
              (r.laterBuy ? <span className="block text-[#9be07a]">Bought later, {fmt(r.laterBuy)}</span> : <span className="block text-[#ffab9c]">No order since</span>)}
            {r.group === "pending" && <span className="block text-[#facc15]">{r.daysLeft} days left</span>}
          </span>
        </div>
      ))}
    </div>
  );

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
          title="Commitments that didn't turn into an order"
          sub={`${rows.length} commitments at ${accounts} different accounts · ${none.length} didn't buy within 30 days (${boughtLater} bought later) · ${pending.length} too soon to tell · sales through ${fmt(data.as_of ?? today)}`}
          onClose={() => setOpen(false)}
          actions={rows.length > 0 ? <ExportButton onClick={doExport} busy={busy} /> : undefined}
        >
          <p className="mb-3 text-[12.5px] text-neutral-400">
            Committed accounts count once per account per week, so an account that committed in more than one week shows once for each week.
          </p>
          <div className="max-h-[62vh] overflow-y-auto pr-1">
            {list("Didn't buy within 30 days", "No Markstein sale to the account in the 30 days after it committed.", none)}
            {list("Too soon to tell", "Committed less than 30 days before the latest sales date and hasn't ordered yet — not counted for or against.", pending)}
          </div>
        </Modal>
      )}
    </>
  );
}
