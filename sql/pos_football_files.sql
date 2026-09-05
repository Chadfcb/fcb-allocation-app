-- POS > Football POS — a flat file library of football-season POS art
-- (posters, table tents, stickers, distributor strips). Added 2026-09-05,
-- per Chad: "these items need to go in there with Previews and download
-- abilities, they need to look just like how we did the labels." Same
-- shape/conventions as pos_label_files, just with no brand/size nesting —
-- one shared pool of seasonal marketing material, not per-brand artwork.
-- Run this once in Supabase's SQL Editor, before the matching code
-- deploy. Idempotent — safe to re-run.
--
-- Access: gated by the "football_pos" section (see lib/permissions.ts),
-- which rides along with POS access — not its own Users > Edit toggle.

create table if not exists pos_football_files (
  id uuid primary key default gen_random_uuid(),
  file_name text not null,
  -- Null when this entry is an external link instead of an uploaded file
  -- (e.g. artwork too large for Storage) — see external_url.
  storage_path text,
  external_url text,
  -- A small JPG preview (e.g. a flattened PDF page) — browsers can't
  -- render some file types directly, so this is what the card thumbnail
  -- and the preview modal actually show. Null for files that are already
  -- a browser-displayable image (the PNGs in this library use the
  -- original file itself as their own preview, same as Labels does).
  preview_path text,
  mime_type text,
  size_bytes bigint,
  uploaded_by uuid references profiles(id),
  uploaded_at timestamptz not null default now()
);

alter table pos_football_files enable row level security;

drop policy if exists "pos_football_files_section" on pos_football_files;
create policy "pos_football_files_section" on pos_football_files for all using (
  has_section(auth.uid(), 'football_pos')
);

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'pos_football_files'
  ) then
    alter publication supabase_realtime add table pos_football_files;
  end if;
end $$;

-- Its own storage bucket, kept separate from "pos-label-files" so its
-- access policy can gate on "football_pos" specifically rather than
-- opening up every path in the labels bucket to anyone with football
-- access (or vice versa).
insert into storage.buckets (id, name, public)
values ('pos-football-files', 'pos-football-files', false)
on conflict (id) do nothing;

drop policy if exists "pos_football_files_bucket_section" on storage.objects;
create policy "pos_football_files_bucket_section" on storage.objects for all using (
  bucket_id = 'pos-football-files' and has_section(auth.uid(), 'football_pos')
) with check (
  bucket_id = 'pos-football-files' and has_section(auth.uid(), 'football_pos')
);
