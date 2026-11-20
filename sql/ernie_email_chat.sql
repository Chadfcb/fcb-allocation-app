-- =========================================================
-- Email Studio → Ernie → Chat (2026-11-20, per Chad / Eddie: "can we have
-- ernie chat in there, so he can work with ernie directly in that section").
--
-- A chat with Ernie inside the email designer belongs to ONE email, so each
-- email keeps its own conversation (reopen the email → the chat is still
-- there). Same ernie_conversations / ernie_messages tables as the Ernie page
-- (same "only your own conversations" rules); this just marks which email a
-- conversation belongs to. These chats are left out of the Ernie page's
-- conversation list.
-- Safe to run twice. No new tables.
-- =========================================================

alter table public.ernie_conversations
  add column if not exists email_design_id uuid references public.email_designs(id) on delete cascade;

create index if not exists ernie_conversations_email_design_idx
  on public.ernie_conversations (user_id, email_design_id, updated_at desc)
  where email_design_id is not null;

comment on column public.ernie_conversations.email_design_id is
  'Set when the conversation is the Ernie chat inside the Email Studio designer for this email (email_designs.id); null for normal Ernie page conversations.';
