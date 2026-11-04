import { NextResponse } from "next/server";
import { getProfile } from "@/lib/getProfile";
import { hasSection } from "@/lib/permissions";
import { createAdminClient } from "@/lib/supabase/admin";
import { geocodeBeerFinder, geocodeSummary } from "@/lib/beerFinderGeocode";

// Beer Finder → Control → "Place pins now" (added 2026-11-04). Looks up map
// pins for every account that still needs one (same step the weekday LilyPad
// sync runs at the end). Beer Finder access only.
export const maxDuration = 300;

export async function POST() {
  const profile = await getProfile();
  if (!profile) return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  if (!hasSection(profile.role, profile.sections, "beer_finder", profile.is_super_admin)) {
    return NextResponse.json({ error: "You don't have access to the Beer Finder." }, { status: 403 });
  }
  // 4 minutes of looking up (Vercel allows 5); anything left goes next run.
  const r = await geocodeBeerFinder(createAdminClient(), 20000, 240_000);
  return NextResponse.json({ ...r, summary: geocodeSummary(r) });
}
