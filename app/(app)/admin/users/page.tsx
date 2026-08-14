"use client";

import { useEffect, useMemo, useState, useCallback } from "react";
import { createClient } from "@/lib/supabase/client";
import type { Profile, Role } from "@/lib/types/db";

export default function UsersPage() {
  const supabase = useMemo(() => createClient(), []);
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [loading, setLoading] = useState(true);
  const [newEmail, setNewEmail] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);

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

  async function handleCreateUser(e: React.FormEvent) {
    e.preventDefault();
    setCreateError(null);

    if (newPassword.length < 8) {
      setCreateError("Temporary password must be at least 8 characters.");
      return;
    }

    setCreating(true);

    const res = await fetch("/api/admin/create-user", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: newEmail, password: newPassword }),
    });
    const body = await res.json();

    if (!res.ok) {
      setCreateError(body.error ?? "Something went wrong creating that user.");
      setCreating(false);
      return;
    }

    setNewEmail("");
    setNewPassword("");
    setCreating(false);
    await load();
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
          New people show up here automatically the first time they sign in, as a Basic user by
          default.
        </p>
      </div>

      <form
        onSubmit={handleCreateUser}
        className="flex flex-wrap items-end gap-3 rounded-lg border border-neutral-800 bg-neutral-950 p-4"
      >
        <div>
          <label className="mb-1 block text-xs font-medium text-neutral-400">Email</label>
          <input
            type="email"
            required
            value={newEmail}
            onChange={(e) => setNewEmail(e.target.value)}
            placeholder="name@fullcirclebrewing.com"
            className="w-64 rounded-md border border-neutral-700 bg-neutral-900 px-3 py-1.5 text-sm text-neutral-100 focus:border-neutral-500 focus:outline-none"
          />
        </div>
        <div>
          <label className="mb-1 block text-xs font-medium text-neutral-400">
            Temporary Password
          </label>
          <input
            type="text"
            required
            minLength={8}
            value={newPassword}
            onChange={(e) => setNewPassword(e.target.value)}
            placeholder="At least 8 characters"
            className="w-56 rounded-md border border-neutral-700 bg-neutral-900 px-3 py-1.5 text-sm text-neutral-100 focus:border-neutral-500 focus:outline-none"
          />
        </div>
        <button
          type="submit"
          disabled={creating}
          className="rounded-md bg-white px-4 py-1.5 text-sm font-medium text-black hover:bg-neutral-200 disabled:opacity-50"
        >
          {creating ? "Adding…" : "Add User"}
        </button>
        {createError && <p className="w-full text-sm text-red-400">{createError}</p>}
        <p className="w-full text-xs text-neutral-500">
          Share this email and temporary password with them directly — they&apos;ll be asked to
          set their own password and name the first time they sign in.
        </p>
      </form>

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
