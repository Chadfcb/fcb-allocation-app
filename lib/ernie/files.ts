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
import type { SupabaseClient } from "@supabase/supabase-js";
import { storageFileName } from "@/lib/events";
import { ERNIE_FILES_BUCKET, ERNIE_MAX_FILE_BYTES } from "@/lib/ernie/fileLimits";

export type ErnieFileKind =
  | "image"
  | "pdf"
  | "spreadsheet_xlsx"
  | "spreadsheet_csv"
  | "text"
  | "unsupported";

export interface ErnieFileRow {
  id: string;
  file_name: string;
  mime_type: string | null;
  size_bytes: number | null;
  storage_path: string;
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
// it. The two differ only in how a PDF is handled: Claude's Messages API
// accepts a "document" block in a user message, but not reliably inside a
// tool_result, so forToolResult mode asks for a re-attach instead of
// risking a malformed request.
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- Anthropic content block shape varies by type (text/image/document)
export async function buildFileContentBlocks(
  supabase: SupabaseClient,
  file: ErnieFileRow,
  opts: { forToolResult?: boolean } = {},
): Promise<any[]> {
  const header = `Attached file: "${file.file_name}"`;

  if (file.size_bytes != null && file.size_bytes > ERNIE_MAX_FILE_BYTES) {
    return [{ type: "text", text: `${header} — too large to read (over the 20MB limit).` }];
  }

  const kind = classifyErnieFile(file.file_name, file.mime_type);

  const { data, error } = await supabase.storage.from(ERNIE_FILES_BUCKET).download(file.storage_path);
  if (error || !data) {
    return [{ type: "text", text: `${header} — couldn't be read from storage (it may have been removed).` }];
  }
  const buffer = Buffer.from(await data.arrayBuffer());

  if (kind === "image") {
    const mediaType = IMAGE_MIME_BY_EXT[extOf(file.file_name)] ?? (file.mime_type || "image/png");
    return [{ type: "image", source: { type: "base64", media_type: mediaType, data: buffer.toString("base64") } }];
  }

  if (kind === "pdf") {
    if (opts.forToolResult) {
      return [{ type: "text", text: `${header} is a PDF — ask the user to re-attach it to read its contents again.` }];
    }
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
      text: `${header} — this file type (${file.mime_type || "unknown"}) can't be read for analysis yet. Only images, PDFs, spreadsheets (.xlsx), CSV, and plain text files are supported right now.`,
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

  const { data, error } = await supabase.storage.from(ERNIE_FILES_BUCKET).download(file.storage_path);
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
