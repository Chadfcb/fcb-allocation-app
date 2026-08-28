import { redirect } from "next/navigation";
import { getProfile } from "@/lib/getProfile";
import PosLabelFilesClient from "@/components/PosLabelFilesClient";

// POS > Labels > speakeasy > 16oz — admin-only, same redirect-guard
// pattern as Events Calendar and Purchase Orders.
export default async function PosLabels_speakeasy_16ozPage() {
  const profile = await getProfile();
  if (profile?.role !== "admin") {
    redirect("/inventory");
  }

  return <PosLabelFilesClient brand="speakeasy" size="16oz" />;
}
