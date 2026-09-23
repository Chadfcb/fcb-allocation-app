// Two-way Google Calendar sync engine (added 2026-09-23).
//
// First calendar: FCB-Data Events Calendar (table `events`) <-> Google
// "Outside/Off Site Events Calendar". Per Chad: two-way, deletes sync both
// ways, most recent edit wins, repeating Google events come in as separate
// events (only within a window), and future calendars are just another row
// in google_calendar_sync (sql/google_calendar_sync.sql).
//
// How changes flow:
//   App -> Google: a database trigger on `events` calls
//     /api/google-calendar/hook/push for every add/edit/delete — no matter
//     whether it came from the Events page, Ernie, or Slack Ernie.
//   Google -> App: Google calls /api/google-calendar/hook/webhook the moment
//     the calendar changes; we pull just what changed (sync token). A daily
//     cron (/api/cron/google-calendar) re-registers that notification
//     channel and does a catch-up pull, in case a notification is missed.
//   Writes coming from Google go through google_sync_apply_event /
//   google_sync_delete_event, which the trigger ignores — so nothing
//   ping-pongs.
//
// Field mapping:
//   title <-> summary; start/end dates <-> all-day dates (Google's end date
//   is exclusive); location <-> location; notes <-> description.
//   The app's free-text time ("3-6pm") is shown as a "Time: ..." first line
//   of the Google description. A timed event made in Google keeps its exact
//   times (google_time) and shows in the app as e.g. "3:00 PM – 6:00 PM".
//   Type / distributor / rep are app-only: shown as a small footer line in
//   the Google description for people, and stored in Google's hidden
//   extendedProperties so they round-trip safely.

import type { SupabaseClient } from "@supabase/supabase-js";
import { getGoogleAccessToken } from "@/lib/google/auth";
import { EVENT_TYPE_LABELS } from "@/lib/events";
import type { EventType } from "@/lib/types/db";

const CAL_SCOPE = "https://www.googleapis.com/auth/calendar";
const API = "https://www.googleapis.com/calendar/v3";
const TZ = "America/Los_Angeles";
const FOOTER_MARK = "— FCB-Data —";
// Google-only events (and repeating-event occurrences) are only brought
// into the app within this window, so a monthly series that runs to 2046
// doesn't flood the calendar.
const WINDOW_PAST_DAYS = 365;
const WINDOW_FUTURE_DAYS = 730;

const EVENT_TYPES = Object.keys(EVENT_TYPE_LABELS) as EventType[];

export interface SyncConfig {
  calendar_key: string;
  google_calendar_id: string;
  enabled: boolean;
  initial_sync_done: boolean;
  sync_token: string | null;
  channel_id: string | null;
  channel_resource_id: string | null;
  channel_expires_at: string | null;
  push_url: string;
  secret: string;
  last_pull_at: string | null;
  last_push_at: string | null;
  last_error: string | null;
}

interface AppEventRow {
  id: string;
  title: string;
  start_date: string;
  end_date: string | null;
  time_label: string | null;
  type: EventType;
  location: string | null;
  distributor_id: string | null;
  rep: string | null;
  notes: string | null;
  updated_at: string;
  google_event_id: string | null;
  google_etag: string | null;
  google_updated_at: string | null;
  google_time: { start: GTime; end: GTime } | null;
  google_time_label: string | null;
}

interface GTime {
  date?: string;
  dateTime?: string;
  timeZone?: string;
}

export interface GEvent {
  id: string;
  status?: string;
  etag?: string;
  updated?: string;
  summary?: string;
  description?: string;
  location?: string;
  start?: GTime;
  end?: GTime;
  recurringEventId?: string;
  extendedProperties?: { private?: Record<string, string> };
}

// ---- config -------------------------------------------------------------

export async function loadSyncConfig(admin: SupabaseClient, key = "events"): Promise<SyncConfig | null> {
  const { data } = await admin.from("google_calendar_sync").select("*").eq("calendar_key", key).maybeSingle();
  return (data as SyncConfig | null) ?? null;
}

async function saveConfig(admin: SupabaseClient, key: string, patch: Partial<SyncConfig>) {
  await admin
    .from("google_calendar_sync")
    .update({ ...patch, updated_at: new Date().toISOString() })
    .eq("calendar_key", key);
}

export function webhookUrlFor(cfg: SyncConfig): string {
  return cfg.push_url.replace(/\/push$/, "/webhook");
}

// ---- Google API helper --------------------------------------------------

class GoogleApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

async function gcal<T = unknown>(path: string, init: RequestInit = {}): Promise<T> {
  const token = await getGoogleAccessToken([CAL_SCOPE]);
  const res = await fetch(`${API}${path}`, {
    ...init,
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json", ...(init.headers ?? {}) },
  });
  if (res.status === 204) return undefined as T;
  const text = await res.text();
  let body: unknown = undefined;
  try {
    body = text ? JSON.parse(text) : undefined;
  } catch {
    body = text;
  }
  if (!res.ok) {
    const msg =
      (body as { error?: { message?: string } } | undefined)?.error?.message || (typeof body === "string" ? body : "") || res.statusText;
    throw new GoogleApiError(res.status, `Google Calendar error (${res.status}): ${msg}`);
  }
  return body as T;
}

const enc = encodeURIComponent;

// Can the robot account actually see/edit this calendar? Used by the
// Events page status so setup problems are explained in plain English.
export async function checkCalendarAccess(cfg: SyncConfig): Promise<{ ok: boolean; message: string }> {
  try {
    const cal = await gcal<{ summary?: string; accessRole?: string }>(`/users/me/calendarList/${enc(cfg.google_calendar_id)}`).catch(
      async (err) => {
        // Not on its list yet — try reading the calendar directly.
        if (err instanceof GoogleApiError && err.status === 404) {
          const c = await gcal<{ summary?: string }>(`/calendars/${enc(cfg.google_calendar_id)}`);
          return { summary: c.summary, accessRole: "unknown" };
        }
        throw err;
      },
    );
    if (cal.accessRole && !["owner", "writer", "unknown"].includes(cal.accessRole)) {
      return { ok: false, message: `The connected Google account can see "${cal.summary}" but can't edit it — share it with ernie@fullcirclebrewing.com using "Make changes to events".` };
    }
    return { ok: true, message: `Connected to "${cal.summary ?? "calendar"}".` };
  } catch (err) {
    if (err instanceof GoogleApiError && (err.status === 404 || err.status === 403)) {
      return { ok: false, message: "The connected Google account can't see the Outside/Off Site Events Calendar yet — share it with ernie@fullcirclebrewing.com (Make changes to events)." };
    }
    return { ok: false, message: err instanceof Error ? err.message : "Couldn't reach Google Calendar." };
  }
}

// ---- date helpers -------------------------------------------------------

function addDays(iso: string, days: number): string {
  const d = new Date(`${iso}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function localDate(dateTime: string): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: TZ }).format(new Date(dateTime));
}

function localTime(dateTime: string): string {
  return new Intl.DateTimeFormat("en-US", { timeZone: TZ, hour: "numeric", minute: "2-digit" }).format(new Date(dateTime));
}

function todayIso(): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: TZ }).format(new Date());
}

function inWindow(startDate: string): boolean {
  const t = todayIso();
  return startDate >= addDays(t, -WINDOW_PAST_DAYS) && startDate <= addDays(t, WINDOW_FUTURE_DAYS);
}

function googleStartDate(g: GEvent): string | null {
  if (g.start?.date) return g.start.date;
  if (g.start?.dateTime) return localDate(g.start.dateTime);
  return null;
}

// ---- description helpers ------------------------------------------------

function htmlToText(s: string): string {
  return s
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|li)>/gi, "\n")
    .replace(/<li[^>]*>/gi, "• ")
    .replace(/<a [^>]*href="([^"]+)"[^>]*>(.*?)<\/a>/gi, (_m, href: string, text: string) => (text && text !== href ? `${text} (${href})` : href))
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function parseDescription(desc: string | undefined): { timeLabel: string | null; notes: string | null } {
  if (!desc) return { timeLabel: null, notes: null };
  let text = /<[a-z][\s\S]*>/i.test(desc) ? htmlToText(desc) : desc.replace(/\r\n/g, "\n");
  const footerAt = text.indexOf(FOOTER_MARK);
  if (footerAt >= 0) text = text.slice(0, footerAt);
  text = text.trim();
  let timeLabel: string | null = null;
  const m = /^Time:\s*(.+)$/m.exec(text.split("\n")[0] ?? "");
  if (m) {
    timeLabel = m[1].trim() || null;
    text = text.split("\n").slice(1).join("\n").trim();
  }
  return { timeLabel, notes: text || null };
}

// ---- mapping: app -> Google ---------------------------------------------

function appToGoogle(ev: AppEventRow, distributorName: string | null): Record<string, unknown> {
  const keepTimed =
    !!ev.google_time &&
    ev.time_label === ev.google_time_label &&
    (ev.google_time.start.dateTime ? localDate(ev.google_time.start.dateTime) : ev.google_time.start.date) === ev.start_date;

  const lines: string[] = [];
  if (ev.time_label && !keepTimed) lines.push(`Time: ${ev.time_label}`);
  if (ev.notes) lines.push(ev.notes);
  const footer = [
    `Type: ${EVENT_TYPE_LABELS[ev.type] ?? ev.type}`,
    distributorName ? `Distributor: ${distributorName}` : null,
    ev.rep ? `Rep: ${ev.rep}` : null,
  ]
    .filter(Boolean)
    .join(" · ");
  const description = [...lines, "", `${FOOTER_MARK}\n${footer}`].join("\n").trim();

  const start = keepTimed ? ev.google_time!.start : { date: ev.start_date };
  const end = keepTimed ? ev.google_time!.end : { date: addDays(ev.end_date && ev.end_date >= ev.start_date ? ev.end_date : ev.start_date, 1) };

  return {
    summary: ev.title,
    location: ev.location ?? "",
    description,
    start: keepTimed ? start : { date: (start as GTime).date, dateTime: null },
    end: keepTimed ? end : { date: (end as GTime).date, dateTime: null },
    extendedProperties: {
      private: {
        fcb_event_id: ev.id,
        fcb_type: ev.type,
        fcb_distributor_id: ev.distributor_id ?? "",
        fcb_rep: ev.rep ?? "",
      },
    },
  };
}

// ---- mapping: Google -> app ---------------------------------------------

function googleToApp(g: GEvent, existing: AppEventRow | null): Record<string, unknown> {
  const priv = g.extendedProperties?.private ?? {};
  const { timeLabel: descTime, notes } = parseDescription(g.description);

  let start_date: string;
  let end_date: string | null;
  let time_label: string | null;
  let google_time: { start: GTime; end: GTime } | null = null;
  let google_time_label: string | null = null;

  if (g.start?.dateTime && g.end?.dateTime) {
    start_date = localDate(g.start.dateTime);
    // An event ending exactly at midnight belongs to the day before.
    const endMinus = new Date(new Date(g.end.dateTime).getTime() - 60_000).toISOString();
    const endLocal = localDate(endMinus);
    end_date = endLocal !== start_date ? endLocal : null;
    time_label = `${localTime(g.start.dateTime)} – ${localTime(g.end.dateTime)}`;
    google_time = { start: g.start, end: g.end };
    google_time_label = time_label;
  } else {
    start_date = g.start?.date ?? todayIso();
    const endInclusive = g.end?.date ? addDays(g.end.date, -1) : start_date;
    end_date = endInclusive > start_date ? endInclusive : null;
    time_label = descTime;
  }

  const type = EVENT_TYPES.includes(priv.fcb_type as EventType) ? priv.fcb_type : existing?.type ?? "other";
  const distributor_id = "fcb_distributor_id" in priv ? priv.fcb_distributor_id || "" : existing?.distributor_id ?? "";
  const rep = "fcb_rep" in priv ? priv.fcb_rep || "" : existing?.rep ?? "";

  return {
    title: (g.summary ?? "").trim() || "(no title)",
    start_date,
    end_date: end_date ?? "",
    time_label: time_label ?? "",
    type,
    location: g.location ?? "",
    distributor_id,
    rep,
    notes: notes ?? "",
    google_event_id: g.id,
    google_etag: g.etag ?? "",
    google_updated_at: g.updated ?? "",
    google_time,
    google_time_label: google_time_label ?? "",
  };
}

// ---- audit log (changes that came from Google) ---------------------------

async function auditFromGoogle(admin: SupabaseClient, recordId: string, oldTitle: string | null, newTitle: string | null) {
  try {
    await admin.from("audit_log").insert({
      week_id: null,
      table_name: "events",
      record_id: recordId,
      field_name: "title (from Google Calendar)",
      old_value: oldTitle,
      new_value: newTitle,
      changed_by: null,
    });
  } catch {
    // best-effort
  }
}

// ---- App -> Google ------------------------------------------------------

const EVENT_COLUMNS =
  "id, title, start_date, end_date, time_label, type, location, distributor_id, rep, notes, updated_at, google_event_id, google_etag, google_updated_at, google_time, google_time_label";

async function distributorNameFor(admin: SupabaseClient, id: string | null): Promise<string | null> {
  if (!id) return null;
  const { data } = await admin.from("distributors").select("name").eq("id", id).maybeSingle();
  return (data as { name?: string } | null)?.name ?? null;
}

async function linkAppEvent(admin: SupabaseClient, appId: string, g: GEvent, extra: Record<string, unknown> = {}) {
  const { error } = await admin.rpc("google_sync_apply_event", {
    p_id: appId,
    p_row: { google_event_id: g.id, google_etag: g.etag ?? "", google_updated_at: g.updated ?? "", ...extra },
  });
  if (error) throw new Error(`Couldn't save the Google link: ${error.message}`);
}

export async function pushAppEvent(admin: SupabaseClient, cfg: SyncConfig, eventId: string): Promise<void> {
  const { data } = await admin.from("events").select(EVENT_COLUMNS).eq("id", eventId).maybeSingle();
  const ev = data as AppEventRow | null;
  if (!ev) return; // deleted in the meantime — the delete call handles Google
  const body = appToGoogle(ev, await distributorNameFor(admin, ev.distributor_id));
  const calPath = `/calendars/${enc(cfg.google_calendar_id)}/events`;

  let g: GEvent;
  if (ev.google_event_id) {
    try {
      g = await gcal<GEvent>(`${calPath}/${enc(ev.google_event_id)}`, { method: "PATCH", body: JSON.stringify(body) });
    } catch (err) {
      if (err instanceof GoogleApiError && (err.status === 404 || err.status === 410)) {
        g = await gcal<GEvent>(calPath, { method: "POST", body: JSON.stringify(body) });
      } else {
        throw err;
      }
    }
  } else {
    g = await gcal<GEvent>(calPath, { method: "POST", body: JSON.stringify(body) });
  }
  await linkAppEvent(admin, ev.id, g);
  await saveConfig(admin, cfg.calendar_key, { last_push_at: new Date().toISOString(), last_error: null });
}

export async function pushDelete(admin: SupabaseClient, cfg: SyncConfig, googleEventId: string): Promise<void> {
  try {
    await gcal(`/calendars/${enc(cfg.google_calendar_id)}/events/${enc(googleEventId)}`, { method: "DELETE" });
  } catch (err) {
    if (!(err instanceof GoogleApiError && (err.status === 404 || err.status === 410))) throw err;
  }
  await saveConfig(admin, cfg.calendar_key, { last_push_at: new Date().toISOString(), last_error: null });
}

// ---- Google -> App ------------------------------------------------------

async function listGoogleEvents(
  cfg: SyncConfig,
  opts: { syncToken?: string | null; showDeleted: boolean },
): Promise<{ items: GEvent[]; nextSyncToken: string | null }> {
  const items: GEvent[] = [];
  let pageToken: string | undefined;
  let nextSyncToken: string | null = null;
  do {
    const params = new URLSearchParams({ singleEvents: "true", maxResults: "250", showDeleted: String(opts.showDeleted) });
    if (opts.syncToken) params.set("syncToken", opts.syncToken);
    if (pageToken) params.set("pageToken", pageToken);
    const res = await gcal<{ items?: GEvent[]; nextPageToken?: string; nextSyncToken?: string }>(
      `/calendars/${enc(cfg.google_calendar_id)}/events?${params.toString()}`,
    );
    items.push(...(res.items ?? []));
    pageToken = res.nextPageToken;
    if (res.nextSyncToken) nextSyncToken = res.nextSyncToken;
  } while (pageToken);
  return { items, nextSyncToken };
}

export interface PullResult {
  created: number;
  updated: number;
  deleted: number;
  skipped: number;
}

export async function pullChanges(admin: SupabaseClient, cfg: SyncConfig): Promise<PullResult> {
  const result: PullResult = { created: 0, updated: 0, deleted: 0, skipped: 0 };
  if (!cfg.initial_sync_done) return result;

  let listing: { items: GEvent[]; nextSyncToken: string | null };
  try {
    listing = await listGoogleEvents(cfg, { syncToken: cfg.sync_token, showDeleted: true });
  } catch (err) {
    if (err instanceof GoogleApiError && err.status === 410) {
      // Sync token expired — do a full pass (existing links make it safe).
      listing = await listGoogleEvents(cfg, { syncToken: null, showDeleted: true });
    } else {
      throw err;
    }
  }

  for (const g of listing.items) {
    const { data: found } = await admin.from("events").select(EVENT_COLUMNS).eq("google_event_id", g.id).maybeSingle();
    let existing = found as AppEventRow | null;

    if (g.status === "cancelled") {
      if (existing) {
        const { error } = await admin.rpc("google_sync_delete_event", { p_id: existing.id });
        if (!error) {
          result.deleted++;
          await auditFromGoogle(admin, existing.id, existing.title, null);
        }
      } else {
        result.skipped++;
      }
      continue;
    }

    // An event this app created whose link didn't get saved yet.
    if (!existing) {
      const fcbId = g.extendedProperties?.private?.fcb_event_id;
      if (fcbId) {
        const { data: byId } = await admin.from("events").select(EVENT_COLUMNS).eq("id", fcbId).maybeSingle();
        if (byId) {
          existing = byId as AppEventRow;
          if (!existing.google_event_id) {
            await linkAppEvent(admin, existing.id, g);
            result.skipped++;
            continue;
          }
        } else {
          // It was ours and has since been deleted in the app — the delete
          // is on its way to Google; don't resurrect it.
          result.skipped++;
          continue;
        }
      }
    }

    if (!existing) {
      const startDate = googleStartDate(g);
      if (!startDate || !inWindow(startDate)) {
        result.skipped++;
        continue;
      }
      const { data: newId, error } = await admin.rpc("google_sync_apply_event", { p_id: null, p_row: googleToApp(g, null) });
      if (!error && newId) {
        result.created++;
        await auditFromGoogle(admin, String(newId), null, (g.summary ?? "").trim());
      }
      continue;
    }

    // Our own change echoing back.
    if (existing.google_etag && existing.google_etag === g.etag) {
      result.skipped++;
      continue;
    }
    // Most recent edit wins: if the app's copy was changed after Google's,
    // keep the app's (its own push will update Google).
    if (g.updated && new Date(existing.updated_at).getTime() > new Date(g.updated).getTime() + 2000) {
      result.skipped++;
      continue;
    }
    const { error } = await admin.rpc("google_sync_apply_event", { p_id: existing.id, p_row: googleToApp(g, existing) });
    if (!error) {
      result.updated++;
      await auditFromGoogle(admin, existing.id, existing.title, (g.summary ?? "").trim());
    }
  }

  await saveConfig(admin, cfg.calendar_key, {
    sync_token: listing.nextSyncToken ?? cfg.sync_token,
    last_pull_at: new Date().toISOString(),
    last_error: null,
  });
  return result;
}

// ---- change notifications ------------------------------------------------

export async function ensureWatch(admin: SupabaseClient, cfg: SyncConfig, force = false): Promise<void> {
  const expires = cfg.channel_expires_at ? new Date(cfg.channel_expires_at).getTime() : 0;
  if (!force && cfg.channel_id && expires > Date.now() + 2 * 24 * 3600 * 1000) return;

  if (cfg.channel_id && cfg.channel_resource_id) {
    await gcal("/channels/stop", {
      method: "POST",
      body: JSON.stringify({ id: cfg.channel_id, resourceId: cfg.channel_resource_id }),
    }).catch(() => {});
  }
  const channelId = crypto.randomUUID();
  const res = await gcal<{ id: string; resourceId: string; expiration?: string }>(
    `/calendars/${enc(cfg.google_calendar_id)}/events/watch`,
    {
      method: "POST",
      body: JSON.stringify({
        id: channelId,
        type: "web_hook",
        address: webhookUrlFor(cfg),
        token: cfg.secret,
        params: { ttl: String(30 * 24 * 3600) },
      }),
    },
  );
  await saveConfig(admin, cfg.calendar_key, {
    channel_id: res.id,
    channel_resource_id: res.resourceId,
    channel_expires_at: res.expiration ? new Date(Number(res.expiration)).toISOString() : null,
  });
}

// ---- first sync: preview + run ---------------------------------------------

function normTitle(s: string): string {
  return (s ?? "").toLowerCase().replace(/[^a-z0-9]+/g, "");
}

export interface PreviewItem {
  title: string;
  start_date: string;
  end_date: string | null;
  time?: string | null;
}

export interface InitialPreview {
  matched: { app: PreviewItem; google: PreviewItem }[];
  googleOnly: PreviewItem[];
  appOnly: PreviewItem[];
  windowNote: string;
}

async function computeInitial(admin: SupabaseClient, cfg: SyncConfig) {
  const { items } = await listGoogleEvents(cfg, { syncToken: null, showDeleted: false });
  const google = items.filter((g) => g.status !== "cancelled" && googleStartDate(g) && inWindow(googleStartDate(g)!));
  const { data } = await admin.from("events").select(EVENT_COLUMNS).order("start_date", { ascending: true });
  const app = ((data ?? []) as AppEventRow[]).filter((e) => !e.google_event_id);

  const byKey = new Map<string, GEvent[]>();
  for (const g of google) {
    const k = `${normTitle(g.summary ?? "")}|${googleStartDate(g)}`;
    byKey.set(k, [...(byKey.get(k) ?? []), g]);
  }
  const matched: { app: AppEventRow; google: GEvent }[] = [];
  const appOnly: AppEventRow[] = [];
  for (const e of app) {
    const list = byKey.get(`${normTitle(e.title)}|${e.start_date}`);
    if (list && list.length) {
      matched.push({ app: e, google: list.shift()! });
    } else {
      appOnly.push(e);
    }
  }
  const matchedIds = new Set(matched.map((m) => m.google.id));
  // Google events already linked to an app event don't count as Google-only.
  const { data: linked } = await admin.from("events").select("google_event_id").not("google_event_id", "is", null);
  const linkedIds = new Set(((linked ?? []) as { google_event_id: string }[]).map((r) => r.google_event_id));
  const googleOnly = google.filter((g) => !matchedIds.has(g.id) && !linkedIds.has(g.id));
  return { matched, appOnly, googleOnly };
}

function gItem(g: GEvent): PreviewItem {
  const row = googleToApp(g, null) as { title: string; start_date: string; end_date: string; time_label: string };
  return { title: row.title, start_date: row.start_date, end_date: row.end_date || null, time: row.time_label || null };
}

function aItem(e: AppEventRow): PreviewItem {
  return { title: e.title, start_date: e.start_date, end_date: e.end_date, time: e.time_label };
}

export async function previewInitialSync(admin: SupabaseClient, cfg: SyncConfig): Promise<InitialPreview> {
  const { matched, appOnly, googleOnly } = await computeInitial(admin, cfg);
  return {
    matched: matched.map((m) => ({ app: aItem(m.app), google: gItem(m.google) })),
    googleOnly: googleOnly.map(gItem),
    appOnly: appOnly.map(aItem),
    windowNote: `Google events are only brought in from ${addDays(todayIso(), -WINDOW_PAST_DAYS)} to ${addDays(todayIso(), WINDOW_FUTURE_DAYS)}.`,
  };
}

export async function runInitialSync(admin: SupabaseClient, cfg: SyncConfig): Promise<{ linked: number; addedToApp: number; addedToGoogle: number }> {
  const { matched, appOnly, googleOnly } = await computeInitial(admin, cfg);

  // 1. Link events that already exist on both sides (no copies made).
  for (const m of matched) {
    const extra =
      m.google.start?.dateTime && m.google.end?.dateTime
        ? {
            google_time: { start: m.google.start, end: m.google.end },
            google_time_label: `${localTime(m.google.start.dateTime)} – ${localTime(m.google.end.dateTime)}`,
          }
        : {};
    // Keep anything Google has that the app doesn't (notes/location), then
    // send the app's fuller version (time, type/distributor/rep footer) to
    // Google — so a later edit on the Google side can't wipe app-only
    // details that Google never had.
    const fromGoogle = parseDescription(m.google.description);
    const fill: Record<string, unknown> = {};
    if (!m.app.notes && fromGoogle.notes) fill.notes = fromGoogle.notes;
    if (!m.app.location && m.google.location) fill.location = m.google.location;
    if (!m.app.time_label && fromGoogle.timeLabel) fill.time_label = fromGoogle.timeLabel;
    // A timed Google event stays timed: the app shows Google's exact time.
    if ("google_time_label" in extra) fill.time_label = extra.google_time_label;
    await linkAppEvent(admin, m.app.id, m.google, { ...extra, ...fill });
    await pushAppEvent(admin, cfg, m.app.id);
  }
  // 2. Google-only -> app.
  let addedToApp = 0;
  for (const g of googleOnly) {
    const { error } = await admin.rpc("google_sync_apply_event", { p_id: null, p_row: googleToApp(g, null) });
    if (!error) addedToApp++;
  }
  // 3. App-only -> Google.
  let addedToGoogle = 0;
  for (const e of appOnly) {
    await pushAppEvent(admin, cfg, e.id);
    addedToGoogle++;
  }

  // 4. Grab a sync token so future pulls only see changes, then turn on the
  //    trigger (initial_sync_done) and Google's change notifications.
  const { nextSyncToken } = await listGoogleEvents(cfg, { syncToken: null, showDeleted: true });
  await saveConfig(admin, cfg.calendar_key, {
    sync_token: nextSyncToken,
    initial_sync_done: true,
    last_pull_at: new Date().toISOString(),
    last_error: null,
  });
  const fresh = await loadSyncConfig(admin, cfg.calendar_key);
  if (fresh) await ensureWatch(admin, fresh, true);
  return { linked: matched.length, addedToApp, addedToGoogle };
}

export async function recordSyncError(admin: SupabaseClient, key: string, err: unknown) {
  await saveConfig(admin, key, { last_error: err instanceof Error ? err.message.slice(0, 500) : String(err).slice(0, 500) });
}
