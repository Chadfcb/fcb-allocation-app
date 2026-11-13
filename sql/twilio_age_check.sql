-- Twilio texting — 21+ age check on sign-ups (added 2026-11-13, per Chad: "go
-- ahead and start", for the new A2P campaign after the 10/30 rejection for
-- alcohol / no age verification). Plan: claude/twilio-retry-app-plan.md.
--
-- Run this ONCE in Supabase's SQL Editor BEFORE pushing the code.
-- Safe to run more than once.
--
-- What changes:
--   * Two new sign-up statuses:
--       pending_age — texted JOIN (or START) but hasn't confirmed their birth
--                     date yet. NOT signed up, never texted except the
--                     birth-date question.
--       under_21    — gave a birth date under 21. Never signed up from that
--                     number again.
--   * age_verified_at / age_method — WHEN and HOW (text or web form) they
--     confirmed they're 21+. The birth date itself is not stored here.
--   * age_asks — how many times we've asked for a birth date this round (we
--     stop asking after 3, so an auto-reply can't loop).
--   * Anyone already opted in without a confirmed age (only Chad's test phone
--     today) is moved to pending_age — they'll be asked for their birth date
--     the next time they text JOIN.

alter table public.sms_contacts drop constraint if exists sms_contacts_status_check;
alter table public.sms_contacts
  add constraint sms_contacts_status_check
  check (status in ('opted_in', 'opted_out', 'pending_age', 'under_21'));

alter table public.sms_contacts add column if not exists age_verified_at timestamptz;
alter table public.sms_contacts add column if not exists age_method text;
alter table public.sms_contacts drop constraint if exists sms_contacts_age_method_check;
alter table public.sms_contacts
  add constraint sms_contacts_age_method_check
  check (age_method is null or age_method in ('keyword', 'web_form'));
alter table public.sms_contacts add column if not exists age_asks integer not null default 0;

update public.sms_contacts
set status = 'pending_age', updated_at = now()
where status = 'opted_in' and age_verified_at is null;

comment on column public.sms_contacts.status is
  'opted_in = signed up AND confirmed 21+ (the only people ever texted); pending_age = asked for birth date, not signed up yet; under_21 = gave an under-21 birth date, blocked; opted_out = replied STOP.';
comment on column public.sms_contacts.age_verified_at is
  'When this person confirmed they are 21+ (birth date by text, or on the web form). Required for opted_in.';
