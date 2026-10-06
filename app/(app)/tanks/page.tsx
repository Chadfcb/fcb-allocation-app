import { redirect } from "next/navigation";
import { getProfile } from "@/lib/getProfile";
import { hasSection } from "@/lib/permissions";
import { createAdminClient } from "@/lib/supabase/admin";
import TanksClient, { type LiveTank } from "@/components/TanksClient";

// Tanks (added 2026-10-03, per Chad) — 3D "x-ray" view of every unitank in
// the cellar. Sits under MAIN, right below Dashboard. Gated by its own
// "Tanks" access on Admin → Users (2026-10-03, per Chad: "It needs to be
// gated as well") — admins always have it, everyone else only when checked.
// Design notes: claude/tank-view-direction.md and claude/tank-floor-layout.md.
//
// Live data (2026-10-05): the automatic Ekos sync ("Ekos — Tanks") fills
// table ekos_tanks each weekday morning (claude/tank-sync-plan.md). Read here
// on the server, after the access check, and handed to the 3D view. Until
// the first sync has run, the page shows the Oct 3 snapshot + samples.
export const dynamic = "force-dynamic";

export default async function TanksPage() {
  const profile = await getProfile();
  if (!profile || !hasSection(profile.role, profile.sections, "tanks", profile.is_super_admin)) redirect("/");

  const admin = createAdminClient();
  const [{ data }, { data: week }] = await Promise.all([
    admin
      .from("ekos_tanks")
      .select(
        "tank_name, volume_bbl, product_code, batch_title, product_name, color, start_date, stage, yeast_in_cone, dry_hop, temp_f, temp_at, overdue, tasks_left, batch_details, synced_at",
      ),
    // current week = the newest one, same as Inventory & Allocation opens to
    admin.from("weeks").select("id").order("week_start", { ascending: false }).limit(1).maybeSingle(),
  ]);
  // Keg, can and lid pallets (Chad, 2026-10-06 — claude/tanks-keg-pallets-plan.md,
  // tanks-can-pallets-plan.md, tanks-lid-pallets-plan.md): On Hand from Inventory &
  // Allocation → Packaging Inventory for the current week, read fresh every time this page
  // opens (no sync needed — it's the app's own data).
  let kegs: { half: number; sixth: number } | null = null;
  let cans: { c19: number; c16: number; c12: number } | null = null;
  let lids: number | null = null;
  if (week) {
    const { data: rows } = await admin
      .from("packaging_inventory")
      .select("item_key, on_hand_qty")
      .eq("week_id", week.id)
      .in("item_key", ["kegs_1_2bbl", "kegs_1_6bbl", "cans_19_2oz", "cans_16oz", "cans_12oz", "lids_202"]);
    const onHand = (key: string) => Math.max(0, Number((rows ?? []).find((r) => r.item_key === key)?.on_hand_qty) || 0);
    kegs = { half: onHand("kegs_1_2bbl"), sixth: onHand("kegs_1_6bbl") };
    cans = { c19: onHand("cans_19_2oz"), c16: onHand("cans_16oz"), c12: onHand("cans_12oz") };
    lids = onHand("lids_202");
  }
  const live = ((data ?? []) as LiveTank[]).map((t) => ({
    ...t,
    volume_bbl: Number(t.volume_bbl) || 0,
    temp_f: t.temp_f === null ? null : Number(t.temp_f),
  }));
  const newest = live.reduce<string | null>((a, t) => (!a || t.synced_at > a ? t.synced_at : a), null);
  const syncedLabel = newest
    ? new Intl.DateTimeFormat("en-US", {
        timeZone: "America/Los_Angeles",
        month: "short",
        day: "numeric",
        hour: "numeric",
        minute: "2-digit",
      }).format(new Date(newest))
    : null;
  // Preview controls under the 3D view are for admins only (Chad, 2026-10-05).
  return <TanksClient live={live} kegs={kegs} cans={cans} lids={lids} syncedLabel={syncedLabel} isAdmin={profile.role === "admin"} />;
}
