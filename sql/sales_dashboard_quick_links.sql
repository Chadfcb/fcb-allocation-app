-- Sales Dashboard quick links — added 2026-10-28, per Chad (the new sales
-- manager kept asking where things are: "Distributor Inventory, Chain Gap
-- Report, UPC's, POS, Account Finder — those are the buttons i want under the
-- sales Dashboard").
-- Run in Supabase SQL Editor BEFORE pushing the matching code. Idempotent —
-- safe to run more than once. Read-only functions only; no tables changed.
--
--   sales_account_finder(q)                 Account Finder: search EVERY
--                                           distributor's accounts at once.
--   sales_dist_product_sales(dist, products, size)
--                                           Distributor Inventory → click a
--                                           product: that product's sales at
--                                           that distributor (by month, by
--                                           account).
--
-- Both are for Sales Dashboard people only (has_section 'sales_dashboard';
-- admins always have it). The account pop-up they open is the existing
-- sales_territory_account(), unchanged.

-- ---------------------------------------------------------------------------
-- Account Finder
-- ---------------------------------------------------------------------------
create or replace function public.sales_account_finder(p_q text)
returns json
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  q text := trim(coalesce(p_q, ''));
begin
  if not public.has_section(auth.uid(), 'sales_dashboard') then
    raise exception 'You don''t have access to the Sales Dashboard.';
  end if;
  if length(q) < 2 then
    return '[]'::json;
  end if;
  return (
    select coalesce(json_agg(x), '[]'::json) from (
      select a.outlet_id, a.name, a.city, a.address, a.premise, a.distributor, a.last_buy_date,
             exists (select 1 from public.sales_account_off o where o.outlet_id = a.outlet_id) as is_off
      from public.sales_accounts a
      where a.name ilike '%' || q || '%'
         or coalesce(a.city, '') ilike '%' || q || '%'
         or coalesce(a.address, '') ilike '%' || q || '%'
         or a.outlet_id = q
      order by (a.name ilike q || '%') desc, a.last_buy_date desc nulls last, a.name
      limit 40
    ) x
  );
end;
$$;
revoke all on function public.sales_account_finder(text) from public, anon;
grant execute on function public.sales_account_finder(text) to authenticated;
comment on function public.sales_account_finder(text) is
  $c$[hidden] Sales Dashboard → Account Finder: search every distributor's accounts by name, store number, city, address or outlet id (up to 40; opens the account pop-up).$c$;

-- ---------------------------------------------------------------------------
-- One product's sales at one distributor (Distributor Inventory pop-up)
-- ---------------------------------------------------------------------------
-- p_products: the LilyPad product name(s) for the brand (the page maps the
-- inventory product to them); p_size: '12oz', '16oz', '19.2oz', '1/2 bbl',
-- '1/6 bbl' … (null = every size). Cases = CE ÷ the size's case factor
-- (sales_case_factor, same as Product Lookup).
--   months   : cases per month, the last 25 months (this year + last year)
--   periods  : cases in the last 30 / 90 days and year to date, and the same
--              days last year — part-months split by days, same rule as the
--              Sales Dashboard home
--   accounts : every account that bought it in the last 2 years: last buy,
--              cases last 90 days / last 12 months
create or replace function public.sales_dist_product_sales(p_dist text, p_products text[], p_size text)
returns json
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  a date;
  y0 date;
  result json;
begin
  if not public.has_section(auth.uid(), 'sales_dashboard') then
    raise exception 'You don''t have access to the Sales Dashboard.';
  end if;
  select m.as_of into a from public.sales_data_meta m where m.id = 1;
  if a is null or p_products is null or cardinality(p_products) = 0 then
    return json_build_object('as_of', a, 'months', '[]'::json, 'periods', '[]'::json, 'accounts', '[]'::json);
  end if;
  y0 := date_trunc('year', a)::date;

  with
  win as (
    select v.p, 'ty'::text as yr, v.ws, v.we
    from (values ('30', a - 29, a), ('90', a - 89, a), ('ytd', y0, a)) v(p, ws, we)
    union all
    select v.p, 'ly', (v.ws - interval '1 year')::date, (v.we - interval '1 year')::date
    from (values ('30', a - 29, a), ('90', a - 89, a), ('ytd', y0, a)) v(p, ws, we)
  ),
  s as (
    select r.outlet_id, r.month,
           r.ce / public.sales_case_factor(coalesce(r.size, 'Other')) as cases,
           coalesce(r.last_buy_date, least((r.month + interval '1 month' - interval '1 day')::date, a)) as lb,
           coalesce(r.first_buy_in_month, r.month) as lo,
           greatest(
             coalesce(r.first_buy_in_month, r.month),
             case
               when r.last_buy_date is not null and (r.first_buy_in_month is not null or r.last_buy_date <> r.month)
                 then r.last_buy_date
               else least((r.month + interval '1 month' - interval '1 day')::date, a)
             end) as hi
    from public.sales_account_sales r
    where r.distributor = p_dist
      and r.product = any(p_products)
      and (p_size is null or coalesce(r.size, 'Other') = p_size)
      and r.month >= (date_trunc('month', a) - interval '24 months')::date
      and r.month <= a
      and not exists (select 1 from public.sales_account_off o where o.outlet_id = r.outlet_id)
  )
  select json_build_object(
    'as_of', a,
    'months', (select coalesce(json_agg(m order by m.month), '[]'::json) from (
        select s.month, round(sum(s.cases), 1) as cases from s group by s.month) m),
    'periods', (select coalesce(json_agg(pp), '[]'::json) from (
        select w.p, w.yr,
               round(coalesce(sum(s.cases * greatest(0, least(s.hi, w.we) - greatest(s.lo, w.ws) + 1)::numeric / (s.hi - s.lo + 1)), 0), 1) as cases
        from win w left join s on s.lo <= w.we and s.hi >= w.ws
        group by w.p, w.yr) pp),
    'accounts', (select coalesce(json_agg(x order by x.last_buy desc), '[]'::json) from (
        select s.outlet_id, ac.name, ac.city, ac.premise,
               max(s.lb) as last_buy,
               round(sum(s.cases) filter (where s.month >= date_trunc('month', a - 89)::date), 1) as cases_90,
               round(sum(s.cases) filter (where s.month > (date_trunc('month', a) - interval '12 months')::date), 1) as cases_12
        from s join public.sales_accounts ac on ac.outlet_id = s.outlet_id
        group by s.outlet_id, ac.name, ac.city, ac.premise) x)
  ) into result;
  return result;
end;
$$;
revoke all on function public.sales_dist_product_sales(text, text[], text) from public, anon;
grant execute on function public.sales_dist_product_sales(text, text[], text) to authenticated;
comment on function public.sales_dist_product_sales(text, text[], text) is
  $c$[needs:sales_dashboard] One product's sales at one distributor (LilyPad): cases by month for 2 years, cases last 30 / 90 days and year to date vs the same days last year, and every account that bought it with its last buy and cases last 90 days / 12 months.$c$;
