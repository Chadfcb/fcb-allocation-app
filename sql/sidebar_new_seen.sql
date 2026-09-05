-- Tracks, per signed-in person, which "New!" sidebar badges they've already
-- clicked — so once someone dismisses one, it's gone for them everywhere
-- they log in (any browser, any device), not just the one they clicked it
-- on. One row per (user, sidebar item) they've seen.
create table if not exists sidebar_new_seen (
  user_id uuid not null references auth.users(id) on delete cascade,
  item_id text not null,
  seen_at timestamptz not null default now(),
  primary key (user_id, item_id)
);

alter table sidebar_new_seen enable row level security;

-- Everyone can see and record only their own dismissals — never anyone else's.
drop policy if exists "sidebar_new_seen_select_own" on sidebar_new_seen;
create policy "sidebar_new_seen_select_own"
  on sidebar_new_seen for select
  using (auth.uid() = user_id);

drop policy if exists "sidebar_new_seen_insert_own" on sidebar_new_seen;
create policy "sidebar_new_seen_insert_own"
  on sidebar_new_seen for insert
  with check (auth.uid() = user_id);
