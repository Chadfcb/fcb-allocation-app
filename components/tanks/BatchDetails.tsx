"use client";

// Tanks → click a tank → "See Batch Details" (added 2026-10-05, per Chad —
// claude/batch-details-plan.md). Batch number, yield (bbl brewed), ABV, Batch
// Cost, and a button for each ingredient group that opens the items used with
// amounts and costs. Data: ekos_tanks.batch_details, filled by the automatic
// Ekos sync from Ekos's "Batch - Bill of Materials" report. Same look as the
// approved preview (v48).

import { useEffect, useRef, useState } from "react";

export interface BatchDetailsData {
  batch: string;
  yield_bbl: number | null;
  abv: number | null;
  costs_found: boolean;
  total: number;
  cats: { key: string; items: { name: string; qty: number; uom: string; cost: number }[] }[];
}

const CATS: Record<string, { name: string; color: string }> = {
  grain: { name: "Grain Bill", color: "#D9A441" },
  kettle: { name: "Boil Kettle / Whirlpool Hops", color: "#6ABC46" },
  dry: { name: "Dry Hops", color: "#3FA37A" },
  fruit: { name: "Fruit Additions", color: "#FFAE6B" },
  yeast: { name: "Yeast", color: "#C9B98A" },
};

const money = (v: number) => "$" + v.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const qty = (v: number) => v.toLocaleString("en-US", { maximumFractionDigits: 2 });

export default function BatchDetails({
  tank,
  product,
  color,
  details,
  onClose,
}: {
  tank: string;
  product: string;
  color: string;
  details: BatchDetailsData | null;
  onClose: () => void;
}) {
  const [open, setOpen] = useState<Record<string, boolean>>({});
  const closeRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    closeRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        onClose();
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [onClose]);

  return (
    <div
      className="absolute inset-0 z-10 flex items-center justify-center p-4"
      style={{ background: "rgba(4,7,6,0.55)", backdropFilter: "blur(3px)" }}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="bd-title"
        className="max-h-full w-[min(560px,100%)] overflow-y-auto rounded-2xl p-5"
        style={{
          background:
            "linear-gradient(155deg,rgba(106,188,70,0.14),rgba(106,188,70,0.03) 40%,rgba(255,255,255,0.01)),rgba(13,18,16,0.97)",
          border: "1px solid rgba(143,209,110,0.35)",
          boxShadow: "0 24px 60px rgba(0,0,0,0.55)",
        }}
      >
        <div className="flex items-start justify-between gap-3">
          <div>
            <b id="bd-title" className="flex items-center gap-2 text-xl tracking-tight">
              <span className="h-3 w-3 flex-none rounded" style={{ background: color, boxShadow: "0 0 0 1px rgba(255,255,255,0.15)" }} />
              {product}
            </b>
            <small className="ml-5 mt-0.5 block text-xs text-neutral-400">
              {tank} · Batch {details?.batch ?? "—"}
            </small>
          </div>
          <button
            ref={closeRef}
            type="button"
            aria-label="Close batch details"
            onClick={onClose}
            className="h-7 w-7 flex-none rounded-lg border border-white/10 bg-white/[0.03] text-sm text-neutral-400 hover:text-white"
          >
            ✕
          </button>
        </div>

        {!details ? (
          <p className="pb-1 pt-5 text-sm text-neutral-400">
            No batch details yet — they fill in on the next Ekos sync (Admin → Ekos Sync → Run now).
          </p>
        ) : (
          <>
            <div className="mb-3 mt-4 grid grid-cols-3 gap-2 max-sm:grid-cols-2">
              <Stat label="Batch Number" className="max-sm:col-span-2">
                {details.batch}
              </Stat>
              <Stat label="Yield">
                {details.yield_bbl === null ? "—" : details.yield_bbl.toFixed(2)}
                {details.yield_bbl !== null && <small className="ml-1 text-xs font-medium text-neutral-400">bbl brewed</small>}
              </Stat>
              <Stat label="ABV">
                {details.abv === null ? "—" : details.abv.toFixed(2)}
                {details.abv !== null && <small className="ml-1 text-xs font-medium text-neutral-400">%</small>}
              </Stat>
            </div>

            {!details.costs_found ? (
              <p className="rounded-xl border border-white/10 bg-white/[0.04] px-3.5 py-3 text-sm text-neutral-400">
                This batch isn&apos;t in Ekos&apos;s &ldquo;Batch - Bill of Materials&rdquo; report yet, so there are no costs to show.
              </p>
            ) : (
              <>
                <div
                  className="mb-2.5 flex items-baseline justify-between rounded-xl px-3.5 py-3"
                  style={{
                    background: "linear-gradient(90deg,rgba(106,188,70,0.22),rgba(106,188,70,0.06))",
                    boxShadow: "inset 0 0 0 1px rgba(106,188,70,0.35)",
                  }}
                >
                  <span className="text-[13px] font-semibold uppercase tracking-wider" style={{ color: "#CDEFBD" }}>
                    Batch Cost
                  </span>
                  <b className="font-mono text-2xl text-white">{money(details.total)}</b>
                </div>
                <div className="flex flex-col gap-1.5">
                  {details.cats.map((c) => {
                    const meta = CATS[c.key] ?? { name: c.key, color: "#888" };
                    const sum = c.items.reduce((a, i) => a + i.cost, 0);
                    const isOpen = !!open[c.key];
                    return (
                      <div key={c.key}>
                        <button
                          type="button"
                          aria-expanded={isOpen}
                          onClick={() => setOpen((o) => ({ ...o, [c.key]: !o[c.key] }))}
                          className="flex w-full items-center gap-2.5 rounded-xl border px-3.5 py-2.5 text-left text-sm font-semibold text-neutral-100 transition-colors hover:border-[rgba(143,209,110,0.3)] hover:bg-[rgba(106,188,70,0.10)]"
                          style={
                            isOpen
                              ? { background: "rgba(106,188,70,0.12)", borderColor: "rgba(143,209,110,0.40)" }
                              : { background: "rgba(255,255,255,0.04)", borderColor: "rgba(255,255,255,0.08)" }
                          }
                        >
                          <i className="h-2.5 w-2.5 flex-none rounded-[3px]" style={{ background: meta.color }} />
                          <span className="flex-1">{meta.name}</span>
                          <span className="font-mono">{money(sum)}</span>
                          <span className="text-neutral-400 transition-transform" style={{ transform: isOpen ? "rotate(90deg)" : "none" }}>
                            ›
                          </span>
                        </button>
                        {isOpen && (
                          <div className="mb-1.5 mt-0.5 rounded-xl border border-white/5 bg-black/20 px-3.5 py-1">
                            {c.items.length === 0 ? (
                              <div className="py-2.5 text-[13px] text-neutral-500">None used in this batch.</div>
                            ) : (
                              c.items.map((i, k) => (
                                <div
                                  key={i.name + k}
                                  className={`grid grid-cols-[1fr_auto_auto] items-baseline gap-x-4 py-2 text-[13px] ${k ? "border-t border-white/[0.06]" : ""}`}
                                >
                                  <span>{i.name}</span>
                                  <span className="whitespace-nowrap font-mono text-neutral-400">
                                    {qty(i.qty)} {i.uom}
                                  </span>
                                  <span className="min-w-[72px] whitespace-nowrap text-right font-mono">{money(i.cost)}</span>
                                  {i.qty > 0 && (
                                    <span className="col-span-3 -mt-0.5 text-[11px] text-neutral-500">
                                      {money(i.cost / i.qty)}
                                      {i.uom === "each" ? " each" : ` per ${i.uom}`}
                                    </span>
                                  )}
                                </div>
                              ))
                            )}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
                <p className="mt-3 text-[11.5px] leading-snug text-neutral-500">
                  Costs from Ekos (Batch - Bill of Materials). Packaging, lactic acid and other left-out items aren&apos;t included.
                </p>
              </>
            )}
          </>
        )}
      </div>
    </div>
  );
}

function Stat({ label, children, className = "" }: { label: string; children: React.ReactNode; className?: string }) {
  return (
    <div className={`rounded-xl border border-white/[0.07] bg-white/[0.04] px-3 py-2.5 ${className}`}>
      <span className="block text-[11px] font-semibold uppercase tracking-widest text-neutral-400">{label}</span>
      <b className="mt-1 block font-mono text-lg">{children}</b>
    </div>
  );
}
