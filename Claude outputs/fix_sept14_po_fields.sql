-- Fixes the two fields that got silently wiped when the carry-forward data
-- was restored onto "Delivery Week of Sept 14th".
--
-- Why this happened: distributor_pos has a trigger
-- (enforce_po_status_admin_only) that only allows an admin (checked via
-- auth.uid()) to set po_status / delivery_date. The SQL Editor runs as the
-- database superuser with no logged-in user attached, so auth.uid() comes
-- back empty, the trigger decides "not an admin," and it quietly resets
-- those two fields back to blank instead of raising an error. That's why:
--   - SJSU's po_status came back blank instead of "approved"
--   - Superior's and Valley Wide's delivery dates came back blank
--
-- This script disables that one trigger just for this transaction, writes
-- the correct values back, then re-enables it before committing. Safe to
-- run once. Running it again is harmless (it just re-sets the same
-- values), but there's no need to run it twice.

begin;

alter table distributor_pos disable trigger enforce_po_status_admin_only_trigger;

update distributor_pos
set po_status = 'approved'
where week_id = '95e6aa3a-3e3b-4119-b271-d3dd0c31de65'
  and distributor_id = (select id from distributors where name = 'SJSU');

update distributor_pos
set delivery_date = '2026-09-18'
where week_id = '95e6aa3a-3e3b-4119-b271-d3dd0c31de65'
  and distributor_id = (select id from distributors where name = 'Superior');

update distributor_pos
set delivery_date = '2026-09-11'
where week_id = '95e6aa3a-3e3b-4119-b271-d3dd0c31de65'
  and distributor_id = (select id from distributors where name = 'Valley Wide');

alter table distributor_pos enable trigger enforce_po_status_admin_only_trigger;

commit;

-- Verify: should show SJSU/approved, Superior with 2026-09-18, Valley Wide
-- with 2026-09-11.
select d.name, dp.po_number, dp.po_status, dp.delivery_date
from distributor_pos dp
join distributors d on d.id = dp.distributor_id
where dp.week_id = '95e6aa3a-3e3b-4119-b271-d3dd0c31de65'
order by d.name;
