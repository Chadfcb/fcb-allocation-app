import { notFound, redirect } from "next/navigation";
import { getProfile } from "@/lib/getProfile";
import { hasSection } from "@/lib/permissions";
import { createClient } from "@/lib/supabase/server";
import { vipCodeBrandBySlug, type VipItemCode } from "@/lib/vipItemCodes";
import VipItemCodesClient from "@/components/VipItemCodesClient";

// Sales → VIP Item Codes → <brand> (added 2026-11-06, per Chad). One page per
// brand, each gated by its own checkbox on Admin → Users → Edit access
// (vip_codes_fcb, vip_codes_speakeasy, vip_codes_sonoma_cider). Read-only
// table + Download. SQL: sql/vip_item_codes.sql.
export const dynamic = "force-dynamic";

export default async function VipItemCodesPage({ params }: { params: Promise<{ brand: string }> }) {
  const { brand } = await params;
  const page = vipCodeBrandBySlug(brand);
  if (!page) notFound();
  const profile = await getProfile();
  if (!profile || !hasSection(profile.role, profile.sections, page.section, profile.is_super_admin)) redirect("/");

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("vip_item_codes")
    .select("id, brand, item, supplier_item_code, vip_item_id, sort_order")
    .eq("brand", page.brand)
    .order("sort_order", { ascending: true });

  return (
    <VipItemCodesClient
      brandName={page.name}
      rows={(data ?? []) as VipItemCode[]}
      loadError={error ? error.message : null}
    />
  );
}
