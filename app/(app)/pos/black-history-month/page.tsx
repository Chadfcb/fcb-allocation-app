import { redirect } from "next/navigation";
import { getProfile } from "@/lib/getProfile";
import { hasSection } from "@/lib/permissions";
import BhmPosFilesClient from "@/components/BhmPosFilesClient";

// Sales → POS → Black History Month (added 2026-11-17, per Chad: "works the
// same way the football section works", same POS as last year). Gated by the
// "bhm_pos" checkbox (Admin → Users, under POS).
export default async function BhmPosPage() {
  const profile = await getProfile();
  if (!hasSection(profile?.role, profile?.sections, "bhm_pos", profile?.is_super_admin)) {
    redirect("/inventory");
  }

  return <BhmPosFilesClient />;
}
