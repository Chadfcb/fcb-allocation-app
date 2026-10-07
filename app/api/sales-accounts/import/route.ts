import { NextRequest, NextResponse } from "next/server";
import { getProfile } from "@/lib/getProfile";
import { createAdminClient } from "@/lib/supabase/admin";
import type { ImportAccount, ImportContact, ImportSale } from "@/lib/salesAccounts";

// Sales > Accounts import (added 2026-10-07). Admins only. The page reads the
// import file in the browser and sends it here in pieces:
//   { action: "start" }                       — empty all account data (full replace)
//   { action: "accounts", rows: ImportAccount[] }
//   { action: "sales", rows: ImportSale[] }
//   { action: "contacts", rows: ImportContact[] }
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
    const rows = ((body.rows ?? []) as ImportSale[]).map(([outlet, ym, product, pkg, dist, ce, lb]) => ({
      outlet_id: String(outlet),
      month: `${ym}-01`,
      product,
      package: pkg,
      distributor: dist,
      ce,
      last_buy_date: cleanDate(lb),
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
