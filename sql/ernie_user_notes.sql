-- Ernie's per-person memory, added 2026-09-10 per Chad: "i would like Ernie
-- to learn from the individuals he interacts with in the web app, retain a
-- memory on who the different people are, how they prefer to communicate
-- with him, and how they prefer him to communicate with them."
--
-- One row per user: a short running note Ernie keeps updating on its own
-- (via the update_person_notes tool, see lib/ernie/tools.ts) covering
-- communication style (tone, brevity, format preferences) and durable work
-- context that's come up naturally — never personal or sensitive
-- information (enforced by the tool's own instructions, not by this table).
--
-- Fully private by explicit design, per Chad: "lets just have only the
-- users be able to edit it" -> "no one but the person themselves" (not even
-- an admin). Unlike every other Ernie-related table, there is deliberately
-- NO admin bypass here at all -- this is the one place in the whole app
-- where being an admin/Administrator grants nothing extra. Ernie itself
-- only ever reads/writes the CURRENT signed-in user's own row (userId comes
-- from the server-verified session in app/api/ernie/chat/route.ts, never
-- from model input), so this RLS policy is the only enforcement needed.
--
-- Idempotent -- safe to re-run.

create table if not exists ernie_user_notes (
  user_id uuid primary key references auth.users(id) on delete cascade,
  notes text not null default '',
  updated_at timestamptz not null default now()
);

alter table ernie_user_notes enable row level security;

drop policy if exists "ernie_user_notes_owner_only" on ernie_user_notes;
create policy "ernie_user_notes_owner_only" on ernie_user_notes for all using (
  user_id = auth.uid()
) with check (
  user_id = auth.uid()
);
