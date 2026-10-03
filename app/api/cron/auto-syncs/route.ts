import { NextRequest, NextResponse } from "next/server";
import { runAutoSyncs } from "@/lib/syncs/autoSyncs";

// Scheduled entry point for Automatic Syncs (Admin → Ekos Sync), added
// 2026-10-03. Same CRON_SECRET check as the other /api/cron routes (which
// proxy.ts lets through without a login session). Scheduled in vercel.json
// (Phase 3, 2026-10-03): "0 11 * * 1-5" = weekdays 11:00 UTC. Chad: "we need
// it done by 5am, so set it between 4 and 5am". Vercel's free plan runs it
// somewhere within that hour, and its clock is UTC (no daylight saving):
// 4–5am Pacific in summer, 3–4am in winter — always done before 5am.
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
