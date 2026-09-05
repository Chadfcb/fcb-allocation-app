-- Allows Oobli and Ugly Fresca labels to be logged in pos_label_files,
-- matching the brands already supported elsewhere in the Labels feature.
alter table pos_label_files
  drop constraint if exists pos_label_files_brand_check;

alter table pos_label_files
  add constraint pos_label_files_brand_check
  check (brand in ('fcb', 'speakeasy', 'sonoma-cider', 'oobli', 'ugly-fresca'));
