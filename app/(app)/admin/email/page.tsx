import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { firstNameFor } from "@/lib/displayName";
import EmailStudioClient, { type DesignRow, type AssetRow } from "@/components/EmailStudioClient";

// Admin → Email Studio (added 2026-10-29, per Chad — Phase 1 of
// claude/email-designer-plan.md): Eddie's saved email designs and his
// Creative Library. Access: the "email_studio" section (layout.tsx).
export const dynamic = "force-dynamic";

export default async function EmailStudioPage() {
  const supabase = await createClient();
  const [{ data: designs, error: designsError }, { data: assets, error: assetsError }] = await Promise.all([
    supabase
      .from("email_designs")
      .select("id, name, subject, status, updated_at, updated_by")
      .neq("status", "archived")
      .order("updated_at", { ascending: false }),
    supabase.from("creative_assets").select("*").order("created_at", { ascending: false }).limit(2000),
  ]);

  // Who last edited each design (names only — read with the server key so it
  // works for people who can't see the Users list).
  const ids = [...new Set((designs ?? []).map((d) => d.updated_by).filter(Boolean))] as string[];
  const names: Record<string, string> = {};
  if (ids.length) {
    const { data: people } = await createAdminClient().from("profiles").select("id, full_name, email").in("id", ids);
    for (const p of people ?? []) names[p.id] = firstNameFor(p);
  }

  const loadError = designsError?.message ?? assetsError?.message ?? null;

  return (
    <EmailStudioClient
      designs={(designs ?? []).map((d) => ({ ...d, updated_by_name: d.updated_by ? names[d.updated_by] ?? null : null })) as DesignRow[]}
      assets={(assets ?? []) as AssetRow[]}
      loadError={loadError}
    />
  );
}
