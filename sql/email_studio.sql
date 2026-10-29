-- Email Studio (Admin → Email Studio) — Phase 1: email designs + Creative
-- Library. Added 2026-10-29, per Chad (claude/email-designer-plan.md): an area
-- where Eddie designs the emails FCB sends, with his image/file library.
--
-- Run this ONCE in Supabase's SQL Editor BEFORE pushing the code.
-- Idempotent — safe to run more than once.
--
-- Access: the new "email_studio" section (Admin → Users → Edit → Email
-- Studio). Admins always have it. Eddie gets only this.

-- =========================================================
-- Email designs. project_data = the designer's own saved design (so it
-- reopens exactly as left); html = the finished, email-ready HTML (styles
-- inlined) made on every save.
-- =========================================================
create table if not exists public.email_designs (
  id uuid primary key default gen_random_uuid(),
  name text not null default 'Untitled email',
  subject text,
  preheader text,
  project_data jsonb,
  html text,
  status text not null default 'draft' check (status in ('draft', 'ready', 'archived')),
  created_by uuid references public.profiles(id),
  updated_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists email_designs_updated_idx on public.email_designs (updated_at desc);

-- =========================================================
-- Creative Library — every file Eddie works with (images, GIFs, PSDs,
-- videos, PDFs). Files live in the public "creative-assets" storage bucket
-- (public so images show inside sent emails). source says where it came
-- from: upload today; ernie / canva / psd in later phases.
-- =========================================================
create table if not exists public.creative_assets (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  storage_path text not null unique,
  public_url text not null,
  mime_type text,
  size_bytes bigint,
  width int,
  height int,
  source text not null default 'upload',
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now()
);
create index if not exists creative_assets_created_idx on public.creative_assets (created_at desc);

alter table public.email_designs enable row level security;
alter table public.creative_assets enable row level security;

drop policy if exists "email_designs_section" on public.email_designs;
create policy "email_designs_section" on public.email_designs for all
  using (public.has_section(auth.uid(), 'email_studio'))
  with check (public.has_section(auth.uid(), 'email_studio'));

drop policy if exists "creative_assets_section" on public.creative_assets;
create policy "creative_assets_section" on public.creative_assets for all
  using (public.has_section(auth.uid(), 'email_studio'))
  with check (public.has_section(auth.uid(), 'email_studio'));

-- =========================================================
-- Storage bucket. Public = anyone with a file's link can view it (needed
-- for images inside emails). Only people with Email Studio can upload,
-- replace, delete or list files.
-- =========================================================
insert into storage.buckets (id, name, public)
values ('creative-assets', 'creative-assets', true)
on conflict (id) do update set public = true;

drop policy if exists "creative_assets_bucket_select" on storage.objects;
create policy "creative_assets_bucket_select" on storage.objects for select using (
  bucket_id = 'creative-assets' and public.has_section(auth.uid(), 'email_studio')
);

drop policy if exists "creative_assets_bucket_insert" on storage.objects;
create policy "creative_assets_bucket_insert" on storage.objects for insert with check (
  bucket_id = 'creative-assets' and public.has_section(auth.uid(), 'email_studio')
);

drop policy if exists "creative_assets_bucket_update" on storage.objects;
create policy "creative_assets_bucket_update" on storage.objects for update using (
  bucket_id = 'creative-assets' and public.has_section(auth.uid(), 'email_studio')
);

drop policy if exists "creative_assets_bucket_delete" on storage.objects;
create policy "creative_assets_bucket_delete" on storage.objects for delete using (
  bucket_id = 'creative-assets' and public.has_section(auth.uid(), 'email_studio')
);
