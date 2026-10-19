import ExcelJS from "exceljs";

// Reading LilyPad's exported .xlsx files (added 2026-10-16 — see
// lib/syncs/lilypadReader.ts). Columns are found by their HEADER NAME on
// every sheet, never by position, so a reordered or extra column doesn't
// break anything. A sheet without the expected headers is skipped.

export type Cell = string | number | Date | null;
export type Row = Record<string, Cell>;

export interface Sheet {
  name: string;
  headers: string[];
  rows: Row[];
}

function cellValue(v: ExcelJS.CellValue): Cell {
  if (v === null || v === undefined) return null;
  if (v instanceof Date) return v;
  if (typeof v === "number" || typeof v === "string") return v;
  if (typeof v === "boolean") return v ? "Yes" : "No";
  if (typeof v === "object") {
    const o = v as unknown as Record<string, unknown>;
    if ("result" in o) return cellValue(o.result as ExcelJS.CellValue);
    if ("text" in o && typeof o.text === "string") return o.text;
    if ("richText" in o && Array.isArray(o.richText)) {
      return (o.richText as { text?: string }[]).map((r) => r.text ?? "").join("");
    }
    if ("hyperlink" in o && typeof o.hyperlink === "string") return o.hyperlink;
  }
  return String(v);
}

export const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

/** Every sheet, with the first row that contains `mustHave` used as headers. */
export async function readSheets(file: Buffer, mustHave: string): Promise<Sheet[]> {
  const wb = new ExcelJS.Workbook();
  // exceljs types expect its own Buffer flavour.
  await wb.xlsx.load(file as unknown as ArrayBuffer);
  const out: Sheet[] = [];
  const want = norm(mustHave);
  wb.eachSheet((ws) => {
    let headerRow = 0;
    let headers: string[] = [];
    for (let r = 1; r <= Math.min(ws.rowCount, 15); r++) {
      const vals = (ws.getRow(r).values as ExcelJS.CellValue[]).slice(1).map((v) => String(cellValue(v) ?? "").trim());
      if (vals.some((v) => norm(v) === want)) {
        headerRow = r;
        headers = vals;
        break;
      }
    }
    if (!headerRow) return;
    const rows: Row[] = [];
    for (let r = headerRow + 1; r <= ws.rowCount; r++) {
      const vals = (ws.getRow(r).values as ExcelJS.CellValue[]).slice(1);
      if (!vals.some((v) => v !== null && v !== undefined && String(cellValue(v) ?? "").trim() !== "")) continue;
      const row: Row = {};
      headers.forEach((h, i) => {
        if (h) row[h] = cellValue(vals[i]);
      });
      rows.push(row);
    }
    out.push({ name: ws.name, headers, rows });
  });
  return out;
}

/** The value of the first column whose header matches one of `names` (exact, then pattern). */
export function pick(row: Row, ...names: (string | RegExp)[]): Cell {
  const keys = Object.keys(row);
  for (const n of names) {
    const k =
      typeof n === "string" ? keys.find((h) => norm(h) === norm(n)) : keys.find((h) => n.test(h));
    if (k !== undefined && row[k] !== null && String(row[k]).trim() !== "") return row[k];
  }
  return null;
}

export function text(v: Cell): string | null {
  if (v === null || v === undefined) return null;
  const s = (v instanceof Date ? v.toISOString().slice(0, 10) : String(v)).trim();
  return s ? s : null;
}

export function num(v: Cell): number {
  if (typeof v === "number") return v;
  const t = String(v ?? "").replace(/[$,\s]/g, "");
  const n = Number(t);
  return Number.isFinite(n) ? n : 0;
}

/** "YYYY-MM-DD" from an Excel date, an Excel serial number, "M/D/YYYY" or "YYYY-MM-DD…". */
export function isoDate(v: Cell): string | null {
  if (v === null || v === undefined || v === "") return null;
  if (v instanceof Date) {
    // exceljs gives dates as UTC midnight of the calendar day.
    return Number.isNaN(v.getTime()) ? null : v.toISOString().slice(0, 10);
  }
  if (typeof v === "number") {
    if (v > 20000 && v < 80000) return new Date(Math.round((v - 25569) * 86400_000)).toISOString().slice(0, 10);
    return null;
  }
  const s = String(v).trim();
  let m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})/);
  if (m) {
    const y = m[3].length === 2 ? `20${m[3]}` : m[3];
    return `${y}-${m[1].padStart(2, "0")}-${m[2].padStart(2, "0")}`;
  }
  const t = Date.parse(s);
  return Number.isNaN(t) ? null : new Date(t).toISOString().slice(0, 10);
}
