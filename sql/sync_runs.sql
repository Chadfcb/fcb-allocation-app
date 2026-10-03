-- Automatic Syncs (Admin → Ekos Sync) — Phase 1, added 2026-10-03.
-- Plan: claude/ekos-auto-sync-plan.md.
--
-- sync_sources: one row per data source the Automatic Syncs job can run
--   (Ekos Open Purchase Orders and Ekos Distributor Inventory today; more
--   later). `enabled` is the on/off switch on Admin → Ekos Sync. New sources
--   start OFF.
-- sync_runs: one row per sync run — automatic, "Run now", or a pasted
--   "Sync from Ekos" — so Admin → Ekos Sync can show what happened, what was
--   synced, and anything skipped/unmatched.
--
-- Admins can read both and flip the on/off switch; rows in sync_runs are
-- written by the app's server only (service role), never from the browser.
--
-- Run this in Supabase's SQL Editor BEFORE pushing the code. Idempotent —
-- safe to run more than once.

create table if not exists public.sync_sources (
  key text primary key,
  label text not null,
  enabled boolean not null default false,
  sort_order int not null default 0,
  updated_at timestamptz not null default now()
);

insert into public.sync_sources (key, label, enabled, sort_order) values
  ('ekos_purchase_orders', 'Ekos — Open Purchase Orders', false, 1),
  ('ekos_distributor_inventory', 'Ekos — Distributor Inventory', false, 2)
on conflict (key) do nothing;

create table if not exists public.sync_runs (
  id uuid primary key default gen_random_uuid(),
  source text not null,
  trigger text not null check (trigger in ('scheduled', 'run_now', 'paste')),
  status text not null check (status in ('ok', 'issues', 'failed', 'skipped')),
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  synced_count int,
  issues jsonb not null default '[]'::jsonb,
  summary text,
  run_by uuid references auth.users(id) on delete set null
);

create index if not exists sync_runs_started_at_idx on public.sync_runs (started_at desc);

alter table public.sync_sources enable row level security;
alter table public.sync_runs enable row level security;

drop policy if exists "sync_sources_select_admin" on public.sync_sources;
create policy "sync_sources_select_admin" on public.sync_sources
  for select using (exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'admin'));

drop policy if exists "sync_sources_update_admin" on public.sync_sources;
create policy "sync_sources_update_admin" on public.sync_sources
  for update using (exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'admin'))
  with check (exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'admin'));

drop policy if exists "sync_runs_select_admin" on public.sync_runs;
create policy "sync_runs_select_admin" on public.sync_runs
  for select using (exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'admin'));

-- No insert/update/delete policy on sync_runs: only the app's server
-- (service role, which skips these rules) writes run records.

-- Check: should list the two Ekos sources, both switched off.
select key, label, enabled from public.sync_sources order by sort_order;
