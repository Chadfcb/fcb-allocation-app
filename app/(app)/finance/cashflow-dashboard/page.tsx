import { redirect } from "next/navigation";
import { getProfile } from "@/lib/getProfile";
import { hasSection } from "@/lib/permissions";
import CashflowDashboardPageClient from "@/components/CashflowDashboardPageClient";

// Finance > Cash Flow Dashboard — gated by the "cashflow_dashboard" section
// (see lib/permissions.ts). This first pass is just the section itself:
// nav entry, access control, and a placeholder page. The actual numbers
// (Planned Batch Expenses from a future Brew Planner, Vendor PO Spend,
// Realized Revenue from Delivered orders, rolled into a weekly/13-week
// view) get wired in as a follow-up — see the flowchart artifact Chad and
// Claude worked through together for the planned data flow.
export default async function CashflowDashboardPage() {
  const profile = await getProfile();
  if (!hasSection(profile?.role, profile?.sections, "cashflow_dashboard")) {
    redirect("/inventory");
  }

  return <CashflowDashboardPageClient />;
}
