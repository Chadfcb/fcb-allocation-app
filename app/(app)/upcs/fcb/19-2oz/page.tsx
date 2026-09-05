import { redirect } from "next/navigation";
import { getProfile } from "@/lib/getProfile";
import { hasSection } from "@/lib/permissions";
import UpcTableClient from "@/components/UpcTableClient";

// UPC's > fcb > 19.2oz — gated by the "upcs" section, same
// redirect-guard pattern as Labels (POS > Labels > fcb > 19.2oz) and
// every other gated page.
export default async function Upcs_fcb_19_2ozPage() {
  const profile = await getProfile();
  if (!hasSection(profile?.role, profile?.sections, "upcs")) {
    redirect("/inventory");
  }

  return <UpcTableClient brand="fcb" size="19.2oz" />;
}
