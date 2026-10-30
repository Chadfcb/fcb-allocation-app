-- Website Age Check (added 2026-10-30, per Chad: replace the Elfsight widget
-- with FCB's own 21+ birth-date check, editable in FCB-Data — "yes execute").
-- See lib/ageCheck.ts and claude/fullcirclebrewing-site-age-gate.md.
--
-- Run this ONCE in Supabase's SQL Editor BEFORE pushing the code.
-- Safe to run more than once.
--
-- What it does:
--   1. New Admin page section "age_check" (Admin → Age Check). Like every
--      Admin page: Administrators always have it; anyone else only if an
--      Administrator grants it in Users > Edit. has_section() and the grant
--      policy are re-created with age_check added to the Admin-only list
--      (same text as sql/admin_section_access.sql otherwise).
--   2. One-row table site_age_check holding the check's look and wording.
--      Empty settings = the built-in design (Eddie's, with all four logos).

-- 1. Admin-only section list (keep in sync with ADMIN_RESTRICTED_SECTIONS
--    in lib/permissions.ts).
create or replace function has_section(uid uuid, section text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select
    exists (
      select 1 from public.profiles p
      where p.id = uid
        and p.role = 'admin'
        and (
          p.is_super_admin
          or section not in ('cashflow_dashboard', 'admin_users', 'audit_log', 'twilio', 'email_studio', 'age_check', 'ekos_sync')
        )
    )
    or exists (
      select 1 from public.user_section_access usa
      where usa.user_id = uid and usa.section_key = section
    );
$$;

drop policy if exists "user_section_access_write_admin" on user_section_access;
create policy "user_section_access_write_admin" on user_section_access for all using (
  exists (select 1 from profiles p where p.id = auth.uid() and p.role = 'admin')
  and (
    section_key not in ('cashflow_dashboard', 'admin_users', 'audit_log', 'twilio', 'email_studio', 'age_check', 'ekos_sync')
    or exists (select 1 from profiles p where p.id = auth.uid() and p.role = 'admin' and p.is_super_admin)
  )
) with check (
  exists (select 1 from profiles p where p.id = auth.uid() and p.role = 'admin')
  and (
    section_key not in ('cashflow_dashboard', 'admin_users', 'audit_log', 'twilio', 'email_studio', 'age_check', 'ekos_sync')
    or exists (select 1 from profiles p where p.id = auth.uid() and p.role = 'admin' and p.is_super_admin)
  )
);

-- 2. The age check's settings (one row).
create table if not exists public.site_age_check (
  id int primary key default 1 check (id = 1),
  settings jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now(),
  updated_by uuid references public.profiles(id)
);
insert into public.site_age_check (id) values (1) on conflict (id) do nothing;

alter table public.site_age_check enable row level security;

-- People with the Age Check page can read and change it. The websites read
-- it through the server (/api/age-check/script), not directly.
drop policy if exists "site_age_check_select" on public.site_age_check;
create policy "site_age_check_select" on public.site_age_check for select
  using (public.has_section(auth.uid(), 'age_check'));
drop policy if exists "site_age_check_update" on public.site_age_check;
create policy "site_age_check_update" on public.site_age_check for update
  using (public.has_section(auth.uid(), 'age_check'))
  with check (public.has_section(auth.uid(), 'age_check'));
