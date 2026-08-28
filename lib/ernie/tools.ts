// Read-only data tools for Ernie (the in-app AI assistant, see
// app/api/ernie/chat/route.ts). Each tool is a narrow, purpose-built query
// against one slice of the app's data — never a raw/arbitrary SQL executor —
// so Ernie can only ever read exactly what these functions expose, joined
// and shaped in plain JS. Nothing here writes to the database.
//
// Ernie itself runs on Anthropic's Claude API under the hood; nothing about
// that should surface in user-facing text (see ERNIE_SYSTEM_PROMPT below).

import type { SupabaseClient } from "@supabase/supabase-js";

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
      "Sales section data: Price List (brand price-to-retailer/distributor by package format), Margin Analysis (batch cost/yield + per-package PTR/PTD), Cost Per Case (packaging component/ingredient/labor prices), or Contribution Margin (revenue per case unit by brand/package).",
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
): Promise<unknown> {
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
        const { data: brands } = await supabase.from("pricing_brands").select("id, name");
        const { data, error } = await supabase
          .from("margin_analyses")
          .select("*, margin_analysis_packages(*)");
        if (error) throw error;
        const brandsById = indexBy(brands ?? [], "id");
        return (data ?? []).map((m) => ({ ...m, brand: brandsById.get(m.brand_id)?.name ?? null }));
      }
      if (section === "cost_per_case") {
        const [{ data: components, error: e1 }, { data: ingredients, error: e2 }, { data: labor, error: e3 }] =
          await Promise.all([
            supabase.from("packaging_components").select("*"),
            supabase.from("ingredient_costs").select("*"),
            supabase.from("package_labor_costs").select("*"),
          ]);
        if (e1 || e2 || e3) throw e1 || e2 || e3;
        return { packaging_components: components, ingredient_costs: ingredients, package_labor_costs: labor };
      }
      if (section === "contribution_margin") {
        const { data: brands } = await supabase.from("pricing_brands").select("id, name");
        const { data, error } = await supabase.from("contribution_margin_lines").select("*");
        if (error) throw error;
        const brandsById = indexBy(brands ?? [], "id");
        return (data ?? []).map((l) => ({ ...l, brand: brandsById.get(l.brand_id)?.name ?? null }));
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
        .select("full_name, email, role")
        .order("full_name");
      if (error) throw error;
      return data;
    }

    default:
      return { error: `Unknown tool "${name}"` };
  }
}

// Kept out of the tools list (not a data lookup) but shared here since it's
// tightly coupled to what the tools above can/can't do.
export const ERNIE_SYSTEM_PROMPT = `You are Ernie, an internal AI assistant built into FCB Data (Full Circle Brewing Co.'s inventory/allocations/operations app). You are only ever shown to admins.

You can read data — inventory, allocations, distributors, events, purchase orders, pricing, users — via the tools available to you. You have NO ability to write, edit, or delete anything in the app; if someone asks you to change something, tell them you're read-only and that they'll need to make that change on the relevant page themselves.

Be direct and brief. Answer exactly what was asked — a specific question gets a specific, short answer, not a full data dump of everything related to it. Only include extra context (other SKUs, other distributors, caveats, etc.) if it's clearly relevant to what they're trying to find out, or if they asked for a fuller breakdown. When asked a question, use the tools to pull real current data rather than guessing. Cite specific numbers/names from the tool results. If a question is ambiguous about which week it refers to, use the current open week by default and say which week you used.

This chat only displays plain text — never use markdown formatting. No **bold**, no tables, no headers, no bullet/numbered lists, no backticks. Write in plain conversational sentences, the way you'd answer someone out loud. If you're listing a few items, just write them into a sentence (e.g. "Big Daddy IPA has 12 cases on hand; Mystic Haze, Prohibition, and Peachy Vibes are all at zero.") instead of a table or list.

Never mention Claude, Anthropic, or any underlying model/vendor — you are Ernie, full stop.`;
