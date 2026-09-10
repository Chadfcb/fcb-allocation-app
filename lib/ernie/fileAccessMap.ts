import type { Role } from "@/lib/types/db";
import { hasAnySection, type AnySectionKey } from "@/lib/permissions";

// Maps the app's real repo paths to who's allowed to see them through
// Ernie's list_app_files/read_app_file tools (added 2026-09-09, per Chad:
// "i want ernie to have access to all the files... available to everyone
// who has access to ernie, but only the areas that user has access to").
//
// The model, in order of precedence:
//   1. BLOCKED_PATTERNS — off-limits to EVERYONE, admin included. Secrets
//      and vendored/build noise, never app logic.
//   2. OPEN_FILES — safe for anyone with Ernie AI access at all (no
//      business logic, no security config) — repo/build config, shared
//      type declarations.
//   3. An admin (role === "admin" — Manager or Administrator tier) can
//      read anything not blocked. Same "admin bypasses everything"
//      pattern already used for every other Ernie tool
//      (canUseTool/TOOL_SECTIONS in lib/ernie/tools.ts) — an admin
//      already sees all of this in the app itself.
//   4. ADMIN_INFRA_PREFIXES — for a non-admin, blocked regardless of any
//      section grant. This is code that shows how the app's own
//      security/permission system, or Ernie itself, actually works —
//      the file-access equivalent of `profiles` staying admin-only
//      through every other Ernie tool no matter what else is granted.
//   5. SECTION_PATH_MAP — for a non-admin, readable only if they've been
//      granted at least one of the mapped section(s) — same
//      hasAnySection check every other section-gated Ernie tool uses.
//   6. Anything reaching here (a non-admin, unmapped path) is DENIED —
//      safe default, not an oversight. Extend SECTION_PATH_MAP as new
//      pages are added, same practice as lib/permissions.ts's own
//      "add one line" convention.

const BLOCKED_PATTERNS: RegExp[] = [
  /(^|\/)\.env(\.|$)/i,
  /(^|\/)\.git(\/|$)/,
  /(^|\/)node_modules(\/|$)/,
  /(^|\/)\.next(\/|$)/,
  /(^|\/)\.vercel(\/|$)/,
  /secret/i,
  /private[_-]?key/i,
  /service[_-]?account/i,
];

export function isBlockedPath(path: string): boolean {
  return BLOCKED_PATTERNS.some((re) => re.test(path));
}

// No business logic, no credentials — fine for any signed-in user with
// Ernie AI access, regardless of what page sections they have.
const OPEN_FILES = new Set([
  "package.json",
  "package-lock.json",
  "tsconfig.json",
  "next.config.ts",
  "next.config.js",
  "next.config.mjs",
  "tailwind.config.ts",
  "eslint.config.mjs",
  "README.md",
  ".gitignore",
  "lib/types/db.ts",
]);

export function isOpenPath(path: string): boolean {
  return OPEN_FILES.has(path);
}

// Code that exposes how the app's own security/permission system (or
// Ernie itself) works — admin-only through these tools no matter what
// page sections a non-admin has been granted.
const ADMIN_INFRA_PREFIXES = [
  "lib/permissions.ts",
  "lib/ernie/",
  "lib/github.ts",
  "app/api/",
  "middleware.ts",
  "app/layout.tsx",
  "app/(app)/layout.tsx",
  "app/(app)/admin/",
  "app/login/",
  "app/account-setup/",
  "components/Sidebar.tsx",
  "sql/",
  "supabase/",
];

export function isAdminInfraPath(path: string): boolean {
  return ADMIN_INFRA_PREFIXES.some((p) => path === p || path.startsWith(p));
}

// Folder/file -> section key(s) a non-admin needs (any ONE of them) to
// read it. Confirmed against the real repo tree 2026-09-09 — a path not
// listed here is NOT automatically safe to add by guessing; verify the
// real folder first, the same standard used building this list.
const SECTION_PATH_MAP: { prefix: string; sections: AnySectionKey[] }[] = [
  { prefix: "app/(app)/inventory/", sections: ["inventory_allocation"] },
  { prefix: "lib/pallets.ts", sections: ["inventory_allocation"] },
  { prefix: "lib/packaging.ts", sections: ["inventory_allocation"] },
  { prefix: "app/(app)/purchase-orders/", sections: ["purchase_orders"] },
  { prefix: "app/(app)/distributor-inventory/", sections: ["distributor_inventory"] },
  { prefix: "app/(app)/build-orders/", sections: ["build_orders"] },
  { prefix: "app/(app)/pricing/", sections: ["distributor_pricing"] },
  { prefix: "app/(app)/admin/weeks/", sections: ["weeks"] },
  { prefix: "app/(app)/admin/audit/", sections: ["audit_log"] },
  { prefix: "app/(app)/upcs/", sections: ["upcs"] },
  { prefix: "app/(app)/sales/pricing/", sections: ["price_list"] },
  { prefix: "app/(app)/sales/cost-per-case/", sections: ["cost_per_case"] },
  { prefix: "lib/costPerCase.ts", sections: ["cost_per_case"] },
  { prefix: "app/(app)/sales/margin-analysis/", sections: ["margin_analysis"] },
  { prefix: "lib/marginAnalysis.ts", sections: ["margin_analysis"] },
  { prefix: "app/(app)/sales/contribution-margin/", sections: ["contribution_margin"] },
  { prefix: "lib/contributionMargin.ts", sections: ["contribution_margin"] },
  { prefix: "app/(app)/sales/chain-authorizations/", sections: ["chain_authorizations"] },
  { prefix: "app/(app)/sales/chain-mandates/", sections: ["chain_mandates"] },
  // The shared Sales layout isn't tied to one sub-page — any one Sales
  // section grants it, same as get_pricing_data's own TOOL_SECTIONS entry.
  {
    prefix: "app/(app)/sales/layout.tsx",
    sections: ["price_list", "margin_analysis", "cost_per_case", "contribution_margin", "chain_authorizations", "chain_mandates"],
  },
  { prefix: "app/(app)/events/", sections: ["events_calendar"] },
  { prefix: "app/(app)/chain-calendar/", sections: ["events_calendar"] },
  { prefix: "app/(app)/social-media-calendar/", sections: ["events_calendar"] },
  { prefix: "app/(app)/pos/labels/", sections: ["pos_labels"] },
  { prefix: "app/(app)/pos/football/", sections: ["football_pos"] },
  { prefix: "app/(app)/tasks/", sections: ["tasks"] },
  { prefix: "app/(app)/finance/cashflow-dashboard/", sections: ["cashflow_dashboard"] },
  { prefix: "app/(app)/finance/distributor-data/", sections: ["distributor_data"] },
  { prefix: "app/(app)/ernie/", sections: ["ernie_ai"] },
];

function sectionsForPath(path: string): AnySectionKey[] | null {
  const hit = SECTION_PATH_MAP.find((m) => path === m.prefix || path.startsWith(m.prefix));
  return hit ? hit.sections : null;
}

// The one function list_app_files/read_app_file actually call. Given a
// repo path and the requesting user's real (role, sections, isSuperAdmin)
// — same three values every other Ernie tool already receives — returns
// whether they're allowed to see it.
//
// NOTE: isSuperAdmin is accepted for signature symmetry with the rest of
// lib/ernie/tools.ts but deliberately unused here — file access isn't one
// of ADMIN_RESTRICTED_SECTIONS (cashflow_dashboard/distributor_data), so
// every admin (Manager or Administrator) gets the same file access, same
// as almost every other Ernie tool.
export function canAccessRepoPath(
  path: string,
  role: Role | undefined,
  sections: AnySectionKey[],
): boolean {
  if (isBlockedPath(path)) return false;
  if (isOpenPath(path)) return true;
  if (role === "admin") return true;
  if (isAdminInfraPath(path)) return false;
  const required = sectionsForPath(path);
  if (!required) return false;
  return hasAnySection(role, sections, required);
}
