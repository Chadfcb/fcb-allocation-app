-- Sales Dashboard Files (2026-11-12, per Chad: "can we add the same thing to
-- the sales dashboard, id like to throw files in there too").
-- The same drop box as the distributor pages (sql/distributor_files.sql),
-- using the same distributor_files table and distributor-files bucket:
--   table rows with dist = 'Sales Dashboard'
--   storage files under sales-dashboard/
-- Access: Sales Dashboard access (Admin → Users). Distributor files keep
-- their distributor-page access, unchanged.
-- Run once in Supabase's SQL Editor, after sql/distributor_files.sql and
-- before the code push. Safe to re-run.

-- 1. File list access
drop policy if exists "distributor_files_page" on distributor_files;
create policy "distributor_files_page" on distributor_files for all using (
  case when dist = 'Sales Dashboard'
    then has_section(auth.uid(), 'sales_dashboard')
    else has_section(auth.uid(), public.dist_section(dist))
  end
) with check (
  case when dist = 'Sales Dashboard'
    then has_section(auth.uid(), 'sales_dashboard')
    else has_section(auth.uid(), public.dist_section(dist))
  end
);

comment on table distributor_files is
  'Files boxes: dropped-in files for each distributor page (dist = distributor name, e.g. The Localist; storage folder = page slug, e.g. the-localist) and for the Sales Dashboard (dist = ''Sales Dashboard''; storage folder sales-dashboard). Files live in the distributor-files storage bucket. Access: that distributor''s page (dist_<name>), or Sales Dashboard access for the Sales Dashboard files.';

-- 2. Storage access
drop policy if exists "distributor_files_bucket_page" on storage.objects;
create policy "distributor_files_bucket_page" on storage.objects for all using (
  bucket_id = 'distributor-files'
  and case when (storage.foldername(name))[1] = 'sales-dashboard'
    then has_section(auth.uid(), 'sales_dashboard')
    else has_section(auth.uid(), 'dist_' || replace((storage.foldername(name))[1], '-', '_'))
  end
) with check (
  bucket_id = 'distributor-files'
  and case when (storage.foldername(name))[1] = 'sales-dashboard'
    then has_section(auth.uid(), 'sales_dashboard')
    else has_section(auth.uid(), 'dist_' || replace((storage.foldername(name))[1], '-', '_'))
  end
);
