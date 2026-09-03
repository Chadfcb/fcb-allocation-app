-- Adds a Subcategory tier to Tasks, between Category and the task list:
-- Category (Sales/Operations/Marketing/Admin/Others) -> Subcategory (e.g.
-- under Operations: PO, Fermentation, Brews — whatever you add) ->
-- Tasks. Run this once in Supabase's SQL Editor, after sql/tasks.sql.
--
-- Idempotent — safe to re-run. If task_items still has its old
-- category_id column (from before this migration), this creates a
-- "General" subcategory under each category that has tasks, backfills
-- those tasks onto it, then drops category_id — no tasks are lost, they
-- just land in a starter subcategory you can rename or split up. If this
-- has already been run, the migration block below is a no-op.

create extension if not exists pgcrypto;

create table if not exists task_subcategories (
  id uuid primary key default gen_random_uuid(),
  category_id uuid not null references task_categories(id) on delete cascade,
  key text not null,
  name text not null,
  sort_order integer not null default 0,
  created_by uuid references profiles(id),
  created_at timestamptz not null default now(),
  unique (category_id, key)
);

alter table task_subcategories enable row level security;

drop policy if exists "task_subcategories_select" on task_subcategories;
create policy "task_subcategories_select" on task_subcategories for select using (auth.uid() is not null);

drop policy if exists "task_subcategories_insert" on task_subcategories;
create policy "task_subcategories_insert" on task_subcategories for insert with check (auth.uid() is not null);

drop policy if exists "task_subcategories_update" on task_subcategories;
create policy "task_subcategories_update" on task_subcategories for update using (auth.uid() is not null) with check (auth.uid() is not null);

drop policy if exists "task_subcategories_delete" on task_subcategories;
create policy "task_subcategories_delete" on task_subcategories for delete using (auth.uid() is not null);

create index if not exists task_subcategories_category_idx on task_subcategories (category_id, sort_order);

-- Add the new column tasks will actually hang off of.
alter table task_items add column if not exists subcategory_id uuid references task_subcategories(id) on delete set null;

-- One-time backfill + cleanup of the old category_id column, only runs if
-- that column still exists (i.e. sql/tasks.sql's original shape is still
-- live). Safe to re-run — the second time through, the column is already
-- gone and this whole block is skipped.
do $$
declare
  cat record;
  sub_id uuid;
begin
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'task_items' and column_name = 'category_id'
  ) then
    for cat in select distinct category_id from task_items where category_id is not null loop
      insert into task_subcategories (category_id, key, name, sort_order)
      values (cat.category_id, 'general', 'General', 0)
      on conflict (category_id, key) do nothing;

      select id into sub_id from task_subcategories
      where category_id = cat.category_id and key = 'general';

      update task_items
      set subcategory_id = sub_id
      where category_id = cat.category_id and subcategory_id is null;
    end loop;

    alter table task_items drop column category_id;
  end if;
end $$;

create index if not exists task_items_subcategory_status_idx on task_items (subcategory_id, status, updated_at desc);

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'task_subcategories'
  ) then
    alter publication supabase_realtime add table task_subcategories;
  end if;
end $$;
