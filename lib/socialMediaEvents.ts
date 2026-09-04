// Social Media Calendar-specific helpers — event type labels/options and
// its own month-grid builder. Added 2026-09-04 alongside Social Media
// Calendar itself: a third calendar, same shape/abilities as Events
// Calendar and Chain Calendar (components/EventsPageClient.tsx,
// components/ChainCalendarPageClient.tsx), but for planning social media
// content (posts, campaigns, stories, promotions) instead of FCB's own
// off-site events or chain/retail account activity — kept as separate
// tables (social_media_events/social_media_event_materials) so none of the
// three calendars' events mix, while still sharing the same POS Materials
// Library, storage bucket, and Distributor list as the other two (per
// Chad, 2026-09-04).
//
// Everything else generic (date parsing, file icons, month/day names,
// storage filename sanitizing) is reused directly from lib/events.ts —
// only the event-type vocabulary and the month-grid's event type differ,
// so only those are duplicated here.

import type { SocialMediaEvent, SocialMediaEventType } from "@/lib/types/db";
import { isoDate, parseIsoDate } from "@/lib/events";

export const SOCIAL_MEDIA_EVENT_TYPE_OPTIONS: { value: SocialMediaEventType; label: string }[] = [
  { value: "post", label: "Post" },
  { value: "campaign", label: "Campaign" },
  { value: "story", label: "Story" },
  { value: "promotion", label: "Promotion" },
  { value: "other", label: "Other" },
];

export const SOCIAL_MEDIA_EVENT_TYPE_LABELS: Record<SocialMediaEventType, string> = {
  post: "Post",
  campaign: "Campaign",
  story: "Story",
  promotion: "Promotion",
  other: "Other",
};

export interface SocialMediaCalendarDay {
  date: Date;
  key: string;
  inCurrentMonth: boolean;
  isToday: boolean;
  events: SocialMediaEvent[];
}

// Same logic as lib/events.ts's buildMonthGrid, just typed for
// SocialMediaEvent — a fixed 6-row/7-col grid (including leading/trailing
// days from adjacent months), with a multi-day event appearing on every
// day it spans.
export function buildSocialMediaMonthGrid(
  year: number,
  month: number, // 0-indexed
  events: SocialMediaEvent[],
): SocialMediaCalendarDay[] {
  const todayKey = isoDate(new Date());
  const firstDay = new Date(year, month, 1);
  const startDow = firstDay.getDay();

  const eventsByDay: Record<string, SocialMediaEvent[]> = {};
  events.forEach((ev) => {
    const start = parseIsoDate(ev.start_date);
    if (!start) return;
    const end = ev.end_date ? (parseIsoDate(ev.end_date) ?? start) : start;
    const cur = new Date(start);
    while (cur <= end) {
      const key = isoDate(cur);
      (eventsByDay[key] ??= []).push(ev);
      cur.setDate(cur.getDate() + 1);
    }
  });

  const days: SocialMediaCalendarDay[] = [];
  const totalCells = 42; // always 6 full weeks, same as the other calendars
  for (let i = 0; i < totalCells; i++) {
    const date = new Date(year, month, 1 - startDow + i);
    const key = isoDate(date);
    days.push({
      date,
      key,
      inCurrentMonth: date.getMonth() === month,
      isToday: key === todayKey,
      events: (eventsByDay[key] ?? []).sort((a, b) =>
        a.title.localeCompare(b.title),
      ),
    });
  }
  return days;
}
