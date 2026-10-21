-- LilyPad sales sync: replace months in ONE step (added 2026-10-21, per Chad).
--
-- Why: the daily sync (lib/syncs/lilypadSales.ts) used to delete the months
-- it re-pulls and then save the fresh copy as a separate step. On 2026-10-20
-- the save failed (a missing column) after the delete had already happened,
-- so Aug–Oct 2026 sales were empty until the sync was re-run.
--
-- Now the sync hands every new row to this function, which deletes the old
-- months and saves the new rows together: if anything fails, NOTHING changes
-- and the old numbers stay exactly as they were (a database function runs as
-- one transaction — all or nothing).
--
-- Only the app's server (service role) can call it.
--
-- Run this in Supabase's SQL Editor BEFORE pushing the code. Idempotent —
-- safe to run more than once. (If the code is pushed first, the sync just
-- fails with "function not found" and changes nothing — no harm done.)

create or replace function public.sales_account_sales_replace(p_from date, p_rows jsonb)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  n integer;
begin
  if p_from is null then
    raise exception 'sales_account_sales_replace: no start month given';
  end if;
  if p_rows is null or jsonb_typeof(p_rows) <> 'array' or jsonb_array_length(p_rows) = 0 then
    raise exception 'sales_account_sales_replace: no rows given — nothing changed';
  end if;

  delete from public.sales_account_sales where month >= p_from;

  insert into public.sales_account_sales
    (outlet_id, month, product, package, distributor, ce, last_buy_date, first_buy_in_month, size)
  select r.outlet_id, r.month, r.product, r.package, r.distributor, r.ce, r.last_buy_date, r.first_buy_in_month, r.size
  from jsonb_to_recordset(p_rows) as r(
    outlet_id text, month date, product text, package text, distributor text,
    ce numeric, last_buy_date date, first_buy_in_month date, size text
  );
  get diagnostics n = row_count;

  if n <> jsonb_array_length(p_rows) then
    raise exception 'sales_account_sales_replace: saved % of % rows — undone, nothing changed', n, jsonb_array_length(p_rows);
  end if;
  return n;
end;
$$;

revoke all on function public.sales_account_sales_replace(date, jsonb) from public, anon, authenticated;
grant execute on function public.sales_account_sales_replace(date, jsonb) to service_role;

comment on function public.sales_account_sales_replace(date, jsonb) is
  $c$[hidden] LilyPad sales sync only: replaces every sales_account_sales month from p_from on with p_rows, all or nothing.$c$;
