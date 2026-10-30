import { createAdminClient } from "@/lib/supabase/admin";
import { cleanSettings, DEFAULT_SETTINGS, gateScript } from "@/lib/ageCheck";

// The age check script FCB's Wix sites load on every page (added 2026-10-30;
// lib/ageCheck.ts explains the whole thing). Public — no login (exempt in
// proxy.ts). Settings come from site_age_check (sql/age_check.sql), edited on
// Admin → Age Check. Cached for 60 seconds, so edits show within a minute.
// If the settings can't be read, the check still runs with the defaults —
// the sites are never left without one because of a database hiccup.
export const dynamic = "force-dynamic";

export async function GET() {
  let settings = DEFAULT_SETTINGS;
  try {
    const { data } = await createAdminClient().from("site_age_check").select("settings").eq("id", 1).maybeSingle();
    if (data?.settings) settings = cleanSettings(data.settings);
  } catch {
    // fall back to defaults
  }
  return new Response(gateScript(settings), {
    headers: {
      "Content-Type": "application/javascript; charset=utf-8",
      "Cache-Control": "public, max-age=60, s-maxage=60, stale-while-revalidate=600",
      "Access-Control-Allow-Origin": "*",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
