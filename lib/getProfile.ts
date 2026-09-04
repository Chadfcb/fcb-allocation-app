import { createClient } from "@/lib/supabase/server";
import { getUserSections, type AnySectionKey } from "@/lib/permissions";
import type { Profile } from "@/lib/types/db";

export type ProfileWithSections = Profile & { sections: AnySectionKey[] };

// How often to actually write last_active_at — every page navigation
// calls getProfile(), so this throttles the write to roughly once per
// window instead of once per click. Doesn't need to be exact.
const LAST_ACTIVE_UPDATE_INTERVAL_MS = 5 * 60 * 1000; // 5 minutes

// Fetches the signed-in user's profile (including their role) plus their
// granted sections (see lib/permissions.ts) in one call. Returns null if
// nobody is signed in — middleware already redirects that case to /login,
// so this is mostly a type-safety convenience for server components.
// `sections` is always [] for an admin (they don't need rows — hasSection()
// short-circuits true for role === "admin" everywhere it's checked).
//
// Also keeps profiles.last_active_at current (throttled — see above) so
// the Users page can show real "used the app today" info. Supabase's own
// auth "last sign in" only updates on a fresh login, not on every visit,
// since sessions stay signed in via a silently-refreshed token — added
// 2026-09-05 per Chad, after that showed every user as August.
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

  const lastActive = profile.last_active_at ? new Date(profile.last_active_at).getTime() : 0;
  if (Date.now() - lastActive > LAST_ACTIVE_UPDATE_INTERVAL_MS) {
    const nowIso = new Date().toISOString();
    // Fire-and-forget-ish: awaited so it isn't dropped mid-request, but not
    // allowed to fail the page load if it errors for some reason.
    try {
      await supabase.from("profiles").update({ last_active_at: nowIso }).eq("id", user.id);
      profile.last_active_at = nowIso;
    } catch {
      // Non-fatal — worst case, last_active_at is a few minutes stale.
    }
  }

  return { ...profile, sections };
}
