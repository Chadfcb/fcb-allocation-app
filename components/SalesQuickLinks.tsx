"use client";

// The button row right under the Sales Dashboard title (added 2026-10-28, per
// Chad — the new sales manager kept asking where these were): "Distributor
// Inventory, Chain Gap Report, UPC's, POS, Account Finder — Those are the
// buttons i want under the sales Dashboard."
//   Distributor Inventory → the sales-friendly inventory tab (SalesDistInventory)
//   Chain Gap Report      → the Gap Report tab
//   UPC's                 → a menu of the UPC's pages (brand → size); only for
//                           people with UPC's access
//   POS                   → Football POS; only for people with POS access
//   Account Finder        → search every distributor's accounts (SalesAccountFinder)

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import NewBadge from "@/components/NewBadge";
import { useNewFeature } from "@/lib/newFeatures";
import { UPC_BRANDS } from "@/lib/appPages";

const BTN =
  "inline-flex min-h-10 items-center gap-2 whitespace-nowrap rounded-full border px-4 text-[13.5px] font-semibold transition";
const OFF = "border-neutral-700 bg-neutral-950 text-neutral-200 hover:border-[#6abc46]/50 hover:text-neutral-50";
const ON = "border-[#6abc46]/45 bg-gradient-to-r from-[#6abc46]/25 to-[#6abc46]/5 text-neutral-50 shadow-[0_0_24px_rgba(106,188,70,0.14)]";

function Icon({ d }: { d: string }) {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className="text-[#9edc7f]">
      <path d={d} />
    </svg>
  );
}
const ICONS = {
  inv: "M3 9l9-6 9 6v11a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1zM9 21v-8h6v8",
  gap: "M4 6h16M4 12h10M4 18h6M18 15l3 3-3 3",
  upc: "M4 5v14M7 5v14M10 5v14M14 5v14M16 5v14M20 5v14",
  pos: "M4 4h16v12H4zM8 20h8M12 16v4",
  find: "M11 4a7 7 0 1 0 0 14 7 7 0 0 0 0-14zM20 20l-3.5-3.5",
};

export default function SalesQuickLinks({
  tab,
  canUpcs,
  canPos,
  onInventory,
  onGap,
  onFinder,
}: {
  tab: string;
  canUpcs: boolean;
  canPos: boolean;
  onInventory: () => void;
  onGap: () => void;
  onFinder: () => void;
}) {
  const invNew = useNewFeature("feature:sales-dist-inventory");
  const finderNew = useNewFeature("feature:sales-account-finder");
  const [upcOpen, setUpcOpen] = useState(false);
  const upcRef = useRef<HTMLDivElement>(null);

  // Close the UPC's menu on a click outside it or Esc.
  useEffect(() => {
    if (!upcOpen) return;
    const onDown = (e: MouseEvent) => {
      if (upcRef.current && !upcRef.current.contains(e.target as Node)) setUpcOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setUpcOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    window.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      window.removeEventListener("keydown", onKey);
    };
  }, [upcOpen]);

  return (
    <div className="flex flex-wrap items-center gap-2">
      <button
        id="sales-link-inventory"
        type="button"
        onClick={() => {
          invNew.dismiss();
          onInventory();
        }}
        className={`${BTN} ${tab === "inv" ? ON : OFF}`}
      >
        <Icon d={ICONS.inv} />
        Distributor Inventory
        {invNew.isNew && <NewBadge inline />}
      </button>
      <button id="sales-link-gap" type="button" onClick={onGap} className={`${BTN} ${tab === "gap" ? ON : OFF}`}>
        <Icon d={ICONS.gap} />
        Chain Gap Report
      </button>
      {canUpcs && (
        <div ref={upcRef} className="relative">
          <button id="sales-link-upcs" type="button" aria-expanded={upcOpen} onClick={() => setUpcOpen((o) => !o)} className={`${BTN} ${upcOpen ? ON : OFF}`}>
            <Icon d={ICONS.upc} />
            UPC&apos;s
            <span className="text-[10px] text-neutral-400">▾</span>
          </button>
          {upcOpen && (
            <div className="absolute left-0 top-full z-40 mt-1.5 w-64 rounded-xl border border-neutral-700 bg-neutral-950 p-2 shadow-2xl">
              {UPC_BRANDS.map((b) => (
                <div key={b.treeKey} className="py-1">
                  <div className="px-2 pb-0.5 text-[11px] font-semibold uppercase tracking-wide text-neutral-500">{b.label}</div>
                  {b.sizes.map((s) => (
                    <Link key={s.href} href={s.href} className="block rounded-md px-2 py-1 text-[13px] text-neutral-200 hover:bg-neutral-800 hover:text-neutral-50">
                      {s.label}
                    </Link>
                  ))}
                </div>
              ))}
            </div>
          )}
        </div>
      )}
      {canPos && (
        <Link id="sales-link-pos" href="/pos/football" className={`${BTN} ${OFF}`}>
          <Icon d={ICONS.pos} />
          POS
        </Link>
      )}
      <button
        id="sales-link-finder"
        type="button"
        onClick={() => {
          finderNew.dismiss();
          onFinder();
        }}
        className={`${BTN} ${OFF}`}
      >
        <Icon d={ICONS.find} />
        Account Finder
        {finderNew.isNew && <NewBadge inline />}
      </button>
    </div>
  );
}
