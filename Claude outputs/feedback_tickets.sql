-- Feedback/ticket button: lets anyone signed into the app report a bug or
-- suggestion from wherever they are, which emails Chad and also keeps a
-- record here for later review. Run this before deploying the matching
-- code change (app/api/feedback/route.ts, components/FeedbackButton.tsx).
--
-- Idempotent -- safe to run more than once.

create table if not exists feedback_tickets (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  page_path text not null,
  category text not null check (category in ('bug', 'suggestion')),
  message text not null,
  reporter_id uuid references profiles(id),
  reporter_email text,
  reporter_name text,
  status text not null default 'open' check (status in ('open', 'resolved'))
);

alter table feedback_tickets enable row level security;

-- Any signed-in user can file a ticket.
drop policy if exists feedback_tickets_insert on feedback_tickets;
create policy feedback_tickets_insert on feedback_tickets
  for insert
  with check (auth.uid() is not null);

-- Only admins can read the history back (matches the pattern used
-- elsewhere in this app for admin-only tables).
drop policy if exists feedback_tickets_select on feedback_tickets;
create policy feedback_tickets_select on feedback_tickets
  for select
  using (exists (select 1 from profiles p where p.id = auth.uid() and p.role = 'admin'));

drop policy if exists feedback_tickets_update on feedback_tickets;
create policy feedback_tickets_update on feedback_tickets
  for update
  using (exists (select 1 from profiles p where p.id = auth.uid() and p.role = 'admin'));
