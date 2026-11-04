-- Chain Classification — added 2026-11-04, per Chad: "these chains, we
-- classified, we need a chain classification button that has these listed on
-- the sales dashboard" (from FCB_Retail_Account_Contacts.xlsx).
--
-- Run in Supabase SQL Editor BEFORE pushing the matching code. Idempotent —
-- safe to run more than once (the sheet's chains / contacts are only added
-- when they aren't there yet, so later edits made in the app are kept).
-- New tables only; nothing existing is changed.
--
--   sales_chain_tiers           T1–T4 and how often to touch base (cadence)
--   sales_chain_class           one row per classified chain: tier + notes
--   sales_chain_class_contacts  the chain's buyers / corporate contacts
--
-- Who: Sales Dashboard people (has_section 'sales_dashboard'; admins always
-- have it) can see AND edit. Nobody else sees anything.
-- This list stands on its own — it isn't linked to store accounts
-- (sales_accounts), store-level contacts or Chain setup.

create table if not exists public.sales_chain_tiers (
  tier text primary key,
  cadence text,
  sort int not null default 0,
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users(id) on delete set null
);

create table if not exists public.sales_chain_class (
  id uuid primary key default gen_random_uuid(),
  chain text not null,
  tier text not null references public.sales_chain_tiers(tier) on update cascade,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users(id) on delete set null
);
create unique index if not exists sales_chain_class_chain_uq on public.sales_chain_class (lower(chain));

create table if not exists public.sales_chain_class_contacts (
  id uuid primary key default gen_random_uuid(),
  chain_id uuid not null references public.sales_chain_class(id) on delete cascade,
  name text,
  title text,
  email text,
  phone text,
  notes text,
  sort int not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users(id) on delete set null
);
create index if not exists sales_chain_class_contacts_chain_idx on public.sales_chain_class_contacts (chain_id);

-- Access: Sales Dashboard only (read + write).
do $$
declare t text;
begin
  foreach t in array array['sales_chain_tiers', 'sales_chain_class', 'sales_chain_class_contacts'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists %I on public.%I', t || '_sales_dashboard', t);
    execute format(
      'create policy %I on public.%I for all using (public.has_section(auth.uid(), ''sales_dashboard'')) with check (public.has_section(auth.uid(), ''sales_dashboard''))',
      t || '_sales_dashboard', t);
    execute format('revoke all on public.%I from anon', t);
    execute format('grant select, insert, update, delete on public.%I to authenticated', t);
    execute format('grant select, insert, update, delete on public.%I to service_role', t);
  end loop;
end $$;

comment on table public.sales_chain_tiers is
  'Chain Classification tiers (Sales Dashboard → Chain Classification): T1–T4 and how often FCB touches base with chains in that tier (cadence, e.g. T1 Twice a year, T2 Once a quarter; blank = not set yet).';
comment on table public.sales_chain_class is
  'Chain Classification (Sales Dashboard → Chain Classification): the chains FCB has classified into tiers T1–T4 (Albertson''s, Safeway, Save Mart, Whole Foods, BevMo, …) with notes. One row per chain; contacts in sales_chain_class_contacts. Use for "what tier is X", "which chains are T1". Not linked to store accounts.';
comment on table public.sales_chain_class_contacts is
  'Corporate / buyer contacts for each classified chain (Sales Dashboard → Chain Classification): name, role, email, phone, notes. Chain-level, not store-level (store contacts are in sales_account_contacts). Use for "who is the buyer at X", "Whole Foods beer buyer email".';

-- Tiers (from the sheet's Summary by Tier tab).
insert into public.sales_chain_tiers (tier, cadence, sort) values
  ('T1', 'Twice a year', 1),
  ('T2', 'Once a quarter', 2),
  ('T3', null, 3),
  ('T4', null, 4)
on conflict (tier) do nothing;

-- Chains (27) from FCB_Retail_Account_Contacts.xlsx — added only if missing.
insert into public.sales_chain_class (chain, tier) select v.chain, v.tier from (values
  ('Albertson''s', 'T1'),
  ('Buffalo Wild Wings', 'T1'),
  ('Disney', 'T1'),
  ('Kroger', 'T1'),
  ('Lazy Dog', 'T1'),
  ('Raley''s', 'T1'),
  ('Safeway', 'T1'),
  ('Target', 'T1'),
  ('Walmart', 'T1'),
  ('Costco', 'T2'),
  ('Food 4 Less', 'T2'),
  ('Save Mart', 'T2'),
  ('Sprouts', 'T2'),
  ('Trader Joe''s', 'T2'),
  ('Whole Foods', 'T2'),
  ('Draeger''s Market', 'T3'),
  ('Gus''s Community Market', 'T3'),
  ('Lunardi''s', 'T3'),
  ('Mollie Stone''s', 'T3'),
  ('New Leaf Market', 'T3'),
  ('Nugget Markets', 'T3'),
  ('Oliver''s Market', 'T3'),
  ('Piazza''s Fine Foods', 'T3'),
  ('Zanotto''s Family Market', 'T3'),
  ('BevMo', 'T4'),
  ('Grocery Outlet', 'T4'),
  ('Total Wine', 'T4')
) as v(chain, tier)
where not exists (select 1 from public.sales_chain_class c where lower(c.chain) = lower(v.chain));

-- Contacts (38) — added only for chains that have no contacts yet, so
-- running this again never doubles them or undoes edits made in the app.
-- The 5 "Prospect - no contact on file" rows have no contact and are not
-- added (the app shows a Prospect tag on any chain with no contacts).
with v(chain, sort, name, title, email, phone, notes) as (values
  ('Albertson''s', 1, 'Kirk Foldenauer', null, 'Kirk.Foldenauer@pavilions.com', null, 'Pavilions banner email'),
  ('Albertson''s', 2, 'Patricia Wilson', null, 'Patricia.Wilson@albertsons.com', null, null),
  ('Buffalo Wild Wings', 1, 'Jeff Ward', 'Local Buyer', 'jeffward@inspirebrands.com', '(559) 273-9417', null),
  ('Buffalo Wild Wings', 2, 'Rudy Singh', 'National Buyer', 'rudolph.singh@inspirebrands.com', null, null),
  ('Disney', 1, 'Johnson Thomas', null, 'Johnson.E.Thomas@disney.com', null, null),
  ('Disney', 2, 'Zach Masongsong', null, 'Zachary.L.Masongsong@disney.com', null, null),
  ('Kroger', 1, 'Mike Davis', null, 'mike.davis@kroger.com', null, null),
  ('Lazy Dog', 1, 'Evelyn Stanga', null, 'estanga@ldeat.com', '(562) 544-1090', null),
  ('Raley''s', 1, 'Clarice Hutcheson', null, 'cflores@raleys.com', null, 'Email alias does not match name as listed'),
  ('Raley''s', 2, 'Thomas Jones', null, 'TJones13@raleys.com', null, null),
  ('Safeway', 1, 'Bob Riley', null, 'Bob.Riley@safeway.com', null, null),
  ('Safeway', 2, 'Michael Pinney', null, 'Michael.Pinney@safeway.com', null, null),
  ('Target', 1, 'Christopher G. Hanson', null, 'Christopher.G.Hanson@target.com', null, null),
  ('Walmart', 1, 'Danielle Zastrow', null, 'danielle.jennison@walmart.com', null, 'Source listed tier as ''T!'' - read as T1; email surname differs from name'),
  ('Costco', 1, 'Andrew Wheat', null, 'ajwheat@costco.com', null, null),
  ('Costco', 2, 'Crystal Vizuet', null, 'cvizuet@costco.com', null, null),
  ('Costco', 3, 'Marisol Cervantes', null, 'mgonzaleza0@costco.com', null, null),
  ('Food 4 Less', 1, 'Doug Gong', null, 'doug@gongcofoods.com', null, null),
  ('Save Mart', 1, 'Brian Holder', null, 'Brian.Holder@savemart.com', null, null),
  ('Save Mart', 2, 'Frank Chandler', null, 'Frank.Chandler@savemart.com', null, null),
  ('Save Mart', 3, 'John Michael', 'District Manager', null, '(209) 857-0264', null),
  ('Save Mart', 4, 'John Stone', 'District Manager', null, '(559) 417-1738', null),
  ('Sprouts', 1, 'Hunter LaRavia', null, 'HunterLaRavia@sprouts.com', '(602) 390-3099', null),
  ('Sprouts', 2, 'Karen Martinez', null, 'KarenMartinez@sprouts.com', '(602) 682-1430', null),
  ('Trader Joe''s', 1, 'Abigail Coronel', 'Buyer', 'ACoronel@traderjoes.com', '(626) 803-9157', null),
  ('Trader Joe''s', 2, 'James Zichterman', 'Accounting', 'JZichterman@traderjoes.com', null, null),
  ('Whole Foods', 1, 'Dan Barrera', 'Beer Assistant', 'Dan.Barrera@wholefoods.com', null, null),
  ('Whole Foods', 2, 'Justin Ray', 'Beer Buyer', 'justin.ray@wholefoods.com', null, null),
  ('Whole Foods', 3, 'Samantha Fletcher', 'Non-Beer Adult Bev', 'Samantha.Fletcher@wholefoods.com', null, null),
  ('Lunardi''s', 1, 'Mike Bisda', null, 'mikeb@matagrano.com', null, 'Matagrano contact - Mike submits for us into set'),
  ('Mollie Stone''s', 1, 'Kiley Van Zant', null, 'kvz@molliestones.com', '(650) 619-3180', null),
  ('New Leaf Market', 1, 'Brian Taylor', null, 'brian.taylor@newleaf.com', '(209) 400-5063', null),
  ('Nugget Markets', 1, 'Chris Luoma', null, 'Chris.Luoma@nuggetmarket.com', '(916) 806-3562', null),
  ('BevMo', 1, 'Jon Harrop', null, 'jonathan.harrop@gopuff.com', null, null),
  ('BevMo', 2, 'Thomas Savage', null, 'thomas.savage@gopuff.com', null, null),
  ('Grocery Outlet', 1, 'Carol Yu', null, 'cyu@cfgo.com', null, null),
  ('Total Wine', 1, 'Nader Tayeh', null, 'ntayeh@totalwine.com', '(240) 541-9667', null),
  ('Total Wine', 2, 'Patrick O''Meallie', null, 'pomeallie@totalwine.com', '(240) 541-9759', null)
)
insert into public.sales_chain_class_contacts (chain_id, sort, name, title, email, phone, notes)
select c.id, v.sort, v.name, v.title, v.email, v.phone, v.notes
from v join public.sales_chain_class c on lower(c.chain) = lower(v.chain)
where not exists (select 1 from public.sales_chain_class_contacts x where x.chain_id = c.id);

-- Check: should show 27 chains and 38 contacts the first time.
select (select count(*) from public.sales_chain_class) as chains,
       (select count(*) from public.sales_chain_class_contacts) as contacts;
