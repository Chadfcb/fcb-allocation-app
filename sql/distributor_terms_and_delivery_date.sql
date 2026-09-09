-- Distributor payment terms + PO delivery date + Finance > Distributor Data
-- Added 2026-09-09. Run this BEFORE deploying the matching code change.
-- Idempotent — safe to run more than once.

-- Distributors: payment terms in days (0 = due on delivery/COD, 30 =
-- net-30, etc.). Editable from the new Finance > Distributor Data page.
-- Combined with a delivered order's Delivery Date below, this decides
-- which week that order's revenue lands in on the Cash Flow Dashboard.
alter table distributors
  add column if not exists payment_terms_days integer not null default 0;

-- distributor_pos: the date a distributor's PO was actually marked
-- Delivered. Auto-filled to today by the app when po_status flips to
-- 'delivered' (same pattern as Purchase Orders' Paid Date); always
-- editable/backdatable by hand.
alter table distributor_pos
  add column if not exists delivery_date date;

-- Backfill: every distributor_pos row already marked Delivered gets that
-- week's own start date as a stand-in Delivery Date — there's no way to
-- recover the real delivery date, since it wasn't tracked before this
-- migration. Editable by hand afterward for any row where that's wrong.
update distributor_pos dp
set delivery_date = w.week_start
from weeks w
where dp.week_id = w.id
  and dp.po_status = 'delivered'
  and dp.delivery_date is null;

-- Extend the existing po_status admin-only guard to also protect
-- delivery_date the same way (po_number stays editable by anyone) — it's
-- tied to marking something Delivered, which is already admin-only.
create or replace function enforce_po_status_admin_only()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_is_admin boolean;
  v_old_status text;
  v_old_delivery_date date;
begin
  v_old_status := case when tg_op = 'UPDATE' then old.po_status else null end;
  v_old_delivery_date := case when tg_op = 'UPDATE' then old.delivery_date else null end;

  if new.po_status is distinct from v_old_status
     or new.delivery_date is distinct from v_old_delivery_date then
    select exists(
      select 1 from public.profiles p where p.id = auth.uid() and p.role = 'admin'
    ) into v_is_admin;

    if not v_is_admin then
      new.po_status := v_old_status;
      new.delivery_date := v_old_delivery_date;
    end if;
  end if;

  return new;
end;
$$;

-- Finance > Distributor Data: a Finance-only user (no Operations grant,
-- possibly not even role='admin' — an Employee can be granted just this
-- section) needs to be able to edit distributors.payment_terms_days,
-- which the existing distributors_write_admin policy (role='admin' only)
-- doesn't allow. Additive — same pattern as the Cash Flow Dashboard's own
-- read policies below; nothing existing is narrowed.
drop policy if exists "distributors_write_finance" on distributors;
create policy "distributors_write_finance" on distributors for update
  using (has_section(auth.uid(), 'distributor_data'))
  with check (has_section(auth.uid(), 'distributor_data'));
