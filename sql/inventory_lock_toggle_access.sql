-- Lets any Basic/Employee user granted Inventory & Allocation lock/unlock a
-- distributor themselves, added 2026-09-09 per Chad: "basics need the
-- ability to lock and unlock if they have access to this section." Until
-- now the lock toggle (components/... app/(app)/inventory/page.tsx) was
-- admin-only in the UI, AND the database itself only ever let role='admin'
-- write to the distributors table at all (see distributors_write_admin) —
-- so even flipping the UI gate alone wouldn't have been enough; a non-admin
-- user's click would have silently failed to save.
--
-- Note: `distributors.allocations_locked` is re-declared here with
-- `add column if not exists` as a safety net — the column already exists in
-- the live database (the lock feature has been working for admins since
-- 2026-09-08), but the migration that originally added it was never found
-- in this project's sql/ folder or supabase/schema.sql, so there's no
-- record of it to point to. This line is a no-op if the column is already
-- there; it exists purely so this file is a complete, self-contained
-- migration going forward.
--
-- Idempotent — safe to run more than once.

alter table distributors
  add column if not exists allocations_locked boolean not null default false;

-- Additive: anyone with the inventory_allocation section can now update a
-- distributor row (needed to flip allocations_locked). Same lighter-touch
-- pattern already used for distributors_write_finance (payment_terms_days)
-- — it doesn't add a column-level trigger restricting exactly which field
-- changes, matching how that policy works today. In practice the app's own
-- UI only ever sends `{ allocations_locked }` in this update call.
drop policy if exists "distributors_write_inventory_lock" on distributors;
create policy "distributors_write_inventory_lock" on distributors for update
  using (has_section(auth.uid(), 'inventory_allocation'))
  with check (has_section(auth.uid(), 'inventory_allocation'));
