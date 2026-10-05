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

  const { data } = await createAdminClient()
    .from("ekos_tanks")
    .select(
      "tank_name, volume_bbl, product_code, batch_title, product_name, color, start_date, stage, yeast_in_cone, dry_hop, temp_f, temp_at, overdue, tasks_left, synced_at",
    );
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
  return <TanksClient live={live} syncedLabel={syncedLabel} />;
}
