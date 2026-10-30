-- Email Studio — send through ernie@ Gmail instead of SendGrid (added
-- 2026-10-30, per Chad: "we dont want a seperate paid service" … "lets use
-- ernies current email, capped at 1800 a day"). See
-- claude/email-designer-plan.md.
--
-- Run this ONCE in Supabase's SQL Editor BEFORE pushing the code.
-- Safe to run more than once. Needs sql/email_sending.sql to have been run
-- first (it was, 2026-10-30).
--
-- What it does:
--   1. Lets a send be paused or cancelled, and lets a recipient be skipped.
--   2. Records when each email actually went out (for the 1,800-a-day cap).
--   3. A safe "hand me the next few emails" function so two runs can never
--      send the same email twice.
--   4. Turns on Supabase's built-in scheduler and has it call the app every
--      5 minutes to send the next small batch. The app itself decides the
--      hours (7am–6pm Pacific) and the daily cap.

-- 1. Statuses ---------------------------------------------------------------
alter table public.email_campaigns drop constraint if exists email_campaigns_status_check;
alter table public.email_campaigns add constraint email_campaigns_status_check
  check (status in ('scheduled', 'sending', 'paused', 'cancelled', 'sent', 'partial', 'failed'));

alter table public.email_sends drop constraint if exists email_sends_status_check;
alter table public.email_sends add constraint email_sends_status_check
  check (status in ('queued', 'sending', 'accepted', 'failed', 'skipped'));

-- 2. When each email went out -----------------------------------------------
alter table public.email_sends add column if not exists sent_at timestamptz;
alter table public.email_sends add column if not exists claimed_at timestamptz;
create index if not exists email_sends_sent_at_idx on public.email_sends (sent_at) where sent_at is not null;
create index if not exists email_sends_queued_idx on public.email_sends (campaign_id, created_at) where status = 'queued';

-- 3. Hand out the next batch (server only) ------------------------------------
-- Takes up to n queued emails from campaigns that are sending (oldest send
-- first), marks them "sending" and returns them. SKIP LOCKED means two runs
-- at the same moment get different emails. Emails stuck in "sending" for
-- 15+ minutes (a run that crashed) go back in the queue first.
create or replace function public.claim_email_sends(n int)
returns table (id uuid, campaign_id uuid, email text, name text)
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.email_sends s
     set status = 'queued', claimed_at = null
   where s.status = 'sending' and s.claimed_at < now() - interval '15 minutes';

  return query
  with picked as (
    select s.id
      from public.email_sends s
      join public.email_campaigns c on c.id = s.campaign_id
     where s.status = 'queued'
       and c.status = 'sending'
     order by c.created_at, s.created_at
     limit greatest(n, 0)
     for update of s skip locked
  )
  update public.email_sends s
     set status = 'sending', claimed_at = now()
    from picked
   where s.id = picked.id
  returning s.id, s.campaign_id, s.email, s.name;
end;
$$;
revoke all on function public.claim_email_sends(int) from public, anon, authenticated;

-- 4. Sent-tab totals: add "sent" and "waiting" (new columns go at the end).
create or replace view public.email_campaign_stats with (security_invoker = true) as
select
  campaign_id,
  count(*)::int as recipients,
  count(*) filter (where status = 'accepted')::int as accepted,
  count(*) filter (where status = 'failed')::int as failed,
  count(delivered_at)::int as delivered,
  count(opened_at)::int as opened,
  count(clicked_at)::int as clicked,
  count(bounced_at)::int as bounced,
  count(spam_at)::int as spam_reports,
  count(unsubscribed_at)::int as unsubscribed,
  count(*) filter (where status in ('queued', 'sending'))::int as waiting,
  count(*) filter (where status = 'skipped')::int as skipped
from public.email_sends
group by campaign_id;

-- 5. The every-5-minutes timer ------------------------------------------------
-- A private key only the database and the app's server can read, so nobody
-- else can poke the sender. Made here, never typed or shared by anyone.
create table if not exists public.email_worker_key (
  id int primary key default 1 check (id = 1),
  key text not null default (replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', '')),
  created_at timestamptz not null default now()
);
alter table public.email_worker_key enable row level security;
-- (no policies = nobody in the app can read it; the server uses the service key)
insert into public.email_worker_key (id) values (1) on conflict (id) do nothing;

create extension if not exists pg_cron;
create extension if not exists pg_net;

select cron.unschedule(jobid) from cron.job where jobname = 'fcb-email-sender';
select cron.schedule(
  'fcb-email-sender',
  '*/5 * * * *',
  $job$
  select net.http_post(
    url := 'https://www.fcb-data.com/api/email-studio/worker',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-worker-key', (select key from public.email_worker_key where id = 1)
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 120000
  );
  $job$
);
