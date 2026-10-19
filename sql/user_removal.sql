-- Admin → Users: "Remove access" / "Restore" (added 2026-10-19, per Chad —
-- Ryan was let go and the app had no way to remove a user).
--
-- Removing someone (app/api/admin/users/remove/route.ts) does all of this at
-- once, and keeps every bit of their history (audit log, tasks, check-ins,
-- notes still show their name):
--   * blocks their login (Supabase ban, ~100 years) — Restore lifts it
--   * Employee tier, every section grant removed (incl. Ernie AI, app + Slack)
--   * profiles.removed_at / removed_by — who removed them and when; removed
--     people are listed separately on Admin → Users and left out of
--     "assign to" pickers
--
-- Also lets the app's own server (service role) change a tier during a
-- removal — the tier guard below otherwise only accepts a signed-in
-- Administrator, and the server route has already checked that the person
-- clicking is allowed to do it.
--
-- Run this in Supabase's SQL Editor BEFORE pushing the code. Idempotent.

alter table public.profiles add column if not exists removed_at timestamptz;
alter table public.profiles add column if not exists removed_by uuid references public.profiles(id);

create or replace function prevent_non_super_admin_tier_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if (new.role is distinct from old.role or new.is_super_admin is distinct from old.is_super_admin) then
    -- The app's server (service role) — only used by routes that check the
    -- caller's permission themselves (Remove access, 2026-10-19).
    if coalesce(auth.role(), '') = 'service_role' then
      return new;
    end if;
    if not exists (
      select 1 from public.profiles p
      where p.id = auth.uid() and p.role = 'admin' and p.is_super_admin
    ) then
      raise exception 'Only an Administrator can change a user''s role or tier.';
    end if;
  end if;
  return new;
end;
$$;

-- Ryan (let go 2026-10-19): his login was already blocked in Supabase and his
-- sections removed by hand today; this marks him as removed so the Users page
-- and pickers show it.
update public.profiles
set removed_at = coalesce(removed_at, now())
where lower(email) = 'ryanm@fullcirclebrewing.com';

comment on table public.profiles is $c$App users: full_name, email, role (admin / basic), is_super_admin (Administrator vs Manager), last_active_at. removed_at / removed_by = this person's access was removed (left the company): their login is blocked and they have no sections; their history stays. Admins only.$c$;
