-- VIP Item Codes (Sales → VIP Item Codes → Full Circle / Speakeasy / Sonoma
-- Cider), added 2026-11-06, per Chad. FCB's own item codes as set up in VIP's
-- Item Catalog: Supplier Item Code + VIP Item ID, one row per item. Seeded
-- from Chad's "VIP Item Codes.xlsx". Run this once in Supabase's SQL Editor
-- BEFORE pushing the code. Safe to re-run (re-running puts the rows back
-- exactly as below).
--
-- Access: each brand page has its own checkbox in Admin → Users → Edit
-- access — section keys vip_codes_fcb, vip_codes_speakeasy,
-- vip_codes_sonoma_cider (lib/vipItemCodes.ts). Read-only in the app.

create table if not exists public.vip_item_codes (
  id uuid primary key default gen_random_uuid(),
  brand text not null check (brand in ('fcb', 'speakeasy', 'sonoma-cider')),
  item text not null,
  supplier_item_code text not null,
  vip_item_id text not null,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  unique (brand, item)
);

comment on table public.vip_item_codes is
  'FCB''s VIP item codes (from VIP''s Item Catalog): one row per current item with its Supplier Item Code (e.g. CAPH16) and VIP Item ID (e.g. 101743315), grouped by brand (fcb = Full Circle, speakeasy, sonoma-cider). Use for "what''s the VIP code / VIP item number for X". Shown on Sales > VIP Item Codes.';

alter table public.vip_item_codes enable row level security;

drop policy if exists "vip_item_codes_read" on public.vip_item_codes;
create policy "vip_item_codes_read" on public.vip_item_codes for select using (
  public.has_section(
    auth.uid(),
    case brand
      when 'fcb' then 'vip_codes_fcb'
      when 'speakeasy' then 'vip_codes_speakeasy'
      else 'vip_codes_sonoma_cider'
    end
  )
);

grant select, insert, update, delete on public.vip_item_codes to authenticated;
grant select, insert, update, delete on public.vip_item_codes to service_role;

-- The codes (Chad's file, his order within each brand).
insert into public.vip_item_codes (brand, item, supplier_item_code, vip_item_id, sort_order) values
  ('fcb', 'Capt. Hazy (Case - 12x - 19.2oz - Can)', 'CAPH19', '101743303', 1),
  ('fcb', 'Capt. Hazy (Case - 6x4 - 16oz - Can)', 'CAPH16', '101743315', 2),
  ('fcb', 'Capt. Hazy (Keg - 1/6 bbl)', 'CAPH16BBL', '101743317', 3),
  ('fcb', 'Capt. Hazy (Keg - 1/2 bbl)', 'CAPH12BBL', '101743316', 4),
  ('fcb', 'Capt. WC (Case - 12x - 19.2oz - Can)', 'CAPW19', '101755624', 5),
  ('fcb', 'Capt. WC IPA (Case - 6x4 - 16oz - Can)', 'CAPT16', '100870191', 6),
  ('fcb', 'Capt. WC (Keg - 1/6 bbl)', 'CAPT16BBL', '100870192', 7),
  ('fcb', 'Capt. WC (Keg - 1/2 bbl)', 'CAPT12BBL', '100870450', 8),
  ('fcb', 'Juicy NE IPA (Case - 12x - 19.2oz - Can)', 'JUICY19', '101504835', 9),
  ('fcb', 'Juicy NE IPA (Case - 6x4 - 16oz - Can)', 'JUICY16', '100870190', 10),
  ('fcb', 'Juicy NE IPA (Keg - 1/6 bbl)', 'JUICY16BBL', '100870212', 11),
  ('fcb', 'Juicy NE IPA (Keg - 1/2 bbl)', 'JUICY12BBL', '100870211', 12),
  ('fcb', 'Mango Bomb NE IIPA Series (Case - 12x - 19.2oz - Can)', 'MBOMB19', '101504825', 13),
  ('fcb', 'Mango Bomb NE IIPA Series (Case - 6x4 - 16oz - Can)', 'MBOMB16', '101106720', 14),
  ('fcb', 'Mango Bomb NE IIPA Series (Keg - 1/6 bbl)', 'MBOMB16BBL', '101106721', 15),
  ('fcb', 'Mango Bomb NE IIPA Series (Keg - 1/2 bbl)', 'MBOMB12BBL', '101106722', 16),
  ('fcb', 'Nectarine Pie of the Tiger (Case - 6x4 - 16oz - Can)', 'NECT16', '101586416', 17),
  ('fcb', 'Nectarine Pie of the Tiger (Keg - 1/6 bbl)', 'HHPN16BBL', '101561176', 18),
  ('fcb', 'Nectarine Pie of the Tiger (Keg - 1/2 bbl)', 'HHPN12BBL', '101561175', 19),
  ('fcb', 'Peachy Vibes (Case - 12x - 19.2oz - Can)', 'PEACHY19', '101674870', 20),
  ('fcb', 'Peachy Vibes (Case - 4x6 - 12oz - Can)', 'PEACHY12', '101743302', 21),
  ('fcb', 'Peachy Vibes (Keg - 1/6 bbl)', 'PV1/6', '101601527', 22),
  ('fcb', 'Peachy Vibes (Keg - 1/2 bbl)', 'PV1/2', '101601528', 23),
  ('speakeasy', 'Big Daddy IPA (Case - 12x - 19.2oz - Can)', 'BD192', '101715638', 1),
  ('speakeasy', 'Big Daddy IPA (Case 4x6 - 12 oz Cans)', 'DAD10', '101733316', 2),
  ('speakeasy', 'Big Daddy IPA (Keg - 1/6 bbl)', 'DAD40', '101733308', 3),
  ('speakeasy', 'Big Daddy IPA (Keg - 1/2 bbl)', 'DAD30', '101733307', 4),
  ('speakeasy', 'Mystic Haze IPA (Case - 12x - 19.2oz - Can)', 'MYH192', '101715642', 5),
  ('speakeasy', 'Mystic Haze IPA (Case 4x6 - 12 oz Cans)', 'MYH10', '101733326', 6),
  ('speakeasy', 'Mystic Haze (Keg - 1/6 bbl)', 'MYH40', '101733320', 7),
  ('speakeasy', 'Mystic Haze (Keg - 1/2 bbl)', 'MYH30', '101733318', 8),
  ('speakeasy', 'Prohibition (Case 4x6 - 12 oz Cans)', 'PRO10', '102244641', 9),
  ('speakeasy', 'Prohibition Red Ale (Keg 1/6bbl)', 'PRO40', '101733328', 10),
  ('speakeasy', 'Prohibition Red Ale (Keg 1/2 bbl)', 'PRO30', '101733327', 11),
  ('speakeasy', 'Metropolis Lager (Case 4x6 - 12 oz Cans)', 'MET12', '102244628', 12),
  ('speakeasy', 'Metropolis Lager (Keg - 1/6 bbl)', 'MET40', '102244631', 13),
  ('speakeasy', 'Metropolis Lager (Keg - 1/2 bbl)', 'MET30', '102244630', 14),
  ('sonoma-cider', 'The Pitchfork - Pear Cider (Case 6x4 - 16 oz Cans)', 'PEAR16', '101373052', 1),
  ('sonoma-cider', 'The Pitchfork - Pear Cider (Keg - 1/6 bbl)', 'PEAR16BBL', '101373053', 2),
  ('sonoma-cider', 'The Pitchfork - Pear Cider (Keg - 1/2 bbl)', 'PEAR12BBL', '101373054', 3),
  ('sonoma-cider', 'The Hatchet - Apple Cider (Case 6x4 - 16 oz Cans)', 'HAT16', '101162281', 4),
  ('sonoma-cider', 'The Hatchet - Apple Cider (Keg - 1/6 bbl)', 'HAT16BBL', '101162282', 5),
  ('sonoma-cider', 'The Hatchet - Apple Cider (Keg - 1/2 bbl)', 'HAT12BBL', '101162283', 6),
  ('sonoma-cider', 'The Sickle - Pineapple Cider (Case 6x4 - 16 oz Cans)', 'SIC16', '101644732', 7),
  ('sonoma-cider', 'The Sickle - Pineapple Cider (Keg - 1/6 bbl)', 'SIC16BBL', '101637516', 8),
  ('sonoma-cider', 'The Sickle - Pineapple Cider (Keg - 1/2 bbl)', 'SIC12BBL', '101637517', 9)
on conflict (brand, item) do update set
  supplier_item_code = excluded.supplier_item_code,
  vip_item_id = excluded.vip_item_id,
  sort_order = excluded.sort_order;

-- Check: should show fcb 23, sonoma-cider 9, speakeasy 14.
select brand, count(*) as items from public.vip_item_codes group by brand order by brand;
