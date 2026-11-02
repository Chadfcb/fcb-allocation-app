// Download order (2026-11-02, per Chad): "on the operations inventory/
// allocations, can we have button for each distributor, that allows us to
// download the order so we can send it in an email to the distributor to
// attempt to get an approval".
//
// Builds one distributor's order for the week shown on Inventory & Allocation
// as an Excel file: header (FCB, distributor, delivery week, date), every
// product with a quantity grouped under its brand divider, that distributor's
// price (Distributor Pricing) and line total, then total cases / kegs / bbl /
// $ and "Please reply to approve this order." Same price × quantity as the
// page's Order Value row.

import { bblPerUnit } from "@/lib/brewPlanner";
import { derivePackaging } from "@/lib/packaging";

export interface OrderLine {
  brand: string | null; // the brand divider above the product
  product: string;
  quantity: number;
  price: number; // 0 = no price set
}

const GREEN = "FF2E6B1F";
const LIGHT = "FFEAF4E4";
const CUR = '$#,##0.00;($#,##0.00);"–"';

function packageOf(name: string): string {
  const p = derivePackaging(name);
  if (p.kind === "keg") return p.size === "1_2bbl" ? "1/2 bbl keg" : "1/6 bbl keg";
  if (p.kind === "tap_handle") return "Tap handle";
  const n = name.toLowerCase();
  if (/19\.2/.test(n)) return "Case – 12 × 19.2oz cans";
  if (/16\s*oz|6x4/.test(n)) return "Case – 6 × 4-pack 16oz cans";
  if (/12\s*oz|4x6/.test(n)) return "Case – 4 × 6-pack 12oz cans";
  return "";
}

const safe = (s: string) => s.replace(/[\\/:*?"<>|]/g, "-");

export function orderFileName(distributor: string, weekLabel: string): string {
  return safe(`Full Circle Brewing - ${distributor} order - ${weekLabel}.xlsx`);
}

export async function buildOrderWorkbook(distributor: string, weekLabel: string, lines: OrderLine[]): Promise<ArrayBuffer> {
  const ExcelJS = (await import("exceljs")).default;
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("Order", { pageSetup: { orientation: "portrait", fitToPage: true, fitToWidth: 1, fitToHeight: 0 } });
  const font = (o: Partial<{ bold: boolean; size: number; color: string; italic: boolean }> = {}) => ({
    name: "Arial",
    size: o.size ?? 10,
    bold: o.bold ?? false,
    italic: o.italic ?? false,
    color: { argb: o.color ?? "FF1F1F1F" },
  });
  ws.columns = [{ width: 52 }, { width: 28 }, { width: 10 }, { width: 13 }, { width: 15 }];

  ws.addRow(["Full Circle Brewing Co."]).font = font({ bold: true, size: 16, color: GREEN });
  ws.addRow(["620 F St., Fresno, CA 93706"]).font = font({ color: "FF595959" });
  ws.addRow([]);
  const today = new Date().toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric", timeZone: "America/Los_Angeles" });
  for (const [k, v] of [
    ["Order for", distributor],
    ["Week", weekLabel],
    ["Date", today],
  ]) {
    const r = ws.addRow([k, v]);
    r.getCell(1).font = font({ bold: true });
    r.getCell(2).font = font();
    ws.mergeCells(r.number, 2, r.number, 5);
  }
  ws.addRow([]);

  const head = ws.addRow(["Product", "Package", "Quantity", "Price", "Line Total"]);
  head.eachCell((c, i) => {
    c.font = font({ bold: true, color: "FFFFFFFF" });
    c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: GREEN } };
    c.alignment = { horizontal: i === 1 || i === 2 ? "left" : "center", vertical: "middle" };
  });
  head.height = 20;
  const first = head.number + 1;

  let cases = 0;
  let kegs = 0;
  let bbl = 0;
  let lastBrand: string | null | undefined = undefined;
  for (const l of lines) {
    if (l.brand && l.brand !== lastBrand) {
      const b = ws.addRow([l.brand]);
      b.getCell(1).font = font({ bold: true, color: GREEN });
      b.getCell(1).fill = { type: "pattern", pattern: "solid", fgColor: { argb: LIGHT } };
      ws.mergeCells(b.number, 1, b.number, 5);
    }
    lastBrand = l.brand;
    const r = ws.addRow([l.product, packageOf(l.product), l.quantity, l.price || null, null]);
    r.getCell(5).value = { formula: `C${r.number}*D${r.number}`, result: l.quantity * l.price };
    r.eachCell({ includeEmpty: true }, (c, i) => {
      c.font = font({ bold: i === 3 });
      c.border = { bottom: { style: "thin", color: { argb: "FFD9D9D9" } } };
      if (i >= 3) c.alignment = { horizontal: "center" };
    });
    r.getCell(4).numFmt = CUR;
    r.getCell(5).numFmt = CUR;
    const kind = derivePackaging(l.product).kind;
    if (kind === "keg") kegs += l.quantity;
    else if (kind === "can") cases += l.quantity;
    bbl += bblPerUnit(l.product) * l.quantity;
  }
  const last = ws.lastRow?.number ?? first;
  const total = lines.reduce((s, x) => s + x.quantity * x.price, 0);
  ws.addRow([]);
  const sum = (label: string, value: string | number | { formula: string; result: number }, fmt?: string) => {
    const r = ws.addRow([label, null, null, null, value]);
    r.getCell(1).font = font({ bold: true, color: GREEN });
    r.getCell(5).font = font({ bold: true, color: GREEN });
    r.getCell(5).alignment = { horizontal: "center" };
    if (fmt) r.getCell(5).numFmt = fmt;
    for (let i = 1; i <= 5; i++) r.getCell(i).fill = { type: "pattern", pattern: "solid", fgColor: { argb: LIGHT } };
  };
  sum("Total cases", cases);
  sum("Total kegs", kegs);
  sum("Total barrels (bbl)", Math.round(bbl * 100) / 100, "0.00");
  sum("Order total", { formula: `SUM(E${first}:E${last})`, result: total }, CUR);
  if (lines.some((x) => !x.price)) {
    ws.addRow([]);
    ws.addRow(["Lines with no price show – (no price set in FCB-Data Distributor Pricing)."]).font = font({ italic: true, size: 9, color: "FF595959" });
  }
  ws.addRow([]);
  const ask = ws.addRow(["Please reply to approve this order."]);
  ask.font = font({ bold: true, size: 11 });
  ws.views = [{ showGridLines: false }];

  return (await wb.xlsx.writeBuffer()) as ArrayBuffer;
}

// Hands the file to the browser as a download.
export function downloadOrder(buf: ArrayBuffer, fileName: string) {
  const blob = new Blob([buf], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}
