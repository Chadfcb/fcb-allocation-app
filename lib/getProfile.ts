import { createClient } from "@/lib/supabase/server";
import { getUserSections, type AnySectionKey } from "@/lib/permissions";
import type { Profile } from "@/lib/types/db";

export type ProfileWithSections = Profile & { sections: AnySectionKey[] };

// Fetches the signed-in user's profile (including their role) plus their
// granted sections (see lib/permissions.ts) in one call. Returns null if
// nobody is signed in — middleware already redirects that case to /login,
// so this is mostly a type-safety convenience for server components.
// `sections` is always [] for an admin (they don't need rows — hasSection()
// short-circuits true for role === "admin" everywhere it's checked).
export async function getProfile(): Promise<ProfileWithSections | null> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) return null;

  const { data } = await supabase.from("profiles").select("*").eq("id", user.id).single();

  if (!data) return null;

  const profile = data as Profile;
  const sections = profile.role === "admin" ? [] : await getUserSections(supabase, user.id);

  return { ...profile, sections };
}
