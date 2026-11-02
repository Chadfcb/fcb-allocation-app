"use client";

// Removed accounts button (2026-11-02, per Chad): "If someone removes an
// account from a distributors page, from any list, i want it inside a button"
// — far right of each distributor page's header (the spot he marked).
//
// Lists THIS distributor's accounts taken off the lists with Remove from lists
// (components/RemoveFromLists.tsx): name, city, reason + note, who and when.
// Click a name → the account pop-up; Put back on lists right on the row;
// Export. Data: sales_removed_accounts() (sql/account_remove.sql). Reloads
// whenever the page reloads (version), so a removal anywhere on the page
// shows in the count right away.

import { useCallback, useEffect, useState } from "react";
import type { createClient } from "@/lib/supabase/client";
import { useNewFeature } from "@/lib/newFeatures";
import NewBadge from "@/components/NewBadge";
import { ExportButton, Modal, exportSheets } from "@/components/SalesDashboardHome";

type Supa = ReturnType<typeof createClient>;

interface RemovedRow {
  outlet_id: string;
  name: string | null;
  city: string | null;
  distributor: string | null;
  reason: string | null;
  note: string | null;
  removed_at: string;
  removed_by: string | null;
}

const fmt = (iso: string) => new Date(iso).toLocaleDateString("en-US", { month: "numeric", day: "numeric", year: "numeric", timeZone: "America/Los_Angeles" });

export default function RemovedAccountsButton({
  supabase,
  dist,
  slug,
  version,
  onOpen,
  onChanged,
}: {
  supabase: Supa;
  dist: string;
  slug: string;
  version: number;
  onOpen: (outletId: string) => void;
  onChanged: () => void;
}) {
  const isNew = useNewFeature(`feature:dist-removed-accounts-${slug}`);
  const [rows, setRows] = useState<RemovedRow[] | null>(null);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const load = useCallback(async () => {
    const { data, error } = await supabase.rpc("sales_removed_accounts", { p_outlet: null });
    if (error) return setRows([]);
    setRows(((data ?? []) as RemovedRow[]).filter((r) => r.distributor === dist));
  }, [supabase, dist]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- load from the database
    load();
  }, [load, version]);

  const putBack = async (r: RemovedRow) => {
    setBusy(r.outlet_id);
    setErr(null);
    const { error } = await supabase.rpc("sales_account_restore", { p_outlet: r.outlet_id });
    setBusy(null);
    if (error) return setErr(error.message);
    await load();
    onChanged();
  };

  const doExport = async () => {
    setBusy("export");
    try {
      await exportSheets(`${dist} - removed accounts.xlsx`, [
        {
          name: "Removed accounts",
          title: `${dist} — accounts removed from lists`,
          cols: [
            { header: "Account", key: "name", width: 34 },
            { header: "City", key: "city", width: 16 },
            { header: "Reason", key: "reason", width: 24 },
            { header: "Note", key: "note", width: 44 },
            { header: "Removed", key: "when", width: 12 },
            { header: "By", key: "by", width: 20 },
            { header: "Outlet ID", key: "outlet_id", width: 14 },
          ],
          rows: (rows ?? []).map((r) => ({
            name: r.name ?? r.outlet_id,
            city: r.city ?? "",
            reason: r.reason ?? "Turned off",
            note: r.note ?? "",
            when: fmt(r.removed_at),
            by: r.removed_by ?? "",
            outlet_id: r.outlet_id,
          })),
        },
      ]);
    } finally {
      setBusy(null);
    }
  };

  return (
    <>
      <button
        type="button"
        onClick={() => {
          setOpen(true);
          isNew.dismiss();
        }}
        className="ml-auto flex items-center gap-1.5 rounded-lg border border-neutral-600 bg-neutral-800/60 px-3.5 py-2 text-sm font-semibold text-neutral-100 hover:border-neutral-400"
      >
        Removed accounts
        <span className="rounded-full bg-neutral-700 px-2 py-0.5 font-mono text-[12px] leading-none text-neutral-100">{rows ? rows.length : "…"}</span>
        {isNew.isNew && <NewBadge inline />}
      </button>
      {open && (
        <Modal
          title={`Removed accounts · ${dist}`}
          sub="Taken off every list and dashboard with Remove from lists. They come back on their own if they order again."
          onClose={() => setOpen(false)}
          actions={rows && rows.length > 0 ? <ExportButton onClick={doExport} busy={busy === "export"} /> : undefined}
        >
          {err && <p className="mb-2 text-sm text-red-300">{err}</p>}
          {!rows && <p className="text-sm text-neutral-500">Loading…</p>}
          {rows && rows.length === 0 && <p className="text-sm text-neutral-500">No {dist} accounts have been removed.</p>}
          <div className="flex max-h-[60vh] flex-col overflow-y-auto">
            {rows?.map((r) => (
              <div key={r.outlet_id} className="flex flex-wrap items-center gap-3 border-t border-neutral-800 py-2 first:border-t-0">
                <button
                  type="button"
                  onClick={() => {
                    setOpen(false);
                    onOpen(r.outlet_id);
                  }}
                  className="flex min-w-0 flex-1 flex-col gap-0.5 text-left hover:opacity-80"
                >
                  <span className="text-[13.5px] font-semibold text-neutral-100">
                    {r.name ?? r.outlet_id}
                    {r.city ? <span className="font-normal text-neutral-500"> · {r.city}</span> : null}
                  </span>
                  <span className="text-[12.5px] text-amber-200/90">
                    {r.reason ?? "Turned off"}
                    {r.note ? ` · “${r.note}”` : ""}
                  </span>
                  <span className="text-[12px] text-neutral-500">
                    Removed {fmt(r.removed_at)}
                    {r.removed_by ? ` by ${r.removed_by}` : ""}
                  </span>
                </button>
                <button
                  type="button"
                  disabled={busy === r.outlet_id}
                  onClick={() => putBack(r)}
                  className="rounded-full border border-[#6abc46]/60 px-3 py-1 text-[12.5px] font-semibold text-[#9be07a] hover:bg-[#6abc46]/15 disabled:opacity-40"
                >
                  {busy === r.outlet_id ? "Saving…" : "Put back on lists"}
                </button>
              </div>
            ))}
          </div>
        </Modal>
      )}
    </>
  );
}
