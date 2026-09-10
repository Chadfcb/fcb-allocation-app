# Setting up Task due-date email reminders

## What it does

Every day, the app checks for open tasks that are due tomorrow or due today, and emails whoever is assigned to each one — exactly those two days, never before or after a task's due date. Each task only ever gets emailed once per milestone (once for "due tomorrow," once for "due today") — no repeat nagging.

## Trigger — reworked 2026-09-10, no longer Vercel Cron

**What happened:** two real tasks (assigned to Dave, due 09/08/2026) never got either reminder email. Investigation ruled out the code, the deploy, and the Gmail/env var setup — all confirmed fine. Vercel's own documentation says its free-tier Cron feature is "best effort" and can simply not fire on a given day with zero error or log trace, and Vercel Hobby's Runtime Logs only retain **1 hour** of history anyway, so there's no way to look back and confirm what happened after the fact. Per Chad: "0 faith in vercel" for this specific piece, and not interested in paying for Vercel Pro just to get reliable Cron timing.

**The fix:** this route (`/api/cron/task-reminders`) is no longer triggered by Vercel's own Cron feature. It's now triggered by an external, free scheduler hitting the same URL — Vercel still hosts and runs the actual code (that part isn't the unreliable piece; Vercel serving an incoming HTTP request is the same reliable path every page of this app already uses), it just doesn't decide *when* to call it anymore.

### Set up the external scheduler (cron-job.org, free)

1. Go to **cron-job.org** and create a free account (or use another free "ping a URL on a schedule" service if you prefer one — the setup is the same idea).
2. Create a new cron job:
   - **URL**: `https://fcb-data.com/api/cron/task-reminders`
   - **Schedule**: pick whatever cadence you want. Once a day at a specific time works, or — recommended — every few hours (e.g. every 4 hours) as extra insurance. Running it more than once a day is completely safe: a task already marked "notified" is skipped on every later run, so nobody gets double-emailed.
   - **Request method**: GET
   - **Custom header**: `Authorization: Bearer <CRON_SECRET>` — use the exact same `CRON_SECRET` value already set in Vercel's environment variables (Settings → Environment Variables in your Vercel project, if you need to look it up).
3. Save it. That's the whole setup — no code deploy needed for this part, it's just a config screen on their site.

The old `vercel.json` cron entry can stay in place (it's a harmless, redundant backup trigger now) or be removed — it's no longer load-bearing either way.

## One-time setup already done (kept here for reference)

These steps were completed when the feature was first built and shouldn't need repeating unless something changes (e.g. the Gmail app password gets revoked):

1. **Gmail "App Password" for ernie@fullcirclebrewing.com** — lets the app send email through that mailbox without knowing its real password. Set up via `myaccount.google.com/apppasswords` (requires 2-Step Verification on first).
2. **Vercel environment variables**: `GMAIL_USER`, `GMAIL_APP_PASSWORD`, `SUPABASE_SERVICE_ROLE_KEY`, `CRON_SECRET`.
3. **SQL migration**: `sql/task_due_reminders.sql`, run once in Supabase's SQL Editor.

## Deploying the current fix

```powershell
cd "C:\Users\C Lizzel\OneDrive\Desktop\FCB-Allocations\fcb-allocation-app"
git add .
git commit -m "Revert due-day catch-up; keep exact day-before/day-of matching plus send-failure logging"
git push
```

No SQL needed for this change — it's a code-only fix (exact day-before/day-of matching, kept exactly as originally specified, plus error logging on a failed send) plus the external scheduler setup above, which happens entirely on cron-job.org's site, not in this repo.
