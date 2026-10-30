import { redirect } from "next/navigation";
import { getProfile } from "@/lib/getProfile";
import { hasSection } from "@/lib/permissions";
import { createAdminClient } from "@/lib/supabase/admin";
import BrewPlannerClient from "@/components/BrewPlannerClient";
import {
  BASES,
  MEASURED,
  ESTIMATED,
  bblPerUnit,
  brandOfProduct,
  baseOfTank,
  distName,
  commitmentBblPerWeek,
  type Commitment,
  type PlannerData,
  type Pot,
} from "@/lib/brewPlanner";

// Brew Planner (added 2026-10-23, per Chad — EXPERIMENTAL): what to brew this
// 2-week cycle and how much. Under MAIN, below Tanks and above Distributors.
// Gated by its own "Brew Planner" access (Admin → Users). Read-only: it only
// reads app data (filled by the Ekos and LilyPad syncs) on the server, after
// the access check. Math + base beers: lib/brewPlanner.ts. Plan:
// claude/brew-planner-plan.md.
export const dynamic = "force-dynamic";

type Admin = ReturnType<typeof createAdminClient>;

// Supabase returns at most 1,000 rows per call — read every page.
async function readAll<T>(make: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>): Promise<T[]> {
  const out: T[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await make(from, from + 999);
    if (error) throw new Error(error.message);
    out.push(...(data ?? []));
    if (!data || data.length < 1000) return out;
  }
}

const pacific = (x: Date, opts: Intl.DateTimeFormatOptions) => new Intl.DateTimeFormat("en-US", { timeZone: "America/Los_Angeles", ...opts }).format(x);
const isoDay = (x: Date) => new Intl.DateTimeFormat("en-CA", { timeZone: "America/Los_Angeles" }).format(x);
const ym = (x: Date) => x.toISOString().slice(0, 7);

async function gather(admin: Admin): Promise<PlannerData> {
  const now = new Date();
  const today = isoDay(now);

  const [{ data: products }, { data: distributors }, { data: meta }, { data: tankRows }, { data: weeks }] = await Promise.all([
    admin.from("products").select("id, name, active"),
    admin.from("distributors").select("id, name, active"),
    admin.from("sales_data_meta").select("as_of, imported_at").order("imported_at", { ascending: false }).limit(1).maybeSingle(),
    admin.from("ekos_tanks").select("tank_name, volume_bbl, product_name, batch_title, start_date, stage, synced_at"),
    admin.from("weeks").select("id, label, week_start, uses_record").order("week_start", { ascending: false }).limit(6),
  ]);
  const prodName = new Map((products ?? []).map((p) => [p.id as string, p.name as string]));
  const dName = new Map((distributors ?? []).map((x) => [x.id as string, distName(x.name as string)]));
  const brandOf = (productId: string) => brandOfProduct(prodName.get(productId) ?? "");
  const bpu = (productId: string) => bblPerUnit(prodName.get(productId) ?? "");

  // --- LilyPad: 3 full months before the data's as-of month + that month so far
  const asOf = meta?.as_of ? new Date(`${meta.as_of}T12:00:00Z`) : now;
  const cur = new Date(Date.UTC(asOf.getUTCFullYear(), asOf.getUTCMonth(), 1));
  const months = [3, 2, 1, 0].map((k) => ym(new Date(Date.UTC(cur.getUTCFullYear(), cur.getUTCMonth() - k, 1))));
  const daysInCur = new Date(Date.UTC(cur.getUTCFullYear(), cur.getUTCMonth() + 1, 0)).getUTCDate();
  const partialFactor = daysInCur / Math.max(1, asOf.getUTCDate());
  const lilyNames = new Map<string, string>(); // LilyPad product → brand key
  for (const b of BASES) for (const br of b.brands) for (const n of br.lily) lilyNames.set(n, br.key);
  // Recurring / New / Lost accounts per product, distributor and month — one
  // database call (sql/brew_planner_commitments.sql, same rules as the Sales Dashboard).
  const { data: potData, error: potErr } = await admin.rpc("brew_planner_account_pots", { p_products: [...lilyNames.keys()] });
  if (potErr) throw new Error(`Couldn't read LilyPad sales for the Brew Planner (has sql/brew_planner_commitments.sql been run?): ${potErr.message}`);
  const pd = (potData ?? {}) as {
    ce?: { product: string; distributor: string; pot: Pot; ym: string; keg: boolean; ce: number }[];
    accounts?: { product: string; distributor: string; pot: Pot; n: number }[];
  };
  const ce: PlannerData["lily"]["ce"] = {};
  const pots: PlannerData["lily"]["pots"] = {};
  const accounts: PlannerData["lily"]["accounts"] = {};
  const kegCe: Record<string, number> = {};
  const canCe: Record<string, number> = {};
  for (const s of pd.ce ?? []) {
    const brand = lilyNames.get(s.product);
    const i = months.indexOf(s.ym);
    if (!brand || i < 0) continue;
    const dist = distName(s.distributor ?? "");
    const v = Number(s.ce) || 0;
    ((ce[brand] ??= {})[dist] ??= [0, 0, 0, 0])[i] += v;
    (((pots[brand] ??= {})[dist] ??= { recurring: [0, 0, 0, 0], new: [0, 0, 0, 0], lost: [0, 0, 0, 0] })[s.pot] ??= [0, 0, 0, 0])[i] += v;
    if (i < 3 && dist !== "Saccani" && s.pot !== "lost") (s.keg ? kegCe : canCe)[brand] = ((s.keg ? kegCe : canCe)[brand] ?? 0) + v;
  }
  for (const a of pd.accounts ?? []) {
    const brand = lilyNames.get(a.product);
    if (!brand || !MEASURED.includes(distName(a.distributor ?? ""))) continue;
    const row = (accounts[brand] ??= { recurring: 0, new: 0, lost: 0 });
    row[a.pot] = (row[a.pot] ?? 0) + (Number(a.n) || 0);
  }

  // --- Distributor counts: each measured distributor's newest Ekos count
  const weekIds = (weeks ?? []).map((w) => w.id as string);
  const inv = weekIds.length
    ? (
        await readAll<{ week_id: string; distributor_id: string; product_id: string; on_hand_qty: number; source: string | null; imported_at: string | null; updated_at: string }>((f, t) =>
          admin.from("distributor_inventory").select("week_id, distributor_id, product_id, on_hand_qty, source, imported_at, updated_at").in("week_id", weekIds).order("id").range(f, t),
        )
      ).filter(
        // Superior: only its Ekos counts (2026-10-30). Rows from the retired
        // Monday VIP file upload are left out so old file numbers never mix in.
        (r) => dName.get(r.distributor_id) !== "Superior" || r.source === "ekos",
      )
    : [];
  const weekOrder = new Map(weekIds.map((id, i) => [id, i])); // 0 = newest
  const newestWeekFor = new Map<string, number>();
  for (const r of inv) {
    const dist = dName.get(r.distributor_id) ?? "";
    const i = weekOrder.get(r.week_id) ?? 99;
    if (i < (newestWeekFor.get(dist) ?? 99)) newestWeekFor.set(dist, i);
  }
  const distStock: PlannerData["distStock"] = {};
  const distCountAt: PlannerData["distCountAt"] = {};
  const ignored: PlannerData["ignored"] = [];
  let distSynced: string | null = null;
  for (const r of inv) {
    const dist = dName.get(r.distributor_id) ?? "";
    if ((weekOrder.get(r.week_id) ?? 99) !== newestWeekFor.get(dist)) continue;
    const br = brandOf(r.product_id);
    const bbl = (Number(r.on_hand_qty) || 0) * bpu(r.product_id);
    const at = r.imported_at ?? r.updated_at;
    if (ESTIMATED.includes(dist)) {
      // Coast stays on estimates until its own data is set up
      // (claude/brew-planner-plan.md). Superior left this list 2026-10-30.
      if (bbl) ignored.push({ what: `${dist}: ${prodName.get(r.product_id) ?? "?"} × ${Number(r.on_hand_qty)}`, bbl });
      continue;
    }
    if (!MEASURED.includes(dist) || !br) continue;
    (distStock[dist] ??= {})[br.brand] = (distStock[dist]?.[br.brand] ?? 0) + bbl;
    if (!distCountAt[dist] || at > (distCountAt[dist] as string)) distCountAt[dist] = at;
    if (!distSynced || at > distSynced) distSynced = at;
  }

  // --- Par levels (Chad, 2026-10-30: "Brew planner HAS to look at par levels, period").
  // Gap per distributor × product = par − that distributor's newest Ekos count (0 floor),
  // in bbl — the same math as the "To Brew" sheet (claude/to-brew-sheet-2026-10-30.md).
  const newestOnHand = new Map<string, number>(); // `${dist}|${product}`
  for (const r of inv) {
    const dist = dName.get(r.distributor_id) ?? "";
    if ((weekOrder.get(r.week_id) ?? 99) !== newestWeekFor.get(dist)) continue;
    const k = `${dist}|${r.product_id}`;
    newestOnHand.set(k, (newestOnHand.get(k) ?? 0) + (Number(r.on_hand_qty) || 0));
  }
  const { data: parRows, error: parErr } = await admin.from("distributor_par_levels").select("distributor_id, product_id, par_level").gt("par_level", 0);
  if (parErr) throw new Error(`Couldn't read par levels for the Brew Planner: ${parErr.message}`);
  const pars: PlannerData["pars"] = {};
  const parSeen = new Map<string, { dist: string; product: string; par: number; onHand: number; gap: number; base: string }>();
  for (const r of (parRows ?? []) as { distributor_id: string; product_id: string; par_level: number }[]) {
    const br = brandOf(r.product_id);
    if (!br) continue;
    const dist = dName.get(r.distributor_id) ?? "";
    const k = `${dist}|${r.product_id}`;
    const x = parSeen.get(k) ?? { dist, product: prodName.get(r.product_id) ?? "?", par: 0, onHand: newestOnHand.get(k) ?? 0, gap: 0, base: br.base };
    x.par += Number(r.par_level) || 0; // split distributor records ("Markstein Cans") add into one
    parSeen.set(k, x);
  }
  for (const [k, x] of parSeen) {
    const u = bblPerUnit(x.product);
    x.gap = Math.max(x.par - x.onHand, 0) * u;
    (pars[x.base] ??= []).push({ dist: x.dist, product: x.product, par: x.par * u, onHand: x.onHand * u, gap: x.gap });
    void k;
  }

  // --- This week's orders on Inventory & Allocation (active distributors only — the
  // old "Markstein Cans" / "Matagrano Cans" / "Valley Wide Cans" records are inactive,
  // hidden on that page, and still hold copied-forward lines).
  const activeDist = new Set((distributors ?? []).filter((x) => (x as { active?: boolean }).active !== false).map((x) => x.id as string));
  const thisWeek = (weeks ?? [])[0] as { id: string; label: string } | undefined;
  const onOrder: PlannerData["onOrder"] = {};
  if (thisWeek) {
    const wa = await readAll<{ distributor_id: string; product_id: string; quantity: number }>((f, t) =>
      admin.from("allocations").select("distributor_id, product_id, quantity").eq("week_id", thisWeek.id).gt("quantity", 0).order("id").range(f, t),
    );
    for (const a of wa) {
      if (!activeDist.has(a.distributor_id)) continue;
      const br = brandOf(a.product_id);
      if (!br) continue;
      const dist = dName.get(a.distributor_id) ?? "";
      const row = (onOrder[br.base] ??= {});
      row[dist] = (row[dist] ?? 0) + (Number(a.quantity) || 0) * bpu(a.product_id);
    }
  }

  // --- Delivered POs in the last 10 weeks → what each distributor was shipped
  const windowStart = isoDay(new Date(now.getTime() - 70 * 864e5));
  const { data: pos } = await admin
    .from("distributor_pos")
    .select("week_id, distributor_id, delivery_date")
    .eq("po_status", "delivered")
    .gte("delivery_date", windowStart);
  const delivered = (pos ?? []) as { week_id: string; distributor_id: string; delivery_date: string }[];
  const shipments: PlannerData["shipments"] = {};
  if (delivered.length) {
    const alloc = await readAll<{ week_id: string; distributor_id: string; product_id: string; quantity: number }>((f, t) =>
      admin
        .from("allocations")
        .select("week_id, distributor_id, product_id, quantity")
        .in("week_id", [...new Set(delivered.map((p) => p.week_id))])
        .order("id")
        .range(f, t),
    );
    for (const p of delivered) {
      const items: Record<string, number> = {};
      for (const a of alloc) {
        if (a.week_id !== p.week_id || a.distributor_id !== p.distributor_id) continue;
        const br = brandOf(a.product_id);
        if (br) items[br.brand] = (items[br.brand] ?? 0) + (Number(a.quantity) || 0) * bpu(a.product_id);
      }
      const dist = dName.get(p.distributor_id) ?? "";
      (shipments[dist] ??= []).push({ date: String(p.delivery_date).slice(0, 10), items });
    }
  }

  // --- Our warehouse: this week's Inventory & Allocation (on hand + unlabeled
  // + to be packaged) minus what this week's delivered POs already took out.
  const warehouse: Record<string, number> = {};
  const week = (weeks ?? [])[0] as { id: string; label: string } | undefined;
  let whUpdated: string | null = null;
  if (week) {
    const [{ data: whRows }, { data: weekPos }, { data: snap }] = await Promise.all([
      admin.from("inventory_with_remaining").select("product_id, on_hand, unlabeled, to_be_packaged").eq("week_id", week.id),
      admin.from("distributor_pos").select("distributor_id, po_status").eq("week_id", week.id),
      admin.from("inventory_snapshots").select("updated_at").eq("week_id", week.id).order("updated_at", { ascending: false }).limit(1).maybeSingle(),
    ]);
    whUpdated = (snap?.updated_at as string) ?? null;
    // Running record weeks (from 10/26/2026): on_hand already has delivered
    // orders taken out, and "to be packaged" is info only — Ekos packaging
    // adds it to on_hand once it's packaged (and it's still counted in the tank).
    const usesRecord = !!(week as { uses_record?: boolean } | undefined)?.uses_record;
    const deliveredDists = new Set(
      usesRecord
        ? []
        : ((weekPos ?? []) as { distributor_id: string; po_status: string | null }[]).filter((p) => p.po_status === "delivered").map((p) => p.distributor_id)
    );
    const out = new Map<string, number>();
    if (deliveredDists.size) {
      const { data: wa } = await admin.from("allocations").select("distributor_id, product_id, quantity").eq("week_id", week.id).in("distributor_id", [...deliveredDists]);
      for (const a of (wa ?? []) as { product_id: string; quantity: number }[]) out.set(a.product_id, (out.get(a.product_id) ?? 0) + (Number(a.quantity) || 0));
    }
    for (const r of (whRows ?? []) as { product_id: string; on_hand: number; unlabeled: number; to_be_packaged: number }[]) {
      const br = brandOf(r.product_id);
      if (!br) continue;
      const units = Math.max(0, (Number(r.on_hand) || 0) + (Number(r.unlabeled) || 0) + (usesRecord ? 0 : Number(r.to_be_packaged) || 0) - (out.get(r.product_id) ?? 0));
      warehouse[br.brand] = (warehouse[br.brand] ?? 0) + units * bpu(r.product_id);
    }
  }

  // --- Tanks
  const tanks: PlannerData["tanks"] = [];
  let emptyTanks = 0;
  let tanksSynced: string | null = null;
  for (const t of (tankRows ?? []) as { tank_name: string; volume_bbl: number; product_name: string | null; batch_title: string | null; start_date: string | null; stage: string | null; synced_at: string }[]) {
    if (!tanksSynced || t.synced_at > tanksSynced) tanksSynced = t.synced_at;
    if (!/^(FV|CID)/i.test(t.tank_name)) continue;
    const bbl = Number(t.volume_bbl) || 0;
    if (bbl <= 0.05) {
      emptyTanks++;
      continue;
    }
    const base = baseOfTank(t.batch_title, t.product_name);
    if (!base) continue;
    tanks.push({
      tank: t.tank_name,
      base,
      bbl,
      start: t.start_date,
      stage: t.stage,
      label: [t.product_name, t.batch_title].filter(Boolean).join(" · "),
    });
  }

  const when = (iso: string | null) => (iso ? pacific(new Date(iso), { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }) : "—");
  const fresh: PlannerData["fresh"] = [
    {
      label: "LilyPad",
      value: `synced ${when(meta?.imported_at ?? null)} · newest sale ${meta?.as_of ? pacific(new Date(`${meta.as_of}T12:00:00Z`), { month: "short", day: "numeric" }) : "—"}`,
      old: false,
    },
    // Same order as the Base beers columns (2026-10-30, Chad: the chips showed
    // our warehouse "but doesnt show our tanks" — it was labeled "Ekos tanks").
    { label: "Distributor counts", value: `from Ekos, synced ${when(distSynced)}`, old: false },
    { label: "Our warehouse", value: `${week?.label ?? "—"}, last updated ${when(whUpdated)}`, old: !!whUpdated && now.getTime() - new Date(whUpdated).getTime() > 8 * 864e5 },
    // Ekos tank sync runs every morning; orange if it hasn't run in over a day.
    { label: "Our tanks", value: `from Ekos, synced ${when(tanksSynced)}`, old: !tanksSynced || now.getTime() - new Date(tanksSynced).getTime() > 864e5 + 4 * 36e5 },
  ];

  // --- Commitments (entered on this page) + the products they can be for
  const { data: cRows } = await admin
    .from("brew_planner_commitments")
    .select("id, account, distributor, product_id, qty, per, start_date, end_date, note")
    .order("start_date", { ascending: true });
  const commitments: Commitment[] = ((cRows ?? []) as Omit<Commitment, "product" | "base" | "brand" | "bblPerWeek">[]).map((c) => {
    const name = prodName.get(c.product_id) ?? "?";
    const br = brandOfProduct(name);
    return { ...c, qty: Number(c.qty) || 0, product: name, base: br?.base ?? null, brand: br?.brand ?? null, bblPerWeek: commitmentBblPerWeek(Number(c.qty) || 0, c.per, name) };
  });
  const planProducts = ((products ?? []) as { id: string; name: string; active?: boolean }[])
    .filter((p) => p.active !== false)
    .map((p) => ({ id: p.id, name: p.name, br: brandOfProduct(p.name) }))
    .filter((p) => p.br && bblPerUnit(p.name) > 0)
    .map((p) => ({ id: p.id, name: p.name, base: p.br!.base, brand: p.br!.brand }))
    .sort((a, b) => a.name.localeCompare(b.name));

  return {
    today,
    commitments,
    pars,
    onOrder,
    ordersWeek: thisWeek?.label ?? null,
    products: planProducts,
    lily: { months, partialFactor, ce, pots, accounts, kegCe, canCe },
    distStock,
    distCountAt,
    shipments,
    windowStart,
    warehouse,
    warehouseWeek: week?.label ?? null,
    tanks,
    emptyTanks,
    ignored,
    fresh,
  };
}

export default async function BrewPlannerPage() {
  const profile = await getProfile();
  if (!profile || !hasSection(profile.role, profile.sections, "brew_planner", profile.is_super_admin)) redirect("/");
  const data = await gather(createAdminClient());
  return <BrewPlannerClient data={data} />;
}
