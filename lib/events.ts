// Shared helpers for Events Calendar — building the month grid, event type
// labels, and small file-display helpers for POS Materials / the POS
// Library. Recreated from the old standalone "FCB Events" Electron app
// (github-backed storage swapped for Supabase; the 3D hover-tilt animation
// on calendar cells intentionally dropped).

import type { EventType, CalendarEvent } from "@/lib/types/db";

export const EVENT_TYPE_OPTIONS: { value: EventType; label: string }[] = [
  { value: "festival", label: "Festival / Event" },
  { value: "tasting", label: "Tasting" },
  { value: "donation", label: "Donation" },
  { value: "work-with", label: "Work-With" },
  { value: "other", label: "Other" },
];

export const EVENT_TYPE_LABELS: Record<EventType, string> = {
  festival: "Festival",
  tasting: "Tasting",
  donation: "Donation",
  "work-with": "Work-With",
  other: "Other",
};

export const EVENT_MATERIALS_BUCKET = "event-materials";

export const MONTH_NAMES = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];
export const MONTH_NAMES_SHORT = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
];
export const DAY_NAMES_SHORT = [
  "Sun",
  "Mon",
  "Tue",
  "Wed",
  "Thu",
  "Fri",
  "Sat",
];
export const DAY_NAMES_FULL = [
  "Sunday",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
];

export function formatBytes(n: number | null | undefined): string {
  if (n == null) return "";
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

// yyyy-mm-dd in local time (not UTC) — matches how <input type="date">
// values are stored and compared throughout this feature.
export function isoDate(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(
    d.getDate(),
  ).padStart(2, "0")}`;
}

export function parseIsoDate(s: string | null | undefined): Date | null {
  if (!s) return null;
  const [y, m, d] = s.split("-").map(Number);
  if (!y || !m || !d) return null;
  return new Date(y, m - 1, d);
}

export interface CalendarDay {
  date: Date;
  key: string;
  inCurrentMonth: boolean;
  isToday: boolean;
  events: CalendarEvent[];
}

// Builds a fixed 6-row/7-col grid (including leading/trailing days from
// adjacent months) for the given month, with each day's events attached —
// a multi-day event (start..end) appears on every day it spans, same as
// the old app.
export function buildMonthGrid(
  year: number,
  month: number, // 0-indexed
  events: CalendarEvent[],
): CalendarDay[] {
  const todayKey = isoDate(new Date());
  const firstDay = new Date(year, month, 1);
  const startDow = firstDay.getDay();

  const eventsByDay: Record<string, CalendarEvent[]> = {};
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

  const days: CalendarDay[] = [];
  const totalCells = 42; // always 6 full weeks, same as the old app
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

const FILE_ICONS: Record<string, string> = {
  pdf: "📄",
  doc: "📝",
  docx: "📝",
  xls: "📊",
  xlsx: "📊",
  ppt: "📊",
  pptx: "📊",
};
const IMAGE_EXTENSIONS = ["jpg", "jpeg", "png", "gif", "webp"];

export function fileExtension(name: string): string {
  return (name.split(".").pop() || "").toLowerCase();
}
export function fileIcon(name: string): string {
  return FILE_ICONS[fileExtension(name)] || "📎";
}
export function isImageFile(name: string): boolean {
  return IMAGE_EXTENSIONS.includes(fileExtension(name));
}

// Storage object keys can't safely contain arbitrary characters — mirrors
// the old app's upload naming (timestamp prefix + sanitized original name),
// which also keeps concurrent uploads of same-named files from colliding.
export function storageFileName(originalName: string): string {
  const safe = originalName.replace(/[^a-zA-Z0-9._-]/g, "_");
  return `${Date.now()}_${safe}`;
}
