-- FCB Distributor Allocation App — Database Functions
-- Run this AFTER schema.sql in the Supabase SQL editor.

-- =========================================================
-- start_new_week: creates a new week and automatically carries forward
-- remaining inventory from the previous week as the new week's opening
-- "on hand" balance. Unlabeled / to-be-packaged reset to 0 since those
-- are new amounts you'll add for the new week. Distributor inventory and
-- allocations are NOT copied forward — those are fresh every week.
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
