import { redirect } from "next/navigation";
import { getProfile } from "@/lib/getProfile";
import { hasSection } from "@/lib/permissions";
import SalesSheetsClient from "@/components/SalesSheetsClient";

// POS > Sales Sheets (added 2026-11-10, per Chad) — FCB / Speakeasy / Sonoma
// Cider sales sheets with previews and downloads, like Football POS. Gated by
// the "sales_sheets" checkbox (Admin → Users, under POS). Every distributor
// page has a "Sales Sheets" button that opens this page.
export default async function SalesSheetsPage() {
  const profile = await getProfile();
  if (!hasSection(profile?.role, profile?.sections, "sales_sheets", profile?.is_super_admin)) {
    redirect("/inventory");
  }

  return <SalesSheetsClient />;
}
