-- Ernie's live data map (added 2026-10-16, per Chad — project doc
-- claude/ernie-live-data-map-plan.md).
--
-- Why: Ernie answered "who did Matagrano sell Big Daddy 1/2 bbl to" with
-- "we don't have visibility into that" — while Sales > Accounts had exactly
-- that data. His query tool carried a HAND-WRITTEN list of tables, and the
-- Sales > Accounts tables had never been added to it. Chad: adding them would
-- be a bandaid — "why isn't he looking everywhere he has access to first?"
--
-- The fix, in two parts:
--
--   1. ernie_data_map() — reads the database's own catalog and returns every
--      table, view and documented function in `public` that THE SIGNED-IN
--      PERSON can read, with its columns and its one-line description. The
--      app calls it at the start of every Ernie reply and hands it to Ernie,
--      so a table built tomorrow is in Ernie's map the moment it exists —
--      nobody has to remember to update a list.
--
--      Access is worked out from each table's own row-level-security rules
--      (the same rules the rest of the app uses), evaluated ONCE for this
--      person — never per row, so it stays fast on big tables:
--        * RLS off + SELECT grant         → listed
--        * a read rule like has_section(…) → evaluated once: listed if true
--        * a rule about the row itself      → listed as "own rows" (e.g.
--          (user_id = auth.uid()) — the person sees their own rows only)
--        * no read rule at all              → not listed (server-only table)
--        * views → listed when every table they read from is listed
--        * profiles → admins only (same rule as ernie_readonly_query)
--      A table whose description starts with "[hidden]" is never listed —
--      used for app plumbing (sign-in tokens, sync bookkeeping, UI state)
--      that Ernie has no business answering from.
--      A function is listed only if it has a description; a description
--      starting "[needs:<section>]" is listed only for people with that
--      section (the function itself still checks access when called).
--
--   2. A plain-English description on every table (COMMENT ON TABLE), below.
--      STANDING RULE from 2026-10-16 (claude/deployment-workflow.md): every
--      new table gets its COMMENT in the same SQL file that creates it —
--      that comment IS what tells Ernie what the table is for.
--
-- Safety: security invoker — runs as the signed-in person, reads only the
-- catalog, never table rows. Read-only.
--
-- Run this in Supabase's SQL Editor BEFORE pushing the code. Idempotent —
-- safe to run more than once (re-running just refreshes the descriptions).

create or replace function public.ernie_data_map()
returns jsonb
language plpgsql
stable
security invoker
set search_path = public
as $$
declare
  me uuid := auth.uid();
  is_admin boolean;
  rel record;
  pol record;
  fn record;
  vis text;            -- 'all' | 'own' | null (not visible)
  any_true boolean;
  any_own boolean;
  restrictive_ok boolean;
  ok boolean;
  result jsonb := '[]'::jsonb;
  visible jsonb := '{}'::jsonb;  -- relname -> 'all' | 'own'
  dep record;
  view_ok boolean;
  view_own boolean;
  needs text;
begin
  if me is null then
    raise exception 'Not signed in';
  end if;

  select exists(select 1 from public.profiles p where p.id = me and p.role = 'admin') into is_admin;

  -- Pass 1: tables.
  for rel in
    select c.oid, c.relname, c.relrowsecurity, obj_description(c.oid, 'pg_class') as descr
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relkind in ('r', 'p')
    order by c.relname
  loop
    continue when coalesce(rel.descr, '') like '[hidden]%';
    continue when not has_table_privilege(rel.oid, 'SELECT');
    continue when rel.relname = 'profiles' and not is_admin;

    if not rel.relrowsecurity then
      vis := 'all';
    else
      any_true := false;
      any_own := false;
      restrictive_ok := true;
      for pol in
        select p.qual, p.permissive
        from pg_policies p
        where p.schemaname = 'public'
          and p.tablename = rel.relname
          and p.cmd in ('SELECT', 'ALL')
          and (p.roles && array['public', 'authenticated']::name[])
      loop
        begin
          if pol.qual is null then
            ok := true;
          else
            execute 'select (' || pol.qual || ')::boolean' into ok;
          end if;
          if pol.permissive = 'PERMISSIVE' then
            if coalesce(ok, false) then any_true := true; end if;
          elsif not coalesce(ok, false) then
            restrictive_ok := false;
          end if;
        exception when others then
          -- The rule refers to the row itself (e.g. user_id = auth.uid()),
          -- so it can't be answered once for the whole table: the person
          -- sees whichever rows the rule lets through — their own.
          if pol.permissive = 'PERMISSIVE' then any_own := true; end if;
        end;
      end loop;

      vis := case
        when not restrictive_ok then null
        when any_true then 'all'
        when any_own then 'own'
        else null
      end;
    end if;

    continue when vis is null;
    visible := visible || jsonb_build_object(rel.relname, vis);

    result := result || jsonb_build_array(jsonb_build_object(
      'name', rel.relname,
      'kind', 'table',
      'access', vis,
      'description', coalesce(rel.descr, ''),
      'columns', (
        select string_agg(a.attname || ' ' || format_type(a.atttypid, a.atttypmod), ', ' order by a.attnum)
        from pg_attribute a
        where a.attrelid = rel.oid and a.attnum > 0 and not a.attisdropped
      )
    ));
  end loop;

  -- Pass 2: views — listed when every public table they read is visible.
  for rel in
    select c.oid, c.relname, obj_description(c.oid, 'pg_class') as descr
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relkind in ('v', 'm')
    order by c.relname
  loop
    continue when coalesce(rel.descr, '') like '[hidden]%';
    continue when not has_table_privilege(rel.oid, 'SELECT');
    view_ok := true;
    view_own := false;
    for dep in
      select distinct t.relname
      from pg_rewrite r
      join pg_depend d on d.objid = r.oid and d.classid = 'pg_rewrite'::regclass and d.refclassid = 'pg_class'::regclass
      join pg_class t on t.oid = d.refobjid
      join pg_namespace tn on tn.oid = t.relnamespace
      where r.ev_class = rel.oid and t.oid <> rel.oid and tn.nspname = 'public'
    loop
      if not (visible ? dep.relname) then view_ok := false; end if;
      if visible ->> dep.relname = 'own' then view_own := true; end if;
    end loop;
    continue when not view_ok;

    result := result || jsonb_build_array(jsonb_build_object(
      'name', rel.relname,
      'kind', 'view',
      'access', case when view_own then 'own' else 'all' end,
      'description', coalesce(rel.descr, ''),
      'columns', (
        select string_agg(a.attname || ' ' || format_type(a.atttypid, a.atttypmod), ', ' order by a.attnum)
        from pg_attribute a
        where a.attrelid = rel.oid and a.attnum > 0 and not a.attisdropped
      )
    ));
  end loop;

  -- Pass 3: documented functions (callable from a SELECT).
  for fn in
    select p.oid, p.proname, pg_get_function_identity_arguments(p.oid) as args,
           pg_get_function_result(p.oid) as returns, obj_description(p.oid, 'pg_proc') as descr
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.prokind = 'f'
      and obj_description(p.oid, 'pg_proc') is not null
    order by p.proname
  loop
    continue when fn.descr like '[hidden]%';
    continue when not has_function_privilege(fn.oid, 'EXECUTE');
    needs := substring(fn.descr from '^\[needs:([a-z_]+)\]');
    if needs is not null then
      continue when not public.has_section(me, needs);
    end if;
    result := result || jsonb_build_array(jsonb_build_object(
      'name', fn.proname || '(' || fn.args || ')',
      'kind', 'function',
      'access', 'all',
      'description', regexp_replace(fn.descr, '^\[needs:[a-z_]+\]\s*', ''),
      'columns', 'returns ' || fn.returns
    ));
  end loop;

  return result;
end;
$$;

comment on function public.ernie_data_map() is
  '[hidden] Ernie''s live data map — see sql/ernie_data_map.sql.';

grant execute on function public.ernie_data_map() to authenticated;

-- ---------------------------------------------------------------------------
-- Descriptions. Plain English: what's in the table, and what questions it
-- answers. Tables that don't exist in this database are skipped quietly.
-- ---------------------------------------------------------------------------
do $do$
declare
  r record;
  kind "char";
begin
  for r in
    select * from (values
      -- Weeks / products / distributors
      ('weeks', $c$Delivery weeks. Every inventory, allocation, PO and packaging number in the app belongs to one week. status is open/closed; the open week is the current one. label is how people name a week ("Oct 12th"); week_start is its Monday.$c$),
      ('products', $c$FCB's sellable products (one row per product + package, e.g. "Big Daddy IPA (1/2 bbl)"). Canned products are counted in CASES, kegs in KEGS — never cans. classify_product_packaging(name) tells you which package a product is.$c$),
      ('distributors', $c$FCB's distributors (Matagrano, Saccani, Markstein, Guardian, Valley Wide, SF Naturals, etc.): sort order, payment_terms_days (Finance > Distributor Data), whether their inventory is tracked, core-distributor flag, allocations lock.$c$),
      ('distributor_prices', $c$What FCB charges each distributor for each product (per case / per keg). Order value = allocation quantity x price.$c$),
      ('section_dividers', $c$[hidden] Visual divider rows on the Inventory & Allocation page.$c$),

      -- Inventory & Allocation
      ('inventory_snapshots', $c$FCB's own brewery inventory per product per week (Inventory & Allocation page): on_hand, unlabeled, to_be_packaged. In cases for cans, kegs for kegs. status_flag: good_confirmed / dont_have / have_some / need_to_package / need_pakteks / need_labels / need_cans / need_kegs. Use the inventory_with_remaining view to also get total and remaining.$c$),
      ('inventory_with_remaining', $c$Same as inventory_snapshots plus total and remaining (total minus everything allocated that week).$c$),
      ('allocations', $c$What FCB is sending each distributor: one row per week x distributor x product, quantity in cases (cans) or kegs. status_flag (same values as inventory_snapshots) says what an order still needs — "what does Matagrano's order still need" = filter this. These are FCB's sales TO distributors, not what distributors sold to stores (that's sales_account_sales).$c$),
      ('distributor_pos', $c$Each distributor's PO for a week: po_number, po_status (approved / pending / delivered), delivery_date.$c$),
      ('packaging_inventory', $c$Packaging materials on hand per week. item_key: cans_19_2oz, cans_16oz, cans_12oz, pakteks_4pack, pakteks_6pack, trays_12_16oz, trays_19oz, lids_202, kegs_1_6bbl, kegs_1_2bbl. For Consumed / Remaining as the Inventory page shows them, open /inventory instead of computing.$c$),
      ('label_inventory', $c$Can labels on hand per product per week (individual labels, not rolls). For Consumed / Remaining as the page shows them, open /inventory.$c$),
      ('custom_packaging_items', $c$Extra packaging items added by hand beyond the fixed list in packaging_inventory.$c$),
      ('custom_packaging_inventory', $c$On-hand counts per week for custom_packaging_items.$c$),
      ('custom_label_items', $c$Extra label items added by hand beyond the per-product labels.$c$),
      ('custom_label_inventory', $c$On-hand counts per week for custom_label_items.$c$),

      -- Distributor-reported data / Build Orders
      ('distributor_inventory', $c$What each DISTRIBUTOR reports having in THEIR warehouse, per week x product: on_hand_qty and rate_of_sale (units per week leaving their warehouse). This is the distributor's stock level only — it does NOT say which stores bought anything (that's sales_account_sales).$c$),
      ('suggested_orders', $c$Weeks of supply per distributor x product, from distributor_inventory (on hand / rate of sale).$c$),
      ('distributor_par_levels', $c$Build Orders: the target stock level per distributor x product.$c$),
      ('build_order_recommendations', $c$Build Orders: recommended order quantity per week x distributor x product.$c$),
      ('tank_allocations', $c$Build Orders > Tank Allocations: per brand, which fermenter (fv_number) it's in, BBLs available, and BBLs committed by package (single / 4pack / 6pk / sixth / half). BBLs remaining is computed, not stored.$c$),

      -- Sales > Accounts (store-level sales — the data Ernie missed)
      ('sales_accounts', $c$Every retail account (bar, restaurant, store) FCB beer is sold to or could be, keyed by VIP outlet_id: name, address, city, distributor (which distributor services it), premise (On/Off), last_buy_date, first_buy_date, lifetime_ce, ce_12mo (case equivalents in the last 12 months), buy_months_6. Sales > Accounts page. Data from VIP (to mid-2026) and LilyPad (2026 on).$c$),
      ('sales_account_sales', $c$WHAT DISTRIBUTORS SOLD TO EACH STORE/BAR: one row per account x month x product x package x distributor, with ce (case equivalents), size (12oz / 16oz / 19.2oz / 22oz bottle / 1/2 bbl / 1/6 bbl / 13.2 gal keg) and last_buy_date. Use for "who bought X", "last time X sold in a distributor's territory", "how much X did Saccani sell in September". Join sales_accounts on outlet_id for the account name. Monthly totals, not single invoices. Cases or kegs = ce / sales_case_factor(size). Sales before 2026 from VIP, 2026 on from LilyPad.$c$),
      ('sales_account_checkins', $c$Sales rep visits / check-ins at accounts: outlet_id, checkin_date, rep, activity, outcome, notes, brands (sampled), contact. source starts "Lilypad:" or "Sales Ops:" when imported; otherwise logged in the app.$c$),
      ('sales_account_contacts', $c$Buyer / manager contacts at each account (name, title, phone, email).$c$),
      ('sales_account_class', $c$How each account is classified by the sales team: owner_type (fcb / buddy / distributor / cadence), tier (A/B/C), handled_by (fcb_rep / distributor_rep / back_office), tags, and the distributor "buddy" rep for shared accounts.$c$),
      ('sales_account_off', $c$Accounts turned off on the Sales Dashboard (closed / not relevant). Turned-off accounts are left out of Sales > Accounts and the dashboard.$c$),
      ('sales_data_meta', $c$The "as of" date of the account sales data (last buy date in the latest import) and when it was imported. Check this to say how current sales_account_sales is.$c$),
      ('sales_product_hidden', $c$Products hidden from Product Lookup (no longer made). Still in sales_account_sales.$c$),

      -- Sales Dashboard (chains)
      ('sales_chain_names', $c$Sales Dashboard chain fixes: renames / merges of automatically detected chains (from store names like "SAFEWAY #667"), or "not a chain".$c$),
      ('sales_chain_store', $c$Sales Dashboard: stores moved into (or out of) a chain by hand.$c$),
      ('sales_chain_list_link', $c$Sales Dashboard: which dashboard chain each chain on the Chain Mandates / Chain Authorizations pages is.$c$),
      ('sales_chain_item_link', $c$Sales Dashboard: which product + size each item on the Chain Mandates / Chain Authorizations pages is.$c$),
      ('sales_chain_item_status', $c$Sales Dashboard: Flex / Mandate status picked for a chain + product + size.$c$),

      -- Chain authorizations / mandates
      ('chain_auth_chains', $c$Chain Authorizations page: the chains (grocery/retail) with authorized items.$c$),
      ('chain_auth_items', $c$Chain Authorizations page: each chain's authorized items, as typed.$c$),
      ('chain_mandate_chains', $c$Chain Mandates page: chains with mandated products.$c$),
      ('chain_mandate_products', $c$Chain Mandates page: mandated products per chain (product_name, package, upc).$c$),
      ('chain_mandate_stores', $c$Chain Mandates page: which stores (store_number, tier, address, status) each mandated product applies to.$c$),

      -- Sales pricing / costing
      ('pricing_brands', $c$Brands used by Price List, Margin Analysis, Cost Per Case and Contribution Margin. company groups brands under a parent for Contribution Margin.$c$),
      ('brand_price_list', $c$Price List: what's charged per brand per package. package_key: 6pk / 4pack / single / sixth / half.$c$),
      ('margin_analyses', $c$Margin Analysis: per brand, the standard batch's total cost and BBL yield (yield_bbls defaults to 30).$c$),
      ('margin_analysis_packages', $c$Margin Analysis per-package settings: enabled, ptr, ptd, pack_cost, labor, yield_amt. A null pack_cost / labor / yield_amt means "use the standard default for that format", not zero.$c$),
      ('packaging_components', $c$Cost Per Case: unit prices for cans, lids, trays, pakteks and other packaging parts.$c$),
      ('ingredient_costs', $c$Unit price per raw ingredient. category_key: yeast / grain / hops / flavoring / other.$c$),
      ('package_labor_costs', $c$Labor cost per package format.$c$),
      ('batch_recipe_items', $c$Batch Ingredients: each brand's recipe, quantity per BBL. Cost for N bbls = sum of qty_per_bbl x N x ingredient_costs.price (join on ingredient_key).$c$),
      ('contribution_margin_lines', $c$Contribution Margin: revenue per case-equivalent per brand per package. Everything else on that page is computed from Cost Per Case and Margin Analysis.$c$),

      -- Purchase orders / Ekos
      ('purchase_orders', $c$Purchase orders FCB placed with suppliers (synced from Ekos): supplier, po_date, expected_delivery_date, total_cost, payment_status, paid_date, ordered_status, comments.$c$),
      ('purchase_order_items', $c$Line items on each purchase order: item_name, quantity, unit_cost, line_total.$c$),
      ('ekos_tanks', $c$Live tank status synced from Ekos (Tanks page): each tank's batch, product, stage, start date, temperature, dry hop, yeast in cone, tasks left, plus batch_details.$c$),
      ('ekos_name_map', $c$[hidden] Ekos sync: how Ekos names map to app names.$c$),
      ('ekos_batch_item_kinds', $c$[hidden] Ekos sync bookkeeping.$c$),
      ('ekos_task_stage_map', $c$[hidden] Ekos sync bookkeeping.$c$),
      ('ekos_sync_status', $c$When the Ekos data was last synced.$c$),
      ('sync_sources', $c$[hidden] Admin > Ekos Sync: which sync sources are switched on.$c$),
      ('sync_runs', $c$History of automatic Ekos sync runs: source, when, status, how many records, issues.$c$),
      ('sync_snapshots', $c$[hidden] Ekos sync debugging snapshots.$c$),

      -- Calendars / events / files
      ('events', $c$Events Calendar: events (tastings, festivals, promos) with dates, type, location, distributor, rep, notes.$c$),
      ('event_materials', $c$Files attached to one event. Storage bucket "event-materials" (use storage_path with get_file_for_download).$c$),
      ('pos_library', $c$Shared POS materials library (not tied to one event). Bucket "event-materials".$c$),
      ('chain_events', $c$Chain Calendar: chain resets, promos and other chain activity with dates and rep.$c$),
      ('chain_event_materials', $c$Files attached to a chain calendar event.$c$),
      ('social_media_events', $c$Social Media Calendar: planned posts with dates, type and notes.$c$),
      ('social_media_event_materials', $c$Files attached to a social media calendar post.$c$),
      ('pos_label_files', $c$Can / bottle label artwork by brand and size. Bucket "pos-label-files".$c$),
      ('pos_football_files', $c$Football-season POS artwork library.$c$),
      ('upc_codes', $c$UPC codes per brand, size and product.$c$),
      ('google_calendar_sync', $c$[hidden] Google Calendar sync settings.$c$),
      ('google_oauth_connection', $c$[hidden] Google sign-in token. Server only.$c$),

      -- Tasks
      ('task_categories', $c$Tasks page: task categories.$c$),
      ('task_subcategories', $c$Tasks page: subcategories within a category.$c$),
      ('task_items', $c$Tasks: title, notes, status, due_date, category, who created it, when resolved.$c$),
      ('task_item_assignees', $c$Who each task is assigned to.$c$),
      ('task_item_activity', $c$History of changes on each task.$c$),
      ('task_messages', $c$Comments / messages on each task.$c$),

      -- Users / admin
      ('profiles', $c$App users: full_name, email, role (admin / basic). Admins only.$c$),
      ('user_section_access', $c$Which sections of the app each user has been granted.$c$),
      ('audit_log', $c$Every change made in the app: which table and field, old -> new value, who and when, and whether it was undone.$c$),
      ('sidebar_new_seen', $c$[hidden] Which "New!" sidebar badges each person has dismissed.$c$),

      -- Ernie's own tables
      ('ernie_reference_documents', $c$Reference notes and documents Chad and Claude added for Ernie: specs, decisions, background about the app. Read the whole table (it's small), description included. A null storage_path means the description IS the note. Bucket "reference-docs".$c$),
      ('ernie_projects', $c$Ernie Projects this person has access to (name, description).$c$),
      ('ernie_project_access', $c$Who has access to which Ernie Project.$c$),
      ('ernie_project_files', $c$Files in each Ernie Project's library. Bucket "ernie-project-files".$c$),
      ('ernie_project_messages', $c$[hidden] Ernie Project chat messages.$c$),
      ('ernie_staged_rows', $c$Scratch rows from a spreadsheet/CSV loaded with stage_uploaded_file_for_query. Always filter by file_id; each row's columns are inside the jsonb "data" field, named as the file's header row (data->>'Column'; cast numbers before summing).$c$),
      ('ernie_files', $c$[hidden] Files uploaded to or produced by Ernie (use list_uploaded_files).$c$),
      ('ernie_conversations', $c$[hidden] Ernie conversations (use search_past_conversations).$c$),
      ('ernie_messages', $c$[hidden] Ernie messages (use search_past_conversations).$c$),
      ('ernie_pending_actions', $c$[hidden] Ernie's staged write actions.$c$),
      ('ernie_tool_execution_log', $c$[hidden] Ernie tool log.$c$),
      ('ernie_user_notes', $c$[hidden] Ernie's private notes about each person.$c$),
      ('ernie_user_preferences', $c$[hidden] Ernie appearance settings.$c$),
      ('ernie_video_jobs', $c$[hidden] Ernie video render jobs.$c$)
    ) as v(tbl, txt)
  loop
    select c.relkind into kind
    from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relname = r.tbl;
    if kind is null then
      continue;
    elsif kind in ('v') then
      execute format('comment on view public.%I is %L', r.tbl, r.txt);
    elsif kind in ('m') then
      execute format('comment on materialized view public.%I is %L', r.tbl, r.txt);
    else
      execute format('comment on table public.%I is %L', r.tbl, r.txt);
    end if;
  end loop;
end
$do$;

-- Functions Ernie can call inside a SELECT. Skipped quietly if missing.
do $do$
declare
  r record;
begin
  for r in
    select * from (values
      ('public.classify_product_packaging(text)', $c$Which package a product name is: can_19_2oz / can_16oz / can_12oz / keg_1_2bbl / keg_1_6bbl / tap_handle / unrecognized.$c$),
      ('public.packaging_consumed_for_week(uuid)', $c$Packaging consumed by a week's allocations — but ONLY Delivered POs, so it does NOT match the Inventory page. For Consumed / Remaining as the page shows them, open /inventory.$c$),
      ('public.product_labels_per_case(uuid)', $c$How many labels one case of a product uses.$c$),
      ('public.sales_case_factor(text)', $c$Case equivalents per unit for a size (12oz case = 1, 16oz = 1.333, 19.2oz = 0.8, 22oz = 0.917, 1/2 bbl = 6.889, 1/6 bbl = 2.293, 13.2 gal = 5.867). Cases or kegs = ce / sales_case_factor(size).$c$),
      ('public.sales_product_options()', $c$[needs:accounts] Every product + size with account sales, and total CE (what Product Lookup offers).$c$),
      ('public.sales_product_lookup(text[], text[], text[], text, text, date, date)', $c$[needs:accounts] Sales > Accounts > Product Lookup: totals by month, distributor, product + size and by account for products, sizes, distributors, one outlet, premise (On/Off) and a month range (first day of From and To months). Null or empty = all.$c$),
      ('public.sales_dash_overview()', $c$[needs:sales_dashboard] Sales Dashboard start data: data date, distributors, chains with store counts, chain lists and Flex/Mandate picks.$c$),
      ('public.sales_gap_by_store(text, text)', $c$[needs:sales_dashboard] Gap report by store: one chain's stores (one distributor, or all when null) and what each bought per product + size — last date sold, CE in 90 days, CE in 12 months.$c$),
      ('public.sales_gap_by_item(text)', $c$[needs:sales_dashboard] Gap report by item: for one distributor (or all when null), per chain x product + size, how many stores carry it (bought in 90 days) and their CE.$c$),
      ('public.sales_dash_search(text)', $c$[needs:sales_dashboard] Search every account by name / city: distributor, chain, turned off or not.$c$),
      ('public.sales_chain_members()', $c$[needs:sales_dashboard] Every account that's in a chain, with its chain name.$c$)
    ) as v(sig, txt)
  loop
    if to_regprocedure(r.sig) is not null then
      execute format('comment on function %s is %L', r.sig, r.txt);
    end if;
  end loop;
end
$do$;
