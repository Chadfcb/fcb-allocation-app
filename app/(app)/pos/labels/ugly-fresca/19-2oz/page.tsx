import { redirect } from "next/navigation";
import { getProfile } from "@/lib/getProfile";
import { hasSection } from "@/lib/permissions";
import PosLabelFilesClient from "@/components/PosLabelFilesClient";

// POS > Labels > ugly-fresca > 19.2oz — gated by the "pos_labels"
// section (the whole POS > Labels tree shares one section), same
// redirect-guard pattern as Events Calendar and Purchase Orders.
export default async function PosLabels_ugly_fresca_19_2ozPage() {
  const profile = await getProfile();
  if (!hasSection(profile?.role, profile?.sections, "pos_labels")) {
    redirect("/inventory");
  }

  return <PosLabelFilesClient brand="ugly-fresca" size="19.2oz" />;
}
