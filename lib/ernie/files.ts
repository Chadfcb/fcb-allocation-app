// Server-only helpers behind Ernie's file upload feature (added 2026-08-31,
// Chad: "spreadsheets is important, we use so many, having ernie to be able
// to edit them and analyze them would be huge"). Split out of tools.ts
// since this pulls in exceljs/papaparse and does real byte-level work
// (downloading from Storage, parsing workbooks, writing new ones) —
// tools.ts stays the thin per-tool dispatch layer.
//
// Reading: images and PDFs go to Claude as native content blocks (it reads
// them directly, no extraction needed here). Spreadsheets (.xlsx) and CSV
// get rendered into an address-labeled text grid (row numbers down the
// left, column letters across the top, matching real spreadsheet
// coordinates) so Ernie can both answer questions about the data AND, when
// asked to edit it, reference the exact same cell addresses back.
//
// Editing: edit_spreadsheet (see lib/ernie/tools.ts) doesn't regenerate a
// file from scratch — it loads the user's actual uploaded workbook with
// ExcelJS, changes only the specific cells it was asked to change, and
// saves that same workbook back out, so everything else (formatting,
// styles, other sheets, formulas) survives untouched. CSV edits work the
// same way at the row/column level, just without any styling to preserve.

import ExcelJS from "exceljs";
import Papa from "papaparse";
import mammoth from "mammoth";
import type { SupabaseClient } from "@supabase/supabase-js";
import { storageFileName } from "@/lib/events";
import { ERNIE_FILES_BUCKET, ERNIE_MAX_FILE_BYTES } from "@/lib/ernie/fileLimits";

export type ErnieFileKind =
  | "image"
  | "pdf"
  | "spreadsheet_xlsx"
  | "spreadsheet_csv"
  | "word_docx"
  | "text"
  | "unsupported";

export interface ErnieFileRow {
  id: string;
  file_name: string;
  mime_type: string | null;
  size_bytes: number | null;
  storage_path: string;
  // Which Storage bucket storage_path actually lives in. Null/undefined
  // means the default "ernie-files" bucket (an ordinary uploaded or
  // Ernie-produced file) — set only when this row came from
  // get_file_for_download fetching a file that lives somewhere ELSE in the
  // app (e.g. an Ernie Project's own library, a POS label file). Every
  // function below that downloads a file's actual bytes MUST resolve the
  // bucket from this field (falling back to ERNIE_FILES_BUCKET), never
  // hardcode ERNIE_FILES_BUCKET — fixed 2026-09-10 after Ernie could
  // create a download chip for an Ernie Project file (via
  // get_file_for_download) but then failed to actually read its content
  // ("couldn't be read from storage") because read_uploaded_file was
  // always looking in ERNIE_FILES_BUCKET regardless of where the file
  // really lived.
  source_bucket?: string | null;
}

// Resolves which Storage bucket a given ErnieFileRow's bytes actually live
// in — see the source_bucket doc comment above. Always use this instead of
// referencing ERNIE_FILES_BUCKET directly when downloading a file's bytes.
function bucketFor(file: Pick<ErnieFileRow, "source_bucket">): string {
  return file.source_bucket || ERNIE_FILES_BUCKET;
}

const IMAGE_EXT = ["png", "jpg", "jpeg", "gif", "webp"];
const TEXT_EXT = ["txt", "md", "json", "log", "yaml", "yml"];
const IMAGE_MIME_BY_EXT: Record<string, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
};

function extOf(fileName: string): string {
  return (fileName.split(".").pop() || "").toLowerCase();
}

export function classifyErnieFile(fileName: string, mimeType: string | null): ErnieFileKind {
  const ext = extOf(fileName);
  const mime = (mimeType || "").toLowerCase();
  if (mime.startsWith("image/") || IMAGE_EXT.includes(ext)) return "image";
  if (mime === "application/pdf" || ext === "pdf") return "pdf";
  if (ext === "xlsx" || ext === "xlsm" || mime.includes("spreadsheetml")) return "spreadsheet_xlsx";
  if (ext === "csv" || ext === "tsv" || mime === "text/csv") return "spreadsheet_csv";
  // .docx only (mammoth can't read the legacy binary .doc format) —
  // added 2026-09-10, per Chad: "He needs to be able to read spreadsheets,
  // pdf's, doc's ect." Word's real MIME type is the long
  // "wordprocessingml.document" string; check that rather than a generic
  // "application/msword" (which also covers .doc, which this can't parse).
  if (ext === "docx" || mime.includes("wordprocessingml")) return "word_docx";
  if (mime.startsWith("text/") || TEXT_EXT.includes(ext)) return "text";
  return "unsupported";
}

// 1-indexed column number -> spreadsheet-style letters (1 -> "A", 27 -> "AA").
function colLetter(n: number): string {
  let s = "";
  let num = n;
  while (num > 0) {
    const rem = (num - 1) % 26;
    s = String.fromCharCode(65 + rem) + s;
    num = Math.floor((num - 1) / 26);
  }
  return s;
}

// Spreadsheet-style address ("B3") -> 1-indexed {row, col}. Returns null for
// anything that doesn't parse as letters-then-digits.
function parseCellAddress(addr: string): { row: number; col: number } | null {
  const m = /^([A-Za-z]+)(\d+)$/.exec(addr.trim());
  if (!m) return null;
  const [, letters, digits] = m;
  let col = 0;
  for (const ch of letters.toUpperCase()) col = col * 26 + (ch.charCodeAt(0) - 64);
  const row = parseInt(digits, 10);
  if (!row || row < 1) return null;
  return { row, col };
}

function cellDisplayValue(cell: ExcelJS.Cell): string {
  const v = cell.value;
  if (v === null || v === undefined) return "";
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  if (typeof v === "object") {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- exceljs' CellValue union (formula/hyperlink/rich-text/error variants) doesn't structurally overlap with a plain Record, so a direct cast is rejected — going through `any` is safe here since every branch below narrows with its own `in`/Array.isArray check before reading a property.
    const obj = v as any;
    if (Array.isArray(obj.richText)) {
      return (obj.richText as { text: string }[]).map((t) => t.text).join("");
    }
    if ("result" in obj) return String(obj.result ?? "");
    if ("text" in obj) return String(obj.text ?? "");
    return "";
  }
  return String(v);
}

const RENDER_MAX_ROWS = 300;
const RENDER_MAX_COLS = 30;
const RENDER_MAX_SHEETS = 10;
const COL_WIDTH = 12;

function renderGrid(sheetLabel: string, rowCount: number, colCount: number, cellAt: (row: number, col: number) => string): string {
  const rowsToShow = Math.min(rowCount, RENDER_MAX_ROWS);
  const colsToShow = Math.min(colCount, RENDER_MAX_COLS);
  const parts: string[] = [
    `${sheetLabel} (${rowCount} row${rowCount === 1 ? "" : "s"} x ${colCount} col${colCount === 1 ? "" : "s"})`,
  ];
  const header = ["    ", ...Array.from({ length: colsToShow }, (_, i) => colLetter(i + 1).padEnd(COL_WIDTH))].join("");
  parts.push(header);
  for (let r = 1; r <= rowsToShow; r++) {
    const cells: string[] = [];
    for (let c = 1; c <= colsToShow; c++) {
      const raw = cellAt(r, c);
      const truncated = raw.length > COL_WIDTH - 2 ? `${raw.slice(0, COL_WIDTH - 3)}…` : raw;
      cells.push(truncated.padEnd(COL_WIDTH));
    }
    parts.push(`${String(r).padEnd(4)}${cells.join("")}`);
  }
  if (rowCount > rowsToShow) {
    parts.push(`... (${rowCount - rowsToShow} more row(s) not shown — ask about a specific range if you need them)`);
  }
  if (colCount > colsToShow) {
    parts.push(`(only the first ${colsToShow} of ${colCount} columns are shown)`);
  }
  return parts.join("\n");
}

async function renderXlsx(buffer: Buffer): Promise<string> {
  const workbook = new ExcelJS.Workbook();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- exceljs' bundled types predate the newer Node Buffer generic
  await workbook.xlsx.load(buffer as any);
  const sheets = workbook.worksheets.slice(0, RENDER_MAX_SHEETS);
  const parts = sheets.map((sheet) =>
    renderGrid(`Sheet "${sheet.name}"`, sheet.rowCount, sheet.columnCount, (r, c) =>
      cellDisplayValue(sheet.getRow(r).getCell(c)),
    ),
  );
  if (workbook.worksheets.length > sheets.length) {
    parts.push(`... (${workbook.worksheets.length - sheets.length} more sheet(s) not shown)`);
  }
  return parts.join("\n\n");
}

function csvRows(buffer: Buffer): string[][] {
  const text = buffer.toString("utf-8");
  // skipEmptyLines: false so row numbers here match real file line numbers
  // exactly — that's what keeps edit_spreadsheet's cell addresses lined up
  // with what Ernie just read.
  const result = Papa.parse<string[]>(text, { skipEmptyLines: false });
  return result.data;
}

function renderCsv(buffer: Buffer): string {
  const rows = csvRows(buffer);
  const rowCount = rows.length;
  const colCount = rows.reduce((m, r) => Math.max(m, r.length), 0);
  return renderGrid('Sheet "Sheet1"', rowCount, colCount, (r, c) => String(rows[r - 1]?.[c - 1] ?? ""));
}

// ---------------------------------------------------------------------
// Staging a file's rows for real analysis (stage_uploaded_file_for_query,
// added 2026-09-09 — see sql/ernie_staged_rows.sql for the full writeup of
// why this exists). Unlike renderXlsx/renderCsv above (capped at
// RENDER_MAX_ROWS, meant for Ernie to just look at/edit a file), this reads
// EVERY row up to STAGING_MAX_ROWS and keeps each cell's real type (numbers
// stay numbers) so the rows can be inserted as JSONB and actually summed/
// grouped/filtered with real SQL via run_read_only_query, instead of Ernie
// trying to eyeball-aggregate thousands of rows of rendered text.
// ---------------------------------------------------------------------

export const STAGING_MAX_ROWS = 20000;

export type StagedCellValue = string | number | boolean | null;

export interface StagedRow {
  rowIndex: number;
  data: Record<string, StagedCellValue>;
}

export interface StagingResult {
  sheetName: string;
  headers: string[];
  rows: StagedRow[];
  totalRowsInSheet: number;
  truncated: boolean;
}

function cellTypedValue(cell: ExcelJS.Cell): StagedCellValue {
  const v = cell.value;
  if (v === null || v === undefined) return null;
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  if (typeof v === "number" || typeof v === "boolean") return v;
  if (typeof v === "object") {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- see cellDisplayValue above for why
    const obj = v as any;
    if (Array.isArray(obj.richText)) {
      return (obj.richText as { text: string }[]).map((t) => t.text).join("");
    }
    if ("result" in obj) {
      const r = obj.result;
      return typeof r === "number" ? r : r == null ? null : String(r);
    }
    if ("text" in obj) return String(obj.text ?? "");
    return null;
  }
  return String(v);
}

// A blank or repeated header would silently clobber a JSONB key (two
// columns both named "Total" would leave only the second one queryable) —
// dedupe defensively rather than let that happen invisibly.
function dedupeHeaders(raw: string[]): string[] {
  const seen = new Map<string, number>();
  return raw.map((h, i) => {
    const label = h.trim() || `Column${i + 1}`;
    const count = seen.get(label) ?? 0;
    seen.set(label, count + 1);
    return count === 0 ? label : `${label}_${count + 1}`;
  });
}

async function parseXlsxRowsForStaging(buffer: Buffer, sheetName?: string): Promise<StagingResult> {
  const workbook = new ExcelJS.Workbook();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- see renderXlsx above
  await workbook.xlsx.load(buffer as any);
  let sheet: ExcelJS.Worksheet | undefined;
  if (sheetName) {
    sheet = workbook.getWorksheet(sheetName);
    if (!sheet) {
      throw new Error(
        `No sheet named "${sheetName}" in this file. Sheets in this file: ${workbook.worksheets.map((s) => s.name).join(", ")}.`,
      );
    }
  } else {
    sheet = workbook.worksheets[0];
  }
  if (!sheet) throw new Error("This file has no sheets.");

  const colCount = sheet.columnCount;
  const headerRow = sheet.getRow(1);
  const headers = dedupeHeaders(
    Array.from({ length: colCount }, (_, i) => cellDisplayValue(headerRow.getCell(i + 1))),
  );

  const totalRowsInSheet = Math.max(sheet.rowCount - 1, 0);
  const lastRowToRead = 1 + Math.min(totalRowsInSheet, STAGING_MAX_ROWS);
  const rows: StagedRow[] = [];
  for (let r = 2; r <= lastRowToRead; r++) {
    const data: Record<string, StagedCellValue> = {};
    let blank = true;
    for (let c = 1; c <= colCount; c++) {
      const val = cellTypedValue(sheet.getRow(r).getCell(c));
      if (val !== null && val !== "") blank = false;
      data[headers[c - 1]] = val;
    }
    if (blank) continue;
    rows.push({ rowIndex: r - 1, data });
  }
  return { sheetName: sheet.name, headers, rows, totalRowsInSheet, truncated: totalRowsInSheet > STAGING_MAX_ROWS };
}

function parseCsvRowsForStaging(buffer: Buffer): StagingResult {
  const raw = csvRows(buffer);
  if (!raw.length) throw new Error("This file has no rows.");
  const headers = dedupeHeaders(raw[0].map((h) => h ?? ""));
  const totalRowsInSheet = Math.max(raw.length - 1, 0);
  const lastIndexToRead = Math.min(totalRowsInSheet, STAGING_MAX_ROWS);
  const rows: StagedRow[] = [];
  for (let i = 0; i < lastIndexToRead; i++) {
    const rawRow = raw[i + 1] ?? [];
    const data: Record<string, StagedCellValue> = {};
    let blank = true;
    headers.forEach((h, ci) => {
      const trimmed = String(rawRow[ci] ?? "").trim();
      let val: StagedCellValue = trimmed === "" ? null : trimmed;
      // CSV has no cell types of its own — coerce anything that reads as a
      // plain number so SUM/AVG/comparisons work without a cast in every
      // query. Anything with formatting (commas, $, %) stays text on
      // purpose; ask Ernie to strip that in the SQL (e.g. replace(...)) —
      // guessing at it here risks silently mis-parsing real text data.
      if (val !== null && /^-?\d+(\.\d+)?$/.test(val)) val = Number(val);
      if (val !== null) blank = false;
      data[h] = val;
    });
    if (blank) continue;
    rows.push({ rowIndex: i + 1, data });
  }
  return { sheetName: "Sheet1", headers, rows, totalRowsInSheet, truncated: totalRowsInSheet > STAGING_MAX_ROWS };
}

// stage_uploaded_file_for_query's implementation — downloads the user's
// actual uploaded file, parses every row (see above), replaces any
// previously-staged rows for this same file (so re-staging after Ernie
// re-reads an updated attach doesn't duplicate), and inserts the new rows
// into ernie_staged_rows in chunks (Supabase/PostgREST caps how much a
// single insert() call can carry).
const STAGING_INSERT_CHUNK_SIZE = 500;

export async function stageFileForQuery(
  supabase: SupabaseClient,
  userId: string,
  file: ErnieFileRow,
  sheetName?: string,
): Promise<{
  file_id: string;
  file_name: string;
  sheet_name: string;
  row_count: number;
  columns: string[];
  truncated: boolean;
  note: string;
}> {
  const kind = classifyErnieFile(file.file_name, file.mime_type);
  if (kind !== "spreadsheet_xlsx" && kind !== "spreadsheet_csv") {
    throw new Error(`"${file.file_name}" isn't a spreadsheet or CSV — only those file types can be staged for query.`);
  }

  const { data, error } = await supabase.storage.from(bucketFor(file)).download(file.storage_path);
  if (error || !data) throw new Error(`Couldn't read "${file.file_name}" from storage.`);
  const buffer = Buffer.from(await data.arrayBuffer());

  const result =
    kind === "spreadsheet_xlsx" ? await parseXlsxRowsForStaging(buffer, sheetName) : parseCsvRowsForStaging(buffer);

  if (!result.rows.length) {
    throw new Error(`"${file.file_name}" (sheet "${result.sheetName}") has no data rows to stage.`);
  }

  // Replace, don't append — re-staging the same file should reflect its
  // current contents, not pile up duplicates from earlier attempts.
  const { error: deleteErr } = await supabase.from("ernie_staged_rows").delete().eq("file_id", file.id);
  if (deleteErr) throw new Error(`Couldn't clear previously-staged rows for this file: ${deleteErr.message}`);

  for (let i = 0; i < result.rows.length; i += STAGING_INSERT_CHUNK_SIZE) {
    const chunk = result.rows.slice(i, i + STAGING_INSERT_CHUNK_SIZE).map((row) => ({
      user_id: userId,
      file_id: file.id,
      sheet_name: result.sheetName,
      row_index: row.rowIndex,
      data: row.data,
    }));
    const { error: insertErr } = await supabase.from("ernie_staged_rows").insert(chunk);
    if (insertErr) throw new Error(`Staged ${i} of ${result.rows.length} row(s), then failed: ${insertErr.message}`);
  }

  const truncNote = result.truncated
    ? ` Only the first ${STAGING_MAX_ROWS} of ${result.totalRowsInSheet} rows were staged (the rest were left out — ask if you need a higher cap).`
    : "";
  return {
    file_id: file.id,
    file_name: file.file_name,
    sheet_name: result.sheetName,
    row_count: result.rows.length,
    columns: result.headers,
    truncated: result.truncated,
    note:
      `Staged ${result.rows.length} row(s) from "${file.file_name}" (sheet "${result.sheetName}") into ` +
      `ernie_staged_rows, file_id="${file.id}". Query it with run_read_only_query, e.g.: ` +
      `select data->>'${result.headers[0]}' as ${JSON.stringify(result.headers[0]).replace(/"/g, "")}, count(*) from ernie_staged_rows where file_id = '${file.id}' group by 1. ` +
      `Each row's fields live in the jsonb "data" column — read a field as data->>'ColumnName' (text) and cast ` +
      `numeric ones with (data->>'ColumnName')::numeric before summing/averaging/comparing.${truncNote}`,
  };
}

// clear_staged_file_data's implementation — lets Ernie (or a natural
// end-of-analysis tidy-up) remove rows it staged once they're no longer
// needed, rather than leaving scratch data to pile up indefinitely.
export async function clearStagedFileData(
  supabase: SupabaseClient,
  fileId: string,
): Promise<{ deleted: boolean }> {
  const { error } = await supabase.from("ernie_staged_rows").delete().eq("file_id", fileId);
  if (error) throw new Error(`Couldn't clear staged data: ${error.message}`);
  return { deleted: true };
}

export interface SpreadsheetEditInput {
  sheet?: string;
  cell: string;
  value: string | number | null;
}

async function applyXlsxEdits(
  buffer: Buffer,
  edits: SpreadsheetEditInput[],
): Promise<{ buffer: Buffer; sheetNames: string[]; applied: number; skipped: string[] }> {
  const workbook = new ExcelJS.Workbook();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await workbook.xlsx.load(buffer as any);
  const sheetNames = workbook.worksheets.map((s) => s.name);
  let applied = 0;
  const skipped: string[] = [];

  for (const edit of edits) {
    // A sheet name that doesn't match anything must be SKIPPED, not fall
    // back to the first sheet — the earlier version of this used `??`
    // for both "no sheet given" and "sheet not found", which silently
    // applied a wrongly-named edit to whatever sheet happened to be first.
    let sheet: ExcelJS.Worksheet | undefined;
    if (edit.sheet) {
      sheet = workbook.getWorksheet(edit.sheet);
      if (!sheet) {
        skipped.push(`${edit.sheet}!${edit.cell} — no sheet named "${edit.sheet}" (sheets in this file: ${sheetNames.join(", ")})`);
        continue;
      }
    } else {
      sheet = workbook.worksheets[0];
      if (!sheet) {
        skipped.push(`${edit.cell} — this file has no sheets`);
        continue;
      }
    }
    if (!parseCellAddress(edit.cell)) {
      skipped.push(`${sheet.name}!${edit.cell} — not a valid cell address`);
      continue;
    }
    const cell = sheet.getCell(edit.cell);
    if (typeof edit.value === "string" && edit.value.trim().startsWith("=")) {
      cell.value = { formula: edit.value.trim().slice(1) } as ExcelJS.CellFormulaValue;
    } else {
      cell.value = edit.value;
    }
    applied++;
  }

  const out = await workbook.xlsx.writeBuffer();
  return { buffer: Buffer.from(out), sheetNames, applied, skipped };
}

function applyCsvEdits(buffer: Buffer, edits: SpreadsheetEditInput[]): { buffer: Buffer; applied: number; skipped: string[] } {
  const rows = csvRows(buffer).map((r) => [...r]);
  let applied = 0;
  const skipped: string[] = [];

  for (const edit of edits) {
    const addr = parseCellAddress(edit.cell);
    if (!addr) {
      skipped.push(`${edit.cell} — not a valid cell address`);
      continue;
    }
    const { row, col } = addr;
    while (rows.length < row) rows.push([]);
    const rowArr = rows[row - 1];
    while (rowArr.length < col) rowArr.push("");
    rowArr[col - 1] = edit.value == null ? "" : String(edit.value);
    applied++;
  }

  const csv = Papa.unparse(rows);
  return { buffer: Buffer.from(csv, "utf-8"), applied, skipped };
}

const TEXT_CHAR_CAP = 20000;

// Builds the Anthropic content block(s) representing one uploaded file —
// used both to attach a freshly-uploaded file to the message that
// references it, and (forToolResult: true, from the read_uploaded_file
// tool) to pull an earlier file's contents back up without re-attaching
// it.
//
// Fixed 2026-09-11 (Chad/Eddie hit this in an Ernie Project's chat: Ernie
// could find their marketing SOP PDF in the Project's file library via
// get_file_for_download, but couldn't actually read it without someone
// re-attaching it fresh) — a "document" (PDF) block genuinely isn't valid
// content INSIDE a tool_result block on Claude's Messages API, but it IS
// valid as a sibling block in the same user-role turn that carries that
// tool_result — a turn can hold both. So `forToolResult` no longer changes
// what this function returns for a PDF (it always returns the real
// document block); the caller is what changed instead — see the tool-loop
// in app/api/ernie/chat/route.ts and app/api/ernie/project-chat/route.ts,
// which now pulls any "document" block out of a tool's __contentBlocks and
// pushes it as a sibling of that round's tool_result blocks, rather than
// trying to nest it inside one.
export async function buildFileContentBlocks(
  supabase: SupabaseClient,
  file: ErnieFileRow,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- Anthropic content block shape varies by type (text/image/document)
): Promise<any[]> {
  const header = `Attached file: "${file.file_name}"`;

  if (file.size_bytes != null && file.size_bytes > ERNIE_MAX_FILE_BYTES) {
    return [{ type: "text", text: `${header} — too large to read (over the 20MB limit).` }];
  }

  const kind = classifyErnieFile(file.file_name, file.mime_type);

  const { data, error } = await supabase.storage.from(bucketFor(file)).download(file.storage_path);
  if (error || !data) {
    return [{ type: "text", text: `${header} — couldn't be read from storage (it may have been removed).` }];
  }
  const buffer = Buffer.from(await data.arrayBuffer());

  if (kind === "image") {
    const mediaType = IMAGE_MIME_BY_EXT[extOf(file.file_name)] ?? (file.mime_type || "image/png");
    return [{ type: "image", source: { type: "base64", media_type: mediaType, data: buffer.toString("base64") } }];
  }

  if (kind === "pdf") {
    return [{ type: "document", source: { type: "base64", media_type: "application/pdf", data: buffer.toString("base64") } }];
  }

  if (kind === "spreadsheet_xlsx") {
    try {
      const text = await renderXlsx(buffer);
      return [{ type: "text", text: `${header} (spreadsheet):\n\n${text}` }];
    } catch {
      return [{ type: "text", text: `${header} — couldn't be parsed as a spreadsheet (it may be corrupted or password-protected).` }];
    }
  }

  if (kind === "spreadsheet_csv") {
    const text = renderCsv(buffer);
    return [{ type: "text", text: `${header} (spreadsheet):\n\n${text}` }];
  }

  if (kind === "word_docx") {
    try {
      const { value } = await mammoth.extractRawText({ buffer });
      let text = value.trim();
      let truncated = false;
      if (text.length > TEXT_CHAR_CAP) {
        text = text.slice(0, TEXT_CHAR_CAP);
        truncated = true;
      }
      return [
        {
          type: "text",
          text: `${header} (Word document):\n\n${text || "(this document appears to be empty)"}${
            truncated ? "\n\n... (truncated — the file is longer than shown)" : ""
          }`,
        },
      ];
    } catch {
      return [
        {
          type: "text",
          text: `${header} — couldn't be parsed as a Word document (it may be corrupted, password-protected, or the older .doc format, which isn't supported — only .docx is).`,
        },
      ];
    }
  }

  if (kind === "text") {
    let text = buffer.toString("utf-8");
    let truncated = false;
    if (text.length > TEXT_CHAR_CAP) {
      text = text.slice(0, TEXT_CHAR_CAP);
      truncated = true;
    }
    return [
      {
        type: "text",
        text: `${header}:\n\n${text}${truncated ? "\n\n... (truncated — the file is longer than shown)" : ""}`,
      },
    ];
  }

  return [
    {
      type: "text",
      text: `${header} — this file type (${file.mime_type || "unknown"}) can't be read for analysis yet. Only images, PDFs, spreadsheets (.xlsx), CSV, Word documents (.docx), and plain text files are supported right now.`,
    },
  ];
}

// edit_spreadsheet's implementation — loads the user's actual file from
// Storage, applies the requested cell edits in place (preserving
// formatting/other sheets/formulas), and saves the result as a new
// ernie_files row (direction: "output") rather than overwriting the
// original, so the source file is never lost.
export async function applySpreadsheetEdits(
  supabase: SupabaseClient,
  userId: string,
  file: ErnieFileRow,
  edits: SpreadsheetEditInput[],
  outputFileName?: string,
): Promise<{ id: string; file_name: string; mime_type: string | null; size_bytes: number; note: string }> {
  const kind = classifyErnieFile(file.file_name, file.mime_type);
  if (kind !== "spreadsheet_xlsx" && kind !== "spreadsheet_csv") {
    throw new Error(`"${file.file_name}" isn't a spreadsheet or CSV — edit_spreadsheet only works on .xlsx or .csv files.`);
  }
  if (!edits.length) throw new Error("No edits provided.");

  const { data, error } = await supabase.storage.from(bucketFor(file)).download(file.storage_path);
  if (error || !data) throw new Error(`Couldn't read the original file "${file.file_name}" from storage.`);
  const buffer = Buffer.from(await data.arrayBuffer());

  let newBuffer: Buffer;
  let note: string;

  if (kind === "spreadsheet_xlsx") {
    const result = await applyXlsxEdits(buffer, edits);
    newBuffer = result.buffer;
    note = `Applied ${result.applied} of ${edits.length} edit(s). Sheets in this file: ${result.sheetNames.join(", ")}.`;
    if (result.skipped.length) note += ` Skipped: ${result.skipped.join("; ")}.`;
  } else {
    const result = applyCsvEdits(buffer, edits);
    newBuffer = result.buffer;
    note = `Applied ${result.applied} of ${edits.length} edit(s).`;
    if (result.skipped.length) note += ` Skipped: ${result.skipped.join("; ")}.`;
  }

  const finalName = outputFileName?.trim() || file.file_name;
  const path = `${userId}/${storageFileName(finalName)}`;

  const { error: uploadErr } = await supabase.storage.from(ERNIE_FILES_BUCKET).upload(path, newBuffer, {
    contentType: file.mime_type || undefined,
    upsert: false,
  });
  if (uploadErr) throw new Error(`Couldn't save the edited file: ${uploadErr.message}`);

  const { data: inserted, error: insertErr } = await supabase
    .from("ernie_files")
    .insert({
      user_id: userId,
      direction: "output",
      source_file_id: file.id,
      file_name: finalName,
      mime_type: file.mime_type,
      size_bytes: newBuffer.length,
      storage_path: path,
    })
    .select("id, file_name, mime_type, size_bytes")
    .single();
  if (insertErr) throw new Error(`Edited the file but couldn't save its record: ${insertErr.message}`);

  return { ...inserted, note };
}

// export_pricing_data_as_spreadsheet's implementation (added 2026-09-09,
// Chad: "give me the contribution margin page in a spreadsheet, and remove
// labor cost from the calculations" — Ernie had get_pricing_data to READ
// this data and edit_spreadsheet to mutate a file the user already
// uploaded, but nothing that could build a brand-new file out of live app
// data. This is that missing piece: given one or more named sheets (each a
// header row + data rows, already computed by the caller — see
// buildPricingSpreadsheetSheets in lib/ernie/tools.ts), writes a real .xlsx
// with ExcelJS and saves it as a new ernie_files row (direction: "output",
// source_file_id: null — this file didn't come from an edit of anything),
// same download-chip mechanism edit_spreadsheet already uses.
export interface SpreadsheetSheetInput {
  name: string;
  header: string[];
  rows: (string | number | null)[][];
}

const XLSX_MIME = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

export async function createSpreadsheetFromSheets(
  supabase: SupabaseClient,
  userId: string,
  fileName: string,
  sheets: SpreadsheetSheetInput[],
): Promise<{ id: string; file_name: string; mime_type: string | null; size_bytes: number; note: string }> {
  if (!sheets.length) throw new Error("No sheet data to write.");

  const workbook = new ExcelJS.Workbook();
  for (const sheet of sheets) {
    // Sheet names can't be blank, exceed 31 chars, or repeat — all three
    // are already true of the fixed names buildPricingSpreadsheetSheets
    // passes in, but truncate defensively in case that ever changes.
    const ws = workbook.addWorksheet(sheet.name.slice(0, 31) || "Sheet1");
    ws.addRow(sheet.header);
    ws.getRow(1).font = { bold: true };
    for (const row of sheet.rows) ws.addRow(row);
    ws.columns.forEach((col) => {
      col.width = 18;
    });
  }

  const out = await workbook.xlsx.writeBuffer();
  const buffer = Buffer.from(out);

  const finalName = fileName.trim() || "export.xlsx";
  const path = `${userId}/${storageFileName(finalName)}`;

  const { error: uploadErr } = await supabase.storage.from(ERNIE_FILES_BUCKET).upload(path, buffer, {
    contentType: XLSX_MIME,
    upsert: false,
  });
  if (uploadErr) throw new Error(`Couldn't save the new spreadsheet: ${uploadErr.message}`);

  const { data: inserted, error: insertErr } = await supabase
    .from("ernie_files")
    .insert({
      user_id: userId,
      direction: "output",
      source_file_id: null,
      file_name: finalName,
      mime_type: XLSX_MIME,
      size_bytes: buffer.length,
      storage_path: path,
    })
    .select("id, file_name, mime_type, size_bytes")
    .single();
  if (insertErr) throw new Error(`Built the spreadsheet but couldn't save its record: ${insertErr.message}`);

  return { ...inserted, note: `Built "${finalName}" with ${sheets.length} sheet(s).` };
}

// get_file_for_download's implementation (added 2026-08-31, Chad: "pos may
// not be the only place we end up having files stored... but either way,
// we need ernie to have the ability to pull files and present them if
// asked"). Deliberately generic and feature-agnostic: it doesn't know or
// care whether the file came from POS > Labels, an event's materials, the
// shared POS library, or something built after this — Ernie itself finds
// the bucket + storage_path first (via run_read_only_query against
// whatever table holds that library) and just hands both to this function.
//
// Whether the download actually succeeds is decided entirely by that
// bucket's own Row Level Security, evaluated against the caller's real,
// request-scoped session — never a service-role bypass. That's what makes
// this safe to leave un-gated (not in ADMIN_ONLY_TOOL_NAMES): a Basic user
// calling this against an admin-only bucket like pos-label-files simply
// gets an access error back from Storage, the exact same way a raw
// run_read_only_query against an admin-only table comes back empty. It
// also means this function needs no changes at all once the admin/basic
// split is replaced by a real per-user, per-area permission system —
// whatever RLS ends up enforcing on that bucket is what this inherits
// automatically.
//
// The file's bytes are never copied into Ernie's own "ernie-files" bucket —
// only a lightweight ernie_files row is created (direction: "output",
// source_bucket: the ORIGINAL bucket, storage_path: the ORIGINAL path) so
// the chat UI's existing download-chip machinery can resolve it later,
// including after reopening a past conversation.
export async function fetchExternalFileForDownload(
  supabase: SupabaseClient,
  userId: string,
  bucket: string,
  path: string,
  fileName?: string,
): Promise<{ id: string; file_name: string; mime_type: string | null; size_bytes: number; note: string }> {
  if (!bucket.trim() || !path.trim()) {
    throw new Error("Both a bucket and a path are required.");
  }

  const { data, error } = await supabase.storage.from(bucket).download(path);
  if (error || !data) {
    throw new Error(
      "Couldn't fetch that file — either it doesn't exist, or you don't currently have access to it.",
    );
  }
  const buffer = Buffer.from(await data.arrayBuffer());
  const finalName = fileName?.trim() || path.split("/").pop() || path;

  const { data: inserted, error: insertErr } = await supabase
    .from("ernie_files")
    .insert({
      user_id: userId,
      direction: "output",
      source_bucket: bucket,
      file_name: finalName,
      mime_type: null,
      size_bytes: buffer.length,
      storage_path: path,
    })
    .select("id, file_name, mime_type, size_bytes")
    .single();
  if (insertErr) {
    throw new Error(`Found the file but couldn't prepare it for download: ${insertErr.message}`);
  }

  return { ...inserted, note: `Ready to download: "${finalName}".` };
}

// ---------------------------------------------------------------------
// Ernie's internet read access and sandbox (added 2026-09-09, see
// claude/ernie-sandbox-restrictions.md for the full agreed restriction
// spec this implements). Two separate capabilities:
//
// 1. Internet reads — Anthropic's own hosted web_fetch tool (wired in
//    app/api/ernie/chat/route.ts, resolved server-side same as
//    web_search) covers ordinary web pages and PDFs. It explicitly does
//    NOT retrieve images or spreadsheets from a URL. fetchUrlAsFile below
//    is the deliberate gap-filler for exactly those file types: a plain
//    read-only GET (never anything else — no cookies, no auth headers,
//    no way to submit or change anything on the far end) that drops the
//    result into the same ernie_files/Storage pipeline every uploaded
//    file already uses, so it's then readable/stageable/editable exactly
//    like something the user attached by hand.
//
// 2. The sandbox — Anthropic's hosted code_execution tool runs entirely
//    in Anthropic's own sandboxed container: no FCB infrastructure, no
//    live credentials reachable from inside it, zero network access at
//    all, hard resource/time caps, ephemeral by default. The only thing
//    that ever crosses back is a finished file, referenced by a file_id
//    in Anthropic's Files API — captureCodeExecutionFile downloads it and
//    drops it into that same ernie_files/Storage pipeline, so it shows up
//    as an ordinary download chip, exactly like a file edit_spreadsheet
//    or export_pricing_data_as_spreadsheet would produce. Nothing about
//    either capability gives Ernie any new way to write to the app's own
//    database, or to reach or change anything outside this same chat.
//
// logErnieToolExecution is the "log of what ran" restriction — a
// best-effort audit trail (see sql/ernie_tool_execution_log.sql) that
// never blocks or fails the actual chat response if logging itself has a
// problem.
// ---------------------------------------------------------------------

const FETCH_URL_TIMEOUT_MS = 20000;

// Best-effort SSRF guard. This runs on Vercel's own serverless network,
// not inside FCB's, so the blast radius of a trick is small regardless —
// but there's no reason to let a URL resolve Ernie's fetch to a loopback,
// link-local (this range also covers cloud metadata endpoints), or
// private-range address just because something crafted the link that way.
function isDisallowedFetchHost(hostname: string): boolean {
  const h = hostname.toLowerCase();
  if (h === "localhost" || h === "0.0.0.0" || h === "::1") return true;
  if (/^127\./.test(h)) return true;
  if (/^10\./.test(h)) return true;
  if (/^192\.168\./.test(h)) return true;
  if (/^172\.(1[6-9]|2\d|3[01])\./.test(h)) return true;
  if (/^169\.254\./.test(h)) return true;
  return false;
}

function fileNameFromUrl(url: string, contentDisposition: string | null): string {
  if (contentDisposition) {
    const m = /filename\*?=(?:UTF-8'')?"?([^";]+)"?/i.exec(contentDisposition);
    if (m?.[1]) {
      try {
        return decodeURIComponent(m[1]);
      } catch {
        return m[1];
      }
    }
  }
  try {
    const u = new URL(url);
    const last = u.pathname.split("/").filter(Boolean).pop();
    if (last) return last;
  } catch {
    // fall through to the generic default below
  }
  return "downloaded-file";
}

// fetch_url_as_file's implementation (see lib/ernie/tools.ts). GET only,
// no redirect to a disallowed host, capped at the same ERNIE_MAX_FILE_BYTES
// every direct upload is capped at.
export async function fetchUrlAsFile(
  supabase: SupabaseClient,
  userId: string,
  url: string,
  fileName?: string,
): Promise<{ id: string; file_name: string; mime_type: string | null; size_bytes: number; note: string }> {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error(`"${url}" isn't a valid URL.`);
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error("Only http:// and https:// URLs can be fetched.");
  }
  if (isDisallowedFetchHost(parsed.hostname)) {
    throw new Error("That address can't be fetched.");
  }

  let res: Response;
  try {
    res = await fetch(parsed.toString(), {
      method: "GET",
      redirect: "follow",
      signal: AbortSignal.timeout(FETCH_URL_TIMEOUT_MS),
    });
  } catch (err) {
    throw new Error(
      err instanceof Error && err.name === "TimeoutError"
        ? "That request took too long and was cancelled."
        : "Couldn't reach that URL.",
    );
  }
  if (!res.ok) {
    throw new Error(`That URL returned an error (HTTP ${res.status}).`);
  }

  const contentLength = res.headers.get("content-length");
  if (contentLength && Number(contentLength) > ERNIE_MAX_FILE_BYTES) {
    throw new Error("That file is too large to fetch (over the 20MB limit).");
  }

  const arrayBuffer = await res.arrayBuffer();
  if (arrayBuffer.byteLength > ERNIE_MAX_FILE_BYTES) {
    throw new Error("That file is too large to fetch (over the 20MB limit).");
  }
  const buffer = Buffer.from(arrayBuffer);

  const mimeType = res.headers.get("content-type")?.split(";")[0]?.trim() || null;
  const finalName = fileName?.trim() || fileNameFromUrl(parsed.toString(), res.headers.get("content-disposition"));
  const path = `${userId}/${storageFileName(finalName)}`;

  const { error: uploadErr } = await supabase.storage.from(ERNIE_FILES_BUCKET).upload(path, buffer, {
    contentType: mimeType || undefined,
    upsert: false,
  });
  if (uploadErr) throw new Error(`Fetched the file but couldn't save it: ${uploadErr.message}`);

  const { data: inserted, error: insertErr } = await supabase
    .from("ernie_files")
    .insert({
      user_id: userId,
      direction: "output",
      source_file_id: null,
      file_name: finalName,
      mime_type: mimeType,
      size_bytes: buffer.length,
      storage_path: path,
    })
    .select("id, file_name, mime_type, size_bytes")
    .single();
  if (insertErr) throw new Error(`Fetched the file but couldn't save its record: ${insertErr.message}`);

  return {
    ...inserted,
    note: `Fetched "${finalName}" (${mimeType || "unknown type"}) from the web. It's now available like any uploaded file — read_uploaded_file, stage_uploaded_file_for_query, or edit_spreadsheet all work on it.`,
  };
}

const ANTHROPIC_FILES_API = "https://api.anthropic.com/v1/files";

// Downloads a file the sandbox (Anthropic's hosted code_execution tool)
// produced, by the file_id Anthropic's own Files API assigned it, and
// drops it into the same ernie_files/Storage pipeline as everything else
// Ernie produces — called from app/api/ernie/chat/route.ts whenever a
// bash_code_execution_tool_result block reports a generated file.
export async function captureCodeExecutionFile(
  supabase: SupabaseClient,
  userId: string,
  anthropicFileId: string,
): Promise<{ id: string; file_name: string; mime_type: string | null; size_bytes: number }> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error("Server is missing ANTHROPIC_API_KEY.");
  const headers = { "x-api-key": apiKey, "anthropic-version": "2023-06-01" };

  const metaRes = await fetch(`${ANTHROPIC_FILES_API}/${anthropicFileId}`, { headers });
  if (!metaRes.ok) throw new Error(`Couldn't look up the generated file (HTTP ${metaRes.status}).`);
  const meta = await metaRes.json();

  const contentRes = await fetch(`${ANTHROPIC_FILES_API}/${anthropicFileId}/content`, { headers });
  if (!contentRes.ok) throw new Error(`Couldn't download the generated file (HTTP ${contentRes.status}).`);
  const buffer = Buffer.from(await contentRes.arrayBuffer());

  const finalName: string = meta.filename || `generated-file-${anthropicFileId}`;
  const mimeType: string | null = meta.mime_type || null;
  const path = `${userId}/${storageFileName(finalName)}`;

  const { error: uploadErr } = await supabase.storage.from(ERNIE_FILES_BUCKET).upload(path, buffer, {
    contentType: mimeType || undefined,
    upsert: false,
  });
  if (uploadErr) throw new Error(`Sandbox produced a file but it couldn't be saved: ${uploadErr.message}`);

  const { data: inserted, error: insertErr } = await supabase
    .from("ernie_files")
    .insert({
      user_id: userId,
      direction: "output",
      source_file_id: null,
      file_name: finalName,
      mime_type: mimeType,
      size_bytes: buffer.length,
      storage_path: path,
    })
    .select("id, file_name, mime_type, size_bytes")
    .single();
  if (insertErr) throw new Error(`Sandbox produced a file but its record couldn't be saved: ${insertErr.message}`);

  return inserted;
}

// Best-effort audit trail for Ernie's internet/sandbox use (see
// sql/ernie_tool_execution_log.sql) — a logging failure here must never
// break or block the actual chat response, so every call site swallows
// its own errors.
export async function logErnieToolExecution(
  supabase: SupabaseClient,
  userId: string,
  conversationId: string | undefined,
  toolName: string,
  detail: Record<string, unknown>,
): Promise<void> {
  try {
    await supabase.from("ernie_tool_execution_log").insert({
      user_id: userId,
      conversation_id: conversationId ?? null,
      tool_name: toolName,
      detail,
    });
  } catch {
    // Best-effort only — never surface a logging failure to the user.
  }
}
