import { redirect } from "next/navigation";
import { getProfile } from "@/lib/getProfile";
import { hasSection } from "@/lib/permissions";
import ChainMandatesClient from "@/components/ChainMandatesClient";

// Sales > Chain Mandates — added 2026-09-05, per Chad, imported from a
// per-store chain mandate spreadsheet. Gated by the "chain_mandates"
// section, which rides along with Sales access (not its own Users > Edit
// toggle — see lib/permissions.ts SECTION_GROUPS), same redirect-guard
// pattern as every other gated page.
export default async function ChainMandatesPage() {
  const profile = await getProfile();
  if (!hasSection(profile?.role, profile?.sections, "chain_mandates")) {
    redirect("/inventory");
  }

  return <ChainMandatesClient />;
}
