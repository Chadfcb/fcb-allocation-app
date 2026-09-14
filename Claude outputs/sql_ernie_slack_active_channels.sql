-- Ernie in Slack: "stay in the conversation" state (2026-09-14, per Chad).
--
-- Chad's ask: once Ernie is @mentioned in a channel, he should keep
-- replying to plain messages there (no @mention needed) until the channel
-- goes quiet for a while, then go back to mention-only. This table is that
-- "is this channel currently active" state -- one row per Slack channel,
-- bumped every time Ernie replies (whether triggered by a fresh @mention or
-- by an already-active conversation). app/api/slack/events/route.ts reads
-- and writes this via the service-role client only (Ernie's Slack backend
-- has no browser session to run this under), so RLS below intentionally
-- has zero policies -- nothing except the service role can touch this
-- table, which is exactly right since no end user ever should.
create table if not exists ernie_slack_active_channels (
  channel_id text primary key,
  last_activity_at timestamptz not null default now()
);

alter table ernie_slack_active_channels enable row level security;
-- No policies added on purpose -- only the service-role key (which bypasses
-- RLS entirely) can read or write this table.
