"use client";

import { Fragment, useEffect, useMemo, useState, useCallback } from "react";
import { createClient } from "@/lib/supabase/client";
import type { Profile, Role } from "@/lib/types/db";
import { firstNameFor } from "@/lib/displayName";
import {
  GROUP_KEYS,
  GROUP_LABEL,
  GROUP_SECTIONS,
  ERNIE_SECTION,
  type AnySectionKey,
  type GroupKey,
} from "@/lib/permissions";

type UserRow = Profile & { sections: AnySectionKey[] };

// Administrator / Manager / Employee tiering — added 2026-09-09, per Chad.
// Deliberately NOT a database enum: it's just role + is_super_admin viewed
// together (see lib/types/db.ts's comment on Profile.is_super_admin).
//   Administrator = role='admin', is_super_admin=true  — full access,
//     always, including Finance. Only an Administrator can grant/revoke
//     Finance access or change anyone's tier.
//   Manager       = role='admin', is_super_admin=false — everything an
//     Administrator has today EXCEPT Finance, unless an Administrator has
//     separately granted it. Still runs Users > Edit for ordinary category
//     grants (Operations, Sales, etc.) and Employee account management —
//     just not Finance or anyone's tier.
//   Employee      = role='basic' — unchanged, exactly what Basic users
//     have today.
type Tier = "administrator" | "manager" | "employee";

function tierOf(role: Role, isSuperAdmin: boolean): Tier {
  if (role === "basic") return "employee";
  return isSuperAdmin ? "administrator" : "manager";
}

function tierToRoleFields(tier: Tier): { role: Role; is_super_admin: boolean } {
  if (tier === "employee") return { role: "basic", is_super_admin: false };
  if (tier === "manager") return { role: "admin", is_super_admin: false };
  return { role: "admin", is_super_admin: true };
}

const TIER_LABEL: Record<Tier, string> = {
  administrator: "Administrator",
  manager: "Manager",
  employee: "Employee",
};

const TIER_BADGE_CLASS: Record<Tier, string> = {
  administrator: "bg-violet-950 text-violet-300",
  manager: "bg-sky-950 text-sky-300",
  employee: "bg-neutral-800 text-neutral-300",
};

// The Users page only ever offers whole-category toggles (see
// GROUP_KEYS/SECTION_GROUPS in lib/permissions.ts) plus Ernie AI — per
// Chad: "if a user is given access to a main section, they auto get the
// sub section... remove individual page toggles." This state shape is
// purely a UI convenience; it gets expanded into (or read back from) the
// real flat list of individual SectionKey rows in user_section_access via
// GROUP_SECTIONS. It now also covers "finance" the same generic way, since
// that's just another entry in GROUP_KEYS — see the Finance-specific
// rendering/gating in GroupChecklist below, which is the only place that
// actually treats it specially.
//
// Built from GROUP_KEYS rather than a hand-written literal — a hardcoded
// object here is exactly what broke a past build (this file still had
// `other: false` after lib/permissions.ts dropped that category for
// `events_calendar`/`pos_labels`, which TypeScript correctly rejected).
// Deriving it from GROUP_KEYS means a future category added to
// SECTION_GROUPS can never get out of sync with this shape again.
type GroupSelectionState = Record<GroupKey, boolean> & { ernie: boolean };

function emptyGroupState(): GroupSelectionState {
  const state = { ernie: false } as GroupSelectionState;
  for (const group of GROUP_KEYS) state[group] = false;
  return state;
}

// Derives which group checkboxes should show as checked for a user's
// existing flat sections array — a group reads as checked only once every
// one of its underlying pages is granted.
function groupStateFromSections(sections: AnySectionKey[]): GroupSelectionState {
  const state = emptyGroupState();
  for (const group of GROUP_KEYS) {
    state[group] = GROUP_SECTIONS[group].every((k) => sections.includes(k));
  }
  state.ernie = sections.includes(ERNIE_SECTION);
  return state;
}

// Expands the checked groups back into the full flat list of individual
// SectionKey rows (plus Ernie) that actually gets written to
// user_section_access / sent to /api/admin/create-user.
function expandGroupState(state: GroupSelectionState): AnySectionKey[] {
  const keys: AnySectionKey[] = [];
  for (const group of GROUP_KEYS) {
    if (state[group]) keys.push(...GROUP_SECTIONS[group]);
  }
  if (state.ernie) keys.push(ERNIE_SECTION);
  return keys;
}

function accessSummary(user: UserRow): string {
  const tier = tierOf(user.role, user.is_super_admin);
  const state = groupStateFromSections(user.sections);

  if (tier === "administrator") return "All sections";

  if (tier === "manager") {
    // Everything else is already automatic for a Manager — Finance is the
    // one thing that isn't, so that's the only thing worth naming here.
    return state.finance ? "All sections (+ Finance)" : "All sections except Finance";
  }

  // Employee — same as today: list whichever categories are actually
  // granted. Skip any group with no items (e.g. POS, emptied out
  // 2026-09-05) — with zero underlying sections, `.every()` on an empty
  // list reads as vacuously true, which would otherwise make an empty
  // category show up as "granted" for every single user.
  const groupLabels = GROUP_KEYS.filter(
    (g) => GROUP_SECTIONS[g].length > 0 && state[g],
  ).map((g) => GROUP_LABEL[g]);
  const withErnie = state.ernie ? [...groupLabels, "Ernie AI"] : groupLabels;
  return withErnie.length ? withErnie.join(", ") : "No sections yet";
}

// Formats profiles.last_active_at for the Users table — added 2026-09-05
// alongside that column (see sql/profiles_last_active.sql) so Chad has a
// real "used the app today" signal instead of Supabase's own "last sign
// in," which only updates on a fresh login rather than every visit.
function formatLastActive(lastActiveAt: string | null): string {
  if (!lastActiveAt) return "Never";
  const date = new Date(lastActiveAt);
  const now = new Date();
  const isToday = date.toDateString() === now.toDateString();
  const yesterday = new Date(now);
  yesterday.setDate(yesterday.getDate() - 1);
  const isYesterday = date.toDateString() === yesterday.toDateString();

  const time = date.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  if (isToday) return `Today, ${time}`;
  if (isYesterday) return `Yesterday, ${time}`;
  return date.toLocaleDateString();
}

function GroupChecklist({
  tier,
  viewerIsSuperAdmin,
  state,
  onToggle,
}: {
  tier: Tier;
  viewerIsSuperAdmin: boolean;
  state: GroupSelectionState;
  onToggle: (key: GroupKey | "ernie", checked: boolean) => void;
}) {
  // An Administrator always has everything, Finance included — nothing to
  // pick, same message as before the tiering existed.
  if (tier === "administrator") {
    return (
      <p className="rounded-md border border-neutral-700 bg-neutral-900 px-3 py-2 text-xs text-neutral-400">
        Administrators automatically have access to every section, including Finance, Ernie AI,
        and Users management — nothing to pick.
      </p>
    );
  }

  // A Manager already has every ordinary section and Ernie AI automatically
  // (same as an Administrator) — Finance is the one exception, and only an
  // Administrator can grant or revoke it.
  if (tier === "manager") {
    if (!viewerIsSuperAdmin) {
      return (
        <p className="rounded-md border border-neutral-700 bg-neutral-900 px-3 py-2 text-xs text-neutral-400">
          Managers automatically have access to every section except Finance, including Ernie AI
          and Users management. Only an Administrator can grant Finance access.
        </p>
      );
    }
    return (
      <div className="space-y-3">
        <div className="rounded-md border border-emerald-900 bg-emerald-950/30 px-3 py-2">
          <label className="flex items-center gap-2 text-sm font-medium text-neutral-100">
            <input
              type="checkbox"
              checked={state.finance}
              onChange={(e) => onToggle("finance", e.target.checked)}
              className="h-4 w-4 accent-white"
            />
            Finance
          </label>
          <p className="mt-1 pl-6 text-xs text-neutral-400">
            Grants the Cash Flow Dashboard. Managers don&apos;t get this automatically — being an
            admin doesn&apos;t include Finance, per Chad.
          </p>
        </div>
        <p className="text-xs text-neutral-500">
          Everything else (Operations, Sales, Ernie AI, etc.) is already automatic for Managers —
          nothing else to pick.
        </p>
      </div>
    );
  }

  // Employee — full checklist, same as today. Finance is only shown to an
  // Administrator; a Manager editing an Employee's access can grant every
  // other category but not Finance (if this Employee already has Finance
  // from an earlier Administrator grant, it stays untouched — it's simply
  // not rendered for a Manager to accidentally uncheck).
  const visibleGroups = GROUP_KEYS.filter(
    (group) => GROUP_SECTIONS[group].length > 0 && (group !== "finance" || viewerIsSuperAdmin),
  );

  return (
    <div className="space-y-3">
      <div>
        <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-neutral-500">
          Access
        </p>
        <div className="flex flex-col gap-1">
          {visibleGroups.map((group) => (
            <label
              key={group}
              className="flex items-center gap-2 rounded px-2 py-1 text-sm text-neutral-200 hover:bg-neutral-900"
            >
              <input
                type="checkbox"
                checked={state[group]}
                onChange={(e) => onToggle(group, e.target.checked)}
                className="h-4 w-4 accent-white"
              />
              {GROUP_LABEL[group]}
            </label>
          ))}
        </div>
        <p className="mt-1 text-xs text-neutral-500">
          Checking a category grants every page under it — no need to also
          pick individual pages.
        </p>
      </div>

      <div className="rounded-md border border-cyan-900 bg-cyan-950/30 px-3 py-2">
        <label className="flex items-center gap-2 text-sm font-medium text-neutral-100">
          <input
            type="checkbox"
            checked={state.ernie}
            onChange={(e) => onToggle("ernie", e.target.checked)}
            className="h-4 w-4 accent-white"
          />
          ✨ Ernie AI
        </label>
        <p className="mt-1 pl-6 text-xs text-neutral-400">
          If checked, Ernie only pulls data from the categories checked
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
  const [viewerId, setViewerId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const [newEmail, setNewEmail] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [newTier, setNewTier] = useState<Tier>("employee");
  const [newSections, setNewSections] = useState(emptyGroupState());
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);

  const [editingId, setEditingId] = useState<string | null>(null);
  const [editTier, setEditTier] = useState<Tier>("employee");
  const [editSections, setEditSections] = useState(emptyGroupState());
  // Added 2026-09-11, per Chad ("there no option for me to change my name
  // in there") — full_name only ever got set by the one-time account-setup
  // flow (app/account-setup/page.tsx, first sign-in with a temp password).
  // An account created before that flow existed (Chad's own, notably) never
  // went through it, so it has no name on file and nothing anywhere let
  // that be fixed after the fact. This is that fix.
  const [editFullName, setEditFullName] = useState("");
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
    supabase.auth.getUser().then(({ data }) => {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- intentional fetch-on-mount
      setViewerId(data.user?.id ?? null);
    });
  }, [load, supabase]);

  const viewerIsSuperAdmin = users.find((u) => u.id === viewerId)?.is_super_admin ?? false;

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
    setEditTier(tierOf(user.role, user.is_super_admin));
    setEditSections(groupStateFromSections(user.sections));
    setEditFullName(user.full_name ?? "");
  }

  async function handleSaveEdit(userId: string) {
    setSaving(true);
    try {
      // Only an Administrator can actually change anyone's tier — enforced
      // in the database too (see sql/is_super_admin.sql's
      // prevent_non_super_admin_tier_change trigger), this is just so a
      // Manager's UI doesn't even attempt it.
      if (viewerIsSuperAdmin) {
        const fields = tierToRoleFields(editTier);
        await supabase.from("profiles").update(fields).eq("id", userId);
      }
      // Name is a normal column, not tier/role — any admin or Manager
      // editing this row can set or fix it (same "admins can update any
      // profile" policy that already covers this page's other writes; only
      // role/is_super_admin themselves are locked down to Administrators,
      // via the trigger referenced above). An empty field clears it back to
      // null, which just falls back to the guessed-from-email name
      // everywhere else in the app already does.
      await supabase
        .from("profiles")
        .update({ full_name: editFullName.trim() || null })
        .eq("id", userId);
      const desired = editTier === "administrator" ? [] : expandGroupState(editSections);
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
      // A Manager can only ever create an Employee account — the tier
      // dropdown isn't even shown to them (see the form below), but pin it
      // here too as a second guard against a stale `newTier` value.
      const tier: Tier = viewerIsSuperAdmin ? newTier : "employee";
      const { role, is_super_admin } = tierToRoleFields(tier);
      const sections = tier === "administrator" ? [] : expandGroupState(newSections);

      const res = await fetch("/api/admin/create-user", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: newEmail, password: newPassword, role, is_super_admin, sections }),
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
      setNewTier("employee");
      setNewSections(emptyGroupState());
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
          Administrators have access to everything, including Finance. Managers have everything
          except Finance, unless an Administrator grants it separately. Employees get exactly the
          categories checked below — checking a category grants every page under it — including
          whether they have Ernie AI at all.
        </p>
        <p className="mt-1 text-xs text-neutral-500">
          New people show up here automatically the first time they sign in, as an Employee with
          nothing granted by default.
          {!viewerIsSuperAdmin &&
            " Only an Administrator (Chad or Art) can grant Finance access or change anyone's tier."}
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
          {viewerIsSuperAdmin ? (
            <div>
              <label className="mb-1 block text-xs font-medium text-neutral-400">
                Tier
              </label>
              <select
                value={newTier}
                onChange={(e) => setNewTier(e.target.value as Tier)}
                className="rounded-md border border-neutral-700 bg-neutral-900 px-2 py-1.5 text-sm text-neutral-100"
              >
                <option value="employee">Employee</option>
                <option value="manager">Manager</option>
                <option value="administrator">Administrator</option>
              </select>
            </div>
          ) : (
            <p className="text-xs text-neutral-500">
              New accounts you add are Employees — ask an Administrator for Manager or
              Administrator accounts.
            </p>
          )}
          <button
            type="submit"
            disabled={creating}
            className="rounded-md bg-white px-4 py-1.5 text-sm font-medium text-black hover:bg-neutral-200 disabled:opacity-50"
          >
            {creating ? "Adding…" : "Add User"}
          </button>
        </div>

        <GroupChecklist
          tier={viewerIsSuperAdmin ? newTier : "employee"}
          viewerIsSuperAdmin={viewerIsSuperAdmin}
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
              <th className="px-3 py-2 text-left">Name</th>
              <th className="px-3 py-2 text-left">Email</th>
              <th className="px-3 py-2 text-left">Joined</th>
              <th className="px-3 py-2 text-left">Last Active</th>
              <th className="px-3 py-2 text-left">Tier</th>
              <th className="px-3 py-2 text-left">Access</th>
              <th className="px-3 py-2 text-left"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-neutral-900">
            {users.map((user) => {
              const tier = tierOf(user.role, user.is_super_admin);
              return (
                <Fragment key={user.id}>
                  <tr className="hover:bg-neutral-900/60">
                    <td className="px-3 py-2 text-neutral-200">
                      {user.full_name?.trim() || (
                        <span className="italic text-neutral-500" title="No name on file — falling back to a guess from their email">
                          {firstNameFor(user)} (guessed)
                        </span>
                      )}
                    </td>
                    <td className="px-3 py-2 text-neutral-200">{user.email}</td>
                    <td className="px-3 py-2 text-neutral-500">
                      {new Date(user.created_at).toLocaleDateString()}
                    </td>
                    <td className="px-3 py-2 text-neutral-500">
                      {formatLastActive(user.last_active_at)}
                    </td>
                    <td className="px-3 py-2">
                      <span
                        className={`rounded-full px-2 py-0.5 text-xs font-medium ${TIER_BADGE_CLASS[tier]}`}
                      >
                        {TIER_LABEL[tier]}
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
                      <td colSpan={7} className="bg-black/40 px-4 py-4">
                        <div className="max-w-xl space-y-3 rounded-md border border-neutral-800 bg-neutral-950 p-4">
                          <div>
                            <label className="mb-1 block text-xs font-medium text-neutral-400">
                              Name
                            </label>
                            <input
                              type="text"
                              value={editFullName}
                              onChange={(e) => setEditFullName(e.target.value)}
                              placeholder="e.g. Dave Smith"
                              className="w-full max-w-xs rounded-md border border-neutral-700 bg-neutral-900 px-3 py-1.5 text-sm text-neutral-100 focus:border-neutral-500 focus:outline-none"
                            />
                            <p className="mt-1 text-xs text-neutral-500">
                              Shown across the app — Tasks, Ernie&apos;s Project chat, etc. Left
                              blank, it falls back to a guessed name from their email.
                            </p>
                          </div>

                          <div>
                            <label className="mb-1 block text-xs font-medium text-neutral-400">
                              Tier
                            </label>
                            {viewerIsSuperAdmin ? (
                              <div className="flex gap-2">
                                {(["employee", "manager", "administrator"] as Tier[]).map((t) => (
                                  <button
                                    key={t}
                                    type="button"
                                    onClick={() => setEditTier(t)}
                                    className={`rounded-md border px-3 py-1.5 text-sm font-medium ${
                                      editTier === t
                                        ? "border-white bg-white text-black"
                                        : "border-neutral-700 text-neutral-300 hover:bg-neutral-900"
                                    }`}
                                  >
                                    {TIER_LABEL[t]}
                                  </button>
                                ))}
                              </div>
                            ) : (
                              <p className="text-sm text-neutral-300">
                                {TIER_LABEL[editTier]}{" "}
                                <span className="text-xs text-neutral-500">
                                  — only an Administrator can change this
                                </span>
                              </p>
                            )}
                          </div>

                          <GroupChecklist
                            tier={editTier}
                            viewerIsSuperAdmin={viewerIsSuperAdmin}
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
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
