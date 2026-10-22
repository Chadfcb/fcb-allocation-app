-- Distributor pages: account search — added 2026-10-22, per Chad ("an account
-- search button, where we can enter an account name, select it, and it will
-- popup all data for that account").
-- Run in Supabase SQL Editor BEFORE pushing the matching code. Idempotent —
-- safe to run more than once.
--
-- Finds that distributor's accounts by name, store number ("#667"), city,
-- street address or outlet id. Same access as the rest of the distributor
-- page: Sales Dashboard people, or people with that distributor's page —
-- a Matagrano-only rep can't search Guardian's accounts.

create or replace function public.sales_territory_search(p_dist text, p_q text)
returns json
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  q text := trim(coalesce(p_q, ''));
begin
  if not public.sales_can_see(array[p_dist]) then
    raise exception 'You don''t have access to this distributor.';
  end if;
  if length(q) < 2 then
    return '[]'::json;
  end if;
  return (
    select coalesce(json_agg(x), '[]'::json) from (
      select a.outlet_id, a.name, a.city, a.address, a.premise, a.last_buy_date,
             exists (select 1 from public.sales_account_off o where o.outlet_id = a.outlet_id) as is_off
      from public.sales_accounts a
      where a.distributor = p_dist
        and (a.name ilike '%' || q || '%'
             or coalesce(a.city, '') ilike '%' || q || '%'
             or coalesce(a.address, '') ilike '%' || q || '%'
             or a.outlet_id = q)
      order by (a.name ilike q || '%') desc, a.name
      limit 25
    ) x
  );
end;
$$;
revoke all on function public.sales_territory_search(text, text) from public, anon;
grant execute on function public.sales_territory_search(text, text) to authenticated;
comment on function public.sales_territory_search(text, text) is
  $c$[hidden] Distributor pages: search one distributor's accounts by name, store number, city, address or outlet id (up to 25; opens the account pop-up).$c$;
