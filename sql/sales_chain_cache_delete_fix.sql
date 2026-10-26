-- Fix for the LilyPad Account Sales failure on 2026-10-26:
--   "Saving new accounts failed: DELETE requires a WHERE clause"
-- Supabase blocks a delete with no WHERE that comes in through the app.
-- The chain store list rebuild cleared its saved table that way, so adding a
-- new account (or editing Chain setup / turning an account off) failed.
-- Same rebuild as before; the only change is "where true" on the delete.
-- Safe to run more than once.

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
  delete from public.sales_chain_member_cache where true;
  insert into public.sales_chain_member_cache (outlet_id, chain, auto_name)
  select b.outlet_id, b.chain, b.auto_name from public.sales_chain_members_build() b;
end;
$$;
revoke all on function public.sales_chain_members_rebuild() from public, anon, authenticated;
grant execute on function public.sales_chain_members_rebuild() to service_role;
comment on function public.sales_chain_members_rebuild() is '[hidden] Rebuilds sales_chain_member_cache.';
