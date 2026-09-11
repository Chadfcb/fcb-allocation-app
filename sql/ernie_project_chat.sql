-- Turns an Ernie Project's chat from "everyone gets their own private
-- conversation with Ernie" into one live, shared room per Project — every
-- user with access to that Project sees the exact same thread, labeled with
-- each person's real name, updating live for everyone via Supabase Realtime.
-- Added 2026-09-11 per Chad: "i want it a live chat area, where each user in
-- the project has a Name, and we can chat live with eachother, and also have
-- ernie chat if we ask him a question as well, as if he is just another
-- user." Follow-up answers: this REPLACES the old private per-user Project
-- conversation (general, non-Project Ernie chat is completely untouched —
-- ernie_conversations/ernie_messages keep working exactly as before, for
-- everything outside a Project); and Ernie reads every message and uses his
-- own judgment about whether to jump in, rather than only replying when
-- explicitly @-mentioned (see app/api/ernie/project-chat/route.ts).
--
-- Old per-user Project conversations (ernie_conversations rows with
-- project_id set, created before this date) are left exactly as they are —
-- nothing here deletes or migrates them, they just stop being how a Project
-- chat works going forward. Nobody loses history; the UI simply stops
-- creating new ones and switches Projects over to this table instead.
--
-- Idempotent — safe to re-run.

create table if not exists ernie_project_messages (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references ernie_projects(id) on delete cascade,
  -- Who sent it. Null for an Ernie message (there's no auth.users row for
  -- Ernie) — sender_name carries "Ernie" in that case. Set null (not
  -- cascaded) if a person's account is ever removed, so their prior messages
  -- stay in the room rather than vanishing.
  sender_id uuid references profiles(id) on delete set null,
  -- Denormalized display name at send time (their full_name, or email if
  -- that's blank — same fallback the rest of the app uses) so a message
  -- still shows a real name even if someone's account name changes later,
  -- and so this table never needs a join just to render the room.
  sender_name text not null,
  role text not null check (role in ('user', 'ernie')),
  content text not null,
  file_ids uuid[] not null default '{}',
  created_at timestamptz not null default now()
);

create index if not exists ernie_project_messages_project_id_created_at_idx
  on ernie_project_messages (project_id, created_at asc);

alter table ernie_project_messages enable row level security;

-- Same visibility rule as the rest of a Project (ernie_projects,
-- ernie_project_files): anyone with an ernie_project_access grant for this
-- project, or any admin, sees every message in the room.
drop policy if exists "ernie_project_messages_select" on ernie_project_messages;
create policy "ernie_project_messages_select" on ernie_project_messages for select using (
  exists (
    select 1 from ernie_project_access a
    where a.project_id = ernie_project_messages.project_id and a.user_id = auth.uid()
  )
  or exists (select 1 from profiles p where p.id = auth.uid() and p.role = 'admin')
);

-- Insert: same access requirement, plus the row has to be either this same
-- person's own "user" message (sender_id = auth.uid()) or an "ernie" message
-- (sender_id left null) — the server posts Ernie's replies using the
-- triggering person's own signed-in session (same pattern as
-- ernie_conversations/ernie_messages letting one session insert both 'user'
-- and 'assistant' rows), so this can't be scoped to "sender_id = auth.uid()"
-- alone. No update/delete policy at all, anywhere below — this room is
-- append-only, on purpose, like any chat log.
drop policy if exists "ernie_project_messages_insert" on ernie_project_messages;
create policy "ernie_project_messages_insert" on ernie_project_messages for insert
  with check (
    (
      exists (
        select 1 from ernie_project_access a
        where a.project_id = ernie_project_messages.project_id and a.user_id = auth.uid()
      )
      or exists (select 1 from profiles p where p.id = auth.uid() and p.role = 'admin')
    )
    and (sender_id = auth.uid() or sender_id is null)
  );

-- Realtime — lets every open browser tab in a Project pick up a new message
-- the instant it's inserted (see DashboardLiveBlocks.tsx for the same
-- postgres_changes pattern already used elsewhere in this app), instead of
-- polling or requiring a refresh. Guarded so re-running this file doesn't
-- error if it's already added.
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'ernie_project_messages'
  ) then
    alter publication supabase_realtime add table ernie_project_messages;
  end if;
end $$;

-- Tell Ernie itself this exists, same as every other feature (see
-- sql/ernie_projects.sql's matching note). Idempotent by description match.
insert into ernie_reference_documents (file_name, storage_path, description)
select
  'Ernie Project live chat (2026-09-11)',
  null,
  'Inside an Ernie Project, the chat is a single shared, live room — every person with access to that Project sees the same thread (table ernie_project_messages), each message labeled with the real sender''s name. Ernie reads every message and decides for himself whether to reply, the way a team member would — he does not reply to every message, only when he has something genuinely useful to add or is clearly being addressed.'
where not exists (
  select 1 from ernie_reference_documents where file_name = 'Ernie Project live chat (2026-09-11)'
);
