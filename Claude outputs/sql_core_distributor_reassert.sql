-- Safety net: guarantee the 7 named core distributors are flagged
-- is_core_distributor = true, no matter what. (2026-09-14)
--
-- This re-asserts the same migration from 2026-09-09 (exact,
-- case-insensitive name match, so it can't accidentally catch a
-- lookalike row like "Matagrano 2" or "Valley Wide Cans"). Safe to run
-- any number of times -- it only ever sets the flag to true for these
-- exact names, never turns it off for anyone.
--
-- Why this matters: is_core_distributor is what the Distributor
-- Pricing and Sales > Price List pages now use (see the code fix
-- shipped alongside this file) to decide which distributors always
-- show up, even when toggled off the current week's Inventory &
-- Allocation grid. If this flag were ever accidentally cleared on one
-- of these 7, their pricing would disappear from those pages again --
-- this file is the fix for that scenario.
update distributors
set is_core_distributor = true
where trim(lower(name)) in (
  'matagrano',
  'markstein',
  'valley wide',
  'coast',
  'guardian',
  'mussetter',
  'superior'
);
