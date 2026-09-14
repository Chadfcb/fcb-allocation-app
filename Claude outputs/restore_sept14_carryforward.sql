-- Restores the distributor orders that should have carried forward from
-- "Delivery Week of Sept 7th" into "Delivery Week of Sept 14th" (the new
-- week), for every distributor whose PO was NOT marked Delivered.
--
-- Markstein and Matagrano are excluded on purpose -- both were correctly
-- marked Delivered on Sept 7th, so they reset fresh, as intended.
-- Saccani is excluded on purpose -- it has 7 allocation rows on Sept 7th
-- but every one is quantity 0 with no status set, i.e. no real order to
-- carry forward.
--
-- Carried forward as-is: Guardian, SJSU (PO 2086, approved), Superior,
-- Valley Wide, Mussetter, Markstein Cans, Matagrano Cans.
--
-- Both target tables are currently empty for this week (verified before
-- writing this), so this is a plain insert -- nothing to overwrite, no
-- conflict with the unique (week_id, distributor_id[, product_id]) keys.
-- Safe to run once. Do not run twice -- running it again would duplicate
-- every row (there's no existing-row check, since none were expected to
-- exist yet).

insert into distributor_pos (week_id, distributor_id, po_number, po_status, delivery_date, updated_by)
select
  '95e6aa3a-3e3b-4119-b271-d3dd0c31de65',
  dp.distributor_id,
  dp.po_number,
  dp.po_status,
  dp.delivery_date,
  dp.updated_by
from distributor_pos dp
join distributors d on d.id = dp.distributor_id
where dp.week_id = '6682a239-cd1f-4d2f-adf4-263f38e3d51c'
  and d.name not in ('Markstein', 'Matagrano', 'Saccani');

insert into allocations (week_id, distributor_id, product_id, quantity, status_flag, updated_by)
select
  '95e6aa3a-3e3b-4119-b271-d3dd0c31de65',
  a.distributor_id,
  a.product_id,
  a.quantity,
  a.status_flag,
  a.updated_by
from allocations a
join distributors d on d.id = a.distributor_id
where a.week_id = '6682a239-cd1f-4d2f-adf4-263f38e3d51c'
  and d.name not in ('Markstein', 'Matagrano', 'Saccani');
