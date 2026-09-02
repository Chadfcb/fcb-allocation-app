import { redirect } from "next/navigation";
import { getProfile } from "@/lib/getProfile";
import { hasSection } from "@/lib/permissions";
import EventsPageClient from "@/components/EventsPageClient";

// Events Calendar — FCB's outside/off-site events program, recreated from
// the old standalone "FCB Events" Electron app. Gated by the
// "events_calendar" section (see lib/permissions.ts), so the redirect guard
// lives here rather than relying on RLS alone.
export default async function EventsPage() {
  const profile = await getProfile();
  if (!hasSection(profile?.role, profile?.sections, "events_calendar")) {
    redirect("/inventory");
  }

  return <EventsPageClient />;
}
