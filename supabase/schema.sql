-- FCB Distributor Allocation App — Database Schema
-- Run this in the Supabase SQL editor (Project > SQL Editor > New query) once
-- your free Supabase project is created.

-- =========================================================
-- Extensions
-- =========================================================
create extension if not exists "pgcrypto"; -- for gen_random_uuid()

-- =========================================================
-- Profiles (extends Supabase auth.users with app-specific data)
-- =========================================================
create table if not exists profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text not null,
  full_name text,
  role text not null default 'basic' check (role in ('admin','basic')),
  created_at timestamptz not null default now()
);

-- Auto-create a profile row whenever a new auth user signs up.
-- First user in the system becomes admin automatically; everyone after is basic
-- (an admin can promote others later from the Admin > Users screen).
create or replace function handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  existing_count int;
begin
  select count(*) into existing_count from public.profiles;
  insert into public.profiles (id, email, role)
  values (new.id, new.email, case when existing_count = 0 then 'admin' else 'basic' end);
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure handle_new_user();

-- =========================================================
-- Master data: distributors & products
-- =========================================================
create table if not exists distributors (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  color text, -- hex color used in the UI, matches FCB-events distributor color convention
  active boolean not null default true,
  created_at timestamptz not null default now()
);

create table if not exists products (
  id uuid primary key default gen_random_uuid(),
  name text not null, -- full display name e.g. "Capt. Hazy (Case - 6x4 - 16oz - Can)"
  sku text,
  avg_price numeric(10,2),
  active boolean not null default true,
  -- Controls display order in the Inventory & Allocation grid (matches how
  -- Chad's original spreadsheet grouped products by brand, e.g. FCB core
  -- products, then Sonoma Cider, then Speakeasy, with tap handles last).
  -- Lower sorts first; nulls sort last (new products default to the end).
  sort_order integer,
  created_at timestamptz not null default now()
);
create unique index if not exists products_name_key on products (name);

-- =========================================================
-- Weeks — one row per weekly cycle. previous_week_id links weeks together
-- so remaining inventory can roll forward automatically.
-- =========================================================
create table if not exists weeks (
  id uuid primary key default gen_random_uuid(),
  label text not null, -- e.g. "Delivery Week of Aug 18"
  week_start date not null,
  previous_week_id uuid references weeks(id),
  status text not null default 'open' check (status in ('draft','open','closed')),
  created_by uuid references profiles(id),
  created_at timestamptz not null default now()
);
create unique index if not exists weeks_week_start_key on weeks (week_start);

-- =========================================================
-- Your own inventory per product per week
-- (on hand / unlabeled / to be packaged, mirrors the spreadsheet columns)
-- =========================================================
create table if not exists inventory_snapshots (
  id uuid primary key default gen_random_uuid(),
  week_id uuid not null references weeks(id) on delete cascade,
  product_id uuid not null references products(id),
  on_hand numeric(12,2) not null default 0,
  unlabeled numeric(12,2) not null default 0,
  to_be_packaged numeric(12,2) not null default 0,
  status_flag text check (status_flag in
    ('good_confirmed','dont_have','have_some','need_to_package','need_pakteks','need_labels','need_cans','old_product')),
  updated_by uuid references profiles(id),
  updated_at timestamptz not null default now(),
  unique (week_id, product_id)
);

-- =========================================================
-- Distributor-reported inventory + rate of sale per product per week
-- =========================================================
create table if not exists distributor_inventory (
  id uuid primary key default gen_random_uuid(),
  week_id uuid not null references weeks(id) on delete cascade,
  distributor_id uuid not null references distributors(id),
  product_id uuid not null references products(id),
  on_hand_qty numeric(12,2) not null default 0,
  rate_of_sale numeric(12,4) not null default 0, -- units sold per week
  source text not null check (source in ('vip','ekos','distributor')),
  imported_at timestamptz,
  updated_by uuid references profiles(id),
  updated_at timestamptz not null default now(),
  unique (week_id, distributor_id, product_id)
);

-- =========================================================
-- Allocations — how much of your inventory is assigned to each
-- distributor's order for the week
-- =========================================================
create table if not exists allocations (
  id uuid primary key default gen_random_uuid(),
  week_id uuid not null references weeks(id) on delete cascade,
  distributor_id uuid not null references distributors(id),
  product_id uuid not null references products(id),
  quantity numeric(12,2) not null default 0,
  status_flag text check (status_flag in
    ('good_confirmed','dont_have','have_some','need_to_package','need_pakteks','need_labels','need_cans','old_product')),
  updated_by uuid references profiles(id),
  updated_at timestamptz not null default now(),
  unique (week_id, distributor_id, product_id)
);

-- =========================================================
-- One PO number per distributor per week (used to find the order in Ekos).
-- Separate table because the grain is (week, distributor) — one PO number
-- total for that distributor's whole order, not one per product line.
-- =========================================================
create table if not exists distributor_pos (
  id uuid primary key default gen_random_uuid(),
  week_id uuid not null references weeks(id) on delete cascade,
  distributor_id uuid not null references distributors(id),
  po_number text,
  updated_by uuid references profiles(id),
  updated_at timestamptz not null default now(),
  unique (week_id, distributor_id)
);

-- =========================================================
-- Audit log — every meaningful change is recorded here so admins can
-- review history and one-click undo a change.
-- =========================================================
create table if not exists audit_log (
  id uuid primary key default gen_random_uuid(),
  week_id uuid references weeks(id) on delete cascade,
  table_name text not null,
  record_id uuid not null,
  field_name text not null,
  old_value text,
  new_value text,
  changed_by uuid references profiles(id),
  changed_at timestamptz not null default now(),
  reverted boolean not null default false,
  reverted_at timestamptz,
  reverted_by uuid references profiles(id)
);
create index if not exists audit_log_week_idx on audit_log (week_id, changed_at desc);

-- =========================================================
-- Convenience view: remaining inventory = total on hand - sum(allocated)
-- =========================================================
create or replace view inventory_with_remaining as
select
  s.id,
  s.week_id,
  s.product_id,
  s.on_hand,
  s.unlabeled,
  s.to_be_packaged,
  (s.on_hand + s.unlabeled + s.to_be_packaged) as total,
  (s.on_hand + s.unlabeled + s.to_be_packaged)
    - coalesce((select sum(a.quantity) from allocations a
                where a.week_id = s.week_id and a.product_id = s.product_id), 0)
    as remaining,
  s.status_flag,
  s.updated_by,
  s.updated_at
from inventory_snapshots s;

-- =========================================================
-- Convenience view: suggested order = days-of-supply based flag
-- =========================================================
create or replace view suggested_orders as
select
  di.week_id,
  di.distributor_id,
  di.product_id,
  di.on_hand_qty,
  di.rate_of_sale,
  case when di.rate_of_sale > 0 then round(di.on_hand_qty / di.rate_of_sale, 2) else null end
    as weeks_of_supply,
  di.source
from distributor_inventory di;

-- =========================================================
-- Row Level Security
-- =========================================================
alter table profiles enable row level security;
alter table distributors enable row level security;
alter table products enable row level security;
alter table weeks enable row level security;
alter table inventory_snapshots enable row level security;
alter table distributor_inventory enable row level security;
alter table allocations enable row level security;
alter table distributor_pos enable row level security;
alter table audit_log enable row level security;

-- Everyone signed in can read their own profile + see other profiles (for
-- attribution / "who changed this" display); only admins can change roles.
create policy "profiles_select_all" on profiles for select using (auth.uid() is not null);
create policy "profiles_update_self_or_admin" on profiles for update using (
  auth.uid() = id or exists (select 1 from profiles p where p.id = auth.uid() and p.role = 'admin')
);

-- Master data (distributors/products): everyone can read; only admins write.
create policy "distributors_select" on distributors for select using (auth.uid() is not null);
create policy "distributors_write_admin" on distributors for all using (
  exists (select 1 from profiles p where p.id = auth.uid() and p.role = 'admin')
);
create policy "products_select" on products for select using (auth.uid() is not null);
create policy "products_write_admin" on products for all using (
  exists (select 1 from profiles p where p.id = auth.uid() and p.role = 'admin')
);

-- Weeks: everyone can read; only admins can create/close a week (starting a
-- new week is an admin-level action since it affects everyone's data).
create policy "weeks_select" on weeks for select using (auth.uid() is not null);
create policy "weeks_write_admin" on weeks for all using (
  exists (select 1 from profiles p where p.id = auth.uid() and p.role = 'admin')
);

-- Day-to-day data entry (inventory, distributor data, allocations):
-- both admin and basic users can read/write — this is the weekly working data.
create policy "inventory_rw" on inventory_snapshots for all using (auth.uid() is not null);
create policy "distributor_inventory_rw" on distributor_inventory for all using (auth.uid() is not null);
create policy "allocations_rw" on allocations for all using (auth.uid() is not null);
create policy "distributor_pos_rw" on distributor_pos for all using (auth.uid() is not null);

-- Audit log: everyone can insert (so their own changes get logged); only
-- admins can read/undo the full history.
create policy "audit_log_insert" on audit_log for insert with check (auth.uid() is not null);
create policy "audit_log_select_admin" on audit_log for select using (
  exists (select 1 from profiles p where p.id = auth.uid() and p.role = 'admin')
);
create policy "audit_log_update_admin" on audit_log for update using (
  exists (select 1 from profiles p where p.id = auth.uid() and p.role = 'admin')
);
