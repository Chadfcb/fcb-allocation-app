import { getProfile } from "@/lib/getProfile";
import { hasSection } from "@/lib/permissions";
import { createAdminClient } from "@/lib/supabase/admin";
import { checkRepliesIfDue } from "@/lib/email/replies";

// Email Studio → Replies → "Check now" (added 2026-11-25). Same check the
// hourly timer runs (lib/email/replies.ts), right away. Email Studio access only.
export const dynamic = "force-dynamic";
export const maxDuration = 120;

export async function POST() {
  const profile = await getProfile();
  if (!profile || !hasSection(profile.role, profile.sections, "email_studio", profile.is_super_admin)) {
    return Response.json({ error: "No access" }, { status: 403 });
  }
  const result = await checkRepliesIfDue(createAdminClient(), { force: true });
  return Response.json(result);
}
