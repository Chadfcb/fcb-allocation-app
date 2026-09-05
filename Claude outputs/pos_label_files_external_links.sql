-- Lets a Labels entry point to an external link (e.g. Google Drive) instead
-- of an uploaded file, for artwork too large for Supabase Storage on the
-- free plan (50MB cap). Run this once in the SQL Editor.

alter table pos_label_files
  alter column storage_path drop not null;

alter table pos_label_files
  add column if not exists external_url text;

alter table pos_label_files
  drop constraint if exists pos_label_files_path_or_url_check;

alter table pos_label_files
  add constraint pos_label_files_path_or_url_check
  check (storage_path is not null or external_url is not null);
