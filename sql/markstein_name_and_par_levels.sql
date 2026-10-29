-- Markstein name fix + Build Orders par levels from Adam's sheet (2026-10-29).
--
-- Why "Markstein C": on 9/14 a new Markstein row was made and the original
-- "Markstein" row was switched off. On 9/23 it was renamed toward
-- "Markstein", but distributor names must be unique and the old switched-off
-- row still holds "Markstein", so it stopped at "Markstein C". Since then the
-- Ekos sync (Core only, matched by the name "Markstein") has kept writing
-- Markstein's inventory into the OLD switched-off row, so Build Orders showed
-- Markstein C with no on hand and no par levels.
--
-- Par levels: they were loaded 8/26 from "Adam Reccomended Par Levels 1.xlsx"
-- (project doc claude/adam-par-levels.md). Valley Wide's went onto the old
-- "Valleywide" row and Markstein's onto the old "Markstein" row, both
-- switched off since, so neither shows on Build Orders. Saccani's column was
-- loaded as Mussetter (kept that way).
--
-- What this does:
--   1. Old switched-off "Markstein" -> "Markstein (old)", not Core, not
--      tracked for inventory. Its history stays on it.
--   2. "Markstein C" -> "Markstein", Core, column order 2 (where the original
--      sat). Its allocations/POs/prices since 9/14 stay on it.
--   3. Every Ekos inventory count saved on the old row moves to the renamed
--      row (skipped where the renamed row already has that week/product).
--   4. Valley Wide gets column order 3 (the old "Valleywide" spot).
--   5. Par levels for Matagrano, Valley Wide, Mussetter (sheet's Saccani),
--      Guardian, Markstein, Superior are reset to the sheet exactly, except
--      Matagrano's Big Daddy kegs keep Chad's 9/23 edits (1/2 bbl 82,
--      1/6 bbl 60). Old pars on "Markstein (old)" / "Valleywide" are removed.
--
-- Run in Supabase's SQL Editor (needed: Core can only change here). One
-- transaction; stops with an error and changes nothing if any name or
-- product doesn't match. Safe to run more than once.

begin;

do $$
declare
  v_old uuid;
  v_new uuid;
begin
  select id into v_old from distributors where name = 'Markstein' and active = false;
  select id into v_new from distributors where name = 'Markstein C';

  if v_new is not null then
    if v_old is null then
      raise exception 'Expected a switched-off "Markstein" row next to "Markstein C"';
    end if;

    update distributors
       set name = 'Markstein (old)', is_core_distributor = false, track_inventory = false
     where id = v_old;

    update distributors
       set name = 'Markstein', is_core_distributor = true, active = true,
           track_inventory = true, inventory_sort_order = 2
     where id = v_new;

    insert into distributor_inventory
      (week_id, distributor_id, product_id, on_hand_qty, rate_of_sale, source,
       imported_at, updated_by, updated_at)
    select week_id, v_new, product_id, on_hand_qty, rate_of_sale, source,
           imported_at, updated_by, updated_at
      from distributor_inventory
     where distributor_id = v_old
    on conflict (week_id, distributor_id, product_id) do nothing;

    delete from distributor_inventory where distributor_id = v_old;
  end if;
end $$;

update distributors set inventory_sort_order = 3
 where name = 'Valley Wide' and active = true;

create temporary table adam_par (dist text, product text, par numeric) on commit drop;
insert into adam_par (dist, product, par) values
  ('Matagrano', 'Capt. Hazy (Case - 6x4 - 16oz - Can)', 20),
  ('Valley Wide', 'Capt. Hazy (Case - 6x4 - 16oz - Can)', 20),
  ('Mussetter', 'Capt. Hazy (Case - 6x4 - 16oz - Can)', 30),
  ('Guardian', 'Capt. Hazy (Case - 6x4 - 16oz - Can)', 20),
  ('Markstein', 'Capt. Hazy (Case - 6x4 - 16oz - Can)', 30),
  ('Superior', 'Capt. Hazy (Case - 6x4 - 16oz - Can)', 10),
  ('Mussetter', 'Capt. Hazy (Case - 12x - 19.2oz - Can)', 30),
  ('Guardian', 'Capt. Hazy (Case - 12x - 19.2oz - Can)', 20),
  ('Markstein', 'Capt. Hazy (Case - 12x - 19.2oz - Can)', 20),
  ('Superior', 'Capt. Hazy (Case - 12x - 19.2oz - Can)', 10),
  ('Mussetter', 'Capt. Hazy (Keg - 1/6 bbl)', 10),
  ('Guardian', 'Capt. Hazy (Keg - 1/6 bbl)', 4),
  ('Markstein', 'Capt. Hazy (Keg - 1/6 bbl)', 5),
  ('Superior', 'Capt. Hazy (Keg - 1/6 bbl)', 2),
  ('Mussetter', 'Capt. Hazy (Keg - 1/2 bbl)', 4),
  ('Guardian', 'Capt. Hazy (Keg - 1/2 bbl)', 4),
  ('Markstein', 'Capt. Hazy (Keg - 1/2 bbl)', 4),
  ('Superior', 'Capt. Hazy (Keg - 1/2 bbl)', 2),
  ('Valley Wide', 'Capt. WC IPA (Case - 6x4 - 16oz - Can)', 20),
  ('Mussetter', 'Capt. WC IPA (Case - 6x4 - 16oz - Can)', 30),
  ('Guardian', 'Capt. WC IPA (Case - 6x4 - 16oz - Can)', 20),
  ('Superior', 'Capt. WC IPA (Case - 6x4 - 16oz - Can)', 10),
  ('Valley Wide', 'Capt. WC (Case - 12x - 19.2oz - Can)', 20),
  ('Mussetter', 'Capt. WC (Case - 12x - 19.2oz - Can)', 30),
  ('Guardian', 'Capt. WC (Case - 12x - 19.2oz - Can)', 20),
  ('Superior', 'Capt. WC (Case - 12x - 19.2oz - Can)', 10),
  ('Mussetter', 'Capt. WC (Keg - 1/6 bbl)', 10),
  ('Guardian', 'Capt. WC (Keg - 1/6 bbl)', 4),
  ('Superior', 'Capt. WC (Keg - 1/6 bbl)', 2),
  ('Mussetter', 'Capt. WC (Keg - 1/2 bbl)', 4),
  ('Guardian', 'Capt. WC (Keg - 1/2 bbl)', 4),
  ('Superior', 'Capt. WC (Keg - 1/2 bbl)', 2),
  ('Valley Wide', 'Juicy NE IPA (Case - 6x4 - 16oz - Can)', 40),
  ('Valley Wide', 'Juicy NE IPA (Case - 12x - 19.2oz - Can)', 20),
  ('Valley Wide', 'Juicy NE IPA (Keg - 1/6 bbl)', 20),
  ('Valley Wide', 'Juicy NE IPA (Keg - 1/2 bbl)', 8),
  ('Valley Wide', 'Mango Bomb NE IIPA Series (Case - 6x4 - 16oz - Can)', 20),
  ('Mussetter', 'Mango Bomb NE IIPA Series (Case - 6x4 - 16oz - Can)', 20),
  ('Guardian', 'Mango Bomb NE IIPA Series (Case - 6x4 - 16oz - Can)', 20),
  ('Superior', 'Mango Bomb NE IIPA Series (Case - 6x4 - 16oz - Can)', 10),
  ('Valley Wide', 'Mango Bomb NE IIPA Series (Case - 12x - 19.2oz - Can)', 10),
  ('Mussetter', 'Mango Bomb NE IIPA Series (Case - 12x - 19.2oz - Can)', 20),
  ('Guardian', 'Mango Bomb NE IIPA Series (Case - 12x - 19.2oz - Can)', 20),
  ('Superior', 'Mango Bomb NE IIPA Series (Case - 12x - 19.2oz - Can)', 10),
  ('Matagrano', 'Nectarine Pie of the Tiger (Case - 6x4 - 16oz - Can)', 20),
  ('Valley Wide', 'Nectarine Pie of the Tiger (Case - 6x4 - 16oz - Can)', 20),
  ('Mussetter', 'Nectarine Pie of the Tiger (Case - 6x4 - 16oz - Can)', 30),
  ('Guardian', 'Nectarine Pie of the Tiger (Case - 6x4 - 16oz - Can)', 20),
  ('Markstein', 'Nectarine Pie of the Tiger (Case - 6x4 - 16oz - Can)', 20),
  ('Superior', 'Nectarine Pie of the Tiger (Case - 6x4 - 16oz - Can)', 10),
  ('Matagrano', 'Nectarine Pie of the Tiger (Keg - 1/6 bbl)', 10),
  ('Mussetter', 'Nectarine Pie of the Tiger (Keg - 1/6 bbl)', 10),
  ('Guardian', 'Nectarine Pie of the Tiger (Keg - 1/6 bbl)', 2),
  ('Markstein', 'Nectarine Pie of the Tiger (Keg - 1/6 bbl)', 5),
  ('Superior', 'Nectarine Pie of the Tiger (Keg - 1/6 bbl)', 2),
  ('Mussetter', 'Nectarine Pie of the Tiger (Keg - 1/2 bbl)', 8),
  ('Guardian', 'Nectarine Pie of the Tiger (Keg - 1/2 bbl)', 4),
  ('Superior', 'Nectarine Pie of the Tiger (Keg - 1/2 bbl)', 2),
  ('Matagrano', 'Peachy Vibes (Case - 4x6 - 12oz - Can)', 20),
  ('Valley Wide', 'Peachy Vibes (Case - 4x6 - 12oz - Can)', 40),
  ('Mussetter', 'Peachy Vibes (Case - 4x6 - 12oz - Can)', 40),
  ('Guardian', 'Peachy Vibes (Case - 4x6 - 12oz - Can)', 30),
  ('Superior', 'Peachy Vibes (Case - 4x6 - 12oz - Can)', 20),
  ('Valley Wide', 'Peachy Vibes (Case - 12x - 19.2oz - Can)', 20),
  ('Mussetter', 'Peachy Vibes (Case - 12x - 19.2oz - Can)', 20),
  ('Guardian', 'Peachy Vibes (Case - 12x - 19.2oz - Can)', 20),
  ('Superior', 'Peachy Vibes (Case - 12x - 19.2oz - Can)', 10),
  ('Matagrano', 'Peachy Vibes (Keg - 1/6 bbl)', 10),
  ('Valley Wide', 'Peachy Vibes (Keg - 1/6 bbl)', 8),
  ('Mussetter', 'Peachy Vibes (Keg - 1/6 bbl)', 10),
  ('Guardian', 'Peachy Vibes (Keg - 1/6 bbl)', 5),
  ('Superior', 'Peachy Vibes (Keg - 1/6 bbl)', 2),
  ('Matagrano', 'Peachy Vibes (Keg - 1/2 bbl)', 4),
  ('Valley Wide', 'Peachy Vibes (Keg - 1/2 bbl)', 4),
  ('Mussetter', 'Peachy Vibes (Keg - 1/2 bbl)', 8),
  ('Guardian', 'Peachy Vibes (Keg - 1/2 bbl)', 4),
  ('Superior', 'Peachy Vibes (Keg - 1/2 bbl)', 2),
  ('Matagrano', 'Big Daddy IPA (Case 4x6 - 12 oz Cans)', 50),
  ('Mussetter', 'Big Daddy IPA (Case 4x6 - 12 oz Cans)', 40),
  ('Markstein', 'Big Daddy IPA (Case 4x6 - 12 oz Cans)', 30),
  ('Superior', 'Big Daddy IPA (Case 4x6 - 12 oz Cans)', 20),
  ('Matagrano', 'Big Daddy IPA (Case - 12x - 19.2oz - Can)', 40),
  ('Mussetter', 'Big Daddy IPA (Case - 12x - 19.2oz - Can)', 20),
  ('Markstein', 'Big Daddy IPA (Case - 12x - 19.2oz - Can)', 20),
  ('Superior', 'Big Daddy IPA (Case - 12x - 19.2oz - Can)', 20),
  ('Matagrano', 'Big Daddy IPA (Keg - 1/6 bbl)', 60),
  ('Mussetter', 'Big Daddy IPA (Keg - 1/6 bbl)', 10),
  ('Markstein', 'Big Daddy IPA (Keg - 1/6 bbl)', 5),
  ('Superior', 'Big Daddy IPA (Keg - 1/6 bbl)', 6),
  ('Matagrano', 'Big Daddy IPA (Keg - 1/2 bbl)', 82),
  ('Mussetter', 'Big Daddy IPA (Keg - 1/2 bbl)', 8),
  ('Markstein', 'Big Daddy IPA (Keg - 1/2 bbl)', 4),
  ('Superior', 'Big Daddy IPA (Keg - 1/2 bbl)', 2),
  ('Matagrano', 'Mystic Haze IPA (Case 4x6 - 12 oz Cans)', 20),
  ('Mussetter', 'Mystic Haze IPA (Case 4x6 - 12 oz Cans)', 30),
  ('Superior', 'Mystic Haze IPA (Case 4x6 - 12 oz Cans)', 10),
  ('Matagrano', 'Mystic Haze IPA (Case - 12x - 19.2oz - Can)', 10),
  ('Mussetter', 'Mystic Haze IPA (Case - 12x - 19.2oz - Can)', 20),
  ('Superior', 'Mystic Haze IPA (Case - 12x - 19.2oz - Can)', 10),
  ('Matagrano', 'Mystic Haze (Keg - 1/6 bbl)(JUICY)', 10),
  ('Mussetter', 'Mystic Haze (Keg - 1/6 bbl)(JUICY)', 5),
  ('Matagrano', 'Mystic Haze (Keg - 1/2 bbl)', 4),
  ('Mussetter', 'Mystic Haze (Keg - 1/2 bbl)', 2),
  ('Matagrano', 'Prohibition (Case 4x6 - 12 oz Cans)', 60),
  ('Mussetter', 'Prohibition (Case 4x6 - 12 oz Cans)', 40),
  ('Superior', 'Prohibition (Case 4x6 - 12 oz Cans)', 20),
  ('Matagrano', 'Prohibition Red Ale (Keg 1/6bbl)', 40),
  ('Mussetter', 'Prohibition Red Ale (Keg 1/6bbl)', 5),
  ('Superior', 'Prohibition Red Ale (Keg 1/6bbl)', 2),
  ('Matagrano', 'Prohibition Red Ale (Keg 1/2 bbl)', 32),
  ('Mussetter', 'Prohibition Red Ale (Keg 1/2 bbl)', 2),
  ('Superior', 'Prohibition Red Ale (Keg 1/2 bbl)', 2);

do $$
declare
  missing text;
begin
  select string_agg(distinct dist, ', ') into missing
    from adam_par a
   where not exists (select 1 from distributors d where d.name = a.dist and d.active);
  if missing is not null then
    raise exception 'Distributor not found (active): %', missing;
  end if;

  select string_agg(distinct product, ' | ') into missing
    from adam_par a
   where not exists (select 1 from products p
                      where p.active and regexp_replace(trim(p.name), '\s+', ' ', 'g') = a.product);
  if missing is not null then
    raise exception 'Product not found (active): %', missing;
  end if;
end $$;

delete from distributor_par_levels
 where distributor_id in (
   select id from distributors
    where name in ('Matagrano', 'Valley Wide', 'Mussetter', 'Guardian', 'Markstein',
                   'Superior', 'Markstein (old)', 'Valleywide'));

insert into distributor_par_levels (distributor_id, product_id, par_level, updated_at)
select d.id, p.id, a.par, now()
  from adam_par a
  join distributors d on d.name = a.dist
  join products p on p.active and regexp_replace(trim(p.name), '\s+', ' ', 'g') = a.product;

commit;

-- Check: par levels per distributor (expect Matagrano 17, Valley Wide 14,
-- Mussetter 28, Guardian 17, Markstein 10, Superior 26) and the Markstein rows.
select d.name, d.active, d.is_core_distributor as core, d.inventory_sort_order,
       (select count(*) from distributor_par_levels x where x.distributor_id = d.id) as par_levels,
       (select count(*) from distributor_inventory x where x.distributor_id = d.id) as inventory_rows
  from distributors d
 where d.name ilike 'markstein%' or d.name ilike 'valley%'
    or d.name in ('Matagrano', 'Mussetter', 'Guardian', 'Superior')
 order by d.active desc, d.name;
