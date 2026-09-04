import { redirect } from "next/navigation";
import { getProfile } from "@/lib/getProfile";
import { hasSection } from "@/lib/permissions";

// Chain Calendar — placeholder, added 2026-09-04 as a sub-item under the
// Calendars sidebar category alongside Events Calendar and Social Media
// Calendar. No real feature yet ("blank for now until we bring them in" —
// Chad). Gated by the same "events_calendar" section as Events Calendar for
// now, since Calendars doesn't have its own access toggle yet — see
// PROJECT-STATUS_1.md's "Calendars" section for the plan to fold all three
// into one "Calendars" toggle once this is a real feature.
export default async function ChainCalendarPage() {
  const profile = await getProfile();
  if (!hasSection(profile?.role, profile?.sections, "events_calendar")) {
    redirect("/inventory");
  }

  return (
    <div className="space-y-2">
      <h1 className="text-lg font-semibold text-neutral-100">Chain Calendar</h1>
      <p className="text-sm text-neutral-400">
        Coming soon — this page isn&apos;t built out yet.
      </p>
    </div>
  );
}
