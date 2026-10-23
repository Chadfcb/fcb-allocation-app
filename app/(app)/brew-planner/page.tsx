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
  type PlannerData,
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
    admin.from("products").select("id, name"),
    admin.from("distributors").select("id, name"),
    admin.from("sales_data_meta").select("as_of, imported_at").order("imported_at", { ascending: false }).limit(1).maybeSingle(),
    admin.from("ekos_tanks").select("tank_name, volume_bbl, product_name, batch_title, start_date, stage, synced_at"),
    admin.from("weeks").select("id, label, week_start").order("week_start", { ascending: false }).limit(6),
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
  const sales = await readAll<{ product: string; package: string | null; distributor: string; month: string; ce: number }>((f, t) =>
    admin
      .from("sales_account_sales")
      .select("product, package, distributor, month, ce")
      .gte("month", `${months[0]}-01`)
      .in("product", [...lilyNames.keys()])
      .order("id")
      .range(f, t),
  );
  const ce: PlannerData["lily"]["ce"] = {};
  const kegCe: Record<string, number> = {};
  const canCe: Record<string, number> = {};
  for (const s of sales) {
    const brand = lilyNames.get(s.product);
    const i = months.indexOf(String(s.month).slice(0, 7));
    if (!brand || i < 0) continue;
    const dist = distName(s.distributor ?? "");
    const v = ((ce[brand] ??= {})[dist] ??= [0, 0, 0, 0]);
    v[i] += Number(s.ce) || 0;
    if (i < 3 && dist !== "Saccani") {
      const keg = /keg|1\/2|1\/6|bbl/i.test(s.package ?? "");
      (keg ? kegCe : canCe)[brand] = ((keg ? kegCe : canCe)[brand] ?? 0) + (Number(s.ce) || 0);
    }
  }

  // --- Distributor counts: each measured distributor's newest Ekos count
  const weekIds = (weeks ?? []).map((w) => w.id as string);
  const inv = weekIds.length
    ? await readAll<{ week_id: string; distributor_id: string; product_id: string; on_hand_qty: number; imported_at: string | null; updated_at: string }>((f, t) =>
        admin.from("distributor_inventory").select("week_id, distributor_id, product_id, on_hand_qty, imported_at, updated_at").in("week_id", weekIds).order("id").range(f, t),
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
      // Superior / Coast stay on estimates until their own data is set up
      // (claude/brew-planner-plan.md — Superior's one Ekos row didn't fit).
      if (bbl) ignored.push({ what: `${dist}: ${prodName.get(r.product_id) ?? "?"} × ${Number(r.on_hand_qty)}`, bbl });
      continue;
    }
    if (!MEASURED.includes(dist) || !br) continue;
    (distStock[dist] ??= {})[br.brand] = (distStock[dist]?.[br.brand] ?? 0) + bbl;
    if (!distCountAt[dist] || at > (distCountAt[dist] as string)) distCountAt[dist] = at;
    if (!distSynced || at > distSynced) distSynced = at;
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
    const deliveredDists = new Set(((weekPos ?? []) as { distributor_id: string; po_status: string | null }[]).filter((p) => p.po_status === "delivered").map((p) => p.distributor_id));
    const out = new Map<string, number>();
    if (deliveredDists.size) {
      const { data: wa } = await admin.from("allocations").select("distributor_id, product_id, quantity").eq("week_id", week.id).in("distributor_id", [...deliveredDists]);
      for (const a of (wa ?? []) as { product_id: string; quantity: number }[]) out.set(a.product_id, (out.get(a.product_id) ?? 0) + (Number(a.quantity) || 0));
    }
    for (const r of (whRows ?? []) as { product_id: string; on_hand: number; unlabeled: number; to_be_packaged: number }[]) {
      const br = brandOf(r.product_id);
      if (!br) continue;
      const units = Math.max(0, (Number(r.on_hand) || 0) + (Number(r.unlabeled) || 0) + (Number(r.to_be_packaged) || 0) - (out.get(r.product_id) ?? 0));
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
    { label: "Ekos tanks", value: `synced ${when(tanksSynced)}`, old: false },
    { label: "Distributor counts", value: `from Ekos, synced ${when(distSynced)}`, old: false },
    { label: "Our warehouse", value: `${week?.label ?? "—"}, last updated ${when(whUpdated)}`, old: !!whUpdated && now.getTime() - new Date(whUpdated).getTime() > 8 * 864e5 },
  ];

  return {
    today,
    lily: { months, partialFactor, ce, kegCe, canCe },
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
