"use client";

// "Par levels" button next to Export in each "On Hand at <distributor>" block
// (2026-11-09, per Chad: "on all distributor pages, in the stock block, next to
// the export button, please add a par level button"). Opens a read-only pop-up:
// every product with a par for that distributor, its latest on-hand count and
// how far short of par it is, plus Export. Pars are still edited on
// Operations → Build Orders. Data: sales_territory_pars(p_dist)
// (sql/distributor_par_levels_view.sql).

import { useCallback, useEffect, useState } from "react";
import type { Supa } from "@/components/SalesDashboardClient";
import { MUTED, ExportButton, Modal, exportSheets } from "@/components/SalesDashboardHome";
import NewBadge from "@/components/NewBadge";
import { useNewFeature } from "@/lib/newFeatures";

type ParRow = { product: string; par: number; on_hand: number | null };

const slugOf = (dist: string) => dist.toLowerCase().trim().replace(/\s+/g, "-");
const fmt = (n: number) => n.toLocaleString("en-US", { maximumFractionDigits: 1 });
const shortOf = (r: ParRow) => Math.max(Number(r.par) - Number(r.on_hand ?? 0), 0);

export default function ParLevelsButton({ supabase, dist, stockLine }: { supabase: Supa; dist: string; stockLine?: string }) {
  const [open, setOpen] = useState(false);
  const [rows, setRows] = useState<ParRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const isNew = useNewFeature(`feature:dist-par-levels-${slugOf(dist)}`);

  const load = useCallback(async () => {
    setError(null);
    const { data, error: e } = await supabase.rpc("sales_territory_pars", { p_dist: dist });
    if (e) {
      setError(e.message);
      setRows([]);
    } else {
      setRows((data as ParRow[]) ?? []);
    }
  }, [supabase, dist]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (open) load();
  }, [open, load]);

  const totalPar = (rows ?? []).reduce((s, r) => s + Number(r.par), 0);
  const totalOn = (rows ?? []).reduce((s, r) => s + Number(r.on_hand ?? 0), 0);
  const totalShort = (rows ?? []).reduce((s, r) => s + shortOf(r), 0);
  const under = (rows ?? []).filter((r) => shortOf(r) > 0).length;

  const doExport = async () => {
    setBusy(true);
    try {
      await exportSheets(`${dist} - par levels.xlsx`, [
        {
          name: "Par levels",
          title: `${dist} par levels${stockLine ? ` — on hand ${stockLine}` : ""}`,
          cols: [
            { header: "Product", key: "product", width: 48 },
            { header: "Par level", key: "par" },
            { header: "On hand", key: "on_hand" },
            { header: "Short of par", key: "short" },
          ],
          rows: [
            ...(rows ?? []).map((r) => ({ product: r.product, par: Number(r.par), on_hand: r.on_hand ?? "", short: shortOf(r) })),
            { product: "Total", par: totalPar, on_hand: totalOn, short: totalShort },
          ],
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
        className="inline-flex min-h-8 items-center gap-1.5 rounded-full border border-neutral-700 px-3 text-xs font-semibold text-neutral-300 hover:border-[#6abc46]/40 hover:text-neutral-100"
      >
        Par levels
        {isNew.isNew && <NewBadge inline />}
      </button>
      {open && (
        <Modal
          title={`${dist} Par Levels`}
          sub={`Target stock per product (set on Operations → Build Orders)${stockLine ? ` · On hand: ${stockLine}` : ""}`}
          onClose={() => setOpen(false)}
          actions={rows && rows.length > 0 ? <ExportButton onClick={doExport} busy={busy} /> : undefined}
        >
          {rows === null ? (
            <p className={`py-4 text-sm ${MUTED}`}>Loading…</p>
          ) : error ? (
            <p className="py-4 text-sm text-[#ffab9c]">{error}</p>
          ) : rows.length === 0 ? (
            <p className={`py-4 text-sm ${MUTED}`}>No par levels set for {dist} yet. They&apos;re set on Operations → Build Orders.</p>
          ) : (
            <div className="flex flex-col gap-3">
              <p className={`text-[12.5px] ${MUTED}`}>
                {rows.length} products · {under ? `${under} under par` : "all at or above par"}
              </p>
              <div className="grid grid-cols-[minmax(0,1fr)_auto_auto_auto] gap-x-5 gap-y-1.5 text-[13px]">
                <span className="text-[11px] text-neutral-500">Product</span>
                <span className="text-right text-[11px] text-neutral-500">Par level</span>
                <span className="text-right text-[11px] text-neutral-500">On hand</span>
                <span className="text-right text-[11px] text-neutral-500">Short</span>
                {rows.map((r) => {
                  const s = shortOf(r);
                  return (
                    <div key={r.product} className="col-span-4 grid grid-cols-subgrid">
                      <span className={`min-w-0 truncate ${s > 0 ? "text-[#ffab9c]" : "text-neutral-200"}`}>{r.product}</span>
                      <span className="text-right font-mono">{fmt(Number(r.par))}</span>
                      <span className="text-right font-mono text-neutral-400">{r.on_hand === null ? "—" : fmt(Number(r.on_hand))}</span>
                      <span className={`text-right font-mono ${s > 0 ? "text-[#ffab9c]" : "text-neutral-500"}`}>{s > 0 ? fmt(s) : "—"}</span>
                    </div>
                  );
                })}
                <div className="col-span-4 grid grid-cols-subgrid border-t border-neutral-800 pt-1.5 font-semibold">
                  <span className="text-neutral-100">Total</span>
                  <span className="text-right font-mono">{fmt(totalPar)}</span>
                  <span className="text-right font-mono text-neutral-300">{fmt(totalOn)}</span>
                  <span className={`text-right font-mono ${totalShort > 0 ? "text-[#ffab9c]" : "text-neutral-500"}`}>{totalShort > 0 ? fmt(totalShort) : "—"}</span>
                </div>
              </div>
            </div>
          )}
        </Modal>
      )}
    </>
  );
}
