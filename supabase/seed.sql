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
