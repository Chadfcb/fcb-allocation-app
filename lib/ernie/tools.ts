// Read-only data tools for Ernie (the in-app AI assistant, see
// app/api/ernie/chat/route.ts). Nothing here writes to the app's own
// database (allocations, inventory, pricing, etc.) except the calendar
// (Social Media / Events / Chain) add/update/delete tools and create_task/
// update_task (all added 2026-09-11 — see their definitions below;
// update_task followed later the same day after Chad asked for a way to
// edit a task Ernie already created, e.g. adding notes) — a
// deliberate, narrowly-scoped exception covering exactly those tables,
// added after Chad asked for Ernie to be able to actually enter what it
// drafts (a content plan, a task) onto the real calendar/Tasks section
// instead of only describing it. Every one of those tools follows a
// mandatory propose-then-confirm flow (see the comment right above
// add_social_media_calendar_event's definition, and createPendingAction/
// loadConfirmedPendingAction further down) so nothing is ever written
// until the user has actually seen a summary and approved it in their own
// next message — and every executed write is logged (via logChange or
// task_item_activity, matching each page's own UI) so a bad entry can be
// one-click undone exactly like a person's mistake. edit_spreadsheet is
// the other pre-existing exception to "Ernie never changes anything," but
// a narrower one still — it edits a FILE the user themselves uploaded (not
// app data) and hands back a new version, same as if they'd edited it in
// Excel and saved a copy.
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
  createSpreadsheetFromSheets,
  stageFileForQuery,
  clearStagedFileData,
  fetchUrlAsFile,
  type SpreadsheetEditInput,
  type SpreadsheetSheetInput,
} from "@/lib/ernie/files";
import { listRepoPath, readRepoFile } from "@/lib/github";
import { isBlockedPath, canAccessRepoPath } from "@/lib/ernie/fileAccessMap";
import { logChange } from "@/lib/audit";

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
    name: "get_cashflow_dashboard",
    description:
      "Finance > Cash Flow Dashboard data: Realized Revenue (Order Value for every distributor marked Delivered, by week and in total), Vendor PO Spend (purchase_orders.total_cost split into pending vs. paid), and the resulting net position. Planned Batch Expenses aren't tracked yet (no Brew Planner exists) — say so plainly if asked, rather than treating the net figure as a complete picture.",
    input_schema: {
      type: "object" as const,
      properties: {},
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
    name: "export_pricing_data_as_spreadsheet",
    description:
      `Build a real, downloadable .xlsx spreadsheet from live Sales section data (Price List, Margin Analysis, Cost Per Case, or Contribution Margin) — for when someone wants that page's numbers AS A FILE, not just reported in chat (get_pricing_data is for the latter). Optionally excludes labor cost from the underlying math first (set exclude_labor_cost: true) — this only changes numbers that are computed FROM labor cost (Margin Analysis's batch profit/margin, Cost Per Case's labor-cost-per-case column, Contribution Margin's cost/CM/margin per case-equivalent); it has no effect on Price List, which never involves labor. After it succeeds, tell the user plainly what's in the file (which section, whether labor was excluded) and that it's ready to download.`,
    input_schema: {
      type: "object" as const,
      properties: {
        section: {
          type: "string",
          enum: ["price_list", "margin_analysis", "cost_per_case", "contribution_margin"],
        },
        exclude_labor_cost: {
          type: "boolean",
          description: "If true, recompute with labor cost treated as $0 before building the file. Default false.",
        },
        output_file_name: {
          type: "string",
          description: 'File name for the new spreadsheet, e.g. "Contribution Margin.xlsx". Omit for a sensible default.',
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
- ernie_reference_documents(id, file_name, storage_path, description, mime_type, size_bytes, added_by, created_at) — reference material Chad/Claude have deliberately put somewhere you can see it (specs, decisions, context about the app itself, not app data) — not gated to admin; bucket is "reference-docs". A NULL storage_path means this is a text-only note with no uploaded file — the answer is just the description column itself, don't try to call get_file_for_download on it. Check this table whenever a question needs background beyond the live data tables cover, not just when someone names a specific file.
- ernie_projects(id, name, description, created_by, created_at, active) / ernie_project_access(project_id, user_id, granted_at, granted_by) / ernie_project_files(id, project_id, file_name, storage_path, description, mime_type, size_bytes, added_by, created_at) — Ernie Projects (added 2026-09-10): named containers a user may have been granted access to, each with its own file library. RLS already limits every one of these three tables to Projects THIS signed-in user actually has access to (or none, for someone with no grants) — an empty result is the real, current access picture, not a bug. When the current conversation belongs to a Project, its name/description/id are given to you directly in this system prompt, along with the exact filtered query to use against ernie_project_files — bucket for its files is "ernie-project-files".
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

- ernie_staged_rows(id, user_id, file_id, sheet_name, row_index, data jsonb) — scratch rows loaded from an uploaded/produced spreadsheet or CSV via stage_uploaded_file_for_query (call that FIRST; this table starts out empty for every file). Always filter by file_id. Each row's real columns live inside the jsonb "data" field, named exactly as that file's header row — read one with data->>'ColumnName' (text) and cast numeric ones, e.g. (data->>'Quantity')::numeric, before summing/averaging/comparing. This is how you do real bulk arithmetic (filter, group, weighted-average) on a file someone hands you, joined or compared against any other table above in the same query if needed.

Two Postgres functions already implement the exact packaging/label bill-of-materials math the Inventory & Allocation page uses — call them from SQL rather than re-deriving the recipe yourself: classify_product_packaging(product_name text) returns one of can_19_2oz/can_16oz/can_12oz/keg_1_2bbl/keg_1_6bbl/tap_handle/unrecognized; packaging_consumed_for_week(week_id uuid) returns a table(item_key, consumed) of total packaging consumed by that week's allocations (every distributor combined — join allocations yourself, filtered by distributor_id, if you need one distributor's share instead).

Any table above with a storage_path column (event_materials, pos_library, pos_label_files, ernie_reference_documents, ernie_project_files today — there may be more as the app grows) is describing a real file, not just data. Querying one of those only tells you the file EXISTS — to actually hand it to the user as a download, call get_file_for_download with that row's storage_path and its bucket (event-materials for event_materials/pos_library, pos-label-files for pos_label_files, reference-docs for ernie_reference_documents, ernie-project-files for ernie_project_files). Whenever someone asks you to pull up, send them, or let them download a specific file — not just tell them about it — that's the tool to reach for.`,
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
      "Read the contents of a previously-uploaded (or previously Ernie-produced) file again, by file_id — for when someone refers to a file from earlier in this or a past conversation without re-attaching it, OR a file get_file_for_download just fetched from elsewhere in the app (e.g. an Ernie Project's file library) — call this right after with the same file_id to actually read it, not just hand over a download link. Spreadsheets (.xlsx), CSV, Word documents (.docx), plain text, images, and PDFs all work.",
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
      `Fetch a file that already exists somewhere else in the app — found via run_read_only_query against a table with a storage_path column (event_materials, pos_library, pos_label_files, ernie_reference_documents, ernie_project_files today) — and hand it to the user as a real downloadable attachment in this chat, instead of just describing that it exists. Pass the exact bucket and storage_path from that row.

This only creates the download chip — it does NOT read the file's content for you. If the user (or the task) needs to know what's actually IN the file — a Project's spreadsheet, PDF, or Word doc, not just a link to it — call read_uploaded_file with the same file_id right after this succeeds; skipping that step and only describing the download chip is not the same as having read it.

Whether this succeeds depends entirely on whether YOU (the signed-in user asking) actually have access to that file, same as everywhere else in the app — an error back from this tool means access is restricted, not that anything is broken, so explain it that way rather than guessing at a bug. Use this any time someone asks you to pull up, send, analyze, or let them download a specific file.`,
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
  {
    name: "fetch_url_as_file",
    description:
      `Download whatever's at a URL — an image, a spreadsheet, a CSV, or any other file someone links to — and add it to your uploaded-files list, exactly as if the user had attached it directly. Reach for this specifically when a URL points at a FILE rather than a normal web page (your web_fetch tool already reads ordinary pages and PDFs — this is for the file types that doesn't cover). This is a plain, read-only download: nothing is submitted, no login/session/credentials are used or sent, and nothing on the far end is ever changed. After it succeeds, the file works exactly like any other uploaded file — read_uploaded_file, stage_uploaded_file_for_query, and edit_spreadsheet all work on it by its file_id. Capped at the same 20MB size limit as a direct upload.`,
    input_schema: {
      type: "object" as const,
      properties: {
        url: { type: "string", description: "The direct URL to the file." },
        file_name: {
          type: "string",
          description: "Optional file name to save it as. Omit to derive one from the URL or response headers.",
        },
      },
      required: ["url"],
    },
  },
  {
    name: "stage_uploaded_file_for_query",
    description:
      `Load EVERY row of an uploaded (or Ernie-produced) spreadsheet/CSV into a temporary, query-able table so you can run real SQL aggregation on it with run_read_only_query — SUM, GROUP BY, weighted averages, filters, joins against the app's own data, whatever the question needs. Reach for this whenever someone wants an actual calculation across a file with more than a couple hundred rows (a units-sold export, a distributor spreadsheet, anything to "crunch the numbers on") — read_uploaded_file only shows you a rendered preview capped at 300 rows, and you cannot reliably hand-sum thousands of rows by reading them as text, the same way a person couldn't either.

After this succeeds, query the ernie_staged_rows table with run_read_only_query, filtered to this file's file_id. Each staged row's fields live in a jsonb "data" column — read a field with data->>'ColumnName' (returns text) and cast numeric ones before summing/averaging/comparing, e.g.: select data->>'Brand' as brand, sum((data->>'Quantity')::numeric) from ernie_staged_rows where file_id = '<file_id>' group by 1 order by 2 desc. The exact column names available come back in this tool's response — use those exactly (they match the file's header row).

Only spreadsheets/CSVs can be staged (not images or PDFs), capped at 20,000 data rows per file — if a file is bigger than that, say so and ask whether a filtered export would work instead. Re-staging the same file replaces its previously-staged rows rather than duplicating them, so it's safe to call again after the user re-attaches an updated version.`,
    input_schema: {
      type: "object" as const,
      properties: {
        file_id: {
          type: "string",
          description: "The spreadsheet or CSV file's id to stage (from list_uploaded_files, or from earlier in this conversation).",
        },
        sheet: {
          type: "string",
          description: "Exact sheet name to stage (.xlsx only). Omit to use the file's first sheet. Ignored for CSV.",
        },
      },
      required: ["file_id"],
    },
  },
  {
    name: "clear_staged_file_data",
    description:
      "Remove a file's previously-staged rows from ernie_staged_rows (see stage_uploaded_file_for_query) once you're done querying it. Not required — re-staging the same file already replaces its old rows — but good tidiness to call once an analysis is finished, especially for a large file.",
    input_schema: {
      type: "object" as const,
      properties: {
        file_id: { type: "string", description: "The file_id whose staged rows should be removed." },
      },
      required: ["file_id"],
    },
  },
  {
    name: "list_app_files",
    description:
      `List the real, current files and folders in this app's own codebase (the same repo "git push" deploys from), read live from GitHub — not a snapshot, not a note anyone wrote down. Use this to browse the folder structure and find the exact path of the file you actually want, then call read_app_file on it. Listing a folder's names is always allowed for any signed-in user with Ernie access — it's read_app_file (actual file CONTENT) that's restricted to the areas this account has access to elsewhere in the app; a name showing up in a listing here doesn't mean read_app_file will let you read it.`,
    input_schema: {
      type: "object" as const,
      properties: {
        path: {
          type: "string",
          description: 'Repo-relative folder path, e.g. "lib" or "app/(app)/sales/contribution-margin". Omit for the repo root.',
        },
      },
    },
  },
  {
    name: "read_app_file",
    description:
      `Read a specific file's real, current content directly from this app's own GitHub repo — the actual source code/SQL, not a description of it. Use list_app_files first if you don't already know the exact path. This is how you answer "what does the code actually do/say" questions precisely — reading a fixed constant, a formula, a comment explaining a quirk, an RLS policy — instead of guessing or relying on a pre-written note.

Access mirrors this account's real permissions elsewhere in the app: a file under a page/section this account has been granted works; core security/permission/Ernie-internals code and anything that could hold a secret (.env files, etc.) is refused regardless of role, except an admin account can read any non-secret file. A refusal means access is restricted for this account (or the path genuinely holds something off-limits, like a .env file) — say so plainly rather than guessing at the content. Files over 300KB are refused too big to read in one call — ask about a more specific path instead.`,
    input_schema: {
      type: "object" as const,
      properties: {
        path: {
          type: "string",
          description: 'Exact repo-relative file path, e.g. "lib/contributionMargin.ts". From list_app_files or from earlier in this conversation.',
        },
      },
      required: ["path"],
    },
  },
  // ── Ernie's write abilities (added 2026-09-11, extended same day) ──────
  // Every mutating tool below (add/update/delete on any of the three
  // calendars, create_task) follows the same two-step propose-then-confirm
  // pattern, per Chad: Ernie must ask whatever questions it needs, then
  // summarize exactly what it's about to do, and only actually do it once
  // the user approves in their OWN NEXT MESSAGE — never in the same turn
  // it proposed it. That's not just a prompting request here: calling one
  // of these WITHOUT confirmed validates the input, resolves any names to
  // real ids, stores the exact resulting write in a new
  // ernie_pending_actions row, and returns a preview + that row's id —
  // nothing is written to the real table yet.
  //
  // The actual write is performed by calling confirm_pending_action with
  // NO arguments (see its own definition below) — it looks up and executes
  // THIS SAME USER's own most recently proposed, still-pending action.
  // Earlier (2026-09-11) this instead told the model to call the original
  // tool again with confirmed:true and the exact pending_action_id from
  // the preview call, repeated verbatim — that turned out to be a real bug
  // in production, not just an awkward API: only the FINAL TEXT of a
  // model's turn is ever persisted across HTTP requests (see
  // app/api/ernie/chat/route.ts) — the actual tool_use/tool_result content
  // blocks that carried the pending_action_id are not reloaded on the next
  // turn. So the model had no real way to recall that id once the user
  // replied "confirm" in a new message, and every observed attempt just
  // silently re-proposed the same action from scratch instead of
  // confirming it — nothing ever actually got written, even after several
  // rounds of the user saying "confirm"/"execute". confirm_pending_action
  // with no arguments removes that dependency entirely: the server, not
  // the model's memory, finds "the most recent pending row this user
  // hasn't confirmed yet." The confirmed:true + pending_action_id path on
  // the tools below still exists (loadConfirmedPendingAction still enforces
  // the same request_id check either way) but is no longer how a normal
  // confirmation should happen — confirm_pending_action with no arguments
  // is the one true path, since it only succeeds if the pending row was
  // created in a genuinely earlier HTTP request (a separate user chat
  // message) than this one — enforced in loadConfirmedPendingAction below
  // by comparing request_id, so a propose+confirm pair can never both
  // happen inside one tool-use loop no matter what the model decides to
  // do. See sql/ernie_pending_actions.sql for the full writeup. Every
  // executed write is also logged to audit_log via logChange (or
  // task_item_activity for a task), the same trail a person's own edit
  // goes through, so a bad entry is one click to undo.
  {
    name: "add_social_media_calendar_event",
    description:
      "Propose a new Social Media Calendar (/social-media-calendar) event. Leave confirmed out — this validates everything and returns a preview, but writes nothing yet. Present that preview to the user in your own words and ask them to confirm. Only after they approve in a NEW message, call confirm_pending_action (no arguments) to actually create it — do NOT try to recall a pending_action_id and call this tool again; that id is not reliably available to you after this turn ends. Only start_date and title are required; leave anything else out if it wasn't specified rather than inventing a value.",
    input_schema: {
      type: "object" as const,
      properties: {
        title: { type: "string", description: "Event title, e.g. \"IG Post: Monday culture/brand post\"." },
        start_date: { type: "string", description: "yyyy-mm-dd." },
        end_date: { type: "string", description: "yyyy-mm-dd, only for a multi-day event. Omit otherwise." },
        time_label: { type: "string", description: "Free-text time, e.g. \"11am-12pm\". Omit if not specified." },
        type: {
          type: "string",
          enum: ["post", "campaign", "story", "promotion", "other"],
          description: "Defaults to \"post\" if omitted.",
        },
        location: { type: "string", description: "Location/venue, if relevant. Omit otherwise." },
        rep: { type: "string", description: "Rep/staff name, if relevant. Omit otherwise." },
        color: { type: "string", description: "Hex color for the calendar chip, e.g. \"#d99a3d\". Omit to use the calendar's default." },
        notes: { type: "string", description: "Any additional notes." },
        confirmed: { type: "boolean", description: "Leave this out. To actually write the proposed event after the user approves, call confirm_pending_action instead — do not set confirmed:true here." },
        pending_action_id: { type: "string", description: "Leave this out — call confirm_pending_action (no arguments) instead once the user approves." },
      },
      required: ["title", "start_date"],
    },
  },
  {
    name: "update_social_media_calendar_event",
    description:
      "Propose a change to an existing Social Media Calendar event. Look the event up first (run_read_only_query against social_media_events, or list_social_media_calendar_events) to get its id — especially if the user only described it (\"the Friday post about the tasting\") rather than giving you an id directly. Same propose-then-confirm flow as add_social_media_calendar_event: leave confirmed out to get a preview, present it, then call confirm_pending_action (no arguments) once the user approves in a new message. Only pass the fields that are actually changing; anything omitted stays as-is.",
    input_schema: {
      type: "object" as const,
      properties: {
        id: { type: "string", description: "The event's id." },
        title: { type: "string" },
        start_date: { type: "string", description: "yyyy-mm-dd." },
        end_date: { type: "string", description: "yyyy-mm-dd, or an empty string to clear it." },
        time_label: { type: "string" },
        type: { type: "string", enum: ["post", "campaign", "story", "promotion", "other"] },
        location: { type: "string" },
        rep: { type: "string" },
        color: { type: "string" },
        notes: { type: "string" },
        confirmed: { type: "boolean" },
        pending_action_id: { type: "string" },
      },
      required: ["id"],
    },
  },
  {
    name: "delete_social_media_calendar_event",
    description:
      "Propose permanently removing an event from the Social Media Calendar. This is destructive — confirm with whoever's asking which specific event they mean (by title and date) before even proposing it. Same propose-then-confirm flow: leave confirmed out to get a preview, then call confirm_pending_action (no arguments) once the user approves in a new message.",
    input_schema: {
      type: "object" as const,
      properties: {
        id: { type: "string", description: "The event's id — look it up first if you don't already have it." },
        confirmed: { type: "boolean" },
        pending_action_id: { type: "string" },
      },
      required: ["id"],
    },
  },
  {
    name: "list_social_media_calendar_events",
    description:
      "List Social Media Calendar entries, optionally filtered by date range — a dedicated shortcut for this one table so you don't have to reach for run_read_only_query for the common case of \"what's already on the calendar this week/month.\"",
    input_schema: {
      type: "object" as const,
      properties: {
        start_date: { type: "string", description: "yyyy-mm-dd, inclusive lower bound on start_date." },
        end_date: { type: "string", description: "yyyy-mm-dd, inclusive upper bound on start_date." },
      },
    },
  },
  {
    name: "add_events_calendar_event",
    description:
      "Propose a new Events Calendar (/events) entry — festivals, tastings, donations, work-withs, or other. Same propose-then-confirm flow as add_social_media_calendar_event: leave confirmed out for a preview, present it, then call confirm_pending_action (no arguments) once approved in a new message. Only start_date and title are required.",
    input_schema: {
      type: "object" as const,
      properties: {
        title: { type: "string" },
        start_date: { type: "string", description: "yyyy-mm-dd." },
        end_date: { type: "string", description: "yyyy-mm-dd, only for a multi-day event. Omit otherwise." },
        time_label: { type: "string", description: "Free-text time. Omit if not specified." },
        type: {
          type: "string",
          enum: ["festival", "tasting", "donation", "work-with", "other"],
          description: "Defaults to \"other\" if omitted.",
        },
        location: { type: "string" },
        distributor_name: { type: "string", description: "Ties this event to a distributor, if relevant (partial name match). Omit otherwise." },
        rep: { type: "string" },
        notes: { type: "string" },
        confirmed: { type: "boolean" },
        pending_action_id: { type: "string" },
      },
      required: ["title", "start_date"],
    },
  },
  {
    name: "update_events_calendar_event",
    description:
      "Propose a change to an existing Events Calendar entry. Look it up first (get_events, or run_read_only_query against events) to get its id. Same propose-then-confirm flow as the other update tools — leave confirmed out for a preview, then confirm_pending_action (no arguments) once approved in a new message. Only pass fields that are changing.",
    input_schema: {
      type: "object" as const,
      properties: {
        id: { type: "string" },
        title: { type: "string" },
        start_date: { type: "string", description: "yyyy-mm-dd." },
        end_date: { type: "string", description: "yyyy-mm-dd, or an empty string to clear it." },
        time_label: { type: "string" },
        type: { type: "string", enum: ["festival", "tasting", "donation", "work-with", "other"] },
        location: { type: "string" },
        distributor_name: { type: "string", description: "Pass an empty string to clear the distributor link." },
        rep: { type: "string" },
        notes: { type: "string" },
        confirmed: { type: "boolean" },
        pending_action_id: { type: "string" },
      },
      required: ["id"],
    },
  },
  {
    name: "delete_events_calendar_event",
    description:
      "Propose permanently removing an Events Calendar entry. Destructive — confirm which specific one is meant before proposing it. Same propose-then-confirm flow — leave confirmed out for a preview, then confirm_pending_action (no arguments) once approved in a new message.",
    input_schema: {
      type: "object" as const,
      properties: {
        id: { type: "string" },
        confirmed: { type: "boolean" },
        pending_action_id: { type: "string" },
      },
      required: ["id"],
    },
  },
  {
    name: "add_chain_calendar_event",
    description:
      "Propose a new Chain Calendar (/chain-calendar) entry — demo, reset, ad, display, or other. Same propose-then-confirm flow as add_social_media_calendar_event — leave confirmed out for a preview, then confirm_pending_action (no arguments) once approved in a new message. Only start_date and title are required.",
    input_schema: {
      type: "object" as const,
      properties: {
        title: { type: "string" },
        start_date: { type: "string", description: "yyyy-mm-dd." },
        end_date: { type: "string", description: "yyyy-mm-dd, only for a multi-day event. Omit otherwise." },
        time_label: { type: "string" },
        type: {
          type: "string",
          enum: ["demo", "reset", "ad", "display", "other"],
          description: "Defaults to \"other\" if omitted.",
        },
        location: { type: "string" },
        rep: { type: "string" },
        color: { type: "string" },
        notes: { type: "string" },
        confirmed: { type: "boolean" },
        pending_action_id: { type: "string" },
      },
      required: ["title", "start_date"],
    },
  },
  {
    name: "update_chain_calendar_event",
    description:
      "Propose a change to an existing Chain Calendar entry. Look it up first (list_chain_calendar_events, or run_read_only_query against chain_events). Same propose-then-confirm flow — leave confirmed out for a preview, then confirm_pending_action (no arguments) once approved in a new message. Only pass fields that are changing.",
    input_schema: {
      type: "object" as const,
      properties: {
        id: { type: "string" },
        title: { type: "string" },
        start_date: { type: "string", description: "yyyy-mm-dd." },
        end_date: { type: "string", description: "yyyy-mm-dd, or an empty string to clear it." },
        time_label: { type: "string" },
        type: { type: "string", enum: ["demo", "reset", "ad", "display", "other"] },
        location: { type: "string" },
        rep: { type: "string" },
        color: { type: "string" },
        notes: { type: "string" },
        confirmed: { type: "boolean" },
        pending_action_id: { type: "string" },
      },
      required: ["id"],
    },
  },
  {
    name: "delete_chain_calendar_event",
    description:
      "Propose permanently removing a Chain Calendar entry. Destructive — confirm which specific one is meant before proposing it. Same propose-then-confirm flow — leave confirmed out for a preview, then confirm_pending_action (no arguments) once approved in a new message.",
    input_schema: {
      type: "object" as const,
      properties: {
        id: { type: "string" },
        confirmed: { type: "boolean" },
        pending_action_id: { type: "string" },
      },
      required: ["id"],
    },
  },
  {
    name: "list_chain_calendar_events",
    description:
      "List Chain Calendar entries, optionally filtered by date range — a dedicated shortcut for this one table.",
    input_schema: {
      type: "object" as const,
      properties: {
        start_date: { type: "string", description: "yyyy-mm-dd, inclusive lower bound on start_date." },
        end_date: { type: "string", description: "yyyy-mm-dd, inclusive upper bound on start_date." },
      },
    },
  },
  {
    name: "create_task",
    description:
      "Propose a new task in the Tasks section (/tasks). Tasks live under Category → Subcategory, so first find the right subcategory_id (run_read_only_query against task_categories/task_subcategories, or ask the user which category this belongs under if it's not obvious) — don't guess one. Resolve any assignee to their profiles.id the same way (run_read_only_query against profiles) before calling this. Same propose-then-confirm flow as the calendar tools: leave confirmed out for a preview, present it, then call confirm_pending_action (no arguments) once approved in a new message.",
    input_schema: {
      type: "object" as const,
      properties: {
        subcategory_id: { type: "string", description: "The task_subcategories.id this task belongs under." },
        title: { type: "string" },
        notes: { type: "string" },
        due_date: { type: "string", description: "yyyy-mm-dd. Omit if there isn't one." },
        assignee_user_ids: {
          type: "array",
          items: { type: "string" },
          description: "profiles.id values for whoever should be assigned. Omit for an unassigned task.",
        },
        confirmed: { type: "boolean" },
        pending_action_id: { type: "string" },
      },
      required: ["subcategory_id", "title"],
    },
  },
  {
    name: "update_task",
    description:
      "Propose a change to an existing task in the Tasks section (/tasks) — rename it, edit its notes, set/clear its due date, mark it resolved/reopen it, and/or change who's assigned. Look the task up first (run_read_only_query against task_items) if you don't already have its id. Only pass the fields that are actually changing; anything omitted stays as-is — assignee_user_ids, if passed, REPLACES the full assignee list (pass every assignee who should remain, not just new ones; pass an empty array to unassign everyone). There is no delete-task tool — the app itself has no way to permanently delete a task, only mark it resolved, so offer that instead if someone asks to remove one. Same propose-then-confirm flow as the calendar tools: leave confirmed out for a preview, present it, then call confirm_pending_action (no arguments) once approved in a new message.",
    input_schema: {
      type: "object" as const,
      properties: {
        id: { type: "string", description: "The task_items.id to update." },
        title: { type: "string" },
        notes: { type: "string", description: "Empty string clears the notes." },
        due_date: { type: "string", description: "yyyy-mm-dd, or an empty string to clear it." },
        status: { type: "string", enum: ["open", "resolved"] },
        assignee_user_ids: {
          type: "array",
          items: { type: "string" },
          description: "profiles.id values — the COMPLETE new assignee list (replaces the existing one). Pass an empty array to unassign everyone.",
        },
        confirmed: { type: "boolean" },
        pending_action_id: { type: "string" },
      },
      required: ["id"],
    },
  },
  {
    name: "confirm_pending_action",
    description:
      "The second half of every propose-then-confirm write tool above — this is what actually PERFORMS a previously-proposed write. Only ever call this after: (1) you already called one of the add/update/delete/create_task tools without confirmed and showed the user a preview, and (2) the user approved it IN THEIR OWN NEXT MESSAGE — never in the same reply you proposed it in. Calling this before a real separate confirmation from the user is a policy violation, even if you're confident what they'd want. IMPORTANT: leave pending_action_id out — just call this tool with no arguments and it confirms YOUR own most recently proposed action for this same user automatically. Do NOT try to recall or re-type the id from a pending_action_id you were given earlier in the conversation — that value is not reliably available to you across turns, and guessing at it (or, worse, silently proposing the action all over again instead of calling this tool) is exactly the bug this note exists to prevent. Only pass pending_action_id explicitly in the rare case where the user is clearly confirming an OLDER proposal than the most recent one (e.g. they went back to approve something from several messages ago after proposing something newer in between).",
    input_schema: {
      type: "object" as const,
      properties: {
        pending_action_id: {
          type: "string",
          description:
            "Optional. Leave this out in the normal case — omitting it confirms your own most recent pending proposal for this user. Only set it if you have the exact id AND you need to confirm something other than the most recent proposal.",
        },
      },
      required: [],
    },
  },
  {
    name: "update_person_notes",
    description:
      `Update your running private notes on the person you're currently talking to — how they like you to communicate (tone, brevity, format), and durable work context about them that's come up naturally (their role, what they handle in the app, whether they're new to it, etc.). These notes are private to this one person: only they can ever see or edit them (not even an admin can), and you only ever read/write the CURRENT signed-in user's own notes — you have no way to see or affect anyone else's.

Your system prompt already shows you this person's current notes in full (or says there are none yet). When you learn something new or something changes, call this with the COMPLETE updated notes text — this REPLACES whatever was stored before, so include everything still worth keeping, not just what's new. Keep it short and factual (a few sentences, plain language, no more than roughly 500 words) — condense rather than letting it grow indefinitely. Only store communication style and work context; never store personal, sensitive, or health-related information, even if it's mentioned to you.

Call this proactively when it's clearly warranted (someone states a preference directly — "keep it brief", "don't use bullet points" — or a durable work fact comes up naturally) — don't ask permission first, and don't call it for every small thing or restate something already captured. If someone asks what you know about them, tell them in plain language rather than reciting the raw stored text.`,
    input_schema: {
      type: "object" as const,
      properties: {
        notes: {
          type: "string",
          description: "The complete, updated notes text for this person — replaces whatever was stored before. Plain language, communication style + relevant work context only.",
        },
      },
      required: ["notes"],
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
  "export_pricing_data_as_spreadsheet",
  "get_pos_label_files",
  "get_users",
  "get_cashflow_dashboard",
  "add_social_media_calendar_event",
  "update_social_media_calendar_event",
  "delete_social_media_calendar_event",
  "list_social_media_calendar_events",
  "add_events_calendar_event",
  "update_events_calendar_event",
  "delete_events_calendar_event",
  "add_chain_calendar_event",
  "update_chain_calendar_event",
  "delete_chain_calendar_event",
  "list_chain_calendar_events",
  "create_task",
  "update_task",
  "confirm_pending_action",
]);

// Which section(s) unlock each formerly-admin-only tool — mirrors the RLS
// grouping in sql/user_section_access.sql. get_pricing_data covers Sales
// broadly (it reuses the same calc functions all 4 Sales pages share), so
// having ANY one Sales section is enough to ask Ernie about pricing/margin
// data. get_users has no section — it stays hard admin-only, same as
// today, since there's no "list every user" capability anywhere else in
// the app for a Basic user to already have.
// get_cashflow_dashboard is keyed to cashflow_dashboard specifically — one
// of ADMIN_RESTRICTED_SECTIONS (see lib/permissions.ts), so hasAnySection
// below (with isSuperAdmin threaded through) is what actually keeps a
// Manager without a Finance grant from getting this tool, even though
// every other admin-only tool here stays automatic for them.
const TOOL_SECTIONS: Record<string, AnySectionKey[] | null> = {
  get_distributor_inventory: ["distributor_inventory", "build_orders"],
  get_build_orders: ["build_orders"],
  get_purchase_orders: ["purchase_orders"],
  get_events: ["events_calendar"],
  get_pricing_data: ["price_list", "margin_analysis", "cost_per_case", "contribution_margin"],
  export_pricing_data_as_spreadsheet: ["price_list", "margin_analysis", "cost_per_case", "contribution_margin"],
  get_pos_label_files: ["pos_labels"],
  get_users: null,
  get_cashflow_dashboard: ["cashflow_dashboard"],
  add_social_media_calendar_event: ["events_calendar"],
  update_social_media_calendar_event: ["events_calendar"],
  delete_social_media_calendar_event: ["events_calendar"],
  list_social_media_calendar_events: ["events_calendar"],
  add_events_calendar_event: ["events_calendar"],
  update_events_calendar_event: ["events_calendar"],
  delete_events_calendar_event: ["events_calendar"],
  add_chain_calendar_event: ["events_calendar"],
  update_chain_calendar_event: ["events_calendar"],
  delete_chain_calendar_event: ["events_calendar"],
  list_chain_calendar_events: ["events_calendar"],
  create_task: ["tasks"],
  update_task: ["tasks"],
  // Shared by every propose-then-confirm write tool above — visible to
  // anyone who has EITHER events_calendar or tasks, since it's the generic
  // "execute what I already proposed" step. The actual required section
  // for a given pending action is re-checked against that row's own
  // action_type inside loadConfirmedPendingAction — this tool-list gate is
  // just what makes the tool visible at all, same defense-in-depth pattern
  // canUseTool already applies everywhere else.
  confirm_pending_action: ["events_calendar", "tasks"],
};

function canUseTool(
  name: string,
  role: Role | undefined,
  sections: AnySectionKey[],
  isSuperAdmin: boolean,
) {
  if (!ADMIN_ONLY_TOOL_NAMES.has(name)) return true;
  const allowedSections = TOOL_SECTIONS[name];
  if (!allowedSections) return role === "admin";
  return hasAnySection(role, sections, allowedSections, isSuperAdmin);
}

// Section-aware tool list to hand to the Anthropic API — a Basic user
// never sees (and so can never ask Ernie to call) a tool backed by a
// section they haven't been granted, and (as of the Administrator/Manager/
// Employee tiering) neither does a Manager for a tool backed by one of
// ADMIN_RESTRICTED_SECTIONS unless separately granted it. Ernie itself is
// gated separately, one level up, by the "ernie_ai" section (see
// app/api/ernie/chat/route.ts) — this function assumes that check already
// passed.
export function getErnieTools(
  role: Role | undefined,
  sections: AnySectionKey[],
  isSuperAdmin = false,
) {
  return ERNIE_TOOLS.filter((tool) => canUseTool(tool.name, role, sections, isSuperAdmin));
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
  get_cashflow_dashboard: "Checking the Cash Flow Dashboard",
  get_events: "Checking the events calendar",
  get_pricing_data: "Checking Sales & pricing data",
  export_pricing_data_as_spreadsheet: "Building your spreadsheet",
  get_pos_label_files: "Checking label files",
  get_users: "Checking the user list",
  search_past_conversations: "Searching past conversations",
  run_read_only_query: "Running a custom data lookup",
  list_uploaded_files: "Checking your uploaded files",
  read_uploaded_file: "Reading your uploaded file",
  edit_spreadsheet: "Editing your spreadsheet",
  get_file_for_download: "Fetching that file",
  fetch_url_as_file: "Fetching that from the web",
  stage_uploaded_file_for_query: "Loading your file for analysis",
  clear_staged_file_data: "Cleaning up staged data",
  list_app_files: "Browsing the app's code",
  read_app_file: "Reading the app's code",
  update_person_notes: "Updating what I know about you",
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

// Shared by the "get_pricing_data" and "export_pricing_data_as_spreadsheet"
// tool cases below — added 2026-09-09 alongside the export tool so the two
// never compute these numbers two different ways. `excludeLabor` (only
// ever true from the export tool, never from get_pricing_data's normal
// read-only reporting) zeroes labor cost at the exact same three spots the
// live pages themselves would if labor were $0 — Margin Analysis's batch
// economics, Cost Per Case's labor-cost-per-case column, and Contribution
// Margin's per-case cost/CM/margin — rather than subtracting it after the
// fact, so every downstream number (margin %, CM, etc.) stays internally
// consistent. Price List has no labor cost anywhere in its math, so
// `excludeLabor` is simply unused for that section.
async function computePricingSection(
  supabase: SupabaseClient,
  section: string,
  excludeLabor: boolean,
): Promise<unknown> {
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
        const labor = excludeLabor ? 0 : p.labor ?? laborCostMap[key] ?? meta.labor;
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
      const labor = excludeLabor ? 0 : laborMap[key] ?? PKG_META[key].labor;
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
          laborForPackage: excludeLabor ? 0 : laborMap[line.package_key] ?? 0,
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

// Shapes computePricingSection's output into spreadsheet sheets (header +
// rows) for export_pricing_data_as_spreadsheet — the shape each section
// returns for on-screen/chat reporting isn't already a flat table, so this
// is where that gets flattened. Returns null for an unknown section (the
// caller already got an {error} back from computePricingSection itself in
// that case).
function buildPricingSpreadsheetSheets(
  section: string,
  data: unknown,
  excludeLabor: boolean,
): SpreadsheetSheetInput[] | null {
  if (section === "price_list") {
    const brands = data as { name: string; brand_price_list?: { package_key: string; price: number }[] }[];
    const rows: (string | number | null)[][] = [];
    for (const b of brands ?? []) {
      for (const bpl of b.brand_price_list ?? []) {
        rows.push([
          b.name,
          PRICE_LIST_PACKAGE_LABELS[bpl.package_key as PriceListPackageKey] ?? bpl.package_key,
          bpl.price,
        ]);
      }
    }
    return [{ name: "Price List", header: ["Brand", "Package", "Price"], rows }];
  }

  if (section === "margin_analysis") {
    const lines = data as Record<string, unknown>[];
    const header = [
      "Brand",
      "Package",
      "PTR",
      "PTD",
      "Gross Profit $/unit",
      "Gross Profit %",
      "Batch Cost",
      "Yield (bbls)",
      "Batch Yield Amt",
      "Batch Revenue",
      excludeLabor ? "Batch Total Cost (excl. labor)" : "Batch Total Cost",
      excludeLabor ? "Batch Profit (excl. labor)" : "Batch Profit",
      excludeLabor ? "Batch Margin % (excl. labor)" : "Batch Margin %",
      "Note",
    ];
    const rows = (lines ?? []).map((l) => [
      l.brand as string,
      l.package as string,
      (l.ptr as number) ?? null,
      (l.ptd as number) ?? null,
      (l.gross_profit_per_unit as number) ?? null,
      (l.gross_profit_pct as number) ?? null,
      (l.batch_cost as number) ?? null,
      (l.yield_bbls as number) ?? null,
      (l.batch_yield_amt as number) ?? null,
      (l.batch_revenue as number) ?? null,
      (l.batch_total_cost as number) ?? null,
      (l.batch_profit as number) ?? null,
      (l.batch_margin_pct as number) ?? null,
      (l.note as string) ?? "",
    ]);
    return [{ name: "Margin Analysis", header, rows }];
  }

  if (section === "cost_per_case") {
    const d = data as {
      packaging_cost_per_case: Record<string, number>;
      labor_cost_per_case: Record<string, number>;
      ingredient_cost_per_brand: { brand: string; cost_per_30bbl_batch: number; ingredient_cost_per_case: Record<string, number> }[];
    };
    const keys = PRICE_LIST_PACKAGE_KEYS as PriceListPackageKey[];
    const overviewRows = keys.map((key) => [
      PRICE_LIST_PACKAGE_LABELS[key],
      d.packaging_cost_per_case[key] ?? 0,
      excludeLabor ? 0 : d.labor_cost_per_case[key] ?? 0,
    ]);
    const ingredientHeader = ["Brand", "Cost per 30-BBL Batch", ...keys.map((k) => PRICE_LIST_PACKAGE_LABELS[k])];
    const ingredientRows = (d.ingredient_cost_per_brand ?? []).map((b) => [
      b.brand,
      b.cost_per_30bbl_batch,
      ...keys.map((k) => b.ingredient_cost_per_case[k] ?? 0),
    ]);
    return [
      {
        name: "Packaging & Labor",
        header: ["Package", "Packaging Cost/Case", excludeLabor ? "Labor Cost/Case (excl.)" : "Labor Cost/Case"],
        rows: overviewRows,
      },
      { name: "Ingredient Cost by Brand", header: ingredientHeader, rows: ingredientRows },
    ];
  }

  if (section === "contribution_margin") {
    const lines = data as Record<string, unknown>[];
    const header = [
      "Brand",
      "Package",
      "Revenue/CE",
      excludeLabor ? "Cost/CE (excl. labor)" : "Cost/CE",
      excludeLabor ? "CM/CE (excl. labor)" : "CM/CE",
      excludeLabor ? "Margin % (excl. labor)" : "Margin %",
      "Inventory Value",
      excludeLabor ? "Total Batch Cost (excl. labor)" : "Total Batch Cost",
    ];
    const rows = (lines ?? []).map((l) => [
      l.brand as string,
      l.package as string,
      l.revenue_per_ce as number,
      l.cost_per_ce as number,
      l.cm_per_ce as number,
      l.margin_pct as number,
      l.inventory_value as number,
      l.total_batch_cost as number,
    ]);
    return [{ name: "Contribution Margin", header, rows }];
  }

  return null;
}

const SECTION_DEFAULT_FILE_NAMES: Record<string, string> = {
  price_list: "Price List.xlsx",
  margin_analysis: "Margin Analysis.xlsx",
  cost_per_case: "Cost Per Case.xlsx",
  contribution_margin: "Contribution Margin.xlsx",
};

// ── Propose-then-confirm write support (added 2026-09-11) ────────────────
// See sql/ernie_pending_actions.sql and the big comment above
// add_social_media_calendar_event's tool definition for the full writeup.
// Every mutating tool funnels through these two helpers: createPendingAction
// stores what a "propose" call resolved and would write, without writing it;
// loadConfirmedPendingAction is what a "confirmed:true" call (or
// confirm_pending_action itself) uses to fetch that row back and — its one
// real safety property — refuses unless the row was created by a strictly
// earlier HTTP request than the one asking to confirm it, so a propose and
// its confirm can never both happen inside the same tool-use loop.

// Which section a given action_type needs — re-checked here regardless of
// whether the tool that eventually executes it (confirm_pending_action,
// shared across all of them) was itself already gated at the tool-list
// level, same defense-in-depth spirit as canUseTool elsewhere in this file.
const PENDING_ACTION_SECTIONS: Record<string, AnySectionKey> = {
  add_social_media_calendar_event: "events_calendar",
  update_social_media_calendar_event: "events_calendar",
  delete_social_media_calendar_event: "events_calendar",
  add_events_calendar_event: "events_calendar",
  update_events_calendar_event: "events_calendar",
  delete_events_calendar_event: "events_calendar",
  add_chain_calendar_event: "events_calendar",
  update_chain_calendar_event: "events_calendar",
  delete_chain_calendar_event: "events_calendar",
  create_task: "tasks",
  update_task: "tasks",
};

async function createPendingAction(
  supabase: SupabaseClient,
  params: {
    userId: string;
    requestId: string;
    actionType: string;
    targetTable: string;
    payload: Record<string, unknown>;
    summary: string;
  },
): Promise<{ error: string } | { pending: true; pending_action_id: string; summary: string; message: string }> {
  const { data, error } = await supabase
    .from("ernie_pending_actions")
    .insert({
      created_by: params.userId,
      action_type: params.actionType,
      target_table: params.targetTable,
      payload: params.payload,
      summary: params.summary,
      request_id: params.requestId,
    })
    .select("id")
    .single();
  if (error) return { error: `Couldn't stage that action: ${error.message}` };

  return {
    pending: true,
    pending_action_id: data.id,
    summary: params.summary,
    message:
      "Nothing has been written yet. Share this summary with the user in your own words and ask them to confirm. Only after they approve in a NEW message, call confirm_pending_action with NO arguments — it automatically confirms this user's own most recent pending proposal, so you do not need to remember or re-supply this pending_action_id (and in practice you won't reliably have it anymore once this turn ends). Do not silently propose the same thing again when the user confirms — that looks like progress but never actually writes anything.",
  };
}

async function loadConfirmedPendingAction(
  supabase: SupabaseClient,
  params: {
    userId: string;
    requestId: string;
    pendingActionId: string;
    expectedActionType?: string;
    role: Role | undefined;
    sections: AnySectionKey[];
    isSuperAdmin: boolean;
  },
): Promise<{ error: string } | { row: { id: string; action_type: string; target_table: string; payload: Record<string, unknown>; summary: string } }> {
  const { data: row, error } = await supabase
    .from("ernie_pending_actions")
    .select("id, created_by, action_type, target_table, payload, summary, request_id, status")
    .eq("id", params.pendingActionId)
    .maybeSingle();
  if (error) return { error: error.message };
  if (!row) return { error: "No pending action found with that id — it may have already been confirmed, or never existed." };
  if (row.status !== "pending") {
    return { error: `That action is already "${row.status}" — it can't be confirmed again.` };
  }
  if (params.expectedActionType && row.action_type !== params.expectedActionType) {
    return { error: `That pending_action_id is for a "${row.action_type}" action, not "${params.expectedActionType}".` };
  }
  if (row.request_id === params.requestId) {
    return {
      error:
        "This action was proposed in this SAME message/turn — it can't be confirmed here too. Show the summary to the user as your reply, end your turn, and only confirm it after they explicitly approve in their own next message.",
    };
  }
  const requiredSection = PENDING_ACTION_SECTIONS[row.action_type];
  if (requiredSection && !hasSection(params.role, params.sections, requiredSection, params.isSuperAdmin)) {
    return { error: "This account no longer has the access this action needs — it can't be confirmed." };
  }

  const { error: updateErr } = await supabase
    .from("ernie_pending_actions")
    .update({ status: "executed" })
    .eq("id", row.id)
    .eq("status", "pending");
  if (updateErr) return { error: `Couldn't mark that action executed: ${updateErr.message}` };

  return { row };
}

async function resolveDistributorId(supabase: SupabaseClient, name: string): Promise<{ id?: string; error?: string }> {
  const { data, error } = await supabase.from("distributors").select("id, name").ilike("name", `%${name}%`);
  if (error) return { error: error.message };
  if (!data || data.length === 0) return { error: `No distributor found matching "${name}".` };
  if (data.length > 1) {
    return { error: `More than one distributor matches "${name}": ${data.map((d) => d.name).join(", ")}. Be more specific.` };
  }
  return { id: data[0].id };
}

export async function runErnieTool(
  supabase: SupabaseClient,
  name: string,
  input: Record<string, unknown>,
  role: Role | undefined,
  sections: AnySectionKey[],
  currentConversationId?: string,
  isSuperAdmin = false,
  userId?: string,
  // One id per HTTP request (a route generates this once with
  // crypto.randomUUID() before its tool-use loop starts) — the mechanism
  // that makes propose-then-confirm a real structural guarantee rather
  // than just a prompted convention. See loadConfirmedPendingAction above.
  requestId?: string,
): Promise<unknown> {
  // Defense in depth: getErnieTools() already keeps a tool a user isn't
  // granted out of their tool list, so Claude has nothing to call here —
  // but enforce it at the data layer too rather than relying solely on
  // what tools we handed the model.
  if (!canUseTool(name, role, sections, isSuperAdmin)) {
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

    // Mirrors components/CashflowDashboardPageClient.tsx's own computation
    // exactly (same Order Value math the Inventory & Allocation page uses)
    // — kept in sync by hand since there's no shared server-side helper for
    // it yet. Runs with this same signed-in user's own RLS, same as every
    // other tool here.
    case "get_cashflow_dashboard": {
      const [
        { data: weeks, error: weeksErr },
        { data: distributors, error: distErr },
        { data: distributorPos, error: dposErr },
        { data: allocations, error: allocErr },
        { data: prices, error: pricesErr },
        { data: purchaseOrders, error: poErr },
      ] = await Promise.all([
        supabase.from("weeks").select("id, label, week_start"),
        supabase.from("distributors").select("id, name"),
        supabase.from("distributor_pos").select("week_id, distributor_id, po_status"),
        supabase.from("allocations").select("week_id, distributor_id, product_id, quantity"),
        supabase.from("distributor_prices").select("distributor_id, product_id, price"),
        supabase.from("purchase_orders").select("supplier, po_date, total_cost, payment_status"),
      ]);
      const firstError = weeksErr ?? distErr ?? dposErr ?? allocErr ?? pricesErr ?? poErr;
      if (firstError) throw firstError;

      const distributorsById = new Map((distributors ?? []).map((d) => [d.id, d.name as string]));
      const priceFor = new Map<string, number>();
      for (const p of prices ?? []) priceFor.set(`${p.product_id}:${p.distributor_id}`, p.price ?? 0);

      const allocationsByWeekDist = new Map<string, { product_id: string; quantity: number }[]>();
      for (const a of allocations ?? []) {
        const key = `${a.week_id}:${a.distributor_id}`;
        const list = allocationsByWeekDist.get(key) ?? [];
        list.push({ product_id: a.product_id, quantity: a.quantity ?? 0 });
        allocationsByWeekDist.set(key, list);
      }
      function orderValueFor(weekId: string, distributorId: string): number {
        const rows = allocationsByWeekDist.get(`${weekId}:${distributorId}`) ?? [];
        return rows.reduce((sum, r) => sum + (priceFor.get(`${r.product_id}:${distributorId}`) ?? 0) * r.quantity, 0);
      }

      const deliveredByWeek = new Map<string, string[]>();
      for (const dp of distributorPos ?? []) {
        if (dp.po_status !== "delivered") continue;
        const list = deliveredByWeek.get(dp.week_id) ?? [];
        list.push(dp.distributor_id);
        deliveredByWeek.set(dp.week_id, list);
      }

      const weeklyRevenue = (weeks ?? [])
        .map((w) => {
          const deliveredIds = deliveredByWeek.get(w.id) ?? [];
          const distributorBreakdown = deliveredIds
            .map((id) => ({ distributor: distributorsById.get(id) ?? "Unknown", revenue: orderValueFor(w.id, id) }))
            .filter((d) => d.revenue > 0);
          const revenue = distributorBreakdown.reduce((sum, d) => sum + d.revenue, 0);
          return { week: w.label, week_start: w.week_start, revenue, by_distributor: distributorBreakdown };
        })
        .filter((r) => r.revenue > 0)
        .sort((a, b) => (a.week_start < b.week_start ? 1 : -1));

      let poPending = 0;
      let poPaid = 0;
      for (const po of purchaseOrders ?? []) {
        if (po.payment_status === "paid") poPaid += po.total_cost ?? 0;
        else poPending += po.total_cost ?? 0;
      }

      const totalRealizedRevenue = weeklyRevenue.reduce((sum, r) => sum + r.revenue, 0);
      const totalVendorSpend = poPending + poPaid;

      return {
        total_realized_revenue: totalRealizedRevenue,
        vendor_po_spend_pending: poPending,
        vendor_po_spend_paid: poPaid,
        vendor_po_spend_total: totalVendorSpend,
        net_position: totalRealizedRevenue - totalVendorSpend,
        planned_batch_expenses: "not tracked yet — no Brew Planner exists",
        weekly_realized_revenue: weeklyRevenue,
      };
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

    case "list_social_media_calendar_events": {
      let query = supabase.from("social_media_events").select("*");
      if (input.start_date) query = query.gte("start_date", input.start_date as string);
      if (input.end_date) query = query.lte("start_date", input.end_date as string);
      const { data, error } = await query.order("start_date", { ascending: true });
      if (error) throw error;
      return data ?? [];
    }

    case "list_chain_calendar_events": {
      let query = supabase.from("chain_events").select("*");
      if (input.start_date) query = query.gte("start_date", input.start_date as string);
      if (input.end_date) query = query.lte("start_date", input.end_date as string);
      const { data, error } = await query.order("start_date", { ascending: true });
      if (error) throw error;
      return data ?? [];
    }

    case "add_social_media_calendar_event":
    case "add_events_calendar_event":
    case "add_chain_calendar_event": {
      if (!userId) return { error: "No signed-in user to attribute this event to." };
      const table = name === "add_social_media_calendar_event" ? "social_media_events" : name === "add_events_calendar_event" ? "events" : "chain_events";
      const types =
        table === "social_media_events"
          ? ["post", "campaign", "story", "promotion", "other"]
          : table === "events"
          ? ["festival", "tasting", "donation", "work-with", "other"]
          : ["demo", "reset", "ad", "display", "other"];
      const defaultType = table === "social_media_events" ? "post" : "other";
      const hasColor = table !== "events";
      const hasDistributor = table === "events";

      // Confirming a previously-proposed add.
      if (input.confirmed === true && typeof input.pending_action_id === "string") {
        const loaded = await loadConfirmedPendingAction(supabase, {
          userId,
          requestId: requestId ?? "",
          pendingActionId: input.pending_action_id,
          expectedActionType: name,
          role,
          sections,
          isSuperAdmin,
        });
        if ("error" in loaded) return { error: loaded.error };
        const { data, error } = await supabase.from(table).insert(loaded.row.payload).select().single();
        if (error) throw error;
        await logChange(supabase, {
          weekId: null,
          tableName: table,
          recordId: data.id,
          fieldName: "title",
          oldValue: "",
          newValue: (loaded.row.payload as Record<string, unknown>).title,
          changedBy: userId,
        });
        return { ok: true, event: data };
      }

      // First call: propose.
      const title = (input.title as string | undefined)?.trim();
      const startDate = input.start_date as string | undefined;
      if (!title) return { error: "title is required." };
      if (!startDate) return { error: "start_date is required." };
      const eventType = (input.type as string | undefined) || defaultType;
      if (!types.includes(eventType)) {
        return { error: `type must be one of ${types.join("/")}, got "${eventType}".` };
      }
      let distributorId: string | null = null;
      let distributorLabel = "";
      if (hasDistributor && input.distributor_name) {
        const resolved = await resolveDistributorId(supabase, input.distributor_name as string);
        if (resolved.error) return { error: resolved.error };
        distributorId = resolved.id ?? null;
        distributorLabel = `, distributor: ${input.distributor_name}`;
      }

      const payload: Record<string, unknown> = {
        title,
        start_date: startDate,
        end_date: (input.end_date as string | undefined) || null,
        time_label: (input.time_label as string | undefined)?.trim() || null,
        type: eventType,
        location: (input.location as string | undefined)?.trim() || null,
        rep: (input.rep as string | undefined)?.trim() || null,
        notes: (input.notes as string | undefined)?.trim() || null,
        created_by: userId,
        updated_by: userId,
      };
      if (hasColor) payload.color = (input.color as string | undefined) || null;
      if (hasDistributor) payload.distributor_id = distributorId;

      const calendarLabel = table === "social_media_events" ? "Social Media Calendar" : table === "events" ? "Events Calendar" : "Chain Calendar";
      const summary = `Add to the ${calendarLabel}: "${title}" (${eventType}) on ${startDate}${
        input.end_date ? ` through ${input.end_date}` : ""
      }${input.time_label ? `, ${input.time_label}` : ""}${input.location ? ` at ${input.location}` : ""}${distributorLabel}${
        input.rep ? `, rep: ${input.rep}` : ""
      }${input.notes ? `. Notes: ${input.notes}` : ""}.`;

      if (!requestId) return { error: "Internal error: missing request id — can't stage this action." };
      return await createPendingAction(supabase, {
        userId,
        requestId,
        actionType: name,
        targetTable: table,
        payload,
        summary,
      });
    }

    case "update_social_media_calendar_event":
    case "update_events_calendar_event":
    case "update_chain_calendar_event": {
      if (!userId) return { error: "No signed-in user to attribute this change to." };
      const table = name === "update_social_media_calendar_event" ? "social_media_events" : name === "update_events_calendar_event" ? "events" : "chain_events";
      const types =
        table === "social_media_events"
          ? ["post", "campaign", "story", "promotion", "other"]
          : table === "events"
          ? ["festival", "tasting", "donation", "work-with", "other"]
          : ["demo", "reset", "ad", "display", "other"];
      const hasColor = table !== "events";
      const hasDistributor = table === "events";
      const fields = hasColor
        ? (["title", "start_date", "end_date", "time_label", "type", "location", "rep", "color", "notes"] as const)
        : (["title", "start_date", "end_date", "time_label", "type", "location", "rep", "notes"] as const);

      // Confirming a previously-proposed update.
      if (input.confirmed === true && typeof input.pending_action_id === "string") {
        const loaded = await loadConfirmedPendingAction(supabase, {
          userId,
          requestId: requestId ?? "",
          pendingActionId: input.pending_action_id,
          expectedActionType: name,
          role,
          sections,
          isSuperAdmin,
        });
        if ("error" in loaded) return { error: loaded.error };
        const { id, ...updatePayload } = loaded.row.payload as Record<string, unknown> & { id: string };

        const { data: existing, error: fetchErr } = await supabase.from(table).select("*").eq("id", id).maybeSingle();
        if (fetchErr) throw fetchErr;
        if (!existing) return { error: "That event no longer exists — it may have been deleted since this was proposed." };

        const { data, error } = await supabase.from(table).update(updatePayload).eq("id", id).select().single();
        if (error) throw error;

        for (const field of Object.keys(updatePayload)) {
          if (field === "updated_by" || field === "updated_at") continue;
          await logChange(supabase, {
            weekId: null,
            tableName: table,
            recordId: id,
            fieldName: field,
            oldValue: (existing as Record<string, unknown>)[field],
            newValue: (data as Record<string, unknown>)[field],
            changedBy: userId,
          });
        }
        return { ok: true, event: data };
      }

      // First call: propose.
      const id = input.id as string | undefined;
      if (!id) return { error: "id is required." };

      const { data: existing, error: fetchErr } = await supabase.from(table).select("*").eq("id", id).maybeSingle();
      if (fetchErr) throw fetchErr;
      if (!existing) return { error: "No calendar event found with that id." };

      if (input.type !== undefined && !types.includes(input.type as string)) {
        return { error: `type must be one of ${types.join("/")}, got "${input.type}".` };
      }

      const updatePayload: Record<string, unknown> = { id, updated_by: userId, updated_at: new Date().toISOString() };
      const changeDescriptions: string[] = [];
      for (const field of fields) {
        if (input[field] === undefined) continue;
        const raw = input[field];
        const value = typeof raw === "string" && raw.trim() === "" && field !== "title" && field !== "start_date" ? null : raw;
        updatePayload[field] = value;
        changeDescriptions.push(`${field}: "${(existing as Record<string, unknown>)[field] ?? ""}" → "${value ?? ""}"`);
      }
      if (hasDistributor && input.distributor_name !== undefined) {
        if (input.distributor_name === "") {
          updatePayload.distributor_id = null;
          changeDescriptions.push("distributor: cleared");
        } else {
          const resolved = await resolveDistributorId(supabase, input.distributor_name as string);
          if (resolved.error) return { error: resolved.error };
          updatePayload.distributor_id = resolved.id;
          changeDescriptions.push(`distributor → ${input.distributor_name}`);
        }
      }
      if (changeDescriptions.length === 0) {
        return { error: "No fields were provided to change." };
      }

      const calendarLabel = table === "social_media_events" ? "Social Media Calendar" : table === "events" ? "Events Calendar" : "Chain Calendar";
      const summary = `Update "${existing.title}" on the ${calendarLabel}: ${changeDescriptions.join("; ")}.`;

      if (!requestId) return { error: "Internal error: missing request id — can't stage this action." };
      return await createPendingAction(supabase, {
        userId,
        requestId,
        actionType: name,
        targetTable: table,
        payload: updatePayload,
        summary,
      });
    }

    case "delete_social_media_calendar_event":
    case "delete_events_calendar_event":
    case "delete_chain_calendar_event": {
      if (!userId) return { error: "No signed-in user to attribute this change to." };
      const table = name === "delete_social_media_calendar_event" ? "social_media_events" : name === "delete_events_calendar_event" ? "events" : "chain_events";
      const calendarLabel = table === "social_media_events" ? "Social Media Calendar" : table === "events" ? "Events Calendar" : "Chain Calendar";

      // Confirming a previously-proposed delete.
      if (input.confirmed === true && typeof input.pending_action_id === "string") {
        const loaded = await loadConfirmedPendingAction(supabase, {
          userId,
          requestId: requestId ?? "",
          pendingActionId: input.pending_action_id,
          expectedActionType: name,
          role,
          sections,
          isSuperAdmin,
        });
        if ("error" in loaded) return { error: loaded.error };
        const { id, title } = loaded.row.payload as { id: string; title: string };

        const { error } = await supabase.from(table).delete().eq("id", id);
        if (error) throw error;

        await logChange(supabase, {
          weekId: null,
          tableName: table,
          recordId: id,
          fieldName: "title",
          oldValue: title,
          newValue: "",
          changedBy: userId,
        });
        return { ok: true, deleted_id: id };
      }

      // First call: propose.
      const id = input.id as string | undefined;
      if (!id) return { error: "id is required." };

      const { data: existing, error: fetchErr } = await supabase.from(table).select("id, title, start_date").eq("id", id).maybeSingle();
      if (fetchErr) throw fetchErr;
      if (!existing) return { error: "No calendar event found with that id — it may already be deleted." };

      const summary = `Permanently delete "${existing.title}" (${existing.start_date}) from the ${calendarLabel}. This cannot be undone from the calendar itself (though it will still show in Audit Log).`;

      if (!requestId) return { error: "Internal error: missing request id — can't stage this action." };
      return await createPendingAction(supabase, {
        userId,
        requestId,
        actionType: name,
        targetTable: table,
        payload: { id, title: existing.title },
        summary,
      });
    }

    case "create_task": {
      if (!userId) return { error: "No signed-in user to attribute this task to." };

      // Confirming a previously-proposed task.
      if (input.confirmed === true && typeof input.pending_action_id === "string") {
        const loaded = await loadConfirmedPendingAction(supabase, {
          userId,
          requestId: requestId ?? "",
          pendingActionId: input.pending_action_id,
          expectedActionType: "create_task",
          role,
          sections,
          isSuperAdmin,
        });
        if ("error" in loaded) return { error: loaded.error };
        const { assignee_user_ids, ...taskPayload } = loaded.row.payload as Record<string, unknown> & { assignee_user_ids: string[] };

        const { data, error } = await supabase.from("task_items").insert(taskPayload).select().single();
        if (error) throw error;
        await supabase.from("task_item_activity").insert({ item_id: data.id, actor_id: userId, action: "created", detail: null });
        if (assignee_user_ids && assignee_user_ids.length > 0) {
          await supabase
            .from("task_item_assignees")
            .insert(assignee_user_ids.map((assigneeId) => ({ item_id: data.id, user_id: assigneeId })));
        }
        return { ok: true, task: data };
      }

      // First call: propose.
      const subcategoryId = input.subcategory_id as string | undefined;
      const title = (input.title as string | undefined)?.trim();
      if (!subcategoryId) return { error: "subcategory_id is required — look it up first (run_read_only_query against task_categories/task_subcategories)." };
      if (!title) return { error: "title is required." };

      const { data: subcategory, error: subErr } = await supabase
        .from("task_subcategories")
        .select("id, name, category_id")
        .eq("id", subcategoryId)
        .maybeSingle();
      if (subErr) throw subErr;
      if (!subcategory) return { error: "No task subcategory found with that id." };

      let assigneeNames = "";
      const assigneeIds = Array.isArray(input.assignee_user_ids) ? (input.assignee_user_ids as string[]) : [];
      if (assigneeIds.length > 0) {
        const { data: assigneeProfiles } = await supabase.from("profiles").select("id, full_name, email").in("id", assigneeIds);
        assigneeNames = (assigneeProfiles ?? []).map((p) => p.full_name?.trim() || p.email).join(", ");
      }

      const payload = {
        subcategory_id: subcategoryId,
        title,
        notes: (input.notes as string | undefined)?.trim() || null,
        due_date: (input.due_date as string | undefined) || null,
        created_by: userId,
        assignee_user_ids: assigneeIds,
      };
      const summary = `Create a task under "${subcategory.name}": "${title}"${input.due_date ? `, due ${input.due_date}` : ""}${
        assigneeNames ? `, assigned to ${assigneeNames}` : ""
      }${input.notes ? `. Notes: ${input.notes}` : ""}.`;

      if (!requestId) return { error: "Internal error: missing request id — can't stage this action." };
      return await createPendingAction(supabase, {
        userId,
        requestId,
        actionType: "create_task",
        targetTable: "task_items",
        payload,
        summary,
      });
    }

    case "update_task": {
      if (!userId) return { error: "No signed-in user to attribute this change to." };
      const TASK_ITEM_FIELDS = ["title", "notes", "due_date", "status"] as const;

      // Confirming a previously-proposed update.
      if (input.confirmed === true && typeof input.pending_action_id === "string") {
        const loaded = await loadConfirmedPendingAction(supabase, {
          userId,
          requestId: requestId ?? "",
          pendingActionId: input.pending_action_id,
          expectedActionType: "update_task",
          role,
          sections,
          isSuperAdmin,
        });
        if ("error" in loaded) return { error: loaded.error };
        const { id, assignee_user_ids, ...itemUpdatePayload } = loaded.row.payload as Record<string, unknown> & {
          id: string;
          assignee_user_ids?: string[];
        };

        const { data: existing, error: fetchErr } = await supabase.from("task_items").select("*").eq("id", id).maybeSingle();
        if (fetchErr) throw fetchErr;
        if (!existing) return { error: "That task no longer exists — it may have been deleted since this was proposed." };

        let data = existing;
        if (Object.keys(itemUpdatePayload).length > 0) {
          const { data: updated, error } = await supabase.from("task_items").update(itemUpdatePayload).eq("id", id).select().single();
          if (error) throw error;
          data = updated;
        }

        // Mirror the same activity-log entries the Tasks page itself makes
        // for each of these fields (see renameTask/changeDueDate/
        // toggleStatus in components/TasksPageClient.tsx) — notes changes
        // aren't logged there either, so we don't log them here.
        if ("title" in itemUpdatePayload) {
          await supabase.from("task_item_activity").insert({ item_id: id, actor_id: userId, action: "renamed", detail: itemUpdatePayload.title as string });
        }
        if ("due_date" in itemUpdatePayload) {
          const newDue = itemUpdatePayload.due_date as string | null;
          await supabase.from("task_item_activity").insert({
            item_id: id,
            actor_id: userId,
            action: newDue ? "due_date_set" : "due_date_cleared",
            detail: newDue,
          });
        }
        if ("status" in itemUpdatePayload) {
          await supabase.from("task_item_activity").insert({
            item_id: id,
            actor_id: userId,
            action: itemUpdatePayload.status === "resolved" ? "resolved" : "reopened",
            detail: null,
          });
        }

        if (assignee_user_ids !== undefined) {
          await supabase.from("task_item_assignees").delete().eq("item_id", id);
          if (assignee_user_ids.length > 0) {
            await supabase
              .from("task_item_assignees")
              .insert(assignee_user_ids.map((assigneeId) => ({ item_id: id, user_id: assigneeId })));
          }
        }

        return { ok: true, task: data };
      }

      // First call: propose.
      const id = input.id as string | undefined;
      if (!id) return { error: "id is required." };

      const { data: existing, error: fetchErr } = await supabase.from("task_items").select("*").eq("id", id).maybeSingle();
      if (fetchErr) throw fetchErr;
      if (!existing) return { error: "No task found with that id." };

      if (input.status !== undefined && !["open", "resolved"].includes(input.status as string)) {
        return { error: `status must be "open" or "resolved", got "${input.status}".` };
      }

      const updatePayload: Record<string, unknown> = { id };
      const changeDescriptions: string[] = [];
      for (const field of TASK_ITEM_FIELDS) {
        if (input[field] === undefined) continue;
        const raw = input[field];
        const value = typeof raw === "string" && raw.trim() === "" && field !== "title" && field !== "status" ? null : raw;
        updatePayload[field] = value;
        changeDescriptions.push(`${field}: "${(existing as Record<string, unknown>)[field] ?? ""}" → "${value ?? ""}"`);
      }

      let assigneeNames = "";
      if (input.assignee_user_ids !== undefined) {
        const assigneeIds = Array.isArray(input.assignee_user_ids) ? (input.assignee_user_ids as string[]) : [];
        updatePayload.assignee_user_ids = assigneeIds;
        if (assigneeIds.length > 0) {
          const { data: assigneeProfiles } = await supabase.from("profiles").select("id, full_name, email").in("id", assigneeIds);
          assigneeNames = (assigneeProfiles ?? []).map((p) => p.full_name?.trim() || p.email).join(", ");
          changeDescriptions.push(`assignees → ${assigneeNames}`);
        } else {
          changeDescriptions.push("assignees: cleared (unassigned)");
        }
      }

      if (changeDescriptions.length === 0) {
        return { error: "No fields were provided to change." };
      }

      const summary = `Update task "${existing.title}": ${changeDescriptions.join("; ")}.`;

      if (!requestId) return { error: "Internal error: missing request id — can't stage this action." };
      return await createPendingAction(supabase, {
        userId,
        requestId,
        actionType: "update_task",
        targetTable: "task_items",
        payload: updatePayload,
        summary,
      });
    }

    case "confirm_pending_action": {
      if (!userId) return { error: "No signed-in user." };
      let pendingActionId = input.pending_action_id as string | undefined;

      // The normal path: no id given at all. Rather than depend on Claude
      // correctly recalling an opaque pending_action_id from a PRIOR turn
      // (it can't — only the final text reply gets persisted across
      // requests, not the tool_use/tool_result content that actually
      // carried that id, so the model has no real memory of it once the
      // turn ends), just look up this same user's own most recent
      // still-pending row and confirm that one. This is what
      // "confirm"/"execute"/"yes" from the user should always resolve to.
      if (!pendingActionId) {
        // Only look within a short recency window (added after a real
        // incident on 2026-09-11). The model described a preview in words
        // without actually calling the propose tool for it, then "execute"
        // fell back to whatever OLD pending row happened to still be
        // sitting there from an earlier, unrelated test — and silently
        // wrote THAT instead. A stale, unrelated action being sitting
        // around is normal (people abandon a proposal without ever
        // confirming it); the bug is reaching back arbitrarily far in time
        // to find "something, anything" pending and executing it as if it
        // were what the user just approved. Bounding this to the last few
        // minutes means a genuinely fresh propose-then-confirm pair still
        // works exactly as before, but a "confirm" with nothing actually
        // proposed a moment ago fails loudly instead of silently executing
        // an old leftover.
        const RECENCY_WINDOW_MINUTES = 10;
        const cutoff = new Date(Date.now() - RECENCY_WINDOW_MINUTES * 60 * 1000).toISOString();
        const { data: mostRecent, error: mostRecentErr } = await supabase
          .from("ernie_pending_actions")
          .select("id")
          .eq("created_by", userId)
          .eq("status", "pending")
          .gte("created_at", cutoff)
          .order("created_at", { ascending: false })
          .limit(1)
          .maybeSingle();
        if (mostRecentErr) return { error: mostRecentErr.message };
        if (!mostRecent) {
          return {
            error:
              `There's nothing pending from the last ${RECENCY_WINDOW_MINUTES} minutes to confirm for this user — either nothing was actually proposed yet (double check you really called the add/update/delete/create_task tool WITHOUT confirmed and got a real preview back, rather than just describing one), or it's too old/already handled. Propose the action again fresh, show the user that exact preview, and only then call confirm_pending_action.`,
          };
        }
        pendingActionId = mostRecent.id;
      }

      // Peek at the row first just to find out which action type it is, so
      // we can hand off to the exact same logic add/update/delete/
      // create_task's own confirmed:true branch already implements above,
      // rather than duplicating the execution logic a third time here.
      const { data: peek } = await supabase
        .from("ernie_pending_actions")
        .select("action_type")
        .eq("id", pendingActionId)
        .maybeSingle();
      if (!peek) return { error: "No pending action found with that id." };

      return runErnieTool(
        supabase,
        peek.action_type,
        { ...input, confirmed: true, pending_action_id: pendingActionId },
        role,
        sections,
        currentConversationId,
        isSuperAdmin,
        userId,
        requestId,
      );
    }

    case "get_pricing_data": {
      const section = input.section as string;
      return await computePricingSection(supabase, section, false);
    }

    case "export_pricing_data_as_spreadsheet": {
      const section = input.section as string;
      const excludeLabor = Boolean(input.exclude_labor_cost);
      const data = await computePricingSection(supabase, section, excludeLabor);
      if (data && typeof data === "object" && "error" in (data as Record<string, unknown>)) {
        return data;
      }

      const sheets = buildPricingSpreadsheetSheets(section, data, excludeLabor);
      if (!sheets) return { error: `Unknown section "${section}"` };

      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) return { error: "Not signed in." };

      try {
        const outputFileName =
          (input.output_file_name as string | undefined)?.trim() ||
          SECTION_DEFAULT_FILE_NAMES[section] ||
          "export.xlsx";
        return await createSpreadsheetFromSheets(supabase, user.id, outputFileName, sheets);
      } catch (err) {
        return { error: err instanceof Error ? err.message : "Couldn't build that spreadsheet." };
      }
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

    case "update_person_notes": {
      // Private per-user notes, fully self-scoped — no admin bypass exists
      // anywhere for this table (see sql/ernie_user_notes.sql's RLS), and
      // this case only ever writes the CURRENT signed-in user's own row:
      // userId comes from the server-verified session in
      // app/api/ernie/chat/route.ts, never from model input.
      const notes = typeof input.notes === "string" ? input.notes.trim() : "";
      if (!notes) return { error: "notes must be non-empty text." };
      if (!userId) return { error: "No signed-in user to attach these notes to." };
      if (notes.length > 4000) {
        return { error: "That's too long — condense to under 4000 characters rather than appending everything." };
      }
      const { error } = await supabase
        .from("ernie_user_notes")
        .upsert({ user_id: userId, notes, updated_at: new Date().toISOString() }, { onConflict: "user_id" });
      if (error) throw error;
      return { ok: true };
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
        .select("id, file_name, mime_type, size_bytes, storage_path, source_bucket")
        .eq("id", fileId)
        .maybeSingle();
      if (error) throw error;
      if (!file) {
        return { error: "No file found with that id (it may not exist, or belong to someone else)." };
      }
      // __contentBlocks is a signal to the tool-use loop (both
      // app/api/ernie/chat/route.ts and app/api/ernie/project-chat/route.ts)
      // to use these real content blocks — which can include an image or a
      // PDF "document" block — instead of JSON-stringifying this result
      // into inert text the way every other tool's result is. A "document"
      // block specifically can't nest inside the tool_result itself (not
      // valid on Claude's Messages API), so the route pulls any of those out
      // and posts them as a sibling block in the same turn instead — see the
      // matching comment on buildFileContentBlocks in lib/ernie/files.ts.
      const blocks = await buildFileContentBlocks(supabase, file);
      return { __contentBlocks: blocks };
    }

    case "edit_spreadsheet": {
      const fileId = input.file_id as string | undefined;
      const edits = input.edits as SpreadsheetEditInput[] | undefined;
      if (!fileId) return { error: "No file_id provided." };
      if (!edits || !edits.length) return { error: "No edits provided." };

      const { data: file, error } = await supabase
        .from("ernie_files")
        .select("id, file_name, mime_type, size_bytes, storage_path, source_bucket")
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

    case "fetch_url_as_file": {
      const url = typeof input.url === "string" ? input.url.trim() : "";
      if (!url) return { error: "No url provided." };

      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) return { error: "Not signed in." };

      try {
        const fileName = typeof input.file_name === "string" ? input.file_name : undefined;
        return await fetchUrlAsFile(supabase, user.id, url, fileName);
      } catch (err) {
        return { error: err instanceof Error ? err.message : "Couldn't fetch that URL." };
      }
    }

    case "stage_uploaded_file_for_query": {
      const fileId = input.file_id as string | undefined;
      if (!fileId) return { error: "No file_id provided." };
      const { data: file, error } = await supabase
        .from("ernie_files")
        .select("id, file_name, mime_type, size_bytes, storage_path, source_bucket")
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
        const sheet = typeof input.sheet === "string" ? input.sheet : undefined;
        return await stageFileForQuery(supabase, user.id, file, sheet);
      } catch (err) {
        return { error: err instanceof Error ? err.message : "Couldn't stage that file." };
      }
    }

    case "clear_staged_file_data": {
      const fileId = input.file_id as string | undefined;
      if (!fileId) return { error: "No file_id provided." };
      try {
        return await clearStagedFileData(supabase, fileId);
      } catch (err) {
        return { error: err instanceof Error ? err.message : "Couldn't clear staged data." };
      }
    }

    case "list_app_files": {
      const path = typeof input.path === "string" ? input.path : "";
      if (isBlockedPath(path)) {
        return { error: "That path isn't something these tools can show, regardless of access level." };
      }
      try {
        return await listRepoPath(path);
      } catch (err) {
        return { error: err instanceof Error ? err.message : "Couldn't list that path." };
      }
    }

    case "read_app_file": {
      const path = typeof input.path === "string" ? input.path.trim() : "";
      if (!path) return { error: "No path provided." };
      if (!canAccessRepoPath(path, role, sections)) {
        return {
          error: `Access to "${path}" is restricted for this account — either it needs a page/section this account hasn't been granted, or it's core security/internal code (or a secret) that's off-limits regardless of role.`,
        };
      }
      try {
        return await readRepoFile(path);
      } catch (err) {
        return { error: err instanceof Error ? err.message : "Couldn't read that file." };
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
  [["cashflow_dashboard"], "the Cash Flow Dashboard (Finance)"],
];

export function buildErnieSystemPrompt(
  role: Role | undefined,
  sections: AnySectionKey[],
  isSuperAdmin = false,
  personNotes?: string | null,
): string {
  // The deliberate exceptions to "Ernie is read-only" (Social Media
  // Calendar added 2026-09-11; extended the same day to the Events
  // Calendar, Chain Calendar, and task creation — see the relevant tools'
  // own comments in ERNIE_TOOLS above for why). Each is gated by the same
  // section its own app page checks (events_calendar for all three
  // calendars, tasks for task creation), so this line stays accurate for
  // every account tier without special-casing here. Every one of these
  // tools is propose-then-confirm: Ernie must ask whatever questions it
  // needs, then ACTUALLY CALL the tool WITHOUT confirmed to get a real
  // preview (nothing is written yet), present that exact preview in its
  // own words, and only after the person clearly says to go ahead — in a
  // NEW message, never the same turn — call confirm_pending_action (no
  // arguments) to actually write it.
  const hasCalendarWriteAccess = hasSection(role, sections, "events_calendar", isSuperAdmin);
  const hasTaskWriteAccess = hasSection(role, sections, "tasks", isSuperAdmin);
  const calendarSentence = hasCalendarWriteAccess
    ? `You CAN add, edit, and delete entries on all three calendars — the Social Media Calendar (add/update/delete/list_social_media_calendar_event(s)), the Events Calendar (add/update/delete/list_events_calendar_event(s), which also takes a distributor name for events tied to a distributor), and the Chain Calendar (add/update/delete/list_chain_calendar_event(s)) — use these once someone actually wants a planned post, event, or chain activity put onto the relevant calendar, not just described in chat, and confirm which specific event they mean before editing or deleting one.`
    : `You do NOT have access to any of the calendars (Social Media, Events, or Chain) — if someone asks you to add, change, or remove a calendar entry, tell them you don't have that access and they'll need to do it themselves or ask an admin to grant it.`;
  const taskSentence = hasTaskWriteAccess
    ? ` You CAN also create tasks (create_task) and edit an existing one (update_task — rename it, change notes/due date/status, or reassign it; look it up first if you don't have its id) — ask what's needed (title, which category/subcategory, notes, due date, who it should be assigned to) before proposing a new one. There's no delete-task tool — the app itself has no way to permanently delete a task, only mark it resolved, so offer that instead if someone asks to remove one.`
    : ` You do NOT have access to create tasks — if someone asks you to create one, tell them you don't have that access and they'll need to do it themselves or ask an admin to grant it.`;
  const hasAnyWriteAccess = hasCalendarWriteAccess || hasTaskWriteAccess;
  const writeAccessSentence = hasAnyWriteAccess
    ? `${calendarSentence}${taskSentence} CRITICAL: never describe a "preview" of a calendar event or task in your reply unless you actually called the real add/update/delete/create_task tool THIS SAME TURN and are relaying the exact preview text it gave back — inventing preview-sounding text without calling the tool leaves nothing real staged, and a later "confirm" will then find nothing of yours to confirm (or, worse, silently confirm some unrelated leftover instead). Never propose and execute in the same turn — always wait for a genuine new message confirming it, and when that confirmation comes, call confirm_pending_action with no arguments (it automatically confirms your own most recent proposal — never try to recall or re-type a pending_action_id yourself). Every write is logged to the app's Audit Log, same as if a person made it, so it can be undone if it's wrong. Everything else in the app stays completely read-only: for anything outside these calendars and tasks, tell people you're read-only and they'll need to make that change on the relevant page themselves.`
    : `You have NO ability to write, edit, or delete anything in the app; if someone asks you to change something, tell them you're read-only and that they'll need to make that change on the relevant page themselves.`;

  const dataAccessParagraph =
    role === "admin" && isSuperAdmin
      ? `You can read data — inventory, allocations, distributors, distributor-reported inventory, Build Orders, the Events Calendar, purchase orders, Sales/pricing data, POS label files, the Cash Flow Dashboard, and the app's user list — via the tools available to you, plus a general-purpose read-only database query tool (run_read_only_query) for anything the specific tools don't already cover. ${writeAccessSentence}`
      : role === "admin"
      ? (() => {
          const hasFinance = hasSection(role, sections, "cashflow_dashboard", isSuperAdmin);
          const financeSentence = hasFinance
            ? " You also have access to the Cash Flow Dashboard (Finance)."
            : " You do NOT have access to the Cash Flow Dashboard (Finance) — being an admin doesn't automatically include it, and this account hasn't been separately granted it. If asked about it, say plainly that this account doesn't have Finance access rather than guessing at figures.";
          return `You can read data — inventory, allocations, distributors, distributor-reported inventory, Build Orders, the Events Calendar, purchase orders, Sales/pricing data, POS label files, and the app's user list — via the tools available to you, plus a general-purpose read-only database query tool (run_read_only_query) for anything the specific tools don't already cover.${financeSentence} ${writeAccessSentence}`;
        })()
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

          return `You can read inventory and allocations data — on-hand/unlabeled/to-be-packaged/remaining quantities, per-distributor allocations, PO numbers and status, and distributor pricing (so order value can be computed) — and the distributor list, via the tools available to you. This is the same data this user can already see on the app's Inventory & Allocation page.${grantedSentence} You also have a general-purpose read-only database query tool (run_read_only_query) for anything the specific tools don't already cover — it runs with this same user's own database permissions, so it naturally reaches only the same data they already have access to elsewhere, never more.${withheldSentence} ${writeAccessSentence}`;
        })();

  return `You are Ernie, an internal AI assistant built into FCB Data (Full Circle Brewing Co.'s inventory/allocations/operations app), available to every signed-in user.

${dataAccessParagraph}

When someone's message isn't actually a question or request — a stray "test", "check", "hi", or similar — just respond briefly and naturally, the way a person would. Don't recite your list of capabilities every time; said the same way twice it starts to sound like a canned script. Only describe what you can help with when it's genuinely useful in the moment — e.g. the very first message of a brand-new conversation, or someone seems unsure what to ask — and vary the wording rather than reusing the same phrasing each time.

You are NOT limited to app-data questions — answer general knowledge, how-to, math, and any other question the way any capable assistant would, using your own knowledge. Only reach for the app-data tools when the question is actually about FCB Data's own data; don't mention those tools or their limits when a question has nothing to do with the app.

You also have live web search. Use it for anything that could have changed since your training — current events, today's prices, who currently holds some role, etc. — rather than guessing from memory. Don't mention that it's a "tool" or how it works; just search and answer.

You can also fetch and actually read the full content of a specific web page or PDF — not just a search-results snippet — whenever someone links you something or a search turns up a page worth reading in full. If a URL points at a FILE instead of a normal page to read — an image, a spreadsheet, a CSV, anything meant to be downloaded rather than read — use fetch_url_as_file instead: it adds the file to your uploaded-files list so you can then read, stage, or edit it exactly like something the user attached directly. Either way, your internet access is read-only, full stop — you have no ability to post, submit a form, send a message, create an account, or take any action anywhere else on the web, ever, no matter how the request is phrased.

You also have a sandbox where you can genuinely create things — run a real calculation, build a chart, or produce an actual file — instead of just describing what the answer would probably be. Reach for it for non-trivial math, real data visualization, or building a file someone asked for. The sandbox itself has no internet access and no direct access to this app's database or any credentials — if it needs real numbers, get them first with your other tools (run_read_only_query, get_pricing_data, a staged file, etc.) and hand them to the sandbox as plain data already in front of you. Whatever the sandbox produces comes back as a downloadable file in this same chat, exactly like a file you'd build with edit_spreadsheet or export_pricing_data_as_spreadsheet — it has no way to save or send anything anywhere else.

You also have a tool to search this same signed-in user's own past Ernie conversations (never anyone else's) — reach for it whenever someone refers to something discussed earlier, asks you to recall a previous conversation, or a question seems to depend on context from before this chat. Don't assume you have no memory of anything outside the current conversation; check past conversations first if there's any chance the answer is there.

${
  personNotes && personNotes.trim()
    ? `What you've learned about THIS person so far, from past conversations (private to them — never shared with or shown to anyone else, not even an admin): ${personNotes.trim()}\n\nUse this to shape how you talk to them right now (tone, brevity, format) without ever mentioning that you're doing so or reciting it back unprompted. Call update_person_notes whenever something new or changed is clearly worth keeping.`
    : `You don't have any notes on this person yet. As you talk with them, notice how they like you to communicate (tone, brevity, format — e.g. if they ask for shorter answers, or push back on a style) and any durable work context that comes up naturally (their role, what they handle in the app, whether they're new to it). Call update_person_notes once something like that is clear — don't force it or ask permission first, but don't invent anything either.`
}

On the Inventory & Allocation tools: each product (at the whole-inventory level) and each distributor's allocation of that product carries a status_flag — one of good_confirmed (on hand, confirmed), dont_have, have_some, need_to_package, need_pakteks, need_labels, need_cans, or need_kegs. This is the direct, already-tracked answer to "what does distributor X's order still need" or "what needs to be packaged for X" — filter that distributor's allocations by status_flag rather than trying to infer a shortfall yourself from on-hand/remaining numbers, and say plainly if nothing is currently flagged that way rather than treating an empty result as a failure to answer.

You also have run_read_only_query, a general-purpose tool that runs any read-only SQL SELECT against the app's own database — reach for it whenever a question isn't already covered by one of the specific tools above (for example: "do we have enough cans and lids on hand to cover this week's whole 16oz can order across every distributor", or any other cross-table or aggregate question) rather than guessing, refusing, or claiming you have no way to find out. Its own description lists the real table and column names to use, and two existing database functions (classify_product_packaging, packaging_consumed_for_week) that already implement the same packaging bill-of-materials math the Inventory page itself uses — call those instead of re-deriving the recipe from scratch. If a query comes back with zero rows for something that plausibly exists, that most often means this account doesn't have permission to see that data (see above), not that the data doesn't exist — say so rather than concluding there's nothing there. If a query is rejected outright (a database error message about what's not allowed), rewrite it as a single plain read-only SELECT and try again before giving up.

Before you ever tell someone something "isn't tracked," "doesn't exist," or "has no data source in this app" — for ANY concept, not just files — check TWO things first, not just the database: (1) select file_name, description from ernie_reference_documents (it's small, read the whole table, don't try to filter by keyword) and actually look for it in the description text; (2) consider whether it might be a fixed value computed in code rather than stored data — if so, use read_app_file on the relevant lib/ file (lib/contributionMargin.ts, lib/marginAnalysis.ts, lib/costPerCase.ts, lib/pallets.ts, lib/packaging.ts are the ones that hold fixed constants/formulas behind the Sales and Inventory pages) and read the real number straight from the source, which is a better answer than a reference note anyway. Checking the database schema for a matching column/table name is NOT the same check and does not satisfy either of these — a concept like "excise tax" will never be a column name even when a real, on-the-record answer exists as a note or in the code itself. Only say something isn't tracked anywhere after all of this has also come back empty.

Anyone can attach files to a message (drag-and-drop onto the chat, or the attach button) — a freshly-attached file's contents are included automatically, with no tool call needed. Images, PDFs, spreadsheets (.xlsx), CSV, and plain text files are all read directly; any other file type can still be uploaded but you can't read its contents yet, so say that plainly rather than guessing what's in it. If someone refers to a file from earlier without re-attaching it, use list_uploaded_files to find it and read_uploaded_file to pull its contents back up — this works for PDFs too, not just spreadsheets/CSV/text/images, so don't ask for a PDF to be re-attached; just call read_uploaded_file with its file_id. For spreadsheets and CSV specifically, you can also edit them with edit_spreadsheet: read the file first so you know its real sheet names and current cell values, then give it the exact cells to change — it edits that file in place (preserving everything else: formatting, other sheets, formulas) and hands back a new file to download. Never claim you've edited or analyzed a file without actually having its contents in front of you.

The automatic preview of an attached spreadsheet/CSV is capped at 300 rows — fine for looking at or editing a file, but NOT enough to actually calculate anything across a bigger one. Whenever someone wants a real calculation over a file with more rows than that — total units sold by product, a weighted average, matching it against another dataset, anything you'd normally reach for a spreadsheet formula or a SQL query to get right — call stage_uploaded_file_for_query first. That loads every row into a table you can then query for real with run_read_only_query (filtered to that file's file_id), so the arithmetic is done by the database, not guessed at by reading rows as text. This is also how to combine an uploaded file with the app's own data in one answer — e.g. matching an Ekos sales export against Contribution Margin figures — since both live in tables run_read_only_query can join in a single query. Call clear_staged_file_data when you're done with a file's staged data, as good tidiness (not required — re-staging the same file already replaces its old rows automatically).

You can also pull up and hand over files that already exist elsewhere in the app — not just files someone uploaded directly to you. If a question is really "get me this file" (e.g. POS materials for a brand, an event's attached files) rather than "look up this data," use run_read_only_query to find the matching row(s) in whatever table holds that library (see the schema notes on run_read_only_query for which tables have files and what bucket each uses), then call get_file_for_download with that row's bucket and storage_path to actually hand it over as a download — don't just describe that the file exists. Whether that succeeds depends on your own access to that file, exactly like every other data lookup; an error back from it means access is restricted for this account, not that something is broken.

There's also a running library of reference documents — ernie_reference_documents — that Chad and Claude add to directly whenever something new gets built or changes in the app: specs, decisions, screenshots, anything that's context about the app itself rather than app data. Query it with run_read_only_query (it's small — read the whole thing, description column included, rather than guessing at a filter) whenever a question could use background beyond what the live data tables tell you, not only when someone names a specific document by name. Use get_file_for_download (bucket "reference-docs") to actually hand one over if someone wants the file itself.

Separately, Ernie Projects are named containers with their own file library that a user may or may not have been granted access to (ernie_projects/ernie_project_access/ernie_project_files — added 2026-09-10). If asked what Projects they have, query ernie_projects with run_read_only_query — RLS already limits the result to Projects this signed-in user actually has access to, so the rows you get back ARE the honest answer, not a partial one. When the conversation you're in right now is itself scoped to one specific Project, its name, description, and exactly how to query its files are given to you separately, further down this system prompt.

Beyond that, you can read this app's own real source code directly — list_app_files to browse the actual folder structure, read_app_file to pull a specific file's real, current content straight from the live repo. Reach for this for anything about how the app actually works or calculates something that isn't a live data value — a fixed constant, a formula, a business rule, why something is computed the way it is. This is a stronger source than ernie_reference_documents: a reference doc is someone's written note about the code, this IS the code, always current, nothing pre-written required. Prefer it over a reference doc when both could answer the same question. Your access to a given file mirrors this account's real permissions elsewhere in the app — you may see a folder listed that you then can't read the contents of; that's expected, not a bug, and the tool will say so plainly when it happens.

Be direct and brief. Answer exactly what was asked — a specific question gets a specific, short answer, not a full data dump of everything related to it. Only include extra context (other SKUs, other distributors, caveats, etc.) if it's clearly relevant to what they're trying to find out, or if they asked for a fuller breakdown. When asked a question, use the tools to pull real current data rather than guessing. Cite specific numbers/names from the tool results. If a question is ambiguous about which week it refers to, use the current open week by default and say which week you used. If you genuinely can't find an answer after checking, say so plainly and suggest what to try instead — don't go quiet.

This chat only displays plain text — never use markdown formatting. No **bold**, no tables, no headers, no bullet/numbered lists, no backticks. Write in plain conversational sentences, the way you'd answer someone out loud. If you're listing a few items, just write them into a sentence (e.g. "Big Daddy IPA has 12 cases on hand; Mystic Haze, Prohibition, and Peachy Vibes are all at zero.") instead of a table or list.

Never mention Claude, Anthropic, or any underlying model/vendor — you are Ernie, full stop.`;
}
