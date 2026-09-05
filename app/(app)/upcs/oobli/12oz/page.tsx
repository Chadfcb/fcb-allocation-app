import { redirect } from "next/navigation";
import { getProfile } from "@/lib/getProfile";
import { hasSection } from "@/lib/permissions";
import UpcTableClient from "@/components/UpcTableClient";

// UPC's > oobli > 12oz — gated by the "upcs" section, same
// redirect-guard pattern as Labels (POS > Labels > oobli > 12oz) and
// every other gated page.
export default async function Upcs_oobli_12ozPage() {
  const profile = await getProfile();
  if (!hasSection(profile?.role, profile?.sections, "upcs")) {
    redirect("/inventory");
  }

  return <UpcTableClient brand="oobli" size="12oz" />;
}
