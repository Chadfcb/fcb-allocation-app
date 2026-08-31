-- Ernie conversation history — permanent, admin-scoped storage so a
-- conversation survives navigating away from /ernie and back, a full page
-- refresh, and even a different device/browser, and so past conversations
-- can be listed and reopened. Previously Ernie's history lived only in the
-- browser tab's React state, which is why it reset on every navigation.
--
-- Idempotent — safe to re-run.

create table if not exists ernie_conversations (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  title text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists ernie_messages (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references ernie_conversations(id) on delete cascade,
  role text not null check (role in ('user', 'assistant')),
  content text not null,
  created_at timestamptz not null default now()
);

create index if not exists ernie_conversations_user_id_updated_at_idx
  on ernie_conversations (user_id, updated_at desc);

create index if not exists ernie_messages_conversation_id_created_at_idx
  on ernie_messages (conversation_id, created_at asc);

alter table ernie_conversations enable row level security;
alter table ernie_messages enable row level security;

-- Admin-only, and only ever your own conversations — same "admin-only, full
-- stop" treatment as the Sales and Purchase Orders tables, plus a per-user
-- scope since conversation history is personal the way it is in any chat app.
drop policy if exists ernie_conversations_admin_own on ernie_conversations;
create policy ernie_conversations_admin_own on ernie_conversations
  for all
  using (
    user_id = auth.uid()
    and exists (select 1 from profiles p where p.id = auth.uid() and p.role = 'admin')
  )
  with check (
    user_id = auth.uid()
    and exists (select 1 from profiles p where p.id = auth.uid() and p.role = 'admin')
  );

drop policy if exists ernie_messages_admin_own on ernie_messages;
create policy ernie_messages_admin_own on ernie_messages
  for all
  using (
    exists (
      select 1 from ernie_conversations c
      where c.id = ernie_messages.conversation_id
        and c.user_id = auth.uid()
    )
    and exists (select 1 from profiles p where p.id = auth.uid() and p.role = 'admin')
  )
  with check (
    exists (
      select 1 from ernie_conversations c
      where c.id = ernie_messages.conversation_id
        and c.user_id = auth.uid()
    )
    and exists (select 1 from profiles p where p.id = auth.uid() and p.role = 'admin')
  );
