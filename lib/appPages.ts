// The app's page list — ONE list, used by both the left Sidebar and Ernie
// (added 2026-10-16, per Chad — claude/ernie-live-data-map-plan.md).
//
// Before this, the Sidebar kept these links to itself and Ernie had no list
// of pages at all, so open_app_page only worked when Ernie already knew a
// page's address. Now Ernie gets every page this person can open (see
// pagesForErnie below), straight from the same arrays the Sidebar draws —
// add a page here and it shows up in both places. No other list to update.
//
// `about` is Ernie's one-line note on what the page shows / answers. The
// Sidebar ignores it. When you add a page, give it an `about`.
//
// Access rules in pagesForErnie() mirror the Sidebar's exactly (each
// link's own section, Users/Ekos Sync admin-only, Dashboard admin-only).

import type { Role } from "@/lib/types/db";
import { hasSection, ERNIE_SECTION, type AnySectionKey, type SectionKey } from "@/lib/permissions";
import { DISTRIBUTOR_PAGES, distributorHref } from "@/lib/distributorPages";

export type AppLink<S = SectionKey> = { href: string; label: string; section: S; about?: string };
export type BrandTree = {
  treeKey: string;
  label: string;
  sizes: { href: string; label: string }[];
};

// Main — drawn one by one in the Sidebar's JSX (each has its own icon), in
// this order. If you add or change one there, change it here too.
//   null section = admins only (Dashboard).
export const MAIN_LINKS: AppLink<SectionKey | typeof ERNIE_SECTION | null>[] = [
  { href: "/dashboard", label: "Operations Dashboard", section: null, about: "Operations Dashboard (the admin home page, at /dashboard): overview of the current week: inventory, orders, purchase orders and other live blocks." },
  { href: "/sales-dashboard", label: "Sales Dashboard", section: "sales_dashboard", about: "Opens on the dashboard home: live headline numbers for the last 30 / 90 days, year to date or custom dates vs the same dates last year (cases sold, buying accounts, new accounts, win backs, at-risk and lost accounts), cases by month, account health, distributor cards with each one's biggest immediate impacts, Needs attention (must-carry gaps, slipping accounts, big losses), Win backs, top brands, chain coverage and rep activity — lists export to Excel. Quick links under the title: Distributor Inventory (running low or out at every distributor, each distributor's stock, click a product for its sales there: cases vs last year, by month, accounts buying / stopped), Chain Gap Report, UPC's, POS (Football POS), Account Finder (search every distributor's accounts). Tools: Action Items (every chain store not buying a Mandate / must-carry item, with rep, phone and last check-in), chain gap report (which chain stores carry / don't carry each product, by distributor), chain setup, turned-off accounts." },
  { href: "/tanks", label: "Tanks", section: "tanks", about: "3D view of every fermenter with its live Ekos batch, stage and temperature, plus pallets of kegs, cans, lids and label rolls on hand." },
  { href: "/brew-planner", label: "Brew Planner", section: "brew_planner", about: "EXPERIMENTAL. What to brew this 2-week cycle and how much, per base beer (Big Daddy + Capt. WC one brew; Capt. Hazy + Juicy + Mystic Haze + Mango Bomb one brew): selling rate, stock at each distributor, our warehouse, beer in tank, weeks of cover, run-out date (simple view by default; Show all numbers for the full table), brand split, and short warnings in each row." },
  { href: "/ernie", label: "My Ernie AI", section: ERNIE_SECTION, about: "This chat." },
  { href: "/ernie/projects", label: "Projects", section: ERNIE_SECTION, about: "Ernie Projects: shared rooms with their own file library." },
  { href: "/tasks", label: "Tasks", section: "tasks", about: "Company task tracker: tasks by category with status, due dates, assignees and comments." },
];

export const FINANCE_LINKS: AppLink[] = [
  { href: "/finance/cashflow-dashboard", label: "Cash Flow Dashboard", section: "cashflow_dashboard", about: "Cash flow: realized revenue from delivered distributor orders, vendor PO spend, projections." },
  { href: "/finance/distributor-data", label: "Distributor Data", section: "distributor_data", about: "Each distributor's payment terms and other distributor finance details." },
];

// Order matters to the Sidebar: it draws Labels / UPC's right after Weeks,
// so anything listed after Weeks (Batch Ingredients) lands below them.
export const OPERATIONS_LINKS: AppLink[] = [
  { href: "/purchase-orders", label: "Purchase Orders", section: "purchase_orders", about: "Supplier purchase orders synced from Ekos: items, costs, delivery dates, paid / unpaid." },
  { href: "/inventory", label: "Inventory & Allocation", section: "inventory_allocation", about: "This week's brewery inventory and what's allocated to each distributor (with PO numbers, status flags and order value), plus the Packaging Inventory and Label Inventory panels with Consumed / Remaining (negative = short). Pick another week in the dropdown." },
  { href: "/distributor-inventory", label: "Distributor Inventory", section: "distributor_inventory", about: "What each distributor reports on hand in their warehouse, daily rate of sale and projected days on hand, per product." },
  { href: "/build-orders", label: "Build Orders", section: "build_orders", about: "Recommended order per distributor from par level vs. their on hand, with the total barrels needed per product and per beer (cans and kegs combined)." },
  { href: "/pricing", label: "Distributor Pricing", section: "distributor_pricing", about: "Price FCB charges each distributor for each product." },
  { href: "/admin/weeks", label: "Weeks", section: "weeks", about: "List of delivery weeks; open a week to see its history." },
  { href: "/batch-ingredients", label: "Batch Ingredients", section: "batch_ingredients", about: "Each brand's batch recipe (ingredients per BBL) and ingredient costs." },
];

// Accounts first — it's the base the rest of the sales system builds on.
export const SALES_LINKS: AppLink[] = [
  { href: "/sales/accounts", label: "Accounts", section: "accounts", about: "Every retail account (bar / store) by distributor: stage, last buy, purchase history by product and month, contacts, rep check-ins, classification. The Product Lookup tab answers \"how much of product X did distributor Y sell, to which accounts, in which months\"." },
  { href: "/sales/pricing", label: "Price List", section: "price_list", about: "What FCB charges per brand per package." },
  { href: "/sales/margin-analysis", label: "Margin Analysis", section: "margin_analysis", about: "Margin per brand and package from batch cost and yield." },
  { href: "/sales/cost-per-case", label: "Cost Per Case", section: "cost_per_case", about: "Full cost to make one case / keg of each brand: ingredients, packaging, labor." },
  { href: "/sales/contribution-margin", label: "Contribution Margin", section: "contribution_margin", about: "Contribution margin per brand and package (revenue per case-equivalent minus cost)." },
  { href: "/sales/chain-authorizations", label: "Chain Authorizations", section: "chain_authorizations", about: "Which items each grocery / retail chain has authorized." },
  { href: "/sales/chain-mandates", label: "Chain Mandates", section: "chain_mandates", about: "Products chains have mandated, and which stores each applies to." },
];

// Distributors (2026-10-22) — one page per distributor, each its own access
// checkbox (lib/distributorPages.ts). Drawn right below Sales.
export const DISTRIBUTOR_LINKS: AppLink[] = DISTRIBUTOR_PAGES.map((d) => ({
  href: distributorHref(d.slug),
  label: d.name,
  section: d.section,
  about: `${d.name}'s daily dashboard: today's priorities (stores missing must-carry items, accounts slipping, big losses to win back), ${d.name}'s inventory (on hand, weeks of supply, when it was last updated), check-ins (overall, maintenance route progress for the current two-month period, accounts checked in with notes, route accounts not yet visited), recent win backs and new accounts, cases vs last year, cases by month and top brands — for the last 30 / 90 days, year to date or custom dates. Click any account for its details (store phone, contacts, what they buy, last check-ins with who the rep spoke with).`,
}));

export const CALENDARS_LINKS: AppLink[] = [
  { href: "/events", label: "Events Calendar", section: "events_calendar", about: "Events: tastings, festivals, promos, with distributor and rep." },
  { href: "/chain-calendar", label: "Chain Calendar", section: "events_calendar", about: "Chain resets, promos and other chain activity." },
  { href: "/social-media-calendar", label: "Social Media Calendar", section: "events_calendar", about: "Planned social media posts." },
];

export const POS_LINKS: AppLink[] = [
  { href: "/pos/football", label: "Football POS", section: "football_pos", about: "Football-season POS artwork library." },
];

// Twilio (2026-10-29) — texting accounts about new items. Drawn as a
// sub-category inside Admin, between Audit Log and Ekos Sync.
export const TWILIO_LINKS: AppLink[] = [
  { href: "/twilio/setup", label: "Setup & Compliance", section: "twilio", about: "FCB's Twilio texting setup: the texting number (559) 478-0269, messaging service, brand and campaign registration status, text-to-join keyword and wording, and links to the public Privacy Policy, Terms and text sign-up pages." },
  { href: "/twilio/sign-ups", label: "Text Sign-ups", section: "twilio", about: "Everyone who agreed to get FCB new-item texts (texted JOIN or used the sign-up page): cell, name, business, linked account, rep, when they joined, and anyone who opted out with STOP." },
  { href: "/twilio/how-it-works", label: "How It Works", section: "twilio", about: "Plain-English explanation of FCB new-item texts from the customer's point of view: signing up (text JOIN to (559) 478-0269 or the web form), what texts they get, replies going to their sales rep, STOP to opt out, where setup stands, and cost." },
];

// Every Admin page has its own section (2026-10-29): Administrators always
// have them; Managers and Employees only if an Administrator grants them.
export const ADMIN_LINKS: AppLink<SectionKey | undefined>[] = [
  { href: "/admin/users", label: "Users", section: "admin_users", about: "App users and what each can access." },
  { href: "/admin/audit", label: "Audit Log", section: "audit_log", about: "Every change made in the app: who, when, old and new value." },
  { href: "/admin/email", label: "Email Studio", section: "email_studio", about: "Email Studio: FCB's drag-and-drop email designer (saved email designs with subject, preview, send a test) and the Creative Library of images, GIFs, PSDs and other files used in emails." },
  { href: "/admin/ekos-sync", label: "Ekos Sync", section: "ekos_sync", about: "Automatic Ekos sync: sources, last runs, errors." },
];

// Ernie AI sub-links (drawn under "Ernie AI" in Main).
export const ERNIE_LINKS = MAIN_LINKS.filter((l) => l.href.startsWith("/ernie")).map(({ href, label }) => ({ href, label }));

export const POS_LABEL_BRANDS: BrandTree[] = [
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

export const UPC_BRANDS: BrandTree[] = [
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

/** One line per page this person can open — what Ernie gets as his page map. */
export function pagesForErnie(role: Role | undefined, sections: AnySectionKey[], isSuperAdmin = false): string[] {
  const can = (s: SectionKey | typeof ERNIE_SECTION) => hasSection(role, sections, s, isSuperAdmin);
  const line = (group: string, l: { href: string; label: string; about?: string }) =>
    `${l.href} — ${group}${l.label}${l.about ? `: ${l.about}` : ""}`;
  const out: string[] = [];
  for (const l of MAIN_LINKS) {
    if (l.section === null ? role === "admin" : can(l.section)) out.push(line("", l));
  }
  for (const l of FINANCE_LINKS) if (can(l.section)) out.push(line("Finance > ", l));
  for (const l of OPERATIONS_LINKS) if (can(l.section)) out.push(line("Operations > ", l));
  if (can("pos_labels")) {
    out.push(
      `/pos/labels/<brand>/<size> — Operations > Labels: label artwork files. ` +
        POS_LABEL_BRANDS.map((b) => `${b.label}: ${b.sizes.map((s) => s.href).join(", ")}`).join("; "),
    );
  }
  if (can("upcs")) {
    out.push(
      `/upcs/<brand>/<size> — Sales > UPC's: UPC codes per product, each with its barcode (preview + PNG / SVG download). ` +
        UPC_BRANDS.map((b) => `${b.label}: ${b.sizes.map((s) => s.href).join(", ")}`).join("; "),
    );
  }
  for (const l of SALES_LINKS) if (can(l.section)) out.push(line("Sales > ", l));
  for (const l of DISTRIBUTOR_LINKS) if (can(l.section)) out.push(line("Sales > Distributors > ", l));
  for (const l of CALENDARS_LINKS) if (can(l.section)) out.push(line("Calendars > ", l));
  for (const l of POS_LINKS) if (can(l.section)) out.push(line("Sales > POS > ", l));
  for (const l of TWILIO_LINKS) if (can(l.section)) out.push(line("Admin > Twilio > ", l));
  for (const l of ADMIN_LINKS) {
    if (l.section ? can(l.section) : role === "admin") out.push(line("Admin > ", l));
  }
  return out;
}
