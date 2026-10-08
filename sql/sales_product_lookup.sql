-- Sales > Accounts > Product Lookup (added 2026-10-08, per Chad: "if i wanted
-- to see how many mystic haze 12oz cases were sold to matagrano in a certain
-- time period"). Whole months only (Chad: "i only need whole months").
--
-- Adds a cleaned-up package size to every purchase row (sales_account_sales.size:
-- 12oz, 16oz, 19.2oz, 22oz bottle, 1/2 bbl, 1/6 bbl, 13.2 gal keg, Other), filled
-- by the import file, and two read-only lookups the page calls:
--   sales_product_options()  every product + size that has sales (for the pickers)
--   sales_product_lookup(...) totals, by month, by distributor, by product + size,
--                             and by account, for the chosen filters
-- Cases are worked out from CE by size: 12oz case (24) = 1 CE, 16oz case (24) =
-- 1.333 CE, 19.2oz case (12) = 0.8 CE, 22oz case (12) = 0.917 CE, 1/2 bbl =
-- 6.889 CE, 1/6 bbl = 2.293 CE, 13.2 gal keg = 5.867 CE.
--
-- Both check Accounts access once (has_section(…, 'accounts')) and then read
-- the tables directly, so wide searches stay fast. Run this in Supabase's SQL Editor BEFORE pushing the code.
-- Idempotent — safe to run more than once.

alter table public.sales_account_sales add column if not exists size text;
create index if not exists sales_account_sales_lookup_idx
  on public.sales_account_sales (product, size, month);

create or replace function public.sales_case_factor(p_size text)
returns numeric
language sql
immutable
as $$
  select case p_size
    when '12oz' then 1
    when '16oz' then 1.3333
    when '19.2oz' then 0.8
    when '22oz bottle' then 0.9167
    when '1/2 bbl' then 6.8889
    when '1/6 bbl' then 2.2933
    when '13.2 gal keg' then 5.8667
    else 1
  end;
$$;

-- Both lookups check access ONCE and then read the tables directly (security
-- definer). Before 2026-10-08 they ran the per-row access rule on every one of
-- ~120k purchase rows, which hit Supabase's statement timeout on wide searches.
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
    group by s.product, coalesce(s.size, 'Other')
    order by sum(s.ce) desc;
end;
$$;

-- p_products / p_sizes / p_distributors: null or empty = all.
-- p_outlet: one account (VIP Outlet ID) or null. p_premise: 'On' / 'Off' / null.
-- p_from / p_to: first day of the From month and of the To month (inclusive).
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
    'by_account', (select coalesce(json_agg(x order by x.cases desc), '[]'::json) from (
        select g.outlet_id, a.name, a.city, g.distributor, g.ce, g.cases, g.last_month
        from (
          select outlet_id, max(distributor) as distributor, sum(ce) as ce, sum(cases) as cases, max(month) as last_month
          from f group by outlet_id
          order by sum(cases) desc
          limit 500
        ) g
        left join public.sales_accounts a on a.outlet_id = g.outlet_id) x)
  )
  into result;
  return result;
end;
$$;

-- Faster read rules: has_section() is checked once per query instead of once
-- per row (the (select …) form), for every Sales > Accounts table.
do $$
declare
  t record;
begin
  for t in
    select * from (values
      ('sales_accounts', 'sales_accounts_read', 'select'),
      ('sales_account_sales', 'sales_account_sales_read', 'select'),
      ('sales_account_contacts', 'sales_account_contacts_read', 'select'),
      ('sales_data_meta', 'sales_data_meta_read', 'select'),
      ('sales_account_class', 'sales_account_class_section', 'all'),
      ('sales_account_checkins', 'sales_account_checkins_section', 'all')
    ) as v(tbl, pol, cmd)
  loop
    execute format('drop policy if exists %I on public.%I', t.pol, t.tbl);
    if t.cmd = 'select' then
      execute format('create policy %I on public.%I for select using ((select public.has_section((select auth.uid()), ''accounts'')))', t.pol, t.tbl);
    else
      execute format('create policy %I on public.%I for all using ((select public.has_section((select auth.uid()), ''accounts''))) with check ((select public.has_section((select auth.uid()), ''accounts'')))', t.pol, t.tbl);
    end if;
  end loop;
end $$;

revoke all on function public.sales_product_options() from public, anon;
revoke all on function public.sales_product_lookup(text[], text[], text[], text, text, date, date) from public, anon;
grant execute on function public.sales_case_factor(text) to authenticated;
grant execute on function public.sales_product_options() to authenticated;
grant execute on function public.sales_product_lookup(text[], text[], text[], text, text, date, date) to authenticated;
