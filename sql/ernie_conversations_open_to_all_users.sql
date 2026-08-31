-- Ernie is now available to every signed-in user (Basic and admin), not
-- just admins — so Ernie's conversation-history tables need to allow a
-- Basic user to have their own history too, same as an admin. The original
-- policies in sql/ernie_conversations.sql required role = 'admin' on top of
-- user_id = auth.uid(); this migration drops that admin requirement and
-- keeps only the per-user ownership check. Which app-data Ernie can actually
-- discuss with a Basic user is restricted separately, at the application
-- layer (see lib/ernie/tools.ts) — this migration only concerns who can see
-- their own Ernie chat history, not what Ernie can look up during a chat.
--
-- Idempotent — safe to re-run.

drop policy if exists ernie_conversations_admin_own on ernie_conversations;
drop policy if exists ernie_conversations_own on ernie_conversations;
create policy ernie_conversations_own on ernie_conversations
  for all
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

drop policy if exists ernie_messages_admin_own on ernie_messages;
drop policy if exists ernie_messages_own on ernie_messages;
create policy ernie_messages_own on ernie_messages
  for all
  using (
    exists (
      select 1 from ernie_conversations c
      where c.id = ernie_messages.conversation_id
        and c.user_id = auth.uid()
    )
  )
  with check (
    exists (
      select 1 from ernie_conversations c
      where c.id = ernie_messages.conversation_id
        and c.user_id = auth.uid()
    )
  );
