-- Fixes the "Unknown column rollover_from on table weeks" bug.
--
-- start_new_week() was logging the new-week audit entry with
-- field_name = 'rollover_from', but the weeks table has no such column
-- (the real column is previous_week_id). That mismatch is why the Audit
-- Log's Undo button failed on any "started a new week" entry.
--
-- This is idempotent — safe to run any time, including if it's ever run
-- twice. Run this in Supabase's SQL Editor before anything else.

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

    -- Fixed: field_name is now 'previous_week_id' (the real column on
    -- weeks), not the nonexistent 'rollover_from'.
    insert into audit_log (week_id, table_name, record_id, field_name, old_value, new_value, changed_by)
    values (v_new_week_id, 'weeks', v_new_week_id, 'previous_week_id', p_previous_week_id::text, v_new_week_id::text, p_created_by);
  end if;

  return v_new_week_id;
end;
$$;
