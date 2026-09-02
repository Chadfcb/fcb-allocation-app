-- Per-user, per-section access — replaces the binary admin/basic split for
-- everything that used to be "admin-only, full stop." Run this once in
-- Supabase's SQL Editor, before the matching code deploy. Idempotent —
-- safe to re-run.
--
-- How it works: a new user_section_access table holds one row per
-- (user, section) grant. Admins are unaffected — they still see and do
-- everything, everywhere, with no rows needed. A Basic user only gets a
-- section's data/page once an admin adds that row for them (Users page).
-- Ernie AI is itself one of the section keys ('ernie_ai'), same as any
-- page — see the section list below.
--
-- Design choice carried over unchanged from today's admin/basic split:
-- checking a section grants routine, everyday use of that page — it does
-- NOT hand over the handful of currently-admin-only structural/destructive
-- actions that already sit apart from "can you see this page" (adding or
-- deleting distributors/products/dividers/custom items, starting or
-- closing a week, undoing an audit log entry). Those stay hard admin-only
-- regardless of any section grant, exactly as they work today. Flagging
-- this explicitly — if that's not what you pictured, it's a quick follow-up
-- change, not a redo.

-- =========================================================
-- The section keys (kept in one place — must match lib/permissions.ts)
-- =========================================================
-- Operations: purchase_orders, inventory_allocation, distributor_inventory,
--             build_orders, distributor_pricing, weeks, audit_log
-- Sales:      price_list, margin_analysis, cost_per_case, contribution_margin
-- Other:      events_calendar, pos_labels
-- Ernie:      ernie_ai

create table if not exists user_section_access (
  user_id uuid not null references profiles(id) on delete cascade,
  section_key text not null,
  granted_at timestamptz not null default now(),
  granted_by uuid references profiles(id),
  primary key (user_id, section_key)
);

alter table user_section_access enable row level security;

drop policy if exists "user_section_access_select" on user_section_access;
create policy "user_section_access_select" on user_section_access for select using (
  user_id = auth.uid()
  or exists (select 1 from profiles p where p.id = auth.uid() and p.role = 'admin')
);

drop policy if exists "user_section_access_write_admin" on user_section_access;
create policy "user_section_access_write_admin" on user_section_access for all using (
  exists (select 1 from profiles p where p.id = auth.uid() and p.role = 'admin')
) with check (
  exists (select 1 from profiles p where p.id = auth.uid() and p.role = 'admin')
);

-- Realtime isn't needed here (Users page reloads on save), but Basic users
-- do need to be able to read their own grants on every page load, hence
-- the self-select policy above.

-- =========================================================
-- has_section(uid, section) — true for an admin (always), or a Basic user
-- with that exact row. security definer so it can be called from inside
-- other tables' RLS policies without re-triggering RLS recursion.
-- =========================================================
create or replace function has_section(uid uuid, section text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select
    exists (select 1 from public.profiles p where p.id = uid and p.role = 'admin')
    or exists (
      select 1 from public.user_section_access usa
      where usa.user_id = uid and usa.section_key = section
    );
$$;

-- =========================================================
-- Backfill: today's Basic users already have Inventory & Allocation + Ernie
-- AI unconditionally — grant them explicitly so nobody loses access the
-- moment this ships. New Basic users going forward start with NOTHING
-- checked until an admin picks sections for them.
-- =========================================================
insert into user_section_access (user_id, section_key)
select id, 'inventory_allocation' from profiles where role = 'basic'
on conflict do nothing;

insert into user_section_access (user_id, section_key)
select id, 'ernie_ai' from profiles where role = 'basic'
on conflict do nothing;

-- =========================================================
-- Inventory & Allocation — was open to every signed-in user; now gated by
-- the inventory_allocation section (admins unaffected). Master-data writes
-- (distributors/products/dividers/custom items) and starting/closing a
-- week are NOT touched here — they stay hard admin-only, see note above.
-- =========================================================
drop policy if exists "inventory_rw" on inventory_snapshots;
create policy "inventory_rw" on inventory_snapshots for all using (
  has_section(auth.uid(), 'inventory_allocation')
);

drop policy if exists "allocations_rw" on allocations;
create policy "allocations_rw" on allocations for all using (
  has_section(auth.uid(), 'inventory_allocation')
);

drop policy if exists "distributor_pos_rw" on distributor_pos;
create policy "distributor_pos_rw" on distributor_pos for all using (
  has_section(auth.uid(), 'inventory_allocation')
);

drop policy if exists "packaging_inventory_rw" on packaging_inventory;
create policy "packaging_inventory_rw" on packaging_inventory for all using (
  has_section(auth.uid(), 'inventory_allocation')
);

drop policy if exists "label_inventory_rw" on label_inventory;
create policy "label_inventory_rw" on label_inventory for all using (
  has_section(auth.uid(), 'inventory_allocation')
);

drop policy if exists "custom_packaging_inventory_rw" on custom_packaging_inventory;
create policy "custom_packaging_inventory_rw" on custom_packaging_inventory for all using (
  has_section(auth.uid(), 'inventory_allocation')
);

drop policy if exists "custom_label_inventory_rw" on custom_label_inventory;
create policy "custom_label_inventory_rw" on custom_label_inventory for all using (
  has_section(auth.uid(), 'inventory_allocation')
);

-- =========================================================
-- Distributor Inventory — Build Orders reads the same table (to compute
-- recommendations), so read is granted by EITHER section; writing the
-- actual on-hand counts stays specific to the Distributor Inventory page.
-- =========================================================
drop policy if exists "distributor_inventory_rw" on distributor_inventory;

create policy "distributor_inventory_select" on distributor_inventory for select using (
  has_section(auth.uid(), 'distributor_inventory') or has_section(auth.uid(), 'build_orders')
);
create policy "distributor_inventory_write" on distributor_inventory for insert with check (
  has_section(auth.uid(), 'distributor_inventory')
);
create policy "distributor_inventory_update" on distributor_inventory for update using (
  has_section(auth.uid(), 'distributor_inventory')
);
create policy "distributor_inventory_delete" on distributor_inventory for delete using (
  has_section(auth.uid(), 'distributor_inventory')
);

-- =========================================================
-- Build Orders — par levels + recommendations + tank allocations, all
-- specific to that one page.
-- =========================================================
drop policy if exists "distributor_par_levels_rw" on distributor_par_levels;
create policy "distributor_par_levels_rw" on distributor_par_levels for all using (
  has_section(auth.uid(), 'build_orders')
);

drop policy if exists "build_order_recommendations_rw" on build_order_recommendations;
create policy "build_order_recommendations_rw" on build_order_recommendations for all using (
  has_section(auth.uid(), 'build_orders')
);

drop policy if exists "tank_allocations_admin" on tank_allocations;
create policy "tank_allocations_build_orders" on tank_allocations for all using (
  has_section(auth.uid(), 'build_orders')
);

-- =========================================================
-- Distributor Pricing — read stays open to everyone (Order Value totals on
-- Inventory & Allocation need it); only writing it is section-gated.
-- =========================================================
drop policy if exists "distributor_prices_write_admin" on distributor_prices;
create policy "distributor_prices_write" on distributor_prices for insert with check (
  has_section(auth.uid(), 'distributor_pricing')
);
create policy "distributor_prices_update" on distributor_prices for update using (
  has_section(auth.uid(), 'distributor_pricing')
);
create policy "distributor_prices_delete" on distributor_prices for delete using (
  has_section(auth.uid(), 'distributor_pricing')
);

-- =========================================================
-- Sales — pricing_brands and the 4 underlying cost tables are shared by
-- more than one Sales page, so their read/write is granted by ANY of the
-- pages that actually depend on them (matches what each page already
-- queries — see app/(app)/sales/*). Each page's own nav/route access is
-- still controlled individually (see the code changes), so having e.g.
-- Margin Analysis alone doesn't put the Cost Per Case page itself in your
-- nav — it just lets the data Margin Analysis needs load.
-- =========================================================
drop policy if exists "pricing_brands_admin" on pricing_brands;
create policy "pricing_brands_sales" on pricing_brands for all using (
  has_section(auth.uid(), 'price_list')
  or has_section(auth.uid(), 'margin_analysis')
  or has_section(auth.uid(), 'contribution_margin')
);

drop policy if exists "brand_price_list_admin" on brand_price_list;
create policy "brand_price_list_section" on brand_price_list for all using (
  has_section(auth.uid(), 'price_list')
);

drop policy if exists "margin_analyses_admin" on margin_analyses;
create policy "margin_analyses_section" on margin_analyses for all using (
  has_section(auth.uid(), 'margin_analysis')
);

drop policy if exists "margin_analysis_packages_admin" on margin_analysis_packages;
create policy "margin_analysis_packages_section" on margin_analysis_packages for all using (
  has_section(auth.uid(), 'margin_analysis')
);

drop policy if exists "packaging_components_admin" on packaging_components;
create policy "packaging_components_sales" on packaging_components for all using (
  has_section(auth.uid(), 'cost_per_case')
  or has_section(auth.uid(), 'margin_analysis')
  or has_section(auth.uid(), 'contribution_margin')
);

drop policy if exists "ingredient_costs_admin" on ingredient_costs;
create policy "ingredient_costs_sales" on ingredient_costs for all using (
  has_section(auth.uid(), 'cost_per_case')
  or has_section(auth.uid(), 'margin_analysis')
  or has_section(auth.uid(), 'contribution_margin')
);

drop policy if exists "package_labor_costs_admin" on package_labor_costs;
create policy "package_labor_costs_sales" on package_labor_costs for all using (
  has_section(auth.uid(), 'cost_per_case')
  or has_section(auth.uid(), 'margin_analysis')
  or has_section(auth.uid(), 'contribution_margin')
);

drop policy if exists "batch_recipe_items_admin" on batch_recipe_items;
create policy "batch_recipe_items_sales" on batch_recipe_items for all using (
  has_section(auth.uid(), 'cost_per_case')
  or has_section(auth.uid(), 'margin_analysis')
  or has_section(auth.uid(), 'contribution_margin')
);

drop policy if exists "contribution_margin_lines_admin" on contribution_margin_lines;
create policy "contribution_margin_lines_section" on contribution_margin_lines for all using (
  has_section(auth.uid(), 'contribution_margin')
);

-- =========================================================
-- Purchase Orders — gated as one unit, same as today.
-- =========================================================
drop policy if exists "purchase_orders_admin" on purchase_orders;
create policy "purchase_orders_section" on purchase_orders for all using (
  has_section(auth.uid(), 'purchase_orders')
);

drop policy if exists "purchase_order_items_admin" on purchase_order_items;
create policy "purchase_order_items_section" on purchase_order_items for all using (
  has_section(auth.uid(), 'purchase_orders')
);

-- =========================================================
-- Events Calendar — events/event_materials/pos_library (the shared POS
-- materials library lives on the Events Calendar page, not POS > Labels).
-- =========================================================
drop policy if exists "events_admin" on events;
create policy "events_section" on events for all using (
  has_section(auth.uid(), 'events_calendar')
);

drop policy if exists "event_materials_admin" on event_materials;
create policy "event_materials_section" on event_materials for all using (
  has_section(auth.uid(), 'events_calendar')
);

drop policy if exists "pos_library_admin" on pos_library;
create policy "pos_library_section" on pos_library for all using (
  has_section(auth.uid(), 'events_calendar')
);

drop policy if exists "event_materials_bucket_admin" on storage.objects;
create policy "event_materials_bucket_section" on storage.objects for all using (
  bucket_id = 'event-materials' and has_section(auth.uid(), 'events_calendar')
) with check (
  bucket_id = 'event-materials' and has_section(auth.uid(), 'events_calendar')
);

-- =========================================================
-- POS > Labels — one section covers the whole brand/size tree.
-- =========================================================
drop policy if exists "pos_label_files_admin" on pos_label_files;
create policy "pos_label_files_section" on pos_label_files for all using (
  has_section(auth.uid(), 'pos_labels')
);

drop policy if exists "pos_label_files_bucket_admin" on storage.objects;
create policy "pos_label_files_bucket_section" on storage.objects for all using (
  bucket_id = 'pos-label-files' and has_section(auth.uid(), 'pos_labels')
) with check (
  bucket_id = 'pos-label-files' and has_section(auth.uid(), 'pos_labels')
);

-- =========================================================
-- Audit Log — viewing history is now section-gated; undoing an entry
-- (audit_log_update_admin) stays hard admin-only, unchanged, since it's a
-- destructive action same as the master-data writes noted above.
-- =========================================================
drop policy if exists "audit_log_select_admin" on audit_log;
create policy "audit_log_select_section" on audit_log for select using (
  has_section(auth.uid(), 'audit_log')
);

-- audit_log_update_admin intentionally left as-is (hard admin-only).

-- Weeks: weeks_select was already open to everyone and stays that way;
-- weeks_write_admin (start/close a week — a whole-company action) stays
-- hard admin-only, unchanged. The 'weeks' section that Users > Edit grants
-- only controls whether the Weeks page/nav link shows up for that person —
-- see the code changes for that.
