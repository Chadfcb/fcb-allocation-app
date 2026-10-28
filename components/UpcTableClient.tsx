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
import {
  barcodeFileName,
  barcodeSvg,
  checkUpc,
  downloadBarcodePng,
  downloadBarcodeSvg,
} from "@/lib/barcode";
import { useNewFeature, upcBarcodeFeatureId } from "@/lib/newFeatures";
import NewBadge from "@/components/NewBadge";

// POS_LABEL_SIZE_LABELS (in lib/posLabels.ts) reads "19.2 oz Labels" —
// fine for the Labels file library, wrong wording here. Same three sizes,
// UPC's-appropriate wording instead.
const UPC_SIZE_LABELS: Record<PosLabelSize, string> = {
  "19.2oz": "19.2 oz",
  "16oz": "16 oz",
  "12oz": "12 oz",
};

// Barcode column (added 2026-10-28, per Chad: "i need a preview and download
// link of the actual barcodes of the UPC's"). Drawn in the browser from the
// UPC itself (lib/barcode.ts) — nothing stored, so an edited UPC redraws.

// Small barcode in a table cell. Click → full-size preview. A UPC that
// can't be drawn shows why instead.
function BarcodeThumb({ upc, onOpen }: { upc: string; onOpen?: () => void }) {
  const check = checkUpc(upc);
  if (!check.ok) {
    return <span className="text-xs text-red-400">{check.reason}</span>;
  }
  const svg = barcodeSvg(check.kind, check.digits);
  const img = (
    <span
      className="block h-10 w-[58px] overflow-hidden rounded-sm bg-white [&>svg]:h-full [&>svg]:w-full"
      dangerouslySetInnerHTML={{ __html: svg }}
    />
  );
  if (!onOpen) return img;
  return (
    <button
      type="button"
      onClick={onOpen}
      title="Click to see full size and download"
      className="rounded-sm ring-offset-2 ring-offset-neutral-950 hover:ring-2 hover:ring-[#6ABC46]/60"
    >
      {img}
    </button>
  );
}

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

  // Full-size barcode preview (one row at a time).
  const [previewRow, setPreviewRow] = useState<UpcEntry | null>(null);
  const [downloadError, setDownloadError] = useState<string | null>(null);
  const barcodeNew = useNewFeature(
    upcBarcodeFeatureId(`/upcs/${brand}/${size.replace(".", "-")}`),
  );

  useEffect(() => {
    if (!previewRow) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setPreviewRow(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [previewRow]);

  function openPreview(row: UpcEntry) {
    barcodeNew.dismiss();
    setDownloadError(null);
    setPreviewRow(row);
  }

  async function downloadBarcode(row: UpcEntry, format: "png" | "svg") {
    barcodeNew.dismiss();
    setDownloadError(null);
    const check = checkUpc(row.upc);
    if (!check.ok) return;
    const svg = barcodeSvg(check.kind, check.digits);
    const name = barcodeFileName(row.product_name, check.digits);
    try {
      if (format === "svg") downloadBarcodeSvg(svg, name);
      else await downloadBarcodePng(svg, name);
    } catch {
      setDownloadError("Couldn't make the download — try the SVG instead.");
    }
  }

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
              <th className="px-3 py-2">
                Barcode
                {barcodeNew.isNew && <NewBadge inline />}
              </th>
              <th className="px-3 py-2 text-right">Actions</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && (
              <tr>
                <td colSpan={4} className="px-3 py-8 text-center text-neutral-500">
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
                    <td className="px-3 py-2">
                      <BarcodeThumb upc={editUpc} />
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
                    <td className="px-3 py-2">
                      <div className="flex items-center gap-3">
                        <BarcodeThumb upc={row.upc} onOpen={() => openPreview(row)} />
                        {checkUpc(row.upc).ok && (
                          <button
                            type="button"
                            onClick={() => downloadBarcode(row, "png")}
                            className="text-xs text-[#8FD16E] hover:underline"
                          >
                            Download
                          </button>
                        )}
                      </div>
                    </td>
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

      {previewRow && (() => {
        const check = checkUpc(previewRow.upc);
        return (
          <div
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4"
            onClick={() => setPreviewRow(null)}
          >
            <div
              className="w-full max-w-lg rounded-lg border border-neutral-800 bg-neutral-900 p-5"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="mb-3 flex items-start justify-between gap-3">
                <div>
                  <h2 className="text-base font-semibold text-neutral-100">
                    {previewRow.product_name}
                  </h2>
                  <p className="text-xs text-neutral-500">
                    {POS_LABEL_BRAND_LABELS[brand]} — {UPC_SIZE_LABELS[size]}
                    {check.ok ? ` · ${check.kind} ${check.digits}` : ""}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => setPreviewRow(null)}
                  className="rounded-md border border-neutral-700 px-2 py-1 text-xs text-neutral-300 hover:bg-neutral-800"
                >
                  Close
                </button>
              </div>
              {check.ok ? (
                <>
                  <div
                    className="rounded-md bg-white p-3 [&>svg]:h-auto [&>svg]:w-full"
                    dangerouslySetInnerHTML={{ __html: barcodeSvg(check.kind, check.digits) }}
                  />
                  <div className="mt-4 flex flex-wrap items-center gap-2">
                    <button
                      type="button"
                      onClick={() => downloadBarcode(previewRow, "png")}
                      className="rounded-md bg-white px-3 py-1.5 text-sm font-medium text-black hover:bg-neutral-200"
                    >
                      Download PNG
                    </button>
                    <button
                      type="button"
                      onClick={() => downloadBarcode(previewRow, "svg")}
                      className="rounded-md border border-neutral-700 px-3 py-1.5 text-sm text-neutral-200 hover:bg-neutral-800"
                    >
                      Download SVG
                    </button>
                    <span className="text-xs text-neutral-500">
                      PNG for labels and documents · SVG for printers and designers (any size)
                    </span>
                  </div>
                  {downloadError && (
                    <p className="mt-2 text-xs text-red-400">{downloadError}</p>
                  )}
                </>
              ) : (
                <p className="text-sm text-red-400">{check.reason}</p>
              )}
            </div>
          </div>
        );
      })()}
    </div>
  );
}
