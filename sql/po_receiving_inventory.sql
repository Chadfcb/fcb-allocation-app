-- =========================================================
-- Completed POs add to Packaging / Label Inventory (2026-11-20, Chad:
-- "whenever PO's are marked completed in the fcb data app, it needs to add
-- them to the packaging/label inventory in the app").
--
-- How it works:
--  * A PO moved to Completed (Purchase Orders page) gets adds_to_inventory =
--    true, and its line items are added to the NEWEST week's Packaging
--    Inventory / Label Inventory On Hand (same units: single cans, lids,
--    trays, labels).
--  * PO item names → inventory rows come from po_inventory_item_map (seeded
--    below from FCB's past POs). A packaging-looking item with no match
--    shows in "Needs a decision" on the Purchase Orders page; picking a row
--    there adds it right away. Hops, grain, etc. are ignored.
--  * Every add is written to po_inventory_receipts. Re-applying only adds the
--    difference, so a PO can never be added twice. If Ekos re-opens a
--    completed PO (sync moves it back to Open), its amounts come back off.
--  * Only POs completed from now on count (older ones are already in the
--    counts) + PO 3185 (Core Cans, received 11/18), added at the end.
-- Safe to run twice.
-- =========================================================

alter table public.purchase_orders
  add column if not exists adds_to_inventory boolean not null default false;

comment on column public.purchase_orders.adds_to_inventory is
  'True once the PO was marked Completed after 11/20/2026 (or PO 3185): its packaging/label items were added to Packaging / Label Inventory.';

-- Same name, different spacing/case → same item.
create or replace function public.po_inventory_name_key(p_name text)
returns text
language sql
immutable
as $$
  select lower(regexp_replace(btrim(coalesce(p_name, '')), '\s+', ' ', 'g'));
$$;

-- Which PO items count as packaging/labels (everything else is ignored).
create or replace function public.po_item_is_packaging(p_supplier text, p_item text)
returns boolean
language sql
immutable
as $$
  select coalesce(p_supplier, '') ~* '(core cans|label brewery|wcp solutions|pak.?tech|keg)'
      or coalesce(p_item, '') ~* '(\mcans?\M|\mlids?\M|\mends?\M|\mlabels?\M|\mtrays?\M|pak.?tech|\mkegs?\M)';
$$;

-- ---------------------------------------------------------
-- Name list: PO item name → inventory row
-- ---------------------------------------------------------
create table if not exists public.po_inventory_item_map (
  name_key text primary key,
  item_name text not null,
  target text not null check (target in ('packaging', 'label', 'skip')),
  item_key text check (item_key in (
    'cans_19_2oz','cans_16oz','cans_12oz',
    'pakteks_4pack','pakteks_6pack',
    'trays_12_16oz','trays_19oz',
    'lids_202',
    'kegs_1_6bbl','kegs_1_2bbl'
  )),
  product_id uuid references public.products(id) on delete cascade,
  created_by uuid references public.profiles(id) default auth.uid(),
  created_at timestamptz not null default now(),
  constraint po_inventory_item_map_target_ok check (
    (target = 'packaging' and item_key is not null and product_id is null)
    or (target = 'label' and product_id is not null and item_key is null)
    or (target = 'skip' and item_key is null and product_id is null)
  )
);

alter table public.po_inventory_item_map enable row level security;
drop policy if exists "po_inventory_item_map_section" on public.po_inventory_item_map;
create policy "po_inventory_item_map_section" on public.po_inventory_item_map for all using (
  has_section(auth.uid(), 'purchase_orders')
) with check (
  has_section(auth.uid(), 'purchase_orders')
);
grant select, insert, update, delete on public.po_inventory_item_map to authenticated;
grant select, insert, update, delete on public.po_inventory_item_map to service_role;

comment on table public.po_inventory_item_map is
  'Which Packaging Inventory item (cans, lids, trays, Pak-Techs, kegs) or which beer''s Label Inventory each vendor PO item name goes to when a PO is marked Completed (or skip = not packaging). Use for "what does PO item X count as".';

-- ---------------------------------------------------------
-- Record of everything POs added to inventory
-- ---------------------------------------------------------
create table if not exists public.po_inventory_receipts (
  id uuid primary key default gen_random_uuid(),
  purchase_order_id uuid references public.purchase_orders(id) on delete set null,
  ekos_po_number text,
  supplier text,
  name_key text not null,
  item_name text not null,
  target text not null check (target in ('packaging', 'label')),
  item_key text,
  product_id uuid references public.products(id) on delete set null,
  week_id uuid references public.weeks(id) on delete set null,
  qty numeric(12,2) not null,
  created_by uuid references public.profiles(id) default auth.uid(),
  created_at timestamptz not null default now()
);
create index if not exists po_inventory_receipts_po_idx on public.po_inventory_receipts (purchase_order_id);

alter table public.po_inventory_receipts enable row level security;
drop policy if exists "po_inventory_receipts_select" on public.po_inventory_receipts;
create policy "po_inventory_receipts_select" on public.po_inventory_receipts for select using (
  has_section(auth.uid(), 'purchase_orders') or has_section(auth.uid(), 'inventory_allocation')
);
grant select on public.po_inventory_receipts to authenticated;
grant select, insert, update, delete on public.po_inventory_receipts to service_role;

comment on table public.po_inventory_receipts is
  'Every amount a completed vendor PO added to Packaging / Label Inventory (negative = taken back off because the PO was re-opened or its item re-assigned): PO number, supplier, item, which inventory row, which week, how many. Use for "when did we receive cans/lids/labels" or "what did PO X add to inventory".';

-- ---------------------------------------------------------
-- Add / take back one PO's amounts (only the difference)
-- ---------------------------------------------------------
create or replace function public.po_inventory_apply(p_po uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_po public.purchase_orders%rowtype;
  v_week uuid;
  r record;
  v_row_id uuid;
  v_old numeric;
  v_new numeric;
begin
  select * into v_po from public.purchase_orders where id = p_po;
  if not found or not v_po.adds_to_inventory then
    return;
  end if;

  select id into v_week from public.weeks order by week_start desc limit 1;
  if v_week is null then
    return;
  end if;

  for r in
    with want as (
      select public.po_inventory_name_key(i.item_name) as k,
             min(i.item_name) as item_name,
             sum(coalesce(i.quantity, 0)) as qty
        from public.purchase_order_items i
       where i.purchase_order_id = p_po
       group by 1
    ),
    mapped as (
      select w.k, w.item_name, m.target, m.item_key, m.product_id,
             case when v_po.record_status = 'completed' then w.qty else 0 end as qty
        from want w
        join public.po_inventory_item_map m on m.name_key = w.k
       where m.target <> 'skip'
    ),
    have as (
      select x.name_key as k, x.target, x.item_key, x.product_id,
             max(x.item_name) as item_name, sum(x.qty) as qty
        from public.po_inventory_receipts x
       where x.purchase_order_id = p_po
       group by 1, 2, 3, 4
    )
    select coalesce(m.k, h.k) as k,
           coalesce(m.item_name, h.item_name) as item_name,
           coalesce(m.target, h.target) as target,
           coalesce(m.item_key, h.item_key) as item_key,
           coalesce(m.product_id, h.product_id) as product_id,
           coalesce(m.qty, 0) - coalesce(h.qty, 0) as diff
      from mapped m
      full join have h
        on h.k = m.k and h.target = m.target
       and h.item_key is not distinct from m.item_key
       and h.product_id is not distinct from m.product_id
  loop
    continue when r.diff = 0;
    continue when r.target = 'label' and r.product_id is null;

    insert into public.po_inventory_receipts
      (purchase_order_id, ekos_po_number, supplier, name_key, item_name, target, item_key, product_id, week_id, qty)
    values
      (p_po, v_po.ekos_po_number, v_po.supplier, r.k, r.item_name, r.target, r.item_key, r.product_id, v_week, r.diff);

    if r.target = 'packaging' then
      select id, on_hand_qty into v_row_id, v_old
        from public.packaging_inventory
       where week_id = v_week and item_key = r.item_key;
      v_new := greatest(coalesce(v_old, 0) + r.diff, 0);
      if v_row_id is null then
        insert into public.packaging_inventory (week_id, item_key, on_hand_qty, updated_by)
        values (v_week, r.item_key, v_new, auth.uid())
        returning id into v_row_id;
      else
        update public.packaging_inventory
           set on_hand_qty = v_new, updated_by = auth.uid(), updated_at = now()
         where id = v_row_id;
      end if;
      insert into public.audit_log (week_id, table_name, record_id, field_name, old_value, new_value, changed_by)
      values (v_week, 'packaging_inventory', v_row_id, 'on_hand_qty',
              coalesce(v_old, 0)::text, v_new::text, auth.uid());
    else
      select id, on_hand_qty into v_row_id, v_old
        from public.label_inventory
       where week_id = v_week and product_id = r.product_id;
      v_new := greatest(coalesce(v_old, 0) + r.diff, 0);
      if v_row_id is null then
        insert into public.label_inventory (week_id, product_id, on_hand_qty, updated_by)
        values (v_week, r.product_id, v_new, auth.uid())
        returning id into v_row_id;
      else
        update public.label_inventory
           set on_hand_qty = v_new, updated_by = auth.uid(), updated_at = now()
         where id = v_row_id;
      end if;
      insert into public.audit_log (week_id, table_name, record_id, field_name, old_value, new_value, changed_by)
      values (v_week, 'label_inventory', v_row_id, 'on_hand_qty',
              coalesce(v_old, 0)::text, v_new::text, auth.uid());
    end if;

    v_row_id := null;
    v_old := null;
  end loop;
end;
$$;

revoke all on function public.po_inventory_apply(uuid) from public;
grant execute on function public.po_inventory_apply(uuid) to service_role;

comment on function public.po_inventory_apply(uuid) is
  '[hidden] Adds a completed PO''s packaging/label items to the newest week''s inventory (only the difference from what it already added).';

-- ---------------------------------------------------------
-- Triggers
-- ---------------------------------------------------------

-- Marked Completed → this PO counts from now on.
create or replace function public.po_inventory_mark()
returns trigger
language plpgsql
as $$
begin
  if new.record_status = 'completed' and old.record_status is distinct from 'completed' then
    new.adds_to_inventory := true;
  end if;
  return new;
end;
$$;

drop trigger if exists po_inventory_mark on public.purchase_orders;
create trigger po_inventory_mark before update of record_status on public.purchase_orders
  for each row execute function public.po_inventory_mark();

-- Status changed (Completed, or re-opened by the Ekos sync) → add / take back.
create or replace function public.po_inventory_po_changed()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.adds_to_inventory
     and (old.record_status is distinct from new.record_status
          or old.adds_to_inventory is distinct from new.adds_to_inventory) then
    perform public.po_inventory_apply(new.id);
  end if;
  return null;
end;
$$;

drop trigger if exists po_inventory_po_changed on public.purchase_orders;
create trigger po_inventory_po_changed after update on public.purchase_orders
  for each row execute function public.po_inventory_po_changed();

-- A counted PO's items changed → re-check.
create or replace function public.po_inventory_items_changed()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op in ('UPDATE', 'DELETE') then
    perform public.po_inventory_apply(old.purchase_order_id);
  end if;
  if tg_op in ('INSERT', 'UPDATE') and (tg_op = 'INSERT' or new.purchase_order_id is distinct from old.purchase_order_id) then
    perform public.po_inventory_apply(new.purchase_order_id);
  end if;
  return null;
end;
$$;

drop trigger if exists po_inventory_items_changed on public.purchase_order_items;
create trigger po_inventory_items_changed after insert or update or delete on public.purchase_order_items
  for each row execute function public.po_inventory_items_changed();

-- Name list changed (e.g. a "Needs a decision" pick) → re-check every counted PO with that item.
create or replace function public.po_inventory_map_changed()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_key text := coalesce(new.name_key, old.name_key);
  v_po uuid;
begin
  for v_po in
    select distinct i.purchase_order_id
      from public.purchase_order_items i
      join public.purchase_orders p on p.id = i.purchase_order_id
     where p.adds_to_inventory
       and public.po_inventory_name_key(i.item_name) = v_key
    union
    select distinct x.purchase_order_id
      from public.po_inventory_receipts x
     where x.name_key = v_key and x.purchase_order_id is not null
  loop
    perform public.po_inventory_apply(v_po);
  end loop;
  return null;
end;
$$;

drop trigger if exists po_inventory_map_changed on public.po_inventory_item_map;
create trigger po_inventory_map_changed after insert or update or delete on public.po_inventory_item_map
  for each row execute function public.po_inventory_map_changed();

-- ---------------------------------------------------------
-- Needs a decision: packaging items on counted POs with no match yet
-- ---------------------------------------------------------
create or replace view public.po_inventory_needs_decision
with (security_invoker = true) as
select i.id as item_id,
       p.id as purchase_order_id,
       p.ekos_po_number,
       p.supplier,
       i.item_name,
       i.quantity
  from public.purchase_order_items i
  join public.purchase_orders p on p.id = i.purchase_order_id
 where p.adds_to_inventory
   and p.record_status = 'completed'
   and public.po_item_is_packaging(p.supplier, i.item_name)
   and not exists (
     select 1 from public.po_inventory_item_map m
      where m.name_key = public.po_inventory_name_key(i.item_name)
   );

grant select on public.po_inventory_needs_decision to authenticated;
grant select on public.po_inventory_needs_decision to service_role;

comment on view public.po_inventory_needs_decision is
  'Packaging/label items on completed vendor POs that don''t match a Packaging or Label Inventory row yet, so they haven''t been added to inventory. Use for "why didn''t PO X add to inventory".';

-- ---------------------------------------------------------
-- Name list from FCB's past POs (read 11/20/2026). Labels are matched to the
-- beer by its exact app product name; a name not found is left out and will
-- show in "Needs a decision" the first time it's on a completed PO.
-- ---------------------------------------------------------
insert into public.po_inventory_item_map (name_key, item_name, target, item_key)
select public.po_inventory_name_key(v.item_name), v.item_name, 'packaging', v.item_key
  from (values
    ('Cans: 211 12oz Standard Brite (8169/plt)', 'cans_12oz'),
    ('Cans: 211 16oz Standard Brite (5057/plt)', 'cans_16oz'),
    ('Cans: 211 19.2 oz Standard Brite (5057/plt)', 'cans_19_2oz'),
    ('Lids: 202 LOE ENDS (Lids 11 State) (500/slv)', 'lids_202'),
    ('Trays 16oz/12oz (24pk) (1140/plt)', 'trays_12_16oz')
  ) as v(item_name, item_key)
on conflict (name_key) do nothing;

insert into public.po_inventory_item_map (name_key, item_name, target, product_id)
select public.po_inventory_name_key(v.item_name), v.item_name, 'label', p.id
  from (values
    ('Label - Big Daddy IPA 12oz', 'Big Daddy IPA (Case 4x6 - 12 oz Cans)'),
    ('Label - Big Daddy IPA 19.2oz', 'Big Daddy IPA (Case - 12x - 19.2oz - Can)'),
    ('Label - Captain Hazy 16oz', 'Capt. Hazy (Case - 6x4 - 16oz - Can)'),
    ('Label - Captain WC 16oz', 'Capt. WC IPA (Case - 6x4 - 16oz - Can)'),
    ('Label - Juicy NE 16oz', 'Juicy NE IPA (Case - 6x4 - 16oz - Can)'),
    ('Label - Juicy NE 19.2oz', 'Juicy NE IPA (Case - 12x - 19.2oz - Can)'),
    ('Label - Nectarine Pie 16oz', 'Nectarine Pie of the Tiger (Case - 6x4 - 16oz - Can)'),
    ('Label - Peachy Vibes 12oz', 'Peachy Vibes (Case - 4x6 - 12oz - Can)'),
    ('Label - SJSU Spartan Ale 12oz', 'Spartan (cases - 12oz - cans)')
  ) as v(item_name, product_name)
  join public.products p on p.name = v.product_name
on conflict (name_key) do nothing;

-- ---------------------------------------------------------
-- Realtime (Purchase Orders page refreshes when a pick is saved)
-- ---------------------------------------------------------
do $$
begin
  if not exists (select 1 from pg_publication_tables
                  where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'po_inventory_item_map') then
    alter publication supabase_realtime add table public.po_inventory_item_map;
  end if;
  if not exists (select 1 from pg_publication_tables
                  where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'po_inventory_receipts') then
    alter publication supabase_realtime add table public.po_inventory_receipts;
  end if;
end $$;

-- ---------------------------------------------------------
-- PO 3185 (Core Cans, received 11/18): add it now.
-- ---------------------------------------------------------
update public.purchase_orders
   set adds_to_inventory = true
 where ekos_po_number = '3185'
   and record_status = 'completed'
   and not adds_to_inventory;
