"use client";

// Remove from lists (2026-11-02, per Chad): "we need a way for our sales reps,
// or anyone for that matter, to be able to remove an account from a list" —
// e.g. Plank, closed for a month, still on James's target list.
//
// Lives in the account pop-up (every list's click-through). Anyone who can see
// that distributor's accounts can remove one, with a reason. It goes on the
// turned-off list (sales_account_off), which every sales list, dashboard,
// route count, James's targets and Sales → Accounts leave out. History
// (check-ins, sales) stays. Put back any time here or on Sales Dashboard →
// Turned off accounts; the LilyPad sync puts it back by itself if it orders
// again. SQL: sql/account_remove.sql.

import { useCallback, useEffect, useState } from "react";
import type { createClient } from "@/lib/supabase/client";
import { useNewFeature } from "@/lib/newFeatures";
import NewBadge from "@/components/NewBadge";

type Supa = ReturnType<typeof createClient>;

export const REMOVE_REASONS = ["Closed / Out of business", "Won't carry us", "Duplicate", "Other"] as const;

interface Removed {
  reason: string | null;
  note: string | null;
  removed_at: string;
  removed_by: string | null;
}

const fmt = (iso: string) => new Date(iso).toLocaleDateString("en-US", { month: "numeric", day: "numeric", year: "numeric", timeZone: "America/Los_Angeles" });

export default function RemoveFromLists({ supabase, outletId, name, onChanged }: { supabase: Supa; outletId: string; name: string; onChanged?: () => void }) {
  const isNew = useNewFeature("feature:remove-from-lists");
  // undefined = loading · null = on the lists · object = removed
  const [state, setState] = useState<Removed | null | undefined>(undefined);
  const [hidden, setHidden] = useState(false);
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState<string>("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const check = useCallback(async () => {
    const { data, error } = await supabase.rpc("sales_removed_accounts", { p_outlet: outletId });
    if (error) {
      setHidden(true); // not set up yet / no access — show nothing
      return;
    }
    const row = ((data ?? []) as Removed[])[0];
    setState(row ?? null);
  }, [supabase, outletId]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- load from the database
    check();
  }, [check]);

  if (hidden || state === undefined) return null;

  const remove = async () => {
    setBusy(true);
    setErr(null);
    const { error } = await supabase.rpc("sales_account_remove", { p_outlet: outletId, p_reason: reason, p_note: note.trim() || null });
    setBusy(false);
    if (error) return setErr(error.message);
    setOpen(false);
    setReason("");
    setNote("");
    await check();
    onChanged?.();
  };

  const putBack = async () => {
    setBusy(true);
    setErr(null);
    const { error } = await supabase.rpc("sales_account_restore", { p_outlet: outletId });
    setBusy(false);
    if (error) return setErr(error.message);
    await check();
    onChanged?.();
  };

  if (state) {
    return (
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2">
        <div className="flex min-w-0 flex-col gap-0.5 text-[13px]">
          <span className="font-semibold text-amber-200">Removed from lists{state.reason ? ` — ${state.reason}` : ""}</span>
          <span className="text-neutral-300">
            {fmt(state.removed_at)}
            {state.removed_by ? ` by ${state.removed_by}` : ""}
            {state.note ? ` · “${state.note}”` : ""}
          </span>
          <span className="text-[12px] text-neutral-400">Hidden from every list and dashboard. It comes back on its own if it orders again.</span>
          {err && <span className="text-[12px] text-red-300">{err}</span>}
        </div>
        <button
          type="button"
          disabled={busy}
          onClick={putBack}
          className="rounded-full border border-[#6abc46]/60 px-3 py-1 text-[12.5px] font-semibold text-[#9be07a] hover:bg-[#6abc46]/15 disabled:opacity-40"
        >
          {busy ? "Saving…" : "Put back on lists"}
        </button>
      </div>
    );
  }

  if (!open) {
    return (
      <div className="flex justify-end">
        <button
          type="button"
          onClick={() => {
            isNew.dismiss();
            setOpen(true);
          }}
          className="inline-flex items-center gap-1.5 rounded-full border border-neutral-700 px-3 py-1 text-[12.5px] text-neutral-300 hover:border-red-500/60 hover:text-red-300"
        >
          Remove from lists
          {isNew.isNew && <NewBadge inline />}
        </button>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-2 rounded-lg border border-neutral-700 bg-neutral-900 p-3">
      <span className="text-[13.5px] font-semibold text-neutral-100">Remove {name} from lists?</span>
      <span className="text-[12.5px] text-neutral-400">
        It comes off every list, target list and dashboard for everyone. Its past sales and check-ins stay. You can put it back any time, and it comes back on its own if it orders again.
      </span>
      <div className="flex flex-wrap gap-2">
        {REMOVE_REASONS.map((r) => (
          <button
            key={r}
            type="button"
            onClick={() => setReason(r)}
            className={`rounded-full border px-3 py-1 text-[12.5px] ${reason === r ? "border-[#6abc46] bg-[#6abc46]/20 text-neutral-50" : "border-neutral-700 text-neutral-300 hover:border-neutral-500"}`}
          >
            {r}
          </button>
        ))}
      </div>
      <input
        type="text"
        value={note}
        maxLength={300}
        onChange={(e) => setNote(e.target.value)}
        placeholder={reason === "Other" ? "Why? (needed for Other)" : "Note (optional) — e.g. closed since September"}
        className="rounded-md border border-neutral-700 bg-neutral-950 px-2 py-1.5 text-[13px] text-neutral-100"
      />
      {err && <span className="text-[12.5px] text-red-300">{err}</span>}
      <div className="flex justify-end gap-2">
        <button type="button" onClick={() => setOpen(false)} className="rounded-full px-3 py-1 text-[12.5px] text-neutral-400 hover:text-neutral-200">
          Cancel
        </button>
        <button
          type="button"
          disabled={busy || !reason || (reason === "Other" && !note.trim())}
          onClick={remove}
          className="rounded-full border border-red-500/60 bg-red-500/15 px-3 py-1 text-[12.5px] font-semibold text-red-200 hover:bg-red-500/25 disabled:opacity-40"
        >
          {busy ? "Removing…" : "Remove"}
        </button>
      </div>
    </div>
  );
}
