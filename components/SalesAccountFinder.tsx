"use client";

// Sales Dashboard → Account Finder (added 2026-10-28, per Chad). Same search
// as the distributor pages' account search, but across EVERY distributor:
// type a name, store number ("#667"), city, street address or outlet id → pick
// one → the usual account pop-up (address, phone, contacts, what they buy,
// recent check-ins). SQL: sales_account_finder() in
// sql/sales_dashboard_quick_links.sql.

import { useEffect, useRef, useState } from "react";
import type { Supa } from "@/components/SalesDashboardClient";
import { AccountPopup } from "@/components/DistributorPageClient";
import { MUTED, Dot, Modal } from "@/components/SalesDashboardHome";
import { REP_BY_DISTRIBUTOR } from "@/lib/salesAccounts";
import { distColor, fmtDay } from "@/lib/salesDashHome";

interface FindRow {
  outlet_id: string;
  name: string;
  city: string | null;
  address: string | null;
  premise: string | null;
  distributor: string | null;
  last_buy_date: string | null;
  is_off: boolean;
}

export default function SalesAccountFinder({ supabase, onClose }: { supabase: Supa; onClose: () => void }) {
  const [q, setQ] = useState("");
  const [rows, setRows] = useState<FindRow[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [hi, setHi] = useState(0);
  const [openId, setOpenId] = useState<string | null>(null);
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!openId) input.current?.focus();
  }, [openId]);

  useEffect(() => {
    const term = q.trim();
    if (term.length < 2) return;
    let cancelled = false;
    const t = setTimeout(async () => {
      const { data, error } = await supabase.rpc("sales_account_finder", { p_q: term });
      if (cancelled) return;
      if (error) {
        setErr(error.message);
        setRows([]);
      } else {
        setErr(null);
        setRows((data as FindRow[]) ?? []);
        setHi(0);
      }
    }, 250);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [supabase, q]);

  // The account pop-up replaces the finder while it's open; closing it comes
  // back to the same search results.
  if (openId) return <AccountPopup supabase={supabase} outletId={openId} onClose={() => setOpenId(null)} />;

  const list = q.trim().length >= 2 ? rows : null;

  return (
    <Modal title="Account Finder" sub="Every distributor's accounts — search by name, store # (like #667), city or street address" onClose={onClose}>
      <div className="flex flex-col gap-3">
        <div className="relative">
          <svg viewBox="0 0 24 24" className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-neutral-500" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
            <circle cx="11" cy="11" r="7" />
            <path d="m20 20-3.5-3.5" />
          </svg>
          <input
            ref={input}
            type="search"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => {
              if (!list?.length) return;
              if (e.key === "ArrowDown") {
                e.preventDefault();
                setHi((h) => Math.min(h + 1, list.length - 1));
              } else if (e.key === "ArrowUp") {
                e.preventDefault();
                setHi((h) => Math.max(h - 1, 0));
              } else if (e.key === "Enter") {
                e.preventDefault();
                if (list[hi]) setOpenId(list[hi].outlet_id);
              }
            }}
            placeholder="Start typing an account name…"
            aria-label="Search all accounts"
            className="min-h-10 w-full rounded-full border border-neutral-700 bg-neutral-950 py-2 pl-9 pr-3 text-sm text-neutral-100 placeholder:text-neutral-500 focus:border-[#6abc46] focus:outline-none"
          />
        </div>
        {q.trim().length < 2 ? (
          <p className={`text-sm ${MUTED}`}>Type at least 2 letters.</p>
        ) : !list ? (
          <p className={`text-sm ${MUTED}`}>Searching…</p>
        ) : err ? (
          <p className="text-sm text-red-300">{err}</p>
        ) : list.length === 0 ? (
          <p className={`text-sm ${MUTED}`}>No accounts match &ldquo;{q.trim()}&rdquo;.</p>
        ) : (
          <div className="flex max-h-[55vh] flex-col overflow-y-auto rounded-lg border border-neutral-800">
            {list.map((r, i) => (
              <button
                key={r.outlet_id}
                type="button"
                onMouseEnter={() => setHi(i)}
                onClick={() => setOpenId(r.outlet_id)}
                className={`flex w-full items-center gap-3 border-t border-neutral-900 px-3 py-2.5 text-left first:border-t-0 ${i === hi ? "bg-neutral-800/70" : "hover:bg-neutral-900"}`}
              >
                <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                  <span className="flex items-center gap-2 text-sm font-semibold text-neutral-100">
                    <span className="truncate">{r.name}</span>
                    {r.is_off && <span className="rounded bg-neutral-700 px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-neutral-300">turned off</span>}
                  </span>
                  <span className={`text-[12px] ${MUTED}`}>
                    {[r.address, r.city, r.premise === "On" ? "On-premise" : r.premise === "Off" ? "Off-premise" : null, r.last_buy_date ? `last order ${fmtDay(r.last_buy_date)}` : "no orders on record"]
                      .filter(Boolean)
                      .join(" · ")}
                  </span>
                </span>
                {r.distributor && (
                  <span className="flex shrink-0 items-center gap-1.5 text-[12px] text-neutral-300">
                    <Dot color={distColor(r.distributor)} />
                    {r.distributor}
                    {REP_BY_DISTRIBUTOR[r.distributor] ? <span className="text-neutral-500">· {REP_BY_DISTRIBUTOR[r.distributor]}</span> : null}
                  </span>
                )}
              </button>
            ))}
          </div>
        )}
        {list && list.length >= 40 && <p className="text-xs text-neutral-500">Showing the first 40 — type more to narrow it down.</p>}
      </div>
    </Modal>
  );
}
