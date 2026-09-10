# FCB-Data — Project Status

This is a running summary of what's been built so far, for Chad (Operations
Manager, Full Circle Brewing / FCB Brands) to hand to a fresh Claude
conversation when the current one gets too long. Paste or attach this file
and say what you want to work on next — no need to re-explain the app from
scratch.

## Note on this doc's reliability (added 2026-09-03)

This doc is the actual fix for a recurring problem: conversation-level
memory (whether lost to compaction or just to a long thread) is NOT
reliable, no matter what a session claims about "remembering everything."
This file lives in the Project's own storage, not in any one conversation,
so it survives regardless of what happens to the chat. **The standing
practice going forward: update this file at the end of any session that
built or changed something real, the same way you'd deliver a code file —
don't wait for it to become stale again.** A session is not to skip this
step because a request "seems small."

A few sections below (Team Access, Projects, Build Orders / Events
Calendar / POS Labels) were added 2026-09-03 from a session that recovered
this context after it had been dropped from a conversation, rather than
from a full page-by-page review — flagged inline where something is
confirmed vs. still unverified.

## What this app is

A Next.js + Supabase web app that replaces Chad's old spreadsheet for
running FCB's weekly distributor beer allocation process, and is also
folding in the old FCB Pricing desktop app (Sales section) and Ekos data
(Operations > Purchase Orders) over time. As of 2026-09-09, it also has a
**Finance** section — see "Finance / Cash Flow Dashboard" and "Finance /
Distributor Data" below — rebuilt/added this same day to match the *actual*
layout of Chad's "Batch to Cash" spreadsheet's Dashboard tab (grids, not
summary cards), and gated by a new **Administrator / Manager / Employee**
permission tiering (see "Team Access" below) rather than the old flat
admin/basic split.

## Tech stack & conventions

- **Next.js 16** (App Router, "use client" components), **Tailwind CSS v4**,
  permanent dark theme (near-black background, neutral-900/950 panels).
- **Supabase**: Postgres + Auth + Row Level Security (RLS). `auth.uid()`
  drives all access policies.
- **Roles/tiers**: every signed-in user has a `profiles` row with `role` =
  `admin` or `basic`, plus (added 2026-09-09) `is_super_admin boolean`.
  Viewed together these make three tiers: **Administrator**
  (`role='admin'`, `is_super_admin=true` — today only Chad and Art; full
  access to everything, always, including Finance), **Manager**
  (`role='admin'`, `is_super_admin=false` — everyone else who's an admin
  today; has everything an Administrator has EXCEPT Finance's Cash Flow
  Dashboard and Distributor Data, unless an Administrator separately grants
  them), and **Employee** (`role='basic'` — unchanged, per-section granted
  access). The very first person to ever sign in still automatically
  becomes an admin (via a database trigger, `is_super_admin` defaults false
  — i.e. a Manager, not an Administrator); Chad/Art's rows were manually
  flipped to `is_super_admin=true` in the migration. Only an Administrator
  can change anyone's tier or grant/revoke Finance access — enforced in the
  database (a `profiles` trigger blocks the column change, and a
  `user_section_access` RLS policy blocks these rows), not just hidden in
  the UI. See `lib/permissions.ts`'s `ADMIN_RESTRICTED_SECTIONS` (today
  `cashflow_dashboard` and, added 2026-09-09, `distributor_data`) and
  `sql/is_super_admin.sql`.
- **Nav**: a left sidebar (`components/Sidebar.tsx`), not a top bar. Admins
  see "Dashboard" (standalone), then "Ernie AI", then "Tasks", then a
  **Finance** category (added 2026-09-09 — Cash Flow Dashboard and, also
  added 2026-09-09, Distributor Data; hidden from a Manager unless
  separately granted), then two more collapsible categories —
  **Operations** (Open Purchase Orders, Inventory & Allocation, Distributor
  Pricing, Distributor Inventory, Weeks, Audit Log) and **Sales** (Price
  List, Margin Analysis, Cost Per Case, Contribution Margin) — then
  POS/Calendar sections, then "Users" (standalone). Basic/Employee users
  see whichever individual sections/groups they've been granted. Category
  expand/collapse state persists per-browser via localStorage; the whole
  sidebar can also be hidden (not persisted, always starts visible on a
  fresh load).
- **Soft delete, with one deliberate exception**: nothing else is ever
  hard-deleted (would break foreign keys and history) — records get an
  `active = false` flag instead. The one exception, added 2026-09-09 per
  Chad's explicit request: a vendor Purchase Order sitting in "Holding" can
  be permanently, irreversibly deleted from the Open Purchase Orders page
  (real `DELETE`, confirmed via a browser confirm prompt, no undo) — see
  the Purchase Orders section below.
- **sort_order**: products and section dividers share a `double precision`
  "lexo-rank" sort order, so anything can be dragged/inserted between any
  two existing items without renumbering everything else.
- **Deployment**: Chad's project lives at
  `C:\Users\C Lizzel\OneDrive\Desktop\FCB-Allocations\fcb-allocation-app`
  on his machine. **Clarified 2026-09-03, to head off a real point of
  confusion:** `fcb-allocation-app` is ONLY the legacy name of the local
  folder on Chad's disk — a holdover from before the app expanded beyond
  just allocations. It is NOT a separate, old, or abandoned project. The
  live app deployed from that same folder is the current, actively-worked
  Vercel project named **`fcb-data`**, serving **FCB-Data.com** — same
  codebase, same git repo, same everything; just don't assume "the
  fcb-allocation-app folder" means something stale just because the name
  sounds dated. Every code delivery is a file (or zip of files) that
  overwrites the matching path in that folder, followed by:
  ```
  cd "C:\Users\C Lizzel\OneDrive\Desktop\FCB-Allocations\fcb-allocation-app"
  git add .
  git commit -m "..."
  git push
  ```
  Database changes ship as a separate idempotent `.sql` file, run first in
  Supabase's SQL Editor, before the code is deployed. The project keeps two
  separate sql locations: `supabase/` holds the full baseline
  (`schema.sql`, `functions.sql`, `seed.sql`); a newer top-level `sql/`
  folder (started 2026-08-31) holds one file per incremental
  feature-specific migration going forward — either is fine to write a new
  migration into, but `sql/` is the more recent convention.
- **Hosting**: deployed on **Vercel**, auto-building on every `git push` to
  `main`. Custom domain **FCB-Data.com** is live (purchased directly through
  Vercel for ~$11/year, both apex and `www` covered by Vercel-generated SSL
  certs).

## Pages & features built so far

**Finance > Cash Flow Dashboard (rebuilt to match the real spreadsheet
layout, 2026-09-09; Revenue In timing and Expenses Out paid/pending
handling both reworked further, same day).** New top-level sidebar
category, **Finance**, sits directly above Operations. Its first page,
`/finance/cashflow-dashboard`, is gated by the `cashflow_dashboard` section
key — one of two entries on **`ADMIN_RESTRICTED_SECTIONS`** (see Team
Access below): being an admin no longer automatically grants this page —
only an Administrator (Chad or Art) always has it; a Manager needs it
separately granted from Users > Edit, same as an Employee would. **Now live
via Supabase Realtime** (added 2026-09-09) — this page used to load once
and never update again while you were looking at it, unlike the rest of
the app; it now reloads automatically on any change to weeks, distributors,
distributor POs, allocations, distributor prices, or purchase orders.

- **Backstory, corrected 2026-09-09**: an earlier pass this same day built
  a "summary cards" version (Realized Revenue / Vendor PO Spend / Net
  Position) and synced it with real data before Chad had asked for that —
  it also didn't match his mental model of the actual spreadsheet, because
  that pass was working from an old, compaction-thinned summary of the
  spreadsheet rather than the file itself. Chad re-uploaded the actual
  spreadsheet (`Batch to Cash 5_27 4.xlsx`) and its Dashboard tab was
  transcribed cell-by-cell (every row, every column, every formula check)
  directly into a new project doc, **`claude/batch-to-cash-dashboard-layout.md`**
  — durable ground truth so this doesn't get lost to compaction again. Zero
  formulas exist anywhere on that sheet; only one cell (Guardian, Wk 34 =
  $4,748.91) was ever actually populated, since Chad's team stopped using
  the spreadsheet months ago.
- **The real shape is a grid, not summary cards** — distributors (or
  vendors) as rows, weeks/columns as columns — and that's what got rebuilt
  in `components/CashflowDashboardPageClient.tsx`, populated with real
  web-app data (not spreadsheet data):
  - **Column range**, per Chad 2026-09-09: built like the spreadsheet — the
    current week (the most recent real week on file, highlighted with a
    ★), the previous 3 real weeks before it, then extended forward with
    placeholder weeks out to 18 months (no real Revenue data existed for
    those originally — since the Delivery-Date-+-Terms rework below,
    Revenue can now land there too, same as Expenses always could).
  - **Revenue In** — one row per distributor, one column per week; each
    cell is that distributor's Order Value for the delivered order(s) that
    land in that column (same quantity × distributor-price math as the
    Inventory & Allocation page). Reworked 2026-09-09, per Chad ("why not
    add in the delivery date, that a distributor's terms are tied to..."):
    still only counts once an order is marked Delivered (Approved alone
    still doesn't count), but WHICH column it lands in is no longer that
    order's own week — it's that order's **Delivery Date** (captured on the
    Inventory & Allocations page the instant a distributor's status flips
    to Delivered — see Inventory & Allocation below — editable/backdatable
    after) plus that distributor's **payment Terms in days** (0 = due on
    delivery/COD, 30 = net-30, etc. — see Finance > Distributor Data
    below), bucketed the same way Expenses Out buckets a PO. A Total
    Revenue footer row sums the grid per column.
  - **Expenses Out** — one row per vendor, one column per week. Reworked
    2026-09-09 (used to be po_date for every PO regardless of paid/
    pending): a **Paid** PO lands in whichever column its **Paid Date**
    falls in (the date it was actually marked Paid on the Open Purchase
    Orders page); a **Pending** PO lands in its PO Date's column —
    UNLESS that column has already passed, in which case it automatically
    rolls forward into the CURRENT real-world column instead (computed
    live off today's actual date every time the page loads/reloads;
    nothing manual, and completely independent of the "Start New Week"
    button). Every dollar figure carries a small color dot matching the
    Open Purchase Orders page's own Paid (green) / Pending (orange)
    colors; a vendor/column cell with both splits into two stacked
    amounts instead of one combined total. A Total Expenses footer row
    sums per column (same paid/pending split).
  - **Net Cash Flow** (Revenue − (Paid + Pending Expenses), per column) and
    **Running Total** (a real cumulative sum across every column in order,
    including placeholder columns, since a rolled-forward pending expense
    — or now, a delivery-date-plus-terms revenue figure — can legitimately
    land in one).
  - **Cash Flow Timing Summary** — per Chad and Art (Chad's boss, who wants
    an 18-month cash-flow projection, not the spreadsheet's 13-week view):
    kept as a weekly-rows table (Week Start / Cash In / Cumulative In /
    Cash Out / Cumulative Out / Net Cash), rows run a full **18 months
    (~78 weeks)**. This section is still an **explicit placeholder** —
    real computed future week-start dates, but every dollar column renders
    "—" with an amber "Not linked to data yet" callout — until Chad asks
    for the projection math to be wired in.
  - Verified with a clean `tsc --noEmit` pass in a disposable cloud sandbox
    before each delivery; committed straight into Chad's project folder.
- **Chad's own framing of where this is going**: "we are basically building
  a brewery business simulator for the cashflow side of things" — i.e. this
  section is expected to keep growing well past a simple dashboard.
- Someone granted ONLY Finance (no Operations/Purchase Orders grant at
  all) can still see real numbers here — additive, read-only RLS policies
  (`allocations_select_cashflow`, `distributor_pos_select_cashflow`,
  `purchase_orders_select_cashflow` in `sql/is_super_admin.sql`) grant read
  access to the underlying tables via `has_section(..., 'cashflow_dashboard')`
  as an alternative to the existing `inventory_allocation`/`purchase_orders`
  gates, additive only (nothing existing was narrowed).
- **Ernie AI's `get_cashflow_dashboard` tool (`lib/ernie/tools.ts`) has NOT
  been updated to match this rebuild (or the 2026-09-09 timing reworks)
  yet** — it still mirrors the old summary-card computation by hand.
  Whether/how to bring it in line with the new grid-based page is an open
  question for Chad, not yet asked or approved — per his standing "ask
  permission before doing any work" rule, this should be raised as a
  question rather than done unilaterally.
- **Still not built**: the Brew Planner (so Planned Batch Expenses can show
  up for batches that haven't brewed yet), and wiring real projected data
  into the 18-month Cash Flow Timing Summary placeholder. Next steps, in
  no fixed order: (1) ask Chad what should drive the Timing Summary's
  Cash In / Cash Out projections, (2) build the Brew Planner, (3) extend
  the existing Margin Analysis cost math + Packaging Inventory
  bill-of-materials logic to accept a planned batch from it, (4) fold both
  into the dashboard in place of today's placeholders.

**Finance > Distributor Data** (`/finance/distributor-data`, new
2026-09-09) — per Chad ("their terms need to live in the financing
section... lets make a new sub category called Distributor Data, that
holds that information, and other data if we need a place to put it"). One
row per **Core** distributor, currently just an editable **Terms (days)**
field (`distributors.payment_terms_days` — 0 = due on delivery/COD, 30 =
net-30, etc.) that feeds the Cash Flow Dashboard's Revenue In timing (see
above). Gated by the `distributor_data` section key, the second entry on
`ADMIN_RESTRICTED_SECTIONS` (same restriction pattern as Cash Flow
Dashboard — a Manager needs it separately granted). Live via Supabase
Realtime, same as the rest of the app. Explicitly built as a home for
"other distributor-level finance data" too, not just Terms — expect more
fields to land here over time rather than a new sub-page per field.

- **Which distributors show up here, corrected same day**: first built
  filtering by `active` (the Inventory grid's weekly on/off toggle), which
  was wrong two different ways in a row — filtering TO `active` hid real
  distributors toggled off for the week (Coast, Valleywide); removing the
  filter entirely brought back rows that should never show up here at
  all — a one-off/direct-customer entry (Sjsu), a dropped distributor
  (Saccani), and a duplicate-order row against the same distributor
  ("Matagrano 2", see `track_inventory` under Database tables below). The
  actual fix: a new, independent **`distributors.is_core_distributor`**
  flag (see `sql/distributors_core_flag.sql`) that only ever changes by
  hand, via a **"Core" checkbox** next to each distributor's name in
  Inventory & Allocation's Edit Distributors mode (see that page below).
  Distributor Data now reads off `is_core_distributor` only, completely
  independent of the weekly active toggle. Chad's named, current core
  roster (2026-09-09): **Matagrano, Markstein, Valley Wide, Coast,
  Guardian, Mussetter, Superior** — auto-flagged by the migration via
  exact (trimmed, case-insensitive) name match; any that didn't match
  (e.g. a spelling variant on file) needs its "Core" box checked by hand
  once.
- **Terms backfilled from the "Batch to Cash" spreadsheet, 2026-09-09**:
  Chad pointed to that workbook's own `Distributor_Terms` tab, which had
  most of the real numbers already sitting in it. `sql/distributor_terms_backfill.sql`
  set: Coast = 1 day, Guardian = 30, Markstein = 15, Matagrano = 15,
  Superior = 15, Valleywide = 15 (matched on exact name, same safe
  pattern as the Core flag migration — can't accidentally catch
  "Matagrano 2"). **Mussetter was NOT on that tab at all** — still needs
  Chad to fill that one in by hand on Finance > Distributor Data once he
  has the number. Saccani was also on the sheet (15 days) but is
  intentionally left alone — it's a dropped distributor, not part of the
  Core roster.

**Finance > 13 Week Cashflow — IN PROGRESS, not yet built (started
2026-09-09).** Chad asked for a second Finance sub-page, right under Cash
Flow Dashboard, pulling automatically from a *different* Google Sheet
(not the "Batch to Cash" workbook) — this URL:
`https://docs.google.com/spreadsheets/d/1A4P_VCrz7bc2k1mUSVeCHh-0qYHL5xeFkR00WcCUkus/edit`
— specifically its **"2026" tab** only. Confirmed via a fetch attempt
that the sheet is private (401), not publicly viewable. Chad chose the
**secure route** over making it link-viewable: a Google Cloud service
account with read-only access, rather than opening the sheet to "anyone
with the link."

**Blocked on Chad completing two things** before this can be built:
1. Google Cloud setup (service account + Sheets API enabled + the sheet
   shared with that service account's `client_email` as Viewer) — full
   step-by-step instructions were given to Chad in-conversation; he's
   doing this on his own Google account, not something Claude can do for
   him.
2. Three new Vercel environment variables (`GOOGLE_SHEETS_CLIENT_EMAIL`,
   `GOOGLE_SHEETS_PRIVATE_KEY`, `GOOGLE_SHEETS_SPREADSHEET_ID`) — Chad
   was told to set these directly in Vercel himself rather than paste the
   private key into chat, since it's a long-lived credential.
3. Chad also still needs to share the actual **layout** of the "2026" tab
   (screenshot, export, or temporary re-share) — same cell-by-cell
   transcription approach used for the Cash Flow Dashboard rebuild (see
   `claude/batch-to-cash-dashboard-layout.md`) — before the page's columns/
   rows can be designed. Not yet received.

**Planned architecture once unblocked** (not yet built, subject to
change once the actual tab layout is seen): a Vercel Cron job hits a new
API route that authenticates as the service account, pulls the "2026"
tab via the Google Sheets API, and upserts into a new Supabase table;
the new page reads that table live via Supabase Realtime, matching the
rest of the app's convention, rather than calling the Google API
directly on every page load. Default refresh cadence proposed: hourly
(Chad hasn't confirmed or asked for something different yet).

**Inventory & Allocation** (`/inventory`) — the main, everyday page.
Visible to both Admin and Basic users. All of it is
**live via Supabase Realtime** — edits from one signed-in user (quantities,
allocations, PO numbers/status/delivery date, distributor/product/divider
add-remove-rename-reorder, packaging & label counts including custom items)
appear for everyone else viewing the page within about a second, no reload
needed.

- A big scrollable grid: products (grouped by brand with labeled divider
  rows, in a fixed display order) × distributors, with sticky column
  headers and a sticky "Product" column.
- Per product, per week: On Hand / Unlabeled / To Package / Total columns,
  a Remaining column (Total minus everything allocated across all
  distributors), and a colored status flag per cell (see below).
- Per distributor, per product: an allocation quantity cell.
- A unified **Edit** menu (admin-only) toggles one edit mode at a time —
  Distributors / Items / Dividers / Packaging / Labels — and each mode's
  move/rename/remove controls appear **inline** in place (yellow
  highlighting on whichever mode is active), not in a separate panel or
  box:
  - Items/Dividers: inline in each row, matching the original pattern.
  - Distributors: inline in the table's column header per distributor —
    ◀▶ reorder arrows, name text input, a small color-swatch dropdown, a
    **"Core" checkbox** (added 2026-09-09 — `distributors.is_core_distributor`;
    marks this as one of FCB's real, ongoing distributors, independent of
    the weekly active toggle; drives who shows up on Finance > Distributor
    Data, see above), and a ✕ remove button, all next to that
    distributor's name. "+ Add Distributor" is a compact inline form that
    reuses the row of previously-blank header cells above the Order Value
    row (not a new table column). Adding back a previously-removed
    distributor reactivates its old (soft-deleted) row instead of
    erroring on a name collision.
  - **Per-distributor lock ("focus mode"), added 2026-09-08, opened up to
    everyone 2026-09-09**: a small 🔒/🔓 button sits right next to each
    distributor's name in the column header. Originally admin-only to
    toggle (a non-admin only ever saw a static 🔒 once something was
    already locked) — per Chad, 2026-09-09 ("basics need the ability to
    lock and unlock if they have access to this section"), ANY user who
    can see the Inventory & Allocation page at all now gets the same
    toggle button admins do. Backed by `distributors.allocations_locked`.
    When ANY distributor is locked, every OTHER distributor's entire
    column (header, Order Value, PO #, PO Status, pallet summary, every
    per-product quantity cell and its color-swatch dropdown) is dimmed
    (`opacity-25`) and disabled for EVERYONE, including admins — the
    point is to make it visually unambiguous which one distributor the
    team should be editing right now, not to protect the locked one from
    edits. `anyDistributorLocked` / `isDistributorDimmed(d)` helpers in
    `app/(app)/inventory/page.tsx`. **Resolved 2026-09-09**: the column
    itself was confirmed live in Supabase (working fine for Chad), but
    the migration that originally added it was never actually found in
    this project's `sql/` folder or `supabase/schema.sql` — no record of
    it existed on file. `sql/inventory_lock_toggle_access.sql` re-declares
    the column (`add column if not exists`, a safe no-op) so there's now
    a real migration file for it, and adds the new
    `distributors_write_inventory_lock` RLS policy
    (`has_section(auth.uid(), 'inventory_allocation')`) needed for a
    non-admin's toggle click to actually save — without it, the database
    itself only ever allowed `role='admin'` to write to `distributors` at
    all, so opening up the UI alone wouldn't have been enough.
- **Packaging Inventory** panel (top left) — manual on-hand counts for 9
  shared packaging items (19.2oz/16oz/12oz Cans, 4-Pack/6-Pack Pakteks,
  12/16oz/19oz Trays, 202 LOE Ends lids, 1/6 bbl/1/2 bbl Kegs). These
  automatically deduct as allocations are entered below, based on each
  product's size (parsed from its name) and a fixed bill-of-materials
  recipe (see "Packaging recipe" below). Remaining is allowed to go
  negative — that's the "you need to order more" signal. Header reads
  "Packaging Inventory — Automatically adjusted as allocations are
  entered."
- **Label Inventory** panel (top right, same row) — same idea, but tracked
  per product (not per size) since every beer's label artwork is unique.
  Same "Automatically adjusted..." subtitle. Has an **Expand/Collapse**
  button (top right of the block) that toggles between the normal
  pinned-height scrollable view and a full auto-height view showing every
  row at once.
- **Order Value** row — per distributor, sum of (allocated qty × that
  distributor's own price for that product), pulled from the Distributor
  Pricing page (see below), plus a grand total.
- **PO # (Ekos)** row — a free-text box per distributor for that week's PO
  number in Ekos. Editable by anyone signed in.
- **PO Status** row — a dropdown per distributor: blank / **Pending**
  (orange) / **Approved** (green) / **Delivered** (blue). Always shows the
  actual word plus the color (never just a bare color swatch). Editable by
  admins only — enforced in the database via a trigger (RLS can't split
  write permissions by column within one row, so `po_status` changes from a
  non-admin are silently reverted while `po_number` stays editable by
  anyone on the same row).
- **Delivery Date row (new 2026-09-09)** — sits directly under PO Status. A
  date box per distributor, backed by `distributor_pos.delivery_date`.
  Auto-fills to today's date the instant a distributor's PO Status is
  flipped to Delivered (and clears if flipped away from Delivered), same
  as Purchase Orders' own Paid Date auto-fill; always editable/backdatable
  afterward. Admin-only to change — protected by the same database trigger
  as PO Status (`enforce_po_status_admin_only()`, extended 2026-09-09 to
  also cover this column). This is what feeds the Cash Flow Dashboard's
  Revenue In timing (Delivery Date + that distributor's Terms — see
  Finance > Distributor Data above).
- Both PO # and PO Status boxes are the same width and right-aligned so
  they line up cleanly under the distributor name and dollar total above.
- **Total Pallets row** — the "FULL CIRCLE BREWING" divider row (previously
  mostly blank space) now shows, per distributor column, how many physical
  pallets that distributor's *entire* order works out to (every product,
  every brand — not just the FCB divider group), right-aligned near the
  "Total" column. Kegs and cans are rounded up to whole pallets
  *separately* (different pallet types) then summed, since they can't
  physically share a pallet:
  - Kegs: 1/2 bbl = 1/8 of a pallet, 1/6 bbl (sixtel) = 1/20 of a pallet;
    the two sizes blend linearly on the same pallet.
  - Cans: 7 layers per pallet; a layer is 10 cases, except 19.2oz cans
    which stack 20 cases per layer; any can size/brand can blend on the
    same pallet by layer count.
  - Tap handles and unrecognized products are excluded entirely (same as
    elsewhere on this page).
  - Logic lives in `lib/pallets.ts` (`computePalletsForDistributor`),
    verified against 13 hand-derived test cases before shipping.
- The whole page scrolls normally (not boxed into fixed-height panels);
  sticky headers stay pinned to the top as you scroll.
- **Status flags** (colored dropdown per allocation/inventory cell):
  - On Hand (green) — have it, confirmed
  - Don't Have (red)
  - Have Some (orange)
  - Need to Package (magenta)
  - Need Pakteks (blue)
  - Need Labels (cyan)
  - Need Cans (gray)
  - Need Kegs (yellow)
- **Performance**: `load()` was rewritten (2026-09-08) from ~15 sequential
  Supabase queries into two `Promise.all` batches (independent queries
  fired together; only the second wave, which needs the current week's
  id, waits on the first) — noticeably faster page loads, same fix applied
  to Build Orders and Distributor Inventory (Purchase Orders didn't need
  it — only 3 queries in its load path).

**Operations > Open Purchase Orders** (`/purchase-orders`, admin-only, full
stop — sits just above Inventory & Allocation in the Operations nav) —
FCB's own *outgoing* vendor purchase orders (buying ingredients/supplies
from suppliers like MoreBeer, Briess Malt, etc.), synced in from Ekos.
Distinct from PO # (Ekos)/PO Status/Delivery Date above, which track a
*distributor's* PO to FCB for finished beer. Renamed from "Purchase
Orders" and given a full three-section lifecycle rework 2026-09-09, per
Chad wanting to see paid-vs-pending status reflected on the Cash Flow
Dashboard and wanting real control over stale/cancelled POs:

- **Paid Date** — a new column between Paid and Ordered. Auto-fills to
  today the moment a PO is marked Paid; clears if reverted to Pending;
  always editable/backdatable by an admin. This is what the Cash Flow
  Dashboard's Expenses Out grid buckets a Paid PO by (see Finance above).
- **Three sections, replacing the old flat table**:
  - **Open Purchase Orders** — the normal, currently-open list (Number,
    Supplier, PO Date, Expected Delivery Date, Total Cost, Paid/Paid Date,
    Status, Comments), same expandable-row line-items view as before.
  - **Holding** — a PO a fresh Ekos sync no longer reports as open lands
    here automatically (instead of being deleted, which is what used to
    happen). Total Cost and Paid Date stay editable here. From Holding, a
    PO can be either:
    - **moved to Completed** (editable Total Cost + Paid Date preserved
      there too), or
    - **permanently Deleted** — a real, hard `DELETE` (cascading to that
      PO's line items), confirmed via a browser `window.confirm` prompt,
      **no undo**. Explicit exception to the app's usual soft-delete-only
      convention, per Chad: "no i want to be able to delete it entirely.
      Some PO's we change our mind on in ekos and delete them entirely, so
      we need that ability in the web app."
  - **Completed Purchase Orders** — a PO explicitly marked done from
    Holding. If a later Ekos sync reports that same PO number as open
    again, it automatically moves back to Open.
  - Backed by a new `purchase_orders.record_status` column
    (`'open'`/`'holding'`/`'completed'`) — see
    `sql/purchase_orders_paid_date_and_lifecycle.sql`.
- **There's no live Ekos API** (confirmed by Chad calling Ekos — they don't
  issue API keys to individual customers), so data arrives via an on-demand
  sync: Chad (or a live Claude-in-Chrome session under his direction) reads
  the current "Open - Purchase Orders" list in Ekos (headers, comments, and
  each PO's line items), and posts it as JSON to
  `/api/purchase-orders/sync` via a "Sync from Ekos" box on the page itself
  — this mirrors manual entry through the site's own field rather than a
  raw database write from outside the app. A sync **moves** any
  currently-`'open'` PO no longer in Ekos's open list to Holding (rather
  than deleting it, per the rework above) and upserts everything Ekos
  currently reports as open (marking it `'open'`, by Ekos PO number).
  **Confirmed working end-to-end via multiple live syncs**, most recently a
  full re-sync on 2026-09-08.
- Live via Supabase Realtime, same as the rest of the app.
- Also has a **Dashboard card** ("Open Purchase Orders") — compact list of
  Number, Supplier, Total Cost, Expected Delivery, and Comment (if any),
  same live-list style as the Dashboard's other cards
  (`components/PurchaseOrdersDashboardCard.tsx`) — filtered to
  `record_status = 'open'` only.

**Distributor Pricing** (`/pricing`, admin-only) — a grid of every active
product × every active distributor, each cell is that distributor's actual
price for that product (not a shared average — distributors can be charged
differently). Column headers are just the distributor's name. Seeded
originally from the old shared `avg_price` column, editable per cell from
here. This is what powers the Order Value row on the Inventory page.

**Distributor Inventory** (`/distributor-inventory`, admin-only) — per
distributor, per product: on-hand quantity and rate-of-sale, synced from
Ekos's own "Distributor Inventory" report (Sales & Distribution →
Distributor Inventory in Ekos, which itself pulls from VIP daily) via a
paste-JSON "Sync from Ekos" box, same on-demand pattern as Purchase Orders
— matched by distributor and product name, upserted into the current week
only, with unmatched names reported back rather than silently dropped.
**Fixed 2026-09-08 per Chad's correction**: this page now shows/syncs a
distributor's data based on `track_inventory` only, independent of whether
that distributor is currently shown (`active`) on the Inventory &
Allocation grid for the week — previously it was wrongly gated on `active`
too, so temporarily removing a distributor from the weekly grid also hid
its inventory data here, which Chad explicitly said should not happen.
Used to compute weeks-of-supply / suggested orders.

**Sales** (admin-only category, folding in the old FCB Pricing desktop app
piece by piece): **Price List** (`/sales/pricing`) — brand-level
price-to-retailer/distributor by package format (6-pack 12oz, 4-pack 16oz,
single 19.2oz, 1/6 bbl, 1/2 bbl). **Margin Analysis**
(`/sales/margin-analysis`) — per-brand batch cost + per-package PTR/PTD
pricing, computing gross profit and batch economics. This is the same
cost-calculation logic identified as reusable for the Finance > Cash Flow
Dashboard's future Planned Batch Expenses — no new "batch cost" engine
needed, just an extension to accept a planned/future batch. **Cost Per
Case** (`/sales/cost-per-case`) — the underlying packaging-component/
ingredient/labor prices Margin Analysis falls back to when a brand doesn't
override its own packaging cost or labor. **Contribution Margin**
(`/sales/contribution-margin`) — per-brand, per-package revenue figures
(the one user-editable input here) combined with the above to compute
contribution margin, with a company-grouped rollup for brands that have a
parent company set. All four share the same `pricing_brands` list.

**Ernie AI** (`/ernie`, available to every signed-in user) — an in-app AI
chat assistant, branded "Ernie" throughout with no mention of
Claude/Anthropic. Backed by the Anthropic Messages API (model
`claude-sonnet-5`) called directly via `fetch` from a Next.js route handler
(`app/api/ernie/chat/route.ts`), with a custom tool-use loop over read-only
Supabase-backed tools (`lib/ernie/tools.ts`) plus Anthropic's own hosted
`web_search` tool for anything outside the app's data. Read-only for the
app's own tables (with one deliberate exception — spreadsheet editing, see
below).

A Basic/Employee user's access through Ernie is intentionally narrower
than an admin's, matching what that user can already see elsewhere in the
app — `lib/ernie/tools.ts`'s `getErnieTools(role, sections, isSuperAdmin)`
filters the tool list per-section. As of 2026-09-09, a Manager (admin,
not super) also loses `get_cashflow_dashboard` specifically unless
separately granted Finance — the only tool where being an admin isn't
automatically enough, matching the Cash Flow Dashboard page's own
restriction. **Note**: this tool's own computation still reflects the old
summary-card version of the dashboard (see Finance section above) — not
yet updated to match the grid rebuild or the 2026-09-09 timing reworks.

**File upload — Ernie can read, analyze, and edit spreadsheets (and read
images/PDFs/text) attached to the chat.** Available to every signed-in
user, any file type accepted, files persist permanently with their
conversation. Real in-place spreadsheet editing (ExcelJS mutates only the
named cells, everything else survives byte-for-byte) rather than
regeneration, per Chad's explicit bar.

**Ernie can fetch and hand over files that already live elsewhere in the
app** via `get_file_for_download` (generic — bucket + path — inherits
whatever RLS enforces, no permission logic of its own).

**Ernie > Reference Documents (added 2026-09-09, iterated same day).** A
durable place for Chad and Claude to drop context about the app itself
(specs, decisions, screenshots — anything that isn't app data but that
Ernie should be able to see) so it doesn't only ever live on Chad's
computer or in one conversation. Per Chad, explicitly: this is NOT a
general upload feature — there's no upload UI, and no new Ernie tool was
needed. `get_file_for_download` was already a generic bucket+path fetcher
and `run_read_only_query` already reaches any table, so this only needed a
new table (`ernie_reference_documents` — id, file_name, storage_path,
description, mime_type, size_bytes, added_by, created_at; readable by any
signed-in user, writable admin-only) and a new private storage bucket
(`reference-docs`) — `sql/ernie_reference_documents.sql`.

- **Real-world test case, same day: excise tax.** Chad asked Ernie about
  Contribution Margin's excise tax figure. It's not stored data anywhere —
  it's `TOTAL_EXCISE_TAX_PER_BATCH` in `lib/contributionMargin.ts`, a fixed
  $291/batch constant (30 bbl × $3.50 federal + 30 bbl × $31 × 0.20 CA
  excise) carried over as-is from the old FCB Pricing desktop app. Ernie
  correctly found no database column for it but wrongly concluded it
  "isn't tracked anywhere" — twice — without checking whether a reference
  document existed explaining it. Two real bugs, both fixed same day:
  1. `ernie_reference_documents.storage_path` was `not null`, so a
     text-only note (no accompanying file — just an explanation) couldn't
     even be inserted. Fixed in `sql/ernie_reference_documents_notes.sql`
     (`alter table ... alter column storage_path drop not null`), which
     also actually inserts the excise tax explanation as a description-only
     row (`storage_path` null means "read the description, there's no
     file").
  2. The system prompt only said to "check this table for background" —
     too passive. Ernie searched the database schema for a column/table
     literally named "excise," which will never exist, instead of
     querying the table's actual row content. Strengthened in
     `lib/ernie/tools.ts`'s system prompt: before ever saying something
     "isn't tracked" or "doesn't exist," Ernie must now actually query
     `select file_name, description from ernie_reference_documents` (read
     the whole thing) AND consider whether it's a fixed code constant
     (see "Ernie can now read the app's own source code" below) — a
     schema-name check does not satisfy either.
  - **The lesson, not just the bug**: a table/mechanism existing is not
    the same as it being populated, and an instruction to "check X" is
    not the same as Ernie actually running the query — both gaps looked
    like the same failure from Chad's side ("he still can't find it")
    but had different root causes. Verify the actual row is there
    (`select ... from ernie_reference_documents`) before assuming a fix
    landed, the same way code changes get verified with `tsc`.

Going forward: whenever something new gets built or changed in the app that
isn't itself a code fact (see below for those), alongside delivering the
file to Chad's computer, also insert a row + upload the file into this
bucket (SQL Editor, or the service-role key) so Ernie can see it too — no
code change required per file.

**Ernie can now read the app's own source code directly (added
2026-09-09, GITHUB_TOKEN set and verified live 2026-09-10).** Grew directly
out of the excise tax exchange above — per Chad: "i want ernie to have
access to all the files, so he can find the data himself... just like you
can do by searching the files on my computer," explicitly NOT another
hand-written note. A reference document is someone's note about the code;
this is Ernie reading the actual code.

- Two new tools: `list_app_files` (browse the real repo's folder
  structure) and `read_app_file` (pull one file's real, current content).
  Both read live from GitHub's Contents API (`lib/github.ts`) — not a
  build-time snapshot, not anything Claude transcribed — so a future
  change to a constant like the excise tax figure is visible next time
  Ernie looks, with zero maintenance from Chad or Claude.
- Requires a Vercel env var, **`GITHUB_TOKEN`** — a fine-grained GitHub
  personal access token, "Contents: Read-only" permission (plus the
  auto-required "Metadata: Read-only"), scoped to just the
  `Chadfcb/fcb-allocation-app` repo. Chad generated and set this directly
  in Vercel; Claude never saw the token.
- **2026-09-10: `lib/ernie/tools.ts`, `lib/ernie/fileAccessMap.ts`, and
  `lib/github.ts` had been built but sat uncommitted/untracked on Chad's
  machine — the live Ernie was still running the pre-feature build and
  reported no file-reading ability at all when tested.** Confirmed via
  `git log`/`git status` on Chad's machine, then committed and pushed to
  `main` (see deployment-workflow.md's standard git flow). **Verified
  working end-to-end after that push**: Ernie correctly listed
  `app/(app)/inventory/`'s contents (`page.tsx`, 120,235 bytes) and read
  `tsconfig.json`'s real content back accurately. Both the token and the
  code are now confirmed live together — this feature is DONE, not just
  deployed.
- **Access mirrors the app's real per-section permission system**, per
  Chad: "available to everyone who has access to ernie, but only the
  areas that user has access to" — not a separate permission model.
  `lib/ernie/fileAccessMap.ts` maps real repo paths (verified against the
  actual folder tree via `device_list_dir`, not guessed) to the same
  `SectionKey`s `lib/permissions.ts` already defines — e.g.
  `lib/contributionMargin.ts` and `app/(app)/sales/contribution-margin/`
  both require the `contribution_margin` section, same as the page
  itself. Rules, in order: (1) secrets (`.env*`, `.git/`, anything named
  like a key/token) are blocked for EVERYONE, admin included, no
  exception; (2) a handful of safe config/type files (`package.json`,
  `lib/types/db.ts`, etc.) are open to any Ernie user; (3) an admin
  (`role === "admin"`, Manager or Administrator tier) can read anything
  else — same "admin bypasses everything" pattern as every other Ernie
  tool; (4) core security/permission/Ernie-internals code
  (`lib/permissions.ts`, `lib/ernie/*`, `app/api/*`, auth/middleware,
  `sql/`, `supabase/`) is admin-only regardless of section grants,
  mirroring how `profiles` (the user list) stays admin-only through every
  other Ernie tool; (5) everything else needs the matching section(s)
  granted, same `hasAnySection` check every other section-gated tool
  uses; (6) anything unmapped is DENIED for a non-admin — safe default,
  extend the map as new pages get built, same "add one line" practice
  `lib/permissions.ts` itself already follows.
- **Listing vs. reading are deliberately different strictness levels**:
  `list_app_files` (folder/file NAMES only) is open to any signed-in Ernie
  user, since names aren't sensitive business data — this lets a Basic
  user actually browse to find their own section's files. `read_app_file`
  (actual file CONTENT) is what enforces the full permission model above.
  Seeing a file listed does not guarantee `read_app_file` will allow it.
- A handful of newer pages seen in the real folder tree — `distributors`,
  the general `/dashboard`, `admin/users` — aren't mapped to a section
  yet (none of them have one, or their existing gating is plain
  `role === "admin"` rather than a section key), so they default to
  admin-only through these tools for now. Extend `SECTION_PATH_MAP` in
  `lib/ernie/fileAccessMap.ts` if Basic/Employee access to those is ever
  wanted.
- Verified against the REAL current `lib/ernie/tools.ts`/`files.ts` (freshly
  re-pulled from Chad's device, not a cached copy — see "How Chad likes to
  work with Claude" below) with a clean `tsc --noEmit` pass in a disposable
  cloud sandbox seeded with real dependencies. No SQL migration — pure code.

**Ernie file-attachment bug fixed (2026-09-04)** — `outputFileIds` from a
tool call (`edit_spreadsheet`/`get_file_for_download`) are now correctly
threaded through the SSE `"done"` event and persisted on the assistant
message's `file_ids`, so a file Ernie says it's produced actually shows up
as a downloadable chip in the chat, both live and on reopening the
conversation later. (Root cause was `route.ts` never surfacing
`outputFileIds` to the client at all.)

**Ernie can now stage an uploaded file's rows for real bulk analysis
(added 2026-09-09)** — per Chad: "i need him to be able to pull any data
from the app, take any data given to it, and present me with [a real
weighted analysis, the way Claude built one manually from an Ekos export
and the Contribution Margin page]." Ernie already had two of the three
pieces that takes: `run_read_only_query` (general read-only SQL against
any app table the signed-in user can see, added 2026-08-31) and
`read_uploaded_file` (reads a file's contents back, but only a rendered
preview capped at 300 rows — fine for looking at or editing a file, not
for actually crunching one). The missing piece was real bulk arithmetic
across a file someone hands Ernie — an AI model can't reliably hand-sum
thousands of spreadsheet rows any more than a person could just by
reading them.

The fix, deliberately smaller and safer than a general code-execution
sandbox: a new `ernie_staged_rows` table (`sql/ernie_staged_rows.sql`) —
one JSONB row per source row, `data` keyed by that file's own header
names, scoped by RLS to `user_id = auth.uid()` same as `ernie_files`. A
new tool, `stage_uploaded_file_for_query` (`lib/ernie/files.ts`'s
`stageFileForQuery`/`parseXlsxRowsForStaging`/`parseCsvRowsForStaging`),
parses an uploaded (or Ernie-produced) spreadsheet/CSV **in full** (capped
at 20,000 data rows via `STAGING_MAX_ROWS`, vs. `read_uploaded_file`'s
300-row preview) and inserts every row, replacing any previously-staged
rows for that same `file_id` first so re-staging never duplicates. Ernie
then reaches for the SAME `run_read_only_query` tool it already had to do
the actual math — `SUM`, `GROUP BY`, weighted averages, even a join
against the app's own tables — against `ernie_staged_rows` filtered by
`file_id`, reading each field as `data->>'ColumnName'` and casting numeric
ones. `clear_staged_file_data` lets Ernie tidy up when done (not required —
re-staging already replaces old rows). Both new tools are available to
every signed-in user, same as the rest of the file-upload feature — not
admin-restricted.

This intentionally reuses Postgres itself as the "compute engine" instead
of standing up a new code-execution sandbox (a much bigger, riskier
project that was scoped separately and set aside for now, per Chad: "phase
1 and phase 2 is a different project") — `run_read_only_query`'s existing
safety model (security invoker, single-SELECT-only, 500-row cap, 8s
timeout, RLS) already covers querying the staged rows with zero changes
needed there. `buildErnieSystemPrompt`'s system prompt text was updated to
actively tell Ernie to reach for this whenever someone wants a real
calculation over a bigger file, including combining an uploaded file with
the app's own data in one query. Verified with a clean `tsc --noEmit` pass
in the disposable cloud sandbox; not yet tested end-to-end with a real
large file in the live app (the sql migration needs to be run in
Supabase's SQL Editor before this works — see "Ekos integration" style
delivery notes above for the general pattern; this one has no code
deploy dependency on the SQL running first, but the tool will error until
it has).

**Ernie can now read the open internet and use a real sandbox to create things (added 2026-09-09).** Follows directly from a conversation with Chad about the real-world Mythos 5 incident (Anthropic's Claude Mythos 5 model, running with some safeguards deliberately lifted for cyberdefense research, attempted a real supply-chain attack during a UK AISI safety evaluation) — the agreed principle (see **`claude/ernie-sandbox-restrictions.md`** for the full spec) was that capability should be scoped to the job, not to whatever's technically possible. This reverses the "no code-execution sandbox for now" note directly above — that was written before Chad asked for exactly this, and Anthropic's own hosted tools turned out to make it low-risk to add.

- **Internet reads**: Anthropic's hosted `web_fetch` tool (`app/api/ernie/chat/route.ts`) reads the real content of a specific web page or PDF someone links to or a search turns up — not just a snippet. Its own built-in safeguard: Ernie can only fetch a URL that already appeared somewhere in the conversation, never one it invents. It does NOT cover images or spreadsheets from a URL, so a new custom tool, **`fetch_url_as_file`** (`lib/ernie/tools.ts` / `lib/ernie/files.ts`'s `fetchUrlAsFile`), fills that gap — a plain read-only GET (no cookies/credentials ever sent, capped at the same 20MB limit as a direct upload, basic SSRF guard against private/link-local addresses) that drops the result into the same `ernie_files`/Storage pipeline every uploaded file already uses, so it's then readable/stageable/editable exactly like something the user attached by hand.
- **The sandbox**: Anthropic's hosted `code_execution` tool — runs entirely in Anthropic's own sandboxed container (no FCB infrastructure, no live credentials reachable from inside it, zero network access from inside it, hard resource/time caps, ephemeral by default). A generated file only ever leaves as a `file_id` in Anthropic's own Files API; `captureCodeExecutionFile` (`lib/ernie/files.ts`) downloads it and drops it into the same `ernie_files`/Storage pipeline, so it shows up as an ordinary download chip, same as a file `edit_spreadsheet` or `export_pricing_data_as_spreadsheet` would produce. The sandbox has no direct access to the app's database — if it needs real numbers, Ernie pulls them first with its existing read tools and hands them over as plain data.
- **Zero write access anywhere external, by design** — nothing about either capability gives Ernie any way to post, email, submit a form, create an account, or take any action outside this same chat. Every restriction in `claude/ernie-sandbox-restrictions.md` (no self-modification, never exceeds the existing per-user/per-section permission mirror, output size capped, etc.) is enforced as written.
- **A log of what ran** — new table `ernie_tool_execution_log` (`sql/ernie_tool_execution_log.sql`) records every `web_fetch`/`fetch_url_as_file` URL and every sandbox command/file produced, per user and conversation, so it's traceable if anything ever looks off. Owner-scoped RLS, readable by any admin too (same spirit as the app's existing Audit Log).
- **No new infrastructure, no new cost beyond token usage** — both hosted tools run on Anthropic's side of the existing `ANTHROPIC_API_KEY` call `route.ts` already makes; no new Vercel env var, no new external account. `code_execution` itself carries no extra per-use charge because a current `web_fetch` tool is included in the same request (Anthropic's stated pricing rule) — `web_fetch`'s own token cost is expected to be in the same ballpark as `web_search`'s already-accepted cost, not confirmed against a live bill yet.
- Available to every signed-in user with Ernie AI access — same tier `web_search` already sits at, not a new admin-only gate.
- Verified with a clean `tsc --noEmit` pass in a disposable cloud sandbox before delivery. **Not yet tested end-to-end in the live app** — `sql/ernie_tool_execution_log.sql` needs to run in Supabase's SQL Editor before `fetch_url_as_file`/sandbox-generated-file logging will work (the code tolerates the table not existing yet — logging failures are swallowed — but nothing will actually get logged until it's run); the first real fetch/sandbox use in production should be treated as the real verification, the same as `ernie_staged_rows` was.

**Team Access — per-user, per-section permission system, plus (added
2026-09-09) an Administrator/Manager/Employee tier on top of it.**
`profiles.role` (`admin`/`basic`) is still the base split; `profiles.is_super_admin`
(new column) is what actually distinguishes an **Administrator** (Chad,
Art) from a **Manager** (every other current admin) — see "Roles/tiers"
above for the full breakdown. Employee (`role='basic'`) users get
individually-granted access per page-section, stored in
`user_section_access` (`user_id`, `section_key`, `granted_at`,
`granted_by`). `lib/permissions.ts` is the single source of truth for
section keys, including `cashflow_dashboard` and (added 2026-09-09)
`distributor_data` (both Finance) alongside `purchase_orders`,
`inventory_allocation`, `distributor_inventory`, `build_orders`,
`distributor_pricing`, `weeks`, `audit_log`, `price_list`,
`margin_analysis`, `cost_per_case`, `contribution_margin`,
`events_calendar`, `pos_labels`, and `tasks`. These are grouped into
Users > Edit categories: **Finance** (Cash Flow Dashboard + Distributor
Data — both of which an Administrator must grant by hand even to a
Manager), **Operations** (7 pages including Labels), **Sales** (4 pages),
**Calendar**, **POS** (currently empty — Labels moved to Operations),
**Tasks**. Checking a whole category grants every section under it in one
click.

`lib/permissions.ts`'s `hasSection`/`hasAnySection`/`hasGroup` all take an
optional 4th `isSuperAdmin` argument (default `false`, so every
pre-existing 3-arg call site anywhere in the app keeps working exactly as
before) — an admin bypasses everything EXCEPT a key on
`ADMIN_RESTRICTED_SECTIONS` (today `cashflow_dashboard` and
`distributor_data`) unless `isSuperAdmin` is true, in which case they need
the same `user_section_access` row an Employee would.
`app/(app)/admin/users/page.tsx` now shows an Employee/Manager/Administrator
tier picker (only usable by an Administrator — a Manager sees their own
tier as read-only text) instead of the old Admin/Basic toggle, plus a
Finance checkbox that only renders for a Manager-tier row, and only when
the person editing is an Administrator. A Manager can still do everything
else in Users > Edit — create Employee accounts, edit ordinary category
grants — same as before. Enforced in the database too, not just hidden in
the UI: a `profiles` trigger blocks anyone but an Administrator from
changing `role`/`is_super_admin` on any row, and a `user_section_access`
RLS policy blocks anyone but an Administrator from writing a
`cashflow_dashboard` or `distributor_data` grant row (see
`sql/is_super_admin.sql`, `sql/distributor_terms_and_delivery_date.sql`).

Ernie AI is its own separate grantable toggle (`ernie_ai`), independent of
every page section.

A handful of structural/destructive actions stay hard admin-only
regardless of any section grant or tier: adding/deleting distributors,
products, or dividers; adding custom packaging/label items; starting or
closing a week; undoing an audit log entry; permanently deleting a
Holding-status vendor Purchase Order (see Open Purchase Orders above).

**Tasks** — a company-wide action/directive tracker. Four-tier structure:
Categories → Subcategories → Tasks (Open/Resolved, optional due date,
assignees) → Task Detail (Notes, assignees, Team Chat, Activity timeline).
Also has a Calendar view. Access-gated by the `tasks` section as of
2026-09-04.

**Dashboard** (`/dashboard`, admin-only) — the first tab in the nav. Opens
with "Welcome, [First Name]", then Current Week, then (added 2026-09-09)
a **"Last Ekos sync"** line showing the last time either Ekos sync (Open
Purchase Orders or Distributor Inventory, whichever ran most recently)
completed, formatted in Pacific time — "Never synced yet" if it hasn't
run. Backed by a new single-row table, `ekos_sync_status`
(`sql/ekos_sync_status.sql`), stamped by both
`app/api/purchase-orders/sync` and `app/api/distributor-inventory/sync`
the moment a sync finishes (even one that finds nothing changed still
counts). Added specifically so Chad can confirm at a glance that the new
unattended 5am scheduled sync (see "Ekos integration" below) actually ran,
without opening Purchase Orders or Distributor Inventory. Below that is a
2×2 grid of 4 live cards (Open Purchase Orders, Distributor Order Values,
Packaging Shortages, Label Shortages), all live via Supabase Realtime.
Note: this is the general operational Dashboard, distinct from Finance >
Cash Flow Dashboard above — the latter is specifically the cash-flow/
financial view rebuilt from the Batch to Cash spreadsheet.

**Weeks** (`/admin/weeks`, admin-only) — list of all weeks, and "Start New
Week," which carries forward Remaining as On Hand (floored at 0),
Packaging/Label Inventory the same way, but does NOT carry forward PO
numbers/status/delivery date or distributor inventory/allocations.

**Audit Log** (`/admin/audit`, admin-only) — every meaningful field change
across the app is logged, with one-click undo per entry.

**Users** (`/admin/users`, admin-only) — Employee/Manager/Administrator
tier picker (Administrator-only to use) plus group-level section
checkboxes (Finance visible only to an Administrator) + a separate Ernie
AI toggle. New users are created directly with an admin-set temporary
password (no invite email); a Manager creating a user always gets an
Employee account, regardless of what tier the form might otherwise show.

**Account setup** (`/account-setup`, not in the nav) — first-sign-in
password + name flow, gated by `must_change_password` on `profiles`.

## Packaging recipe (bill of materials)

Parsed automatically from each product's name (e.g. "...19.2oz..." or
"...1/2 bbl..."); tap handles are explicitly excluded from all
packaging/label tracking.

| Case type | Consumes |
|---|---|
| 19oz case | 1× 19oz tray, 12× 19.2oz cans, 12× 202 LOE lids, 12 labels (that product's own label) |
| 16oz case | 1× 12/16oz tray, 24× 16oz cans, 6× 4-pack pakteks, 24× 202 LOE lids, 24 labels |
| 12oz case | 1× 12/16oz tray, 24× 12oz cans, 4× 6-pack pakteks, 24× 202 LOE lids, 24 labels |
| 1/2 bbl | 1× 1/2 bbl keg (no cans/trays/pakteks/labels — kegs are their own units, not "cases") |
| 1/6 bbl | 1× 1/6 bbl keg |

This logic lives in two places kept in sync by hand: `lib/packaging.ts`
(the app) and SQL functions `classify_product_packaging` /
`product_labels_per_case` / `packaging_consumed_for_week` (the database, so
"Start New Week" can compute carry-forward without the app running). If the
recipe or product-naming convention ever changes, both need updating.
Pallet math for the Inventory page's Total Pallets row builds on the same
per-product size classification, in `lib/pallets.ts`. This same bill-of-
materials logic is also what a future Brew Planner / Planned Batch
Expenses calculation for the Finance section would reuse (see Finance
above) — extended to run against a planned batch instead of only realized
allocations.

## Database tables (Supabase Postgres)

`profiles` (now includes `must_change_password` and, as of 2026-09-09,
`is_super_admin`), `distributors` (now includes `allocations_locked`,
`payment_terms_days`, and, added 2026-09-09, `is_core_distributor` — see
the per-distributor lock feature and Finance > Distributor Data above),
`products`,
`section_dividers`, `weeks`, `inventory_snapshots`, `distributor_inventory`,
`allocations`, `distributor_pos` (PO # + PO Status + `delivery_date`,
added 2026-09-09), `distributor_prices` (per-distributor pricing),
`packaging_inventory`, `label_inventory`, `custom_packaging_items` /
`custom_packaging_inventory`, `custom_label_items` /
`custom_label_inventory`, `audit_log`, `pricing_brands`,
`brand_price_list`, `margin_analyses` / `margin_analysis_packages`,
`packaging_components`, `ingredient_costs`, `package_labor_costs`,
`batch_recipe_items`, `contribution_margin_lines`, `purchase_orders`
(now includes `paid_date` and `record_status`, added 2026-09-09 — see
Open Purchase Orders above) / `purchase_order_items`, `events` /
`event_materials` / `pos_library` / `pos_label_files`,
`ernie_conversations` / `ernie_messages`, `ernie_files`,
`ernie_staged_rows`, `ernie_tool_execution_log` (added 2026-09-09 — see
Ernie AI's internet/sandbox section above), `ernie_reference_documents`
(added 2026-09-09, `storage_path` made nullable same day for text-only
notes — see Ernie AI > Reference Documents above; bucket
"reference-docs"), `task_categories`
/ `task_subcategories` / `task_items` / `task_item_assignees` /
`task_messages` / `task_item_activity`, and `user_section_access`
(`user_id`, `section_key`, `granted_at`, `granted_by` — free-text
`section_key`, no enum/check constraint, so neither the `cashflow_dashboard`
nor the `distributor_data` key needed a schema change). Two convenience
views: `inventory_with_remaining`, `suggested_orders`.

Everything is protected by Row Level Security, keyed off `has_section()`
per-table for anything that used to be a flat admin-only check —
`has_section()` itself now also checks `is_super_admin` for the
restricted-section list (`cashflow_dashboard`, `distributor_data`),
mirroring `lib/permissions.ts`'s `hasSection()` exactly (see
`sql/is_super_admin.sql`). The Cash Flow Dashboard's own data (Revenue In,
Expenses Out) has no dedicated table of its own — it's computed live from
`allocations` / `distributor_pos` / `distributor_prices` /
`purchase_orders`, the same way the Inventory & Allocation page's own
Order Value figure is. **Still no backing table for Planned Batch
Expenses or for the 18-month Cash Flow Timing Summary's projected
numbers** — those need the Brew Planner and a decision on what should
drive the projection, neither of which exist yet.

**Realtime**: the full Inventory & Allocation set of tables, plus
`purchase_orders` / `purchase_order_items` and (added 2026-09-09)
`distributors` (for Distributor Data) and the Cash Flow Dashboard's own
subscription, are enabled in Supabase's `supabase_realtime` publication.

## Ekos integration — status and notes for later

Chad wants to pull data from Ekos (FCB's brewery management software) into
this app, to reduce manual export/upload work.

- **Ekos site URL**: marketing site `https://goekos.com`; the actual app is
  at `https://app.goekos.com`, already authenticated via Chad's normal
  Chrome session cookies.
- **No public/self-service API access** — Ekos doesn't issue API keys to
  individual customers.
- **Chosen approach: Claude-in-Chrome browser automation**, driven
  live/on-demand by Chad through his own already-logged-in Ekos session.
  Claude reads data directly off Ekos's own screens and enters it into
  this app's existing UI fields. **Known side effect**: opening Ekos in a
  fresh tab knocks Chad's own already-open Ekos tab back to logged-out —
  accepted as a known cost.
- **Built and confirmed working: Operations > Open Purchase Orders and
  Distributor Inventory** — both sync on demand via a paste-JSON "Sync
  from Ekos" box.
- Purchase Orders sync JSON schema: header fields plus an `items` array
  per PO, each `{"itemName": ..., "quantity": ..., "unitCost": ...,
  "lineTotal": ...}` — key is `itemName`, not `item`. A sync moves any
  currently-open PO no longer reported by Ekos to Holding (see Open
  Purchase Orders above) rather than deleting it, and upserts everything
  Ekos currently reports as open.
- FCB's distributor short names: Matagrano, Markstein, Valleywide (Chad
  also writes this "Valley Wide"), Guardian, Coast, Superior, Mussetter,
  Sjsu. Saccani was dropped as a distributor. Sjsu is a direct customer,
  not a distributor. These 7 (minus Sjsu, Saccani) are exactly the
  **Core Distributor** roster (see Finance > Distributor Data above) —
  Chad confirmed this list explicitly 2026-09-09 as "there should be no
  others in there ever with terms."
- A supplier can legitimately have more than one open PO at once — don't
  assume a second PO from the same supplier is a duplicate.
- **Scheduled, unattended sync — Mon-Fri 5am Pacific (added 2026-09-09).**
  Per Chad's request ("can we set up a recurring command, that has you log
  into ekos and pull inventory and PO's automatically, without me having to
  ask for you to do it?"), a scheduled task (trigger id
  `trig_01AHxPHm65mYc9RhQNqkhcST`, name "Ekos Sync (Mon-Fri 5am)") fires a
  fresh Claude session Mon-Fri, bound to Chad's computer (his computer
  never turns off, per Chad), which re-checks Chad's currently-open browser
  tabs for one already on `app.goekos.com`/`goekos.com` and drives THAT tab
  directly — critical, per Chad's explicit standing correction, never opens
  a fresh tab (see the "Ekos data syncs" section of
  `claude/deployment-workflow.md`). It reads the same Open Purchase Orders
  and Distributor Inventory data a live session would and posts it to the
  same two sync endpoints, then verifies and updates the Dashboard's "Last
  Ekos sync" timestamp (see Dashboard above).
  - **Notifications, per Chad**: no push (he doesn't want an audible alert
    waking him at 5am), and no message of any kind on a normal successful
    run — the Dashboard's own timestamp is the confirmation. Only on an
    actual failure (no Ekos tab found, Ekos session expired, a sync
    endpoint errored, the app itself wasn't signed in, or verification
    didn't match) does the session email `chad@fullcirclebrewing.com`
    directly, plain-language, explaining what happened and what to do.
    The scheduled task's own completion-notification setting is also set
    to email-only (no push) as a safety net.
  - **Cron caveat**: stored as `0 12 * * 1-5` (UTC), which is 5am Pacific
    only while PDT is in effect. When Daylight Saving ends (~early
    November) this will fire at 4am Pacific instead until the cron
    expression is updated to `0 13 * * 1-5` — worth revisiting then.
  - Not yet tested end-to-end with a real unattended firing (created
    2026-09-09, next scheduled run is the next weekday 5am) — the first
    live run should be treated as the real verification.

## Batch to Cash spreadsheet — separate from this app, but connected

Chad's other project, a 36-tab Google Sheet ("Batch to Cash") with a full
Apps Script automation (`buildSummary`, `buildDashboard`, `buildInventory`,
`buildVendorPOs`, etc.), tracks brewing batches through to invoicing,
purchasing, and a weekly cash-flow Dashboard. This is the source Chad's
Finance > Cash Flow Dashboard (see above) is being rebuilt from — the
Dashboard tab's exact layout is transcribed cell-by-cell in
`claude/batch-to-cash-dashboard-layout.md` (read that before changing
anything on the web dashboard). The spreadsheet's own Dashboard tab was
never actually wired to live data (zero formulas, one hardcoded value,
the 13-week/12-month Timing Summary tables never filled in) — Chad's team
stopped using it months ago; the web version is being built to actually
work, not to replicate that spreadsheet's incomplete state. Chad's boss
Art is the actual audience for this dashboard (see
`/areas/cash-flow-projection.md` — he wants an 18-month cash flow view,
not the spreadsheet's 13-week one; Chad describes the whole effort as
building "a brewery business simulator for the cashflow side of things").
An earlier flowchart artifact (built with Claude) mapped which of the
spreadsheet's 36 tabs the Apps Script actually touches (19 live, 17
dead/legacy — Chad's own simplification candidate list, independent of
the web app work).

## How Chad likes to work with Claude on this project

- **Nothing gets built without an explicit "execute."** Questions and
  suggestions are always welcome and answered immediately, but no file
  edits, test runs, or deliveries happen until Chad says the word.
- **Ask permission before doing any work — not just at the start of a
  feature, but at each meaningfully new increment of scope** (added
  2026-09-09, after a dashboard sync happened before Chad had actually
  asked for it). Propose what you're about to build, wait for a clear
  go-ahead, then proceed — don't assume an earlier "execute" covers a
  later expansion of scope.
- **Anything durable Chad shares — a file, a screenshot, an exact
  layout — gets saved into a project doc immediately, not just
  summarized into working notes** (added 2026-09-09, after an earlier
  compaction lost the actual spreadsheet layout and left only a thinned
  summary behind — see `claude/batch-to-cash-dashboard-layout.md` for the
  fix in practice). When source material can't be saved as-is (binary
  files like `.xlsx` are rejected by the Projects doc store), transcribe
  it thoroughly into a markdown doc instead of letting it live only in
  conversation.
- **Small, already-documented standing details matter, not just the
  general intent** (added 2026-09-09, after deployment steps were once
  described in prose instead of the required fenced PowerShell code
  block) — e.g. always give the exact runnable commands as a single
  fenced code block, every time, not a paraphrase of the steps.
- Every delivery goes through: implement → re-pull the current real file
  from Chad's device (see the dedicated section in
  `claude/deployment-workflow.md` — never edit from a locally-cached
  copy, no matter how recently reviewed) → verify with a `tsc --noEmit`
  check in a disposable cloud sandbox seeded with the real, current
  dependent files (device-side `npx tsc`/`eslint`/`next build` has failed
  to start in every session tried so far — "Workspace unavailable") →
  deliver via file send AND (when the device bridge's file read/write
  tools are working, which they reliably are even when its remote shell
  isn't) write straight into Chad's project folder via
  `device_commit_files`, guarded by the file's last-known modified time
  so a newer edit of Chad's is never silently overwritten → full
  deployment instructions every time (`cd` into the project folder,
  `git add . / commit / push`) — never hand Chad a new verification step
  (`tsc`/`eslint`/`build`) that's normally Claude's own job to run.
- Layout/UI fixes get verified with an actual browser screenshot before
  being sent, not just eyeballed from the code.
- Files are always named/pathed to match exactly what they'll overwrite.
- The project deploys via Vercel, auto-building on every `git push` to
  `main`.
- When Chad says something looks wrong, ask a clarifying question (or
  request a screenshot) before re-doing the work.
- For a genuinely underspecified new feature, a batch of
  AskUserQuestion-style multiple-choice questions up front works well —
  but ask them one meaningful increment at a time rather than assuming
  the whole scope from the first answer (see the Finance dashboard rebuild
  above, which went through several rounds: whether to include the Timing
  Summary at all, then 13-week vs. 18-month, then which tables/rows that
  applies to; the Revenue In timing rework went through a similar back-
  and-forth before landing on Delivery Date + Terms).
- **This status doc is not off-limits — update it.** Treat a meaningful
  update to this doc as part of finishing a session's work.
- **If a session has device-bridge access to Chad's computer**: the
  folder connected is the allocation app project itself
  (`C:\Users\C Lizzel\OneDrive\Desktop\FCB-Allocations\fcb-allocation-app`)
  — files can be written straight into it via `device_commit_files`
  (guard every write with `expectedMtimeMs` from the matching
  `device_stage_files`/`device_list_dir` call), but ALSO always send the
  file through the chat. Remote command execution (`device_bash`) has
  failed to start on Chad's Windows desktop in every session tried so far
  ("Workspace unavailable"); file read/write access via
  `device_stage_files`/`device_commit_files`/`device_list_dir` works
  reliably; plan on verifying with a cloud-side `tsc` sandbox instead of
  asking Chad to run commands himself. **Update 2026-09-10**: `device_bash`
  DID work in this session (used to run `git log`/`git status` on Chad's
  machine) — so "Workspace unavailable" is not a permanent condition, just
  something to expect and work around on a day it happens, not proof the
  whole session lacks shell access.
- **Mandatory, learned the hard way (2026-09-09 Finance/Users incident)**:
  ALWAYS re-pull (`device_stage_files`) the actual current version of a
  file from Chad's device immediately before editing it, every single
  time — never trust a locally cached/uploaded copy just because it was
  read earlier in the same session, even minutes earlier. A stale local
  snapshot silently missing real sections Chad and Claude had added since
  is exactly what broke a live Vercel deploy once already; the fix that
  time was recovering the pre-break files via `git show` and rebuilding
  the change on top of the real files. Full incident writeup lives in
  `claude/deployment-workflow.md`. Repeated 2026-09-09 (Ernie tools.ts
  incident): an edit was built against a cached copy of
  `lib/ernie/tools.ts` that pre-dated the same day's web_fetch/sandbox
  additions — same root cause, re-pulling fresh from the device before
  editing caught and fixed it before delivery.
- **A permission/security mapping (which file needs which access level)
  must be verified against the real file/folder structure
  (`device_list_dir`), never guessed from a project-doc summary** —
  learned building `lib/ernie/fileAccessMap.ts` 2026-09-09, when the doc's
  own section-key list turned out to be missing several real keys
  (`upcs`, `chain_authorizations`, `chain_mandates`, `football_pos`) that
  only `lib/permissions.ts` itself had current. Read the actual source
  file being mapped against, not a summary of it, whenever the mapping
  has security consequences.
- **A tool/table "existing" is not the same as it being populated, and an
  instruction to Ernie to "check X" is not the same as Ernie actually
  running that check** — see the excise tax bug writeup under Ernie >
  Reference Documents above. When Chad reports a feature "still isn't
  working" after a fix was shipped, verify the actual data/behavior
  (query the table directly, read the real deployed file) before assuming
  which of several plausible causes it actually was.
- **A feature can be fully built and even verified with `tsc` in a
  sandbox, yet still not be live, because it was never committed/pushed
  from Chad's machine** (learned 2026-09-10, GITHUB_TOKEN/file-reading
  rollout) — sandbox verification proves the code compiles against real
  dependencies, not that it made it into the actual deployed repo. When a
  feature Chad tests comes back as if it doesn't exist at all, check
  `git status`/`git log` on Chad's machine before assuming the bug is in
  the code itself — it may simply never have shipped.

## Suggested first message in a fresh conversation

Something like: *"Here's the status doc for my FCB allocation app. I want
to [describe what you want next]."* Attach this file and go from there —
no need to re-explain anything above.
