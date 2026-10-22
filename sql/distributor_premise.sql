-- Distributor pages — On-premise / Off-premise tags (2026-10-22, per Chad:
-- "we also need it to show on or off premise" on Today's priorities).
-- Reps can't read sales_accounts directly (that's Sales → Accounts), so the
-- page gets each account's premise for its distributor through this function.
--
-- Run this in Supabase's SQL Editor BEFORE pushing the code. Idempotent —
-- safe to run more than once. No new tables.

create or replace function public.sales_territory_premise(p_dist text)
returns json
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not public.sales_can_see(array[p_dist]) then
    raise exception 'You don''t have access to this distributor.';
  end if;
  return (select coalesce(json_object_agg(a.outlet_id, a.premise), '{}'::json)
          from public.sales_accounts a
          where a.distributor = p_dist and a.premise is not null);
end;
$$;
revoke all on function public.sales_territory_premise(text) from public, anon;
grant execute on function public.sales_territory_premise(text) to authenticated;
comment on function public.sales_territory_premise(text) is $c$[hidden] Distributor pages: outlet_id → On / Off premise for one distributor's accounts (for the On-premise / Off-premise tags).$c$;
