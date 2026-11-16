import { timingSafeEqual } from "node:crypto";
import { createAdminClient } from "@/lib/supabase/admin";

// Distributor on-hand feed for the "To Brew" Google Sheet (added 2026-11-16,
// per Chad: "yes" — an Update On Hand button in the sheet that fills ONLY the
// On Hand column on each Rec Orders tab from the distributor inventories in
// FCB-Data; nothing else in the sheet changes).
//
// The sheet's Apps Script calls this with the private key in an
// "x-fcb-key" header. No login (exempt in proxy.ts) — the key is the lock.
//   Vercel env: SHEETS_FEED_KEY — any long random text Chad picks; the same
//   text is saved once in the sheet (FCB-Data menu → Set FCB-Data key).
//   No key set in Vercel → the feed is off (503).
//
// Returns each active distributor's NEWEST inventory report (same rule as the
// distributor pages' On Hand block: the newest week that has a report):
//   { distributors: [{ name, week, updated_at, source, items: [{ product, on_hand }] }] }
// Read-only. Only product names + on-hand counts — no prices, accounts or people.
export const dynamic = "force-dynamic";

function keyOk(given: string | null, expected: string): boolean {
  if (!given) return false;
  const a = Buffer.from(given);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

export async function GET(request: Request) {
  const expected = process.env.SHEETS_FEED_KEY;
  if (!expected) return Response.json({ error: "The sheet feed is turned off (SHEETS_FEED_KEY isn't set in Vercel)." }, { status: 503 });
  if (!keyOk(request.headers.get("x-fcb-key"), expected)) {
    return Response.json({ error: "Wrong or missing FCB-Data key." }, { status: 403 });
  }

  const admin = createAdminClient();
  const { data: dists, error: dErr } = await admin.from("distributors").select("id, name").eq("active", true).order("name");
  if (dErr) return Response.json({ error: `Couldn't read distributors: ${dErr.message}` }, { status: 500 });

  const out: {
    name: string;
    week: string | null;
    updated_at: string | null;
    source: string | null;
    items: { product: string; on_hand: number }[];
  }[] = [];

  // Weeks, newest first — to find each distributor's newest report.
  const { data: weeks, error: wErr } = await admin.from("weeks").select("id, label, week_start").order("week_start", { ascending: false });
  if (wErr) return Response.json({ error: `Couldn't read weeks: ${wErr.message}` }, { status: 500 });
  const weekOrder = new Map((weeks ?? []).map((w, i) => [w.id as string, i]));

  for (const d of dists ?? []) {
    const { data: wk_ids, error: kErr } = await admin.from("distributor_inventory").select("week_id").eq("distributor_id", d.id);
    if (kErr) return Response.json({ error: `Couldn't read ${d.name}'s inventory: ${kErr.message}` }, { status: 500 });
    let best: string | null = null;
    for (const r of wk_ids ?? []) {
      const id = r.week_id as string;
      if (weekOrder.has(id) && (best === null || (weekOrder.get(id) as number) < (weekOrder.get(best) as number))) best = id;
    }
    if (!best) {
      out.push({ name: d.name, week: null, updated_at: null, source: null, items: [] });
      continue;
    }
    const wk = (weeks ?? [])[weekOrder.get(best) as number];
    const row = { week_id: best };
    const { data: inv, error: iErr } = await admin
      .from("distributor_inventory")
      .select("on_hand_qty, source, imported_at, updated_at, products!inner(name)")
      .eq("distributor_id", d.id)
      .eq("week_id", row.week_id);
    if (iErr) return Response.json({ error: `Couldn't read ${d.name}'s inventory: ${iErr.message}` }, { status: 500 });

    let latest: string | null = null;
    let source: string | null = null;
    const items: { product: string; on_hand: number }[] = [];
    for (const r of (inv ?? []) as {
      on_hand_qty: number | string | null;
      source: string | null;
      imported_at: string | null;
      updated_at: string | null;
      products: { name: string } | { name: string }[];
    }[]) {
      const p = Array.isArray(r.products) ? r.products[0] : r.products;
      if (!p?.name) continue;
      items.push({ product: p.name, on_hand: Number(r.on_hand_qty) || 0 });
      const when = r.imported_at ?? r.updated_at;
      if (when && (!latest || when > latest)) {
        latest = when;
        source = r.source;
      }
    }
    items.sort((a, b) => a.product.localeCompare(b.product));
    out.push({ name: d.name, week: wk?.label ?? null, updated_at: latest, source, items });
  }

  return Response.json({ generated_at: new Date().toISOString(), distributors: out }, { headers: { "Cache-Control": "no-store" } });
}
