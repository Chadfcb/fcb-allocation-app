import { redirect } from "next/navigation";
import { getProfile } from "@/lib/getProfile";
import { homeFor } from "@/lib/access";

// Shown to a signed-in person who hasn't been given access to anything yet
// (2026-10-22, access lockdown). If they do have something, send them there.
export default async function NoAccessPage() {
  const profile = await getProfile();
  if (!profile) redirect("/login");
  const home = homeFor(profile);
  if (home !== "/no-access") redirect(home);

  return (
    <div className="mx-auto mt-16 max-w-md rounded-xl border border-neutral-800 bg-neutral-950 p-6 text-center">
      <h1 className="text-base font-semibold text-neutral-100">You don&apos;t have access to anything yet</h1>
      <p className="mt-2 text-sm text-neutral-400">
        Ask an admin to give you access from Admin → Users. Once they do, refresh this page.
      </p>
    </div>
  );
}
