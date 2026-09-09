-- Audit trail for Ernie's internet-read and sandbox capabilities, added
-- 2026-09-09 — see claude/ernie-sandbox-restrictions.md's "a log of what
-- ran" requirement (the restriction spec Chad and Claude agreed on before
-- building web_fetch/fetch_url_as_file/code_execution support into Ernie).
--
-- Every insert here is best-effort from app/api/ernie/chat/route.ts and
-- lib/ernie/tools.ts (via logErnieToolExecution in lib/ernie/files.ts) —
-- a logging failure never blocks or breaks Ernie's actual reply. Rows
-- record, per call: which tool ran (web_fetch, bash_code_execution,
-- text_editor_code_execution, fetch_url_as_file, or
-- code_execution_file_created for a file the sandbox produced), and a
-- free-form jsonb "detail" — the URL fetched, the command/path run, or
-- the generated file's name — so if something ever looks off, it's
-- traceable, in the same spirit as the app's existing Audit Log
-- (sql/... audit_log table, admin/audit page).
--
-- Idempotent — safe to re-run.

create table if not exists ernie_tool_execution_log (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  conversation_id uuid references ernie_conversations(id) on delete set null,
  tool_name text not null,
  detail jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists ernie_tool_execution_log_user_idx
  on ernie_tool_execution_log (user_id, created_at desc);

alter table ernie_tool_execution_log enable row level security;

-- Same owner-scoped read pattern as ernie_files/ernie_staged_rows, plus a
-- broader read for any admin — this is an audit/traceability log, not
-- personal data, so it's reasonable for an admin to review any user's
-- Ernie internet/sandbox activity if something looks off, the same way
-- the app's existing Audit Log page is admin-visible across all users.
drop policy if exists "ernie_tool_execution_log_select" on ernie_tool_execution_log;
create policy "ernie_tool_execution_log_select" on ernie_tool_execution_log for select using (
  user_id = auth.uid()
  or exists (select 1 from profiles where id = auth.uid() and role = 'admin')
);

-- Inserts always come from the caller's own request-scoped Supabase
-- client (see logErnieToolExecution in lib/ernie/files.ts), so this is
-- the same "insert your own rows only" shape as ernie_staged_rows.
drop policy if exists "ernie_tool_execution_log_insert" on ernie_tool_execution_log;
create policy "ernie_tool_execution_log_insert" on ernie_tool_execution_log for insert with check (
  user_id = auth.uid()
);
