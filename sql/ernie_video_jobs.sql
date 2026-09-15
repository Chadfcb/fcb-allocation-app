-- Tracks an in-progress Ernie video animation (animate_image tool, added
-- 2026-09-15, per Chad: "what if we want ernie to be able to animate
-- images"). Video generation (Google's Veo model) takes anywhere from
-- ~30 seconds to several minutes — far too long to hold open inside a
-- single chat request the way generate_image/edit_image's near-instant
-- Nano Banana Pro calls do — so this table is what lets Ernie hand back an
-- immediate "I'm animating that, give me a minute" reply, while the actual
-- render is checked on later (see app/api/ernie/video-jobs/[id]/route.ts,
-- polled by the client every few seconds) instead of leaving the request
-- hanging.
--
-- Idempotent — safe to re-run.

create table if not exists ernie_video_jobs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  -- Exactly one of these is set, matching where the request to animate
  -- something came from — general/personal Ernie chat (conversation_id) or
  -- an Ernie Project's shared room (project_id). Whichever is set is where
  -- the finished video's "here it is" message gets posted once ready.
  conversation_id uuid references ernie_conversations(id) on delete cascade,
  project_id uuid references ernie_projects(id) on delete cascade,
  -- The image this animation started from, and the motion prompt used —
  -- kept around mainly for Ernie's own reference if asked "what was that
  -- again", not required for the job to complete.
  source_file_id uuid references ernie_files(id) on delete set null,
  prompt text not null,
  -- Google's own operation name for this render (opaque string handed back
  -- by the initial predictLongRunning call) — polling re-checks THIS, not
  -- anything derived from it.
  operation_name text not null,
  status text not null default 'pending' check (status in ('pending', 'done', 'error')),
  result_file_id uuid references ernie_files(id) on delete set null,
  error_message text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists ernie_video_jobs_user_id_created_at_idx
  on ernie_video_jobs (user_id, created_at desc);

alter table ernie_video_jobs enable row level security;

-- Owner-only, same as ernie_files — only the person who asked for an
-- animation ever polls its status; once it finishes, the result shows up
-- for everyone the normal way (a real chat message with the finished video
-- attached, which the existing shared-room/file visibility rules already
-- cover).
drop policy if exists "ernie_video_jobs_owner" on ernie_video_jobs;
create policy "ernie_video_jobs_owner" on ernie_video_jobs for all using (
  user_id = auth.uid()
) with check (
  user_id = auth.uid()
);

-- Tell Ernie himself this exists, same pattern as every other feature note.
insert into ernie_reference_documents (file_name, storage_path, description)
select
  'Ernie image animation (2026-09-15)',
  null,
  'Ernie can animate an existing image into a short video (animate_image tool) using Google''s Veo model. Because rendering takes 1-3+ minutes, this never finishes inside the same reply — Ernie starts the job and tells the person it''s rendering, then the finished video shows up as a new message in this same conversation/room once it''s ready (tracked in ernie_video_jobs, polled by app/api/ernie/video-jobs/[id]).'
where not exists (
  select 1 from ernie_reference_documents where file_name = 'Ernie image animation (2026-09-15)'
);
