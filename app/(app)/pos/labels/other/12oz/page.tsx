import { redirect } from "next/navigation";
import { getProfile } from "@/lib/getProfile";
import { hasSection } from "@/lib/permissions";
import PosLabelFilesClient from "@/components/PosLabelFilesClient";

// POS > Labels > Other > 12oz — the catch-all bucket for one-off custom
// labels that don't belong to any of FCB's own brands (e.g. Spartan Ale,
// made for San Jose State University). Added 2026-09-05, per Chad. Same
// redirect-guard pattern and "pos_labels" section gate as every other
// brand/size page in this tree.
export default async function PosLabels_other_12ozPage() {
  const profile = await getProfile();
  if (!hasSection(profile?.role, profile?.sections, "pos_labels")) {
    redirect("/inventory");
  }

  return <PosLabelFilesClient brand="other" size="12oz" />;
}
