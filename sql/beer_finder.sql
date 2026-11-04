-- Beer Finder — step 1 (internal), added 2026-11-04, per Chad: "we need a map,
-- and we are going to want to link this into our website, so customers can
-- find our beer … the fcb data portion will be where we can control and
-- modify it. I also want it to auto update based on sales and active
-- accounts" → "lets add this below Tasks, execute". Plan:
-- claude/beer-finder-plan.md in the project.
--
-- Run in Supabase SQL Editor BEFORE pushing the matching code. Idempotent —
-- safe to run more than once. New tables + functions only; nothing existing
-- is changed.
--
--   beer_finder_settings      one row: how many days back a buy counts (60),
--                             public page on / off (used in step 2)
--   beer_finder_beers         per product: show on the finder, public name,
--                             which POS → Labels label to picture it with
--   beer_finder_distributors  per distributor: include its accounts or not
--   beer_finder_overrides     per account: hide / always show, name to show,
--                             pin moved by hand
--   beer_finder_geo           map pin per account address (filled by the app
--                             from the free US Census Bureau geocoder)
--   beer_finder_data()        everything the Beer Finder page needs, one call
--   beer_finder_geocode_todo() accounts that still need a map pin (server only)
--
-- Who: the new "Beer Finder" access (Admin → Users; admins always have it)
-- can see and change everything here. Pins are only written by the server.
-- No taproom anywhere (FCB has none). Accounts taken off the lists ("Remove
-- from lists" / turned off) never show.

-- ---------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------
create table if not exists public.beer_finder_settings (
  id int primary key default 1 check (id = 1),
  days int not null default 60 check (days between 7 and 365),
  public_on boolean not null default true,
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users(id) on delete set null
);
insert into public.beer_finder_settings (id) values (1) on conflict (id) do nothing;

create table if not exists public.beer_finder_beers (
  product text primary key,            -- the product name in the sales data
  public_name text,                    -- null = show the product name
  show boolean not null default true,
  label_path text,                     -- pos-label-files path of the label preview
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users(id) on delete set null
);

create table if not exists public.beer_finder_distributors (
  distributor text primary key,
  show boolean not null default true,
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users(id) on delete set null
);

create table if not exists public.beer_finder_overrides (
  outlet_id text primary key references public.sales_accounts(outlet_id) on delete cascade,
  mode text not null default 'auto' check (mode in ('auto', 'hide', 'always')),
  display_name text,
  lat double precision,
  lng double precision,
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users(id) on delete set null
);

create table if not exists public.beer_finder_geo (
  outlet_id text primary key references public.sales_accounts(outlet_id) on delete cascade,
  addr_key text not null,              -- the address that was looked up
  status text not null check (status in ('ok', 'nomatch')),
  lat double precision,
  lng double precision,
  matched text,                        -- the address the geocoder matched
  geocoded_at timestamptz not null default now()
);

-- Access: Beer Finder people read + write the settings tables; pins read-only.
do $$
declare t text;
begin
  foreach t in array array['beer_finder_settings', 'beer_finder_beers', 'beer_finder_distributors', 'beer_finder_overrides'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists %I on public.%I', t || '_beer_finder', t);
    execute format(
      'create policy %I on public.%I for all using (public.has_section(auth.uid(), ''beer_finder'')) with check (public.has_section(auth.uid(), ''beer_finder''))',
      t || '_beer_finder', t);
    execute format('revoke all on public.%I from anon', t);
    execute format('grant select, insert, update, delete on public.%I to authenticated', t);
    execute format('grant select, insert, update, delete on public.%I to service_role', t);
  end loop;
end $$;
alter table public.beer_finder_geo enable row level security;
drop policy if exists beer_finder_geo_read on public.beer_finder_geo;
create policy beer_finder_geo_read on public.beer_finder_geo for select using (public.has_section(auth.uid(), 'beer_finder'));
revoke all on public.beer_finder_geo from anon;
grant select on public.beer_finder_geo to authenticated;
grant select, insert, update, delete on public.beer_finder_geo to service_role;

comment on table public.beer_finder_settings is
  'Beer Finder (Main → Beer Finder) settings: an account shows a beer on the finder map if it bought it in the last `days` days (default 60); public_on = the public website finder is showing.';
comment on table public.beer_finder_beers is
  'Beer Finder: per product — show it on the finder or not, the name customers see (public_name), and which POS → Labels label pictures it (label_path in the pos-label-files bucket). Products with no row show under their own name.';
comment on table public.beer_finder_distributors is
  'Beer Finder: per distributor — include its accounts on the finder map or not. No row = included.';
comment on table public.beer_finder_overrides is
  'Beer Finder: per account — mode hide (never on the finder), always (always on it), auto (from sales); display_name = the name customers see; lat/lng = pin moved by hand.';
comment on table public.beer_finder_geo is
  'Beer Finder map pins: latitude/longitude for each account''s street address, looked up by the app (US Census Bureau geocoder). status nomatch = the address couldn''t be placed (fix the pin on the Beer Finder Control tab).';

-- ---------------------------------------------------------------------------
-- Everything the Beer Finder page needs
-- ---------------------------------------------------------------------------
-- Accounts that bought anything in the last 365 days (by the sales data's
-- as-of date) or are set to "always", with what they bought (product + size,
-- last buy, CEs last 90 days). The page decides live / dropped off with the
-- days setting, so moving the slider updates the map without reloading.
create or replace function public.beer_finder_data()
returns json
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  a date;
begin
  if not public.has_section(auth.uid(), 'beer_finder') then
    raise exception 'You don''t have access to the Beer Finder.';
  end if;
  select coalesce((select m.as_of from public.sales_data_meta m where m.id = 1), current_date) into a;
  return (
    with items as (
      select s.outlet_id, s.product, coalesce(nullif(trim(s.size), ''), '') as size,
             max(s.last_buy_date) as last_buy,
             round(sum(s.ce) filter (where s.last_buy_date >= a - 90), 1) as ce90
      from public.sales_account_sales s
      where s.last_buy_date >= a - 365 and s.ce > 0
      group by s.outlet_id, s.product, coalesce(nullif(trim(s.size), ''), '')
    ),
    acc as (
      select a2.outlet_id from (
        select distinct i.outlet_id from items i
        union
        select o.outlet_id from public.beer_finder_overrides o where o.mode = 'always'
      ) a2
    )
    select json_build_object(
      'as_of', a,
      'settings', (select row_to_json(st) from (select days, public_on from public.beer_finder_settings where id = 1) st),
      'beers', (select coalesce(json_agg(b order by b.product), '[]'::json) from (
          select p.product, bb.public_name, coalesce(bb.show, true) as show, bb.label_path
          from (select distinct i.product from items i
                union select x.product from public.beer_finder_beers x) p
          left join public.beer_finder_beers bb on bb.product = p.product) b),
      'distributors', (select coalesce(json_agg(d order by d.distributor), '[]'::json) from (
          select dd.distributor, coalesce(bd.show, true) as show
          from (select distinct sa.distributor from public.sales_accounts sa join acc on acc.outlet_id = sa.outlet_id where sa.distributor is not null) dd
          left join public.beer_finder_distributors bd on bd.distributor = dd.distributor) d),
      'locations', (select coalesce(json_agg(l), '[]'::json) from (
          select sa.outlet_id, sa.name, o.display_name, sa.address, sa.city, sa.state, sa.zip, sa.phone,
                 sa.premise, sa.distributor,
                 coalesce(o.lat, g.lat) as lat, coalesce(o.lng, g.lng) as lng,
                 case when o.lat is not null then 'manual' else g.status end as pin,
                 coalesce(o.mode, 'auto') as mode,
                 exists (select 1 from public.sales_account_off f where f.outlet_id = sa.outlet_id) as is_off,
                 (select max(i.last_buy) from items i where i.outlet_id = sa.outlet_id) as last_buy,
                 (select coalesce(json_agg(json_build_object('product', i.product, 'size', i.size, 'last_buy', i.last_buy, 'ce90', i.ce90) order by i.product, i.size), '[]'::json)
                  from items i where i.outlet_id = sa.outlet_id) as items
          from acc
          join public.sales_accounts sa on sa.outlet_id = acc.outlet_id
          left join public.beer_finder_overrides o on o.outlet_id = sa.outlet_id
          left join public.beer_finder_geo g on g.outlet_id = sa.outlet_id) l)
    )
  );
end;
$$;
revoke all on function public.beer_finder_data() from public, anon;
grant execute on function public.beer_finder_data() to authenticated;
comment on function public.beer_finder_data() is
  $c$[hidden] Beer Finder page: settings, beers, distributors and every account that bought in the last 365 days (or is set to always show) with its map pin and what it bought.$c$;

-- ---------------------------------------------------------------------------
-- Accounts that still need a map pin (the app's geocoder step; server only)
-- ---------------------------------------------------------------------------
-- Bought in the last 365 days (or "always"), not taken off the lists, no
-- hand-placed pin, and no pin yet for its CURRENT address (an address change
-- gets looked up again).
create or replace function public.beer_finder_geocode_todo(p_limit int default 2000)
returns table (outlet_id text, street text, city text, state text, zip text, addr_key text)
language sql
stable
security definer
set search_path = ''
as $$
  with a as (select coalesce((select m.as_of from public.sales_data_meta m where m.id = 1), current_date) as d),
  cand as (
    select distinct s.outlet_id from public.sales_account_sales s, a where s.last_buy_date >= a.d - 365 and s.ce > 0
    union
    select o.outlet_id from public.beer_finder_overrides o where o.mode = 'always'
  )
  select sa.outlet_id, trim(sa.address), trim(sa.city), coalesce(nullif(trim(sa.state), ''), 'CA'), trim(sa.zip),
         lower(concat_ws('|', trim(sa.address), trim(sa.city), coalesce(nullif(trim(sa.state), ''), 'CA'), trim(sa.zip))) as addr_key
  from cand
  join public.sales_accounts sa on sa.outlet_id = cand.outlet_id
  left join public.beer_finder_geo g on g.outlet_id = sa.outlet_id
  left join public.beer_finder_overrides o on o.outlet_id = sa.outlet_id
  where coalesce(trim(sa.address), '') <> ''
    and not exists (select 1 from public.sales_account_off f where f.outlet_id = sa.outlet_id)
    and o.lat is null
    and coalesce(o.mode, 'auto') <> 'hide'
    and (g.outlet_id is null
         or g.addr_key <> lower(concat_ws('|', trim(sa.address), trim(sa.city), coalesce(nullif(trim(sa.state), ''), 'CA'), trim(sa.zip))))
  order by sa.last_buy_date desc nulls last
  limit greatest(1, least(coalesce(p_limit, 2000), 10000));
$$;
revoke all on function public.beer_finder_geocode_todo(int) from public, anon, authenticated;
grant execute on function public.beer_finder_geocode_todo(int) to service_role;
comment on function public.beer_finder_geocode_todo(int) is
  $c$[hidden] Beer Finder: accounts that still need a map pin for their current address (used by the app's geocoder step only).$c$;

-- Check: how many accounts will need a pin on the first run.
select count(*) as accounts_to_place_on_the_map from public.beer_finder_geocode_todo(10000);
