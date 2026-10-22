import { redirect } from "next/navigation";
import { getProfile } from "@/lib/getProfile";
import { hasSection } from "@/lib/permissions";
import { DISTRIBUTOR_PAGES, distributorHref } from "@/lib/distributorPages";

// My Territory (2026-10-21) became Distributors → <distributor> on
// 2026-10-22. Old links / bookmarks land on the person's first distributor page.
export const dynamic = "force-dynamic";

export default async function MyTerritoryPage() {
  const profile = await getProfile();
  const first = profile ? DISTRIBUTOR_PAGES.find((d) => hasSection(profile.role, profile.sections, d.section, profile.is_super_admin)) : null;
  redirect(first ? distributorHref(first.slug) : "/");
}
