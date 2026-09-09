import { redirect } from "next/navigation";
import { getProfile } from "@/lib/getProfile";
import { hasSection } from "@/lib/permissions";
import CashflowDashboardPageClient from "@/components/CashflowDashboardPageClient";

// Finance > Cash Flow Dashboard — gated by the "cashflow_dashboard" section,
// which is itself one of the ADMIN_RESTRICTED_SECTIONS (see
// lib/permissions.ts): being an admin does NOT automatically grant this —
// only an Administrator (role='admin' AND is_super_admin) always has it; a
// Manager needs it separately granted via Users > Edit, same as an
// Employee would. Real numbers: Realized Revenue (Delivered distributor
// orders' Order Value) and Vendor PO Spend are wired in; Planned Batch
// Expenses shows as not-yet-tracked until a Brew Planner exists — see
// components/CashflowDashboardPageClient.tsx.
export default async function CashflowDashboardPage() {
  const profile = await getProfile();
  if (!hasSection(profile?.role, profile?.sections, "cashflow_dashboard", profile?.is_super_admin)) {
    redirect("/inventory");
  }

  return <CashflowDashboardPageClient />;
}
