-- Two-way Google Calendar sync — first calendar: Events Calendar <->
-- Google "Outside/Off Site Events Calendar". Added 2026-09-23.
-- Safe to run more than once.
--
-- What this adds:
--   1. google_calendar_sync — one row per synced calendar (the "settings
--      entry" — adding a future calendar is another row). Holds the Google
--      calendar id, sync progress, and a random secret the app uses to
--      trust calls between Supabase, Google, and FCB-Data. No policies, so
--      only the server (service role) can read it — the secret never
--      reaches a browser.
--   2. New columns on events to remember which Google event each app event
--      is linked to.
--   3. A trigger that, whenever an event is added/edited/deleted in the app
--      (Events page, Ernie, Slack Ernie — anything), tells FCB-Data to send
--      that change to Google. It does nothing until the first sync has been
--      approved on the Events page, and it ignores changes that CAME from
--      Google (so nothing ping-pongs back and forth).
--   4. Two small functions the sync uses to write Google's changes into the
--      app without re-triggering the above.

create extension if not exists pg_net;
create extension if not exists pgcrypto;

-- 1. Settings / state per synced calendar -------------------------------
create table if not exists public.google_calendar_sync (
  calendar_key text primary key,              -- 'events'
  google_calendar_id text not null,
  enabled boolean not null default true,
  initial_sync_done boolean not null default false,
  sync_token text,
  channel_id text,
  channel_resource_id text,
  channel_expires_at timestamptz,
  push_url text not null,
  secret text not null default encode(gen_random_bytes(24), 'hex'),
  last_pull_at timestamptz,
  last_push_at timestamptz,
  last_error text,
  updated_at timestamptz not null default now()
);

alter table public.google_calendar_sync enable row level security;
-- (intentionally no policies: server-only)

insert into public.google_calendar_sync (calendar_key, google_calendar_id, push_url)
values (
  'events',
  'c_b48cdedb64a52c56d1216a7ed938e3d9345dc67ca9a3ffd240d667a8aafbe540@group.calendar.google.com',
  'https://www.fcb-data.com/api/google-calendar/hook/push'
)
on conflict (calendar_key) do nothing;

-- 2. Link columns on events ---------------------------------------------
alter table public.events add column if not exists google_event_id text;
alter table public.events add column if not exists google_etag text;
alter table public.events add column if not exists google_updated_at timestamptz;
-- A timed event created in Google (e.g. 3:00–6:00 PM) keeps its exact
-- Google start/end here, so sending it back doesn't turn it into all-day.
alter table public.events add column if not exists google_time jsonb;
alter table public.events add column if not exists google_time_label text;

create unique index if not exists events_google_event_id_key
  on public.events (google_event_id) where google_event_id is not null;

-- 3. App -> Google trigger ----------------------------------------------
create or replace function public.events_google_sync_notify()
returns trigger
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  cfg public.google_calendar_sync%rowtype;
  body jsonb;
begin
  -- Changes written by the sync itself (coming FROM Google) are skipped.
  if coalesce(current_setting('app.google_sync', true), '') = 'on' then
    return coalesce(new, old);
  end if;

  select * into cfg from public.google_calendar_sync where calendar_key = 'events';
  if not found or not cfg.enabled or not cfg.initial_sync_done then
    return coalesce(new, old);
  end if;

  if tg_op = 'DELETE' then
    if old.google_event_id is null then
      return old;
    end if;
    body := jsonb_build_object('calendar_key', 'events', 'op', 'delete', 'event_id', old.id, 'google_event_id', old.google_event_id);
  else
    -- Only real content changes, not bookkeeping-only updates.
    if tg_op = 'UPDATE'
      and new.title is not distinct from old.title
      and new.start_date is not distinct from old.start_date
      and new.end_date is not distinct from old.end_date
      and new.time_label is not distinct from old.time_label
      and new.type is not distinct from old.type
      and new.location is not distinct from old.location
      and new.distributor_id is not distinct from old.distributor_id
      and new.rep is not distinct from old.rep
      and new.notes is not distinct from old.notes then
      return new;
    end if;
    body := jsonb_build_object('calendar_key', 'events', 'op', 'upsert', 'event_id', new.id);
  end if;

  perform net.http_post(
    url := cfg.push_url,
    body := body,
    headers := jsonb_build_object('content-type', 'application/json', 'x-fcb-sync-secret', cfg.secret),
    timeout_milliseconds := 10000
  );
  return coalesce(new, old);
end;
$$;

drop trigger if exists events_google_sync_notify on public.events;
create trigger events_google_sync_notify
  after insert or update or delete on public.events
  for each row execute function public.events_google_sync_notify();

-- 4. Writes coming FROM Google (skip the trigger above) ------------------
-- Upsert one event. p_id null = create. Returns the event id.
create or replace function public.google_sync_apply_event(p_id uuid, p_row jsonb)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
begin
  perform set_config('app.google_sync', 'on', true);
  if p_id is null then
    insert into public.events (title, start_date, end_date, time_label, type, location, distributor_id, rep, notes,
                               google_event_id, google_etag, google_updated_at, google_time, google_time_label)
    values (
      p_row->>'title',
      (p_row->>'start_date')::date,
      nullif(p_row->>'end_date', '')::date,
      nullif(p_row->>'time_label', ''),
      coalesce(nullif(p_row->>'type', ''), 'other'),
      nullif(p_row->>'location', ''),
      nullif(p_row->>'distributor_id', '')::uuid,
      nullif(p_row->>'rep', ''),
      nullif(p_row->>'notes', ''),
      p_row->>'google_event_id',
      p_row->>'google_etag',
      nullif(p_row->>'google_updated_at', '')::timestamptz,
      case when p_row ? 'google_time' and jsonb_typeof(p_row->'google_time') = 'object' then p_row->'google_time' else null end,
      nullif(p_row->>'google_time_label', '')
    )
    returning id into v_id;
  else
    update public.events set
      title = case when p_row ? 'title' then p_row->>'title' else title end,
      start_date = case when p_row ? 'start_date' then (p_row->>'start_date')::date else start_date end,
      end_date = case when p_row ? 'end_date' then nullif(p_row->>'end_date', '')::date else end_date end,
      time_label = case when p_row ? 'time_label' then nullif(p_row->>'time_label', '') else time_label end,
      type = case when p_row ? 'type' then coalesce(nullif(p_row->>'type', ''), type) else type end,
      location = case when p_row ? 'location' then nullif(p_row->>'location', '') else location end,
      distributor_id = case when p_row ? 'distributor_id' then nullif(p_row->>'distributor_id', '')::uuid else distributor_id end,
      rep = case when p_row ? 'rep' then nullif(p_row->>'rep', '') else rep end,
      notes = case when p_row ? 'notes' then nullif(p_row->>'notes', '') else notes end,
      google_event_id = case when p_row ? 'google_event_id' then p_row->>'google_event_id' else google_event_id end,
      google_etag = case when p_row ? 'google_etag' then p_row->>'google_etag' else google_etag end,
      google_updated_at = case when p_row ? 'google_updated_at' then nullif(p_row->>'google_updated_at', '')::timestamptz else google_updated_at end,
      google_time = case when p_row ? 'google_time' then (case when jsonb_typeof(p_row->'google_time') = 'object' then p_row->'google_time' else null end) else google_time end,
      google_time_label = case when p_row ? 'google_time_label' then nullif(p_row->>'google_time_label', '') else google_time_label end,
      updated_at = case when p_row ? 'title' or p_row ? 'start_date' or p_row ? 'notes' then now() else updated_at end
    where id = p_id
    returning id into v_id;
  end if;
  return v_id;
end;
$$;

create or replace function public.google_sync_delete_event(p_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  perform set_config('app.google_sync', 'on', true);
  delete from public.events where id = p_id;
end;
$$;

-- Only the server (service role) may call these.
revoke all on function public.google_sync_apply_event(uuid, jsonb) from public, anon, authenticated;
revoke all on function public.google_sync_delete_event(uuid) from public, anon, authenticated;
grant execute on function public.google_sync_apply_event(uuid, jsonb) to service_role;
grant execute on function public.google_sync_delete_event(uuid) to service_role;
