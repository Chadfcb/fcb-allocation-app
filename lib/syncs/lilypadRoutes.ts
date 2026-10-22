import type { SupabaseClient } from "@supabase/supabase-js";
import { readLilypadTargetAccounts, readLilypadTargetLists, readLilypadUsers } from "@/lib/syncs/lilypadReader";
import { appDistributor } from "@/lib/syncs/lilypadSales";

// LilyPad → maintenance routes (added 2026-10-22 — claude/maintenance-routes.md,
// plan approved by Chad 10/21). Daily, automatic, with the other syncs.
//
// Each distributor has a maintenance route: a LilyPad target list of accounts
// the rep must check in at, at least once every two-month period. This reads
// each CURRENT rep's lists (Chad: "dont select all users" → current reps
// only), keeps the ones named "… Maintenance Route", and saves every account
// on them (lilypad_routes / lilypad_route_accounts, sql/distributors.sql) —
// new or removed accounts are picked up on the next run.
//
// The check-ins themselves are NOT exported again here: the Check-ins sync
// already saves every LilyPad check-in (all activities, all users, with
// notes) to sales_account_checkins. The pages count a route account as
// checked in when it has an Email/Text Contact, Phone Call, Off or On Premise
// Visit by a current rep in the period — the same rows LilyPad's Target
// Accounts export lists (route_checkin_counts() in sql/distributors.sql).
//
// GET calls only — nothing is created or changed in LilyPad.

// Current reps whose routes count (claude/maintenance-routes.md, 10/21: Steve
// → Matagrano, Eric → Guardian, Lance → Saccani). Bill Grossman's Saccani
// route and Ryan Morrison's Valley Wide route (inactive) are left out.
// Add a name here when a new rep gets a route.
export const ROUTE_REPS = ["Steve Bruce", "Eric Gutenkauf", "Lance Huravitch"];

const ROUTE_NAME = /maintenance\s+route/i;

export async function syncLilypadRoutes(admin: SupabaseClient) {
  const issues: string[] = [];
  const users = await readLilypadUsers();
  if (!users.length) throw new Error("LilyPad returned no users — the reader needs an update.");

  const routes: { list_id: string; name: string; distributor: string | null; rep: string; account_count: number }[] = [];
  const accounts: { list_id: string; outlet_id: string; name: string | null; city: string | null }[] = [];

  for (const repName of ROUTE_REPS) {
    const user = users.find((u) => u.name.toLowerCase() === repName.toLowerCase());
    if (!user) {
      issues.push(`${repName} isn't a LilyPad user anymore — their route was skipped. Update ROUTE_REPS (lib/syncs/lilypadRoutes.ts).`);
      continue;
    }
    if (!user.active) {
      issues.push(`${repName} is inactive in LilyPad — their route was skipped.`);
      continue;
    }
    const lists = (await readLilypadTargetLists(user.id)).filter((l) => ROUTE_NAME.test(l.name));
    if (!lists.length) issues.push(`${repName} has no "Maintenance Route" list in LilyPad.`);
    for (const list of lists) {
      const accs = await readLilypadTargetAccounts(list.id);
      // Distributor: from the list's name ("Matagrano Maintenance Route"),
      // else from its accounts.
      const fromName = appDistributor(list.name.replace(ROUTE_NAME, "").trim()) ?? null;
      const fromAccounts = appDistributor(accs.find((a) => a.distributor)?.distributor ?? null);
      const seen = new Set<string>();
      for (const a of accs) {
        if (seen.has(a.outletId)) continue;
        seen.add(a.outletId);
        accounts.push({ list_id: list.id, outlet_id: a.outletId, name: a.name, city: a.city });
      }
      routes.push({ list_id: list.id, name: list.name, distributor: fromName || fromAccounts, rep: user.name, account_count: seen.size });
    }
  }

  if (!routes.length) throw new Error("No maintenance routes found in LilyPad for the current reps — nothing saved (the old lists are kept).");

  // Replace everything: routes removed in LilyPad go away (their accounts with them).
  const now = new Date().toISOString();
  const { error: upErr } = await admin.from("lilypad_routes").upsert(routes.map((r) => ({ ...r, synced_at: now })), { onConflict: "list_id" });
  if (upErr) throw new Error(`Saving routes failed: ${upErr.message}`);
  const keep = routes.map((r) => r.list_id);
  const { error: delRoutesErr } = await admin.from("lilypad_routes").delete().not("list_id", "in", `(${keep.map((k) => `"${k}"`).join(",")})`);
  if (delRoutesErr) issues.push(`Removing old routes failed: ${delRoutesErr.message}`);
  for (const id of keep) {
    const { error } = await admin.from("lilypad_route_accounts").delete().eq("list_id", id);
    if (error) throw new Error(`Clearing route accounts failed: ${error.message}`);
  }
  for (let i = 0; i < accounts.length; i += 1000) {
    const { error } = await admin.from("lilypad_route_accounts").insert(accounts.slice(i, i + 1000));
    if (error) throw new Error(`Saving route accounts failed part-way: ${error.message}. The next run re-does them.`);
  }

  return {
    syncedCount: accounts.length,
    issues,
    summary: routes.map((r) => `${r.rep}: ${r.name} (${r.account_count} accounts${r.distributor ? `, ${r.distributor}` : ""})`).join(" · "),
  };
}
