-- Sales → POS → Black History Month (added 2026-11-17, per Chad: "we need to
-- add a Black History Month POS into the POS section, that works the same way
-- the football section works"). Same as pos_football_files: one flat file
-- library with previews and downloads, its own private storage bucket.
-- Run once in Supabase's SQL Editor before pushing the code. Safe to re-run.
-- Access: the "bhm_pos" checkbox (Admin → Users, under POS).
-- Everyone who has Football POS today gets it too (step 4).

-- 1. The file list
create table if not exists pos_bhm_files (
  id uuid primary key default gen_random_uuid(),
  file_name text not null,
  storage_path text,
  external_url text,
  preview_path text,
  mime_type text,
  size_bytes bigint,
  uploaded_by uuid references profiles(id),
  uploaded_at timestamptz not null default now()
);

alter table pos_bhm_files enable row level security;

drop policy if exists "pos_bhm_files_section" on pos_bhm_files;
create policy "pos_bhm_files_section" on pos_bhm_files for all using (
  has_section(auth.uid(), 'bhm_pos')
) with check (
  has_section(auth.uid(), 'bhm_pos')
);

comment on table pos_bhm_files is
  'Sales → POS → Black History Month: Black History Month POS files (posters, tap hangers, shelf strips, sales sheets). Files live in the pos-bhm-files storage bucket. Access: bhm_pos.';

-- 2. Live updates on the page
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'pos_bhm_files'
  ) then
    alter publication supabase_realtime add table pos_bhm_files;
  end if;
end $$;

-- 3. Its own private storage bucket
insert into storage.buckets (id, name, public)
values ('pos-bhm-files', 'pos-bhm-files', false)
on conflict (id) do nothing;

drop policy if exists "pos_bhm_files_bucket_section" on storage.objects;
create policy "pos_bhm_files_bucket_section" on storage.objects for all using (
  bucket_id = 'pos-bhm-files' and has_section(auth.uid(), 'bhm_pos')
) with check (
  bucket_id = 'pos-bhm-files' and has_section(auth.uid(), 'bhm_pos')
);

-- 4. Everyone with Football POS gets Black History Month
insert into user_section_access (user_id, section_key)
select user_id, 'bhm_pos'
from user_section_access
where section_key = 'football_pos'
on conflict (user_id, section_key) do nothing;
