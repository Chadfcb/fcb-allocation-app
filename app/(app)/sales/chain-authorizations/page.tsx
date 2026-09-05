import { redirect } from "next/navigation";
import { getProfile } from "@/lib/getProfile";
import { hasSection } from "@/lib/permissions";
import ChainAuthorizationsClient from "@/components/ChainAuthorizationsClient";

// Sales > Chain Authorizations — added 2026-09-05, per Chad, imported from
// a chain authorizations spreadsheet. Gated by the "chain_authorizations"
// section, which rides along with Sales access (not its own Users > Edit
// toggle — see lib/permissions.ts SECTION_GROUPS), same redirect-guard
// pattern as every other gated page.
export default async function ChainAuthorizationsPage() {
  const profile = await getProfile();
  if (!hasSection(profile?.role, profile?.sections, "chain_authorizations")) {
    redirect("/inventory");
  }

  return <ChainAuthorizationsClient />;
}
