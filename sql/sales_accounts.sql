-- Sales > Accounts (added 2026-10-07, per Chad + Art) — Feature 1 of the
-- sales system (project doc claude/sales-system-build-plan.md). Every retail
-- account we've sold to or could sell to, with its monthly purchase history
-- and buyer contacts. Starting data: the two VIP Master files (Jan 2020 –
-- Jul 15, 2026), the Accounts & Contacts file, and later buy dates from the
-- Sales Ops reports. Loaded from the page's "Import data" panel (admins).
--
-- sales_accounts          one row per account, keyed by VIP Outlet ID.
--                         The summary columns (last buy, lifetime CE, etc.)
--                         are filled by sales_accounts_refresh() after each
--                         import — the page works out each account's stage
--                         from them.
-- sales_account_sales     purchase history: one row per account × month ×
--                         product × package × distributor (VIP data is
--                         monthly totals, not single invoices).
-- sales_account_contacts  buyer / manager contacts (CRM Export + KARMA).
-- sales_data_meta         one row: the "as of" date of the data (last buy
--                         date in the import) and when it was imported.
--
-- Access: has_section(auth.uid(), 'accounts') — rides along with the Sales
-- toggle on Users > Edit, same as Chain Authorizations. Read-only for
-- everyone in the app; only the import route (service role) writes.
--
-- Run this in Supabase's SQL Editor BEFORE pushing the code. Idempotent —
-- safe to run more than once.

create table if not exists public.sales_accounts (
  outlet_id text primary key,
  name text not null,
  address text,
  city text,
  state text,
  zip text,
  phone text,
  distributor text,
  premise text,
  best_day text,
  last_buy_date date,
  first_buy_date date,
  lifetime_ce numeric not null default 0,
  ce_12mo numeric not null default 0,
  buy_months_6 int not null default 0,
  contact_count int not null default 0,
  report_buy_date date,
  report_note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists sales_accounts_distributor_idx on public.sales_accounts (distributor);

create table if not exists public.sales_account_sales (
  id bigint generated always as identity primary key,
  outlet_id text not null references public.sales_accounts(outlet_id) on delete cascade,
  month date not null,
  product text not null,
  package text,
  distributor text,
  ce numeric not null,
  last_buy_date date
);
create index if not exists sales_account_sales_outlet_idx on public.sales_account_sales (outlet_id);

create table if not exists public.sales_account_contacts (
  id uuid primary key default gen_random_uuid(),
  outlet_id text not null references public.sales_accounts(outlet_id) on delete cascade,
  name text,
  title text,
  phone text,
  mobile text,
  email text,
  notes text,
  source text,
  created_at timestamptz not null default now()
);
create index if not exists sales_account_contacts_outlet_idx on public.sales_account_contacts (outlet_id);

create table if not exists public.sales_data_meta (
  id int primary key default 1 check (id = 1),
  as_of date,
  imported_at timestamptz,
  imported_by uuid references public.profiles(id),
  note text
);

alter table public.sales_accounts enable row level security;
alter table public.sales_account_sales enable row level security;
alter table public.sales_account_contacts enable row level security;
alter table public.sales_data_meta enable row level security;

drop policy if exists "sales_accounts_read" on public.sales_accounts;
create policy "sales_accounts_read" on public.sales_accounts for select using (
  has_section(auth.uid(), 'accounts')
);
drop policy if exists "sales_account_sales_read" on public.sales_account_sales;
create policy "sales_account_sales_read" on public.sales_account_sales for select using (
  has_section(auth.uid(), 'accounts')
);
drop policy if exists "sales_account_contacts_read" on public.sales_account_contacts;
create policy "sales_account_contacts_read" on public.sales_account_contacts for select using (
  has_section(auth.uid(), 'accounts')
);
drop policy if exists "sales_data_meta_read" on public.sales_data_meta;
create policy "sales_data_meta_read" on public.sales_data_meta for select using (
  has_section(auth.uid(), 'accounts')
);

-- Empties all account data before a full re-import. Only the import route
-- (service role) can call it.
create or replace function public.sales_accounts_clear()
returns void
language sql
security definer
set search_path = ''
as $$
  truncate table public.sales_account_sales, public.sales_account_contacts, public.sales_accounts;
$$;

-- Fills each account's summary columns from its purchase history, as of
-- p_as_of (the last buy date in the data):
--   last / first buy, lifetime CE, CE in the last 12 months, how many of the
--   last 6 months had a buy, the distributor it last bought through, and how
--   many contacts it has.
create or replace function public.sales_accounts_refresh(p_as_of date)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  m0 date := date_trunc('month', p_as_of)::date;
begin
  update public.sales_accounts a set
    last_buy_date = null, first_buy_date = null, lifetime_ce = 0, ce_12mo = 0, buy_months_6 = 0, contact_count = 0;

  update public.sales_accounts a set
    last_buy_date = s.lb,
    first_buy_date = s.fb,
    lifetime_ce = s.t,
    ce_12mo = s.y,
    buy_months_6 = s.b6,
    updated_at = now()
  from (
    select outlet_id,
      max(coalesce(last_buy_date, month)) as lb,
      min(month) as fb,
      sum(ce) as t,
      coalesce(sum(ce) filter (where month > (m0 - interval '12 months')), 0) as y,
      count(distinct month) filter (where month > (m0 - interval '6 months')) as b6
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

revoke all on function public.sales_accounts_clear() from public, anon, authenticated;
revoke all on function public.sales_accounts_refresh(date) from public, anon, authenticated;
grant execute on function public.sales_accounts_clear() to service_role;
grant execute on function public.sales_accounts_refresh(date) to service_role;
