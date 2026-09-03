-- Tasks (formerly "Projects") — the company-wide action/directive tracker.
-- Run this once in Supabase's SQL Editor, before the matching code deploy.
--
-- SUPERSEDES sql/projects.sql. If you already ran that file, this migration
-- drops those tables and rebuilds under the new "task_*" names with the
-- real feature set (categories, due dates, activity log). There is no real
-- data to preserve — the earlier Projects tables were only ever open in
-- preview, never used — so this is a clean drop + recreate, not an
-- in-place alter. If you never ran sql/projects.sql, the drops below are
-- harmless no-ops and this just creates everything fresh.
--
-- Structure, matching the approved preview:
--   task_categories     — Sales / Operations / Marketing / Admin / Others,
--                          seeded below; more can be added from the UI.
--   task_items          — one row per tracked action/directive.
--   task_item_assignees — which users are on an item (shown as avatars).
--   task_messages        — the chat thread under an item (a message tagged
--                          is_directive = true renders as a "Directive").
--   task_item_activity  — auto-logged timeline per item (created, due date
--                          changed, directive posted, reply posted,
--                          resolved/reopened) — written by the app on each
--                          action, not by a database trigger, so it can
--                          record who did it in plain language.
--
-- Deliberately NOT part of the Team Access / user_section_access system
-- that gates every other feature in this app. Per Chad: "anyone can
-- assign... gives leadership the ability to see everything currently
-- happening inside the company." Every signed-in user can read, create,
-- and update categories/items/messages — there's no per-section grant
-- here. Deleting a category or item is also left open to everyone
-- (matching the preview, where the delete button had no role check) —
-- flag it if that should actually be admin-only.

create extension if not exists pgcrypto;

drop table if exists project_messages cascade;
drop table if exists project_items cascade;
drop function if exists project_items_set_updated_at() cascade;

drop table if exists task_item_activity cascade;
drop table if exists task_messages cascade;
drop table if exists task_item_assignees cascade;
drop table if exists task_items cascade;
drop table if exists task_categories cascade;
drop function if exists task_items_set_updated_at() cascade;

create table task_categories (
  id uuid primary key default gen_random_uuid(),
  key text not null unique,
  name text not null,
  color text,
  sort_order integer not null default 0,
  created_by uuid references profiles(id),
  created_at timestamptz not null default now()
);

create table task_items (
  id uuid primary key default gen_random_uuid(),
  category_id uuid references task_categories(id) on delete set null,
  title text not null,
  notes text,
  status text not null default 'open' check (status in ('open', 'resolved')),
  -- 'manual' is the only source wired up today. 'ai_import' is reserved for
  -- the "Pull action items from today's notes" button, which is visible in
  -- the UI but not hooked up to a real notes tool yet.
  source text not null default 'manual',
  due_date date,
  created_by uuid references profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  resolved_at timestamptz
);

create table task_item_assignees (
  item_id uuid not null references task_items(id) on delete cascade,
  user_id uuid not null references profiles(id) on delete cascade,
  added_at timestamptz not null default now(),
  primary key (item_id, user_id)
);

create table task_messages (
  id uuid primary key default gen_random_uuid(),
  item_id uuid not null references task_items(id) on delete cascade,
  author_id uuid references profiles(id),
  body text not null,
  is_directive boolean not null default false,
  created_at timestamptz not null default now()
);

create table task_item_activity (
  id uuid primary key default gen_random_uuid(),
  item_id uuid not null references task_items(id) on delete cascade,
  actor_id uuid references profiles(id),
  -- One of: created, due_date_set, due_date_cleared, directive_posted,
  -- reply_posted, resolved, reopened, category_changed.
  action text not null,
  -- Freeform display text (e.g. "Due date set to Sep 12") so the Activity
  -- Log can render without extra joins/formatting on read.
  detail text,
  created_at timestamptz not null default now()
);

create index task_items_category_status_idx on task_items (category_id, status, updated_at desc);
create index task_items_due_date_idx on task_items (due_date) where due_date is not null;
create index task_messages_item_id_idx on task_messages (item_id, created_at);
create index task_item_activity_item_id_idx on task_item_activity (item_id, created_at);

alter table task_categories enable row level security;
alter table task_items enable row level security;
alter table task_item_assignees enable row level security;
alter table task_messages enable row level security;
alter table task_item_activity enable row level security;

create policy "task_categories_select" on task_categories for select using (auth.uid() is not null);
create policy "task_categories_insert" on task_categories for insert with check (auth.uid() is not null);
create policy "task_categories_update" on task_categories for update using (auth.uid() is not null) with check (auth.uid() is not null);
create policy "task_categories_delete" on task_categories for delete using (auth.uid() is not null);

create policy "task_items_select" on task_items for select using (auth.uid() is not null);
create policy "task_items_insert" on task_items for insert with check (auth.uid() is not null);
create policy "task_items_update" on task_items for update using (auth.uid() is not null) with check (auth.uid() is not null);
create policy "task_items_delete" on task_items for delete using (auth.uid() is not null);

create policy "task_item_assignees_select" on task_item_assignees for select using (auth.uid() is not null);
create policy "task_item_assignees_insert" on task_item_assignees for insert with check (auth.uid() is not null);
create policy "task_item_assignees_delete" on task_item_assignees for delete using (auth.uid() is not null);

create policy "task_messages_select" on task_messages for select using (auth.uid() is not null);
create policy "task_messages_insert" on task_messages for insert with check (auth.uid() is not null and author_id = auth.uid());

create policy "task_item_activity_select" on task_item_activity for select using (auth.uid() is not null);
create policy "task_item_activity_insert" on task_item_activity for insert with check (auth.uid() is not null);

-- Keep updated_at current, and stamp/clear resolved_at as status flips.
create function task_items_set_updated_at()
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

create trigger task_items_updated_at
before update on task_items
for each row execute function task_items_set_updated_at();

-- Seed the five categories shown in the approved preview. Idempotent via
-- the unique key.
insert into task_categories (key, name, color, sort_order) values
  ('sales', 'Sales', '#6ABC46', 0),
  ('operations', 'Operations', '#4a9fd9', 1),
  ('marketing', 'Marketing', '#d99a3d', 2),
  ('admin', 'Admin', '#c96ad4', 3),
  ('others', 'Others', '#8a8a86', 4)
on conflict (key) do nothing;

-- Realtime, same as the rest of the app.
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'task_categories'
  ) then
    alter publication supabase_realtime add table task_categories;
  end if;
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'task_items'
  ) then
    alter publication supabase_realtime add table task_items;
  end if;
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'task_item_assignees'
  ) then
    alter publication supabase_realtime add table task_item_assignees;
  end if;
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'task_messages'
  ) then
    alter publication supabase_realtime add table task_messages;
  end if;
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'task_item_activity'
  ) then
    alter publication supabase_realtime add table task_item_activity;
  end if;
end $$;
