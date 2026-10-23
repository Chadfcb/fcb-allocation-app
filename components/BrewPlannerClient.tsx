"use client";

import { Fragment, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { logChange } from "@/lib/audit";
import {
  BASES,
  DEFAULT_SETTINGS,
  addDays,
  fmtDay,
  plan,
  r1,
  type Commitment,
  type Plan,
  type PlannerData,
  type Settings,
} from "@/lib/brewPlanner";

// Brew Planner page (2026-10-23, per Chad — EXPERIMENTAL). Same layout as the
// approved preview: summary → base-beer table (click a row for why, a 10-week
// chart, brand split, distributors, tanks) → Needs a look + Settings side by
// side. Settings are saved in this browser only (localStorage) for now.

const STORE = "fcb-brew-planner-settings";
const CARD = "rounded-xl border border-neutral-800 bg-neutral-950";
const PILL_BREW = "rounded-full bg-[#6ABC46] px-2.5 py-0.5 text-xs font-semibold text-black";
const PILL_HOLD = "rounded-full border border-neutral-700 px-2.5 py-0.5 text-xs font-semibold text-neutral-400";

function coverClass(w: number | null) {
  if (w === null) return "text-neutral-500";
  if (w < 2) return "bg-red-500/15 text-red-300";
  if (w < 4) return "bg-amber-500/15 text-amber-300";
  return "bg-[#6ABC46]/15 text-[#8fd46b]";
}
const Cover = ({ w }: { w: number | null }) => (
  <span className={`inline-block min-w-[44px] rounded-md px-1.5 text-center font-semibold tabular-nums ${coverClass(w)}`}>{w === null ? "–" : r1(w)}</span>
);

function mangoLine(p: Plan): string | null {
  const m = p.brands.find((b) => b.pullOff);
  if (!m || p.rec.action !== "Brew") return null;
  return `pull ~${r1(m.fromBatch)} bbl for ${m.name}`;
}

function Chart({ p, S }: { p: Plan; S: Settings }) {
  const W = 520, H = 150, pl = 34, pr = 8, pt = 12, pb = 22;
  const vals = [p.dstock + p.wh, ...p.proj.map((x) => x.stock)];
  const max = Math.max(1, ...vals);
  const min = Math.min(0, ...vals);
  const slot = (W - pl - pr) / 11;
  const x = (i: number) => pl + i * slot + slot / 2;
  const yv = (v: number) => pt + ((max - v) * (H - pt - pb)) / (max - min);
  const step = Math.max(1, Math.ceil((max - min) / 4 / 5) * 5);
  const grid: number[] = [];
  for (let v = Math.ceil(min / step) * step; v <= max; v += step) grid.push(v);
  const target = p.demand * S.targetWeeks;
  const bw = slot * 0.62;
  return (
    <div>
      <svg viewBox={`0 0 ${W} ${H}`} width="100%" role="img" aria-label="bbl outside the tanks, next 10 weeks" className="text-neutral-500">
        {grid.map((v) => (
          <g key={v}>
            <line x1={pl} x2={W - pr} y1={yv(v)} y2={yv(v)} stroke="currentColor" strokeOpacity={0.2} />
            <text x={pl - 5} y={yv(v) + 3} textAnchor="end" fontSize={10} fill="currentColor">{v}</text>
          </g>
        ))}
        <line x1={pl} x2={W - pr} y1={yv(0)} y2={yv(0)} stroke="currentColor" strokeOpacity={0.6} />
        {target > 0 && target <= max && (
          <g>
            <line x1={pl} x2={W - pr} y1={yv(target)} y2={yv(target)} stroke="#6ABC46" strokeDasharray="4 3" />
            <text x={W - pr} y={yv(target) - 3} textAnchor="end" fontSize={10} fill="#8fd46b">target {S.targetWeeks} wk</text>
          </g>
        )}
        {vals.map((v, i) => {
          const top = yv(Math.max(v, 0));
          const bot = yv(Math.min(v, 0));
          const addBbl = i > 0 ? p.proj[i - 1].add : 0;
          return (
            <g key={i}>
              <rect x={x(i) - bw / 2} y={top} width={bw} height={Math.max(1, bot - top)} rx={2} fill={v < 0 ? "#ef6b6b" : "#6ABC46"} opacity={i === 0 ? 1 : 0.8} />
              {i % 2 === 0 && (
                <text x={x(i)} y={H - 6} textAnchor="middle" fontSize={10} fill="currentColor">{i === 0 ? "now" : fmtDay(p.proj[i - 1].day)}</text>
              )}
              {addBbl > 0 && <text x={x(i)} y={top - 4} textAnchor="middle" fontSize={10} fill="#8fd46b">+{r1(addBbl)}</text>}
            </g>
          );
        })}
      </svg>
      <p className="mt-1 text-[11px] text-neutral-500">
        Bars = bbl at distributors + our warehouse each week. Green +numbers = a tank getting packaged. Red = run out. This cycle&apos;s recommended batch isn&apos;t included.
      </p>
    </div>
  );
}

// Demand pots (Chad, 2026-10-23): recurring / new / estimated (Superior, Coast,
// beers without LilyPad) / commitments — lost shown but not counted.
const POT_COLORS = { recurring: "#6ABC46", new: "#4aa3df", estimated: "#c9a227", commitments: "#b07ce8" } as const;
function PotBar({ p }: { p: Plan }) {
  const parts = [
    { k: "recurring", v: p.pots.recurring },
    { k: "new", v: p.pots.newCounted },
    { k: "estimated", v: p.pots.estimated },
    { k: "commitments", v: p.pots.commitments },
  ] as const;
  const total = parts.reduce((a, x) => a + x.v, 0);
  if (total <= 0) return null;
  return (
    <span className="mt-1 ml-auto flex h-1.5 w-24 overflow-hidden rounded-full bg-neutral-800" title="Recurring · New · Estimated · Commitments">
      {parts.map((x) => (x.v > 0 ? <span key={x.k} style={{ width: `${(x.v / total) * 100}%`, background: POT_COLORS[x.k] }} /> : null))}
    </span>
  );
}

function PotsBox({ p, S }: { p: Plan; S: Settings }) {
  const box = "rounded-lg border border-neutral-800 bg-neutral-900/60 p-3 min-w-0";
  const th = "px-1.5 py-1 text-right text-[10.5px] font-semibold uppercase tracking-wide text-neutral-500 first:text-left";
  const td = "px-1.5 py-1 text-right tabular-nums first:text-left";
  const acc = (k: "recurring" | "new" | "lost") => {
    if (p.brands.length) return p.brands.reduce((a, b) => a + (b.accounts[k] ?? 0), 0);
    return null;
  };
  const rows: { name: string; color?: string; accounts: number | null; bbl: number; counted: string }[] = [
    { name: "Recurring accounts", color: POT_COLORS.recurring, accounts: acc("recurring"), bbl: p.pots.recurring, counted: "Yes" },
    { name: "New accounts (first order in 60 days)", color: POT_COLORS.new, accounts: acc("new"), bbl: p.pots.new, counted: `${S.newPct}%` },
    { name: "Superior / Coast / no LilyPad (estimated)", color: POT_COLORS.estimated, accounts: null, bbl: p.pots.estimated, counted: "Yes" },
    { name: "Commitments", color: POT_COLORS.commitments, accounts: p.commitments.length || null, bbl: p.pots.commitments, counted: "Yes, from start date" },
    { name: "Lost / slipping (no order in 60+ days)", accounts: acc("lost"), bbl: p.pots.lost, counted: "No" },
  ];
  return (
    <div className={box}>
      <h3 className="mb-2 text-sm font-semibold">Where demand comes from</h3>
      <div className="overflow-x-auto">
        <table className="w-full text-[12.5px]">
          <thead><tr><th className={th}>Pot</th><th className={th}>Accounts</th><th className={th}>bbl / wk</th><th className={th}>Counted</th></tr></thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.name} className="border-t border-neutral-800">
                <td className={td}><span className="mr-1.5 inline-block h-2 w-2 rounded-sm align-middle" style={{ background: r.color ?? "#555" }} />{r.name}</td>
                <td className={td}>{r.accounts ?? "–"}</td>
                <td className={td}>{r.name.startsWith("Lost") && r.bbl > 0 ? `−${r1(r.bbl)}` : r1(r.bbl)}</td>
                <td className={td}>{r.counted}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {p.recWithout && (
        <p className="mt-2 text-[13px] text-neutral-200">
          Without commitments: <b>{p.recWithout.action === "Brew" ? `Brew ${p.recWithout.bbl} bbl` : "Hold"}</b> · with them: <b>{p.rec.action === "Brew" ? `Brew ${p.rec.bbl} bbl` : "Hold"}</b> (+{r1(p.commitNow)} bbl / wk when this batch is ready)
        </p>
      )}
      <p className="mt-1 text-[11px] text-neutral-500">LilyPad, last 3 full months (latest counted more), measured distributors. Accounts are counted per brand, so one store buying two brands counts twice. Same 60-day rules as the Sales Dashboard.</p>
    </div>
  );
}

function Detail({ p, S }: { p: Plan; S: Settings }) {
  const box = "rounded-lg border border-neutral-800 bg-neutral-900/60 p-3 min-w-0";
  const th = "px-1.5 py-1 text-right text-[10.5px] font-semibold uppercase tracking-wide text-neutral-500 first:text-left";
  const td = "px-1.5 py-1 text-right tabular-nums first:text-left";
  const ml = mangoLine(p);
  return (
    <div className="grid gap-4 lg:grid-cols-[1.1fr_1fr]">
      <div className={box}>
        <h3 className="mb-2 text-sm font-semibold">{p.rec.action === "Brew" ? `Brew ${p.rec.bbl} bbl` : "Hold"}: why</h3>
        <p className="mb-1.5 text-[13px] leading-relaxed text-neutral-300">{p.rec.why}</p>
        {p.rec.action === "Brew" && p.rec.sell !== undefined && (
          <p className="mb-1.5 text-[13px] text-neutral-300">After packaging it lasts about <b>{Math.round(p.rec.sell)} days</b> at today&apos;s selling rate.</p>
        )}
        {p.rec.warn && <p className="mb-1.5 text-[13px] text-amber-300">{p.rec.warn}</p>}
        {ml && <p className="mb-1.5 text-[13px] text-neutral-200"><b>{ml[0].toUpperCase() + ml.slice(1)}</b> (its share of sales), then can or keg it.</p>}
        <Chart p={p} S={S} />
      </div>
      <div className="flex min-w-0 flex-col gap-4">
        <PotsBox p={p} S={S} />
        {p.brands.length > 0 && (
          <div className={box}>
            <h3 className="mb-2 text-sm font-semibold">Brand split</h3>
            <div className="overflow-x-auto">
              <table className="w-full text-[12.5px]">
                <thead><tr><th className={th}>Brand</th><th className={th}>Share</th><th className={th}>bbl / wk</th><th className={th}>At dist.</th><th className={th}>Weeks</th><th className={th}>Kegs / cans</th>{p.rec.action === "Brew" && <th className={th}>From batch</th>}</tr></thead>
                <tbody>
                  {p.brands.map((b) => (
                    <tr key={b.key} className="border-t border-neutral-800">
                      <td className={td}>{b.name}{b.pullOff && <span className="block text-[11px] text-neutral-500">same base, pulled off + finished</span>}</td>
                      <td className={td}>{Math.round(b.share * 100)}%</td>
                      <td className={td}>{r1(b.rate)}</td>
                      <td className={td}>{r1(b.stock)}</td>
                      <td className={td}><Cover w={b.weeks} /></td>
                      <td className={td}>{b.kegShare === null ? "–" : `${Math.round(b.kegShare * 100)} / ${100 - Math.round(b.kegShare * 100)}`}</td>
                      {p.rec.action === "Brew" && <td className={td}><b>{r1(b.fromBatch)}</b></td>}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="mt-1 text-[11px] text-neutral-500">Share = each brand&apos;s selling rate. Kegs / cans = LilyPad, last 3 full months. &quot;From batch&quot; = packaged bbl at today&apos;s mix.</p>
          </div>
        )}
        <div className={box}>
          <h3 className="mb-2 text-sm font-semibold">By distributor</h3>
          <div className="overflow-x-auto">
            <table className="w-full text-[12.5px]">
              <thead><tr><th className={th}>Distributor</th><th className={th}>Data</th><th className={th}>bbl / wk</th><th className={th}>Has bbl</th><th className={th}>Weeks</th></tr></thead>
              <tbody>
                {p.rows.length === 0 && <tr><td className={`${td} text-neutral-500`} colSpan={5}>No distributor stock or sales.</td></tr>}
                {p.rows.map((x) => (
                  <tr key={x.dist} className="border-t border-neutral-800">
                    <td className={td}>{x.dist}</td>
                    <td className={td}><span className={`rounded px-1.5 text-[11px] font-semibold ${x.q === "Measured" ? "bg-[#6ABC46]/15 text-[#8fd46b]" : "bg-amber-500/15 text-amber-300"}`}>{x.q}</span></td>
                    <td className={td}>{r1(x.rate)}</td>
                    <td className={td}>{r1(x.stock)}</td>
                    <td className={td}><Cover w={x.rate ? x.stock / x.rate : null} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="mt-1 text-[11px] text-neutral-500">Measured = Ekos count + LilyPad sales. Estimated = no count yet; worked out from our deliveries. Our warehouse: {r1(p.wh)} bbl.</p>
        </div>
        <div className={box}>
          <h3 className="mb-2 text-sm font-semibold">In tank</h3>
          <table className="w-full text-[12.5px]">
            <thead><tr><th className={th}>Tank</th><th className={th}>Batch</th><th className={th}>bbl</th><th className={th}>Packaged</th></tr></thead>
            <tbody>
              {p.tanks.length === 0 && <tr><td className={`${td} text-neutral-500`} colSpan={4}>Nothing in tank.</td></tr>}
              {p.tanks.map((t) => (
                <tr key={t.tank} className="border-t border-neutral-800">
                  <td className={td}>{t.tank}</td>
                  <td className={`${td} whitespace-normal`}>{t.label}<span className="block text-[11px] text-neutral-500">{t.stage ?? "—"}{t.days !== null ? ` · ${t.days} days in tank` : ""}</span></td>
                  <td className={td}>{r1(t.bbl)}</td>
                  <td className={td}>{t.ready ? "ready now" : `~${fmtDay(t.pkg)}`}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="mt-1 text-[11px] text-neutral-500">Ready beer counts from next week. Others: start date + {S.lead[p.base.key]} days (setting).</p>
        </div>
      </div>
    </div>
  );
}

const SETS: { key: keyof Settings; label: string; sub?: string; text?: boolean }[] = [
  { key: "targetWeeks", label: "Weeks of stock when a batch lands", sub: "target cover at distributors" },
  { key: "cycleWeeks", label: "Weeks between brews" },
  { key: "safetyWeeks", label: "Brew now if waiting leaves under", sub: "weeks of stock" },
  { key: "maxDays", label: "Over-brew limit", sub: "days to sell a batch" },
  { key: "yieldPct", label: "Packaging yield", sub: "% of tank bbl" },
  { key: "sizes", label: "Batch sizes", sub: "bbl", text: true },
  { key: "minBrew", label: "Smallest batch worth brewing", sub: "bbl" },
  { key: "recentWeight", label: "Weight on last month", sub: "2 older months + last month × this" },
  { key: "saccaniPct", label: "Saccani sales moving to Mussetter", sub: "%" },
  { key: "newPct", label: "Count New accounts at", sub: "% of their sales (some won't reorder)" },
];

export default function BrewPlannerClient({ data }: { data: PlannerData }) {
  const [S, setS] = useState<Settings>(DEFAULT_SETTINGS);
  const [open, setOpen] = useState<Set<string>>(new Set());
  useEffect(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(STORE) ?? "null");
      // eslint-disable-next-line react-hooks/set-state-in-effect -- read saved settings once after mount
      if (saved) setS({ ...DEFAULT_SETTINGS, ...saved, lead: { ...DEFAULT_SETTINGS.lead, ...(saved.lead ?? {}) } });
    } catch {}
  }, []);
  const save = (next: Settings) => {
    setS(next);
    try {
      localStorage.setItem(STORE, JSON.stringify(next));
    } catch {}
  };

  const P = useMemo(() => BASES.map((b) => plan(data, S, b)), [data, S]);
  const brews = P.filter((p) => p.rec.action === "Brew");
  const holds = P.filter((p) => p.rec.action !== "Brew");
  const today = new Date(`${data.today}T12:00:00`);

  const flags = useMemo(() => {
    const F: { tone: "bad" | "warn" | "info"; title: string; text: string }[] = [];
    for (const p of P) {
      for (const t of p.tanks) {
        if (t.ready && (t.days ?? 0) > 30) {
          const weeks = p.demand ? (t.out / p.demand) : null;
          F.push({
            tone: weeks !== null && weeks > 12 ? "bad" : "warn",
            title: `${p.base.name}: ${r1(t.bbl)} bbl ready in ${t.tank}, ${t.days} days in tank`,
            text: weeks === null ? "No sales showing for it." : `That's about ${Math.round(weeks)} weeks of sales.`,
          });
        }
      }
      if (p.demand > 0.5 && p.tanks.length === 0 && p.cover !== null && p.cover < S.targetWeeks + S.cycleWeeks) {
        F.push({ tone: "warn", title: `${p.base.name}: nothing in tank`, text: `About ${r1(p.cover)} weeks left outside the tanks.` });
      }
      for (const b of p.brands) {
        if (b.pullOff && b.weeks !== null && b.weeks < 1) {
          F.push({ tone: "warn", title: `${b.name} almost out at distributors`, text: `About ${r1(b.stock)} bbl left at the measured distributors, under a week of sales. Pull it off the next ${p.base.name} that's ready.` });
        }
      }
      if (p.dstock + p.wh > 0) {
        const low = p.rows.filter((x) => x.rate > 0.2 && x.stock / x.rate < 1);
        if (low.length && p.wh < p.demand) {
          F.push({ tone: "warn", title: `${p.base.name}: low now at ${low.map((x) => x.dist).join(", ")}`, text: `Under a week each, and our warehouse has ${r1(p.wh)} bbl.` });
        }
      }
    }
    if (data.ignored.length) {
      const bbl = data.ignored.reduce((a, x) => a + x.bbl, 0);
      F.push({ tone: "info", title: "Superior / Coast Ekos rows left out", text: `${data.ignored.length} row(s), ${r1(bbl)} bbl (${data.ignored.slice(0, 2).map((x) => x.what).join("; ")}). They stay on estimates from our deliveries until their own data is set up.` });
    }
    F.push({ tone: "info", title: "Saccani counted as gone", text: "Saccani's past sales aren't counted. Mussetter's own LilyPad sales pick up converted accounts; the setting adds more if you expect it." });
    return F;
  }, [P, S, data.ignored]);

  const toggle = (k: string) =>
    setOpen((prev) => {
      const n = new Set(prev);
      if (n.has(k)) n.delete(k);
      else n.add(k);
      return n;
    });

  const th = "px-2.5 py-2.5 text-right text-[11px] font-semibold uppercase tracking-wide text-neutral-500 first:text-left whitespace-nowrap";
  const td = "px-2.5 py-3 text-right align-top tabular-nums whitespace-nowrap first:text-left";

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <span className="mb-3 inline-flex rounded-full border border-amber-500/60 bg-amber-500/10 px-2.5 py-0.5 text-xs font-semibold uppercase tracking-wide text-amber-300">Experimental</span>
          <h1 className="text-3xl font-semibold tracking-tight">Brew Planner</h1>
          <p className="mt-1 max-w-3xl text-sm text-neutral-400">
            Work in progress. What to brew this cycle and how much, from distributor stock, LilyPad sales, our warehouse and what&apos;s in tank. Check it against your own call before brewing.
          </p>
        </div>
        <div className="flex flex-wrap gap-1.5">
          {data.fresh.map((f) => (
            <span key={f.label} className={`rounded-full border px-2.5 py-0.5 text-xs ${f.old ? "border-amber-500/60 text-amber-300" : "border-neutral-800 text-neutral-400"}`}>
              {f.label}: <b className="font-semibold text-neutral-200">{f.value}</b>
            </span>
          ))}
        </div>
      </div>

      <section className={`${CARD} flex flex-col gap-3 p-4`} aria-label="This brew cycle">
        <div className="text-[11px] font-semibold uppercase tracking-wide text-neutral-500">
          This {S.cycleWeeks}-week cycle · {fmtDay(today)} – {fmtDay(addDays(today, 7 * S.cycleWeeks))} · {data.emptyTanks} fermenters empty
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <span className="w-12 text-[11px] font-semibold uppercase tracking-wide text-neutral-500">Brew</span>
          {brews.length === 0 && <span className="text-sm text-neutral-400">Nothing needed this cycle.</span>}
          {brews.map((p) => (
            <span key={p.base.key} className="rounded-full bg-[#6ABC46] px-3 py-1 text-[13px] font-semibold text-black">
              {p.base.name} · {p.rec.bbl} bbl{mangoLine(p) ? <span className="font-medium"> ({mangoLine(p)})</span> : null}
            </span>
          ))}
          {brews.length > 0 && <span className="text-[13px] tabular-nums text-neutral-500">{brews.reduce((a, p) => a + p.rec.bbl, 0)} bbl total</span>}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <span className="w-12 text-[11px] font-semibold uppercase tracking-wide text-neutral-500">Hold</span>
          {holds.map((p) => <span key={p.base.key} className={PILL_HOLD}>{p.base.name}</span>)}
        </div>
      </section>

      <section className={CARD} aria-label="Base beers">
        <div className="flex items-center justify-between border-b border-neutral-800 px-4 py-3">
          <h2 className="text-base font-semibold">Base beers</h2>
          <span className="text-xs text-neutral-500">Click a beer for the details</span>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr>
                <th className={th}>Base beer</th><th className={th}>Selling / wk</th><th className={th}>At distributors</th><th className={th}>Our warehouse</th>
                <th className={th}>In tank</th><th className={th}>Weeks of cover</th><th className={th}>Runs out</th><th className={th}>This cycle</th>
              </tr>
            </thead>
            <tbody>
              {P.map((p) => {
                const next = p.tanks.filter((t) => !t.ready).sort((a, b) => a.pkg.getTime() - b.pkg.getTime())[0];
                const ready = p.tanks.some((t) => t.ready);
                const isOpen = open.has(p.base.key);
                return (
                  <Fragment key={p.base.key}>
                    <tr
                      className="cursor-pointer border-t border-neutral-800 hover:bg-white/[0.03]"
                      tabIndex={0}
                      aria-expanded={isOpen}
                      onClick={() => toggle(p.base.key)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" || e.key === " ") {
                          e.preventDefault();
                          toggle(p.base.key);
                        }
                      }}
                    >
                      <td className={td}>
                        <span className="font-semibold">{p.base.name}</span>
                        <span className="block max-w-[260px] whitespace-normal text-xs text-neutral-500">{p.base.brands.map((b) => b.name).join(" · ")}</span>
                      </td>
                      <td className={td}>
                        {r1(p.demand)}
                        {p.commitNow > 0 && <span className="block text-[11px] text-[#c9a6f2]">+{r1(p.commitNow)} committed</span>}
                        <PotBar p={p} />
                      </td>
                      <td className={td}>{r1(p.dstock)}</td>
                      <td className={td}>{r1(p.wh)}</td>
                      <td className={td}>
                        {p.inTank ? r1(p.inTank) : "–"}
                        <span className="block text-[11px] text-neutral-500">{[next ? `~${fmtDay(next.pkg)}` : null, ready ? "ready now" : null].filter(Boolean).join(" · ")}</span>
                      </td>
                      <td className={td}><Cover w={p.cover} /></td>
                      <td className={td}>{p.runout ? fmtDay(p.runout) : p.demand ? "10+ wks" : "–"}</td>
                      <td className={td}>
                        <span className={p.rec.action === "Brew" ? PILL_BREW : PILL_HOLD}>{p.rec.action === "Brew" ? `Brew ${p.rec.bbl} bbl` : "Hold"}</span>
                        {mangoLine(p) && <span className="mt-1 block text-[11px] text-neutral-500">{mangoLine(p)}</span>}
                      </td>
                    </tr>
                    {isOpen && (
                      <tr className="bg-neutral-900/40">
                        <td colSpan={8} className="p-4"><Detail p={p} S={S} /></td>
                      </tr>
                    )}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>

      <Commitments data={data} />

      <div className="grid items-start gap-4 lg:grid-cols-[1.5fr_1fr]">
        <section className={CARD} aria-label="Needs a look">
          <div className="flex items-center justify-between border-b border-neutral-800 px-4 py-3">
            <h2 className="text-base font-semibold">Needs a look</h2>
            <span className="text-xs text-neutral-500">{flags.length} items</span>
          </div>
          <div className="flex max-h-[460px] flex-col gap-3 overflow-y-auto p-4">
            {flags.map((f, i) => (
              <div key={i} className={`border-l-[3px] pl-3 ${f.tone === "bad" ? "border-red-400" : f.tone === "warn" ? "border-amber-400" : "border-neutral-700"}`}>
                <div className="text-[13px] font-semibold">{f.title}</div>
                <p className="mt-0.5 text-[12.5px] text-neutral-400">{f.text}</p>
              </div>
            ))}
          </div>
        </section>
        <section className={CARD} aria-label="Settings">
          <div className="flex items-center justify-between border-b border-neutral-800 px-4 py-3">
            <h2 className="text-base font-semibold">Settings</h2>
            <button
              type="button"
              className="rounded-md border border-neutral-700 px-2.5 py-1 text-xs hover:border-[#6ABC46]"
              onClick={() => {
                save(DEFAULT_SETTINGS);
                try {
                  localStorage.removeItem(STORE);
                } catch {}
              }}
            >
              Reset
            </button>
          </div>
          <div className="flex max-h-[460px] flex-col gap-2.5 overflow-y-auto p-4">
            <p className="text-[11px] text-neutral-500">Saved in this browser only.</p>
            {SETS.map((s) => (
              <label key={s.key} className="grid grid-cols-[1fr_88px] items-center gap-2 text-[12.5px]">
                <span>{s.label}{s.sub && <span className="block text-[11px] text-neutral-500">{s.sub}</span>}</span>
                <input
                  id={`bp-${s.key}`}
                  type={s.text ? "text" : "number"}
                  step="any"
                  value={String(S[s.key])}
                  onChange={(e) => {
                    const v = e.target.value;
                    save({ ...S, [s.key]: s.text ? v : v === "" ? DEFAULT_SETTINGS[s.key] : Number(v) } as Settings);
                  }}
                  className="rounded-md border border-neutral-700 bg-neutral-900 px-2 py-1 text-right tabular-nums"
                />
              </label>
            ))}
            {BASES.map((b) => (
              <label key={b.key} className="grid grid-cols-[1fr_88px] items-center gap-2 text-[12.5px]">
                <span>Days to package: {b.name}<span className="block text-[11px] text-neutral-500">brew day to packaged (a guess to start)</span></span>
                <input
                  id={`bp-lead-${b.key}`}
                  type="number"
                  value={S.lead[b.key] ?? b.lead}
                  onChange={(e) => save({ ...S, lead: { ...S.lead, [b.key]: e.target.value === "" ? b.lead : Number(e.target.value) } })}
                  className="rounded-md border border-neutral-700 bg-neutral-900 px-2 py-1 text-right tabular-nums"
                />
              </label>
            ))}
          </div>
        </section>
      </div>

      <p className="text-xs text-neutral-500">
        Numbers: LilyPad store sales (last 3 full months, latest counted more), each distributor&apos;s newest Ekos count, delivered POs for Superior and Coast, this week&apos;s Inventory &amp; Allocation minus delivered POs, and the Ekos tank sync. 1 case-equivalent = 2.25 gal (13.78 per bbl). Base beers: Big Daddy + Capt. WC are one brew; Capt. Hazy + Juicy + Mystic Haze + Mango Bomb (pulled off) are one brew.
      </p>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Commitments (Chad, 2026-10-23): accounts / chains that committed to a product
// at an expected rate. Entered here for now (LilyPad later). Saved in table
// brew_planner_commitments; every add / change / delete goes in the audit log.
// ---------------------------------------------------------------------------
type Draft = { account: string; distributor: string; product_id: string; qty: string; per: "week" | "month"; start_date: string; end_date: string; note: string };
const EMPTY: Draft = { account: "", distributor: "", product_id: "", qty: "", per: "week", start_date: "", end_date: "", note: "" };
const DISTS = ["Matagrano", "Guardian", "Valley Wide", "Mussetter", "Markstein", "Superior", "Coast"];

function Commitments({ data }: { data: PlannerData }) {
  const supabase = useMemo(() => createClient(), []);
  const router = useRouter();
  const [draft, setDraft] = useState<Draft>({ ...EMPTY, start_date: data.today });
  const [editing, setEditing] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [confirmDel, setConfirmDel] = useState<string | null>(null);
  const baseName = (k: string | null) => BASES.find((b) => b.key === k)?.name ?? "—";

  const userId = async () => (await supabase.auth.getUser()).data.user?.id ?? null;

  async function save() {
    setErr(null);
    const qty = Number(draft.qty);
    if (!draft.account.trim() || !draft.product_id || !(qty > 0) || !draft.start_date) {
      setErr("Fill in the account, product, amount (more than 0) and start date.");
      return;
    }
    if (draft.end_date && draft.end_date < draft.start_date) {
      setErr("The end date is before the start date.");
      return;
    }
    setBusy(true);
    const uid = await userId();
    const row = {
      account: draft.account.trim(),
      distributor: draft.distributor || null,
      product_id: draft.product_id,
      qty,
      per: draft.per,
      start_date: draft.start_date,
      end_date: draft.end_date || null,
      note: draft.note.trim() || null,
      updated_by: uid,
      updated_at: new Date().toISOString(),
    };
    const old = editing ? data.commitments.find((c) => c.id === editing) : null;
    const res = editing
      ? await supabase.from("brew_planner_commitments").update(row).eq("id", editing).select("id").single()
      : await supabase.from("brew_planner_commitments").insert({ ...row, created_by: uid }).select("id").single();
    if (res.error || !res.data) {
      setErr(`Couldn't save: ${res.error?.message ?? "no row came back"}`);
      setBusy(false);
      return;
    }
    if (uid) {
      const id = res.data.id as string;
      const product = data.products.find((x) => x.id === row.product_id)?.name ?? row.product_id;
      const summary = `${row.account} — ${product} ${row.qty}/${row.per} from ${row.start_date}${row.end_date ? ` to ${row.end_date}` : ""}`;
      if (!old) {
        await logChange(supabase, { weekId: null, tableName: "brew_planner_commitments", recordId: id, fieldName: "created", oldValue: null, newValue: summary, changedBy: uid });
      } else {
        const fields: [string, unknown, unknown][] = [
          ["account", old.account, row.account],
          ["distributor", old.distributor, row.distributor],
          ["product_id", old.product_id, row.product_id],
          ["qty", old.qty, row.qty],
          ["per", old.per, row.per],
          ["start_date", old.start_date, row.start_date],
          ["end_date", old.end_date, row.end_date],
          ["note", old.note, row.note],
        ];
        for (const [f, o, n] of fields) await logChange(supabase, { weekId: null, tableName: "brew_planner_commitments", recordId: id, fieldName: f, oldValue: o, newValue: n, changedBy: uid });
      }
    }
    setDraft({ ...EMPTY, start_date: data.today });
    setEditing(null);
    setBusy(false);
    router.refresh();
  }

  async function remove(c: Commitment) {
    setBusy(true);
    setErr(null);
    const { error } = await supabase.from("brew_planner_commitments").delete().eq("id", c.id);
    if (error) setErr(`Couldn't delete: ${error.message}`);
    else {
      const uid = await userId();
      if (uid)
        await logChange(supabase, {
          weekId: null,
          tableName: "brew_planner_commitments",
          recordId: c.id,
          fieldName: "deleted",
          oldValue: `${c.account} — ${c.product} ${c.qty}/${c.per} from ${c.start_date}`,
          newValue: null,
          changedBy: uid,
        });
      router.refresh();
    }
    setConfirmDel(null);
    setBusy(false);
  }

  const input = "rounded-md border border-neutral-700 bg-neutral-900 px-2 py-1 text-[13px]";
  const th = "px-2.5 py-2 text-left text-[11px] font-semibold uppercase tracking-wide text-neutral-500 whitespace-nowrap";
  const td = "px-2.5 py-2 align-top text-[13px]";
  return (
    <section className={CARD} aria-label="Commitments">
      <div className="flex items-center justify-between border-b border-neutral-800 px-4 py-3">
        <h2 className="text-base font-semibold">Commitments</h2>
        <span className="text-xs text-neutral-500">Accounts that committed to a product. Added to that beer&apos;s demand from the start date.</span>
      </div>
      <div className="max-h-[360px] overflow-auto">
        <table className="w-full">
          <thead>
            <tr><th className={th}>Account</th><th className={th}>Distributor</th><th className={th}>Product</th><th className={th}>Base beer</th><th className={th}>Rate</th><th className={th}>bbl / wk</th><th className={th}>Dates</th><th className={th}>Note</th><th className={th} /></tr>
          </thead>
          <tbody>
            {data.commitments.length === 0 && (
              <tr><td className={`${td} text-neutral-500`} colSpan={9}>No commitments yet. Add one below.</td></tr>
            )}
            {data.commitments.map((c) => (
              <tr key={c.id} className="border-t border-neutral-800">
                <td className={td}>{c.account}</td>
                <td className={td}>{c.distributor ?? "—"}</td>
                <td className={td}>{c.product}</td>
                <td className={td}>{baseName(c.base)}</td>
                <td className={`${td} tabular-nums`}>{c.qty} / {c.per}</td>
                <td className={`${td} tabular-nums`}>{r1(c.bblPerWeek)}</td>
                <td className={`${td} whitespace-nowrap`}>{c.start_date}{c.end_date ? ` → ${c.end_date}` : " → ongoing"}</td>
                <td className={`${td} max-w-[220px] text-neutral-400`}>{c.note ?? ""}</td>
                <td className={`${td} whitespace-nowrap text-right`}>
                  {confirmDel === c.id ? (
                    <>
                      <button type="button" disabled={busy} onClick={() => remove(c)} className="mr-2 text-red-300 hover:underline">Delete it</button>
                      <button type="button" onClick={() => setConfirmDel(null)} className="text-neutral-400 hover:underline">Keep</button>
                    </>
                  ) : (
                    <>
                      <button
                        type="button"
                        className="mr-3 text-[#8fd46b] hover:underline"
                        onClick={() => {
                          setEditing(c.id);
                          setDraft({ account: c.account, distributor: c.distributor ?? "", product_id: c.product_id, qty: String(c.qty), per: c.per, start_date: c.start_date, end_date: c.end_date ?? "", note: c.note ?? "" });
                        }}
                      >
                        Edit
                      </button>
                      <button type="button" className="text-neutral-400 hover:text-red-300" onClick={() => setConfirmDel(c.id)}>Delete</button>
                    </>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="flex flex-wrap items-end gap-2 border-t border-neutral-800 p-4">
        <label className="flex flex-col gap-1 text-[11px] text-neutral-500">Account / chain
          <input id="bp-c-account" className={`${input} w-44`} value={draft.account} onChange={(e) => setDraft({ ...draft, account: e.target.value })} placeholder="e.g. Save Mart" />
        </label>
        <label className="flex flex-col gap-1 text-[11px] text-neutral-500">Distributor
          <select id="bp-c-dist" className={input} value={draft.distributor} onChange={(e) => setDraft({ ...draft, distributor: e.target.value })}>
            <option value="">—</option>
            {DISTS.map((x) => <option key={x} value={x}>{x}</option>)}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-[11px] text-neutral-500">Product
          <select id="bp-c-product" className={`${input} max-w-[280px]`} value={draft.product_id} onChange={(e) => setDraft({ ...draft, product_id: e.target.value })}>
            <option value="">Pick a product…</option>
            {data.products.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-[11px] text-neutral-500">Cases / kegs
          <input id="bp-c-qty" type="number" min="0" step="any" className={`${input} w-24 text-right`} value={draft.qty} onChange={(e) => setDraft({ ...draft, qty: e.target.value })} />
        </label>
        <label className="flex flex-col gap-1 text-[11px] text-neutral-500">Per
          <select id="bp-c-per" className={input} value={draft.per} onChange={(e) => setDraft({ ...draft, per: e.target.value as "week" | "month" })}>
            <option value="week">week</option>
            <option value="month">month</option>
          </select>
        </label>
        <label className="flex flex-col gap-1 text-[11px] text-neutral-500">Starts
          <input id="bp-c-start" type="date" className={input} value={draft.start_date} onChange={(e) => setDraft({ ...draft, start_date: e.target.value })} />
        </label>
        <label className="flex flex-col gap-1 text-[11px] text-neutral-500">Ends (optional)
          <input id="bp-c-end" type="date" className={input} value={draft.end_date} onChange={(e) => setDraft({ ...draft, end_date: e.target.value })} />
        </label>
        <label className="flex flex-col gap-1 text-[11px] text-neutral-500">Note
          <input id="bp-c-note" className={`${input} w-48`} value={draft.note} onChange={(e) => setDraft({ ...draft, note: e.target.value })} />
        </label>
        <button type="button" disabled={busy} onClick={save} className="rounded-md bg-[#6ABC46] px-3 py-1.5 text-[13px] font-semibold text-black disabled:opacity-50">
          {editing ? "Save changes" : "Add commitment"}
        </button>
        {editing && (
          <button type="button" onClick={() => { setEditing(null); setDraft({ ...EMPTY, start_date: data.today }); }} className="rounded-md border border-neutral-700 px-3 py-1.5 text-[13px]">
            Cancel
          </button>
        )}
        {err && <p className="w-full text-[12.5px] text-red-300">{err}</p>}
      </div>
    </section>
  );
}
