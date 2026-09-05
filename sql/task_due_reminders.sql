-- Task due-date email reminders (2026-09-05, per Chad).
-- Run this once in Supabase's SQL Editor, before the matching code deploy.
--
-- Adds two "have we already sent this?" timestamps to task_items so the
-- reminder job (app/api/cron/task-reminders/route.ts, run once a day by
-- Vercel Cron) never emails the same task twice for the same milestone —
-- once when a task's due date is tomorrow, and again when it's today, each
-- only ever sent once per task.

alter table task_items
  add column if not exists notified_day_before_at timestamptz,
  add column if not exists notified_due_day_at timestamptz;

comment on column task_items.notified_day_before_at is
  'When the "due tomorrow" reminder email was sent for this task. Null = not sent yet.';
comment on column task_items.notified_due_day_at is
  'When the "due today" reminder email was sent for this task. Null = not sent yet.';

-- No RLS change needed — task_items already has an open "any signed-in user
-- can update" policy, and the reminder job itself runs with the Supabase
-- service role key (bypasses RLS entirely, since it runs on a schedule with
-- no signed-in user attached).
