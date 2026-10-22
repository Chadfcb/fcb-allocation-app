import { redirect } from "next/navigation";
import { getProfile } from "@/lib/getProfile";
import { hasSection } from "@/lib/permissions";
import MyTerritoryClient from "@/components/MyTerritoryClient";

// My Territory (added 2026-10-21, per Chad): a rep's own daily dashboard for
// their distributor(s) only — first for Steve / Matagrano. Gated by its own
// "My Territory" access on Admin → Users; the territory is set on the same
// Edit access panel (rep_territories). Admins can pick any distributor.
// Plan: claude/rep-dashboard-plan.md. SQL: sql/my_territory.sql.
export const dynamic = "force-dynamic";

export default async function MyTerritoryPage() {
  const profile = await getProfile();
  if (!profile || !hasSection(profile.role, profile.sections, "my_territory", profile.is_super_admin)) redirect("/");
  const name = profile.full_name?.trim() || null;
  return <MyTerritoryClient isAdmin={profile.role === "admin"} viewerName={name} />;
}
