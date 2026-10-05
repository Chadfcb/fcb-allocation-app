-- Tanks → "See Batch Details" popup (added 2026-10-05). Plan:
-- claude/batch-details-plan.md (project doc).
--
-- ekos_tanks.batch_details: filled by the automatic Ekos sync ("Ekos —
--   Tanks") for each full tank: batch number, yield (bbl brewed), ABV, and
--   the batch's ingredient costs from Ekos's "Batch - Bill of Materials"
--   report (Chad's choice — real costs, even when a vendor changes), sorted
--   into Grain Bill / Boil Kettle + Whirlpool Hops / Dry Hops / Fruit
--   Additions / Yeast.
--
-- ekos_batch_item_kinds: which button each Ekos item goes under. The sync
--   adds every item name it sees; names that match the starting rules get
--   their button automatically (malts → Grain Bill, "… Hops" → hops, yeasts
--   and cultures → Yeast, fruit / vanilla → Fruit Additions), anything else
--   (packaging, lactic acid, finings…) is "Leave out". Any name can be
--   changed on Admin → Ekos Sync → "Ekos batch items". Whether a hop counts
--   as Boil Kettle / Whirlpool or Dry Hop comes from the Ekos task that used
--   it (a Turn's Kettle / Whirlpool step vs. a later dry-hop task).
--
-- Run this in Supabase's SQL Editor BEFORE pushing the code. Idempotent —
-- safe to run more than once.

alter table public.ekos_tanks add column if not exists batch_details jsonb;

create table if not exists public.ekos_batch_item_kinds (
  item_title text primary key,
  kind text not null default 'none' check (kind in ('grain', 'hops', 'fruit', 'yeast', 'none')),
  first_seen_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users(id) on delete set null
);

alter table public.ekos_batch_item_kinds enable row level security;

drop policy if exists "ekos_batch_item_kinds_admin_all" on public.ekos_batch_item_kinds;
create policy "ekos_batch_item_kinds_admin_all" on public.ekos_batch_item_kinds
  for all using (exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'admin'))
  with check (exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'admin'));

-- Check: should show the new column and the new (empty until the next sync) list.
select 'ekos_tanks.batch_details column' as what, count(*) from information_schema.columns
  where table_schema = 'public' and table_name = 'ekos_tanks' and column_name = 'batch_details'
union all select 'ekos_batch_item_kinds rows', count(*) from public.ekos_batch_item_kinds;
