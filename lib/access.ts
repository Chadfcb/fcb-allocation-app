import { redirect } from "next/navigation";
import { getProfile, type ProfileWithSections } from "@/lib/getProfile";
import { hasAnySection, hasSection, ERNIE_SECTION, type AnySectionKey } from "@/lib/permissions";
import {
  MAIN_LINKS,
  OPERATIONS_LINKS,
  FINANCE_LINKS,
  SALES_LINKS,
  DISTRIBUTOR_LINKS,
  CALENDARS_LINKS,
  POS_LINKS,
  ADMIN_LINKS,
  POS_LABEL_BRANDS,
  UPC_BRANDS,
} from "@/lib/appPages";

// Access lockdown (2026-10-22, per Chad): "nobody should be able to see
// anything unless given access to it in the app". Every page checks access
// on the SERVER before anything is drawn — typing an address you weren't
// given sends you to your home page (or the "no access" page) instead of
// showing an empty page. The database rules (sql/access_lockdown.sql) are
// the real lock on the data; this keeps the pages themselves closed too.

/** Server-side gate for a page or layout. "admin" = admins only; otherwise
 *  the person needs ANY of the listed sections. Returns the profile. */
export async function requireAccess(need: "admin" | AnySectionKey[]): Promise<ProfileWithSections> {
  const profile = await getProfile();
  if (!profile) redirect("/login");
  const ok =
    need === "admin"
      ? profile.role === "admin"
      : hasAnySection(profile.role, profile.sections, need, profile.is_super_admin);
  if (!ok) redirect("/");
  return profile;
}

/** For server routes: true if the signed-in person has any of these sections. */
export async function apiHasAccess(need: "admin" | AnySectionKey[]): Promise<boolean> {
  const profile = await getProfile();
  if (!profile) return false;
  return need === "admin"
    ? profile.role === "admin"
    : hasAnySection(profile.role, profile.sections, need, profile.is_super_admin);
}

/** Where a person lands after sign-in: the Operations Dashboard for admins,
 *  Inventory & Allocation for anyone who has it (same as always), otherwise
 *  the first page they've been given, in sidebar order — or /no-access. */
export function homeFor(profile: ProfileWithSections | null): string {
  if (!profile) return "/login";
  if (profile.role === "admin") return "/dashboard";
  const can = (s: AnySectionKey) => hasSection(profile.role, profile.sections, s, profile.is_super_admin);
  if (can("inventory_allocation")) return "/inventory";
  // Distributor-only reps (e.g. Steve → Matagrano) land on their page.
  for (const l of DISTRIBUTOR_LINKS) if (can(l.section)) return l.href;
  for (const l of MAIN_LINKS) if (l.section !== null && can(l.section)) return l.href;
  for (const l of [...FINANCE_LINKS, ...OPERATIONS_LINKS, ...SALES_LINKS, ...CALENDARS_LINKS, ...POS_LINKS]) {
    if (can(l.section)) return l.href;
  }
  if (can("pos_labels") && POS_LABEL_BRANDS[0]?.sizes[0]) return POS_LABEL_BRANDS[0].sizes[0].href;
  if (can("upcs") && UPC_BRANDS[0]?.sizes[0]) return UPC_BRANDS[0].sizes[0].href;
  for (const l of ADMIN_LINKS) if (l.section && can(l.section)) return l.href;
  if (can(ERNIE_SECTION)) return "/ernie";
  return "/no-access";
}
