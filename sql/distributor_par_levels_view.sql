-- Par levels button on every distributor page (2026-11-09, per Chad: "on all
-- distributor pages, in the stock block, next to the export button, please add
-- a par level button").
--
-- distributor_par_levels is only readable with Build Orders access (that's
-- where pars are set). This read-only function lets anyone who can open a
-- distributor's page (or the Sales Dashboard) see THAT distributor's pars,
-- next to its latest on-hand count. Editing pars stays on Build Orders.
--
-- Run in Supabase's SQL Editor BEFORE pushing the code. Safe to run more than once.

create or replace function public.sales_territory_pars(p_dist text)
returns json
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_week uuid;
  result json;
begin
  if not public.sales_can_see(array[p_dist]) then
    raise exception 'You don''t have access to this distributor.';
  end if;
  -- Same "latest count" week as the On Hand block (sales_territory_stock).
  select di.week_id into v_week
  from public.distributor_inventory di
  join public.distributors d on d.id = di.distributor_id
  join public.weeks w on w.id = di.week_id
  where d.name = p_dist
  order by w.week_start desc limit 1;

  select coalesce(json_agg(x order by x.sort_order nulls last, x.product), '[]'::json) into result
  from (
    select p.name as product, p.sort_order, pl.par_level as par,
           (select di.on_hand_qty from public.distributor_inventory di
             where di.week_id = v_week and di.distributor_id = d.id and di.product_id = p.id
             limit 1) as on_hand
    from public.distributor_par_levels pl
    join public.distributors d on d.id = pl.distributor_id
    join public.products p on p.id = pl.product_id
    where d.name = p_dist and pl.par_level > 0
  ) x;
  return result;
end;
$$;
revoke all on function public.sales_territory_pars(text) from public, anon;
grant execute on function public.sales_territory_pars(text) to authenticated, service_role;
comment on function public.sales_territory_pars(text) is $c$[needs:sales_dashboard] One distributor's par levels (target stock per product, set on Build Orders) next to its latest on-hand count. Use for "what are Markstein's par levels" or "which products is Matagrano under par on".$c$;
