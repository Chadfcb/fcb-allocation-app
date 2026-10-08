"use client";

// Left-hand navigation sidebar. Every link below is shown based on the
// signed-in person's per-section access (see lib/permissions.ts) — an admin
// sees everything unconditionally; a Basic user sees exactly the sections
// an admin has granted them from Users > Edit, nothing more. Dashboard and
// Users management are the two exceptions: they stay admin-only, full
// stop, same as always — they aren't grantable sections.
//
// Three independent bits of UI state:
// - Whether Operations/Sales/Calendars are expanded — remembered per-browser
//   via localStorage, so collapsing one stays collapsed next time you load
//   the app. Calendars (added 2026-09-04) holds just Events Calendar today,
//   structured as an expandable parent rather than a flat link since more
//   calendar types are expected to land under it later.
// - Whether the whole sidebar is hidden — NOT persisted; it always starts
//   visible on a fresh page load, per Chad's request.
// - Nothing about WHICH links show is persisted — that comes fresh from
//   the server on every load via the `sections` prop.
//
// "New!" badges (added 2026-09-05, per Chad): when a brand-new section or
// sub-link is added to the sidebar, it can carry a small green "New!" tag
// lined up on the right, so people notice it landed. Add its id to
// NEW_SIDEBAR_IDS below when you add the item — a genuine sub-tree parent
// (like a brand under Labels/UPC's) uses a synthetic "section:<name>" id
// since it has no href of its own; a regular link just uses its href. A
// TOP-LEVEL parent (Operations, Sales, Calendars, Labels, UPC's) does NOT
// need an entry here at all — sectionShowsNew() (defined further down,
// inside the component) computes its badge automatically from whatever's
// still unseen underneath it, so there's nothing to remember when you add
// a new sub-item. (This replaced an earlier manual-only version of this
// system, after Operations shipped a new sub-tree without its own button
// ever lighting up — see sectionShowsNew()'s comment for the story.) The
// badge disappears the first time that person clicks it and never comes
// back — remembered server-side per signed-in person (sidebar_new_seen
// table), not just in this browser, so it stays dismissed on every device
// they log in from. Nothing existing today is flagged; per Chad, this is
// only for things added from here forward, not retroactive for Chain
// Calendar/Social Media Calendar/etc. which already existed before this
// feature shipped. Once something's been out for a while, just delete its
// id from the list below — no need to keep it around forever.

import { useState, useEffect } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import type { Role } from "@/lib/types/db";
import { hasSection, ERNIE_SECTION, type AnySectionKey, type SectionKey } from "@/lib/permissions";
import { createClient } from "@/lib/supabase/client";
import NewBadge from "@/components/NewBadge";
import { NEW_FEATURES, NEW_SEEN_EVENT, featureIdsOnPage } from "@/lib/newFeatures";

const NEW_SIDEBAR_IDS: string[] = [
  // Only actual leaf pages and true sub-tree parents (like a brand under
  // Labels/UPC's) need to go in this list. A top-level parent — Calendars,
  // Operations, Labels, UPC's, Sales — does NOT need its own entry
  // anymore: sectionShowsNew() (below, in the component) computes those
  // automatically from whatever's still unseen underneath them. That's a
  // 2026-09-05 fix, per Chad, after Operations shipped the Labels
  // Oobli/Ugly Fresca brands and the whole UPC's tree without its own
  // button ever lighting up — it had needed a manually-added
  // "section:operations" entry here that nobody remembered to add. Same
  // fix applies to Calendars/Labels/UPC's/Sales so it can't happen again
  // anywhere in the tree, not just Operations.
  "/chain-calendar",
  "/social-media-calendar",
  // Oobli and Ugly Fresca — new brands added under Labels (2026-09-05),
  // per Chad: "remember, these will be new to everyone."
  "section:pos-labels-oobli",
  "/pos/labels/oobli/16oz",
  "section:pos-labels-ugly-fresca",
  "/pos/labels/ugly-fresca/19-2oz",
  "/pos/labels/ugly-fresca/16oz",
  "/pos/labels/ugly-fresca/12oz",
  // Other — new catch-all brand under Labels (2026-09-05), per Chad, for
  // one-off custom labels like Spartan Ale.
  "section:pos-labels-other",
  "/pos/labels/other/12oz",
  // UPC's — new expandable brand+size tree added under Operations
  // (2026-09-05), set up exactly like Labels. Every page under it is brand
  // new, so every brand and every size leaf are flagged (the UPC's parent
  // itself picks this up automatically, per the note above). (Audit Log
  // moved the same day too, but that's a relocation of something that
  // already existed, not new content, so it isn't flagged.)
  "section:upc-fcb",
  "/upcs/fcb/19-2oz",
  "/upcs/fcb/16oz",
  "/upcs/fcb/12oz",
  "section:upc-speakeasy",
  "/upcs/speakeasy/19-2oz",
  "/upcs/speakeasy/16oz",
  "/upcs/speakeasy/12oz",
  "section:upc-sonoma-cider",
  "/upcs/sonoma-cider/19-2oz",
  "/upcs/sonoma-cider/16oz",
  "/upcs/sonoma-cider/12oz",
  "section:upc-oobli",
  "/upcs/oobli/16oz",
  "section:upc-ugly-fresca",
  "/upcs/ugly-fresca/19-2oz",
  "/upcs/ugly-fresca/16oz",
  "/upcs/ugly-fresca/12oz",
  // Chain Authorizations / Chain Mandates — new Sales sub-links, added
  // 2026-09-05, per Chad.
  "/sales/chain-authorizations",
  "/sales/chain-mandates",
  // Accounts — new Sales sub-link, added 2026-10-07, per Chad + Art.
  "/sales/accounts",
  // Tanks — new 3D tank view under MAIN, right below Dashboard (2026-10-03),
  // per Chad.
  "/tanks",
  // Sales Dashboard — new page under MAIN, right below Tanks (2026-10-08),
  // per Chad.
  "/sales-dashboard",
  // Football POS — new POS sub-link, added 2026-09-05, per Chad.
  "/pos/football",
  // Cash Flow Dashboard — new Finance section, added 2026-09-09, per Chad.
  "/finance/cashflow-dashboard",
  // Distributor Data — new Finance sub-link, added 2026-09-09, per Chad.
  "/finance/distributor-data",
  // Batch Ingredients — new Operations sub-link, added 2026-09-16, per Chad.
  "/batch-ingredients",
  // Ekos Sync — new page under the new Admin category, added 2026-10-03,
  // per Chad. (Users and Audit Log moved into Admin the same day — a move,
  // not new content, so they aren't flagged.)
  "/admin/ekos-sync",
];

// NewBadge now lives in components/NewBadge.tsx (shared with in-page
// buttons — see lib/newFeatures.ts).

// Finance — new top-level category, added 2026-09-09, sits above
// Operations. Distributor Data (added same day) holds each distributor's
// payment terms and any other distributor-level finance data that comes
// up later.
const FINANCE_LINKS: { href: string; label: string; section: SectionKey }[] = [
  { href: "/finance/cashflow-dashboard", label: "Cash Flow Dashboard", section: "cashflow_dashboard" },
  { href: "/finance/distributor-data", label: "Distributor Data", section: "distributor_data" },
];

const OPERATIONS_LINKS: { href: string; label: string; section: SectionKey }[] = [
  { href: "/purchase-orders", label: "Purchase Orders", section: "purchase_orders" },
  { href: "/inventory", label: "Inventory & Allocation", section: "inventory_allocation" },
  { href: "/distributor-inventory", label: "Distributor Inventory", section: "distributor_inventory" },
  { href: "/build-orders", label: "Build Orders", section: "build_orders" },
  { href: "/pricing", label: "Distributor Pricing", section: "distributor_pricing" },
  { href: "/admin/weeks", label: "Weeks", section: "weeks" },
  // Audit Log used to be last here — moved out to its own top-level nav
  // entry below Users (see the standalone Link further down), per Chad,
  // 2026-09-05: "lets move audit log to a main category, below Users, and
  // out of operations." UPC's (new, same date) is no longer a flat link
  // here either — like Labels, it's now its own expandable brand tree
  // (see UPC_BRANDS / showUpcTree below) rendered right after Labels.
  //
  // Batch Ingredients — new standalone page, added 2026-09-16 per Chad,
  // positioned right below UPC's. Placed after the Weeks entry here (not
  // before it) so it lands in opsAfterLabels below, which renders after
  // the Labels/UPC's tree block rather than before it.
  { href: "/batch-ingredients", label: "Batch Ingredients", section: "batch_ingredients" },
];

// Sales sub-links get added here one at a time as each piece of the old FCB
// Pricing desktop app is folded in — Price List first, then Margin Analysis,
// Cost Per Case, and Contribution Margin.
const SALES_LINKS: { href: string; label: string; section: SectionKey }[] = [
  // Accounts — added 2026-10-07, per Chad + Art (sales system Feature 1).
  // First in the Sales list since it's the base the rest of the sales
  // system builds on.
  { href: "/sales/accounts", label: "Accounts", section: "accounts" },
  { href: "/sales/pricing", label: "Price List", section: "price_list" },
  { href: "/sales/margin-analysis", label: "Margin Analysis", section: "margin_analysis" },
  { href: "/sales/cost-per-case", label: "Cost Per Case", section: "cost_per_case" },
  { href: "/sales/contribution-margin", label: "Contribution Margin", section: "contribution_margin" },
  // Added 2026-09-05, per Chad, imported from a chain authorizations/
  // mandates spreadsheet. Not their own Users > Edit toggle — they ride
  // along with Sales access, same as every other link in this list (see
  // lib/permissions.ts SECTION_GROUPS).
  { href: "/sales/chain-authorizations", label: "Chain Authorizations", section: "chain_authorizations" },
  { href: "/sales/chain-mandates", label: "Chain Mandates", section: "chain_mandates" },
];

// Calendars — currently just Events Calendar, structured as an expandable
// parent (like Operations/Sales) rather than a flat link, since Chad plans
// to add more calendar types under this same category later.
const CALENDARS_LINKS: { href: string; label: string; section: SectionKey }[] = [
  { href: "/events", label: "Events Calendar", section: "events_calendar" },
  { href: "/chain-calendar", label: "Chain Calendar", section: "events_calendar" },
  { href: "/social-media-calendar", label: "Social Media Calendar", section: "events_calendar" },
];

const FINANCE_STORAGE_KEY = "fcb-sidebar-finance-expanded";
const OPERATIONS_STORAGE_KEY = "fcb-sidebar-operations-expanded";
const SALES_STORAGE_KEY = "fcb-sidebar-sales-expanded";
const CALENDARS_STORAGE_KEY = "fcb-sidebar-calendars-expanded";
const ERNIE_STORAGE_KEY = "fcb-sidebar-ernie-expanded";

// Ernie AI — split into two sub-links, added 2026-09-10 per Chad ("we need
// to separate them, instead of having them together, its too convoluted the
// way it is currently"): the previous single "Ernie AI" link opened a page
// that mixed the personal/General chat and the whole Projects tab-and-tile
// UI together in one view. "My Ernie AI" (/ernie) is now the plain personal
// chat only — no Project tiles, no Completed Projects — and "Projects"
// (/ernie/projects) is its own page for creating/opening Projects. Both
// still gated by the same "ernie_ai" section grant as before — this only
// splits the ONE page into two, it doesn't add a new permission.
// Admin — new top-level category, added 2026-10-03, per Chad: "Lets make a
// new Admin Category, that has sub categories of Users, Audit Log, Ekos
// Sync." Users and Audit Log keep their same pages, addresses and access
// rules (Users: admins only; Audit Log: the "audit_log" section) — they're
// just grouped here now instead of standing alone.
const ADMIN_STORAGE_KEY = "fcb-sidebar-admin-expanded";
const ADMIN_LINKS: { href: string; label: string; section?: SectionKey }[] = [
  { href: "/admin/users", label: "Users" },
  { href: "/admin/audit", label: "Audit Log", section: "audit_log" },
  { href: "/admin/ekos-sync", label: "Ekos Sync" },
];

const ERNIE_LINKS: { href: string; label: string }[] = [
  { href: "/ernie", label: "My Ernie AI" },
  { href: "/ernie/projects", label: "Projects" },
];

type TopLevelCategory = "ernie" | "finance" | "operations" | "sales" | "calendars" | "pos" | "admin";

// Which top-level category (if any) a given pathname belongs to — added
// 2026-09-10, per Chad ("we built in that other categories would close if
// you move to a different, what happened here?"). The accordion behavior
// below (closeOtherTopLevelSections) only ever ran when a category's own
// HEADER was clicked to open it — clicking a sub-link inside an
// already-expanded category (the normal way to actually navigate) never
// triggered it, so e.g. leaving Operations expanded and clicking straight
// into a Finance sub-link left Operations sitting open too. This never
// showed up before because Ernie AI used to be a single flat link with no
// sub-links to click into — splitting it into "My Ernie AI"/"Projects" is
// what exposed the gap. Fixed by expanding/collapsing based on the ACTUAL
// CURRENT PAGE (see the effect below) rather than only on a header click.
function topLevelCategoryForPath(pathname: string): TopLevelCategory | null {
  if (pathname.startsWith("/ernie")) return "ernie";
  if (FINANCE_LINKS.some((l) => l.href === pathname)) return "finance";
  if (
    OPERATIONS_LINKS.some((l) => l.href === pathname) ||
    pathname.startsWith("/pos/labels") ||
    pathname.startsWith("/upcs")
  ) {
    return "operations";
  }
  if (SALES_LINKS.some((l) => l.href === pathname)) return "sales";
  if (CALENDARS_LINKS.some((l) => l.href === pathname)) return "calendars";
  if (POS_LINKS.some((l) => l.href === pathname)) return "pos";
  if (ADMIN_LINKS.some((l) => l.href === pathname)) return "admin";
  return null;
}

// POS — restored 2026-09-05 as its own top-level nav section, per Chad,
// after "move Labels out of POS" got read too literally and the whole POS
// entry disappeared along with it (Labels was the only thing under it, and
// an empty top-level section doesn't render on its own — see the
// showPosSection check below). Labels itself correctly stays under
// Operations; POS started back out empty, on purpose, for Chad to add new
// items to — Football POS (added same day) is its first one: a flat file
// library of football-season POS art, no brand/size nesting like Labels.
const POS_STORAGE_KEY = "fcb-sidebar-pos-expanded";
const POS_LINKS: { href: string; label: string; section: SectionKey }[] = [
  { href: "/pos/football", label: "Football POS", section: "football_pos" },
];

// Labels > <brand> > <size> — a nested tree (unlike Operations/Sales' other
// links, which are one level of flat links), so its expand/collapse state
// is a single JSON blob keyed by node id rather than one boolean per
// section. The whole tree shares one section ('pos_labels' — the
// underlying SectionKey name is unchanged even though it's not nested
// under a "POS" nav entry anymore).
//
// Labels used to be its own top-level "POS" section here, matching a
// same-named top-level "POS" grant category in lib/permissions.ts. Per
// Chad, 2026-09-05: "Labels needs to be a sub category of Operations...
// remove it from POS" — moved it to render inside Operations below,
// right after Weeks, matching the same move already made in
// lib/permissions.ts's SECTION_GROUPS. POS no longer appears as its own
// nav entry at all (it would have nothing left under it).
const POS_TREE_STORAGE_KEY = "fcb-sidebar-pos-tree-expanded";
// Only the two top-level tree ids get remembered across page loads — a
// brand row (e.g. "pos-labels-fcb") always starts collapsed each time you
// open Labels/UPC's, so clicking "Labels" only ever reveals the 5 brand
// names, never cascades open whichever brands you'd previously clicked
// into. Fixed 2026-09-05 per Chad, after brand-level expand state (which
// used to get saved right alongside the top-level state) made "Labels"
// look like it was opening everything at once.
const PERSISTED_POS_TREE_KEYS = ["pos-labels", "upcs"];

const POS_LABEL_BRANDS: {
  treeKey: string;
  label: string;
  sizes: { href: string; label: string }[];
}[] = [
  {
    treeKey: "pos-labels-fcb",
    label: "FCB",
    sizes: [
      { href: "/pos/labels/fcb/19-2oz", label: "19.2 oz Labels" },
      { href: "/pos/labels/fcb/16oz", label: "16 oz Labels" },
      { href: "/pos/labels/fcb/12oz", label: "12 oz Labels" },
    ],
  },
  {
    treeKey: "pos-labels-speakeasy",
    label: "Speakeasy",
    sizes: [
      { href: "/pos/labels/speakeasy/19-2oz", label: "19.2 oz Labels" },
      { href: "/pos/labels/speakeasy/16oz", label: "16 oz Labels" },
      { href: "/pos/labels/speakeasy/12oz", label: "12 oz Labels" },
    ],
  },
  {
    treeKey: "pos-labels-sonoma-cider",
    label: "Sonoma Cider",
    sizes: [
      { href: "/pos/labels/sonoma-cider/19-2oz", label: "19.2 oz Labels" },
      { href: "/pos/labels/sonoma-cider/16oz", label: "16 oz Labels" },
      { href: "/pos/labels/sonoma-cider/12oz", label: "12 oz Labels" },
    ],
  },
  // Oobli and Ugly Fresca — added 2026-09-05, flagged New! below since
  // they're brand new to everyone (see NEW_SIDEBAR_IDS at the top of this
  // file).
  {
    // Oobli only ships in 16oz, per Chad 2026-09-05 — no 19.2oz/12oz sizes.
    treeKey: "pos-labels-oobli",
    label: "Oobli",
    sizes: [{ href: "/pos/labels/oobli/16oz", label: "16 oz Labels" }],
  },
  {
    treeKey: "pos-labels-ugly-fresca",
    label: "Ugly Fresca",
    sizes: [
      { href: "/pos/labels/ugly-fresca/19-2oz", label: "19.2 oz Labels" },
      { href: "/pos/labels/ugly-fresca/16oz", label: "16 oz Labels" },
      { href: "/pos/labels/ugly-fresca/12oz", label: "12 oz Labels" },
    ],
  },
  {
    // Catch-all for one-off custom labels that aren't one of FCB's own
    // brands (e.g. Spartan Ale, made for San Jose State University) — added
    // 2026-09-05, per Chad: "add a new sub category called Other, put the
    // spartan ale in there." Only a 12oz bucket, since there's no reason to
    // expect other sizes of a one-off label.
    treeKey: "pos-labels-other",
    label: "Other",
    sizes: [{ href: "/pos/labels/other/12oz", label: "12 oz Labels" }],
  },
];

// UPC's > <brand> > <size> — added 2026-09-05, per Chad: "UPC has sub
// categories, Same Sub categories as Labels," then, after seeing a
// brand-only first pass: "no, incorrect, i want it set up exactly like
// the labels is." So this now mirrors POS_LABEL_BRANDS exactly — same
// brands, same three sizes each, same two-level tree, just a Product/UPC
// table on each size's page instead of a file library. Reuses the same
// posTreeExpanded collapse-state map as Labels (it's just a generic
// id -> expanded record); this tree's own ids are prefixed "upc-" so they
// don't collide with Labels' "pos-labels-*" keys.
const UPC_BRANDS: {
  treeKey: string;
  label: string;
  sizes: { href: string; label: string }[];
}[] = [
  {
    treeKey: "upc-fcb",
    label: "FCB",
    sizes: [
      { href: "/upcs/fcb/19-2oz", label: "19.2 oz UPC's" },
      { href: "/upcs/fcb/16oz", label: "16 oz UPC's" },
      { href: "/upcs/fcb/12oz", label: "12 oz UPC's" },
    ],
  },
  {
    treeKey: "upc-speakeasy",
    label: "Speakeasy",
    sizes: [
      { href: "/upcs/speakeasy/19-2oz", label: "19.2 oz UPC's" },
      { href: "/upcs/speakeasy/16oz", label: "16 oz UPC's" },
      { href: "/upcs/speakeasy/12oz", label: "12 oz UPC's" },
    ],
  },
  {
    treeKey: "upc-sonoma-cider",
    label: "Sonoma Cider",
    sizes: [
      { href: "/upcs/sonoma-cider/19-2oz", label: "19.2 oz UPC's" },
      { href: "/upcs/sonoma-cider/16oz", label: "16 oz UPC's" },
      { href: "/upcs/sonoma-cider/12oz", label: "12 oz UPC's" },
    ],
  },
  {
    // Oobli only ships in 16oz, per Chad 2026-09-05 — no 19.2oz/12oz sizes.
    treeKey: "upc-oobli",
    label: "Oobli",
    sizes: [{ href: "/upcs/oobli/16oz", label: "16 oz UPC's" }],
  },
  {
    treeKey: "upc-ugly-fresca",
    label: "Ugly Fresca",
    sizes: [
      { href: "/upcs/ugly-fresca/19-2oz", label: "19.2 oz UPC's" },
      { href: "/upcs/ugly-fresca/16oz", label: "16 oz UPC's" },
      { href: "/upcs/ugly-fresca/12oz", label: "12 oz UPC's" },
    ],
  },
];

// Every id nested under the Labels tree, for sectionShowsNew() to check
// when deciding whether the Labels button itself (and, one level up,
// Operations) should show New!.
function labelsDescendantIds(): string[] {
  return POS_LABEL_BRANDS.flatMap((b) => [
    `section:${b.treeKey}`,
    ...b.sizes.map((s) => s.href),
  ]);
}

// Same idea, for the UPC's tree.
function upcDescendantIds(): string[] {
  return UPC_BRANDS.flatMap((b) => [
    `section:${b.treeKey}`,
    ...b.sizes.map((s) => s.href),
  ]);
}

export default function Sidebar({
  role,
  sections,
  isSuperAdmin,
}: {
  role: Role | undefined;
  sections: AnySectionKey[];
  // Administrator (true) vs Manager (false/undefined) — only matters for
  // ADMIN_RESTRICTED_SECTIONS (today just Finance's cashflow_dashboard, see
  // lib/permissions.ts). Added 2026-09-09, per Chad: being an admin no
  // longer automatically shows Finance in the sidebar.
  isSuperAdmin?: boolean;
}) {
  const pathname = usePathname();
  const [hidden, setHidden] = useState(false);
  // Facelift (2026-10-03): the MAIN and DEPARTMENTS group labels can fold
  // their group away. Not remembered — they start open on every page load.
  const [mainOpen, setMainOpen] = useState(true);
  const [departmentsOpen, setDepartmentsOpen] = useState(true);
  // Admins see a small Ekos sync status card at the bottom of the sidebar
  // (latest automatic/Run now/pasted runs from sync_runs, admin-readable).
  const [ekosStatus, setEkosStatus] = useState<{ title: string; detail: string; color: string } | null>(null);
  const [ernieExpanded, setErnieExpanded] = useState(true);
  const [financeExpanded, setFinanceExpanded] = useState(true);
  const [operationsExpanded, setOperationsExpanded] = useState(true);
  const [salesExpanded, setSalesExpanded] = useState(true);
  const [calendarsExpanded, setCalendarsExpanded] = useState(true);
  const [posExpanded, setPosExpanded] = useState(true);
  const [adminExpanded, setAdminExpanded] = useState(true);
  const [posTreeExpanded, setPosTreeExpanded] = useState<
    Record<string, boolean>
  >({ "pos-labels": true, upcs: true });
  const [seenNew, setSeenNew] = useState<Record<string, true>>({});
  // Which "New!" badges this signed-in person has already dismissed —
  // stored server-side (sidebar_new_seen table) rather than in this
  // browser's localStorage, so a badge stays dismissed no matter which
  // device or browser they next log in from. Created once and reused for
  // the life of this component.
  const [supabase] = useState(() => createClient());

  useEffect(() => {
    // Hydrate persisted expand/collapse prefs after mount rather than in the
    // initial useState — reading localStorage during the initializer would
    // mismatch between server render (no localStorage) and client.
    const storedAdmin = localStorage.getItem(ADMIN_STORAGE_KEY);
    if (storedAdmin !== null) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- intentional post-mount hydration from localStorage
      setAdminExpanded(storedAdmin === "true");
    }
    const storedErnie = localStorage.getItem(ERNIE_STORAGE_KEY);
    if (storedErnie !== null) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- intentional post-mount hydration from localStorage
      setErnieExpanded(storedErnie === "true");
    }
    const storedFinance = localStorage.getItem(FINANCE_STORAGE_KEY);
    if (storedFinance !== null) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- intentional post-mount hydration from localStorage
      setFinanceExpanded(storedFinance === "true");
    }
    const storedOperations = localStorage.getItem(OPERATIONS_STORAGE_KEY);
    if (storedOperations !== null) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- intentional post-mount hydration from localStorage
      setOperationsExpanded(storedOperations === "true");
    }
    const storedSales = localStorage.getItem(SALES_STORAGE_KEY);
    if (storedSales !== null) {
      setSalesExpanded(storedSales === "true");
    }
    const storedCalendars = localStorage.getItem(CALENDARS_STORAGE_KEY);
    if (storedCalendars !== null) {
      setCalendarsExpanded(storedCalendars === "true");
    }
    const storedPos = localStorage.getItem(POS_STORAGE_KEY);
    if (storedPos !== null) {
      setPosExpanded(storedPos === "true");
    }
    const storedPosTree = localStorage.getItem(POS_TREE_STORAGE_KEY);
    if (storedPosTree) {
      try {
        const parsed = JSON.parse(storedPosTree) as Record<string, boolean>;
        // Only hydrate the two top-level keys — ignore any brand-level
        // entries that may be sitting in older, already-saved localStorage
        // from before this fix, so they don't cascade back open.
        const filtered: Record<string, boolean> = {};
        for (const key of PERSISTED_POS_TREE_KEYS) {
          if (key in parsed) filtered[key] = parsed[key];
        }
        setPosTreeExpanded((prev) => ({
          ...prev,
          ...filtered,
        }));
      } catch {
        // Ignore malformed/stale localStorage content.
      }
    }
  }, []);

  // Expand whichever top-level category the CURRENT PAGE belongs to and
  // collapse the rest — added 2026-09-10 (see topLevelCategoryForPath
  // above for why). Runs after the hydration effect above, so it correctly
  // overrides whatever localStorage happened to have saved: which section
  // is open should always match where you actually are once you've
  // navigated somewhere. A page that isn't under any category (Dashboard,
  // Tasks, Users, Audit Log) collapses all of them, matching "moving to a
  // different section" generally, not just to another categorized page.
  useEffect(() => {
    const active = topLevelCategoryForPath(pathname);
    const sections: Array<{
      key: TopLevelCategory;
      setExpanded: (value: boolean) => void;
      storageKey: string;
    }> = [
      { key: "ernie", setExpanded: setErnieExpanded, storageKey: ERNIE_STORAGE_KEY },
      { key: "finance", setExpanded: setFinanceExpanded, storageKey: FINANCE_STORAGE_KEY },
      { key: "operations", setExpanded: setOperationsExpanded, storageKey: OPERATIONS_STORAGE_KEY },
      { key: "sales", setExpanded: setSalesExpanded, storageKey: SALES_STORAGE_KEY },
      { key: "calendars", setExpanded: setCalendarsExpanded, storageKey: CALENDARS_STORAGE_KEY },
      { key: "pos", setExpanded: setPosExpanded, storageKey: POS_STORAGE_KEY },
      { key: "admin", setExpanded: setAdminExpanded, storageKey: ADMIN_STORAGE_KEY },
    ];
    for (const section of sections) {
      const shouldBeOpen = section.key === active;
      // eslint-disable-next-line react-hooks/set-state-in-effect -- syncing sidebar expand state to the current route, not a UI-driven update
      section.setExpanded(shouldBeOpen);
      localStorage.setItem(section.storageKey, String(shouldBeOpen));
    }
  }, [pathname]);

  useEffect(() => {
    // Pull this person's previously-dismissed "New!" badges from the
    // database on mount — nothing to fetch if nothing's currently flagged.
    if (NEW_SIDEBAR_IDS.length === 0 && NEW_FEATURES.length === 0) return;
    let cancelled = false;
    (async () => {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) return;
      const { data } = await supabase.from("sidebar_new_seen").select("item_id").eq("user_id", user.id);
      if (cancelled || !data) return;
      const next: Record<string, true> = {};
      for (const row of data) next[row.item_id] = true;
      setSeenNew(next);
    })();
    return () => {
      cancelled = true;
    };
  }, [supabase]);

  // A new button/feature inside a page (lib/newFeatures.ts) being clicked
  // clears its trail here immediately, without a reload.
  useEffect(() => {
    const onSeen = (e: Event) => {
      const id = (e as CustomEvent<string>).detail;
      if (typeof id === "string") setSeenNew((prev) => ({ ...prev, [id]: true as const }));
    };
    window.addEventListener(NEW_SEEN_EVENT, onSeen);
    return () => window.removeEventListener(NEW_SEEN_EVENT, onSeen);
  }, []);

  // Whether a "New!" badge should currently show for this id — flagged in
  // NEW_SIDEBAR_IDS above and not yet clicked by this person, OR (added
  // 2026-09-23, the "chain" per Chad) this is a page link and that page
  // has a new in-page button/feature (lib/newFeatures.ts) this person
  // hasn't clicked yet. Clicking the page link itself doesn't clear the
  // feature part — only clicking the new button does — so the trail
  // (section → page → button) stays lit until they actually find it.
  // Parent sections pick this up automatically via sectionShowsNew().
  useEffect(() => {
    if (role !== "admin") return;
    let cancelled = false;
    (async () => {
      try {
        const { data, error } = await supabase
          .from("sync_runs")
          .select("source, status, started_at")
          .like("source", "ekos_%")
          .order("started_at", { ascending: false })
          .limit(10);
        if (cancelled || error || !data || data.length === 0) return;
        // Latest run of each Ekos source.
        const latest = new Map<string, { status: string; started_at: string }>();
        for (const r of data as { source: string; status: string; started_at: string }[]) {
          if (!latest.has(r.source)) latest.set(r.source, r);
        }
        const runs = [...latest.values()];
        const newest = runs.reduce((a, b) => (a.started_at > b.started_at ? a : b));
        const when = new Date(newest.started_at).toLocaleString("en-US", {
          month: "short",
          day: "numeric",
          hour: "numeric",
          minute: "2-digit",
        });
        const failed = runs.some((r) => r.status === "failed");
        const issues = runs.some((r) => r.status === "issues");
        setEkosStatus(
          failed
            ? { title: "Ekos sync failed", detail: `Last run ${when}. Open Ekos Sync for details.`, color: "#f87171" }
            : issues
              ? { title: "Ekos sync needs a look", detail: `Last run ${when}. Open Ekos Sync for details.`, color: "#ffc266" }
              : { title: "Ekos sync healthy", detail: `Last run ${when}. Runs weekdays 4–5am.`, color: "var(--fcb-accent)" },
        );
      } catch {
        // No status card if it can't be read — never breaks the sidebar.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [role, supabase]);

  function showsNew(id: string) {
    if (NEW_SIDEBAR_IDS.includes(id) && !seenNew[id]) return true;
    return featureIdsOnPage(id).some((featureId) => !seenNew[featureId]);
  }

  // First click on a flagged item retires its badge for good — recorded
  // against this person's account, so it stays gone on every device/
  // browser they sign in from, not just this one.
  function dismissNew(id: string) {
    if (!NEW_SIDEBAR_IDS.includes(id) || seenNew[id]) return;
    setSeenNew((prev) => ({ ...prev, [id]: true as const }));
    (async () => {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) return;
      await supabase.from("sidebar_new_seen").upsert(
        { user_id: user.id, item_id: id },
        { onConflict: "user_id,item_id", ignoreDuplicates: true },
      );
    })();
  }

  // A parent section/tree also shows New! automatically whenever anything
  // still-unseen is nested inside it — added 2026-09-05 per Chad, after
  // Operations shipped Labels' Oobli/Ugly Fresca and the whole UPC's tree
  // without its own button ever lighting up: "operations didnt tell me
  // something new was added inside it... i can see the new next to all
  // the new things [but not on Operations itself]." Root cause was that a
  // parent's badge only ever showed if I remembered to separately add
  // "section:<name>" to NEW_SIDEBAR_IDS by hand — easy to forget, and
  // exactly what happened here. This replaces that manual step: pass every
  // descendant id (including nested parent ids, so it recurses through
  // Labels/UPC's brand trees too) and it returns true if the parent's own
  // id happens to be flagged+unseen OR any descendant still is. Going
  // forward, adding a new sub-item only ever needs its own id added to
  // NEW_SIDEBAR_IDS — every ancestor picks it up automatically, nothing
  // else to remember.
  function sectionShowsNew(id: string, descendantIds: string[] = []) {
    if (showsNew(id)) return true;
    return descendantIds.some((childId) => showsNew(childId));
  }

  // Accordion behavior for the four top-level sections — added 2026-09-05
  // per Chad: "if i click out of a section... and go to a different
  // section, i want the last one to collapse as well." Opening any one of
  // Operations/Sales/POS/Calendars now closes the other three, so at most
  // one is ever expanded at a time. Closing the section you're currently
  // in still just closes it, same as before — this only kicks in when a
  // section is being opened.
  function closeOtherTopLevelSections(except: TopLevelCategory) {
    if (except !== "admin") {
      setAdminExpanded(false);
      localStorage.setItem(ADMIN_STORAGE_KEY, "false");
    }
    if (except !== "ernie") {
      setErnieExpanded(false);
      localStorage.setItem(ERNIE_STORAGE_KEY, "false");
    }
    if (except !== "finance") {
      setFinanceExpanded(false);
      localStorage.setItem(FINANCE_STORAGE_KEY, "false");
    }
    if (except !== "operations") {
      setOperationsExpanded(false);
      localStorage.setItem(OPERATIONS_STORAGE_KEY, "false");
    }
    if (except !== "sales") {
      setSalesExpanded(false);
      localStorage.setItem(SALES_STORAGE_KEY, "false");
    }
    if (except !== "calendars") {
      setCalendarsExpanded(false);
      localStorage.setItem(CALENDARS_STORAGE_KEY, "false");
    }
    if (except !== "pos") {
      setPosExpanded(false);
      localStorage.setItem(POS_STORAGE_KEY, "false");
    }
  }

  function toggleAdmin() {
    setAdminExpanded((prev) => {
      const next = !prev;
      localStorage.setItem(ADMIN_STORAGE_KEY, String(next));
      if (next) closeOtherTopLevelSections("admin");
      return next;
    });
  }

  function toggleErnie() {
    setErnieExpanded((prev) => {
      const next = !prev;
      localStorage.setItem(ERNIE_STORAGE_KEY, String(next));
      if (next) closeOtherTopLevelSections("ernie");
      return next;
    });
  }

  function toggleFinance() {
    setFinanceExpanded((prev) => {
      const next = !prev;
      localStorage.setItem(FINANCE_STORAGE_KEY, String(next));
      if (next) closeOtherTopLevelSections("finance");
      return next;
    });
  }

  function toggleOperations() {
    setOperationsExpanded((prev) => {
      const next = !prev;
      localStorage.setItem(OPERATIONS_STORAGE_KEY, String(next));
      if (next) closeOtherTopLevelSections("operations");
      return next;
    });
  }

  function toggleSales() {
    setSalesExpanded((prev) => {
      const next = !prev;
      localStorage.setItem(SALES_STORAGE_KEY, String(next));
      if (next) closeOtherTopLevelSections("sales");
      return next;
    });
  }

  function toggleCalendars() {
    setCalendarsExpanded((prev) => {
      const next = !prev;
      localStorage.setItem(CALENDARS_STORAGE_KEY, String(next));
      if (next) closeOtherTopLevelSections("calendars");
      return next;
    });
  }

  function togglePos() {
    setPosExpanded((prev) => {
      const next = !prev;
      localStorage.setItem(POS_STORAGE_KEY, String(next));
      if (next) closeOtherTopLevelSections("pos");
      return next;
    });
  }

  function togglePosTree(key: string) {
    setPosTreeExpanded((prev) => {
      let next = { ...prev, [key]: !prev[key] };
      // Opening the top-level Labels/UPC's tree always starts every brand
      // row collapsed underneath it — clicking "Labels" should only ever
      // reveal the 5 brand names, never whichever ones happened to be left
      // open from earlier in this same browsing session.
      if (key === "pos-labels" && next[key]) {
        for (const b of POS_LABEL_BRANDS) next = { ...next, [b.treeKey]: false };
      }
      if (key === "upcs" && next[key]) {
        for (const b of UPC_BRANDS) next = { ...next, [b.treeKey]: false };
      }
      // Only persist the top-level Labels/UPC's open-closed state — brand
      // rows (e.g. "pos-labels-fcb") stay in-memory only for this page
      // load, so they never carry over and cascade open next time.
      if (PERSISTED_POS_TREE_KEYS.includes(key)) {
        const toPersist: Record<string, boolean> = {};
        for (const k of PERSISTED_POS_TREE_KEYS) {
          if (k in next) toPersist[k] = next[k];
        }
        localStorage.setItem(POS_TREE_STORAGE_KEY, JSON.stringify(toPersist));
      }
      return next;
    });
  }

  function isActive(href: string) {
    return pathname === href;
  }

  function can(section: SectionKey | typeof ERNIE_SECTION) {
    return hasSection(role, sections, section, isSuperAdmin);
  }

  // Facelift (2026-10-03, per Chad — "the sidebar looks great, lets lock
  // that in"): the floating rounded panel from the Hynex reference. Same
  // links, same access rules, same expand/collapse and New! logic as before
  // — only the look changed. The current page gets the soft green highlight
  // (top-level links) or a green left bar (links inside a section). Styles:
  // the .fcb-* classes in app/globals.css.
  const topLinkClass = (href: string) => `fcb-nav-item ${isActive(href) ? "is-active" : ""}`;
  const linkClass = (href: string) => `fcb-nav-sub ${isActive(href) ? "is-active" : ""}`;
  const parentClass = (open: boolean) => `fcb-nav-item ${open ? "text-neutral-100" : ""}`;

  if (hidden) {
    return (
      <div className="shrink-0 p-3">
        <button
          type="button"
          onClick={() => setHidden(false)}
          aria-label="Show menu"
          title="Show menu"
          className="fcb-sidebar flex h-11 w-11 items-center justify-center text-neutral-300 hover:text-white"
        >
          <IconChevrons dir="right" />
        </button>
      </div>
    );
  }

  const visibleFinance = FINANCE_LINKS.filter((link) => can(link.section));
  const visibleOperations = OPERATIONS_LINKS.filter((link) => can(link.section));
  // Labels renders just below Weeks within Operations (see the "Labels"
  // block in the JSX below) — split here so it can be interleaved between
  // the two halves of OPERATIONS_LINKS rather than only ever appended.
  const weeksIndex = visibleOperations.findIndex((link) => link.href === "/admin/weeks");
  const opsBeforeLabels = weeksIndex === -1 ? visibleOperations : visibleOperations.slice(0, weeksIndex + 1);
  const opsAfterLabels = weeksIndex === -1 ? [] : visibleOperations.slice(weeksIndex + 1);
  const visibleSales = SALES_LINKS.filter((link) => can(link.section));
  const showPosTree = can("pos_labels");
  const showUpcTree = can("upcs");
  const visibleCalendars = CALENDARS_LINKS.filter((link) => can(link.section));
  const visiblePos = POS_LINKS.filter((link) => can(link.section));
  // POS has nothing under it yet (see POS_LINKS above) — show the empty
  // section to admins so Chad has somewhere to add to, but don't show an
  // empty, useless heading to a Basic user who has nothing granted in it.
  const showPosSection = role === "admin" || visiblePos.length > 0;
  const showErnie = can(ERNIE_SECTION);
  const showTasks = can("tasks");
  const showAuditLog = can("audit_log");
  // Users and Ekos Sync are admins-only (same rule Users always had); Audit
  // Log follows its own "audit_log" section grant.
  const visibleAdmin = ADMIN_LINKS.filter((link) => (link.section ? can(link.section) : role === "admin"));

  const nothingVisible =
    role !== "admin" &&
    !showErnie &&
    !showTasks &&
    !showAuditLog &&
    !can("tanks") &&
    !can("sales_dashboard") &&
    visibleFinance.length === 0 &&
    visibleOperations.length === 0 &&
    visibleSales.length === 0 &&
    !showPosTree &&
    !showUpcTree &&
    visibleCalendars.length === 0 &&
    visiblePos.length === 0;

  // Every id nested under Operations — everything sectionShowsNew() checks
  // to decide whether the Operations button itself should show New!.
  const operationsDescendantIds = [
    ...visibleOperations.map((link) => link.href),
    ...(showPosTree ? ["section:pos-labels", ...labelsDescendantIds()] : []),
    ...(showUpcTree ? ["section:upcs", ...upcDescendantIds()] : []),
  ];

  const showMainGroup = role === "admin" || showErnie || showTasks || can("tanks") || can("sales_dashboard");
  const showDepartments =
    visibleFinance.length > 0 ||
    visibleOperations.length > 0 ||
    showPosTree ||
    showUpcTree ||
    visibleSales.length > 0 ||
    showPosSection ||
    visibleCalendars.length > 0;

  // Right side of a parent row: its New! tag (if any) + the open/closed arrow.
  const parentRight = (isNew: boolean, open: boolean) => (
    <span className="ml-auto flex items-center gap-2">
      {isNew && <NewBadge inline />}
      <IconChevron open={open} />
    </span>
  );

  // One brand -> sizes branch of the Labels / UPC's trees.
  const brandTree = (brands: { treeKey: string; label: string; sizes: { href: string; label: string }[] }[]) =>
    brands.map((brand) => (
      <div key={brand.treeKey} className="flex flex-col">
        <button
          type="button"
          onClick={() => {
            togglePosTree(brand.treeKey);
            dismissNew(`section:${brand.treeKey}`);
          }}
          className="fcb-nav-sub"
        >
          {brand.label}
          {parentRight(
            sectionShowsNew(`section:${brand.treeKey}`, brand.sizes.map((s) => s.href)),
            !!posTreeExpanded[brand.treeKey],
          )}
        </button>
        {posTreeExpanded[brand.treeKey] && (
          <div className="fcb-nav-sub-group">
            {brand.sizes.map((s) => (
              <Link key={s.href} href={s.href} className={linkClass(s.href)} onClick={() => dismissNew(s.href)}>
                {s.label}
                {showsNew(s.href) && <NewBadge />}
              </Link>
            ))}
          </div>
        )}
      </div>
    ));

  return (
    <div className="flex w-[17rem] shrink-0 flex-col p-3 pr-0">
      <div className="fcb-sidebar flex flex-1 flex-col gap-5 px-3.5 py-4">
        <div className="flex items-center justify-between gap-2 pl-2 pr-1">
          <div className="flex items-center gap-2.5">
            <div
              className="flex h-[34px] w-[34px] items-center justify-center rounded-[11px] border"
              style={{
                background: "color-mix(in srgb, var(--fcb-accent) 16%, transparent)",
                borderColor: "color-mix(in srgb, var(--fcb-accent) 35%, transparent)",
              }}
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" className="text-brand" aria-hidden="true">
                <circle cx="12" cy="12" r="8" />
                <path d="M12 4a8 8 0 0 1 8 8" />
              </svg>
            </div>
            <div className="flex flex-col leading-tight">
              <span className="text-base font-bold tracking-tight text-neutral-100">FCB Data</span>
              <span className="text-[11px] text-neutral-500">Full Circle Brewing</span>
            </div>
          </div>
          <button
            type="button"
            onClick={() => setHidden(true)}
            aria-label="Hide menu"
            title="Hide menu"
            className="flex h-[30px] w-[30px] items-center justify-center rounded-[10px] border border-white/10 bg-white/[0.03] text-neutral-400 hover:text-white"
          >
            <IconChevrons dir="left" />
          </button>
        </div>

        <nav className="flex flex-col gap-5">
          {showMainGroup && (
            <div className="flex flex-col gap-1.5">
              <button type="button" onClick={() => setMainOpen((v) => !v)} className="fcb-nav-label">
                <span>Main</span>
                <IconChevron open={mainOpen} small />
              </button>
              {mainOpen && (
                <>
                  {role === "admin" && (
                    <Link href="/dashboard" className={topLinkClass("/dashboard")} onClick={() => dismissNew("/dashboard")}>
                      <IconHome />
                      Dashboard
                      {showsNew("/dashboard") && <NewBadge />}
                    </Link>
                  )}

                  {/* Tanks (2026-10-03) — 3D x-ray view of every unitank.
                      Gated by its own "Tanks" access (Admin → Users), same
                      as every other section. */}
                  {can("tanks") && (
                    <Link href="/tanks" className={topLinkClass("/tanks")} onClick={() => dismissNew("/tanks")}>
                      <IconTank />
                      Tanks
                      {showsNew("/tanks") && <NewBadge />}
                    </Link>
                  )}

                  {/* Sales Dashboard (2026-10-08) — gap report by chain /
                      distributor, chain setup, turn accounts off / on.
                      Gated by its own "Sales Dashboard" access. */}
                  {can("sales_dashboard") && (
                    <Link href="/sales-dashboard" className={topLinkClass("/sales-dashboard")} onClick={() => dismissNew("/sales-dashboard")}>
                      <IconChart />
                      Sales Dashboard
                      {showsNew("/sales-dashboard") && <NewBadge />}
                    </Link>
                  )}

                  {showErnie && (
                    <>
                      <button
                        type="button"
                        onClick={() => {
                          toggleErnie();
                          dismissNew("section:ernie");
                        }}
                        className={parentClass(ernieExpanded)}
                      >
                        <IconSparkle />
                        Ernie AI
                        {parentRight(
                          sectionShowsNew(
                            "section:ernie",
                            ERNIE_LINKS.map((link) => link.href),
                          ),
                          ernieExpanded,
                        )}
                      </button>
                      {ernieExpanded && (
                        <div className="fcb-nav-sub-group">
                          {ERNIE_LINKS.map((link) => (
                            <Link
                              key={link.href}
                              href={link.href}
                              className={linkClass(link.href)}
                              onClick={() => dismissNew(link.href)}
                            >
                              {link.label}
                              {showsNew(link.href) && <NewBadge />}
                            </Link>
                          ))}
                        </div>
                      )}
                    </>
                  )}

                  {/* Tasks (formerly "Projects") — the company-wide
                      action/directive tracker, gated by the "tasks" section. */}
                  {showTasks && (
                    <Link href="/tasks" className={topLinkClass("/tasks")} onClick={() => dismissNew("/tasks")}>
                      <IconCheck />
                      Tasks
                      {showsNew("/tasks") && <NewBadge />}
                    </Link>
                  )}
                </>
              )}
            </div>
          )}

          {showDepartments && (
            <div className="flex flex-col gap-1.5">
              <button type="button" onClick={() => setDepartmentsOpen((v) => !v)} className="fcb-nav-label">
                <span>Departments</span>
                <IconChevron open={departmentsOpen} small />
              </button>
              {departmentsOpen && (
                <>
                  {visibleFinance.length > 0 && (
                    <>
                      <button
                        type="button"
                        onClick={() => {
                          toggleFinance();
                          dismissNew("section:finance");
                        }}
                        className={parentClass(financeExpanded)}
                      >
                        <IconChart />
                        Finance
                        {parentRight(
                          sectionShowsNew("section:finance", visibleFinance.map((link) => link.href)),
                          financeExpanded,
                        )}
                      </button>
                      {financeExpanded && (
                        <div className="fcb-nav-sub-group">
                          {visibleFinance.map((link) => (
                            <Link
                              key={link.href}
                              href={link.href}
                              className={linkClass(link.href)}
                              onClick={() => dismissNew(link.href)}
                            >
                              {link.label}
                              {showsNew(link.href) && <NewBadge />}
                            </Link>
                          ))}
                        </div>
                      )}
                    </>
                  )}

                  {(visibleOperations.length > 0 || showPosTree || showUpcTree) && (
                    <>
                      <button
                        type="button"
                        onClick={() => {
                          toggleOperations();
                          dismissNew("section:operations");
                        }}
                        className={parentClass(operationsExpanded)}
                      >
                        <IconLayers />
                        Operations
                        {parentRight(sectionShowsNew("section:operations", operationsDescendantIds), operationsExpanded)}
                      </button>
                      {operationsExpanded && (
                        <div className="fcb-nav-sub-group">
                          {opsBeforeLabels.map((link) => (
                            <Link
                              key={link.href}
                              href={link.href}
                              className={linkClass(link.href)}
                              onClick={() => dismissNew(link.href)}
                            >
                              {link.label}
                              {showsNew(link.href) && <NewBadge />}
                            </Link>
                          ))}

                          {/* Labels — a sub-category of Operations (moved
                              from POS 2026-09-05, per Chad), gated by the
                              'pos_labels' section. */}
                          {showPosTree && (
                            <div className="flex flex-col">
                              <button
                                type="button"
                                onClick={() => {
                                  togglePosTree("pos-labels");
                                  dismissNew("section:pos-labels");
                                }}
                                className="fcb-nav-sub is-parent"
                              >
                                Labels
                                {parentRight(
                                  sectionShowsNew("section:pos-labels", labelsDescendantIds()),
                                  !!posTreeExpanded["pos-labels"],
                                )}
                              </button>
                              {posTreeExpanded["pos-labels"] && (
                                <div className="fcb-nav-sub-group">{brandTree(POS_LABEL_BRANDS)}</div>
                              )}
                            </div>
                          )}

                          {/* UPC's — brand -> size tree set up exactly like
                              Labels (2026-09-05, per Chad). */}
                          {showUpcTree && (
                            <div className="flex flex-col">
                              <button
                                type="button"
                                onClick={() => {
                                  togglePosTree("upcs");
                                  dismissNew("section:upcs");
                                }}
                                className="fcb-nav-sub is-parent"
                              >
                                UPC&apos;s
                                {parentRight(
                                  sectionShowsNew("section:upcs", upcDescendantIds()),
                                  !!posTreeExpanded["upcs"],
                                )}
                              </button>
                              {posTreeExpanded["upcs"] && <div className="fcb-nav-sub-group">{brandTree(UPC_BRANDS)}</div>}
                            </div>
                          )}

                          {opsAfterLabels.map((link) => (
                            <Link
                              key={link.href}
                              href={link.href}
                              className={linkClass(link.href)}
                              onClick={() => dismissNew(link.href)}
                            >
                              {link.label}
                              {showsNew(link.href) && <NewBadge />}
                            </Link>
                          ))}
                        </div>
                      )}
                    </>
                  )}

                  {visibleSales.length > 0 && (
                    <>
                      <button
                        type="button"
                        onClick={() => {
                          toggleSales();
                          dismissNew("section:sales");
                        }}
                        className={parentClass(salesExpanded)}
                      >
                        <IconCart />
                        Sales
                        {parentRight(sectionShowsNew("section:sales", visibleSales.map((link) => link.href)), salesExpanded)}
                      </button>
                      {salesExpanded && (
                        <div className="fcb-nav-sub-group">
                          {visibleSales.map((link) => (
                            <Link
                              key={link.href}
                              href={link.href}
                              className={linkClass(link.href)}
                              onClick={() => dismissNew(link.href)}
                            >
                              {link.label}
                              {showsNew(link.href) && <NewBadge />}
                            </Link>
                          ))}
                        </div>
                      )}
                    </>
                  )}

                  {/* POS — its own top-level section (restored 2026-09-05,
                      per Chad), between Sales and Calendars. */}
                  {showPosSection && (
                    <>
                      <button
                        type="button"
                        onClick={() => {
                          togglePos();
                          dismissNew("section:pos");
                        }}
                        className={parentClass(posExpanded)}
                      >
                        <IconCard />
                        POS
                        {parentRight(sectionShowsNew("section:pos", visiblePos.map((link) => link.href)), posExpanded)}
                      </button>
                      {posExpanded && (
                        <div className="fcb-nav-sub-group">
                          {visiblePos.map((link) => (
                            <Link
                              key={link.href}
                              href={link.href}
                              className={linkClass(link.href)}
                              onClick={() => dismissNew(link.href)}
                            >
                              {link.label}
                              {showsNew(link.href) && <NewBadge />}
                            </Link>
                          ))}
                          {visiblePos.length === 0 && (
                            <p className="px-[18px] py-1.5 text-xs leading-relaxed text-neutral-600">Nothing here yet.</p>
                          )}
                        </div>
                      )}
                    </>
                  )}

                  {visibleCalendars.length > 0 && (
                    <>
                      <button
                        type="button"
                        onClick={() => {
                          toggleCalendars();
                          dismissNew("section:calendars");
                        }}
                        className={parentClass(calendarsExpanded)}
                      >
                        <IconCalendar />
                        Calendars
                        {parentRight(
                          sectionShowsNew("section:calendars", visibleCalendars.map((link) => link.href)),
                          calendarsExpanded,
                        )}
                      </button>
                      {calendarsExpanded && (
                        <div className="fcb-nav-sub-group">
                          {visibleCalendars.map((link) => (
                            <Link
                              key={link.href}
                              href={link.href}
                              className={linkClass(link.href)}
                              onClick={() => dismissNew(link.href)}
                            >
                              {link.label}
                              {showsNew(link.href) && <NewBadge />}
                            </Link>
                          ))}
                        </div>
                      )}
                    </>
                  )}
                </>
              )}
            </div>
          )}

          {/* Admin — added 2026-10-03, per Chad (Users, Audit Log, Ekos
              Sync). The section label is its open/close switch. */}
          {visibleAdmin.length > 0 && (
            <div className="flex flex-col gap-1.5">
              <button
                type="button"
                onClick={() => {
                  toggleAdmin();
                  dismissNew("section:admin");
                }}
                className="fcb-nav-label"
              >
                <span>Admin</span>
                <span className="flex items-center gap-2">
                  {sectionShowsNew("section:admin", visibleAdmin.map((link) => link.href)) && <NewBadge inline />}
                  <IconChevron open={adminExpanded} small />
                </span>
              </button>
              {adminExpanded &&
                visibleAdmin.map((link) => (
                  <Link
                    key={link.href}
                    href={link.href}
                    className={topLinkClass(link.href)}
                    onClick={() => dismissNew(link.href)}
                  >
                    <AdminIcon href={link.href} />
                    {link.label}
                    {showsNew(link.href) && <NewBadge />}
                  </Link>
                ))}
            </div>
          )}

          {nothingVisible && (
            <p className="px-3 text-xs leading-relaxed text-neutral-600">
              No sections granted yet — ask an admin to give you access from Users.
            </p>
          )}
        </nav>

        {role === "admin" && ekosStatus && (
          <Link
            href="/admin/ekos-sync"
            className="mt-auto flex flex-col gap-1.5 rounded-[18px] border p-3.5"
            style={{
              background:
                "linear-gradient(160deg, color-mix(in srgb, var(--fcb-accent) 16%, transparent), color-mix(in srgb, var(--fcb-accent) 3%, transparent))",
              borderColor: "color-mix(in srgb, var(--fcb-accent) 22%, transparent)",
            }}
          >
            <span className="flex items-center gap-2 text-[13px] font-semibold text-neutral-100">
              <span
                className="h-2 w-2 rounded-full"
                style={{ background: ekosStatus.color, boxShadow: `0 0 10px ${ekosStatus.color}` }}
              />
              {ekosStatus.title}
            </span>
            <span className="text-xs leading-snug text-neutral-400">{ekosStatus.detail}</span>
          </Link>
        )}
      </div>
    </div>
  );
}

// --- Sidebar icons (thin line icons, facelift 2026-10-03) -------------------

function NavIcon({ children }: { children: React.ReactNode }) {
  return (
    <svg
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      className="fcb-nav-icon shrink-0"
      aria-hidden="true"
    >
      {children}
    </svg>
  );
}
function IconHome() {
  return (
    <NavIcon>
      <path d="M3 11l9-7 9 7v9a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z" />
    </NavIcon>
  );
}
function IconTank() {
  return (
    <NavIcon>
      <path d="M8 3h8M7 6a5 3 0 0 1 10 0v8l-5 5-5-5z" />
      <path d="M8.5 21v-2.5M15.5 21v-2.5" />
    </NavIcon>
  );
}
function IconSparkle() {
  return (
    <NavIcon>
      <path d="M12 3l1.8 4.6L18 9l-4.2 1.4L12 15l-1.8-4.6L6 9l4.2-1.4z" />
      <path d="M19 15l.8 2 2 .8-2 .8-.8 2-.8-2-2-.8 2-.8z" />
    </NavIcon>
  );
}
function IconCheck() {
  return (
    <NavIcon>
      <rect x="4" y="4" width="16" height="16" rx="4" />
      <path d="M8.5 12l2.5 2.5 4.5-5" />
    </NavIcon>
  );
}
function IconChart() {
  return (
    <NavIcon>
      <path d="M4 19V5M4 19h16M8 15l3-4 3 2 5-6" />
    </NavIcon>
  );
}
function IconLayers() {
  return (
    <NavIcon>
      <path d="M3 7l9-4 9 4-9 4z" />
      <path d="M3 12l9 4 9-4M3 17l9 4 9-4" />
    </NavIcon>
  );
}
function IconCart() {
  return (
    <NavIcon>
      <path d="M3 3h2l2.4 12.2a1 1 0 0 0 1 .8h9.2a1 1 0 0 0 1-.8L20 7H6" />
      <circle cx="9" cy="20" r="1.3" />
      <circle cx="17" cy="20" r="1.3" />
    </NavIcon>
  );
}
function IconCard() {
  return (
    <NavIcon>
      <rect x="3" y="5" width="18" height="14" rx="3" />
      <path d="M3 10h18M7 15h4" />
    </NavIcon>
  );
}
function IconCalendar() {
  return (
    <NavIcon>
      <rect x="3" y="5" width="18" height="16" rx="3" />
      <path d="M3 10h18M8 3v4M16 3v4" />
    </NavIcon>
  );
}
function AdminIcon({ href }: { href: string }) {
  if (href.startsWith("/admin/users")) {
    return (
      <NavIcon>
        <circle cx="9" cy="8" r="3.5" />
        <path d="M2.5 20a6.5 6.5 0 0 1 13 0M16 4.5a3.5 3.5 0 0 1 0 7M21.5 20a6.5 6.5 0 0 0-4-6" />
      </NavIcon>
    );
  }
  if (href.startsWith("/admin/ekos-sync")) {
    return (
      <NavIcon>
        <path d="M20 12a8 8 0 0 1-14 5.3M4 12a8 8 0 0 1 14-5.3" />
        <path d="M18 3v4h-4M6 21v-4h4" />
      </NavIcon>
    );
  }
  return (
    <NavIcon>
      <path d="M7 3h7l5 5v13H7z" />
      <path d="M14 3v5h5M10 13h6M10 17h6" />
    </NavIcon>
  );
}
function IconChevron({ open, small = false }: { open: boolean; small?: boolean }) {
  return (
    <svg
      width={small ? 12 : 13}
      height={small ? 12 : 13}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      className={`shrink-0 text-neutral-500 transition-transform ${open ? "" : "-rotate-90"}`}
      aria-hidden="true"
    >
      <path d="M6 9l6 6 6-6" />
    </svg>
  );
}
function IconChevrons({ dir }: { dir: "left" | "right" }) {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
      <path d={dir === "left" ? "M11 17l-5-5 5-5M18 17l-5-5 5-5" : "M13 17l5-5-5-5M6 17l5-5-5-5"} />
    </svg>
  );
}
