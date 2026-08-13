"use client";

import { useEffect, useMemo, useState, useCallback } from "react";
import { createClient } from "@/lib/supabase/client";
import type { Profile, Role } from "@/lib/types/db";

export default function UsersPage() {
  const supabase = useMemo(() => createClient(), []);
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    const { data } = await supabase.from("profiles").select("*").order("created_at");
    setProfiles((data as Profile[]) ?? []);
    setLoading(false);
  }, [supabase]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- intentional fetch-on-mount
    load();
  }, [load]);

  async function handleRoleChange(profileId: string, role: Role) {
    setProfiles((prev) => prev.map((p) => (p.id === profileId ? { ...p, role } : p)));
    await supabase.from("profiles").update({ role }).eq("id", profileId);
  }

  if (loading) return <p className="text-sm text-neutral-400">Loading…</p>;

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-lg font-semibold text-neutral-100">Users</h1>
        <p className="text-sm text-neutral-400">
          Admins can access Dashboard, Distributor Data, Weeks, Audit Log, and Users. Basic users
          can only access Inventory & Allocation — they can enter allocations, on-hand/unlabeled/
          to-package counts, and PO numbers, but can&apos;t add or delete products, start a new
          week, or undo changes.
        </p>
        <p className="mt-1 text-xs text-neutral-500">
          To add a new person, invite them from your Supabase project&apos;s Authentication
          panel (or add a public sign-up flow later) — they&apos;ll show up here automatically
          once they sign in for the first time, as a Basic user by default.
        </p>
      </div>

      <div className="overflow-hidden rounded-lg border border-neutral-800 bg-neutral-950">
        <table className="min-w-full divide-y divide-neutral-900 text-sm">
          <thead className="bg-neutral-900 text-xs uppercase tracking-wide text-neutral-500">
            <tr>
              <th className="px-3 py-2 text-left">Email</th>
              <th className="px-3 py-2 text-left">Joined</th>
              <th className="px-3 py-2 text-left">Role</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-neutral-900">
            {profiles.map((p) => (
              <tr key={p.id} className="hover:bg-neutral-900/60">
                <td className="px-3 py-2 text-neutral-200">{p.email}</td>
                <td className="px-3 py-2 text-neutral-500">
                  {new Date(p.created_at).toLocaleDateString()}
                </td>
                <td className="px-3 py-2">
                  <select
                    value={p.role}
                    onChange={(e) => handleRoleChange(p.id, e.target.value as Role)}
                    className="rounded-md border border-neutral-700 bg-neutral-900 px-2 py-1 text-sm text-neutral-100"
                  >
                    <option value="admin">Admin</option>
                    <option value="basic">Basic</option>
                  </select>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
