-- Ernie in Slack: manual Slack-user -> FCB-account mapping (2026-09-14).
--
-- We originally tried matching a Slack user to an FCB app account by email
-- (via Slack's users.info API). That turned out to be unreliable -- Slack's
-- users.info call returns "user_not_found" for real, verified users in this
-- workspace even with users:read/users:read.email fully granted (confirmed
-- via Vercel logs and cross-checked against Slack's own "Copy member ID"),
-- which looks like a platform-side restriction rather than anything
-- fixable on our end. This table replaces that approach entirely: a simple
-- explicit mapping filled in once per person, with zero dependency on
-- Slack's user-lookup API.
--
-- To add someone else later: get their Slack member ID (in Slack, click
-- their profile picture -> the "..." menu -> "Copy member ID"), then either
-- insert a row here directly, or ask Claude to do it given their name/email
-- and Slack ID.
create table if not exists ernie_slack_user_map (
  slack_user_id text primary key,
  app_user_id uuid not null references profiles(id) on delete cascade,
  created_at timestamptz not null default now()
);

alter table ernie_slack_user_map enable row level security;
-- No policies added on purpose -- only the service-role key (used by
-- app/api/slack/events/route.ts) can read or write this table.

-- Bootstrap: map Chad's own Slack account to his FCB profile so this works
-- immediately after this file is run.
insert into ernie_slack_user_map (slack_user_id, app_user_id)
select 'UAXCQMU2V', id from profiles where email ilike 'chad@fullcirclebrewing.com'
on conflict (slack_user_id) do update set app_user_id = excluded.app_user_id;
