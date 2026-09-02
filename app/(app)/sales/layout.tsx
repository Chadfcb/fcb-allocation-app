import { redirect } from "next/navigation";
import { getProfile } from "@/lib/getProfile";
import { hasAnySection } from "@/lib/permissions";

// Every page under Sales (Price List, Margin Analysis, Cost Per Case,
// Contribution Margin) needs at least one Sales section granted to enter
// the /sales area at all — this guard covers all of them in one place.
// Exactly which of the 4 pages shows up in the sidebar, and which of their
// underlying tables a given person can actually read/write, still follows
// that person's own specific section grants (see lib/permissions.ts and
// sql/user_section_access.sql) — this is just the outer gate.
export default async function SalesLayout({ children }: { children: React.ReactNode }) {
  const profile = await getProfile();
  if (
    !hasAnySection(profile?.role, profile?.sections, [
      "price_list",
      "margin_analysis",
      "cost_per_case",
      "contribution_margin",
    ])
  ) {
    redirect("/inventory");
  }

  return <>{children}</>;
}
