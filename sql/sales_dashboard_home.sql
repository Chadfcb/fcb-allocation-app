-- Sales Dashboard home (added 2026-10-21, per Chad): the at-a-glance page —
-- headline numbers, cases by month, account health, distributor cards with
-- their biggest immediate impacts, Needs attention, Win backs, what's selling
-- and rep activity. Plan + mockup: claude/sales-dashboard-plan.md.
--
-- Live: nothing here is stored. sales_dash_home() works everything out from
-- the sales data each time the page opens, and the page reloads itself when
-- a LilyPad sync finishes (the sync stamps sales_data_meta — this file adds
-- that table to the live-update feed and lets Sales Dashboard users read it).
--
-- Rules (same as Sales → Accounts, from the data's as-of date):
--   New           first order EVER in the period
--   Buying        bought in the last 60 days (Active + New + Re-Activated)
--   Potential lost / slipping   61–90 days since the last order
--   Lost          90+ days (the dashboard counts the last 12 months)
--   Went lost     hit 91 days without an order during the period
--   Won back      ordered again after 61+ days without an order —
--                 "from Lost" when the gap was 91+ days, "from Potential
--                 lost" when it was 61–90
--   Cases in a period: monthly totals; a month only partly inside the period
--   is split by days (using the first / last order day when we have them).
-- Only current distributors (p_current) count; turned-off accounts and
-- hidden products are left out.
--
-- Custom dates (added 2026-10-21, per Chad): pass p_from / p_to and the
-- numbers come back for that range too (period key 'custom'), compared with
-- the same dates a year earlier.
--
-- Distributor pages (2026-10-22; were My Territory 10/21): access goes
-- through sales_can_see() (sql/distributors.sql, which also re-creates
-- sales_dash_home exactly as below); adds a 'new_accounts' list.
--
-- Run this in Supabase's SQL Editor BEFORE pushing the code.
-- Idempotent — safe to run more than once. No new tables.

-- Sales Dashboard users can read the as-of date (and so get the live update).
drop policy if exists "sales_data_meta_dashboard_read" on public.sales_data_meta;
create policy "sales_data_meta_dashboard_read" on public.sales_data_meta for select using (
  (select public.has_section((select auth.uid()), 'sales_dashboard'))
);

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'sales_data_meta'
  ) then
    alter publication supabase_realtime add table public.sales_data_meta;
  end if;
end $$;

-- (The first version took only p_current / p_big — replaced by the one below.)
drop function if exists public.sales_dash_home(text[], numeric);

create or replace function public.sales_dash_home(p_current text[], p_big numeric default 50, p_from date default null, p_to date default null)
returns json
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  a date;          -- the data's as-of date
  y0 date;         -- Jan 1 of that year
  c0 date;         -- custom range start (null = none)
  c1 date;         -- custom range end
  back date;       -- earliest day any period needs (this year)
  v_acc boolean;   -- can this person see Sales → Accounts (phones, check-ins)?
  result json;
begin
  -- Sales Dashboard users see any distributors; distributor-page people
  -- (2026-10-22 — sql/distributors.sql) only their own.
  if not public.sales_can_see(p_current) then
    raise exception 'You don''t have access to the Sales Dashboard.';
  end if;
  -- Phones / check-ins: Sales → Accounts people, and distributor-page people for their own accounts.
  v_acc := public.has_section(auth.uid(), 'accounts') or public.has_dist_page();
  select m.as_of into a from public.sales_data_meta m where m.id = 1;
  if a is null then
    return json_build_object('as_of', null);
  end if;
  y0 := date_trunc('year', a)::date;
  if p_from is not null and p_to is not null then
    c0 := least(p_from, p_to);
    c1 := least(greatest(p_from, p_to), a);
    if c0 > c1 then c0 := c1; end if;
  end if;
  back := least(y0, a - 89, coalesce(c0, a));

  with
  -- The three periods, this year (ty) and the same days last year (ly).
  win as (
    select v.p, 'ty'::text as yr, v.ws, v.we
    from (values ('30', a - 29, a), ('90', a - 89, a), ('ytd', y0, a), ('custom', c0, c1)) v(p, ws, we)
    where v.ws is not null
    union all
    select v.p, 'ly', (v.ws - interval '1 year')::date, (v.we - interval '1 year')::date
    from (values ('30', a - 29, a), ('90', a - 89, a), ('ytd', y0, a), ('custom', c0, c1)) v(p, ws, we)
    where v.ws is not null
  ),
  acc as (
    select x.outlet_id, x.name, x.city, x.phone, x.distributor, x.last_buy_date as lb,
           x.first_buy_date as fb, coalesce(x.ce_12mo, 0) as ce12, coalesce(x.lifetime_ce, 0) as cel,
           coalesce(x.bought_61_150, false) as b61
    from public.sales_accounts x
    where x.distributor = any(p_current)
      and not exists (select 1 from public.sales_account_off o where o.outlet_id = x.outlet_id)
  ),
  -- Sales rows for the last ~2 years, with the day span each row covers.
  s as (
    select r.outlet_id, r.distributor as dist, r.month, r.product, coalesce(r.size, 'Other') as size, r.ce,
           coalesce(r.first_buy_in_month, r.month) as lo,
           greatest(
             coalesce(r.first_buy_in_month, r.month),
             case
               when r.last_buy_date is not null and (r.first_buy_in_month is not null or r.last_buy_date <> r.month)
                 then r.last_buy_date
               else least((r.month + interval '1 month' - interval '1 day')::date, a)
             end) as hi
    from public.sales_account_sales r
    where r.month >= least((date_trunc('month', a) - interval '25 months')::date,
                           date_trunc('month', back - interval '1 year')::date)
      and r.distributor = any(p_current)
      and not exists (select 1 from public.sales_account_off o where o.outlet_id = r.outlet_id)
      and not exists (select 1 from public.sales_product_hidden h where h.product = r.product)
  ),
  part as (
    select w.p, w.yr, s.dist, s.product, s.size,
           s.ce * greatest(0, least(s.hi, w.we) - greatest(s.lo, w.ws) + 1)::numeric / (s.hi - s.lo + 1) as ce
    from s join win w on s.lo <= w.we and s.hi >= w.ws
  ),
  -- Stage of every account (current distributors only).
  st as (
    select ac.*, (a - ac.lb) as dark,
      case
        when ac.lb is null then null
        when a - ac.lb <= 60 then
          case when ac.fb is not null and a - ac.fb <= 60 then 'new'
               when ac.b61 then 'active' else 'reactivated' end
        when a - ac.lb <= 90 then 'plost'
        when a - ac.lb <= 365 then 'lost'
        else 'old'
      end as stage
    from acc ac
  ),
  -- Every known order day per account (first and last order day of each month).
  bd as (
    select distinct r.outlet_id, v.d
    from public.sales_account_sales r
    cross join lateral (values (coalesce(r.first_buy_in_month, r.last_buy_date, r.month)),
                               (coalesce(r.last_buy_date, r.month))) v(d)
    where r.month >= (back - interval '4 years')::date
      and r.outlet_id in (select outlet_id from acc)
      and v.d <= a
  ),
  g as (
    select bd.outlet_id, bd.d,
           lag(bd.d) over (partition by bd.outlet_id order by bd.d) as prev,
           lead(bd.d) over (partition by bd.outlet_id order by bd.d) as nxt
    from bd
  ),
  -- Came back after 61+ quiet days.
  wb as (
    select g.outlet_id, ac.distributor as dist, g.d, g.prev, (g.d - g.prev) as gap
    from g join acc ac on ac.outlet_id = g.outlet_id
    where g.prev is not null and g.d - g.prev >= 61
  ),
  -- Hit 91 days without an order (d + 91 is the day they "went lost").
  wl as (
    select g.outlet_id, ac.distributor as dist, (g.d + 91) as day
    from g join acc ac on ac.outlet_id = g.outlet_id
    where (g.nxt is null or g.nxt - g.d > 90) and g.d + 91 <= a
  ),
  cm as (select m.outlet_id, m.chain from public.sales_chain_members() m)
  select json_build_object(
    'as_of', a,
    'has_accounts', v_acc,
    'periods', (select json_agg(json_build_object('p', w.p, 'yr', w.yr, 'from', w.ws, 'to', w.we)) from win w),
    -- Cases per period × year × distributor
    'cases', (select coalesce(json_agg(c), '[]'::json) from (
        select p, yr, dist, round(sum(ce), 1) as ce from part group by p, yr, dist) c),
    'brands', (select coalesce(json_agg(c), '[]'::json) from (
        select p, yr, dist, product, round(sum(ce), 1) as ce from part group by p, yr, dist, product having sum(ce) > 0) c),
    'sizes', (select coalesce(json_agg(c), '[]'::json) from (
        select p, dist, size, round(sum(ce), 1) as ce from part where yr = 'ty' group by p, dist, size having sum(ce) > 0) c),
    'monthly', (select coalesce(json_agg(c order by c.month), '[]'::json) from (
        select s.month, s.dist, round(sum(s.ce), 1) as ce from s
        where s.month >= (date_trunc('month', a) - interval '25 months')::date
        group by s.month, s.dist) c),
    -- Account stages per distributor (+ cases a year at stake)
    'stages', (select coalesce(json_agg(c), '[]'::json) from (
        select st.distributor as dist, st.stage, count(*)::int as n, round(sum(st.ce12), 1) as ce12
        from st where st.stage is not null and st.stage <> 'old'
        group by st.distributor, st.stage) c),
    -- Accounts buying (last 60 days) at the same point last year
    'buying_ly', (select coalesce(json_agg(c), '[]'::json) from (
        select ac.distributor as dist, count(distinct ac.outlet_id)::int as n
        from acc ac join bd on bd.outlet_id = ac.outlet_id
        where bd.d between (a - interval '1 year')::date - 60 and (a - interval '1 year')::date
        group by ac.distributor) c),
    -- Counts per period × year × distributor: new accounts, win backs, went lost
    -- New accounts this year (newest first) — the My Territory follow-up list
    'new_accounts', (select coalesce(json_agg(c order by c.fb desc), '[]'::json) from (
        select ac.outlet_id, ac.name, ac.city, ac.distributor as dist, ac.fb, ac.lb, ac.ce12
        from acc ac where ac.fb >= back) c),
    'new_counts', (select coalesce(json_agg(c), '[]'::json) from (
        select w.p, w.yr, x.distributor as dist, count(*)::int as n
        from win w join acc x on x.fb between w.ws and w.we
        group by w.p, w.yr, x.distributor) c),
    'won_counts', (select coalesce(json_agg(c), '[]'::json) from (
        select w.p, w.yr, wb.dist, count(distinct wb.outlet_id)::int as n,
               count(distinct wb.outlet_id) filter (where wb.gap > 90)::int as from_lost
        from win w join wb on wb.d between w.ws and w.we
        group by w.p, w.yr, wb.dist) c),
    'lost_counts', (select coalesce(json_agg(c), '[]'::json) from (
        select w.p, w.yr, wl.dist, count(distinct wl.outlet_id)::int as n
        from win w join wl on wl.day between w.ws and w.we
        group by w.p, w.yr, wl.dist) c),
    -- Win backs this year (newest first), with what they came back buying
    'winbacks', (select coalesce(json_agg(c order by c.d desc), '[]'::json) from (
        select distinct on (wb.outlet_id, wb.d)
          wb.outlet_id, ac.name, ac.city, wb.dist, wb.d, wb.prev, wb.gap,
          (select round(sum(r.ce), 1) from public.sales_account_sales r
             where r.outlet_id = wb.outlet_id and r.month >= date_trunc('month', wb.d)::date) as ce_since,
          (select string_agg(t.item, ', ') from (
             select r.product || ' ' || coalesce(r.size, '') as item from public.sales_account_sales r
             where r.outlet_id = wb.outlet_id and r.month = date_trunc('month', wb.d)::date
             group by r.product, r.size order by sum(r.ce) desc limit 3) t) as items,
          case when v_acc then (select json_build_object('date', k.checkin_date, 'rep', k.rep)
             from public.sales_account_checkins k
             where k.outlet_id = wb.outlet_id and k.checkin_date between wb.prev and wb.d
             order by k.checkin_date desc limit 1) end as checkin
        from wb join acc ac on ac.outlet_id = wb.outlet_id
        where wb.d >= back
        order by wb.outlet_id, wb.d) c),
    -- Slipping now (Potential lost) and big losses (lost in the last year, p_big+ lifetime cases)
    'attention', (select coalesce(json_agg(c order by c.ce12 desc), '[]'::json) from (
        select st.outlet_id, st.name, st.city, st.distributor as dist, st.stage, st.lb, st.dark, st.ce12,
          case when v_acc then st.phone end as phone,
          case when v_acc then (select json_build_object('date', k.checkin_date, 'rep', k.rep)
             from public.sales_account_checkins k where k.outlet_id = st.outlet_id
             order by k.checkin_date desc limit 1) end as checkin
        from st
        where st.stage = 'plost' or (st.stage = 'lost' and st.cel >= p_big)) c),
    -- Chains where 2+ stores (of 3+ that bought in the last year) went quiet
    'chain_quiet', (select coalesce(json_agg(c order by c.quiet_ce desc), '[]'::json) from (
        select cm.chain, st.distributor as dist, count(*)::int as stores,
          count(*) filter (where st.stage in ('plost', 'lost'))::int as quiet,
          round(coalesce(sum(st.ce12) filter (where st.stage in ('plost', 'lost')), 0), 1) as quiet_ce,
          json_agg(st.name order by st.ce12 desc) filter (where st.stage in ('plost', 'lost')) as quiet_names
        from cm join st on st.outlet_id = cm.outlet_id
        where st.stage in ('active', 'new', 'reactivated', 'plost', 'lost')
        group by cm.chain, st.distributor
        having count(*) >= 3 and count(*) filter (where st.stage in ('plost', 'lost')) >= 2) c),
    -- Check-ins per person per period (people with Sales → Accounts only)
    'checkins', case when v_acc then (select coalesce(json_agg(c), '[]'::json) from (
        select w.p, k.rep, count(*)::int as n
        from public.sales_account_checkins k join win w on w.yr = 'ty' and k.checkin_date between w.ws and w.we
        where k.rep is not null
        group by w.p, k.rep) c) end
  ) into result;
  return result;
end;
$$;

revoke all on function public.sales_dash_home(text[], numeric, date, date) from public, anon;
grant execute on function public.sales_dash_home(text[], numeric, date, date) to authenticated;

comment on function public.sales_dash_home(text[], numeric, date, date) is $c$[needs:sales_dashboard] Sales Dashboard home numbers for the current distributors (pass their names): cases by period (last 30 / 90 days / year to date, plus a custom p_from–p_to range as 'custom') vs the same days last year per distributor, by brand and size, cases by month, account stages per distributor (Active/New/Re-Activated/Potential lost/Lost in the last year), new accounts, win backs (ordered again after 61+ quiet days), accounts that went lost, slipping and big-loss accounts, chains with stores gone quiet, and check-ins per person.$c$;
