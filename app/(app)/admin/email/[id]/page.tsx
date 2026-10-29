import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import EmailDesignerClient, { type DesignFull } from "@/components/EmailDesignerClient";
import type { CreativeAsset } from "@/lib/creativeAssets";

// Admin → Email Studio → one email in the drag-and-drop designer (added
// 2026-10-29, Phase 1 of claude/email-designer-plan.md). Access: the
// "email_studio" section (../layout.tsx).
export const dynamic = "force-dynamic";

export default async function EmailDesignPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();
  const [{ data: design }, { data: assets }] = await Promise.all([
    supabase
      .from("email_designs")
      .select("id, name, subject, preheader, project_data, html, status, updated_at")
      .eq("id", id)
      .maybeSingle(),
    supabase.from("creative_assets").select("*").order("created_at", { ascending: false }).limit(2000),
  ]);
  if (!design) notFound();

  return <EmailDesignerClient design={design as DesignFull} assets={(assets ?? []) as CreativeAsset[]} />;
}
