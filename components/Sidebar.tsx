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
// NEW_SIDEBAR_IDS below when you add the item — a parent section (like
// "Calendars") uses a synthetic "section:<name>" id since it has no href
// of its own; a regular link just uses its href. The badge disappears the
// first time that person clicks it and never comes back — remembered
// per-browser in localStorage, the same way expand/collapse state is.
// Nothing existing today is flagged; per Chad, this is only for things
// added from here forward, not retroactive for Chain Calendar/Social
// Media Calendar/etc. which already existed before this feature shipped.
// Once something's been out for a while, just delete its id from the list
// below — no need to keep it around forever.

import { useState, useEffect } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import type { Role } from "@/lib/types/db";
import { hasSection, ERNIE_SECTION, type AnySectionKey, type SectionKey } from "@/lib/permissions";
import { createClient } from "@/lib/supabase/client";

const NEW_SIDEBAR_IDS: string[] = [
  // e.g. "section:calendars", "/chain-calendar",
];

function NewBadge() {
  return (
    <span className="ml-auto shrink-0 rounded-full bg-[#6ABC46] px-1.5 py-0.5 text-[9px] font-bold leading-none text-black">
      New!
    </span>
  );
}

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

// Calendars — currently just Events Calendar, structured as an expandable
// parent (like Operations/Sales) rather than a flat link, since Chad plans
// to add more calendar types under this same category later.
const CALENDARS_LINKS: { href: string; label: string; section: SectionKey }[] = [
  { href: "/events", label: "Events Calendar", section: "events_calendar" },
  { href: "/chain-calendar", label: "Chain Calendar", section: "events_calendar" },
  { href: "/social-media-calendar", label: "Social Media Calendar", section: "events_calendar" },
];

const OPERATIONS_STORAGE_KEY = "fcb-sidebar-operations-expanded";
const SALES_STORAGE_KEY = "fcb-sidebar-sales-expanded";
const CALENDARS_STORAGE_KEY = "fcb-sidebar-calendars-expanded";

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
  const [calendarsExpanded, setCalendarsExpanded] = useState(true);
  const [posTreeExpanded, setPosTreeExpanded] = useState<
    Record<string, boolean>
  >({ pos: true, "pos-labels": true });
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

  useEffect(() => {
    // Pull this person's previously-dismissed "New!" badges from the
    // database on mount — nothing to fetch if nothing's currently flagged.
    if (NEW_SIDEBAR_IDS.length === 0) return;
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

  // Whether a "New!" badge should currently show for this id — flagged in
  // NEW_SIDEBAR_IDS above, and not yet clicked by this person.
  function showsNew(id: string) {
    return NEW_SIDEBAR_IDS.includes(id) && !seenNew[id];
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

  function toggleCalendars() {
    setCalendarsExpanded((prev) => {
      const next = !prev;
      localStorage.setItem(CALENDARS_STORAGE_KEY, String(next));
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
    `flex items-center gap-2 rounded border-l-2 px-2 py-1.5 ${
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
  const visibleCalendars = CALENDARS_LINKS.filter((link) => can(link.section));
  const showErnie = can(ERNIE_SECTION);
  const showTasks = can("tasks");

  const nothingVisible =
    role !== "admin" &&
    !showErnie &&
    !showTasks &&
    visibleOperations.length === 0 &&
    visibleSales.length === 0 &&
    !showPosTree &&
    visibleCalendars.length === 0;

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
          <Link href="/dashboard" className={linkClass("/dashboard")} onClick={() => dismissNew("/dashboard")}>
            Dashboard
            {showsNew("/dashboard") && <NewBadge />}
          </Link>
        )}

        {showErnie && (
          <Link href="/ernie" className={`mt-1 ${linkClass("/ernie")}`} onClick={() => dismissNew("/ernie")}>
            Ernie AI
            {showsNew("/ernie") && <NewBadge />}
          </Link>
        )}

        {/* Tasks (formerly "Projects") — the company-wide action/directive
            tracker. Gated by the "tasks" section (added 2026-09-04), same as
            every other link here — anyone with it checked gets full,
            unrestricted use of Tasks itself (create/assign/resolve/delete),
            this only controls who can get into the page at all. */}
        {showTasks && (
          <Link href="/tasks" className={`mt-1 ${linkClass("/tasks")}`} onClick={() => dismissNew("/tasks")}>
            Tasks
            {showsNew("/tasks") && <NewBadge />}
          </Link>
        )}

        {visibleOperations.length > 0 && (
          <>
            <button
              type="button"
              onClick={() => {
                toggleOperations();
                dismissNew("section:operations");
              }}
              className="mt-2 flex items-center gap-2 rounded px-2 py-1.5 text-left font-semibold text-neutral-300 hover:bg-neutral-900"
            >
              Operations
              {showsNew("section:operations") && <NewBadge />}
            </button>
            {operationsExpanded && (
              <div className="ml-2 flex flex-col gap-1 border-l border-neutral-800 pl-3">
                {visibleOperations.map((link) => (
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
              className="mt-1 flex items-center gap-2 rounded px-2 py-1.5 text-left font-semibold text-neutral-300 hover:bg-neutral-900"
            >
              Sales
              {showsNew("section:sales") && <NewBadge />}
            </button>
            {salesExpanded && (
              <div className="ml-2 flex flex-col gap-1 border-l border-neutral-800 pl-3">
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

        {showPosTree && (
          <>
            <button
              type="button"
              onClick={() => {
                togglePosTree("pos");
                dismissNew("section:pos");
              }}
              className="mt-1 flex items-center gap-2 rounded px-2 py-1.5 text-left font-semibold text-neutral-300 hover:bg-neutral-900"
            >
              POS
              {showsNew("section:pos") && <NewBadge />}
            </button>
            {posTreeExpanded.pos && (
              <div className="ml-2 flex flex-col gap-1 border-l border-neutral-800 pl-3">
                <button
                  type="button"
                  onClick={() => {
                    togglePosTree("pos-labels");
                    dismissNew("section:pos-labels");
                  }}
                  className="flex items-center gap-2 rounded px-2 py-1 text-left text-sm font-semibold text-neutral-400 hover:bg-neutral-900 hover:text-white"
                >
                  Labels
                  {showsNew("section:pos-labels") && <NewBadge />}
                </button>
                {posTreeExpanded["pos-labels"] && (
                  <div className="ml-2 flex flex-col gap-1 border-l border-neutral-800 pl-3">
                    {POS_LABEL_BRANDS.map((brand) => (
                      <div key={brand.treeKey} className="flex flex-col gap-1">
                        <button
                          type="button"
                          onClick={() => {
                            togglePosTree(brand.treeKey);
                            dismissNew(`section:${brand.treeKey}`);
                          }}
                          className="flex items-center gap-2 rounded px-2 py-1 text-left text-sm text-neutral-400 hover:bg-neutral-900 hover:text-white"
                        >
                          {brand.label}
                          {showsNew(`section:${brand.treeKey}`) && <NewBadge />}
                        </button>
                        {posTreeExpanded[brand.treeKey] && (
                          <div className="ml-2 flex flex-col gap-1 border-l border-neutral-800 pl-3">
                            {brand.sizes.map((s) => (
                              <Link
                                key={s.href}
                                href={s.href}
                                className={linkClass(s.href)}
                                onClick={() => dismissNew(s.href)}
                              >
                                {s.label}
                                {showsNew(s.href) && <NewBadge />}
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

        {visibleCalendars.length > 0 && (
          <>
            <button
              type="button"
              onClick={() => {
                toggleCalendars();
                dismissNew("section:calendars");
              }}
              className="mt-1 flex items-center gap-2 rounded px-2 py-1.5 text-left font-semibold text-neutral-300 hover:bg-neutral-900"
            >
              Calendars
              {showsNew("section:calendars") && <NewBadge />}
            </button>
            {calendarsExpanded && (
              <div className="ml-2 flex flex-col gap-1 border-l border-neutral-800 pl-3">
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

        {role === "admin" && (
          <Link
            href="/admin/users"
            className={`mt-1 ${linkClass("/admin/users")}`}
            onClick={() => dismissNew("/admin/users")}
          >
            Users
            {showsNew("/admin/users") && <NewBadge />}
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
