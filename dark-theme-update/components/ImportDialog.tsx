"use client";

import { useState } from "react";
import type { InventorySource } from "@/lib/types/db";

interface Props {
  weekId: string;
  distributorId: string;
  onImported: () => void;
  onClose: () => void;
}

export default function ImportDialog({ weekId, distributorId, onImported, onClose }: Props) {
  const [file, setFile] = useState<File | null>(null);
  const [headers, setHeaders] = useState<string[]>([]);
  const [previewRows, setPreviewRows] = useState<string[][]>([]);
  const [productCol, setProductCol] = useState(0);
  const [onHandCol, setOnHandCol] = useState(1);
  const [rateOfSaleCol, setRateOfSaleCol] = useState(2);
  const [source, setSource] = useState<InventorySource>("vip");
  const [step, setStep] = useState<"upload" | "map" | "result">("upload");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<{ matchedCount: number; unmatched: string[] } | null>(null);

  async function handleFileSelected(f: File) {
    setFile(f);
    setBusy(true);
    setError(null);

    const formData = new FormData();
    formData.append("file", f);

    const res = await fetch("/api/import/preview", { method: "POST", body: formData });
    const json = await res.json();

    if (!res.ok) {
      setError(json.error ?? "Failed to read file");
      setBusy(false);
      return;
    }

    setHeaders(json.headers);
    setPreviewRows(json.previewRows);
    setStep("map");
    setBusy(false);
  }

  async function handleCommit() {
    if (!file) return;
    setBusy(true);
    setError(null);

    const formData = new FormData();
    formData.append("file", file);
    formData.append("weekId", weekId);
    formData.append("distributorId", distributorId);
    formData.append("source", source);
    formData.append("productCol", String(productCol));
    formData.append("onHandCol", String(onHandCol));
    formData.append("rateOfSaleCol", String(rateOfSaleCol));

    const res = await fetch("/api/import/commit", { method: "POST", body: formData });
    const json = await res.json();

    if (!res.ok) {
      setError(json.error ?? "Import failed");
      setBusy(false);
      return;
    }

    setResult(json);
    setStep("result");
    setBusy(false);
    onImported();
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 px-4">
      <div className="w-full max-w-2xl rounded-lg border border-neutral-800 bg-neutral-950 p-6 shadow-lg">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-base font-semibold text-neutral-100">Import distributor data</h2>
          <button onClick={onClose} className="text-neutral-500 hover:text-neutral-200">
            ✕
          </button>
        </div>

        {step === "upload" && (
          <div className="space-y-3">
            <label className="block text-sm text-neutral-400">
              Source of this data
              <select
                value={source}
                onChange={(e) => setSource(e.target.value as InventorySource)}
                className="mt-1 block w-full rounded-md border border-neutral-700 bg-neutral-900 px-3 py-2 text-sm text-neutral-100"
              >
                <option value="vip">VIP</option>
                <option value="ekos">Ekos</option>
                <option value="distributor">Distributor (sent directly)</option>
              </select>
            </label>
            <label className="block text-sm text-neutral-400">
              File (.xlsx or .csv export)
              <input
                type="file"
                accept=".xlsx,.xls,.csv"
                onChange={(e) => e.target.files?.[0] && handleFileSelected(e.target.files[0])}
                className="mt-1 block w-full text-sm text-neutral-300"
              />
            </label>
            {busy && <p className="text-xs text-neutral-500">Reading file…</p>}
            {error && <p className="text-sm text-red-400">{error}</p>}
          </div>
        )}

        {step === "map" && (
          <div className="space-y-4">
            <p className="text-sm text-neutral-400">
              Tell us which column in your file is which — this only needs to be set once per
              export format.
            </p>
            <div className="grid grid-cols-3 gap-3">
              <label className="text-sm text-neutral-400">
                Product name column
                <select
                  value={productCol}
                  onChange={(e) => setProductCol(Number(e.target.value))}
                  className="mt-1 block w-full rounded-md border border-neutral-700 bg-neutral-900 px-2 py-1.5 text-sm text-neutral-100"
                >
                  {headers.map((h, i) => (
                    <option key={i} value={i}>
                      {h || `Column ${i + 1}`}
                    </option>
                  ))}
                </select>
              </label>
              <label className="text-sm text-neutral-400">
                On hand quantity column
                <select
                  value={onHandCol}
                  onChange={(e) => setOnHandCol(Number(e.target.value))}
                  className="mt-1 block w-full rounded-md border border-neutral-700 bg-neutral-900 px-2 py-1.5 text-sm text-neutral-100"
                >
                  {headers.map((h, i) => (
                    <option key={i} value={i}>
                      {h || `Column ${i + 1}`}
                    </option>
                  ))}
                </select>
              </label>
              <label className="text-sm text-neutral-400">
                Rate of sale column
                <select
                  value={rateOfSaleCol}
                  onChange={(e) => setRateOfSaleCol(Number(e.target.value))}
                  className="mt-1 block w-full rounded-md border border-neutral-700 bg-neutral-900 px-2 py-1.5 text-sm text-neutral-100"
                >
                  {headers.map((h, i) => (
                    <option key={i} value={i}>
                      {h || `Column ${i + 1}`}
                    </option>
                  ))}
                </select>
              </label>
            </div>

            <div className="max-h-48 overflow-auto rounded border border-neutral-800">
              <table className="min-w-full text-xs">
                <thead className="bg-neutral-900 text-neutral-400">
                  <tr>
                    {headers.map((h, i) => (
                      <th key={i} className="px-2 py-1 text-left">
                        {h || `Column ${i + 1}`}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="text-neutral-300">
                  {previewRows.map((row, ri) => (
                    <tr key={ri} className="odd:bg-neutral-950 even:bg-neutral-900/50">
                      {row.map((cell, ci) => (
                        <td key={ci} className="px-2 py-1">
                          {cell}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {error && <p className="text-sm text-red-400">{error}</p>}

            <div className="flex justify-end gap-2">
              <button
                onClick={onClose}
                className="rounded-md border border-neutral-700 px-3 py-1.5 text-sm text-neutral-300 hover:bg-neutral-800"
              >
                Cancel
              </button>
              <button
                onClick={handleCommit}
                disabled={busy}
                className="rounded-md bg-white px-3 py-1.5 text-sm font-medium text-black hover:bg-neutral-200 disabled:opacity-50"
              >
                {busy ? "Importing…" : "Import"}
              </button>
            </div>
          </div>
        )}

        {step === "result" && result && (
          <div className="space-y-3">
            <p className="text-sm text-neutral-300">
              Imported <span className="font-semibold">{result.matchedCount}</span> product rows.
            </p>
            {result.unmatched.length > 0 && (
              <div>
                <p className="text-sm font-medium text-red-400">
                  {result.unmatched.length} product name(s) didn&apos;t match anything in your
                  product list and were skipped:
                </p>
                <ul className="mt-1 max-h-32 list-disc overflow-auto pl-5 text-xs text-neutral-400">
                  {result.unmatched.map((name) => (
                    <li key={name}>{name}</li>
                  ))}
                </ul>
              </div>
            )}
            <div className="flex justify-end">
              <button
                onClick={onClose}
                className="rounded-md bg-white px-3 py-1.5 text-sm font-medium text-black hover:bg-neutral-200"
              >
                Done
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
