import { redirect } from "next/navigation";
import { getProfile } from "@/lib/getProfile";
import { hasSection } from "@/lib/permissions";
import PosLabelFilesClient from "@/components/PosLabelFilesClient";

// POS > Labels > sonoma-cider > 12oz — gated by the "pos_labels"
// section (the whole POS > Labels tree shares one section), same
// redirect-guard pattern as Events Calendar and Purchase Orders.
export default async function PosLabels_sonoma_cider_12ozPage() {
  const profile = await getProfile();
  if (!hasSection(profile?.role, profile?.sections, "pos_labels")) {
    redirect("/inventory");
  }

  return <PosLabelFilesClient brand="sonoma-cider" size="12oz" />;
}
