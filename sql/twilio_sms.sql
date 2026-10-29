-- Twilio texting — text sign-ups (opt-ins / opt-outs) and the message log.
-- Added 2026-10-29, per Chad (claude/twilio-texting-notes.md).
--
-- Run this ONCE in Supabase's SQL Editor BEFORE pushing the code.
-- Idempotent — safe to run more than once.
--
-- How sign-ups get in here (no one types them in by hand):
--   * Text-to-join: a buyer texts JOIN to (559) 478-0269 → Twilio calls
--     /api/twilio/incoming → that route (service role) adds/updates the row.
--   * Web form backup: /sms-signup → /api/sms-signup (service role).
--   * STOP (and the other carrier stop words) marks the row opted_out.
-- In the app (Twilio → Text Sign-ups) people with the "twilio" section can
-- read everything and edit name / business / linked account / rep / notes.
-- Nobody in the app can insert or delete — the consent record stays intact.

create table if not exists public.sms_contacts (
  id uuid primary key default gen_random_uuid(),
  phone text not null unique,                 -- E.164, e.g. +15595551234
  name text,
  business text,
  outlet_id text,                             -- sales_accounts.outlet_id (no FK: accounts are re-imported)
  rep_name text,
  status text not null default 'opted_in' check (status in ('opted_in', 'opted_out')),
  opt_in_method text check (opt_in_method in ('keyword', 'web_form')),
  opt_in_keyword text,                        -- e.g. JOIN
  opt_in_at timestamptz,
  consent_text text,                          -- the exact wording they agreed to / were sent
  opt_out_at timestamptz,
  opt_out_keyword text,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists sms_contacts_outlet_idx on public.sms_contacts (outlet_id);
create index if not exists sms_contacts_status_idx on public.sms_contacts (status);

create table if not exists public.sms_messages (
  id bigint generated always as identity primary key,
  direction text not null check (direction in ('inbound', 'outbound')),
  from_phone text not null,
  to_phone text not null,
  body text,
  twilio_sid text,
  kind text,                                  -- join | stop | help | start | reply | signup_confirm | other
  contact_id uuid references public.sms_contacts(id) on delete set null,
  created_at timestamptz not null default now()
);
create index if not exists sms_messages_contact_idx on public.sms_messages (contact_id, created_at desc);
create index if not exists sms_messages_created_idx on public.sms_messages (created_at desc);

alter table public.sms_contacts enable row level security;
alter table public.sms_messages enable row level security;

drop policy if exists "sms_contacts_select" on public.sms_contacts;
create policy "sms_contacts_select" on public.sms_contacts for select
  using (public.has_section(auth.uid(), 'twilio'));

drop policy if exists "sms_contacts_update" on public.sms_contacts;
create policy "sms_contacts_update" on public.sms_contacts for update
  using (public.has_section(auth.uid(), 'twilio'))
  with check (public.has_section(auth.uid(), 'twilio'));

drop policy if exists "sms_messages_select" on public.sms_messages;
create policy "sms_messages_select" on public.sms_messages for select
  using (public.has_section(auth.uid(), 'twilio'));

-- In the app, only these fields are editable — phone, status and the consent
-- record (method, keyword, times, wording) can only be changed by the
-- Twilio webhook / sign-up form (service role).
revoke update on public.sms_contacts from authenticated;
grant update (name, business, outlet_id, rep_name, notes, updated_at) on public.sms_contacts to authenticated;
