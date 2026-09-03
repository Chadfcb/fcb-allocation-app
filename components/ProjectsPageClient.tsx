"use client";

// Projects — the company-wide action/directive tracker (see sql/projects.sql
// for the full design rationale). Opens directly into a two-pane workspace,
// no separate hub page: a flat, filterable list of items on the left, and
// the selected item's notes + team chat thread on the right. Any signed-in
// user can create an item, edit it, resolve/reopen it, and post to its
// thread — there's no admin gate anywhere in this feature except deleting a
// bad item/message.
//
// Brand green (#6ABC46, sampled from the hop cone in FCB's logo) marks the
// active filter pill, the "New Item" / "Send" actions, and a Directive tag
// in the chat thread — same accent Sidebar.tsx now uses for the active-page
// highlight.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import type { Profile, ProjectItem, ProjectMessage } from "@/lib/types/db";

const BRAND_GREEN = "#6ABC46";

type Filter = "all" | "open" | "resolved";

function authorName(
  profiles: Record<string, Pick<Profile, "full_name" | "email">>,
  id: string | null,
): string {
  if (!id) return "Unknown";
  const p = profiles[id];
  if (!p) return "Unknown";
  return p.full_name?.trim() || p.email;
}

function relativeTime(iso: string): string {
  const diffMs = Date.now() - new Date(iso).getTime();
  const diffSec = Math.round(diffMs / 1000);
  const diffMin = Math.round(diffSec / 60);
  const diffHr = Math.round(diffMin / 60);
  const diffDay = Math.round(diffHr / 24);

  if (diffSec < 60) return "just now";
  if (diffMin < 60) return `${diffMin}m ago`;
  if (diffHr < 24) return `${diffHr}h ago`;
  if (diffDay < 7) return `${diffDay}d ago`;
  return new Date(iso).toLocaleDateString();
}

export default function ProjectsPageClient() {
  const supabase = useMemo(() => createClient(), []);

  const [userId, setUserId] = useState<string | null>(null);
  const [items, setItems] = useState<ProjectItem[]>([]);
  const [messages, setMessages] = useState<ProjectMessage[]>([]);
  const [profiles, setProfiles] = useState<
    Record<string, Pick<Profile, "full_name" | "email">>
  >({});
  const [loading, setLoading] = useState(true);

  const [filter, setFilter] = useState<Filter>("open");
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const [showNewItem, setShowNewItem] = useState(false);
  const [newTitle, setNewTitle] = useState("");
  const [newNotes, setNewNotes] = useState("");
  const [creating, setCreating] = useState(false);

  const [notesDraft, setNotesDraft] = useState("");
  const [notesDirty, setNotesDirty] = useState(false);
  const [savingNotes, setSavingNotes] = useState(false);

  const [composerText, setComposerText] = useState("");
  const [composerDirective, setComposerDirective] = useState(false);
  const [sending, setSending] = useState(false);

  const threadEndRef = useRef<HTMLDivElement | null>(null);

  const loadItems = useCallback(async () => {
    const { data } = await supabase
      .from("project_items")
      .select("*")
      .order("updated_at", { ascending: false });
    setItems((data as ProjectItem[]) ?? []);
    setLoading(false);
  }, [supabase]);

  const loadMessagesFor = useCallback(
    async (itemId: string) => {
      const { data } = await supabase
        .from("project_messages")
        .select("*")
        .eq("item_id", itemId)
        .order("created_at", { ascending: true });
      setMessages((data as ProjectMessage[]) ?? []);
    },
    [supabase],
  );

  const loadProfiles = useCallback(async () => {
    const { data } = await supabase
      .from("profiles")
      .select("id, full_name, email");
    const map: Record<string, Pick<Profile, "full_name" | "email">> = {};
    (data as (Pick<Profile, "id" | "full_name" | "email">)[] | null)?.forEach(
      (p) => {
        map[p.id] = { full_name: p.full_name, email: p.email };
      },
    );
    setProfiles(map);
  }, [supabase]);

  useEffect(() => {
    (async () => {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      setUserId(user?.id ?? null);
    })();
    // eslint-disable-next-line react-hooks/set-state-in-effect -- intentional fetch-on-mount
    loadItems();
    loadProfiles();

    const channel = supabase
      .channel("projects-live")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "project_items" },
        loadItems,
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [supabase, loadItems, loadProfiles]);

  // Selected item's chat thread gets its own realtime subscription, scoped
  // to that item, so switching between items doesn't pile up channels.
  useEffect(() => {
    if (!selectedId) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- intentional reset on deselect
      setMessages([]);
      return;
    }
    loadMessagesFor(selectedId);

    const channel = supabase
      .channel(`project-messages-${selectedId}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "project_messages",
          filter: `item_id=eq.${selectedId}`,
        },
        () => loadMessagesFor(selectedId),
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [selectedId, supabase, loadMessagesFor]);

  useEffect(() => {
    threadEndRef.current?.scrollIntoView({ block: "end" });
  }, [messages]);

  const selectedItem = items.find((i) => i.id === selectedId) ?? null;

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- intentional draft reset when the selected item changes
    setNotesDraft(selectedItem?.notes ?? "");
    setNotesDirty(false);
  }, [selectedItem?.id, selectedItem?.notes]);

  const filteredItems = items.filter((item) => {
    if (filter === "all") return true;
    return item.status === filter;
  });

  const counts = {
    all: items.length,
    open: items.filter((i) => i.status === "open").length,
    resolved: items.filter((i) => i.status === "resolved").length,
  };

  async function createItem() {
    const title = newTitle.trim();
    if (!title || !userId) return;
    setCreating(true);
    const { data, error } = await supabase
      .from("project_items")
      .insert({
        title,
        notes: newNotes.trim() || null,
        created_by: userId,
      })
      .select()
      .single();
    setCreating(false);
    if (error) return;
    setNewTitle("");
    setNewNotes("");
    setShowNewItem(false);
    await loadItems();
    if (data) setSelectedId((data as ProjectItem).id);
  }

  async function toggleStatus(item: ProjectItem) {
    const nextStatus = item.status === "open" ? "resolved" : "open";
    await supabase
      .from("project_items")
      .update({ status: nextStatus })
      .eq("id", item.id);
  }

  async function saveNotes() {
    if (!selectedItem) return;
    setSavingNotes(true);
    await supabase
      .from("project_items")
      .update({ notes: notesDraft.trim() || null })
      .eq("id", selectedItem.id);
    setSavingNotes(false);
    setNotesDirty(false);
  }

  async function sendMessage() {
    const body = composerText.trim();
    if (!body || !selectedItem || !userId) return;
    setSending(true);
    const { error } = await supabase.from("project_messages").insert({
      item_id: selectedItem.id,
      author_id: userId,
      body,
      is_directive: composerDirective,
    });
    setSending(false);
    if (error) return;
    setComposerText("");
    setComposerDirective(false);
  }

  if (loading) {
    return <p className="text-sm text-neutral-500">Loading Projects…</p>;
  }

  return (
    <div className="flex h-[calc(100vh-8rem)] gap-4">
      {/* Left pane: filterable item list */}
      <div className="flex w-80 shrink-0 flex-col rounded-lg border border-neutral-800 bg-neutral-950">
        <div className="flex items-center justify-between border-b border-neutral-800 p-3">
          <h1 className="font-semibold text-neutral-100">Projects</h1>
          <button
            type="button"
            onClick={() => setShowNewItem((v) => !v)}
            className="rounded-md px-2 py-1 text-xs font-semibold text-black hover:opacity-90"
            style={{ backgroundColor: BRAND_GREEN }}
          >
            + New Item
          </button>
        </div>

        {showNewItem && (
          <div className="flex flex-col gap-2 border-b border-neutral-800 p-3">
            <input
              type="text"
              value={newTitle}
              onChange={(e) => setNewTitle(e.target.value)}
              placeholder="Title"
              className="rounded border border-neutral-700 bg-neutral-900 px-2 py-1 text-sm text-neutral-100 placeholder:text-neutral-600"
              autoFocus
            />
            <textarea
              value={newNotes}
              onChange={(e) => setNewNotes(e.target.value)}
              placeholder="Notes (optional)"
              rows={2}
              className="rounded border border-neutral-700 bg-neutral-900 px-2 py-1 text-sm text-neutral-100 placeholder:text-neutral-600"
            />
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setShowNewItem(false)}
                className="rounded-md border border-neutral-700 px-2 py-1 text-xs text-neutral-400 hover:bg-neutral-900"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={createItem}
                disabled={creating || !newTitle.trim()}
                className="rounded-md px-2 py-1 text-xs font-semibold text-black disabled:opacity-50"
                style={{ backgroundColor: BRAND_GREEN }}
              >
                {creating ? "Creating…" : "Create"}
              </button>
            </div>
          </div>
        )}

        <div className="flex gap-1 border-b border-neutral-800 p-2">
          {(["all", "open", "resolved"] as Filter[]).map((f) => (
            <button
              key={f}
              type="button"
              onClick={() => setFilter(f)}
              className={`rounded-full px-3 py-1 text-xs font-medium capitalize ${
                filter === f
                  ? "text-black"
                  : "bg-neutral-900 text-neutral-400 hover:text-white"
              }`}
              style={filter === f ? { backgroundColor: BRAND_GREEN } : undefined}
            >
              {f} ({counts[f]})
            </button>
          ))}
        </div>

        <div className="flex-1 overflow-y-auto">
          {filteredItems.length === 0 && (
            <p className="p-3 text-sm text-neutral-600">
              No {filter === "all" ? "" : filter} items yet.
            </p>
          )}
          {filteredItems.map((item) => (
            <button
              key={item.id}
              type="button"
              onClick={() => setSelectedId(item.id)}
              className={`flex w-full flex-col gap-0.5 border-b border-neutral-900 px-3 py-2 text-left ${
                selectedId === item.id ? "bg-neutral-900" : "hover:bg-neutral-900/60"
              }`}
            >
              <div className="flex items-center gap-2">
                <span
                  className={`h-1.5 w-1.5 shrink-0 rounded-full ${
                    item.status === "open" ? "" : "bg-neutral-600"
                  }`}
                  style={
                    item.status === "open" ? { backgroundColor: BRAND_GREEN } : undefined
                  }
                />
                <span className="truncate text-sm text-neutral-200">{item.title}</span>
              </div>
              <span className="pl-3.5 text-xs text-neutral-600">
                {relativeTime(item.updated_at)}
              </span>
            </button>
          ))}
        </div>
      </div>

      {/* Right pane: selected item's notes + chat thread */}
      <div className="flex flex-1 flex-col rounded-lg border border-neutral-800 bg-neutral-950">
        {!selectedItem ? (
          <div className="flex flex-1 items-center justify-center text-sm text-neutral-600">
            Select an item, or create a new one, to see its notes and team chat.
          </div>
        ) : (
          <>
            <div className="flex items-center justify-between border-b border-neutral-800 p-3">
              <div className="flex items-center gap-2">
                <h2 className="font-semibold text-neutral-100">{selectedItem.title}</h2>
                <span
                  className={`rounded px-2 py-0.5 text-xs font-medium ${
                    selectedItem.status === "open" ? "bg-neutral-900" : "bg-neutral-900 text-neutral-500"
                  }`}
                  style={
                    selectedItem.status === "open" ? { color: BRAND_GREEN } : undefined
                  }
                >
                  {selectedItem.status === "open" ? "Open" : "Resolved"}
                </span>
              </div>
              <button
                type="button"
                onClick={() => toggleStatus(selectedItem)}
                className="rounded-md border border-neutral-700 px-2 py-1 text-xs text-neutral-300 hover:bg-neutral-900"
              >
                {selectedItem.status === "open" ? "Mark Resolved" : "Reopen"}
              </button>
            </div>

            <div className="border-b border-neutral-800 p-3">
              <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-neutral-500">
                Notes
              </p>
              <textarea
                value={notesDraft}
                onChange={(e) => {
                  setNotesDraft(e.target.value);
                  setNotesDirty(true);
                }}
                onBlur={() => notesDirty && saveNotes()}
                placeholder="Add notes for this item…"
                rows={3}
                className="w-full resize-none rounded border border-neutral-700 bg-neutral-900 px-2 py-1 text-sm text-neutral-100 placeholder:text-neutral-600"
              />
              {savingNotes && <p className="mt-1 text-xs text-neutral-600">Saving…</p>}
            </div>

            <div className="flex-1 overflow-y-auto p-3">
              <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-neutral-500">
                Team Chat
              </p>
              {messages.length === 0 && (
                <p className="text-sm text-neutral-600">No messages yet.</p>
              )}
              <div className="flex flex-col gap-3">
                {messages.map((m) => (
                  <div key={m.id} className="flex flex-col gap-0.5">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-medium text-neutral-200">
                        {authorName(profiles, m.author_id)}
                      </span>
                      {m.is_directive && (
                        <span
                          className="rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase text-black"
                          style={{ backgroundColor: BRAND_GREEN }}
                        >
                          Directive
                        </span>
                      )}
                      <span className="text-xs text-neutral-600">
                        {relativeTime(m.created_at)}
                      </span>
                    </div>
                    <p className="whitespace-pre-wrap text-sm text-neutral-300">{m.body}</p>
                  </div>
                ))}
              </div>
              <div ref={threadEndRef} />
            </div>

            <div className="border-t border-neutral-800 p-3">
              <textarea
                value={composerText}
                onChange={(e) => setComposerText(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    sendMessage();
                  }
                }}
                placeholder="Reply to this item's thread…"
                rows={2}
                className="w-full resize-none rounded border border-neutral-700 bg-neutral-900 px-2 py-1 text-sm text-neutral-100 placeholder:text-neutral-600"
              />
              <div className="mt-2 flex items-center justify-between">
                <label className="flex items-center gap-1.5 text-xs text-neutral-400">
                  <input
                    type="checkbox"
                    checked={composerDirective}
                    onChange={(e) => setComposerDirective(e.target.checked)}
                  />
                  Post as Directive
                </label>
                <button
                  type="button"
                  onClick={sendMessage}
                  disabled={sending || !composerText.trim()}
                  className="rounded-md px-3 py-1 text-xs font-semibold text-black disabled:opacity-50"
                  style={{ backgroundColor: BRAND_GREEN }}
                >
                  {sending ? "Sending…" : "Send"}
                </button>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
