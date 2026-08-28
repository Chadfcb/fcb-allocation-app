import { redirect } from "next/navigation";
import { getProfile } from "@/lib/getProfile";
import PosLabelFilesClient from "@/components/PosLabelFilesClient";

// POS > Labels > fcb > 16oz — admin-only, same redirect-guard
// pattern as Events Calendar and Purchase Orders.
export default async function PosLabels_fcb_16ozPage() {
  const profile = await getProfile();
  if (profile?.role !== "admin") {
    redirect("/inventory");
  }

  return <PosLabelFilesClient brand="fcb" size="16oz" />;
}
