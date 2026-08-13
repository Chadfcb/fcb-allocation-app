import Link from "next/link";
import { createClient } from "@/lib/supabase/server";

export default async function DashboardPage() {
  const supabase = await createClient();

  const { data: currentWeek } = await supabase
    .from("weeks")
    .select("*")
    .order("week_start", { ascending: false })
    .limit(1)
    .maybeSingle();

  const { count: productCount } = await supabase
    .from("products")
    .select("*", { count: "exact", head: true })
    .eq("active", true);

  const { count: distributorCount } = await supabase
    .from("distributors")
    .select("*", { count: "exact", head: true })
    .eq("active", true);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-lg font-semibold text-neutral-900">Dashboard</h1>
        <p className="text-sm text-neutral-500">
          Current week: <span className="font-medium text-neutral-700">{currentWeek?.label ?? "No week started yet"}</span>
        </p>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <div className="rounded-lg border border-neutral-200 bg-white p-4">
          <p className="text-xs uppercase tracking-wide text-neutral-400">Active Products</p>
          <p className="mt-1 text-2xl font-semibold text-neutral-900">{productCount ?? 0}</p>
        </div>
        <div className="rounded-lg border border-neutral-200 bg-white p-4">
          <p className="text-xs uppercase tracking-wide text-neutral-400">Active Distributors</p>
          <p className="mt-1 text-2xl font-semibold text-neutral-900">{distributorCount ?? 0}</p>
        </div>
        <div className="rounded-lg border border-neutral-200 bg-white p-4">
          <p className="text-xs uppercase tracking-wide text-neutral-400">Week Status</p>
          <p className="mt-1 text-2xl font-semibold capitalize text-neutral-900">{currentWeek?.status ?? "—"}</p>
        </div>
      </div>

      <div className="flex gap-3">
        <Link
          href="/inventory"
          className="rounded-md bg-neutral-900 px-4 py-2 text-sm font-medium text-white hover:bg-neutral-800"
        >
          Go to Inventory & Allocation
        </Link>
        <Link
          href="/distributors"
          className="rounded-md border border-neutral-300 px-4 py-2 text-sm font-medium text-neutral-700 hover:bg-neutral-100"
        >
          Go to Distributor Data
        </Link>
      </div>
    </div>
  );
}
