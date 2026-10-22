-- My Territory (added 2026-10-21, per Chad): a rep's own daily dashboard —
-- "a Matagrano dashboard specifically for Steve … with information pertaining
-- just to matagrano, for him to look at each day and be able to make
-- decisions." Plan: claude/rep-dashboard-plan.md.
--
-- What this file adds:
--   rep_territories     which distributor(s) each rep covers (set on
--                       Admin → Users → Edit access → Territory). A rep with
--                       the "My Territory" section sees only these.
--   my_territories()    the signed-in person's distributor(s).
--   sales_can_see(d[])  true for Sales Dashboard people (any distributor), or
--                       My Territory people when every distributor asked for
--                       is theirs. Used by sales_dash_home,
--                       sales_gap_by_store and the two functions below.
--   sales_territory_stock(dist)    the distributor's latest inventory (on hand,
--                       rate of sale, weeks of supply) + its newest-week order.
--   sales_territory_account(id)    one account's details (sales by month,
--                       last check-ins) for a rep's pop-up.
--   sales_dash_overview / sales_gap_by_store — same as sql/sales_dashboard.sql
--                       with the My Territory access added (that file was
--                       updated the same way).
--   sales_data_meta read rule for My Territory (so the page updates live).
--
-- Run this FIRST in Supabase's SQL Editor, then
-- sql/sales_dashboard_home.sql, then push. Idempotent.

create table if not exists public.rep_territories (
  user_id uuid not null references public.profiles(id) on delete cascade,
  distributor text not null,
  updated_by uuid references public.profiles(id),
  updated_at timestamptz not null default now(),
  primary key (user_id, distributor)
);

alter table public.rep_territories enable row level security;
drop policy if exists "rep_territories_read" on public.rep_territories;
create policy "rep_territories_read" on public.rep_territories for select using (
  user_id = (select auth.uid())
  or exists (select 1 from public.profiles p where p.id = (select auth.uid()) and p.role = 'admin')
);
drop policy if exists "rep_territories_admin_write" on public.rep_territories;
create policy "rep_territories_admin_write" on public.rep_territories for all
  using (exists (select 1 from public.profiles p where p.id = (select auth.uid()) and p.role = 'admin'))
  with check (exists (select 1 from public.profiles p where p.id = (select auth.uid()) and p.role = 'admin'));

grant select, insert, update, delete on public.rep_territories to authenticated;
grant select, insert, update, delete on public.rep_territories to service_role;

comment on table public.rep_territories is $c$Which distributor territory each sales rep covers (user_id → distributor name, e.g. Steve → Matagrano). A rep with the My Territory section sees only these distributors on the My Territory page. Set on Admin → Users → Edit access → Territory.$c$;

create or replace function public.my_territories()
returns text[]
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(array_agg(t.distributor order by t.distributor), '{}')
  from public.rep_territories t where t.user_id = auth.uid();
$$;
revoke all on function public.my_territories() from public, anon;
grant execute on function public.my_territories() to authenticated;

create or replace function public.sales_can_see(p_dists text[])
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select public.has_section(auth.uid(), 'sales_dashboard')
    or (
      public.has_section(auth.uid(), 'my_territory')
      and p_dists is not null and cardinality(p_dists) > 0
      and p_dists <@ (select coalesce(array_agg(t.distributor), '{}') from public.rep_territories t where t.user_id = auth.uid())
    );
$$;
revoke all on function public.sales_can_see(text[]) from public, anon;
grant execute on function public.sales_can_see(text[]) to authenticated;

-- Live updates on My Territory: reps can read the as-of date too.
drop policy if exists "sales_data_meta_territory_read" on public.sales_data_meta;
create policy "sales_data_meta_territory_read" on public.sales_data_meta for select using (
  (select public.has_section((select auth.uid()), 'my_territory'))
);

-- The distributor's stock: latest Distributor Inventory week for it (on hand,
-- rate of sale per week, weeks of supply), and the newest week's order on
-- Inventory & Allocation (every row named like it, e.g. "Matagrano 2").
create or replace function public.sales_territory_stock(p_dist text)
returns json
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_inv_week uuid;
  v_ord_week uuid;
  result json;
begin
  if not public.sales_can_see(array[p_dist]) then
    raise exception 'You don''t have access to this territory.';
  end if;
  select di.week_id into v_inv_week
  from public.distributor_inventory di
  join public.distributors d on d.id = di.distributor_id
  join public.weeks w on w.id = di.week_id
  where d.name = p_dist
  order by w.week_start desc limit 1;
  select w.id into v_ord_week from public.weeks w order by w.week_start desc limit 1;

  select json_build_object(
    'inventory_week', (select json_build_object('label', w.label, 'week_start', w.week_start) from public.weeks w where w.id = v_inv_week),
    'inventory', (select coalesce(json_agg(x order by x.weeks_left nulls last, x.product), '[]'::json) from (
        select p.name as product, di.on_hand_qty as on_hand, di.rate_of_sale as per_week,
               case when di.rate_of_sale > 0 then round(di.on_hand_qty / di.rate_of_sale, 1) end as weeks_left,
               di.imported_at
        from public.distributor_inventory di
        join public.distributors d on d.id = di.distributor_id
        join public.products p on p.id = di.product_id
        where di.week_id = v_inv_week and d.name = p_dist
          and (di.on_hand_qty > 0 or di.rate_of_sale > 0)) x),
    'order_week', (select json_build_object('label', w.label, 'week_start', w.week_start) from public.weeks w where w.id = v_ord_week),
    'order', (select coalesce(json_agg(x order by x.distributor, x.product), '[]'::json) from (
        select d.name as distributor, p.name as product, a.quantity, a.status_flag
        from public.allocations a
        join public.distributors d on d.id = a.distributor_id
        join public.products p on p.id = a.product_id
        where a.week_id = v_ord_week and a.quantity > 0
          and (d.name = p_dist or d.name like p_dist || ' %')) x),
    'order_status', (select coalesce(json_agg(x), '[]'::json) from (
        select d.name as distributor, po.po_number, po.po_status
        from public.distributor_pos po
        join public.distributors d on d.id = po.distributor_id
        where po.week_id = v_ord_week and (d.name = p_dist or d.name like p_dist || ' %')) x)
  ) into result;
  return result;
end;
$$;
revoke all on function public.sales_territory_stock(text) from public, anon;
grant execute on function public.sales_territory_stock(text) to authenticated;
comment on function public.sales_territory_stock(text) is $c$[needs:my_territory] One distributor's stock for a rep: latest Distributor Inventory (on hand, rate of sale per week, weeks of supply per product) and the newest week's order on Inventory & Allocation with its PO status.$c$;

-- One account for a rep's pop-up: details, cases by month and item (last 13
-- months), last 10 check-ins with notes.
create or replace function public.sales_territory_account(p_outlet text)
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
  if v_dist is null or not (public.has_section(auth.uid(), 'accounts') or public.sales_can_see(array[v_dist])) then
    raise exception 'You don''t have access to this account.';
  end if;
  select json_build_object(
    'account', (select json_build_object('outlet_id', a.outlet_id, 'name', a.name, 'address', a.address, 'city', a.city,
        'zip', a.zip, 'phone', a.phone, 'distributor', a.distributor, 'premise', a.premise, 'last_buy', a.last_buy_date,
        'first_buy', a.first_buy_date, 'ce_12mo', a.ce_12mo, 'lifetime_ce', a.lifetime_ce)
      from public.sales_accounts a where a.outlet_id = p_outlet),
    'as_of', (select m.as_of from public.sales_data_meta m where m.id = 1),
    'sales', (select coalesce(json_agg(x order by x.month desc, x.ce desc), '[]'::json) from (
        select s.month, s.product, coalesce(s.size, '') as size, round(sum(s.ce), 1) as ce, max(s.last_buy_date) as last_buy
        from public.sales_account_sales s
        where s.outlet_id = p_outlet
          and s.month >= (date_trunc('month', (select m.as_of from public.sales_data_meta m where m.id = 1)) - interval '12 months')::date
        group by s.month, s.product, s.size) x),
    'checkins', (select coalesce(json_agg(x order by x.checkin_date desc), '[]'::json) from (
        select k.checkin_date, k.rep, k.activity, k.notes, k.brands
        from public.sales_account_checkins k where k.outlet_id = p_outlet
        order by k.checkin_date desc limit 10) x)
  ) into result;
  return result;
end;
$$;
revoke all on function public.sales_territory_account(text) from public, anon;
grant execute on function public.sales_territory_account(text) to authenticated;
comment on function public.sales_territory_account(text) is $c$[needs:my_territory] One account's details for a rep: address, phone, last buy, cases last 12 months, cases by month and item for the last 13 months, and the last 10 check-ins with notes.$c$;

-- ---------------------------------------------------------------------------
-- Same as sql/sales_dashboard.sql (updated there too), with My Territory access.
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
  -- Sales Dashboard, or My Territory (a rep's page — 2026-10-21; chain lists
  -- only, no sales numbers per store here).
  if not (public.has_section(auth.uid(), 'sales_dashboard') or public.has_section(auth.uid(), 'my_territory')) then
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

create or replace function public.sales_gap_by_store(p_chain text, p_distributor text)
returns json
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  result json;
  v_as_of date;
begin
  -- My Territory users (2026-10-21) only for their own distributor(s).
  if not public.sales_can_see(case when p_distributor is null then null else array[p_distributor] end) then
    raise exception 'You don''t have access to the Sales Dashboard.';
  end if;
  select as_of into v_as_of from public.sales_data_meta where id = 1;
  v_as_of := coalesce(v_as_of, current_date);

  with st as (
    select a.outlet_id, a.name, a.address, a.city, a.zip, coalesce(a.distributor, '(none)') as distributor,
           a.premise, a.last_buy_date, public.sales_store_number(a.name) as store_no
    from public.sales_chain_members() m
    join public.sales_accounts a on a.outlet_id = m.outlet_id
    where m.chain = p_chain
      and (p_distributor is null or coalesce(a.distributor, '(none)') = p_distributor)
  )
  select json_build_object(
    'as_of', v_as_of,
    'stores', (select coalesce(json_agg(st order by st.name), '[]'::json) from st),
    'buys', (select coalesce(json_agg(b), '[]'::json) from (
        select s.outlet_id, s.product, coalesce(s.size, 'Other') as size,
               max(coalesce(s.last_buy_date, s.month)) as last_buy,
               round(coalesce(sum(s.ce) filter (where coalesce(s.last_buy_date, s.month) > v_as_of - 90), 0), 2) as ce90,
               round(coalesce(sum(s.ce) filter (where s.month > (date_trunc('month', v_as_of) - interval '12 months')), 0), 2) as ce12
        from public.sales_account_sales s
        where s.outlet_id in (select outlet_id from st)
          and s.ce > 0
          and not exists (select 1 from public.sales_product_hidden h where h.product = s.product)
        group by s.outlet_id, s.product, coalesce(s.size, 'Other')) b)
  ) into result;
  return result;
end;
$$;
