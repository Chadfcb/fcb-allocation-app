-- Distributors (Departments → Distributors) — added 2026-10-22, per Chad.
-- Replaces the 10/21 My Territory page (sql/my_territory.sql — don't run that
-- file again). Plan: claude/rep-dashboard-plan.md.
--
--   * One dashboard page per distributor, each with its own access checkbox in
--     Admin → Users → Edit access (section keys dist_matagrano, dist_guardian,
--     … — "dist_" + the name in lower case, spaces → "_"). Chad: "steve has
--     access to the distributors button, but only sees the sub category of
--     Matagrano."
--   * Stock block: shows WHEN the inventory was last updated and where from
--     (Ekos, or the file uploaded on the page — Superior), instead of the
--     week. "This week's order" removed (Chad: "not needed").
--   * Fix: Ekos's rate of sale is PER DAY (Ekos / VIP "Projected Daily Rate
--     of Sales"; Operations → Distributor Inventory shows it as Rate/Day). The
--     10/21 My Territory page showed it as "per week" and its "weeks left" was
--     really days left. Per week = daily × 7 now.
--   * Check-ins block: overall check-ins at the distributor's accounts with
--     notes, and the maintenance route for the current two-month period
--     (X of Y accounts checked in, accounts not checked in yet).
--   * Maintenance routes (claude/maintenance-routes.md): two new tables the
--     "LilyPad — Maintenance Routes" sync fills every weekday morning, and a
--     route column on Sales Dashboard → Rep activity.
--
-- Moves anyone who had My Territory to the matching distributor page(s), then
-- removes My Territory (rep_territories, my_territories()).
--
-- Run this in Supabase's SQL Editor BEFORE pushing the code. Idempotent —
-- safe to run more than once.

-- ---------------------------------------------------------------------------
-- Access
-- ---------------------------------------------------------------------------

-- The page section key for a distributor name: Valley Wide → dist_valley_wide.
create or replace function public.dist_section(p_dist text)
returns text
language sql
immutable
set search_path = ''
as $$
  select 'dist_' || regexp_replace(lower(trim(p_dist)), '\s+', '_', 'g');
$$;
grant execute on function public.dist_section(text) to authenticated, service_role;

-- True if the signed-in person can open at least one distributor page.
create or replace function public.has_dist_page()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'admin')
    or exists (select 1 from public.user_section_access u where u.user_id = auth.uid() and u.section_key like 'dist\_%');
$$;
revoke all on function public.has_dist_page() from public, anon;
grant execute on function public.has_dist_page() to authenticated;

-- Sales Dashboard people: any distributor. Distributor-page people: only when
-- every distributor asked for is one of their pages.
create or replace function public.sales_can_see(p_dists text[])
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select public.has_section(auth.uid(), 'sales_dashboard')
    or (
      p_dists is not null and cardinality(p_dists) > 0
      and not exists (select 1 from unnest(p_dists) d where not public.has_section(auth.uid(), public.dist_section(d)))
    );
$$;
revoke all on function public.sales_can_see(text[]) from public, anon;
grant execute on function public.sales_can_see(text[]) to authenticated;

-- Move My Territory people to their distributor page(s), then drop My Territory.
do $$
begin
  if to_regclass('public.rep_territories') is not null then
    insert into public.user_section_access (user_id, section_key)
    select t.user_id, public.dist_section(t.distributor)
    from public.rep_territories t
    join public.user_section_access u on u.user_id = t.user_id and u.section_key = 'my_territory'
    on conflict do nothing;
  end if;
end $$;
delete from public.user_section_access where section_key = 'my_territory';
drop policy if exists "sales_data_meta_territory_read" on public.sales_data_meta;
drop function if exists public.my_territories();
drop table if exists public.rep_territories;

-- Live updates on the distributor pages: their people can read the as-of date.
drop policy if exists "sales_data_meta_dist_read" on public.sales_data_meta;
create policy "sales_data_meta_dist_read" on public.sales_data_meta for select using (
  (select public.has_dist_page())
);

-- ---------------------------------------------------------------------------
-- Stock at the distributor
-- ---------------------------------------------------------------------------
create or replace function public.sales_territory_stock(p_dist text)
returns json
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_week uuid;
  result json;
begin
  if not public.sales_can_see(array[p_dist]) then
    raise exception 'You don''t have access to this distributor.';
  end if;
  -- The newest week that has an inventory report for this distributor.
  select di.week_id into v_week
  from public.distributor_inventory di
  join public.distributors d on d.id = di.distributor_id
  join public.weeks w on w.id = di.week_id
  where d.name = p_dist
  order by w.week_start desc limit 1;

  select json_build_object(
    -- When it was last updated, and from where: 'ekos' (the automatic Ekos
    -- sync) or 'distributor' (a file uploaded on the page, or typed in on
    -- Distributor Inventory).
    'updated_at', (select max(coalesce(di.imported_at, di.updated_at)) from public.distributor_inventory di
                   join public.distributors d on d.id = di.distributor_id
                   where di.week_id = v_week and d.name = p_dist),
    'source', (select di.source from public.distributor_inventory di
               join public.distributors d on d.id = di.distributor_id
               where di.week_id = v_week and d.name = p_dist
               order by coalesce(di.imported_at, di.updated_at) desc nulls last limit 1),
    -- rate_of_sale is per DAY (Ekos / VIP "Projected Daily Rate of Sales").
    'inventory', (select coalesce(json_agg(x order by x.weeks_left nulls last, x.product), '[]'::json) from (
        select p.name as product, di.on_hand_qty as on_hand,
               round(di.rate_of_sale * 7, 1) as per_week,
               case when di.rate_of_sale > 0 then round(di.on_hand_qty / (di.rate_of_sale * 7), 1) end as weeks_left
        from public.distributor_inventory di
        join public.distributors d on d.id = di.distributor_id
        join public.products p on p.id = di.product_id
        where di.week_id = v_week and d.name = p_dist
          and (di.on_hand_qty > 0 or di.rate_of_sale > 0)) x)
  ) into result;
  return result;
end;
$$;
revoke all on function public.sales_territory_stock(text) from public, anon;
grant execute on function public.sales_territory_stock(text) to authenticated;
comment on function public.sales_territory_stock(text) is $c$[needs:sales_dashboard] One distributor's latest inventory report: on hand, cases sold per week (daily rate × 7) and weeks of supply per product, plus when it was last updated and whether it came from Ekos or an uploaded file.$c$;

-- ---------------------------------------------------------------------------
-- Maintenance routes (LilyPad target lists) — filled by the sync
-- ---------------------------------------------------------------------------
create table if not exists public.lilypad_routes (
  list_id text primary key,
  name text not null,
  distributor text,
  rep text not null,
  account_count int not null default 0,
  synced_at timestamptz not null default now()
);
create table if not exists public.lilypad_route_accounts (
  list_id text not null references public.lilypad_routes(list_id) on delete cascade,
  outlet_id text not null,
  name text,
  city text,
  primary key (list_id, outlet_id)
);
create index if not exists lilypad_route_accounts_outlet_idx on public.lilypad_route_accounts (outlet_id);

alter table public.lilypad_routes enable row level security;
alter table public.lilypad_route_accounts enable row level security;
drop policy if exists "lilypad_routes_read" on public.lilypad_routes;
create policy "lilypad_routes_read" on public.lilypad_routes for select using (
  (select public.has_section((select auth.uid()), 'sales_dashboard'))
);
drop policy if exists "lilypad_route_accounts_read" on public.lilypad_route_accounts;
create policy "lilypad_route_accounts_read" on public.lilypad_route_accounts for select using (
  (select public.has_section((select auth.uid()), 'sales_dashboard'))
);
grant select, insert, update, delete on public.lilypad_routes to authenticated;
grant select, insert, update, delete on public.lilypad_routes to service_role;
grant select, insert, update, delete on public.lilypad_route_accounts to authenticated;
grant select, insert, update, delete on public.lilypad_route_accounts to service_role;

comment on table public.lilypad_routes is $c$Each current sales rep's MAINTENANCE ROUTE (a LilyPad target list): the accounts that rep must check in at, at least once every two-month period (Oct–Nov, Dec–Jan, Feb–Mar, Apr–May, Jun–Jul, Aug–Sep). Columns: name, distributor, rep, account_count. Synced from LilyPad every weekday morning. For "how is Steve doing on his route", use sales_route_progress().$c$;
comment on table public.lilypad_route_accounts is $c$The accounts on each maintenance route (list_id → lilypad_routes; outlet_id = sales_accounts.outlet_id). A route account counts as checked in for the period when sales_account_checkins has an Email/Text Contact, Phone Call, Off Premise Visit or On Premise Visit there by a current rep in that period.$c$;

insert into public.sync_sources (key, label, enabled, sort_order) values
  ('lilypad_routes', 'LilyPad — Maintenance Routes', true, 12)
on conflict (key) do nothing;

-- The current two-month route period (Oct–Nov, Dec–Jan, …), Pacific time.
create or replace function public.route_period(p_day date default null)
returns table (period_start date, period_end date)
language sql
stable
set search_path = ''
as $$
  with d as (select coalesce(p_day, (now() at time zone 'America/Los_Angeles')::date) as day)
  select s::date, (s + interval '2 months' - interval '1 day')::date
  from (
    select date_trunc('month', d.day) - (case when extract(month from d.day)::int % 2 = 0 then interval '0 months' else interval '1 month' end) as s
    from d
  ) x;
$$;
grant execute on function public.route_period(date) to authenticated, service_role;

-- Check-ins that count for a route: these four activities, by a current rep
-- (a rep who owns a synced route), matched on first name like the rest of
-- the sales pages.
create or replace function public.route_checkin_counts(k public.sales_account_checkins)
returns boolean
language sql
stable
set search_path = ''
as $$
  select lower(coalesce(k.activity, '')) in ('email/text contact', 'phone call', 'off premise visit', 'on premise visit')
    and split_part(lower(trim(coalesce(k.rep, ''))), ' ', 1) in (
      select split_part(lower(trim(r.rep)), ' ', 1) from public.lilypad_routes r);
$$;

-- Route progress for every route (Sales Dashboard → Rep activity).
create or replace function public.sales_route_progress()
returns json
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_from date;
  v_to date;
  result json;
begin
  if not (public.has_section(auth.uid(), 'sales_dashboard') or public.has_dist_page()) then
    raise exception 'You don''t have access to the Sales Dashboard.';
  end if;
  select period_start, period_end into v_from, v_to from public.route_period();
  select json_build_object(
    'period_start', v_from,
    'period_end', v_to,
    'routes', (select coalesce(json_agg(x order by x.distributor), '[]'::json) from (
        select r.list_id, r.name, r.distributor, r.rep,
               (select count(*) from public.lilypad_route_accounts ra where ra.list_id = r.list_id) as total,
               (select count(distinct ra.outlet_id) from public.lilypad_route_accounts ra
                 join public.sales_account_checkins k on k.outlet_id = ra.outlet_id
                 where ra.list_id = r.list_id and k.checkin_date between v_from and v_to
                   and public.route_checkin_counts(k)) as visited,
               r.synced_at
        from public.lilypad_routes r
        where public.has_section(auth.uid(), 'sales_dashboard') or public.sales_can_see(array[r.distributor])) x)
  ) into result;
  return result;
end;
$$;
revoke all on function public.sales_route_progress() from public, anon;
grant execute on function public.sales_route_progress() to authenticated;
comment on function public.sales_route_progress() is $c$[needs:sales_dashboard] Maintenance route progress for the current two-month period: per route (rep, distributor) how many of its accounts have been checked in (Email/Text, Phone Call, Off / On Premise Visit) out of the total.$c$;

-- ---------------------------------------------------------------------------
-- Check-ins block on a distributor page
-- ---------------------------------------------------------------------------
create or replace function public.sales_territory_checkins(p_dist text, p_from date)
returns json
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_today date := (now() at time zone 'America/Los_Angeles')::date;
  v_rs date;
  v_re date;
  result json;
begin
  if not public.sales_can_see(array[p_dist]) then
    raise exception 'You don''t have access to this distributor.';
  end if;
  select period_start, period_end into v_rs, v_re from public.route_period();

  with ck as (
    select k.checkin_date, k.rep, k.activity, k.notes, k.brands, k.outlet_id, a.name, a.city,
           exists (select 1 from public.lilypad_route_accounts ra join public.lilypad_routes r on r.list_id = ra.list_id
                   where ra.outlet_id = k.outlet_id and r.distributor = p_dist) as on_route
    from public.sales_account_checkins k
    join public.sales_accounts a on a.outlet_id = k.outlet_id
    where a.distributor = p_dist and k.checkin_date between p_from and v_today
  )
  select json_build_object(
    'from', p_from,
    'to', v_today,
    'total', (select count(*) from ck),
    'accounts', (select count(distinct outlet_id) from ck),
    'with_notes', (select count(*) from ck where coalesce(trim(notes), '') <> ''),
    'by_rep', (select coalesce(json_agg(x order by x.n desc), '[]'::json) from (
        select coalesce(rep, '(no rep)') as rep, count(*) as n from ck group by coalesce(rep, '(no rep)')) x),
    'checkins', (select coalesce(json_agg(x order by x.checkin_date desc, x.name), '[]'::json) from (
        select * from ck order by checkin_date desc limit 500) x),
    'route_period', json_build_object('start', v_rs, 'end', v_re, 'today', v_today),
    'routes', (select coalesce(json_agg(rt order by rt.rep), '[]'::json) from (
        select r.list_id, r.name, r.rep, r.synced_at,
               (select coalesce(json_agg(acc order by acc.visited, acc.name), '[]'::json) from (
                   select ra.outlet_id, coalesce(sa.name, ra.name) as name, coalesce(sa.city, ra.city) as city,
                          max(k.checkin_date) filter (where k.checkin_date between v_rs and v_re and public.route_checkin_counts(k)) as last_in_period,
                          max(k.checkin_date) as last_ever,
                          (max(k.checkin_date) filter (where k.checkin_date between v_rs and v_re and public.route_checkin_counts(k))) is not null as visited
                   from public.lilypad_route_accounts ra
                   left join public.sales_accounts sa on sa.outlet_id = ra.outlet_id
                   left join public.sales_account_checkins k on k.outlet_id = ra.outlet_id
                   where ra.list_id = r.list_id
                   group by ra.outlet_id, coalesce(sa.name, ra.name), coalesce(sa.city, ra.city)) acc) as accounts
        from public.lilypad_routes r
        where r.distributor = p_dist) rt)
  ) into result;
  return result;
end;
$$;
revoke all on function public.sales_territory_checkins(text, date) from public, anon;
grant execute on function public.sales_territory_checkins(text, date) to authenticated;
comment on function public.sales_territory_checkins(text, date) is $c$[needs:sales_dashboard] One distributor's check-ins since a date (who, which account, activity, meeting notes, brands sampled) and its maintenance route for the current two-month period (every route account, checked in or not).$c$;

-- ---------------------------------------------------------------------------
-- Same as sql/sales_dashboard.sql (updated there too): distributor-page people
-- can load the chain lists.
-- ---------------------------------------------------------------------------

create or replace function public.sales_dash_overview()
returns json
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  result json;
begin
  -- Sales Dashboard, or a distributor page (2026-10-22; chain lists
  -- only, no sales numbers per store here).
  if not (public.has_section(auth.uid(), 'sales_dashboard') or public.has_dist_page()) then
    raise exception 'You don''t have access to the Sales Dashboard.';
  end if;

  with m as (select * from public.sales_chain_members()),
  ms as (
    select m.chain, coalesce(a.distributor, '(none)') as distributor, count(*) as stores
    from m join public.sales_accounts a on a.outlet_id = m.outlet_id
    group by m.chain, coalesce(a.distributor, '(none)')
  )
  select json_build_object(
    'as_of', (select as_of from public.sales_data_meta where id = 1),
    'chains', (select coalesce(json_agg(c order by c.stores desc, c.chain), '[]'::json) from (
        select ms.chain, sum(ms.stores)::int as stores,
               json_object_agg(ms.distributor, ms.stores) as by_distributor,
               (select coalesce(json_agg(distinct m2.auto_name), '[]'::json) from m m2
                 where m2.chain = ms.chain and m2.auto_name is not null) as auto_names
        from ms group by ms.chain) c),
    'not_chains', (select coalesce(json_agg(n.auto_name order by n.auto_name), '[]'::json)
        from public.sales_chain_names n where n.not_chain),
    'distributors', (select coalesce(json_agg(d order by d.stores desc), '[]'::json) from (
        select distributor, sum(stores)::int as stores from ms group by distributor) d),
    'products', (select coalesce(json_agg(p order by p.ce desc), '[]'::json) from (
        select s.product, coalesce(s.size, 'Other') as size, round(sum(s.ce), 1) as ce,
               max(coalesce(s.last_buy_date, s.month)) as last_buy
        from public.sales_account_sales s
        where not exists (select 1 from public.sales_product_hidden h where h.product = s.product)
        group by s.product, coalesce(s.size, 'Other')) p),
    'mandate_chains', (select coalesce(json_agg(json_build_object('id', c.id, 'name', c.name) order by c.sort_order nulls last, c.name), '[]'::json)
        from public.chain_mandate_chains c),
    'mandate_items', (select coalesce(json_agg(json_build_object(
          'id', p.id, 'chain_id', p.chain_id, 'text', p.product_name, 'package', p.package,
          'stores', (select coalesce(json_agg(ltrim(st.store_number, '0')), '[]'::json)
                     from public.chain_mandate_stores st where st.product_id = p.id))
        order by p.sort_order nulls last, p.product_name), '[]'::json)
        from public.chain_mandate_products p),
    'auth_chains', (select coalesce(json_agg(json_build_object('id', c.id, 'name', c.name) order by c.sort_order nulls last, c.name), '[]'::json)
        from public.chain_auth_chains c),
    'auth_items', (select coalesce(json_agg(json_build_object('id', i.id, 'chain_id', i.chain_id, 'text', i.item_text)
          order by i.sort_order nulls last, i.item_text), '[]'::json)
        from public.chain_auth_items i),
    'list_links', (select coalesce(json_agg(l), '[]'::json) from (
        select id, list_type, list_chain_id, chain_name from public.sales_chain_list_link) l),
    'item_links', (select coalesce(json_agg(l), '[]'::json) from (
        select id, list_type, list_item_id, product, size from public.sales_chain_item_link) l),
    'statuses', (select coalesce(json_agg(s), '[]'::json) from (
        select id, chain_name, product, size, status from public.sales_chain_item_status) s),
    'names', (select coalesce(json_agg(n), '[]'::json) from (
        select id, auto_name, chain_name, not_chain from public.sales_chain_names) n)
  ) into result;
  return result;
end;
$$;

-- Same as sql/sales_dashboard_home.sql (updated there too): phones and
-- check-ins for distributor-page people on their own accounts.
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
