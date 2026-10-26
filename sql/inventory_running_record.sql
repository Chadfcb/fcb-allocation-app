-- Our Inventory — running record (Inventory & Allocation) — added 2026-10-26.
-- Plan: claude/ekos-packaging-inventory-plan.md (project). Starting count:
-- claude/inventory-starting-count-2026-10-26.md.
--
-- What this does, in plain English:
--   * Our beer On Hand is no longer typed in each week. It's a running record:
--       last physical count
--       + what Ekos says was packaged since (read every morning, "Ekos — Packaging")
--       − orders marked Delivered since (automatic, from the PO status)
--       − "Other out" (taproom / samples / breakage / dumped, entered on the page)
--     The newest week's On Hand and Unlabeled columns are filled from the record
--     automatically and can't be typed over.
--   * Unlabeled beer: Ekos items ending in "Unlabeled" add to Unlabeled instead.
--     "Labeled" on the page moves cases from Unlabeled to On Hand.
--   * Supplies (Chad, 2026-10-26: "when we package something off a tank, we
--     actually use those items in reality"): cans, lids, trays, Pak-Techs,
--     labels and kegs now come off when Ekos says something was packaged —
--     NOT when orders are delivered (that would count them twice).
--     Unlabeled runs use cans, lids and trays; labels and Pak-Techs come off
--     when the cases are marked Labeled.
--   * Count Differences: every count is saved with what the record said at
--     that moment, so drift shows instead of disappearing.
--   * Only weeks from 10/26/2026 on work this way (weeks.uses_record). Older
--     weeks keep their old numbers and old math.
--   * Loads the starting count (10/26/2026, Matagrano's order already taken
--     out) and adds the "Spartan (Keg - 1/2 bbl)" product.
--
-- Run this in Supabase's SQL Editor BEFORE pushing the code. Idempotent — safe
-- to run more than once (the starting count is only loaded the first time).
-- Every DELETE/UPDATE has a WHERE (Supabase's safeupdate blocks them otherwise).

-- ---------------------------------------------------------------------------
-- 1. Which weeks use the record
-- ---------------------------------------------------------------------------
alter table public.weeks add column if not exists uses_record boolean not null default true;

-- Weeks before the record started keep the old math. (Only touches weeks
-- still marked true, so a rerun changes nothing.)
update public.weeks set uses_record = false
 where week_start < date '2026-10-26' and uses_record;

comment on column public.weeks.uses_record is
  'True for weeks from 10/26/2026 on: our beer On Hand / Unlabeled come from the running record (inventory_moves + Ekos packaging), and supplies come off at packaging instead of at delivery.';

-- First day whose Ekos packaging counts (the day after the first count).
create or replace function public.inventory_record_start()
returns date language sql immutable as $$ select date '2026-10-27' $$;

comment on function public.inventory_record_start() is
  '[hidden] First day whose Ekos packaging runs count toward the running inventory record.';

create or replace function public.ekos_norm(t text)
returns text language sql immutable as $$ select regexp_replace(btrim(coalesce(t, '')), '\s+', ' ', 'g') $$;

comment on function public.ekos_norm(text) is '[hidden] Trims and collapses spaces so Ekos names match the Ekos name list.';

-- ---------------------------------------------------------------------------
-- 2. Ekos packaging runs (written by the "Ekos — Packaging" sync only)
-- ---------------------------------------------------------------------------
create table if not exists public.ekos_packaging (
  task_rowguid text primary key,
  batch_guid text,
  batch_title text,
  item_title text not null,
  type_title text,
  status_title text,
  packaged_on date,
  units numeric not null default 0,
  wip_bbl numeric,
  is_planned boolean not null default false,
  first_seen_at timestamptz not null default now(),
  synced_at timestamptz not null default now()
);

create index if not exists ekos_packaging_packaged_on_idx on public.ekos_packaging (packaged_on);

alter table public.ekos_packaging enable row level security;

drop policy if exists "ekos_packaging_select" on public.ekos_packaging;
create policy "ekos_packaging_select" on public.ekos_packaging
  for select using (public.has_section(auth.uid(), 'inventory_allocation'));

grant select on public.ekos_packaging to authenticated;
grant select, insert, update, delete on public.ekos_packaging to service_role;

comment on table public.ekos_packaging is
  'Every packaging run Ekos shows on a batch (cases or kegs packaged off a tank): batch, Ekos item name, date, how many, status. Read each morning by the "Ekos — Packaging" sync. Use for "what did we package / can / keg on <date>". Only status Completed counts. Matched to app products through the Ekos name list (ekos_name_map, kind item); names ending in "Unlabeled" are unlabeled cases.';

-- Each run matched to an app product (through the Ekos name list).
create or replace view public.ekos_packaging_mapped with (security_invoker = on) as
select
  e.task_rowguid,
  e.batch_title,
  e.item_title,
  e.packaged_on,
  e.units,
  e.status_title,
  e.is_planned,
  (e.item_title ~* 'unlabel') as unlabeled,
  p.id as product_id,
  p.name as product_name,
  coalesce(n.skip, false) as skipped,
  (n.ekos_name is null or (n.app_name is null and not n.skip)) as needs_decision
from public.ekos_packaging e
left join lateral (
  select m.ekos_name, m.app_name, m.skip
  from public.ekos_name_map m
  where m.kind = 'item' and public.ekos_norm(m.ekos_name) = public.ekos_norm(e.item_title)
  order by (m.app_name is not null) desc, m.skip desc
  limit 1
) n on true
left join public.products p on p.name = n.app_name and not coalesce(n.skip, false);

comment on view public.ekos_packaging_mapped is
  'Ekos packaging runs matched to app products (product_id empty = not on the Ekos name list yet, or skipped). unlabeled = the Ekos item is an Unlabeled item.';

grant select on public.ekos_packaging_mapped to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 3. The running record
-- ---------------------------------------------------------------------------
create table if not exists public.inventory_moves (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references public.products(id) on delete cascade,
  bucket text not null default 'labeled' check (bucket in ('labeled', 'unlabeled')),
  kind text not null check (kind in ('count', 'delivered', 'undelivered', 'other_out', 'other_out_undo', 'labeled')),
  qty numeric not null,
  record_qty numeric,          -- count only: what the record said right before the count
  packaging_from date,         -- count only: first day whose Ekos packaging adds on top of it
  happened_at timestamptz not null default now(),
  week_id uuid references public.weeks(id) on delete cascade,
  distributor_id uuid references public.distributors(id) on delete set null,
  distributor_po_id uuid references public.distributor_pos(id) on delete set null,
  po_number text,
  reason text,
  note text,
  reverses_id uuid references public.inventory_moves(id) on delete set null,
  group_id uuid,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);

create index if not exists inventory_moves_product_idx on public.inventory_moves (product_id, bucket, happened_at);
create index if not exists inventory_moves_week_dist_idx on public.inventory_moves (week_id, distributor_id);

alter table public.inventory_moves enable row level security;

drop policy if exists "inventory_moves_select" on public.inventory_moves;
create policy "inventory_moves_select" on public.inventory_moves
  for select using (public.has_section(auth.uid(), 'inventory_allocation'));

-- People add counts / Other out / Labeled from the page. Delivered entries
-- are written by the PO trigger below, not by people.
drop policy if exists "inventory_moves_insert" on public.inventory_moves;
create policy "inventory_moves_insert" on public.inventory_moves
  for insert with check (
    public.has_section(auth.uid(), 'inventory_allocation')
    and kind in ('count', 'other_out', 'other_out_undo', 'labeled')
  );

grant select, insert on public.inventory_moves to authenticated;
grant select, insert, update, delete on public.inventory_moves to service_role;

comment on table public.inventory_moves is
  'FCB''s running record of our own beer inventory (Inventory & Allocation, weeks from 10/26/2026 on). One row per change: count (physical count — qty is the level counted, record_qty what the record said), delivered / undelivered (a PO marked Delivered or un-marked — qty negative / positive), other_out / other_out_undo (taproom, samples, breakage, dumped — reason), labeled (unlabeled cases labeled: one row −qty unlabeled, one row +qty labeled). Cases for cans, kegs for kegs. On hand = last count + Ekos packaging since + these entries since. Use for "where did our beer go", "what did we count", "count differences".';

-- Entries are never changed — mistakes are fixed with a new entry (Undo on
-- the page). This also stops the Audit Log's Undo from half-changing one.
-- (Links to a deleted PO / distributor / entry may still be cleared by the
-- database itself.)
create or replace function public.inventory_moves_no_update()
returns trigger language plpgsql as $$
begin
  if (new.product_id, new.bucket, new.kind, new.qty, new.record_qty, new.packaging_from, new.happened_at, new.reason, new.note)
     is distinct from
     (old.product_id, old.bucket, old.kind, old.qty, old.record_qty, old.packaging_from, old.happened_at, old.reason, old.note) then
    raise exception 'Inventory record entries can''t be changed — use Undo on the Inventory & Allocation page.';
  end if;
  return new;
end;
$$;

drop trigger if exists inventory_moves_no_update on public.inventory_moves;
create trigger inventory_moves_no_update before update on public.inventory_moves
  for each row execute function public.inventory_moves_no_update();

-- ---------------------------------------------------------------------------
-- 4. Levels
-- ---------------------------------------------------------------------------
-- One product, one bucket ('labeled' = On Hand, 'unlabeled' = Unlabeled).
create or replace function public.inventory_record_level(p_product uuid, p_bucket text)
returns numeric
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  c record;
  v_start date := public.inventory_record_start();
  v numeric;
begin
  select m.qty, m.happened_at, m.created_at, coalesce(m.packaging_from, v_start) as pf
    into c
    from public.inventory_moves m
   where m.product_id = p_product and m.bucket = p_bucket and m.kind = 'count'
   order by m.happened_at desc, m.created_at desc
   limit 1;

  v := coalesce(c.qty, 0);

  v := v + coalesce((
    select sum(m.qty) from public.inventory_moves m
     where m.product_id = p_product and m.bucket = p_bucket and m.kind <> 'count'
       and (c.happened_at is null or (m.happened_at, m.created_at) > (c.happened_at, c.created_at))
  ), 0);

  v := v + coalesce((
    select sum(e.units) from public.ekos_packaging_mapped e
     where e.product_id = p_product
       and e.unlabeled = (p_bucket = 'unlabeled')
       and e.status_title ilike 'completed'
       and not e.is_planned
       and e.packaged_on >= greatest(coalesce(c.pf, v_start), v_start)
  ), 0);

  return v;
end;
$$;

comment on function public.inventory_record_level(uuid, text) is
  '[hidden] Running-record level for one product: bucket labeled = On Hand, unlabeled = Unlabeled.';

revoke all on function public.inventory_record_level(uuid, text) from public, anon;
grant execute on function public.inventory_record_level(uuid, text) to authenticated, service_role;

-- Every active product: On Hand, Unlabeled, and the last count.
create or replace function public.inventory_record_levels()
returns table(product_id uuid, on_hand numeric, unlabeled numeric, last_count_at timestamptz)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if auth.uid() is not null and not public.has_section(auth.uid(), 'inventory_allocation') then
    raise exception 'No access to Inventory & Allocation.';
  end if;
  return query
    select p.id,
           public.inventory_record_level(p.id, 'labeled'),
           public.inventory_record_level(p.id, 'unlabeled'),
           (select max(m.happened_at) from public.inventory_moves m where m.product_id = p.id and m.kind = 'count')
      from public.products p
     where p.active;
end;
$$;

comment on function public.inventory_record_levels() is
  'Our beer inventory right now from the running record, every active product: on_hand (labeled cases / kegs), unlabeled, and when it was last counted.';

revoke all on function public.inventory_record_levels() from public, anon;
grant execute on function public.inventory_record_levels() to authenticated, service_role;

-- Before a new entry is saved: a count remembers what the record said
-- (Count Differences) and when its Ekos packaging starts; who made it.
create or replace function public.inventory_moves_before_insert()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.created_by is null then new.created_by := auth.uid(); end if;
  if new.kind = 'count' then
    if new.record_qty is null then
      new.record_qty := public.inventory_record_level(new.product_id, new.bucket);
    end if;
    if new.packaging_from is null then
      new.packaging_from := (new.happened_at at time zone 'America/Los_Angeles')::date;
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists inventory_moves_before_insert on public.inventory_moves;
create trigger inventory_moves_before_insert before insert on public.inventory_moves
  for each row execute function public.inventory_moves_before_insert();

-- ---------------------------------------------------------------------------
-- 5. Keep the newest week's On Hand / Unlabeled equal to the record
-- ---------------------------------------------------------------------------
create or replace function public.inventory_is_record_week(p_week uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.weeks w
     where w.id = p_week and w.uses_record
       and w.week_start = (select max(x.week_start) from public.weeks x)
  );
$$;

comment on function public.inventory_is_record_week(uuid) is '[hidden] True when the week is the newest week and uses the running record.';

create or replace function public.inventory_snapshot_from_record()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if public.inventory_is_record_week(new.week_id) then
    new.on_hand := public.inventory_record_level(new.product_id, 'labeled');
    new.unlabeled := public.inventory_record_level(new.product_id, 'unlabeled');
  end if;
  return new;
end;
$$;

drop trigger if exists inventory_snapshot_from_record on public.inventory_snapshots;
create trigger inventory_snapshot_from_record before insert or update on public.inventory_snapshots
  for each row execute function public.inventory_snapshot_from_record();

create or replace function public.inventory_record_refresh()
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_week uuid;
begin
  select w.id into v_week from public.weeks w order by w.week_start desc limit 1;
  if v_week is null or not public.inventory_is_record_week(v_week) then
    return;
  end if;

  insert into public.inventory_snapshots (week_id, product_id, on_hand, unlabeled, to_be_packaged)
  select v_week, p.id, 0, 0, 0
    from public.products p
   where p.active
     and not exists (select 1 from public.inventory_snapshots s where s.week_id = v_week and s.product_id = p.id);

  -- The before-update trigger above fills in the record's numbers.
  -- (updated_by cleared so everyone's open page picks up the change live.)
  update public.inventory_snapshots s
     set updated_at = now(), updated_by = null
   where s.week_id = v_week
     and (s.on_hand, s.unlabeled) is distinct from
         (public.inventory_record_level(s.product_id, 'labeled'), public.inventory_record_level(s.product_id, 'unlabeled'));
end;
$$;

comment on function public.inventory_record_refresh() is '[hidden] Copies the running record into the newest week''s On Hand / Unlabeled.';

revoke all on function public.inventory_record_refresh() from public, anon, authenticated;
grant execute on function public.inventory_record_refresh() to service_role;

create or replace function public.inventory_record_refresh_trigger()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform public.inventory_record_refresh();
  return null;
end;
$$;

drop trigger if exists inventory_moves_refresh on public.inventory_moves;
create trigger inventory_moves_refresh after insert or update or delete on public.inventory_moves
  for each statement execute function public.inventory_record_refresh_trigger();

drop trigger if exists ekos_packaging_refresh on public.ekos_packaging;
create trigger ekos_packaging_refresh after insert or update or delete on public.ekos_packaging
  for each statement execute function public.inventory_record_refresh_trigger();

drop trigger if exists ekos_name_map_refresh on public.ekos_name_map;
create trigger ekos_name_map_refresh after insert or update or delete on public.ekos_name_map
  for each statement execute function public.inventory_record_refresh_trigger();

-- ---------------------------------------------------------------------------
-- 6. Delivered orders come off the record (and go back if un-marked)
-- ---------------------------------------------------------------------------
-- Makes the record's entries for one week + distributor match its order:
-- PO Delivered → −allocation for every product; not Delivered → nothing.
-- Also fixes itself if an allocation changes after the PO was delivered.
create or replace function public.inventory_sync_delivered(p_week uuid, p_dist uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_po record;
  v_delivered boolean;
begin
  if not exists (select 1 from public.weeks w where w.id = p_week and w.uses_record) then
    return;
  end if;

  select dp.id, dp.po_number, dp.po_status into v_po
    from public.distributor_pos dp
   where dp.week_id = p_week and dp.distributor_id = p_dist
   limit 1;
  v_delivered := coalesce(v_po.po_status, '') = 'delivered';

  -- One insert for the whole order (so the record refreshes once).
  insert into public.inventory_moves
    (product_id, bucket, kind, qty, week_id, distributor_id, distributor_po_id, po_number, created_by)
  select d.product_id, 'labeled', case when d.diff < 0 then 'delivered' else 'undelivered' end,
         d.diff, p_week, p_dist, v_po.id, v_po.po_number, auth.uid()
    from (
      with t as (
        select a.product_id,
               case when v_delivered then -coalesce(sum(a.quantity), 0) else 0 end as target
          from public.allocations a
         where a.week_id = p_week and a.distributor_id = p_dist
         group by a.product_id
      ), c as (
        select m.product_id, sum(m.qty) as cur
          from public.inventory_moves m
         where m.week_id = p_week and m.distributor_id = p_dist and m.kind in ('delivered', 'undelivered')
         group by m.product_id
      )
      select coalesce(t.product_id, c.product_id) as product_id,
             coalesce(t.target, 0) - coalesce(c.cur, 0) as diff
        from t full join c on c.product_id = t.product_id
    ) d
   where d.diff <> 0;
end;
$$;

comment on function public.inventory_sync_delivered(uuid, uuid) is '[hidden] Writes Delivered / un-Delivered entries in the running record for one week + distributor.';

revoke all on function public.inventory_sync_delivered(uuid, uuid) from public, anon, authenticated;
grant execute on function public.inventory_sync_delivered(uuid, uuid) to service_role;

create or replace function public.inventory_po_status_changed()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform public.inventory_sync_delivered(new.week_id, new.distributor_id);
  return null;
end;
$$;

drop trigger if exists inventory_po_status_changed on public.distributor_pos;
create trigger inventory_po_status_changed after insert or update of po_status on public.distributor_pos
  for each row execute function public.inventory_po_status_changed();

create or replace function public.inventory_allocation_changed()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_week uuid := coalesce(new.week_id, old.week_id);
  v_dist uuid := coalesce(new.distributor_id, old.distributor_id);
begin
  -- A week being deleted takes its allocations with it — leave the record alone.
  if not exists (select 1 from public.weeks w where w.id = v_week) then
    return null;
  end if;
  if exists (select 1 from public.distributor_pos dp
              where dp.week_id = v_week and dp.distributor_id = v_dist and dp.po_status = 'delivered')
     or exists (select 1 from public.inventory_moves m
                 where m.week_id = v_week and m.distributor_id = v_dist and m.kind in ('delivered', 'undelivered')) then
    perform public.inventory_sync_delivered(v_week, v_dist);
  end if;
  return null;
end;
$$;

drop trigger if exists inventory_allocation_changed on public.allocations;
create trigger inventory_allocation_changed after insert or update or delete on public.allocations
  for each row execute function public.inventory_allocation_changed();

-- ---------------------------------------------------------------------------
-- 7. Remaining = On Hand + Unlabeled − orders not delivered yet (record weeks)
--    ("To be packaged" is info only once packaging syncs — Chad, 2026-10-23.)
-- ---------------------------------------------------------------------------
create or replace view public.inventory_with_remaining with (security_invoker = on) as
select
  s.id,
  s.week_id,
  s.product_id,
  s.on_hand,
  s.unlabeled,
  s.to_be_packaged,
  (s.on_hand + s.unlabeled + case when coalesce(w.uses_record, false) then 0 else s.to_be_packaged end) as total,
  (s.on_hand + s.unlabeled + case when coalesce(w.uses_record, false) then 0 else s.to_be_packaged end)
    - coalesce((
        select sum(a.quantity) from public.allocations a
         where a.week_id = s.week_id and a.product_id = s.product_id
           and (not coalesce(w.uses_record, false)
                or not exists (select 1 from public.distributor_pos dp
                                where dp.week_id = a.week_id and dp.distributor_id = a.distributor_id
                                  and dp.po_status = 'delivered'))
      ), 0)
    as remaining,
  s.status_flag,
  s.updated_by,
  s.updated_at
from public.inventory_snapshots s
left join public.weeks w on w.id = s.week_id;

comment on view public.inventory_with_remaining is
  'Same as inventory_snapshots plus total and remaining. Weeks from 10/26/2026 on (weeks.uses_record): on_hand / unlabeled come from the running record, total = on_hand + unlabeled, remaining = total minus orders not delivered yet (delivered orders are already out of on_hand). Older weeks: total = on_hand + unlabeled + to_be_packaged, remaining = total minus everything allocated that week.';

-- ---------------------------------------------------------------------------
-- 8. Supplies used by packaging (record weeks)
-- ---------------------------------------------------------------------------
create or replace function public.inventory_supplies_used(p_week uuid)
returns table(kind text, item_key text, product_id uuid, used numeric)
language sql
stable
security definer
set search_path = ''
as $$
  with w as (
    select w.week_start,
           (select min(n.week_start) from public.weeks n where n.week_start > w.week_start) as next_start
      from public.weeks w
     where w.id = p_week and w.uses_record
  ),
  runs as (
    select e.product_id, e.unlabeled, sum(e.units) as qty
      from public.ekos_packaging_mapped e, w
     where e.product_id is not null
       and e.status_title ilike 'completed'
       and not e.is_planned
       and e.packaged_on >= greatest(w.week_start, public.inventory_record_start())
       and (w.next_start is null or e.packaged_on < w.next_start)
     group by e.product_id, e.unlabeled
  ),
  lab as (
    select m.product_id, sum(m.qty) as qty
      from public.inventory_moves m, w
     where m.kind = 'labeled' and m.bucket = 'labeled'
       and (m.happened_at at time zone 'America/Los_Angeles')::date >= w.week_start
       and (w.next_start is null or (m.happened_at at time zone 'America/Los_Angeles')::date < w.next_start)
     group by m.product_id
  ),
  k as (
    select r.product_id, r.unlabeled, r.qty, public.classify_product_packaging(p.name) as pk
      from runs r join public.products p on p.id = r.product_id
  ),
  lk as (
    select l.product_id, l.qty, public.classify_product_packaging(p.name) as pk
      from lab l join public.products p on p.id = l.product_id
  ),
  lines as (
    select 'cans_19_2oz'::text as key, null::uuid as pid, qty * 12 as amt from k where pk = 'can_19_2oz'
    union all select 'trays_19oz', null, qty from k where pk = 'can_19_2oz'
    union all select 'lids_202', null, qty * 12 from k where pk = 'can_19_2oz'
    union all select 'cans_16oz', null, qty * 24 from k where pk = 'can_16oz'
    union all select 'trays_12_16oz', null, qty from k where pk = 'can_16oz'
    union all select 'lids_202', null, qty * 24 from k where pk = 'can_16oz'
    union all select 'cans_12oz', null, qty * 24 from k where pk = 'can_12oz'
    union all select 'trays_12_16oz', null, qty from k where pk = 'can_12oz'
    union all select 'lids_202', null, qty * 24 from k where pk = 'can_12oz'
    union all select 'kegs_1_2bbl', null, qty from k where pk = 'keg_1_2bbl'
    union all select 'kegs_1_6bbl', null, qty from k where pk = 'keg_1_6bbl'
    -- labeled runs: Pak-Techs + labels at packaging
    union all select 'pakteks_4pack', null, qty * 6 from k where pk = 'can_16oz' and not unlabeled
    union all select 'pakteks_6pack', null, qty * 4 from k where pk = 'can_12oz' and not unlabeled
    union all select 'label', product_id, qty * (case pk when 'can_19_2oz' then 12 else 24 end)
                from k where pk like 'can%' and not unlabeled
    -- unlabeled cases labeled later: Pak-Techs + labels then
    union all select 'pakteks_4pack', null, qty * 6 from lk where pk = 'can_16oz'
    union all select 'pakteks_6pack', null, qty * 4 from lk where pk = 'can_12oz'
    union all select 'label', product_id, qty * (case pk when 'can_19_2oz' then 12 else 24 end)
                from lk where pk like 'can%'
  )
  select case when key = 'label' then 'label' else 'packaging' end,
         case when key = 'label' then null else key end,
         pid,
         sum(amt)
    from lines
   group by 1, 2, 3;
$$;

comment on function public.inventory_supplies_used(uuid) is
  'Supplies used by packaging in a week (weeks from 10/26/2026 on): kind packaging → item_key (cans_16oz, lids_202, trays_19oz, pakteks_4pack, kegs_1_2bbl …) and used; kind label → product_id and labels used. From Ekos packaging runs (and cases marked Labeled).';

revoke all on function public.inventory_supplies_used(uuid) from public, anon;
grant execute on function public.inventory_supplies_used(uuid) to authenticated, service_role;

-- The old rule (supplies come off when an order is Delivered) — kept for
-- weeks before the record.
create or replace function public.packaging_consumed_by_orders(p_week_id uuid)
returns table(item_key text, consumed numeric)
language sql
stable
set search_path = ''
as $$
  with product_totals as (
    select p.id as product_id,
           public.classify_product_packaging(p.name) as kind,
           coalesce(
             (select sum(a.quantity) from public.allocations a
                join public.distributor_pos dp
                  on dp.week_id = a.week_id and dp.distributor_id = a.distributor_id
               where a.week_id = p_week_id and a.product_id = p.id
                 and dp.po_status = 'delivered'),
             0
           ) as qty
    from public.products p
    where p.active = true
  ),
  line_items as (
    select 'cans_19_2oz'::text as key, qty * 12 as amount from product_totals where kind = 'can_19_2oz'
    union all select 'trays_19oz', qty * 1 from product_totals where kind = 'can_19_2oz'
    union all select 'lids_202', qty * 12 from product_totals where kind = 'can_19_2oz'
    union all select 'cans_16oz', qty * 24 from product_totals where kind = 'can_16oz'
    union all select 'trays_12_16oz', qty * 1 from product_totals where kind = 'can_16oz'
    union all select 'pakteks_4pack', qty * 6 from product_totals where kind = 'can_16oz'
    union all select 'lids_202', qty * 24 from product_totals where kind = 'can_16oz'
    union all select 'cans_12oz', qty * 24 from product_totals where kind = 'can_12oz'
    union all select 'trays_12_16oz', qty * 1 from product_totals where kind = 'can_12oz'
    union all select 'pakteks_6pack', qty * 4 from product_totals where kind = 'can_12oz'
    union all select 'lids_202', qty * 24 from product_totals where kind = 'can_12oz'
    union all select 'kegs_1_2bbl', qty * 1 from product_totals where kind = 'keg_1_2bbl'
    union all select 'kegs_1_6bbl', qty * 1 from product_totals where kind = 'keg_1_6bbl'
  )
  select key, sum(amount) from line_items group by key;
$$;

comment on function public.packaging_consumed_by_orders(uuid) is '[hidden] Old rule for weeks before 10/26/2026: packaging used by Delivered orders.';

-- What Start New Week carries forward uses this: record weeks → packaging,
-- older weeks → Delivered orders (same as before).
create or replace function public.packaging_consumed_for_week(p_week_id uuid)
returns table(item_key text, consumed numeric)
language sql
stable
set search_path = ''
as $$
  select u.item_key, u.used
    from public.inventory_supplies_used(p_week_id) u
   where u.kind = 'packaging'
     and exists (select 1 from public.weeks w where w.id = p_week_id and w.uses_record)
  union all
  select o.item_key, o.consumed
    from public.packaging_consumed_by_orders(p_week_id) o
   where not exists (select 1 from public.weeks w where w.id = p_week_id and w.uses_record);
$$;

create or replace function public.label_consumed_for_week(p_week_id uuid)
returns table(product_id uuid, consumed numeric)
language sql
stable
set search_path = ''
as $$
  select u.product_id, u.used
    from public.inventory_supplies_used(p_week_id) u
   where u.kind = 'label'
     and exists (select 1 from public.weeks w where w.id = p_week_id and w.uses_record)
  union all
  select a.product_id,
         (case public.classify_product_packaging(p.name)
            when 'can_19_2oz' then 12 when 'can_16oz' then 24 when 'can_12oz' then 24 else 0 end) * sum(a.quantity)
    from public.allocations a
    join public.products p on p.id = a.product_id
   where a.week_id = p_week_id
     and not exists (select 1 from public.weeks w where w.id = p_week_id and w.uses_record)
   group by a.product_id, p.name;
$$;

comment on function public.label_consumed_for_week(uuid) is '[hidden] Labels used in a week (record weeks: by packaging; older weeks: by allocations, as before).';

-- Start New Week: same as the live function (pulled from the database
-- 2026-10-26), except labels carried forward now use label_consumed_for_week.
create or replace function public.start_new_week_core(p_label text, p_week_start date, p_previous_week_id uuid, p_created_by uuid)
returns uuid
language plpgsql
security definer
as $function$
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
             greatest(li.on_hand_qty - coalesce(lc.consumed, 0), 0) as carry
      from label_inventory li
      left join label_consumed_for_week(p_previous_week_id) lc on lc.product_id = li.product_id
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

  -- New: the new week's beer comes from the running record.
  perform public.inventory_record_refresh();

  return v_new_week_id;
end;
$function$;

-- Packaging runs for the page's Activity list (the Ekos name list is admin-only,
-- so the page reads runs through this).
create or replace function public.inventory_packaging_runs(p_from date)
returns table(task_rowguid text, batch_title text, item_title text, packaged_on date, units numeric,
              status_title text, unlabeled boolean, product_id uuid, needs_decision boolean, skipped boolean)
language sql
stable
security definer
set search_path = ''
as $$
  select e.task_rowguid, e.batch_title, e.item_title, e.packaged_on, e.units, e.status_title,
         e.unlabeled, e.product_id, e.needs_decision, e.skipped
    from public.ekos_packaging_mapped e
   where e.packaged_on >= p_from and not e.is_planned
     and (auth.uid() is null or public.has_section(auth.uid(), 'inventory_allocation'))
   order by e.packaged_on desc, e.batch_title;
$$;

comment on function public.inventory_packaging_runs(date) is
  'Ekos packaging runs from a date on, matched to app products (product_id empty + needs_decision = the Ekos item name isn''t on the Ekos name list yet).';

revoke all on function public.inventory_packaging_runs(date) from public, anon;
grant execute on function public.inventory_packaging_runs(date) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 9. Ekos — Packaging sync source + Ekos packaging item names
--    (read from Ekos 2026-10-26, the 25 newest batches)
-- ---------------------------------------------------------------------------
insert into public.sync_sources (key, label, enabled, sort_order) values
  ('ekos_packaging', 'Ekos — Packaging', true, 4)
on conflict (key) do nothing;

-- Spartan half-barrel kegs (Chad's count, 10/26) — slotted right after the
-- Spartan cases.
insert into public.products (name, active, sort_order)
select 'Spartan (Keg - 1/2 bbl)', true,
       (select s.sort_order + 0.01 from public.products s where s.name = 'Spartan (cases - 12oz - cans)')
where not exists (select 1 from public.products p where p.name = 'Spartan (Keg - 1/2 bbl)');

insert into public.ekos_name_map (kind, ekos_name, app_name, skip)
select 'item', v.ekos_name, v.app_name, false
from (values
  ('Big Daddy IPA (Keg - 1/2 bbl)', 'Big Daddy IPA (Keg - 1/2 bbl)'),
  ('Big Daddy IPA (Keg - 1/6 bbl)', 'Big Daddy IPA (Keg - 1/6 bbl)'),
  ('Big Daddy IPA (Case - 12x - 19.2oz - Can)', 'Big Daddy IPA (Case - 12x - 19.2oz - Can)'),
  ('Big Daddy IPA (Case - 4x6 - 12oz - Can)', 'Big Daddy IPA (Case 4x6 - 12 oz Cans)'),
  ('Big Daddy IPA (Case - 4x6 - 12oz - Can) Unlabeled', 'Big Daddy IPA (Case 4x6 - 12 oz Cans)'),
  ('Big Daddy IPA (Case - 6x4 - 16oz - Can)', 'Big Daddy IPA (Case 6x4 - 16 oz Cans)'),
  ('Capt. Save A Hop HAZY IPA (Case - 12x - 19.2oz - Can)', 'Capt. Hazy (Case - 12x - 19.2oz - Can)'),
  ('Capt. Save A Hop HAZY IPA (Case - 6x4 - 16oz - Can)', 'Capt. Hazy (Case - 6x4 - 16oz - Can)'),
  ('Capt. Save A Hop WC IPA (Case - 6x4 - 16oz - Can)', 'Capt. WC IPA (Case - 6x4 - 16oz - Can)'),
  ('Capt. Save A Hop WC IPA (Keg - 1/2 bbl)', 'Capt. WC (Keg - 1/2 bbl)'),
  ('Captain WC IPA (Case - 12x - 19.2oz - Can)', 'Capt. WC (Case - 12x - 19.2oz - Can)'),
  ('Juicy NE IPA (Case - 6x4 - 16oz - Can)', 'Juicy NE IPA (Case - 6x4 - 16oz - Can)'),
  ('Juicy NE IPA (Keg - 1/2 bbl)', 'Juicy NE IPA (Keg - 1/2 bbl)'),
  ('Juicy NE IPA (Keg - 1/6 bbl)', 'Juicy NE IPA (Keg - 1/6 bbl)'),
  ('Metropolis Lager (Keg - 1/2 bbl)', 'Metropolis Lager (Keg - 1/2 bbl)'),
  ('Metropolis Lager (Keg - 1/6 bbl)', 'Metropolis Lager (Keg - 1/6 bbl)'),
  ('Mystic Haze IPA (Case - 12x - 19.2oz - Can)', 'Mystic Haze IPA (Case - 12x - 19.2oz - Can)'),
  ('Mystic Haze IPA (Case - 4x6 - 12oz - Can)', 'Mystic Haze IPA (Case 4x6 - 12 oz Cans)'),
  ('Mystic Haze IPA (Keg - 1/2 bbl)', 'Mystic Haze (Keg - 1/2 bbl)'),
  ('Nectarine Pie of the Tiger Sour (Case-6x4-16oz-Can)', 'Nectarine Pie of the Tiger (Case - 6x4 - 16oz - Can)'),
  ('Nectarine Pie of the Tiger Sour (Keg - 1/2 bbl)', 'Nectarine Pie of the Tiger (Keg - 1/2 bbl)'),
  ('Nectarine Pie of the Tiger Sour (Keg - 1/6 bbl)', 'Nectarine Pie of the Tiger (Keg - 1/6 bbl)'),
  ('Peachy Vibes (Case - 12x - 19.2oz - Can)', 'Peachy Vibes (Case - 12x - 19.2oz - Can)'),
  ('Peachy Vibes (Case - 4x6 - 12oz - Can)', 'Peachy Vibes (Case - 4x6 - 12oz - Can)'),
  ('Peachy Vibes (Keg - 1/2 bbl)', 'Peachy Vibes (Keg - 1/2 bbl)'),
  ('Peachy Vibes (Keg - 1/6 bbl)', 'Peachy Vibes (Keg - 1/6 bbl)'),
  ('Prohibition Red Ale (Case - 4x6 - 12oz - Can)', 'Prohibition (Case 4x6 - 12 oz Cans)'),
  ('Prohibition Red Ale (Keg - 1/2 bbl)', 'Prohibition Red Ale (Keg 1/2 bbl)'),
  ('Prohibition Red Ale (Keg - 1/6 bbl)', 'Prohibition Red Ale (Keg 1/6bbl)'),
  ('SJSU Spartan Ale (Case - 4x6 - 12oz - Can)', 'Spartan (cases - 12oz - cans)')
) as v(ekos_name, app_name)
where exists (select 1 from public.products p where p.name = v.app_name)
on conflict (kind, ekos_name) do update
  set app_name = excluded.app_name, updated_at = now()
  where public.ekos_name_map.app_name is null and not public.ekos_name_map.skip;

-- ---------------------------------------------------------------------------
-- 10. Starting count — 10/26/2026 (only the first time this file runs)
--     Chad's count sheet, Matagrano PO 2102 already taken out; everything not
--     listed = 0. Ekos packaging from 10/27 on adds on top of it.
-- ---------------------------------------------------------------------------
do $$
declare
  v_missing text;
begin
  if exists (select 1 from public.inventory_moves where kind = 'count') then
    raise notice 'Starting count already loaded — skipped.';
    return;
  end if;

  select string_agg(v.name, ', ') into v_missing
    from (values
      ('Big Daddy IPA (Case 6x4 - 16 oz Cans)'),
      ('Capt. WC (Case - 12x - 19.2oz - Can)'),
      ('Mystic Haze IPA (Case - 12x - 19.2oz - Can)'),
      ('Mango Bomb NE IIPA Series (Case - 12x - 19.2oz - Can)'),
      ('Mango Bomb NE IIPA Series (Case - 6x4 - 16oz - Can)'),
      ('Mango Bomb NE IIPA (Keg - 1/2 bbl)'),
      ('Nectarine Pie of the Tiger (Case - 6x4 - 16oz - Can)'),
      ('Capt. Hazy (Case - 6x4 - 16oz - Can)'),
      ('Capt. Hazy (Case - 12x - 19.2oz - Can)'),
      ('Prohibition (Case 4x6 - 12 oz Cans)'),
      ('Spartan (cases - 12oz - cans)'),
      ('Spartan (Keg - 1/2 bbl)'),
      ('The Hacksaw (Keg 1/6bbl)')
    ) as v(name)
   where not exists (select 1 from public.products p where p.name = v.name);
  if v_missing is not null then
    raise exception 'Starting count stopped — these products weren''t found: %. Nothing was changed.', v_missing;
  end if;

  insert into public.inventory_moves (product_id, bucket, kind, qty, record_qty, packaging_from, note)
  select p.id, 'labeled', 'count', coalesce(c.qty, 0), coalesce(c.qty, 0), date '2026-10-27',
         'Starting count 10/26/2026 (count sheet, Matagrano PO 2102 taken out)'
    from public.products p
    left join (values
      ('Big Daddy IPA (Case 6x4 - 16 oz Cans)', 12),
      ('Capt. WC (Case - 12x - 19.2oz - Can)', 12),
      ('Mystic Haze IPA (Case - 12x - 19.2oz - Can)', 1),
      ('Mango Bomb NE IIPA Series (Case - 12x - 19.2oz - Can)', 4),
      ('Mango Bomb NE IIPA Series (Case - 6x4 - 16oz - Can)', 1),
      ('Mango Bomb NE IIPA (Keg - 1/2 bbl)', 2),
      ('Nectarine Pie of the Tiger (Case - 6x4 - 16oz - Can)', 2),
      ('Capt. Hazy (Case - 6x4 - 16oz - Can)', 22),
      ('Capt. Hazy (Case - 12x - 19.2oz - Can)', 6),
      ('Prohibition (Case 4x6 - 12 oz Cans)', 2),
      ('Spartan (cases - 12oz - cans)', 1),
      ('Spartan (Keg - 1/2 bbl)', 2),
      ('The Hacksaw (Keg 1/6bbl)', 1)
    ) as c(name, qty) on c.name = p.name
   where p.active;

  insert into public.inventory_moves (product_id, bucket, kind, qty, record_qty, packaging_from, note)
  select p.id, 'unlabeled', 'count', 0, 0, date '2026-10-27', 'Starting count 10/26/2026 — no unlabeled cases'
    from public.products p
   where p.active;
end $$;

-- Fill this week's On Hand / Unlabeled from the record now.
do $$ begin perform public.inventory_record_refresh(); end $$;

-- Live updates on the Inventory & Allocation page.
do $$
begin
  if not exists (select 1 from pg_publication_tables
                  where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'inventory_moves') then
    alter publication supabase_realtime add table public.inventory_moves;
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- Check: the newest week, what the record says for the counted beers, and
-- how many Ekos packaging names are on the list.
-- ---------------------------------------------------------------------------
select p.name, s.on_hand, s.unlabeled
  from public.inventory_snapshots s
  join public.products p on p.id = s.product_id
 where s.week_id = (select id from public.weeks order by week_start desc limit 1)
   and (s.on_hand <> 0 or s.unlabeled <> 0)
 order by p.sort_order nulls last, p.name;
