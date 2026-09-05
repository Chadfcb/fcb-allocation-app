"use client";

// Sales > Chain Authorizations — which items each retail chain is
// authorized to carry. Simple two-level structure: Chain -> Items (one
// freeform text line per item). Added 2026-09-05, per Chad, imported from
// a spreadsheet where this same data was crammed sideways into a handful
// of columns per chain. Chain and item are both freely addable/removable
// right on this page — no more editing the spreadsheet. Modeled on
// UpcTableClient.tsx's load/realtime/audit-log conventions.

import { useCallback, useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { logChange } from "@/lib/audit";
import type { ChainAuthChain, ChainAuthItem } from "@/lib/types/db";

export default function ChainAuthorizationsClient() {
  const supabase = useMemo(() => createClient(), []);

  const [chains, setChains] = useState<ChainAuthChain[]>([]);
  const [items, setItems] = useState<ChainAuthItem[]>([]);
  const [userId, setUserId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const [newChainName, setNewChainName] = useState("");
  // One new-item draft per chain, keyed by chain id.
  const [newItemText, setNewItemText] = useState<Record<string, string>>({});

  const [editingItemId, setEditingItemId] = useState<string | null>(null);
  const [editItemText, setEditItemText] = useState("");

  const [editingChainId, setEditingChainId] = useState<string | null>(null);
  const [editChainName, setEditChainName] = useState("");

  const load = useCallback(async () => {
    const {
      data: { user },
    } = await supabase.auth.getUser();
    setUserId(user?.id ?? null);

    const [chainsRes, itemsRes] = await Promise.all([
      supabase.from("chain_auth_chains").select("*").order("sort_order", { ascending: true }).order("name", { ascending: true }),
      supabase.from("chain_auth_items").select("*").order("sort_order", { ascending: true }).order("item_text", { ascending: true }),
    ]);

    setChains((chainsRes.data as ChainAuthChain[]) ?? []);
    setItems((itemsRes.data as ChainAuthItem[]) ?? []);
    setLoading(false);
  }, [supabase]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- intentional fetch-on-mount
    load();
    const channel = supabase
      .channel("chain-authorizations")
      .on("postgres_changes", { event: "*", schema: "public", table: "chain_auth_chains" }, () => load())
      .on("postgres_changes", { event: "*", schema: "public", table: "chain_auth_items" }, () => load())
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [supabase, load]);

  const itemsByChain = useMemo(() => {
    const map: Record<string, ChainAuthItem[]> = {};
    for (const item of items) {
      (map[item.chain_id] ??= []).push(item);
    }
    return map;
  }, [items]);

  async function handleAddChain() {
    if (!userId) return;
    const name = newChainName.trim();
    if (!name) return;
    setSaving(true);
    const { data, error } = await supabase
      .from("chain_auth_chains")
      .insert({ name, created_by: userId })
      .select("id")
      .single();
    if (!error && data) {
      await logChange(supabase, {
        weekId: null,
        tableName: "chain_auth_chains",
        recordId: data.id,
        fieldName: "chain",
        oldValue: null,
        newValue: name,
        changedBy: userId,
      });
      setNewChainName("");
    }
    setSaving(false);
    await load();
  }

  async function handleDeleteChain(chain: ChainAuthChain) {
    if (!userId) return;
    const count = itemsByChain[chain.id]?.length ?? 0;
    const warning = count > 0 ? ` Its ${count} item${count === 1 ? "" : "s"} will be deleted too.` : "";
    if (!window.confirm(`Delete "${chain.name}"?${warning} This can't be undone.`)) return;
    await supabase.from("chain_auth_chains").delete().eq("id", chain.id);
    await logChange(supabase, {
      weekId: null,
      tableName: "chain_auth_chains",
      recordId: chain.id,
      fieldName: "chain",
      oldValue: chain.name,
      newValue: null,
      changedBy: userId,
    });
    await load();
  }

  function startEditChain(chain: ChainAuthChain) {
    setEditingChainId(chain.id);
    setEditChainName(chain.name);
  }

  function cancelEditChain() {
    setEditingChainId(null);
    setEditChainName("");
  }

  async function saveEditChain(chain: ChainAuthChain) {
    if (!userId) return;
    const name = editChainName.trim();
    if (!name) return;
    setSaving(true);
    await supabase.from("chain_auth_chains").update({ name }).eq("id", chain.id);
    if (name !== chain.name) {
      await logChange(supabase, {
        weekId: null,
        tableName: "chain_auth_chains",
        recordId: chain.id,
        fieldName: "chain",
        oldValue: chain.name,
        newValue: name,
        changedBy: userId,
      });
    }
    setSaving(false);
    cancelEditChain();
    await load();
  }

  async function handleAddItem(chain: ChainAuthChain) {
    if (!userId) return;
    const text = (newItemText[chain.id] ?? "").trim();
    if (!text) return;
    setSaving(true);
    const { data, error } = await supabase
      .from("chain_auth_items")
      .insert({ chain_id: chain.id, item_text: text, created_by: userId })
      .select("id")
      .single();
    if (!error && data) {
      await logChange(supabase, {
        weekId: null,
        tableName: "chain_auth_items",
        recordId: data.id,
        fieldName: `${chain.name}`,
        oldValue: null,
        newValue: text,
        changedBy: userId,
      });
      setNewItemText((prev) => ({ ...prev, [chain.id]: "" }));
    }
    setSaving(false);
    await load();
  }

  function startEditItem(item: ChainAuthItem) {
    setEditingItemId(item.id);
    setEditItemText(item.item_text);
  }

  function cancelEditItem() {
    setEditingItemId(null);
    setEditItemText("");
  }

  async function saveEditItem(item: ChainAuthItem, chain: ChainAuthChain) {
    if (!userId) return;
    const text = editItemText.trim();
    if (!text) return;
    setSaving(true);
    await supabase.from("chain_auth_items").update({ item_text: text }).eq("id", item.id);
    if (text !== item.item_text) {
      await logChange(supabase, {
        weekId: null,
        tableName: "chain_auth_items",
        recordId: item.id,
        fieldName: chain.name,
        oldValue: item.item_text,
        newValue: text,
        changedBy: userId,
      });
    }
    setSaving(false);
    cancelEditItem();
    await load();
  }

  async function handleDeleteItem(item: ChainAuthItem, chain: ChainAuthChain) {
    if (!userId) return;
    if (!window.confirm(`Remove "${item.item_text}" from ${chain.name}?`)) return;
    await supabase.from("chain_auth_items").delete().eq("id", item.id);
    await logChange(supabase, {
      weekId: null,
      tableName: "chain_auth_items",
      recordId: item.id,
      fieldName: chain.name,
      oldValue: item.item_text,
      newValue: null,
      changedBy: userId,
    });
    if (editingItemId === item.id) cancelEditItem();
    await load();
  }

  if (loading) return <p className="text-sm text-neutral-400">Loading…</p>;

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h1 className="text-lg font-semibold text-neutral-100">Chain Authorizations</h1>
        <p className="text-sm text-neutral-500">
          {chains.length} chain{chains.length === 1 ? "" : "s"}
        </p>
      </div>

      <div className="flex flex-col gap-4">
        {chains.length === 0 && (
          <p className="rounded-lg border border-neutral-800 px-3 py-8 text-center text-sm text-neutral-500">
            No chains yet. Add one below to get started.
          </p>
        )}

        {chains.map((chain) => {
          const chainItems = itemsByChain[chain.id] ?? [];
          return (
            <div key={chain.id} className="overflow-hidden rounded-lg border border-neutral-800">
              <div className="flex items-center justify-between gap-2 border-b border-neutral-800 bg-neutral-900 px-3 py-2">
                {editingChainId === chain.id ? (
                  <div className="flex flex-1 items-center gap-2">
                    <input
                      value={editChainName}
                      onChange={(e) => setEditChainName(e.target.value)}
                      className="flex-1 rounded-md border border-neutral-700 bg-neutral-950 px-2 py-1 text-sm text-neutral-100"
                      autoFocus
                    />
                    <button
                      type="button"
                      onClick={() => saveEditChain(chain)}
                      disabled={saving}
                      className="rounded-md bg-white px-2 py-1 text-xs font-medium text-black hover:bg-neutral-200 disabled:opacity-50"
                    >
                      Save
                    </button>
                    <button
                      type="button"
                      onClick={cancelEditChain}
                      className="rounded-md border border-neutral-700 px-2 py-1 text-xs text-neutral-300 hover:bg-neutral-900"
                    >
                      Cancel
                    </button>
                  </div>
                ) : (
                  <>
                    <span className="font-semibold text-neutral-100">
                      {chain.name}{" "}
                      <span className="font-normal text-neutral-500">
                        ({chainItems.length} item{chainItems.length === 1 ? "" : "s"})
                      </span>
                    </span>
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={() => startEditChain(chain)}
                        className="rounded-md border border-neutral-700 px-2 py-1 text-xs text-neutral-300 hover:bg-neutral-900"
                      >
                        Rename
                      </button>
                      <button
                        type="button"
                        onClick={() => handleDeleteChain(chain)}
                        className="rounded-md border border-neutral-700 px-2 py-1 text-xs text-neutral-400 hover:bg-neutral-900 hover:text-red-400"
                      >
                        Delete Chain
                      </button>
                    </div>
                  </>
                )}
              </div>

              <table className="w-full text-sm">
                <tbody>
                  {chainItems.length === 0 && (
                    <tr>
                      <td className="px-3 py-4 text-center text-neutral-500">
                        No items yet for {chain.name}.
                      </td>
                    </tr>
                  )}
                  {chainItems.map((item) => (
                    <tr key={item.id} className="border-b border-neutral-800 last:border-b-0">
                      {editingItemId === item.id ? (
                        <>
                          <td className="px-3 py-2">
                            <input
                              value={editItemText}
                              onChange={(e) => setEditItemText(e.target.value)}
                              className="w-full rounded-md border border-neutral-700 bg-neutral-950 px-2 py-1 text-neutral-100"
                              autoFocus
                            />
                          </td>
                          <td className="w-40 px-3 py-2 text-right">
                            <button
                              type="button"
                              onClick={() => saveEditItem(item, chain)}
                              disabled={saving}
                              className="mr-2 rounded-md bg-white px-2 py-1 text-xs font-medium text-black hover:bg-neutral-200 disabled:opacity-50"
                            >
                              Save
                            </button>
                            <button
                              type="button"
                              onClick={cancelEditItem}
                              className="rounded-md border border-neutral-700 px-2 py-1 text-xs text-neutral-300 hover:bg-neutral-900"
                            >
                              Cancel
                            </button>
                          </td>
                        </>
                      ) : (
                        <>
                          <td className="px-3 py-2 text-neutral-200">{item.item_text}</td>
                          <td className="w-40 px-3 py-2 text-right">
                            <button
                              type="button"
                              onClick={() => startEditItem(item)}
                              className="mr-2 rounded-md border border-neutral-700 px-2 py-1 text-xs text-neutral-300 hover:bg-neutral-900"
                            >
                              Edit
                            </button>
                            <button
                              type="button"
                              onClick={() => handleDeleteItem(item, chain)}
                              className="rounded-md border border-neutral-700 px-2 py-1 text-xs text-neutral-400 hover:bg-neutral-900 hover:text-red-400"
                            >
                              Delete
                            </button>
                          </td>
                        </>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>

              <div className="flex items-center gap-2 border-t border-neutral-800 bg-neutral-900/50 p-2">
                <input
                  value={newItemText[chain.id] ?? ""}
                  onChange={(e) => setNewItemText((prev) => ({ ...prev, [chain.id]: e.target.value }))}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") handleAddItem(chain);
                  }}
                  placeholder="Add an item…"
                  className="flex-1 rounded-md border border-neutral-700 bg-neutral-950 px-2 py-1.5 text-sm text-neutral-100"
                />
                <button
                  type="button"
                  onClick={() => handleAddItem(chain)}
                  disabled={saving || !(newItemText[chain.id] ?? "").trim()}
                  className="rounded-md bg-white px-3 py-1.5 text-sm font-medium text-black hover:bg-neutral-200 disabled:opacity-50"
                >
                  + Add Item
                </button>
              </div>
            </div>
          );
        })}
      </div>

      <div className="flex items-end gap-2 rounded-lg border border-neutral-800 bg-neutral-900 p-3">
        <div className="flex flex-1 flex-col gap-1">
          <label className="text-xs uppercase tracking-wide text-neutral-500">New Chain Name</label>
          <input
            value={newChainName}
            onChange={(e) => setNewChainName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") handleAddChain();
            }}
            placeholder="e.g. Costco"
            className="rounded-md border border-neutral-700 bg-neutral-950 px-2 py-1.5 text-sm text-neutral-100"
          />
        </div>
        <button
          type="button"
          onClick={handleAddChain}
          disabled={saving || !newChainName.trim()}
          className="rounded-md bg-white px-3 py-1.5 text-sm font-medium text-black hover:bg-neutral-200 disabled:opacity-50"
        >
          + Add Chain
        </button>
      </div>
    </div>
  );
}
