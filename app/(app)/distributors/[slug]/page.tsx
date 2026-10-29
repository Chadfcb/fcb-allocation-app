import { notFound, redirect } from "next/navigation";
import { getProfile } from "@/lib/getProfile";
import { hasSection } from "@/lib/permissions";
import { distributorBySlug } from "@/lib/distributorPages";
import DistributorPageClient from "@/components/DistributorPageClient";

// Distributors → <distributor> (added 2026-10-22, per Chad; replaces My
// Territory). One page per distributor, each gated by its own checkbox on
// Admin → Users → Edit access (dist_matagrano, …). Shows only that
// distributor — no switcher. Plan: claude/rep-dashboard-plan.md.
// SQL: sql/distributors.sql.
export const dynamic = "force-dynamic";

export default async function DistributorPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const page = distributorBySlug(slug);
  if (!page) notFound();
  const profile = await getProfile();
  if (!profile || !hasSection(profile.role, profile.sections, page.section, profile.is_super_admin)) redirect("/");
  const name = profile.full_name?.trim() || null;
  // isAdmin (2026-10-29): Administrators see the "James's weekly recaps" box
  // on Markstein (components/MarksteinJamesBox.tsx).
  const isAdmin = profile.role === "admin" && !!profile.is_super_admin;
  return <DistributorPageClient dist={page.name} viewerName={name} isAdmin={isAdmin} />;
}
