import { redirect } from "next/navigation";
import { getProfile } from "@/lib/getProfile";
import { hasSection } from "@/lib/permissions";
import SkeletonHeroPageClient from "@/components/SkeletonHeroPageClient";

// Skeleton Hero — the Ernie mini-game. Gated by the "skeleton_hero_game"
// section (see lib/permissions.ts and sql/skeleton_hero_scores.sql), same
// server-component-checks-then-renders-client-component pattern as every
// other gated page (Tasks, Events Calendar, etc.) — see
// app/(app)/tasks/page.tsx for the precedent this follows.
export default async function SkeletonHeroPage() {
  const profile = await getProfile();
  if (!hasSection(profile?.role, profile?.sections, "skeleton_hero_game")) {
    redirect("/inventory");
  }

  // Computed here (server-side, from the profile we already have) rather
  // than re-fetched client-side — sidesteps needing any RLS policy that
  // would let a signed-in user read ANOTHER user's profile row, since the
  // leaderboard only ever needs to write down each person's own name at the
  // moment they submit a score (see sql/skeleton_hero_scores.sql's
  // display_name column).
  const displayName = profile?.full_name?.trim() || profile?.email?.split("@")[0] || "Player";

  return <SkeletonHeroPageClient displayName={displayName} />;
}
