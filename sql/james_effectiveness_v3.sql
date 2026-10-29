-- Direction for James: "Buying accounts he hasn't visited" (2026-10-29, per Chad).
-- Plan: claude/james-effectiveness-plan.md. Run in Supabase's SQL Editor BEFORE
-- pushing the code. Idempotent — safe to run more than once. No new tables.
--
-- james_effectiveness() now also returns:
--   unvisited_buyers — Markstein accounts that ordered in the last 90 days and
--     that James has never visited, with what each bought in the last 12 months.
--   popular — the 6 most-bought Markstein items (product + size) on premise and
--     off premise, so the page can show what each account doesn't carry yet.
-- Everything else in the function is unchanged (same as sql/james_effectiveness_v2.sql).

create or replace function public.james_effectiveness()
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
  if not public.sales_can_see(array['Markstein']) then
    raise exception 'You don''t have access to Markstein.';
  end if;
  select max(as_of) into v_as_of from public.sales_data_meta;

  with ck as (
    select k.outlet_id, k.checkin_date, k.activity, k.outcome, k.brands, k.notes, a.name, a.city, a.premise, a.ce_12mo
    from public.sales_account_checkins k
    join public.sales_accounts a on a.outlet_id = k.outlet_id
    where k.rep = 'James' and k.source like 'CMC: James%'
  ),
  outlets as (
    select outlet_id from ck
    union
    select outlet_id from public.markstein_target_accounts where outlet_id is not null
  )
  select json_build_object(
    'as_of', v_as_of,
    'checkins', (select coalesce(json_agg(c order by c.checkin_date), '[]'::json) from ck c),
    'sales', (select coalesce(json_agg(s), '[]'::json) from (
        select s.outlet_id, s.month, s.product, s.size, s.ce, s.first_buy_in_month, s.last_buy_date
        from public.sales_account_sales s
        where s.outlet_id in (select outlet_id from outlets) and s.month >= date '2025-05-01') s),
    'targets', (select coalesce(json_agg(t order by t.sort), '[]'::json) from (
        select t.name, t.tier, t.class_of_trade, t.outlet_id, t.why, t.sort
        from public.markstein_target_accounts t) t),
    -- Markstein accounts that bought in the last year but not in 90+ days and
    -- that James has never visited (Direction for James: win back).
    'lapsed', (select coalesce(json_agg(l), '[]'::json) from (
        select a.outlet_id, a.name, a.city, a.premise, a.last_buy_date, a.ce_12mo
        from public.sales_accounts a
        where a.distributor = 'Markstein'
          and a.last_buy_date > coalesce(v_as_of, current_date) - 365
          and a.last_buy_date <= coalesce(v_as_of, current_date) - 90
          and a.outlet_id not in (select outlet_id from ck)
          and not exists (select 1 from public.sales_account_off o where o.outlet_id = a.outlet_id)
        order by a.ce_12mo desc nulls last
        limit 200) l),
    -- Markstein accounts buying now (ordered in the last 90 days) that James
    -- has never visited, with what they bought in the last 12 months
    -- (Direction for James: buying accounts he hasn't visited, 2026-10-29).
    'unvisited_buyers', (select coalesce(json_agg(u), '[]'::json) from (
        select a.outlet_id, a.name, a.city, a.premise, a.last_buy_date, a.ce_12mo,
               (select coalesce(json_agg(distinct s.product || ' (' || s.size || ')'), '[]'::json)
                  from public.sales_account_sales s
                  where s.outlet_id = a.outlet_id and s.size is not null
                    and s.month >= date_trunc('month', coalesce(v_as_of, current_date) - 365)::date) as items
        from public.sales_accounts a
        where a.distributor = 'Markstein'
          and a.last_buy_date > coalesce(v_as_of, current_date) - 90
          and a.outlet_id not in (select outlet_id from ck)
          and not exists (select 1 from public.sales_account_off o where o.outlet_id = a.outlet_id)
        order by a.ce_12mo desc nulls last
        limit 300) u),
    -- What Markstein accounts buy most (last 12 months), on and off premise —
    -- used to show each unvisited buyer what it doesn't carry yet.
    'popular', (select coalesce(json_agg(p order by p.premise, p.accounts desc), '[]'::json) from (
        select x.premise, x.item, x.accounts from (
          select case when a.premise ilike 'on%' then 'On' else 'Off' end as premise,
                 s.product || ' (' || s.size || ')' as item,
                 count(distinct s.outlet_id) as accounts,
                 row_number() over (partition by case when a.premise ilike 'on%' then 'On' else 'Off' end
                                    order by count(distinct s.outlet_id) desc) as rn
          from public.sales_account_sales s
          join public.sales_accounts a on a.outlet_id = s.outlet_id
          where a.distributor = 'Markstein' and s.size is not null
            and s.month >= date_trunc('month', coalesce(v_as_of, current_date) - 365)::date
          group by 1, 2) x
        where x.rn <= 6) p)
  ) into result;
  return result;
end;
$$;

revoke all on function public.james_effectiveness() from public, anon;
grant execute on function public.james_effectiveness() to authenticated;
comment on function public.james_effectiveness() is
  '[needs:dist_markstein] James Mendoza (CMC, Markstein''s field rep): his check-ins (visits, outcome, notes, products committed/sampled), what those accounts and his 52 target accounts bought since May 2025, Markstein accounts that stopped buying (last year, not in 90+ days) that he has never visited, Markstein accounts buying now that he has never visited (with what they buy), and the most-bought Markstein items on and off premise. Answers "is James moving beer", "did his commitments turn into sales", "which targets has he hit", "what should James work on next".';
