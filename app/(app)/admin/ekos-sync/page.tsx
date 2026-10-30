import { redirect } from "next/navigation";
import { getProfile } from "@/lib/getProfile";
import { hasSection } from "@/lib/permissions";
import { SYNC_SOURCES } from "@/lib/syncs/autoSyncs";
import EkosSyncClient from "@/components/EkosSyncClient";

// Admin → Ekos Sync (added 2026-10-03). Since 2026-10-29: the "ekos_sync"
// section — Administrators always, a Manager only if granted. Plan:
// claude/ekos-auto-sync-plan.md.
export default async function EkosSyncPage() {
  const profile = await getProfile();
  if (!profile || profile.role !== "admin" || !hasSection(profile.role, profile.sections, "ekos_sync", profile.is_super_admin)) redirect("/");

  const sources = SYNC_SOURCES.map((s) => ({
    key: s.key,
    label: s.label,
    description: s.description,
    built: !!s.run,
  }));
  return <EkosSyncClient sources={sources} />;
}
