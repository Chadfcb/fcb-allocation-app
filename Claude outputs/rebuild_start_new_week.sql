-- Rebuilds start_new_week() to restore the distributor carry-forward
-- behavior described on the Weeks page itself:
--
--   "Any distributor whose purchase order hasn't been marked Delivered
--   carries forward too -- its allocation quantities, PO number, and
--   status all move to the new week unchanged... Once a distributor's PO
--   is marked Delivered, its order is complete: its allocation resets
--   fresh next week."
--
-- This logic existed live in the database at some point but was never in
-- any checked-in file, so it got silently dropped when the function was
-- last rebuilt from the stale copy in supabase/functions.sql (the fix for
-- the "Unknown column rollover_from" bug). This restores it, on top of
-- that fix, pulled from the function's CURRENT live source (verified via
-- pg_proc just before writing this), not the stale file.
--
-- Rules this uses, matching what we found in the data:
--   - A distributor is treated as "not delivered" if its po_status is
--     anything other than exactly 'delivered' -- including a blank/NULL
--     status (e.g. Superior, Valley Wide, Guardian, and the "Cans"
--     distributors all had no po_status set, and all still carry).
--   - A distributor with allocations but no distributor_pos row at all
--     (e.g. Guardian, Mussetter, Markstein Cans, Valley Wide Cans,
--     Matagrano Cans) still carries its allocations forward -- no PO row
--     existing is not the same as being delivered.
--   - Everything is copied unchanged: PO number, PO status, delivery
--     date, allocation quantity, and status flag.
--
-- This does NOT touch packaging_consumed_for_week() -- that function's
-- live numbers didn't match a direct calculation when we checked it, but
-- that's a separate, not-yet-diagnosed issue and rebuilding this function
-- doesn't fix or worsen it either way.

create or replace function start_new_week(
  p_label text,
  p_week_start date,
  p_previous_week_id uuid,
  p_created_by uuid
)
returns uuid
language plpgsql
security definer
as $$
declare
  v_new_week_id uuid;
  r record;
begin
  insert into weeks (label, week_start, previous_week_id, status, created_by)
  values (p_label, p_week_start, p_previous_week_id, 'open', p_created_by)
  returning id into v_new_week_id;

  if p_previous_week_id is not null then
    for r in
      select product_id, remaining
      from inventory_with_remaining
      where week_id = p_previous_week_id
    loop
      insert into inventory_snapshots (week_id, product_id, on_hand, unlabeled, to_be_packaged, updated_by)
      values (v_new_week_id, r.product_id, greatest(r.remaining, 0), 0, 0, p_created_by);
    end loop;

    for r in
      select pi.item_key, greatest(pi.on_hand_qty - coalesce(pc.consumed, 0), 0) as carry
      from packaging_inventory pi
      left join packaging_consumed_for_week(p_previous_week_id) pc on pc.item_key = pi.item_key
      where pi.week_id = p_previous_week_id
    loop
      insert into packaging_inventory (week_id, item_key, on_hand_qty, updated_by)
      values (v_new_week_id, r.item_key, r.carry, p_created_by);
    end loop;

    for r in
      select li.product_id,
             greatest(
               li.on_hand_qty - product_labels_per_case(li.product_id) * coalesce(
                 (select sum(a.quantity) from allocations a
                  where a.week_id = p_previous_week_id and a.product_id = li.product_id),
                 0
               ),
               0
             ) as carry
      from label_inventory li
      where li.week_id = p_previous_week_id
    loop
      insert into label_inventory (week_id, product_id, on_hand_qty, updated_by)
      values (v_new_week_id, r.product_id, r.carry, p_created_by);
    end loop;

    -- Carry forward PO number/status/delivery date for every distributor
    -- whose PO isn't marked Delivered.
    for r in
      select distributor_id, po_number, po_status, delivery_date
      from distributor_pos
      where week_id = p_previous_week_id
        and coalesce(po_status, '') <> 'delivered'
    loop
      insert into distributor_pos (week_id, distributor_id, po_number, po_status, delivery_date, updated_by)
      values (v_new_week_id, r.distributor_id, r.po_number, r.po_status, r.delivery_date, p_created_by);
    end loop;

    -- Carry forward allocation quantities for the same set of distributors
    -- -- including ones with no distributor_pos row at all, since no PO
    -- on file isn't the same as Delivered.
    for r in
      select a.distributor_id, a.product_id, a.quantity, a.status_flag
      from allocations a
      left join distributor_pos dp
        on dp.week_id = a.week_id and dp.distributor_id = a.distributor_id
      where a.week_id = p_previous_week_id
        and coalesce(dp.po_status, '') <> 'delivered'
    loop
      insert into allocations (week_id, distributor_id, product_id, quantity, status_flag, updated_by)
      values (v_new_week_id, r.distributor_id, r.product_id, r.quantity, r.status_flag, p_created_by);
    end loop;

    insert into audit_log (week_id, table_name, record_id, field_name, old_value, new_value, changed_by)
    values (v_new_week_id, 'weeks', v_new_week_id, 'previous_week_id', p_previous_week_id::text, v_new_week_id::text, p_created_by);
  end if;

  return v_new_week_id;
end;
$$;
