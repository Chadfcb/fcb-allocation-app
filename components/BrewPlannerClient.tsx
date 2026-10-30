"use client";

import { Fragment, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { logChange } from "@/lib/audit";
import { useNewFeature } from "@/lib/newFeatures";
import NewBadge from "@/components/NewBadge";
import BrewPlannerGuide from "@/components/BrewPlannerGuide";
import {
  BASES,
  DEFAULT_SETTINGS,
  addDays,
  bblPerUnit,
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
// chart, brand split, distributors, tanks) → Settings. Settings are saved in
// this browser only (localStorage) for now.
// 2026-10-30 (Chad): "remove the needs a look section ... its extra stuff for the
// eye that can confuse people" + "simplify the base beers block" for someone who
// isn't computer savvy. Needs a look is gone (its warnings are now short notes in
// each beer's row) and the Base beers table opens in a simple 4-column view
// (Beer · How much is left · Runs out · What to do). "Show all numbers" brings
// back the full table; remembered in this browser.

const STORE = "fcb-brew-planner-settings";
const VIEW_STORE = "fcb-brew-planner-all-numbers";
const CARD = "rounded-xl border border-neutral-800 bg-neutral-950";
const PILL_BREW = "rounded-full bg-[#6ABC46] px-2.5 py-0.5 text-xs font-semibold text-black";
const PILL_HOLD = "rounded-full border border-neutral-700 px-2.5 py-0.5 text-xs font-semibold text-neutral-400";

function coverClass(w0: number | null) {
  if (w0 === null) return "text-neutral-500";
  const w = Math.round(w0 * 10) / 10; // color matches the number shown
  if (w < 2) return "bg-red-500/15 text-red-300";
  if (w < 4) return "bg-amber-500/15 text-amber-300";
  return "bg-[#6ABC46]/15 text-[#8fd46b]";
}
// Goes by the number as shown (1.97 shows "2.0", so it's "Getting low", not "Low").
const coverWord = (w: number | null) => {
  if (w === null) return "";
  const x = Math.round(w * 10) / 10;
  return x < 2 ? "Low" : x < 4 ? "Getting low" : "Plenty";
};
const Cover = ({ w }: { w: number | null }) => (
  <span className={`inline-block min-w-[44px] rounded-md px-1.5 text-center font-semibold tabular-nums ${coverClass(w)}`}>{w === null ? "–" : r1(w)}</span>
);

function mangoLine(p: Plan): string | null {
  const m = p.brands.find((b) => b.pullOff);
  if (!m || p.rec.action !== "Brew") return null;
  return `pull ~${r1(m.fromBatch)} bbl for ${m.name}`;
}


// ---------------------------------------------------------------------------
// Plain-English units + "Why this recommendation" (2026-10-26, per Chad: "we
// need an area that gives a detailed description as to why it is recommending
// the beers to brew" / the Base beers rows — "is it cases? CE's? Barrels of
// beer? its way to vague"). Every number on this page is bbl of finished
// beer; these helpers turn bbl into cases + kegs and spell out the math.
// Nothing here changes the planner's math (lib/brewPlanner.ts).
// ---------------------------------------------------------------------------
type Mix = { kegShare: number | null; caseBbl: number; caseWord: string };

const CASE_WORDS: [number, string][] = [
  [0.09677, "16oz cases"],
  [0.07258, "12oz cases"],
  [0.05806, "19.2oz cases"],
];

// This base beer's keg / can split (LilyPad, last 3 full months) and the size
// of its cases (from its can products in the app).
function mixFor(base: Plan["base"], data: PlannerData): Mix {
  let k = 0;
  let c = 0;
  for (const br of base.brands) {
    k += data.lily.kegCe[br.key] ?? 0;
    c += data.lily.canCe[br.key] ?? 0;
  }
  const sizes = [
    ...new Set(
      data.products
        .filter((x) => x.base === base.key && !/bbl/i.test(x.name))
        .map((x) => bblPerUnit(x.name))
        .filter((v) => v > 0),
    ),
  ];
  const caseBbl = sizes.length ? sizes.reduce((a, v) => a + v, 0) / sizes.length : 0.09677;
  const caseWord = sizes.length === 1 ? CASE_WORDS.find(([v]) => Math.abs(v - sizes[0]) < 0.001)?.[1] ?? "cases" : "cases";
  return { kegShare: k + c > 0 ? k / (k + c) : null, caseBbl, caseWord };
}

// bbl → "≈ 33 16oz cases + 12 ½-bbl kegs" (at this beer's can / keg mix).
function conv(bbl: number, m: Mix): string | null {
  if (!(bbl > 0.05)) return null;
  if (m.kegShare === null) {
    return `≈ ${Math.round(bbl / m.caseBbl)} ${m.caseWord} or ${pl(Math.round(bbl / 0.5), "½-bbl keg", "½-bbl kegs")}`;
  }
  const cases = Math.round((bbl * (1 - m.kegShare)) / m.caseBbl);
  const kegs = Math.round((bbl * m.kegShare) / 0.5);
  const parts = [cases > 0 ? `${cases} ${m.caseWord}` : null, kegs > 0 ? pl(kegs, "½-bbl keg", "½-bbl kegs") : null].filter(Boolean);
  return parts.length ? `≈ ${parts.join(" + ")}` : null;
}
const pl = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;
const wks = (bbl: number, rate: number) => (rate > 0 ? r1(Math.max(bbl, 0) / rate) : "–");

// One line for the table's "This cycle" column.
function shortReason(p: Plan, S: Settings): string {
  const r = p.rec;
  const rate = r.rateNext ?? p.demand;
  if (r.action === "Brew" && r.basis === "par") return `Distributors are ${r1(p.par.need)} bbl short of par after this week's orders and the beer in tank.`;
  if (r.action === "Brew") {
    if ((r.nextLand ?? 0) <= 0) return `Waiting ${S.cycleWeeks} more weeks, distributors would run out before the next batch is ready.`;
    return `Waiting ${S.cycleWeeks} more weeks leaves only ${wks(r.nextLand ?? 0, rate)} weeks of beer when it's ready (needs ${S.safetyWeeks}).`;
  }
  if (rate <= 0) return "No sales showing.";
  if ((r.nextLand ?? 0) >= rate * S.safetyWeeks) return `Still ${wks(r.nextLand ?? 0, rate)} weeks of beer even if you wait ${S.cycleWeeks} weeks.`;
  return `Only ${r1(Math.max(r.need ?? 0, 0))} bbl short, under the ${S.minBrew} bbl minimum.`;
}

// Plainer reason for the simple view (2026-10-30).
function simpleReason(p: Plan, S: Settings): string {
  const r = p.rec;
  const rate = r.rateNext ?? p.demand;
  if (r.action === "Brew" && r.basis === "par") return `Distributors are ${r1(p.par.need)} bbl short of par, even after this week's orders and the beer in tank.`;
  if (r.action === "Brew") {
    return (r.nextLand ?? 0) <= 0
      ? "If we wait, it runs out before a new batch is ready."
      : "If we wait, it gets too low before a new batch is ready.";
  }
  if (rate <= 0) return "No sales showing.";
  if ((r.nextLand ?? 0) >= rate * S.safetyWeeks) return "Enough beer for now.";
  return "Only a little needed, so it can wait.";
}

// Short warnings shown in a beer's row (these used to be the "Needs a look" box).
function rowNotes(p: Plan, S: Settings): string[] {
  const out: string[] = [];
  for (const t of p.tanks) {
    if (t.ready && (t.days ?? 0) > 30) out.push(`${r1(t.bbl)} bbl ready in ${t.tank} for ${t.days} days.`);
  }
  if (p.demand > 0.5 && p.tanks.length === 0 && p.cover !== null && p.cover < S.targetWeeks + S.cycleWeeks) out.push("Nothing in tank.");
  for (const b of p.brands) {
    if (b.pullOff && b.weeks !== null && b.weeks < 1) out.push(`${b.name} almost out.`);
  }
  if (p.dstock + p.wh > 0) {
    const low = p.rows.filter((x) => x.rate > 0.2 && x.stock / x.rate < 1);
    if (low.length && p.wh < p.demand) out.push(`Low now at ${low.map((x) => x.dist).join(", ")}.`);
  }
  return out;
}

type Para = { head: string; text: string; tone?: "warn" };

// The full write-up for one base beer, in the order the planner thinks.
function explain(p: Plan, S: Settings, m: Mix): Para[] {
  const out: Para[] = [];
  const r = p.rec;
  const lead = S.lead[p.base.key] ?? p.base.lead;
  const y = S.yieldPct / 100;
  const total = p.demand + p.commitNow;
  const c = (bbl: number) => {
    const x = conv(bbl, m);
    return x ? ` (${x})` : "";
  };

  // 1. What's selling
  if (p.demand <= 0 && p.commitNow <= 0) {
    out.push({ head: "What's selling", text: "No sales are showing for this beer in LilyPad or in our deliveries, so there's nothing to plan for." });
  } else {
    const src: string[] = [];
    if (p.pots.recurring > 0.05) src.push(`${r1(p.pots.recurring)} bbl from stores that buy it regularly`);
    if (p.pots.newCounted > 0.05) src.push(`${r1(p.pots.newCounted)} bbl from new stores (first order in the last 60 days${S.newPct !== 100 ? `, counted at ${S.newPct}%` : ""})`);
    if (p.pots.estimated > 0.05) src.push(`${r1(p.pots.estimated)} bbl estimated from what we've shipped (Coast, and distributors with no LilyPad sales yet)`);
    let text = `Distributors are selling about ${r1(p.demand)} bbl a week${c(p.demand)}.`;
    if (src.length) text += ` That's ${src.join(", ")}.`;
    if (p.commitNow > 0.05) text += ` Commitments add ${r1(p.commitNow)} bbl a week by the time a new batch would be ready.`;
    if (p.pots.lost > 0.05) text += ` Stores that stopped ordering (no order in 60+ days) used to buy ${r1(p.pots.lost)} bbl a week. That is not counted unless they start buying again.`;
    const selling = p.brands.filter((b) => Math.round(b.share * 100) > 0);
    if (selling.length) text += ` By brand: ${selling.map((b) => `${b.name} ${Math.round(b.share * 100)}%`).join(", ")}.`;
    text += " Based on LilyPad store sales over the last 3 full months, with the latest month counted more.";
    out.push({ head: "What's selling", text });
  }

  // 2. What we have now
  {
    const have = p.dstock + p.wh;
    let text = `Right now there's ${r1(p.dstock)} bbl at distributors and ${r1(p.wh)} bbl in our warehouse: ${r1(have)} bbl${c(have)}`;
    text += total > 0 ? `, about ${wks(have, total)} weeks of sales.` : ".";
    if (p.tanks.length) {
      text += ` In tank: ${p.tanks
        .map((t) => `${t.tank} ${r1(t.bbl)} bbl (${t.ready ? "ready now, counted from next week" : `packaged ~${fmtDay(t.pkg)}`})`)
        .join(", ")}. After about ${100 - S.yieldPct}% packaging loss that's ${r1(p.tanks.reduce((a, t) => a + t.out, 0))} bbl of finished beer.`;
    } else text += " Nothing is in tank for it.";
    const low = p.rows.filter((x) => x.rate > 0.2 && x.stock / x.rate < 2);
    if (low.length) text += ` Running low: ${low.map((x) => `${x.dist} (${wks(x.stock, x.rate)} wks)`).join(", ")}.`;
    out.push({ head: "What we have now", text });
  }

  // 2b. Par levels (Chad, 2026-10-30: "Brew planner HAS to look at par levels, period").
  {
    const pr = p.par;
    if (!pr.hasPars) {
      out.push({ head: "Par levels", text: "No par levels are set for this beer at any distributor, so the call goes by sales only." });
    } else {
      const top = pr.byDist.filter((x) => x.gap > 0.05).slice(0, 4).map((x) => `${x.dist} ${r1(x.gap)}`).join(", ");
      let text = `Distributors are ${r1(pr.gap)} bbl short of their par levels${top ? ` (${top})` : ""}.`;
      text += pr.onOrder > 0.05 ? ` This week's orders on Inventory & Allocation cover ${r1(pr.onOrder)} bbl, leaving ${r1(pr.short)} bbl short.` : " Nothing is on order this week.";
      text += p.tanks.length ? ` After those orders, about ${r1(pr.tankLeft)} bbl of finished beer is left in tank.` : " Nothing is in tank.";
      text += pr.need > 0.05 ? ` So it still takes ${r1(pr.need)} bbl of finished beer to bring everyone up to par.` : " So par levels are covered.";
      out.push({ head: "Par levels", text });
    }
  }

  if (total <= 0 && !(r.action === "Brew" && r.basis === "par")) return out;

  // 3. When a new batch would be ready
  {
    const arriving = p.tanks.filter((t) => t.pkg <= p.land);
    const arrivingBbl = arriving.reduce((a, t) => a + t.out, 0);
    let text = `A batch brewed today would be packaged about ${fmtDay(p.land)} (${lead} days, set in Settings). Until then distributors sell about ${r1((p.demand * lead) / 7)} bbl`;
    text += arriving.length
      ? `, and ${arriving.map((t) => t.tank).join(" + ")} ${arriving.length === 1 ? "adds" : "add"} ${r1(arrivingBbl)} bbl when packaged.`
      : ", and no tank packages before then.";
    text +=
      p.atLand > 0
        ? ` That leaves about ${r1(p.atLand)} bbl (${wks(p.atLand, total)} weeks) on ${fmtDay(p.land)}.`
        : ` That's ${r1(-p.atLand)} bbl short: distributors would run out before ${fmtDay(p.land)}.`;
    out.push({ head: "When a new batch would be ready", text });
  }

  // 4. The call
  const nextLand = r.nextLand ?? 0;
  const rate = r.rateNext ?? total;
  if (r.action === "Brew" && r.basis === "par") {
    const sizes = String(S.sizes).split(/[ ,]+/).map(Number).filter((x) => x > 0).sort((a, b) => a - b);
    const biggest = sizes[sizes.length - 1];
    const need = r.need ?? 0;
    let text = `Par levels decide this one. Bringing distributors up to par takes ${r1(p.par.need)} bbl of finished beer, or ${r1(need)} bbl in tank at ${S.yieldPct}% yield.`;
    const sn = r.salesNeed ?? 0;
    text += sn >= S.minBrew && nextLand < rate * S.safetyWeeks ? ` Store sales alone would call for about ${r1(sn)} bbl, less than par needs.` : " Store sales alone would say it can wait, but par levels need beer now.";
    if (r.bbl === biggest && need > biggest) text += ` ${biggest} bbl is the largest batch size, so brew ${biggest} bbl.`;
    else text += ` The next batch size up is ${r.bbl} bbl.`;
    if (r.sell !== undefined && r.sell < 9999) text += ` At today's store sales, ${r.bbl} bbl lasts about ${Math.round(r.sell)} days after it's packaged.`;
    out.push({ head: `Why brew ${r.bbl} bbl`, text });
    const pull = p.brands.find((b) => b.pullOff);
    if (pull && pull.fromBatch >= 0.05) out.push({ head: "How to split the batch", text: `Pull ~${r1(pull.fromBatch)} bbl off for ${pull.name} (its share of sales), ${pull.key === "LM" ? "add lime" : pull.key === "MB" ? "add mango" : "finish it"}, then can or keg it.` });
    if (r.warn) out.push({ head: "Watch out", text: `${r.warn} Par levels may be set higher than stores are buying right now.`, tone: "warn" });
  } else if (r.action === "Brew") {
    let text =
      nextLand > 0
        ? `If you waited one more cycle (${S.cycleWeeks} weeks), the next batch would be ready with only ${r1(nextLand)} bbl left, about ${wks(nextLand, rate)} weeks. That's under the ${S.safetyWeeks}-week safety line, so brew now.`
        : `If you waited one more cycle (${S.cycleWeeks} weeks), distributors would run out before that batch was ready, so brew now.`;
    const required = r.required ?? 0;
    const need = r.need ?? 0;
    text += ` To cover the ${S.cycleWeeks} weeks until the following batch plus ${S.targetWeeks} weeks of stock takes ${r1(required)} bbl.`;
    text +=
      p.atLand > 0.05
        ? ` Minus the ${r1(p.atLand)} bbl still there, that's ${r1(need * y)} bbl of finished beer, or ${r1(need)} bbl in tank at ${S.yieldPct}% yield.`
        : ` Nothing will be left by then, so all of it has to come from this batch: ${r1(need)} bbl in tank at ${S.yieldPct}% yield.`;
    const sizes = String(S.sizes).split(/[ ,]+/).map(Number).filter((x) => x > 0).sort((a, b) => a - b);
    const biggest = sizes[sizes.length - 1];
    if (r.warn && /went down/.test(r.warn)) text += ` ${r.warn}`;
    else if (r.bbl === biggest && need > biggest) text += ` ${biggest} bbl is the largest batch size, so brew ${biggest} bbl.`;
    else text += ` The next batch size up is ${r.bbl} bbl.`;
    if (r.sell !== undefined) text += ` ${r.bbl} bbl${c(r.bbl * y)} lasts about ${Math.round(r.sell)} days after it's packaged.`;
    out.push({ head: `Why brew ${r.bbl} bbl`, text });
    const pull = p.brands.find((b) => b.pullOff);
    const split = p.brands.filter((b) => b.fromBatch >= 0.05);
    if (pull && pull.fromBatch >= 0.05) {
      out.push({
        head: "How to split the batch",
        text: `${split.map((b) => `${b.name} ${r1(b.fromBatch)} bbl`).join(", ")}: each brand's share of sales. Pull ~${r1(pull.fromBatch)} bbl off for ${pull.name}, ${pull.key === "LM" ? "add lime" : pull.key === "MB" ? "add mango" : "finish it"}, then can or keg it.`,
      });
    } else if (split.length > 1) {
      out.push({ head: "How to split the batch", text: `${split.map((b) => `${b.name} ${r1(b.fromBatch)} bbl`).join(", ")}: each brand's share of sales.` });
    }
    if (r.warn && !/went down/.test(r.warn)) out.push({ head: "Watch out", text: r.warn, tone: "warn" });
  } else {
    let text: string;
    if (rate <= 0) text = "No sales are showing, so there's nothing to brew for.";
    else if (nextLand >= rate * S.safetyWeeks)
      text = `Even if you wait one more cycle (${S.cycleWeeks} weeks), there's still ${r1(nextLand)} bbl, about ${wks(nextLand, rate)} weeks, when that batch would be ready. That's above the ${S.safetyWeeks}-week safety line, so it can wait.`;
    else
      text = `It would need only ${r1(Math.max(r.need ?? 0, 0))} bbl, under the ${S.minBrew} bbl smallest batch worth brewing, so it can wait a cycle.`;
    if (p.par.hasPars) text += " Par levels are covered too.";
    out.push({ head: "Why hold", text });
  }

  // 5. How sure
  {
    const notes: string[] = [];
    const estShare = total > 0 ? p.pots.estimated / total : 0;
    if (estShare >= 0.25) notes.push(`${Math.round(estShare * 100)}% of the selling rate is estimated from our deliveries (no store sales data), so treat it as a rough number.`);
    if (p.recWithout) notes.push(`Without the commitments this would be ${p.recWithout.action === "Brew" ? `brew ${p.recWithout.bbl} bbl` : "hold"}.`);
    notes.push("Change the targets, safety line or days to package in Settings and this updates right away.");
    out.push({ head: "How sure is this", text: notes.join(" ") });
  }
  return out;
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

// Demand pots (Chad, 2026-10-23): recurring / new / estimated (Coast,
// distributors with no LilyPad sales yet, beers without LilyPad) /
// commitments — lost shown but not counted.
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
    { name: "Coast / no LilyPad (estimated)", color: POT_COLORS.estimated, accounts: null, bbl: p.pots.estimated, counted: "Yes" },
    { name: "Commitments", color: POT_COLORS.commitments, accounts: p.commitments.length || null, bbl: p.pots.commitments, counted: "Yes, from start date" },
    { name: "Lost (no order in 60+ days)", accounts: acc("lost"), bbl: p.pots.lost, counted: "No, only if they buy again" },
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
                <td className={`${td} ${r.name.startsWith("Lost") ? "text-neutral-500" : ""}`}>{r1(r.bbl)}</td>
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

// Clicking a beer (2026-10-30, Chad: "waaaaay too much data for the average person
// ... we just need to know the why mainly. The why needs to be its only block and span
// the width of the page"): simple view = the Why block only, full width. With "Show all
// numbers" on, the chart / demand / brand / distributor / tank blocks follow below it.
function Detail({ p, S, mix, full }: { p: Plan; S: Settings; mix: Mix; full: boolean }) {
  const box = "rounded-lg border border-neutral-800 bg-neutral-900/60 p-3 min-w-0";
  const th = "px-1.5 py-1 text-right text-[10.5px] font-semibold uppercase tracking-wide text-neutral-500 first:text-left";
  const td = "px-1.5 py-1 text-right tabular-nums first:text-left";
  const paras = explain(p, S, mix);
  return (
    <div className="flex flex-col gap-4">
        <div className={box}>
          <h3 className="mb-2 flex items-center gap-2 text-sm font-semibold">
            Why this recommendation:
            <span className={p.rec.action === "Brew" ? PILL_BREW : PILL_HOLD}>{p.rec.action === "Brew" ? `Brew ${p.rec.bbl} bbl` : "Hold"}</span>
          </h3>
          <ol className="flex flex-col gap-2.5">
            {paras.map((x, i) => (
              <li key={i} className={`border-l-2 pl-3 ${x.tone === "warn" ? "border-amber-400" : "border-neutral-700"}`}>
                <div className={`text-[12px] font-semibold uppercase tracking-wide ${x.tone === "warn" ? "text-amber-300" : "text-neutral-400"}`}>{x.head}</div>
                <p className="mt-0.5 whitespace-normal text-[13px] leading-relaxed text-neutral-200">{x.text}</p>
              </li>
            ))}
          </ol>
          <p className="mt-2.5 text-[11px] text-neutral-500">All amounts are barrels (bbl) of beer. 1 bbl = 31 gallons ≈ 2 half-barrel kegs.</p>
        </div>
      {full && (
      <div className="grid gap-4 lg:grid-cols-[1.1fr_1fr]">
      <div className="flex min-w-0 flex-col gap-4">
        <div className={box}>
          <h3 className="mb-2 text-sm font-semibold">Beer outside the tanks, next 10 weeks (bbl)</h3>
          <Chart p={p} S={S} />
        </div>
      </div>
      <div className="flex min-w-0 flex-col gap-4">
        <PotsBox p={p} S={S} />
        {p.brands.length > 0 && (
          <div className={box}>
            <h3 className="mb-2 text-sm font-semibold">Brand split</h3>
            <div className="overflow-x-auto">
              <table className="w-full text-[12.5px]">
                <thead><tr><th className={th}>Brand</th><th className={th}>Share</th><th className={th}>bbl / wk</th><th className={th}>At dist. (bbl)</th><th className={th}>Weeks left</th><th className={th}>Kegs / cans</th>{p.rec.action === "Brew" && <th className={th}>From batch</th>}</tr></thead>
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
              <thead><tr><th className={th}>Distributor</th><th className={th}>Data</th><th className={th}>bbl / wk</th><th className={th}>Has (bbl)</th><th className={th}>Weeks left</th></tr></thead>
              <tbody>
                {p.rows.length === 0 && <tr><td className={`${td} text-neutral-500`} colSpan={5}>No distributor stock or sales.</td></tr>}
                {p.rows.map((x) => (
                  <tr key={x.dist} className="border-t border-neutral-800">
                    <td className={td}>{x.dist}</td>
                    <td className={td}><span className={`rounded px-1.5 text-[11px] font-semibold ${x.q === "Measured" ? "bg-[#6ABC46]/15 text-[#8fd46b]" : x.q === "Partly measured" ? "bg-sky-500/15 text-sky-300" : "bg-amber-500/15 text-amber-300"}`}>{x.q}</span></td>
                    <td className={td}>{r1(x.rate)}</td>
                    <td className={td}>{r1(x.stock)}</td>
                    <td className={td}><Cover w={x.rate ? x.stock / x.rate : null} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="mt-1 text-[11px] text-neutral-500">Measured = Ekos count + LilyPad sales. Partly measured = Ekos count; sales worked out from our deliveries (no LilyPad sales yet). Estimated = no count yet; worked out from our deliveries. Our warehouse: {r1(p.wh)} bbl.</p>
        </div>
        <div className={box}>
          <h3 className="mb-2 text-sm font-semibold">In tank</h3>
          <table className="w-full text-[12.5px]">
            <thead><tr><th className={th}>Tank</th><th className={th}>Batch</th><th className={th}>In tank (bbl)</th><th className={th}>Packaged</th></tr></thead>
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
      )}
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
  const [allNumbers, setAllNumbers] = useState(false);
  // "This cycle" pills open the Why in a pop-up (2026-10-30, Chad: "i need to be able to
  // click on the recommended brews, to be able to see the why").
  const [whyKey, setWhyKey] = useState<string | null>(null);
  useEffect(() => {
    if (!whyKey) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setWhyKey(null);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [whyKey]);
  useEffect(() => {
    try {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- read the saved view once after mount
      if (localStorage.getItem(VIEW_STORE) === "1") setAllNumbers(true);
    } catch {}
    try {
      const saved = JSON.parse(localStorage.getItem(STORE) ?? "null");
      // Batch sizes changed to 15/30/45/60 (2026-10-30): drop the old default if it was never edited.
      if (saved && String(saved.sizes ?? "").replace(/\s/g, "") === "7,15,30,60") delete saved.sizes;
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
  const mixes = useMemo(() => Object.fromEntries(BASES.map((b) => [b.key, mixFor(b, data)])) as Record<string, Mix>, [data]);
  const whyNew = useNewFeature("feature:brew-planner-why");
  const unitsNew = useNewFeature("feature:brew-planner-units");
  const guideNew = useNewFeature("feature:brew-planner-how-it-works");
  const brews = P.filter((p) => p.rec.action === "Brew");
  const holds = P.filter((p) => p.rec.action !== "Brew");
  const today = new Date(`${data.today}T12:00:00`);


  const toggle = (k: string) =>
    setOpen((prev) => {
      const n = new Set(prev);
      if (n.has(k)) n.delete(k);
      else n.add(k);
      return n;
    });

  const th = "px-2.5 py-2.5 text-right text-[11px] font-semibold uppercase tracking-wide text-neutral-500 first:text-left whitespace-nowrap";
  const td = "px-2.5 py-3 text-right align-top tabular-nums whitespace-nowrap first:text-left";
  const sub = "block text-[11px] font-normal text-neutral-500";
  // Simple view: left-aligned, wraps, roomier (2026-10-30).
  const thS = "px-4 py-2.5 text-left text-[11px] font-semibold uppercase tracking-wide text-neutral-500 whitespace-nowrap";
  const tdS = "px-4 py-3.5 text-left align-top";
  // Column headers say their unit; hover for a one-line explanation.
  const COLS: { label: string; tip: string }[] = [
    { label: "Base beer", tip: "One brew. Brands made from the same beer are listed under it." },
    { label: "Selling per week (bbl)", tip: "What distributors sell to stores each week, in barrels. From LilyPad store sales, last 3 full months (latest counted more); Coast and distributors with no LilyPad sales yet (Superior for now) are estimated from our deliveries. Everyone else: real store sales only, a delivery never counts as a sale." },
    { label: "At distributors (bbl)", tip: "Barrels sitting in distributor warehouses now: each one's newest Ekos count (estimated for Coast)." },
    { label: "Our warehouse (bbl)", tip: "Barrels of packaged beer in our warehouse, from this week's Inventory & Allocation." },
    { label: "In tank (bbl)", tip: "Barrels in our fermenters for this beer, with when they'll be packaged." },
    { label: "Weeks of beer left", tip: "(At distributors + our warehouse) ÷ selling per week. Doesn't count beer still in tank. Red under 2, amber under 4." },
    { label: "Runs out", tip: "The week distributors + our warehouse would hit zero at today's selling rate, counting tanks as they get packaged." },
    { label: "This cycle", tip: "Brew (and how many barrels to brew) or Hold, with the main reason. Click the row for the full explanation." },
  ];
  // Simple view (2026-10-30) — the default, for anyone who isn't used to the page.
  const SIMPLE_COLS: { label: string; tip: string }[] = [
    { label: "Beer", tip: "One brew. Brands made from the same beer are listed under it." },
    { label: "How much is left", tip: "How many weeks the beer at distributors and in our warehouse will last at today's sales. Doesn't count beer still in a tank." },
    { label: "Runs out", tip: "The week it would run out at today's sales, counting tanks as they get packaged." },
    { label: "What to do", tip: "Brew (and how many barrels) or Hold, and why. Click the beer for all the numbers." },
  ];
  const cols = allNumbers ? COLS : SIMPLE_COLS;
  const setView = (v: boolean) => {
    setAllNumbers(v);
    try {
      localStorage.setItem(VIEW_STORE, v ? "1" : "0");
    } catch {}
  };

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <span className="mb-3 inline-flex rounded-full border border-amber-500/60 bg-amber-500/10 px-2.5 py-0.5 text-xs font-semibold uppercase tracking-wide text-amber-300">Experimental</span>
          <div className="flex flex-wrap items-center gap-3">
            <h1 className="text-3xl font-semibold tracking-tight">Brew Planner</h1>
            <BrewPlannerGuide P={P} S={S} data={data} isNew={guideNew.isNew} onSeen={() => guideNew.dismiss()} />
          </div>
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
          <span className="ml-2 font-normal normal-case tracking-normal text-neutral-500">· Click a beer to see why</span>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <span className="w-12 text-[11px] font-semibold uppercase tracking-wide text-neutral-500">Brew</span>
          {brews.length === 0 && <span className="text-sm text-neutral-400">Nothing needed this cycle.</span>}
          {brews.map((p) => (
            <button
              key={p.base.key}
              type="button"
              onClick={() => setWhyKey(p.base.key)}
              title="See why"
              className="cursor-pointer rounded-full bg-[#6ABC46] px-3 py-1 text-[13px] font-semibold text-black hover:bg-[#7fcf5a] focus:outline-none focus-visible:ring-2 focus-visible:ring-white/60"
            >
              {p.base.name} · {p.rec.bbl} bbl{mangoLine(p) ? <span className="font-medium"> ({mangoLine(p)})</span> : null}
              <span className="ml-1.5 text-[11px] font-medium opacity-70">Why?</span>
            </button>
          ))}
          {brews.length > 0 && <span className="text-[13px] tabular-nums text-neutral-500">{brews.reduce((a, p) => a + p.rec.bbl, 0)} bbl total</span>}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <span className="w-12 text-[11px] font-semibold uppercase tracking-wide text-neutral-500">Hold</span>
          {holds.map((p) => (
            <button
              key={p.base.key}
              type="button"
              onClick={() => setWhyKey(p.base.key)}
              title="See why"
              className={`${PILL_HOLD} cursor-pointer hover:border-neutral-500 hover:text-neutral-200 focus:outline-none focus-visible:ring-2 focus-visible:ring-white/60`}
            >
              {p.base.name}
            </button>
          ))}
        </div>
      </section>

      {(() => {
        const wp = whyKey ? P.find((x) => x.base.key === whyKey) : null;
        if (!wp) return null;
        return (
          <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto p-4 sm:p-8" role="dialog" aria-modal="true" aria-label={`Why: ${wp.base.name}`}>
            <div className="absolute inset-0 bg-black/60" onClick={() => setWhyKey(null)} />
            <div className="relative w-full max-w-3xl rounded-xl border border-neutral-800 bg-neutral-950 p-4 shadow-2xl">
              <div className="mb-3 flex items-start justify-between gap-3">
                <div>
                  <h2 className="text-lg font-semibold">{wp.base.name}</h2>
                  {wp.base.brands.length > 1 && <p className="text-xs text-neutral-500">{wp.base.brands.map((b) => b.name).join(" · ")}</p>}
                </div>
                <button type="button" onClick={() => setWhyKey(null)} className="rounded-md border border-neutral-700 px-2.5 py-1 text-sm hover:border-[#6ABC46]">
                  Close
                </button>
              </div>
              <Detail p={wp} S={S} mix={mixes[wp.base.key]} full={false} />
            </div>
          </div>
        );
      })()}

      <section className={CARD} aria-label="Base beers">
        <div className="flex items-center justify-between border-b border-neutral-800 px-4 py-3">
          <h2 className="text-base font-semibold">Base beers</h2>
          <div className="flex flex-wrap items-center gap-3">
            <span className="flex items-center gap-1.5 text-xs text-neutral-500">
              Click a beer to see why it&apos;s recommended
              {whyNew.isNew && <NewBadge inline />}
            </span>
            <label className="flex cursor-pointer items-center gap-1.5 text-xs text-neutral-300">
              <input id="bp-all-numbers" type="checkbox" checked={allNumbers} onChange={(e) => setView(e.target.checked)} className="accent-[#6ABC46]" />
              Show all numbers
            </label>
          </div>
        </div>
        {/* Units key (2026-10-26) — clicking it clears its New! tag. */}
        <div
          className="flex flex-wrap items-center gap-x-2 gap-y-1 border-b border-neutral-800 bg-white/[0.02] px-4 py-2.5 text-[12.5px] text-neutral-300"
          onClick={() => unitsNew.dismiss()}
        >
          {unitsNew.isNew && <NewBadge inline />}
          {!allNumbers ? (
            <span>
              <b className="text-neutral-100">Amounts are in barrels (bbl).</b> 1 bbl = 2 half-barrel kegs, or about 10 cases of 16oz cans.
            </span>
          ) : (
          <span>
            <b className="text-neutral-100">All numbers are barrels (bbl) of beer.</b> 1 bbl = 31 gallons ≈ 2 half-barrel kegs (6 sixtels) ≈ 10 cases of
            16oz 4-packs ≈ 14 cases of 12oz 6-packs. The gray line under a number turns it into cases and kegs, using that beer&apos;s recent can / keg mix
            from LilyPad. Hover a column name for what it means.
          </span>
          )}
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr>
                {cols.map((c) => (
                  <th key={c.label} className={`${allNumbers ? th : thS} cursor-help`} title={c.tip}>{c.label}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {P.map((p) => {
                const next = p.tanks.filter((t) => !t.ready).sort((a, b) => a.pkg.getTime() - b.pkg.getTime())[0];
                const ready = p.tanks.some((t) => t.ready);
                const isOpen = open.has(p.base.key);
                const mix = mixes[p.base.key];
                const cv = (bbl: number) => conv(bbl, mix);
                const notes = rowNotes(p, S);
                const noteList =
                  notes.length > 0 ? (
                    <span className="mt-1 block max-w-[260px] text-[12px] leading-snug text-amber-300">{notes.join(" ")}</span>
                  ) : null;
                const brewPill = (
                  <span className={`${p.rec.action === "Brew" ? PILL_BREW : PILL_HOLD} whitespace-nowrap`}>{p.rec.action === "Brew" ? `Brew ${p.rec.bbl} bbl` : "Hold"}</span>
                );
                return (
                  <Fragment key={p.base.key}>
                    <tr
                      className="cursor-pointer border-t border-neutral-800 hover:bg-white/[0.03]"
                      tabIndex={0}
                      aria-expanded={isOpen}
                      onClick={() => {
                        toggle(p.base.key);
                        whyNew.dismiss();
                      }}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" || e.key === " ") {
                          e.preventDefault();
                          toggle(p.base.key);
                          whyNew.dismiss();
                        }
                      }}
                    >
                      <td className={allNumbers ? td : `${tdS} w-[30%]`}>
                        <span className="font-semibold">{p.base.name}</span>
                        {p.base.brands.length > 1 && <span className="block max-w-[260px] whitespace-normal text-xs text-neutral-500">{p.base.brands.map((b) => b.name).join(" · ")}</span>}
                      </td>
                      {!allNumbers ? (
                        <>
                          <td className={`${tdS} w-[18%] tabular-nums`}>
                            {p.cover === null ? (
                              <span className="text-neutral-500">No sales</span>
                            ) : (
                              <>
                                <Cover w={p.cover} /> <span className="ml-1 text-[13px]">weeks</span>
                                <span className="mt-1 block text-[12px] text-neutral-400">{coverWord(p.cover)}</span>
                              </>
                            )}
                          </td>
                          <td className={`${tdS} w-[17%]`}>{p.runout ? fmtDay(p.runout) : p.demand ? "Not in the next 10 weeks" : "–"}</td>
                          <td className={tdS}>
                            {brewPill}
                            {mangoLine(p) && <span className="mt-1 block text-[12px] text-neutral-400">{mangoLine(p)}</span>}
                            <span className="mt-1.5 block text-[13px] leading-snug text-neutral-300">{simpleReason(p, S)}</span>
                            {noteList}
                          </td>
                        </>
                      ) : (
                        <>
                          <td className={td}>
                            {r1(p.demand)} bbl
                            {cv(p.demand) && <span className={sub}>{cv(p.demand)} a week</span>}
                            {p.commitNow > 0 && <span className="block text-[11px] text-[#c9a6f2]">+{r1(p.commitNow)} bbl committed</span>}
                            <PotBar p={p} />
                          </td>
                          <td className={td}>
                            {r1(p.dstock)} bbl
                            {cv(p.dstock) && <span className={sub}>{cv(p.dstock)}</span>}
                          </td>
                          <td className={td}>
                            {r1(p.wh)} bbl
                            {cv(p.wh) && <span className={sub}>{cv(p.wh)}</span>}
                          </td>
                          <td className={td}>
                            {p.inTank ? `${r1(p.inTank)} bbl` : "–"}
                            <span className={sub}>{[next ? `packaged ~${fmtDay(next.pkg)}` : null, ready ? "ready now" : null].filter(Boolean).join(" · ")}</span>
                          </td>
                          <td className={td}>
                            <Cover w={p.cover} />
                            {p.cover !== null && <span className={sub}>weeks</span>}
                          </td>
                          <td className={td}>{p.runout ? fmtDay(p.runout) : p.demand ? "10+ wks" : "–"}</td>
                          <td className={`${td} whitespace-normal`}>
                            {brewPill}
                            {mangoLine(p) && <span className="mt-1 block text-[11px] text-neutral-500">{mangoLine(p)}</span>}
                            <span className="ml-auto mt-1 block max-w-[220px] text-[11px] leading-snug text-neutral-400">{shortReason(p, S)}</span>
                            {noteList}
                          </td>
                        </>
                      )}
                    </tr>
                    {isOpen && (
                      <tr className="bg-neutral-900/40">
                        <td colSpan={cols.length} className="p-4"><Detail p={p} S={S} mix={mix} full={allNumbers} /></td>
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

      <div>
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
          <p className="px-4 pt-3 text-[11px] text-neutral-500">Saved in this browser only.</p>
          <div className="grid gap-x-8 gap-y-2.5 p-4 md:grid-cols-2 xl:grid-cols-3">
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
        Numbers: LilyPad store sales (last 3 full months, latest counted more), each distributor&apos;s newest Ekos count, delivered POs for Coast and any distributor without LilyPad sales yet, this week&apos;s Inventory &amp; Allocation minus delivered POs, and the Ekos tank sync. 1 case-equivalent = 2.25 gal (13.78 per bbl). Base beers: Big Daddy + Capt. WC are one brew; Capt. Hazy + Juicy + Mystic Haze + Mango Bomb (pulled off) are one brew; Metropolis + Victory Vibes + Lime 30 (pulled off, lime added) are one brew.
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
