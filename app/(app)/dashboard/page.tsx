import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getProfile } from "@/lib/getProfile";
import DashboardLiveBlocks from "@/components/DashboardLiveBlocks";
import PurchaseOrdersDashboardCard from "@/components/PurchaseOrdersDashboardCard";
import { firstNameFor } from "@/lib/displayName";

export default async function DashboardPage() {
  const profile = await getProfile();
  // Basic users' access is limited to Inventory & Allocation.
  if (profile?.role !== "admin") {
    redirect("/inventory");
  }

  const supabase = await createClient();

  const { data: currentWeek } = await supabase
    .from("weeks")
    .select("*")
    .order("week_start", { ascending: false })
    .limit(1)
    .maybeSingle();

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-lg font-semibold text-neutral-100">
          Welcome, {profile ? firstNameFor(profile) : ""}
        </h1>
        <p className="text-sm text-neutral-400">
          Current week: <span className="font-medium text-neutral-300">{currentWeek?.label ?? "No week started yet"}</span>
        </p>
      </div>

      <div className="flex gap-3">
        <Link
          href="/inventory"
          className="rounded-md bg-white px-4 py-2 text-sm font-medium text-black hover:bg-neutral-200"
        >
          Go to Inventory & Allocation
        </Link>
        <Link
          href="/purchase-orders"
          className="rounded-md border border-neutral-700 px-4 py-2 text-sm font-medium text-neutral-300 hover:bg-neutral-900"
        >
          Go to Purchase Orders
        </Link>
        <Link
          href="/distributor-inventory"
          className="rounded-md border border-neutral-700 px-4 py-2 text-sm font-medium text-neutral-300 hover:bg-neutral-900"
        >
          Go to Distributor Inventory
        </Link>
      </div>

      {/*
        Shared 2-column grid for all 4 live cards. DOM order drives the
        layout: Open Purchase Orders, then Distributor Order Values (row 1),
        then Packaging Shortages and Label Shortages (row 2) — the latter
        three come from DashboardLiveBlocks, which renders as a Fragment so
        its cards land directly in this grid alongside Purchase Orders.
      */}
      <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
        <PurchaseOrdersDashboardCard />
        <DashboardLiveBlocks weekId={currentWeek?.id ?? null} />
      </div>
    </div>
  );
}
