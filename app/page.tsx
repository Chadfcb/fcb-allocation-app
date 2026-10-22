import { redirect } from "next/navigation";
import { getProfile } from "@/lib/getProfile";

export default async function Home() {
  const profile = await getProfile();
  if (profile?.role === "admin") redirect("/dashboard");
  // A rep set up with only My Territory (2026-10-21) lands on it, not on
  // Inventory & Allocation (which they can't open).
  const sections = profile?.sections ?? [];
  if (sections.includes("my_territory") && !sections.includes("inventory_allocation")) redirect("/my-territory");
  redirect("/inventory");
}
