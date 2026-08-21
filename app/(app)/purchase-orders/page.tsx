import { redirect } from "next/navigation";
import { getProfile } from "@/lib/getProfile";
import PurchaseOrdersPageClient from "@/components/PurchaseOrdersPageClient";

// Operations > Purchase Orders — admin-only, full stop (like Sales), so the
// redirect guard lives here rather than relying on RLS alone.
export default async function PurchaseOrdersPage() {
  const profile = await getProfile();
  if (profile?.role !== "admin") {
    redirect("/inventory");
  }

  return <PurchaseOrdersPageClient />;
}
