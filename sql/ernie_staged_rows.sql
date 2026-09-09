-- Ernie's "load a file's rows for real analysis" feature, added 2026-09-09
-- per Chad: "i need him to be able to pull any data from the app, take any
-- data given to it, and present me with [a from-scratch weighted analysis]."
--
-- The gap this closes: run_read_only_query (sql/ernie_readonly_query.sql)
-- already lets Ernie do real SQL aggregation against the app's OWN database
-- tables, and read_uploaded_file already lets Ernie see an uploaded file's
-- contents — but only as a rendered, ~300-row text grid (see
-- lib/ernie/files.ts's RENDER_MAX_ROWS). Neither one lets Ernie do bulk
-- arithmetic (filter, group, weighted-average) across a file with thousands
-- of rows — an LLM can't reliably hand-sum that many rows just by reading
-- them as text, the same way a person couldn't either.
--
-- The fix: stage_uploaded_file_for_query (see lib/ernie/tools.ts) parses an
-- uploaded spreadsheet/CSV IN FULL and inserts every row here as a JSONB
-- object (column name -> cell value), scoped to the signed-in user and the
-- specific file. Ernie then reaches for the SAME run_read_only_query tool
-- it already has to run real SQL — SUM, GROUP BY, JOIN, whatever the
-- question needs — against these staged rows, exactly like querying any
-- other table in the app. No new query engine, no code sandbox: this reuses
-- Postgres itself as the "compute engine," which is the piece that was
-- actually missing.
--
-- This table is scratch space, not permanent app data: rows are replaced
-- (old ones for the same file_id deleted first) every time a file is
-- (re-)staged, and clear_staged_file_data lets Ernie tidy up when a query
-- session is done. It intentionally is NOT reachable through
-- ernie_readonly_query for writes — that function only permits SELECT — so
-- all inserts/deletes here go through lib/ernie/tools.ts using the caller's
-- own request-scoped Supabase client, still bound by the RLS policy below.
--
-- Idempotent — safe to re-run.

create table if not exists ernie_staged_rows (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  file_id uuid not null references ernie_files(id) on delete cascade,
  sheet_name text,
  row_index integer not null,
  data jsonb not null,
  created_at timestamptz not null default now()
);

create index if not exists ernie_staged_rows_user_file_idx
  on ernie_staged_rows (user_id, file_id, row_index);

-- GIN index so a query filtering/grouping on a specific JSONB field (e.g.
-- data->>'ItemName') doesn't have to sequential-scan every staged row.
create index if not exists ernie_staged_rows_data_gin_idx
  on ernie_staged_rows using gin (data);

alter table ernie_staged_rows enable row level security;

drop policy if exists "ernie_staged_rows_owner" on ernie_staged_rows;
create policy "ernie_staged_rows_owner" on ernie_staged_rows for all using (
  user_id = auth.uid()
) with check (
  user_id = auth.uid()
);
