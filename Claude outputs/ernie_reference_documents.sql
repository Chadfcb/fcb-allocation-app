-- Ernie > Reference Documents — a durable place for Chad + Claude to drop
-- context about the app itself (specs, decisions, screenshots, anything
-- that isn't "app data" but that Ernie should be able to see) so it
-- doesn't only ever live on Chad's computer or inside one conversation.
-- Added 2026-09-09 per Chad: he explicitly does NOT want a general
-- upload feature here — this is not a team upload area, it's a place he
-- and Claude populate deliberately when something new gets built, the
-- same way sql/pos_football_files.sql's bucket+table pair works.
--
-- No new Ernie tool needed for this. get_file_for_download is already a
-- generic bucket+path fetcher (see lib/ernie/tools.ts), and
-- run_read_only_query already reaches any table in this database — this
-- migration just gives Ernie a table+bucket to find things in. Dropping a
-- new file in later is a plain SQL insert + storage upload, nothing to
-- build or deploy.
--
-- Run this once in Supabase's SQL Editor. Idempotent — safe to re-run.

create table if not exists ernie_reference_documents (
  id uuid primary key default gen_random_uuid(),
  file_name text not null,
  storage_path text not null,
  -- What this file is / why it's here — Ernie reads this to decide
  -- whether a document is relevant without having to open every file.
  description text,
  mime_type text,
  size_bytes bigint,
  added_by uuid references profiles(id),
  created_at timestamptz not null default now()
);

alter table ernie_reference_documents enable row level security;

-- Readable by any signed-in user — this is general reference context,
-- not gated to a specific page/section like pos_labels or events are.
-- Tighten to has_section(...) later if some future document needs to be
-- restricted.
drop policy if exists "ernie_reference_documents_select" on ernie_reference_documents;
create policy "ernie_reference_documents_select" on ernie_reference_documents for select using (
  auth.uid() is not null
);

-- Writes are admin-only. There is no app UI for this today — Chad/Claude
-- add rows directly (Supabase SQL Editor, or the service-role key) — this
-- policy just keeps the door closed for everyone else in case a UI is
-- ever added later.
drop policy if exists "ernie_reference_documents_write" on ernie_reference_documents;
create policy "ernie_reference_documents_write" on ernie_reference_documents for all using (
  exists (select 1 from profiles where id = auth.uid() and role = 'admin')
) with check (
  exists (select 1 from profiles where id = auth.uid() and role = 'admin')
);

-- Its own bucket, kept separate from pos-label-files/event-materials so
-- its access policy is independent of theirs.
insert into storage.buckets (id, name, public)
values ('reference-docs', 'reference-docs', false)
on conflict (id) do nothing;

drop policy if exists "ernie_reference_documents_bucket_select" on storage.objects;
create policy "ernie_reference_documents_bucket_select" on storage.objects for select using (
  bucket_id = 'reference-docs' and auth.uid() is not null
);

drop policy if exists "ernie_reference_documents_bucket_write" on storage.objects;
create policy "ernie_reference_documents_bucket_write" on storage.objects for all using (
  bucket_id = 'reference-docs'
  and exists (select 1 from profiles where id = auth.uid() and role = 'admin')
) with check (
  bucket_id = 'reference-docs'
  and exists (select 1 from profiles where id = auth.uid() and role = 'admin')
);
