-- LilyPad automatic sync (added 2026-10-16, per Chad — project doc
-- claude/lilypad-sync-plan.md). Code: lib/syncs/lilypadReader.ts,
-- lib/syncs/lilypadSales.ts, lib/syncs/lilypadCheckins.ts.
--
-- Adds the two new sources to Admin → Ekos Sync (switched OFF until Chad has
-- put LILYPAD_USERNAME / LILYPAD_PASSWORD in Vercel and a test run looks
-- right), an index for the check-in sync, and refreshes Ernie's notes on the
-- tables it fills. No new tables.
--
-- Run this in Supabase's SQL Editor BEFORE pushing the code. Idempotent —
-- safe to run more than once.

insert into public.sync_sources (key, label, enabled, sort_order) values
  ('lilypad_sales', 'LilyPad — Account Sales', false, 10),
  ('lilypad_checkins', 'LilyPad — Check-ins', false, 11)
on conflict (key) do nothing;

-- The check-in sync clears and re-saves its own rows (source "Lilypad: …")
-- for a date range every run.
create index if not exists sales_account_checkins_source_date_idx
  on public.sales_account_checkins (source, checkin_date);

-- Month lookups for the sales sync's "replace these months" step.
create index if not exists sales_account_sales_month_idx
  on public.sales_account_sales (month);

-- Ernie's notes (see sql/ernie_data_map.sql) — now that LilyPad syncs daily.
comment on table public.sales_account_sales is $c$WHAT DISTRIBUTORS SOLD TO EACH STORE/BAR: one row per account x month x product x package x distributor, with ce (case equivalents), size (12oz / 16oz / 19.2oz / 22oz bottle / 1/2 bbl / 1/6 bbl / 13.2 gal keg) and last_buy_date. Use for "who bought X", "last time X sold in a distributor's territory", "how much X did Saccani sell in September". Join sales_accounts on outlet_id for the account name. Monthly totals, not single invoices. Cases or kegs = ce / sales_case_factor(size). Sales before 2026 from VIP; 2026 on from LilyPad, synced automatically every weekday morning (sales_data_meta.as_of = how current it is).$c$;
comment on table public.sales_account_checkins is $c$Sales rep visits / check-ins at accounts: outlet_id, checkin_date, rep, activity (Off/On Premise Visit, Phone Call, Email/Text Contact, …), outcome, notes (meeting recap), brands (sampled), contact. source "Lilypad: sync" = synced automatically from LilyPad every weekday morning; "Sales Ops: …" = from the Sales Ops spreadsheets; empty = logged in the app.$c$;
comment on table public.sales_data_meta is $c$The "as of" date of the account sales data (latest invoice date pulled) and when it was last updated — by the daily LilyPad sync (note "LilyPad sync") or the Import data panel. Check this to say how current sales_account_sales is.$c$;
