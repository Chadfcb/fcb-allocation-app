-- Email Studio — Ernie inside the designer (added 2026-10-30, per Chad:
-- "we need to do ernie and canva now" … "execute"). See
-- claude/email-designer-plan.md.
--
-- Run this ONCE in Supabase's SQL Editor BEFORE pushing the code.
-- Safe to run more than once.
--
-- One row per thing Eddie asks Ernie to make in Email Studio (a new image,
-- an edited image, or an animation). Used for:
--   * the monthly safety cap (100 images + 10 animations, set in the app),
--   * the "this month" usage counter in the Ernie panel,
--   * picking up animations that are still rendering if the page is closed.
-- Finished images/videos land in the Creative Library (creative_assets,
-- source = 'ernie').
create table if not exists public.creative_ernie_jobs (
  id uuid primary key default gen_random_uuid(),
  kind text not null check (kind in ('create', 'edit', 'animate')),
  prompt text not null,
  source_asset_id uuid references public.creative_assets(id) on delete set null,
  status text not null default 'pending' check (status in ('pending', 'done', 'error')),
  operation_name text,
  settings jsonb not null default '{}'::jsonb,
  result_asset_id uuid references public.creative_assets(id) on delete set null,
  error text,
  cost_estimate numeric(8, 3) not null default 0,
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists creative_ernie_jobs_created_idx on public.creative_ernie_jobs (created_at desc);
create index if not exists creative_ernie_jobs_pending_idx on public.creative_ernie_jobs (status) where status = 'pending';

alter table public.creative_ernie_jobs enable row level security;

-- Readable by people with Email Studio; only the server writes (so nobody can
-- get around the monthly cap).
drop policy if exists "creative_ernie_jobs_select" on public.creative_ernie_jobs;
create policy "creative_ernie_jobs_select" on public.creative_ernie_jobs for select
  using (public.has_section(auth.uid(), 'email_studio'));
