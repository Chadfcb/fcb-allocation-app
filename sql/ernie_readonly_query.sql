-- Ernie's general-purpose, read-only data tool. Rather than hand-building a
-- narrow function in lib/ernie/tools.ts for every new kind of question
-- someone thinks to ask, Ernie can call this function directly with any
-- read-only SELECT statement and get the results back as JSON, the same
-- way it uses any other tool's output — "the more versatile the tool the
-- better" (Chad, 2026-08-31), after a "do we have enough packaging
-- materials to cover the order" question had no existing tool to answer
-- it and Ernie had nothing to fall back on.
--
-- Safety comes from several independent layers, not just one:
--   1. security invoker (deliberately NOT definer) — the query runs as the
--      actual signed-in user's own Postgres role, so every Row Level
--      Security policy already in schema.sql applies exactly as it would
--      if that same user queried the table directly through the app
--      itself. A Basic user's query against an admin-only table
--      (purchase_orders, distributor_inventory, build_order_recommendations,
--      events, pricing_brands and the rest of Sales, pos_label_files)
--      simply comes back with zero rows, the same as anywhere else.
--   2. Statement-shape checks below reject anything that isn't a single
--      plain read-only SELECT (optionally with a WITH/CTE prefix) — no
--      INSERT, UPDATE, DELETE, or any DDL/admin command, no matter who's
--      asking, and no stacking a second statement after a semicolon.
--   3. One deliberate carve-out: `profiles` is world-readable to any
--      signed-in user by RLS design (profiles_select_all — needed
--      elsewhere in the app for attribution/audit display), but Chad's
--      requirement is that Basic users never get a "list every user"
--      capability through Ernie — so a non-admin's query mentioning
--      `profiles` is rejected here explicitly, same restriction already
--      enforced for the get_users tool in lib/ernie/tools.ts.
--   4. The `auth`/`storage`/`vault`/`extensions` schemas are blocked
--      outright (defense in depth — the authenticated role shouldn't have
--      meaningful grants there anyway, but this makes it explicit).
--   5. A hard cap of 500 result rows and an 8-second statement timeout
--      guard against a runaway or overly broad query.
--
-- Idempotent — safe to re-run.

create or replace function ernie_readonly_query(query_text text)
returns jsonb
language plpgsql
security invoker
set search_path = public
set statement_timeout = '8s'
as $$
declare
  caller_is_admin boolean;
  cleaned text;
  result jsonb;
begin
  if auth.uid() is null then
    raise exception 'Not signed in';
  end if;

  -- Trim whitespace and a single trailing semicolon (a common, harmless
  -- habit) before validating — but reject any semicolon that remains,
  -- since that would mean a second statement is being smuggled in.
  cleaned := regexp_replace(trim(query_text), ';\s*$', '');

  if cleaned = '' then
    raise exception 'No query provided';
  end if;

  if cleaned ~ ';' then
    raise exception 'Only a single statement is allowed (no semicolons)';
  end if;

  if lower(cleaned) !~ '^(select|with)\M' then
    raise exception 'Only SELECT queries are allowed';
  end if;

  if cleaned ~* '\y(insert|update|delete|drop|alter|truncate|grant|revoke|create|copy|vacuum|call|do|execute|lock|merge|refresh|reindex|cluster|listen|notify|unlisten|checkpoint|comment)\y' then
    raise exception 'Only read-only SELECT queries are allowed';
  end if;

  if cleaned ~* '\y(auth|storage|vault|extensions)\.' then
    raise exception 'Querying system schemas is not allowed';
  end if;

  select exists(
    select 1 from public.profiles p where p.id = auth.uid() and p.role = 'admin'
  ) into caller_is_admin;

  if not caller_is_admin and cleaned ~* '\yprofiles\y' then
    raise exception 'Querying the profiles table is restricted to admins';
  end if;

  execute format(
    'select coalesce(jsonb_agg(ernie_row), ''[]''::jsonb) from (select * from (%s) as ernie_query limit 500) as ernie_row',
    cleaned
  ) into result;

  return result;
end;
$$;

grant execute on function ernie_readonly_query(text) to authenticated;
