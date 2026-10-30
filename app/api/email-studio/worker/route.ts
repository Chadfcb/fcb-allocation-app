import { timingSafeEqual } from "node:crypto";
import { createAdminClient } from "@/lib/supabase/admin";
import { processEmailQueue } from "@/lib/email/queue";

// Email Studio's sender (added 2026-10-30). Called every 5 minutes by
// Supabase's own scheduler (pg_cron job "fcb-email-sender", set up by
// sql/email_gmail_sending.sql) — not Vercel's, which only runs once a day on
// this plan. Public route (proxy.ts) but locked: the caller must send the
// private key that only the database holds (email_worker_key). Running it
// extra times is harmless — the daily cap, sending hours and per-run batch
// size are all enforced inside processEmailQueue.
export const dynamic = "force-dynamic";
export const maxDuration = 120;

async function handle(request: Request) {
  const given = request.headers.get("x-worker-key") ?? "";
  const admin = createAdminClient();
  const { data } = await admin.from("email_worker_key").select("key").eq("id", 1).maybeSingle();
  const expected = data?.key ?? "";
  const ok = !!expected && given.length === expected.length && timingSafeEqual(Buffer.from(given), Buffer.from(expected));
  if (!ok) return Response.json({ error: "Not allowed" }, { status: 401 });

  const result = await processEmailQueue(admin);
  return Response.json(result);
}

export const POST = handle;
export const GET = handle;
