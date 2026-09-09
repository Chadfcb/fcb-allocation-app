import { redirect } from "next/navigation";
import { getProfile } from "@/lib/getProfile";
import { hasSection } from "@/lib/permissions";
import DistributorDataPageClient from "@/components/DistributorDataPageClient";

// Finance > Distributor Data — gated by the "distributor_data" section,
// itself one of the ADMIN_RESTRICTED_SECTIONS (see lib/permissions.ts):
// being an admin does NOT automatically grant this — only an
// Administrator (role='admin' AND is_super_admin) always has it; a
// Manager needs it separately granted via Users > Edit, same as an
// Employee would. Added 2026-09-09 per Chad, who wanted distributor
// payment terms living in Finance rather than Operations or Sales — this
// page is also where any other distributor-level finance data lands as
// it comes up.
export default async function DistributorDataPage() {
  const profile = await getProfile();
  if (!hasSection(profile?.role, profile?.sections, "distributor_data", profile?.is_super_admin)) {
    redirect("/inventory");
  }

  return <DistributorDataPageClient />;
}
