import { NextRequest, NextResponse } from "next/server";
import { getProfile } from "@/lib/getProfile";
import { createAdminClient } from "@/lib/supabase/admin";
import type { ImportAccount, ImportBuddy, ImportCheckin, ImportContact, ImportSale } from "@/lib/salesAccounts";

// Sales > Accounts import (added 2026-10-07). Admins only. The page reads the
// import file in the browser and sends it here in pieces:
//   { action: "start" }                       — empty all account data (full replace)
//   { action: "accounts", rows: ImportAccount[] }
//   { action: "sales", rows: ImportSale[] }
//   { action: "contacts", rows: ImportContact[] }
//   { action: "buddies", rows: ImportBuddy[] }  — target-list accounts start as Buddy
//       accounts. Only adds a classification where the account has none yet;
//       never changes one someone already set (classifications survive re-imports).
//   { action: "checkins_clear" }                 — remove previously IMPORTED check-ins
//       (source "Sales Ops: …" / "Lilypad: …"); check-ins logged in the app stay
//   { action: "checkins", rows: ImportCheckin[] }
//   { action: "finish", as_of: "YYYY-MM-DD" }  — fill each account's summary + save the as-of date
export const maxDuration = 60;

const cleanDate = (s: string | null | undefined) => (s && /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : null);

export async function POST(req: NextRequest) {
  const profile = await getProfile();
  if (!profile || profile.role !== "admin") {
    return NextResponse.json({ error: "Only admins can import account data." }, { status: 403 });
  }
  const body = ((await req.json().catch(() => ({}))) ?? {}) as {
    action?: string;
    rows?: unknown[];
    as_of?: string;
  };
  const admin = createAdminClient();

  if (body.action === "start") {
    const { error } = await admin.rpc("sales_accounts_clear");
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ ok: true });
  }

  if (body.action === "accounts") {
    const rows = ((body.rows ?? []) as ImportAccount[]).map((a) => ({
      outlet_id: String(a.id),
      name: a.n,
      address: a.a ?? null,
      city: a.c ?? null,
      state: a.st ?? null,
      zip: a.z ?? null,
      phone: a.ph ?? null,
      distributor: a.d ?? null,
      premise: a.pr ?? null,
      best_day: a.bd ?? null,
      report_buy_date: cleanDate(a.rd),
      report_note: a.rn ?? null,
    }));
    const { error } = await admin.from("sales_accounts").upsert(rows, { onConflict: "outlet_id" });
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ ok: true, count: rows.length });
  }

  if (body.action === "sales") {
    const rows = ((body.rows ?? []) as ImportSale[]).map(([outlet, ym, product, pkg, dist, ce, lb, size]) => ({
      outlet_id: String(outlet),
      month: `${ym}-01`,
      product,
      package: pkg,
      distributor: dist,
      ce,
      last_buy_date: cleanDate(lb),
      size: size ?? null,
    }));
    const { error } = await admin.from("sales_account_sales").insert(rows);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ ok: true, count: rows.length });
  }

  if (body.action === "contacts") {
    const rows = ((body.rows ?? []) as ImportContact[]).map(([outlet, name, title, phone, mobile, email, notes, source]) => ({
      outlet_id: String(outlet),
      name,
      title,
      phone,
      mobile,
      email,
      notes,
      source,
    }));
    const { error } = await admin.from("sales_account_contacts").insert(rows);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ ok: true, count: rows.length });
  }

  if (body.action === "buddies") {
    const rows = ((body.rows ?? []) as ImportBuddy[]).map(([outlet, list, repName, repPhone, repEmail]) => ({
      outlet_id: String(outlet),
      owner_type: "buddy",
      buddy_list: list,
      buddy_rep_name: repName,
      buddy_rep_phone: repPhone,
      buddy_rep_email: repEmail,
      updated_by: profile.id,
    }));
    const { error } = await admin
      .from("sales_account_class")
      .upsert(rows, { onConflict: "outlet_id", ignoreDuplicates: true });
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ ok: true, count: rows.length });
  }

  if (body.action === "checkins_clear") {
    for (const prefix of ["Sales Ops:%", "Lilypad:%"]) {
      const { error } = await admin.from("sales_account_checkins").delete().like("source", prefix);
      if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    }
    return NextResponse.json({ ok: true });
  }

  if (body.action === "checkins") {
    const rows = ((body.rows ?? []) as ImportCheckin[])
      .filter((c) => cleanDate(c[1]))
      .map(([outlet, date, rep, activity, outcome, notes, brands, contact, source]) => ({
        outlet_id: String(outlet),
        checkin_date: date,
        rep,
        activity,
        outcome,
        notes,
        brands,
        contact,
        source,
        created_by: profile.id,
      }));
    const { error } = await admin.from("sales_account_checkins").insert(rows);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ ok: true, count: rows.length });
  }

  if (body.action === "finish") {
    const asOf = cleanDate(body.as_of);
    if (!asOf) return NextResponse.json({ error: "The import file has no valid as-of date." }, { status: 400 });
    const { error } = await admin.rpc("sales_accounts_refresh", { p_as_of: asOf });
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    const { error: metaError } = await admin.from("sales_data_meta").upsert({
      id: 1,
      as_of: asOf,
      imported_at: new Date().toISOString(),
      imported_by: profile.id,
    });
    if (metaError) return NextResponse.json({ error: metaError.message }, { status: 500 });
    return NextResponse.json({ ok: true });
  }

  return NextResponse.json({ error: "Unknown action" }, { status: 400 });
}
