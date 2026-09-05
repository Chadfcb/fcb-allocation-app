# Setting up Task due-date email reminders

This feature is built and ready to deploy, but it needs a few things set up on your end first — none of it requires touching code, just a couple of settings pages.

## What it does

Every day, the app checks for open tasks that are due tomorrow or due today, and emails whoever is assigned to each one at around 8am Pacific. Each task only ever gets emailed once per milestone (once for "due tomorrow," once for "due today") — no repeat nagging.

**Heads up on timing:** Vercel's free plan (which is what this app runs on) only allows cron jobs to run once a day, and it doesn't guarantee the exact minute — it can land anywhere within about an hour of the scheduled time. I've set it to land around 8am during winter (PST); during daylight saving (roughly March–November) it'll drift to around 9am unless we manually shift it, or move to Vercel's paid plan for exact timing. Let me know if that's a problem and we can revisit.

## Steps

### 1. Create a Gmail "App Password" for ernie@fullcirclebrewing.com

Once that mailbox exists, this lets the app send email through it without knowing its real password.

1. Sign in to **ernie@fullcirclebrewing.com** in a browser.
2. Go to **myaccount.google.com/security**.
3. Under "How you sign in to Google," turn on **2-Step Verification** if it isn't already on (required for app passwords to be available).
4. Search the account settings for **"App passwords"** (or go to myaccount.google.com/apppasswords directly).
5. Create a new app password — name it something like "FCB Data App" — and copy the 16-character code it gives you. You won't be able to see it again after this screen closes.

If "App passwords" doesn't show up as an option, it may be blocked at the company level — someone with Google Workspace admin access would need to go to **admin.google.com → Security → Authentication → App passwords** and allow it for your organization (or at least for this one mailbox).

### 2. Check whether you already have a Supabase "service role" key in Vercel

This lets the daily reminder check run without a signed-in user (since nobody's logged in at 8am for a scheduled job). Good news — the app already has code elsewhere that uses this same key, so there's a decent chance it's already set up:

1. In Vercel: **Settings → Environment Variables** — look for one named `SUPABASE_SERVICE_ROLE_KEY`.
2. If it's already there, skip to step 3.
3. If it's NOT there: go to your Supabase project dashboard → **Project Settings → API**, copy the key labeled **service_role** (NOT the "anon" one you already use elsewhere — treat this one as sensitive, it has full access to the database), and add it to Vercel as `SUPABASE_SERVICE_ROLE_KEY`.

### 3. Add these to Vercel

In your Vercel project: **Settings → Environment Variables**, add (if not already there):

| Name | Value |
|---|---|
| `GMAIL_USER` | `ernie@fullcirclebrewing.com` |
| `GMAIL_APP_PASSWORD` | the 16-character code from step 1 |
| `SUPABASE_SERVICE_ROLE_KEY` | only if it wasn't already there per step 2 |
| `CRON_SECRET` | any random string you make up (e.g. a long password) — this just stops random people from triggering the reminder check themselves |

### 4. Run the SQL migration

Run `sql/task_due_reminders.sql` once in Supabase's SQL Editor, before deploying the code (adds two tracking columns to the Tasks table).

### 5. Deploy as usual

```powershell
cd "C:\Users\C Lizzel\OneDrive\Desktop\FCB-Allocations\fcb-allocation-app"
git add .
git commit -m "Add task due-date email reminders"
git push
```

Once that's live and the environment variables are set, Vercel will start running the check automatically every day — nothing further to do.
