-- Brew Planner — demand pots + commitments (2026-10-23, per Chad).
-- Plan: claude/brew-planner-plan.md. Run this in Supabase's SQL Editor BEFORE
-- pushing the code. Idempotent — safe to run more than once.
--
-- 1. brew_planner_commitments: accounts / chains that have committed to a
--    product at an expected rate ("they have x amount of commitments, the
--    velocity should be this"). Entered by hand on the Brew Planner page for
--    now (LilyPad later). Each one adds to that beer's demand from its start
--    date, so the planner's brew amount goes up.
-- 2. brew_planner_account_pots(): LilyPad sales for the planner's products,
--    split into Recurring / New / Lost accounts, per product, distributor and
--    month — same 60-day rules as the Sales Dashboard (sales_dash_home).

create table if not exists public.brew_planner_commitments (
  id uuid primary key default gen_random_uuid(),
  account text not null,
  distributor text,
  product_id uuid not null references public.products (id) on delete cascade,
  qty numeric not null check (qty > 0),
  per text not null default 'week' check (per in ('week', 'month')),
  start_date date not null,
  end_date date,
  note text,
  created_by uuid references auth.users (id),
  created_at timestamptz not null default now(),
  updated_by uuid references auth.users (id),
  updated_at timestamptz not null default now()
);

comment on table public.brew_planner_commitments is
  'Brew Planner commitments: an account or chain (account, distributor) committed to a product (product_id) at qty cases/kegs per week or per month (per), from start_date to end_date (open = ongoing). Added to that base beer''s demand in the Brew Planner. Use for "what commitments do we have", "who committed to X", "how much extra demand is coming for X".';

alter table public.brew_planner_commitments enable row level security;

drop policy if exists "brew_planner_commitments_select" on public.brew_planner_commitments;
create policy "brew_planner_commitments_select" on public.brew_planner_commitments
  for select using (public.has_section(auth.uid(), 'brew_planner'));
drop policy if exists "brew_planner_commitments_insert" on public.brew_planner_commitments;
create policy "brew_planner_commitments_insert" on public.brew_planner_commitments
  for insert with check (public.has_section(auth.uid(), 'brew_planner'));
drop policy if exists "brew_planner_commitments_update" on public.brew_planner_commitments;
create policy "brew_planner_commitments_update" on public.brew_planner_commitments
  for update using (public.has_section(auth.uid(), 'brew_planner')) with check (public.has_section(auth.uid(), 'brew_planner'));
drop policy if exists "brew_planner_commitments_delete" on public.brew_planner_commitments;
create policy "brew_planner_commitments_delete" on public.brew_planner_commitments
  for delete using (public.has_section(auth.uid(), 'brew_planner'));

grant select, insert, update, delete on public.brew_planner_commitments to authenticated;
grant select, insert, update, delete on public.brew_planner_commitments to service_role;

-- ---------------------------------------------------------------------------
-- Account pots. Per LilyPad account × product: last buy (lb) and first buy
-- (fb) over all history; stage on the data's as-of date (a):
--   lost      = no order in the last 60+ days (a - lb > 60)
--   new       = first order in the last 60 days
--   recurring = everyone else
-- Returns { as_of, months, ce: [{product, distributor, pot, ym, keg, ce}],
--           accounts: [{product, distributor, pot, n}] } for the 3 full months
-- before a's month plus a's month so far. Server-only (the page reads it with
-- the service key after its own access check).
-- ---------------------------------------------------------------------------
create or replace function public.brew_planner_account_pots(p_products text[])
returns json
language plpgsql
stable
security definer
set search_path to ''
as $$
declare
  a date;
  m0 date;
  result json;
begin
  select m.as_of into a from public.sales_data_meta m order by m.imported_at desc nulls last limit 1;
  if a is null then
    return json_build_object('as_of', null);
  end if;
  m0 := (date_trunc('month', a) - interval '3 months')::date;

  with g as (
    select r.outlet_id, r.product,
           max(coalesce(r.last_buy_date, r.month)) as lb,
           min(coalesce(r.first_buy_in_month, r.month)) as fb
    from public.sales_account_sales r
    where r.product = any(p_products)
    group by r.outlet_id, r.product
  ),
  w as (
    select r.outlet_id, r.product, r.distributor, to_char(r.month, 'YYYY-MM') as ym,
           (coalesce(r.package, '') ~* '(keg|1/2|1/6|bbl)') as keg, r.ce,
           case when a - g.lb > 60 then 'lost' when a - g.fb <= 60 then 'new' else 'recurring' end as pot
    from public.sales_account_sales r
    join g on g.outlet_id = r.outlet_id and g.product = r.product
    where r.product = any(p_products) and r.month >= m0
  )
  select json_build_object(
    'as_of', a,
    'ce', (select coalesce(json_agg(c), '[]'::json) from (
      select product, distributor, pot, ym, keg, round(sum(ce), 3) as ce
      from w group by product, distributor, pot, ym, keg) c),
    'accounts', (select coalesce(json_agg(c), '[]'::json) from (
      select product, distributor, pot, count(distinct outlet_id)::int as n
      from w group by product, distributor, pot) c)
  ) into result;
  return result;
end;
$$;

comment on function public.brew_planner_account_pots(text[]) is
  '[hidden] Brew Planner page helper: LilyPad sales for the given products split into recurring / new / lost accounts (60-day rules), per product, distributor and month. Ernie: use sales_account_sales / the Sales Dashboard instead.';

revoke all on function public.brew_planner_account_pots(text[]) from public, anon, authenticated;
grant execute on function public.brew_planner_account_pots(text[]) to service_role;
