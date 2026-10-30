import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { firstNameFor } from "@/lib/displayName";
import { cleanSettings } from "@/lib/ageCheck";
import AgeCheckEditorClient, { type LibraryImage } from "@/components/AgeCheckEditorClient";

// Admin → Age Check (added 2026-10-30, per Chad): edit the 21+ birth-date
// check on FCB's websites. lib/ageCheck.ts explains how it works.
export const dynamic = "force-dynamic";

export default async function AgeCheckPage() {
  const supabase = await createClient();
  const { data: row, error } = await supabase.from("site_age_check").select("settings, updated_at, updated_by").eq("id", 1).maybeSingle();

  // Creative Library pictures to pick logos/backgrounds from (server key, so
  // it works for people with Age Check but not Email Studio).
  const admin = createAdminClient();
  const { data: assets } = await admin
    .from("creative_assets")
    .select("id, name, public_url, mime_type, width, height")
    .in("mime_type", ["image/png", "image/jpeg", "image/webp", "image/gif", "image/svg+xml"])
    .order("created_at", { ascending: false })
    .limit(500);

  let updatedByName: string | null = null;
  if (row?.updated_by) {
    const { data: p } = await admin.from("profiles").select("id, full_name, email").eq("id", row.updated_by).maybeSingle();
    if (p) updatedByName = firstNameFor(p);
  }

  return (
    <AgeCheckEditorClient
      initial={cleanSettings(row?.settings ?? {})}
      hasSaved={!!row?.settings && Object.keys(row.settings as object).length > 0}
      updatedAt={row?.updated_at ?? null}
      updatedByName={updatedByName}
      library={(assets ?? []) as LibraryImage[]}
      loadError={error?.message ?? (row ? null : "The Age Check table isn't set up yet — run sql/age_check.sql in Supabase.")}
    />
  );
}
