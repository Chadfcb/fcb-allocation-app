// Read-only data tools for Ernie (the in-app AI assistant, see
// app/api/ernie/chat/route.ts). Each tool is a narrow, purpose-built query
// against one slice of the app's data — never a raw/arbitrary SQL executor —
// so Ernie can only ever read exactly what these functions expose, joined
// and shaped in plain JS. Nothing here writes to the database.
//
// Ernie itself runs on Anthropic's Claude API under the hood; nothing about
// that should surface in user-facing text (see ERNIE_SYSTEM_PROMPT below).

import type { SupabaseClient } from "@supabase/supabase-js";
import type { PriceListPackageKey } from "@/lib/types/db";
import { PRICE_LIST_PACKAGE_KEYS, PRICE_LIST_PACKAGE_LABELS } from "@/lib/types/db";
import { calcPackagingCost, OVERVIEW_BATCH_BBLS, OVERVIEW_PACKAGE_YIELDS } from "@/lib/costPerCase";
import { PKG_META, calcPkg, calcBatchCan, calcBatchKeg } from "@/lib/marginAnalysis";
import { computeContributionMarginLine } from "@/lib/contributionMargin";

// Several Sales pages show numbers that are NOT stored in the database —
// they're computed live in the browser from several tables at once (see
// lib/marginAnalysis.ts, lib/costPerCase.ts, lib/contributionMargin.ts).
// The get_pricing_data cases below import and run those exact same
// functions so Ernie reports the same figures the pages show, not just the
// raw inputs to those figures.

export const ERNIE_TOOLS = [
  {
    name: "list_weeks",
    description:
      "List all delivery weeks (id, label, week_start date, status: draft/open/closed). Use this first if you need a week_id/week_label for another tool and the user didn't name one, or to answer questions about which weeks exist/are open.",
    input_schema: {
      type: "object" as const,
      properties: {},
    },
  },
  {
    name: "get_inventory_and_allocations",
    description:
      "Per-product inventory (on hand, unlabeled, to be packaged, total, remaining) and per-distributor allocations for one delivery week, including each distributor's PO number/status and price (so order value can be computed as quantity x price). Defaults to the current open week if week_label is omitted.",
    input_schema: {
      type: "object" as const,
      properties: {
        week_label: {
          type: "string",
          description:
            "Exact or partial week label (e.g. \"Aug 18\"). Omit to use the most recent open week.",
        },
      },
    },
  },
  {
    name: "get_distributor_inventory",
    description:
      "Distributor-reported on-hand quantity and rate of sale per product, per distributor, for one delivery week. Defaults to the current open week if week_label is omitted.",
    input_schema: {
      type: "object" as const,
      properties: {
        week_label: { type: "string", description: "Omit for the most recent open week." },
      },
    },
  },
  {
    name: "get_build_orders",
    description:
      "Build Orders data: each distributor/product's par level, current on-hand, and recommended order quantity for one delivery week. Defaults to the current open week if week_label is omitted.",
    input_schema: {
      type: "object" as const,
      properties: {
        week_label: { type: "string", description: "Omit for the most recent open week." },
      },
    },
  },
  {
    name: "get_distributors",
    description:
      "List all distributors with their active/inactive status and whether their inventory is tracked on the Distributor Inventory page.",
    input_schema: {
      type: "object" as const,
      properties: {},
    },
  },
  {
    name: "get_purchase_orders",
    description:
      "Vendor purchase orders (buying ingredients/supplies from suppliers like MoreBeer, Briess Malt), synced from Ekos — each PO's supplier, dates, total cost, payment status, ordered status, and comments, with line items.",
    input_schema: {
      type: "object" as const,
      properties: {
        payment_status: { type: "string", enum: ["pending", "paid"] },
        ordered_status: { type: "string", enum: ["ordered", "not_ordered"] },
      },
    },
  },
  {
    name: "get_events",
    description:
      "Events Calendar entries (festivals, tastings, donations, work-withs, other), optionally filtered by date range and/or distributor name.",
    input_schema: {
      type: "object" as const,
      properties: {
        start_date: { type: "string", description: "yyyy-mm-dd, inclusive lower bound on event start_date." },
        end_date: { type: "string", description: "yyyy-mm-dd, inclusive upper bound on event start_date." },
        distributor_name: { type: "string", description: "Filter to events tied to this distributor (partial match)." },
      },
    },
  },
  {
    name: "get_pricing_data",
    description:
      "Sales section data, computed the same way each page computes it (not just raw inputs): Price List (brand price-to-retailer/distributor by package format), Margin Analysis (PTR/PTD, gross profit $ and %, and full batch revenue/cost/profit/margin % per brand+package), Cost Per Case (packaging/labor cost per case, and each brand's ingredient cost per case), or Contribution Margin (revenue, cost, CM, and Margin % per case-equivalent, by brand+package).",
    input_schema: {
      type: "object" as const,
      properties: {
        section: {
          type: "string",
          enum: ["price_list", "margin_analysis", "cost_per_case", "contribution_margin"],
        },
      },
      required: ["section"],
    },
  },
  {
    name: "get_pos_label_files",
    description:
      "List the label-artwork files on file in POS > Labels for a brand/size (file names, sizes, upload dates only — not file contents).",
    input_schema: {
      type: "object" as const,
      properties: {
        brand: { type: "string", enum: ["fcb", "speakeasy", "sonoma-cider"] },
        size: { type: "string", enum: ["19.2oz", "16oz", "12oz"] },
      },
    },
  },
  {
    name: "get_users",
    description: "List the app's user accounts: name, email, and role (admin/basic).",
    input_schema: {
      type: "object" as const,
      properties: {},
    },
  },
];

// Tools whose underlying tables are admin-only in the app's own RLS policies
// (Distributor Inventory, Build Orders, Purchase Orders, Events, Sales/
// pricing, POS Label Files), plus get_users — which is app-level restricted
// even though the profiles table itself is readable by any signed-in user
// (see profiles_select_all in supabase/schema.sql), because there's no
// "list every user" capability anywhere in the app for Basic users to
// already have. Basic users get everything else: list_weeks,
// get_inventory_and_allocations, and get_distributors all read tables any
// signed-in user can already see on the Inventory & Allocation page.
const ADMIN_ONLY_TOOL_NAMES = new Set([
  "get_distributor_inventory",
  "get_build_orders",
  "get_purchase_orders",
  "get_events",
  "get_pricing_data",
  "get_pos_label_files",
  "get_users",
]);

// Role-aware tool list to hand to the Anthropic API — Basic users never see
// (and so can never ask Ernie to call) the admin-only tools above.
export function getErnieTools(isAdmin: boolean) {
  return isAdmin
    ? ERNIE_TOOLS
    : ERNIE_TOOLS.filter((tool) => !ADMIN_ONLY_TOOL_NAMES.has(tool.name));
}

async function resolveWeek(supabase: SupabaseClient, weekLabel?: string) {
  if (weekLabel) {
    const { data } = await supabase
      .from("weeks")
      .select("*")
      .ilike("label", `%${weekLabel}%`)
      .order("week_start", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (data) return data;
  }
  const { data: openWeek } = await supabase
    .from("weeks")
    .select("*")
    .eq("status", "open")
    .order("week_start", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (openWeek) return openWeek;

  const { data: anyWeek } = await supabase
    .from("weeks")
    .select("*")
    .order("week_start", { ascending: false })
    .limit(1)
    .maybeSingle();
  return anyWeek ?? null;
}

function indexBy<T extends Record<string, unknown>>(rows: T[], key: string) {
  const map = new Map<string, T>();
  for (const row of rows) map.set(String(row[key]), row);
  return map;
}

export async function runErnieTool(
  supabase: SupabaseClient,
  name: string,
  input: Record<string, unknown>,
  isAdmin: boolean,
): Promise<unknown> {
  // Defense in depth: getErnieTools() already keeps admin-only tools out of
  // a Basic user's tool list, so Claude has nothing to call here — but
  // enforce it at the data layer too rather than relying solely on what
  // tools we handed the model.
  if (ADMIN_ONLY_TOOL_NAMES.has(name) && !isAdmin) {
    return { error: `Tool "${name}" is admin-only and not available to this user.` };
  }

  switch (name) {
    case "list_weeks": {
      const { data, error } = await supabase
        .from("weeks")
        .select("id, label, week_start, status")
        .order("week_start", { ascending: false });
      if (error) throw error;
      return data;
    }

    case "get_inventory_and_allocations": {
      const week = await resolveWeek(supabase, input.week_label as string | undefined);
      if (!week) return { error: "No delivery weeks exist yet." };

      const [
        { data: inventory, error: invErr },
        { data: allocations, error: allocErr },
        { data: products, error: prodErr },
        { data: distributors, error: distErr },
        { data: pos, error: posErr },
        { data: prices, error: priceErr },
      ] = await Promise.all([
        supabase.from("inventory_with_remaining").select("*").eq("week_id", week.id),
        supabase.from("allocations").select("*").eq("week_id", week.id),
        supabase.from("products").select("id, name, sku"),
        supabase.from("distributors").select("id, name"),
        supabase.from("distributor_pos").select("*").eq("week_id", week.id),
        supabase.from("distributor_prices").select("*"),
      ]);
      const err = invErr || allocErr || prodErr || distErr || posErr || priceErr;
      if (err) throw err;

      const productsById = indexBy(products ?? [], "id");
      const distributorsById = indexBy(distributors ?? [], "id");
      const posByDistributor = indexBy(pos ?? [], "distributor_id");
      const priceKey = (distributorId: string, productId: string) => `${distributorId}:${productId}`;
      const pricesByKey = new Map<string, { price: number }>();
      for (const p of prices ?? []) {
        pricesByKey.set(priceKey(p.distributor_id, p.product_id), p);
      }

      const rows = (inventory ?? []).map((snap) => {
        const product = productsById.get(snap.product_id);
        const productAllocations = (allocations ?? []).filter(
          (a) => a.product_id === snap.product_id,
        );
        return {
          product: product?.name ?? "Unknown product",
          sku: product?.sku ?? null,
          on_hand: snap.on_hand,
          unlabeled: snap.unlabeled,
          to_be_packaged: snap.to_be_packaged,
          total: snap.total,
          remaining: snap.remaining,
          status_flag: snap.status_flag,
          allocations: productAllocations.map((a) => {
            const distributor = distributorsById.get(a.distributor_id);
            const distPo = posByDistributor.get(a.distributor_id);
            const priceRow = pricesByKey.get(priceKey(a.distributor_id, a.product_id));
            return {
              distributor: distributor?.name ?? "Unknown distributor",
              quantity: a.quantity,
              status_flag: a.status_flag,
              po_number: distPo?.po_number ?? null,
              po_status: distPo?.po_status ?? null,
              unit_price: priceRow?.price ?? null,
              order_value: priceRow?.price != null ? priceRow.price * a.quantity : null,
            };
          }),
        };
      });

      return { week: { id: week.id, label: week.label, status: week.status }, products: rows };
    }

    case "get_distributor_inventory": {
      const week = await resolveWeek(supabase, input.week_label as string | undefined);
      if (!week) return { error: "No delivery weeks exist yet." };
      const [{ data, error }, { data: products }, { data: distributors }] = await Promise.all([
        supabase.from("distributor_inventory").select("*").eq("week_id", week.id),
        supabase.from("products").select("id, name"),
        supabase.from("distributors").select("id, name"),
      ]);
      if (error) throw error;
      const productsById = indexBy(products ?? [], "id");
      const distributorsById = indexBy(distributors ?? [], "id");
      return {
        week: { id: week.id, label: week.label },
        rows: (data ?? []).map((r) => ({
          product: productsById.get(r.product_id)?.name ?? "Unknown product",
          distributor: distributorsById.get(r.distributor_id)?.name ?? "Unknown distributor",
          on_hand_qty: r.on_hand_qty,
          rate_of_sale: r.rate_of_sale,
          // Same "Days OH" the page shows — on_hand / rate_of_sale, projecting
          // how many days of supply remain at the current sell-through rate.
          days_on_hand: r.rate_of_sale ? r.on_hand_qty / r.rate_of_sale : null,
          source: r.source,
        })),
      };
    }

    case "get_build_orders": {
      const week = await resolveWeek(supabase, input.week_label as string | undefined);
      if (!week) return { error: "No delivery weeks exist yet." };
      const [
        { data: recs, error: recErr },
        { data: parLevels, error: parErr },
        { data: onHand, error: onHandErr },
        { data: products },
        { data: distributors },
      ] = await Promise.all([
        supabase.from("build_order_recommendations").select("*").eq("week_id", week.id),
        supabase.from("distributor_par_levels").select("*"),
        supabase.from("distributor_inventory").select("*").eq("week_id", week.id),
        supabase.from("products").select("id, name"),
        supabase.from("distributors").select("id, name"),
      ]);
      const err = recErr || parErr || onHandErr;
      if (err) throw err;

      const productsById = indexBy(products ?? [], "id");
      const distributorsById = indexBy(distributors ?? [], "id");
      const onHandKey = (d: string, p: string) => `${d}:${p}`;
      const onHandByKey = new Map<string, number>();
      for (const r of onHand ?? []) onHandByKey.set(onHandKey(r.distributor_id, r.product_id), r.on_hand_qty);

      const rows = (parLevels ?? []).map((par) => {
        const rec = (recs ?? []).find(
          (r) => r.distributor_id === par.distributor_id && r.product_id === par.product_id,
        );
        const currentOnHand = onHandByKey.get(onHandKey(par.distributor_id, par.product_id)) ?? 0;
        return {
          distributor: distributorsById.get(par.distributor_id)?.name ?? "Unknown distributor",
          product: productsById.get(par.product_id)?.name ?? "Unknown product",
          par_level: par.par_level,
          on_hand: currentOnHand,
          recommended_qty: rec?.recommended_qty ?? Math.max(par.par_level - currentOnHand, 0),
        };
      });
      return { week: { id: week.id, label: week.label }, rows };
    }

    case "get_distributors": {
      const { data, error } = await supabase
        .from("distributors")
        .select("name, active, track_inventory")
        .order("sort_order", { ascending: true, nullsFirst: false });
      if (error) throw error;
      return data;
    }

    case "get_purchase_orders": {
      let query = supabase.from("purchase_orders").select("*, purchase_order_items(*)");
      if (input.payment_status) query = query.eq("payment_status", input.payment_status);
      if (input.ordered_status) query = query.eq("ordered_status", input.ordered_status);
      const { data, error } = await query.order("po_date", { ascending: false });
      if (error) throw error;
      return data;
    }

    case "get_events": {
      let query = supabase.from("events").select("*");
      if (input.start_date) query = query.gte("start_date", input.start_date as string);
      if (input.end_date) query = query.lte("start_date", input.end_date as string);
      const { data, error } = await query.order("start_date", { ascending: true });
      if (error) throw error;

      let rows = data ?? [];
      if (input.distributor_name) {
        const { data: distributors } = await supabase
          .from("distributors")
          .select("id, name")
          .ilike("name", `%${input.distributor_name}%`);
        const ids = new Set((distributors ?? []).map((d) => d.id));
        rows = rows.filter((r) => r.distributor_id && ids.has(r.distributor_id));
      }
      const { data: allDistributors } = await supabase.from("distributors").select("id, name");
      const distributorsById = indexBy(allDistributors ?? [], "id");
      return rows.map((r) => ({
        title: r.title,
        type: r.type,
        start_date: r.start_date,
        end_date: r.end_date,
        time_label: r.time_label,
        location: r.location,
        distributor: r.distributor_id ? distributorsById.get(r.distributor_id)?.name ?? null : null,
        rep: r.rep,
        notes: r.notes,
      }));
    }

    case "get_pricing_data": {
      const section = input.section as string;
      if (section === "price_list") {
        const { data: brands, error } = await supabase
          .from("pricing_brands")
          .select("*, brand_price_list(*)")
          .eq("active", true)
          .order("sort_order", { ascending: true, nullsFirst: false });
        if (error) throw error;
        return brands;
      }
      if (section === "margin_analysis") {
        const [
          { data: brands, error: e1 },
          { data: analyses, error: e2 },
          { data: packages, error: e3 },
          { data: components, error: e4 },
          { data: laborRows, error: e5 },
        ] = await Promise.all([
          supabase.from("pricing_brands").select("id, name"),
          supabase.from("margin_analyses").select("*"),
          supabase.from("margin_analysis_packages").select("*"),
          supabase.from("packaging_components").select("component_key, price"),
          supabase.from("package_labor_costs").select("package_key, labor"),
        ]);
        const err = e1 || e2 || e3 || e4 || e5;
        if (err) throw err;

        const brandsById = indexBy(brands ?? [], "id");
        const componentPriceMap: Record<string, number> = {};
        for (const c of components ?? []) componentPriceMap[c.component_key] = c.price;
        const laborCostMap: Record<string, number> = {};
        for (const l of laborRows ?? []) laborCostMap[l.package_key] = l.labor;

        const packagesByAnalysis = new Map<string, typeof packages>();
        for (const p of packages ?? []) {
          const list = packagesByAnalysis.get(p.analysis_id) ?? [];
          list.push(p);
          packagesByAnalysis.set(p.analysis_id, list);
        }

        // Same math as the live Margin Analysis page (lib/marginAnalysis.ts):
        // per-package PTR/PTD gross profit, then full-batch economics using
        // each package's own override or the live Cost Per Case default.
        const rows: unknown[] = [];
        for (const analysis of analyses ?? []) {
          const brandName = brandsById.get(analysis.brand_id)?.name ?? "Unknown brand";
          const pkgRows = packagesByAnalysis.get(analysis.id) ?? [];
          for (const key of PRICE_LIST_PACKAGE_KEYS as PriceListPackageKey[]) {
            const p = (pkgRows ?? []).find((r) => r.package_key === key);
            if (!p || p.enabled === false) continue;
            const meta = PKG_META[key];
            const calc = p.ptr > 0 && p.ptd > 0 ? calcPkg(p.ptr, p.ptd, meta.units) : null;
            if (!calc) {
              rows.push({
                brand: brandName,
                package: PRICE_LIST_PACKAGE_LABELS[key],
                note: "No PTR/PTD entered for this package yet.",
              });
              continue;
            }
            const labor = p.labor ?? laborCostMap[key] ?? meta.labor;
            const yieldAmt = p.yield_amt ?? meta.defaultYield;
            const packCost = p.pack_cost ?? (meta.isKeg ? 0 : calcPackagingCost(key, componentPriceMap));
            const batch = meta.isKeg
              ? calcBatchKeg(calc.ptd, yieldAmt, analysis.batch_cost, labor)
              : calcBatchCan(calc.ptd, yieldAmt, analysis.batch_cost, packCost, labor);
            rows.push({
              brand: brandName,
              package: PRICE_LIST_PACKAGE_LABELS[key],
              ptr: p.ptr,
              ptd: p.ptd,
              gross_profit_per_unit: calc.gp$,
              gross_profit_pct: calc.gp_pct * 100,
              batch_cost: analysis.batch_cost,
              yield_bbls: analysis.yield_bbls,
              batch_yield_amt: yieldAmt,
              batch_revenue: batch.revenue,
              batch_total_cost: batch.total,
              batch_profit: batch.profit,
              batch_margin_pct: batch.margin * 100,
            });
          }
        }
        return rows;
      }
      if (section === "cost_per_case") {
        const [
          { data: components, error: e1 },
          { data: ingredients, error: e2 },
          { data: laborRows, error: e3 },
          { data: recipeItems, error: e4 },
          { data: brands, error: e5 },
        ] = await Promise.all([
          supabase.from("packaging_components").select("*"),
          supabase.from("ingredient_costs").select("*"),
          supabase.from("package_labor_costs").select("*"),
          supabase.from("batch_recipe_items").select("*"),
          supabase.from("pricing_brands").select("id, name"),
        ]);
        const err = e1 || e2 || e3 || e4 || e5;
        if (err) throw err;

        const componentPriceMap: Record<string, number> = {};
        for (const c of components ?? []) componentPriceMap[c.component_key] = c.price;
        const ingredientPriceMap: Record<string, number> = {};
        for (const i of ingredients ?? []) ingredientPriceMap[i.ingredient_key] = i.price;
        const laborMap: Record<string, number> = {};
        for (const l of laborRows ?? []) laborMap[l.package_key] = l.labor;

        // Same math as the live Cost Per Case "Overview" tab
        // (lib/costPerCase.ts): packaging cost per case from the fixed
        // composition table, labor allocated across each format's fixed
        // yield, and each brand's ingredient batch cost (always a flat
        // 30-BBL batch) spread across each format's yield too.
        const packagingCostPerCase: Record<string, number> = {};
        const laborCostPerCase: Record<string, number> = {};
        for (const key of PRICE_LIST_PACKAGE_KEYS as PriceListPackageKey[]) {
          const isKeg = key === "sixth" || key === "half";
          packagingCostPerCase[key] = isKeg ? 0 : calcPackagingCost(key, componentPriceMap);
          const labor = laborMap[key] ?? PKG_META[key].labor;
          laborCostPerCase[key] = labor / OVERVIEW_PACKAGE_YIELDS[key];
        }

        const recipeByBrand = new Map<string, typeof recipeItems>();
        for (const r of recipeItems ?? []) {
          const list = recipeByBrand.get(r.brand_id) ?? [];
          list.push(r);
          recipeByBrand.set(r.brand_id, list);
        }

        const ingredientCostByBrand = (brands ?? [])
          .map((b) => {
            const recipe = recipeByBrand.get(b.id) ?? [];
            const costPerBatch = (recipe ?? []).reduce(
              (sum, r) => sum + r.qty_per_bbl * OVERVIEW_BATCH_BBLS * (ingredientPriceMap[r.ingredient_key] ?? 0),
              0,
            );
            const costPerCase: Record<string, number> = {};
            for (const key of PRICE_LIST_PACKAGE_KEYS as PriceListPackageKey[]) {
              costPerCase[key] = costPerBatch / OVERVIEW_PACKAGE_YIELDS[key];
            }
            return { brand: b.name, cost_per_30bbl_batch: costPerBatch, ingredient_cost_per_case: costPerCase };
          })
          .filter((b) => b.cost_per_30bbl_batch > 0);

        return {
          packaging_cost_per_case: packagingCostPerCase,
          labor_cost_per_case: laborCostPerCase,
          ingredient_cost_per_brand: ingredientCostByBrand,
          raw_component_prices: components,
          raw_ingredient_prices: ingredients,
          raw_labor_costs: laborRows,
        };
      }
      if (section === "contribution_margin") {
        const [
          { data: lines, error: e1 },
          { data: brands, error: e2 },
          { data: components, error: e3 },
          { data: ingredients, error: e4 },
          { data: laborRows, error: e5 },
          { data: recipeItems, error: e6 },
        ] = await Promise.all([
          supabase.from("contribution_margin_lines").select("*"),
          supabase.from("pricing_brands").select("id, name, company"),
          supabase.from("packaging_components").select("*"),
          supabase.from("ingredient_costs").select("*"),
          supabase.from("package_labor_costs").select("*"),
          supabase.from("batch_recipe_items").select("*"),
        ]);
        const err = e1 || e2 || e3 || e4 || e5 || e6;
        if (err) throw err;

        const brandsById = indexBy(brands ?? [], "id");
        const componentPriceMap: Record<string, number> = {};
        for (const c of components ?? []) componentPriceMap[c.component_key] = c.price;
        const ingredientPriceMap: Record<string, number> = {};
        for (const i of ingredients ?? []) ingredientPriceMap[i.ingredient_key] = i.price;
        const laborMap: Record<string, number> = {};
        for (const l of laborRows ?? []) laborMap[l.package_key] = l.labor;
        const recipeByBrand = new Map<string, { ingredientKey: string; qtyPerBbl: number }[]>();
        for (const r of recipeItems ?? []) {
          const list = recipeByBrand.get(r.brand_id) ?? [];
          list.push({ ingredientKey: r.ingredient_key, qtyPerBbl: r.qty_per_bbl });
          recipeByBrand.set(r.brand_id, list);
        }

        // Same math as the live Contribution Margin page
        // (lib/contributionMargin.ts) — only brands with a company set are
        // in scope there, same restriction applied here.
        return (lines ?? [])
          .map((line) => {
            const brand = brandsById.get(line.brand_id);
            if (!brand || !brand.company) return null;
            const calc = computeContributionMarginLine({
              packageKey: line.package_key,
              revenuePerCe: line.revenue_per_ce,
              componentPrices: componentPriceMap,
              recipeItems: recipeByBrand.get(line.brand_id) ?? [],
              ingredientPrices: ingredientPriceMap,
              laborForPackage: laborMap[line.package_key] ?? 0,
            });
            return {
              brand: brand.name,
              package: PRICE_LIST_PACKAGE_LABELS[line.package_key as PriceListPackageKey],
              revenue_per_ce: calc.revenuePerCE,
              cost_per_ce: calc.totalCostPerCE,
              cm_per_ce: calc.cm,
              margin_pct: calc.cmPct,
              inventory_value: calc.inventoryValue,
              total_batch_cost: calc.totalBatchCost,
            };
          })
          .filter((r) => r !== null);
      }
      return { error: `Unknown section "${section}"` };
    }

    case "get_pos_label_files": {
      let query = supabase
        .from("pos_label_files")
        .select("brand, size, file_name, size_bytes, uploaded_at");
      if (input.brand) query = query.eq("brand", input.brand as string);
      if (input.size) query = query.eq("size", input.size as string);
      const { data, error } = await query.order("uploaded_at", { ascending: false });
      if (error) throw error;
      return data;
    }

    case "get_users": {
      const { data, error } = await supabase
        .from("profiles")
        .select("full_name, email, role, created_at")
        .order("full_name");
      if (error) throw error;
      return data;
    }

    default:
      return { error: `Unknown tool "${name}"` };
  }
}

// Kept out of the tools list (not a data lookup) but shared here since it's
// tightly coupled to what the tools above can/can't do. Role-aware: a Basic
// user's prompt describes a narrower, accurate set of data Ernie can reach
// for them (matching getErnieTools() above), rather than claiming access
// Ernie doesn't actually have for that user.
export function buildErnieSystemPrompt(isAdmin: boolean): string {
  const dataAccessParagraph = isAdmin
    ? `You can read data — inventory, allocations, distributors, distributor-reported inventory, Build Orders, the Events Calendar, purchase orders, Sales/pricing data, POS label files, and the app's user list — via the tools available to you. You have NO ability to write, edit, or delete anything in the app; if someone asks you to change something, tell them you're read-only and that they'll need to make that change on the relevant page themselves.`
    : `You can read inventory and allocations data — on-hand/unlabeled/to-be-packaged/remaining quantities, per-distributor allocations, PO numbers and status, and distributor pricing (so order value can be computed) — and the distributor list, via the tools available to you. This is the same data this user can already see on the app's Inventory & Allocation page. You do NOT have access to purchase orders, Sales/pricing data, distributor-reported on-hand inventory, Build Orders, the Events Calendar, POS label files, or the list of app users — those are admin-only areas of the app. If someone asks about any of those, say plainly that you don't have access to that and they should check with an admin, rather than guessing or refusing to engage. You have NO ability to write, edit, or delete anything in the app; if someone asks you to change something, tell them you're read-only and that they'll need to make that change on the relevant page themselves.`;

  return `You are Ernie, an internal AI assistant built into FCB Data (Full Circle Brewing Co.'s inventory/allocations/operations app), available to every signed-in user.

${dataAccessParagraph}

When someone's message isn't actually a question or request — a stray "test", "check", "hi", or similar — just respond briefly and naturally, the way a person would. Don't recite your list of capabilities every time; said the same way twice it starts to sound like a canned script. Only describe what you can help with when it's genuinely useful in the moment — e.g. the very first message of a brand-new conversation, or someone seems unsure what to ask — and vary the wording rather than reusing the same phrasing each time.

You are NOT limited to app-data questions — answer general knowledge, how-to, math, and any other question the way any capable assistant would, using your own knowledge. Only reach for the app-data tools when the question is actually about FCB Data's own data; don't mention those tools or their limits when a question has nothing to do with the app.

You also have live web search. Use it for anything that could have changed since your training — current events, today's prices, who currently holds some role, etc. — rather than guessing from memory. Don't mention that it's a "tool" or how it works; just search and answer.

Be direct and brief. Answer exactly what was asked — a specific question gets a specific, short answer, not a full data dump of everything related to it. Only include extra context (other SKUs, other distributors, caveats, etc.) if it's clearly relevant to what they're trying to find out, or if they asked for a fuller breakdown. When asked a question, use the tools to pull real current data rather than guessing. Cite specific numbers/names from the tool results. If a question is ambiguous about which week it refers to, use the current open week by default and say which week you used.

This chat only displays plain text — never use markdown formatting. No **bold**, no tables, no headers, no bullet/numbered lists, no backticks. Write in plain conversational sentences, the way you'd answer someone out loud. If you're listing a few items, just write them into a sentence (e.g. "Big Daddy IPA has 12 cases on hand; Mystic Haze, Prohibition, and Peachy Vibes are all at zero.") instead of a table or list.

Never mention Claude, Anthropic, or any underlying model/vendor — you are Ernie, full stop.`;
}
