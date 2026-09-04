import { redirect } from "next/navigation";
import { getProfile } from "@/lib/getProfile";
import { hasSection } from "@/lib/permissions";
import SocialMediaCalendarPageClient from "@/components/SocialMediaCalendarPageClient";

// Social Media Calendar — a sub-item under the Calendars sidebar category
// alongside Events Calendar and Chain Calendar. Built out for real
// 2026-09-04 with the same abilities as the other two (calendar view,
// add/edit/delete events, POS Materials/Library) but its own
// social_media_events/social_media_event_materials tables — and
// deliberately NO distributor association (unlike the other two), per
// Chad, 2026-09-04: "this calendar does not need that and is not
// associated with distributors" — see SocialMediaCalendarPageClient.tsx.
// Gated by the same "events_calendar" section as the others for now,
// since Calendars doesn't have its own access toggle yet — see
// PROJECT-STATUS_1.md's "Calendars" section for the plan to fold all
// three sub-items into one "Calendars" toggle later.
export default async function SocialMediaCalendarPage() {
  const profile = await getProfile();
  if (!hasSection(profile?.role, profile?.sections, "events_calendar")) {
    redirect("/inventory");
  }

  return <SocialMediaCalendarPageClient />;
}
