-- POS > Sales Sheets (2026-11-10, per Chad) — FCB / Speakeasy / Sonoma Cider
-- sales sheets with previews and downloads, set up like Football POS
-- (sql/pos_football_files.sql) plus a brand column.
-- Run once in Supabase's SQL Editor, before the code push. Safe to re-run.
--
-- Access: the new "sales_sheets" checkbox (Admin → Users, under POS).
-- Everyone who has Football POS today gets it too (step 4).

-- 1. The file list
create table if not exists pos_sales_sheet_files (
  id uuid primary key default gen_random_uuid(),
  brand text not null check (brand in ('fcb', 'speakeasy', 'sonoma-cider')),
  file_name text not null,
  storage_path text,
  external_url text,
  preview_path text,
  mime_type text,
  size_bytes bigint,
  uploaded_by uuid references profiles(id),
  uploaded_at timestamptz not null default now()
);

create index if not exists pos_sales_sheet_files_brand_idx on pos_sales_sheet_files (brand, uploaded_at desc);

alter table pos_sales_sheet_files enable row level security;

drop policy if exists "pos_sales_sheet_files_section" on pos_sales_sheet_files;
create policy "pos_sales_sheet_files_section" on pos_sales_sheet_files for all using (
  has_section(auth.uid(), 'sales_sheets')
) with check (
  has_section(auth.uid(), 'sales_sheets')
);

comment on table pos_sales_sheet_files is
  'Sales → POS → Sales Sheets: sales sheet files per brand (fcb, speakeasy, sonoma-cider). Files live in the pos-sales-sheet-files storage bucket under <brand>/. Access: sales_sheets.';

-- 2. Live updates on the page
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'pos_sales_sheet_files'
  ) then
    alter publication supabase_realtime add table pos_sales_sheet_files;
  end if;
end $$;

-- 3. Its own private storage bucket
insert into storage.buckets (id, name, public)
values ('pos-sales-sheet-files', 'pos-sales-sheet-files', false)
on conflict (id) do nothing;

drop policy if exists "pos_sales_sheet_files_bucket_section" on storage.objects;
create policy "pos_sales_sheet_files_bucket_section" on storage.objects for all using (
  bucket_id = 'pos-sales-sheet-files' and has_section(auth.uid(), 'sales_sheets')
) with check (
  bucket_id = 'pos-sales-sheet-files' and has_section(auth.uid(), 'sales_sheets')
);

-- 4. Everyone with Football POS gets Sales Sheets
insert into user_section_access (user_id, section_key)
select user_id, 'sales_sheets'
from user_section_access
where section_key = 'football_pos'
on conflict (user_id, section_key) do nothing;
