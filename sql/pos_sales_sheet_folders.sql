-- Sales → POS → Sales Sheets — folders (added 2026-11-11, per Chad: "execute",
-- after Eddie asked "maybe we can give it that same folder to file set up? so
-- we can create a file for distros, chains, and so on"). Same setup as Email
-- Studio's folders (sql/email_folders.sql).
--
-- Run this ONCE in Supabase's SQL Editor BEFORE pushing the code.
-- Safe to run more than once.
--
-- One shared folder list used under all three brands (FCB, Speakeasy, Sonoma
-- Cider). A sales sheet is in one folder or none. Deleting a folder never
-- deletes the sheets in it — they go back to "No folder".
-- Access: same "sales_sheets" checkbox as the page (Admin → Users, under POS).

-- 1. The folder list
create table if not exists public.pos_sales_sheet_folders (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(btrim(name)) > 0),
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now()
);
create unique index if not exists pos_sales_sheet_folders_name_key
  on public.pos_sales_sheet_folders (lower(btrim(name)));

alter table public.pos_sales_sheet_folders enable row level security;

drop policy if exists "pos_sales_sheet_folders_section" on public.pos_sales_sheet_folders;
create policy "pos_sales_sheet_folders_section" on public.pos_sales_sheet_folders for all
  using (public.has_section(auth.uid(), 'sales_sheets'))
  with check (public.has_section(auth.uid(), 'sales_sheets'));

grant select, insert, update, delete on public.pos_sales_sheet_folders to authenticated;
grant select, insert, update, delete on public.pos_sales_sheet_folders to service_role;

comment on table public.pos_sales_sheet_folders is
  'Sales → POS → Sales Sheets folders (e.g. "Distributors", "Chains"), shared by all three brands. Sheets point to a folder with pos_sales_sheet_files.folder_id — use for "which sales sheets are in the X folder". Access: sales_sheets.';

-- 2. Which folder each sales sheet is in (empty = No folder)
alter table public.pos_sales_sheet_files
  add column if not exists folder_id uuid references public.pos_sales_sheet_folders(id) on delete set null;
create index if not exists pos_sales_sheet_files_folder_idx on public.pos_sales_sheet_files (folder_id);

-- 3. Live updates on the page when someone adds/renames/deletes a folder
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'pos_sales_sheet_folders'
  ) then
    alter publication supabase_realtime add table public.pos_sales_sheet_folders;
  end if;
end $$;
