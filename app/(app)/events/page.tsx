import { redirect } from "next/navigation";
import { getProfile } from "@/lib/getProfile";
import EventsPageClient from "@/components/EventsPageClient";

// Events Calendar — FCB's outside/off-site events program, recreated from
// the old standalone "FCB Events" Electron app. Admin-only, full stop
// (like Sales and Purchase Orders), so the redirect guard lives here
// rather than relying on RLS alone.
export default async function EventsPage() {
  const profile = await getProfile();
  if (profile?.role !== "admin") {
    redirect("/inventory");
  }

  return <EventsPageClient />;
}
