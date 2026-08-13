import ExcelJS from "exceljs";
import Papa from "papaparse";

export interface ParsedSheet {
  headers: string[];
  rows: string[][]; // string cell values, one array per data row (excludes header row)
}

// Parses an uploaded VIP/Ekos export (xlsx or csv) into a generic
// headers + rows shape so the UI can let the user map columns rather than
// us guessing an exact export format we haven't seen yet.
export async function parseSpreadsheet(buffer: Buffer, filename: string): Promise<ParsedSheet> {
  const isCsv = filename.toLowerCase().endsWith(".csv");

  if (isCsv) {
    const text = buffer.toString("utf-8");
    const result = Papa.parse<string[]>(text, { skipEmptyLines: true });
    const [headerRow, ...dataRows] = result.data;
    return {
      headers: (headerRow ?? []).map((h) => String(h ?? "").trim()),
      rows: dataRows.map((r) => r.map((c) => String(c ?? "").trim())),
    };
  }

  const workbook = new ExcelJS.Workbook();
  // exceljs' bundled type defs predate the newer generic Node Buffer type;
  // the value is a real Buffer at runtime, so this cast is safe.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await workbook.xlsx.load(buffer as any);
  const sheet = workbook.worksheets[0];

  const headers: string[] = [];
  const rows: string[][] = [];

  sheet.eachRow((row, rowNumber) => {
    const values = (row.values as unknown[]).slice(1); // exceljs pads index 0
    const cells = values.map((v) => {
      if (v === null || v === undefined) return "";
      if (typeof v === "object" && "text" in (v as object)) return String((v as { text: unknown }).text);
      if (typeof v === "object" && "result" in (v as object)) return String((v as { result: unknown }).result);
      return String(v);
    });

    if (rowNumber === 1) {
      headers.push(...cells.map((c) => c.trim()));
    } else {
      rows.push(cells.map((c) => c.trim()));
    }
  });

  return { headers, rows };
}
