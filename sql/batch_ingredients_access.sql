-- Grants the new "batch_ingredients" section access to the tables the new
-- standalone Batch Ingredients page (Operations > Batch Ingredients) reads
-- and writes: pricing_brands (brand dropdown), ingredient_costs (ingredient
-- picker + prices), batch_recipe_items (each brand's recipe rows).
--
-- Today these three tables are only gated by cost_per_case / margin_analysis
-- / contribution_margin (ingredient_costs, batch_recipe_items) or
-- price_list / margin_analysis / contribution_margin (pricing_brands) —
-- someone granted ONLY "Batch Ingredients" from Users > Edit (without also
-- having Cost Per Case, Margin Analysis, Contribution Margin, or Price
-- List) would load the page fine but have every read/write silently
-- rejected by RLS. This adds has_section(auth.uid(), 'batch_ingredients')
-- as an additional OR condition on each policy so that grant alone is
-- enough — nothing else about these policies changes. Each policy's
-- original with_check was NULL (Postgres defaults an ALL policy's WITH
-- CHECK to its USING clause when none is given), so these are recreated
-- the same way — USING only, no explicit WITH CHECK — rather than
-- introducing new behavior.
--
-- Idempotent: safe to run multiple times.

drop policy if exists "pricing_brands_sales" on public.pricing_brands;
create policy "pricing_brands_sales" on public.pricing_brands
  for all
  using (
    has_section(auth.uid(), 'price_list'::text)
    or has_section(auth.uid(), 'margin_analysis'::text)
    or has_section(auth.uid(), 'contribution_margin'::text)
    or has_section(auth.uid(), 'batch_ingredients'::text)
  );

drop policy if exists "ingredient_costs_sales" on public.ingredient_costs;
create policy "ingredient_costs_sales" on public.ingredient_costs
  for all
  using (
    has_section(auth.uid(), 'cost_per_case'::text)
    or has_section(auth.uid(), 'margin_analysis'::text)
    or has_section(auth.uid(), 'contribution_margin'::text)
    or has_section(auth.uid(), 'batch_ingredients'::text)
  );

drop policy if exists "batch_recipe_items_sales" on public.batch_recipe_items;
create policy "batch_recipe_items_sales" on public.batch_recipe_items
  for all
  using (
    has_section(auth.uid(), 'cost_per_case'::text)
    or has_section(auth.uid(), 'margin_analysis'::text)
    or has_section(auth.uid(), 'contribution_margin'::text)
    or has_section(auth.uid(), 'batch_ingredients'::text)
  );
