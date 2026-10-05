"use client";

// Tanks (added 2026-10-03, per Chad) — a 3D "x-ray" view of every FCB
// unitank, in the real cellar layout, at true size. Design notes and every
// decision: claude/tank-view-direction.md and claude/tank-floor-layout.md
// (project docs). Approved preview: "FCB Tanks Preview" artifact (v40).
//
// The 3D scene lives in components/tanks/tankScene.js (the preview's code,
// ported 2026-10-05): x-ray glass full tanks, polished stainless empty tanks
// under overhead lights, standard beer looks (clear / hazy / cider /
// Prohibition), label plate with status at the cone seam, temperature scale +
// 45° current-temp pill, stage visuals (yeast in cone, dry hop, cold crash,
// carbonating) and the 1.5 s hover snapshot (FV16 sample batch for now).
// Also the walking guy (2026-10-05): wanders and looks at tanks; click him →
// "Take control" → first person (mouse look, W A S D, left Shift run, Space
// jump, Esc exits). This file mounts it and draws the click details card.
//
// DATA: until the Ekos tank sync is built, levels are the Ekos tank map
// snapshot (Oct 3); statuses, temps, days and tasks are samples.

import { useEffect, useRef, useState } from "react";
import { createTankScene, type TankScene } from "./tanks/tankScene.js";

// One tank from the Ekos tank sync (table ekos_tanks, sql/ekos_tanks.sql).
export interface LiveTank {
  tank_name: string;
  volume_bbl: number;
  product_code: string | null;
  batch_title: string | null;
  product_name: string | null;
  color: string | null;
  start_date: string | null;
  stage: string | null;
  yeast_in_cone: boolean;
  dry_hop: boolean;
  temp_f: number | null;
  temp_at: string | null;
  overdue: boolean;
  tasks_left: { title: string; date: string | null; overdue: boolean }[];
  synced_at: string;
}

interface TankInfo {
  name: string;
  capacity: number;
  volume: number;
  status: string;
  product: string;
  batch: string;
  color: string;
}

// Tanks beta build number: v1.xx, xx = main Tanks changes so far, preview + site
// (Chad, 2026-10-05: count every main change, not just pushes). Full list of the
// first 25 in the project doc claude/tank-view-direction.md. Add 1 per main change.
const TANKS_BUILD = "1.29";   // 26 walking guy + take control, 27 Shift run + Space jump, 28 overdue warning signs, 29 Ekos tank sync

const STATUS_PILL: Record<string, { bg: string; fg: string }> = {
  Fermenting: { bg: "rgba(255,153,0,0.18)", fg: "#FFC266" },
  "Dry Hopping": { bg: "rgba(200,230,80,0.18)", fg: "#DCEB7A" },
  "Cold Crashing": { bg: "rgba(51,153,255,0.18)", fg: "#8EC3FF" },
  Carbonating: { bg: "rgba(170,130,255,0.20)", fg: "#CDB4FF" },
  "Ready For Packaging": { bg: "rgba(106,188,70,0.30)", fg: "#CDEFBD" },
  Conditioning: { bg: "rgba(51,153,255,0.16)", fg: "#8EC3FF" },
  Empty: { bg: "rgba(255,255,255,0.07)", fg: "#A3ADA8" },
};

// Hover snapshot styles (same look as the approved preview)
const SNAP_CSS = `
.tk-snap{position:absolute;left:0;top:0;width:300px;z-index:3;pointer-events:auto;opacity:0;visibility:hidden;
  transition:opacity .35s ease, visibility 0s linear .35s;border-radius:18px;padding:16px 16px 12px;color:#E8EDEA;
  background:linear-gradient(155deg,rgba(106,188,70,0.16),rgba(106,188,70,0.04) 45%,rgba(255,255,255,0.03)),rgba(10,15,13,0.48);
  border:1px solid rgba(143,209,110,0.35);backdrop-filter:blur(10px) saturate(1.2);-webkit-backdrop-filter:blur(10px) saturate(1.2);
  box-shadow:0 18px 50px rgba(0,0,0,0.45),inset 0 1px 0 rgba(255,255,255,0.10),0 0 30px rgba(106,188,70,0.12)}
.tk-snap.show{opacity:1;visibility:visible;transition:opacity .35s ease, visibility 0s}
.tk-snap::after{content:"";position:absolute;left:var(--tip,50%);bottom:-9px;width:16px;height:16px;transform:translateX(-50%) rotate(45deg);
  background:rgba(10,15,13,0.55);border-right:1px solid rgba(143,209,110,0.35);border-bottom:1px solid rgba(143,209,110,0.35)}
.tk-snap.below::after{bottom:auto;top:-9px;transform:translateX(-50%) rotate(225deg)}
.tk-snap.side::after{display:none}
.tk-swatch{width:12px;height:12px;border-radius:4px;flex:none;box-shadow:0 0 0 1px rgba(255,255,255,0.15)}
.tk-num{font-family:ui-monospace,"SFMono-Regular",Consolas,monospace;font-variant-numeric:tabular-nums}
.tk-snap-prod{display:flex;align-items:center;gap:9px;font-size:17px;font-weight:700;letter-spacing:-0.01em;line-height:1.2}
.tk-snap-tank{font-size:11.5px;color:#A3ADA8;margin:3px 0 10px 21px}
.tk-snap-row{display:flex;justify-content:space-between;align-items:center;gap:10px;padding:7px 0;border-top:1px solid rgba(255,255,255,0.07);font-size:13.5px}
.tk-snap-row span:first-child{color:#A3ADA8}
.tk-snap-pill{display:inline-block;padding:3px 11px;border-radius:999px;font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:0.05em}
.tk-tasks-h{display:flex;justify-content:space-between;margin:10px 0 6px;font-size:11px;font-weight:600;color:#A3ADA8;text-transform:uppercase;letter-spacing:0.12em}
.tk-tasks{max-height:150px;overflow-y:auto;padding-right:4px;display:flex;flex-direction:column;gap:6px;scrollbar-width:thin;scrollbar-color:rgba(143,209,110,0.45) transparent}
.tk-tasks::-webkit-scrollbar{width:6px}.tk-tasks::-webkit-scrollbar-thumb{background:rgba(143,209,110,0.45);border-radius:6px}
.tk-task{display:grid;grid-template-columns:auto 1fr;gap:4px 10px;align-items:start;padding:8px 10px;border-radius:12px;background:rgba(255,255,255,0.04);border:1px solid rgba(255,255,255,0.06)}
.tk-task .d{font-family:ui-monospace,"SFMono-Regular",Consolas,monospace;font-size:11px;color:#8FD16E;padding-top:1px;white-space:nowrap}
.tk-task .n{font-size:13px;line-height:1.35}
.tk-task.next{border-color:rgba(143,209,110,0.35);background:rgba(106,188,70,0.10)}
.tk-task.late{border-color:rgba(255,120,90,0.45);background:rgba(255,90,60,0.10)}
.tk-task .late-tag{margin-left:6px;padding:1px 6px;border-radius:999px;font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:0.04em;color:#FFB4A3;background:rgba(255,90,60,0.22)}
.tk-all-done{display:flex;align-items:center;gap:10px;margin-top:10px;padding:12px;border-radius:12px;background:rgba(106,188,70,0.14);border:1px solid rgba(106,188,70,0.35);font-weight:600;font-size:14px;color:#CDEFBD}
@media (prefers-reduced-motion: reduce){.tk-snap,.tk-snap.show{transition:none}}
.tk-guy-card{position:absolute;left:0;top:0;width:230px;z-index:4;padding:14px;border-radius:16px;color:#E8EDEA;
  background:linear-gradient(155deg,rgba(106,188,70,0.16),rgba(106,188,70,0.04) 45%,rgba(255,255,255,0.03)),rgba(10,15,13,0.82);
  border:1px solid rgba(143,209,110,0.35);backdrop-filter:blur(10px);box-shadow:0 18px 50px rgba(0,0,0,0.45)}
.tk-guy-card[hidden],.tk-fp-hud[hidden]{display:none}
.tk-guy-card .gh{display:flex;justify-content:space-between;align-items:center;font-weight:700;font-size:15px}
.tk-guy-card p{margin:6px 0 12px;font-size:12.5px;color:#A3ADA8;line-height:1.4}
.tk-x{width:28px;height:28px;border-radius:9px;border:1px solid rgba(255,255,255,0.08);background:rgba(255,255,255,0.03);color:#A3ADA8;cursor:pointer;font-size:14px}
.tk-guy-card .take{width:100%;height:38px;border-radius:999px;border:0;cursor:pointer;font-weight:600;font-size:13.5px;color:#F2F7F0;
  background:linear-gradient(90deg,rgba(106,188,70,0.32),rgba(106,188,70,0.10));box-shadow:inset 0 0 0 1px rgba(106,188,70,0.45),0 0 24px rgba(106,188,70,0.18)}
.tk-guy-card .take:hover{background:linear-gradient(90deg,rgba(106,188,70,0.42),rgba(106,188,70,0.16))}
.tk-fp-hud .xh{position:absolute;left:50%;top:50%;width:14px;height:14px;transform:translate(-50%,-50%);pointer-events:none}
.tk-fp-hud .xh::before,.tk-fp-hud .xh::after{content:"";position:absolute;background:rgba(255,255,255,0.75);border-radius:2px}
.tk-fp-hud .xh::before{left:6px;top:0;width:2px;height:14px}.tk-fp-hud .xh::after{top:6px;left:0;height:2px;width:14px}
.tk-fp-hud .note{position:absolute;top:14px;left:50%;transform:translateX(-50%);padding:8px 16px;border-radius:999px;font-size:13px;font-weight:600;
  color:#F2F7F0;background:rgba(8,11,10,0.72);border:1px solid rgba(143,209,110,0.35);pointer-events:none;white-space:nowrap}
.tk-fp-hud .note b{color:#8FD16E}
`;

export default function TanksClient({ live = [], syncedLabel = null }: { live?: LiveTank[]; syncedLabel?: string | null }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const snapRef = useRef<HTMLDivElement>(null);
  const sceneRef = useRef<TankScene | null>(null);
  const [selected, setSelected] = useState<TankInfo | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    const canvas = canvasRef.current;
    const snapEl = snapRef.current;
    if (!canvas || !snapEl) return;
    try {
      sceneRef.current = createTankScene({
        canvas,
        snapEl,
        onSelect: (info: TankInfo | null) => setSelected(info),
        font: getComputedStyle(canvas).fontFamily || "system-ui, sans-serif",
        live,
      });
    } catch {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- one-time fallback when the browser can't start WebGL
      setFailed(true);
      return;
    }
    return () => {
      sceneRef.current?.dispose();
      sceneRef.current = null;
    };
  }, [live]);

  const full = !!selected && selected.volume > 0.05;
  const pct = selected ? Math.round((selected.volume / selected.capacity) * 100) : 0;
  const pill = (selected && STATUS_PILL[selected.status]) || STATUS_PILL.Empty;

  return (
    <div className="flex flex-col gap-5">
      <style>{SNAP_CSS}</style>
      <div>
        {/* Beta build label (Chad, 2026-10-05): same look as the active sidebar link.
            Bump the number with each main Tanks change pushed to the site. */}
        <span className="fcb-nav-item is-active mb-3" style={{ display: "inline-flex", width: "auto" }}>Beta Test Build v{TANKS_BUILD}</span>
        <h1 className="text-3xl font-semibold tracking-tight">Tanks</h1>
        <p className="mt-1 text-sm text-neutral-400">
          {syncedLabel
            ? `21 unitanks at true size, in the cellar layout. Synced from Ekos ${syncedLabel}. Temperatures are each batch's latest Fermentation Log.`
            : "21 unitanks at true size, in the cellar layout. Levels from the Ekos tank map (Oct 3); status, temps and tasks are samples until the first Ekos tank sync runs."}
        </p>
      </div>

      <section
        aria-label="3D tank view"
        className="relative overflow-hidden rounded-xl border border-neutral-800"
        style={{ height: "clamp(440px, 70vh, 780px)" }}
      >
        <canvas
          ref={canvasRef}
          tabIndex={0}
          aria-label="3D view of the FCB cellar's 21 fermenters. Drag to turn, right-click drag to slide, scroll to zoom, click a tank for details."
          className="absolute inset-0 block h-full w-full outline-none"
          style={{ touchAction: "none" }}
          onContextMenu={(e) => e.preventDefault()}
        />
        {failed && (
          <div className="absolute inset-0 flex items-center justify-center text-sm text-neutral-400">
            This browser couldn&apos;t start the 3D view.
          </div>
        )}
        {/* Hover snapshot: filled + positioned by the 3D scene (shows after 1.5 s on a tank) */}
        <div ref={snapRef} className="tk-snap" role="tooltip" aria-hidden="true" />
        <div className="pointer-events-none absolute bottom-3 left-3.5 rounded-full bg-black/60 px-2.5 py-1 text-xs text-neutral-300">
          Drag to turn · Right-click drag to slide · Scroll to zoom · Click a tank
        </div>

        {selected && (
          <aside
            aria-live="polite"
            className="absolute right-4 top-4 w-[280px] max-w-[calc(100%-32px)] rounded-xl border border-neutral-700 bg-neutral-950 p-4 shadow-2xl max-sm:bottom-12 max-sm:left-3 max-sm:right-3 max-sm:top-auto max-sm:w-auto"
          >
            <div className="flex items-start justify-between gap-2.5">
              <div>
                <b className="text-xl tracking-tight">{selected.name}</b>
                <small className="mt-0.5 block text-xs text-neutral-400">{selected.capacity} bbl unitank · fermenter</small>
              </div>
              <button
                type="button"
                aria-label="Close tank details"
                onClick={() => sceneRef.current?.select(null)}
                className="h-7 w-7 rounded-lg border border-white/10 bg-white/[0.03] text-sm text-neutral-400 hover:text-white"
              >
                ✕
              </button>
            </div>
            <div className="mb-2.5 mt-3.5 flex items-center gap-2 text-[15px] font-semibold">
              <span
                className="h-3 w-3 flex-none rounded"
                style={{ background: full ? selected.color : "transparent", boxShadow: "0 0 0 1px rgba(255,255,255,0.15)" }}
              />
              {full ? selected.product : "Empty"}
            </div>
            <div className="h-2 overflow-hidden rounded-full bg-white/[0.06]">
              <i className="block h-full rounded-full" style={{ width: `${pct}%`, background: selected.color }} />
            </div>
            <div className="mb-2.5 mt-1.5 flex justify-between text-[12.5px] text-neutral-400 tabular-nums">
              <span>
                {selected.volume.toFixed(2)} of {selected.capacity} bbl
              </span>
              <span>{pct}%</span>
            </div>
            <div className="flex flex-col">
              <div className="flex justify-between gap-3 border-t border-white/5 py-2 text-[13.5px]">
                <span className="text-neutral-400">Status</span>
                <span
                  className="inline-block rounded-full px-2.5 py-0.5 text-[11px] font-semibold uppercase tracking-wide"
                  style={{ background: pill.bg, color: pill.fg }}
                >
                  {selected.status}
                </span>
              </div>
              <div className="flex justify-between gap-3 border-t border-white/5 py-2 text-[13.5px]">
                <span className="text-neutral-400">Batch</span>
                <span>{full ? selected.batch : "—"}</span>
              </div>
            </div>
            {full && (
              <button
                type="button"
                className="mt-3 h-[38px] w-full rounded-full text-[13.5px] font-semibold"
                style={{
                  color: "#F2F7F0",
                  background: "linear-gradient(90deg, var(--hl-strong, rgba(106,188,70,0.20)), var(--hl-soft, rgba(106,188,70,0.06)))",
                  boxShadow: "inset 0 0 0 1px var(--hl-line, rgba(106,188,70,0.30)), 0 0 24px var(--hl-glow, rgba(106,188,70,0.12))",
                }}
                // Placeholder (Chad, 2026-10-03): will open a popup with all
                // the batch's tasks. Does nothing yet.
              >
                See Batch Details
              </button>
            )}
          </aside>
        )}
      </section>
    </div>
  );
}
