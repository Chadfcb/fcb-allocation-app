-- Ernie's confirm-before-write staging table (added 2026-09-11).
--
-- Per Chad: Ernie should be able to write to the calendars and create
-- tasks, but only after (1) asking whatever questions it needs to fill in
-- the details, (2) summarizing exactly what it's about to create/change,
-- and (3) getting the user's explicit go-ahead in their own next message
-- — never proposing and executing an action in the same breath.
--
-- This table is what makes step 3 a real, structural checkpoint rather
-- than something only ever enforced by prompting: a "propose" tool call
-- (add_events_calendar_event, create_task, etc. with confirmed left out)
-- validates the request, resolves any names to real ids, and inserts a row
-- here describing EXACTLY what it would do — it does not touch the real
-- table yet. Only a later confirm_pending_action call, referencing that
-- same row's id, actually performs the write — and the app layer requires
-- that row's request_id (one per HTTP request / one per user chat
-- message) to be different from the request_id of the confirm call
-- itself, so a propose-then-confirm pair can never happen inside the same
-- tool-use loop — it always takes a genuine separate user message in
-- between. See lib/ernie/tools.ts's createPendingAction/
-- loadConfirmedPendingAction for the enforcement.
create table if not exists ernie_pending_actions (
  id uuid primary key default gen_random_uuid(),
  created_by uuid not null references profiles(id) on delete cascade,
  action_type text not null,
  target_table text not null,
  payload jsonb not null,
  summary text not null,
  request_id text not null,
  status text not null default 'pending' check (status in ('pending', 'executed', 'cancelled')),
  created_at timestamptz not null default now()
);

create index if not exists ernie_pending_actions_created_by_idx
  on ernie_pending_actions (created_by, created_at desc);

alter table ernie_pending_actions enable row level security;

-- Private to the user who proposed it — nobody else (not even an admin)
-- needs to see a half-confirmed draft action.
drop policy if exists ernie_pending_actions_select_own on ernie_pending_actions;
create policy ernie_pending_actions_select_own on ernie_pending_actions
  for select using (created_by = auth.uid());

drop policy if exists ernie_pending_actions_insert_own on ernie_pending_actions;
create policy ernie_pending_actions_insert_own on ernie_pending_actions
  for insert with check (created_by = auth.uid());

drop policy if exists ernie_pending_actions_update_own on ernie_pending_actions;
create policy ernie_pending_actions_update_own on ernie_pending_actions
  for update using (created_by = auth.uid());

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'ernie_pending_actions'
  ) then
    alter publication supabase_realtime add table ernie_pending_actions;
  end if;
end $$;
