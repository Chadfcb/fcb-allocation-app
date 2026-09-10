-- Tracks the most recent successful Ekos sync (Purchase Orders or
-- Distributor Inventory) so the Dashboard can show "Last Ekos sync" under
-- Current Week. Added 2026-09-09, ahead of the Mon-Fri 5am scheduled sync,
-- so Chad has a way to confirm at a glance that an unattended run actually
-- completed.
--
-- Single-row table (id is always 1) rather than two separate timestamps —
-- either sync endpoint completing counts as "Ekos synced" for this
-- purpose; there was no ask to distinguish which kind ran last.
--
-- Idempotent — safe to run more than once.

create table if not exists ekos_sync_status (
  id smallint primary key default 1,
  last_synced_at timestamptz,
  constraint ekos_sync_status_singleton check (id = 1)
);

insert into ekos_sync_status (id) values (1)
on conflict (id) do nothing;

alter table ekos_sync_status enable row level security;

-- Anyone signed in can read it. The Dashboard itself is admin-only today,
-- but this keeps the policy simple and matches how other reference-style
-- tables are set up elsewhere in the app.
drop policy if exists "ekos_sync_status_read" on ekos_sync_status;
create policy "ekos_sync_status_read" on ekos_sync_status for select
  using (auth.uid() is not null);

-- Only admins write it — both sync routes already require
-- profile.role = 'admin' before doing anything, so this just lets that same
-- admin-authenticated request stamp the timestamp too.
drop policy if exists "ekos_sync_status_write_admin" on ekos_sync_status;
create policy "ekos_sync_status_write_admin" on ekos_sync_status for update
  using (exists (select 1 from profiles p where p.id = auth.uid() and p.role = 'admin'))
  with check (exists (select 1 from profiles p where p.id = auth.uid() and p.role = 'admin'));

-- Fixed 2026-09-10: both sync routes call .upsert({id: 1, ...}), which
-- Postgres runs as INSERT ... ON CONFLICT DO UPDATE. RLS enforces the
-- INSERT policy on that statement even though the conflict always routes it
-- to an UPDATE (the row is a permanent singleton, id=1, seeded above) — with
-- no INSERT policy at all, every sync's upsert was silently rejected by RLS,
-- so "Last Ekos sync" on the Dashboard stayed stuck on "Never synced yet"
-- forever despite both syncs actually completing. This just extends the
-- same admin-only check to INSERT.
drop policy if exists "ekos_sync_status_write_admin_insert" on ekos_sync_status;
create policy "ekos_sync_status_write_admin_insert" on ekos_sync_status for insert
  with check (exists (select 1 from profiles p where p.id = auth.uid() and p.role = 'admin'));
