"use client";

// Finance > Cash Flow Dashboard — placeholder shell.
//
// This is intentionally just the section landing here for now, per Chad:
// get Finance > Cash Flow Dashboard built as a real, access-gated page
// first, then wire in the actual numbers as a follow-up. The planned data
// flow (Planned Batch Expenses + Vendor PO Spend on the expense side,
// Realized Revenue — Delivered orders' Order Value — on the revenue side,
// rolled into a weekly net + 13-week/12-month timing view) is worked out
// in the flowchart artifact from that planning conversation; this
// component is where that gets built once the data plumbing (starting
// with a Brew Planner) exists.

export default function CashflowDashboardPageClient() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-lg font-semibold text-neutral-100">Cash Flow Dashboard</h1>
        <p className="text-sm text-neutral-400">
          Weekly revenue, expenses, and running cash position — the web-app version of the
          Batch to Cash spreadsheet&apos;s Dashboard tab.
        </p>
      </div>

      <div className="rounded-lg border border-dashed border-neutral-700 bg-neutral-950 p-8 text-center">
        <p className="text-sm font-medium text-neutral-200">Not connected yet</p>
        <p className="mx-auto mt-2 max-w-md text-sm text-neutral-500">
          This page exists and is access-controlled, but it isn&apos;t pulling real numbers yet.
          Next up: wiring in Realized Revenue (Delivered orders), Vendor PO Spend, and Planned
          Batch Expenses once the Brew Planner is built.
        </p>
      </div>
    </div>
  );
}
