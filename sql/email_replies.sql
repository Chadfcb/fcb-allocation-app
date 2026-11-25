-- =========================================================
-- Email Studio: "Emails sent" + reply alerts (added 2026-11-25, per Chad).
--   "We need to add a button on each distributor page in the app, that tells
--    the sales reps which accounts emails went out to, so when they visit the
--    account they know if the account has gotten an email or not."
--   "we need an alert when one of these accounts replies to our emails …
--    i want the email checked for replies, us notified, so we can act" —
--    once an hour, notified IN THE APP (not email, not Slack), and on the
--    distributor pages "so our sales reps can see what accounts replied, what
--    they said, and be able to see all their account info".
-- Plan: claude/email-replies-alerts-plan.md
--
-- Replies keep going to ernie@fullcirclebrewing.com. Once an hour the app
-- reads Ernie's inbox (lib/email/replies.ts, run by the existing every-5-minute
-- sender, which only checks the inbox when an hour has passed) and saves each
-- reply from someone we emailed here.
--
-- Run once in Supabase → SQL Editor BEFORE pushing the code. Safe to run again.
-- =========================================================

-- 1. Replies -------------------------------------------------------------
create table if not exists public.email_replies (
  id uuid primary key default gen_random_uuid(),
  message_id text not null unique,            -- the reply's own Message-ID (stops doubles)
  send_id uuid references public.email_sends(id) on delete set null,
  campaign_id uuid references public.email_campaigns(id) on delete set null,
  outlet_id text,                              -- the account (sales_accounts), when known
  from_email text not null,
  from_name text,
  subject text,
  body text,                                   -- their words only (quoted email trimmed off)
  received_at timestamptz not null,
  handled_at timestamptz,
  handled_by uuid references public.profiles(id),
  handled_by_name text,
  created_at timestamptz not null default now()
);
create index if not exists email_replies_open_idx on public.email_replies (received_at desc) where handled_at is null;
create index if not exists email_replies_outlet_idx on public.email_replies (outlet_id);
create index if not exists email_replies_received_idx on public.email_replies (received_at desc);

alter table public.email_replies enable row level security;
-- Email Studio people can read every reply. Changes go through the functions
-- below (and the server); nobody edits rows directly.
drop policy if exists "email_replies_select" on public.email_replies;
create policy "email_replies_select" on public.email_replies for select
  using (public.has_section(auth.uid(), 'email_studio'));

-- When Ernie's inbox was last checked (one row).
create table if not exists public.email_reply_state (
  id int primary key default 1 check (id = 1),
  last_checked_at timestamptz,
  last_result text
);
alter table public.email_reply_state enable row level security;
drop policy if exists "email_reply_state_select" on public.email_reply_state;
create policy "email_reply_state_select" on public.email_reply_state for select
  using (public.has_section(auth.uid(), 'email_studio'));
insert into public.email_reply_state (id) values (1) on conflict (id) do nothing;

-- 2. Distributor page → "Emails sent" -----------------------------------------
-- Every email that went to one of this distributor's accounts (account contacts
-- only — typed-in addresses and pasted lists aren't tied to an account).
create or replace function public.distributor_email_sends(p_dist text)
returns json
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not public.sales_can_see(array[p_dist]) then
    raise exception 'You don''t have access to this distributor.';
  end if;
  return (select coalesce(json_agg(x order by x.sent_at desc nulls last, x.account), '[]'::json) from (
    select s.id as send_id, a.outlet_id, a.name as account, a.city, a.premise,
      s.email, s.name as contact, c.id as campaign_id, c.name as campaign, c.subject,
      coalesce(s.sent_at, s.created_at) as sent_at, s.status,
      s.opened_at, s.clicked_at, s.bounced_at, s.unsubscribed_at,
      (select count(*) from public.email_replies r where r.send_id = s.id)::int as replies,
      (select count(*) from public.email_replies r where r.send_id = s.id and r.handled_at is null)::int as open_replies
    from public.email_sends s
    join public.email_campaigns c on c.id = s.campaign_id
    join public.sales_accounts a on a.outlet_id = s.outlet_id
    where a.distributor = p_dist
      and s.status in ('accepted', 'queued')
  ) x);
end;
$$;
revoke all on function public.distributor_email_sends(text) from public, anon;
grant execute on function public.distributor_email_sends(text) to authenticated;

-- 3. Distributor page → "Replies" (with the account's info) --------------------
create or replace function public.distributor_email_replies(p_dist text)
returns json
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not public.sales_can_see(array[p_dist]) then
    raise exception 'You don''t have access to this distributor.';
  end if;
  return (select coalesce(json_agg(x order by (x.handled_at is not null), x.received_at desc), '[]'::json) from (
    select r.id, r.outlet_id, r.from_email, r.from_name, r.subject as reply_subject, r.body, r.received_at,
      r.handled_at, r.handled_by_name,
      c.name as campaign, c.subject as campaign_subject,
      s.sent_at, s.opened_at, s.clicked_at,
      a.name as account, a.address, a.city, a.state, a.zip, a.phone, a.premise, a.distributor,
      a.best_day, a.last_buy_date, a.ce_12mo,
      (select json_build_object('date', k.checkin_date, 'rep', k.rep)
         from public.sales_account_checkins k where k.outlet_id = r.outlet_id
         order by k.checkin_date desc limit 1) as last_checkin
    from public.email_replies r
    join public.sales_accounts a on a.outlet_id = r.outlet_id
    left join public.email_sends s on s.id = r.send_id
    left join public.email_campaigns c on c.id = r.campaign_id
    where a.distributor = p_dist
  ) x);
end;
$$;
revoke all on function public.distributor_email_replies(text) from public, anon;
grant execute on function public.distributor_email_replies(text) to authenticated;

-- 3b. Email Studio → Replies: every reply (all distributors), same shape.
create or replace function public.email_studio_replies()
returns json
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not public.has_section(auth.uid(), 'email_studio') then
    raise exception 'You don''t have access to Email Studio.';
  end if;
  return (select coalesce(json_agg(x order by (x.handled_at is not null), x.received_at desc), '[]'::json) from (
    select r.id, r.outlet_id, r.from_email, r.from_name, r.subject as reply_subject, r.body, r.received_at,
      r.handled_at, r.handled_by_name,
      c.name as campaign, c.subject as campaign_subject,
      s.sent_at, s.opened_at, s.clicked_at,
      coalesce(a.name, s.business, r.from_email) as account, a.address, a.city, a.state, a.zip, a.phone, a.premise, a.distributor,
      a.best_day, a.last_buy_date, a.ce_12mo,
      (select json_build_object('date', k.checkin_date, 'rep', k.rep)
         from public.sales_account_checkins k where k.outlet_id = r.outlet_id
         order by k.checkin_date desc limit 1) as last_checkin
    from public.email_replies r
    left join public.sales_accounts a on a.outlet_id = r.outlet_id
    left join public.email_sends s on s.id = r.send_id
    left join public.email_campaigns c on c.id = r.campaign_id
    order by r.received_at desc
    limit 1000
  ) x);
end;
$$;
revoke all on function public.email_studio_replies() from public, anon;
grant execute on function public.email_studio_replies() to authenticated;

-- 4. ✓ Mark handled / un-handle ----------------------------------------------
-- Email Studio people can mark any reply; reps can mark replies from their own
-- distributor's accounts. Records who did it, by name.
create or replace function public.email_reply_set_handled(p_id uuid, p_handled boolean)
returns json
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_dist text;
  v_name text;
begin
  select a.distributor into v_dist
    from public.email_replies r left join public.sales_accounts a on a.outlet_id = r.outlet_id
   where r.id = p_id;
  if not found then
    raise exception 'Reply not found.';
  end if;
  if not (public.has_section(auth.uid(), 'email_studio')
          or (v_dist is not null and public.sales_can_see(array[v_dist]))) then
    raise exception 'You don''t have access to this reply.';
  end if;
  select coalesce(nullif(trim(p.full_name), ''), p.email) into v_name from public.profiles p where p.id = auth.uid();
  update public.email_replies
     set handled_at = case when p_handled then now() else null end,
         handled_by = case when p_handled then auth.uid() else null end,
         handled_by_name = case when p_handled then v_name else null end
   where id = p_id;
  return json_build_object('handled', p_handled, 'by', case when p_handled then v_name else null end);
end;
$$;
revoke all on function public.email_reply_set_handled(uuid, boolean) from public, anon;
grant execute on function public.email_reply_set_handled(uuid, boolean) to authenticated;

-- 5. Red number in the menu: replies not handled yet ---------------------------
-- Email Studio people: every open reply. Reps: open replies on the distributors
-- they can see. Returns {"total": n, "by_dist": {"Markstein": n, …}}.
create or replace function public.email_open_reply_counts()
returns json
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_all boolean := public.has_section(auth.uid(), 'email_studio');
begin
  return (
    select json_build_object(
      'total', coalesce(sum(n), 0)::int,
      'studio', v_all,
      'by_dist', coalesce(json_object_agg(dist, n) filter (where dist is not null), '{}'::json)
    )
    from (
      select a.distributor as dist, count(*)::int as n
        from public.email_replies r
        left join public.sales_accounts a on a.outlet_id = r.outlet_id
       where r.handled_at is null
         and (v_all or (a.distributor is not null and public.sales_can_see(array[a.distributor])))
       group by a.distributor
    ) t
  );
end;
$$;
revoke all on function public.email_open_reply_counts() from public, anon;
grant execute on function public.email_open_reply_counts() to authenticated;

-- 6. Live updates when a reply comes in or gets handled.
do $$
begin
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and tablename = 'email_replies') then
    execute 'alter publication supabase_realtime add table public.email_replies';
  end if;
end $$;

select 'Email replies ready' as result;
