"use client";

// Tasks (formerly "Projects") — the company-wide action/directive tracker,
// built to match the approved preview exactly: Categories (Sales/
// Operations/Marketing/Admin/Others, seeded, more addable) -> that
// category's Items (Open/Resolved, with an optional due date and a
// "NEEDS ATTENTION" box for anything overdue/due today) -> an item's
// Detail (notes, team chat with Directive tags, and an auto-logged
// Activity timeline).
//
// The header's green button is contextual: "+ Add Category" on the
// categories landing page (creates a category via a name prompt); "+ Add
// Task" once inside a category (opens an inline form — title, optional
// notes, optional due date — and creates a real row in task_items). The
// "✨ Pull action items from today's notes" button stays visible but isn't
// wired to a real notes tool yet — that's the one piece still deliberately
// inert ("we will work on that later").
//
// Brand green (#6ABC46) marks the active filter pill, both "+ Add" buttons,
// and a Directive tag in chat — same accent Sidebar.tsx uses for the
// active-page highlight.

import { useCallback, useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { firstNameFor } from "@/lib/displayName";
import type {
  Profile,
  TaskCategory,
  TaskItem,
  TaskItemActivity,
  TaskItemAssignee,
  TaskMessage,
} from "@/lib/types/db";

const BRAND_GREEN = "#6ABC46";
const ORANGE = "#d99a3d";
const RED = "#e05c5c";
const AVATAR_PALETTE = ["#d9a23d", "#4a9fd9", "#c96ad4", "#e05c5c", "#6ABC46", "#5ad9c9"];

type View = "categories" | "items" | "detail";
type Filter = "open" | "resolved";
type ProfileLite = Pick<Profile, "full_name" | "email">;

function slugify(name: string): string {
  return name.trim().toLowerCase().replace(/\s+/g, "-");
}

function initials(name: string): string {
  return name
    .split(/\s+/)
    .map((w) => w[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();
}

function hashColor(id: string): string {
  let h = 0;
  for (const c of id) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return AVATAR_PALETTE[h % AVATAR_PALETTE.length];
}

// Same fallback the rest of the app already uses (see the Dashboard's
// "Welcome, ___" greeting, lib/displayName.ts) — a signed-in user whose
// profile predates the account-setup flow (no full_name saved) gets a
// friendly guessed name from their email instead of the raw address.
function displayName(profiles: Record<string, ProfileLite>, id: string | null): string {
  if (!id) return "Unknown";
  const p = profiles[id];
  if (!p) return "Unknown";
  return p.full_name?.trim() || firstNameFor(p);
}

function relativeTime(iso: string): string {
  const diffMs = Date.now() - new Date(iso).getTime();
  const diffMin = Math.round(diffMs / 60000);
  const diffHr = Math.round(diffMin / 60);
  const diffDay = Math.round(diffHr / 24);
  if (diffMin < 1) return "just now";
  if (diffMin < 60) return `${diffMin}m ago`;
  if (diffHr < 24) return `${diffHr}h ago`;
  if (diffDay < 7) return `${diffDay}d ago`;
  return new Date(iso).toLocaleDateString();
}

function todayIso(): string {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d.toISOString().slice(0, 10);
}

function dueStatus(item: TaskItem): "overdue" | "today" | "upcoming" | null {
  if (!item.due_date || item.status !== "open") return null;
  const today = todayIso();
  if (item.due_date < today) return "overdue";
  if (item.due_date === today) return "today";
  return "upcoming";
}

function formatDueDate(dateStr: string): string {
  return new Date(`${dateStr}T00:00:00`).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
  });
}

function activityText(entry: TaskItemActivity, profiles: Record<string, ProfileLite>): string {
  const actor = displayName(profiles, entry.actor_id);
  switch (entry.action) {
    case "created":
      return `Created by ${actor}`;
    case "due_date_set":
      return `Due date set to ${entry.detail} by ${actor}`;
    case "due_date_cleared":
      return `Due date cleared by ${actor}`;
    case "directive_posted":
      return `Directive posted by ${actor}`;
    case "reply_posted":
      return `Reply posted by ${actor}`;
    case "resolved":
      return `Marked resolved by ${actor}`;
    case "reopened":
      return `Reopened by ${actor}`;
    case "category_changed":
      return `Moved to ${entry.detail} by ${actor}`;
    default:
      return entry.action;
  }
}

export default function TasksPageClient() {
  const supabase = useMemo(() => createClient(), []);

  const [userId, setUserId] = useState<string | null>(null);
  const [categories, setCategories] = useState<TaskCategory[]>([]);
  const [items, setItems] = useState<TaskItem[]>([]);
  const [assignees, setAssignees] = useState<TaskItemAssignee[]>([]);
  const [messages, setMessages] = useState<TaskMessage[]>([]);
  const [activity, setActivity] = useState<TaskItemActivity[]>([]);
  const [profiles, setProfiles] = useState<Record<string, ProfileLite>>({});
  const [loading, setLoading] = useState(true);

  const [view, setView] = useState<View>("categories");
  const [currentCategoryId, setCurrentCategoryId] = useState<string | null>(null);
  const [selectedItemId, setSelectedItemId] = useState<string | null>(null);
  const [filter, setFilter] = useState<Filter>("open");

  const [notesDraft, setNotesDraft] = useState("");
  const [notesDirty, setNotesDirty] = useState(false);
  const [composerText, setComposerText] = useState("");
  const [composerDirective, setComposerDirective] = useState(false);
  const [sending, setSending] = useState(false);

  const [showAddTask, setShowAddTask] = useState(false);
  const [newTaskTitle, setNewTaskTitle] = useState("");
  const [newTaskNotes, setNewTaskNotes] = useState("");
  const [newTaskDueDate, setNewTaskDueDate] = useState("");
  const [newTaskAssignees, setNewTaskAssignees] = useState<string[]>([]);
  const [creatingTask, setCreatingTask] = useState(false);

  const [showAssigneePicker, setShowAssigneePicker] = useState(false);

  const loadCategories = useCallback(async () => {
    const { data } = await supabase.from("task_categories").select("*").order("sort_order");
    setCategories((data as TaskCategory[]) ?? []);
  }, [supabase]);

  const loadItems = useCallback(async () => {
    const { data } = await supabase
      .from("task_items")
      .select("*")
      .order("updated_at", { ascending: false });
    setItems((data as TaskItem[]) ?? []);
    setLoading(false);
  }, [supabase]);

  const loadAssignees = useCallback(async () => {
    const { data } = await supabase.from("task_item_assignees").select("*");
    setAssignees((data as TaskItemAssignee[]) ?? []);
  }, [supabase]);

  const loadMessages = useCallback(async () => {
    const { data } = await supabase
      .from("task_messages")
      .select("*")
      .order("created_at", { ascending: true });
    setMessages((data as TaskMessage[]) ?? []);
  }, [supabase]);

  const loadProfiles = useCallback(async () => {
    const { data } = await supabase.from("profiles").select("id, full_name, email");
    const map: Record<string, ProfileLite> = {};
    (data as (Pick<Profile, "id" | "full_name" | "email">)[] | null)?.forEach((p) => {
      map[p.id] = { full_name: p.full_name, email: p.email };
    });
    setProfiles(map);
  }, [supabase]);

  const loadActivityFor = useCallback(
    async (itemId: string) => {
      const { data } = await supabase
        .from("task_item_activity")
        .select("*")
        .eq("item_id", itemId)
        .order("created_at", { ascending: false });
      setActivity((data as TaskItemActivity[]) ?? []);
    },
    [supabase],
  );

  useEffect(() => {
    (async () => {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      setUserId(user?.id ?? null);
    })();
    // eslint-disable-next-line react-hooks/set-state-in-effect -- intentional fetch-on-mount
    loadCategories();
    loadItems();
    loadAssignees();
    loadMessages();
    loadProfiles();

    const channel = supabase
      .channel("tasks-live")
      .on("postgres_changes", { event: "*", schema: "public", table: "task_categories" }, loadCategories)
      .on("postgres_changes", { event: "*", schema: "public", table: "task_items" }, loadItems)
      .on("postgres_changes", { event: "*", schema: "public", table: "task_item_assignees" }, loadAssignees)
      .on("postgres_changes", { event: "*", schema: "public", table: "task_messages" }, loadMessages)
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [supabase, loadCategories, loadItems, loadAssignees, loadMessages, loadProfiles]);

  useEffect(() => {
    if (!selectedItemId) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- intentional reset on deselect
      setActivity([]);
      return;
    }
    loadActivityFor(selectedItemId);

    const channel = supabase
      .channel(`task-activity-${selectedItemId}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "task_item_activity",
          filter: `item_id=eq.${selectedItemId}`,
        },
        () => loadActivityFor(selectedItemId),
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [selectedItemId, supabase, loadActivityFor]);

  const selectedItem = items.find((i) => i.id === selectedItemId) ?? null;
  const currentCategory = categories.find((c) => c.id === currentCategoryId) ?? null;

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- intentional draft reset when the selected item changes
    setNotesDraft(selectedItem?.notes ?? "");
    setNotesDirty(false);
    setShowAssigneePicker(false);
  }, [selectedItem?.id, selectedItem?.notes]);

  async function logActivity(
    itemId: string,
    action: TaskItemActivity["action"],
    detail: string | null = null,
  ) {
    if (!userId) return;
    await supabase
      .from("task_item_activity")
      .insert({ item_id: itemId, actor_id: userId, action, detail });
  }

  function openCountFor(categoryId: string) {
    return items.filter((i) => i.category_id === categoryId && i.status === "open").length;
  }
  function closedCountFor(categoryId: string) {
    return items.filter((i) => i.category_id === categoryId && i.status === "resolved").length;
  }
  function urgentCountFor(categoryId: string) {
    return items.filter(
      (i) => i.category_id === categoryId && (dueStatus(i) === "overdue" || dueStatus(i) === "today"),
    ).length;
  }
  function assigneesFor(itemId: string) {
    return assignees.filter((a) => a.item_id === itemId).map((a) => a.user_id);
  }
  function lastMessageFor(itemId: string) {
    const msgs = messages.filter((m) => m.item_id === itemId);
    return msgs.length ? msgs[msgs.length - 1] : null;
  }
  function messageCountFor(itemId: string) {
    return messages.filter((m) => m.item_id === itemId).length;
  }

  function goToCategories() {
    setView("categories");
    setCurrentCategoryId(null);
    setShowAddTask(false);
  }
  function goToCategoryItems(categoryId: string) {
    setCurrentCategoryId(categoryId);
    setFilter("open");
    setView("items");
    setShowAddTask(false);
  }
  function goToDetail(itemId: string) {
    setSelectedItemId(itemId);
    setView("detail");
    setShowAddTask(false);
  }

  async function addCategory() {
    const name = window.prompt("New category name:");
    if (!name?.trim()) return;
    const key = slugify(name);
    if (categories.some((c) => c.key === key)) {
      window.alert("A category with that name already exists.");
      return;
    }
    await supabase.from("task_categories").insert({ key, name: name.trim(), created_by: userId });
    await loadCategories();
  }

  async function createTask() {
    const title = newTaskTitle.trim();
    if (!title || !currentCategoryId) return;
    setCreatingTask(true);
    const { data, error } = await supabase
      .from("task_items")
      .insert({
        category_id: currentCategoryId,
        title,
        notes: newTaskNotes.trim() || null,
        due_date: newTaskDueDate || null,
        created_by: userId,
      })
      .select()
      .single();
    setCreatingTask(false);
    if (error || !data) return;
    const newItemId = (data as TaskItem).id;
    await logActivity(newItemId, "created");
    if (newTaskAssignees.length > 0) {
      await supabase
        .from("task_item_assignees")
        .insert(newTaskAssignees.map((userId2) => ({ item_id: newItemId, user_id: userId2 })));
      await loadAssignees();
    }
    setNewTaskTitle("");
    setNewTaskNotes("");
    setNewTaskDueDate("");
    setNewTaskAssignees([]);
    setShowAddTask(false);
    await loadItems();
    goToDetail(newItemId);
  }

  function toggleNewTaskAssignee(userId2: string) {
    setNewTaskAssignees((prev) =>
      prev.includes(userId2) ? prev.filter((id) => id !== userId2) : [...prev, userId2],
    );
  }

  async function addAssignee(itemId: string, assigneeId: string) {
    await supabase.from("task_item_assignees").insert({ item_id: itemId, user_id: assigneeId });
    await loadAssignees();
  }

  async function removeAssignee(itemId: string, assigneeId: string) {
    await supabase
      .from("task_item_assignees")
      .delete()
      .eq("item_id", itemId)
      .eq("user_id", assigneeId);
    await loadAssignees();
  }

  async function deleteCategory(cat: TaskCategory) {
    const count = items.filter((i) => i.category_id === cat.id).length;
    const msg =
      count > 0
        ? `Delete "${cat.name}"? ${count} item(s) in it will move to Others.`
        : `Delete "${cat.name}"?`;
    if (!window.confirm(msg)) return;

    if (count > 0) {
      let others = categories.find((c) => c.key === "others");
      if (!others) {
        const { data } = await supabase
          .from("task_categories")
          .insert({ key: "others", name: "Others", created_by: userId })
          .select()
          .single();
        others = data as TaskCategory;
      }
      if (others) {
        await supabase
          .from("task_items")
          .update({ category_id: others.id })
          .eq("category_id", cat.id);
      }
    }
    await supabase.from("task_categories").delete().eq("id", cat.id);
    await loadCategories();
    await loadItems();
  }

  async function toggleStatus(item: TaskItem) {
    const nextStatus = item.status === "open" ? "resolved" : "open";
    await supabase.from("task_items").update({ status: nextStatus }).eq("id", item.id);
    await logActivity(item.id, nextStatus === "resolved" ? "resolved" : "reopened");
  }

  async function changeDueDate(item: TaskItem, newVal: string) {
    await supabase
      .from("task_items")
      .update({ due_date: newVal || null })
      .eq("id", item.id);
    if (newVal) {
      await logActivity(item.id, "due_date_set", formatDueDate(newVal));
    } else {
      await logActivity(item.id, "due_date_cleared");
    }
  }

  async function saveNotes() {
    if (!selectedItem) return;
    await supabase
      .from("task_items")
      .update({ notes: notesDraft.trim() || null })
      .eq("id", selectedItem.id);
    setNotesDirty(false);
  }

  async function sendMessage() {
    const body = composerText.trim();
    if (!body || !selectedItem || !userId) return;
    setSending(true);
    const { error } = await supabase.from("task_messages").insert({
      item_id: selectedItem.id,
      author_id: userId,
      body,
      is_directive: composerDirective,
    });
    setSending(false);
    if (error) return;
    await logActivity(selectedItem.id, composerDirective ? "directive_posted" : "reply_posted");
    setComposerText("");
    setComposerDirective(false);
  }

  if (loading) {
    return <p className="text-sm text-neutral-500">Loading Tasks…</p>;
  }

  return (
    <div className="flex h-[calc(100vh-8rem)] flex-col">
      <div className="flex items-start justify-between gap-6 border-b border-neutral-800 pb-4">
        <div>
          <h1 className="text-2xl font-bold text-neutral-100">Tasks</h1>
          <p className="mt-1.5 max-w-2xl text-[13px] leading-relaxed text-neutral-400">
            Anything that needs to get done, in one place — a running log per item, plus a chat
            thread so whoever&apos;s driving it can give direction and whoever&apos;s doing the
            work can post updates back, right in place. Anyone can start one and assign it.
          </p>
          {view === "categories" ? (
            <button
              type="button"
              onClick={addCategory}
              className="mt-3 rounded-md px-3.5 py-2 text-xs font-semibold text-black hover:opacity-90"
              style={{ backgroundColor: BRAND_GREEN }}
            >
              + Add Category
            </button>
          ) : (
            <button
              type="button"
              onClick={() => setShowAddTask((v) => !v)}
              className="mt-3 rounded-md px-3.5 py-2 text-xs font-semibold text-black hover:opacity-90"
              style={{ backgroundColor: BRAND_GREEN }}
            >
              + Add Task
            </button>
          )}
        </div>
        <button
          type="button"
          disabled
          title="Coming soon — not connected to a notes tool yet"
          className="shrink-0 cursor-not-allowed whitespace-nowrap rounded-md border border-neutral-700 bg-neutral-900 px-3.5 py-2 text-xs text-neutral-300 opacity-60"
        >
          ✨ Pull action items from today&apos;s notes
        </button>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
        {view === "categories" && (
          <div className="grid max-w-[900px] grid-cols-[repeat(auto-fill,minmax(200px,1fr))] gap-4 py-6">
            {categories.map((cat) => {
              const open = openCountFor(cat.id);
              const closed = closedCountFor(cat.id);
              const urgent = urgentCountFor(cat.id);
              return (
                <div
                  key={cat.id}
                  className="group relative flex min-h-[110px] cursor-pointer flex-col items-center justify-center gap-1.5 rounded-lg border border-neutral-800 bg-neutral-900 px-4 py-4 hover:border-neutral-600"
                  onClick={() => goToCategoryItems(cat.id)}
                >
                  <button
                    type="button"
                    title={`Delete ${cat.name}`}
                    onClick={(e) => {
                      e.stopPropagation();
                      deleteCategory(cat);
                    }}
                    className="absolute -left-2 -top-2 hidden h-5 w-5 items-center justify-center rounded-full border border-neutral-700 bg-neutral-800 text-xs text-neutral-400 hover:border-red-900 hover:bg-red-950 hover:text-red-400 group-hover:flex"
                  >
                    ✕
                  </button>
                  <span className="text-[15px] font-semibold text-neutral-100">{cat.name}</span>
                  {urgent > 0 && (
                    <span className="flex items-center gap-1.5 text-xs text-neutral-400">
                      Overdue items
                      <span
                        className="flex h-5 min-w-[20px] items-center justify-center rounded-full px-1.5 text-[11px] font-bold text-white"
                        style={{ backgroundColor: RED }}
                      >
                        {urgent}
                      </span>
                    </span>
                  )}
                  <span className="flex items-center gap-1.5 text-xs text-neutral-400">
                    Open items
                    <span
                      className="flex h-5 min-w-[20px] items-center justify-center rounded-full px-1.5 text-[11px] font-bold"
                      style={{ backgroundColor: ORANGE, color: "#1a1200" }}
                    >
                      {open}
                    </span>
                  </span>
                  <span className="flex items-center gap-1.5 text-xs text-neutral-400">
                    Closed items
                    <span className="flex h-5 min-w-[20px] items-center justify-center rounded-full bg-neutral-600 px-1.5 text-[11px] font-bold text-neutral-100">
                      {closed}
                    </span>
                  </span>
                </div>
              );
            })}
          </div>
        )}

        {view === "items" && currentCategory && (
          <div className="py-2">
            <button
              type="button"
              onClick={goToCategories}
              className="mb-3 flex items-center gap-1.5 text-[12.5px] text-neutral-400 hover:text-neutral-200"
            >
              ← Tasks
            </button>

            {showAddTask && (
              <div className="mb-5 flex flex-col gap-2 rounded-lg border border-neutral-800 bg-neutral-900 px-4 py-3.5">
                <input
                  type="text"
                  value={newTaskTitle}
                  onChange={(e) => setNewTaskTitle(e.target.value)}
                  placeholder="Task title"
                  className="rounded border border-neutral-700 bg-neutral-950 px-2.5 py-1.5 text-sm text-neutral-100 placeholder:text-neutral-600"
                  autoFocus
                />
                <textarea
                  value={newTaskNotes}
                  onChange={(e) => setNewTaskNotes(e.target.value)}
                  placeholder="Notes (optional)"
                  rows={2}
                  className="rounded border border-neutral-700 bg-neutral-950 px-2.5 py-1.5 text-sm text-neutral-100 placeholder:text-neutral-600"
                />
                <div className="flex items-center gap-2">
                  <label className="text-xs text-neutral-400">Due date (optional):</label>
                  <input
                    type="date"
                    value={newTaskDueDate}
                    onChange={(e) => setNewTaskDueDate(e.target.value)}
                    className="rounded border border-neutral-700 bg-neutral-950 px-2 py-1 text-xs text-neutral-200"
                  />
                </div>
                <div>
                  <p className="mb-1.5 text-xs text-neutral-400">Assign to (optional):</p>
                  <div className="flex flex-wrap gap-1.5">
                    {Object.entries(profiles).map(([id, p]) => {
                      const selected = newTaskAssignees.includes(id);
                      const name = p.full_name?.trim() || firstNameFor(p);
                      return (
                        <button
                          key={id}
                          type="button"
                          onClick={() => toggleNewTaskAssignee(id)}
                          className="flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs"
                          style={
                            selected
                              ? { borderColor: BRAND_GREEN, color: BRAND_GREEN, backgroundColor: "rgba(106,188,70,0.08)" }
                              : { borderColor: "#2a2a2a", color: "#9a9a97" }
                          }
                        >
                          <span
                            className="flex h-4 w-4 items-center justify-center rounded-full text-[8px] font-bold text-black"
                            style={{ backgroundColor: hashColor(id) }}
                          >
                            {initials(name)}
                          </span>
                          {name.split(" ")[0]}
                        </button>
                      );
                    })}
                  </div>
                </div>
                <div className="flex justify-end gap-2">
                  <button
                    type="button"
                    onClick={() => setShowAddTask(false)}
                    className="rounded-md border border-neutral-700 px-3 py-1.5 text-xs text-neutral-400 hover:bg-neutral-950"
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    onClick={createTask}
                    disabled={creatingTask || !newTaskTitle.trim()}
                    className="rounded-md px-3 py-1.5 text-xs font-semibold text-black disabled:opacity-50"
                    style={{ backgroundColor: BRAND_GREEN }}
                  >
                    {creatingTask ? "Creating…" : "Create Task"}
                  </button>
                </div>
              </div>
            )}

            {(() => {
              const overdueItems = items.filter(
                (i) => i.category_id === currentCategory.id && dueStatus(i) === "overdue",
              );
              const todayItems = items.filter(
                (i) => i.category_id === currentCategory.id && dueStatus(i) === "today",
              );
              if (overdueItems.length === 0 && todayItems.length === 0) return null;
              return (
                <div className="mb-5 rounded-lg border border-red-950 bg-red-950/30 px-4 py-3.5">
                  <p className="mb-2 text-xs font-bold tracking-wide text-red-300">⚠ NEEDS ATTENTION</p>
                  {[...overdueItems, ...todayItems].map((item) => {
                    const status = dueStatus(item);
                    return (
                      <button
                        key={item.id}
                        type="button"
                        onClick={() => goToDetail(item.id)}
                        className="flex w-full items-center justify-between gap-3 border-t border-red-900/30 py-1.5 text-left first:border-t-0"
                      >
                        <span className="text-sm text-neutral-300">{item.title}</span>
                        <span
                          className="whitespace-nowrap text-xs font-semibold"
                          style={{ color: status === "overdue" ? RED : ORANGE }}
                        >
                          {status === "overdue" ? "Past due" : "Due today"} ·{" "}
                          {item.due_date && formatDueDate(item.due_date)}
                        </span>
                      </button>
                    );
                  })}
                </div>
              );
            })()}

            <div className="mb-4 flex gap-2">
              {(["open", "resolved"] as Filter[]).map((f) => (
                <button
                  key={f}
                  type="button"
                  onClick={() => setFilter(f)}
                  className={`rounded-full px-3.5 py-1.5 text-xs font-medium capitalize ${
                    filter === f
                      ? "bg-neutral-100 font-semibold text-neutral-900"
                      : "border border-neutral-700 text-neutral-400 hover:text-white"
                  }`}
                >
                  {f}
                </button>
              ))}
            </div>

            <div className="grid grid-cols-[repeat(auto-fill,minmax(300px,1fr))] gap-3">
              {items
                .filter((i) => i.category_id === currentCategory.id && i.status === filter)
                .map((item) => {
                  const status = dueStatus(item);
                  const last = lastMessageFor(item.id);
                  const people = assigneesFor(item.id);
                  return (
                    <div
                      key={item.id}
                      onClick={() => goToDetail(item.id)}
                      className="cursor-pointer rounded-lg border border-neutral-800 bg-neutral-900 px-3.5 py-3 hover:border-neutral-600"
                    >
                      <div className="mb-1 flex items-center gap-2">
                        <span
                          className="rounded px-1.5 py-0.5 text-[9.5px] font-bold tracking-wide"
                          style={
                            item.status === "open"
                              ? { backgroundColor: "#4a3a1f", color: ORANGE }
                              : { backgroundColor: "#1f3a2a", color: BRAND_GREEN }
                          }
                        >
                          {item.status.toUpperCase()}
                        </span>
                        <span className="flex-1 text-[13.5px] font-semibold leading-tight text-neutral-100">
                          {item.title}
                        </span>
                      </div>
                      <p className="mb-1.5 text-[11px] text-neutral-500">
                        {item.source === "ai_import" ? "Pulled from notes" : "Added manually"}
                      </p>
                      {status && (
                        <p
                          className="mb-2 text-[11.5px] font-semibold"
                          style={{ color: status === "overdue" ? RED : status === "today" ? ORANGE : "#6b6b68" }}
                        >
                          📅 Due {item.due_date && formatDueDate(item.due_date)}
                          {status === "overdue" ? " — Past due" : status === "today" ? " — Due today" : ""}
                        </p>
                      )}
                      {last && (
                        <p className="mb-2 line-clamp-2 text-xs leading-snug text-neutral-400">
                          <b className="text-neutral-200">{displayName(profiles, last.author_id).split(" ")[0]}:</b>{" "}
                          {last.body}
                        </p>
                      )}
                      <div className="flex items-center justify-between">
                        <div className="flex">
                          {people.map((pid, idx) => (
                            <div
                              key={pid}
                              className="flex h-5 w-5 items-center justify-center rounded-full border-[1.5px] border-neutral-900 text-[9px] font-bold text-black"
                              style={{ backgroundColor: hashColor(pid), marginLeft: idx === 0 ? 0 : -6 }}
                            >
                              {initials(displayName(profiles, pid))}
                            </div>
                          ))}
                        </div>
                        <span className="text-[11px] text-neutral-500">💬 {messageCountFor(item.id)}</span>
                      </div>
                    </div>
                  );
                })}
              {items.filter((i) => i.category_id === currentCategory.id && i.status === filter).length === 0 && (
                <p className="col-span-full py-8 text-center text-sm text-neutral-600">No items here yet.</p>
              )}
            </div>
          </div>
        )}

        {view === "detail" && selectedItem && (
          <div className="flex h-full gap-4 py-2">
            <div className="flex w-72 shrink-0 flex-col overflow-y-auto border-r border-neutral-800 pr-4">
              <button
                type="button"
                onClick={() => currentCategory && goToCategoryItems(currentCategory.id)}
                className="mb-3 flex items-center gap-1.5 text-[12.5px] text-neutral-400 hover:text-neutral-200"
              >
                ← {currentCategory?.name ?? "Tasks"}
              </button>
              <p className="mb-2 text-[11px] tracking-wide text-neutral-500">ACTIVITY LOG</p>
              {activity.length === 0 && <p className="text-xs text-neutral-600">No activity yet.</p>}
              <div className="flex flex-col gap-3">
                {activity.map((entry) => (
                  <div key={entry.id} className="flex gap-2.5">
                    <span
                      className="mt-1 h-2 w-2 shrink-0 rounded-full"
                      style={{ backgroundColor: BRAND_GREEN }}
                    />
                    <div>
                      <p className="text-xs leading-snug text-neutral-300">
                        {activityText(entry, profiles)}
                      </p>
                      <p className="text-[11px] text-neutral-600">{relativeTime(entry.created_at)}</p>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            <div className="flex min-w-0 flex-1 flex-col">
              <div className="flex items-start justify-between gap-4 pb-3">
                <div>
                  <div className="flex flex-wrap items-center gap-2.5">
                    <h2 className="text-lg font-bold text-neutral-100">{selectedItem.title}</h2>
                    <span
                      className="rounded px-2 py-0.5 text-xs font-semibold"
                      style={
                        selectedItem.status === "open"
                          ? { backgroundColor: "#4a3a1f", color: ORANGE }
                          : { backgroundColor: "#1f3a2a", color: BRAND_GREEN }
                      }
                    >
                      {selectedItem.status.toUpperCase()}
                    </span>
                  </div>
                  <p className="mt-1.5 text-xs text-neutral-400">
                    <b className="text-neutral-300">Source:</b>{" "}
                    {selectedItem.source === "ai_import" ? "Pulled from notes" : "Added manually"}
                  </p>
                  <div className="mt-1.5 flex items-center gap-2 text-xs text-neutral-400">
                    <b className="text-neutral-300">Due date:</b>
                    <input
                      type="date"
                      defaultValue={selectedItem.due_date ?? ""}
                      onChange={(e) => changeDueDate(selectedItem, e.target.value)}
                      className="rounded border border-neutral-700 bg-neutral-900 px-1.5 py-0.5 text-xs text-neutral-200"
                    />
                    {dueStatus(selectedItem) === "overdue" && (
                      <span className="rounded px-1.5 py-0.5 text-[11px] font-bold" style={{ backgroundColor: "#4a1f1f", color: RED }}>
                        Past due
                      </span>
                    )}
                    {dueStatus(selectedItem) === "today" && (
                      <span className="rounded px-1.5 py-0.5 text-[11px] font-bold" style={{ backgroundColor: "#4a3a1f", color: ORANGE }}>
                        Due today
                      </span>
                    )}
                  </div>
                  <div className="relative mt-2 flex items-center gap-1.5">
                    <b className="text-xs text-neutral-300">Assigned:</b>
                    {assigneesFor(selectedItem.id).map((pid) => (
                      <button
                        key={pid}
                        type="button"
                        title={`Remove ${displayName(profiles, pid)}`}
                        onClick={() => removeAssignee(selectedItem.id, pid)}
                        className="flex h-6 w-6 items-center justify-center rounded-full text-[10px] font-bold text-black hover:opacity-70"
                        style={{ backgroundColor: hashColor(pid) }}
                      >
                        {initials(displayName(profiles, pid))}
                      </button>
                    ))}
                    <button
                      type="button"
                      onClick={() => setShowAssigneePicker((v) => !v)}
                      className="flex h-6 w-6 items-center justify-center rounded-full border border-dashed border-neutral-600 text-xs text-neutral-500 hover:border-neutral-400 hover:text-neutral-300"
                    >
                      +
                    </button>
                    {showAssigneePicker && (
                      <div className="absolute left-0 top-7 z-10 flex w-56 flex-col gap-1 rounded-lg border border-neutral-700 bg-neutral-900 p-2 shadow-lg">
                        {Object.entries(profiles)
                          .filter(([id]) => !assigneesFor(selectedItem.id).includes(id))
                          .map(([id, p]) => (
                            <button
                              key={id}
                              type="button"
                              onClick={() => {
                                addAssignee(selectedItem.id, id);
                                setShowAssigneePicker(false);
                              }}
                              className="rounded px-2 py-1 text-left text-xs text-neutral-300 hover:bg-neutral-800"
                            >
                              {p.full_name?.trim() || firstNameFor(p)}
                            </button>
                          ))}
                        {Object.entries(profiles).filter(
                          ([id]) => !assigneesFor(selectedItem.id).includes(id),
                        ).length === 0 && (
                          <p className="px-2 py-1 text-xs text-neutral-600">Everyone&apos;s assigned.</p>
                        )}
                      </div>
                    )}
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => toggleStatus(selectedItem)}
                  className="shrink-0 rounded-md border border-neutral-700 px-3 py-1.5 text-xs text-neutral-300 hover:bg-neutral-900"
                >
                  {selectedItem.status === "open" ? "Mark resolved" : "Reopen"}
                </button>
              </div>

              <div className="min-h-0 flex-1 overflow-y-auto">
                <p className="mb-2 text-[11px] tracking-wide text-neutral-500">NOTES</p>
                <textarea
                  value={notesDraft}
                  onChange={(e) => {
                    setNotesDraft(e.target.value);
                    setNotesDirty(true);
                  }}
                  onBlur={() => notesDirty && saveNotes()}
                  placeholder="Add notes for this item…"
                  rows={3}
                  className="mb-6 w-full resize-none rounded-lg border border-neutral-800 bg-neutral-900 px-3.5 py-3 text-sm leading-relaxed text-neutral-100 placeholder:text-neutral-600"
                />

                <p className="mb-2 text-[11px] tracking-wide text-neutral-500">TEAM CHAT</p>
                <hr className="mb-4 border-neutral-800" />
                {messages.filter((m) => m.item_id === selectedItem.id).length === 0 && (
                  <p className="text-sm text-neutral-600">No messages yet.</p>
                )}
                <div className="flex flex-col gap-3.5">
                  {messages
                    .filter((m) => m.item_id === selectedItem.id)
                    .map((m) => (
                      <div key={m.id} className="flex gap-2.5">
                        <div
                          className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-[10.5px] font-bold text-black"
                          style={{ backgroundColor: hashColor(m.author_id ?? "") }}
                        >
                          {initials(displayName(profiles, m.author_id))}
                        </div>
                        <div className="min-w-0 flex-1">
                          <div className="mb-1 flex items-center gap-2">
                            <span className="text-[13px] font-semibold text-neutral-200">
                              {displayName(profiles, m.author_id)}
                            </span>
                            {m.is_directive && (
                              <span
                                className="rounded border px-1.5 py-0.5 text-[9px] font-bold tracking-wide"
                                style={{ color: BRAND_GREEN, borderColor: "#3f7a2a" }}
                              >
                                DIRECTIVE
                              </span>
                            )}
                            <span className="ml-auto text-[11px] text-neutral-600">
                              {relativeTime(m.created_at)}
                            </span>
                          </div>
                          <div
                            className="whitespace-pre-wrap rounded-lg px-3.5 py-2.5 text-[13px] leading-relaxed text-neutral-200"
                            style={
                              m.is_directive
                                ? { backgroundColor: "#2a3a1f", border: "1px solid #4a6a2f" }
                                : { backgroundColor: "#191919", border: "1px solid #2a2a2a" }
                            }
                          >
                            {m.body}
                          </div>
                        </div>
                      </div>
                    ))}
                </div>
              </div>

              <div className="border-t border-neutral-800 pt-3">
                <div className="flex items-center gap-2.5">
                  <label className="flex shrink-0 cursor-pointer items-center gap-1.5 text-xs text-neutral-400">
                    <input
                      type="checkbox"
                      checked={composerDirective}
                      onChange={(e) => setComposerDirective(e.target.checked)}
                    />
                    Directive
                  </label>
                  <input
                    type="text"
                    value={composerText}
                    onChange={(e) => setComposerText(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") sendMessage();
                    }}
                    placeholder="Reply…"
                    className="min-w-0 flex-1 rounded-md border border-neutral-700 bg-neutral-900 px-3 py-2 text-sm text-neutral-100 placeholder:text-neutral-600"
                  />
                  <button
                    type="button"
                    onClick={sendMessage}
                    disabled={sending || !composerText.trim()}
                    className="shrink-0 rounded-md px-3.5 py-2 text-xs font-semibold text-black disabled:opacity-50"
                    style={{ backgroundColor: BRAND_GREEN }}
                  >
                    {sending ? "Sending…" : "Send"}
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
