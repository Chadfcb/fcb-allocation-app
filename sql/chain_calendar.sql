-- Chain Calendar — a second calendar alongside Events Calendar, for
-- chain/retail account activity (demos, resets, ads, displays) rather than
-- FCB's own off-site events. Added 2026-09-04, per Chad: "add the calendar
-- to the chain calendar, with the same abilities as the events calendar."
-- Run this once in Supabase's SQL Editor, before the matching code deploy.
-- Idempotent — safe to re-run.
--
-- Structure mirrors events/event_materials exactly (see supabase/
-- schema.sql), just under new table names so the two calendars' events
-- never mix. The POS Materials Library (pos_library) and the
-- "event-materials" storage bucket are SHARED with Events Calendar (per
-- Chad — no new library/bucket needed); only chain_events/
-- chain_event_materials themselves are new/separate. Deliberately has NO
-- distributor association — per Chad, 2026-09-05: "remove the
-- distributors from the chain calendar" (it originally did, matching
-- Events Calendar; now matches Social Media Calendar instead).
--
-- Access: gated by the existing "events_calendar" section, same as Events
-- Calendar and the Chain Calendar placeholder page already were — nothing
-- new to grant, anyone with Events Calendar access already sees this too.

create table if not exists chain_events (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  start_date date not null,
  end_date date,
  time_label text,
  type text not null default 'other'
    check (type in ('demo', 'reset', 'ad', 'display', 'other')),
  location text,
  rep text,
  color text,
  notes text,
  created_by uuid references profiles(id),
  updated_by uuid references profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists chain_events_start_date_idx on chain_events (start_date);

-- Idempotent: adds the per-event color column for rows created before the
-- color picker existed. No-op if the column is already there (fresh run).
alter table chain_events add column if not exists color text;

-- Idempotent safety net: this table was originally created WITH a
-- distributor_id column (see the earlier version of this file) — drop it
-- now that Chain Calendar no longer has a distributor association. No-op
-- on a fresh run where the column was never created.
alter table chain_events drop column if exists distributor_id;

-- POS materials attached to one specific chain event — same pattern as
-- event_materials, and stored in the SAME "event-materials" bucket (paths
-- are namespaced by event id, which is unique across both tables, so
-- there's no collision risk sharing the bucket).
create table if not exists chain_event_materials (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references chain_events(id) on delete cascade,
  file_name text not null,
  storage_path text not null,
  mime_type text,
  size_bytes bigint,
  uploaded_by uuid references profiles(id),
  uploaded_at timestamptz not null default now()
);
create index if not exists chain_event_materials_event_idx on chain_event_materials (event_id);

alter table chain_events enable row level security;
alter table chain_event_materials enable row level security;

drop policy if exists "chain_events_section" on chain_events;
create policy "chain_events_section" on chain_events for all using (
  has_section(auth.uid(), 'events_calendar')
);

drop policy if exists "chain_event_materials_section" on chain_event_materials;
create policy "chain_event_materials_section" on chain_event_materials for all using (
  has_section(auth.uid(), 'events_calendar')
);

-- Realtime, same as events/event_materials.
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'chain_events'
  ) then
    alter publication supabase_realtime add table chain_events;
  end if;
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'chain_event_materials'
  ) then
    alter publication supabase_realtime add table chain_event_materials;
  end if;
end $$;
