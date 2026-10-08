-- Sales Dashboard (Main → Sales Dashboard), added 2026-10-08, per Chad.
-- Project doc: claude/sales-dashboard-plan.md ("Sales - classification -
-- project"). Its own Users > Edit toggle: section key 'sales_dashboard'.
--
-- What this file adds:
--   sales_account_off        accounts (stores) that are turned off. A turned-off
--                            account disappears from the dashboard AND from
--                            Sales > Accounts (lists, counts, stage boxes,
--                            Product Lookup) until it's turned back on. Kept
--                            apart from the imported data, so re-imports never
--                            turn anything back on.
--   sales_chain_names        chain fixes per automatic group: rename / merge
--                            (two groups given the same name become one chain)
--                            or "not a chain".
--   sales_chain_store        per-store fixes: move a store into a chain, or out
--                            of every chain.
--   sales_chain_list_link    which dashboard chain each chain on the Chain
--                            Mandates / Chain Authorizations pages is.
--   sales_chain_item_link    which product + size each item on those two pages
--                            is (the pages are typed by hand, e.g. "152639 FULL
--                            CIRCLE CAP SAVE HAZY 19C").
--   sales_chain_item_status  Flex / Mandate / Not set picked on the dashboard
--                            for a chain + item (wins over the two pages).
--
-- Chains are worked out from store names: everything before " #<number>"
-- ("SAFEWAY #667" → SAFEWAY). A group needs 2+ stores to count as a chain,
-- unless someone set it up by hand.
--
-- The report functions check Sales Dashboard access once, then read the
-- tables directly (security definer) — the fast pattern from Product Lookup.
--
-- Also changes Sales > Accounts so turned-off accounts are left out:
--   * the read rule on sales_accounts
--   * sales_product_options() and sales_product_lookup() (same as in
--     sql/sales_product_lookup.sql, plus the turned-off filter). If
--     sales_product_lookup.sql is ever re-run, run this file again after it.
--
-- Run this in Supabase's SQL Editor BEFORE pushing the code.
-- Idempotent — safe to run more than once.

-- ---------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------
create table if not exists public.sales_account_off (
  id uuid primary key default gen_random_uuid(),
  outlet_id text not null unique,
  name text,
  turned_off_by uuid references public.profiles(id),
  turned_off_at timestamptz not null default now()
);

create table if not exists public.sales_chain_names (
  id uuid primary key default gen_random_uuid(),
  auto_name text not null unique,
  chain_name text,
  not_chain boolean not null default false,
  updated_by uuid references public.profiles(id),
  updated_at timestamptz not null default now()
);

create table if not exists public.sales_chain_store (
  id uuid primary key default gen_random_uuid(),
  outlet_id text not null unique,
  chain_name text, -- null = not in any chain
  updated_by uuid references public.profiles(id),
  updated_at timestamptz not null default now()
);

create table if not exists public.sales_chain_list_link (
  id uuid primary key default gen_random_uuid(),
  list_type text not null check (list_type in ('mandate', 'auth')),
  list_chain_id uuid not null,
  chain_name text, -- null = not one of our chains
  updated_by uuid references public.profiles(id),
  updated_at timestamptz not null default now(),
  unique (list_type, list_chain_id)
);

create table if not exists public.sales_chain_item_link (
  id uuid primary key default gen_random_uuid(),
  list_type text not null check (list_type in ('mandate', 'auth')),
  list_item_id uuid not null,
  product text, -- null = not matched to one of our products
  size text,
  updated_by uuid references public.profiles(id),
  updated_at timestamptz not null default now(),
  unique (list_type, list_item_id)
);

create table if not exists public.sales_chain_item_status (
  id uuid primary key default gen_random_uuid(),
  chain_name text not null,
  product text not null,
  size text not null,
  status text not null check (status in ('mandate', 'flex', 'none')),
  updated_by uuid references public.profiles(id),
  updated_at timestamptz not null default now(),
  unique (chain_name, product, size)
);

-- ---------------------------------------------------------------------------
-- Access rules (has_section checked once per query — the (select …) form)
-- ---------------------------------------------------------------------------
alter table public.sales_account_off enable row level security;
alter table public.sales_chain_names enable row level security;
alter table public.sales_chain_store enable row level security;
alter table public.sales_chain_list_link enable row level security;
alter table public.sales_chain_item_link enable row level security;
alter table public.sales_chain_item_status enable row level security;

do $$
declare
  t text;
begin
  foreach t in array array['sales_account_off', 'sales_chain_names', 'sales_chain_store',
                           'sales_chain_list_link', 'sales_chain_item_link', 'sales_chain_item_status']
  loop
    execute format('drop policy if exists %I on public.%I', t || '_section', t);
    execute format('create policy %I on public.%I for all using ((select public.has_section((select auth.uid()), ''sales_dashboard''))) with check ((select public.has_section((select auth.uid()), ''sales_dashboard'')))', t || '_section', t);
    execute format('grant select, insert, update, delete on public.%I to authenticated', t);
  end loop;
end $$;

-- People with Sales > Accounts (but not the dashboard) still need to READ the
-- turned-off list, so Accounts can leave those accounts out.
drop policy if exists "sales_account_off_accounts_read" on public.sales_account_off;
create policy "sales_account_off_accounts_read" on public.sales_account_off for select using (
  (select public.has_section((select auth.uid()), 'accounts'))
);

-- Sales > Accounts: turned-off accounts are left out of the list (and so out of
-- every count and stage box on the page).
drop policy if exists "sales_accounts_read" on public.sales_accounts;
create policy "sales_accounts_read" on public.sales_accounts for select using (
  (select public.has_section((select auth.uid()), 'accounts'))
  and not exists (select 1 from public.sales_account_off o where o.outlet_id = sales_accounts.outlet_id)
);

-- Live updates for the dashboard (everyone sees a change right away).
do $$
declare
  t text;
begin
  foreach t in array array['sales_account_off', 'sales_chain_names', 'sales_chain_store',
                           'sales_chain_list_link', 'sales_chain_item_link', 'sales_chain_item_status']
  loop
    if not exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t
    ) then
      execute format('alter publication supabase_realtime add table public.%I', t);
    end if;
  end loop;
end $$;

-- ---------------------------------------------------------------------------
-- Starting chain fixes (only added once; edit them on the dashboard)
-- ---------------------------------------------------------------------------
insert into public.sales_chain_names (auto_name, chain_name) values
  ('WALMART SUPERCENTER', 'WALMART'),
  ('WALMART STORE', 'WALMART'),
  ('WALMART NEIGHBORHOOD MA', 'WALMART'),
  ('TARGET STORE', 'TARGET'),
  ('SUPERTARGET', 'TARGET'),
  ('SAVE MART SUPERMARKET', 'SAVE MART'),
  ('LUCKY SUPERMARKET', 'LUCKY'),
  ('FOODMAXX', 'FOOD MAXX'),
  ('SMART & FINAL EXTRA', 'SMART & FINAL'),
  ('COSTCO BUSINESS CENTER', 'COSTCO WHOLESALE')
on conflict (auto_name) do nothing;

-- ---------------------------------------------------------------------------
-- Chain helpers (internal — called only from the functions below)
-- ---------------------------------------------------------------------------

-- "SAFEWAY #667" → 'SAFEWAY'. Null when the name has no "#<number>".
create or replace function public.sales_chain_auto(p_name text)
returns text
language sql
immutable
as $$
  select case
    when p_name ~ '#\s*[0-9]'
      then nullif(upper(regexp_replace(trim(regexp_replace(p_name, '\s*#.*$', '')), '\s+', ' ', 'g')), '')
  end;
$$;

-- Store number from the name: "SAFEWAY #667" → '667'.
create or replace function public.sales_store_number(p_name text)
returns text
language sql
immutable
as $$
  select ltrim(substring(p_name from '#\s*([0-9]+)'), '0');
$$;

-- Every account that's in a chain (turned-off accounts left out).
create or replace function public.sales_chain_members()
returns table (outlet_id text, chain text, auto_name text)
language sql
stable
security definer
set search_path = ''
as $$
  with base as (
    select a.outlet_id, public.sales_chain_auto(a.name) as auto_name
    from public.sales_accounts a
    where not exists (select 1 from public.sales_account_off o where o.outlet_id = a.outlet_id)
  ),
  named as (
    select b.outlet_id, b.auto_name,
      case
        when s.outlet_id is not null then nullif(trim(s.chain_name), '')
        when b.auto_name is null or coalesce(n.not_chain, false) then null
        else coalesce(nullif(trim(n.chain_name), ''), b.auto_name)
      end as chain,
      (s.outlet_id is not null or n.chain_name is not null) as manual
    from base b
    left join public.sales_chain_store s on s.outlet_id = b.outlet_id
    left join public.sales_chain_names n on n.auto_name = b.auto_name
  ),
  counted as (
    select n.*, count(*) over (partition by n.chain) as cnt,
           bool_or(n.manual) over (partition by n.chain) as any_manual
    from named n
    where n.chain is not null
  )
  select c.outlet_id, c.chain, c.auto_name from counted c where c.cnt >= 2 or c.any_manual;
$$;

revoke all on function public.sales_chain_members() from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Report functions (check Sales Dashboard access once)
-- ---------------------------------------------------------------------------

-- Everything the dashboard needs to start: data date, distributors, chains
-- (with store counts per distributor), the Chain Mandates / Chain
-- Authorizations lists, the links and Flex/Mandate picks, and every product +
-- size with sales (hidden products left out).
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
  if not public.has_section(auth.uid(), 'sales_dashboard') then
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

-- Gap report, By store: the chain's stores (one distributor, or all when
-- p_distributor is null) and what each store has bought, per product + size:
-- last date sold, CE in the 90 days before the data date, CE in 12 months.
-- Hidden products are left out. The page decides carried / gap.
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
  if not public.has_section(auth.uid(), 'sales_dashboard') then
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

-- Gap report, By item: for one distributor (or all when null), every chain's
-- store count, and per chain × product + size how many of its stores carry it
-- (bought in the 90 days before the data date) and their CE in those 90 days.
create or replace function public.sales_gap_by_item(p_distributor text)
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
  if not public.has_section(auth.uid(), 'sales_dashboard') then
    raise exception 'You don''t have access to the Sales Dashboard.';
  end if;
  select as_of into v_as_of from public.sales_data_meta where id = 1;
  v_as_of := coalesce(v_as_of, current_date);

  with st as (
    select m.outlet_id, m.chain, public.sales_store_number(a.name) as store_no
    from public.sales_chain_members() m
    join public.sales_accounts a on a.outlet_id = m.outlet_id
    where p_distributor is null or coalesce(a.distributor, '(none)') = p_distributor
  ),
  carried as (
    select st.chain, st.outlet_id, st.store_no, s.product, coalesce(s.size, 'Other') as size, sum(s.ce) as ce
    from public.sales_account_sales s
    join st on st.outlet_id = s.outlet_id
    where s.ce > 0
      and coalesce(s.last_buy_date, s.month) > v_as_of - 90
      and not exists (select 1 from public.sales_product_hidden h where h.product = s.product)
    group by st.chain, st.outlet_id, st.store_no, s.product, coalesce(s.size, 'Other')
  )
  select json_build_object(
    'as_of', v_as_of,
    'chains', (select coalesce(json_agg(c order by c.stores desc, c.chain), '[]'::json) from (
        select chain, count(*)::int as stores,
               coalesce(json_agg(store_no) filter (where store_no is not null), '[]'::json) as store_nos
        from st group by chain) c),
    'cells', (select coalesce(json_agg(x), '[]'::json) from (
        select chain, product, size, count(*)::int as carried, round(sum(ce), 1) as ce,
               coalesce(json_agg(store_no) filter (where store_no is not null), '[]'::json) as store_nos
        from carried group by chain, product, size) x)
  ) into result;
  return result;
end;
$$;

-- Search every account (for turning one off, or adding a store to a chain).
create or replace function public.sales_dash_search(p_q text)
returns table (outlet_id text, name text, city text, distributor text, chain text, is_off boolean)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not public.has_section(auth.uid(), 'sales_dashboard') then
    raise exception 'You don''t have access to the Sales Dashboard.';
  end if;
  return query
    select a.outlet_id, a.name, a.city, a.distributor, m.chain,
           exists (select 1 from public.sales_account_off o where o.outlet_id = a.outlet_id)
    from public.sales_accounts a
    left join public.sales_chain_members() m on m.outlet_id = a.outlet_id
    where length(trim(coalesce(p_q, ''))) >= 2
      and (a.name ilike '%' || trim(p_q) || '%' or a.outlet_id = trim(p_q)
           or coalesce(a.city, '') ilike '%' || trim(p_q) || '%' or coalesce(a.address, '') ilike '%' || trim(p_q) || '%')
    order by a.name
    limit 50;
end;
$$;

-- The turned-off list, with each account's details.
create or replace function public.sales_dash_off_list()
returns table (id uuid, outlet_id text, name text, city text, distributor text, turned_off_at timestamptz, turned_off_by text)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not public.has_section(auth.uid(), 'sales_dashboard') then
    raise exception 'You don''t have access to the Sales Dashboard.';
  end if;
  return query
    select o.id, o.outlet_id, coalesce(a.name, o.name), a.city, a.distributor, o.turned_off_at,
           (select p.full_name from public.profiles p where p.id = o.turned_off_by)
    from public.sales_account_off o
    left join public.sales_accounts a on a.outlet_id = o.outlet_id
    order by o.turned_off_at desc;
end;
$$;

-- ---------------------------------------------------------------------------
-- Sales > Accounts > Product Lookup: same as sql/sales_product_lookup.sql,
-- plus turned-off accounts left out.
-- ---------------------------------------------------------------------------
create or replace function public.sales_product_options()
returns table (product text, size text, ce numeric)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not public.has_section(auth.uid(), 'accounts') then
    raise exception 'You don''t have access to Sales > Accounts.';
  end if;
  return query
    select s.product, coalesce(s.size, 'Other') as size, sum(s.ce) as ce
    from public.sales_account_sales s
    where not exists (select 1 from public.sales_account_off o where o.outlet_id = s.outlet_id)
    group by s.product, coalesce(s.size, 'Other')
    order by sum(s.ce) desc;
end;
$$;

create or replace function public.sales_product_lookup(
  p_products text[],
  p_sizes text[],
  p_distributors text[],
  p_outlet text,
  p_premise text,
  p_from date,
  p_to date
)
returns json
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  result json;
begin
  if not public.has_section(auth.uid(), 'accounts') then
    raise exception 'You don''t have access to Sales > Accounts.';
  end if;

  with f as (
    select s.outlet_id, s.month, s.product, coalesce(s.size, 'Other') as size, s.distributor, s.ce,
           s.ce / public.sales_case_factor(coalesce(s.size, 'Other')) as cases
    from public.sales_account_sales s
    where s.month between p_from and p_to
      and (p_products is null or cardinality(p_products) = 0 or s.product = any(p_products))
      and (p_sizes is null or cardinality(p_sizes) = 0 or coalesce(s.size, 'Other') = any(p_sizes))
      and (p_distributors is null or cardinality(p_distributors) = 0 or s.distributor = any(p_distributors))
      and (p_outlet is null or s.outlet_id = p_outlet)
      and (p_premise is null or exists (
            select 1 from public.sales_accounts a where a.outlet_id = s.outlet_id and a.premise = p_premise))
      and not exists (select 1 from public.sales_account_off o where o.outlet_id = s.outlet_id)
  )
  select json_build_object(
    'totals', (select json_build_object('ce', coalesce(sum(ce), 0), 'cases', coalesce(sum(cases), 0),
                                        'accounts', count(distinct outlet_id), 'months', count(distinct month)) from f),
    'by_month', (select coalesce(json_agg(m order by m.month), '[]'::json) from (
        select month, sum(ce) as ce, sum(cases) as cases, count(distinct outlet_id) as accounts
        from f group by month) m),
    'by_distributor', (select coalesce(json_agg(d order by d.cases desc), '[]'::json) from (
        select coalesce(distributor, '(none)') as distributor, sum(ce) as ce, sum(cases) as cases,
               count(distinct outlet_id) as accounts
        from f group by coalesce(distributor, '(none)')) d),
    'by_product', (select coalesce(json_agg(p order by p.cases desc), '[]'::json) from (
        select product, size, sum(ce) as ce, sum(cases) as cases, count(distinct outlet_id) as accounts
        from f group by product, size) p),
    'by_account', (select coalesce(json_agg(x order by x.last_month desc, x.cases desc), '[]'::json) from (
        select g.outlet_id, a.name, a.city, g.distributor, round(g.ce, 2) as ce, round(g.cases, 2) as cases, g.last_month,
               round(lm.ce, 2) as last_ce, round(lm.cases, 2) as last_cases
        from (
          select outlet_id, max(distributor) as distributor, sum(ce) as ce, sum(cases) as cases, max(month) as last_month
          from f group by outlet_id
        ) g
        left join (
          select outlet_id, month, sum(ce) as ce, sum(cases) as cases from f group by outlet_id, month
        ) lm on lm.outlet_id = g.outlet_id and lm.month = g.last_month
        left join public.sales_accounts a on a.outlet_id = g.outlet_id) x)
  )
  into result;
  return result;
end;
$$;

-- ---------------------------------------------------------------------------
-- Who can call what
-- ---------------------------------------------------------------------------
revoke all on function public.sales_dash_overview() from public, anon;
revoke all on function public.sales_gap_by_store(text, text) from public, anon;
revoke all on function public.sales_gap_by_item(text) from public, anon;
revoke all on function public.sales_dash_search(text) from public, anon;
revoke all on function public.sales_dash_off_list() from public, anon;
revoke all on function public.sales_product_options() from public, anon;
revoke all on function public.sales_product_lookup(text[], text[], text[], text, text, date, date) from public, anon;
grant execute on function public.sales_chain_auto(text) to authenticated;
grant execute on function public.sales_store_number(text) to authenticated;
grant execute on function public.sales_dash_overview() to authenticated;
grant execute on function public.sales_gap_by_store(text, text) to authenticated;
grant execute on function public.sales_gap_by_item(text) to authenticated;
grant execute on function public.sales_dash_search(text) to authenticated;
grant execute on function public.sales_dash_off_list() to authenticated;
grant execute on function public.sales_product_options() to authenticated;
grant execute on function public.sales_product_lookup(text[], text[], text[], text, text, date, date) to authenticated;
