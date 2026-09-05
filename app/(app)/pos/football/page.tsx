import { redirect } from "next/navigation";
import { getProfile } from "@/lib/getProfile";
import { hasSection } from "@/lib/permissions";
import FootballPosFilesClient from "@/components/FootballPosFilesClient";

// POS > Football POS — a flat file library of football-season POS art
// (posters, table tents, stickers, distributor strips). Added 2026-09-05,
// per Chad: "these items need to go in there with Previews and download
// abilities, they need to look just like how we did the labels." Gated by
// the "football_pos" section, which rides along with POS access (see
// lib/permissions.ts SECTION_GROUPS), same redirect-guard pattern as every
// other gated page.
export default async function FootballPosPage() {
  const profile = await getProfile();
  if (!hasSection(profile?.role, profile?.sections, "football_pos")) {
    redirect("/inventory");
  }

  return <FootballPosFilesClient />;
}
