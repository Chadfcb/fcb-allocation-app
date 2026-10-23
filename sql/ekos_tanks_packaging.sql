-- Tanks page Status section (2026-10-23, Chad): "Ready for package / being
-- packaged" block. The Ekos tank sync now marks a tank as being packaged when
-- its batch has a "Package: …" task that's In-Progress or Completed and the
-- tank still has beer in it (lib/syncs/ekosTanks.ts).
--
-- Run this in Supabase's SQL Editor BEFORE pushing the code. Idempotent —
-- safe to run more than once. No new table (so no new grants needed).

alter table public.ekos_tanks add column if not exists packaging boolean not null default false;

comment on column public.ekos_tanks.packaging is
  'True when the tank still has beer and its batch has a "Package: …" task In-Progress or Completed in Ekos — i.e. the tank is being packaged. Shown in the Tanks page Status section.';

-- check
select 'ekos_tanks.packaging column' as what, count(*) from information_schema.columns
where table_schema = 'public' and table_name = 'ekos_tanks' and column_name = 'packaging';
