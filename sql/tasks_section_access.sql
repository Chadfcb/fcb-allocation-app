-- Adds Tasks to the per-user, per-section access system (sql/user_section_
-- access.sql) — follow-up to sql/tasks.sql, which originally built Tasks as
-- deliberately open to every signed-in user. Per Chad, 2026-09-04: any new
-- sidebar section needs a real Users > Edit access toggle going forward,
-- and Tasks should follow that rule too. Run this once in Supabase's SQL
-- Editor, before the matching code deploy. Idempotent — safe to re-run.
--
-- What this does NOT change: anyone who has the "tasks" section still gets
-- full, unrestricted use of Tasks itself — create, assign, post directives/
-- replies, resolve/reopen, and delete categories/items, exactly as today.
-- This only gates who can get into Tasks at all, same as every other
-- section-gated page (Purchase Orders, Events Calendar, etc.).
--
-- Backfill: Tasks has been open to everyone since it shipped, so every
-- existing Basic user is granted the "tasks" section here explicitly —
-- nobody loses access the moment this ships. New Basic users going forward
-- start unchecked, same as any other section, until an admin grants it from
-- Users > Edit.

insert into user_section_access (user_id, section_key)
select id, 'tasks' from profiles where role = 'basic'
on conflict do nothing;

drop policy if exists "task_categories_select" on task_categories;
drop policy if exists "task_categories_insert" on task_categories;
drop policy if exists "task_categories_update" on task_categories;
drop policy if exists "task_categories_delete" on task_categories;
create policy "task_categories_section" on task_categories for all using (
  has_section(auth.uid(), 'tasks')
);

drop policy if exists "task_items_select" on task_items;
drop policy if exists "task_items_insert" on task_items;
drop policy if exists "task_items_update" on task_items;
drop policy if exists "task_items_delete" on task_items;
create policy "task_items_section" on task_items for all using (
  has_section(auth.uid(), 'tasks')
);

drop policy if exists "task_item_assignees_select" on task_item_assignees;
drop policy if exists "task_item_assignees_insert" on task_item_assignees;
drop policy if exists "task_item_assignees_delete" on task_item_assignees;
create policy "task_item_assignees_section" on task_item_assignees for all using (
  has_section(auth.uid(), 'tasks')
);

-- task_messages keeps its own insert check (author_id = auth.uid()) on top
-- of the section grant — unchanged behavior, just now also gated.
drop policy if exists "task_messages_select" on task_messages;
drop policy if exists "task_messages_insert" on task_messages;
create policy "task_messages_select_section" on task_messages for select using (
  has_section(auth.uid(), 'tasks')
);
create policy "task_messages_insert_section" on task_messages for insert with check (
  has_section(auth.uid(), 'tasks') and author_id = auth.uid()
);

drop policy if exists "task_item_activity_select" on task_item_activity;
drop policy if exists "task_item_activity_insert" on task_item_activity;
create policy "task_item_activity_section" on task_item_activity for all using (
  has_section(auth.uid(), 'tasks')
);
