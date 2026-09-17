-- ============================================================================
-- Ernie in Slack: map every FCB-Data Slack user to their real app account
-- ============================================================================
--
-- WHY: Ernie in Slack was only ever able to see FCB-Data info for Chad,
-- because ernie_slack_user_map (the table that connects a Slack account to
-- a real FCB-Data login) only had one row in it (Chad's, and even that was
-- created the same day notifications broke, so it's never really been
-- exercised). Everyone else got generic chat only, with no real data.
--
-- WHAT THIS DOES: Chad + Claude agreed the policy should be: anyone who
-- already has an FCB-Data account can use Ernie in Slack, and Ernie shows
-- them exactly what their own FCB-Data account is already allowed to see --
-- nothing more, nothing less. That "what they're allowed to see" logic
-- already exists in the app (role + section access) and Ernie's Slack code
-- already tries to use it -- the only missing piece is this lookup table.
--
-- This script:
--   1. Clears out any old mapping rows for the Slack accounts listed below,
--      so we start from a clean slate.
--   2. Inserts a fresh mapping row ONLY for Slack accounts whose email
--      matches a real FCB-Data account (profiles.email). Anyone on Slack
--      who does NOT have an FCB-Data account is automatically skipped --
--      this script cannot grant anyone access they don't already have.
--   3. Runs a check at the end listing anyone who was skipped, so you can
--      see at a glance who's on Slack but has no FCB-Data login.
--
-- This ONLY touches the ernie_slack_user_map lookup table. It does not
-- change anyone's role, section access, or anything else in the FCB-Data
-- app itself.
--
-- The Slack user list below is every @fullcirclebrewing.com account Claude
-- found in your Slack workspace directory as of 2026-09-17. If someone new
-- joins Slack later, they'll need a row added the same way.
-- ============================================================================

-- Step 1: clear any existing mappings for these Slack accounts.
delete from ernie_slack_user_map
where slack_user_id in (
  'U0BM1U7T611', -- Lance Huravitch
  'U04LT58DF4K', -- Kelli Rogers
  'U07HYKSSA67', -- Juan Cienfuegos
  'U06FXUEC9SQ', -- Ryan Morrison
  'U04DZ22GY4S', -- Mike Sumaya
  'U04UVNGPH4N', -- Steve Bruce
  'U04FPGBPWK0', -- Bill Grossman
  'U03AEAVTT9P', -- Francesca Ramirez
  'U051SRGNEM8', -- Eric Gutenkauf
  'U01UXERAU9Z', -- Grace
  'U01UU3VSJTX', -- John Borges
  'U083EA6G389', -- Shanelle
  'U5U3S61HA',   -- Eddie Garcia (Eddius Octavius Magnus IV)
  'U06SN410KJ5', -- Sara
  'U045NM13YBS', -- Dave Apkarian
  'UAXCQMU2V',   -- Chad
  'UTCTXPPQC',   -- Juanitooo
  'U15PGJ95Y'    -- art / Arthur
);

-- Step 2: insert a fresh mapping row for every Slack account above whose
-- email matches a real FCB-Data profile. (Case-insensitive match, since
-- Slack and the app don't always agree on capitalization.)
insert into ernie_slack_user_map (slack_user_id, app_user_id)
select v.slack_user_id, p.id
from (values
  ('U0BM1U7T611', 'lance@fullcirclebrewing.com'),
  ('U04LT58DF4K', 'kellisound@fullcirclebrewing.com'),
  ('U07HYKSSA67', 'juanc@fullcirclebrewing.com'),
  ('U06FXUEC9SQ', 'ryanm@fullcirclebrewing.com'),
  ('U04DZ22GY4S', 'mikesumaya@fullcirclebrewing.com'),
  ('U04UVNGPH4N', 'stevebruce@fullcirclebrewing.com'),
  ('U04FPGBPWK0', 'grossman@fullcirclebrewing.com'),
  ('U03AEAVTT9P', 'fran@fullcirclebrewing.com'),
  ('U051SRGNEM8', 'ericg@fullcirclebrewing.com'),
  ('U01UXERAU9Z', 'grace@fullcirclebrewing.com'),
  ('U01UU3VSJTX', 'johnb@fullcirclebrewing.com'),
  ('U083EA6G389', 'shanelle@fullcirclebrewing.com'),
  ('U5U3S61HA',   'eddie@fullcirclebrewing.com'),
  ('U06SN410KJ5', 'sara@fullcirclebrewing.com'),
  ('U045NM13YBS', 'apkarian@fullcirclebrewing.com'),
  ('UAXCQMU2V',   'chad@fullcirclebrewing.com'),
  ('UTCTXPPQC',   'juan@fullcirclebrewing.com'),
  ('U15PGJ95Y',   'arthur@fullcirclebrewing.com')
) as v(slack_user_id, email)
join profiles p on lower(p.email) = lower(v.email);

-- Step 3: sanity check. Anyone this lists is on Slack but has NO matching
-- FCB-Data account, so they were intentionally skipped above. They'll still
-- be able to talk to Ernie in Slack once he's un-silenced, just without any
-- real FCB-Data access -- same as anyone outside the company would get.
select v.slack_user_id, v.email
from (values
  ('U0BM1U7T611', 'lance@fullcirclebrewing.com'),
  ('U04LT58DF4K', 'kellisound@fullcirclebrewing.com'),
  ('U07HYKSSA67', 'juanc@fullcirclebrewing.com'),
  ('U06FXUEC9SQ', 'ryanm@fullcirclebrewing.com'),
  ('U04DZ22GY4S', 'mikesumaya@fullcirclebrewing.com'),
  ('U04UVNGPH4N', 'stevebruce@fullcirclebrewing.com'),
  ('U04FPGBPWK0', 'grossman@fullcirclebrewing.com'),
  ('U03AEAVTT9P', 'fran@fullcirclebrewing.com'),
  ('U051SRGNEM8', 'ericg@fullcirclebrewing.com'),
  ('U01UXERAU9Z', 'grace@fullcirclebrewing.com'),
  ('U01UU3VSJTX', 'johnb@fullcirclebrewing.com'),
  ('U083EA6G389', 'shanelle@fullcirclebrewing.com'),
  ('U5U3S61HA',   'eddie@fullcirclebrewing.com'),
  ('U06SN410KJ5', 'sara@fullcirclebrewing.com'),
  ('U045NM13YBS', 'apkarian@fullcirclebrewing.com'),
  ('UAXCQMU2V',   'chad@fullcirclebrewing.com'),
  ('UTCTXPPQC',   'juan@fullcirclebrewing.com'),
  ('U15PGJ95Y',   'arthur@fullcirclebrewing.com')
) as v(slack_user_id, email)
left join profiles p on lower(p.email) = lower(v.email)
where p.id is null;

-- Step 4: see who actually got mapped, and to which FCB-Data account.
select m.slack_user_id, p.email
from ernie_slack_user_map m
join profiles p on p.id = m.app_user_id
order by p.email;
