-- Superior → Today's priorities → "Top 50 — we're in" / "Top 50 — not in"
-- (2026-11-13, per Chad): Superior's top 50 independent craft accounts, on and
-- off premise (Superior's "SPC Top 50 OnP Craft Accounts" + "SPC Top 50 Craft
-- Accounts", 11/12/2026). "We're in" = has ordered Full Circle / Speakeasy from
-- Superior (Superior's store sales are in LilyPad from 8/2026); "Not in" = hasn't
-- — the ones to go after. Live: an account moves to "we're in" as soon as a
-- Superior order shows up. Source list: claude/superior-top50-2026-11-13.md.
--
-- What this file adds:
--   11 stores not in the account list yet, added as Superior prospects ("SPC-" id)
--   superior_top50_accounts           the 98 accounts on the two lists (Granzella's
--                                     deli + restaurant are one account; the
--                                     list's "TRINITY LAKES --- DUPLICATE" line skipped)
--   superior_top50_list()             both lists + all-time purchase history (Export)
--   superior_top50_account(outlet)    account pop-up with ALL-TIME purchases and
--                                     ALL check-ins
-- Access: anyone who can see the Superior page.
-- Run this in Supabase's SQL Editor BEFORE pushing the code. Safe to run more than once.

insert into public.sales_accounts (outlet_id, name, address, city, state, distributor, premise, report_note) values
  ('SPC-0098C55F', 'Blue Plate (B)', '900 Newville Rd', 'Orland', 'CA', 'Superior', 'On', 'Added from Superior''s Top 50 list (11/12/2026) — not in the account list yet.'),
  ('SPC-56CB1EA0', 'Sage & Salt', '521 Main St', 'Quincy', 'CA', 'Superior', 'On', 'Added from Superior''s Top 50 list (11/12/2026) — not in the account list yet.'),
  ('SPC-F77BD0B2', 'Leon & Roys Fam Pizzeria', '231 Main Street', 'Quincy', 'CA', 'Superior', 'On', 'Added from Superior''s Top 50 list (11/12/2026) — not in the account list yet.'),
  ('SPC-F7EDA844', 'Bonus Round', '1665 Pine St', 'Redding', 'CA', 'Superior', 'On', 'Added from Superior''s Top 50 list (11/12/2026) — not in the account list yet.'),
  ('SPC-A5606133', 'Papa Dogs Taphouse &Deli', '1121 Main Street', 'Weaverville', 'CA', 'Superior', 'On', 'Added from Superior''s Top 50 list (11/12/2026) — not in the account list yet.'),
  ('SPC-7DBAE4DE', 'Crocketts Up North', '480 Main St', 'Weaverville', 'CA', 'Superior', 'On', 'Added from Superior''s Top 50 list (11/12/2026) — not in the account list yet.'),
  ('SPC-6035B6F2', 'Hallelujah Jct Market', '753-775 Hwy 70', 'Chilcoot', 'CA', 'Superior', 'Off', 'Added from Superior''s Top 50 list (11/12/2026) — not in the account list yet.'),
  ('SPC-EABAB302', 'The Branch', '7640 St Hwy  147', 'Lake Almanor', 'CA', 'Superior', 'Off', 'Added from Superior''s Top 50 list (11/12/2026) — not in the account list yet.'),
  ('SPC-DFAE90E9', 'Parkview Market', '843 Parkview Ave', 'Redding', 'CA', 'Superior', 'Off', 'Added from Superior''s Top 50 list (11/12/2026) — not in the account list yet.'),
  ('SPC-7B2CC236', 'Diamond Mtn Mini Mart', '910 Skyline Road', 'Susanville', 'CA', 'Superior', 'Off', 'Added from Superior''s Top 50 list (11/12/2026) — not in the account list yet.'),
  ('SPC-8B6B10DA', 'Mountain Market', '298 Main St', 'Weed', 'CA', 'Superior', 'Off', 'Added from Superior''s Top 50 list (11/12/2026) — not in the account list yet.')
on conflict (outlet_id) do nothing;

create table if not exists public.superior_top50_accounts (
  outlet_id text primary key references public.sales_accounts(outlet_id) on delete cascade,
  list_name text not null,
  premise text,
  list_address text,
  list_city text,
  match_note text,
  created_at timestamptz not null default now()
);

alter table public.superior_top50_accounts enable row level security;
drop policy if exists "superior_top50_accounts_read" on public.superior_top50_accounts;
create policy "superior_top50_accounts_read" on public.superior_top50_accounts for select using (
  public.sales_can_see(array['Superior'])
);
grant select on public.superior_top50_accounts to authenticated;
grant select, insert, update, delete on public.superior_top50_accounts to service_role;

comment on table public.superior_top50_accounts is
  'Superior''s top 50 independent craft accounts, on premise and off premise (Superior''s lists of 11/12/2026), matched to FCB-Data accounts. premise On/Off = which list. Shown on Distributors → Superior → Today''s priorities → "Top 50 — we''re in" (has ordered from Superior) and "Top 50 — not in" (hasn''t). Use for "which of Superior''s top accounts are we in / not in".';

insert into public.superior_top50_accounts (outlet_id, list_name, premise, list_address, list_city, match_note)
select v.* from (values
  ('2928634', 'DESERT ROSE CASINO', 'On', '901 COUNTY RD 56', 'Alturas', null),
  ('4655487', 'CHARLEWS TAP HOUSE (AND)', 'On', '1901 STATE HIGHWAY 273', 'Anderson', null),
  ('2930250', 'WOODSIDE GRILL', 'On', '4125 RIVERSIDE PL', 'Anderson', 'Woodside Grill is the restaurant at GAIA HOTEL (same address)'),
  ('1340432', 'ARBUCKLE GOLF (A)', 'On', '5918 HILLGATE ROAD', 'Arbuckle', null),
  ('4020139', 'GUMBAS 2 GO', 'On', '250 BONTA ST', 'Blairsden', null),
  ('4000916', 'THE TAP ROOM', 'On', '121 8TH STREET', 'Colusa', null),
  ('4543794', 'JAMESONS', 'On', '138 5TH STREET', 'Colusa', null),
  ('538854', 'RIVERSIDE LANES (TS)', 'On', '420 MAIN STREET', 'Colusa', null),
  ('538904', 'ROLLING HILLS CASINO', 'On', '2655 EVERETT FREEMAN WAY', 'Corning', null),
  ('4230857', 'HOPS & VINES', 'On', '20635 GAS POINT RD STE A1', 'Cottonwood', null),
  ('3659071', 'YAKS', 'On', '4917 DUNSMUIR AVENUE', 'Dunsmuir', null),
  ('4536452', 'SHELLY''S GRILL', 'On', '42889 HIGHWAY 299E', 'Fall River Mill', null),
  ('4885733', 'CALI JAYS BBQ', 'On', '7091 STATE HIGHWAY 3', 'Hayfork', null),
  ('4666258', 'HAYFORK HOTEL', 'On', '7230 HIGHWAY 3', 'Hayfork', null),
  ('3074085', 'THE OLD MERC INC', 'On', '44247 HIGHWAY 299E', 'Mcarthur', null),
  ('4552039', 'DEADWOOD SUPPLY', 'On', '408 N SHASTA BLVD', 'Mt Shasta', null),
  ('4327559', 'PIPELINE CRAFTS MT SHASTA', 'On', '320 N MT. SHASTA BLVD', 'Mt Shasta', null),
  ('4521118', 'HARVEST RESTAURANT', 'On', '1121 S MOUNT SHASTA BLVD', 'Mt Shasta', 'not SHASTA INN at the same address'),
  ('4154228', 'OH BEES HIVE (B)', 'On', '730 6TH STREET', 'Orland', 'THE HIVE KITCHEN at 730 6th St'),
  ('SPC-0098C55F', 'BLUE PLATE (B)', 'On', '900 NEWVILLE RD', 'Orland', null),
  ('1344188', 'LA CORONA (C)', 'On', '1002 6TH STREET', 'Orland', null),
  ('2929738', 'FARWOOD BAR AND GRILL(B)', 'On', '705 5TH STREET', 'Orland', null),
  ('4932162', 'CHALET VIEW LODGE', 'On', '72056 HWY 70', 'Portola', null),
  ('4694608', 'RICH BAR', 'On', '60 E MAIN STREET', 'Quincy', null),
  ('SPC-56CB1EA0', 'SAGE & SALT', 'On', '521 MAIN ST', 'Quincy', null),
  ('SPC-F77BD0B2', 'LEON & ROYS FAM PIZZERIA', 'On', '231 MAIN STREET', 'Quincy', null),
  ('4469778', 'ENJOY THE STORE LLC', 'On', '615 MAIN ST', 'Red Bluff', null),
  ('3979751', 'DOWNTOWN ALE HOUSE', 'On', '343 WALNUT ST', 'Red Bluff', null),
  ('4689742', 'POURBOY''S TAPYARD', 'On', '2040 WALDON ST', 'Redding', null),
  ('2017661', 'SUN OAKS TENNIS/FIT  (C)', 'On', '3452 ARGYLE RD', 'Redding', null),
  ('6a500a83d430e104a0e16a43', 'LOGIC CIDERBAR & ALEHOUSE', 'On', '1534 MARKET ST', 'Redding', null),
  ('4896799', 'HEADS OR TAILS', 'On', '1551 MARKET ST SUITE 120', 'Redding', null),
  ('2924100', 'ALEHOUSE PUB', 'On', '2181 HILLTOP DR', 'Redding', null),
  ('4789201', 'PIPELINE CRAFTS REDDING', 'On', '1318 CALIFORNIA ST', 'Redding', null),
  ('SPC-F7EDA844', 'BONUS ROUND', 'On', '1665 PINE ST', 'Redding', null),
  ('3905349', 'THE DIP', 'On', '1730 CALIFORNIA STREET', 'Redding', null),
  ('4862514', 'FOMO', 'On', '1416 TEHAMA STREET', 'Redding', null),
  ('4391365', 'WESTSIDE TAP & CORK', 'On', '1321 BUTTE ST STE 130', 'Redding', 'WESTSIDE VINES & HOPS at the same address'),
  ('4139971', 'FINAL DRFT BRWING COMPANY', 'On', '1600 CALIFORNIA ST', 'Redding', null),
  ('2349325', 'C.R. GIBBS AMERICAN GRILL', 'On', '2300 HILLTOP DRIVE', 'Redding', null),
  ('4082082', 'SHERATON REDDING', 'On', '820 SUNDIAL BRIDGE DRIVE', 'Redding', null),
  ('4525380', 'RAW', 'On', '2167 HILLTOP DRIVE STE A', 'Redding', null),
  ('2018096', 'THE TROPICS', 'On', '2555 S MARKET ST', 'Redding', null),
  ('SPC-A5606133', 'PAPA DOGS TAPHOUSE &DELI', 'On', '1121 MAIN STREET', 'Weaverville', null),
  ('SPC-7DBAE4DE', 'CROCKETTS UP NORTH', 'On', '480 MAIN ST', 'Weaverville', null),
  ('3994771', 'NEW YORK SALOON', 'On', '533 MAIN ST', 'Weaverville', null),
  ('1343274', 'GRANZELLA''S DELI / GRANZELLA''S RESTAURANT', 'On', '451 6TH STREET', 'Williams', null),
  ('1341374', 'CASA RAMOS-WILLOWS (B)', 'On', '458 NORTH HUMBOLT AVENUE', 'Willows', 'CASA RAMOS Willows is listed at 247 N Humboldt in the app'),
  ('4835847', 'YAWTZEE (B)', 'On', '222 W WALNUT ST', 'Willows', null),
  ('530570', 'FOUR CORNERS MARKET', 'Off', '1077 N. MAIN STREET', 'Alturas', null),
  ('533537', 'DUFFYS LIQUORS', 'Off', '2182 NORTH ST', 'Anderson', null),
  ('1340431', 'ARBUCKLE FOOD (A)', 'Off', '575 AMANDA ST.', 'Arbuckle', null),
  ('533013', 'CORNER STORE- CHESTER', 'Off', '189 MAIN STREET', 'Chester', null),
  ('4036164', 'GOODWINS GEN STORE', 'Off', '94139 HIGHWAY 70', 'Chilcoot', null),
  ('SPC-6035B6F2', 'HALLELUJAH JCT MARKET', 'Off', '753-775 HWY 70', 'Chilcoot', null),
  ('3429420', 'OLIVE PIT', 'Off', '2156 SOLANO ST', 'Corning', null),
  ('4624869', 'CIRCLE K - SUNSHINE (F)', 'Off', '3505 RHONDA WAY', 'Cottonwood', 'CIRCLE K at 3505 Rhonda (SUNSHINE GAS & FOOD 3308325 same address, older)'),
  ('3408111', 'MANFREDI FOOD - GAS DEPOT', 'Off', '6920 DUNSMUIR AVE', 'Dunsmuir', null),
  ('534715', 'GRAEAGLE STORE', 'Off', '7386 CA-89', 'Graeagle', null),
  ('538076', 'PENINSULA MARKET', 'Off', '309 PENINSULA DRIVE', 'Lake Almanor', null),
  ('SPC-EABAB302', 'THE BRANCH', 'Off', '7640 ST HWY  147', 'Lake Almanor', null),
  ('4318042', 'SHELL LAKEHEAD GAS & FOOD', 'Off', '20749 LAKESHORE DR', 'Lakehead', 'SHELL FOOD MART at the same address'),
  ('4331438', 'SMOKEHOUSE MARKET', 'Off', '4391 TRINITY DAM BLVD', 'Lewiston', null),
  ('536935', 'MCCLOUD MARKET', 'Off', '117 BROADWAY', 'Mccloud', null),
  ('531562', 'BERRYVALE GROCERY', 'Off', '305 S MT SHASTA BLVD', 'Mt Shasta', null),
  ('532212', 'CANNONS MARKET', 'Off', '1004 S MT SHASTA BLV', 'Mt Shasta', null),
  ('4411611', 'LAKE ST MINI MART', 'Off', '411 W LAKE ST', 'Mt Shasta', '76 station at 411 W Lake St'),
  ('2907471', 'RED & WHITE MARKET', 'Off', '141 COMMERCIAL ST', 'Portola', 'RED & WHITE at 165 Commercial (list says 141)'),
  ('3618968', 'FR FOOD COOP', 'Off', '60 N PINE ST', 'Portola', null),
  ('4708500', 'MOUNTAIN MRKT & GAS', 'Off', '196 E SIERRA AVE', 'Portola', null),
  ('4594425', 'PORTOLA MARKET', 'Off', '16 E. SIERRA STREET', 'Portola', 'PORTOLA FUELS at 16 E Sierra'),
  ('4943349', 'QUINCY NATURAL FOODS', 'Off', '269 MAIN STREET', 'Quincy', 'FEATHER RIVER FOOD COOP at 269 Main St (QUINCY NATURAL FOODS 1346386 same address, older name)'),
  ('1345673', 'ONE STOP GAS & GROCERY', 'Off', '2003 EAST MAIN ST', 'Quincy', null),
  ('4560442', 'QUINCY MARKET & GAS', 'Off', '98 EAST MAIN', 'Quincy', null),
  ('1341730', 'CIRCLE 7 DAYS FOOD', 'Off', '1055 WALNUT STREET', 'Red Bluff', null),
  ('1345552', 'NUMBER ONE STOP', 'Off', '714 WALNUT ST', 'Red Bluff', null),
  ('2143835', 'LIQUOR BARN REDDING', 'Off', '2611 HILLTOP DR', 'Redding', null),
  ('2937944', 'REDDING EXPRESS STOP', 'Off', '1220 SHASTA ST', 'Redding', 'VALERO at 1220 Shasta St'),
  ('SPC-DFAE90E9', 'PARKVIEW MARKET', 'Off', '843 PARKVIEW AVE', 'Redding', null),
  ('2348271', 'BONNYVIEW MARKET', 'Off', '5110 E BONNYVIEW RD', 'Redding', null),
  ('4763994', 'WESTSIDE MARKET', 'Off', '4560 WESTSIDE RD', 'Redding', null),
  ('2354705', 'SPORTSMANS EXPRESS', 'Off', '14385 WONDERLAND BLVD', 'Redding', null),
  ('2928846', 'DOWNTOWN MARKET', 'Off', '1821 PLACER ST', 'Redding', null),
  ('1949197', 'ORCHARD NUTRITION CTR 2', 'Off', '221 LOCUST STREET', 'Redding', null),
  ('4383210', 'VALERO-RDG BALLPARK  (B)', 'Off', '1275 CHURN CREEK RD', 'Redding', null),
  ('4851967', 'CHEVRON EM GOLD BEAR MINI MART #6015', 'Off', '29422 HWAY 299 E', 'Round Mountain', null),
  ('1342766', 'FARMER''S MARKET PLACE', 'Off', '4525 SHASTA DAM BL', 'Shasta Lake', null),
  ('SPC-7B2CC236', 'DIAMOND MTN MINI MART', 'Off', '910 SKYLINE ROAD', 'Susanville', null),
  ('1343935', 'JOHNSTONVILLE QUALITY FD', 'Off', '472-850 JOHNSTONVILLE RD', 'Susanville', '472 Johnstonville Rd'),
  ('2939962', 'TRINITY LAKES KOA HOLIDAY', 'Off', '60260 CALIFORNIA 3', 'Trinity Center', 'KOA (Trinity Center)'),
  ('1344418', 'LAYTONS LIQUOR', 'Off', '39 S WEED BLVD', 'Weed', null),
  ('SPC-8B6B10DA', 'MOUNTAIN MARKET', 'Off', '298 MAIN ST', 'Weed', null),
  ('4239943', 'LIQUOR WAREHOUSE WEED', 'Off', '420 ALAMO AVE', 'Weed', null),
  ('4286955', 'WESTWOOD  Y  MARKET', 'Off', '671-475 CA-36', 'Westwood', 'SUPER Y MARKET'),
  ('1349061', 'WESTWOOD FOODMART', 'Off', '671-585 HIGHWAY 36', 'Westwood', 'WESTWOOD QUIK MART'),
  ('1345742', 'ORV''S COUNTRY STORE (A)', 'Off', '180 N. VIRGINIA AVE', 'Williams', null),
  ('1342984', 'FREEWAY BOTTLE SHOP', 'Off', '1212 W WOOD ST', 'Willows', null),
  ('4068853', 'YREKA LIQUOR LAND', 'Off', '100 MONTAGUE ROAD', 'Yreka', null)
) as v(outlet_id, list_name, premise, list_address, list_city, match_note)
where exists (select 1 from public.sales_accounts a where a.outlet_id = v.outlet_id)
on conflict (outlet_id) do update set
  list_name = excluded.list_name, premise = excluded.premise, list_address = excluded.list_address,
  list_city = excluded.list_city, match_note = excluded.match_note;

-- ---------------------------------------------------------------------------
-- Both lists + all-time history for Export. Accounts removed with "Remove from
-- lists" are left out.
-- ---------------------------------------------------------------------------
create or replace function public.superior_top50_list()
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
  with t as (
    select b.*
    from public.superior_top50_accounts b
    where not exists (select 1 from public.sales_account_off o where o.outlet_id = b.outlet_id)
  ),
  hist as (
    select s.outlet_id, s.month, s.product, coalesce(s.size, '') as size, coalesce(s.distributor, '') as dist,
      round(sum(s.ce), 2) as ce, max(s.last_buy_date) as last_buy
    from public.sales_account_sales s
    join t on t.outlet_id = s.outlet_id
    group by 1, 2, 3, 4, 5
  )
  select json_build_object(
    'as_of', (select m.as_of from public.sales_data_meta m where m.id = 1),
    'accounts', (select coalesce(json_agg(x order by x.lifetime_ce desc nulls last, x.name), '[]'::json) from (
        select t.outlet_id, a.name, a.city, a.address, a.phone,
          coalesce(nullif(a.premise, ''), t.premise) as premise, t.premise as list_premise,
          t.list_name,
          (select max(coalesce(h.last_buy, h.month)) from hist h where h.outlet_id = t.outlet_id and h.dist = 'Superior') as superior_last,
          (select max(coalesce(h.last_buy, h.month)) from hist h where h.outlet_id = t.outlet_id) as last_buy,
          (select h.dist from hist h where h.outlet_id = t.outlet_id order by coalesce(h.last_buy, h.month) desc limit 1) as last_dist,
          (select round(sum(h.ce), 1) from hist h where h.outlet_id = t.outlet_id) as lifetime_ce,
          (select max(k.checkin_date) from public.sales_account_checkins k where k.outlet_id = t.outlet_id) as last_checkin,
          (select count(*) from public.sales_account_contacts c where c.outlet_id = t.outlet_id) as contacts
        from t join public.sales_accounts a on a.outlet_id = t.outlet_id) x),
    'history', (select coalesce(json_agg(h order by h.outlet_id, h.month desc, h.ce desc), '[]'::json) from hist h)
  ) into result;
  return result;
end;
$$;
revoke all on function public.superior_top50_list() from public, anon;
grant execute on function public.superior_top50_list() to authenticated;
comment on function public.superior_top50_list() is
  $c$[needs:dist_superior] Superior's top 50 on- and off-premise craft accounts: name, city, which list, last Superior order (null = not in yet), last order and who from, CEs all time, last check-in, contacts count — plus every month of what they bought, all time.$c$;

-- ---------------------------------------------------------------------------
-- Account pop-up: ALL-TIME purchases (with who sold it) and ALL check-ins.
-- ---------------------------------------------------------------------------
create or replace function public.superior_top50_account(p_outlet text)
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
      (public.sales_can_see(array['Superior']) and exists (select 1 from public.superior_top50_accounts b where b.outlet_id = p_outlet))
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
revoke all on function public.superior_top50_account(text) from public, anon;
grant execute on function public.superior_top50_account(text) to authenticated;
comment on function public.superior_top50_account(text) is
  $c$[needs:dist_superior] One of Superior's top 50 accounts: address, phone, last order, every month of what it bought all time (and which distributor sold it), every check-in, contacts.$c$;
