"use client";

// Left-hand navigation sidebar, replacing the old top nav bar. Admins get
// "Dashboard" (standalone), "Operations" and "Sales" (collapsible
// categories — click the name itself, no chevrons/icons), and "Users"
// (standalone). Basic users only ever see a single "Inventory &
// Allocation" link, matching their existing page restriction.
//
// Two independent bits of UI state:
// - Whether Operations/Sales are expanded — remembered per-browser via
//   localStorage, so collapsing one stays collapsed next time you load the
//   app.
// - Whether the whole sidebar is hidden — NOT persisted; it always starts
//   visible on a fresh page load, per Chad's request.

import { useState, useEffect } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import type { Role } from "@/lib/types/db";

const OPERATIONS_LINKS = [
  { href: "/purchase-orders", label: "Purchase Orders" },
  { href: "/inventory", label: "Inventory & Allocation" },
  { href: "/distributor-inventory", label: "Distributor Inventory" },
  { href: "/build-orders", label: "Build Orders" },
  { href: "/pricing", label: "Distributor Pricing" },
  { href: "/admin/weeks", label: "Weeks" },
  { href: "/admin/audit", label: "Audit Log" },
];

// Sales sub-links get added here one at a time as each piece of the old FCB
// Pricing desktop app is folded in — Price List first, then Margin Analysis,
// Cost Per Case, and Contribution Margin.
const SALES_LINKS = [
  { href: "/sales/pricing", label: "Price List" },
  { href: "/sales/margin-analysis", label: "Margin Analysis" },
  { href: "/sales/cost-per-case", label: "Cost Per Case" },
  { href: "/sales/contribution-margin", label: "Contribution Margin" },
];

const OPERATIONS_STORAGE_KEY = "fcb-sidebar-operations-expanded";
const SALES_STORAGE_KEY = "fcb-sidebar-sales-expanded";

// POS > Labels > <brand> > <size> — a 3-level nested tree (unlike
// Operations/Sales, which are just one level of flat links), so its
// expand/collapse state is a single JSON blob keyed by node id rather than
// one boolean per section.
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

export default function Sidebar({ role }: { role: Role | undefined }) {
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

  const linkClass = (href: string) =>
    `rounded px-2 py-1.5 ${
      isActive(href)
        ? "bg-neutral-900 font-semibold text-white"
        : "text-neutral-400 hover:bg-neutral-900 hover:text-white"
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
        {role === "admin" ? (
          <>
            <Link href="/dashboard" className={linkClass("/dashboard")}>
              Dashboard
            </Link>

            <Link href="/ernie" className={`mt-1 ${linkClass("/ernie")}`}>
              Ernie AI
            </Link>

            <button
              type="button"
              onClick={toggleOperations}
              className="mt-2 rounded px-2 py-1.5 text-left font-semibold text-neutral-300 hover:bg-neutral-900"
            >
              Operations
            </button>
            {operationsExpanded && (
              <div className="ml-2 flex flex-col gap-1 border-l border-neutral-800 pl-3">
                {OPERATIONS_LINKS.map((link) => (
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

            <button
              type="button"
              onClick={toggleSales}
              className="mt-1 rounded px-2 py-1.5 text-left font-semibold text-neutral-300 hover:bg-neutral-900"
            >
              Sales
            </button>
            {salesExpanded && (
              <div className="ml-2 flex flex-col gap-1 border-l border-neutral-800 pl-3">
                {SALES_LINKS.map((link) => (
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

            <Link href="/events" className={`mt-1 ${linkClass("/events")}`}>
              Events Calendar
            </Link>

            <Link
              href="/admin/users"
              className={`mt-1 ${linkClass("/admin/users")}`}
            >
              Users
            </Link>
          </>
        ) : (
          <Link href="/inventory" className={linkClass("/inventory")}>
            Inventory & Allocation
          </Link>
        )}
      </nav>
    </div>
  );
}
