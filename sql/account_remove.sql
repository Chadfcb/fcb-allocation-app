-- Remove from lists (2026-11-02, per Chad): anyone who can see a distributor's
-- accounts (reps included) can take an account off every list — e.g. Plank,
-- closed for a month but still on James's target list.
--
-- Uses the existing turned-off list (sales_account_off), which every sales
-- list, dashboard, route count and Sales → Accounts already leave out.
--
-- What this file adds:
--   sales_account_off.reason / note / distributor   why it was removed
--   sales_account_off_log      every remove / put back (by a person or
--                              automatically), with who, when and why
--   sales_account_remove(outlet, reason, note)     reps + admins
--   sales_account_restore(outlet)                  reps + admins
--   sales_removed_accounts(outlet)                 removed accounts the viewer
--                                                  can see (null = all)
--   sales_account_off_recent_log()                 last 60 days of the log
--   sales_account_off_autorestore()                server only: puts back a
--                              removed account that orders again (run by the
--                              LilyPad sync). Only accounts removed with a
--                              reason — old "Turn off" entries stay off.
--
-- Run this in Supabase's SQL Editor BEFORE pushing the code.
-- Idempotent — safe to run more than once.

alter table public.sales_account_off add column if not exists reason text;
alter table public.sales_account_off add column if not exists note text;
alter table public.sales_account_off add column if not exists distributor text;

create table if not exists public.sales_account_off_log (
  id uuid primary key default gen_random_uuid(),
  outlet_id text not null,
  name text,
  distributor text,
  action text not null check (action in ('removed', 'restored', 'auto_restored')),
  reason text,
  note text,
  done_by uuid references public.profiles(id),
  done_at timestamptz not null default now()
);
create index if not exists sales_account_off_log_outlet_idx on public.sales_account_off_log (outlet_id);
create index if not exists sales_account_off_log_at_idx on public.sales_account_off_log (done_at desc);

alter table public.sales_account_off_log enable row level security;
drop policy if exists "sales_account_off_log_read" on public.sales_account_off_log;
create policy "sales_account_off_log_read" on public.sales_account_off_log for select using (
  public.sales_can_see(array[distributor])
);
-- Writes go through the functions below only.
grant select on public.sales_account_off_log to authenticated;
grant select, insert, update, delete on public.sales_account_off_log to service_role;

comment on table public.sales_account_off_log is
  'History of accounts taken off the sales lists ("Remove from lists" in the account pop-up) and put back — who, when and why (Closed / Out of business, Won''t carry us, Duplicate, Other), plus accounts put back automatically because they ordered again. Use for "who removed X", "why is X off the list", "which accounts closed".';
comment on column public.sales_account_off.reason is 'Why it was removed (Remove from lists). Null = an older admin "Turn off".';

-- ---------------------------------------------------------------------------
-- Remove an account from every list
-- ---------------------------------------------------------------------------
create or replace function public.sales_account_remove(p_outlet text, p_reason text, p_note text default null)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_name text;
  v_dist text;
  v_note text := nullif(trim(coalesce(p_note, '')), '');
begin
  select a.name, a.distributor into v_name, v_dist from public.sales_accounts a where a.outlet_id = p_outlet;
  if not found then
    raise exception 'Account not found.';
  end if;
  if not public.sales_can_see(array[v_dist]) then
    raise exception 'You don''t have access to %''s accounts.', coalesce(v_dist, 'this distributor');
  end if;
  if p_reason is null or p_reason not in ('Closed / Out of business', 'Won''t carry us', 'Duplicate', 'Other') then
    raise exception 'Pick a reason.';
  end if;
  if p_reason = 'Other' and v_note is null then
    raise exception 'Add a short note for "Other".';
  end if;
  if exists (select 1 from public.sales_account_off o where o.outlet_id = p_outlet) then
    raise exception 'This account is already off the lists.';
  end if;

  insert into public.sales_account_off (outlet_id, name, turned_off_by, reason, note, distributor)
  values (p_outlet, v_name, auth.uid(), p_reason, v_note, v_dist);
  insert into public.sales_account_off_log (outlet_id, name, distributor, action, reason, note, done_by)
  values (p_outlet, v_name, v_dist, 'removed', p_reason, v_note, auth.uid());
end;
$$;
revoke all on function public.sales_account_remove(text, text, text) from public, anon;
grant execute on function public.sales_account_remove(text, text, text) to authenticated;
comment on function public.sales_account_remove(text, text, text) is '[hidden] Remove from lists button.';

-- ---------------------------------------------------------------------------
-- Put an account back on the lists
-- ---------------------------------------------------------------------------
create or replace function public.sales_account_restore(p_outlet text)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_name text;
  v_dist text;
begin
  select coalesce(a.name, o.name), coalesce(a.distributor, o.distributor) into v_name, v_dist
  from public.sales_account_off o
  left join public.sales_accounts a on a.outlet_id = o.outlet_id
  where o.outlet_id = p_outlet;
  if not found then
    return; -- already back on
  end if;
  if not public.sales_can_see(array[v_dist]) then
    raise exception 'You don''t have access to %''s accounts.', coalesce(v_dist, 'this distributor');
  end if;
  delete from public.sales_account_off o where o.outlet_id = p_outlet;
  insert into public.sales_account_off_log (outlet_id, name, distributor, action, done_by)
  values (p_outlet, v_name, v_dist, 'restored', auth.uid());
end;
$$;
revoke all on function public.sales_account_restore(text) from public, anon;
grant execute on function public.sales_account_restore(text) to authenticated;
comment on function public.sales_account_restore(text) is '[hidden] Put back on lists button.';

-- ---------------------------------------------------------------------------
-- Removed accounts the viewer can see (p_outlet null = all of them)
-- ---------------------------------------------------------------------------
create or replace function public.sales_removed_accounts(p_outlet text default null)
returns table (outlet_id text, name text, city text, distributor text, reason text, note text, removed_at timestamptz, removed_by text)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  return query
    select o.outlet_id, coalesce(a.name, o.name), a.city, coalesce(a.distributor, o.distributor),
           o.reason, o.note, o.turned_off_at,
           (select p.full_name from public.profiles p where p.id = o.turned_off_by)
    from public.sales_account_off o
    left join public.sales_accounts a on a.outlet_id = o.outlet_id
    where (p_outlet is null or o.outlet_id = p_outlet)
      and public.sales_can_see(array[coalesce(a.distributor, o.distributor)])
    order by o.turned_off_at desc;
end;
$$;
revoke all on function public.sales_removed_accounts(text) from public, anon;
grant execute on function public.sales_removed_accounts(text) to authenticated;
comment on function public.sales_removed_accounts(text) is
  'Accounts taken off the sales lists (closed, won''t carry us, duplicate…) with who removed them, when and why. Only distributors the person can see.';

-- ---------------------------------------------------------------------------
-- Last 60 days of removals / put-backs (Turned off accounts tab)
-- ---------------------------------------------------------------------------
create or replace function public.sales_account_off_recent_log()
returns table (outlet_id text, name text, distributor text, action text, reason text, note text, done_at timestamptz, done_by text)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  return query
    select l.outlet_id, l.name, l.distributor, l.action, l.reason, l.note, l.done_at,
           (select p.full_name from public.profiles p where p.id = l.done_by)
    from public.sales_account_off_log l
    where l.done_at >= now() - interval '60 days'
      and public.sales_can_see(array[l.distributor])
    order by l.done_at desc
    limit 200;
end;
$$;
revoke all on function public.sales_account_off_recent_log() from public, anon;
grant execute on function public.sales_account_off_recent_log() to authenticated;
comment on function public.sales_account_off_recent_log() is '[hidden] Turned off accounts tab history.';

-- ---------------------------------------------------------------------------
-- Put back a removed account that ordered again (LilyPad sync calls this)
-- ---------------------------------------------------------------------------
create or replace function public.sales_account_off_autorestore()
returns integer
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  n integer := 0;
  r record;
begin
  for r in
    select o.outlet_id, coalesce(a.name, o.name) as name, coalesce(a.distributor, o.distributor) as dist,
           o.reason, max(coalesce(s.last_buy_date, s.month)) as last_order
    from public.sales_account_off o
    left join public.sales_accounts a on a.outlet_id = o.outlet_id
    join public.sales_account_sales s on s.outlet_id = o.outlet_id
    where o.reason is not null
      and coalesce(s.last_buy_date, s.month) > (o.turned_off_at at time zone 'America/Los_Angeles')::date
      and s.ce > 0
    group by o.outlet_id, a.name, o.name, a.distributor, o.distributor, o.reason
  loop
    delete from public.sales_account_off o where o.outlet_id = r.outlet_id;
    insert into public.sales_account_off_log (outlet_id, name, distributor, action, reason, note)
    values (r.outlet_id, r.name, r.dist, 'auto_restored', r.reason,
            'Ordered again ' || to_char(r.last_order, 'FMMM/FMDD/YYYY') || ' — put back on the lists automatically');
    n := n + 1;
  end loop;
  return n;
end;
$$;
revoke all on function public.sales_account_off_autorestore() from public, anon, authenticated;
grant execute on function public.sales_account_off_autorestore() to service_role;
comment on function public.sales_account_off_autorestore() is '[hidden] LilyPad sync: removed accounts that order again go back on the lists.';
