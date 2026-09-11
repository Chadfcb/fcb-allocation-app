// This file (lib/ernie/tools-1.ts) is an orphaned duplicate of tools.ts —
// nothing in the app imports it (only "@/lib/ernie/tools" is ever imported),
// but Next.js's TypeScript type-check still compiles every .ts file in the
// project, so a stale copy of tools.ts left lying around here can break the
// build the moment tools.ts's own function signatures move on without it
// (exactly what happened on 2026-09-11: it still called
// buildFileContentBlocks with a 3rd argument that no longer exists).
//
// Emptied out on 2026-09-11 to unblock the build. Safe to delete this file
// entirely next time you're in the folder — it serves no purpose.
export {};
