// Chain Calendar-specific helpers — event type labels/options and its own
// month-grid builder. Added 2026-09-04 alongside Chain Calendar itself: a
// second calendar, same shape/abilities as Events Calendar
// (components/EventsPageClient.tsx, lib/events.ts), but for chain/retail
// account activity (demos, resets, ads, displays) instead of FCB's own
// off-site events — kept as separate tables (chain_events/
// chain_event_materials) so the two calendars' events never mix, while
// still sharing the same POS Materials Library and storage bucket as
// Events Calendar (per Chad, 2026-09-04) — but deliberately NOT the
// Distributor list, since this calendar no longer has a distributor
// association (per Chad, 2026-09-05).
//
// Everything else generic (date parsing, file icons, month/day names,
// storage filename sanitizing) is reused directly from lib/events.ts —
// only the event-type vocabulary and the month-grid's event type differ,
// so only those are duplicated here.

import type { ChainEvent, ChainEventType } from "@/lib/types/db";
import { isoDate, parseIsoDate } from "@/lib/events";

export const CHAIN_EVENT_TYPE_OPTIONS: { value: ChainEventType; label: string }[] = [
  { value: "demo", label: "Demo" },
  { value: "reset", label: "Reset" },
  { value: "ad", label: "Ad" },
  { value: "display", label: "Display" },
  { value: "other", label: "Other" },
];

export const CHAIN_EVENT_TYPE_LABELS: Record<ChainEventType, string> = {
  demo: "Demo",
  reset: "Reset",
  ad: "Ad",
  display: "Display",
  other: "Other",
};

export interface ChainCalendarDay {
  date: Date;
  key: string;
  inCurrentMonth: boolean;
  isToday: boolean;
  events: ChainEvent[];
}

// Same logic as lib/events.ts's buildMonthGrid, just typed for ChainEvent —
// a fixed 6-row/7-col grid (including leading/trailing days from adjacent
// months), with a multi-day event appearing on every day it spans.
export function buildChainMonthGrid(
  year: number,
  month: number, // 0-indexed
  events: ChainEvent[],
): ChainCalendarDay[] {
  const todayKey = isoDate(new Date());
  const firstDay = new Date(year, month, 1);
  const startDow = firstDay.getDay();

  const eventsByDay: Record<string, ChainEvent[]> = {};
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

  const days: ChainCalendarDay[] = [];
  const totalCells = 42; // always 6 full weeks, same as Events Calendar
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
