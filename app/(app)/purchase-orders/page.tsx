import { redirect } from "next/navigation";
import { getProfile } from "@/lib/getProfile";
import { hasSection } from "@/lib/permissions";
import PurchaseOrdersPageClient from "@/components/PurchaseOrdersPageClient";

// Operations > Purchase Orders — gated by the "purchase_orders" section
// (see lib/permissions.ts), so the redirect guard lives here rather than
// relying on RLS alone.
export default async function PurchaseOrdersPage() {
  const profile = await getProfile();
  if (!hasSection(profile?.role, profile?.sections, "purchase_orders")) {
    redirect("/inventory");
  }

  return <PurchaseOrdersPageClient />;
}
