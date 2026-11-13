-- Superior → Today's priorities → "Superior non buy from Saccani accounts"
-- (2026-11-13, per Chad): accounts that bought FC / Speakeasy from Saccani
-- (closed) and have NOT bought those items from Superior — from Superior's
-- "Full Circle - Saccani Buying Accounts - SPC Non Buy" list (11/12/2026).
-- Source + comparison: claude/saccani-vs-superior-2026-11-13.md.
--
-- What this file adds:
--   superior_saccani_nonbuy_accounts        the 35 accounts on Superior's list,
--                                           matched to FCB-Data accounts (34;
--                                           WEED LIQUOR DEPOT not found)
--   superior_saccani_nonbuy_list()          the live list + all-time purchase
--                                           history (for Export)
--   superior_saccani_nonbuy_account(outlet) the account pop-up for one of them,
--                                           with ALL-TIME purchases and ALL check-ins
--
-- An account drops off the list when it's removed with "Remove from lists", or
-- when a Superior sale dated after 11/12/2026 shows up in LilyPad (Superior's
-- store sales aren't in LilyPad yet).
-- Access: anyone who can see the Superior page.
--
-- Run this in Supabase's SQL Editor BEFORE pushing the code.
-- Idempotent — safe to run more than once.

create table if not exists public.superior_saccani_nonbuy_accounts (
  outlet_id text primary key references public.sales_accounts(outlet_id) on delete cascade,
  list_name text not null,
  county text,
  premise text,
  nonbuy_units numeric,
  saccani_units numeric,
  nonbuy_items text,
  created_at timestamptz not null default now()
);

alter table public.superior_saccani_nonbuy_accounts enable row level security;
drop policy if exists "superior_saccani_nonbuy_accounts_read" on public.superior_saccani_nonbuy_accounts;
create policy "superior_saccani_nonbuy_accounts_read" on public.superior_saccani_nonbuy_accounts for select using (
  public.sales_can_see(array['Superior'])
);
grant select on public.superior_saccani_nonbuy_accounts to authenticated;
grant select, insert, update, delete on public.superior_saccani_nonbuy_accounts to service_role;

comment on table public.superior_saccani_nonbuy_accounts is
  'Saccani accounts not buying from Superior — Saccani (closed) was FCB''s distributor in these northern CA counties; Superior took them over. From Superior''s "SPC Non Buy" list of 11/12/2026: accounts that bought FC / Speakeasy from Saccani and have not bought those items from Superior. nonbuy_units = Saccani cases/kegs not bought from Superior, saccani_units = everything they bought from Saccani on that list, nonbuy_items = which items. Shown on Distributors → Superior → Today''s priorities → "Superior non buy from Saccani accounts". Use for "which Saccani accounts aren''t buying from Superior".';

insert into public.superior_saccani_nonbuy_accounts (outlet_id, list_name, county, premise, nonbuy_units, saccani_units, nonbuy_items)
select v.* from (values
  ('4339388', 'YREKA FOOD GAS', 'Siskiyou', 'Off', 16, 16, 'Big Daddy IPA 19.2oz ×5; Capt. WC IPA 19.2oz ×4; Mystic Haze IPA 19.2oz ×4; Mango Bomb 19.2oz ×3'),
  ('4236055', 'PIT 76', 'Modoc', 'Off', 9, 9, 'Capt. Hazy IPA 16oz 4-pk ×4; Capt. WC IPA 16oz 4-pk ×3; Juicy IPA 16oz 4-pk ×2'),
  ('1345742', 'ORV''S SHELL', 'Colusa', 'Off', 6, 7, 'Capt. Hazy IPA 16oz 4-pk ×2; Peachy Vibes 12oz 6-pk ×1; Capt. WC IPA 16oz 4-pk ×1; Mango Bomb 16oz 4-pk ×1; Nectar Pie of the Tiger 16oz 4-pk ×1; Big Daddy IPA 19.2oz ×1'),
  ('2877003', 'WAYSIDE INN MARKET', 'Lassen', 'Off', 6, 6, 'Capt. WC IPA 19.2oz ×3; Big Daddy IPA 19.2oz ×2; Capt. Hazy IPA 19.2oz ×1'),
  ('538904', 'ROLLING HILLS CASINO', 'Tehama', 'On', 6, 6, 'Big Daddy IPA 12oz 6-pk ×5; Big Daddy IPA 1/2 bbl ×1'),
  ('2861999', 'SHASTA VIEW CHEVRON', 'Shasta', 'Off', 5, 5, 'Mango Bomb 19.2oz ×5'),
  ('532597', 'ALTURAS CHEVRON_2', 'Modoc', 'Off', 4, 4, 'Capt. Hazy IPA 16oz 4-pk ×2; Juicy IPA 16oz 4-pk ×1; Nectar Pie of the Tiger 16oz 4-pk ×1'),
  ('4286955', 'SUPER Y MARKET', 'Lassen', 'Off', 4, 4, 'Peachy Vibes 12oz 6-pk ×4'),
  ('4536452', 'SHELLY''S GRILL', 'Shasta', 'Off', 4, 4, 'Capt. Hazy IPA 16oz 4-pk ×4'),
  ('1349061', 'WESTWOOD FOOD MART', 'Lassen', 'Off', 4, 4, 'Capt. Hazy IPA 19.2oz ×2; Capt. WC IPA 19.2oz ×1; Mango Bomb 19.2oz ×1'),
  ('533013', 'CORNER STORE_2', 'Plumas', 'Off', 3, 3, 'Mystic Haze IPA 19.2oz ×2; Big Daddy IPA 19.2oz ×1'),
  ('4500528', 'SUSANVILLE FOOD MART', 'Lassen', 'Off', 3, 3, 'Big Daddy IPA 19.2oz ×2; Mystic Haze IPA 19.2oz ×1'),
  ('531837', 'BOTTLE SHOP, THE', 'Modoc', 'Off', 2, 2, 'Capt. Hazy IPA 19.2oz ×1; Capt. WC IPA 19.2oz ×1'),
  ('4211236', 'CHESTER MINI MART', 'Plumas', 'Off', 2, 2, 'Capt. WC IPA 19.2oz ×1; Big Daddy IPA 19.2oz ×1'),
  ('4383210', 'BALL PARK FOOD AND GAS', 'Shasta', 'Off', 2, 2, 'Mango Bomb 19.2oz ×1; Peachy Vibes 12oz 6-pk ×1'),
  ('4636481', 'BEVERAGE HOUSE LIQUOR #13', 'Glenn', 'Off', 2, 2, 'Capt. WC IPA 16oz 4-pk ×1; Mango Bomb 16oz 4-pk ×1'),
  ('3194194', 'BROWNING STREET MINI MART', 'Shasta', 'Off', 2, 2, 'Mango Bomb 19.2oz ×2'),
  ('1345552', 'ONE STOP GAS_2', 'Tehama', 'Off', 2, 2, 'Mango Bomb 19.2oz ×1; Nectar Pie of the Tiger 16oz 4-pk ×1'),
  ('1348001', 'SUPER SHOPPER', 'Glenn', 'Off', 2, 2, 'Capt. WC IPA 16oz 4-pk ×1; Capt. WC Pale Ale 16oz 4-pk ×1'),
  ('3363544', 'JANESVILLE CHEVRON', 'Lassen', 'Off', 2, 2, 'Capt. WC IPA 19.2oz ×2'),
  ('535379', 'JANESVILLE PAYLESS', 'Lassen', 'Off', 2, 2, 'Capt. Hazy IPA 19.2oz ×1; Capt. WC IPA 19.2oz ×1'),
  ('531095', 'AMMIRATI''S MARKET', 'Shasta', 'Off', 1, 1, 'Mango Bomb 19.2oz ×1'),
  ('1344418', 'LAYTON''S LIQUORS', 'Siskiyou', 'Off', 1, 1, 'Capt. Hazy IPA 19.2oz ×1'),
  ('2894963', 'BOB''S LIQUORS', 'Shasta', 'Off', 1, 1, 'Big Daddy IPA 12oz 6-pk ×1'),
  ('1340431', 'ARBUCKLE FOOD CENTER', 'Colusa', 'Off', 1, 1, 'Capt. WC Pale Ale 16oz 4-pk ×1'),
  ('1342984', 'FREEWAY BOTTLE SHOP', 'Glenn', 'Off', 1, 1, 'Peachy Vibes 19.2oz ×1'),
  ('2894955', 'CORNER MART', 'Trinity', 'On', 2, 2, 'Illa Vanilla 16oz 4-pk ×1; Mystic Haze IPA 1/6 bbl ×1'),
  ('3023112', 'LIQUOR EXPO', 'Siskiyou', 'Off', 1, 1, 'Nectar Pie of the Tiger 16oz 4-pk ×1'),
  ('536272', 'LEWISTON HOTEL', 'Trinity', 'On', 14, 14, 'Peachy Vibes 1/6 bbl ×14'),
  ('4327559', 'PIPELINE, THE', 'Siskiyou', 'On', 10, 10, 'Nectar Pie of the Tiger 1/2 bbl ×10'),
  ('4694608', 'RICH BAR', 'Plumas', 'On', 6, 6, 'Peachy Vibes Wheat 1/2 bbl ×3; Beachy Vibes Blonde Ale 1/2 bbl ×1; Capt. Hazy IPA 1/2 bbl ×1; Hazy Beach IPA 1/2 bbl ×1'),
  ('3731032', 'HANDSOME JOHNS', 'Siskiyou', 'On', 5, 5, 'Peachy Vibes 1/6 bbl ×3; Capt. WC IPA 1/2 bbl ×1; Big Daddy IPA 1/2 bbl ×1'),
  ('4655487', 'CHARLES TAP HOUSE', 'Shasta', 'On', 3, 3, 'Capt. WC IPA 1/6 bbl ×1; Peachy Vibes 1/6 bbl ×1; Prohibition Red Ale 1/6 bbl ×1'),
  ('2017959', 'THE SHACK', 'Shasta', 'On', 2, 2, 'Peachy Vibes Wheat 1/2 bbl ×1; Capt. WC IPA 1/6 bbl ×1')
) as v(outlet_id, list_name, county, premise, nonbuy_units, saccani_units, nonbuy_items)
where exists (select 1 from public.sales_accounts a where a.outlet_id = v.outlet_id)
on conflict (outlet_id) do update set
  list_name = excluded.list_name, county = excluded.county, premise = excluded.premise,
  nonbuy_units = excluded.nonbuy_units, saccani_units = excluded.saccani_units, nonbuy_items = excluded.nonbuy_items;

-- ---------------------------------------------------------------------------
-- The live list (Today's priorities button) + all-time history for Export.
-- Same shape as markstein_old_bad_list() so the page shows it the same way.
-- ---------------------------------------------------------------------------
create or replace function public.superior_saccani_nonbuy_list()
returns json
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  result json;
begin
  if not public.sales_can_see(array['Superior']) then
    raise exception 'You don''t have access to the Superior page.';
  end if;
  with lost as (
    select b.*
    from public.superior_saccani_nonbuy_accounts b
    where not exists (
        select 1 from public.sales_account_sales s
        where s.outlet_id = b.outlet_id and s.distributor = 'Superior'
          and coalesce(s.last_buy_date, (s.month + interval '1 month' - interval '1 day')::date) > date '2026-11-12')
      and not exists (select 1 from public.sales_account_off o where o.outlet_id = b.outlet_id)
  ),
  hist as (
    select s.outlet_id, s.month, s.product, coalesce(s.size, '') as size, coalesce(s.distributor, '') as dist,
      round(sum(s.ce), 2) as ce, max(s.last_buy_date) as last_buy
    from public.sales_account_sales s
    join lost l on l.outlet_id = s.outlet_id
    group by 1, 2, 3, 4, 5
  )
  select json_build_object(
    'as_of', (select m.as_of from public.sales_data_meta m where m.id = 1),
    'accounts', (select coalesce(json_agg(x order by x.lifetime_ce desc nulls last, x.name), '[]'::json) from (
        select l.outlet_id, a.name, a.city, a.address, a.phone,
          coalesce(nullif(a.premise, ''), l.premise) as premise,
          l.list_name as bad_name, l.nonbuy_units as bad_units_2023, l.nonbuy_items as note,
          (select max(coalesce(h.last_buy, h.month)) from hist h where h.outlet_id = l.outlet_id) as last_buy,
          (select h.dist from hist h where h.outlet_id = l.outlet_id order by coalesce(h.last_buy, h.month) desc limit 1) as last_dist,
          (select round(sum(h.ce), 1) from hist h where h.outlet_id = l.outlet_id) as lifetime_ce,
          (select max(k.checkin_date) from public.sales_account_checkins k where k.outlet_id = l.outlet_id) as last_checkin,
          (select count(*) from public.sales_account_contacts c where c.outlet_id = l.outlet_id) as contacts
        from lost l join public.sales_accounts a on a.outlet_id = l.outlet_id) x),
    'history', (select coalesce(json_agg(h order by h.outlet_id, h.month desc, h.ce desc), '[]'::json) from hist h)
  ) into result;
  return result;
end;
$$;
revoke all on function public.superior_saccani_nonbuy_list() from public, anon;
grant execute on function public.superior_saccani_nonbuy_list() to authenticated;
comment on function public.superior_saccani_nonbuy_list() is
  $c$[needs:dist_superior] Saccani accounts not buying from Superior (Superior's 11/12/2026 non-buy list): name, city, premise, what they're not buying from Superior, last order and who from, CEs all time, last check-in, contacts count — plus every month of what they bought, all time.$c$;

-- ---------------------------------------------------------------------------
-- Account pop-up for one of them: ALL-TIME purchases (with who sold it) and
-- ALL check-ins. Same shape as markstein_old_bad_account().
-- ---------------------------------------------------------------------------
create or replace function public.superior_saccani_nonbuy_account(p_outlet text)
returns json
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_dist text;
  result json;
begin
  select a.distributor into v_dist from public.sales_accounts a where a.outlet_id = p_outlet;
  if v_dist is null or not (
      (public.sales_can_see(array['Superior']) and exists (select 1 from public.superior_saccani_nonbuy_accounts b where b.outlet_id = p_outlet))
      or public.has_section(auth.uid(), 'accounts')
      or public.sales_can_see(array[v_dist])) then
    raise exception 'You don''t have access to this account.';
  end if;
  select json_build_object(
    'account', (select json_build_object('outlet_id', a.outlet_id, 'name', a.name, 'address', a.address, 'city', a.city,
        'zip', a.zip, 'phone', a.phone, 'distributor', a.distributor, 'premise', a.premise, 'last_buy', a.last_buy_date,
        'first_buy', a.first_buy_date, 'ce_12mo', a.ce_12mo, 'lifetime_ce', a.lifetime_ce)
      from public.sales_accounts a where a.outlet_id = p_outlet),
    'as_of', (select m.as_of from public.sales_data_meta m where m.id = 1),
    'all_time', true,
    'sales', (select coalesce(json_agg(x order by x.month desc, x.ce desc), '[]'::json) from (
        select s.month, s.product, coalesce(s.size, '') as size, coalesce(s.distributor, '') as dist,
          round(sum(s.ce), 1) as ce, max(s.last_buy_date) as last_buy
        from public.sales_account_sales s
        where s.outlet_id = p_outlet
        group by 1, 2, 3, 4) x),
    'checkins', (select coalesce(json_agg(x order by x.checkin_date desc), '[]'::json) from (
        select k.checkin_date, k.rep, k.activity, k.notes, k.brands, k.contact
        from public.sales_account_checkins k where k.outlet_id = p_outlet) x),
    'contacts', (select coalesce(json_agg(x order by x.name nulls last), '[]'::json) from (
        select c.name, c.title, c.phone, c.mobile, c.email, c.notes
        from public.sales_account_contacts c where c.outlet_id = p_outlet) x)
  ) into result;
  return result;
end;
$$;
revoke all on function public.superior_saccani_nonbuy_account(text) from public, anon;
grant execute on function public.superior_saccani_nonbuy_account(text) to authenticated;
comment on function public.superior_saccani_nonbuy_account(text) is
  $c$[needs:dist_superior] One Saccani-not-buying-from-Superior account's details: address, phone, last order, every month of what it bought all time (and which distributor sold it), every check-in, contacts.$c$;
