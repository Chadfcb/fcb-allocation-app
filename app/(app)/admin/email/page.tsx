import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { firstNameFor } from "@/lib/displayName";
import EmailStudioClient, { type DesignRow, type AssetRow } from "@/components/EmailStudioClient";
import type { ListRow } from "@/components/EmailAudienceTab";
import type { CampaignRow } from "@/components/EmailSentTab";
import { DAILY_CAP, sentToday } from "@/lib/email/queue";

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

  // Audience + Sent tabs (Phase 5, 2026-10-30).
  const admin = createAdminClient();
  const [{ data: listRows }, { count: suppressionCount }, { count: accountEmailCount }, { data: campaignRows }] = await Promise.all([
    supabase.from("email_lists").select("id, name, source, created_at").order("created_at", { ascending: false }),
    supabase.from("email_suppressions").select("email", { count: "exact", head: true }),
    // Account contacts with an email (server key — Eddie doesn't have Accounts).
    admin.from("sales_account_contacts").select("id", { count: "exact", head: true }).not("email", "is", null),
    supabase
      .from("email_campaigns")
      .select("id, name, subject, status, scheduled_for, recipient_count, sent_count, failed_count, created_at, created_by")
      .order("created_at", { ascending: false })
      .limit(100),
  ]);
  const lists: ListRow[] = await Promise.all(
    (listRows ?? []).map(async (l) => {
      const { count } = await supabase.from("email_list_members").select("email", { count: "exact", head: true }).eq("list_id", l.id);
      return { ...(l as Omit<ListRow, "member_count">), member_count: count ?? 0 };
    }),
  );
  const campaignIds = (campaignRows ?? []).map((c) => c.id);
  const statsById: Record<string, CampaignRow["stats"]> = {};
  if (campaignIds.length) {
    const { data: stats } = await supabase.from("email_campaign_stats").select("*").in("campaign_id", campaignIds);
    for (const st of stats ?? []) statsById[st.campaign_id] = st;
  }

  // Who last edited each design / sent each email (names only — read with the
  // server key so it works for people who can't see the Users list).
  const ids = [
    ...new Set([...(designs ?? []).map((d) => d.updated_by), ...(campaignRows ?? []).map((c) => c.created_by)].filter(Boolean)),
  ] as string[];
  const names: Record<string, string> = {};
  if (ids.length) {
    const { data: people } = await admin.from("profiles").select("id, full_name, email").in("id", ids);
    for (const p of people ?? []) names[p.id] = firstNameFor(p);
  }

  const todayCount = await sentToday(admin).catch(() => 0);

  const loadError = designsError?.message ?? assetsError?.message ?? null;

  return (
    <EmailStudioClient
      designs={(designs ?? []).map((d) => ({ ...d, updated_by_name: d.updated_by ? names[d.updated_by] ?? null : null })) as DesignRow[]}
      assets={(assets ?? []) as AssetRow[]}
      loadError={loadError}
      lists={lists}
      suppressionCount={suppressionCount ?? 0}
      accountEmailCount={accountEmailCount ?? null}
      campaigns={(campaignRows ?? []).map((c) => ({
        ...(c as Omit<CampaignRow, "stats" | "created_by_name">),
        created_by_name: c.created_by ? names[c.created_by] ?? null : null,
        stats: statsById[c.id] ?? null,
      }))}
      sentToday={todayCount}
      dailyCap={DAILY_CAP}
    />
  );
}
