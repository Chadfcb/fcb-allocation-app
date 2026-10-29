-- James Effectiveness block on Distributors → Markstein (2026-10-29, per Chad).
-- Plan: claude/james-effectiveness-plan.md. Run in Supabase's SQL Editor BEFORE
-- pushing the code. Idempotent — safe to run more than once.
--
--  1. markstein_target_accounts — James's (CMC) 52 target accounts, from Chad's
--     tracking spreadsheet ("Target Accounts" tab), matched to account ids.
--  2. james_effectiveness() — everything the block needs in one call: James's
--     check-ins, what those stores (and the targets) bought since May 2025,
--     the target list, and lapsed Markstein buyers he hasn't visited (function
--     updated by sql/james_effectiveness_v2.sql). The page does the math.

create table if not exists public.markstein_target_accounts (
  id bigint generated always as identity primary key,
  name text not null unique,
  tier text,
  class_of_trade text,            -- 'On' / 'Off'
  outlet_id text,                 -- sales_accounts.outlet_id (null = not found)
  why text,
  sort int,
  created_at timestamptz not null default now()
);

grant select, insert, update, delete on public.markstein_target_accounts to authenticated;
grant select, insert, update, delete on public.markstein_target_accounts to service_role;

alter table public.markstein_target_accounts enable row level security;
drop policy if exists "markstein_target_accounts_read" on public.markstein_target_accounts;
create policy "markstein_target_accounts_read" on public.markstein_target_accounts for select
  using (public.sales_can_see(array['Markstein']));

comment on table public.markstein_target_accounts is
  'James Mendoza''s (CMC, Markstein''s field rep) target accounts — 52 stores FCB asked him to work, with tier/rank, On/Off premise and why each is a target. outlet_id links to sales_accounts. Use for "which of James''s targets has he visited / have they bought".';

insert into public.markstein_target_accounts (name, tier, class_of_trade, outlet_id, why, sort) values
  ('Extreme Pizza', 'P2·1', 'On', '3165881', 'Highest-volume P2 at 33 CE. Top multi-SKU buyer — 9 SKUs. At 9 months lapsed, risk of losing tap/shelf is real.', 1),
  ('Fireside Lounge', 'P2·10', 'On', '534248', 'Excellent contact data. 6 SKUs historically. Lounge format is a natural craft fit.', 2),
  ('Park Station', 'P2·11', 'On', '4873739', '2 months since last buy — still warm. Room to grow from 2 SKUs.', 3),
  ('Wine Thieves', 'P3·2', 'On', '541092', 'Active this month with 6 SKUs and a strong 20 CE base. Logged as OFF premise in James''s visit data.', 4),
  ('Extreme Pizza (Active Location)', 'P3·3', 'On', '4883598', 'Second Extreme Pizza location buying actively. Assumed to be the Walnut Creek location based on ''active/buying'' status. VIP Master confirms multiple Markstein-distributed Extreme Pizza outlet IDs beyond Brentwood, consistent with a chain of 3. Walnut Creek assumed ''Active'' based on buying status.', 5),
  ('Ben ''N Nick''s Bar & Grill', 'P4·6', 'On', '2210939', '6 recent Lilypad visits as late as Sep ''25. 17 CE history with 0.42 CE/mo velocity.', 6),
  ('Straw Hat Pizza (Hayward)', 'NP·3', 'On', '2918238', 'New prospect — no VIP sales history.', 7),
  ('Yardhouse', 'NP·5', 'On', '4218651', 'New prospect — no VIP sales history.', 8),
  ('Summer Summer Thai Eatery', 'P2·2', 'On', '3181424', '26 CE lifetime with solid 0.64 CE/mo velocity. Bought just 2 months ago — relationship is warm. Confirmed in VIP Master data (Markstein), zip 94608 = Emeryville.', 9),
  ('Birdhaus Beer Garden', 'P2·3', 'On', '4376002', '4 peak SKUs have all dropped to zero — SKU recovery here is significant upside.', 10),
  ('Harrys Hofbrau', 'P2·4', 'On', '2014697', '12 Lilypad check-ins — rep knows this account cold. 7 SKUs and bought just 2 months ago.', 11),
  ('Sequoyah Country Club', 'P2·5', 'On', '539336', 'Country clubs offer premium long-term placement. 7 SKUs historically.', 12),
  ('Chaplins Sports Bistro', 'P2·6', 'On', '3399674', '5 SKUs and bought just 2 months ago. Alfred is reachable by phone.', 13),
  ('Hops and Sessions', 'P2·7', 'On', '4127823', 'Craft-focused account name signals ideal brand fit. 4 months since last order.', 14),
  ('Farleys East', 'P2·8', 'On', '3220805', 'Just 1 month since last buy — tap is almost certainly still pouring.', 15),
  ('Horatios #12', 'P2·9', 'On', '2143495', '1 month since last purchase — call now to keep buying without interruption. Confirmed as Horatio''s Seafood Restaurant at the San Leandro Marina.', 16),
  ('Baggys By The Lake', 'P2·12', 'On', '531373', 'Lakeside venue = high summer foot traffic. Opportunity to expand from 1 SKU heading into summer peak.', 17),
  ('Mavericks Country Lounge', 'P3·1', 'On', '3935087', 'Most consistent buyer on the list — 24 of 40 months active. Only 1 SKU is a missed opportunity.', 18),
  ('Petes Brass Rail & Car Wash', 'P3·4', 'On', '2213771', 'Active buyer with full contact details — Colleen Tague. Buying this month.', 19),
  ('The Office', 'P3·5', 'On', '2352857', 'Stable buying account, active this month. Only 1 SKU — pitch a second SKU.', 20),
  ('Danville Kitchens', 'P3·6', 'On', '4698729', 'Active this month with direct contact (VJ). Only 1 SKU — opportunity to expand.', 21),
  ('Brentwood Emporium', 'P3·7', 'On', '1572728', 'Flagged dormant but still showing 1 CE in recent 6 months. Reclassify as near-active. Appears under BOTH Markstein (ON premise) and Geyser Beverage (OFF premise) — may be worth confirming trade class.', 22),
  ('Eureka Burger ⭐', 'P4·1', 'On', '3612973', 'Highest-value dormant account on the list — 96 CE lifetime, 2.41 CE/mo. Highest-priority call on the list.', 23),
  ('Elbo Room Jack London', 'P4·2', 'On', '4107544', 'Second-largest dormant account at nearly 1 CE/mo historical velocity.', 24),
  ('Whiskey Lane', 'P4·3', 'On', '3129050', 'Strong 31 CE with 0.77 CE/mo velocity. Only 10 months lapsed.', 25),
  ('Doolittle The', 'P4·4', 'On', '3609009', 'Nearly 30 CE and 0.75 CE/mo — a serious former account.', 26),
  ('Plank', 'P4·5', 'On', '3696287', 'Major Oakland waterfront venue — high-volume potential. Rep visited as recently as Feb 2026.', 27),
  ('Tailgaters', 'P4·7', 'On', '2955497', 'Sports bar in Brentwood — natural home for the brand. 10 months lapsed.', 28),
  ('First Street Ale House', 'P4·8', 'On', '3199120', 'Hasn''t bought in 26 months — clear portfolio gap. Venue type aligns perfectly with the brand.', 29),
  ('Mad Oak', 'P4·9', 'On', '3940600', 'Oakland craft bar — confirmed former buyer (6 SKUs). Contact Mark by email.', 30),
  ('Extreme Pizza (Dormant Location)', 'P4·10', 'On', '4581781', 'Third Extreme Pizza location — coordinate re-engagement via the Brentwood (Steve) relationship. Best-guess match: Extreme Pizza''s only other realistic East Bay location besides Brentwood/Walnut Creek. VIP Master confirms a 3rd+ Markstein outlet ID exists but has no zip/address, so this is a geographic best-guess, not a confirmed outlet-ID match.', 31),
  ('Eureka Burger (2nd Location)', 'P4·11', 'On', '3904144', 'Second Eureka Burger location also dormant — leverage to activate all chain locations simultaneously. VIP Master confirms a 2nd distinct Markstein-distributed ''Eureka Burger'' outlet ID exists (besides Berkeley), but Eureka! Restaurant Group has no other public East Bay location — Berkeley appears to be their only Bay Area site. Could not locate; may need to confirm directly with the Berkeley contact (Karly Beze) who the target notes say to route through.', 32),
  ('Catos Ale House', 'P4·12', 'On', '532385', 'Confirmed Markstein On-Premise account. 6 SKUs historically purchased.', 33),
  ('Gallaghers Dublin Pub', 'NP·1', 'On', '2014447', 'New prospect — no VIP sales history.', 34),
  ('Pacific Pourhouse', 'NP·2', 'On', '4083163', 'New prospect — no VIP sales history.', 35),
  ('Missouri Cafe', 'NP·4', 'On', '537175', 'New prospect — no VIP sales history. (Likely ''Missouri Lounge & Cafe'' — confirm before visiting.)', 36),
  ('Tiipsy Putt', 'Monitor', 'On', '4608687', 'Also Monitor list — 1 account. Not found in either VIP Master file (no purchase history), consistent with ''Also Monitor'' / new-prospect status.', 37),
  ('Dave''s Liquor', 'Rank 1', 'Off', '533262', '128 CE across both windows — highest indie CE in the territory.', 38),
  ('Alameda Cellars Wines & Liquors', 'Rank 5', 'Off', '530864', '86 CE in both windows — premium wine & spirits shop with current buyer.', 39),
  ('Ledger''s Liquors', 'Rank 11', 'Off', '4907293', 'Berkeley indie liquor institution. Store was acquired and rebranded ''SIPS'' — James''s 6/25 visit is logged under that name at the same address.', 40),
  ('Berkeley Bowl West', 'Rank 12', 'Off', '3034615', 'Flagship independent grocery in Berkeley. High craft beer volume, influential buyer.', 41),
  ('Berkeley Bowl East', 'Rank 13', 'Off', '531548', 'Second Berkeley Bowl location. Logged as ''Berkeley Bowl Produce''/''Marketplace'' in James''s data.', 42),
  ('Mikey''s Supermarket', 'Rank 14', 'Off', '3007132', 'Active account in Fremont with multi-year purchase history across both windows.', 43),
  ('Woodminster Market', 'Rank 2', 'Off', '2215330', '122 CE, buying in both windows — 14 months in 2023-26, 18 in 2020-22.', 44),
  ('Grand Piedmont Liquors', 'Rank 3', 'Off', '2983660', '118 CE. One of Oakland''s highest foot-traffic retail corridors.', 45),
  ('Neptune Market', 'Rank 4', 'Off', '4905718', '101 CE across both windows — longest lapse of the Alameda cluster.', 46),
  ('Fast & Easy Mart #2', 'Rank 6', 'Off', '2907847', '254 CE — the largest single-account CE on this entire list. Nothing since Nov 2022.', 47),
  ('La Franchi''s Liquor', 'Rank 7', 'Off', '2920936', '23 CE with 9 months buying in 2023-26 — recently engaged buyer who went quiet.', 48),
  ('Pic N Pac', 'Rank 8', 'Off', '2016506', '55 CE. Was still buying as recently as Oct 2024 — only 20 months gone.', 49),
  ('Cole''s Market', 'Rank 9', 'Off', '1341863', '23 CE. Only 9 months gone — tied with Perry''s as most recently lapsed.', 50),
  ('Khatmandu Market & Deli', 'Rank 10', 'Off', '4035234', 'Independent market on Telegraph Ave. Markstein route 65. Craft-forward.', 51),
  ('Keller Market', 'Rank 15', 'Off', '535619', 'Markstein account (route 62). Had purchase activity in 2023-26 window.', 52)
on conflict (name) do update set tier = excluded.tier, class_of_trade = excluded.class_of_trade,
  outlet_id = excluded.outlet_id, why = excluded.why, sort = excluded.sort;

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
