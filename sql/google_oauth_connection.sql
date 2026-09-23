-- Google sign-in connection for FCB-Data — the app acts as Ernie's own
-- Google account (ernie@fullcirclebrewing.com). Added 2026-09-23.
-- Safe to run more than once.
--
-- Why: FCB's Workspace doesn't allow giving an outside "robot" (service
-- account) edit access to calendars, and changing that needs a Super
-- Admin. Ernie's account is a normal FCB account, so it can be shared the
-- Outside/Off Site Events Calendar like any coworker. Someone signs in as
-- ernie@ once ("Connect Google" on the Events page) and this stores the
-- long-lived connection token. No policies = server-only; the token never
-- reaches a browser.

create table if not exists public.google_oauth_connection (
  connection_key text primary key,            -- 'default'
  account_email text not null,
  refresh_token text not null,
  scopes text,
  connected_by uuid references auth.users (id) on delete set null,
  connected_at timestamptz not null default now()
);

alter table public.google_oauth_connection enable row level security;
-- (intentionally no policies: server-only)
