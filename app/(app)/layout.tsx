import { redirect } from "next/navigation";
import { getProfile } from "@/lib/getProfile";
import SignOutButton from "@/components/SignOutButton";
import Sidebar from "@/components/Sidebar";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const profile = await getProfile();

  // First-time sign-in with a temporary password an admin set: force
  // choosing a real password + name before letting them into any page here.
  if (profile?.must_change_password) {
    redirect("/account-setup");
  }

  return (
    <div className="flex min-h-screen bg-black">
      <Sidebar role={profile?.role} sections={profile?.sections ?? []} />
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="border-b border-neutral-800 bg-neutral-950">
          <div className="flex items-center justify-end px-4 py-3">
            <div className="flex items-center gap-3 text-sm text-neutral-400">
              <span>
                {profile?.email} <span className="text-neutral-600">·</span>{" "}
                <span className="capitalize">{profile?.role}</span>
              </span>
              <SignOutButton />
            </div>
          </div>
        </header>
        <main className="mx-auto w-full max-w-[2200px] px-4 py-6">{children}</main>
      </div>
    </div>
  );
}
