-- Purchase Orders: Paid Date + Open/Holding/Completed lifecycle
-- Added 2026-09-09. Run this BEFORE deploying the matching code change.
-- Idempotent — safe to run more than once.

-- paid_date: the date a PO was actually marked Paid. The app auto-fills
-- this to today when a PO's payment_status flips to 'paid' (clearing it if
-- flipped back to 'pending'), and it's always editable/backdatable by
-- hand. The Cash Flow Dashboard's Expenses Out grid uses this — not
-- po_date — to bucket a paid expense into the week it actually got paid.
alter table purchase_orders
  add column if not exists paid_date date;

-- record_status: replaces "delete on sync" with a real lifecycle.
--   open      — currently open in Ekos (every PO before this migration).
--   holding   — dropped off the latest Ekos sync; a person decides from
--               here whether to delete it for real or mark it Completed.
--   completed — moved here on purpose, once Total Cost/Paid Date are
--               correct.
-- Nothing is auto-deleted by a sync anymore. A PO that reappears as open
-- in a later Ekos sync moves back to 'open' automatically (handled by the
-- sync route, not by any trigger here).
alter table purchase_orders
  add column if not exists record_status text not null default 'open'
    check (record_status in ('open', 'holding', 'completed'));

-- Backfill: every PO already marked Paid gets its existing PO Date as a
-- stand-in Paid Date — there's no way to recover the actual date it was
-- paid, since that was never tracked before this migration. Editable by
-- hand afterward for any PO where that stand-in is wrong.
update purchase_orders
set paid_date = po_date
where payment_status = 'paid' and paid_date is null;
