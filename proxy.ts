import { type NextRequest } from "next/server";
import { updateSession } from "@/lib/supabase/proxy";

export async function proxy(request: NextRequest) {
  return updateSession(request);
}

// Matcher excludes /api/cron/* (added 2026-09-10): this proxy redirects any
// unauthenticated request straight to /login, with no exception for API
// routes — which was silently swallowing every external call to
// app/api/cron/task-reminders (Vercel Cron's own invocations, and later
// cron-job.org's) before that route's own CRON_SECRET check ever got a
// chance to run. Both callers have no signed-in session by design (nobody's
// logged in for a scheduled job), so they were redirected to /login (a 3xx)
// every single time, and neither Vercel Cron nor cron-job.org follows
// redirects — the request just ends there, silently. This is very likely
// why the reminder job never actually ran even once, previously blamed on
// Vercel's cron reliability. Any other route under /api/cron/* added later
// gets the same exemption; every other route (pages and the rest of
// /api/*) is untouched and still requires a real login exactly as before.
export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|api/cron|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
