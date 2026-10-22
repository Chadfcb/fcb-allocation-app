// Distributors (Departments → Distributors), added 2026-10-22, per Chad:
// one dashboard page per distributor (Matagrano first, for Steve), each
// gated on its own in Admin → Users → Edit access — "steve has access to the
// distributors button, but only sees the sub category of Matagrano." Replaces
// the 10/21 My Territory page. Plan: claude/rep-dashboard-plan.md.
//
// The section key for each page is "dist_" + the name in lower case with
// spaces as underscores (Valley Wide → dist_valley_wide). The database
// works it out the same way (dist_section() in sql/distributors.sql), so a
// page added here needs no SQL change for its access rule.
//
// Order = Chad's order, also the Sidebar and Users > Edit order.

export const DISTRIBUTOR_PAGES = [
  { slug: "matagrano", name: "Matagrano", section: "dist_matagrano" },
  { slug: "guardian", name: "Guardian", section: "dist_guardian" },
  { slug: "valley-wide", name: "Valley Wide", section: "dist_valley_wide" },
  { slug: "mussetter", name: "Mussetter", section: "dist_mussetter" },
  { slug: "markstein", name: "Markstein", section: "dist_markstein" },
  { slug: "superior", name: "Superior", section: "dist_superior" },
  { slug: "saccani", name: "Saccani", section: "dist_saccani" },
  { slug: "coast", name: "Coast", section: "dist_coast" },
] as const;

export type DistributorPage = (typeof DISTRIBUTOR_PAGES)[number];
export type DistributorSectionKey = DistributorPage["section"];

export const distributorHref = (slug: string) => `/distributors/${slug}`;

export function distributorBySlug(slug: string): DistributorPage | null {
  return DISTRIBUTOR_PAGES.find((d) => d.slug === slug) ?? null;
}

// Distributors whose weekly inventory comes in a file instead of Ekos (the
// Upload inventory button). Superior: "SPC Full Circle Inventory.xlsx", emailed
// by VIP every Monday. Coast sends no inventory at all yet (Chad, 2026-10-22:
// "a work in progress").
export const FILE_INVENTORY_DISTRIBUTORS = ["Superior"];
export const NO_INVENTORY_DISTRIBUTORS = ["Coast"];
