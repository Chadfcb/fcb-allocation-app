-- Access lockdown — added 2026-10-22, per Chad: "nobody should be able to
-- see anything unless given access to it in the app".
-- Run in Supabase SQL Editor BEFORE pushing the matching code. Idempotent —
-- safe to run more than once.
--
-- What the live-database audit (2026-10-22) found open to ANY signed-in
-- person, whatever access they'd been given — and what each is tied to now:
--   distributor_prices ........ Inventory & Allocation, Distributor Pricing, Weeks, Cash Flow
--   products .................. Inventory & Allocation, Distributor Inventory, Build Orders,
--                               Distributor Pricing, Weeks, Tanks
--   distributors .............. the pages that list distributors (Inventory & Allocation,
--                               Distributor Inventory, Build Orders, Distributor Pricing,
--                               Weeks, Price List, Cash Flow, Distributor Data, Events)
--   weeks ..................... Inventory & Allocation, Weeks, Build Orders,
--                               Distributor Inventory, Tanks, Cash Flow
--   section_dividers .......... Inventory & Allocation, Weeks, Build Orders,
--                               Distributor Inventory, Distributor Pricing
--   custom_packaging_items /
--   custom_label_items ........ Inventory & Allocation, Weeks
--   ekos_sync_status .......... admins (Operations Dashboard)
--   ernie_reference_documents
--     (+ reference-docs files)  Ernie AI
--   task_subcategories ........ Tasks (read AND write — anyone signed in could
--                               add/rename/delete them before)
--   profiles (names/emails) ... your own row always; everyone else's only if
--                               you've been given at least one section
--   audit_log (writing) ....... people with at least one section
--   inventory_with_remaining /
--   suggested_orders (views) .. ran as the view's owner, so they skipped every
--                               rule above. Now they run as the person asking
--                               (security_invoker), so the underlying tables'
--                               rules apply.
--   start_new_week() .......... anyone (even signed out) could start a new
--                               week. Now admins only (and the server).
--   anon (signed-out) role .... had full table privileges on every table (the
--                               Supabase default); rules kept data out, but
--                               the whole app requires sign-in, so revoked.
-- Weeks section: a person with only "Weeks" could open a past week but its
-- inventory/allocation tables refused them; they now get read access to
-- those week tables (that's what the Weeks page shows).
-- Unchanged on purpose: your own profile, Customize settings, New! badges,
-- and sending Feedback (so someone with no access can still ask for it).

-- ---------------------------------------------------------------------------
-- Helpers (security definer so they can read profiles/user_section_access
-- from inside a profiles policy without recursion)
-- ---------------------------------------------------------------------------
create or replace function public.has_any_section(uid uuid, sections text[])
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from unnest(sections) s where public.has_section(uid, s)
  );
$$;
comment on function public.has_any_section(uuid, text[]) is
  '[hidden] Access helper for row rules: true if the person has ANY of these sections (admins per has_section).';

create or replace function public.has_any_access(uid uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select
    exists (select 1 from public.profiles p where p.id = uid and p.role = 'admin')
    or exists (select 1 from public.user_section_access usa where usa.user_id = uid);
$$;
comment on function public.has_any_access(uuid) is
  '[hidden] Access helper for row rules: true if the person is an admin or has been given at least one section.';

revoke all on function public.has_any_section(uuid, text[]) from public, anon;
revoke all on function public.has_any_access(uuid) from public, anon;
grant execute on function public.has_any_section(uuid, text[]) to authenticated, service_role;
grant execute on function public.has_any_access(uuid) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Shared lists
-- ---------------------------------------------------------------------------
drop policy if exists "distributor_prices_select" on public.distributor_prices;
create policy "distributor_prices_select" on public.distributor_prices for select using (
  public.has_any_section(auth.uid(), array['inventory_allocation', 'distributor_pricing', 'weeks', 'cashflow_dashboard'])
);

drop policy if exists "products_select" on public.products;
create policy "products_select" on public.products for select using (
  public.has_any_section(auth.uid(), array['inventory_allocation', 'distributor_inventory', 'build_orders',
    'distributor_pricing', 'weeks', 'tanks'])
);

drop policy if exists "distributors_select" on public.distributors;
create policy "distributors_select" on public.distributors for select using (
  public.has_any_section(auth.uid(), array['inventory_allocation', 'distributor_inventory', 'build_orders',
    'distributor_pricing', 'weeks', 'price_list', 'cashflow_dashboard', 'distributor_data', 'events_calendar'])
);

drop policy if exists "weeks_select" on public.weeks;
create policy "weeks_select" on public.weeks for select using (
  public.has_any_section(auth.uid(), array['inventory_allocation', 'weeks', 'build_orders',
    'distributor_inventory', 'tanks', 'cashflow_dashboard'])
);

drop policy if exists "section_dividers_select" on public.section_dividers;
create policy "section_dividers_select" on public.section_dividers for select using (
  public.has_any_section(auth.uid(), array['inventory_allocation', 'weeks', 'build_orders',
    'distributor_inventory', 'distributor_pricing'])
);

drop policy if exists "custom_packaging_items_select" on public.custom_packaging_items;
create policy "custom_packaging_items_select" on public.custom_packaging_items for select using (
  public.has_any_section(auth.uid(), array['inventory_allocation', 'weeks'])
);

drop policy if exists "custom_label_items_select" on public.custom_label_items;
create policy "custom_label_items_select" on public.custom_label_items for select using (
  public.has_any_section(auth.uid(), array['inventory_allocation', 'weeks'])
);

drop policy if exists "ekos_sync_status_read" on public.ekos_sync_status;
create policy "ekos_sync_status_read" on public.ekos_sync_status for select using (
  exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'admin')
);

drop policy if exists "ernie_reference_documents_select" on public.ernie_reference_documents;
create policy "ernie_reference_documents_select" on public.ernie_reference_documents for select using (
  public.has_section(auth.uid(), 'ernie_ai')
);

drop policy if exists "ernie_reference_documents_bucket_select" on storage.objects;
create policy "ernie_reference_documents_bucket_select" on storage.objects for select using (
  bucket_id = 'reference-docs' and public.has_section(auth.uid(), 'ernie_ai')
);

-- Tasks subcategories: read and write only with Tasks
drop policy if exists "task_subcategories_select" on public.task_subcategories;
drop policy if exists "task_subcategories_insert" on public.task_subcategories;
drop policy if exists "task_subcategories_update" on public.task_subcategories;
drop policy if exists "task_subcategories_delete" on public.task_subcategories;
create policy "task_subcategories_select" on public.task_subcategories for select using (
  public.has_section(auth.uid(), 'tasks')
);
create policy "task_subcategories_insert" on public.task_subcategories for insert with check (
  public.has_section(auth.uid(), 'tasks')
);
create policy "task_subcategories_update" on public.task_subcategories for update
  using (public.has_section(auth.uid(), 'tasks'))
  with check (public.has_section(auth.uid(), 'tasks'));
create policy "task_subcategories_delete" on public.task_subcategories for delete using (
  public.has_section(auth.uid(), 'tasks')
);

-- Profiles: your own row always; other people's names only once you've been
-- given at least one section.
drop policy if exists "profiles_select_all" on public.profiles;
drop policy if exists "profiles_select" on public.profiles;
create policy "profiles_select" on public.profiles for select using (
  id = auth.uid() or public.has_any_access(auth.uid())
);

-- Audit log: writing an entry needs at least one section
drop policy if exists "audit_log_insert" on public.audit_log;
create policy "audit_log_insert" on public.audit_log for insert with check (
  public.has_any_access(auth.uid())
);

-- ---------------------------------------------------------------------------
-- Weeks section: read the week tables the Weeks page shows
-- ---------------------------------------------------------------------------
do $$
declare
  t text;
begin
  foreach t in array array['inventory_snapshots', 'allocations', 'distributor_pos', 'packaging_inventory',
    'label_inventory', 'custom_packaging_inventory', 'custom_label_inventory']
  loop
    if to_regclass('public.' || t) is not null then
      execute format('drop policy if exists %I on public.%I', t || '_select_weeks', t);
      execute format(
        'create policy %I on public.%I for select using (public.has_section(auth.uid(), %L))',
        t || '_select_weeks', t, 'weeks');
    end if;
  end loop;
end $$;

-- ---------------------------------------------------------------------------
-- Views: run as the person asking, not as the owner
-- ---------------------------------------------------------------------------
alter view public.inventory_with_remaining set (security_invoker = on);
alter view public.suggested_orders set (security_invoker = on);

-- ---------------------------------------------------------------------------
-- start_new_week(): admins (and the server) only.
-- The live function is renamed to start_new_week_core (not callable from the
-- app) and start_new_week becomes a checked wrapper with the same inputs, so
-- the Weeks page keeps working unchanged. NOTE: don't re-run the old
-- sql/weeks_rollover_audit_field_fix.sql or supabase/functions.sql
-- start_new_week blocks — they'd replace this wrapper.
-- ---------------------------------------------------------------------------
do $$
begin
  if to_regprocedure('public.start_new_week_core(text, date, uuid, uuid)') is null then
    alter function public.start_new_week(text, date, uuid, uuid) rename to start_new_week_core;
  end if;
end $$;

revoke all on function public.start_new_week_core(text, date, uuid, uuid) from public, anon, authenticated;
grant execute on function public.start_new_week_core(text, date, uuid, uuid) to service_role;

create or replace function public.start_new_week(
  p_label text,
  p_week_start date,
  p_previous_week_id uuid,
  p_created_by uuid
)
returns uuid
language plpgsql
security definer
-- public on the path: start_new_week_core uses unqualified table names and
-- has no search_path of its own (an empty path here made it fail — found in
-- testing 10/22).
set search_path = public, pg_temp
as $$
begin
  if not (
    coalesce(auth.role(), '') = 'service_role'
    or exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'admin')
  ) then
    raise exception 'Only an admin can start a new week';
  end if;
  return public.start_new_week_core(p_label, p_week_start, p_previous_week_id, p_created_by);
end;
$$;
comment on function public.start_new_week(text, date, uuid, uuid) is
  '[hidden] Starts a new delivery week (admins only); carries inventory forward via start_new_week_core.';

revoke all on function public.start_new_week(text, date, uuid, uuid) from public, anon;
grant execute on function public.start_new_week(text, date, uuid, uuid) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Signed-out (anon) role: no table access at all — the app requires sign-in
-- ---------------------------------------------------------------------------
revoke all on all tables in schema public from anon;
alter default privileges in schema public revoke all on tables from anon;
