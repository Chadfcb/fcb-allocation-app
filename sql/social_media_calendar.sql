-- Social Media Calendar — a third calendar alongside Events Calendar and
-- Chain Calendar, for planning social media content (posts, campaigns,
-- stories, promotions). Added 2026-09-04, per Chad: "add the social media
-- calendar as well, same thing." Run this once in Supabase's SQL Editor,
-- before the matching code deploy. Idempotent — safe to re-run.
--
-- Structure mirrors events/event_materials and chain_events/
-- chain_event_materials exactly (see supabase/schema.sql and
-- sql/chain_calendar.sql), just under new table names so none of the
-- three calendars' events ever mix. Distributor color-coding, the POS
-- Materials Library (pos_library), and the "event-materials" storage
-- bucket are all SHARED across all three calendars (per Chad) — only
-- social_media_events/social_media_event_materials themselves are
-- new/separate.
--
-- Access: gated by the existing "events_calendar" section, same as Events
-- Calendar, Chain Calendar, and the Social Media Calendar placeholder page
-- already were — nothing new to grant.

create table if not exists social_media_events (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  start_date date not null,
  end_date date,
  time_label text,
  type text not null default 'other'
    check (type in ('post', 'campaign', 'story', 'promotion', 'other')),
  location text,
  distributor_id uuid references distributors(id) on delete set null,
  rep text,
  notes text,
  created_by uuid references profiles(id),
  updated_by uuid references profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists social_media_events_start_date_idx on social_media_events (start_date);

-- POS materials attached to one specific social media event — same
-- pattern as event_materials/chain_event_materials, stored in the SAME
-- "event-materials" bucket (paths are namespaced by event id, which is
-- unique across all three event tables, so there's no collision risk
-- sharing the bucket).
create table if not exists social_media_event_materials (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references social_media_events(id) on delete cascade,
  file_name text not null,
  storage_path text not null,
  mime_type text,
  size_bytes bigint,
  uploaded_by uuid references profiles(id),
  uploaded_at timestamptz not null default now()
);
create index if not exists social_media_event_materials_event_idx on social_media_event_materials (event_id);

alter table social_media_events enable row level security;
alter table social_media_event_materials enable row level security;

drop policy if exists "social_media_events_section" on social_media_events;
create policy "social_media_events_section" on social_media_events for all using (
  has_section(auth.uid(), 'events_calendar')
);

drop policy if exists "social_media_event_materials_section" on social_media_event_materials;
create policy "social_media_event_materials_section" on social_media_event_materials for all using (
  has_section(auth.uid(), 'events_calendar')
);

-- Realtime, same as events/event_materials and chain_events/chain_event_materials.
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'social_media_events'
  ) then
    alter publication supabase_realtime add table social_media_events;
  end if;
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'social_media_event_materials'
  ) then
    alter publication supabase_realtime add table social_media_event_materials;
  end if;
end $$;
