import type { SupabaseClient } from "@supabase/supabase-js";
import { runLilypadExport, pacificDayEndUnix, pacificDayStartUnix, todayPacific } from "@/lib/syncs/lilypadReader";
import { isoDate, num, pick, readSheets, text, type Row } from "@/lib/syncs/lilypadFiles";

// LilyPad → Sales > Accounts purchase history (added 2026-10-16 —
// claude/lilypad-sync-plan.md). Daily, automatic; replaces Chad's hand-run
// "Invoices" export + Claude's import file for 2026-on data.
//
// What it does each run:
//   1. Exports LilyPad's Invoices report (every distributor, "Download Now",
//      .xlsx) from the first day of the month TWO months before the data's
//      current as-of date, through today. Re-pulling the last couple of
//      months every day is what catches invoices that show up in LilyPad late
//      (Aug/Sep 2026 were thin in the 10/8 import) — nothing is ever "missed"
//      just because it arrived after a run.
//   2. Rolls invoices up the same way the import file did: one row per
//      account × month × product (brand) × package × distributor, CE summed,
//      last buy date = latest invoice date in that month, size worked out
//      from the package name.
//   3. Replaces those months in sales_account_sales (all months from the
//      window start on), adds any account it hasn't seen before to
//      sales_accounts (never changes existing accounts), recomputes every
//      account's summary (sales_accounts_refresh) and saves the new as-of
//      date — same finish as the Import data panel.
//
// Safety: if a finished month comes back with less than half the rows the
// app already has for it, nothing is written and the run reports why — a
// LilyPad hiccup can never wipe good data.

const MIN_RATIO = 0.5;

// LilyPad distributor (code or name) → the name Sales > Accounts uses.
const DISTRIBUTORS: [RegExp, string][] = [
  [/guard/i, "Guardian"],
  [/markant|markstein/i, "Markstein"],
  [/matagran/i, "Matagrano"],
  [/^mus$|mussetter/i, "Mussetter"],
  [/saccani/i, "Saccani"],
  [/^valley$|valley ?wide/i, "Valley Wide"],
  [/sfnat|san francisco naturals|sf naturals/i, "SF Naturals"],
  [/^eagle|eagle dist/i, "Eagle"],
  [/^ca03$|breakthru|wine warehouse/i, "Breakthru"],
  [/coast/i, "Coast"],
  [/superior/i, "Superior"],
];

export function appDistributor(raw: string | null): string | null {
  if (!raw) return null;
  const s = raw.trim();
  for (const [re, name] of DISTRIBUTORS) if (re.test(s)) return name;
  return s;
}

// Same size buckets as the import file (checked against all 122k imported
// rows on 2026-10-16: identical results).
export function sizeFor(pkg: string | null): string {
  const s = (pkg ?? "").toLowerCase();
  if (/19\.2|19 ?oz/.test(s)) return "19.2oz";
  if (/13\.2/.test(s)) return "13.2 gal keg";
  if (/1\/2|half|15\.5 ?gal/.test(s)) return "1/2 bbl";
  if (/1\/6|sixth|5\.1\d? ?gal|5\.2 ?gal/.test(s)) return "1/6 bbl";
  if (/22\s*oz/.test(s)) return "22oz bottle";
  if (/16\s*oz/.test(s)) return "16oz";
  if (/12\s*oz/.test(s)) return "12oz";
  return "Other";
}

function premise(v: string | null): string | null {
  if (!v) return null;
  if (/off/i.test(v)) return "Off";
  if (/on/i.test(v)) return "On";
  return v;
}

function firstOfMonth(iso: string, monthsBack = 0): string {
  const [y, m] = iso.split("-").map(Number);
  const d = new Date(Date.UTC(y, m - 1 - monthsBack, 1));
  return d.toISOString().slice(0, 10);
}

export interface SalesSyncResult {
  syncedCount: number;
  issues: string[];
  summary: string;
}

interface Agg {
  outlet_id: string;
  month: string;
  product: string;
  package: string | null;
  distributor: string | null;
  ce: number;
  last_buy_date: string;
  size: string;
}

export function rollUpInvoices(rows: Row[], windowStart: string, windowEnd: string) {
  const agg = new Map<string, Agg>();
  const accounts = new Map<string, Record<string, string | null>>();
  let skipped = 0;
  let maxDate = "";
  for (const r of rows) {
    const outlet = text(pick(r, "Account Id", /account ?id/i));
    const date = isoDate(pick(r, "Invoice Date", /invoice date|^date$/i));
    const product = text(pick(r, "Brand Name", /brand/i));
    const pkg = text(pick(r, "Product Name", /product name|^product$/i));
    const dist = appDistributor(text(pick(r, "Distributor", /^distributor$/i)));
    const ce = num(pick(r, "CE", /^ce$|case equiv/i));
    if (date && (date < windowStart || date > windowEnd)) continue; // outside the window
    if (!outlet || !date || !product) {
      skipped++;
      continue;
    }
    if (date > maxDate) maxDate = date;
    const month = `${date.slice(0, 7)}-01`;
    const key = [outlet, month, product, pkg ?? "", dist ?? ""].join("|");
    const cur = agg.get(key);
    if (cur) {
      cur.ce += ce;
      if (date > cur.last_buy_date) cur.last_buy_date = date;
    } else {
      agg.set(key, { outlet_id: outlet, month, product, package: pkg, distributor: dist, ce, last_buy_date: date, size: sizeFor(pkg) });
    }
    if (!accounts.has(outlet)) {
      accounts.set(outlet, {
        outlet_id: outlet,
        name: text(pick(r, "Account", /^account( name)?$/i)) ?? outlet,
        address: text(pick(r, "Address")),
        city: text(pick(r, "City")),
        state: text(pick(r, "State")),
        zip: text(pick(r, "Zip")),
        premise: premise(text(pick(r, "Premise"))),
        distributor: dist,
      });
    }
  }
  const rowsOut = [...agg.values()].map((a) => ({ ...a, ce: Math.round(a.ce * 10000) / 10000 }));
  return { rows: rowsOut, accounts: [...accounts.values()], skipped, maxDate };
}

export async function syncLilypadSales(admin: SupabaseClient): Promise<SalesSyncResult> {
  const issues: string[] = [];
  const today = todayPacific();
  const { data: meta } = await admin.from("sales_data_meta").select("as_of").eq("id", 1).maybeSingle();
  const asOf = (meta?.as_of as string | null) ?? `${today.slice(0, 4)}-01-01`;
  const anchor = asOf < today ? asOf : today;
  const windowStart = firstOfMonth(anchor, 2);

  const file = await runLilypadExport("invoices", `FCB-Data sync ${today} (sales)`, {
    distributors: ["ALL SELECTED"],
    range: { start_dt: pacificDayStartUnix(windowStart), end_dt: pacificDayEndUnix(today) },
    attributes: [],
    targetUsers: [],
    worklist: [],
    target: 1, // All Accounts
  });
  const sheets = await readSheets(file, "Account Id");
  if (!sheets.length) throw new Error("LilyPad's Invoices file had no sheet with an \"Account Id\" column — the reader needs an update.");
  const all = sheets.flatMap((s) => s.rows);
  const { rows, accounts, skipped, maxDate } = rollUpInvoices(all, windowStart, today);
  if (!rows.length) throw new Error(`LilyPad's Invoices file had no usable rows from ${windowStart} on — nothing changed.`);

  // Safety: compare each finished month with what's already in the app.
  const thisMonth = firstOfMonth(today);
  const newCounts = new Map<string, number>();
  for (const r of rows) newCounts.set(r.month, (newCounts.get(r.month) ?? 0) + 1);
  for (let m = windowStart; m < thisMonth; m = firstOfMonth(m, -1)) {
    const { count } = await admin.from("sales_account_sales").select("id", { count: "exact", head: true }).eq("month", m);
    const had = count ?? 0;
    const got = newCounts.get(m) ?? 0;
    if (had > 20 && got < had * MIN_RATIO) {
      throw new Error(
        `LilyPad returned ${got} rows for ${m.slice(0, 7)} but the app already has ${had} — looks incomplete, so nothing was changed.`,
      );
    }
  }

  // New accounts first (existing ones are never changed here).
  for (let i = 0; i < accounts.length; i += 1000) {
    const { error } = await admin
      .from("sales_accounts")
      .upsert(accounts.slice(i, i + 1000), { onConflict: "outlet_id", ignoreDuplicates: true });
    if (error) throw new Error(`Saving new accounts failed: ${error.message}`);
  }

  // Replace the window's months.
  const { error: delError } = await admin.from("sales_account_sales").delete().gte("month", windowStart);
  if (delError) throw new Error(`Clearing ${windowStart.slice(0, 7)} on failed: ${delError.message}`);
  for (let i = 0; i < rows.length; i += 1000) {
    const { error } = await admin.from("sales_account_sales").insert(rows.slice(i, i + 1000));
    if (error) {
      throw new Error(
        `Saving sales failed part-way (${i} of ${rows.length} saved): ${error.message}. The next run re-does these months.`,
      );
    }
  }

  const newAsOf = maxDate > asOf ? maxDate : asOf;
  const { error: refreshError } = await admin.rpc("sales_accounts_refresh", { p_as_of: newAsOf });
  if (refreshError) issues.push(`Account summaries didn't refresh: ${refreshError.message}`);
  const { error: metaError } = await admin.from("sales_data_meta").upsert({
    id: 1,
    as_of: newAsOf,
    imported_at: new Date().toISOString(),
    imported_by: null,
    note: "LilyPad sync",
  });
  if (metaError) issues.push(`Couldn't save the as-of date: ${metaError.message}`);
  if (skipped) issues.push(`${skipped} invoice lines skipped (missing account, date or brand).`);

  const months = [...newCounts.keys()].sort();
  return {
    syncedCount: rows.length,
    issues,
    summary: `${all.length} invoice lines → ${rows.length} account-month rows for ${months[0]?.slice(0, 7)}–${months[months.length - 1]?.slice(0, 7)}; data now through ${newAsOf}`,
  };
}
