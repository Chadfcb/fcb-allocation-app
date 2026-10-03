-- Snapshot runs for Admin → Ekos Sync — added 2026-10-03.
--
-- "Run now + snapshots" saves what the hidden browser saw at every step of
-- one run (a screenshot + the page's text, inner frames, tables and the
-- Ekos data requests it made), so a failing step can be diagnosed in one
-- go instead of one guess per push. Normal runs save nothing here.
--
-- sync_snapshots: one row per step. Screenshots live in the private storage
-- bucket "sync-snapshots". Admins can read both; only the app's server
-- (service role) writes.
--
-- Run this in Supabase's SQL Editor BEFORE pushing the code. Idempotent —
-- safe to run more than once.

create table if not exists public.sync_snapshots (
  id uuid primary key default gen_random_uuid(),
  run_group uuid not null,
  step int not null,
  label text not null,
  details jsonb not null default '{}'::jsonb,
  image_path text,
  created_at timestamptz not null default now()
);

create index if not exists sync_snapshots_group_idx on public.sync_snapshots (run_group, step);

alter table public.sync_snapshots enable row level security;

drop policy if exists "sync_snapshots_select_admin" on public.sync_snapshots;
create policy "sync_snapshots_select_admin" on public.sync_snapshots
  for select using (exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'admin'));

insert into storage.buckets (id, name, public)
values ('sync-snapshots', 'sync-snapshots', false)
on conflict (id) do nothing;

-- Check: should show the new bucket (private).
select id, public from storage.buckets where id = 'sync-snapshots';
