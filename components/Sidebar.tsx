"use client";

// Left-hand navigation sidebar. Every link below is shown based on the
// signed-in person's per-section access (see lib/permissions.ts) — an admin
// sees everything unconditionally; a Basic user sees exactly the sections
// an admin has granted them from Users > Edit, nothing more. Dashboard and
// Users management are the two exceptions: they stay admin-only, full
// stop, same as always — they aren't grantable sections.
//
// Three independent bits of UI state:
// - Whether Operations/Sales are expanded — remembered per-browser via
//   localStorage, so collapsing one stays collapsed next time you load the
//   app.
// - Whether the whole sidebar is hidden — NOT persisted; it always starts
//   visible on a fresh page load, per Chad's request.
// - Nothing about WHICH links show is persisted — that comes fresh from
//   the server on every load via the `sections` prop.

import { useState, useEffect } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import type { Role } from "@/lib/types/db";
import { hasSection, ERNIE_SECTION, type AnySectionKey, type SectionKey } from "@/lib/permissions";

const OPERATIONS_LINKS: { href: string; label: string; section: SectionKey }[] = [
  { href: "/purchase-orders", label: "Purchase Orders", section: "purchase_orders" },
  { href: "/inventory", label: "Inventory & Allocation", section: "inventory_allocation" },
  { href: "/distributor-inventory", label: "Distributor Inventory", section: "distributor_inventory" },
  { href: "/build-orders", label: "Build Orders", section: "build_orders" },
  { href: "/pricing", label: "Distributor Pricing", section: "distributor_pricing" },
  { href: "/admin/weeks", label: "Weeks", section: "weeks" },
  { href: "/admin/audit", label: "Audit Log", section: "audit_log" },
];

// Sales sub-links get added here one at a time as each piece of the old FCB
// Pricing desktop app is folded in — Price List first, then Margin Analysis,
// Cost Per Case, and Contribution Margin.
const SALES_LINKS: { href: string; label: string; section: SectionKey }[] = [
  { href: "/sales/pricing", label: "Price List", section: "price_list" },
  { href: "/sales/margin-analysis", label: "Margin Analysis", section: "margin_analysis" },
  { href: "/sales/cost-per-case", label: "Cost Per Case", section: "cost_per_case" },
  { href: "/sales/contribution-margin", label: "Contribution Margin", section: "contribution_margin" },
];

const OPERATIONS_STORAGE_KEY = "fcb-sidebar-operations-expanded";
const SALES_STORAGE_KEY = "fcb-sidebar-sales-expanded";

// POS > Labels > <brand> > <size> — a 3-level nested tree (unlike
// Operations/Sales, which are just one level of flat links), so its
// expand/collapse state is a single JSON blob keyed by node id rather than
// one boolean per section. The whole tree shares one section ('pos_labels').
const POS_TREE_STORAGE_KEY = "fcb-sidebar-pos-tree-expanded";

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
];

export default function Sidebar({
  role,
  sections,
}: {
  role: Role | undefined;
  sections: AnySectionKey[];
}) {
  const pathname = usePathname();
  const [hidden, setHidden] = useState(false);
  const [operationsExpanded, setOperationsExpanded] = useState(true);
  const [salesExpanded, setSalesExpanded] = useState(true);
  const [posTreeExpanded, setPosTreeExpanded] = useState<
    Record<string, boolean>
  >({ pos: true, "pos-labels": true });

  useEffect(() => {
    // Hydrate persisted expand/collapse prefs after mount rather than in the
    // initial useState — reading localStorage during the initializer would
    // mismatch between server render (no localStorage) and client.
    const storedOperations = localStorage.getItem(OPERATIONS_STORAGE_KEY);
    if (storedOperations !== null) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- intentional post-mount hydration from localStorage
      setOperationsExpanded(storedOperations === "true");
    }
    const storedSales = localStorage.getItem(SALES_STORAGE_KEY);
    if (storedSales !== null) {
      setSalesExpanded(storedSales === "true");
    }
    const storedPosTree = localStorage.getItem(POS_TREE_STORAGE_KEY);
    if (storedPosTree) {
      try {
        setPosTreeExpanded((prev) => ({
          ...prev,
          ...JSON.parse(storedPosTree),
        }));
      } catch {
        // Ignore malformed/stale localStorage content.
      }
    }
  }, []);

  function toggleOperations() {
    setOperationsExpanded((prev) => {
      const next = !prev;
      localStorage.setItem(OPERATIONS_STORAGE_KEY, String(next));
      return next;
    });
  }

  function toggleSales() {
    setSalesExpanded((prev) => {
      const next = !prev;
      localStorage.setItem(SALES_STORAGE_KEY, String(next));
      return next;
    });
  }

  function togglePosTree(key: string) {
    setPosTreeExpanded((prev) => {
      const next = { ...prev, [key]: !prev[key] };
      localStorage.setItem(POS_TREE_STORAGE_KEY, JSON.stringify(next));
      return next;
    });
  }

  function isActive(href: string) {
    return pathname === href;
  }

  function can(section: SectionKey | typeof ERNIE_SECTION) {
    return hasSection(role, sections, section);
  }

  // Site-wide active-page highlight: a green left border + green text
  // (FCB's brand green, #6ABC46, sampled from the hop cone in the company
  // logo) for whichever page is currently open, applied identically to
  // every nav link — Dashboard, Ernie AI, every Operations/Sales item, the
  // POS > Labels brand/size tree, Events Calendar, Users, and Tasks.
  // border-l-2 is always reserved (transparent when inactive) so the text
  // doesn't shift left/right as a link becomes active.
  const linkClass = (href: string) =>
    `rounded border-l-2 px-2 py-1.5 ${
      isActive(href)
        ? "border-[#6ABC46] bg-neutral-900 font-semibold text-[#6ABC46]"
        : "border-transparent text-neutral-400 hover:bg-neutral-900 hover:text-white"
    }`;

  if (hidden) {
    return (
      <div className="shrink-0 border-r border-neutral-800 bg-neutral-950 p-2">
        <button
          type="button"
          onClick={() => setHidden(false)}
          className="whitespace-nowrap rounded-md border border-neutral-700 px-2 py-1 text-xs text-neutral-300 hover:bg-neutral-900"
        >
          Show menu
        </button>
      </div>
    );
  }

  const visibleOperations = OPERATIONS_LINKS.filter((link) => can(link.section));
  const visibleSales = SALES_LINKS.filter((link) => can(link.section));
  const showPosTree = can("pos_labels");
  const showEvents = can("events_calendar");
  const showErnie = can(ERNIE_SECTION);

  const nothingVisible =
    role !== "admin" &&
    !showErnie &&
    visibleOperations.length === 0 &&
    visibleSales.length === 0 &&
    !showPosTree &&
    !showEvents;

  return (
    <div className="flex w-56 shrink-0 flex-col border-r border-neutral-800 bg-neutral-950 p-3">
      <div className="mb-4 flex items-center justify-between gap-2">
        <span className="font-semibold text-neutral-100">FCB Data</span>
        <button
          type="button"
          onClick={() => setHidden(true)}
          className="rounded-md border border-neutral-700 px-2 py-1 text-xs text-neutral-400 hover:bg-neutral-900"
        >
          Hide
        </button>
      </div>

      <nav className="flex flex-col gap-1 text-sm">
        {role === "admin" && (
          <Link href="/dashboard" className={linkClass("/dashboard")}>
            Dashboard
          </Link>
        )}

        {showErnie && (
          <Link href="/ernie" className={`mt-1 ${linkClass("/ernie")}`}>
            Ernie AI
          </Link>
        )}

        {/* Tasks (formerly "Projects") — the company-wide action/directive
            tracker. Deliberately NOT gated by a Team Access section like
            everything else below: per Chad, "anyone can assign... gives
            leadership the ability to see everything currently happening
            inside the company," so it's open to every signed-in user
            unconditionally, same spirit as Ernie AI being available to
            everyone but tracked separately. */}
        <Link href="/tasks" className={`mt-1 ${linkClass("/tasks")}`}>
          Tasks
        </Link>

        {visibleOperations.length > 0 && (
          <>
            <button
              type="button"
              onClick={toggleOperations}
              className="mt-2 rounded px-2 py-1.5 text-left font-semibold text-neutral-300 hover:bg-neutral-900"
            >
              Operations
            </button>
            {operationsExpanded && (
              <div className="ml-2 flex flex-col gap-1 border-l border-neutral-800 pl-3">
                {visibleOperations.map((link) => (
                  <Link
                    key={link.href}
                    href={link.href}
                    className={linkClass(link.href)}
                  >
                    {link.label}
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
              onClick={toggleSales}
              className="mt-1 rounded px-2 py-1.5 text-left font-semibold text-neutral-300 hover:bg-neutral-900"
            >
              Sales
            </button>
            {salesExpanded && (
              <div className="ml-2 flex flex-col gap-1 border-l border-neutral-800 pl-3">
                {visibleSales.map((link) => (
                  <Link
                    key={link.href}
                    href={link.href}
                    className={linkClass(link.href)}
                  >
                    {link.label}
                  </Link>
                ))}
              </div>
            )}
          </>
        )}

        {showPosTree && (
          <>
            <button
              type="button"
              onClick={() => togglePosTree("pos")}
              className="mt-1 rounded px-2 py-1.5 text-left font-semibold text-neutral-300 hover:bg-neutral-900"
            >
              POS
            </button>
            {posTreeExpanded.pos && (
              <div className="ml-2 flex flex-col gap-1 border-l border-neutral-800 pl-3">
                <button
                  type="button"
                  onClick={() => togglePosTree("pos-labels")}
                  className="rounded px-2 py-1 text-left text-sm font-semibold text-neutral-400 hover:bg-neutral-900 hover:text-white"
                >
                  Labels
                </button>
                {posTreeExpanded["pos-labels"] && (
                  <div className="ml-2 flex flex-col gap-1 border-l border-neutral-800 pl-3">
                    {POS_LABEL_BRANDS.map((brand) => (
                      <div key={brand.treeKey} className="flex flex-col gap-1">
                        <button
                          type="button"
                          onClick={() => togglePosTree(brand.treeKey)}
                          className="rounded px-2 py-1 text-left text-sm text-neutral-400 hover:bg-neutral-900 hover:text-white"
                        >
                          {brand.label}
                        </button>
                        {posTreeExpanded[brand.treeKey] && (
                          <div className="ml-2 flex flex-col gap-1 border-l border-neutral-800 pl-3">
                            {brand.sizes.map((s) => (
                              <Link
                                key={s.href}
                                href={s.href}
                                className={linkClass(s.href)}
                              >
                                {s.label}
                              </Link>
                            ))}
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </>
        )}

        {showEvents && (
          <Link href="/events" className={`mt-1 ${linkClass("/events")}`}>
            Events Calendar
          </Link>
        )}

        {role === "admin" && (
          <Link
            href="/admin/users"
            className={`mt-1 ${linkClass("/admin/users")}`}
          >
            Users
          </Link>
        )}

        {nothingVisible && (
          <p className="mt-2 px-2 text-xs leading-relaxed text-neutral-600">
            No sections granted yet — ask an admin to give you access from
            Users.
          </p>
        )}
      </nav>
    </div>
  );
}
