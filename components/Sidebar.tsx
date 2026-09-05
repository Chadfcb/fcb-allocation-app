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
  // Audit Log used to be last here — moved out to its own top-level nav
  // entry below Users (see the standalone Link further down), per Chad,
  // 2026-09-05: "lets move audit log to a main category, below Users, and
  // out of operations." UPC's (new, same date) is no longer a flat link
  // here either — like Labels, it's now its own expandable brand tree
  // (see UPC_BRANDS / showUpcTree below) rendered right after Labels.
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

// POS — restored 2026-09-05 as its own top-level nav section, per Chad,
// after "move Labels out of POS" got read too literally and the whole POS
// entry disappeared along with it (Labels was the only thing under it, and
// an empty top-level section doesn't render on its own — see the
// showPosSection check below). Labels itself correctly stays under
// Operations; POS is back empty, on purpose, for Chad to add new items to.
// Matches lib/permissions.ts's "pos_labels" GroupKey, which was already
// kept around empty with the label "POS" for the same reason.
const POS_STORAGE_KEY = "fcb-sidebar-pos-expanded";
const POS_LINKS: { href: string; label: string; section: SectionKey }[] = [];

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
}: {
  role: Role | undefined;
  sections: AnySectionKey[];
}) {
  const pathname = usePathname();
  const [hidden, setHidden] = useState(false);
  const [operationsExpanded, setOperationsExpanded] = useState(true);
  const [salesExpanded, setSalesExpanded] = useState(true);
  const [calendarsExpanded, setCalendarsExpanded] = useState(true);
  const [posExpanded, setPosExpanded] = useState(true);
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
  function closeOtherTopLevelSections(except: "operations" | "sales" | "calendars" | "pos") {
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

  const nothingVisible =
    role !== "admin" &&
    !showErnie &&
    !showTasks &&
    !showAuditLog &&
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

        {(visibleOperations.length > 0 || showPosTree || showUpcTree) && (
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
              {sectionShowsNew("section:operations", operationsDescendantIds) && <NewBadge />}
            </button>
            {operationsExpanded && (
              <div className="ml-2 flex flex-col gap-1 border-l border-neutral-800 pl-3">
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

                {/* Labels — moved here from its own top-level "POS" nav
                    entry, per Chad 2026-09-05: "Labels needs to be a sub
                    category of Operations... remove it from POS." POS
                    itself has no items left and no longer shows up top-
                    level at all (see lib/permissions.ts SECTION_GROUPS,
                    which made this same move for the Users > Edit grant
                    checkboxes on the same date). Still gated by the same
                    'pos_labels' section/showPosTree as before — only
                    where it renders changed. */}
                {showPosTree && (
                  <div className="flex flex-col gap-1">
                    <button
                      type="button"
                      onClick={() => {
                        togglePosTree("pos-labels");
                        dismissNew("section:pos-labels");
                      }}
                      className="rounded px-2 py-1 text-left text-sm font-semibold text-neutral-400 hover:bg-neutral-900 hover:text-white flex items-center gap-2"
                    >
                      Labels
                      {sectionShowsNew("section:pos-labels", labelsDescendantIds()) && <NewBadge />}
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
                              {sectionShowsNew(`section:${brand.treeKey}`, brand.sizes.map((s) => s.href)) && <NewBadge />}
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

                {/* UPC's — new expandable brand+size tree, added
                    2026-09-05 right after Labels, set up exactly like it
                    per Chad: "i want it set up exactly like the labels
                    is." Same two-level structure (brand -> size), just an
                    editable Product/UPC table on each size's page instead
                    of a file library. */}
                {showUpcTree && (
                  <div className="flex flex-col gap-1">
                    <button
                      type="button"
                      onClick={() => {
                        togglePosTree("upcs");
                        dismissNew("section:upcs");
                      }}
                      className="rounded px-2 py-1 text-left text-sm font-semibold text-neutral-400 hover:bg-neutral-900 hover:text-white flex items-center gap-2"
                    >
                      UPC&apos;s
                      {sectionShowsNew("section:upcs", upcDescendantIds()) && <NewBadge />}
                    </button>
                    {posTreeExpanded["upcs"] && (
                      <div className="ml-2 flex flex-col gap-1 border-l border-neutral-800 pl-3">
                        {UPC_BRANDS.map((brand) => (
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
                              {sectionShowsNew(`section:${brand.treeKey}`, brand.sizes.map((s) => s.href)) && <NewBadge />}
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
              className="mt-1 flex items-center gap-2 rounded px-2 py-1.5 text-left font-semibold text-neutral-300 hover:bg-neutral-900"
            >
              Sales
              {sectionShowsNew("section:sales", visibleSales.map((link) => link.href)) && <NewBadge />}
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

        {/* POS — its own top-level section, empty for now. Restored
            2026-09-05 per Chad after it got removed by mistake along with
            Labels (Labels moved to Operations, which was the actual
            request — POS itself was meant to stay, just empty, ready for
            new items). Placed here, between Sales and Calendars, per Chad. */}
        {showPosSection && (
          <>
            <button
              type="button"
              onClick={() => {
                togglePos();
                dismissNew("section:pos");
              }}
              className="mt-1 flex items-center gap-2 rounded px-2 py-1.5 text-left font-semibold text-neutral-300 hover:bg-neutral-900"
            >
              POS
              {sectionShowsNew("section:pos", visiblePos.map((link) => link.href)) && <NewBadge />}
            </button>
            {posExpanded && (
              <div className="ml-2 flex flex-col gap-1 border-l border-neutral-800 pl-3">
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
                  <p className="px-2 py-1 text-xs leading-relaxed text-neutral-600">
                    Nothing here yet.
                  </p>
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
              {sectionShowsNew("section:calendars", visibleCalendars.map((link) => link.href)) && <NewBadge />}
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

        {/* Audit Log — moved here from inside Operations, per Chad,
            2026-09-05: "lets move audit log to a main category, below
            Users, and out of operations." Same "audit_log" section/page
            as before, just a standalone top-level link now instead of an
            Operations sub-link. */}
        {showAuditLog && (
          <Link
            href="/admin/audit"
            className={`mt-1 ${linkClass("/admin/audit")}`}
            onClick={() => dismissNew("/admin/audit")}
          >
            Audit Log
            {showsNew("/admin/audit") && <NewBadge />}
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
