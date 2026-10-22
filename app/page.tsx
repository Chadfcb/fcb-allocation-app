import { redirect } from "next/navigation";
import { getProfile } from "@/lib/getProfile";
import { homeFor } from "@/lib/access";

// Home: admins → Operations Dashboard; anyone with Inventory & Allocation →
// there (same as always); otherwise the first page they've been given
// (distributor-only reps like Steve → their distributor page), or the
// "no access yet" page if they haven't been given anything (2026-10-22).
export default async function Home() {
  const profile = await getProfile();
  redirect(homeFor(profile));
}
