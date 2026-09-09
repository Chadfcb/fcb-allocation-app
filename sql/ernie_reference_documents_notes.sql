-- Follow-up to sql/ernie_reference_documents.sql, same day (2026-09-09).
--
-- Two fixes:
-- 1. storage_path was declared `not null`, which means a pure text note
--    (no accompanying uploaded file — just an explanation Ernie should
--    know) could never actually be inserted. Not every reference "document"
--    needs a real file; sometimes it's just a fact worth writing down.
--    storage_path is now nullable — a null storage_path means
--    "description-only note," no file to fetch via get_file_for_download.
-- 2. Actually inserts the excise tax explanation Chad asked Ernie about,
--    which is the concrete thing this whole feature was built for. This
--    was the missing step before now — the table existed but nothing had
--    ever been put in it.
--
-- Run this once in Supabase's SQL Editor, after ernie_reference_documents.sql.
-- Idempotent — safe to re-run (the insert is guarded by a WHERE NOT EXISTS
-- check on file_name so re-running this file doesn't duplicate the row).

alter table ernie_reference_documents alter column storage_path drop not null;

insert into ernie_reference_documents (file_name, storage_path, description)
select
  'Excise Tax Calculation (Contribution Margin)',
  null,
  'Contribution Margin''s excise tax figure (TOTAL_EXCISE_TAX_PER_BATCH in lib/contributionMargin.ts) is a FIXED CONSTANT, not stored data anywhere in the database — carried over exactly from the old FCB Pricing desktop app, which never made it editable either. It equals $291 per batch: 30 bbl x $3.50 (federal excise tax) + 30 bbl x $31 x 0.20 (California excise tax), applied flat regardless of brand or package format, and independent of that brand''s own margin_analyses.yield_bbls (Contribution Margin always assumes a flat 25-BBL batch for its own case-equivalents math, CM_BBL_YIELD, but excise tax itself is computed off a 30-BBL batch — a quirk carried over as-is from the old app). Every Contribution Margin line''s exciseTax field is this same $291 figure; there is no per-brand or per-package variation. There is no database column for it and no other source of truth in this app — if the real tax rate or the batch-size assumption ever changes, it has to be changed directly in that constant in lib/contributionMargin.ts, not through any UI or database edit.'
where not exists (
  select 1 from ernie_reference_documents where file_name = 'Excise Tax Calculation (Contribution Margin)'
);
