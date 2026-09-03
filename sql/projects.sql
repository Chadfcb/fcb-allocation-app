-- Projects — the company-wide action/directive tracker. Run this once in
-- Supabase's SQL Editor, before the matching code deploy. Idempotent —
-- safe to re-run.
--
-- Deliberately NOT part of the Team Access / user_section_access system
-- (sql/user_section_access.sql) that gates every other feature in this
-- app. Per Chad: "it's basically anything that requires things to be
-- done... it doesn't have to be [one person] assigning, anyone can
-- assign, but it gives [leadership] the ability to see everything
-- currently happening inside the company." So every signed-in user
-- (admin or basic, regardless of any section grant) can read, create, and
-- update items and post chat messages — there's no admin-only piece here
-- at all except deleting a bad item/message, kept as a cleanup escape
-- hatch.
--
-- Two tables:
--   project_items    — one row per tracked action/directive.
--   project_messages — the chat thread + Notes-block replies under an item.
--     A message tagged is_directive = true is a "Directive" post (meant as
--     direction, not just a comment) — same table, just a flag, so the
--     thread stays one continuous list rather than two separate features.

create extension if not exists pgcrypto;

create table if not exists project_items (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  notes text,
  status text not null default 'open' check (status in ('open', 'resolved')),
  -- Where this item came from — 'manual' (someone typed it in) today;
  -- 'meeting_notes' / 'ai_import' are reserved for when a real notes-tool
  -- integration lands, not wired up to anything yet.
  source text not null default 'manual',
  created_by uuid references profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  resolved_at timestamptz
);

create table if not exists project_messages (
  id uuid primary key default gen_random_uuid(),
  item_id uuid not null references project_items(id) on delete cascade,
  author_id uuid references profiles(id),
  body text not null,
  is_directive boolean not null default false,
  created_at timestamptz not null default now()
);

create index if not exists project_messages_item_id_idx
  on project_messages (item_id, created_at);

create index if not exists project_items_status_idx
  on project_items (status, updated_at desc);

alter table project_items enable row level security;
alter table project_messages enable row level security;

-- Any signed-in user can read every item and create new ones or edit
-- existing ones (change status, edit notes/title) — matching "anyone can
-- assign." Deleting an item is kept admin-only as a cleanup tool.
drop policy if exists "project_items_select" on project_items;
create policy "project_items_select" on project_items for select using (
  auth.uid() is not null
);

drop policy if exists "project_items_insert" on project_items;
create policy "project_items_insert" on project_items for insert with check (
  auth.uid() is not null
);

drop policy if exists "project_items_update" on project_items;
create policy "project_items_update" on project_items for update using (
  auth.uid() is not null
) with check (
  auth.uid() is not null
);

drop policy if exists "project_items_delete_admin" on project_items;
create policy "project_items_delete_admin" on project_items for delete using (
  exists (select 1 from profiles p where p.id = auth.uid() and p.role = 'admin')
);

-- Chat is append-only in the UI (no editing someone else's post) — every
-- signed-in user can read the whole thread and post as themselves; only an
-- admin can delete a message.
drop policy if exists "project_messages_select" on project_messages;
create policy "project_messages_select" on project_messages for select using (
  auth.uid() is not null
);

drop policy if exists "project_messages_insert" on project_messages;
create policy "project_messages_insert" on project_messages for insert with check (
  auth.uid() is not null and author_id = auth.uid()
);

drop policy if exists "project_messages_delete_admin" on project_messages;
create policy "project_messages_delete_admin" on project_messages for delete using (
  exists (select 1 from profiles p where p.id = auth.uid() and p.role = 'admin')
);

-- Keep updated_at current, and stamp/clear resolved_at as status flips.
create or replace function project_items_set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  if new.status = 'resolved' and old.status is distinct from 'resolved' then
    new.resolved_at = now();
  elsif new.status = 'open' and old.status is distinct from 'open' then
    new.resolved_at = null;
  end if;
  return new;
end;
$$;

drop trigger if exists project_items_updated_at on project_items;
create trigger project_items_updated_at
before update on project_items
for each row execute function project_items_set_updated_at();

-- Realtime, same as the rest of the app — the item list and an open
-- item's chat thread update live for everyone viewing Projects.
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'project_items'
  ) then
    alter publication supabase_realtime add table project_items;
  end if;

  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'project_messages'
  ) then
    alter publication supabase_realtime add table project_messages;
  end if;
end $$;
