-- Sales > Accounts stages: New = brand new, plus Re-Activated (added
-- 2026-10-19, per Chad).
--   New          first order EVER in the last 60 days
--   Re-Activated bought in the last 60 days, nothing in the 90 days before
--                that (days 61–150 back from the data's as-of date)
--   Active       bought in the last 60 days and also in those 90 days before
-- (The rules themselves live in lib/salesAccounts.ts → stageFor.)
--
-- What this file adds:
--   sales_account_sales.first_buy_in_month — the FIRST invoice date in that
--     account-month (last_buy_date already holds the last one). With both, the
--     "anything bought 61–150 days back?" check is exact: a month can't hide an
--     order inside that 90-day stretch if neither its first nor last order is
--     in it. Filled by the LilyPad sync (which re-pulls 2026 from Jan 1 once to
--     fill months already saved); empty for older VIP history (monthly totals).
--   sales_accounts.bought_61_150 — yes/no, worked out by sales_accounts_refresh.
--   sales_accounts_refresh — also sets first_buy_date to the exact first order
--     day when known (it was the first of the month before).
--
-- Run this in Supabase's SQL Editor BEFORE pushing the code. Idempotent —
-- safe to run more than once.

alter table public.sales_account_sales add column if not exists first_buy_in_month date;
alter table public.sales_accounts add column if not exists bought_61_150 boolean not null default false;

create or replace function public.sales_accounts_refresh(p_as_of date)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  m0 date := date_trunc('month', p_as_of)::date;
  w_from date := p_as_of - 150;  -- the 90 days before the last 60
  w_to date := p_as_of - 61;
begin
  -- (Supabase requires a WHERE on every UPDATE, hence "where true".)
  update public.sales_accounts set
    last_buy_date = null, first_buy_date = null, lifetime_ce = 0, ce_12mo = 0, buy_months_6 = 0, contact_count = 0,
    bought_61_150 = false
  where true;

  update public.sales_accounts a set
    last_buy_date = s.lb,
    first_buy_date = s.fb,
    lifetime_ce = s.t,
    ce_12mo = s.y,
    buy_months_6 = s.b6,
    bought_61_150 = s.w,
    updated_at = now()
  from (
    select outlet_id,
      max(coalesce(last_buy_date, month)) as lb,
      min(coalesce(first_buy_in_month, last_buy_date, month)) as fb,
      sum(ce) as t,
      coalesce(sum(ce) filter (where month > (m0 - interval '12 months')), 0) as y,
      count(distinct month) filter (where month > (m0 - interval '6 months')) as b6,
      bool_or(
        coalesce(last_buy_date, month) between w_from and w_to
        or coalesce(first_buy_in_month, last_buy_date, month) between w_from and w_to
      ) as w
    from public.sales_account_sales
    where ce > 0
    group by outlet_id
  ) s
  where a.outlet_id = s.outlet_id;

  update public.sales_accounts a set distributor = d.distributor
  from (
    select distinct on (outlet_id) outlet_id, distributor
    from public.sales_account_sales
    where ce > 0 and distributor is not null
    order by outlet_id, coalesce(last_buy_date, month) desc
  ) d
  where a.outlet_id = d.outlet_id;

  update public.sales_accounts a set contact_count = c.n
  from (select outlet_id, count(*)::int as n from public.sales_account_contacts group by outlet_id) c
  where a.outlet_id = c.outlet_id;
end;
$$;

revoke all on function public.sales_accounts_refresh(date) from public, anon, authenticated;
grant execute on function public.sales_accounts_refresh(date) to service_role;

-- Ernie's notes (sql/ernie_data_map.sql) — mention the new fields.
comment on table public.sales_accounts is $c$Every retail account (bar, restaurant, store) FCB beer is sold to or could be, keyed by VIP outlet_id: name, address, city, distributor (which distributor services it), premise (On/Off), last_buy_date, first_buy_date (first order ever), lifetime_ce, ce_12mo (case equivalents in the last 12 months), buy_months_6, bought_61_150 (bought in the 90 days before the last 60). Stages (lib/salesAccounts.ts): New = first order ever in the last 60 days; Re-Activated = bought in the last 60 days but not in the 90 days before; Active = bought in the last 60 days and in the 90 before; Potential lost = 61–90 days dark; Lost = 90+. Sales > Accounts page. Data from VIP (to 2025) and LilyPad (2026 on).$c$;

-- Fill the new yes/no right away from what's already saved (the LilyPad sync
-- re-runs this every morning).
select public.sales_accounts_refresh(coalesce((select as_of from public.sales_data_meta where id = 1), current_date));
