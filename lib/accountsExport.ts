// Sales > Accounts > Overview — "Export report" (added 2026-10-19, per Chad:
// "export whatever data we have filtered to"). Builds an .xlsx of EVERY
// account the current filters + search match (all pages, in the current
// sort order) right in the browser and downloads it. Plain values only, so
// it opens cleanly in Google Sheets.
//
// exceljs is loaded only when someone clicks the button, so the page itself
// doesn't get heavier.
//
// 2026-10-20, per Chad ("it's not showing the sales information on the
// account, what they bought and when — we need that info on the export"):
// a second sheet, "What they bought" — one row per account × month × item
// (from sales_account_sales), newest month first — plus an "Items bought
// (all time)" column on the Accounts sheet. "Last order that month" = the
// exact date when it's on record (all of 2026 from LilyPad, some VIP months);
// blank when only a monthly total exists (VIP saved the 1st as a stand-in).

export interface ExportAccount {
  outlet_id: string;
  name: string;
  address: string | null;
  city: string | null;
  zip: string | null;
  phone: string | null;
  distributor: string | null;
  rep: string | null;
  stage: string; // label, e.g. "Potential lost"
  big: boolean;
  last_buy_date: string | null;
  daysDark: number | null;
  ce_12mo: number;
  lifetime_ce: number;
  premise: string | null;
  owner: string; // label
  tier: string | null;
  handled: string | null; // label
  tags: string[];
  lastCheckin: string | null;
}

import type { createClient } from "@/lib/supabase/client";

// One row of sales history (a month of one item at one account).
export interface PurchaseRow {
  outlet_id: string;
  month: string; // first of the month, YYYY-MM-DD
  product: string;
  size: string | null;
  distributor: string | null;
  ce: number;
  last_order: string | null; // exact last order date that month, when known
}

type Supa = ReturnType<typeof createClient>;

/** Every saved sale for these accounts (all months), read in pages. */
export async function fetchPurchases(supabase: Supa, outletIds: string[]): Promise<PurchaseRow[]> {
  const out: PurchaseRow[] = [];
  const PAGE = 1000;
  for (let i = 0; i < outletIds.length; i += 150) {
    const ids = outletIds.slice(i, i + 150);
    for (let from = 0; ; from += PAGE) {
      const { data, error } = await supabase
        .from("sales_account_sales")
        .select("id,outlet_id,month,product,size,package,distributor,ce,last_buy_date,first_buy_in_month")
        .in("outlet_id", ids)
        .order("id", { ascending: true })
        .range(from, from + PAGE - 1);
      if (error) throw new Error(`Couldn't read the sales history: ${error.message}`);
      const rows = (data ?? []) as {
        outlet_id: string;
        month: string;
        product: string;
        size: string | null;
        package: string | null;
        distributor: string | null;
        ce: number | string;
        last_buy_date: string | null;
        first_buy_in_month: string | null;
      }[];
      for (const r of rows) {
        const ce = Number(r.ce) || 0;
        if (ce <= 0) continue;
        const month = r.month.slice(0, 10);
        const last = r.last_buy_date ? r.last_buy_date.slice(0, 10) : null;
        // VIP months saved the first of the month as a stand-in date — that's
        // not a real order date, so leave it blank.
        const real = last && !(last === month && !r.first_buy_in_month) ? last : null;
        out.push({ outlet_id: r.outlet_id, month, product: r.product, size: r.size ?? r.package, distributor: r.distributor, ce, last_order: real });
      }
      if (rows.length < PAGE) break;
    }
  }
  return out;
}

const COLUMNS: { header: string; width: number; get: (a: ExportAccount) => string | number | Date | null }[] = [
  { header: "Account", width: 34, get: (a) => a.name },
  { header: "Outlet ID", width: 12, get: (a) => a.outlet_id },
  { header: "Address", width: 30, get: (a) => a.address },
  { header: "City", width: 16, get: (a) => a.city },
  { header: "Zip", width: 10, get: (a) => a.zip },
  { header: "Phone", width: 14, get: (a) => a.phone },
  { header: "Distributor", width: 14, get: (a) => a.distributor },
  { header: "Rep", width: 10, get: (a) => a.rep },
  { header: "Stage", width: 14, get: (a) => a.stage },
  { header: "Lost big", width: 9, get: (a) => (a.big ? "Yes" : "") },
  { header: "Last buy", width: 11, get: (a) => toDate(a.last_buy_date) },
  { header: "Days dark", width: 10, get: (a) => a.daysDark },
  { header: "Last 12 mo CE", width: 13, get: (a) => (a.last_buy_date ? round1(a.ce_12mo) : null) },
  { header: "Lifetime CE", width: 12, get: (a) => (a.last_buy_date ? round1(a.lifetime_ce) : null) },
  { header: "Premise", width: 9, get: (a) => a.premise },
  { header: "Owner", width: 18, get: (a) => a.owner },
  { header: "Tier", width: 6, get: (a) => a.tier },
  { header: "Handled by", width: 15, get: (a) => a.handled },
  { header: "Tags", width: 20, get: (a) => a.tags.join(", ") || null },
  { header: "Last check-in", width: 13, get: (a) => toDate(a.lastCheckin) },
];

function toDate(s: string | null): Date | null {
  if (!s) return null;
  const d = new Date(`${s.slice(0, 10)}T00:00:00Z`);
  return Number.isNaN(d.getTime()) ? null : d;
}
const round1 = (n: number) => Math.round(n * 10) / 10;

/** "Accounts - Matagrano - Lost - 2026-10-19.xlsx" (characters Windows won't allow are removed). */
export function exportFileName(filterParts: string[], today: string): string {
  const name = ["Accounts", ...filterParts, today].join(" - ").replace(/[\\/:*?"<>|]+/g, " ").replace(/\s+/g, " ").trim();
  return `${name}.xlsx`;
}

export async function downloadAccountsXlsx(
  accounts: ExportAccount[],
  opts: { filterLine: string; asOf: string | null; fileName: string; purchases: PurchaseRow[] },
): Promise<void> {
  // The browser build of exceljs is a plain bundle — depending on the bundler
  // it arrives as the default export or as the module itself.
  const mod = await import("exceljs");
  const ExcelJS = ((mod as unknown as { default?: typeof mod }).default ?? mod) as typeof mod;
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("Accounts", { views: [{ state: "frozen", ySplit: 2 }] });

  // "Items bought (all time)" per account, biggest first.
  const itemsBy = new Map<string, Map<string, number>>();
  for (const p of opts.purchases) {
    const label = p.size ? `${p.product} ${p.size}` : p.product;
    if (!itemsBy.has(p.outlet_id)) itemsBy.set(p.outlet_id, new Map());
    const m = itemsBy.get(p.outlet_id)!;
    m.set(label, (m.get(label) ?? 0) + p.ce);
  }
  const itemsFor = (id: string) =>
    [...(itemsBy.get(id) ?? new Map<string, number>()).entries()]
      .sort((a, b) => b[1] - a[1])
      .map(([k]) => k)
      .join(", ") || null;
  const cols = [...COLUMNS];
  cols.splice(COLUMNS.findIndex((c) => c.header === "Lifetime CE") + 1, 0, { header: "Items bought (all time)", width: 50, get: (a) => itemsFor(a.outlet_id) });

  ws.columns = cols.map((c) => ({ width: c.width }));
  ws.addRow([
    `${opts.filterLine} · ${accounts.length.toLocaleString("en-US")} ${accounts.length === 1 ? "account" : "accounts"} · data as of ${opts.asOf ?? "—"}`,
  ]);
  ws.getRow(1).font = { italic: true, color: { argb: "FF666666" } };
  const header = ws.addRow(cols.map((c) => c.header));
  header.font = { bold: true };
  for (const a of accounts) ws.addRow(cols.map((c) => c.get(a)));
  cols.forEach((c, i) => {
    const col = ws.getColumn(i + 1);
    if (c.header === "Last buy" || c.header === "Last check-in") col.numFmt = "m/d/yyyy";
    if (c.header.endsWith("CE")) col.numFmt = "#,##0.0";
  });

  // Sheet 2: what they bought and when.
  const name = new Map(accounts.map((a) => [a.outlet_id, a.name]));
  const order = new Map(accounts.map((a, i) => [a.outlet_id, i])); // same order as the Accounts sheet
  const hist = [...opts.purchases].sort(
    (a, b) =>
      (order.get(a.outlet_id) ?? 0) - (order.get(b.outlet_id) ?? 0) || b.month.localeCompare(a.month) || b.ce - a.ce || a.product.localeCompare(b.product),
  );
  const ws2 = wb.addWorksheet("What they bought", { views: [{ state: "frozen", ySplit: 2 }] });
  ws2.columns = [{ width: 34 }, { width: 12 }, { width: 14 }, { width: 11 }, { width: 32 }, { width: 12 }, { width: 11 }, { width: 14 }];
  ws2.addRow([
    `${opts.filterLine} · every month each account bought, newest first · "Last order that month" is blank when only a monthly total is on record (most VIP history before 2026)`,
  ]);
  ws2.getRow(1).font = { italic: true, color: { argb: "FF666666" } };
  ws2.addRow(["Account", "Outlet ID", "Distributor", "Month", "Item", "Size", "Cases (CE)", "Last order that month"]).font = { bold: true };
  for (const p of hist) {
    ws2.addRow([name.get(p.outlet_id) ?? p.outlet_id, p.outlet_id, p.distributor, toDate(p.month), p.product, p.size, round1(p.ce), toDate(p.last_order)]);
  }
  if (!hist.length) ws2.addRow(["No sales on record for these accounts."]);
  ws2.getColumn(4).numFmt = "mmm yyyy";
  ws2.getColumn(7).numFmt = "#,##0.0";
  ws2.getColumn(8).numFmt = "m/d/yyyy";
  ws2.autoFilter = { from: { row: 2, column: 1 }, to: { row: 2, column: 8 } };

  const buf = await wb.xlsx.writeBuffer();
  const blob = new Blob([buf], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = opts.fileName;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
