-- Sales > Chain Authorizations and Chain Mandates — two new sub-categories
-- under Sales, added 2026-09-05, per Chad, imported from a spreadsheet of
-- chain authorization/mandate data that "isn't designed very well." Run
-- this once in Supabase's SQL Editor, before the matching code deploy.
-- Idempotent — safe to re-run.
--
-- Access: both are gated by their own SectionKey (chain_authorizations /
-- chain_mandates, see lib/permissions.ts), but neither has its own
-- Users > Edit toggle — per Chad, "only the main category is gated for
-- access... if someone is given access to Sales, they have access to all
-- sub categories." Checking Sales grants both, same has_section() RLS
-- pattern as every other gated table.

-- =========================================================
-- Chain Authorizations — simple two-level structure: Chain -> Items (one
-- freeform text line per item, since the source spreadsheet's item
-- formatting was inconsistent — some with a leading SKU number, some
-- without — and Chad asked to keep it as one editable text field rather
-- than parsing it further).
-- =========================================================
create table if not exists chain_auth_chains (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  sort_order int,
  created_by uuid references profiles(id),
  created_at timestamptz not null default now()
);

create table if not exists chain_auth_items (
  id uuid primary key default gen_random_uuid(),
  chain_id uuid not null references chain_auth_chains(id) on delete cascade,
  item_text text not null,
  sort_order int,
  created_by uuid references profiles(id),
  created_at timestamptz not null default now(),
  unique (chain_id, item_text)
);
create index if not exists chain_auth_items_chain_idx on chain_auth_items (chain_id);

alter table chain_auth_chains enable row level security;
alter table chain_auth_items enable row level security;

drop policy if exists "chain_auth_chains_section" on chain_auth_chains;
create policy "chain_auth_chains_section" on chain_auth_chains for all using (
  has_section(auth.uid(), 'chain_authorizations')
);

drop policy if exists "chain_auth_items_section" on chain_auth_items;
create policy "chain_auth_items_section" on chain_auth_items for all using (
  has_section(auth.uid(), 'chain_authorizations')
);

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'chain_auth_chains'
  ) then
    alter publication supabase_realtime add table chain_auth_chains;
  end if;
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'chain_auth_items'
  ) then
    alter publication supabase_realtime add table chain_auth_items;
  end if;
end $$;

-- =========================================================
-- Chain Mandates — three-level structure: Chain -> Product -> Store. Kept
-- at the store level (rather than flattened to a plain item list like
-- Authorizations), per Chad, since the source spreadsheet was already one
-- row per store (store #, tier/segment, address, city, state, zip,
-- package, status) and that detail is worth keeping.
-- =========================================================
create table if not exists chain_mandate_chains (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  sort_order int,
  created_by uuid references profiles(id),
  created_at timestamptz not null default now()
);

create table if not exists chain_mandate_products (
  id uuid primary key default gen_random_uuid(),
  chain_id uuid not null references chain_mandate_chains(id) on delete cascade,
  product_name text not null,
  package text,
  upc text,
  sort_order int,
  created_by uuid references profiles(id),
  created_at timestamptz not null default now(),
  unique (chain_id, product_name)
);
create index if not exists chain_mandate_products_chain_idx on chain_mandate_products (chain_id);

create table if not exists chain_mandate_stores (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references chain_mandate_products(id) on delete cascade,
  store_number text not null,
  tier text,
  address text,
  city text,
  state text,
  zip text,
  status text,
  sort_order int,
  created_by uuid references profiles(id),
  created_at timestamptz not null default now(),
  unique (product_id, store_number)
);
create index if not exists chain_mandate_stores_product_idx on chain_mandate_stores (product_id);

alter table chain_mandate_chains enable row level security;
alter table chain_mandate_products enable row level security;
alter table chain_mandate_stores enable row level security;

drop policy if exists "chain_mandate_chains_section" on chain_mandate_chains;
create policy "chain_mandate_chains_section" on chain_mandate_chains for all using (
  has_section(auth.uid(), 'chain_mandates')
);

drop policy if exists "chain_mandate_products_section" on chain_mandate_products;
create policy "chain_mandate_products_section" on chain_mandate_products for all using (
  has_section(auth.uid(), 'chain_mandates')
);

drop policy if exists "chain_mandate_stores_section" on chain_mandate_stores;
create policy "chain_mandate_stores_section" on chain_mandate_stores for all using (
  has_section(auth.uid(), 'chain_mandates')
);

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'chain_mandate_chains'
  ) then
    alter publication supabase_realtime add table chain_mandate_chains;
  end if;
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'chain_mandate_products'
  ) then
    alter publication supabase_realtime add table chain_mandate_products;
  end if;
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'chain_mandate_stores'
  ) then
    alter publication supabase_realtime add table chain_mandate_stores;
  end if;
end $$;

-- Chain Authorizations seed data, imported 2026-09-05 from Chad's
-- spreadsheet.
insert into chain_auth_chains (name, sort_order) values ('BEVMO', 0)
  on conflict (name) do nothing;
insert into chain_auth_chains (name, sort_order) values ('Raley''s', 1)
  on conflict (name) do nothing;
insert into chain_auth_chains (name, sort_order) values ('World Market', 2)
  on conflict (name) do nothing;
insert into chain_auth_chains (name, sort_order) values ('Whole Foods', 3)
  on conflict (name) do nothing;
insert into chain_auth_chains (name, sort_order) values ('TotalWine', 4)
  on conflict (name) do nothing;
insert into chain_auth_chains (name, sort_order) values ('Grocery Outlet', 5)
  on conflict (name) do nothing;

insert into chain_auth_items (chain_id, item_text, sort_order) select id, '152639 FULL CIRCLE CAP SAVE HAZY 19C', 0 from chain_auth_chains where name = 'BEVMO'
  on conflict (chain_id, item_text) do nothing;
insert into chain_auth_items (chain_id, item_text, sort_order) select id, '123228 FULL CIRCLE CAPT SAVE HOP 4PKC', 1 from chain_auth_chains where name = 'BEVMO'
  on conflict (chain_id, item_text) do nothing;
insert into chain_auth_items (chain_id, item_text, sort_order) select id, '123229 FULL CIRCLE JUICY NE IPA 4PKC', 2 from chain_auth_chains where name = 'BEVMO'
  on conflict (chain_id, item_text) do nothing;
insert into chain_auth_items (chain_id, item_text, sort_order) select id, '152640 FULL CIRCLE PEACHY VIBES 19C', 3 from chain_auth_chains where name = 'BEVMO'
  on conflict (chain_id, item_text) do nothing;
insert into chain_auth_items (chain_id, item_text, sort_order) select id, '152635 FULL CIRCLE CAP SAVE HAZY 4PKC', 4 from chain_auth_chains where name = 'BEVMO'
  on conflict (chain_id, item_text) do nothing;
insert into chain_auth_items (chain_id, item_text, sort_order) select id, '152637 FULL CIRCLE VICTORY VIBES 6PKC', 5 from chain_auth_chains where name = 'BEVMO'
  on conflict (chain_id, item_text) do nothing;
insert into chain_auth_items (chain_id, item_text, sort_order) select id, '125201 FULL CIRCLE ILLA VANL IPA 4PKC', 6 from chain_auth_chains where name = 'BEVMO'
  on conflict (chain_id, item_text) do nothing;
insert into chain_auth_items (chain_id, item_text, sort_order) select id, '144357 FULL CIRCLE PIE TGR APRCT 4PKC', 7 from chain_auth_chains where name = 'BEVMO'
  on conflict (chain_id, item_text) do nothing;
insert into chain_auth_items (chain_id, item_text, sort_order) select id, '145963 FULL CIRCLE PIE TGR NECTA 4PKC', 8 from chain_auth_chains where name = 'BEVMO'
  on conflict (chain_id, item_text) do nothing;
insert into chain_auth_items (chain_id, item_text, sort_order) select id, '128924 FULL CIRCLE CREAMZILLA 4PKC', 9 from chain_auth_chains where name = 'BEVMO'
  on conflict (chain_id, item_text) do nothing;
insert into chain_auth_items (chain_id, item_text, sort_order) select id, '152641 FULL CIRCLE VICTORY VIBES 19C', 10 from chain_auth_chains where name = 'BEVMO'
  on conflict (chain_id, item_text) do nothing;
insert into chain_auth_items (chain_id, item_text, sort_order) select id, '133089 FULL CIRCLE ILLA IPA MIX 6PKC', 11 from chain_auth_chains where name = 'BEVMO'
  on conflict (chain_id, item_text) do nothing;
insert into chain_auth_items (chain_id, item_text, sort_order) select id, '145964 SONOMA CIDER PITCHFORK 4PKC', 12 from chain_auth_chains where name = 'BEVMO'
  on conflict (chain_id, item_text) do nothing;
insert into chain_auth_items (chain_id, item_text, sort_order) select id, '142524 FULL CIRCLE MANGO BOMB IPA 19C', 13 from chain_auth_chains where name = 'BEVMO'
  on conflict (chain_id, item_text) do nothing;
insert into chain_auth_items (chain_id, item_text, sort_order) select id, '142520 FULL CIRCLE JUICY NE IPA 19C', 14 from chain_auth_chains where name = 'BEVMO'
  on conflict (chain_id, item_text) do nothing;
insert into chain_auth_items (chain_id, item_text, sort_order) select id, '152638 FULL CIRCLE CAPT SAVE HOP 19C', 15 from chain_auth_chains where name = 'BEVMO'
  on conflict (chain_id, item_text) do nothing;
insert into chain_auth_items (chain_id, item_text, sort_order) select id, '145965 SONOMA CIDER HATCHET 19C', 16 from chain_auth_chains where name = 'BEVMO'
  on conflict (chain_id, item_text) do nothing;
insert into chain_auth_items (chain_id, item_text, sort_order) select id, '145966 SONOMA CIDER PITCHFORK 19C', 17 from chain_auth_chains where name = 'BEVMO'
  on conflict (chain_id, item_text) do nothing;
insert into chain_auth_items (chain_id, item_text, sort_order) select id, '152636 FULL CIRCLE PEACHY VIBES 6PKCs', 18 from chain_auth_chains where name = 'BEVMO'
  on conflict (chain_id, item_text) do nothing;
insert into chain_auth_items (chain_id, item_text, sort_order) select id, 'Speakeasy Big Daddy IPA 19.2C', 0 from chain_auth_chains where name = 'Raley''s'
  on conflict (chain_id, item_text) do nothing;
insert into chain_auth_items (chain_id, item_text, sort_order) select id, 'SPEAKEASY MYSTIC HAZE 19.2', 1 from chain_auth_chains where name = 'Raley''s'
  on conflict (chain_id, item_text) do nothing;
insert into chain_auth_items (chain_id, item_text, sort_order) select id, 'Speakeasy Prohibition 6/12C', 2 from chain_auth_chains where name = 'Raley''s'
  on conflict (chain_id, item_text) do nothing;
insert into chain_auth_items (chain_id, item_text, sort_order) select id, 'Speakeasy Big Daddy 6/12C', 3 from chain_auth_chains where name = 'Raley''s'
  on conflict (chain_id, item_text) do nothing;
insert into chain_auth_items (chain_id, item_text, sort_order) select id, 'Speakeasy Mystic Haze 6/12C', 4 from chain_auth_chains where name = 'Raley''s'
  on conflict (chain_id, item_text) do nothing;
insert into chain_auth_items (chain_id, item_text, sort_order) select id, 'Captain Save a Hop Hazy 19.2C', 5 from chain_auth_chains where name = 'Raley''s'
  on conflict (chain_id, item_text) do nothing;
insert into chain_auth_items (chain_id, item_text, sort_order) select id, 'FULL CIRCLE CAPTAIN SAVE A HOP WC 4/16', 6 from chain_auth_chains where name = 'Raley''s'
  on conflict (chain_id, item_text) do nothing;
insert into chain_auth_items (chain_id, item_text, sort_order) select id, 'FULL CIRCLE JUICY 4/16', 7 from chain_auth_chains where name = 'Raley''s'
  on conflict (chain_id, item_text) do nothing;
insert into chain_auth_items (chain_id, item_text, sort_order) select id, 'Captain Save a Hop Imperial Punch 4/16C', 8 from chain_auth_chains where name = 'Raley''s'
  on conflict (chain_id, item_text) do nothing;
insert into chain_auth_items (chain_id, item_text, sort_order) select id, 'Peachy Vibes 19.2C', 9 from chain_auth_chains where name = 'Raley''s'
  on conflict (chain_id, item_text) do nothing;
insert into chain_auth_items (chain_id, item_text, sort_order) select id, 'Captain Save a Hop Imperial Punch 19.2C', 10 from chain_auth_chains where name = 'Raley''s'
  on conflict (chain_id, item_text) do nothing;
insert into chain_auth_items (chain_id, item_text, sort_order) select id, 'The Sickle Pineapple Cider 4/16C', 11 from chain_auth_chains where name = 'Raley''s'
  on conflict (chain_id, item_text) do nothing;
insert into chain_auth_items (chain_id, item_text, sort_order) select id, 'Captain Save a Hop Hazy 4/16C', 12 from chain_auth_chains where name = 'Raley''s'
  on conflict (chain_id, item_text) do nothing;
insert into chain_auth_items (chain_id, item_text, sort_order) select id, 'FULL CIRCLE ILLA VANILLA 4/16', 13 from chain_auth_chains where name = 'Raley''s'
  on conflict (chain_id, item_text) do nothing;
insert into chain_auth_items (chain_id, item_text, sort_order) select id, 'Mango Bomb 4/16C', 14 from chain_auth_chains where name = 'Raley''s'
  on conflict (chain_id, item_text) do nothing;
insert into chain_auth_items (chain_id, item_text, sort_order) select id, 'Necterine Pie of the Tiger 4/16C', 15 from chain_auth_chains where name = 'Raley''s'
  on conflict (chain_id, item_text) do nothing;
insert into chain_auth_items (chain_id, item_text, sort_order) select id, 'SONOMA CIDER HATCHET 4/16', 16 from chain_auth_chains where name = 'Raley''s'
  on conflict (chain_id, item_text) do nothing;
insert into chain_auth_items (chain_id, item_text, sort_order) select id, 'SONOMA CIDER PITCHFORK 4/16', 17 from chain_auth_chains where name = 'Raley''s'
  on conflict (chain_id, item_text) do nothing;
insert into chain_auth_items (chain_id, item_text, sort_order) select id, 'FULL CIRCLE MANGO BOMB 19.2', 18 from chain_auth_chains where name = 'Raley''s'
  on conflict (chain_id, item_text) do nothing;
insert into chain_auth_items (chain_id, item_text, sort_order) select id, 'FULL CIRCLE JUICY IPA 19.2', 19 from chain_auth_chains where name = 'Raley''s'
  on conflict (chain_id, item_text) do nothing;
insert into chain_auth_items (chain_id, item_text, sort_order) select id, 'Captain Save a Hop West Coast 19.2C', 20 from chain_auth_chains where name = 'Raley''s'
  on conflict (chain_id, item_text) do nothing;
insert into chain_auth_items (chain_id, item_text, sort_order) select id, 'FULL CIRCLE PEACHY VIBES 6/12', 21 from chain_auth_chains where name = 'Raley''s'
  on conflict (chain_id, item_text) do nothing;
insert into chain_auth_items (chain_id, item_text, sort_order) select id, 'Peachy Vibes 6/12C', 22 from chain_auth_chains where name = 'Raley''s'
  on conflict (chain_id, item_text) do nothing;
insert into chain_auth_items (chain_id, item_text, sort_order) select id, '603863 SPEAKEASY MYSTIC HAZE 19.2OZ C', 0 from chain_auth_chains where name = 'World Market'
  on conflict (chain_id, item_text) do nothing;
insert into chain_auth_items (chain_id, item_text, sort_order) select id, '365396 SPEAKEASY PROHIBITION ALE 6PK', 1 from chain_auth_chains where name = 'World Market'
  on conflict (chain_id, item_text) do nothing;
insert into chain_auth_items (chain_id, item_text, sort_order) select id, '572162 SPEAKEASY BIG DADDY 6PK CAN', 2 from chain_auth_chains where name = 'World Market'
  on conflict (chain_id, item_text) do nothing;
insert into chain_auth_items (chain_id, item_text, sort_order) select id, '603865 SPEAKEASY MYSTIC HAZE 6PK CAN', 3 from chain_auth_chains where name = 'World Market'
  on conflict (chain_id, item_text) do nothing;
insert into chain_auth_items (chain_id, item_text, sort_order) select id, '630225 FULL CIRCLE JUICY IPA 4PK CAN', 4 from chain_auth_chains where name = 'World Market'
  on conflict (chain_id, item_text) do nothing;
insert into chain_auth_items (chain_id, item_text, sort_order) select id, '630216 FULL CIRCLE PEACHY VIBE 19OZ', 5 from chain_auth_chains where name = 'World Market'
  on conflict (chain_id, item_text) do nothing;
insert into chain_auth_items (chain_id, item_text, sort_order) select id, '631425 FULL CIRCLE ILLA VANILLA 4P CN', 6 from chain_auth_chains where name = 'World Market'
  on conflict (chain_id, item_text) do nothing;
insert into chain_auth_items (chain_id, item_text, sort_order) select id, '630221 FULL CIRCLE MANGO BOMB 4PK CAN', 7 from chain_auth_chains where name = 'World Market'
  on conflict (chain_id, item_text) do nothing;
insert into chain_auth_items (chain_id, item_text, sort_order) select id, '630227 FULL CIRCLE PIE TIGER NCT 4PCN', 8 from chain_auth_chains where name = 'World Market'
  on conflict (chain_id, item_text) do nothing;
insert into chain_auth_items (chain_id, item_text, sort_order) select id, '630223 FULL CIRCLE ILLA VANILLA 6PKCN', 9 from chain_auth_chains where name = 'World Market'
  on conflict (chain_id, item_text) do nothing;
insert into chain_auth_items (chain_id, item_text, sort_order) select id, '630220 FULL CIRCLE MANGO BOMB 19OZ', 10 from chain_auth_chains where name = 'World Market'
  on conflict (chain_id, item_text) do nothing;
insert into chain_auth_items (chain_id, item_text, sort_order) select id, '630214 FULL CIRCLE PEACHY VIBE 6PK CN', 11 from chain_auth_chains where name = 'World Market'
  on conflict (chain_id, item_text) do nothing;
insert into chain_auth_items (chain_id, item_text, sort_order) select id, 'PALE CAPTAIN SAVE A HOP 16FZ CAN 4PK', 0 from chain_auth_chains where name = 'Whole Foods'
  on conflict (chain_id, item_text) do nothing;
insert into chain_auth_items (chain_id, item_text, sort_order) select id, 'IPA NE JUICY 16FZ CAN 4PK', 1 from chain_auth_chains where name = 'Whole Foods'
  on conflict (chain_id, item_text) do nothing;
insert into chain_auth_items (chain_id, item_text, sort_order) select id, 'IPA HAZY CAPTAIN SAVE A HOP 16FZ CAN 4PK', 2 from chain_auth_chains where name = 'Whole Foods'
  on conflict (chain_id, item_text) do nothing;
insert into chain_auth_items (chain_id, item_text, sort_order) select id, 'IPA LACTOSE ILLA VANILLA 16FZ CAN 4PK', 3 from chain_auth_chains where name = 'Whole Foods'
  on conflict (chain_id, item_text) do nothing;
insert into chain_auth_items (chain_id, item_text, sort_order) select id, 'IPA DOUBLE BOMB SERIES 16FZ CAN 4PK', 4 from chain_auth_chains where name = 'Whole Foods'
  on conflict (chain_id, item_text) do nothing;
insert into chain_auth_items (chain_id, item_text, sort_order) select id, 'SOUR ALE HIP HOP SERIES 16FZ CAN 4PK', 5 from chain_auth_chains where name = 'Whole Foods'
  on conflict (chain_id, item_text) do nothing;
insert into chain_auth_items (chain_id, item_text, sort_order) select id, 'ROTATING MILKSHAKE IPA 16FZ CAN 4PK', 6 from chain_auth_chains where name = 'Whole Foods'
  on conflict (chain_id, item_text) do nothing;
insert into chain_auth_items (chain_id, item_text, sort_order) select id, 'Big Daddy IPA 12oz 6-Pack', 7 from chain_auth_chains where name = 'Whole Foods'
  on conflict (chain_id, item_text) do nothing;
insert into chain_auth_items (chain_id, item_text, sort_order) select id, 'Speakeasy Big Daddy 19.2', 0 from chain_auth_chains where name = 'TotalWine'
  on conflict (chain_id, item_text) do nothing;
insert into chain_auth_items (chain_id, item_text, sort_order) select id, 'Speakeasy Big Daddy 6/12', 1 from chain_auth_chains where name = 'TotalWine'
  on conflict (chain_id, item_text) do nothing;
insert into chain_auth_items (chain_id, item_text, sort_order) select id, 'Captain Save a Hop Hazy 4/16', 2 from chain_auth_chains where name = 'TotalWine'
  on conflict (chain_id, item_text) do nothing;
insert into chain_auth_items (chain_id, item_text, sort_order) select id, 'Captain Save a Hop West Coast 4/16', 3 from chain_auth_chains where name = 'TotalWine'
  on conflict (chain_id, item_text) do nothing;
insert into chain_auth_items (chain_id, item_text, sort_order) select id, 'Juicy NE IPA 4/16', 4 from chain_auth_chains where name = 'TotalWine'
  on conflict (chain_id, item_text) do nothing;
insert into chain_auth_items (chain_id, item_text, sort_order) select id, 'Captain Save a Hop Hazy 19.2', 5 from chain_auth_chains where name = 'TotalWine'
  on conflict (chain_id, item_text) do nothing;
insert into chain_auth_items (chain_id, item_text, sort_order) select id, 'Victory Vibes 6/12', 6 from chain_auth_chains where name = 'TotalWine'
  on conflict (chain_id, item_text) do nothing;
insert into chain_auth_items (chain_id, item_text, sort_order) select id, 'Illa Vanilla 4/16', 7 from chain_auth_chains where name = 'TotalWine'
  on conflict (chain_id, item_text) do nothing;
insert into chain_auth_items (chain_id, item_text, sort_order) select id, 'Mango Bomb 4/16', 8 from chain_auth_chains where name = 'TotalWine'
  on conflict (chain_id, item_text) do nothing;
insert into chain_auth_items (chain_id, item_text, sort_order) select id, 'Nectarine Pie of the Tiger 4/16', 9 from chain_auth_chains where name = 'TotalWine'
  on conflict (chain_id, item_text) do nothing;
insert into chain_auth_items (chain_id, item_text, sort_order) select id, 'Mango Bomb 19.2', 10 from chain_auth_chains where name = 'TotalWine'
  on conflict (chain_id, item_text) do nothing;
insert into chain_auth_items (chain_id, item_text, sort_order) select id, 'Peachy Vibes 6/12', 11 from chain_auth_chains where name = 'TotalWine'
  on conflict (chain_id, item_text) do nothing;
insert into chain_auth_items (chain_id, item_text, sort_order) select id, 'Speakeasy Mystic Haze 6/12C', 12 from chain_auth_chains where name = 'TotalWine'
  on conflict (chain_id, item_text) do nothing;
insert into chain_auth_items (chain_id, item_text, sort_order) select id, 'Speakeasy Prohibition 6/12C', 13 from chain_auth_chains where name = 'TotalWine'
  on conflict (chain_id, item_text) do nothing;
insert into chain_auth_items (chain_id, item_text, sort_order) select id, 'Captain Imperial Punch 19.2', 14 from chain_auth_chains where name = 'TotalWine'
  on conflict (chain_id, item_text) do nothing;
insert into chain_auth_items (chain_id, item_text, sort_order) select id, 'Captain Imperial Punch 16', 15 from chain_auth_chains where name = 'TotalWine'
  on conflict (chain_id, item_text) do nothing;
insert into chain_auth_items (chain_id, item_text, sort_order) select id, 'Sonoma Pitchfork Pear 16', 16 from chain_auth_chains where name = 'TotalWine'
  on conflict (chain_id, item_text) do nothing;
insert into chain_auth_items (chain_id, item_text, sort_order) select id, 'Sonoma Hatchet 16', 17 from chain_auth_chains where name = 'TotalWine'
  on conflict (chain_id, item_text) do nothing;
insert into chain_auth_items (chain_id, item_text, sort_order) select id, 'Sonoma Sickle 16', 18 from chain_auth_chains where name = 'TotalWine'
  on conflict (chain_id, item_text) do nothing;
insert into chain_auth_items (chain_id, item_text, sort_order) select id, '218772 6 4PK FULL CIRCLE CAPTAIN SAVE A HOP', 0 from chain_auth_chains where name = 'Grocery Outlet'
  on conflict (chain_id, item_text) do nothing;
insert into chain_auth_items (chain_id, item_text, sort_order) select id, '213235 6 4PK FULL CIRCLE JUICY NE IPA', 1 from chain_auth_chains where name = 'Grocery Outlet'
  on conflict (chain_id, item_text) do nothing;
insert into chain_auth_items (chain_id, item_text, sort_order) select id, '243807 6 4PK FULL CIRCLE VANILLA ILLA MILKS', 2 from chain_auth_chains where name = 'Grocery Outlet'
  on conflict (chain_id, item_text) do nothing;
insert into chain_auth_items (chain_id, item_text, sort_order) select id, '259673 6 4PK FULL CRICLE BOMB ROTATING SERI', 3 from chain_auth_chains where name = 'Grocery Outlet'
  on conflict (chain_id, item_text) do nothing;
insert into chain_auth_items (chain_id, item_text, sort_order) select id, '335303 6 4PK FULL CIRCLE PIE OF TIGER ROTAT', 4 from chain_auth_chains where name = 'Grocery Outlet'
  on conflict (chain_id, item_text) do nothing;
insert into chain_auth_items (chain_id, item_text, sort_order) select id, '328613 12 19.2Z FULL CIRCLE MANGO BOMB IMPERIA', 5 from chain_auth_chains where name = 'Grocery Outlet'
  on conflict (chain_id, item_text) do nothing;
insert into chain_auth_items (chain_id, item_text, sort_order) select id, '346957 4 6PK FULL CIRCLE PEACHY VIBES', 6 from chain_auth_chains where name = 'Grocery Outlet'
  on conflict (chain_id, item_text) do nothing;
insert into chain_auth_items (chain_id, item_text, sort_order) select id, '346958 4 6PK FULL CIRCLE JUICY VIBES IPA', 7 from chain_auth_chains where name = 'Grocery Outlet'
  on conflict (chain_id, item_text) do nothing;
insert into chain_auth_items (chain_id, item_text, sort_order) select id, 'BIG DADDY IPA 6PACK 12oz', 8 from chain_auth_chains where name = 'Grocery Outlet'
  on conflict (chain_id, item_text) do nothing;

-- Chain Mandates seed data, imported 2026-09-05 from Chad's
-- spreadsheet.
insert into chain_mandate_chains (name, sort_order) values ('SAFEWAY', 0)
  on conflict (name) do nothing;
insert into chain_mandate_chains (name, sort_order) values ('VONS', 1)
  on conflict (name) do nothing;
insert into chain_mandate_chains (name, sort_order) values ('WALMART', 2)
  on conflict (name) do nothing;

insert into chain_mandate_products (chain_id, product_name, package, upc, sort_order) select id, 'SPEAKEASY PROHIBITION ALE 6/12C', '6PACK', '69092600023', 0 from chain_mandate_chains where name = 'SAFEWAY'
  on conflict (chain_id, product_name) do nothing;
insert into chain_mandate_products (chain_id, product_name, package, upc, sort_order) select id, 'FULL CIRCLE CAPTAIN SAVE A HOP! HAZY IPA 4/16C', '4PACK', '85038200119', 0 from chain_mandate_chains where name = 'VONS'
  on conflict (chain_id, product_name) do nothing;
insert into chain_mandate_products (chain_id, product_name, package, upc, sort_order) select id, 'FULL CIRCLE PIE OF THE TIGER MIXED BERRY PIE SOUR 4/16C', '4PACK', '85038200131', 1 from chain_mandate_chains where name = 'VONS'
  on conflict (chain_id, product_name) do nothing;
insert into chain_mandate_products (chain_id, product_name, package, upc, sort_order) select id, 'Full Circle Brewing Co Juicy Ne Ipa 4/16c', '4PACK', '0085038200110', 0 from chain_mandate_chains where name = 'WALMART'
  on conflict (chain_id, product_name) do nothing;
insert into chain_mandate_products (chain_id, product_name, package, upc, sort_order) select id, 'Full Circle Captain Save A Hop! West Coast Pale Ale 4/16c', '4PACK', '0085038200105', 1 from chain_mandate_chains where name = 'WALMART'
  on conflict (chain_id, product_name) do nothing;

insert into chain_mandate_stores (product_id, store_number, tier, address, city, state, zip, status, sort_order) select p.id, '667', 'AFFLUENT', '5290 DIAMOND HTS BLVD', 'SAN FRANCISCO', 'CA', '94131', 'RETAIN', 0 from chain_mandate_products p join chain_mandate_chains c on c.id = p.chain_id where c.name = 'SAFEWAY' and p.product_name = 'SPEAKEASY PROHIBITION ALE 6/12C'
  on conflict (product_id, store_number) do nothing;
insert into chain_mandate_stores (product_id, store_number, tier, address, city, state, zip, status, sort_order) select p.id, '739', 'AFFLUENT', '3350 MISSION ST', 'SAN FRANCISCO', 'CA', '94110', 'RETAIN', 1 from chain_mandate_products p join chain_mandate_chains c on c.id = p.chain_id where c.name = 'SAFEWAY' and p.product_name = 'SPEAKEASY PROHIBITION ALE 6/12C'
  on conflict (product_id, store_number) do nothing;
insert into chain_mandate_stores (product_id, store_number, tier, address, city, state, zip, status, sort_order) select p.id, '777', 'MAINSTREAM', '30 CHESTNUT AVE', 'S SAN FRANCISCO', 'CA', '94080', 'RETAIN', 2 from chain_mandate_products p join chain_mandate_chains c on c.id = p.chain_id where c.name = 'SAFEWAY' and p.product_name = 'SPEAKEASY PROHIBITION ALE 6/12C'
  on conflict (product_id, store_number) do nothing;
insert into chain_mandate_stores (product_id, store_number, tier, address, city, state, zip, status, sort_order) select p.id, '785', 'AFFLUENT', '850 LA PLAYA', 'SAN FRANCISCO', 'CA', '94121', 'RETAIN', 3 from chain_mandate_products p join chain_mandate_chains c on c.id = p.chain_id where c.name = 'SAFEWAY' and p.product_name = 'SPEAKEASY PROHIBITION ALE 6/12C'
  on conflict (product_id, store_number) do nothing;
insert into chain_mandate_stores (product_id, store_number, tier, address, city, state, zip, status, sort_order) select p.id, '909', 'AFFLUENT', '730 TARAVAL STREET', 'SAN FRANCISCO', 'CA', '94116', 'RETAIN', 4 from chain_mandate_products p join chain_mandate_chains c on c.id = p.chain_id where c.name = 'SAFEWAY' and p.product_name = 'SPEAKEASY PROHIBITION ALE 6/12C'
  on conflict (product_id, store_number) do nothing;
insert into chain_mandate_stores (product_id, store_number, tier, address, city, state, zip, status, sort_order) select p.id, '964', 'MAINSTREAM', '4950 MISSION ST', 'SAN FRANCISCO', 'CA', '94112', 'RETAIN', 5 from chain_mandate_products p join chain_mandate_chains c on c.id = p.chain_id where c.name = 'SAFEWAY' and p.product_name = 'SPEAKEASY PROHIBITION ALE 6/12C'
  on conflict (product_id, store_number) do nothing;
insert into chain_mandate_stores (product_id, store_number, tier, address, city, state, zip, status, sort_order) select p.id, '970', 'AFFLUENT', '1655 EL CAMINO REAL', 'SAN MATEO', 'CA', '94402', 'RETAIN', 6 from chain_mandate_products p join chain_mandate_chains c on c.id = p.chain_id where c.name = 'SAFEWAY' and p.product_name = 'SPEAKEASY PROHIBITION ALE 6/12C'
  on conflict (product_id, store_number) do nothing;
insert into chain_mandate_stores (product_id, store_number, tier, address, city, state, zip, status, sort_order) select p.id, '985', 'AFFLUENT', '2350 NORIEGA STREET', 'SAN FRANCISCO', 'CA', '94122', 'RETAIN', 7 from chain_mandate_products p join chain_mandate_chains c on c.id = p.chain_id where c.name = 'SAFEWAY' and p.product_name = 'SPEAKEASY PROHIBITION ALE 6/12C'
  on conflict (product_id, store_number) do nothing;
insert into chain_mandate_stores (product_id, store_number, tier, address, city, state, zip, status, sort_order) select p.id, '1490', 'MAINSTREAM', '2300 - 16TH STREET, UNIT #203', 'SAN FRANCISCO', 'CA', '94103', 'RETAIN', 8 from chain_mandate_products p join chain_mandate_chains c on c.id = p.chain_id where c.name = 'SAFEWAY' and p.product_name = 'SPEAKEASY PROHIBITION ALE 6/12C'
  on conflict (product_id, store_number) do nothing;
insert into chain_mandate_stores (product_id, store_number, tier, address, city, state, zip, status, sort_order) select p.id, '1507', 'EXPANDED AFFLUENT', '2020 MARKET ST', 'SAN FRANCISCO', 'CA', '94114', 'RETAIN', 9 from chain_mandate_products p join chain_mandate_chains c on c.id = p.chain_id where c.name = 'SAFEWAY' and p.product_name = 'SPEAKEASY PROHIBITION ALE 6/12C'
  on conflict (product_id, store_number) do nothing;
insert into chain_mandate_stores (product_id, store_number, tier, address, city, state, zip, status, sort_order) select p.id, '1711', 'AFFLUENT', '15 MARINA BLVD', 'SAN FRANCISCO', 'CA', '94123', 'RETAIN', 10 from chain_mandate_products p join chain_mandate_chains c on c.id = p.chain_id where c.name = 'SAFEWAY' and p.product_name = 'SPEAKEASY PROHIBITION ALE 6/12C'
  on conflict (product_id, store_number) do nothing;
insert into chain_mandate_stores (product_id, store_number, tier, address, city, state, zip, status, sort_order) select p.id, '2452', 'ANDRONICOS', '1200 IRVING STREET', 'SAN FRANCISCO', 'CA', '94122', 'RETAIN', 11 from chain_mandate_products p join chain_mandate_chains c on c.id = p.chain_id where c.name = 'SAFEWAY' and p.product_name = 'SPEAKEASY PROHIBITION ALE 6/12C'
  on conflict (product_id, store_number) do nothing;
insert into chain_mandate_stores (product_id, store_number, tier, address, city, state, zip, status, sort_order) select p.id, '2606', 'EXPANDED AFFLUENT', '298 KING STREET', 'SAN FRANCISCO', 'CA', '94107', 'RETAIN', 12 from chain_mandate_products p join chain_mandate_chains c on c.id = p.chain_id where c.name = 'SAFEWAY' and p.product_name = 'SPEAKEASY PROHIBITION ALE 6/12C'
  on conflict (product_id, store_number) do nothing;
insert into chain_mandate_stores (product_id, store_number, tier, address, city, state, zip, status, sort_order) select p.id, '2843', 'AFFLUENT', '250 FAIRMONT SHOPPING CENTER', 'PACIFICA', 'CA', '94044', 'RETAIN', 13 from chain_mandate_products p join chain_mandate_chains c on c.id = p.chain_id where c.name = 'SAFEWAY' and p.product_name = 'SPEAKEASY PROHIBITION ALE 6/12C'
  on conflict (product_id, store_number) do nothing;
insert into chain_mandate_stores (product_id, store_number, tier, address, city, state, zip, status, sort_order) select p.id, '3008', 'AFFLUENT', '12 PLAZA DRIVE', 'PACIFICA', 'CA', '94044', 'RETAIN', 14 from chain_mandate_products p join chain_mandate_chains c on c.id = p.chain_id where c.name = 'SAFEWAY' and p.product_name = 'SPEAKEASY PROHIBITION ALE 6/12C'
  on conflict (product_id, store_number) do nothing;
insert into chain_mandate_stores (product_id, store_number, tier, address, city, state, zip, status, sort_order) select p.id, '3031', 'MAINSTREAM', '85 WESTLAKE MALL', 'DALY CITY', 'CA', '94015', 'RETAIN', 15 from chain_mandate_products p join chain_mandate_chains c on c.id = p.chain_id where c.name = 'SAFEWAY' and p.product_name = 'SPEAKEASY PROHIBITION ALE 6/12C'
  on conflict (product_id, store_number) do nothing;
insert into chain_mandate_stores (product_id, store_number, tier, address, city, state, zip, status, sort_order) select p.id, '3066', 'ANDRONICOS', '375 32ND STREET', 'SAN FRANCISCO', 'CA', '94121', 'RETAIN', 16 from chain_mandate_products p join chain_mandate_chains c on c.id = p.chain_id where c.name = 'SAFEWAY' and p.product_name = 'SPEAKEASY PROHIBITION ALE 6/12C'
  on conflict (product_id, store_number) do nothing;
insert into chain_mandate_stores (product_id, store_number, tier, address, city, state, zip, status, sort_order) select p.id, '3116', 'MAINSTREAM', '2255 GELLERT BLVD', 'S SAN FRANCISCO', 'CA', '94080', 'RETAIN', 17 from chain_mandate_products p join chain_mandate_chains c on c.id = p.chain_id where c.name = 'SAFEWAY' and p.product_name = 'SPEAKEASY PROHIBITION ALE 6/12C'
  on conflict (product_id, store_number) do nothing;
insert into chain_mandate_stores (product_id, store_number, tier, address, city, state, zip, status, sort_order) select p.id, '1754', 'MAINSTREAM', '5638 E KINGS  CANYON', 'FRESNO', 'CA', '93727', 'RETAIN', 0 from chain_mandate_products p join chain_mandate_chains c on c.id = p.chain_id where c.name = 'VONS' and p.product_name = 'FULL CIRCLE CAPTAIN SAVE A HOP! HAZY IPA 4/16C'
  on conflict (product_id, store_number) do nothing;
insert into chain_mandate_stores (product_id, store_number, tier, address, city, state, zip, status, sort_order) select p.id, '1756', 'MAINSTREAM', '1650 HERNDON AVE', 'CLOVIS', 'CA', '93611', 'RETAIN', 1 from chain_mandate_products p join chain_mandate_chains c on c.id = p.chain_id where c.name = 'VONS' and p.product_name = 'FULL CIRCLE CAPTAIN SAVE A HOP! HAZY IPA 4/16C'
  on conflict (product_id, store_number) do nothing;
insert into chain_mandate_stores (product_id, store_number, tier, address, city, state, zip, status, sort_order) select p.id, '1968', 'MAINSTREAM', '3051 COUNTRYSIDE DRIVE', 'TURLOCK', 'CA', '95380', 'RETAIN', 2 from chain_mandate_products p join chain_mandate_chains c on c.id = p.chain_id where c.name = 'VONS' and p.product_name = 'FULL CIRCLE CAPTAIN SAVE A HOP! HAZY IPA 4/16C'
  on conflict (product_id, store_number) do nothing;
insert into chain_mandate_stores (product_id, store_number, tier, address, city, state, zip, status, sort_order) select p.id, '2188', 'MAINSTREAM', '8949 N CEDAR AVE', 'FRESNO', 'CA', '93720', 'RETAIN', 3 from chain_mandate_products p join chain_mandate_chains c on c.id = p.chain_id where c.name = 'VONS' and p.product_name = 'FULL CIRCLE CAPTAIN SAVE A HOP! HAZY IPA 4/16C'
  on conflict (product_id, store_number) do nothing;
insert into chain_mandate_stores (product_id, store_number, tier, address, city, state, zip, status, sort_order) select p.id, '2409', 'MAINSTREAM', '40044 ST HWY 49', 'OAKHURST', 'CA', '93644', 'RETAIN', 4 from chain_mandate_products p join chain_mandate_chains c on c.id = p.chain_id where c.name = 'VONS' and p.product_name = 'FULL CIRCLE CAPTAIN SAVE A HOP! HAZY IPA 4/16C'
  on conflict (product_id, store_number) do nothing;
insert into chain_mandate_stores (product_id, store_number, tier, address, city, state, zip, status, sort_order) select p.id, '2701', 'MAINSTREAM', '3100 FOWLER AVE', 'CLOVIS', 'CA', '93611', 'RETAIN', 5 from chain_mandate_products p join chain_mandate_chains c on c.id = p.chain_id where c.name = 'VONS' and p.product_name = 'FULL CIRCLE CAPTAIN SAVE A HOP! HAZY IPA 4/16C'
  on conflict (product_id, store_number) do nothing;
insert into chain_mandate_stores (product_id, store_number, tier, address, city, state, zip, status, sort_order) select p.id, '1754', 'MAINSTREAM', '5638 E KINGS  CANYON', 'FRESNO', 'CA', '93727', 'RETAIN', 0 from chain_mandate_products p join chain_mandate_chains c on c.id = p.chain_id where c.name = 'VONS' and p.product_name = 'FULL CIRCLE PIE OF THE TIGER MIXED BERRY PIE SOUR 4/16C'
  on conflict (product_id, store_number) do nothing;
insert into chain_mandate_stores (product_id, store_number, tier, address, city, state, zip, status, sort_order) select p.id, '1756', 'MAINSTREAM', '1650 HERNDON AVE', 'CLOVIS', 'CA', '93611', 'RETAIN', 1 from chain_mandate_products p join chain_mandate_chains c on c.id = p.chain_id where c.name = 'VONS' and p.product_name = 'FULL CIRCLE PIE OF THE TIGER MIXED BERRY PIE SOUR 4/16C'
  on conflict (product_id, store_number) do nothing;
insert into chain_mandate_stores (product_id, store_number, tier, address, city, state, zip, status, sort_order) select p.id, '1968', 'MAINSTREAM', '3051 COUNTRYSIDE DRIVE', 'TURLOCK', 'CA', '95380', 'RETAIN', 2 from chain_mandate_products p join chain_mandate_chains c on c.id = p.chain_id where c.name = 'VONS' and p.product_name = 'FULL CIRCLE PIE OF THE TIGER MIXED BERRY PIE SOUR 4/16C'
  on conflict (product_id, store_number) do nothing;
insert into chain_mandate_stores (product_id, store_number, tier, address, city, state, zip, status, sort_order) select p.id, '2188', 'MAINSTREAM', '8949 N CEDAR AVE', 'FRESNO', 'CA', '93720', 'RETAIN', 3 from chain_mandate_products p join chain_mandate_chains c on c.id = p.chain_id where c.name = 'VONS' and p.product_name = 'FULL CIRCLE PIE OF THE TIGER MIXED BERRY PIE SOUR 4/16C'
  on conflict (product_id, store_number) do nothing;
insert into chain_mandate_stores (product_id, store_number, tier, address, city, state, zip, status, sort_order) select p.id, '2409', 'MAINSTREAM', '40044 ST HWY 49', 'OAKHURST', 'CA', '93644', 'RETAIN', 4 from chain_mandate_products p join chain_mandate_chains c on c.id = p.chain_id where c.name = 'VONS' and p.product_name = 'FULL CIRCLE PIE OF THE TIGER MIXED BERRY PIE SOUR 4/16C'
  on conflict (product_id, store_number) do nothing;
insert into chain_mandate_stores (product_id, store_number, tier, address, city, state, zip, status, sort_order) select p.id, '2701', 'MAINSTREAM', '3100 FOWLER AVE', 'CLOVIS', 'CA', '93611', 'RETAIN', 5 from chain_mandate_products p join chain_mandate_chains c on c.id = p.chain_id where c.name = 'VONS' and p.product_name = 'FULL CIRCLE PIE OF THE TIGER MIXED BERRY PIE SOUR 4/16C'
  on conflict (product_id, store_number) do nothing;
insert into chain_mandate_stores (product_id, store_number, tier, address, city, state, zip, status, sort_order) select p.id, '1882', 'SC', '3400 Floral Ave', 'Selma', 'CA', '93662', 'Keep', 0 from chain_mandate_products p join chain_mandate_chains c on c.id = p.chain_id where c.name = 'WALMART' and p.product_name = 'Full Circle Brewing Co Juicy Ne Ipa 4/16c'
  on conflict (product_id, store_number) do nothing;
insert into chain_mandate_stores (product_id, store_number, tier, address, city, state, zip, status, sort_order) select p.id, '5337', 'SC', '1185 Herndon Ave', 'Clovis', 'CA', '93612', 'Keep', 1 from chain_mandate_products p join chain_mandate_chains c on c.id = p.chain_id where c.name = 'WALMART' and p.product_name = 'Full Circle Brewing Co Juicy Ne Ipa 4/16c'
  on conflict (product_id, store_number) do nothing;
insert into chain_mandate_stores (product_id, store_number, tier, address, city, state, zip, status, sort_order) select p.id, '1882', 'SC', '3400 Floral Ave', 'Selma', 'CA', '93662', 'Keep', 0 from chain_mandate_products p join chain_mandate_chains c on c.id = p.chain_id where c.name = 'WALMART' and p.product_name = 'Full Circle Captain Save A Hop! West Coast Pale Ale 4/16c'
  on conflict (product_id, store_number) do nothing;
insert into chain_mandate_stores (product_id, store_number, tier, address, city, state, zip, status, sort_order) select p.id, '5337', 'SC', '1185 Herndon Ave', 'Clovis', 'CA', '93612', 'Keep', 1 from chain_mandate_products p join chain_mandate_chains c on c.id = p.chain_id where c.name = 'WALMART' and p.product_name = 'Full Circle Captain Save A Hop! West Coast Pale Ale 4/16c'
  on conflict (product_id, store_number) do nothing;
