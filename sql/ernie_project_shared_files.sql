-- Lets everyone in an Ernie Project's shared chat room actually see (and
-- download/preview) a file that shows up in that room — whether it's
-- something a teammate attached, or something Ernie generated/edited back
-- (an image, an edited spreadsheet, etc.) — not just the one person who
-- originally uploaded it or asked Ernie for it.
--
-- Added 2026-09-15, per Chad: "i also want everyone to see the files ernies
-- gives back, not just the user in the project." The room's own messages
-- (ernie_project_messages) were already visible to every project member —
-- but ernie_files itself (sql/ernie_files.sql) is locked to "user_id =
-- auth.uid()" only, and the ernie-files Storage bucket is locked to each
-- user's own "<user_id>/..." folder. So today, when Ernie hands a file back
-- to whoever asked for it, every OTHER person in that same shared room sees
-- the message text but no file chip at all — the client's query for that
-- file's metadata comes back empty for them, blocked by RLS.
--
-- This adds two ADDITIONAL, narrow policies (on top of the existing
-- owner-only ones, which are untouched and still apply everywhere else —
-- general/personal Ernie chat is completely unaffected): a project member
-- can SELECT an ernie_files row, or download/view its Storage object, if
-- that file's id is referenced in some ernie_project_messages row for a
-- Project they actually have access to. Postgres OR's multiple permissive
-- policies together, so this only ever ADDS visibility, never removes the
-- owner's existing full access to their own files.
--
-- Idempotent — safe to re-run.

drop policy if exists "ernie_files_visible_in_shared_project_room" on ernie_files;
create policy "ernie_files_visible_in_shared_project_room" on ernie_files for select using (
  exists (
    select 1
    from ernie_project_messages m
    join ernie_project_access a on a.project_id = m.project_id and a.user_id = auth.uid()
    where ernie_files.id = any(m.file_ids)
  )
  or exists (select 1 from profiles p where p.id = auth.uid() and p.role = 'admin')
);

drop policy if exists "ernie_files_bucket_visible_in_shared_project_room" on storage.objects;
create policy "ernie_files_bucket_visible_in_shared_project_room" on storage.objects for select using (
  bucket_id = 'ernie-files'
  and exists (
    select 1
    from ernie_files f
    join ernie_project_messages m on f.id = any(m.file_ids)
    join ernie_project_access a on a.project_id = m.project_id and a.user_id = auth.uid()
    where f.storage_path = storage.objects.name
  )
);
