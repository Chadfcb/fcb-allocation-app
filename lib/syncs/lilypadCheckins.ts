import type { SupabaseClient } from "@supabase/supabase-js";
import {
  pacificDayEndUnix,
  pacificDayStartUnix,
  pacificOffsetMinutes,
  readLilypadActivityDefs,
  readLilypadTeamsAndUsers,
  runLilypadExport,
  todayPacific,
} from "@/lib/syncs/lilypadReader";
import { appDistributor } from "@/lib/syncs/lilypadSales";
import { isoDate, pick, readSheets, text, type Row } from "@/lib/syncs/lilypadFiles";

// LilyPad → Sales > Accounts check-ins (added 2026-10-16 —
// claude/lilypad-sync-plan.md). Daily, automatic.
//
// Exports LilyPad's "Activities & Tasks" report — every activity type (Off /
// On Premise Visit, Phone Call, Email/Text Contact, Distributor Visit, …),
// every user including inactive ones, all accounts — with LilyPad's default
// columns (one sheet per activity type, incl. Meeting Recap / Brands Sampled
// / Contact), and saves them to sales_account_checkins with source
// "Lilypad: sync".
//
// Window: the last 45 days every run (late entries get picked up). If the app
// has no LilyPad check-ins at all yet (first run, or after a full re-import
// on the Import data panel, which clears imported check-ins), it goes back
// to January 1 of this year.
//
// Check-ins already in the app from the Sales Ops spreadsheets (many of them
// are the same LilyPad check-ins, entered by hand) are not doubled: a LilyPad
// check-in for the same account, day and activity is skipped. Check-ins
// logged in the app itself are never touched.

const SOURCE = "Lilypad: sync";
const RECENT_DAYS = 45;

function daysAgo(iso: string, days: number): string {
  const d = new Date(Date.parse(`${iso}T12:00:00Z`) - days * 86400_000);
  return d.toISOString().slice(0, 10);
}

export interface CheckinRow {
  outlet_id: string;
  checkin_date: string;
  rep: string | null;
  activity: string | null;
  outcome: string | null;
  notes: string | null;
  brands: string | null;
  contact: string | null;
  source: string;
}

export function checkinsFromSheets(sheets: { name: string; rows: Row[] }[]) {
  const out: CheckinRow[] = [];
  const accounts = new Map<string, Record<string, string | null>>();
  let skipped = 0;
  for (const sheet of sheets) {
    for (const r of sheet.rows) {
      const outlet = text(pick(r, "Account Id", /account ?id/i));
      const date = isoDate(pick(r, "Date Completed At", "Date Started At", /date (completed|started)/i));
      if (!outlet || !date) {
        skipped++;
        continue;
      }
      out.push({
        outlet_id: outlet,
        checkin_date: date,
        rep: text(pick(r, "User")),
        activity: text(pick(r, "Activity Name")) ?? sheet.name,
        outcome: text(pick(r, /opportunit/i, /outcome|result/i)),
        notes: text(pick(r, /recap/i, /summary/i, /notes?\b/i, /comments?/i, /description/i)),
        brands: text(pick(r, /brands? sampled/i, /brand/i)),
        contact: text(pick(r, "Contact Name", "Contact", /contact name/i)),
        source: SOURCE,
      });
      if (!accounts.has(outlet)) {
        accounts.set(outlet, {
          outlet_id: outlet,
          name: text(pick(r, "Account Name")) ?? outlet,
          address: text(pick(r, "Account Address")),
          city: text(pick(r, "Account City")),
          state: text(pick(r, "Account State")),
          zip: text(pick(r, "Account Zip")),
          distributor: appDistributor(text(pick(r, "Distributor"))),
        });
      }
    }
  }
  return { rows: out, accounts: [...accounts.values()], skipped };
}

const dedupeKey = (c: { outlet_id: string; checkin_date: string; activity: string | null }) =>
  `${c.outlet_id}|${c.checkin_date}|${(c.activity ?? "").toLowerCase().trim()}`;

export async function syncLilypadCheckins(admin: SupabaseClient) {
  const issues: string[] = [];
  const today = todayPacific();
  const { count: lilypadCount } = await admin
    .from("sales_account_checkins")
    .select("id", { count: "exact", head: true })
    .like("source", "Lilypad:%");
  // Also back to Jan 1 once if none of the saved LilyPad check-ins has notes
  // yet — the first run (2026-10-19) saved them without the answer columns.
  const { count: withNotes } = await admin
    .from("sales_account_checkins")
    .select("id", { count: "exact", head: true })
    .like("source", "Lilypad:%")
    .not("notes", "is", null);
  const start =
    (lilypadCount ?? 0) > 0 && (withNotes ?? 0) > 0 ? daysAgo(today, RECENT_DAYS) : `${today.slice(0, 4)}-01-01`;

  const [defs, { teams, users }] = await Promise.all([readLilypadActivityDefs(), readLilypadTeamsAndUsers()]);
  if (!defs.length) throw new Error("LilyPad returned no activity types — the reader needs an update.");

  // Columns: LilyPad's own default (attributes: []), the same setting Chad's
  // working "pce" exports use. Listing every form field explicitly (the first
  // build) gave the right column headers but EMPTY answers — Meeting Recap,
  // Brands Sampled, etc. were blank for all 3,377 check-ins in the
  // 2026-10-19 file, while LilyPad itself has them (e.g. Steve's 8/14 RENOS
  // visit, "DID NOT SAMPLE").
  const attributes: unknown[] = [];

  const file = await runLilypadExport(
    "activity",
    `FCB-Data sync ${today} (check-ins)`,
    {
      teams,
      users,
      activitys: defs.map((d) => d.id),
      tasks: [],
      distributors: ["ALL SELECTED"],
      range: { start_dt: pacificDayStartUnix(start), end_dt: pacificDayEndUnix(today) },
      attributes,
      multiFieldPreference: 1,
      worklist: [],
      target: 1, // All Accounts
      isInactiveUsers: true,
    },
    { style: 1, timezoneOffset: pacificOffsetMinutes() }, // one sheet per activity type
  );
  const sheets = await readSheets(file, "Account Id");
  const { rows, accounts, skipped } = checkinsFromSheets(sheets);
  const rawDistributors = new Set<string>();
  for (const sh of sheets) for (const r of sh.rows) {
    const d = text(pick(r, "Distributor"));
    if (d) rawDistributors.add(d);
  }

  // Skip what's already in the app from the Sales Ops spreadsheets, and
  // anything listed twice in the file.
  const existing = new Set<string>();
  for (let from = 0; ; from += 1000) {
    const { data, error } = await admin
      .from("sales_account_checkins")
      .select("outlet_id, checkin_date, activity, source")
      .gte("checkin_date", start)
      .range(from, from + 999);
    if (error) throw new Error(`Reading existing check-ins failed: ${error.message}`);
    for (const c of data ?? []) {
      if (!String(c.source ?? "").startsWith("Lilypad:")) existing.add(dedupeKey(c as CheckinRow));
    }
    if (!data || data.length < 1000) break;
  }
  const seen = new Set<string>();
  const fresh: CheckinRow[] = [];
  let alreadyThere = 0;
  for (const r of rows) {
    if (r.checkin_date < start || r.checkin_date > today) continue;
    const k = dedupeKey(r) + "|" + (r.rep ?? "") + "|" + (r.notes ?? "");
    if (existing.has(dedupeKey(r))) {
      alreadyThere++;
      continue;
    }
    if (seen.has(k)) continue;
    seen.add(k);
    fresh.push(r);
  }

  for (let i = 0; i < accounts.length; i += 1000) {
    const { error } = await admin
      .from("sales_accounts")
      .upsert(accounts.slice(i, i + 1000), { onConflict: "outlet_id", ignoreDuplicates: true });
    if (error) issues.push(`Saving new accounts from check-ins failed: ${error.message}`);
  }
  // The first run (2026-10-19) saved a few accounts with LilyPad's full
  // distributor name (e.g. "Beauchamp Dist Co."); use the app's names.
  for (const raw of rawDistributors) {
    const mapped = appDistributor(raw);
    if (mapped && mapped !== raw) {
      await admin.from("sales_accounts").update({ distributor: mapped }).eq("distributor", raw);
    }
  }

  const { error: delError } = await admin
    .from("sales_account_checkins")
    .delete()
    .like("source", "Lilypad:%")
    .gte("checkin_date", start);
  if (delError) throw new Error(`Clearing LilyPad check-ins from ${start} failed: ${delError.message}`);
  for (let i = 0; i < fresh.length; i += 1000) {
    const { error } = await admin.from("sales_account_checkins").insert(fresh.slice(i, i + 1000));
    if (error) {
      throw new Error(`Saving check-ins failed part-way (${i} of ${fresh.length} saved): ${error.message}. The next run re-does them.`);
    }
  }

  return {
    syncedCount: fresh.length,
    issues,
    summary: `${fresh.length} check-ins saved from ${start} on — ${fresh.filter((c) => c.notes).length} with notes, ${fresh.filter((c) => c.brands).length} with brands sampled (${alreadyThere} already in the app from Sales Ops${skipped ? `; ${skipped} activities with no account skipped` : ""})`,
  };
}
