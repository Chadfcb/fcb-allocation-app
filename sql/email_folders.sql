-- Email Studio — folders (added 2026-11-06, per Chad: "yes", after Eddie
-- asked for "a file system for the gallery project area … so we can put all
-- the oobli emails in one folder"). See claude/email-designer-plan.md.
--
-- Run this ONCE in Supabase's SQL Editor BEFORE pushing the code.
-- Safe to run more than once.
--
-- One shared list of folders, used on both the Emails tab and the Creative
-- Library tab. An email or file is in one folder or none. Deleting a folder
-- never deletes what's in it — those go back to "No folder".

create table if not exists public.email_folders (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(btrim(name)) > 0),
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now()
);
create unique index if not exists email_folders_name_key on public.email_folders (lower(btrim(name)));

alter table public.email_folders enable row level security;

drop policy if exists "email_folders_section" on public.email_folders;
create policy "email_folders_section" on public.email_folders for all
  using (public.has_section(auth.uid(), 'email_studio'))
  with check (public.has_section(auth.uid(), 'email_studio'));

grant select, insert, update, delete on public.email_folders to authenticated;
grant select, insert, update, delete on public.email_folders to service_role;

comment on table public.email_folders is
  'Email Studio folders (e.g. "Oobli") that group saved email designs (email_designs.folder_id) and Creative Library files (creative_assets.folder_id) — use for "which emails / pictures are in the X folder".';

alter table public.email_designs add column if not exists folder_id uuid references public.email_folders(id) on delete set null;
alter table public.creative_assets add column if not exists folder_id uuid references public.email_folders(id) on delete set null;
create index if not exists email_designs_folder_idx on public.email_designs (folder_id);
create index if not exists creative_assets_folder_idx on public.creative_assets (folder_id);
