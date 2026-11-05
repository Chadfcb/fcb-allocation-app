import { redirect } from "next/navigation";
import { getProfile } from "@/lib/getProfile";
import { hasSection } from "@/lib/permissions";
import BeerFinderClient from "@/components/BeerFinderClient";

// Beer Finder (added 2026-11-04, per Chad — Main, below Tasks). Step 1 of the
// "find our beer" map: the internal map (with sales detail) and the Control
// tab that decides what the public website finder will show. Its own "Beer
// Finder" access (Admin → Users; admins always have it). SQL:
// sql/beer_finder.sql. Plan: claude/beer-finder-plan.md in the project.
// Moved to /beer-finder/manage on 2026-11-04 (per Chad) so the PUBLIC website
// finder can be www.fcb-data.com/beer-finder (app/beer-finder/page.tsx).
export const dynamic = "force-dynamic";

export default async function BeerFinderPage() {
  const profile = await getProfile();
  if (!profile || !hasSection(profile.role, profile.sections, "beer_finder", profile.is_super_admin)) redirect("/");
  return <BeerFinderClient />;
}
