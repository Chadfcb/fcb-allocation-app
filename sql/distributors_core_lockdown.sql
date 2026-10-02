-- Core distributors — locked to Chad's roster, changeable ONLY in Supabase
-- (added 2026-10-02).
--
-- Per Chad: "that list of cores i gave you are the only core distributors.
-- There shouldnt even be an option in the app to make one a core. that
-- should be done on the back end."
--
-- Core exists for two things:
--   1. The Ekos sync — ONLY Core distributors get their inventory updated.
--      Nothing prevents a Core distributor from being updated (not its
--      active/off toggle, not other rows with similar names like
--      "Markstein C" or "Valley WIde 2"). The only way a Core distributor
--      stops being updated is if it's deleted from the system entirely
--      (like Saccani).
--   2. Pricing.
--
-- The Core roster (Chad, 2026-09-09, reconfirmed 2026-10-02):
--   Matagrano, Markstein, Valley Wide, Coast, Guardian, Mussetter, Superior
--
-- What this file does:
--   a) Sets Core to exactly those 7 rows (exact, case-insensitive,
--      trimmed name match) and turns it OFF for every other row — e.g.
--      "Markstein C" had its Core box checked on 2026-09-23 and is not Core.
--   b) Adds a trigger so the app can never change Core: a new distributor
--      added in the app is always non-Core, and an edit from the app can't
--      flip it (the old value is kept). Only a change made directly here in
--      Supabase's SQL Editor goes through.
--
-- Run this in Supabase's SQL Editor. Idempotent — safe to run more than once.

-- a) The roster.
update distributors
set is_core_distributor = (lower(trim(name)) in (
  'matagrano',
  'markstein',
  'valley wide',
  'coast',
  'guardian',
  'mussetter',
  'superior'
));

-- b) Lock it.
create or replace function protect_core_distributor_flag()
returns trigger
language plpgsql
as $$
begin
  -- Requests from the app (signed-in users, anonymous, or the app's own
  -- server key) run as these roles. Supabase's SQL Editor runs as
  -- "postgres", so changes made there are allowed.
  if current_user in ('authenticated', 'anon', 'service_role') then
    if tg_op = 'INSERT' then
      new.is_core_distributor := false;
    elsif new.is_core_distributor is distinct from old.is_core_distributor then
      new.is_core_distributor := old.is_core_distributor;
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists protect_core_distributor_flag on distributors;
create trigger protect_core_distributor_flag
  before insert or update on distributors
  for each row
  execute function protect_core_distributor_flag();

comment on column distributors.is_core_distributor is
  'FCB''s Core distributors: Matagrano, Markstein, Valley Wide, Coast, Guardian, Mussetter, Superior. Used by the Ekos sync (ONLY Core distributors get inventory updated) and by pricing. Can only be changed directly in Supabase — the protect_core_distributor_flag trigger blocks any change from the app (see sql/distributors_core_lockdown.sql, 2026-10-02).';

-- Check: should list exactly the 7 Core distributors.
select name, active, is_core_distributor
from distributors
where is_core_distributor
order by name;
