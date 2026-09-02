// Read-only data tools for Ernie (the in-app AI assistant, see
// app/api/ernie/chat/route.ts). Nothing here writes to the app's own
// database (allocations, inventory, pricing, etc.) — the one deliberate
// exception to "Ernie never changes anything" is edit_spreadsheet, which
// edits a FILE the user themselves uploaded (not app data) and hands back
// a new version, same as if they'd edited it in Excel and saved a copy.
// Most of these tools are narrow, purpose-built queries against one slice
// of the app's data, shaped in plain JS — but "run_read_only_query" (see
// its case below) is a deliberate exception: a general-purpose read-only
// SQL tool, added 2026-08-31 after enough one-off narrow tools had been
// hand-built that Chad asked for a genuinely versatile one instead
// ("the more versatile the tool the better"). It calls the
// `ernie_readonly_query` Postgres function (sql/ernie_readonly_query.sql)
// with `security invoker`, so it runs as the actual signed-in user and is
// bound by the exact same Row Level Security policies as anything else —
// a Basic user's query against admin-only data comes back empty there too,
// same as everywhere else in the app. See that SQL file for the full
// safety writeup (statement-shape checks, the profiles carve-out, schema
// blocks, row cap, timeout).
//
// File upload (added 2026-08-31, "spreadsheets is important, we use so
// many, having ernie to be able to edit them and analyze them would be
// huge" — Chad): list_uploaded_files/read_uploaded_file/edit_spreadsheet
// work with whatever a user attaches in the chat (see lib/ernie/files.ts
// for the actual byte-level work — download from Storage, render a
// spreadsheet into an address-labeled text grid, apply edits in place with
// ExcelJS so formatting/other sheets/formulas survive untouched). RLS on
// ernie_files plus a per-user Storage folder policy (sql/ernie_files.sql)
// keeps everyone to their own files, same as ernie_conversations/messages.
//
// get_file_for_download (added 2026-08-31, Chad: "pos may not be the only
// place we end up having files stored... but either way, we need ernie to
// have the ability to pull files and present them if asked") is a second,
// deliberately generic way Ernie hands someone a real file — not something
// they uploaded to Ernie, but a file that already exists elsewhere in the
// app (a POS label file, event material, etc.), found first via
// run_read_only_query. It isn't in ADMIN_ONLY_TOOL_NAMES below, because it
// doesn't need to be: whether the fetch actually succeeds is decided
// entirely by that bucket's own Row Level Security, evaluated against the
// caller's real session (see fetchExternalFileForDownload in
// lib/ernie/files.ts) — the same "admin-only data just comes back empty/
// denied" pattern as run_read_only_query, and one that needs zero changes
// when the admin/basic split is eventually replaced by a real per-user,
// per-area permission system.
//
// Ernie itself runs on Anthropic's Claude API under the hood; nothing about
// that should surface in user-facing text (see ERNIE_SYSTEM_PROMPT below).

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Role } from "@/lib/types/db";
import { hasSection, hasAnySection, type AnySectionKey } from "@/lib/permissions";
import type { PriceListPackageKey } from "@/lib/types/db";
import { PRICE_LIST_PACKAGE_KEYS, PRICE_LIST_PACKAGE_LABELS } from "@/lib/types/db";
import { calcPackagingCost, OVERVIEW_BATCH_BBLS, OVERVIEW_PACKAGE_YIELDS } from "@/lib/costPerCase";
import { PKG_META, calcPkg, calcBatchCan, calcBatchKeg } from "@/lib/marginAnalysis";
import { computeContributionMarginLine } from "@/lib/contributionMargin";
import {
  buildFileContentBlocks,
  applySpreadsheetEdits,
  fetchExternalFileForDownload,
  type SpreadsheetEditInput,
} from "@/lib/ernie/files";

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
  {
    name: "search_past_conversations",
    description:
      "Search THIS SAME signed-in user's own past Ernie conversations (every conversation except the current one) for messages matching a keyword or phrase. Use this whenever someone refers to something discussed earlier, asks you to recall a previous conversation, or a question seems to depend on context from before this chat (e.g. \"like I asked last week\", \"what did you tell me about X before\", \"pull up that conversation about...\"). Omit the query to just list recent past conversations instead of searching by keyword. Never returns any other user's conversations — only this one's.",
    input_schema: {
      type: "object" as const,
      properties: {
        query: {
          type: "string",
          description: "Keyword or phrase to search for in past messages. Omit to list recent past conversations instead.",
        },
      },
    },
  },
  {
    name: "run_read_only_query",
    description:
      `Run any read-only Postgres SELECT query against the app's own database to answer a question none of the other tools already cover — join, filter, group, or aggregate across whatever tables this signed-in user is allowed to see. Prefer a more specific tool above when one already answers the question directly; reach for this whenever it doesn't, instead of guessing or saying you can't help.

Permissions work exactly like the rest of the app: this runs as the actual signed-in user, so the database's own row-level security applies automatically — a Basic user's query against an admin-only table (purchase_orders, distributor_inventory, build_order_recommendations, events, pricing_brands/brand_price_list/margin_analyses/margin_analysis_packages/packaging_components/ingredient_costs/package_labor_costs/batch_recipe_items/contribution_margin_lines, pos_label_files) simply comes back with zero rows — that almost always means "this account doesn't have access to that," not "no such thing exists," so say so rather than concluding nothing exists. A non-admin's query mentioning the profiles table is rejected outright (that table holds the full user list, which stays admin-only). Only a single SELECT (or WITH ... SELECT) statement is allowed — no INSERT/UPDATE/DELETE/DDL, no semicolons, capped at 500 rows, an 8 second timeout.

Key tables and their columns:
- weeks(id, label, week_start, status, previous_week_id)
- products(id, name, sku, avg_price, active, sort_order)
- distributors(id, name, active, track_inventory, sort_order)
- inventory_snapshots(id, week_id, product_id, on_hand, unlabeled, to_be_packaged, status_flag) — or the inventory_with_remaining view, same columns plus a computed "remaining" (total minus all allocations)
- allocations(id, week_id, distributor_id, product_id, quantity, status_flag) — status_flag on both tables is one of good_confirmed/dont_have/have_some/need_to_package/need_pakteks/need_labels/need_cans/need_kegs
- distributor_pos(week_id, distributor_id, po_number, po_status) — po_status is approved/pending/delivered
- distributor_prices(distributor_id, product_id, price)
- packaging_inventory(week_id, item_key, on_hand_qty) — item_key is one of cans_19_2oz/cans_16oz/cans_12oz/pakteks_4pack/pakteks_6pack/trays_12_16oz/trays_19oz/lids_202/kegs_1_6bbl/kegs_1_2bbl
- label_inventory(week_id, product_id, on_hand_qty) — one row of on-hand labels per product per week
- custom_packaging_items(id, name, active) / custom_packaging_inventory(week_id, item_id, on_hand_qty), and the same shape for custom_label_items / custom_label_inventory — freeform items beyond the fixed list above
- distributor_inventory(week_id, distributor_id, product_id, on_hand_qty, rate_of_sale, source) [admin-only]
- distributor_par_levels(distributor_id, product_id, par_level) / build_order_recommendations(week_id, distributor_id, product_id, recommended_qty) [admin-only]
- purchase_orders(id, supplier, po_date, expected_delivery_date, total_cost, payment_status, ordered_status, comments) / purchase_order_items(purchase_order_id, item, quantity, unit_cost, line_total) [admin-only]
- events(id, title, type, start_date, end_date, time_label, location, distributor_id, rep, notes) [admin-only]
- event_materials(id, event_id, file_name, storage_path, mime_type, size_bytes, uploaded_at) [admin-only] — files attached to one specific event; bucket is "event-materials"
- pos_library(id, file_name, storage_path, mime_type, size_bytes, uploaded_at) [admin-only] — the shared POS materials library, not tied to any one event; same "event-materials" bucket
- pos_label_files(id, brand, size, file_name, storage_path, mime_type, size_bytes, uploaded_at) [admin-only] — can/bottle label artwork; bucket is "pos-label-files"
- profiles(id, full_name, email, role, created_at) [admin-only through this tool]

Sales section tables (all admin-only, folded in from the old FCB Pricing desktop app):
- pricing_brands(id, name, sort_order, active, company) — one row per brand; company groups a brand under a parent for Contribution Margin, null for brands outside that feature's scope
- brand_price_list(id, brand_id, package_key, price) — Price List: what's charged per package format, package_key one of 6pk/4pack/single/sixth/half
- margin_analyses(id, brand_id, batch_cost, yield_bbls) — one row per brand: total cost and BBL yield of that brand's standard batch (yield_bbls defaults to 30)
- margin_analysis_packages(id, analysis_id, package_key, enabled, ptr, ptd, pack_cost, labor, yield_amt) — per-package overrides off a margin_analyses row; a null pack_cost/labor/yield_amt means "use the standard default for that format," not zero
- packaging_components(component_key, label, category, price) — unit prices for cans/lids/trays/pakteks and the rest of Cost Per Case's fixed packaging composition
- ingredient_costs(id, category_key, ingredient_key, name, unit, price) — unit price per raw ingredient; category_key is one of yeast/grain/hops/flavoring/other
- package_labor_costs(package_key, labor) — labor cost per package format
- batch_recipe_items(id, brand_id, ingredient_key, qty_per_bbl, unit, sort_order) — one row per ingredient in a brand's batch recipe, quantity per BBL of batch. This is Sales > Cost Per Case > Batch Ingredients: to answer "what are the batch ingredients and costs for N bbls of <brand>," join batch_recipe_items to ingredient_costs on ingredient_key, multiply qty_per_bbl * N * ingredient_costs.price for each ingredient's cost, and sum across a brand's rows for the batch total — N is whatever batch size was asked about, it does not have to match that brand's usual margin_analyses.yield_bbls
- contribution_margin_lines(id, brand_id, package_key, revenue_per_ce) — revenue per case-equivalent, the one user-edited figure Contribution Margin needs; everything else there is computed from Cost Per Case's and Margin Analysis's tables

Two Postgres functions already implement the exact packaging/label bill-of-materials math the Inventory & Allocation page uses — call them from SQL rather than re-deriving the recipe yourself: classify_product_packaging(product_name text) returns one of can_19_2oz/can_16oz/can_12oz/keg_1_2bbl/keg_1_6bbl/tap_handle/unrecognized; packaging_consumed_for_week(week_id uuid) returns a table(item_key, consumed) of total packaging consumed by that week's allocations (every distributor combined — join allocations yourself, filtered by distributor_id, if you need one distributor's share instead).

Any table above with a storage_path column (event_materials, pos_library, pos_label_files today — there may be more as the app grows) is describing a real file, not just data. Querying one of those only tells you the file EXISTS — to actually hand it to the user as a download, call get_file_for_download with that row's storage_path and its bucket (event-materials for event_materials/pos_library, pos-label-files for pos_label_files). Whenever someone asks you to pull up, send them, or let them download a specific file — not just tell them about it — that's the tool to reach for.`,
    input_schema: {
      type: "object" as const,
      properties: {
        query: {
          type: "string",
          description: "A single read-only Postgres SELECT statement (or WITH ... SELECT). No semicolons.",
        },
      },
      required: ["query"],
    },
  },
  {
    name: "list_uploaded_files",
    description:
      "List files this signed-in user has uploaded to Ernie (or that Ernie has produced by editing one), most recent first — file_id, file name, type, size, and whether it's something they uploaded or something Ernie produced. Use this to find a file_id when someone refers to a file from earlier without re-attaching it (e.g. \"that spreadsheet from before\", \"the file I sent you yesterday\").",
    input_schema: {
      type: "object" as const,
      properties: {},
    },
  },
  {
    name: "read_uploaded_file",
    description:
      "Read the contents of a previously-uploaded (or previously Ernie-produced) file again, by file_id — for when someone refers to a file from earlier in this or a past conversation without re-attaching it. Use list_uploaded_files first if you don't already have the file_id. Spreadsheets, CSV, plain text, and images all work; a PDF can't be re-read this way — ask the user to re-attach it instead.",
    input_schema: {
      type: "object" as const,
      properties: {
        file_id: {
          type: "string",
          description: "The file's id, from list_uploaded_files or from earlier in this conversation.",
        },
      },
      required: ["file_id"],
    },
  },
  {
    name: "edit_spreadsheet",
    description:
      `Edit specific cells in a spreadsheet (.xlsx) or CSV file the user uploaded, and save the result as a new downloadable file — the original file's other cells, formatting, other sheets, and formulas are left untouched; only the cells listed here change. Always read the file first (it's included automatically when freshly attached, or use read_uploaded_file for one from earlier) so you know its real sheet names and current values — cell addresses like "B3" must match exactly what you saw when you read it.

Each edit is {sheet, cell, value}: sheet is the exact sheet name (omit for a CSV, or to use the file's first/only sheet); cell is a spreadsheet-style address such as "B3"; value is the new value (a string, a number, or null to clear the cell) — a string starting with "=" is set as a formula (.xlsx only, ignored for CSV). Pass every cell that needs to change in one call rather than calling this once per cell. After it succeeds, tell the user plainly what changed and that a new file is ready to download — don't just say "done" with no detail, and never claim you edited a file if this tool wasn't actually called or didn't succeed.`,
    input_schema: {
      type: "object" as const,
      properties: {
        file_id: { type: "string", description: "The spreadsheet or CSV file's id to edit." },
        edits: {
          type: "array",
          items: {
            type: "object" as const,
            properties: {
              sheet: {
                type: "string",
                description: "Exact sheet name (.xlsx only). Omit for CSV, or to use the file's first sheet.",
              },
              cell: { type: "string", description: 'Spreadsheet-style address, e.g. "B3".' },
              value: {
                type: ["string", "number", "null"],
                description: "The new value for this cell — string, number, or null to clear it.",
              },
            },
            required: ["cell", "value"],
          },
        },
        output_file_name: {
          type: "string",
          description: "Optional new file name for the edited file. Omit to keep the original name.",
        },
      },
      required: ["file_id", "edits"],
    },
  },
  {
    name: "get_file_for_download",
    description:
      `Fetch a file that already exists somewhere else in the app — found via run_read_only_query against a table with a storage_path column (event_materials, pos_library, pos_label_files today) — and hand it to the user as a real downloadable attachment in this chat, instead of just describing that it exists. Pass the exact bucket and storage_path from that row.

Whether this succeeds depends entirely on whether YOU (the signed-in user asking) actually have access to that file, same as everywhere else in the app — an error back from this tool means access is restricted, not that anything is broken, so explain it that way rather than guessing at a bug. Use this any time someone asks you to pull up, send, or let them download a specific file.`,
    input_schema: {
      type: "object" as const,
      properties: {
        bucket: {
          type: "string",
          description: 'The storage bucket name, e.g. "pos-label-files" or "event-materials".',
        },
        path: {
          type: "string",
          description: "The file's storage_path exactly as returned by the query that found it.",
        },
        file_name: {
          type: "string",
          description: "A human-readable file name to show the user. Omit to derive one from the path.",
        },
      },
      required: ["bucket", "path"],
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

// Which section(s) unlock each formerly-admin-only tool — mirrors the RLS
// grouping in sql/user_section_access.sql. get_pricing_data covers Sales
// broadly (it reuses the same calc functions all 4 Sales pages share), so
// having ANY one Sales section is enough to ask Ernie about pricing/margin
// data. get_users has no section — it stays hard admin-only, same as
// today, since there's no "list every user" capability anywhere else in
// the app for a Basic user to already have.
const TOOL_SECTIONS: Record<string, AnySectionKey[] | null> = {
  get_distributor_inventory: ["distributor_inventory", "build_orders"],
  get_build_orders: ["build_orders"],
  get_purchase_orders: ["purchase_orders"],
  get_events: ["events_calendar"],
  get_pricing_data: ["price_list", "margin_analysis", "cost_per_case", "contribution_margin"],
  get_pos_label_files: ["pos_labels"],
  get_users: null,
};

function canUseTool(name: string, role: Role | undefined, sections: AnySectionKey[]) {
  if (!ADMIN_ONLY_TOOL_NAMES.has(name)) return true;
  const allowedSections = TOOL_SECTIONS[name];
  if (!allowedSections) return role === "admin";
  return hasAnySection(role, sections, allowedSections);
}

// Section-aware tool list to hand to the Anthropic API — a Basic user
// never sees (and so can never ask Ernie to call) a tool backed by a
// section they haven't been granted. Ernie itself is gated separately, one
// level up, by the "ernie_ai" section (see app/api/ernie/chat/route.ts) —
// this function assumes that check already passed.
export function getErnieTools(role: Role | undefined, sections: AnySectionKey[]) {
  if (role === "admin") return ERNIE_TOOLS;
  return ERNIE_TOOLS.filter((tool) => canUseTool(tool.name, role, sections));
}

// Friendly, human-readable labels shown live in the chat UI while Ernie is
// working (see app/api/ernie/chat/route.ts and ErnieChatClient.tsx) — never
// the raw tool/function name. Anthropic's own hosted "web_search" isn't one
// of ERNIE_TOOLS (it's a server-side tool Anthropic runs itself), so it's
// handled as a special case wherever this is called from.
const TOOL_STATUS_LABELS: Record<string, string> = {
  list_weeks: "Checking delivery weeks",
  get_inventory_and_allocations: "Checking inventory & allocations",
  get_distributor_inventory: "Checking distributor-reported inventory",
  get_build_orders: "Checking Build Orders",
  get_distributors: "Checking the distributor list",
  get_purchase_orders: "Checking purchase orders",
  get_events: "Checking the events calendar",
  get_pricing_data: "Checking Sales & pricing data",
  get_pos_label_files: "Checking label files",
  get_users: "Checking the user list",
  search_past_conversations: "Searching past conversations",
  run_read_only_query: "Running a custom data lookup",
  list_uploaded_files: "Checking your uploaded files",
  read_uploaded_file: "Reading your uploaded file",
  edit_spreadsheet: "Editing your spreadsheet",
  get_file_for_download: "Fetching that file",
};

export function describeErnieToolCall(name: string): string {
  return TOOL_STATUS_LABELS[name] ?? "Looking something up";
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
  role: Role | undefined,
  sections: AnySectionKey[],
  currentConversationId?: string,
): Promise<unknown> {
  // Defense in depth: getErnieTools() already keeps a tool a user isn't
  // granted out of their tool list, so Claude has nothing to call here —
  // but enforce it at the data layer too rather than relying solely on
  // what tools we handed the model.
  if (!canUseTool(name, role, sections)) {
    return { error: `Tool "${name}" isn't available to this user — the section it needs hasn't been granted.` };
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

    case "search_past_conversations": {
      // RLS on ernie_messages/ernie_conversations already scopes both
      // tables to this signed-in user's own rows, so there's no separate
      // user-id filter to apply here — a Basic user searching their own
      // history can never see another user's conversations, same as an
      // admin can never see another admin's.
      const query = (input.query as string | undefined)?.trim();
      let messagesQuery = supabase
        .from("ernie_messages")
        .select("conversation_id, role, content, created_at")
        .order("created_at", { ascending: false })
        .limit(60);
      if (currentConversationId) {
        messagesQuery = messagesQuery.neq("conversation_id", currentConversationId);
      }
      if (query) {
        messagesQuery = messagesQuery.ilike("content", `%${query}%`);
      }
      const { data: messages, error } = await messagesQuery;
      if (error) throw error;

      if (!messages || messages.length === 0) {
        return {
          results: [],
          note: query
            ? `No past messages matched "${query}".`
            : "No past conversations found.",
        };
      }

      const conversationIds = Array.from(new Set(messages.map((m) => m.conversation_id)));
      const { data: conversations, error: convErr } = await supabase
        .from("ernie_conversations")
        .select("id, title, updated_at")
        .in("id", conversationIds);
      if (convErr) throw convErr;
      const conversationsById = indexBy(conversations ?? [], "id");

      return messages.map((m) => ({
        conversation_title: conversationsById.get(m.conversation_id)?.title ?? "Untitled conversation",
        conversation_last_updated: conversationsById.get(m.conversation_id)?.updated_at ?? null,
        role: m.role,
        message: m.content,
        said_at: m.created_at,
      }));
    }

    case "run_read_only_query": {
      // All the real safety enforcement lives in the ernie_readonly_query
      // Postgres function itself (sql/ernie_readonly_query.sql) — it runs
      // `security invoker`, so this executes as the actual signed-in
      // user and is bound by the same RLS policies as everything else in
      // the app, plus its own statement-shape checks, the profiles
      // carve-out, schema blocks, row cap, and timeout. This case is just
      // the thin call-through.
      const query = (input.query as string | undefined)?.trim();
      if (!query) return { error: "No query provided." };
      const { data, error } = await supabase.rpc("ernie_readonly_query", { query_text: query });
      if (error) throw error;
      return data;
    }

    case "list_uploaded_files": {
      // RLS on ernie_files already scopes this to the signed-in user's own
      // files, same pattern as search_past_conversations above.
      const { data, error } = await supabase
        .from("ernie_files")
        .select("id, file_name, mime_type, size_bytes, direction, created_at")
        .order("created_at", { ascending: false })
        .limit(50);
      if (error) throw error;
      return data;
    }

    case "read_uploaded_file": {
      const fileId = input.file_id as string | undefined;
      if (!fileId) return { error: "No file_id provided." };
      const { data: file, error } = await supabase
        .from("ernie_files")
        .select("id, file_name, mime_type, size_bytes, storage_path")
        .eq("id", fileId)
        .maybeSingle();
      if (error) throw error;
      if (!file) {
        return { error: "No file found with that id (it may not exist, or belong to someone else)." };
      }
      // __contentBlocks is a signal to app/api/ernie/chat/route.ts to pass
      // this straight through as the tool_result's content array (which can
      // include an image block) instead of JSON-stringifying it into inert
      // text — every other tool's result goes through the normal
      // stringified path untouched.
      const blocks = await buildFileContentBlocks(supabase, file, { forToolResult: true });
      return { __contentBlocks: blocks };
    }

    case "edit_spreadsheet": {
      const fileId = input.file_id as string | undefined;
      const edits = input.edits as SpreadsheetEditInput[] | undefined;
      if (!fileId) return { error: "No file_id provided." };
      if (!edits || !edits.length) return { error: "No edits provided." };

      const { data: file, error } = await supabase
        .from("ernie_files")
        .select("id, file_name, mime_type, size_bytes, storage_path")
        .eq("id", fileId)
        .maybeSingle();
      if (error) throw error;
      if (!file) {
        return { error: "No file found with that id (it may not exist, or belong to someone else)." };
      }

      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) return { error: "Not signed in." };

      try {
        const outputFileName = input.output_file_name as string | undefined;
        return await applySpreadsheetEdits(supabase, user.id, file, edits, outputFileName);
      } catch (err) {
        return { error: err instanceof Error ? err.message : "Couldn't edit that file." };
      }
    }

    case "get_file_for_download": {
      // Deliberately NOT in ADMIN_ONLY_TOOL_NAMES — access is enforced by
      // the target bucket's own RLS at fetch time (see
      // fetchExternalFileForDownload in lib/ernie/files.ts), not by
      // whether this tool is on offer, so it inherits whatever the real
      // access rule is for THIS signed-in user without any special-casing
      // here.
      const bucket = typeof input.bucket === "string" ? input.bucket.trim() : "";
      const path = typeof input.path === "string" ? input.path.trim() : "";
      if (!bucket || !path) return { error: "Both bucket and path are required." };

      const {
        data: { user: currentUser },
      } = await supabase.auth.getUser();
      if (!currentUser) return { error: "Not signed in." };

      try {
        const fileName = typeof input.file_name === "string" ? input.file_name : undefined;
        return await fetchExternalFileForDownload(supabase, currentUser.id, bucket, path, fileName);
      } catch (err) {
        return { error: err instanceof Error ? err.message : "Couldn't fetch that file." };
      }
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
const TOOL_SECTION_DESCRIPTIONS: [AnySectionKey[], string][] = [
  [["distributor_inventory", "build_orders"], "distributor-reported inventory"],
  [["build_orders"], "Build Orders"],
  [["purchase_orders"], "purchase orders"],
  [["events_calendar"], "the Events Calendar"],
  [
    ["price_list", "margin_analysis", "cost_per_case", "contribution_margin"],
    "Sales/pricing data",
  ],
  [["pos_labels"], "POS label files"],
];

export function buildErnieSystemPrompt(role: Role | undefined, sections: AnySectionKey[]): string {
  const dataAccessParagraph =
    role === "admin"
      ? `You can read data — inventory, allocations, distributors, distributor-reported inventory, Build Orders, the Events Calendar, purchase orders, Sales/pricing data, POS label files, and the app's user list — via the tools available to you, plus a general-purpose read-only database query tool (run_read_only_query) for anything the specific tools don't already cover. You have NO ability to write, edit, or delete anything in the app; if someone asks you to change something, tell them you're read-only and that they'll need to make that change on the relevant page themselves.`
      : (() => {
          const granted = TOOL_SECTION_DESCRIPTIONS.filter(([keys]) =>
            hasAnySection(role, sections, keys),
          ).map(([, label]) => label);
          const withheld = TOOL_SECTION_DESCRIPTIONS.filter(
            ([keys]) => !hasAnySection(role, sections, keys),
          ).map(([, label]) => label);

          const grantedSentence = granted.length
            ? ` You also have access to: ${granted.join(", ")} — same as this user can already see elsewhere in the app.`
            : "";
          const withheldAll = [...withheld, "the list of app users"];
          const withheldSentence = ` You do NOT have access to: ${withheldAll.join(", ")} — those aren't areas of the app this user has been granted (the user list is admin-only regardless), and a query touching them will simply come back empty rather than erroring, no matter how it's phrased. If someone asks about any of those, say plainly that you don't have access to that and they should check with an admin, rather than guessing or refusing to engage.`;

          return `You can read inventory and allocations data — on-hand/unlabeled/to-be-packaged/remaining quantities, per-distributor allocations, PO numbers and status, and distributor pricing (so order value can be computed) — and the distributor list, via the tools available to you. This is the same data this user can already see on the app's Inventory & Allocation page.${grantedSentence} You also have a general-purpose read-only database query tool (run_read_only_query) for anything the specific tools don't already cover — it runs with this same user's own database permissions, so it naturally reaches only the same data they already have access to elsewhere, never more.${withheldSentence} You have NO ability to write, edit, or delete anything in the app; if someone asks you to change something, tell them you're read-only and that they'll need to make that change on the relevant page themselves.`;
        })();

  return `You are Ernie, an internal AI assistant built into FCB Data (Full Circle Brewing Co.'s inventory/allocations/operations app), available to every signed-in user.

${dataAccessParagraph}

When someone's message isn't actually a question or request — a stray "test", "check", "hi", or similar — just respond briefly and naturally, the way a person would. Don't recite your list of capabilities every time; said the same way twice it starts to sound like a canned script. Only describe what you can help with when it's genuinely useful in the moment — e.g. the very first message of a brand-new conversation, or someone seems unsure what to ask — and vary the wording rather than reusing the same phrasing each time.

You are NOT limited to app-data questions — answer general knowledge, how-to, math, and any other question the way any capable assistant would, using your own knowledge. Only reach for the app-data tools when the question is actually about FCB Data's own data; don't mention those tools or their limits when a question has nothing to do with the app.

You also have live web search. Use it for anything that could have changed since your training — current events, today's prices, who currently holds some role, etc. — rather than guessing from memory. Don't mention that it's a "tool" or how it works; just search and answer.

You also have a tool to search this same signed-in user's own past Ernie conversations (never anyone else's) — reach for it whenever someone refers to something discussed earlier, asks you to recall a previous conversation, or a question seems to depend on context from before this chat. Don't assume you have no memory of anything outside the current conversation; check past conversations first if there's any chance the answer is there.

On the Inventory & Allocation tools: each product (at the whole-inventory level) and each distributor's allocation of that product carries a status_flag — one of good_confirmed (on hand, confirmed), dont_have, have_some, need_to_package, need_pakteks, need_labels, need_cans, or need_kegs. This is the direct, already-tracked answer to "what does distributor X's order still need" or "what needs to be packaged for X" — filter that distributor's allocations by status_flag rather than trying to infer a shortfall yourself from on-hand/remaining numbers, and say plainly if nothing is currently flagged that way rather than treating an empty result as a failure to answer.

You also have run_read_only_query, a general-purpose tool that runs any read-only SQL SELECT against the app's own database — reach for it whenever a question isn't already covered by one of the specific tools above (for example: "do we have enough cans and lids on hand to cover this week's whole 16oz can order across every distributor", or any other cross-table or aggregate question) rather than guessing, refusing, or claiming you have no way to find out. Its own description lists the real table and column names to use, and two existing database functions (classify_product_packaging, packaging_consumed_for_week) that already implement the same packaging bill-of-materials math the Inventory page itself uses — call those instead of re-deriving the recipe from scratch. If a query comes back with zero rows for something that plausibly exists, that most often means this account doesn't have permission to see that data (see above), not that the data doesn't exist — say so rather than concluding there's nothing there. If a query is rejected outright (a database error message about what's not allowed), rewrite it as a single plain read-only SELECT and try again before giving up.

Anyone can attach files to a message (drag-and-drop onto the chat, or the attach button) — a freshly-attached file's contents are included automatically, with no tool call needed. Images, PDFs, spreadsheets (.xlsx), CSV, and plain text files are all read directly; any other file type can still be uploaded but you can't read its contents yet, so say that plainly rather than guessing what's in it. If someone refers to a file from earlier without re-attaching it, use list_uploaded_files to find it and read_uploaded_file to pull its contents back up (this works for everything except PDFs — ask for a PDF to be re-attached instead). For spreadsheets and CSV specifically, you can also edit them with edit_spreadsheet: read the file first so you know its real sheet names and current cell values, then give it the exact cells to change — it edits that file in place (preserving everything else: formatting, other sheets, formulas) and hands back a new file to download. Never claim you've edited or analyzed a file without actually having its contents in front of you.

You can also pull up and hand over files that already exist elsewhere in the app — not just files someone uploaded directly to you. If a question is really "get me this file" (e.g. POS materials for a brand, an event's attached files) rather than "look up this data," use run_read_only_query to find the matching row(s) in whatever table holds that library (see the schema notes on run_read_only_query for which tables have files and what bucket each uses), then call get_file_for_download with that row's bucket and storage_path to actually hand it over as a download — don't just describe that the file exists. Whether that succeeds depends on your own access to that file, exactly like every other data lookup; an error back from it means access is restricted for this account, not that something is broken.

Be direct and brief. Answer exactly what was asked — a specific question gets a specific, short answer, not a full data dump of everything related to it. Only include extra context (other SKUs, other distributors, caveats, etc.) if it's clearly relevant to what they're trying to find out, or if they asked for a fuller breakdown. When asked a question, use the tools to pull real current data rather than guessing. Cite specific numbers/names from the tool results. If a question is ambiguous about which week it refers to, use the current open week by default and say which week you used. If you genuinely can't find an answer after checking, say so plainly and suggest what to try instead — don't go quiet.

This chat only displays plain text — never use markdown formatting. No **bold**, no tables, no headers, no bullet/numbered lists, no backticks. Write in plain conversational sentences, the way you'd answer someone out loud. If you're listing a few items, just write them into a sentence (e.g. "Big Daddy IPA has 12 cases on hand; Mystic Haze, Prohibition, and Peachy Vibes are all at zero.") instead of a table or list.

Never mention Claude, Anthropic, or any underlying model/vendor — you are Ernie, full stop.`;
}
