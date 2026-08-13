import Link from "next/link";
import { getProfile } from "@/lib/getProfile";
import SignOutButton from "@/components/SignOutButton";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const profile = await getProfile();

  return (
    <div className="min-h-screen bg-black">
      <header className="border-b border-neutral-800 bg-neutral-950">
        <div className="mx-auto flex max-w-[2200px] items-center justify-between px-4 py-3">
          <div className="flex items-center gap-6">
            <span className="font-semibold text-neutral-100">FCB Allocation</span>
            <nav className="flex gap-4 text-sm text-neutral-400">
              <Link href="/dashboard" className="hover:text-white">
                Dashboard
              </Link>
              <Link href="/inventory" className="hover:text-white">
                Inventory & Allocation
              </Link>
              <Link href="/distributors" className="hover:text-white">
                Distributor Data
              </Link>
              {profile?.role === "admin" && (
                <>
                  <Link href="/admin/weeks" className="hover:text-white">
                    Weeks
                  </Link>
                  <Link href="/admin/audit" className="hover:text-white">
                    Audit Log
                  </Link>
                  <Link href="/admin/users" className="hover:text-white">
                    Users
                  </Link>
                </>
              )}
            </nav>
          </div>
          <div className="flex items-center gap-3 text-sm text-neutral-400">
            <span>
              {profile?.email} <span className="text-neutral-600">·</span>{" "}
              <span className="capitalize">{profile?.role}</span>
            </span>
            <SignOutButton />
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-[2200px] px-4 py-6">{children}</main>
    </div>
  );
}
