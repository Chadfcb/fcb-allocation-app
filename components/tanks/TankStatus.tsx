"use client";

// Tanks page — Status section at the top (added 2026-10-23, per Chad):
// "actionable items as the first block, tanks that are in progress in the
// second block, and tanks that are ready for package, or are being packaged
// in the 3rd block".
//
// All from the Ekos tank sync (table ekos_tanks) — the same rows the 3D view
// draws. Clicking a row picks that tank in the 3D view (its details card with
// See Batch Details), scrolls the view into sight and glides the camera in
// close to that tank's label (2026-10-23 — tankScene focus()).
//
// - Action items: every overdue task on a tank's batch (not Completed, due
//   date before today, "Close Batch" never counts — same rule as the warning
//   signs), then tasks due today. Most overdue first.
// - In progress: full tanks Fermenting / Dry Hopping / Cold Crashing /
//   Carbonating (not ready, not being packaged).
// - Ready to package / Packaging: stage Ready For Packaging, or being packaged
//   (a "Package: …" task In-Progress or Completed while the tank still has
//   beer — ekos_tanks.packaging, sql/ekos_tanks_packaging.sql).

import NewBadge from "@/components/NewBadge";
import { useNewFeature } from "@/lib/newFeatures";

export interface StatusTank {
  tank_name: string;
  volume_bbl: number;
  product_name: string | null;
  product_code: string | null;
  batch_title: string | null;
  color: string | null;
  start_date: string | null;
  stage: string | null;
  temp_f: number | null;
  packaging?: boolean | null;
  tasks_left: { title: string; date: string | null; due?: string | null; status?: string; overdue: boolean }[];
}

type Pill = { bg: string; fg: string };

const CARD = "rounded-xl border border-neutral-800 bg-neutral-950 p-4";
const SCROLL = "flex max-h-[320px] flex-col gap-1.5 overflow-y-auto pr-1";
const ROW =
  "flex w-full flex-col gap-0.5 rounded-lg border border-white/[0.06] bg-white/[0.03] px-3 py-2 text-left hover:border-[rgba(143,209,110,0.35)] hover:bg-[rgba(106,188,70,0.08)]";

const isFull = (t: StatusTank) => t.volume_bbl > 0.05;
const CLOSE_BATCH = /^close\s+batch$/i;

// natural tank order: CID-1, CID-2, FV01, FV02 … FV16
const byTank = (a: StatusTank, b: StatusTank) => a.tank_name.localeCompare(b.tank_name, undefined, { numeric: true });

function daysBetween(from: string, to: string): number {
  const a = Date.UTC(+from.slice(0, 4), +from.slice(5, 7) - 1, +from.slice(8, 10));
  const b = Date.UTC(+to.slice(0, 4), +to.slice(5, 7) - 1, +to.slice(8, 10));
  return Math.round((b - a) / 86400000);
}

// "2026-10-20" → "10/20/26" (straight from the date string, no time-zone shift)
const md = (d: string) => `${+d.slice(5, 7)}/${+d.slice(8, 10)}/${d.slice(2, 4)}`;

const productOf = (t: StatusTank) => t.product_name || t.product_code || "Unknown product";

function Swatch({ color }: { color: string | null }) {
  return (
    <span
      className="h-2.5 w-2.5 flex-none rounded-[3px]"
      style={{ background: color || "#888", boxShadow: "0 0 0 1px rgba(255,255,255,0.15)" }}
    />
  );
}

function Tag({ text, pill }: { text: string; pill: Pill }) {
  return (
    <span
      className="flex-none rounded-full px-2 py-0.5 text-[10.5px] font-semibold uppercase tracking-wide"
      style={{ background: pill.bg, color: pill.fg }}
    >
      {text}
    </span>
  );
}

function Head({ title, count, sub }: { title: string; count: number; sub: string }) {
  return (
    <div className="mb-3">
      <div className="flex items-center gap-2">
        <h3 className="text-[15px] font-semibold">{title}</h3>
        <span className="rounded-full bg-white/[0.07] px-2 py-0.5 text-xs font-semibold tabular-nums text-neutral-300">{count}</span>
      </div>
      <p className="mt-0.5 text-xs text-neutral-400">{sub}</p>
    </div>
  );
}

const Empty = ({ text }: { text: string }) => <p className="py-3 text-sm text-neutral-500">{text}</p>;

const LATE: Pill = { bg: "rgba(255,90,60,0.22)", fg: "#FFB4A3" };
const TODAY: Pill = { bg: "rgba(255,153,0,0.18)", fg: "#FFC266" };
const PACKAGING: Pill = { bg: "rgba(51,153,255,0.18)", fg: "#8EC3FF" };

export default function TankStatus({
  tanks,
  today,
  pills,
  onPick,
}: {
  tanks: StatusTank[];
  today: string; // YYYY-MM-DD, brewery time
  pills: Record<string, Pill>;
  onPick: (tankName: string) => void;
}) {
  const isNew = useNewFeature("feature:tanks-status");
  const full = tanks.filter(isFull).sort(byTank);
  const pick = (name: string) => {
    isNew.dismiss();
    onPick(name);
  };

  // --- Block 1: action items -------------------------------------------------
  const actions: { tank: StatusTank; title: string; due: string | null; late: number }[] = [];
  for (const t of full) {
    for (const task of t.tasks_left) {
      if (CLOSE_BATCH.test(task.title.trim())) continue;
      if (task.status === "Completed") continue;
      const due = task.due ?? task.date;
      const late = task.overdue || (!!due && due < today);
      if (late) actions.push({ tank: t, title: task.title, due, late: due ? Math.max(1, daysBetween(due, today)) : 1 });
      else if (due === today) actions.push({ tank: t, title: task.title, due, late: 0 });
    }
  }
  actions.sort((a, b) => b.late - a.late || byTank(a.tank, b.tank));
  const overdueCount = actions.filter((a) => a.late > 0).length;

  // --- Block 2 / 3 -------------------------------------------------------------
  const ready = full.filter((t) => t.packaging || t.stage === "Ready For Packaging");
  const readySet = new Set(ready.map((t) => t.tank_name));
  const inProgress = full.filter((t) => !readySet.has(t.tank_name));
  // being packaged first, then ready
  ready.sort((a, b) => Number(!!b.packaging) - Number(!!a.packaging) || byTank(a, b));

  const days = (t: StatusTank) => (t.start_date ? `${daysBetween(t.start_date.slice(0, 10), today)} days in tank` : null);

  return (
    <section aria-label="Tank status" className="flex flex-col gap-3">
      <div className="flex items-center gap-2">
        <h2 className="text-lg font-semibold tracking-tight">Status</h2>
        {isNew.isNew && <NewBadge inline />}
        <span className="text-xs text-neutral-500">Click a row to find that tank below</span>
      </div>
      <div className="grid gap-4 lg:grid-cols-3">
        {/* Block 1 */}
        <div className={CARD}>
          <Head
            title="Action items"
            count={actions.length}
            sub={`${overdueCount} overdue · ${actions.length - overdueCount} due today`}
          />
          {actions.length === 0 ? (
            <Empty text="Nothing overdue or due today." />
          ) : (
            <div className={SCROLL}>
              {actions.map((a, i) => (
                <button key={`${a.tank.tank_name}-${i}`} type="button" className={ROW} onClick={() => pick(a.tank.tank_name)}>
                  <span className="flex items-center justify-between gap-2">
                    <span className="flex min-w-0 items-center gap-2 text-[13.5px] font-semibold">
                      <Swatch color={a.tank.color} />
                      <span className="truncate">
                        {a.tank.tank_name} · {productOf(a.tank)}
                      </span>
                    </span>
                    {a.late > 0 ? (
                      <Tag text={`${a.late} day${a.late === 1 ? "" : "s"} overdue`} pill={LATE} />
                    ) : (
                      <Tag text="Due today" pill={TODAY} />
                    )}
                  </span>
                  <span className="text-[13px] text-neutral-200">{a.title}</span>
                  {a.due && <span className="text-xs text-neutral-400">Due {md(a.due)}</span>}
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Block 2 */}
        <div className={CARD}>
          <Head title="In progress" count={inProgress.length} sub="Fermenting, dry hopping, cold crashing or carbonating" />
          {inProgress.length === 0 ? (
            <Empty text="No tanks in progress." />
          ) : (
            <div className={SCROLL}>
              {inProgress.map((t) => {
                const stage = t.stage || "Fermenting";
                return (
                  <button key={t.tank_name} type="button" className={ROW} onClick={() => pick(t.tank_name)}>
                    <span className="flex items-center justify-between gap-2">
                      <span className="flex min-w-0 items-center gap-2 text-[13.5px] font-semibold">
                        <Swatch color={t.color} />
                        <span className="truncate">
                          {t.tank_name} · {productOf(t)}
                        </span>
                      </span>
                      <Tag text={stage} pill={pills[stage] ?? pills.Fermenting} />
                    </span>
                    <span className="text-xs text-neutral-400">
                      {[t.batch_title ? `Batch ${t.batch_title}` : null, days(t), t.temp_f !== null ? `${Math.round(t.temp_f)}°F` : null]
                        .filter(Boolean)
                        .join(" · ")}
                    </span>
                  </button>
                );
              })}
            </div>
          )}
        </div>

        {/* Block 3 */}
        <div className={CARD}>
          <Head
            title="Ready to package / Packaging"
            count={ready.length}
            sub={`${ready.filter((t) => t.packaging).length} being packaged · ${ready.filter((t) => !t.packaging).length} ready`}
          />
          {ready.length === 0 ? (
            <Empty text="No tanks ready or being packaged." />
          ) : (
            <div className={SCROLL}>
              {ready.map((t) => (
                <button key={t.tank_name} type="button" className={ROW} onClick={() => pick(t.tank_name)}>
                  <span className="flex items-center justify-between gap-2">
                    <span className="flex min-w-0 items-center gap-2 text-[13.5px] font-semibold">
                      <Swatch color={t.color} />
                      <span className="truncate">
                        {t.tank_name} · {productOf(t)}
                      </span>
                    </span>
                    {t.packaging ? (
                      <Tag text="Packaging" pill={PACKAGING} />
                    ) : (
                      <Tag text="Ready" pill={pills["Ready For Packaging"] ?? PACKAGING} />
                    )}
                  </span>
                  <span className="text-xs text-neutral-400">
                    {[`${t.volume_bbl.toFixed(2)} bbl left`, t.batch_title ? `Batch ${t.batch_title}` : null, days(t)].filter(Boolean).join(" · ")}
                  </span>
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
    </section>
  );
}
