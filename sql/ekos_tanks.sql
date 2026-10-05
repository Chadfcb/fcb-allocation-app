-- Ekos Tank Sync (Tanks page) — added 2026-10-05. Plan: claude/tank-sync-plan.md.
--
-- ekos_tanks: one row per spot on Ekos's tank map (Home → Facility View),
--   refreshed by the automatic Ekos sync ("Ekos — Tanks" on Admin → Ekos
--   Sync). What's in each tank, how much, the batch's product + start date,
--   its stage (worked out from the batch's completed tasks), the newest
--   Fermentation Log temperature, whether Ekos shows it overdue (red dashed
--   border), and the batch's tasks still left. The Tanks page reads it.
--
-- ekos_task_stage_map: which Ekos task names move a tank to a new stage
--   (Chad confirmed 2026-10-05):
--     dump_yeast  — "Dump Cone"                       → yeast gone from the cone
--     dry_hop     — "DRYHOP" / "Dry hop"              → Dry Hopping
--     cold_crash  — "Hard Crash" / "Cold Crash"       → Cold Crashing
--     carbonating — "Carb" / "Carbonate"              → Carbonating
--     ready       — "READY TO PACKAGE" / "READY FOR PACKAGING" / "Transition to … Brite"
--                                                     → Ready For Packaging
--     none        — not a stage task (Fermentation Log, Add Zinc, …)
--   stage empty = "Needs a decision" on Admin → Ekos Sync (a task name the
--   sync saw that matched none of the above). It's treated as "no stage"
--   until Chad picks one — never guessed.
--
-- Also adds the "Ekos — Tanks" source to the automatic sync, switched ON.
--
-- Run this in Supabase's SQL Editor BEFORE pushing the code. Idempotent —
-- safe to run more than once.

create table if not exists public.ekos_tanks (
  tank_name text primary key,
  volume_bbl numeric not null default 0,
  product_code text,
  batch_title text,
  product_name text,
  color text,
  start_date date,
  stage text,
  yeast_in_cone boolean not null default false,
  dry_hop boolean not null default false,
  temp_f numeric,
  temp_at timestamptz,
  overdue boolean not null default false,
  tasks_left jsonb not null default '[]'::jsonb,
  synced_at timestamptz not null default now()
);

-- Written and read by the app's server only (the Tanks page checks the
-- person's Tanks access first), never straight from the browser.
alter table public.ekos_tanks enable row level security;

create table if not exists public.ekos_task_stage_map (
  task_title text primary key,
  stage text check (stage in ('dump_yeast', 'dry_hop', 'cold_crash', 'carbonating', 'ready', 'none')),
  first_seen_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users(id) on delete set null
);

alter table public.ekos_task_stage_map enable row level security;

drop policy if exists "ekos_task_stage_map_admin_all" on public.ekos_task_stage_map;
create policy "ekos_task_stage_map_admin_all" on public.ekos_task_stage_map
  for all using (exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'admin'))
  with check (exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'admin'));

insert into public.sync_sources (key, label, enabled, sort_order) values
  ('ekos_tanks', 'Ekos — Tanks', true, 3)
on conflict (key) do nothing;

-- Check: should list the three tables/rows below.
select 'ekos_tanks' as what, count(*) from public.ekos_tanks
union all select 'ekos_task_stage_map', count(*) from public.ekos_task_stage_map
union all select 'sync source ekos_tanks', count(*) from public.sync_sources where key = 'ekos_tanks';
