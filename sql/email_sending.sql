-- Email Studio — Phase 5: audiences + real sending (added 2026-10-29/30, per
-- Chad: email becomes the main new-item channel after Twilio rejected the
-- text campaign for alcohol content). See claude/email-designer-plan.md.
--
-- Run this ONCE in Supabase's SQL Editor BEFORE pushing the code.
-- Idempotent — safe to run more than once.
--
-- Access: the "email_studio" section (same as the designer). Writes that
-- record sends, deliveries, opens and unsubscribes come from the server
-- (service role) — nobody in the app can fake a send record.

-- =========================================================
-- Lists you import (Mailchimp) or build by hand. Account contacts aren't
-- copied here — they're read live from sales_account_contacts at send time.
-- =========================================================
create table if not exists public.email_lists (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  source text not null default 'manual' check (source in ('manual', 'mailchimp')),
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now()
);

create table if not exists public.email_list_members (
  list_id uuid not null references public.email_lists(id) on delete cascade,
  email text not null,
  name text,
  business text,
  added_at timestamptz not null default now(),
  primary key (list_id, email)
);
create index if not exists email_list_members_email_idx on public.email_list_members (email);

-- =========================================================
-- Suppressions: anyone here is NEVER emailed — unsubscribed (our link or a
-- Mailchimp unsubscribe import), bounced, or marked as spam. Lowercased.
-- =========================================================
create table if not exists public.email_suppressions (
  email text primary key,
  reason text not null check (reason in ('unsubscribed', 'bounced', 'spam_report', 'mailchimp_unsubscribed', 'manual')),
  source text,
  created_at timestamptz not null default now()
);

-- =========================================================
-- One row per send of a design ("campaign"), with a frozen copy of the
-- email as sent, and one row per recipient.
-- =========================================================
create table if not exists public.email_campaigns (
  id uuid primary key default gen_random_uuid(),
  design_id uuid references public.email_designs(id) on delete set null,
  name text not null,
  subject text not null,
  preheader text,
  from_name text not null,
  reply_to text,
  html_snapshot text not null,
  audience jsonb not null,
  status text not null default 'sending' check (status in ('sending', 'scheduled', 'sent', 'partial', 'failed')),
  scheduled_for timestamptz,
  recipient_count int not null default 0,
  sent_count int not null default 0,
  failed_count int not null default 0,
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  finished_at timestamptz
);
create index if not exists email_campaigns_created_idx on public.email_campaigns (created_at desc);

create table if not exists public.email_sends (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid not null references public.email_campaigns(id) on delete cascade,
  email text not null,
  name text,
  business text,
  outlet_id text,
  status text not null default 'queued' check (status in ('queued', 'accepted', 'failed')),
  error text,
  sg_message_id text,
  delivered_at timestamptz,
  opened_at timestamptz,
  clicked_at timestamptz,
  bounced_at timestamptz,
  spam_at timestamptz,
  unsubscribed_at timestamptz,
  created_at timestamptz not null default now(),
  unique (campaign_id, email)
);
create index if not exists email_sends_campaign_idx on public.email_sends (campaign_id);

alter table public.email_lists enable row level security;
alter table public.email_list_members enable row level security;
alter table public.email_suppressions enable row level security;
alter table public.email_campaigns enable row level security;
alter table public.email_sends enable row level security;

-- Lists: people with Email Studio manage them in the app.
drop policy if exists "email_lists_section" on public.email_lists;
create policy "email_lists_section" on public.email_lists for all
  using (public.has_section(auth.uid(), 'email_studio'))
  with check (public.has_section(auth.uid(), 'email_studio'));

drop policy if exists "email_list_members_section" on public.email_list_members;
create policy "email_list_members_section" on public.email_list_members for all
  using (public.has_section(auth.uid(), 'email_studio'))
  with check (public.has_section(auth.uid(), 'email_studio'));

-- Suppressions: readable in the app; added by the server, or by hand in the
-- app (never removed in the app — an unsubscribe has to stay honored).
drop policy if exists "email_suppressions_select" on public.email_suppressions;
create policy "email_suppressions_select" on public.email_suppressions for select
  using (public.has_section(auth.uid(), 'email_studio'));
drop policy if exists "email_suppressions_insert" on public.email_suppressions;
create policy "email_suppressions_insert" on public.email_suppressions for insert
  with check (public.has_section(auth.uid(), 'email_studio'));

-- Campaigns / sends: read-only in the app (the server writes them).
drop policy if exists "email_campaigns_select" on public.email_campaigns;
create policy "email_campaigns_select" on public.email_campaigns for select
  using (public.has_section(auth.uid(), 'email_studio'));
drop policy if exists "email_sends_select" on public.email_sends;
create policy "email_sends_select" on public.email_sends for select
  using (public.has_section(auth.uid(), 'email_studio'));

-- Per-campaign totals for the Sent tab (runs with the viewer's own access).
create or replace view public.email_campaign_stats with (security_invoker = true) as
select
  campaign_id,
  count(*)::int as recipients,
  count(*) filter (where status = 'accepted')::int as accepted,
  count(*) filter (where status = 'failed')::int as failed,
  count(delivered_at)::int as delivered,
  count(opened_at)::int as opened,
  count(clicked_at)::int as clicked,
  count(bounced_at)::int as bounced,
  count(spam_at)::int as spam_reports,
  count(unsubscribed_at)::int as unsubscribed
from public.email_sends
group by campaign_id;
