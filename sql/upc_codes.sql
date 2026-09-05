-- UPC's — new Operations sub-tree, set up exactly like Labels: brand ->
-- size (19.2oz / 16oz / 12oz), same nesting, same PosLabelBrand/PosLabelSize
-- values. Added 2026-09-05, per Chad: "UPC has sub categories, Same Sub
-- categories as Labels" and then, after seeing a brand-only first pass:
-- "no, incorrect, i want it set up exactly like the labels is." Storage:
-- "In the database, editable on the page." Run this once in Supabase's SQL
-- Editor, before the matching code deploy. Idempotent — safe to re-run.
--
-- Access: gated by the "upcs" section (SectionKey, see lib/permissions.ts)
-- — same has_section() RLS pattern as every other gated table.

create table if not exists upc_codes (
  id uuid primary key default gen_random_uuid(),
  brand text not null
    check (brand in ('fcb', 'speakeasy', 'sonoma-cider', 'oobli', 'ugly-fresca')),
  size text not null
    check (size in ('19.2oz', '16oz', '12oz')),
  product_name text not null,
  upc text not null,
  created_by uuid references profiles(id),
  created_at timestamptz not null default now(),
  unique (brand, size, product_name)
);
create index if not exists upc_codes_brand_size_idx on upc_codes (brand, size);

alter table upc_codes enable row level security;

drop policy if exists "upc_codes_section" on upc_codes;
create policy "upc_codes_section" on upc_codes for all using (
  has_section(auth.uid(), 'upcs')
);

-- Realtime, same pattern as every other live-editable table here.
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'upc_codes'
  ) then
    alter publication supabase_realtime add table upc_codes;
  end if;
end $$;

-- Seed data Chad provided 2026-09-05. "Full Circle" -> brand 'fcb' (same
-- brand value used under Labels). Size is read straight off each product
-- name (every row Chad sent already has its size baked into the name, e.g.
-- "16oz/4pk" or "19.2"), matching how Labels itself splits by size. Oobli
-- and Ugly Fresca have no UPC data yet, so their 6 size pages start empty
-- — Chad can add rows on the page itself once he has them.
-- on conflict do nothing so this stays safe to re-run without duplicating
-- rows or clobbering anything Chad has since edited on the page.
insert into upc_codes (brand, size, product_name, upc) values
  ('fcb', '16oz', 'Apricot Pie 16oz/4pk', '850382001030'),
  ('fcb', '16oz', 'Captain Hazy 16oz/4pk', '850382001191'),
  ('fcb', '19.2oz', 'Captain Hazy 19.2oz/1pk', '850382001023'),
  ('fcb', '16oz', 'Captain Imperial 16oz', '850382001092'),
  ('fcb', '19.2oz', 'Captain Imperial 19.2', '850382001160'),
  ('fcb', '16oz', 'Captain WC 16oz/4pk', '850382001054'),
  ('fcb', '19.2oz', 'Captain WC 19.2oz/1pk', '850382001924'),
  ('fcb', '12oz', 'Illa Vanilla 12oz/6pk box', '850382001740'),
  ('fcb', '16oz', 'Illa Vanilla 16oz/4pk', '850382001238'),
  ('fcb', '16oz', 'Juicy 16oz/4pk', '850382001108'),
  ('fcb', '19.2oz', 'Juicy 19.2oz/1pk', '850382001917'),
  ('fcb', '12oz', 'Juicy Vibes 12oz/6pk', '850382001993'),
  ('fcb', '19.2oz', 'Juicy Vibes 19.2oz/1pk', '850382001122'),
  ('fcb', '16oz', 'Mango Bomb 16oz/4pk', '850382001269'),
  ('fcb', '19.2oz', 'Mango Bomb 19.2oz/1pk', '850382001900'),
  ('fcb', '12oz', 'Mango Vibes 12oz/6pk', '850382001368'),
  ('fcb', '19.2oz', 'Mango Vibes 19.2oz/1pk', '850382001559'),
  ('fcb', '16oz', 'Nectarine Pie 16oz/4pk', '850382001313'),
  ('fcb', '16oz', 'Peach Bomb 16oz/4pk', '850382001962'),
  ('fcb', '19.2oz', 'Peach Bomb 19.2oz/1pk', '850382001931'),
  ('fcb', '16oz', 'Peaches & Cream Illa 16oz/4pk', '850382001535'),
  ('fcb', '12oz', 'Peachy Vibes 12oz/6pk', '850382001979'),
  ('fcb', '19.2oz', 'Peachy Vibes 19.2oz/1pk', '850382001108'),
  ('fcb', '16oz', 'Pina Bomb 16oz/4pk', '850382001962'),
  ('fcb', '16oz', 'Strawberry Illa 16oz/4pk', '850382001672'),
  ('fcb', '12oz', 'Victory Vibes 12oz', '850382001221'),
  ('fcb', '19.2oz', 'Victory Vibes 19.2', '850382001467'),
  ('sonoma-cider', '16oz', 'The Hatchet 16oz/4pk', '850382001658'),
  ('sonoma-cider', '16oz', 'The Sickle 16oz/4pk', '850382001177'),
  ('sonoma-cider', '16oz', 'The Pitchfork 16oz/4pk', '850382001757'),
  ('sonoma-cider', '19.2oz', 'The Pitchfork 19.2oz/1pk', '850382001955'),
  ('speakeasy', '12oz', 'Mystic Haze 12oz/6pk', '690926009197'),
  ('speakeasy', '16oz', 'Mystic Haze 16oz/4pk', '690926000361'),
  ('speakeasy', '19.2oz', 'Mystic Haze 19.2oz/1pk', '690926000088'),
  ('speakeasy', '12oz', 'Big Daddy 12oz/6pk', '690926000330'),
  ('speakeasy', '16oz', 'Big Daddy 16oz/4pk', '690926000316'),
  ('speakeasy', '19.2oz', 'Big Daddy 19.2oz/1pk', '690926000057'),
  ('speakeasy', '12oz', 'Prohibition 12oz/6pk', '690926000231')
on conflict (brand, size, product_name) do nothing;
