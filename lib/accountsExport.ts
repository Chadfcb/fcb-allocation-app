// Sales > Accounts > Overview — "Export report" (added 2026-10-19, per Chad:
// "export whatever data we have filtered to"). Builds an .xlsx of EVERY
// account the current filters + search match (all pages, in the current
// sort order) right in the browser and downloads it. Plain values only, so
// it opens cleanly in Google Sheets.
//
// exceljs is loaded only when someone clicks the button, so the page itself
// doesn't get heavier.

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
  opts: { filterLine: string; asOf: string | null; fileName: string },
): Promise<void> {
  // The browser build of exceljs is a plain bundle — depending on the bundler
  // it arrives as the default export or as the module itself.
  const mod = await import("exceljs");
  const ExcelJS = ((mod as unknown as { default?: typeof mod }).default ?? mod) as typeof mod;
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("Accounts", { views: [{ state: "frozen", ySplit: 2 }] });

  ws.columns = COLUMNS.map((c) => ({ width: c.width }));
  ws.addRow([
    `${opts.filterLine} · ${accounts.length.toLocaleString("en-US")} ${accounts.length === 1 ? "account" : "accounts"} · data as of ${opts.asOf ?? "—"}`,
  ]);
  ws.getRow(1).font = { italic: true, color: { argb: "FF666666" } };
  const header = ws.addRow(COLUMNS.map((c) => c.header));
  header.font = { bold: true };
  for (const a of accounts) ws.addRow(COLUMNS.map((c) => c.get(a)));
  COLUMNS.forEach((c, i) => {
    const col = ws.getColumn(i + 1);
    if (c.header === "Last buy" || c.header === "Last check-in") col.numFmt = "m/d/yyyy";
    if (c.header.endsWith("CE")) col.numFmt = "#,##0.0";
  });

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
