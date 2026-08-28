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
  -- True until this person has been through the account-setup flow (chosen
  -- their own password + entered their name) after an admin sets them up
  -- with a temporary password. New profiles start out true; existing users
  -- who'd already signed in before this feature shipped are left/set false
  -- by the migration so they aren't forced through it retroactively.
  must_change_password boolean not null default true,
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
  -- Lets admins reorder/add/remove distributor columns on Inventory &
  -- Allocation the same way products can be reordered/added/removed —
  -- null (the original 7 seeded distributors) sorts after any explicitly
  -- ordered ones, then falls back to name.
  sort_order double precision,
  -- False for a distributor "row" that isn't a real separate physical
  -- location — e.g. "Matagrano 2", which Chad created as a second PO/
  -- allocation entry for the same distributor, not a second warehouse.
  -- Such rows still fully participate in Inventory & Allocation, Purchase
  -- Orders, etc.; they're just excluded from the Distributor Inventory
  -- page and its Ekos sync, since there's no separate on-hand number for
  -- them to report.
  track_inventory boolean not null default true,
  -- Column order used ONLY by the Distributor Inventory page — kept
  -- separate from `sort_order` (which drives Inventory & Allocation,
  -- Purchase Orders, Pricing, and Distributor Data) because Chad wants a
  -- different left-to-right order on this one page. Null sorts after any
  -- explicitly ordered distributor, then falls back to name, same
  -- convention as `sort_order`.
  inventory_sort_order double precision,
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
  -- Double precision (not integer) so a new/moved product can be slotted
  -- in between two existing ones (e.g. 3.5 between 3 and 4) without having
  -- to renumber everything else.
  sort_order double precision,
  created_at timestamptz not null default now()
);
create unique index if not exists products_name_key on products (name);

-- =========================================================
-- Section dividers — labeled break rows in the Inventory & Allocation grid
-- (e.g. "Sonoma Cider", "Speakeasy Ales & Lagers", "Tap Handles") so the
-- product list can be grouped by brand like the original spreadsheet was.
-- Shares the same sort_order numbering space as products so a divider can
-- sit at any position relative to the products around it.
-- =========================================================
create table if not exists section_dividers (
  id uuid primary key default gen_random_uuid(),
  label text not null,
  sort_order double precision not null,
  created_at timestamptz not null default now()
);

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
    ('good_confirmed','dont_have','have_some','need_to_package','need_pakteks','need_labels','need_cans','need_kegs')),
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
    ('good_confirmed','dont_have','have_some','need_to_package','need_pakteks','need_labels','need_cans','need_kegs')),
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
  -- Whether the distributor has approved this PO. Blank until an admin
  -- picks a value; never carries forward to a new week (fresh every week,
  -- same as po_number). Admin-only to change — enforced below by a
  -- trigger, since po_number itself stays editable by any signed-in user.
  po_status text check (po_status in ('approved','pending','delivered')),
  updated_by uuid references profiles(id),
  updated_at timestamptz not null default now(),
  unique (week_id, distributor_id)
);

-- Blocks non-admins from changing po_status specifically (po_number on the
-- same row stays editable by anyone, per distributor_pos_rw below — RLS
-- alone can't split permissions by column within one row, so this is a
-- trigger instead).
create or replace function enforce_po_status_admin_only()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_is_admin boolean;
  v_old_status text;
begin
  v_old_status := case when tg_op = 'UPDATE' then old.po_status else null end;

  if new.po_status is distinct from v_old_status then
    select exists(
      select 1 from public.profiles p where p.id = auth.uid() and p.role = 'admin'
    ) into v_is_admin;

    if not v_is_admin then
      new.po_status := v_old_status;
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists enforce_po_status_admin_only_trigger on distributor_pos;
create trigger enforce_po_status_admin_only_trigger
  before insert or update on distributor_pos
  for each row execute procedure enforce_po_status_admin_only();

-- =========================================================
-- Distributor pricing — each distributor's own actual price per product
-- (not an average). Standing catalog data, not tied to a week. Drives the
-- Order Value totals on the Inventory & Allocation page.
-- =========================================================
create table if not exists distributor_prices (
  id uuid primary key default gen_random_uuid(),
  distributor_id uuid not null references distributors(id),
  product_id uuid not null references products(id),
  price numeric(10,2) not null default 0,
  updated_by uuid references profiles(id),
  updated_at timestamptz not null default now(),
  unique (distributor_id, product_id)
);

-- =========================================================
-- Operations > Build Orders — Par Level is a standing target per
-- distributor/product (like distributor_prices above: one number, not tied
-- to a week, edited directly on the Build Orders page).
-- =========================================================
create table if not exists distributor_par_levels (
  id uuid primary key default gen_random_uuid(),
  distributor_id uuid not null references distributors(id),
  product_id uuid not null references products(id),
  par_level numeric(12,2) not null default 0,
  updated_by uuid references profiles(id),
  updated_at timestamptz not null default now(),
  unique (distributor_id, product_id)
);

-- Recommended Order, per week. Defaults to (par level - on hand, floored at
-- 0) when no row exists yet — the app computes that default on the fly, so
-- a row only gets written here once someone actually edits the cell (or
-- once it's pushed to Inventory & Allocation, which stores the effective
-- value even if it was never hand-edited). That's the same
-- computed-until-edited pattern distributor_inventory uses for on-hand.
create table if not exists build_order_recommendations (
  id uuid primary key default gen_random_uuid(),
  week_id uuid not null references weeks(id) on delete cascade,
  distributor_id uuid not null references distributors(id),
  product_id uuid not null references products(id),
  recommended_qty numeric(12,2) not null default 0,
  updated_by uuid references profiles(id),
  updated_at timestamptz not null default now(),
  unique (week_id, distributor_id, product_id)
);

-- =========================================================
-- Sales > Price List — brand-level price-to-retailer/distributor by
-- package format (6-pack, 4-pack, single, 1/6 bbl keg, 1/2 bbl keg). This is
-- the first piece of the old FCB Pricing desktop app being folded in under
-- the Sales section; Margin Analysis, Cost Per Case, and Contribution
-- Margin build on top of the same brand list in later phases.
-- Distinct from distributor_prices above (which drives Order Value totals
-- on Inventory & Allocation) — these two happened to share the name
-- "Distributor Pricing" in the old desktop app, so this one's called
-- "Price List" here to keep them apart. Admin-only, like the rest of Sales.
-- =========================================================
create table if not exists pricing_brands (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  sort_order double precision,
  active boolean not null default true,
  created_at timestamptz not null default now()
);

create table if not exists brand_price_list (
  id uuid primary key default gen_random_uuid(),
  brand_id uuid not null references pricing_brands(id) on delete cascade,
  package_key text not null check (package_key in ('6pk','4pack','single','sixth','half')),
  price numeric(10,2) not null default 0,
  updated_by uuid references profiles(id),
  updated_at timestamptz not null default now(),
  unique (brand_id, package_key)
);

-- =========================================================
-- Operations > Build Orders > Tank Allocations — a standing (not week-
-- scoped) block, one row per Price List brand: which fermentation vessel
-- it's in, how many BBLs are available in that tank, and how those BBLs are
-- being committed across package formats (same 5 formats as Price List:
-- single/4pack/6pk/sixth/half). BBLs Remaining isn't stored — the app
-- computes it as bbls_available minus each qty converted to BBLs via
-- standard volumetric math (1 bbl = 31 gal), independent of any brand's
-- Margin Analysis batch-yield figures.
-- =========================================================
create table if not exists tank_allocations (
  id uuid primary key default gen_random_uuid(),
  brand_id uuid not null references pricing_brands(id) on delete cascade,
  fv_number text,
  bbls_available numeric(10,2) not null default 0,
  qty_single numeric(10,2) not null default 0,
  qty_4pack numeric(10,2) not null default 0,
  qty_6pk numeric(10,2) not null default 0,
  qty_sixth numeric(10,2) not null default 0,
  qty_half numeric(10,2) not null default 0,
  updated_by uuid references profiles(id),
  updated_at timestamptz not null default now(),
  unique (brand_id)
);

-- =========================================================
-- Sales > Margin Analysis — second piece of folding FCB Pricing in. One
-- analysis per brand (batch cost + batch yield in BBLs), with a row per
-- package format holding what you charge the retailer (PTR) vs. what the
-- distributor pays (PTD). pack_cost/labor/yield_amt are per-package
-- overrides — null means "use the standard default for that format" (see
-- PKG_META in lib/marginAnalysis.ts). Admin-only, like the rest of Sales.
-- =========================================================
create table if not exists margin_analyses (
  id uuid primary key default gen_random_uuid(),
  brand_id uuid not null references pricing_brands(id) on delete cascade,
  batch_cost numeric(10,2) not null default 0,
  yield_bbls numeric(6,2) not null default 30,
  updated_by uuid references profiles(id),
  updated_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  unique (brand_id)
);

create table if not exists margin_analysis_packages (
  id uuid primary key default gen_random_uuid(),
  analysis_id uuid not null references margin_analyses(id) on delete cascade,
  package_key text not null check (package_key in ('6pk','4pack','single','sixth','half')),
  enabled boolean not null default true,
  ptr numeric(10,2),
  ptd numeric(10,2),
  pack_cost numeric(10,2),
  labor numeric(10,2),
  yield_amt numeric(10,2),
  updated_by uuid references profiles(id),
  updated_at timestamptz not null default now(),
  unique (analysis_id, package_key)
);

-- =========================================================
-- Sales > Cost Per Case — third piece of folding FCB Pricing in. The
-- underlying prices Margin Analysis falls back to when a brand doesn't set
-- its own packaging-cost/labor override for a package format. Recipe/
-- composition structure (how many cans/lids/labels per case, which
-- ingredients go in a brand's batch) is fixed in lib/costPerCase.ts — only
-- the unit prices here are editable. Admin-only, like the rest of Sales.
-- =========================================================
create table if not exists packaging_components (
  component_key text primary key,
  label text not null,
  category text not null,
  price numeric(10,2) not null default 0,
  updated_by uuid references profiles(id),
  updated_at timestamptz not null default now()
);

create table if not exists ingredient_costs (
  id uuid primary key default gen_random_uuid(),
  category_key text not null check (category_key in ('yeast','grain','hops','flavoring','other')),
  ingredient_key text not null,
  name text not null,
  unit text not null,
  price numeric(10,2) not null default 0,
  updated_by uuid references profiles(id),
  updated_at timestamptz not null default now(),
  unique (category_key, ingredient_key)
);

create table if not exists package_labor_costs (
  package_key text primary key check (package_key in ('6pk','4pack','single','sixth','half')),
  labor numeric(10,2) not null default 0,
  updated_by uuid references profiles(id),
  updated_at timestamptz not null default now()
);

-- View-only in the app for now (matches the old desktop app) — one row per
-- ingredient in a brand's recipe, quantity per BBL of batch.
create table if not exists batch_recipe_items (
  id uuid primary key default gen_random_uuid(),
  brand_id uuid not null references pricing_brands(id) on delete cascade,
  ingredient_key text not null,
  qty_per_bbl numeric(12,4) not null default 0,
  unit text not null,
  sort_order int not null default 0,
  unique (brand_id, ingredient_key)
);

-- Which parent company a brand rolls up under — only used by Contribution
-- Margin's company-grouped table below. Null for brands outside that
-- feature's scope (e.g. Mango Bomb never had Contribution Margin figures
-- in the old desktop app).
alter table pricing_brands add column if not exists company text;

-- =========================================================
-- Sales > Contribution Margin — fourth and final piece of folding the old
-- FCB Pricing desktop app in. One row per brand + package format holding
-- the only user-editable figure this feature needs — revenue per case
-- equivalent (a federal excise-tax accounting unit). Everything else
-- (packaging/ingredient/labor cost, PTD) is computed live from Cost Per
-- Case's and Margin Analysis's tables — see lib/contributionMargin.ts.
-- Admin-only, like the rest of Sales.
-- =========================================================
create table if not exists contribution_margin_lines (
  id uuid primary key default gen_random_uuid(),
  brand_id uuid not null references pricing_brands(id) on delete cascade,
  package_key text not null check (package_key in ('6pk','4pack','single','sixth','half')),
  revenue_per_ce numeric(12,6) not null default 0,
  updated_by uuid references profiles(id),
  updated_at timestamptz not null default now(),
  unique (brand_id, package_key)
);

-- =========================================================
-- Packaging inventory — manual on-hand counts for shared packaging
-- materials (cans, trays, pakteks, lids, kegs). Consumption against these
-- is computed in the app from allocations below, based on each product's
-- can/keg size (see lib/packaging.ts) — not stored here.
-- =========================================================
create table if not exists packaging_inventory (
  id uuid primary key default gen_random_uuid(),
  week_id uuid not null references weeks(id) on delete cascade,
  item_key text not null check (item_key in (
    'cans_19_2oz','cans_16oz','cans_12oz',
    'pakteks_4pack','pakteks_6pack',
    'trays_12_16oz','trays_19oz',
    'lids_202',
    'kegs_1_6bbl','kegs_1_2bbl'
  )),
  on_hand_qty numeric(12,2) not null default 0,
  updated_by uuid references profiles(id),
  updated_at timestamptz not null default now(),
  unique (week_id, item_key)
);

-- =========================================================
-- Label inventory — manual on-hand label counts, tracked per product since
-- each beer's label is unique artwork (unlike cans/trays/pakteks/lids,
-- which are shared across any product of the same size).
-- =========================================================
create table if not exists label_inventory (
  id uuid primary key default gen_random_uuid(),
  week_id uuid not null references weeks(id) on delete cascade,
  product_id uuid not null references products(id),
  on_hand_qty numeric(12,2) not null default 0,
  updated_by uuid references profiles(id),
  updated_at timestamptz not null default now(),
  unique (week_id, product_id)
);

-- =========================================================
-- Custom Packaging/Label Inventory items — freeform, admin-managed items
-- (added/renamed/reordered/removed from the "Edit Packaging Inventory
-- Item" / "Edit Label Item" menu on Inventory & Allocation), separate from
-- the fixed 10 packaging items and the per-product label rows above.
-- Simple manually-tracked counts — no automatic consumption math tied to
-- these, unlike the fixed packaging items.
-- =========================================================
create table if not exists custom_packaging_items (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  sort_order double precision,
  active boolean not null default true,
  created_at timestamptz not null default now()
);

create table if not exists custom_packaging_inventory (
  id uuid primary key default gen_random_uuid(),
  week_id uuid not null references weeks(id) on delete cascade,
  item_id uuid not null references custom_packaging_items(id) on delete cascade,
  on_hand_qty numeric(12,2) not null default 0,
  updated_by uuid references profiles(id),
  updated_at timestamptz not null default now(),
  unique (week_id, item_id)
);

create table if not exists custom_label_items (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  sort_order double precision,
  active boolean not null default true,
  created_at timestamptz not null default now()
);

create table if not exists custom_label_inventory (
  id uuid primary key default gen_random_uuid(),
  week_id uuid not null references weeks(id) on delete cascade,
  item_id uuid not null references custom_label_items(id) on delete cascade,
  on_hand_qty numeric(12,2) not null default 0,
  updated_by uuid references profiles(id),
  updated_at timestamptz not null default now(),
  unique (week_id, item_id)
);

-- =========================================================
-- Operations > Purchase Orders — FCB's own outgoing vendor purchase orders
-- (buying ingredients/supplies from suppliers like MoreBeer, Briess Malt,
-- etc.), synced in from Ekos. Distinct from distributor_pos above, which
-- tracks a distributor's PO *to* FCB for finished beer. Admin-only.
--
-- Not tied to a week — this mirrors Ekos's own "Open - Purchase Orders"
-- list as of the last sync, not a per-week snapshot. ekos_po_number is
-- unique so re-syncing the same PO updates it in place (upsert) instead of
-- duplicating; a sync also removes any row here whose PO number is no
-- longer in the current open list (it's been closed/received in Ekos
-- since the last sync).
-- =========================================================
create table if not exists purchase_orders (
  id uuid primary key default gen_random_uuid(),
  ekos_po_number text not null unique,
  supplier text not null,
  po_date date,
  expected_delivery_date date,
  total_cost numeric(12,2),
  status text,
  -- FCB's own "have we paid this" tracker — distinct from `status` above
  -- (Ekos's own field, always "Open"). Always one of these 2, no blank
  -- state; defaults to "pending". Set from the Purchase Orders page, shown
  -- as a badge on the Dashboard card. Independent from ordered_status below.
  payment_status text not null default 'pending'
    check (payment_status in ('pending', 'paid')),
  -- FCB's own "have we placed the order" tracker — its own dropdown,
  -- independent from payment_status. Always one of these 2, no blank state.
  ordered_status text not null default 'not_ordered'
    check (ordered_status in ('ordered', 'not_ordered')),
  -- The freeform note typed onto the PO in Ekos itself — the whole reason
  -- this feature exists, so it travels along with everything else and
  -- surfaces on both the Purchase Orders page and the Dashboard card.
  comments text,
  -- Ekos's own "Last Modified By" name, as Ekos records it — distinct from
  -- synced_by below (which of our own admins ran the sync).
  ekos_last_modified_by text,
  synced_by uuid references profiles(id),
  synced_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

create table if not exists purchase_order_items (
  id uuid primary key default gen_random_uuid(),
  purchase_order_id uuid not null references purchase_orders(id) on delete cascade,
  item_name text not null,
  quantity numeric(12,2),
  unit_cost numeric(12,2),
  line_total numeric(12,2),
  sort_order integer not null default 0
);
create index if not exists purchase_order_items_po_idx on purchase_order_items (purchase_order_id, sort_order);

-- =========================================================
-- Events Calendar — FCB's outside/off-site events program (festivals,
-- tastings, donations, distributor work-withs), recreated from the
-- standalone "FCB Events" Electron app. Standing data, not tied to a week.
-- Admin-only, full stop, like Sales and Purchase Orders. distributor_id
-- reuses the existing distributors table (name + color) instead of a
-- separate list, since that table's color column was already built to
-- match this app's distributor color convention.
-- =========================================================
create table if not exists events (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  start_date date not null,
  end_date date,
  time_label text,
  type text not null default 'other'
    check (type in ('festival', 'tasting', 'donation', 'work-with', 'other')),
  location text,
  distributor_id uuid references distributors(id) on delete set null,
  rep text,
  notes text,
  created_by uuid references profiles(id),
  updated_by uuid references profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists events_start_date_idx on events (start_date);

-- POS materials attached to one specific event (flyers, images, PDFs).
-- Actual bytes live in the "event-materials" storage bucket (see the
-- Storage section near the end of this file); this row is just the
-- metadata + which event it belongs to.
create table if not exists event_materials (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references events(id) on delete cascade,
  file_name text not null,
  storage_path text not null,
  mime_type text,
  size_bytes bigint,
  uploaded_by uuid references profiles(id),
  uploaded_at timestamptz not null default now()
);
create index if not exists event_materials_event_idx on event_materials (event_id);

-- Shared POS library — files not tied to any one event, which can be
-- attached to an event later (attaching just adds a row to
-- event_materials pointing at the same storage_path; the file itself
-- isn't duplicated).
create table if not exists pos_library (
  id uuid primary key default gen_random_uuid(),
  file_name text not null,
  storage_path text not null unique,
  mime_type text,
  size_bytes bigint,
  uploaded_by uuid references profiles(id),
  uploaded_at timestamptz not null default now()
);

-- POS > Labels — can/bottle label artwork, split into a fixed set of
-- brand + size buckets (3 brands x 3 sizes = 9 combinations). Actual bytes
-- live in the "pos-label-files" storage bucket (see the Storage section
-- near the end of this file); this row is just the metadata. Standing
-- data, not tied to a week. Admin-only, full stop, like Events Calendar.
create table if not exists pos_label_files (
  id uuid primary key default gen_random_uuid(),
  brand text not null check (brand in ('fcb', 'speakeasy', 'sonoma-cider')),
  size text not null check (size in ('19.2oz', '16oz', '12oz')),
  file_name text not null,
  storage_path text not null unique,
  mime_type text,
  size_bytes bigint,
  uploaded_by uuid references profiles(id),
  uploaded_at timestamptz not null default now()
);
create index if not exists pos_label_files_brand_size_idx on pos_label_files (brand, size);

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
alter table distributor_par_levels enable row level security;
alter table build_order_recommendations enable row level security;
alter table allocations enable row level security;
alter table distributor_pos enable row level security;
alter table distributor_prices enable row level security;
alter table section_dividers enable row level security;
alter table packaging_inventory enable row level security;
alter table label_inventory enable row level security;
alter table custom_packaging_items enable row level security;
alter table custom_packaging_inventory enable row level security;
alter table custom_label_items enable row level security;
alter table custom_label_inventory enable row level security;
alter table audit_log enable row level security;
alter table pricing_brands enable row level security;
alter table brand_price_list enable row level security;
alter table tank_allocations enable row level security;
alter table margin_analyses enable row level security;
alter table margin_analysis_packages enable row level security;
alter table packaging_components enable row level security;
alter table ingredient_costs enable row level security;
alter table package_labor_costs enable row level security;
alter table batch_recipe_items enable row level security;
alter table contribution_margin_lines enable row level security;
alter table purchase_orders enable row level security;
alter table purchase_order_items enable row level security;
alter table events enable row level security;
alter table event_materials enable row level security;
alter table pos_library enable row level security;
alter table pos_label_files enable row level security;

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
create policy "section_dividers_select" on section_dividers for select using (auth.uid() is not null);
create policy "section_dividers_write_admin" on section_dividers for all using (
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
-- Distributor Data (on-hand qty / rate of sale from VIP/Ekos/distributor) is
-- admin-only — Basic users' access is limited to the Inventory & Allocation
-- grid (allocations, inventory_snapshots, distributor_pos) only.
create policy "distributor_inventory_rw" on distributor_inventory for all using (
  exists (select 1 from profiles p where p.id = auth.uid() and p.role = 'admin')
);
-- Build Orders (par levels + recommended order) is admin-only, same as
-- Distributor Inventory — it's the same Operations sub-area.
create policy "distributor_par_levels_rw" on distributor_par_levels for all using (
  exists (select 1 from profiles p where p.id = auth.uid() and p.role = 'admin')
);
create policy "build_order_recommendations_rw" on build_order_recommendations for all using (
  exists (select 1 from profiles p where p.id = auth.uid() and p.role = 'admin')
);
create policy "allocations_rw" on allocations for all using (auth.uid() is not null);
create policy "distributor_pos_rw" on distributor_pos for all using (auth.uid() is not null);
-- Distributor Pricing: everyone can read (Order Value totals need it on the
-- Inventory & Allocation page for Basic users too); only admins can edit it.
create policy "distributor_prices_select" on distributor_prices for select using (auth.uid() is not null);
create policy "distributor_prices_write_admin" on distributor_prices for all using (
  exists (select 1 from profiles p where p.id = auth.uid() and p.role = 'admin')
);
-- Packaging/label inventory live right on the Inventory & Allocation page,
-- so both admin and basic users can read/write them (same as allocations).
create policy "packaging_inventory_rw" on packaging_inventory for all using (auth.uid() is not null);
create policy "label_inventory_rw" on label_inventory for all using (auth.uid() is not null);

-- Custom packaging/label items: anyone signed in can see the item list
-- (needed to enter quantities), but only admins can add/rename/remove an
-- item — same split as distributors. The quantity rows themselves (the
-- actual on-hand counts) are read/write for everyone, same as the fixed
-- packaging/label inventory above.
create policy "custom_packaging_items_select" on custom_packaging_items for select using (auth.uid() is not null);
create policy "custom_packaging_items_write_admin" on custom_packaging_items for all using (
  exists (select 1 from profiles p where p.id = auth.uid() and p.role = 'admin')
);
create policy "custom_packaging_inventory_rw" on custom_packaging_inventory for all using (auth.uid() is not null);
create policy "custom_label_items_select" on custom_label_items for select using (auth.uid() is not null);
create policy "custom_label_items_write_admin" on custom_label_items for all using (
  exists (select 1 from profiles p where p.id = auth.uid() and p.role = 'admin')
);
create policy "custom_label_inventory_rw" on custom_label_inventory for all using (auth.uid() is not null);

-- Sales > Price List: admin-only, full stop (read and write) — nobody else
-- can even see it, matching Dashboard/Users.
create policy "pricing_brands_admin" on pricing_brands for all using (
  exists (select 1 from profiles p where p.id = auth.uid() and p.role = 'admin')
);
create policy "brand_price_list_admin" on brand_price_list for all using (
  exists (select 1 from profiles p where p.id = auth.uid() and p.role = 'admin')
);
create policy "tank_allocations_admin" on tank_allocations for all using (
  exists (select 1 from profiles p where p.id = auth.uid() and p.role = 'admin')
);
create policy "margin_analyses_admin" on margin_analyses for all using (
  exists (select 1 from profiles p where p.id = auth.uid() and p.role = 'admin')
);
create policy "margin_analysis_packages_admin" on margin_analysis_packages for all using (
  exists (select 1 from profiles p where p.id = auth.uid() and p.role = 'admin')
);
create policy "packaging_components_admin" on packaging_components for all using (
  exists (select 1 from profiles p where p.id = auth.uid() and p.role = 'admin')
);
create policy "ingredient_costs_admin" on ingredient_costs for all using (
  exists (select 1 from profiles p where p.id = auth.uid() and p.role = 'admin')
);
create policy "package_labor_costs_admin" on package_labor_costs for all using (
  exists (select 1 from profiles p where p.id = auth.uid() and p.role = 'admin')
);
create policy "batch_recipe_items_admin" on batch_recipe_items for all using (
  exists (select 1 from profiles p where p.id = auth.uid() and p.role = 'admin')
);
create policy "contribution_margin_lines_admin" on contribution_margin_lines for all using (
  exists (select 1 from profiles p where p.id = auth.uid() and p.role = 'admin')
);

-- Operations > Purchase Orders: admin-only, full stop, matching Sales.
create policy "purchase_orders_admin" on purchase_orders for all using (
  exists (select 1 from profiles p where p.id = auth.uid() and p.role = 'admin')
);
create policy "purchase_order_items_admin" on purchase_order_items for all using (
  exists (select 1 from profiles p where p.id = auth.uid() and p.role = 'admin')
);

-- Events Calendar: admin-only, full stop (read and write) — hidden from
-- basic users entirely, same as Sales and Purchase Orders.
create policy "events_admin" on events for all using (
  exists (select 1 from profiles p where p.id = auth.uid() and p.role = 'admin')
);
create policy "event_materials_admin" on event_materials for all using (
  exists (select 1 from profiles p where p.id = auth.uid() and p.role = 'admin')
);
create policy "pos_library_admin" on pos_library for all using (
  exists (select 1 from profiles p where p.id = auth.uid() and p.role = 'admin')
);

-- POS > Labels: admin-only, full stop, same as Events Calendar.
create policy "pos_label_files_admin" on pos_label_files for all using (
  exists (select 1 from profiles p where p.id = auth.uid() and p.role = 'admin')
);

-- Audit log: everyone can insert (so their own changes get logged); only
-- admins can read/undo the full history.
create policy "audit_log_insert" on audit_log for insert with check (auth.uid() is not null);
create policy "audit_log_select_admin" on audit_log for select using (
  exists (select 1 from profiles p where p.id = auth.uid() and p.role = 'admin')
);
create policy "audit_log_update_admin" on audit_log for update using (
  exists (select 1 from profiles p where p.id = auth.uid() and p.role = 'admin')
);

-- =========================================================
-- Realtime — Inventory & Allocation live sync. Lets everyone viewing the
-- page see each other's edits (quantities, allocations, PO info,
-- distributor/product/divider changes, packaging & label counts) within
-- about a second, without reloading. Only takes effect on a real Supabase
-- project, where the `supabase_realtime` publication already exists —
-- silently does nothing on a bare local Postgres used for testing this
-- schema, and safe to re-run any number of times.
-- =========================================================
do $$
declare
  tbl text;
  realtime_tables text[] := array[
    'distributors', 'products', 'section_dividers',
    'custom_packaging_items', 'custom_label_items', 'distributor_prices',
    'inventory_snapshots', 'allocations', 'distributor_pos',
    'packaging_inventory', 'label_inventory',
    'custom_packaging_inventory', 'custom_label_inventory',
    'purchase_orders', 'purchase_order_items',
    'distributor_par_levels', 'build_order_recommendations', 'tank_allocations',
    'events', 'event_materials', 'pos_library', 'pos_label_files'
  ];
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    foreach tbl in array realtime_tables loop
      if not exists (
        select 1 from pg_publication_tables
        where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = tbl
      ) then
        execute format('alter publication supabase_realtime add table %I', tbl);
      end if;
    end loop;
  end if;
end
$$;

-- =========================================================
-- Storage — "event-materials" bucket backs both per-event POS materials
-- and the shared POS library (see events/event_materials/pos_library
-- above). Private bucket; admin-only read/write, same as the tables that
-- hold each file's metadata.
-- =========================================================
insert into storage.buckets (id, name, public)
values ('event-materials', 'event-materials', false)
on conflict (id) do nothing;

create policy "event_materials_bucket_admin" on storage.objects for all using (
  bucket_id = 'event-materials'
  and exists (select 1 from profiles p where p.id = auth.uid() and p.role = 'admin')
) with check (
  bucket_id = 'event-materials'
  and exists (select 1 from profiles p where p.id = auth.uid() and p.role = 'admin')
);

-- "pos-label-files" bucket backs POS > Labels (see pos_label_files above).
-- Private bucket; admin-only read/write, same convention as event-materials.
insert into storage.buckets (id, name, public)
values ('pos-label-files', 'pos-label-files', false)
on conflict (id) do nothing;

create policy "pos_label_files_bucket_admin" on storage.objects for all using (
  bucket_id = 'pos-label-files'
  and exists (select 1 from profiles p where p.id = auth.uid() and p.role = 'admin')
) with check (
  bucket_id = 'pos-label-files'
  and exists (select 1 from profiles p where p.id = auth.uid() and p.role = 'admin')
);
