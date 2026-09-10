import { redirect } from "next/navigation";
import { getProfile } from "@/lib/getProfile";
import ErnieChatClient from "@/components/ErnieChatClient";

// Ernie is available to every signed-in user, Basic or admin — the chat
// route and its tools (app/api/ernie/*, lib/ernie/tools.ts) are what
// actually restrict a Basic user to only the app data they can already see
// elsewhere. This page just requires being signed in at all.
export default async function ErniePage() {
  const profile = await getProfile();
  if (!profile) {
    redirect("/login");
  }
  const firstName =
    profile.full_name?.trim().split(/\s+/)[0] || profile.email.split("@")[0];

  // Whether this signed-in user can create Ernie Projects, manage their
  // access, and add/remove their files — Administrators and Managers
  // (role === "admin", either tier) per Chad, 2026-09-10. See
  // sql/ernie_projects.sql.
  return <ErnieChatClient firstName={firstName} canManageProjects={profile.role === "admin"} />;
}
