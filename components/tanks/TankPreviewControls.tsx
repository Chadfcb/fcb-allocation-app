"use client";

// Tanks → "Preview controls" under the 3D view (added 2026-10-05, per Chad: "i want
// the same preview controls in the app, for example, if there is an empty tank, i
// want the preview controls for it so i can show it to people"). Admins only.
// Changes are ONLY on this screen: nothing is saved, Ekos is never touched, and
// refreshing the page or "Reset to Ekos data" puts the real data back. While
// anything is changed, the 3D view shows a "Demo — not real data" tag (Chad's pick).
// Same controls as the approved preview (v50+): Tank, Liquid level, Status, Temp °F,
// Yeast in cone, Overdue warning, Reset.

import { useState } from "react";
import type { LiveTank } from "@/components/TanksClient";

const STAGES = ["Fermenting", "Dry Hopping", "Cold Crashing", "Carbonating", "Ready For Packaging"];

const field =
  "h-[34px] rounded-full border border-white/10 bg-white/[0.04] px-3 text-[13px] font-medium text-neutral-100 disabled:opacity-40";

export default function TankPreviewControls({
  data,
  tank,
  capacity,
  changed,
  onTank,
  onChange,
  onReset,
}: {
  data: LiveTank[];
  tank: string;
  capacity: number;
  changed: boolean;
  onTank: (name: string) => void;
  onChange: (name: string, change: (r: LiveTank) => void) => void;
  onReset: () => void;
}) {
  const names = data
    .map((r) => r.tank_name)
    .filter((n) => /^(FV|CID-)\d+$/i.test(n))
    .sort((a, b) => a.localeCompare(b, "en", { numeric: true }));
  const r = data.find((x) => x.tank_name === tank);
  const vol = r?.volume_bbl ?? 0;
  const full = vol > 0.05;
  // slider position while dragging (applied when let go)
  const [draft, setDraft] = useState<{ tank: string; v: number } | null>(null);
  const shown = draft && draft.tank === tank ? draft.v : vol;
  const commit = () => {
    if (!draft || draft.tank !== tank) return;
    const v = draft.v;
    setDraft(null);
    onChange(tank, (x) => void (x.volume_bbl = v));
  };

  return (
    <section
      aria-label="Preview controls"
      className="flex flex-wrap items-end gap-x-7 gap-y-4 rounded-xl border border-neutral-800 px-[18px] py-4"
    >
      <div className="basis-full text-xs font-semibold uppercase tracking-[0.12em] text-neutral-400">
        Preview controls
        <span className="ml-1.5 font-normal normal-case tracking-normal text-neutral-500">
          Admins only. For showing people — only changes your screen, nothing is saved, Ekos isn&apos;t touched.
        </span>
      </div>

      <label className="flex flex-col gap-2 text-[12.5px] text-neutral-400">
        Tank
        <select className={field} value={tank} onChange={(e) => onTank(e.target.value)}>
          {names.map((n) => (
            <option key={n} value={n}>
              {n}
            </option>
          ))}
        </select>
      </label>

      <label className="flex min-w-0 flex-[1_1_260px] flex-col gap-2 text-[12.5px] text-neutral-400">
        <span>
          Liquid level: <span className="font-mono text-neutral-200">{shown.toFixed(1)} bbl</span>
        </span>
        <input
          type="range"
          min={0}
          max={capacity}
          step={0.1}
          value={shown}
          className="w-full accent-[#6ABC46]"
          onChange={(e) => setDraft({ tank, v: Number(e.target.value) })}
          onPointerUp={commit}
          onKeyUp={commit}
          onBlur={commit}
        />
      </label>

      <label className="flex flex-col gap-2 text-[12.5px] text-neutral-400">
        Status
        <select
          className={field}
          disabled={!full}
          value={r?.stage ?? "Fermenting"}
          onChange={(e) => {
            const stage = e.target.value;
            onChange(tank, (x) => {
              x.stage = stage;
              if (stage !== "Fermenting" && stage !== "Dry Hopping") x.yeast_in_cone = false;
              if (["Cold Crashing", "Carbonating", "Ready For Packaging"].includes(stage)) x.temp_f = 32;
            });
          }}
        >
          {STAGES.map((s) => (
            <option key={s}>{s}</option>
          ))}
        </select>
      </label>

      <label className="flex flex-col gap-2 text-[12.5px] text-neutral-400">
        Temp °F
        <input
          type="number"
          min={20}
          max={110}
          step={1}
          disabled={!full}
          key={`${tank}-${r?.temp_f ?? ""}`}
          defaultValue={r?.temp_f ?? ""}
          className={`${field} w-[90px]`}
          onBlur={(e) => {
            const v = e.target.value;
            onChange(tank, (x) => void (x.temp_f = v === "" ? null : Number(v)));
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter") (e.target as HTMLInputElement).blur();
          }}
        />
      </label>

      <div className="flex flex-col gap-2 text-[12.5px] text-neutral-400">
        Options
        <div className="flex h-[34px] items-center gap-4 text-[13px] text-neutral-100">
          <label className={`flex items-center gap-1.5 ${full ? "" : "opacity-40"}`}>
            <input
              type="checkbox"
              className="accent-[#6ABC46]"
              disabled={!full}
              checked={!!r?.yeast_in_cone}
              onChange={(e) => {
                const on = e.target.checked;
                onChange(tank, (x) => void (x.yeast_in_cone = on));
              }}
            />
            Yeast in cone
          </label>
          <label className={`flex items-center gap-1.5 ${full ? "" : "opacity-40"}`}>
            <input
              type="checkbox"
              className="accent-[#6ABC46]"
              disabled={!full}
              checked={!!r?.overdue}
              onChange={(e) => {
                const on = e.target.checked;
                onChange(tank, (x) => {
                  x.overdue = on;
                  if (on && !x.tasks_left.some((t) => t.overdue)) {
                    x.tasks_left = [{ date: new Date().toISOString().slice(0, 10), title: "Sample overdue task", overdue: true }, ...x.tasks_left];
                  }
                });
              }}
            />
            Overdue warning
          </label>
        </div>
      </div>

      <div className="flex flex-col gap-2 text-[12.5px] text-neutral-400">
        &nbsp;
        <button
          type="button"
          disabled={!changed}
          onClick={onReset}
          className="h-[34px] rounded-full border border-white/10 bg-white/[0.03] px-4 text-[13px] font-medium text-neutral-200 hover:text-white disabled:opacity-40"
        >
          Reset to Ekos data
        </button>
      </div>
    </section>
  );
}
