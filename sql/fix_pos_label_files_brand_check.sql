-- Allows Oobli, Ugly Fresca, and Other labels to be logged in
-- pos_label_files, matching the brands already supported elsewhere in the
-- Labels feature. "Other" added 2026-09-05 as a catch-all for one-off
-- custom labels that don't belong to any of FCB's own brands (e.g.
-- Spartan Ale, made for San Jose State University).
alter table pos_label_files
  drop constraint if exists pos_label_files_brand_check;

alter table pos_label_files
  add constraint pos_label_files_brand_check
  check (brand in ('fcb', 'speakeasy', 'sonoma-cider', 'oobli', 'ugly-fresca', 'other'));
