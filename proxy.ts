import { type NextRequest } from "next/server";
import { updateSession } from "@/lib/supabase/proxy";

export async function proxy(request: NextRequest) {
  return updateSession(request);
}

// Matcher excludes /api/cron/* (added 2026-09-10) and /api/slack/* (added
// 2026-09-14): this proxy redirects any unauthenticated request straight to
// /login, with no exception for API routes -- which was silently swallowing
// every external call to app/api/cron/task-reminders (Vercel Cron's own
// invocations, and later cron-job.org's) before that route's own
// CRON_SECRET check ever got a chance to run. Both callers have no
// signed-in session by design (nobody's logged in for a scheduled job), so
// they were redirected to /login (a 3xx) every single time, and neither
// Vercel Cron nor cron-job.org follows redirects -- the request just ends
// there, silently. This is very likely why the reminder job never actually
// ran even once, previously blamed on Vercel's cron reliability.
//
// Same problem hit app/api/slack/events: Slack's own servers (verifying the
// Request URL, and later delivering real events) have no login session
// either, so they were redirected to /login too -- which is why Slack
// reported "Your URL didn't respond with the value of the challenge
// parameter." That route verifies Slack's own request signature itself, so
// it doesn't need this proxy's session check.
//
// Same for /api/google-calendar/hook/* (added 2026-09-23): Google's own
// change notifications and the database's "send this event to Google"
// calls have no login session either. Both routes check a shared secret
// themselves (google_calendar_sync.secret) before doing anything.
//
// Same for Twilio texting (added 2026-10-29): /api/twilio/* (Twilio's own
// servers deliver incoming texts — the route checks Twilio's signature
// itself) and the PUBLIC pages carriers and buyers must open without an app
// login: /privacy, /terms, /sms-signup and the form's /api/sms-signup. These
// pages show nothing from the app's data.
//
// Same for email (added 2026-10-30; SendGrid removed the same day): the
// sender that Supabase's scheduler calls every 5 minutes
// (/api/email-studio/worker — checks a private key only the database holds),
// and the links inside sent emails that anyone's inbox opens without an app
// login: /api/email/* (unsubscribe one-click — signed; open pixel; click
// tracking — signed) and the /email/unsubscribe page.
//
// Same for the websites' age check (added 2026-10-30): /api/age-check/script
// is loaded by fcbbrands.com and fullcirclebrewing.com on every page, by
// visitors with no app login. It only returns the check's design (no app
// data). Its default images live in /public/age-check (already exempt as
// image files).
//
// Any other route under /api/cron/* or /api/slack/* added later gets the
// same exemption; every other route (pages and the rest of /api/*) is
// untouched and still requires a real login exactly as before.
export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|api/cron|api/slack|api/google-calendar/hook|api/twilio|api/sms-signup|api/email-studio/worker|api/email/|email/unsubscribe|api/age-check|privacy$|privacy/|terms$|terms/|sms-signup$|sms-signup/|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
