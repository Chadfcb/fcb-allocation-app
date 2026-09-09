-- Administrator / Manager / Employee tiering — added 2026-09-09 per Chad.
-- Run this once in Supabase's SQL Editor, before the matching code deploy.
-- Idempotent — safe to re-run.
--
-- Deliberately does NOT rename or touch the existing role enum ('admin' /
-- 'basic') — every existing `role = 'admin'` check across the schema and
-- app keeps working unchanged for Managers. Instead this adds ONE new
-- column, is_super_admin, that only matters for the handful of sections on
-- the new ADMIN_RESTRICTED_SECTIONS list in lib/permissions.ts (today just
-- 'cashflow_dashboard' — the Finance > Cash Flow Dashboard).
--
--   Administrator = role = 'admin' AND is_super_admin = true   (full access, always)
--   Manager       = role = 'admin' AND is_super_admin = false  (everything Administrators
--                                                                have today, EXCEPT the
--                                                                admin-restricted sections
--                                                                below, unless separately
--                                                                granted one via
--                                                                user_section_access)
--   Employee      = role = 'basic'                             (unchanged — exactly what
--                                                                Basic users have today)
--
-- Per Chad: only he and Art are Administrators. Everyone else currently
-- role = 'admin' becomes a Manager (is_super_admin defaults to false, so no
-- explicit UPDATE is needed for them — only Chad's and Art's rows need to be
-- flipped to true below).

alter table profiles add column if not exists is_super_admin boolean not null default false;

update profiles set is_super_admin = true
where email in ('chad@fullcirclebrewing.com', 'arthur@fullcirclebrewing.com');

-- =========================================================
-- has_section(uid, section) — mirrors lib/permissions.ts's hasSection()
-- exactly: an Administrator (role='admin' AND is_super_admin) always has
-- every section; a Manager (role='admin', not super) has every section
-- EXCEPT the admin-restricted ones unless they hold the matching row; a
-- Basic/Employee user needs the matching row regardless. Keep the
-- restricted-section list below in sync with ADMIN_RESTRICTED_SECTIONS in
-- lib/permissions.ts — today just 'cashflow_dashboard'.
-- =========================================================
create or replace function has_section(uid uuid, section text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select
    exists (
      select 1 from public.profiles p
      where p.id = uid
        and p.role = 'admin'
        and (p.is_super_admin or section not in ('cashflow_dashboard'))
    )
    or exists (
      select 1 from public.user_section_access usa
      where usa.user_id = uid and usa.section_key = section
    );
$$;

-- =========================================================
-- Only an Administrator may change anyone's role/tier, or grant/revoke a
-- restricted (Finance) section — a Manager can still do everything else in
-- Users > Edit (create Employee accounts, edit ordinary category grants),
-- but not this. profiles_write_admin below assumes a policy of that name
-- already exists from the base schema (the normal "admins can update any
-- profile" policy); this replaces it with a version that also blocks a
-- non-super admin from changing role/is_super_admin on ANY row (including
-- their own) via a trigger, since row-level security can't inspect
-- OLD/NEW column-by-column on its own.
-- =========================================================
create or replace function prevent_non_super_admin_tier_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if (new.role is distinct from old.role or new.is_super_admin is distinct from old.is_super_admin) then
    if not exists (
      select 1 from public.profiles p
      where p.id = auth.uid() and p.role = 'admin' and p.is_super_admin
    ) then
      raise exception 'Only an Administrator can change a user''s role or tier.';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists prevent_non_super_admin_tier_change_trg on profiles;
create trigger prevent_non_super_admin_tier_change_trg
before update on profiles
for each row execute function prevent_non_super_admin_tier_change();

-- =========================================================
-- Restrict who can write a 'cashflow_dashboard' grant row — same idea as
-- the trigger above, but for user_section_access instead of profiles.
-- Reading/writing every OTHER section still goes through the existing
-- user_section_access_write_admin policy (any admin — Manager or
-- Administrator), unchanged.
-- =========================================================
drop policy if exists "user_section_access_write_admin" on user_section_access;
create policy "user_section_access_write_admin" on user_section_access for all using (
  exists (select 1 from profiles p where p.id = auth.uid() and p.role = 'admin')
  and (
    section_key <> 'cashflow_dashboard'
    or exists (select 1 from profiles p where p.id = auth.uid() and p.role = 'admin' and p.is_super_admin)
  )
) with check (
  exists (select 1 from profiles p where p.id = auth.uid() and p.role = 'admin')
  and (
    section_key <> 'cashflow_dashboard'
    or exists (select 1 from profiles p where p.id = auth.uid() and p.role = 'admin' and p.is_super_admin)
  )
);

-- =========================================================
-- Cash Flow Dashboard read access — the underlying figures live on tables
-- that are today gated by 'inventory_allocation'/'purchase_orders' (see
-- sql/user_section_access.sql). Someone granted ONLY Finance (no Operations
-- grant at all) still needs to be able to read the rows the Dashboard
-- computes from. These are additive SELECT-only policies (Postgres ORs
-- multiple permissive policies together for the same command), so nothing
-- already granted narrows — this only ever adds an additional way in, for
-- reading only.
-- =========================================================
drop policy if exists "allocations_select_cashflow" on allocations;
create policy "allocations_select_cashflow" on allocations for select using (
  has_section(auth.uid(), 'cashflow_dashboard')
);

drop policy if exists "distributor_pos_select_cashflow" on distributor_pos;
create policy "distributor_pos_select_cashflow" on distributor_pos for select using (
  has_section(auth.uid(), 'cashflow_dashboard')
);

drop policy if exists "purchase_orders_select_cashflow" on purchase_orders;
create policy "purchase_orders_select_cashflow" on purchase_orders for select using (
  has_section(auth.uid(), 'cashflow_dashboard')
);
