// Shared constants for Ernie's file upload feature — kept in their own tiny
// file (no server-only imports like exceljs/Buffer) so both the client
// component (ErnieChatClient.tsx, which enforces the size cap before
// uploading) and server code (lib/ernie/files.ts, route.ts) can import the
// same numbers without the client bundle pulling in Node-only libraries.

export const ERNIE_FILES_BUCKET = "ernie-files";

// 20MB — comfortably covers any spreadsheet/PDF/image Chad's team would
// realistically attach, while keeping the base64-encoded request Ernie's
// chat route sends to Claude's API well under its size limits.
export const ERNIE_MAX_FILE_BYTES = 20 * 1024 * 1024;

export const ERNIE_MAX_FILES_PER_MESSAGE = 5;
