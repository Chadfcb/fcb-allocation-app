-- Adds a small preview-image column so label cards can show a real thumbnail
-- (pulled from the PSD's flattened composite image) instead of a generic
-- file icon, since browsers can't render .psd files directly. Applies to
-- every entry, including the 2 Drive-link ones — the original full file
-- stays wherever it already is; this is just an extra, small preview copy.
alter table pos_label_files
  add column if not exists preview_path text;
