-- Distributor Files (2026-11-12, per Chad: "in the localist section, id like a
-- button at the top, that looks different from the others, where we can drag
-- and drop files into it ... lets do that for all distributors").
-- A drag-and-drop file box at the top of every distributor page. Each
-- distributor keeps its own files.
-- Run once in Supabase's SQL Editor, before the code push. Safe to re-run.
--
-- Access: anyone who can open that distributor's page (its dist_<name>
-- checkbox in Admin → Users) can see, upload and delete its files.

-- 1. The file list
create table if not exists distributor_files (
  id uuid primary key default gen_random_uuid(),
  dist text not null,                 -- distributor name as on the page, e.g. 'The Localist'
  file_name text not null,
  storage_path text not null,         -- '<page slug>/<timestamp>_<name>' in the distributor-files bucket
  mime_type text,
  size_bytes bigint,
  uploaded_by uuid references profiles(id),
  uploaded_by_name text,
  uploaded_at timestamptz not null default now()
);

create index if not exists distributor_files_dist_idx on distributor_files (dist, uploaded_at desc);

alter table distributor_files enable row level security;

drop policy if exists "distributor_files_page" on distributor_files;
create policy "distributor_files_page" on distributor_files for all using (
  has_section(auth.uid(), public.dist_section(dist))
) with check (
  has_section(auth.uid(), public.dist_section(dist))
);

grant select, insert, update, delete on distributor_files to authenticated;

comment on table distributor_files is
  'Distributors → <distributor> → Files box at the top of each distributor page: files dropped in for that distributor (account lists, price sheets, etc.). dist = distributor name (e.g. The Localist). Files live in the distributor-files storage bucket under <page slug>/ (the-localist, valley-wide, …). Access: that distributor''s page (dist_<name>).';

-- 2. Live updates on the page
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'distributor_files'
  ) then
    alter publication supabase_realtime add table distributor_files;
  end if;
end $$;

-- 3. Its own private storage bucket. The first folder in the path is the
-- page slug (the-localist → dist_the_localist).
insert into storage.buckets (id, name, public)
values ('distributor-files', 'distributor-files', false)
on conflict (id) do nothing;

drop policy if exists "distributor_files_bucket_page" on storage.objects;
create policy "distributor_files_bucket_page" on storage.objects for all using (
  bucket_id = 'distributor-files'
  and has_section(auth.uid(), 'dist_' || replace((storage.foldername(name))[1], '-', '_'))
) with check (
  bucket_id = 'distributor-files'
  and has_section(auth.uid(), 'dist_' || replace((storage.foldername(name))[1], '-', '_'))
);
