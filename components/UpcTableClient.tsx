"use client";

// UPC's > <brand> > <size> — a simple, editable Product/UPC table. Set up
// exactly like Labels, per Chad, 2026-09-05: "i want it set up exactly
// like the labels is" — same brand+size nesting, same page-per-combo
// structure, just a plain database table instead of a file library.
// Modeled on PosLabelFilesClient.tsx's load/realtime/audit-log conventions.

import { useCallback, useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { logChange } from "@/lib/audit";
import type { PosLabelBrand, PosLabelSize, UpcEntry } from "@/lib/types/db";
import { POS_LABEL_BRAND_LABELS } from "@/lib/posLabels";

// POS_LABEL_SIZE_LABELS (in lib/posLabels.ts) reads "19.2 oz Labels" —
// fine for the Labels file library, wrong wording here. Same three sizes,
// UPC's-appropriate wording instead.
const UPC_SIZE_LABELS: Record<PosLabelSize, string> = {
  "19.2oz": "19.2 oz",
  "16oz": "16 oz",
  "12oz": "12 oz",
};

export default function UpcTableClient({
  brand,
  size,
}: {
  brand: PosLabelBrand;
  size: PosLabelSize;
}) {
  const supabase = useMemo(() => createClient(), []);

  const [rows, setRows] = useState<UpcEntry[]>([]);
  const [userId, setUserId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  // New-row form fields.
  const [newProduct, setNewProduct] = useState("");
  const [newUpc, setNewUpc] = useState("");

  // In-place edit state — at most one row editable at a time.
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editProduct, setEditProduct] = useState("");
  const [editUpc, setEditUpc] = useState("");

  const load = useCallback(async () => {
    const {
      data: { user },
    } = await supabase.auth.getUser();
    setUserId(user?.id ?? null);

    const { data } = await supabase
      .from("upc_codes")
      .select("*")
      .eq("brand", brand)
      .eq("size", size)
      .order("product_name", { ascending: true });

    setRows((data as UpcEntry[]) ?? []);
    setLoading(false);
  }, [supabase, brand, size]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- intentional fetch-on-mount
    load();
    const channel = supabase
      .channel(`upc-codes-${brand}-${size}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "upc_codes" },
        () => load(),
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [supabase, load, brand, size]);

  async function handleAdd() {
    if (!userId) return;
    const product = newProduct.trim();
    const upc = newUpc.trim();
    if (!product || !upc) return;
    setSaving(true);
    const { data, error } = await supabase
      .from("upc_codes")
      .insert({ brand, size, product_name: product, upc, created_by: userId })
      .select("id")
      .single();
    if (!error && data) {
      await logChange(supabase, {
        weekId: null,
        tableName: "upc_codes",
        recordId: data.id,
        fieldName: `${brand}/${size}/${product}`,
        oldValue: null,
        newValue: upc,
        changedBy: userId,
      });
      setNewProduct("");
      setNewUpc("");
    }
    setSaving(false);
    await load();
  }

  function startEdit(row: UpcEntry) {
    setEditingId(row.id);
    setEditProduct(row.product_name);
    setEditUpc(row.upc);
  }

  function cancelEdit() {
    setEditingId(null);
    setEditProduct("");
    setEditUpc("");
  }

  async function saveEdit(row: UpcEntry) {
    if (!userId) return;
    const product = editProduct.trim();
    const upc = editUpc.trim();
    if (!product || !upc) return;
    setSaving(true);
    await supabase
      .from("upc_codes")
      .update({ product_name: product, upc })
      .eq("id", row.id);
    if (product !== row.product_name || upc !== row.upc) {
      await logChange(supabase, {
        weekId: null,
        tableName: "upc_codes",
        recordId: row.id,
        fieldName: `${brand}/${size}/${row.product_name}`,
        oldValue: row.upc,
        newValue: upc,
        changedBy: userId,
      });
    }
    setSaving(false);
    cancelEdit();
    await load();
  }

  async function handleDelete(row: UpcEntry) {
    if (!userId) return;
    if (!window.confirm(`Delete "${row.product_name}"? This can't be undone.`))
      return;
    await supabase.from("upc_codes").delete().eq("id", row.id);
    await logChange(supabase, {
      weekId: null,
      tableName: "upc_codes",
      recordId: row.id,
      fieldName: `${brand}/${size}/${row.product_name}`,
      oldValue: row.upc,
      newValue: null,
      changedBy: userId,
    });
    if (editingId === row.id) cancelEdit();
    await load();
  }

  if (loading) return <p className="text-sm text-neutral-400">Loading…</p>;

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h1 className="text-lg font-semibold text-neutral-100">
          {POS_LABEL_BRAND_LABELS[brand]} — {UPC_SIZE_LABELS[size]} UPC&apos;s
        </h1>
        <p className="text-sm text-neutral-500">
          {rows.length} product{rows.length === 1 ? "" : "s"}
        </p>
      </div>

      <div className="overflow-hidden rounded-lg border border-neutral-800">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-neutral-800 bg-neutral-900 text-left text-xs uppercase tracking-wide text-neutral-500">
              <th className="px-3 py-2">Product</th>
              <th className="px-3 py-2">UPC</th>
              <th className="px-3 py-2 text-right">Actions</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && (
              <tr>
                <td colSpan={3} className="px-3 py-8 text-center text-neutral-500">
                  No UPC&apos;s yet for {POS_LABEL_BRAND_LABELS[brand]} —{" "}
                  {UPC_SIZE_LABELS[size]}. Add one below to get started.
                </td>
              </tr>
            )}
            {rows.map((row) => (
              <tr key={row.id} className="border-b border-neutral-800 last:border-b-0">
                {editingId === row.id ? (
                  <>
                    <td className="px-3 py-2">
                      <input
                        value={editProduct}
                        onChange={(e) => setEditProduct(e.target.value)}
                        className="w-full rounded-md border border-neutral-700 bg-neutral-950 px-2 py-1 text-neutral-100"
                      />
                    </td>
                    <td className="px-3 py-2">
                      <input
                        value={editUpc}
                        onChange={(e) => setEditUpc(e.target.value)}
                        className="w-full rounded-md border border-neutral-700 bg-neutral-950 px-2 py-1 text-neutral-100"
                      />
                    </td>
                    <td className="px-3 py-2 text-right">
                      <button
                        type="button"
                        onClick={() => saveEdit(row)}
                        disabled={saving}
                        className="mr-2 rounded-md bg-white px-2 py-1 text-xs font-medium text-black hover:bg-neutral-200 disabled:opacity-50"
                      >
                        Save
                      </button>
                      <button
                        type="button"
                        onClick={cancelEdit}
                        className="rounded-md border border-neutral-700 px-2 py-1 text-xs text-neutral-300 hover:bg-neutral-900"
                      >
                        Cancel
                      </button>
                    </td>
                  </>
                ) : (
                  <>
                    <td className="px-3 py-2 text-neutral-200">{row.product_name}</td>
                    <td className="px-3 py-2 font-mono text-neutral-300">{row.upc}</td>
                    <td className="px-3 py-2 text-right">
                      <button
                        type="button"
                        onClick={() => startEdit(row)}
                        className="mr-2 rounded-md border border-neutral-700 px-2 py-1 text-xs text-neutral-300 hover:bg-neutral-900"
                      >
                        Edit
                      </button>
                      <button
                        type="button"
                        onClick={() => handleDelete(row)}
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
      </div>

      <div className="flex items-end gap-2 rounded-lg border border-neutral-800 bg-neutral-900 p-3">
        <div className="flex flex-1 flex-col gap-1">
          <label className="text-xs uppercase tracking-wide text-neutral-500">
            Product Name
          </label>
          <input
            value={newProduct}
            onChange={(e) => setNewProduct(e.target.value)}
            placeholder="e.g. Juicy 16oz/4pk"
            className="rounded-md border border-neutral-700 bg-neutral-950 px-2 py-1.5 text-sm text-neutral-100"
          />
        </div>
        <div className="flex flex-1 flex-col gap-1">
          <label className="text-xs uppercase tracking-wide text-neutral-500">
            UPC
          </label>
          <input
            value={newUpc}
            onChange={(e) => setNewUpc(e.target.value)}
            placeholder="e.g. 850382001108"
            className="rounded-md border border-neutral-700 bg-neutral-950 px-2 py-1.5 text-sm font-mono text-neutral-100"
          />
        </div>
        <button
          type="button"
          onClick={handleAdd}
          disabled={saving || !newProduct.trim() || !newUpc.trim()}
          className="rounded-md bg-white px-3 py-1.5 text-sm font-medium text-black hover:bg-neutral-200 disabled:opacity-50"
        >
          + Add
        </button>
      </div>
    </div>
  );
}
