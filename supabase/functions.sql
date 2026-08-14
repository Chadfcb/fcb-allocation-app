-- FCB Distributor Allocation App — Database Functions
-- Run this AFTER schema.sql in the Supabase SQL editor.

-- =========================================================
-- classify_product_packaging / product_labels_per_case: server-side copies
-- of the exact same can/keg-size-from-name rules used by the app in
-- lib/packaging.ts (derivePackaging / computeConsumption). These exist so
-- start_new_week (below) can compute how much packaging/label inventory
-- was consumed by the previous week's allocations, without the app having
-- to be running. IMPORTANT: if the recipe or naming rules in
-- lib/packaging.ts ever change, these two must be updated to match, or the
-- carried-forward numbers will drift from what the app shows.
-- =========================================================
create or replace function classify_product_packaging(p_name text)
returns text
language sql
immutable
as $$
  select case
    when p_name ilike '%tap handle%' then 'tap_handle'
    when p_name ~* '1\s*/\s*2\s*bbl' then 'keg_1_2bbl'
    when p_name ~* '1\s*/\s*6\s*bbl' then 'keg_1_6bbl'
    when p_name ~* '19\.?2?\s*oz' then 'can_19_2oz'
    when p_name ~* '16\s*oz' then 'can_16oz'
    when p_name ~* '12\s*oz' then 'can_12oz'
    else 'unrecognized'
  end;
$$;

create or replace function product_labels_per_case(p_product_id uuid)
returns numeric
language sql
stable
as $$
  select case classify_product_packaging(p.name)
    when 'can_19_2oz' then 12
    when 'can_16oz' then 24
    when 'can_12oz' then 24
    else 0
  end
  from products p where p.id = p_product_id;
$$;

-- Total packaging consumed for a given week, one row per packaging item
-- key, following the same recipe as lib/packaging.ts's CAN_RECIPES/
-- KEG_ITEMS. Items with zero consumption simply don't appear in the result.
create or replace function packaging_consumed_for_week(p_week_id uuid)
returns table(item_key text, consumed numeric)
language sql
stable
as $$
  with product_totals as (
    select p.id as product_id,
           classify_product_packaging(p.name) as kind,
           coalesce(
             (select sum(a.quantity) from allocations a
              where a.week_id = p_week_id and a.product_id = p.id),
             0
           ) as qty
    from products p
    where p.active = true
  ),
  line_items as (
    select 'cans_19_2oz'::text as key, qty * 12 as amount from product_totals where kind = 'can_19_2oz'
    union all
    select 'trays_19oz', qty * 1 from product_totals where kind = 'can_19_2oz'
    union all
    select 'lids_202', qty * 12 from product_totals where kind = 'can_19_2oz'
    union all
    select 'cans_16oz', qty * 24 from product_totals where kind = 'can_16oz'
    union all
    select 'trays_12_16oz', qty * 1 from product_totals where kind = 'can_16oz'
    union all
    select 'pakteks_4pack', qty * 6 from product_totals where kind = 'can_16oz'
    union all
    select 'lids_202', qty * 24 from product_totals where kind = 'can_16oz'
    union all
    select 'cans_12oz', qty * 24 from product_totals where kind = 'can_12oz'
    union all
    select 'trays_12_16oz', qty * 1 from product_totals where kind = 'can_12oz'
    union all
    select 'pakteks_6pack', qty * 4 from product_totals where kind = 'can_12oz'
    union all
    select 'lids_202', qty * 24 from product_totals where kind = 'can_12oz'
    union all
    select 'kegs_1_2bbl', qty * 1 from product_totals where kind = 'keg_1_2bbl'
    union all
    select 'kegs_1_6bbl', qty * 1 from product_totals where kind = 'keg_1_6bbl'
  )
  select key, sum(amount) from line_items group by key;
$$;

-- =========================================================
-- start_new_week: creates a new week and automatically carries forward
-- remaining inventory from the previous week as the new week's opening
-- "on hand" balance — for regular product inventory, and for packaging &
-- label inventory (each floored at 0, same rule as the rest: a shortfall
-- doesn't carry as a negative number, it starts at 0 until restocked).
-- Unlabeled / to-be-packaged reset to 0 since those are new amounts you'll
-- add for the new week. Distributor inventory, allocations, and PO
-- numbers/status are NOT copied forward — those are fresh every week.
-- =========================================================
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

    insert into audit_log (week_id, table_name, record_id, field_name, old_value, new_value, changed_by)
    values (v_new_week_id, 'weeks', v_new_week_id, 'rollover_from', p_previous_week_id::text, v_new_week_id::text, p_created_by);
  end if;

  return v_new_week_id;
end;
$$;

-- =========================================================
-- undo_audit_entry: reverts a single audit_log entry by writing the
-- old_value back into the original field, then marks the entry reverted.
-- Only usable by admins (enforced by RLS on audit_log + this function
-- being security definer so it can still write to the target table).
-- =========================================================
create or replace function undo_audit_entry(p_audit_id uuid, p_reverted_by uuid)
returns void
language plpgsql
security definer
as $$
declare
  a record;
  v_col_type text;
begin
  select * into a from audit_log where id = p_audit_id and reverted = false;
  if not found then
    raise exception 'Audit entry not found or already reverted';
  end if;

  -- Only allow undo by an admin
  if not exists (select 1 from profiles p where p.id = p_reverted_by and p.role = 'admin') then
    raise exception 'Only admins can undo changes';
  end if;

  -- old_value/new_value are always stored as text in audit_log (so one
  -- column works for numeric, text, and uuid fields alike), so we look up
  -- the target column's real type here and cast back to it explicitly —
  -- otherwise writing a text value into a numeric/uuid column fails.
  select data_type into v_col_type
  from information_schema.columns
  where table_schema = 'public' and table_name = a.table_name and column_name = a.field_name;

  if v_col_type is null then
    raise exception 'Unknown column % on table %', a.field_name, a.table_name;
  end if;

  execute format('update %I set %I = $1::%s where id = $2', a.table_name, a.field_name, v_col_type)
    using a.old_value, a.record_id;

  update audit_log
  set reverted = true, reverted_at = now(), reverted_by = p_reverted_by
  where id = p_audit_id;
end;
$$;
