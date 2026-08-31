-- Ernie file uploads — lets Ernie read, and for spreadsheets/CSV actually
-- edit, files a signed-in user attaches in the chat (drag-and-drop or the
-- attach button), and persists them the same way conversation history does
-- so reopening an old chat still shows what was attached. Available to
-- every signed-in user (Basic and admin alike), matching Ernie itself —
-- NOT admin-only like event-materials/pos-label-files, since a file
-- someone uploads is their own, not shared app data.
--
-- Idempotent — safe to re-run.

-- =========================================================
-- Storage — private "ernie-files" bucket. Objects are stored at
-- "<user_id>/<filename>", and the policy below only lets a user read/write
-- objects under their OWN user-id folder (storage.foldername(name) splits
-- the object path on "/" and returns it as an array — this is the standard
-- Supabase pattern for "everyone can only touch their own folder").
-- =========================================================
insert into storage.buckets (id, name, public)
values ('ernie-files', 'ernie-files', false)
on conflict (id) do nothing;

drop policy if exists "ernie_files_bucket_owner" on storage.objects;
create policy "ernie_files_bucket_owner" on storage.objects for all using (
  bucket_id = 'ernie-files'
  and (storage.foldername(name))[1] = auth.uid()::text
) with check (
  bucket_id = 'ernie-files'
  and (storage.foldername(name))[1] = auth.uid()::text
);

-- =========================================================
-- Metadata table — one row per file, whether it's something the user
-- uploaded ('upload') or something Ernie produced/edited and handed back
-- ('output', e.g. an edited spreadsheet). source_file_id links an 'output'
-- row back to the 'upload' (or earlier 'output') it was derived from, so a
-- chain of edits stays traceable.
-- =========================================================
create table if not exists ernie_files (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  direction text not null check (direction in ('upload', 'output')),
  source_file_id uuid references ernie_files(id) on delete set null,
  file_name text not null,
  mime_type text,
  size_bytes bigint,
  storage_path text not null,
  created_at timestamptz not null default now()
);

create index if not exists ernie_files_user_id_created_at_idx
  on ernie_files (user_id, created_at desc);

alter table ernie_files enable row level security;

drop policy if exists "ernie_files_owner" on ernie_files;
create policy "ernie_files_owner" on ernie_files for all using (
  user_id = auth.uid()
) with check (
  user_id = auth.uid()
);

-- =========================================================
-- Which files (if any) are attached to a given chat message — a user
-- message's file_ids are what they attached; an assistant message's
-- file_ids are whatever Ernie produced that turn (e.g. an edited
-- spreadsheet), so a download chip can be shown next to either.
-- =========================================================
alter table ernie_messages add column if not exists file_ids uuid[] not null default '{}';
