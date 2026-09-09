-- Distributor payment Terms — backfill from the "Batch to Cash" spreadsheet's
-- own Distributor_Terms tab, added 2026-09-09 per Chad.
--
-- Sets distributors.payment_terms_days for the 6 core distributors whose
-- terms were actually filled in on that tab. Matched on an exact,
-- case-insensitive, whitespace-trimmed name — same safe pattern as
-- sql/distributors_core_flag.sql — so this can't accidentally touch
-- "Matagrano 2" or any other similarly-named row.
--
-- NOT included: Mussetter (not listed on the spreadsheet's
-- Distributor_Terms tab at all — still needs Chad to fill it in by hand
-- on Finance > Distributor Data) and Saccani (listed on the sheet at 15
-- days, but Saccani is a dropped distributor, not part of FCB's current
-- roster — intentionally left alone).
--
-- Idempotent — safe to run more than once.

update distributors set payment_terms_days = 1  where lower(trim(name)) in ('coast');
update distributors set payment_terms_days = 30 where lower(trim(name)) in ('guardian');
update distributors set payment_terms_days = 15 where lower(trim(name)) in ('markstein');
update distributors set payment_terms_days = 15 where lower(trim(name)) in ('matagrano');
update distributors set payment_terms_days = 15 where lower(trim(name)) in ('superior');
update distributors set payment_terms_days = 15 where lower(trim(name)) in ('valley wide', 'valleywide');
