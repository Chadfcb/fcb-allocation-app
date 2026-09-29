import { redirect } from "next/navigation";
import { getProfile } from "@/lib/getProfile";
import { createClient } from "@/lib/supabase/server";
import SignOutButton from "@/components/SignOutButton";
import Sidebar from "@/components/Sidebar";
import FeedbackButton from "@/components/FeedbackButton";
import CustomizeButton from "@/components/CustomizeButton";
import SiteAppearanceProvider from "@/components/SiteAppearanceProvider";
import { DEFAULT_ERNIE_APPEARANCE, normalizeErnieAppearance, type ErnieAppearance } from "@/lib/ernie/appearance";
import { fontVariables } from "@/lib/fonts";

// This person's Customize setting (site-wide since 2026-09-29 — see
// lib/appearance.ts), read here on the server so every page is already in
// their colors on first paint. Any problem reading it = the default look.
async function getAppearance(userId: string | undefined): Promise<ErnieAppearance> {
  if (!userId) return DEFAULT_ERNIE_APPEARANCE;
  try {
    const supabase = await createClient();
    const { data } = await supabase
      .from("ernie_user_preferences")
      .select("appearance")
      .eq("user_id", userId)
      .maybeSingle();
    return data?.appearance ? normalizeErnieAppearance(data.appearance) : DEFAULT_ERNIE_APPEARANCE;
  } catch {
    return DEFAULT_ERNIE_APPEARANCE;
  }
}

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const profile = await getProfile();

  // First-time sign-in with a temporary password an admin set: force
  // choosing a real password + name before letting them into any page here.
  if (profile?.must_change_password) {
    redirect("/account-setup");
  }

  const appearance = await getAppearance(profile?.id);

  return (
    <div className={`site-theme ${fontVariables} flex min-h-screen bg-black`}>
      <SiteAppearanceProvider initial={appearance}>
        <Sidebar
          role={profile?.role}
          sections={profile?.sections ?? []}
          isSuperAdmin={profile?.is_super_admin}
        />
        <div className="flex min-w-0 flex-1 flex-col">
          <header className="border-b border-neutral-800 bg-neutral-950">
            <div className="flex items-center justify-end gap-3 px-4 py-3">
              <CustomizeButton />
              <FeedbackButton />
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
      </SiteAppearanceProvider>
    </div>
  );
}
