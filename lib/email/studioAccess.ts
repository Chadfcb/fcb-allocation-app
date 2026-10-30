import { getProfile, type ProfileWithSections } from "@/lib/getProfile";
import { hasSection } from "@/lib/permissions";

/** Email Studio API gate: the signed-in person with the email_studio section, or null. */
export async function emailStudioProfile(): Promise<ProfileWithSections | null> {
  const profile = await getProfile();
  if (!profile || !hasSection(profile.role, profile.sections, "email_studio", profile.is_super_admin)) return null;
  return profile;
}
