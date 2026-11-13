-- Orders for the week of 11/16/26 (Inventory & Allocation), from To Brew 10 (2026-11-13, per Chad).
-- What we can send, after today's allocation: tanks at 90% (10% loss), Mussetter's approved order first,
-- every distributor getting the same % of what they need to reach par, rounded down.
-- 63 lines: Matagrano 13, Markstein 5, Valley Wide 13, Guardian 4, Superior 11, The Localist 5, Coast 12.
-- Mussetter is NOT touched (Chad: leave Mussetter out). Inactive "... Cans" distributors are not touched.
-- Color code: GREEN (On Hand / good_confirmed) = already packaged in the warehouse;
--             PURPLE (Need to Package / need_to_package) = comes out of a tank.
-- Only fills lines that are empty (0) on that week, so it never overwrites something already entered.
-- If the first version of this file was already run, re-running this one just adds the colors.
-- Safe to run more than once. Run in Supabase's SQL Editor.

begin;

insert into public.allocations (week_id, distributor_id, product_id, quantity, status_flag, updated_at)
select w.id, d.id, p.id, v.q, v.flag, now()
from (values
('Matagrano','Nectarine Pie of the Tiger (Keg - 1/6 bbl)',3,'good_confirmed'),
('Matagrano','Peachy Vibes (Case - 4x6 - 12oz - Can)',19,'need_to_package'),
('Matagrano','Peachy Vibes (Keg - 1/6 bbl)',1,'good_confirmed'),
('Matagrano','Big Daddy IPA (Case - 12x - 19.2oz - Can)',23,'need_to_package'),
('Matagrano','Big Daddy IPA (Case 4x6 - 12 oz Cans)',23,'need_to_package'),
('Matagrano','Big Daddy IPA (Keg - 1/6 bbl)',15,'need_to_package'),
('Matagrano','Big Daddy IPA (Keg - 1/2 bbl)',22,'need_to_package'),
('Matagrano','Mystic Haze IPA (Case - 12x - 19.2oz - Can)',9,'need_to_package'),
('Matagrano','Mystic Haze IPA (Case 4x6 - 12 oz Cans)',19,'need_to_package'),
('Matagrano','Mystic Haze (Keg - 1/6 bbl)(JUICY)',4,'need_to_package'),
('Matagrano','Prohibition (Case 4x6 - 12 oz Cans)',16,'need_to_package'),
('Matagrano','Prohibition Red Ale (Keg 1/6bbl)',17,'need_to_package'),
('Matagrano','Prohibition Red Ale (Keg 1/2 bbl)',17,'need_to_package'),
('Markstein','Capt. Hazy (Case - 12x - 19.2oz - Can)',29,'need_to_package'),
('Markstein','Capt. Hazy (Case - 6x4 - 16oz - Can)',29,'need_to_package'),
('Markstein','Capt. Hazy (Keg - 1/2 bbl)',2,'need_to_package'),
('Markstein','Metropolis Lager (Keg - 1/2 bbl)',1,'need_to_package'),
('Markstein','Big Daddy IPA (Case 4x6 - 12 oz Cans)',2,'need_to_package'),
('Valley Wide','Capt. Hazy (Case - 6x4 - 16oz - Can)',19,'need_to_package'),
('Valley Wide','Capt. WC (Case - 12x - 19.2oz - Can)',11,'need_to_package'),
('Valley Wide','Capt. WC IPA (Case - 6x4 - 16oz - Can)',11,'need_to_package'),
('Valley Wide','Juicy NE IPA (Case - 12x - 19.2oz - Can)',18,'need_to_package'),
('Valley Wide','Juicy NE IPA (Case - 6x4 - 16oz - Can)',39,'need_to_package'),
('Valley Wide','Juicy NE IPA (Keg - 1/6 bbl)',15,'need_to_package'),
('Valley Wide','Juicy NE IPA (Keg - 1/2 bbl)',6,'need_to_package'),
('Valley Wide','Mango Bomb NE IIPA Series (Case - 12x - 19.2oz - Can)',9,'need_to_package'),
('Valley Wide','Mango Bomb NE IIPA Series (Case - 6x4 - 16oz - Can)',19,'need_to_package'),
('Valley Wide','Peachy Vibes (Case - 12x - 19.2oz - Can)',9,'need_to_package'),
('Valley Wide','Peachy Vibes (Case - 4x6 - 12oz - Can)',34,'need_to_package'),
('Valley Wide','Peachy Vibes (Keg - 1/6 bbl)',3,'need_to_package'),
('Valley Wide','Peachy Vibes (Keg - 1/2 bbl)',1,'good_confirmed'),
('Guardian','Capt. Hazy (Case - 12x - 19.2oz - Can)',7,'need_to_package'),
('Guardian','Capt. WC IPA (Case - 6x4 - 16oz - Can)',5,'need_to_package'),
('Guardian','Nectarine Pie of the Tiger (Keg - 1/2 bbl)',1,'good_confirmed'),
('Guardian','Peachy Vibes (Case - 12x - 19.2oz - Can)',16,'need_to_package'),
('Superior','Capt. Hazy (Case - 12x - 19.2oz - Can)',3,'good_confirmed'),
('Superior','Mango Bomb NE IIPA Series (Case - 12x - 19.2oz - Can)',4,'need_to_package'),
('Superior','Peachy Vibes (Case - 12x - 19.2oz - Can)',10,'need_to_package'),
('Superior','Peachy Vibes (Case - 4x6 - 12oz - Can)',20,'need_to_package'),
('Superior','Big Daddy IPA (Case - 12x - 19.2oz - Can)',11,'need_to_package'),
('Superior','Big Daddy IPA (Case 4x6 - 12 oz Cans)',8,'need_to_package'),
('Superior','Big Daddy IPA (Keg - 1/6 bbl)',3,'need_to_package'),
('Superior','Mystic Haze IPA (Case 4x6 - 12 oz Cans)',1,'need_to_package'),
('Superior','Mystic Haze (Keg - 1/6 bbl)(JUICY)',1,'need_to_package'),
('Superior','Prohibition (Case 4x6 - 12 oz Cans)',3,'need_to_package'),
('Superior','Prohibition Red Ale (Keg 1/6bbl)',1,'need_to_package'),
('The Localist','The Hatchet - Apple Cider (Keg - 1/2 bbl)',2,'good_confirmed'),
('The Localist','The Hatchet - Apple Cider (Keg - 1/6 bbl)',5,'good_confirmed'),
('The Localist','Big Daddy IPA (Case - 12x - 19.2oz - Can)',17,'need_to_package'),
('The Localist','Big Daddy IPA (Keg - 1/2 bbl)',1,'good_confirmed'),
('The Localist','Big Daddy IPA (Keg - 1/6 bbl)',2,'need_to_package'),
('Coast','Capt. Hazy (Case - 12x - 19.2oz - Can)',9,'need_to_package'),
('Coast','Capt. Hazy (Case - 6x4 - 16oz - Can)',9,'need_to_package'),
('Coast','Capt. WC (Case - 12x - 19.2oz - Can)',5,'need_to_package'),
('Coast','Capt. WC IPA (Case - 6x4 - 16oz - Can)',5,'need_to_package'),
('Coast','Juicy NE IPA (Case - 12x - 19.2oz - Can)',9,'need_to_package'),
('Coast','Juicy NE IPA (Case - 6x4 - 16oz - Can)',9,'good_confirmed'),
('Coast','Mango Bomb NE IIPA Series (Case - 12x - 19.2oz - Can)',9,'need_to_package'),
('Coast','Mango Bomb NE IIPA Series (Case - 6x4 - 16oz - Can)',9,'need_to_package'),
('Coast','Big Daddy IPA (Case - 12x - 19.2oz - Can)',8,'need_to_package'),
('Coast','Big Daddy IPA (Case 6x4 - 16 oz Cans)',5,'good_confirmed'),
('Coast','Mystic Haze IPA (Case - 12x - 19.2oz - Can)',14,'need_to_package'),
('Coast','Mystic Haze IPA (Case 6x4 - 16 oz Cans)',9,'need_to_package')
) as v(dist, product, q, flag)
join public.weeks w on w.week_start = date '2026-11-13'
join public.distributors d on d.name = v.dist and d.active
join public.products p on p.name = v.product
on conflict (week_id, distributor_id, product_id)
do update set quantity = excluded.quantity, status_flag = excluded.status_flag, updated_at = now()
where public.allocations.quantity = 0
   or (public.allocations.quantity = excluded.quantity and public.allocations.status_flag is null);

commit;

-- Check: expect 63 lines (10 green, 53 purple) -> Matagrano 13 lines / 188 units (2 green), Markstein 5 / 63 (0), Valley Wide 13 / 194 (1), Guardian 4 / 29 (1), Superior 11 / 65 (1), The Localist 5 / 27 (3), Coast 12 / 100 (2)
select d.name as distributor, count(*) as lines, sum(a.quantity) as units,
       count(*) filter (where a.status_flag = 'good_confirmed') as green,
       count(*) filter (where a.status_flag = 'need_to_package') as purple
from public.allocations a
join public.weeks w on w.id = a.week_id and w.week_start = date '2026-11-13'
join public.distributors d on d.id = a.distributor_id and d.active
where a.quantity <> 0
group by d.name
order by d.name;
