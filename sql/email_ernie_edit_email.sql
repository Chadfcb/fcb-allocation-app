-- Email Studio — Ernie "Edit email" (added 2026-11-05, per Chad: "build it",
-- after Eddie asked for Ernie to write and fix the email itself, not just
-- make pictures). See claude/email-designer-plan.md.
--
-- Run this ONCE in Supabase's SQL Editor BEFORE pushing the code.
-- Safe to run more than once.
--
-- Lets creative_ernie_jobs record a new kind of job, 'email' (Ernie changed
-- the email's words/layout). Used for the monthly cap (300 email edits, set
-- in the app) and the usage line in the Ernie panel. No new table.

-- Drop whatever check currently limits "kind" (whatever it's named), then add the new one.
do $$
declare c record;
begin
  for c in
    select conname from pg_constraint
    where conrelid = 'public.creative_ernie_jobs'::regclass and contype = 'c'
      and pg_get_constraintdef(oid) ilike '%kind%'
  loop
    execute format('alter table public.creative_ernie_jobs drop constraint %I', c.conname);
  end loop;
end $$;
alter table public.creative_ernie_jobs
  add constraint creative_ernie_jobs_kind_check check (kind in ('create', 'edit', 'animate', 'email'));

comment on table public.creative_ernie_jobs is
  '[hidden] One row per thing Ernie did in Email Studio (create/edit image, animate, email = edited the email itself) — monthly caps and the usage counter.';
