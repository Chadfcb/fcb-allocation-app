-- Sales Dashboard speed fix — added 2026-10-22, per Chad ("the sales
-- dashboard is failing to load at times").
-- Run in Supabase SQL Editor BEFORE pushing the matching code. Idempotent —
-- safe to run more than once.
--
-- Root cause (Supabase logs 10/22): one Sales Dashboard load fired ~15 heavy
-- database calls at once — sales_dash_overview, sales_dash_home, and one
-- sales_gap_by_store per chain for Chain coverage AND again per chain for
-- Action Items. Every one of them rebuilt the chain store list
-- (sales_chain_members) from scratch: a pattern match over all ~23,000
-- accounts each time (~300 ms alone). Piled up on the small database, the
-- slowest call passed the 8-second limit and the page showed an error.
--
-- This file:
--   1. Saves the chain store list in a table (sales_chain_member_cache) and
--      rebuilds it only when it can change: new / removed / renamed accounts,
--      accounts turned off / on, Chain setup edits. sales_chain_members()
--      now just reads that table, so every report that uses it gets faster.
--   2. Adds sales_gap_by_store_many(chains[], distributor): the Gap Report
--      "By store" data for several chains in ONE call (same shape per chain
--      as sales_gap_by_store), so Chain coverage and Action Items each make
--      one call instead of one per chain.

-- ---------------------------------------------------------------------------
-- 1. Chain store list, saved
-- ---------------------------------------------------------------------------
create table if not exists public.sales_chain_member_cache (
  outlet_id text primary key,
  chain text not null,
  auto_name text
);
create index if not exists sales_chain_member_cache_chain_idx on public.sales_chain_member_cache (chain);
alter table public.sales_chain_member_cache enable row level security;
-- No row rules on purpose: only the report functions (security definer) and
-- the server read it.
grant select, insert, update, delete on public.sales_chain_member_cache to service_role;
comment on table public.sales_chain_member_cache is
  '[hidden] Saved chain store list (which account is in which chain) — rebuilt automatically; read it through sales_chain_members().';

-- The original calculation, unchanged (was the body of sales_chain_members()).
create or replace function public.sales_chain_members_build()
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
revoke all on function public.sales_chain_members_build() from public, anon, authenticated;
comment on function public.sales_chain_members_build() is '[hidden] Recomputes the chain store list (used to refresh sales_chain_member_cache).';

create or replace function public.sales_chain_members_rebuild()
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
begin
  -- One rebuild at a time (two at once could collide on the same rows).
  perform pg_advisory_xact_lock(hashtext('sales_chain_member_cache'));
  delete from public.sales_chain_member_cache;
  insert into public.sales_chain_member_cache (outlet_id, chain, auto_name)
  select b.outlet_id, b.chain, b.auto_name from public.sales_chain_members_build() b;
end;
$$;
revoke all on function public.sales_chain_members_rebuild() from public, anon, authenticated;
grant execute on function public.sales_chain_members_rebuild() to service_role;
comment on function public.sales_chain_members_rebuild() is '[hidden] Rebuilds sales_chain_member_cache.';

-- Every report reads the saved list now.
create or replace function public.sales_chain_members()
returns table (outlet_id text, chain text, auto_name text)
language sql
stable
security definer
set search_path = ''
as $$
  select c.outlet_id, c.chain, c.auto_name from public.sales_chain_member_cache c;
$$;
revoke all on function public.sales_chain_members() from public, anon, authenticated;

-- Rebuild triggers (once per statement, not per row)
create or replace function public.sales_chain_members_touch()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform public.sales_chain_members_rebuild();
  return null;
end;
$$;

-- Inserts/deletes on accounts: only rebuild when rows actually changed (the
-- LilyPad sync re-sends every account with "ignore duplicates", which inserts
-- nothing most days).
create or replace function public.sales_chain_members_touch_if_rows()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    if exists (select 1 from new_rows) then perform public.sales_chain_members_rebuild(); end if;
  elsif tg_op = 'DELETE' then
    if exists (select 1 from old_rows) then perform public.sales_chain_members_rebuild(); end if;
  end if;
  return null;
end;
$$;
revoke all on function public.sales_chain_members_touch() from public, anon, authenticated;
revoke all on function public.sales_chain_members_touch_if_rows() from public, anon, authenticated;

drop trigger if exists sales_chain_cache_accounts_ins on public.sales_accounts;
create trigger sales_chain_cache_accounts_ins after insert on public.sales_accounts
  referencing new table as new_rows for each statement execute function public.sales_chain_members_touch_if_rows();
drop trigger if exists sales_chain_cache_accounts_del on public.sales_accounts;
create trigger sales_chain_cache_accounts_del after delete on public.sales_accounts
  referencing old table as old_rows for each statement execute function public.sales_chain_members_touch_if_rows();
-- Name changes only (the nightly account refresh doesn't touch names).
drop trigger if exists sales_chain_cache_accounts_name on public.sales_accounts;
create trigger sales_chain_cache_accounts_name after update of name, outlet_id on public.sales_accounts
  for each statement execute function public.sales_chain_members_touch();
drop trigger if exists sales_chain_cache_accounts_trunc on public.sales_accounts;
create trigger sales_chain_cache_accounts_trunc after truncate on public.sales_accounts
  for each statement execute function public.sales_chain_members_touch();

do $$
declare
  t text;
begin
  foreach t in array array['sales_account_off', 'sales_chain_store', 'sales_chain_names'] loop
    if to_regclass('public.' || t) is not null then
      execute format('drop trigger if exists sales_chain_cache_touch on public.%I', t);
      execute format(
        'create trigger sales_chain_cache_touch after insert or update or delete or truncate on public.%I '
        'for each statement execute function public.sales_chain_members_touch()', t);
    end if;
  end loop;
end $$;

-- Fill it now.
select public.sales_chain_members_rebuild();

-- ---------------------------------------------------------------------------
-- 2. Gap Report "By store" for several chains in one call
-- ---------------------------------------------------------------------------
-- Returns { "<chain>": { as_of, stores, buys }, ... } — each value exactly
-- what sales_gap_by_store(chain, distributor) returns.
create or replace function public.sales_gap_by_store_many(p_chains text[], p_distributor text)
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
  if not public.sales_can_see(case when p_distributor is null then null else array[p_distributor] end) then
    raise exception 'You don''t have access to the Sales Dashboard.';
  end if;
  select as_of into v_as_of from public.sales_data_meta where id = 1;
  v_as_of := coalesce(v_as_of, current_date);

  with st as (
    select m.chain, a.outlet_id, a.name, a.address, a.city, a.zip, coalesce(a.distributor, '(none)') as distributor,
           a.premise, a.last_buy_date, public.sales_store_number(a.name) as store_no
    from public.sales_chain_member_cache m
    join public.sales_accounts a on a.outlet_id = m.outlet_id
    where m.chain = any(p_chains)
      and (p_distributor is null or coalesce(a.distributor, '(none)') = p_distributor)
  ),
  b as (
    select s.outlet_id, s.product, coalesce(s.size, 'Other') as size,
           max(coalesce(s.last_buy_date, s.month)) as last_buy,
           round(coalesce(sum(s.ce) filter (where coalesce(s.last_buy_date, s.month) > v_as_of - 90), 0), 2) as ce90,
           round(coalesce(sum(s.ce) filter (where s.month > (date_trunc('month', v_as_of) - interval '12 months')), 0), 2) as ce12
    from public.sales_account_sales s
    where s.outlet_id in (select outlet_id from st)
      and s.ce > 0
      and not exists (select 1 from public.sales_product_hidden h where h.product = s.product)
    group by s.outlet_id, s.product, coalesce(s.size, 'Other')
  )
  select coalesce(json_object_agg(c.chain, json_build_object(
    'as_of', v_as_of,
    'stores', (select coalesce(json_agg(x order by x.name), '[]'::json) from (
        select st.outlet_id, st.name, st.address, st.city, st.zip, st.distributor, st.premise, st.last_buy_date, st.store_no
        from st where st.chain = c.chain) x),
    'buys', (select coalesce(json_agg(bb), '[]'::json) from (
        select b.outlet_id, b.product, b.size, b.last_buy, b.ce90, b.ce12
        from b where b.outlet_id in (select st.outlet_id from st where st.chain = c.chain)) bb)
  )), '{}'::json) into result
  from (select distinct unnest(p_chains) as chain) c;
  return result;
end;
$$;
revoke all on function public.sales_gap_by_store_many(text[], text) from public, anon;
grant execute on function public.sales_gap_by_store_many(text[], text) to authenticated, service_role;
comment on function public.sales_gap_by_store_many(text[], text) is
  '[needs:sales_dashboard] Gap Report "By store" for several chains at once: per chain, its stores and what each bought (last buy, cases last 90 days / 12 months) per product + size.';
