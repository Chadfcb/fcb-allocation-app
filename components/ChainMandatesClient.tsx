"use client";

// Sales > Chain Mandates — which specific stores are mandated to carry
// which products, per chain. Three-level structure: Chain -> Product ->
// Store (store #, address, tier/segment, status). Added 2026-09-05, per
// Chad, imported from a per-store mandate spreadsheet (SAFEWAY/VONS/
// WALMART) — kept at the store level rather than flattened to a plain
// item list, since that's the level of detail the source data actually
// had. Chain, product, and store are all freely addable/removable right
// on this page. Modeled on UpcTableClient.tsx/ChainAuthorizationsClient.tsx's
// load/realtime/audit-log conventions, with an extra accordion level for
// each product's store list.

import { useCallback, useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { logChange } from "@/lib/audit";
import type { ChainMandateChain, ChainMandateProduct, ChainMandateStore } from "@/lib/types/db";

const emptyStoreDraft = { store_number: "", city: "", tier: "", status: "", address: "", state: "", zip: "" };

export default function ChainMandatesClient() {
  const supabase = useMemo(() => createClient(), []);

  const [chains, setChains] = useState<ChainMandateChain[]>([]);
  const [products, setProducts] = useState<ChainMandateProduct[]>([]);
  const [stores, setStores] = useState<ChainMandateStore[]>([]);
  const [userId, setUserId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const [newChainName, setNewChainName] = useState("");
  const [editingChainId, setEditingChainId] = useState<string | null>(null);
  const [editChainName, setEditChainName] = useState("");

  // New-product drafts, keyed by chain id.
  const [newProductDraft, setNewProductDraft] = useState<Record<string, { product_name: string; package: string; upc: string }>>({});
  const [editingProductId, setEditingProductId] = useState<string | null>(null);
  const [editProduct, setEditProduct] = useState({ product_name: "", package: "", upc: "" });

  // Which product rows have their store list expanded.
  const [expandedProducts, setExpandedProducts] = useState<Record<string, boolean>>({});
  // New-store drafts, keyed by product id.
  const [newStoreDraft, setNewStoreDraft] = useState<Record<string, typeof emptyStoreDraft>>({});
  const [editingStoreId, setEditingStoreId] = useState<string | null>(null);
  const [editStore, setEditStore] = useState(emptyStoreDraft);

  const load = useCallback(async () => {
    const {
      data: { user },
    } = await supabase.auth.getUser();
    setUserId(user?.id ?? null);

    const [chainsRes, productsRes, storesRes] = await Promise.all([
      supabase.from("chain_mandate_chains").select("*").order("sort_order", { ascending: true }).order("name", { ascending: true }),
      supabase.from("chain_mandate_products").select("*").order("sort_order", { ascending: true }).order("product_name", { ascending: true }),
      supabase.from("chain_mandate_stores").select("*").order("sort_order", { ascending: true }).order("store_number", { ascending: true }),
    ]);

    setChains((chainsRes.data as ChainMandateChain[]) ?? []);
    setProducts((productsRes.data as ChainMandateProduct[]) ?? []);
    setStores((storesRes.data as ChainMandateStore[]) ?? []);
    setLoading(false);
  }, [supabase]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- intentional fetch-on-mount
    load();
    const channel = supabase
      .channel("chain-mandates")
      .on("postgres_changes", { event: "*", schema: "public", table: "chain_mandate_chains" }, () => load())
      .on("postgres_changes", { event: "*", schema: "public", table: "chain_mandate_products" }, () => load())
      .on("postgres_changes", { event: "*", schema: "public", table: "chain_mandate_stores" }, () => load())
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [supabase, load]);

  const productsByChain = useMemo(() => {
    const map: Record<string, ChainMandateProduct[]> = {};
    for (const p of products) (map[p.chain_id] ??= []).push(p);
    return map;
  }, [products]);

  const storesByProduct = useMemo(() => {
    const map: Record<string, ChainMandateStore[]> = {};
    for (const s of stores) (map[s.product_id] ??= []).push(s);
    return map;
  }, [stores]);

  function toggleExpanded(productId: string) {
    setExpandedProducts((prev) => ({ ...prev, [productId]: !prev[productId] }));
  }

  // ---- Chains ----

  async function handleAddChain() {
    if (!userId) return;
    const name = newChainName.trim();
    if (!name) return;
    setSaving(true);
    const { data, error } = await supabase
      .from("chain_mandate_chains")
      .insert({ name, created_by: userId })
      .select("id")
      .single();
    if (!error && data) {
      await logChange(supabase, {
        weekId: null,
        tableName: "chain_mandate_chains",
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

  async function handleDeleteChain(chain: ChainMandateChain) {
    if (!userId) return;
    const productCount = productsByChain[chain.id]?.length ?? 0;
    const warning = productCount > 0 ? ` Its ${productCount} product${productCount === 1 ? "" : "s"} (and their stores) will be deleted too.` : "";
    if (!window.confirm(`Delete "${chain.name}"?${warning} This can't be undone.`)) return;
    await supabase.from("chain_mandate_chains").delete().eq("id", chain.id);
    await logChange(supabase, {
      weekId: null,
      tableName: "chain_mandate_chains",
      recordId: chain.id,
      fieldName: "chain",
      oldValue: chain.name,
      newValue: null,
      changedBy: userId,
    });
    await load();
  }

  function startEditChain(chain: ChainMandateChain) {
    setEditingChainId(chain.id);
    setEditChainName(chain.name);
  }
  function cancelEditChain() {
    setEditingChainId(null);
    setEditChainName("");
  }
  async function saveEditChain(chain: ChainMandateChain) {
    if (!userId) return;
    const name = editChainName.trim();
    if (!name) return;
    setSaving(true);
    await supabase.from("chain_mandate_chains").update({ name }).eq("id", chain.id);
    if (name !== chain.name) {
      await logChange(supabase, {
        weekId: null,
        tableName: "chain_mandate_chains",
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

  // ---- Products ----

  function productDraft(chainId: string) {
    return newProductDraft[chainId] ?? { product_name: "", package: "", upc: "" };
  }

  async function handleAddProduct(chain: ChainMandateChain) {
    if (!userId) return;
    const draft = productDraft(chain.id);
    const product_name = draft.product_name.trim();
    if (!product_name) return;
    setSaving(true);
    const { data, error } = await supabase
      .from("chain_mandate_products")
      .insert({
        chain_id: chain.id,
        product_name,
        package: draft.package.trim() || null,
        upc: draft.upc.trim() || null,
        created_by: userId,
      })
      .select("id")
      .single();
    if (!error && data) {
      await logChange(supabase, {
        weekId: null,
        tableName: "chain_mandate_products",
        recordId: data.id,
        fieldName: chain.name,
        oldValue: null,
        newValue: product_name,
        changedBy: userId,
      });
      setNewProductDraft((prev) => ({ ...prev, [chain.id]: { product_name: "", package: "", upc: "" } }));
    }
    setSaving(false);
    await load();
  }

  async function handleDeleteProduct(product: ChainMandateProduct, chain: ChainMandateChain) {
    if (!userId) return;
    const storeCount = storesByProduct[product.id]?.length ?? 0;
    const warning = storeCount > 0 ? ` Its ${storeCount} store${storeCount === 1 ? "" : "s"} will be deleted too.` : "";
    if (!window.confirm(`Remove "${product.product_name}" from ${chain.name}?${warning}`)) return;
    await supabase.from("chain_mandate_products").delete().eq("id", product.id);
    await logChange(supabase, {
      weekId: null,
      tableName: "chain_mandate_products",
      recordId: product.id,
      fieldName: chain.name,
      oldValue: product.product_name,
      newValue: null,
      changedBy: userId,
    });
    await load();
  }

  function startEditProduct(product: ChainMandateProduct) {
    setEditingProductId(product.id);
    setEditProduct({ product_name: product.product_name, package: product.package ?? "", upc: product.upc ?? "" });
  }
  function cancelEditProduct() {
    setEditingProductId(null);
    setEditProduct({ product_name: "", package: "", upc: "" });
  }
  async function saveEditProduct(product: ChainMandateProduct, chain: ChainMandateChain) {
    if (!userId) return;
    const product_name = editProduct.product_name.trim();
    if (!product_name) return;
    setSaving(true);
    await supabase
      .from("chain_mandate_products")
      .update({ product_name, package: editProduct.package.trim() || null, upc: editProduct.upc.trim() || null })
      .eq("id", product.id);
    if (product_name !== product.product_name) {
      await logChange(supabase, {
        weekId: null,
        tableName: "chain_mandate_products",
        recordId: product.id,
        fieldName: chain.name,
        oldValue: product.product_name,
        newValue: product_name,
        changedBy: userId,
      });
    }
    setSaving(false);
    cancelEditProduct();
    await load();
  }

  // ---- Stores ----

  function storeDraft(productId: string) {
    return newStoreDraft[productId] ?? emptyStoreDraft;
  }

  async function handleAddStore(product: ChainMandateProduct) {
    if (!userId) return;
    const draft = storeDraft(product.id);
    const store_number = draft.store_number.trim();
    if (!store_number) return;
    setSaving(true);
    const { data, error } = await supabase
      .from("chain_mandate_stores")
      .insert({
        product_id: product.id,
        store_number,
        city: draft.city.trim() || null,
        tier: draft.tier.trim() || null,
        status: draft.status.trim() || null,
        address: draft.address.trim() || null,
        state: draft.state.trim() || null,
        zip: draft.zip.trim() || null,
        created_by: userId,
      })
      .select("id")
      .single();
    if (!error && data) {
      await logChange(supabase, {
        weekId: null,
        tableName: "chain_mandate_stores",
        recordId: data.id,
        fieldName: product.product_name,
        oldValue: null,
        newValue: `Store ${store_number}`,
        changedBy: userId,
      });
      setNewStoreDraft((prev) => ({ ...prev, [product.id]: emptyStoreDraft }));
    }
    setSaving(false);
    await load();
  }

  async function handleDeleteStore(store: ChainMandateStore, product: ChainMandateProduct) {
    if (!userId) return;
    if (!window.confirm(`Remove store ${store.store_number} from ${product.product_name}?`)) return;
    await supabase.from("chain_mandate_stores").delete().eq("id", store.id);
    await logChange(supabase, {
      weekId: null,
      tableName: "chain_mandate_stores",
      recordId: store.id,
      fieldName: product.product_name,
      oldValue: `Store ${store.store_number}`,
      newValue: null,
      changedBy: userId,
    });
    if (editingStoreId === store.id) cancelEditStore();
    await load();
  }

  function startEditStore(store: ChainMandateStore) {
    setEditingStoreId(store.id);
    setEditStore({
      store_number: store.store_number ?? "",
      city: store.city ?? "",
      tier: store.tier ?? "",
      status: store.status ?? "",
      address: store.address ?? "",
      state: store.state ?? "",
      zip: store.zip ?? "",
    });
  }
  function cancelEditStore() {
    setEditingStoreId(null);
    setEditStore(emptyStoreDraft);
  }
  async function saveEditStore(store: ChainMandateStore, product: ChainMandateProduct) {
    if (!userId) return;
    const store_number = editStore.store_number.trim();
    if (!store_number) return;
    setSaving(true);
    await supabase
      .from("chain_mandate_stores")
      .update({
        store_number,
        city: editStore.city.trim() || null,
        tier: editStore.tier.trim() || null,
        status: editStore.status.trim() || null,
        address: editStore.address.trim() || null,
        state: editStore.state.trim() || null,
        zip: editStore.zip.trim() || null,
      })
      .eq("id", store.id);
    if (store_number !== store.store_number) {
      await logChange(supabase, {
        weekId: null,
        tableName: "chain_mandate_stores",
        recordId: store.id,
        fieldName: product.product_name,
        oldValue: `Store ${store.store_number}`,
        newValue: `Store ${store_number}`,
        changedBy: userId,
      });
    }
    setSaving(false);
    cancelEditStore();
    await load();
  }

  if (loading) return <p className="text-sm text-neutral-400">Loading…</p>;

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h1 className="text-lg font-semibold text-neutral-100">Chain Mandates</h1>
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
          const chainProducts = productsByChain[chain.id] ?? [];
          const draft = productDraft(chain.id);
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
                    <button type="button" onClick={() => saveEditChain(chain)} disabled={saving} className="rounded-md bg-white px-2 py-1 text-xs font-medium text-black hover:bg-neutral-200 disabled:opacity-50">
                      Save
                    </button>
                    <button type="button" onClick={cancelEditChain} className="rounded-md border border-neutral-700 px-2 py-1 text-xs text-neutral-300 hover:bg-neutral-900">
                      Cancel
                    </button>
                  </div>
                ) : (
                  <>
                    <span className="font-semibold text-neutral-100">
                      {chain.name}{" "}
                      <span className="font-normal text-neutral-500">
                        ({chainProducts.length} product{chainProducts.length === 1 ? "" : "s"})
                      </span>
                    </span>
                    <div className="flex items-center gap-2">
                      <button type="button" onClick={() => startEditChain(chain)} className="rounded-md border border-neutral-700 px-2 py-1 text-xs text-neutral-300 hover:bg-neutral-900">
                        Rename
                      </button>
                      <button type="button" onClick={() => handleDeleteChain(chain)} className="rounded-md border border-neutral-700 px-2 py-1 text-xs text-neutral-400 hover:bg-neutral-900 hover:text-red-400">
                        Delete Chain
                      </button>
                    </div>
                  </>
                )}
              </div>

              <div className="flex flex-col gap-2 p-2">
                {chainProducts.length === 0 && (
                  <p className="px-2 py-4 text-center text-sm text-neutral-500">No products yet for {chain.name}.</p>
                )}
                {chainProducts.map((product) => {
                  const productStores = storesByProduct[product.id] ?? [];
                  const expanded = !!expandedProducts[product.id];
                  const sDraft = storeDraft(product.id);
                  return (
                    <div key={product.id} className="rounded-md border border-neutral-800">
                      <div className="flex items-center justify-between gap-2 bg-neutral-900/60 px-3 py-2">
                        {editingProductId === product.id ? (
                          <div className="flex flex-1 flex-wrap items-center gap-2">
                            <input
                              value={editProduct.product_name}
                              onChange={(e) => setEditProduct((prev) => ({ ...prev, product_name: e.target.value }))}
                              placeholder="Product name"
                              className="flex-1 rounded-md border border-neutral-700 bg-neutral-950 px-2 py-1 text-sm text-neutral-100"
                              autoFocus
                            />
                            <input
                              value={editProduct.package}
                              onChange={(e) => setEditProduct((prev) => ({ ...prev, package: e.target.value }))}
                              placeholder="Package (e.g. 4PACK)"
                              className="w-32 rounded-md border border-neutral-700 bg-neutral-950 px-2 py-1 text-sm text-neutral-100"
                            />
                            <input
                              value={editProduct.upc}
                              onChange={(e) => setEditProduct((prev) => ({ ...prev, upc: e.target.value }))}
                              placeholder="UPC"
                              className="w-36 rounded-md border border-neutral-700 bg-neutral-950 px-2 py-1 text-sm font-mono text-neutral-100"
                            />
                            <button type="button" onClick={() => saveEditProduct(product, chain)} disabled={saving} className="rounded-md bg-white px-2 py-1 text-xs font-medium text-black hover:bg-neutral-200 disabled:opacity-50">
                              Save
                            </button>
                            <button type="button" onClick={cancelEditProduct} className="rounded-md border border-neutral-700 px-2 py-1 text-xs text-neutral-300 hover:bg-neutral-900">
                              Cancel
                            </button>
                          </div>
                        ) : (
                          <>
                            <button type="button" onClick={() => toggleExpanded(product.id)} className="flex flex-1 items-center gap-2 text-left">
                              <span className="text-neutral-500">{expanded ? "▾" : "▸"}</span>
                              <span className="text-neutral-100">{product.product_name}</span>
                              {product.package && <span className="text-xs text-neutral-500">{product.package}</span>}
                              {product.upc && <span className="font-mono text-xs text-neutral-600">{product.upc}</span>}
                              <span className="text-xs text-neutral-500">
                                ({productStores.length} store{productStores.length === 1 ? "" : "s"})
                              </span>
                            </button>
                            <div className="flex items-center gap-2">
                              <button type="button" onClick={() => startEditProduct(product)} className="rounded-md border border-neutral-700 px-2 py-1 text-xs text-neutral-300 hover:bg-neutral-900">
                                Edit
                              </button>
                              <button type="button" onClick={() => handleDeleteProduct(product, chain)} className="rounded-md border border-neutral-700 px-2 py-1 text-xs text-neutral-400 hover:bg-neutral-900 hover:text-red-400">
                                Delete
                              </button>
                            </div>
                          </>
                        )}
                      </div>

                      {expanded && (
                        <div className="border-t border-neutral-800">
                          <div className="overflow-x-auto">
                            <table className="w-full min-w-[720px] text-sm">
                              <thead>
                                <tr className="border-b border-neutral-800 bg-neutral-900 text-left text-xs uppercase tracking-wide text-neutral-500">
                                  <th className="px-3 py-2">Store #</th>
                                  <th className="px-3 py-2">City</th>
                                  <th className="px-3 py-2">Tier</th>
                                  <th className="px-3 py-2">Status</th>
                                  <th className="px-3 py-2 text-right">Actions</th>
                                </tr>
                              </thead>
                              <tbody>
                                {productStores.length === 0 && (
                                  <tr>
                                    <td colSpan={5} className="px-3 py-4 text-center text-neutral-500">
                                      No stores yet.
                                    </td>
                                  </tr>
                                )}
                                {productStores.map((store) => (
                                  <tr key={store.id} className="border-b border-neutral-800 last:border-b-0">
                                    {editingStoreId === store.id ? (
                                      <>
                                        <td className="px-3 py-2">
                                          <input value={editStore.store_number} onChange={(e) => setEditStore((prev) => ({ ...prev, store_number: e.target.value }))} className="w-20 rounded-md border border-neutral-700 bg-neutral-950 px-2 py-1 text-neutral-100" autoFocus />
                                        </td>
                                        <td className="px-3 py-2">
                                          <input value={editStore.city} onChange={(e) => setEditStore((prev) => ({ ...prev, city: e.target.value }))} className="w-full rounded-md border border-neutral-700 bg-neutral-950 px-2 py-1 text-neutral-100" />
                                        </td>
                                        <td className="px-3 py-2">
                                          <input value={editStore.tier} onChange={(e) => setEditStore((prev) => ({ ...prev, tier: e.target.value }))} className="w-full rounded-md border border-neutral-700 bg-neutral-950 px-2 py-1 text-neutral-100" />
                                        </td>
                                        <td className="px-3 py-2">
                                          <input value={editStore.status} onChange={(e) => setEditStore((prev) => ({ ...prev, status: e.target.value }))} className="w-full rounded-md border border-neutral-700 bg-neutral-950 px-2 py-1 text-neutral-100" />
                                        </td>
                                        <td className="px-3 py-2 text-right">
                                          <button type="button" onClick={() => saveEditStore(store, product)} disabled={saving} className="mr-2 rounded-md bg-white px-2 py-1 text-xs font-medium text-black hover:bg-neutral-200 disabled:opacity-50">
                                            Save
                                          </button>
                                          <button type="button" onClick={cancelEditStore} className="rounded-md border border-neutral-700 px-2 py-1 text-xs text-neutral-300 hover:bg-neutral-900">
                                            Cancel
                                          </button>
                                        </td>
                                      </>
                                    ) : (
                                      <>
                                        <td className="px-3 py-2 font-mono text-neutral-200">{store.store_number}</td>
                                        <td className="px-3 py-2 text-neutral-300">{store.city ?? "—"}</td>
                                        <td className="px-3 py-2 text-neutral-300">{store.tier ?? "—"}</td>
                                        <td className="px-3 py-2 text-neutral-300">{store.status ?? "—"}</td>
                                        <td className="px-3 py-2 text-right">
                                          <button type="button" onClick={() => startEditStore(store)} className="mr-2 rounded-md border border-neutral-700 px-2 py-1 text-xs text-neutral-300 hover:bg-neutral-900">
                                            Edit
                                          </button>
                                          <button type="button" onClick={() => handleDeleteStore(store, product)} className="rounded-md border border-neutral-700 px-2 py-1 text-xs text-neutral-400 hover:bg-neutral-900 hover:text-red-400">
                                            Delete
                                          </button>
                                        </td>
                                      </>
                                    )}
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </div>
                          <div className="flex flex-wrap items-center gap-2 border-t border-neutral-800 bg-neutral-900/50 p-2">
                            <input
                              value={sDraft.store_number}
                              onChange={(e) => setNewStoreDraft((prev) => ({ ...prev, [product.id]: { ...storeDraft(product.id), store_number: e.target.value } }))}
                              placeholder="Store #"
                              className="w-24 rounded-md border border-neutral-700 bg-neutral-950 px-2 py-1.5 text-sm text-neutral-100"
                            />
                            <input
                              value={sDraft.city}
                              onChange={(e) => setNewStoreDraft((prev) => ({ ...prev, [product.id]: { ...storeDraft(product.id), city: e.target.value } }))}
                              placeholder="City"
                              className="flex-1 rounded-md border border-neutral-700 bg-neutral-950 px-2 py-1.5 text-sm text-neutral-100"
                            />
                            <input
                              value={sDraft.tier}
                              onChange={(e) => setNewStoreDraft((prev) => ({ ...prev, [product.id]: { ...storeDraft(product.id), tier: e.target.value } }))}
                              placeholder="Tier"
                              className="w-32 rounded-md border border-neutral-700 bg-neutral-950 px-2 py-1.5 text-sm text-neutral-100"
                            />
                            <input
                              value={sDraft.status}
                              onChange={(e) => setNewStoreDraft((prev) => ({ ...prev, [product.id]: { ...storeDraft(product.id), status: e.target.value } }))}
                              placeholder="Status"
                              className="w-32 rounded-md border border-neutral-700 bg-neutral-950 px-2 py-1.5 text-sm text-neutral-100"
                            />
                            <button
                              type="button"
                              onClick={() => handleAddStore(product)}
                              disabled={saving || !sDraft.store_number.trim()}
                              className="rounded-md bg-white px-3 py-1.5 text-sm font-medium text-black hover:bg-neutral-200 disabled:opacity-50"
                            >
                              + Add Store
                            </button>
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })}

                <div className="flex flex-wrap items-center gap-2 rounded-md border border-neutral-800 bg-neutral-900/50 p-2">
                  <input
                    value={draft.product_name}
                    onChange={(e) => setNewProductDraft((prev) => ({ ...prev, [chain.id]: { ...productDraft(chain.id), product_name: e.target.value } }))}
                    placeholder="New product name"
                    className="flex-1 rounded-md border border-neutral-700 bg-neutral-950 px-2 py-1.5 text-sm text-neutral-100"
                  />
                  <input
                    value={draft.package}
                    onChange={(e) => setNewProductDraft((prev) => ({ ...prev, [chain.id]: { ...productDraft(chain.id), package: e.target.value } }))}
                    placeholder="Package (e.g. 4PACK)"
                    className="w-36 rounded-md border border-neutral-700 bg-neutral-950 px-2 py-1.5 text-sm text-neutral-100"
                  />
                  <input
                    value={draft.upc}
                    onChange={(e) => setNewProductDraft((prev) => ({ ...prev, [chain.id]: { ...productDraft(chain.id), upc: e.target.value } }))}
                    placeholder="UPC"
                    className="w-40 rounded-md border border-neutral-700 bg-neutral-950 px-2 py-1.5 text-sm font-mono text-neutral-100"
                  />
                  <button
                    type="button"
                    onClick={() => handleAddProduct(chain)}
                    disabled={saving || !draft.product_name.trim()}
                    className="rounded-md bg-white px-3 py-1.5 text-sm font-medium text-black hover:bg-neutral-200 disabled:opacity-50"
                  >
                    + Add Product
                  </button>
                </div>
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
