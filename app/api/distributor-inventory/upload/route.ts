import { NextRequest, NextResponse } from "next/server";
import { getProfile } from "@/lib/getProfile";
import { hasAnySection, hasSection } from "@/lib/permissions";
import { createAdminClient } from "@/lib/supabase/admin";
import { parseSpreadsheet } from "@/lib/parseSpreadsheet";
import { DISTRIBUTOR_PAGES, FILE_INVENTORY_DISTRIBUTORS } from "@/lib/distributorPages";

// Upload inventory (Distributors → Superior), added 2026-10-22, per Chad:
// Superior doesn't put inventory into Ekos — VIP emails "SPC Full Circle
// Inventory.xlsx" every Monday. The file is the same VIP inventory report Ekos
// shows (Item Names, Current On Hand in Units, Projected Daily Rate of Sales …,
// with a "Total" row per package size — those are skipped).
//
// Item names are matched with the same name lists the Ekos sync uses
// (ekos_name_map, kind 'item' — shown on Admin → Ekos Sync), or an exact app
// product name. Never guessed: if any name is unknown, nothing is saved and
// the page asks for the match (or Skip) right there; the choices are saved to
// the name list so next Monday's file goes straight in.
//
// Saves into Operations → Distributor Inventory for the CURRENT week, source
// 'distributor' (= from the distributor's own file), the same table Ekos
// fills — so Distributor Inventory and Build Orders see it too.
//
// POST multipart: file, distributor, matches (optional JSON { "<file name>": "<app product>" | "__skip" }).
export const maxDuration = 60;

const SKIP = "__skip";

const norm = (s: string) => s.replace(/\s+/g, " ").trim();
const num = (s: string | undefined) => {
  const n = Number(String(s ?? "").replace(/,/g, ""));
  return Number.isFinite(n) ? n : 0;
};

export async function POST(req: NextRequest) {
  const form = await req.formData().catch(() => null);
  const file = form?.get("file");
  const distributor = String(form?.get("distributor") ?? "");
  const page = DISTRIBUTOR_PAGES.find((d) => d.name === distributor);

  const profile = await getProfile();
  if (!profile || !page || !hasSection(profile.role, profile.sections, page.section, profile.is_super_admin)) {
    return NextResponse.json({ error: "You don't have access to this distributor." }, { status: 403 });
  }
  if (!FILE_INVENTORY_DISTRIBUTORS.includes(distributor)) {
    return NextResponse.json({ error: `${distributor}'s inventory comes from Ekos — there's no file to upload.` }, { status: 400 });
  }
  if (!(file instanceof File)) return NextResponse.json({ error: "No file was attached." }, { status: 400 });

  let matches: Record<string, string> = {};
  try {
    matches = JSON.parse(String(form?.get("matches") ?? "{}")) as Record<string, string>;
  } catch {
    matches = {};
  }

  // ---- Read the file ----
  let table: string[][];
  try {
    const parsed = await parseSpreadsheet(Buffer.from(await file.arrayBuffer()), file.name);
    table = [parsed.headers, ...parsed.rows];
  } catch {
    return NextResponse.json({ error: "Couldn't open that file — it should be the .xlsx (or .csv) from the Monday email." }, { status: 400 });
  }
  const headerIdx = table.findIndex((r) => r.some((c) => /^item names?$/i.test(norm(c))));
  if (headerIdx < 0) {
    return NextResponse.json(
      { error: "This doesn't look like the VIP inventory report — no \"Item Names\" column found. Use \"SPC Full Circle Inventory.xlsx\" from the Monday email." },
      { status: 400 },
    );
  }
  const header = table[headerIdx].map(norm);
  const col = (re: RegExp) => header.findIndex((h) => re.test(h));
  const iItem = col(/^item names?$/i);
  const iOnHand = col(/^current on hand/i);
  const iRate = col(/^projected daily rate of sales?$/i);
  if (iOnHand < 0 || iRate < 0) {
    return NextResponse.json(
      { error: "The file is missing \"Current On Hand in Units\" or \"Projected Daily Rate of Sales\" — VIP's report layout may have changed. Tell Claude." },
      { status: 400 },
    );
  }
  const reportLine = table.flat().find((c) => /^report created on/i.test(norm(c)));
  const reportDate = reportLine ? norm(reportLine).replace(/^report created on\s*/i, "") : null;

  const fileRows = table
    .slice(headerIdx + 1)
    .map((r) => ({ item: norm(r[iItem] ?? ""), onHand: num(r[iOnHand]), rate: num(r[iRate]) }))
    .filter((r) => r.item && !/^total$/i.test(r.item));
  if (!fileRows.length) return NextResponse.json({ error: "No items found in the file." }, { status: 400 });

  // ---- Match names ----
  const admin = createAdminClient();
  const [{ data: nameRows, error: nameErr }, { data: products }, { data: dist }, { data: week }] = await Promise.all([
    admin.from("ekos_name_map").select("ekos_name, app_name, skip").eq("kind", "item"),
    admin.from("products").select("id, name").eq("active", true).order("name"),
    admin.from("distributors").select("id").eq("name", distributor).maybeSingle(),
    admin.from("weeks").select("id, label").order("week_start", { ascending: false }).limit(1).maybeSingle(),
  ]);
  if (nameErr) return NextResponse.json({ error: `Couldn't load the name lists: ${nameErr.message}` }, { status: 500 });
  if (!dist) return NextResponse.json({ error: `"${distributor}" isn't a distributor in the app.` }, { status: 500 });
  if (!week) return NextResponse.json({ error: "No week has been started yet." }, { status: 400 });

  const productByName = new Map((products ?? []).map((p) => [String(p.name).toLowerCase(), { id: p.id as string, name: p.name as string }]));
  const nameMap = new Map((nameRows ?? []).map((r) => [norm(String(r.ekos_name)), r as { app_name: string | null; skip: boolean }]));

  // Save the matches picked on the page (only for names in this file).
  const fileNames = new Set(fileRows.map((r) => r.item));
  const toSave = Object.entries(matches)
    .filter(([n, choice]) => fileNames.has(norm(n)) && (choice === SKIP || productByName.has(choice.toLowerCase())))
    .map(([n, choice]) => ({
      kind: "item",
      ekos_name: norm(n),
      app_name: choice === SKIP ? null : productByName.get(choice.toLowerCase())!.name,
      skip: choice === SKIP,
      updated_at: new Date().toISOString(),
      updated_by: profile.id,
    }));
  if (toSave.length) {
    // The name list is shared with the Ekos sync for the whole app. Someone
    // with only a distributor page can ADD a match for a name that isn't on
    // the list yet, but only people with Distributor Inventory or Inventory &
    // Allocation (or admins) can change an existing one (2026-10-22, access
    // lockdown).
    const canChangeExisting = hasAnySection(
      profile.role,
      profile.sections,
      ["distributor_inventory", "inventory_allocation"],
      profile.is_super_admin,
    );
    const { error } = await admin
      .from("ekos_name_map")
      .upsert(toSave, { onConflict: "kind,ekos_name", ignoreDuplicates: !canChangeExisting });
    if (error) return NextResponse.json({ error: `Couldn't save the matches: ${error.message}` }, { status: 500 });
    for (const r of toSave) {
      if (canChangeExisting || !nameMap.has(r.ekos_name)) nameMap.set(r.ekos_name, { app_name: r.app_name, skip: r.skip });
    }
  }

  const needs: string[] = [];
  const totals = new Map<string, { product_id: string; onHand: number; rate: number }>();
  let skipped = 0;
  for (const r of fileRows) {
    const hit = nameMap.get(r.item);
    if (hit?.skip) {
      skipped++;
      continue;
    }
    const product = hit?.app_name ? productByName.get(hit.app_name.toLowerCase()) : productByName.get(r.item.toLowerCase());
    if (!product) {
      if (!needs.includes(r.item)) needs.push(r.item);
      continue;
    }
    const t = totals.get(product.id) ?? { product_id: product.id, onHand: 0, rate: 0 };
    t.onHand += r.onHand;
    t.rate = Math.round((t.rate + r.rate) * 10000) / 10000;
    totals.set(product.id, t);
  }

  if (needs.length) {
    // Nothing saved yet — the page shows a match picker for these.
    return NextResponse.json({
      needs,
      products: (products ?? []).map((p) => p.name as string),
      items: fileRows.length,
      reportDate,
    });
  }

  // ---- Save ----
  const now = new Date().toISOString();
  const rows = [...totals.values()].map((t) => ({
    week_id: week.id,
    distributor_id: dist.id,
    product_id: t.product_id,
    on_hand_qty: t.onHand,
    rate_of_sale: t.rate, // per day, like Ekos
    source: "distributor",
    imported_at: now,
    updated_by: profile.id,
    updated_at: now,
  }));
  const { error } = await admin.from("distributor_inventory").upsert(rows, { onConflict: "week_id,distributor_id,product_id" });
  if (error) return NextResponse.json({ error: `Saving the inventory failed: ${error.message}` }, { status: 500 });

  return NextResponse.json({ ok: true, saved: rows.length, skipped, week: week.label, reportDate });
}
