-- Skeleton Hero (the Ernie mini-game) score/leaderboard table, plus wiring
-- it into the per-user, per-section access system (sql/user_section_access.
-- sql) the same way every other page is gated. Run once in Supabase's SQL
-- Editor, before the matching code deploy. Idempotent — safe to re-run.
--
-- Brand-new section, so unlike sql/tasks_section_access.sql there is no
-- backfill: nobody had this page before, so nobody needs a grandfathered
-- grant — every user starts unchecked and an admin turns it on per person
-- from Users > Edit, same as any other new section.
--
-- display_name is stored directly on each score row (denormalized) rather
-- than joined from `profiles` at read time. The leaderboard needs to show
-- everyone's name to everyone with the section granted, but there's no
-- existing policy here that opens up reading OTHER people's `profiles`
-- rows app-wide, and this migration deliberately doesn't add one. Each
-- person can always read their OWN profile (used everywhere else in the
-- app already), so the app fills in display_name from that at the moment
-- a score is submitted — the leaderboard read then never has to touch
-- `profiles` at all.

create table if not exists skeleton_hero_scores (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references profiles(id) on delete cascade,
  display_name text not null,
  score integer not null,
  created_at timestamptz not null default now()
);

create index if not exists skeleton_hero_scores_score_idx
  on skeleton_hero_scores (score desc);

alter table skeleton_hero_scores enable row level security;

drop policy if exists "skeleton_hero_scores_select" on skeleton_hero_scores;
create policy "skeleton_hero_scores_select" on skeleton_hero_scores for select using (
  has_section(auth.uid(), 'skeleton_hero_game')
);

drop policy if exists "skeleton_hero_scores_insert" on skeleton_hero_scores;
create policy "skeleton_hero_scores_insert" on skeleton_hero_scores for insert with check (
  has_section(auth.uid(), 'skeleton_hero_game') and user_id = auth.uid()
);
