-- Markstein → Today's priorities → "Old Bay Area Distributing accounts"
-- (2026-11-12, per Chad): accounts that bought from Bay Area Distributing (BAD,
-- FCB's old East Bay distributor — the 2023 top-40 on + off premise lists) and
-- have NOT bought from Markstein since Markstein took over (8/1/2024). Lost
-- accounts for James to go after. Plan: claude/bad-accounts-vs-markstein-2026-11-12.md.
--
-- What this file adds:
--   markstein_old_bad_accounts          the 2023 BAD list, matched to FCB-Data
--                                       accounts (79 outlet IDs; G1 Liquor has 2).
--                                       Doc's Refresher + Z's Tavern aren't in
--                                       FCB-Data, so they're not here.
--   markstein_old_bad_list()            the live list: accounts on the table with
--                                       no Markstein sale since 8/1/2024 and not
--                                       removed from lists, + their all-time
--                                       purchase history (for Export)
--   markstein_old_bad_account(outlet)   the account pop-up for one of them, with
--                                       ALL-TIME purchases and ALL check-ins
--
-- Sales before 8/1/2024 that FCB-Data labels "Markstein" were Bay Area
-- Distributing — both functions show them as "Bay Area Distributing".
-- Access: anyone who can see the Markstein page (or the Sales Dashboard) —
-- including the 7 accounts LilyPad files under Geyser / Breakthru.
--
-- Run this in Supabase's SQL Editor BEFORE pushing the code.
-- Idempotent — safe to run more than once.

create table if not exists public.markstein_old_bad_accounts (
  outlet_id text primary key references public.sales_accounts(outlet_id) on delete cascade,
  bad_name text not null,
  premise text,
  bad_address text,
  bad_city text,
  bad_units_2023 numeric,
  created_at timestamptz not null default now()
);

alter table public.markstein_old_bad_accounts enable row level security;
drop policy if exists "markstein_old_bad_accounts_read" on public.markstein_old_bad_accounts;
create policy "markstein_old_bad_accounts_read" on public.markstein_old_bad_accounts for select using (
  public.sales_can_see(array['Markstein'])
);
grant select on public.markstein_old_bad_accounts to authenticated;
grant select, insert, update, delete on public.markstein_old_bad_accounts to service_role;

comment on table public.markstein_old_bad_accounts is
  'Old Bay Area Distributing (BAD) accounts — FCB''s 2023 top-40 on- and off-premise East Bay accounts from BAD, matched to FCB-Data accounts (outlet_id). Markstein took over the territory 8/1/2024. Shown on Distributors → Markstein → Today''s priorities → "Old Bay Area Distributing accounts" when they have not bought from Markstein since then (lost accounts). bad_units_2023 = units BAD sold them 1/1–4/30/2023. Use for "which old Bay Area accounts haven''t bought from Markstein".';

insert into public.markstein_old_bad_accounts (outlet_id, bad_name, premise, bad_address, bad_city, bad_units_2023)
select v.* from (values
  ('2142885', 'COSTCO #118 SAN LEANDRO', 'OFF', '1900 DAVIS STREET', 'SAN LEANDRO', 100),
  ('1341948', 'COSTCO #482 RICHMOND', 'OFF', '4801 CENTRAL AVENUE', 'RICHMOND', 55),
  ('2142880', 'COSTCO #146 LIVERMORE', 'OFF', '2800 INDEPENDENCE DRIVE', 'LIVERMORE', 50),
  ('3149997', 'COSTCO #1061 HAYWARD', 'OFF', '28505 HESPERIAN BLVD', 'HAYWARD', 50),
  ('3998631', 'TOTAL WINE #1118 P-HILL', 'OFF', '3250 BUSKIRK AVENUE', 'PLEASANT HILL', 20),
  ('2215330', 'WOODMINSTER MARKET', 'OFF', '5000 WOODMINSTER', 'OAKLAND', 14),
  ('3947884', 'TOTAL WINE #1115 FREMONT', 'OFF', '43484 BOSCELL ROAD', 'FREMONT', 12),
  ('4052116', 'TOTAL WINE #1121 PLSNTN', 'OFF', '4225 ROSEWOOD DRIVE', 'PLEASANTON', 11),
  ('4929649', 'G 1 LIQUOR', 'OFF', '7980 MOUNTAIN BLVD', 'OAKLAND', 9),
  ('4587457', 'G 1 LIQUOR', 'OFF', '7980 MOUNTAIN BLVD', 'OAKLAND', 9),
  ('3980928', 'BEV MO #180 LAFAYETTE', 'OFF', '3590 MT DIABLO BLVD', 'LAFAYETTE', 9),
  ('4376370', 'CASTRO VALLEY NATURAL', 'OFF', '3295 CASTRO VALLEY BLVD', 'CASTRO VALLEY', 9),
  ('2144651', 'SAFEWAY #1197(UNIONCITY)', 'OFF', '1790 DECOTO ROAD', 'UNION CITY', 9),
  ('3948153', 'GROCERY OUTLET-ALAMEDA', 'OFF', '730 BUENA VISTA AVENUE', 'ALAMEDA', 8),
  ('2017097', 'SAFEWAY #1224(JARVIS)', 'OFF', '5877 JARVIS STREET', 'NEWARK', 8),
  ('96297', 'BEV MO #26 ORINDA', 'OFF', '6 CAMINO PABLO', 'ORINDA', 8),
  ('2915444', 'BEV MO #70 (WC)', 'OFF', '2220 OAK GROVE ROAD', 'WALNUT CREEK', 8),
  ('2017075', 'SAFEWAY #768(REDWOOD)', 'OFF', '20629 REDWOOD ROAD', 'CASTRO VALLEY', 8),
  ('4047850', 'TOTAL WINE #1124 SNRAMON', 'OFF', '3161 CROW CANYON PL', 'SAN RAMON', 7),
  ('96318', 'BEV MO #5 OAKLAND', 'OFF', '525 EMBARCADERO', 'OAKLAND', 7),
  ('3593957', 'BEV MO #158 SAN LEANDRO', 'OFF', '15100 HESPERIAN BLVD#400A', 'SAN LEANDRO', 7),
  ('2144874', 'STATE MARKET', 'OFF', '707 WILLOW STREET', 'OAKLAND', 7),
  ('538512', 'RALEY S #304', 'OFF', '2077 MAIN STREET', 'OAKLEY', 6),
  ('2348397', 'C & C FOOD & LIQ - CHECK', 'OFF', '43100 SUMTER AVENUE', 'FREMONT', 6),
  ('535619', 'KELLER MARKET', 'OFF', '4400 KELLER AVENUE #100', 'OAKLAND', 6),
  ('2739980', 'BEV MO #55 FREMONT', 'OFF', '5171 MOWRY AVENUE', 'FREMONT', 6),
  ('2904732', 'ASA LIQUORS(CASH ONLY)', 'OFF', '5909 MARKET STREET', 'OAKLAND', 6),
  ('539106', 'SAFEWAY #955(WILLOW PASS)', 'OFF', '2600 WILLOW PASS ROAD', 'CONCORD', 6),
  ('4600538', 'OFFICE LIBATIONS', 'OFF', '562 WHITNEY ST', 'SAN LEANDRO', 6),
  ('2214224', 'SAFEWAY #2870(COLLEGE)', 'OFF', '6310 COLLEGE AVENUE', 'OAKLAND', 6),
  ('3763883', 'GROCERY OUTLET-OAKLEY', 'OFF', '3110 MAIN STREET', 'OAKLEY', 6),
  ('4317334', 'THE WINE NOIRE', 'OFF', '2001 ADDISON STREET #300', 'BERKELEY', 6),
  ('1949189', 'SAFEWAY #1215(BAILEY)', 'OFF', '660 BAILEY ROAD', 'BAY POINT', 6),
  ('4433066', 'SAFEWAY #2874(HERCULES)', 'OFF', '4040 SAN PABLO AVENUE', 'HERCULES', 6),
  ('2722687', 'SAFEWAY #994(WASHINGTON)', 'OFF', '1499 WASHINGTON AVENUE', 'SAN LEANDRO', 5),
  ('2017085', 'SAFEWAY #971(FOOTHILL)', 'OFF', '22280 FOOTHILL BLVD', 'HAYWARD', 5),
  ('2144652', 'SAFEWAY #967(ORINDA)', 'OFF', '2 CAMINO SOBRANTE', 'ORINDA', 5),
  ('2214311', 'SAVEMORE LIQUOR', 'OFF', '1333 PERALTA STREET', 'OAKLAND', 5),
  ('531733', 'BLUE & GOLD LIQ CASH', 'OFF', '1811 14TH AVENUE', 'OAKLAND', 5),
  ('2739977', 'BEV MO #61 PINOLE', 'OFF', '1220 FITZGERALD DRIVE', 'PINOLE', 5),
  ('2907410', 'P & M LIQUOR', 'OFF', '1405 34TH STREET', 'OAKLAND', 5),
  ('4107544', 'ELBO ROOM JACK LONDON', 'ON', '311 BROADWAY', 'OAKLAND', 29),
  ('3980916', 'STAY GOLD DELI', 'ON', '2633-2635 SAN PABLO AVE', 'OAKLAND', 15),
  ('540314', 'TILDEN PARK GOLF COURSE', 'ON', '10 GOLF COURSE DRIVE', 'BERKELEY', 10),
  ('538077', 'PENNINI S', 'ON', '1375 MORAGA ROAD # B', 'MORAGA', 10),
  ('2921420', 'MERCHANTS SALOON', 'ON', '401 SECOND STREET', 'OAKLAND', 9),
  ('531506', 'BEER BEER & MORE BEER', 'ON', '995 DETROIT AVENUE #G', 'CONCORD', 7),
  ('2355677', 'V & E CLUB', 'ON', '2071 FIRST STREET', 'LIVERMORE', 6),
  ('3981200', 'PORT BAR', 'ON', '2023 BROADWAY', 'OAKLAND', 5),
  ('535798', 'QUINNS LIGHTHOUSE', 'ON', '1951 EMBARCADERO', 'OAKLAND', 5),
  ('3728555', 'CLOVE & HOOF', 'ON', '4001 BROADWAY', 'OAKLAND', 4),
  ('4403385', 'LIMITLESS AXES AND ALES', 'ON', '1809 SANTA RITA ROAD #K', 'PLEASANTON', 3),
  ('2211569', 'CONTINENTAL CLUB', 'ON', '1658 12TH STREET', 'OAKLAND', 3),
  ('4434338', 'MOXY HOTEL OAKLAND', 'ON', '2225 TELEGRAPH AVE', 'OAKLAND', 3),
  ('4232609', 'TAPS & TAKEOUT', 'ON', '5736 THORNHILL DRIVE #104', 'OAKLAND', 3),
  ('4365697', 'TELEGRAPH QUALITY MRKT', 'ON', '2429 TELEGRAPH AVENUE', 'OAKLAND', 3),
  ('4100212', 'IN THE WOOD', 'ON', '2930 COLLEGE AVENUE', 'BERKELEY', 3),
  ('537453', 'MUSICAL OFFERING', 'ON', '2430 BANCROFT WAY', 'BERKELEY', 3),
  ('3956887', 'BUFFALO WILD WINGS #665', 'ON', '2090 DIAMOND BLVD', 'CONCORD', 2),
  ('3073933', 'BRONCO BILLYS-NILES', 'ON', '37651 NILES BLVD', 'FREMONT', 2),
  ('1949195', 'RICHMOND YACHT CLUB', 'ON', '351 BRICKYARD COVE', 'POINT RICHMOND', 2),
  ('540408', 'TOOTS TAVERN(NEW OWNER)', 'ON', '627 2ND AVENUE', 'CROCKETT', 2),
  ('3165881', 'EXTREME PIZZA - BRENTWOOD', 'ON', '3120 BALFOUR ROAD #F', 'BRENTWOOD', 2),
  ('3412364', 'CALIFORNIA CRAFT BEER', 'ON', '43377 MISSION BLVD', 'FREMONT', 2),
  ('4113629', 'NEW PARISH AT TOWNHALL', 'ON', '579 18TH STREET', 'OAKLAND', 2),
  ('4451005', 'CALI KID BURGER & SHAKES', 'ON', '4587 LIVERMORE OUTLETS DR', 'LIVERMORE', 2),
  ('536942', 'MCGEE S BAR & GRILL', 'ON', '1645 PARK STREET', 'ALAMEDA', 2),
  ('3374980', 'TELEGRAPH BEER GARDEN', 'ON', '2318 TELEGRAPH AVENUE', 'OAKLAND', 1),
  ('4511701', '(MONICA S) RIVERVIEW REST', 'ON', '1 I STREET (WHARF)', 'ANTIOCH', 1),
  ('3110748', 'VINE CINEMA', 'ON', '1722 FIRST STREET', 'LIVERMORE', 1),
  ('4594865', 'THE BACKYARD', 'ON', '205 CUTTING BLVD', 'RICHMOND', 1),
  ('3119944', 'BISTRO (THE)', 'ON', '1001 B STREET', 'HAYWARD', 1),
  ('3959409', 'PHILOMENA PIZZA', 'ON', '1801 14TH AVENUE', 'OAKLAND', 1),
  ('3938510', 'FOURTH BORE (THE)', 'ON', '2 THEATRE SQUARE #130', 'ORINDA', 1),
  ('4193948', 'TOWN TAVERN', 'ON', '1437 PARK STREET', 'ALAMEDA', 1),
  ('3302955', 'OL BEER CAFE & BOTTLESHOP', 'ON', '1541 GIAMMONA DRIVE', 'WALNUT CREEK', 1),
  ('4139593', 'MONICA S LIVERMORE', 'ON', '2074 2ND STREET', 'LIVERMORE', 1),
  ('3687740', 'BUFFALO WILD WINGS #505', 'ON', '32135 UNION LANDING BLVD', 'UNION CITY', 1),
  ('4505039', 'TASTY WAVES (CRYBABY)', 'ON', '1928 TELEGRAPH AVENUE', 'OAKLAND', 1)
) as v(outlet_id, bad_name, premise, bad_address, bad_city, bad_units_2023)
where exists (select 1 from public.sales_accounts a where a.outlet_id = v.outlet_id)
on conflict (outlet_id) do update set
  bad_name = excluded.bad_name, premise = excluded.premise, bad_address = excluded.bad_address,
  bad_city = excluded.bad_city, bad_units_2023 = excluded.bad_units_2023;

-- ---------------------------------------------------------------------------
-- The live list (Today's priorities button) + all-time history for Export
-- ---------------------------------------------------------------------------
create or replace function public.markstein_old_bad_list()
returns json
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  result json;
begin
  if not public.sales_can_see(array['Markstein']) then
    raise exception 'You don''t have access to the Markstein page.';
  end if;
  with lost as (
    select b.*
    from public.markstein_old_bad_accounts b
    where not exists (
        select 1 from public.sales_account_sales s
        where s.outlet_id = b.outlet_id and s.distributor = 'Markstein' and s.month >= date '2024-08-01')
      and not exists (select 1 from public.sales_account_off o where o.outlet_id = b.outlet_id)
  ),
  hist as (
    select s.outlet_id, s.month, s.product, coalesce(s.size, '') as size,
      case when s.distributor = 'Markstein' and s.month < date '2024-08-01' then 'Bay Area Distributing' else coalesce(s.distributor, '') end as dist,
      round(sum(s.ce), 2) as ce, max(s.last_buy_date) as last_buy
    from public.sales_account_sales s
    join lost l on l.outlet_id = s.outlet_id
    group by 1, 2, 3, 4, 5
  )
  select json_build_object(
    'as_of', (select m.as_of from public.sales_data_meta m where m.id = 1),
    'accounts', (select coalesce(json_agg(x order by x.lifetime_ce desc nulls last, x.name), '[]'::json) from (
        select l.outlet_id, a.name, a.city, a.address, a.phone,
          coalesce(nullif(a.premise, ''), case l.premise when 'ON' then 'On' when 'OFF' then 'Off' end) as premise,
          l.bad_name, l.bad_units_2023,
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
revoke all on function public.markstein_old_bad_list() from public, anon;
grant execute on function public.markstein_old_bad_list() to authenticated;
comment on function public.markstein_old_bad_list() is
  $c$[needs:dist_markstein] Old Bay Area Distributing accounts that have not bought from Markstein since it took over (8/1/2024): name, city, premise, last order and who from, CEs all time, last check-in, contacts count — plus every month of what they bought, all time.$c$;

-- ---------------------------------------------------------------------------
-- Account pop-up for one of them: same as sales_territory_account, but
-- ALL-TIME purchases (with who sold it) and ALL check-ins.
-- ---------------------------------------------------------------------------
create or replace function public.markstein_old_bad_account(p_outlet text)
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
      (public.sales_can_see(array['Markstein']) and exists (select 1 from public.markstein_old_bad_accounts b where b.outlet_id = p_outlet))
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
        select s.month, s.product, coalesce(s.size, '') as size,
          case when s.distributor = 'Markstein' and s.month < date '2024-08-01' then 'Bay Area Distributing' else coalesce(s.distributor, '') end as dist,
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
revoke all on function public.markstein_old_bad_account(text) from public, anon;
grant execute on function public.markstein_old_bad_account(text) to authenticated;
comment on function public.markstein_old_bad_account(text) is
  $c$[needs:dist_markstein] One old Bay Area Distributing account's details: address, phone, last order, every month of what it bought all time (and which distributor sold it — Bay Area Distributing before 8/1/2024), every check-in, contacts.$c$;
