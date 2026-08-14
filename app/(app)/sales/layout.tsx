import { redirect } from "next/navigation";
import { getProfile } from "@/lib/getProfile";

// Every page under Sales (Price List, and later Margin Analysis, Cost Per
// Case, Contribution Margin) is admin-only — this guard covers all of them
// in one place instead of repeating the check on each page.
export default async function SalesLayout({ children }: { children: React.ReactNode }) {
  const profile = await getProfile();
  if (profile?.role !== "admin") {
    redirect("/inventory");
  }

  return <>{children}</>;
}
