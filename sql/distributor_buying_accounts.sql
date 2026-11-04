-- Distributor pages: Buying accounts (last 60 days) — added 2026-11-04, per
-- Chad ("shows all active accounts, and what they are buying, everything less
-- then 60"). Plan: claude/buying-accounts-60-plan.md.
-- Run in Supabase SQL Editor BEFORE pushing the matching code. Idempotent —
-- safe to run more than once. Read-only; no new tables.
--
-- Every account of one distributor that ordered in the last p_days days
-- (counted back from the sales data date, sales_data_meta.as_of) — the same
-- rule as "Buying accounts" in <distributor> at a glance (stages New + Active +
-- Re-Activated), so the list and the number match. For each account: what it
-- bought in those days, per product + package size, with cases (CEs) and the
-- last buy. Sales are stored by month, so a month only partly inside the
-- window is split by days (same method as sales_dash_home). Turned-off /
-- removed accounts and hidden products are left out, like everywhere else.
--
-- Same access as the rest of the distributor page (sales_can_see): Sales
-- Dashboard people, or people with that distributor's page — a Matagrano-only
-- rep can't open Guardian's list.

create or replace function public.sales_territory_buying(p_dist text, p_days integer default 60)
returns json
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  a date;    -- the data's as-of date
  w0 date;   -- first day of the window
  n integer := greatest(1, least(coalesce(p_days, 60), 400));
begin
  if not public.sales_can_see(array[p_dist]) then
    raise exception 'You don''t have access to this distributor.';
  end if;
  select m.as_of into a from public.sales_data_meta m where m.id = 1;
  if a is null then
    return json_build_object('as_of', null, 'from', null, 'days', n, 'accounts', '[]'::json);
  end if;
  w0 := a - (n - 1);

  return (
    with
    acc as (
      select x.outlet_id, x.name, x.city, x.address, x.premise, x.last_buy_date as lb
      from public.sales_accounts x
      where x.distributor = p_dist
        and x.last_buy_date is not null
        and a - x.last_buy_date < n
        and x.last_buy_date <= a
        and not exists (select 1 from public.sales_account_off o where o.outlet_id = x.outlet_id)
    ),
    -- Sales rows that touch the window, with the day span each row covers.
    s as (
      select r.outlet_id, r.product, coalesce(r.size, 'Other') as size, r.ce, r.last_buy_date,
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
        and r.month >= date_trunc('month', w0)::date
        and r.month <= a
        and r.outlet_id in (select outlet_id from acc)
        and not exists (select 1 from public.sales_product_hidden h where h.product = r.product)
    ),
    it as (
      select s.outlet_id, s.product, s.size,
             round(sum(s.ce * greatest(0, least(s.hi, a) - greatest(s.lo, w0) + 1)::numeric / (s.hi - s.lo + 1)), 1) as ce,
             max(s.last_buy_date) filter (where s.last_buy_date between w0 and a) as last_buy
      from s
      where s.lo <= a and s.hi >= w0
      group by s.outlet_id, s.product, s.size
    ),
    items as (
      select it.outlet_id,
             json_agg(json_build_object('product', it.product, 'size', it.size, 'ce', it.ce, 'last_buy', it.last_buy)
                      order by it.ce desc, it.product, it.size) as items,
             sum(it.ce) as ce
      from it
      where it.ce > 0 or it.last_buy is not null
      group by it.outlet_id
    )
    select json_build_object(
      'as_of', a,
      'from', w0,
      'days', n,
      'accounts', coalesce((
        select json_agg(json_build_object(
                 'outlet_id', acc.outlet_id, 'name', acc.name, 'city', acc.city, 'address', acc.address,
                 'premise', acc.premise, 'last_buy', acc.lb,
                 'ce', round(coalesce(i.ce, 0), 1), 'items', coalesce(i.items, '[]'::json))
               order by coalesce(i.ce, 0) desc, acc.name)
        from acc left join items i on i.outlet_id = acc.outlet_id
      ), '[]'::json)
    )
  );
end;
$$;
revoke all on function public.sales_territory_buying(text, integer) from public, anon;
grant execute on function public.sales_territory_buying(text, integer) to authenticated;
comment on function public.sales_territory_buying(text, integer) is
  $c$[hidden] Distributor pages: every account of one distributor that ordered in the last N days (default 60, same rule as "Buying accounts" at a glance), with what each bought in those days per product + size (CEs, last buy).$c$;
