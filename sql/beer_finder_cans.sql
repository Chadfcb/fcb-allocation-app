-- Beer Finder: 3D cans — added 2026-11-04, per Chad ("they need to look like
-- actual cans with labels on them", "Please make them all the same", "that
-- looks good, execute"). Notes: claude/beer-finder-can-look.md in the project.
--
-- Run in Supabase SQL Editor BEFORE pushing the matching code. Idempotent —
-- safe to run more than once.
--
--   beer_finder_beers.label_front  where the FRONT of the label sits across
--                                  the label (0–1). That spot faces you on the
--                                  can. Null = the usual spot. Changed with the
--                                  ◀ ▶ arrows on the Control tab.
--   beer_finder_data()             same as before, plus label_front.
-- The labels already picked get the front positions from the preview (only
-- where none is set yet, so a can someone turned is kept).

alter table public.beer_finder_beers add column if not exists label_front numeric check (label_front >= 0 and label_front < 1);
comment on column public.beer_finder_beers.label_front is
  'Beer Finder can: where the front of the label sits across the full label (0–1); that spot faces the viewer. Null = the usual spot.';

update public.beer_finder_beers set label_front = case
    when label_path like '%speakeasy_12oz_prohibition%' then 0.56
    when label_path like 'previews/speakeasy/%' then 0.535
    when label_path like '%fcb_12oz_peachyvibes%' then 0.295
    when label_path like '%nectarine%' then 0.46
    else 0.45 end
where label_path is not null and label_front is null;

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
          select p.product, bb.public_name, coalesce(bb.show, true) as show, bb.label_path, bb.label_front
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

-- Check: each beer with a label and its front position.
select product, label_path, label_front from public.beer_finder_beers where label_path is not null order by product;
