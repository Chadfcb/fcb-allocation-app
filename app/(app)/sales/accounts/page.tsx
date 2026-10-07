import { redirect } from "next/navigation";
import { getProfile } from "@/lib/getProfile";
import { hasSection } from "@/lib/permissions";
import SalesAccountsClient from "@/components/SalesAccountsClient";

// Sales > Accounts — added 2026-10-07, per Chad + Art (Feature 1 of the sales
// system, project doc claude/sales-system-build-plan.md). Every account with
// its stage, rep (by distributor territory), purchase history and contacts.
// Gated by the "accounts" section, which rides along with Sales access (not
// its own Users > Edit toggle), same as Chain Authorizations. Admins also get
// the Import data panel.
export default async function SalesAccountsPage() {
  const profile = await getProfile();
  if (!hasSection(profile?.role, profile?.sections, "accounts")) {
    redirect("/inventory");
  }

  return <SalesAccountsClient isAdmin={profile?.role === "admin"} />;
}
