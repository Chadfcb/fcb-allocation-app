-- Beer Finder — step 2: the PUBLIC page for our websites. Added 2026-11-04,
-- per Chad ("lets make the page live" → address "beer-finder" → "Execute").
-- Plan: claude/beer-finder-step2-plan.md in the project.
--
-- Run in Supabase SQL Editor BEFORE pushing the matching code. Idempotent —
-- safe to run more than once. Run it AFTER beer_finder.sql and
-- beer_finder_cans.sql (if either of those is ever run again, run this one
-- again after it — it replaces beer_finder_data()).
--
--   www.fcb-data.com/beer-finder       the public finder (no login). The
--                                      internal one moves to /beer-finder/manage.
--   beer_finder_beers.can_image        public link to the beer's finished 3D
--   beer_finder_beers.can_key          can picture + which label/front it was
--                                      drawn from (redrawn by the app when the
--                                      label or its front changes)
--   storage bucket beer-finder-public  those can pictures (public to read;
--                                      only the server writes)
--   beer_finder_public()               what the public page shows — ONLY name,
--                                      address, phone, store/bar, map pin and
--                                      beers + package. No distributor, rep,
--                                      sales or CEs. Follows the Control tab
--                                      (days, beers, names, hidden places,
--                                      distributors, website switch).
--   beer_finder_data()                 same as before + can_image / can_key.

alter table public.beer_finder_beers add column if not exists can_image text;
alter table public.beer_finder_beers add column if not exists can_key text;
comment on column public.beer_finder_beers.can_image is
  'Beer Finder: public link to this beer''s finished 3D can picture (beer-finder-public bucket) shown on the public website finder. Set by the app.';
comment on column public.beer_finder_beers.can_key is
  'Beer Finder: which label + front the can picture was drawn from (label_path@front); when it no longer matches, the app redraws it.';

insert into storage.buckets (id, name, public)
values ('beer-finder-public', 'beer-finder-public', true)
on conflict (id) do update set public = true;

-- ---------------------------------------------------------------------------
-- The public page's data (anyone can call it — returns public info only)
-- ---------------------------------------------------------------------------
create or replace function public.beer_finder_public()
returns json
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  a date;
  d int;
  pub boolean;
begin
  select coalesce((select m.as_of from public.sales_data_meta m where m.id = 1), current_date) into a;
  select s.days, s.public_on into d, pub from public.beer_finder_settings s where s.id = 1;
  d := coalesce(d, 60);
  if not coalesce(pub, true) then
    return json_build_object('public_on', false);
  end if;
  return (
    with items as (
      select s.outlet_id, s.product, coalesce(nullif(trim(s.size), ''), '') as size, max(s.last_buy_date) as last_buy
      from public.sales_account_sales s
      where s.last_buy_date >= a - 365 and s.ce > 0
      group by s.outlet_id, s.product, coalesce(nullif(trim(s.size), ''), '')
    ),
    shown as (
      select p.product
      from (select distinct i.product from items i) p
      left join public.beer_finder_beers b on b.product = p.product
      where coalesce(b.show, true)
    ),
    si as (select i.* from items i join shown x on x.product = i.product),
    acc as (
      select si.outlet_id from si
      union
      select o.outlet_id from public.beer_finder_overrides o where o.mode = 'always'
    ),
    loc as (
      select sa.outlet_id, sa.name, o.display_name, sa.address, sa.city, sa.state, sa.zip, sa.phone, sa.premise,
             coalesce(o.lat, g.lat) as lat, coalesce(o.lng, g.lng) as lng, coalesce(o.mode, 'auto') as mode
      from acc
      join public.sales_accounts sa on sa.outlet_id = acc.outlet_id
      left join public.beer_finder_overrides o on o.outlet_id = sa.outlet_id
      left join public.beer_finder_geo g on g.outlet_id = sa.outlet_id
      left join public.beer_finder_distributors bd on bd.distributor = sa.distributor
      where coalesce(o.mode, 'auto') <> 'hide'
        and coalesce(bd.show, true)
        and not exists (select 1 from public.sales_account_off f where f.outlet_id = sa.outlet_id)
        and coalesce(o.lat, g.lat) is not null
        and coalesce(o.lng, g.lng) is not null
    ),
    pick as (
      select l.*,
             coalesce(
               (select json_agg(json_build_object('p', i.product, 's', i.size) order by i.product, i.size)
                from si i where i.outlet_id = l.outlet_id and i.last_buy >= a - d),
               case when l.mode = 'always' then
                 (select json_agg(json_build_object('p', i.product, 's', i.size) order by i.product, i.size)
                  from si i where i.outlet_id = l.outlet_id)
               end) as items
      from loc l
    )
    select json_build_object(
      'public_on', true,
      'as_of', a,
      'beers', (select coalesce(json_agg(json_build_object(
                    'product', x.product,
                    'name', coalesce(nullif(trim(b.public_name), ''), x.product),
                    'can', case when b.label_path is not null then b.can_image end) order by x.product), '[]'::json)
                from shown x left join public.beer_finder_beers b on b.product = x.product),
      'places', (select coalesce(json_agg(json_build_object(
                    'id', md5(p.outlet_id),
                    'name', coalesce(nullif(trim(p.display_name), ''), p.name),
                    'custom', nullif(trim(p.display_name), '') is not null,
                    'address', p.address, 'city', p.city, 'state', p.state, 'zip', p.zip,
                    'phone', p.phone,
                    'bar', p.premise = 'On',
                    'lat', round(p.lat::numeric, 6), 'lng', round(p.lng::numeric, 6),
                    'items', p.items)), '[]'::json)
                 from pick p where p.items is not null)
    )
  );
end;
$$;
revoke all on function public.beer_finder_public() from public;
grant execute on function public.beer_finder_public() to anon, authenticated, service_role;
comment on function public.beer_finder_public() is
  $c$[hidden] PUBLIC Beer Finder (www.fcb-data.com/beer-finder, no login): the places on the finder right now with name, address, phone, store or bar, map pin and which beers + package — nothing internal. Empty with public_on = false when the website switch is off.$c$;

-- ---------------------------------------------------------------------------
-- The internal Beer Finder page's data — same as before + can_image / can_key
-- ---------------------------------------------------------------------------
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
          select p.product, bb.public_name, coalesce(bb.show, true) as show, bb.label_path, bb.label_front,
                 bb.can_image, bb.can_key
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

-- Check: what the public page will show right now.
select (beer_finder_public()->>'public_on') as website_on,
       json_array_length(beer_finder_public()->'places') as places_on_the_public_finder,
       json_array_length(beer_finder_public()->'beers') as beers;
