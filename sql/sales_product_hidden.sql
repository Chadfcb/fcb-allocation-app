-- Sales > Accounts > Product Lookup — hidden products (added 2026-10-08, per
-- Chad: "a lot of those we dont make anymore, and its filling up a large
-- amount of space"). The "Hide items" / "Unhide items" buttons next to the
-- Size row add and remove products here. One list for everyone with Accounts
-- access. Hidden products drop out of the product chips and out of the
-- "all products" totals; unhiding brings them right back.
--
-- First run only: every product with no sales in the 12 months up to the
-- data's as-of date starts out hidden. Running this file again never re-hides
-- anything someone unhid.
--
-- Run this in Supabase's SQL Editor BEFORE pushing the code. Idempotent.

do $$
declare
  first_run boolean := not exists (
    select 1 from information_schema.tables
    where table_schema = 'public' and table_name = 'sales_product_hidden');
begin
  create table if not exists public.sales_product_hidden (
    id uuid primary key default gen_random_uuid(),
    product text not null unique,
    hidden_at timestamptz not null default now(),
    hidden_by uuid references public.profiles(id)
  );

  if first_run then
    insert into public.sales_product_hidden (product)
    select s.product
    from public.sales_account_sales s
    group by s.product
    having max(s.month) < (
      select date_trunc('month', coalesce(m.as_of, current_date))::date - interval '11 months'
      from public.sales_data_meta m where m.id = 1
    )
    on conflict (product) do nothing;
  end if;
end $$;

alter table public.sales_product_hidden enable row level security;

drop policy if exists "sales_product_hidden_section" on public.sales_product_hidden;
create policy "sales_product_hidden_section" on public.sales_product_hidden for all
  using ((select public.has_section((select auth.uid()), 'accounts')))
  with check ((select public.has_section((select auth.uid()), 'accounts')));

grant select, insert, delete on public.sales_product_hidden to authenticated;
