"use client";

import { useEffect, useMemo, useState, useCallback } from "react";
import { createClient } from "@/lib/supabase/client";
import type { AuditLogEntry, Profile } from "@/lib/types/db";

export default function AuditLogPage() {
  const supabase = useMemo(() => createClient(), []);
  const [entries, setEntries] = useState<AuditLogEntry[]>([]);
  const [profiles, setProfiles] = useState<Record<string, Profile>>({});
  const [userId, setUserId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [undoingId, setUndoingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);

    const {
      data: { user },
    } = await supabase.auth.getUser();
    setUserId(user?.id ?? null);

    const { data: logData } = await supabase
      .from("audit_log")
      .select("*")
      .order("changed_at", { ascending: false })
      .limit(200);
    setEntries((logData as AuditLogEntry[]) ?? []);

    const { data: profileData } = await supabase.from("profiles").select("*");
    const map: Record<string, Profile> = {};
    (profileData as Profile[] | null)?.forEach((p) => (map[p.id] = p));
    setProfiles(map);

    setLoading(false);
  }, [supabase]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- intentional fetch-on-mount
    load();
  }, [load]);

  async function handleUndo(entryId: string) {
    if (!userId) return;
    setUndoingId(entryId);
    setError(null);

    const { error: rpcError } = await supabase.rpc("undo_audit_entry", {
      p_audit_id: entryId,
      p_reverted_by: userId,
    });

    if (rpcError) {
      setError(rpcError.message);
    } else {
      await load();
    }

    setUndoingId(null);
  }

  if (loading) return <p className="text-sm text-neutral-500">Loading…</p>;

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-lg font-semibold text-neutral-900">Audit Log</h1>
        <p className="text-sm text-neutral-500">
          Every change made in the app, most recent first. Undo reverts just that one field back
          to its previous value.
        </p>
      </div>

      {error && <p className="text-sm text-red-600">{error}</p>}

      <div className="overflow-x-auto rounded-lg border border-neutral-200 bg-white">
        <table className="min-w-full divide-y divide-neutral-200 text-sm">
          <thead className="bg-neutral-50 text-xs uppercase tracking-wide text-neutral-500">
            <tr>
              <th className="px-3 py-2 text-left">When</th>
              <th className="px-3 py-2 text-left">Who</th>
              <th className="px-3 py-2 text-left">Table</th>
              <th className="px-3 py-2 text-left">Field</th>
              <th className="px-3 py-2 text-left">Old</th>
              <th className="px-3 py-2 text-left">New</th>
              <th className="px-3 py-2 text-left">Status</th>
              <th className="px-3 py-2"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-neutral-100">
            {entries.map((e) => (
              <tr key={e.id} className={e.reverted ? "opacity-50" : ""}>
                <td className="whitespace-nowrap px-3 py-1.5 text-neutral-500">
                  {new Date(e.changed_at).toLocaleString()}
                </td>
                <td className="px-3 py-1.5 text-neutral-700">
                  {e.changed_by ? profiles[e.changed_by]?.email ?? "—" : "—"}
                </td>
                <td className="px-3 py-1.5 text-neutral-600">{e.table_name}</td>
                <td className="px-3 py-1.5 text-neutral-600">{e.field_name}</td>
                <td className="px-3 py-1.5 text-neutral-500">{e.old_value ?? "—"}</td>
                <td className="px-3 py-1.5 font-medium text-neutral-800">{e.new_value ?? "—"}</td>
                <td className="px-3 py-1.5 text-xs text-neutral-500">
                  {e.reverted ? "Reverted" : ""}
                </td>
                <td className="px-3 py-1.5 text-right">
                  {!e.reverted && (
                    <button
                      onClick={() => handleUndo(e.id)}
                      disabled={undoingId === e.id}
                      className="rounded-md border border-neutral-300 px-2 py-1 text-xs hover:bg-neutral-100 disabled:opacity-50"
                    >
                      {undoingId === e.id ? "Undoing…" : "Undo"}
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
