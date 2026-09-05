import { redirect } from "next/navigation";
import { getProfile } from "@/lib/getProfile";
import { hasSection } from "@/lib/permissions";
import UpcTableClient from "@/components/UpcTableClient";

// UPC's > ugly-fresca > 16oz — gated by the "upcs" section, same
// redirect-guard pattern as Labels (POS > Labels > ugly-fresca > 16oz) and
// every other gated page.
export default async function Upcs_ugly_fresca_16ozPage() {
  const profile = await getProfile();
  if (!hasSection(profile?.role, profile?.sections, "upcs")) {
    redirect("/inventory");
  }

  return <UpcTableClient brand="ugly-fresca" size="16oz" />;
}
