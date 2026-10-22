import { redirect } from "next/navigation";
import { getProfile } from "@/lib/getProfile";
import { DISTRIBUTOR_PAGES, distributorHref } from "@/lib/distributorPages";

export default async function Home() {
  const profile = await getProfile();
  if (profile?.role === "admin") redirect("/dashboard");
  // A rep set up with only distributor page(s) (2026-10-22 — e.g. Steve →
  // Matagrano) lands on their first one, not on Inventory & Allocation
  // (which they can't open).
  const sections: string[] = profile?.sections ?? [];
  const firstDist = DISTRIBUTOR_PAGES.find((d) => sections.includes(d.section));
  if (firstDist && !sections.includes("inventory_allocation")) redirect(distributorHref(firstDist.slug));
  redirect("/inventory");
}
