import { redirect } from "next/navigation";
import { getProfile } from "@/lib/getProfile";
import { hasSection } from "@/lib/permissions";
import ChainCalendarPageClient from "@/components/ChainCalendarPageClient";

// Chain Calendar — a sub-item under the Calendars sidebar category
// alongside Events Calendar and Social Media Calendar. Built out for real
// 2026-09-04 with the same abilities as Events Calendar (calendar view,
// add/edit/delete events, distributor color-coding, POS Materials/Library)
// but its own chain_events/chain_event_materials tables — see
// ChainCalendarPageClient.tsx. Gated by the same "events_calendar" section
// as Events Calendar for now, since Calendars doesn't have its own access
// toggle yet — see PROJECT-STATUS_1.md's "Calendars" section for the plan
// to fold all three sub-items into one "Calendars" toggle later.
export default async function ChainCalendarPage() {
  const profile = await getProfile();
  if (!hasSection(profile?.role, profile?.sections, "events_calendar")) {
    redirect("/inventory");
  }

  return <ChainCalendarPageClient />;
}
