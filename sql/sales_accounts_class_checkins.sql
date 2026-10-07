-- Sales > Accounts — classifications + check-ins (added 2026-10-07, per
-- Chad + Art; Feature 2 of the sales system, project doc
-- claude/sales-system-build-plan.md, plus the start of Feature 3's check-in log).
--
-- sales_account_class: one row per classified account (keyed by VIP Outlet
-- ID). Kept apart from sales_accounts ON PURPOSE, with no foreign key, so a
-- full re-import of the sales data (which empties sales_accounts) never
-- wipes anyone's classifications.
--   owner_type  fcb | buddy | distributor | cadence   (empty = Distributor)
--                 fcb         — we own the relationship
--                 buddy       — shared account we review with the distributor rep
--                 distributor — the distributor owns it
--                 cadence     — never on permanently, buys a few kegs a year when asked
--               (Former distributor is automatic, from the account's distributor.)
--   tier        A | B | C
--   handled_by  fcb_rep | distributor_rep | back_office
--   tags        comma-separated: SCRUB, NOFOLLOWUP, POLITIC, EXEC, COMMITTED,
--               POTENTIAL, SOCIAL, EMAIL ONLY (plain text so Audit Log → Undo works)
--   buddy_list / buddy_rep_*  the distributor target list the account came
--               from and that list's distributor rep (from the import file).
-- Every change in the app is written to the Audit Log (who, when, old → new).
--
-- Access: anyone with Accounts access can view and change classifications
-- (has_section(auth.uid(), 'accounts')).
--
-- Run this in Supabase's SQL Editor BEFORE pushing the code. Idempotent —
-- safe to run more than once.

create table if not exists public.sales_account_class (
  id uuid primary key default gen_random_uuid(),
  outlet_id text not null unique,
  owner_type text check (owner_type in ('fcb', 'buddy', 'distributor', 'cadence')),
  tier text check (tier in ('A', 'B', 'C')),
  handled_by text check (handled_by in ('fcb_rep', 'distributor_rep', 'back_office')),
  tags text not null default '',
  buddy_list text,
  buddy_rep_name text,
  buddy_rep_phone text,
  buddy_rep_email text,
  updated_at timestamptz not null default now(),
  updated_by uuid references public.profiles(id)
);

alter table public.sales_account_class enable row level security;

drop policy if exists "sales_account_class_section" on public.sales_account_class;
create policy "sales_account_class_section" on public.sales_account_class for all
  using (has_section(auth.uid(), 'accounts'))
  with check (has_section(auth.uid(), 'accounts'));

-- Live updates: a change made by one person shows for everyone on the page.
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'sales_account_class'
  ) then
    alter publication supabase_realtime add table public.sales_account_class;
  end if;
end $$;

-- =========================================================
-- sales_account_checkins: visits, emails/texts, calls and other check-ins,
-- with the notes from each — shown as "Last check-in" in the account panel.
-- Starts with the check-ins in Chad's Sales Ops workbook (James's updates,
-- off-premise check-ins, bar checks, Melinda's Lilypad check-ins); later
-- Lilypad's check-in export and check-ins logged in the app (Feature 3).
-- No foreign key, same reason as above. Re-importing replaces only the rows
-- that came from an import (source starts with "Sales Ops:" or "Lilypad:"),
-- never ones logged in the app.
-- =========================================================
create table if not exists public.sales_account_checkins (
  id uuid primary key default gen_random_uuid(),
  outlet_id text not null,
  checkin_date date not null,
  rep text,
  activity text,
  outcome text,
  notes text,
  brands text,
  contact text,
  source text,
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now()
);
create index if not exists sales_account_checkins_outlet_idx on public.sales_account_checkins (outlet_id, checkin_date desc);

alter table public.sales_account_checkins enable row level security;

drop policy if exists "sales_account_checkins_section" on public.sales_account_checkins;
create policy "sales_account_checkins_section" on public.sales_account_checkins for all
  using (has_section(auth.uid(), 'accounts'))
  with check (has_section(auth.uid(), 'accounts'));
