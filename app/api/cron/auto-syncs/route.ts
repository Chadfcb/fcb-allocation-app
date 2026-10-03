import { NextRequest, NextResponse } from "next/server";
import { runAutoSyncs } from "@/lib/syncs/autoSyncs";

// Scheduled entry point for Automatic Syncs (Admin → Ekos Sync), added
// 2026-10-03. Same CRON_SECRET check as the other /api/cron routes (which
// proxy.ts lets through without a login session). NOT on the schedule in
// vercel.json yet — that's Phase 3 of claude/ekos-auto-sync-plan.md, once
// the Ekos reading step (Phase 2) is built and proven with "Run now".
export const maxDuration = 300;

export async function GET(req: NextRequest) {
  const cronSecret = process.env.CRON_SECRET?.trim();
  const received = req.headers.get("authorization")?.trim().replace(/^Bearer\s+/i, "").trim();
  if (!cronSecret || received !== cronSecret) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const summary = await runAutoSyncs("scheduled", null);
  return NextResponse.json({ ok: true, ...summary });
}
