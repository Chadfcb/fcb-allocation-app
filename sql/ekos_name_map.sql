-- Ekos name lists (Admin → Ekos Sync) — Automatic Syncs Phase 2, added 2026-10-03.
-- Plan: claude/ekos-auto-sync-plan.md. Rules: claude/ekos-sync-reference.md.
--
-- ekos_name_map: how each name Ekos shows maps to the app.
--   kind 'distributor' → Ekos "Distributor" column  → a Core distributor's app name
--   kind 'item'        → Ekos "Item" column          → an app product's name
--   skip = true        → Ekos shows it, but the sync ignores it on purpose
--                        (e.g. Saccani, Illa Vanilla)
--   app_name empty AND skip = false → "Needs a decision": the automatic sync
--                        saw a new Ekos name it doesn't know. It is NOT
--                        synced (never guessed) and Chad picks the match or
--                        Skip on Admin → Ekos Sync.
--
-- Seeded with the exact lists from claude/ekos-sync-reference.md (read from
-- Ekos 2026-10-02). "Mussetter Distributing Inc" → Mussetter confirmed by
-- Chad 2026-10-03. Superior and Coast are not seeded on purpose — their
-- Ekos names aren't known yet; they'll show up as "Needs a decision" the
-- first time Ekos lists them, so Chad confirms the name.
--
-- Also: automatic runs have no signed-in person, so the "who synced it"
-- columns must allow empty.
--
-- Run this in Supabase's SQL Editor BEFORE pushing the code. Idempotent —
-- safe to run more than once (it never overwrites a mapping already saved).

create table if not exists public.ekos_name_map (
  kind text not null check (kind in ('distributor', 'item')),
  ekos_name text not null,
  app_name text,
  skip boolean not null default false,
  first_seen_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users(id) on delete set null,
  primary key (kind, ekos_name)
);

insert into public.ekos_name_map (kind, ekos_name, app_name, skip) values
  ('distributor', 'Matagrano Inc.', 'Matagrano', false),
  ('distributor', 'Markstein Sales Company', 'Markstein', false),
  ('distributor', 'Valley Wide Beverage Co', 'Valley Wide', false),
  ('distributor', 'Guardian Distributors of Los Angeles', 'Guardian', false),
  ('distributor', 'Mussetter Distributing Inc', 'Mussetter', false),
  ('distributor', 'Saccani Distributing Co', null, true),

  ('item', 'Big Daddy 19.2 12PK', 'Big Daddy IPA (Case - 12x - 19.2oz - Can)', false),
  ('item', 'Big Daddy IPA 12oz 6 pack', 'Big Daddy IPA (Case 4x6 - 12 oz Cans)', false),
  ('item', 'Big Daddy IPA 1/6 Keg', 'Big Daddy IPA (Keg - 1/6 bbl)', false),
  ('item', 'Big Daddy IPA 1/2 Keg', 'Big Daddy IPA (Keg - 1/2 bbl)', false),
  ('item', 'Captain Save A Hop HAZY IPA 19.2', 'Capt. Hazy (Case - 12x - 19.2oz - Can)', false),
  ('item', 'Captain Save A Hop HAZY IPA 16 oz', 'Capt. Hazy (Case - 6x4 - 16oz - Can)', false),
  ('item', 'Captain Save A Hop HAZY IPA 1/6 bbl', 'Capt. Hazy (Keg - 1/6 bbl)', false),
  ('item', 'Captain Save A Hop HAZY IPA 1/2 bbl', 'Capt. Hazy (Keg - 1/2 bbl)', false),
  ('item', 'Captain Save A Hop West Coast IPA 19.2', 'Capt. WC (Case - 12x - 19.2oz - Can)', false),
  ('item', 'Captain Save A Hop WC IPA 6/4/16oz', 'Capt. WC IPA (Case - 6x4 - 16oz - Can)', false),
  ('item', 'Captain Save A Hop WC IPA 1/6 Keg', 'Capt. WC (Keg - 1/6 bbl)', false),
  ('item', 'Captain Save A Hop WC IPA 1/2 Keg', 'Capt. WC (Keg - 1/2 bbl)', false),
  ('item', 'Juicy 12/19.2 oz', 'Juicy NE IPA (Case - 12x - 19.2oz - Can)', false),
  ('item', 'Juicy 6/4/16oz', 'Juicy NE IPA (Case - 6x4 - 16oz - Can)', false),
  ('item', 'Juicy 1/6 Keg', 'Juicy NE IPA (Keg - 1/6 bbl)', false),
  ('item', 'Juicy 1/2 Keg', 'Juicy NE IPA (Keg - 1/2 bbl)', false),
  ('item', 'Mango Bomb 12/19.2 oz', 'Mango Bomb NE IIPA Series (Case - 12x - 19.2oz - Can)', false),
  ('item', 'Mango Bomb 6/4/16oz', 'Mango Bomb NE IIPA Series (Case - 6x4 - 16oz - Can)', false),
  ('item', 'Mystic Haze 19.2 12PK', 'Mystic Haze IPA (Case - 12x - 19.2oz - Can)', false),
  ('item', 'Mystic Haze IPA 12oz 6pack case', 'Mystic Haze IPA (Case 4x6 - 12 oz Cans)', false),
  ('item', 'Mystic Haze IPA 1/6 bbl', 'Mystic Haze (Keg - 1/6 bbl)(JUICY)', false),
  ('item', 'Mystic Haze IPA 1/2 bbl', 'Mystic Haze (Keg - 1/2 bbl)', false),
  ('item', 'Nectarine Pie 6/4/16oz', 'Nectarine Pie of the Tiger (Case - 6x4 - 16oz - Can)', false),
  ('item', 'Nectarine Pie of the Tiger 6/4/16oz', 'Nectarine Pie of the Tiger (Case - 6x4 - 16oz - Can)', false),
  ('item', 'Nectarine Pie Of The Tiger 1/6 Keg', 'Nectarine Pie of the Tiger (Keg - 1/6 bbl)', false),
  ('item', 'Nectarine Pie of the Tiger 1/2 Keg', 'Nectarine Pie of the Tiger (Keg - 1/2 bbl)', false),
  ('item', 'Peachy  Vibes 19.2 oz', 'Peachy Vibes (Case - 12x - 19.2oz - Can)', false),
  ('item', 'Peachy Vibes 12oz', 'Peachy Vibes (Case - 4x6 - 12oz - Can)', false),
  ('item', 'Peachy Vibes 1/6 bbl', 'Peachy Vibes (Keg - 1/6 bbl)', false),
  ('item', 'Peachy Vibes 1/2 bbl', 'Peachy Vibes (Keg - 1/2 bbl)', false),
  ('item', 'Prohibition Ale 4/6/12oz Cans', 'Prohibition (Case 4x6 - 12 oz Cans)', false),
  ('item', 'Prohibition Red Ale 1/6 bbl', 'Prohibition Red Ale (Keg 1/6bbl)', false),
  ('item', 'Prohibition Red Ale 1/2 bbl', 'Prohibition Red Ale (Keg 1/2 bbl)', false),
  ('item', 'The Pitchfork 6/4/16oz', 'The Pitchfork - Pear Cider (Case 6x4 - 16 oz Cans)', false),
  ('item', 'The The Pitchfork Keg 1/6 bbl', 'The Pitchfork - Pear Cider (Keg - 1/6 bbl)', false),
  ('item', 'Apricot Pie of the Tiger 6/4/16oz', null, true),
  ('item', 'Town & City 6/4/16oz Can', null, true),
  ('item', 'Illa Vanilla 6/4/16oz', null, true)
on conflict (kind, ekos_name) do nothing;

alter table public.ekos_name_map enable row level security;

drop policy if exists "ekos_name_map_admin_all" on public.ekos_name_map;
create policy "ekos_name_map_admin_all" on public.ekos_name_map
  for all using (exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'admin'))
  with check (exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'admin'));

-- Automatic runs have no signed-in person → allow empty "who" columns.
do $$
begin
  if exists (select 1 from information_schema.columns
             where table_schema = 'public' and table_name = 'purchase_orders' and column_name = 'synced_by') then
    execute 'alter table public.purchase_orders alter column synced_by drop not null';
  end if;
  if exists (select 1 from information_schema.columns
             where table_schema = 'public' and table_name = 'distributor_inventory' and column_name = 'updated_by') then
    execute 'alter table public.distributor_inventory alter column updated_by drop not null';
  end if;
end $$;

-- Check: 6 distributor rows (5 matched + Saccani skipped), 38 item rows (35 matched + 3 skipped).
select kind, count(*) as total, count(*) filter (where skip) as skipped
from public.ekos_name_map group by kind order by kind;
