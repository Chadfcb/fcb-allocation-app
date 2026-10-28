import { redirect } from "next/navigation";
import { getProfile } from "@/lib/getProfile";
import { hasSection } from "@/lib/permissions";
import SalesDashboardClient from "@/components/SalesDashboardClient";

// Sales Dashboard (added 2026-10-08, per Chad) — under MAIN, below Tanks.
// Gap report by chain / distributor (By store and By item, Flex / Mandate
// color coding, Excel export), Chain setup, and turning accounts off / back
// on. Gated by its own "Sales Dashboard" access on Admin → Users (admins
// always have it). Plan: claude/sales-dashboard-plan.md. SQL: sql/sales_dashboard.sql.
export const dynamic = "force-dynamic";

export default async function SalesDashboardPage() {
  const profile = await getProfile();
  if (!profile || !hasSection(profile.role, profile.sections, "sales_dashboard", profile.is_super_admin)) redirect("/");
  // Quick links under the title (2026-10-28): UPC's and POS only show for
  // people who can open those pages.
  const can = (k: "upcs" | "football_pos") => hasSection(profile.role, profile.sections, k, profile.is_super_admin);
  return <SalesDashboardClient canUpcs={can("upcs")} canPos={can("football_pos")} />;
}
