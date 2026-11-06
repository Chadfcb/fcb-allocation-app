"use client";

// Sales → VIP Item Codes → <brand> (2026-11-06, per Chad). The brand's items
// with FCB's Supplier Item Code and VIP Item ID (from VIP's Item Catalog),
// and a Download button for the same table as an Excel file.

import { useState } from "react";
import type { VipItemCode } from "@/lib/vipItemCodes";

async function downloadXlsx(brandName: string, rows: VipItemCode[]) {
  // exceljs loads only when someone clicks Download (same as other exports).
  const mod = await import("exceljs");
  const ExcelJS = ((mod as unknown as { default?: typeof mod }).default ?? mod) as typeof mod;
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("VIP Item Codes");
  ws.columns = [{ width: 55 }, { width: 20 }, { width: 14 }];
  ws.addRow(["Item", "Supplier Item Code", "VIP Item ID"]).font = { bold: true };
  for (const r of rows) ws.addRow([r.item, r.supplier_item_code, r.vip_item_id]);
  const buf = await wb.xlsx.writeBuffer();
  const blob = new Blob([buf], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `VIP Item Codes - ${brandName}.xlsx`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export default function VipItemCodesClient({
  brandName,
  rows,
  loadError,
}: {
  brandName: string;
  rows: VipItemCode[];
  loadError: string | null;
}) {
  const [busy, setBusy] = useState(false);
  const [downloadError, setDownloadError] = useState<string | null>(null);

  async function onDownload() {
    setBusy(true);
    setDownloadError(null);
    try {
      await downloadXlsx(brandName, rows);
    } catch {
      setDownloadError("Download didn't work. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-lg font-semibold text-neutral-100">{brandName} — VIP Item Codes</h1>
          <p className="text-sm text-neutral-500">
            {rows.length} item{rows.length === 1 ? "" : "s"}
          </p>
        </div>
        <button
          type="button"
          onClick={onDownload}
          disabled={busy || rows.length === 0}
          className="rounded-md bg-white px-3 py-1.5 text-sm font-medium text-black hover:bg-neutral-200 disabled:opacity-50"
        >
          {busy ? "Downloading…" : "Download"}
        </button>
      </div>
      {downloadError && <p className="text-xs text-red-400">{downloadError}</p>}

      <div className="overflow-hidden rounded-lg border border-neutral-800">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-neutral-800 bg-neutral-900 text-left text-xs uppercase tracking-wide text-neutral-500">
              <th className="px-3 py-2">Item</th>
              <th className="px-3 py-2">Supplier Item Code</th>
              <th className="px-3 py-2">VIP Item ID</th>
            </tr>
          </thead>
          <tbody>
            {loadError && (
              <tr>
                <td colSpan={3} className="px-3 py-8 text-center text-red-400">
                  Couldn&apos;t load the codes: {loadError}
                </td>
              </tr>
            )}
            {!loadError && rows.length === 0 && (
              <tr>
                <td colSpan={3} className="px-3 py-8 text-center text-neutral-500">
                  No VIP item codes for {brandName} yet.
                </td>
              </tr>
            )}
            {rows.map((r) => (
              <tr key={r.id} className="border-b border-neutral-800 last:border-b-0">
                <td className="px-3 py-2 text-neutral-200">{r.item}</td>
                <td className="px-3 py-2 font-mono text-neutral-300">{r.supplier_item_code}</td>
                <td className="px-3 py-2 font-mono text-neutral-300">{r.vip_item_id}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
