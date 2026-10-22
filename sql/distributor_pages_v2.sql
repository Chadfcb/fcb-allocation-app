-- Distributor pages — round 2 (2026-10-22, per Chad: "yes do all those, execute").
--   * Custom dates: sales_territory_checkins(p_dist, p_from, p_to) — check-ins
--     between two dates (to = today when left out). Replaces the 2-argument one.
--   * Check-ins carry who the rep spoke with (contact).
--   * Account pop-up: sales_territory_account() now also returns the account's
--     contacts (name, title, phone, mobile, email, notes) and, on each check-in,
--     who they spoke with — reps don't have Sales → Accounts.
-- Same functions updated in sql/distributors.sql so re-running that file keeps them.
--
-- Run this in Supabase's SQL Editor BEFORE pushing the code. Idempotent —
-- safe to run more than once. No new tables.

-- The first version (10/22 morning) took only p_dist, p_from — replaced by the one below.
drop function if exists public.sales_territory_checkins(text, date);
create or replace function public.sales_territory_checkins(p_dist text, p_from date, p_to date default null)
returns json
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_today date := (now() at time zone 'America/Los_Angeles')::date;
  v_to date;
  v_rs date;
  v_re date;
  result json;
begin
  if not public.sales_can_see(array[p_dist]) then
    raise exception 'You don''t have access to this distributor.';
  end if;
  select period_start, period_end into v_rs, v_re from public.route_period();
  -- Custom dates (2026-10-22): p_to ends the range (never past today).
  v_to := least(coalesce(p_to, v_today), v_today);

  with ck as (
    select k.checkin_date, k.rep, k.activity, k.notes, k.brands, k.contact, k.outlet_id, a.name, a.city,
           exists (select 1 from public.lilypad_route_accounts ra join public.lilypad_routes r on r.list_id = ra.list_id
                   where ra.outlet_id = k.outlet_id and r.distributor = p_dist) as on_route
    from public.sales_account_checkins k
    join public.sales_accounts a on a.outlet_id = k.outlet_id
    where a.distributor = p_dist and k.checkin_date between p_from and v_to
  )
  select json_build_object(
    'from', p_from,
    'to', v_to,
    'total', (select count(*) from ck),
    'accounts', (select count(distinct outlet_id) from ck),
    'with_notes', (select count(*) from ck where coalesce(trim(notes), '') <> ''),
    'by_rep', (select coalesce(json_agg(x order by x.n desc), '[]'::json) from (
        select coalesce(rep, '(no rep)') as rep, count(*) as n from ck group by coalesce(rep, '(no rep)')) x),
    'checkins', (select coalesce(json_agg(x order by x.checkin_date desc, x.name), '[]'::json) from (
        select * from ck order by checkin_date desc limit 500) x),
    'route_period', json_build_object('start', v_rs, 'end', v_re, 'today', v_today),
    'routes', (select coalesce(json_agg(rt order by rt.rep), '[]'::json) from (
        select r.list_id, r.name, r.rep, r.synced_at,
               (select coalesce(json_agg(acc order by acc.visited, acc.name), '[]'::json) from (
                   select ra.outlet_id, coalesce(sa.name, ra.name) as name, coalesce(sa.city, ra.city) as city,
                          max(k.checkin_date) filter (where k.checkin_date between v_rs and v_re and public.route_checkin_counts(k)) as last_in_period,
                          max(k.checkin_date) as last_ever,
                          (max(k.checkin_date) filter (where k.checkin_date between v_rs and v_re and public.route_checkin_counts(k))) is not null as visited
                   from public.lilypad_route_accounts ra
                   left join public.sales_accounts sa on sa.outlet_id = ra.outlet_id
                   left join public.sales_account_checkins k on k.outlet_id = ra.outlet_id
                   where ra.list_id = r.list_id
                   group by ra.outlet_id, coalesce(sa.name, ra.name), coalesce(sa.city, ra.city)) acc) as accounts
        from public.lilypad_routes r
        where r.distributor = p_dist) rt)
  ) into result;
  return result;
end;
$$;
revoke all on function public.sales_territory_checkins(text, date, date) from public, anon;
grant execute on function public.sales_territory_checkins(text, date, date) to authenticated;
comment on function public.sales_territory_checkins(text, date, date) is $c$[needs:sales_dashboard] One distributor's check-ins between two dates (to = today when left out) (who, which account, activity, meeting notes, brands sampled) and its maintenance route for the current two-month period (every route account, checked in or not).$c$;

-- One account for the distributor pages' pop-up (was in sql/my_territory.sql):
-- details, cases by month and item (last 13 months), last 10 check-ins with
-- notes + who they spoke with, and the account's contacts (2026-10-22, Chad:
-- "im seeing a phone number, but its not telling me who its for, and im not
-- seeing contact info"). Reps don't have Sales → Accounts, so the contacts
-- come through here.
create or replace function public.sales_territory_account(p_outlet text)
returns json
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_dist text;
  result json;
begin
  select a.distributor into v_dist from public.sales_accounts a where a.outlet_id = p_outlet;
  if v_dist is null or not (public.has_section(auth.uid(), 'accounts') or public.sales_can_see(array[v_dist])) then
    raise exception 'You don''t have access to this account.';
  end if;
  select json_build_object(
    'account', (select json_build_object('outlet_id', a.outlet_id, 'name', a.name, 'address', a.address, 'city', a.city,
        'zip', a.zip, 'phone', a.phone, 'distributor', a.distributor, 'premise', a.premise, 'last_buy', a.last_buy_date,
        'first_buy', a.first_buy_date, 'ce_12mo', a.ce_12mo, 'lifetime_ce', a.lifetime_ce)
      from public.sales_accounts a where a.outlet_id = p_outlet),
    'as_of', (select m.as_of from public.sales_data_meta m where m.id = 1),
    'sales', (select coalesce(json_agg(x order by x.month desc, x.ce desc), '[]'::json) from (
        select s.month, s.product, coalesce(s.size, '') as size, round(sum(s.ce), 1) as ce, max(s.last_buy_date) as last_buy
        from public.sales_account_sales s
        where s.outlet_id = p_outlet
          and s.month >= (date_trunc('month', (select m.as_of from public.sales_data_meta m where m.id = 1)) - interval '12 months')::date
        group by s.month, s.product, s.size) x),
    'checkins', (select coalesce(json_agg(x order by x.checkin_date desc), '[]'::json) from (
        select k.checkin_date, k.rep, k.activity, k.notes, k.brands, k.contact
        from public.sales_account_checkins k where k.outlet_id = p_outlet
        order by k.checkin_date desc limit 10) x),
    'contacts', (select coalesce(json_agg(x order by x.name nulls last), '[]'::json) from (
        select c.name, c.title, c.phone, c.mobile, c.email, c.notes
        from public.sales_account_contacts c where c.outlet_id = p_outlet) x)
  ) into result;
  return result;
end;
$$;
revoke all on function public.sales_territory_account(text) from public, anon;
grant execute on function public.sales_territory_account(text) to authenticated;
comment on function public.sales_territory_account(text) is $c$[needs:sales_dashboard] One account's details for a distributor page: address, store phone, last buy, cases last 12 months, cases by month and item for the last 13 months, the last 10 check-ins (notes, who they spoke with) and the account's contacts (name, title, phone, mobile, email).$c$;
