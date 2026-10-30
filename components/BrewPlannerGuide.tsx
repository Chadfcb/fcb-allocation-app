"use client";

import { useEffect, useState, type ReactNode } from "react";
import { BASES, addDays, fmtDay, r1, type Plan, type PlannerData, type Settings } from "@/lib/brewPlanner";

// Brew Planner → "How this works" (added 2026-10-30, per Chad: "its very hard
// to explain this to my sales manager, i need a button we can click on, that
// explains the process, and if we see something missing we can have you add
// it" + "Whatever we build has to be easily understandable for other people").
// Written for someone who wasn't part of building the planner. Uses today's
// real numbers and the current settings so the examples always match the page.
// KEEP THIS IN SYNC with lib/brewPlanner.ts (the math) and
// components/BrewPlannerClient.tsx (the screens) whenever either changes.

const K = ({ children }: { children: ReactNode }) => <strong className="text-neutral-100">{children}</strong>;
const Steps = ({ children }: { children: ReactNode }) => <ol className="list-decimal space-y-1.5 pl-5">{children}</ol>;
const Bullets = ({ children }: { children: ReactNode }) => <ul className="list-disc space-y-1.5 pl-5">{children}</ul>;
const Note = ({ children }: { children: ReactNode }) => (
  <p className="rounded-lg border border-neutral-800 bg-neutral-900/60 px-3 py-2 text-xs text-neutral-400">{children}</p>
);
const Example = ({ children }: { children: ReactNode }) => (
  <div className="rounded-lg border border-[#6ABC46]/40 bg-[#6ABC46]/5 px-3 py-2.5 text-[13px]">
    <div className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-[#8fd46b]">Example with today&apos;s numbers</div>
    {children}
  </div>
);

type Section = { id: string; title: string; body: ReactNode };

function sections(P: Plan[], S: Settings, data: PlannerData): Section[] {
  // The worked example: the first beer it says to brew (or the first beer at all).
  const ex = P.find((p) => p.rec.action === "Brew") ?? P.find((p) => p.demand > 0) ?? P[0];
  const exLead = ex ? S.lead[ex.base.key] ?? ex.base.lead : 0;
  const exHave = ex ? ex.dstock + ex.wh : 0;
  const exArriving = ex ? ex.tanks.filter((t) => t.pkg <= ex.land).reduce((a, t) => a + t.out, 0) : 0;
  const exRate = ex ? ex.rec.rateNext ?? ex.demand : 0;
  const hold = P.find((p) => p.rec.action === "Hold" && (p.rec.rateNext ?? 0) > 0 && (p.rec.nextLand ?? 0) >= (p.rec.rateNext ?? 0) * S.safetyWeeks);
  const sizes = String(S.sizes);

  return [
    {
      id: "short",
      title: "The short version",
      body: (
        <>
          <p>
            The Brew Planner answers one question every {S.cycleWeeks} weeks: <K>which beers do we need to brew now, and how much</K>, so we
            don&apos;t brew so much that it sits in a tank for months, and don&apos;t brew so little that distributors get shorted.
          </p>
          <p>For each beer it does four things:</p>
          <Steps>
            <li><K>How fast is it selling?</K> Barrels a week that distributors sell to stores.</li>
            <li><K>How much do we have?</K> Beer at the distributors + in our warehouse + in our tanks.</li>
            <li><K>If we brewed today, how much would be left when that batch is ready?</K></li>
            <li><K>Could it wait {S.cycleWeeks} more weeks?</K> If waiting still leaves at least {S.safetyWeeks} weeks of beer, it says Hold. If not, it says Brew, and picks a batch size big enough to get us through the next {S.cycleWeeks + S.targetWeeks} weeks.</li>
          </Steps>
          <Note>
            Every number on the page is <K>barrels (bbl) of finished beer</K>. 1 bbl = 31 gallons = 2 half-barrel kegs ≈ 10 cases of 16oz cans. The
            planner is a helper, not the final word: check it against what you know before brewing.
          </Note>
        </>
      ),
    },
    {
      id: "reading",
      title: "Reading the page, top to bottom",
      body: (
        <>
          <Bullets>
            <li>
              <K>The labels at the top right</K> show when each source of numbers was last updated (LilyPad sales, distributor counts, our
              warehouse, our tanks). An <span className="text-amber-300">orange</span> label means that source is out of date, so treat the
              results with care.
            </li>
            <li>
              <K>This cycle box</K>: the answer. Beers under <K>Brew</K> (with how many barrels) and beers under <K>Hold</K>. It also shows how many
              fermenters are empty right now.
            </li>
            <li>
              <K>Base beers table</K>: one row per beer we brew, with three things:
              <Bullets>
                <li>
                  <K>How much is left</K>: how many weeks the beer at distributors and in our warehouse will last, with a word:{" "}
                  <span className="text-red-300">Low</span> (under 2 weeks), <span className="text-amber-300">Getting low</span> (under 4) or{" "}
                  <span className="text-[#8fd46b]">Plenty</span>.
                </li>
                <li><K>Runs out</K>: the week it would run out at today&apos;s sales.</li>
                <li><K>What to do</K>: Brew (and how many barrels) or Hold, and why in one line.</li>
              </Bullets>
            </li>
            <li>
              <span className="text-amber-300">Yellow notes</span> under What to do point out something worth checking, like beer sitting ready
              in a tank, a brand almost out, or a distributor running low.
            </li>
            <li>
              <K>Click any beer</K> to see <K>why</K> it says Brew or Hold, in plain words. With Show all numbers on, you also get a 10-week
              chart, where the demand comes from, how it splits between brands, each distributor, and what&apos;s in the tanks.
            </li>
            <li>
              <K>Show all numbers</K> (top right of the table) adds the full columns back (selling per week, at distributors, our warehouse and
              in tank) and the extra detail when you click a beer. Your choice is remembered in your browser.
            </li>
            <li><K>Commitments</K>: accounts that promised to buy a set amount. These raise that beer&apos;s demand (more below).</li>
            <li><K>Settings</K>: the rules the planner uses. Changing one updates the whole page right away.</li>
          </Bullets>
        </>
      ),
    },
    {
      id: "sources",
      title: "Where the numbers come from",
      body: (
        <>
          <p>Nobody types these in. They come from the systems we already use, updated automatically:</p>
          <Bullets>
            <li>
              <K>Sales: LilyPad.</K> What each distributor sold to each store. Updated every morning, but distributors report to LilyPad about a{" "}
              <K>week late</K>, so the newest sales are usually about a week old.
            </li>
            <li><K>Beer at distributors: Ekos.</K> Each distributor&apos;s newest inventory count.</li>
            <li><K>Our warehouse: Inventory &amp; Allocation</K> in this app (packaged beer on hand).</li>
            <li><K>Our tanks: Ekos.</K> What&apos;s in each fermenter, when it was brewed, and whether it&apos;s ready. Updated every morning.</li>
            <li><K>Deliveries: our purchase orders</K> marked delivered. Used where we don&apos;t have store sales (see the next section).</li>
          </Bullets>
          {data.fresh.length > 0 && (
            <Note>
              Right now: {data.fresh.map((f, i) => (
                <span key={f.label}>{i > 0 && " · "}<K>{f.label}</K> {f.value}</span>
              ))}
            </Note>
          )}
        </>
      ),
    },
    {
      id: "bases",
      title: "Base beers: why some brands are grouped together",
      body: (
        <>
          <p>
            Some of our brands are the <K>same beer in the tank</K>. We brew it once and package it under different names, so the planner adds
            their sales together and plans one brew for all of them:
          </p>
          <Bullets>
            {BASES.filter((b) => b.brands.length > 1).map((b) => (
              <li key={b.key}>
                <K>{b.name}</K> = {b.brands.map((x) => x.name + (x.pullOff ? " (pulled off the batch and finished separately)" : "")).join(" + ")}
              </li>
            ))}
            <li>Everything else is one beer, one brew.</li>
          </Bullets>
          <p>
            When it says Brew for a grouped beer, the <K>brand split</K> (click the row) shows how much of the batch goes to each brand, based on
            each brand&apos;s share of sales. For Mango Bomb it shows how much to pull off before finishing it.
          </p>
        </>
      ),
    },
    {
      id: "selling",
      title: "How it figures \"selling per week\"",
      body: (
        <>
          <p>
            It looks at what distributors sold to stores over the <K>last 3 full months</K>, with the most recent month counted{" "}
            {S.recentWeight === 1 ? "the same as the others" : `${S.recentWeight} times as much`} (so it reacts to a beer speeding up or slowing
            down), and turns that into barrels a week.
          </p>
          <p>Every distributor gets a label in the By distributor table showing how good its numbers are:</p>
          <Bullets>
            <li><span className="rounded bg-[#6ABC46]/15 px-1.5 text-[11px] font-semibold text-[#8fd46b]">Measured</span> real inventory count + real store sales. The most reliable.</li>
            <li><span className="rounded bg-sky-500/15 px-1.5 text-[11px] font-semibold text-sky-300">Partly measured</span> real inventory count, but no store sales yet, so sales are worked out from what we&apos;ve delivered to them.</li>
            <li><span className="rounded bg-amber-500/15 px-1.5 text-[11px] font-semibold text-amber-300">Estimated</span> no count and no store sales (Coast today). Both are worked out from our deliveries: what we shipped, minus what they likely sold.</li>
          </Bullets>
          <p>A distributor moves up a label on its own as soon as the better data shows up.</p>
          <p className="font-semibold text-neutral-100">Which stores count</p>
          <Bullets>
            <li><K>Recurring accounts</K> (buying regularly): counted.</li>
            <li><K>New accounts</K> (first order in the last 60 days): counted at {S.newPct}% (a setting), since some won&apos;t reorder.</li>
            <li>
              <K>Lost accounts</K> (no order in 60+ days): <K>never counted</K>. We don&apos;t assume they&apos;ll come back. If one starts
              buying again, it counts again on its own.
            </li>
            <li><K>Saccani</K> is closed. Its old sales aren&apos;t counted unless you set how much is moving to Mussetter.</li>
          </Bullets>
          <p>Click a row and look at <K>Where demand comes from</K> to see this broken down for that beer.</p>
        </>
      ),
    },
    {
      id: "decide",
      title: "How it decides Brew or Hold",
      body: (
        <>
          <Steps>
            <li>
              <K>When would a new batch be ready?</K> Today + the days from brew day to packaged for that beer (a setting; it&apos;s different for
              hazies, ales and lagers).
            </li>
            <li>
              <K>How much beer is left by then?</K> Beer at distributors + our warehouse, plus any tank that gets packaged before then, minus what
              sells in the meantime. Tank beer is counted at {S.yieldPct}% because some is lost in packaging.
            </li>
            <li>
              <K>Could it wait one more cycle?</K> It pretends we wait {S.cycleWeeks} more weeks and checks how much would be left when <i>that</i>{" "}
              batch is ready. If that&apos;s still <K>{S.safetyWeeks} weeks of sales or more</K>, it says <K>Hold</K>. If not, it says <K>Brew</K>.
            </li>
            <li>It also says Hold if the amount needed is under {S.minBrew} bbl, the smallest batch worth brewing.</li>
          </Steps>
          {ex && ex.rec.action === "Brew" && (
            <Example>
              <p>
                <K>{ex.base.name}</K> sells about <K>{r1(ex.demand)} bbl a week</K>. Right now there&apos;s {r1(ex.dstock)} bbl at distributors and{" "}
                {r1(ex.wh)} bbl in our warehouse ({r1(exHave)} bbl).
              </p>
              <p className="mt-1">
                Brewed today, it would be ready about <K>{fmtDay(ex.land)}</K> ({exLead} days).{" "}
                {exArriving > 0 ? `Tanks add ${r1(exArriving)} bbl before then. ` : "No tank gets packaged before then. "}
                {ex.atLand > 0 ? (
                  <>About <K>{r1(ex.atLand)} bbl</K> would be left that day.</>
                ) : (
                  <>Distributors would <K>run out</K> before that day.</>
                )}
              </p>
              <p className="mt-1">
                If we waited {S.cycleWeeks} weeks instead, that batch would be ready about {fmtDay(addDays(ex.land, S.cycleWeeks * 7))} with{" "}
                {(ex.rec.nextLand ?? 0) > 0 ? (
                  <>only <K>{r1((ex.rec.nextLand ?? 0) / (exRate || 1))} weeks</K> of beer left</>
                ) : (
                  <K>nothing left</K>
                )}
                . That&apos;s under the {S.safetyWeeks}-week line, so: <K>Brew</K>.
              </p>
            </Example>
          )}
          {hold && (
            <Example>
              <p>
                <K>{hold.base.name}</K>: even if we wait {S.cycleWeeks} weeks, there would still be about{" "}
                <K>{r1((hold.rec.nextLand ?? 0) / (hold.rec.rateNext || 1))} weeks</K> of beer when that batch is ready. That&apos;s at least{" "}
                {S.safetyWeeks} weeks, so: <K>Hold</K>.
              </p>
            </Example>
          )}
        </>
      ),
    },
    {
      id: "howmuch",
      title: "How it picks how much to brew",
      body: (
        <>
          <Steps>
            <li>
              <K>How much do we need?</K> Enough to cover the {S.cycleWeeks} weeks until the next brew <i>plus</i> {S.targetWeeks} weeks of stock
              ({S.cycleWeeks + S.targetWeeks} weeks of sales in all).
            </li>
            <li><K>Take off</K> what will still be there when the batch is ready.</li>
            <li><K>Add packaging loss</K>: we only get about {S.yieldPct}% of the tank into cans and kegs.</li>
            <li><K>Round up</K> to the next batch size we brew: {sizes} bbl.</li>
            <li>
              <K>Over-brew check:</K> if that batch would take more than {S.maxDays} days to sell, it drops one size, as long as the smaller batch
              still lasts until the next brew.
            </li>
          </Steps>
          {ex && ex.rec.action === "Brew" && ex.rec.required !== undefined && (
            <Example>
              <p>
                <K>{ex.base.name}</K>: {S.cycleWeeks + S.targetWeeks} weeks × {r1(ex.demand)} bbl ≈ <K>{r1(ex.rec.required)} bbl needed</K>
                {ex.commitNow > 0 ? " (including commitments)" : ""}. {ex.atLand > 0.05 ? `Minus the ${r1(ex.atLand)} bbl still there, ` : "Nothing will be left, so "}
                that&apos;s {r1(ex.rec.need ?? 0)} bbl in the tank after packaging loss. The batch size is <K>{ex.rec.bbl} bbl</K>
                {ex.rec.sell !== undefined ? <>, which lasts about {Math.round(ex.rec.sell)} days once packaged</> : null}.
              </p>
            </Example>
          )}
        </>
      ),
    },
    {
      id: "commitments",
      title: "Commitments",
      body: (
        <>
          <p>
            Use the <K>Commitments</K> section when an account or chain commits to buying a set amount, like a new chain placement, before it
            shows up in LilyPad.
          </p>
          <Steps>
            <li>Enter the account, distributor, product, how many cases or kegs, per week or per month, and the start date (end date is optional).</li>
            <li>From the start date on, that amount is added to the beer&apos;s selling rate, and the Brew / Hold call and batch size update.</li>
            <li>Click the beer&apos;s row to see the call <K>with and without</K> the commitments side by side.</li>
          </Steps>
          <Note>Once the account is really ordering, its sales show up in LilyPad too, so end the commitment then. Otherwise it gets counted twice.</Note>
        </>
      ),
    },
    {
      id: "settings",
      title: "What the settings mean",
      body: (
        <>
          <Bullets>
            <li><K>Weeks of stock when a batch lands</K> ({S.targetWeeks}): how much cushion each batch should build up.</li>
            <li><K>Weeks between brews</K> ({S.cycleWeeks}): how often we decide what to brew.</li>
            <li><K>Brew now if waiting leaves under</K> ({S.safetyWeeks} weeks): the safety line. Higher = brews sooner.</li>
            <li><K>Over-brew limit</K> ({S.maxDays} days): longest we want a batch to take to sell.</li>
            <li><K>Packaging yield</K> ({S.yieldPct}%): how much of the tank ends up in cans and kegs.</li>
            <li><K>Batch sizes</K> ({sizes} bbl) and <K>Smallest batch worth brewing</K> ({S.minBrew} bbl).</li>
            <li><K>Weight on last month</K> ({S.recentWeight}): how much more the newest month counts.</li>
            <li><K>Saccani sales moving to Mussetter</K> ({S.saccaniPct}%) and <K>Count New accounts at</K> ({S.newPct}%).</li>
            <li><K>Days to package</K> for each beer: brew day to packaged. These started as guesses.</li>
          </Bullets>
          <Note>
            Settings are saved <K>in your own browser only</K>. Someone else (or you on another computer) may have different settings and see
            different answers. <K>Reset</K> puts them back to the standard ones.
          </Note>
        </>
      ),
    },
    {
      id: "limits",
      title: "What it can't see yet",
      body: (
        <Bullets>
          <li><K>Days to package are guesses</K> to start, not taken from our real brewing history.</li>
          <li>
            <K>Store sales only.</K> If a distributor&apos;s stock drops faster than its store sales show (for example, they&apos;re stocking new
            accounts), it can run out sooner than the page shows.
          </li>
          <li><K>Coast is estimated</K> from our deliveries until we get their inventory.</li>
          <li><K>Tank space, ingredients and cans aren&apos;t checked.</K> It shows how many fermenters are empty but doesn&apos;t plan around them.</li>
          <li><K>Beer ready in a tank</K> is counted from next week, as if it gets packaged then.</li>
          <li>The chart and the run-out date <K>don&apos;t include</K> the batch it recommends brewing.</li>
        </Bullets>
      ),
    },
    {
      id: "missing",
      title: "See something missing or wrong?",
      body: (
        <>
          <p>The planner is still being dialed in, and this guide grows with it. When something doesn&apos;t look right or isn&apos;t explained here:</p>
          <Steps>
            <li>Write down <K>which beer</K>, <K>what the page said</K>, and <K>what you expected</K> (a screenshot helps).</li>
            <li>Pass it along to get it fixed or added to this guide.</li>
          </Steps>
        </>
      ),
    },
  ];
}

/** "How this works" button + the slide-out guide on the Brew Planner. */
export default function BrewPlannerGuide({ P, S, data, isNew, onSeen }: { P: Plan[]; S: Settings; data: PlannerData; isNew?: boolean; onSeen?: () => void }) {
  const [show, setShow] = useState(false);
  const [open, setOpen] = useState<string | null>("short");
  useEffect(() => {
    if (!show) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setShow(false);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [show]);
  const list = sections(P, S, data);
  return (
    <>
      <button
        type="button"
        onClick={() => {
          setShow(true);
          onSeen?.();
        }}
        className="inline-flex items-center gap-1.5 rounded-md border border-[#6ABC46]/60 bg-[#6ABC46]/10 px-3 py-1.5 text-sm font-semibold text-[#8fd46b] hover:bg-[#6ABC46]/20"
      >
        <span aria-hidden className="flex h-4 w-4 items-center justify-center rounded-full border border-current text-[10px]">?</span>
        How this works
        {isNew && <span className="rounded bg-[#6ABC46] px-1 text-[10px] font-bold text-black">New!</span>}
      </button>
      {show && (
        <div className="fixed inset-0 z-50 flex justify-end" role="dialog" aria-modal="true" aria-label="How the Brew Planner works">
          <div className="absolute inset-0 bg-black/60" onClick={() => setShow(false)} />
          <div className="relative flex h-full w-full max-w-2xl flex-col border-l border-neutral-800 bg-neutral-950 shadow-2xl">
            <div className="flex items-start justify-between gap-3 border-b border-neutral-800 px-5 py-4">
              <div>
                <h2 className="text-lg font-semibold">How the Brew Planner works</h2>
                <p className="text-xs text-neutral-500">Plain-English guide. Examples use today&apos;s numbers and your current settings.</p>
              </div>
              <button type="button" onClick={() => setShow(false)} className="rounded-md border border-neutral-700 px-2.5 py-1 text-sm hover:border-[#6ABC46]">
                Close
              </button>
            </div>
            <div className="flex-1 space-y-2 overflow-y-auto p-5">
              {list.map((s, i) => (
                <div key={s.id} className="rounded-xl border border-neutral-800 bg-neutral-900/40">
                  <button
                    type="button"
                    onClick={() => setOpen((o) => (o === s.id ? null : s.id))}
                    className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left"
                    aria-expanded={open === s.id}
                  >
                    <span className="font-semibold text-neutral-100">
                      <span className="mr-2 text-neutral-500">{i + 1}.</span>
                      {s.title}
                    </span>
                    <span className="shrink-0 text-xs text-neutral-500">{open === s.id ? "Hide" : "Show"}</span>
                  </button>
                  {open === s.id && <div className="space-y-3 border-t border-neutral-800 px-4 py-3 text-sm leading-relaxed text-neutral-300">{s.body}</div>}
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </>
  );
}
