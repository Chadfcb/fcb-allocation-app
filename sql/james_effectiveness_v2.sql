-- Effectiveness + Direction for James, round 2 (2026-10-29, per Chad).
-- Plan: claude/james-effectiveness-plan.md. Run in Supabase's SQL Editor BEFORE
-- pushing the code. Idempotent — safe to run more than once. No new tables.
--
--  1. james_effectiveness() now also returns each visit's notes and the
--     account's yearly CE, plus "lapsed": Markstein accounts that bought in the
--     last year but not in 90+ days and that James has never visited. The
--     store-vs-store monthly comparison is gone (replaced by before/after
--     James's first visit, worked out on the page).
--  2. Fix from the history import: at four shared street addresses James's
--     visits were saved to the neighbouring business. Moves those 8 check-ins
--     to the right account (Castro Valley Natural Grocery, Danville Kitchens,
--     Zephyr Grill & Bar, and Blast and Brew — added as a new Markstein
--     account).

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
        limit 200) l)
  ) into result;
  return result;
end;
$$;

revoke all on function public.james_effectiveness() from public, anon;
grant execute on function public.james_effectiveness() to authenticated;
comment on function public.james_effectiveness() is
  '[needs:dist_markstein] James Mendoza (CMC, Markstein''s field rep): his check-ins (visits, outcome, notes, products committed/sampled), what those accounts and his 52 target accounts bought since May 2025, and Markstein accounts that stopped buying (last year, not in 90+ days) that he has never visited. Answers "is James moving beer", "did his commitments turn into sales", "which targets has he hit", "what should James work on next".';

insert into public.sales_accounts (outlet_id, name, address, city, state, distributor, report_note)
values ('CMC-BLASTBRW', 'Blast and Brew', '2151 Salvio St', 'Concord', 'CA', 'Markstein',
        'Added from James''s (CMC) visits — not in the account list yet.')
on conflict (outlet_id) do nothing;

update public.sales_account_checkins set outlet_id = '4698729'
where source like 'CMC: James%' and outlet_id = '540836' and checkin_date = date '2026-07-28' and notes = 'Customer remembers the brand but is excited to sample the other SKUs available through our distributor partner. Going to try the product with the account owner and review sales materials before deciding next steps.';
update public.sales_account_checkins set outlet_id = '4376370'
where source like 'CMC: James%' and outlet_id = '4823209' and checkin_date = date '2026-06-03' and notes = 'Customer will start with the Captain Save a Hop and Big Daddy SKUs and take it from there.';
update public.sales_account_checkins set outlet_id = '4376370'
where source like 'CMC: James%' and outlet_id = '4823209' and checkin_date = date '2026-06-04' and notes = 'Jess expressed strong interest in supporting the Full Circle Brewing portfolio and committed to Captain Save a Hop four-packs and Big Daddy 19.2-ounce cans during our visit. The account''s enthusiasm makes it a promising new partner for the brand. This commitment was not fulfilled last week because product was not able to be located within the ordering system. If 19.2s are no longer available, I will visit and ask the customer to pivot to the six packs.';
update public.sales_account_checkins set outlet_id = '3984537'
where source like 'CMC: James%' and outlet_id = '3941811' and checkin_date = date '2026-10-12' and notes = 'Customer states that at this time he is going to wait about a month or two before he starts making changes to the offerings at the account. Customer has my contact information and will reach out if and when any opportunities may arise.';
update public.sales_account_checkins set outlet_id = '4376370'
where source like 'CMC: James%' and outlet_id = '4823209' and checkin_date = date '2026-10-21' and notes = 'Product has been out of stock so they have not been able to order. Inventory issues may prevent account from moving forward with offering it at their location';
update public.sales_account_checkins set outlet_id = '3984537'
where source like 'CMC: James%' and outlet_id = '3941811' and checkin_date = date '2026-10-05' and notes = 'Customer is familiar with the big daddy ipa and speakeasy products. He is curious to sample the liquid and see if it tastes like he remembers. Customer has only been at this account for 2 weeks so he will sample the product and evaluate sales materials to see if he believes it makes sense for his account moving forward';
update public.sales_account_checkins set outlet_id = 'CMC-BLASTBRW'
where source like 'CMC: James%' and outlet_id = '3675408' and checkin_date = date '2026-10-06' and notes = 'This is a new account that is working towards its grand opening at the end of October. The account has 24 taps and the customer is looking at offering a variety of core and eclectic beers. Met the account owner last Friday and set up an appointment for today with Markstein''s On premise specialist Mike. Had a productive meeting, shared samples and sales materials for the owner and his bar manager to evaluate and will stay in touch with the account over the coming weeks to support any needs they may have as they prepare to open.';
update public.sales_account_checkins set outlet_id = '3984537'
where source like 'CMC: James%' and outlet_id = '3941811' and checkin_date = date '2026-08-10' and notes = 'Customer will review sales materials and consult with her bar manager to see if anything makes sense for their account.';
