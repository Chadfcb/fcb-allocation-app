-- Lets an admin "lock" a distributor's column on Inventory & Allocation so
-- non-admin team members can't accidentally type a quantity into the wrong
-- distributor (Chad, 2026-09-08). Admins can still edit a locked
-- distributor's cells themselves — this only blocks everyone else.
--
-- Idempotent — safe to run again.
alter table distributors
  add column if not exists allocations_locked boolean not null default false;

comment on column distributors.allocations_locked is
  'When true, only admins can edit this distributor''s quantity cells on Inventory & Allocation. Everyone else sees the column but can''t type into it.';
