-- Ernie Projects — named containers Chad/Managers can create, each holding
-- its own file library and its own conversation history, visible only to
-- whichever users have been explicitly granted access. Per Chad
-- (2026-09-10): "I want ernie to have the ability to have projects, that
-- can accept files to the project, ernie can access, and have user
-- permissions. If they have been given access to a project they will see
-- it, if they haven't it will not be there." Plus a follow-up: access is
-- managed per-project via an add/remove-user control inside the project
-- itself, not just at creation time.
--
-- Who can do what:
--   - Create a project, add/remove its files, and grant/revoke anyone's
--     access to it: Administrators and Managers (role = 'admin', either
--     tier) — same "admin bypasses everything" convention used everywhere
--     else in the app (see sql/user_section_access.sql). An admin also
--     sees every project's tab automatically, without needing a grant row
--     — consistent with admins never needing rows for anything else.
--   - See a project's tab, chat inside it, and see its file list: ANY
--     signed-in user (Basic/Employee included) who has an
--     ernie_project_access row for it. No row = the project doesn't
--     exist for them, per Chad's spec above.
--
-- No new Ernie tool needed for the files themselves — same reasoning as
-- sql/ernie_reference_documents.sql: run_read_only_query already reaches
-- any table (bound by this table's own RLS, enforced automatically since
-- that function runs `security invoker`), and get_file_for_download is
-- already a generic bucket+path fetcher. This migration just adds a
-- table+bucket pair for Ernie to find project files in, gated by the same
-- RLS as the rest of this feature — see lib/ernie/tools.ts for the
-- doc-string updates that tell Ernie these tables/bucket exist.
--
-- Idempotent — safe to re-run.

-- =========================================================
-- ernie_projects — the container itself. Soft-delete via `active`,
-- matching the rest of the app's convention (never a hard delete).
-- =========================================================
create table if not exists ernie_projects (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  description text,
  created_by uuid references profiles(id),
  created_at timestamptz not null default now(),
  active boolean not null default true
);

alter table ernie_projects enable row level security;

drop policy if exists "ernie_projects_select" on ernie_projects;
create policy "ernie_projects_select" on ernie_projects for select using (
  exists (
    select 1 from ernie_project_access a
    where a.project_id = ernie_projects.id and a.user_id = auth.uid()
  )
  or exists (select 1 from profiles p where p.id = auth.uid() and p.role = 'admin')
);

drop policy if exists "ernie_projects_write" on ernie_projects;
create policy "ernie_projects_write" on ernie_projects for all using (
  exists (select 1 from profiles p where p.id = auth.uid() and p.role = 'admin')
) with check (
  exists (select 1 from profiles p where p.id = auth.uid() and p.role = 'admin')
);

-- =========================================================
-- ernie_project_access — one row per (project, user) grant. A project
-- simply doesn't show up in someone's tab row without a row here — same
-- shape/spirit as user_section_access, scoped to a project instead of an
-- app-wide section.
-- =========================================================
create table if not exists ernie_project_access (
  project_id uuid not null references ernie_projects(id) on delete cascade,
  user_id uuid not null references profiles(id) on delete cascade,
  granted_at timestamptz not null default now(),
  granted_by uuid references profiles(id),
  primary key (project_id, user_id)
);

alter table ernie_project_access enable row level security;

drop policy if exists "ernie_project_access_select" on ernie_project_access;
create policy "ernie_project_access_select" on ernie_project_access for select using (
  user_id = auth.uid()
  or exists (select 1 from profiles p where p.id = auth.uid() and p.role = 'admin')
);

drop policy if exists "ernie_project_access_write" on ernie_project_access;
create policy "ernie_project_access_write" on ernie_project_access for all using (
  exists (select 1 from profiles p where p.id = auth.uid() and p.role = 'admin')
) with check (
  exists (select 1 from profiles p where p.id = auth.uid() and p.role = 'admin')
);

-- =========================================================
-- ernie_project_files — the files themselves, same shape as
-- ernie_reference_documents. Visible only to someone with access to the
-- parent project (or an admin); added only by an admin.
-- =========================================================
create table if not exists ernie_project_files (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references ernie_projects(id) on delete cascade,
  file_name text not null,
  storage_path text not null,
  description text,
  mime_type text,
  size_bytes bigint,
  added_by uuid references profiles(id),
  created_at timestamptz not null default now()
);

create index if not exists ernie_project_files_project_id_idx
  on ernie_project_files (project_id, created_at desc);

alter table ernie_project_files enable row level security;

drop policy if exists "ernie_project_files_select" on ernie_project_files;
create policy "ernie_project_files_select" on ernie_project_files for select using (
  exists (
    select 1 from ernie_project_access a
    where a.project_id = ernie_project_files.project_id and a.user_id = auth.uid()
  )
  or exists (select 1 from profiles p where p.id = auth.uid() and p.role = 'admin')
);

drop policy if exists "ernie_project_files_write" on ernie_project_files;
create policy "ernie_project_files_write" on ernie_project_files for all using (
  exists (select 1 from profiles p where p.id = auth.uid() and p.role = 'admin')
) with check (
  exists (select 1 from profiles p where p.id = auth.uid() and p.role = 'admin')
);

-- =========================================================
-- Storage — its own bucket, "ernie-project-files", objects stored at
-- "<project_id>/<filename>" so the policies below can key off the project
-- id the same way ernie_files keys off user id.
-- =========================================================
insert into storage.buckets (id, name, public)
values ('ernie-project-files', 'ernie-project-files', false)
on conflict (id) do nothing;

drop policy if exists "ernie_project_files_bucket_select" on storage.objects;
create policy "ernie_project_files_bucket_select" on storage.objects for select using (
  bucket_id = 'ernie-project-files'
  and (
    exists (
      select 1 from ernie_project_access a
      where a.user_id = auth.uid()
        and a.project_id::text = (storage.foldername(name))[1]
    )
    or exists (select 1 from profiles p where p.id = auth.uid() and p.role = 'admin')
  )
);

drop policy if exists "ernie_project_files_bucket_write" on storage.objects;
create policy "ernie_project_files_bucket_write" on storage.objects for all using (
  bucket_id = 'ernie-project-files'
  and exists (select 1 from profiles p where p.id = auth.uid() and p.role = 'admin')
) with check (
  bucket_id = 'ernie-project-files'
  and exists (select 1 from profiles p where p.id = auth.uid() and p.role = 'admin')
);

-- =========================================================
-- ernie_conversations gets a nullable project_id. Null = a normal,
-- general Ernie conversation exactly like today. Set = it belongs to that
-- project, and only shows up in that project's own "Past Conversations"
-- list (see app/api/ernie/conversations/route.ts). No RLS change needed —
-- the existing "user_id = auth.uid()" ownership policy already covers
-- project conversations the same as general ones. on delete set null
-- rather than cascade: archiving/removing a project later shouldn't
-- destroy anyone's own conversation history.
-- =========================================================
alter table ernie_conversations
  add column if not exists project_id uuid references ernie_projects(id) on delete set null;

create index if not exists ernie_conversations_project_id_idx
  on ernie_conversations (project_id);

-- =========================================================
-- Tell Ernie itself this feature exists, the same way every other
-- feature's context gets logged in ernie_reference_documents (see
-- sql/ernie_reference_documents.sql) — a text-only note, no file
-- (storage_path stays null). Idempotent by description match.
-- =========================================================
insert into ernie_reference_documents (file_name, storage_path, description)
select
  'Ernie Projects (2026-09-10)',
  null,
  'Ernie Projects: named containers with their own file library and their own conversation history. A project only shows up for someone with an ernie_project_access grant row (admins see every project automatically, no grant needed). Administrators/Managers can create a project, add/remove its files, and grant/revoke anyone''s access. Files live in ernie_project_files (bucket ernie-project-files); query it via run_read_only_query filtered to project_id, and use get_file_for_download to hand one over.'
where not exists (
  select 1 from ernie_reference_documents where file_name = 'Ernie Projects (2026-09-10)'
);
