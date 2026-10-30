-- Admin pages: Administrators only, unless an Administrator grants them.
-- Added 2026-10-29, per Chad: "managers should not see anything in admin
-- period, only admins, or if an admin grants them access to that section".
--
-- Run this ONCE in Supabase's SQL Editor BEFORE pushing the code.
-- Idempotent — safe to run more than once.
--
-- What changes:
--   * has_section(): a Manager (role='admin', not is_super_admin) no longer
--     automatically has the Admin pages' sections — admin_users (Users),
--     audit_log, twilio, email_studio, ekos_sync — same as Finance's
--     cashflow_dashboard already worked. They need a grant row.
--   * Only an Administrator can grant or remove those rows (Users > Edit).
-- Keep both lists below in sync with ADMIN_RESTRICTED_SECTIONS in
-- lib/permissions.ts. (distributor_data is restricted in the app only, as
-- before — unchanged here.)

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
          or section not in ('cashflow_dashboard', 'admin_users', 'audit_log', 'twilio', 'email_studio', 'ekos_sync')
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
    section_key not in ('cashflow_dashboard', 'admin_users', 'audit_log', 'twilio', 'email_studio', 'ekos_sync')
    or exists (select 1 from profiles p where p.id = auth.uid() and p.role = 'admin' and p.is_super_admin)
  )
) with check (
  exists (select 1 from profiles p where p.id = auth.uid() and p.role = 'admin')
  and (
    section_key not in ('cashflow_dashboard', 'admin_users', 'audit_log', 'twilio', 'email_studio', 'ekos_sync')
    or exists (select 1 from profiles p where p.id = auth.uid() and p.role = 'admin' and p.is_super_admin)
  )
);

-- Who's affected right now (read-only check — shows each Manager and which
-- Admin pages they still have after this change; empty list = none):
select p.email,
       coalesce(string_agg(usa.section_key, ', ' order by usa.section_key), '(no Admin pages)') as admin_pages
from public.profiles p
left join public.user_section_access usa
  on usa.user_id = p.id
 and usa.section_key in ('admin_users', 'audit_log', 'twilio', 'email_studio', 'ekos_sync')
where p.role = 'admin' and not p.is_super_admin and p.removed_at is null
group by p.email
order by p.email;
