-- FCB Distributor Allocation App — Seed Data
-- Run this AFTER schema.sql and functions.sql. Populates the distributor and
-- product lists using your actual current data (pulled from the "Inventory
-- for Sale" spreadsheet, 8/11/26 tab) so you can start using the app with
-- real products right away instead of a blank list.
--
-- Feel free to edit names/colors below before running, or clean up
-- afterwards directly in the Supabase table editor.

insert into distributors (name, color) values
  ('Matagrano', '#3fb950'),
  ('Saccani', '#d4a017'),
  ('Valleywide', '#388bfd'),
  ('Guardian', '#bc8cff'),
  ('Markstein', '#00b4d8'),
  ('Coast', '#f85149'),
  ('Superior', '#ff7b54')
on conflict (name) do nothing;

insert into products (name, sort_order) values
  ('EUREKA STOUT - 1/2 bbl keg', 1),
  ('Capt. WC PALE ALE (Case - 6x4 - 16oz - Can)', 2),
  ('Capt. Pale Ale (Keg - 1/2 bbl)', 3),
  ('Capt. Pale Ale (Keg - 1/6 bbl)', 4),
  ('Capt. Hazy (Case - 6x4 - 16oz - Can)', 5),
  ('Capt. Hazy (Case - 12x - 19.2oz - Can)', 6),
  ('Capt. Hazy (Keg - 1/6 bbl)', 7),
  ('Capt. Hazy (Keg - 1/2 bbl)', 8),
  ('Capt. Hazy Imperial Punch (Case - 12x - 19.2oz - Can)', 9),
  ('Capt. Hazy Imperial Punch (Case - 6x4 - 16oz - Can)', 10),
  ('Capt. Hazy Imperial Punch (Keg - 1/2 bbl)', 11),
  ('Capt. Hazy Imperial Punch (Keg - 1/6 bbl)', 12),
  ('Hazy Beach (Keg - 1/2 bbl)', 13),
  ('Capt. WC IPA (Case - 6x4 - 16oz - Can)', 14),
  ('Capt. WC (Case - 12x - 19.2oz - Can)', 15),
  ('Town & City 16oz', 16),
  ('Capt. WC (Keg - 1/6 bbl)', 17),
  ('Capt. WC (Keg - 1/2 bbl)', 18),
  ('Illa Vanilla Milkshake IPA (6 pack 12oz box)', 19),
  ('Illa Vanilla Milkshake IPA (6 pack Mixed pack case)', 20),
  ('Illa Vanilla Milkshake IPA (Case 6x4 - 16oz Cans)', 21),
  ('Illa Vanilla Milkshake IPA (Keg - 1/2 bbl)', 22),
  ('Illa Vanilla Milkshake IPA (Keg - 1/6 bbl)', 23),
  ('Strawberry Milkshake IPA (Case 6x4 - 16oz Cans)', 24),
  ('Blueberry Illa (Case 6x4 - 16oz Cans)', 25),
  ('Strawberry Illa (Keg - 1/2 bbl)', 26),
  ('Juicy NE IPA (Case - 6x4 - 16oz - Can)', 27),
  ('Juicy NE IPA (Case - 12x - 19.2oz - Can)', 28),
  ('Juicy NE IPA (Keg - 1/6 bbl)', 29),
  ('Juicy NE IPA (Keg - 1/2 bbl)', 30),
  ('Mango Bomb NE IIPA Series (Case - 6x4 - 16oz - Can)', 31),
  ('Mango Bomb NE IIPA Series (Case - 12x - 19.2oz - Can)', 32),
  ('Mango Bomb NE IIPA (Keg - 1/6 bbl)', 33),
  ('Mango Bomb NE IIPA (Keg - 1/2 bbl)', 34),
  ('Nectarine Pie of the Tiger (Case - 6x4 - 16oz - Can)', 35),
  ('Nectarine Pie of the Tiger (Keg - 1/6 bbl)', 36),
  ('Nectarine Pie of the Tiger (Keg - 1/2 bbl)', 37),
  ('Peachy Vibes (Case - 4x6 - 12oz - Can)', 38),
  ('Peachy Vibes (Case - 12x - 19.2oz - Can)', 39),
  ('Peachy Vibes (Keg - 1/6 bbl)', 40),
  ('Peachy Vibes (Keg - 1/2 bbl)', 41),
  ('Beachy Vibes (keg - 1/6 bbl)', 42),
  ('Beachy Vibes (keg - 1/2 bbl)', 43),
  ('PRESS BOX PL BLONDE (keg - 1/6bbl)', 44),
  ('TEKO (Case - 4x6 - 12oz - Can)', 45),
  ('TEKO (Keg - 1/2 bbl)', 46),
  ('TEKO (Keg - 1/6 bbl)', 47),
  ('Spartan (cases - 12oz - cans)', 48),
  ('Cherry Blossom Sakura Chaya (cases - 16oz cans)', 49),
  ('Cherry Blossom Sakura Chaya (kegs - 1/6 bbl )', 50),
  ('Victory Vibes (Case - 4x6 - 12oz - Can)', 51),
  ('Victory Vibes (Case - 12x - 19.2oz - Can)', 52),
  ('Victory Vibes (Keg - 1/6 bbl)', 53),
  ('Victory Vibes (Keg - 1/2 bbl)', 54),
  ('The Hatchet - Apple Cider (Case 6x4 - 16 oz Cans)', 55),
  ('The Hatchet - Apple Cider (Keg - 1/6 bbl)', 56),
  ('The Hatchet - Apple Cider (Keg - 1/2 bbl)', 57),
  ('The Pitchfork - Pear Cider (Case 6x4 - 16 oz Cans)', 58),
  ('The Pitchfork - Pear Cider (Keg - 1/6 bbl)', 59),
  ('The Pitchfork - Pear Cider (Keg - 1/2 bbl)', 60),
  ('The Sickle - Pineapple Cider (Case 6x4 - 16 oz Cans)', 61),
  ('The Sickle - Pineapple Cider (Keg - 1/6 bbl)', 62),
  ('The Sickle - Pineapple Cider (Keg - 1/2 bbl)', 63),
  ('Guava Cider (Keg - 1/2 bbl)', 64),
  ('Guava Cider (Keg - 1/6 bbl)', 65),
  ('Big Daddy IPA (Case 4x6 - 12 oz Cans)', 66),
  ('Big Daddy IPA (Case 6x4 - 16 oz Cans)', 67),
  ('Big Daddy IPA (Case - 12x - 19.2oz - Can)', 68),
  ('Big Daddy IPA (Keg - 1/6 bbl)', 69),
  ('Big Daddy IPA (Keg - 1/2 bbl)', 70),
  ('Blind Tiger (Case 6x4 - 16 oz Cans)', 71),
  ('Blind Tiger (Keg - 1/2 bbl)', 72),
  ('Blind Tiger (Keg - 1/6 bbl)', 73),
  ('Mystic Haze IPA (Case 4x6 - 12 oz Cans)', 74),
  ('Mystic Haze IPA (Case 6x4 - 16 oz Cans)', 75),
  ('Mystic Haze IPA (Case - 12x - 19.2oz - Can)', 76),
  ('Mystic Haze (Keg - 1/6 bbl)(JUICY)', 77),
  ('Mystic Haze (Keg - 1/2 bbl)', 78),
  ('Prohibition (Case 4x6 - 12 oz Cans)', 79),
  ('Prohibition Red Ale (Keg 1/6bbl)', 80),
  ('Prohibition Red Ale (Keg 1/2 bbl)', 81),
  ('The Dopest (Case - 6x4 - 16oz - Can)', 82),
  ('The Dopest (Keg - 1/2 bbl)', 83),
  ('The Dopest (Keg - 1/6 bbl)', 84),
  ('BPLB (cases - 6x4 -16 oz - cans)', 85),
  ('8 trill pills (cases - 6x4 - 16oz - cans)', 86),
  ('8 trill pills (kegs - 1/2 bbl)', 87),
  ('Dopetoberfest (cases - 6x4 - 16oz - cans)', 88),
  ('Dopetoberfest (kegs - 1/2bbls)', 89),
  ('Seltzer Batch #1 (kegs-1/2bbl)', 90),
  ('Tea Base (kegs- 1/2bbl)', 91),
  ('FCB Can Tap Handle', 92),
  ('Speakeasy Tap Handle', 93)
on conflict (name) do nothing;

-- Brand dividers, matching the section-header rows from the original
-- spreadsheet (plus a new "Tap Handles" divider grouping those two together
-- at the very bottom).
insert into section_dividers (label, sort_order) values
  ('Full Circle Brewing', 0.5),
  ('Sonoma Cider', 54.5),
  ('Speakeasy Ales & Lagers', 65.5),
  ('Tap Handles', 91.5);

-- Sales > Price List — brands + starting prices, carried over from the old
-- FCB Pricing desktop app's price list (same numbers, just corrected the
-- "Mystic Hazy" typo to match the current brand name "Mystic Haze").
insert into pricing_brands (name, sort_order) values
  ('Big Daddy', 1),
  ('Prohibition', 2),
  ('Mystic Haze', 3),
  ('Capt Hazy', 4),
  ('Capt WC IPA', 5),
  ('Peachy Vibes', 6),
  ('Mango Bomb', 7),
  ('Nectarine', 8)
on conflict (name) do nothing;

insert into brand_price_list (brand_id, package_key, price)
select b.id, v.package_key, v.price
from pricing_brands b
join (values
  ('Big Daddy',    '6pk',    28.25),
  ('Big Daddy',    '4pack',  35.50),
  ('Big Daddy',    'single', 19.00),
  ('Big Daddy',    'sixth',  70.00),
  ('Big Daddy',    'half',   143.00),
  ('Prohibition',  '6pk',    38.25),
  ('Prohibition',  '4pack',  35.50),
  ('Prohibition',  'single', 0),
  ('Prohibition',  'sixth',  70.00),
  ('Prohibition',  'half',   143.00),
  ('Mystic Haze',  '6pk',    28.25),
  ('Mystic Haze',  '4pack',  35.50),
  ('Mystic Haze',  'single', 24.50),
  ('Mystic Haze',  'sixth',  70.00),
  ('Mystic Haze',  'half',   143.00),
  ('Capt Hazy',    '6pk',    0),
  ('Capt Hazy',    '4pack',  45.34),
  ('Capt Hazy',    'single', 24.50),
  ('Capt Hazy',    'sixth',  71.50),
  ('Capt Hazy',    'half',   143.00),
  ('Capt WC IPA',  '6pk',    0),
  ('Capt WC IPA',  '4pack',  45.34),
  ('Capt WC IPA',  'single', 24.50),
  ('Capt WC IPA',  'sixth',  71.50),
  ('Capt WC IPA',  'half',   143.00),
  ('Peachy Vibes', '6pk',    27.25),
  ('Peachy Vibes', '4pack',  0),
  ('Peachy Vibes', 'single', 24.50),
  ('Peachy Vibes', 'sixth',  61.00),
  ('Peachy Vibes', 'half',   135.00),
  ('Mango Bomb',   '6pk',    0),
  ('Mango Bomb',   '4pack',  54.40),
  ('Mango Bomb',   'single', 30.50),
  ('Mango Bomb',   'sixth',  90.00),
  ('Mango Bomb',   'half',   194.00),
  ('Nectarine',    '6pk',    0),
  ('Nectarine',    '4pack',  45.34),
  ('Nectarine',    'single', 0),
  ('Nectarine',    'sixth',  74.50),
  ('Nectarine',    'half',   160.00)
) as v(brand_name, package_key, price) on v.brand_name = b.name
on conflict (brand_id, package_key) do nothing;

-- Sales > Margin Analysis — a few brands only existed in Margin Analysis in
-- the old desktop app, not yet in the Price List brand list above; adding
-- them here too so Sales has one consistent brand list throughout.
insert into pricing_brands (name, sort_order) values
  ('The Pitchfork', 9),
  ('The Hatchet', 10),
  ('Juicy', 11)
on conflict (name) do nothing;

insert into margin_analyses (brand_id, batch_cost, yield_bbls)
select b.id, v.batch_cost, v.yield_bbls
from pricing_brands b
join (values
  ('Big Daddy',     2234.31::numeric, 25::numeric),
  ('The Pitchfork',  3762.52, 25),
  ('The Hatchet',    3476.01, 25),
  ('Prohibition',    2072.20, 25),
  ('Mystic Haze',    1770.20, 25),
  ('Capt Hazy',      2752.20, 25),
  ('Capt WC IPA',    2474.79, 25),
  ('Peachy Vibes',   1615.36, 25),
  ('Juicy',          2752.20, 25),
  ('Nectarine',      0,       25)
) as v(brand_name, batch_cost, yield_bbls) on v.brand_name = b.name
on conflict (brand_id) do nothing;

insert into margin_analysis_packages (analysis_id, package_key, enabled, ptr, ptd)
select ma.id, v.package_key, v.enabled, v.ptr, v.ptd
from margin_analyses ma
join pricing_brands b on b.id = ma.brand_id
join (values
  ('Big Daddy',     '6pk',    true,  39.25::numeric,  28.25::numeric),
  ('Big Daddy',     '4pack',  true,  45.50,  35.00),
  ('Big Daddy',     'single', true,  35.00,  24.50),
  ('Big Daddy',     'sixth',  true,  100.00, 70.00),
  ('Big Daddy',     'half',   true,  200.00, 140.00),

  ('The Pitchfork', '6pk',    false, null,   null),
  ('The Pitchfork', '4pack',  true,  52.50,  42.00),
  ('The Pitchfork', 'single', true,  31.25,  25.00),
  ('The Pitchfork', 'sixth',  true,  110.00, 72.00),
  ('The Pitchfork', 'half',   true,  220.00, 151.00),

  ('The Hatchet',   '6pk',    false, null,   null),
  ('The Hatchet',   '4pack',  true,  52.50,  42.00),
  ('The Hatchet',   'single', true,  31.25,  25.00),
  ('The Hatchet',   'sixth',  true,  110.00, 72.00),
  ('The Hatchet',   'half',   true,  220.00, 151.00),

  ('Prohibition',   '6pk',    true,  39.25,  28.25),
  ('Prohibition',   '4pack',  true,  50.50,  35.50),
  ('Prohibition',   'single', true,  27.00,  19.00),
  ('Prohibition',   'sixth',  true,  100.00, 70.00),
  ('Prohibition',   'half',   true,  200.00, 140.00),

  ('Mystic Haze',   '6pk',    true,  39.25,  28.25),
  ('Mystic Haze',   '4pack',  true,  58.75,  35.50),
  ('Mystic Haze',   'single', true,  27.00,  19.00),
  ('Mystic Haze',   'sixth',  true,  85.00,  61.00),
  ('Mystic Haze',   'half',   true,  178.00, 128.00),

  ('Capt Hazy',     '6pk',    false, null,   null),
  ('Capt Hazy',     '4pack',  true,  63.00,  45.34),
  ('Capt Hazy',     'single', true,  33.50,  24.50),
  ('Capt Hazy',     'sixth',  true,  99.00,  71.50),
  ('Capt Hazy',     'half',   true,  199.00, 143.00),

  ('Capt WC IPA',   '6pk',    false, null,   null),
  ('Capt WC IPA',   '4pack',  true,  63.00,  45.34),
  ('Capt WC IPA',   'single', true,  31.50,  23.00),
  ('Capt WC IPA',   'sixth',  true,  99.00,  71.50),
  ('Capt WC IPA',   'half',   true,  199.00, 143.00),

  ('Peachy Vibes',  '6pk',    true,  38.00,  27.25),
  ('Peachy Vibes',  '4pack',  true,  58.80,  42.50),
  ('Peachy Vibes',  'single', true,  29.00,  21.00),
  ('Peachy Vibes',  'sixth',  true,  85.00,  61.00),
  ('Peachy Vibes',  'half',   true,  178.00, 128.00),

  ('Juicy',         '6pk',    false, null,   null),
  ('Juicy',         '4pack',  false, null,   null),
  ('Juicy',         'single', true,  25.15,  18.00),
  ('Juicy',         'sixth',  false, null,   null),
  ('Juicy',         'half',   false, null,   null),

  ('Nectarine',     '6pk',    false, null,   null),
  ('Nectarine',     '4pack',  false, null,   null),
  ('Nectarine',     'single', false, null,   null),
  ('Nectarine',     'sixth',  false, null,   null),
  ('Nectarine',     'half',   false, null,   null)
) as v(brand_name, package_key, enabled, ptr, ptd) on v.brand_name = b.name
on conflict (analysis_id, package_key) do nothing;

-- Sales > Cost Per Case — packaging component prices, ingredient prices,
-- per-package labor costs, and per-brand batch recipes, carried over from
-- the old FCB Pricing desktop app.
-- packaging_components
insert into packaging_components (component_key, label, category, price) values
  ('can_12oz', '12oz can (per can)', 'Cans', 0.18),
  ('can_16oz', '16oz can (per can)', 'Cans', 0.22),
  ('can_19_2oz', '19.2oz can (per can)', 'Cans', 0.28),
  ('lid', 'Lid (per lid)', 'Lids', 0.04),
  ('label_12oz', 'Label 12oz (per label)', 'Labels', 0.12),
  ('label_16oz', 'Label 16oz (per label)', 'Labels', 0.14),
  ('label_19_2oz', 'Label 19.2oz (per label)', 'Labels', 0.14),
  ('paktek_4pk', 'Paktek 4pk (per unit)', 'Pakteks', 0.18),
  ('paktek_6pk', 'Paktek 6pk (per unit)', 'Pakteks', 0.18),
  ('tray_12_16oz', 'Tray 12-16oz (per tray)', 'Trays', 0.45),
  ('tray_19_2oz', 'Tray 19.2oz (per tray)', 'Trays', 0.45)
on conflict (component_key) do nothing;

-- ingredient_costs
insert into ingredient_costs (category_key, ingredient_key, name, unit, price) values
  ('yeast', 'ay4', 'Ay4', 'g', 0.09),
  ('yeast', 'lacto_bbl', 'Lacto bbl', 'e', 350),
  ('yeast', 'new_e', 'New E', 'g', 0.09),
  ('grain', 'pilsner', 'Pilsner', 'lb', 0.72),
  ('grain', 'munich_light', 'Munich Light', 'lb', 0.74),
  ('grain', 'vienna', 'Vienna', 'lb', 0.73),
  ('grain', '2row', '2 row', 'lb', 0.7),
  ('grain', 'white_wheat', 'White Wheat', 'lb', 0.8),
  ('grain', 'oats', 'Oats', 'lb', 0.64),
  ('grain', 'dextrin', 'Dextrin', 'lb', 0.84),
  ('grain', 'melanoidin', 'Melanoidin', 'lb', 0.88),
  ('grain', 'victory', 'Victory', 'lb', 0.73),
  ('grain', 'melanoidin_gold', 'Melanoidin Gold', 'lb', 0.88),
  ('grain', 'red_x', 'Red X', 'lb', 0.99),
  ('grain', 'carmel_60', 'Carmel 60', 'lb', 0.88),
  ('grain', 'midnight_wheat', 'Midnight Wheat', 'lb', 0.46),
  ('hops', 'cascade_cold', 'Cascade - Cold Side', 'lb', 5),
  ('hops', 'cascade_hot', 'Cascade - Hot Side', 'lb', 5),
  ('hops', 'centennial_cold', 'Centennial - Cold Side', 'lb', 12),
  ('hops', 'centennial_hot', 'Centennial - Hot Side', 'lb', 12),
  ('hops', 'chinook_cold', 'Chinook - Cold Side', 'lb', 6.1),
  ('hops', 'chinook_hot', 'Chinook - Hot Side', 'lb', 6.1),
  ('hops', 'citra_cold', 'Citra - Cold Side', 'lb', 11.52),
  ('hops', 'citra_hot', 'Citra - Hot Side', 'lb', 11.52),
  ('hops', 'columbus_cold', 'Columbus - Cold Side', 'lb', 8),
  ('hops', 'columbus_hot', 'Columbus - Hot Side', 'lb', 8),
  ('hops', 'mosaic_cold', 'Mosaic - Cold Side', 'lb', 10.81),
  ('hops', 'mosaic_hot', 'Mosaic - Hot Side', 'lb', 10.81),
  ('flavoring', 'mango_lbs', 'Mango lbs', 'lb', 1.95),
  ('flavoring', 'mango_gal', 'Mango Gal', 'gal', 140.6),
  ('flavoring', 'nectarine_gal', 'Nectarine Gal', 'gal', 140.6),
  ('flavoring', 'peach_lbs', 'Peach lbs', 'lb', 19.84),
  ('flavoring', 'apple_concentrate', 'Apple Concentrate', 'gal', 18.82),
  ('flavoring', 'vanilla_gal', 'Vanilla Gal', 'gal', 10.78),
  ('flavoring', 'imitation_vanilla', 'Imitation Vanilla - Felbro', 'gal', 14.55),
  ('flavoring', 'pear_wonf', 'Pear WONF', 'g', 27.2),
  ('other', 'cane_sugar', 'Cane Sugar', 'lb', 1.12),
  ('other', 'fermol_charmat', 'Fermol Charmat', 'g', 0.05),
  ('other', 'malic_acid', 'Malic Acid', 'g', 20.02),
  ('other', 'potassium_metabisulfite', 'Potassium Metabisulfite', 'lb', 0),
  ('other', 'potassium_sorbate', 'Potassium Sorbate', 'lb', 6.87),
  ('other', 'scottzyme_hc', 'Scottzyme HC', 'ml', 0.18),
  ('other', 'scottzyme_pec5l', 'Scottzyme PEC5L', 'ml', 0.17),
  ('other', 'spindasol', 'Spindasol SB3 - 20kg', 'g', 5.51)
on conflict (category_key, ingredient_key) do nothing;

-- package_labor_costs
insert into package_labor_costs (package_key, labor) values
  ('6pk', 637.29),
  ('4pack', 637.29),
  ('single', 637.29),
  ('sixth', 200),
  ('half', 200)
on conflict (package_key) do nothing;

-- batch_recipe_items
insert into batch_recipe_items (brand_id, ingredient_key, qty_per_bbl, unit, sort_order)
select b.id, v.ingredient_key, v.qty_per_bbl, v.unit, v.sort_order
from pricing_brands b
join (values
  ('Big Daddy', 'ay4', 83.3333, 'g', 0),
  ('Big Daddy', '2row', 42.1667, 'lb', 1),
  ('Big Daddy', 'pilsner', 20.1667, 'lb', 2),
  ('Big Daddy', 'munich_light', 3.6667, 'lb', 3),
  ('Big Daddy', 'vienna', 3.6667, 'lb', 4),
  ('Big Daddy', 'columbus_hot', 0.9167, 'lb', 5),
  ('Big Daddy', 'chinook_hot', 0.1833, 'lb', 6),
  ('Big Daddy', 'columbus_cold', 0.3667, 'lb', 7),
  ('Big Daddy', 'cascade_cold', 0.7333, 'lb', 8),
  ('Big Daddy', 'chinook_cold', 0.55, 'lb', 9),
  ('Capt WC IPA', 'ay4', 83.3333, 'g', 0),
  ('Capt WC IPA', '2row', 42.1667, 'lb', 1),
  ('Capt WC IPA', 'pilsner', 20.1667, 'lb', 2),
  ('Capt WC IPA', 'munich_light', 3.6667, 'lb', 3),
  ('Capt WC IPA', 'vienna', 3.6667, 'lb', 4),
  ('Capt WC IPA', 'columbus_hot', 0.9167, 'lb', 5),
  ('Capt WC IPA', 'chinook_hot', 0.1833, 'lb', 6),
  ('Capt WC IPA', 'columbus_cold', 0.3667, 'lb', 7),
  ('Capt WC IPA', 'cascade_cold', 0.7333, 'lb', 8),
  ('Capt WC IPA', 'chinook_cold', 0.55, 'lb', 9),
  ('Capt Hazy', 'new_e', 83.3333, 'g', 0),
  ('Capt Hazy', '2row', 56.8333, 'lb', 1),
  ('Capt Hazy', 'pilsner', 11, 'lb', 2),
  ('Capt Hazy', 'white_wheat', 9.1667, 'lb', 3),
  ('Capt Hazy', 'dextrin', 7.3333, 'lb', 4),
  ('Capt Hazy', 'oats', 8.3333, 'lb', 5),
  ('Capt Hazy', 'mosaic_hot', 0.3667, 'lb', 6),
  ('Capt Hazy', 'citra_hot', 0.7333, 'lb', 7),
  ('Capt Hazy', 'mosaic_cold', 0.9167, 'lb', 8),
  ('Capt Hazy', 'citra_cold', 0.7333, 'lb', 9),
  ('Juicy', 'new_e', 83.3333, 'g', 0),
  ('Juicy', '2row', 56.8333, 'lb', 1),
  ('Juicy', 'pilsner', 11, 'lb', 2),
  ('Juicy', 'white_wheat', 9.1667, 'lb', 3),
  ('Juicy', 'dextrin', 7.3333, 'lb', 4),
  ('Juicy', 'oats', 8.3333, 'lb', 5),
  ('Juicy', 'mosaic_hot', 0.3667, 'lb', 6),
  ('Juicy', 'citra_hot', 0.7333, 'lb', 7),
  ('Juicy', 'mosaic_cold', 0.9167, 'lb', 8),
  ('Juicy', 'citra_cold', 0.7333, 'lb', 9),
  ('Mystic Haze', 'new_e', 83.3333, 'g', 0),
  ('Mystic Haze', '2row', 56.8333, 'lb', 1),
  ('Mystic Haze', 'pilsner', 11, 'lb', 2),
  ('Mystic Haze', 'white_wheat', 9.1667, 'lb', 3),
  ('Mystic Haze', 'dextrin', 7.3333, 'lb', 4),
  ('Mystic Haze', 'oats', 8.3333, 'lb', 5),
  ('Mystic Haze', 'mosaic_hot', 0.3667, 'lb', 6),
  ('Mystic Haze', 'citra_hot', 0.7333, 'lb', 7),
  ('Mystic Haze', 'mosaic_cold', 0.9167, 'lb', 8),
  ('Mystic Haze', 'citra_cold', 0.7333, 'lb', 9),
  ('Nectarine', 'lacto_bbl', 0.0333, 'e', 0),
  ('Nectarine', '2row', 40.3333, 'lb', 1),
  ('Nectarine', 'white_wheat', 18.3333, 'lb', 2),
  ('Nectarine', 'dextrin', 7.3333, 'lb', 3),
  ('Nectarine', 'melanoidin', 3.6667, 'lb', 4),
  ('Nectarine', 'munich_light', 3.6667, 'lb', 5),
  ('Nectarine', 'victory', 3.3333, 'lb', 6),
  ('Nectarine', 'nectarine_gal', 0.0333, 'gal', 7),
  ('Nectarine', 'ay4', 83.3333, 'g', 8),
  ('Mango Bomb', 'new_e', 83.3333, 'g', 0),
  ('Mango Bomb', '2row', 56.8333, 'lb', 1),
  ('Mango Bomb', 'pilsner', 11, 'lb', 2),
  ('Mango Bomb', 'white_wheat', 9.1667, 'lb', 3),
  ('Mango Bomb', 'dextrin', 7.3333, 'lb', 4),
  ('Mango Bomb', 'oats', 8.3333, 'lb', 5),
  ('Mango Bomb', 'mosaic_hot', 0.3667, 'lb', 6),
  ('Mango Bomb', 'citra_hot', 0.7333, 'lb', 7),
  ('Mango Bomb', 'mosaic_cold', 0.9167, 'lb', 8),
  ('Mango Bomb', 'citra_cold', 0.7333, 'lb', 9),
  ('Mango Bomb', 'mango_gal', 0.0333, 'gal', 10),
  ('Peachy Vibes', 'ay4', 83.3333, 'g', 0),
  ('Peachy Vibes', '2row', 25.6667, 'lb', 1),
  ('Peachy Vibes', 'white_wheat', 31.1667, 'lb', 2),
  ('Peachy Vibes', 'dextrin', 7.3333, 'lb', 3),
  ('Peachy Vibes', 'melanoidin', 3.6667, 'lb', 4),
  ('Peachy Vibes', 'munich_light', 3.6667, 'lb', 5),
  ('Peachy Vibes', 'victory', 3.3333, 'lb', 6),
  ('Peachy Vibes', 'chinook_hot', 0.1833, 'lb', 7),
  ('Peachy Vibes', 'chinook_cold', 0.1833, 'lb', 8),
  ('Peachy Vibes', 'peach_lbs', 0.3333, 'lb', 9),
  ('The Hatchet', 'apple_concentrate', 5.1987, 'gal', 0),
  ('The Hatchet', 'fermol_charmat', 71.1133, 'g', 1),
  ('The Hatchet', 'scottzyme_hc', 7.9611, 'ml', 2),
  ('The Hatchet', 'scottzyme_pec5l', 7.8412, 'ml', 3),
  ('The Hatchet', 'malic_acid', 0.0479, 'g', 4),
  ('The Hatchet', 'potassium_sorbate', 0.1051, 'lb', 5),
  ('The Hatchet', 'potassium_metabisulfite', 0, 'lb', 6),
  ('The Hatchet', 'cane_sugar', 8.3357, 'lb', 7),
  ('The Hatchet', 'spindasol', 0.125, 'g', 8),
  ('The Pitchfork', 'apple_concentrate', 5.1987, 'gal', 0),
  ('The Pitchfork', 'fermol_charmat', 71.1133, 'g', 1),
  ('The Pitchfork', 'scottzyme_hc', 7.9611, 'ml', 2),
  ('The Pitchfork', 'scottzyme_pec5l', 7.8412, 'ml', 3),
  ('The Pitchfork', 'malic_acid', 0.0479, 'g', 4),
  ('The Pitchfork', 'potassium_sorbate', 0.1051, 'lb', 5),
  ('The Pitchfork', 'potassium_metabisulfite', 0, 'lb', 6),
  ('The Pitchfork', 'cane_sugar', 8.3357, 'lb', 7),
  ('The Pitchfork', 'imitation_vanilla', 0.0333, 'gal', 8),
  ('The Pitchfork', 'pear_wonf', 0.3333, 'g', 9),
  ('The Pitchfork', 'spindasol', 0.125, 'g', 10),
  ('Prohibition', '2row', 34.8333, 'lb', 0),
  ('Prohibition', 'pilsner', 20.1667, 'lb', 1),
  ('Prohibition', 'melanoidin_gold', 3.6667, 'lb', 2),
  ('Prohibition', 'red_x', 11, 'lb', 3),
  ('Prohibition', 'carmel_60', 3.3333, 'lb', 4),
  ('Prohibition', 'midnight_wheat', 0.6667, 'lb', 5),
  ('Prohibition', 'cascade_hot', 0.1833, 'lb', 6),
  ('Prohibition', 'chinook_hot', 0.1467, 'lb', 7),
  ('Prohibition', 'ay4', 83.3333, 'g', 8)
) as v(brand_name, ingredient_key, qty_per_bbl, unit, sort_order) on v.brand_name = b.name
on conflict (brand_id, ingredient_key) do nothing;

-- Sales > Contribution Margin — company groupings (matching the old desktop
-- app's "companies" dict, but using the same full company names already
-- used elsewhere in the app rather than its internal shorthand) and the
-- revenue-per-case-equivalent figure for each brand + package line the old
-- app tracked. Mango Bomb is intentionally left with no company / no lines
-- here — it was never part of this feature in the old app.
update pricing_brands set company = 'Full Circle Brewing'
  where name in ('Capt Hazy', 'Capt WC IPA', 'Juicy', 'Nectarine', 'Peachy Vibes');
update pricing_brands set company = 'Speakeasy Ales & Lagers'
  where name in ('Big Daddy', 'Prohibition', 'Mystic Haze');
update pricing_brands set company = 'Sonoma Cider'
  where name in ('The Pitchfork', 'The Hatchet');

insert into contribution_margin_lines (brand_id, package_key, revenue_per_ce)
select b.id, v.package_key, v.revenue_per_ce
from pricing_brands b
join (values
  ('Capt Hazy',      '4pack', 33.98854862),
  ('Capt Hazy',      'single', 30.62006128),
  ('Capt Hazy',      'sixth', 31.13207547),
  ('Capt Hazy',      'half', 20.75471698),
  ('Capt WC IPA',    '4pack', 33.98854862),
  ('Capt WC IPA',    'single', 30.62006128),
  ('Capt WC IPA',    'sixth', 31.13207547),
  ('Capt WC IPA',    'half', 20.75471698),
  ('Juicy',          '4pack', 33.98854862),
  ('Juicy',          'single', 30.62006128),
  ('Juicy',          'sixth', 31.13207547),
  ('Juicy',          'half', 20.75471698),
  ('Nectarine',      '4pack', 36.24495646),
  ('Nectarine',      'sixth', 32.4383164),
  ('Nectarine',      'half', 23.22206096),
  ('Peachy Vibes',   '6pk', 27.25),
  ('Peachy Vibes',   'single', 30.62006128),
  ('Peachy Vibes',   'sixth', 26.56023222),
  ('Peachy Vibes',   'half', 19.59361393),
  ('Big Daddy',      '6pk', 28.25),
  ('Big Daddy',      '4pack', 33.98854862),
  ('Big Daddy',      'single', 30.62006128),
  ('Big Daddy',      'sixth', 30.47895501),
  ('Big Daddy',      'half', 20.75471698),
  ('Prohibition',    '6pk', 28.25),
  ('Prohibition',    'single', 30.62006128),
  ('Prohibition',    'sixth', 30.47895501),
  ('Prohibition',    'half', 20.75471698),
  ('Mystic Haze',    '6pk', 28.25),
  ('Mystic Haze',    '4pack', 33.98854862),
  ('Mystic Haze',    'single', 30.62006128),
  ('Mystic Haze',    'sixth', 30.47895501),
  ('Mystic Haze',    'half', 20.75471698),
  ('The Pitchfork',  '4pack', 31.48476052),
  ('The Pitchfork',  'single', 31.24496049),
  ('The Pitchfork',  'sixth', 31.34978229),
  ('The Pitchfork',  'half', 21.91582003),
  ('The Hatchet',    '4pack', 31.48476052),
  ('The Hatchet',    'single', 31.24496049),
  ('The Hatchet',    'sixth', 31.34978229),
  ('The Hatchet',    'half', 21.91582003)
) as v(brand_name, package_key, revenue_per_ce) on v.brand_name = b.name
on conflict (brand_id, package_key) do nothing;
