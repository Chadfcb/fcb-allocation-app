import Link from "next/link";
import { getProfile } from "@/lib/getProfile";
import SignOutButton from "@/components/SignOutButton";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const profile = await getProfile();

  return (
    <div className="min-h-screen bg-neutral-50">
      <header className="border-b border-neutral-200 bg-white">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-4 py-3">
          <div className="flex items-center gap-6">
            <span className="font-semibold text-neutral-900">FCB Allocation</span>
            <nav className="flex gap-4 text-sm text-neutral-600">
              <Link href="/dashboard" className="hover:text-neutral-900">
                Dashboard
              </Link>
              <Link href="/inventory" className="hover:text-neutral-900">
                Inventory & Allocation
              </Link>
              <Link href="/distributors" className="hover:text-neutral-900">
                Distributor Data
              </Link>
              {profile?.role === "admin" && (
                <>
                  <Link href="/admin/weeks" className="hover:text-neutral-900">
                    Weeks
                  </Link>
                  <Link href="/admin/audit" className="hover:text-neutral-900">
                    Audit Log
                  </Link>
                  <Link href="/admin/users" className="hover:text-neutral-900">
                    Users
                  </Link>
                </>
              )}
            </nav>
          </div>
          <div className="flex items-center gap-3 text-sm text-neutral-500">
            <span>
              {profile?.email} <span className="text-neutral-300">·</span>{" "}
              <span className="capitalize">{profile?.role}</span>
            </span>
            <SignOutButton />
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-6xl px-4 py-6">{children}</main>
    </div>
  );
}
