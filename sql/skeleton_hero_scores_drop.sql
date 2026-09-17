-- Removes the Skeleton Hero game entirely: drops the leaderboard table
-- (skeleton_hero_scores.sql), its index, and its RLS policies. Run once in
-- Supabase's SQL Editor BEFORE pushing the code change that removes the
-- Skeleton Hero page/nav/permissions. Idempotent — safe to re-run.

drop table if exists skeleton_hero_scores cascade;
