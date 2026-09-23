-- Per-person Ernie chat appearance (Customize button on the Ernie page).
-- Added 2026-09-23. Safe to run more than once.
--
-- One row per person: their chosen theme / colors / font / text size for the
-- Ernie page and Project chats only (see lib/ernie/appearance.ts). Nobody
-- can see or change anyone else's row.

create table if not exists public.ernie_user_preferences (
  user_id uuid primary key references auth.users (id) on delete cascade,
  appearance jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

alter table public.ernie_user_preferences enable row level security;

drop policy if exists "ernie_user_preferences_select_own" on public.ernie_user_preferences;
create policy "ernie_user_preferences_select_own" on public.ernie_user_preferences
  for select using (user_id = auth.uid());

drop policy if exists "ernie_user_preferences_insert_own" on public.ernie_user_preferences;
create policy "ernie_user_preferences_insert_own" on public.ernie_user_preferences
  for insert with check (user_id = auth.uid());

drop policy if exists "ernie_user_preferences_update_own" on public.ernie_user_preferences;
create policy "ernie_user_preferences_update_own" on public.ernie_user_preferences
  for update using (user_id = auth.uid()) with check (user_id = auth.uid());
