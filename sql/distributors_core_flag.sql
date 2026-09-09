-- Finance > Distributor Data — "Core Distributor" flag, added 2026-09-09.
--
-- Distributor Data needs to show ONLY FCB's real, ongoing distributors
-- (Matagrano, Markstein, Valley Wide, Coast, Guardian, Mussetter,
-- Superior) with their payment Terms — never a one-off/direct-customer
-- row like Sjsu, and never leftover junk like "Matagrano 2" (a duplicate
-- order entry against the same distributor, see the existing
-- track_inventory comment on this table) or a dropped-and-gone
-- distributor like Saccani.
--
-- The distributors table's `active` column can't do this job — it's the
-- WEEKLY on/off toggle for who's currently shown on the Inventory &
-- Allocation grid (who FCB is delivering to that particular week), which
-- is a completely separate concept from "is this genuinely one of our
-- ongoing distributors." This migration adds a second, independent flag
-- for that: `is_core_distributor`. It only ever changes by explicit admin
-- action (via the new "Core" checkbox in Inventory & Allocation's Edit
-- Distributors mode) — never automatically, and never tied to the weekly
-- active toggle.
--
-- Idempotent — safe to run more than once.

alter table distributors
  add column if not exists is_core_distributor boolean not null default false;

comment on column distributors.is_core_distributor is
  'True only for FCB''s real, ongoing distributors (set by hand via Inventory & Allocation''s Edit Distributors mode). Independent of `active` (the weekly on/off toggle) and `track_inventory`. Drives Finance > Distributor Data — a row here is excluded from that page and can never carry payment Terms unless this is true. Defaults false so one-off/direct-customer rows (e.g. Sjsu) and duplicate-order rows (e.g. Matagrano 2) never show up there by accident.';

-- One-time backfill: flip it on for exactly the 7 distributors Chad named
-- as FCB's current core roster (2026-09-09), matched on an exact,
-- case-insensitive, whitespace-trimmed name so this can never accidentally
-- catch a similarly-named row like "Matagrano 2". If any of these don't
-- match — a slightly different spelling on file, e.g. "Valleywide" as one
-- word — that one simply stays unflagged; check Distributor Data after
-- deploying and flip it on by hand (the new "Core" checkbox on the
-- Inventory page) if one of the 7 is missing.
update distributors
set is_core_distributor = true
where lower(trim(name)) in (
  'matagrano',
  'markstein',
  'valley wide',
  'valleywide',
  'coast',
  'guardian',
  'mussetter',
  'superior'
);
