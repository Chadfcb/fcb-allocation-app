import { redirect } from "next/navigation";
import { getProfile } from "@/lib/getProfile";
import { hasSection } from "@/lib/permissions";
import TanksClient from "@/components/TanksClient";

// Tanks (added 2026-10-03, per Chad) — 3D "x-ray" view of every unitank in
// the cellar. Sits under MAIN, right below Dashboard. Gated by its own
// "Tanks" access on Admin → Users (2026-10-03, per Chad: "It needs to be
// gated as well") — admins always have it, everyone else only when checked.
// Design notes: claude/tank-view-direction.md and claude/tank-floor-layout.md.
export default async function TanksPage() {
  const profile = await getProfile();
  if (!profile || !hasSection(profile.role, profile.sections, "tanks", profile.is_super_admin)) redirect("/");
  return <TanksClient />;
}
