import { redirect } from "next/navigation";
import { getProfile } from "@/lib/getProfile";
import TanksClient from "@/components/TanksClient";

// Tanks (added 2026-10-03, per Chad) — 3D "x-ray" view of every unitank in
// the cellar. Sits under MAIN, right below Dashboard. Admins only for now,
// same as Dashboard (not a grantable section yet — making it one needs a new
// SectionKey + its SQL). Design notes: claude/tank-view-direction.md and
// claude/tank-floor-layout.md.
export default async function TanksPage() {
  const profile = await getProfile();
  if (!profile || profile.role !== "admin") redirect("/");
  return <TanksClient />;
}
