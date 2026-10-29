import { NextRequest, NextResponse } from "next/server";
import { getProfile } from "@/lib/getProfile";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  JAMES_HISTORY_END,
  JAMES_REP,
  JAMES_SOURCES,
  activityFor,
  matchStores,
  newAccountId,
  premiseOf,
  visitsForStore,
  type AccountLite,
} from "@/lib/marksteinJames";

// James's history import for the Markstein page (added 2026-10-29, per Chad).
// Administrators only. Plan: claude/markstein-james-import-plan.md.
//   GET  → the review list: every store James visited, matched to an account
//          (matched / unsure / none), plus whether the history is already in.
//   POST { picks: { [storeKey]: outlet_id | "new" | "skip" } }
//        → saves James's check-ins to sales_account_checkins (rep "James",
//          source "CMC: James …"). Stores marked "new" are added as Markstein
//          accounts ("CMC-…" id) so they show as Prospects. Running it again
//          replaces James's imported check-ins up to 10/25 — nothing else.
export const maxDuration = 60;

async function requireAdmin() {
  const profile = await getProfile();
  if (!profile || profile.role !== "admin" || !profile.is_super_admin) return null;
  return profile;
}

async function loadAccounts(admin: ReturnType<typeof createAdminClient>): Promise<AccountLite[]> {
  const out: AccountLite[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await admin
      .from("sales_accounts")
      .select("outlet_id, name, address, city, distributor, premise")
      .order("outlet_id")
      .range(from, from + 999);
    if (error) throw new Error(error.message);
    out.push(...((data ?? []) as AccountLite[]));
    if (!data || data.length < 1000) break;
  }
  return out;
}

export async function GET() {
  if (!(await requireAdmin())) return NextResponse.json({ error: "Only Administrators can import James's history." }, { status: 403 });
  const admin = createAdminClient();
  try {
    const accounts = await loadAccounts(admin);
    const stores = matchStores(accounts);
    const { count } = await admin
      .from("sales_account_checkins")
      .select("id", { count: "exact", head: true })
      .in("source", Object.values(JAMES_SOURCES))
      .lte("checkin_date", JAMES_HISTORY_END);
    return NextResponse.json({ stores, imported: count ?? 0, visits: stores.reduce((n, s) => n + s.visits, 0) });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  const profile = await requireAdmin();
  if (!profile) return NextResponse.json({ error: "Only Administrators can import James's history." }, { status: 403 });
  const body = ((await req.json().catch(() => ({}))) ?? {}) as { picks?: Record<string, string> };
  const picks = body.picks ?? {};
  const admin = createAdminClient();
  try {
    const accounts = await loadAccounts(admin);
    const byId = new Map(accounts.map((a) => [a.outlet_id, a]));
    const stores = matchStores(accounts);

    const newAccounts: Record<string, unknown>[] = [];
    const rows: Record<string, unknown>[] = [];
    let skipped = 0;
    for (const s of stores) {
      const pick = picks[s.key] ?? s.pick ?? "new";
      const visits = visitsForStore(s.key);
      if (pick === "skip") {
        skipped += visits.length;
        continue;
      }
      let outlet = pick;
      let acctPremise: string | null = null;
      if (pick === "new") {
        outlet = newAccountId(s.key);
        if (!byId.has(outlet)) {
          newAccounts.push({
            outlet_id: outlet,
            name: s.name,
            address: s.address,
            city: s.city,
            state: "CA",
            distributor: "Markstein",
            premise: s.premise,
            report_note: "Added from James's (CMC) visits — not in the VIP account list yet.",
          });
        }
      } else {
        const a = byId.get(pick);
        if (!a) return NextResponse.json({ error: `Account ${pick} for ${s.name} isn't in the account list anymore — reload the review list.` }, { status: 400 });
        acctPremise = premiseOf(a.premise);
      }
      for (const v of visits) {
        rows.push({
          outlet_id: outlet,
          checkin_date: v.d,
          rep: JAMES_REP,
          activity: activityFor(premiseOf(v.p) ?? s.premise ?? acctPremise),
          outcome: v.r,
          notes: v.x,
          brands: v.b,
          contact: v.k,
          source: JAMES_SOURCES[v.s],
          created_by: profile.id,
        });
      }
    }

    if (newAccounts.length) {
      const { error } = await admin.from("sales_accounts").upsert(newAccounts, { onConflict: "outlet_id", ignoreDuplicates: true });
      if (error) throw new Error(`Adding new accounts: ${error.message}`);
    }
    const { error: delErr } = await admin
      .from("sales_account_checkins")
      .delete()
      .in("source", Object.values(JAMES_SOURCES))
      .lte("checkin_date", JAMES_HISTORY_END);
    if (delErr) throw new Error(`Clearing the earlier import: ${delErr.message}`);
    for (let i = 0; i < rows.length; i += 500) {
      const { error } = await admin.from("sales_account_checkins").insert(rows.slice(i, i + 500));
      if (error) throw new Error(`Saving check-ins: ${error.message}`);
    }
    return NextResponse.json({ ok: true, checkins: rows.length, newAccounts: newAccounts.length, skipped });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}
