"use client";

import { Fragment, useEffect, useMemo, useState, useCallback } from "react";
import { createClient } from "@/lib/supabase/client";
import type { Profile, Role } from "@/lib/types/db";
import {
  SECTION_GROUPS,
  ALL_SECTION_KEYS,
  SECTION_LABEL,
  ERNIE_SECTION,
  type AnySectionKey,
  type SectionKey,
} from "@/lib/permissions";

type UserRow = Profile & { sections: AnySectionKey[] };

function emptySectionState(): Record<AnySectionKey, boolean> {
  const state = {} as Record<AnySectionKey, boolean>;
  for (const key of ALL_SECTION_KEYS) state[key] = false;
  state[ERNIE_SECTION] = false;
  return state;
}

function accessSummary(user: UserRow): string {
  if (user.role === "admin") return "All sections";
  const pageLabels = user.sections
    .filter((s): s is SectionKey => s !== ERNIE_SECTION)
    .map((s) => SECTION_LABEL[s]);
  const withErnie = user.sections.includes(ERNIE_SECTION) ? [...pageLabels, "Ernie AI"] : pageLabels;
  return withErnie.length ? withErnie.join(", ") : "No sections yet";
}

function SectionChecklist({
  role,
  state,
  onToggle,
}: {
  role: Role;
  state: Record<AnySectionKey, boolean>;
  onToggle: (key: AnySectionKey, checked: boolean) => void;
}) {
  if (role === "admin") {
    return (
      <p className="rounded-md border border-neutral-700 bg-neutral-900 px-3 py-2 text-xs text-neutral-400">
        Admins automatically have access to every section, including Ernie
        AI and Users management — nothing to pick.
      </p>
    );
  }

  return (
    <div className="space-y-3">
      {SECTION_GROUPS.map((group) => (
        <div key={group.label}>
          <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-neutral-500">
            {group.label}
          </p>
          <div className="grid grid-cols-2 gap-1 sm:grid-cols-3">
            {group.items.map((item) => (
              <label
                key={item.key}
                className="flex items-center gap-2 rounded px-2 py-1 text-sm text-neutral-200 hover:bg-neutral-900"
              >
                <input
                  type="checkbox"
                  checked={state[item.key]}
                  onChange={(e) => onToggle(item.key, e.target.checked)}
                  className="h-4 w-4 accent-white"
                />
                {item.label}
              </label>
            ))}
          </div>
        </div>
      ))}

      <div className="rounded-md border border-cyan-900 bg-cyan-950/30 px-3 py-2">
        <label className="flex items-center gap-2 text-sm font-medium text-neutral-100">
          <input
            type="checkbox"
            checked={state[ERNIE_SECTION]}
            onChange={(e) => onToggle(ERNIE_SECTION, e.target.checked)}
            className="h-4 w-4 accent-white"
          />
          ✨ Ernie AI
        </label>
        <p className="mt-1 pl-6 text-xs text-neutral-400">
          If checked, Ernie only pulls data from the sections checked
          above — not the whole app.
        </p>
      </div>

      <p className="text-xs text-neutral-500">
        Dashboard and Users management stay admin-only.
      </p>
    </div>
  );
}

export default function UsersPage() {
  const supabase = useMemo(() => createClient(), []);
  const [users, setUsers] = useState<UserRow[]>([]);
  const [loading, setLoading] = useState(true);

  const [newEmail, setNewEmail] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [newRole, setNewRole] = useState<Role>("basic");
  const [newSections, setNewSections] = useState(emptySectionState());
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);

  const [editingId, setEditingId] = useState<string | null>(null);
  const [editRole, setEditRole] = useState<Role>("basic");
  const [editSections, setEditSections] = useState(emptySectionState());
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    const [{ data: profiles }, { data: grants }] = await Promise.all([
      supabase.from("profiles").select("*").order("created_at"),
      supabase.from("user_section_access").select("user_id, section_key"),
    ]);

    const sectionsByUser = new Map<string, AnySectionKey[]>();
    for (const g of grants ?? []) {
      const list = sectionsByUser.get(g.user_id) ?? [];
      list.push(g.section_key as AnySectionKey);
      sectionsByUser.set(g.user_id, list);
    }

    setUsers(
      ((profiles as Profile[]) ?? []).map((p) => ({
        ...p,
        sections: sectionsByUser.get(p.id) ?? [],
      })),
    );
    setLoading(false);
  }, [supabase]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- intentional fetch-on-mount
    load();
  }, [load]);

  // Writes a user's section grants to match `desired` exactly — deletes
  // anything unchecked, inserts anything newly checked. Cheap enough for
  // ~14 possible sections; no need for a smarter diff.
  async function saveSections(userId: string, desired: AnySectionKey[]) {
    await supabase.from("user_section_access").delete().eq("user_id", userId);
    if (desired.length > 0) {
      await supabase
        .from("user_section_access")
        .insert(desired.map((section_key) => ({ user_id: userId, section_key })));
    }
  }

  function openEdit(user: UserRow) {
    setEditingId(user.id);
    setEditRole(user.role);
    const state = emptySectionState();
    for (const s of user.sections) state[s] = true;
    setEditSections(state);
  }

  async function handleSaveEdit(userId: string) {
    setSaving(true);
    try {
      await supabase.from("profiles").update({ role: editRole }).eq("id", userId);
      const desired =
        editRole === "admin"
          ? []
          : (Object.keys(editSections) as AnySectionKey[]).filter((k) => editSections[k]);
      await saveSections(userId, desired);
      setEditingId(null);
      await load();
    } finally {
      setSaving(false);
    }
  }

  async function handleCreateUser(e: React.FormEvent) {
    e.preventDefault();
    setCreateError(null);

    if (newPassword.length < 8) {
      setCreateError("Temporary password must be at least 8 characters.");
      return;
    }

    setCreating(true);

    try {
      const sections =
        newRole === "admin"
          ? []
          : (Object.keys(newSections) as AnySectionKey[]).filter((k) => newSections[k]);

      const res = await fetch("/api/admin/create-user", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: newEmail, password: newPassword, role: newRole, sections }),
      });

      // The server route always returns JSON on purpose, but guard against
      // an unexpected non-JSON response (a platform-level 500/timeout page,
      // a network hiccup, etc.) so this can't get stuck on "Adding…" forever
      // — surface a real error message instead.
      let body: { error?: string; id?: string } = {};
      try {
        body = await res.json();
      } catch {
        body = {};
      }

      if (!res.ok) {
        setCreateError(
          body.error ??
            `Something went wrong creating that user (${res.status}).`,
        );
        return;
      }

      setNewEmail("");
      setNewPassword("");
      setNewRole("basic");
      setNewSections(emptySectionState());
      await load();
    } catch {
      setCreateError(
        "Couldn't reach the server to create that user — check your connection and try again.",
      );
    } finally {
      setCreating(false);
    }
  }

  if (loading) return <p className="text-sm text-neutral-400">Loading…</p>;

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-lg font-semibold text-neutral-100">Users</h1>
        <p className="text-sm text-neutral-400">
          Admins have access to everything. Basic users get exactly the
          sections checked below — including whether they have Ernie AI at
          all.
        </p>
        <p className="mt-1 text-xs text-neutral-500">
          New people show up here automatically the first time they sign in,
          as a Basic user with nothing granted by default.
        </p>
      </div>

      <form
        onSubmit={handleCreateUser}
        className="space-y-3 rounded-lg border border-neutral-800 bg-neutral-950 p-4"
      >
        <div className="flex flex-wrap items-end gap-3">
          <div>
            <label className="mb-1 block text-xs font-medium text-neutral-400">
              Email
            </label>
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
          <div>
            <label className="mb-1 block text-xs font-medium text-neutral-400">
              Role
            </label>
            <select
              value={newRole}
              onChange={(e) => setNewRole(e.target.value as Role)}
              className="rounded-md border border-neutral-700 bg-neutral-900 px-2 py-1.5 text-sm text-neutral-100"
            >
              <option value="basic">Basic</option>
              <option value="admin">Admin</option>
            </select>
          </div>
          <button
            type="submit"
            disabled={creating}
            className="rounded-md bg-white px-4 py-1.5 text-sm font-medium text-black hover:bg-neutral-200 disabled:opacity-50"
          >
            {creating ? "Adding…" : "Add User"}
          </button>
        </div>

        <SectionChecklist
          role={newRole}
          state={newSections}
          onToggle={(key, checked) => setNewSections((prev) => ({ ...prev, [key]: checked }))}
        />

        {createError && <p className="text-sm text-red-400">{createError}</p>}
        <p className="text-xs text-neutral-500">
          Share this email and temporary password with them directly —
          they&apos;ll be asked to set their own password and name the first
          time they sign in.
        </p>
      </form>

      <div className="overflow-hidden rounded-lg border border-neutral-800 bg-neutral-950">
        <table className="min-w-full divide-y divide-neutral-900 text-sm">
          <thead className="bg-neutral-900 text-xs uppercase tracking-wide text-neutral-500">
            <tr>
              <th className="px-3 py-2 text-left">Email</th>
              <th className="px-3 py-2 text-left">Joined</th>
              <th className="px-3 py-2 text-left">Role</th>
              <th className="px-3 py-2 text-left">Access</th>
              <th className="px-3 py-2 text-left"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-neutral-900">
            {users.map((user) => (
              <Fragment key={user.id}>
                <tr className="hover:bg-neutral-900/60">
                  <td className="px-3 py-2 text-neutral-200">{user.email}</td>
                  <td className="px-3 py-2 text-neutral-500">
                    {new Date(user.created_at).toLocaleDateString()}
                  </td>
                  <td className="px-3 py-2">
                    <span
                      className={`rounded-full px-2 py-0.5 text-xs font-medium ${
                        user.role === "admin"
                          ? "bg-violet-950 text-violet-300"
                          : "bg-neutral-800 text-neutral-300"
                      }`}
                    >
                      {user.role === "admin" ? "Admin" : "Basic"}
                    </span>
                  </td>
                  <td className="max-w-xs px-3 py-2 text-xs text-neutral-400">
                    {accessSummary(user)}
                  </td>
                  <td className="px-3 py-2 text-right">
                    <button
                      type="button"
                      onClick={() => (editingId === user.id ? setEditingId(null) : openEdit(user))}
                      className="rounded-md border border-neutral-700 px-3 py-1 text-xs text-neutral-300 hover:bg-neutral-900"
                    >
                      {editingId === user.id ? "Close" : "Edit access"}
                    </button>
                  </td>
                </tr>
                {editingId === user.id && (
                  <tr>
                    <td colSpan={5} className="bg-black/40 px-4 py-4">
                      <div className="max-w-xl space-y-3 rounded-md border border-neutral-800 bg-neutral-950 p-4">
                        <div>
                          <label className="mb-1 block text-xs font-medium text-neutral-400">
                            Role
                          </label>
                          <div className="flex gap-2">
                            {(["admin", "basic"] as Role[]).map((r) => (
                              <button
                                key={r}
                                type="button"
                                onClick={() => setEditRole(r)}
                                className={`rounded-md border px-3 py-1.5 text-sm font-medium ${
                                  editRole === r
                                    ? "border-white bg-white text-black"
                                    : "border-neutral-700 text-neutral-300 hover:bg-neutral-900"
                                }`}
                              >
                                {r === "admin" ? "Admin" : "Basic"}
                              </button>
                            ))}
                          </div>
                        </div>

                        <SectionChecklist
                          role={editRole}
                          state={editSections}
                          onToggle={(key, checked) => setEditSections((prev) => ({ ...prev, [key]: checked }))}
                        />

                        <div className="flex justify-end gap-2 pt-1">
                          <button
                            type="button"
                            onClick={() => setEditingId(null)}
                            className="rounded-md border border-neutral-700 px-3 py-1.5 text-sm text-neutral-300 hover:bg-neutral-900"
                          >
                            Cancel
                          </button>
                          <button
                            type="button"
                            disabled={saving}
                            onClick={() => handleSaveEdit(user.id)}
                            className="rounded-md bg-white px-4 py-1.5 text-sm font-medium text-black hover:bg-neutral-200 disabled:opacity-50"
                          >
                            {saving ? "Saving…" : "Save changes"}
                          </button>
                        </div>
                      </div>
                    </td>
                  </tr>
                )}
              </Fragment>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
