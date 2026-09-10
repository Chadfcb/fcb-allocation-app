import { redirect } from "next/navigation";
import { getProfile } from "@/lib/getProfile";
import ErnieChatClient from "@/components/ErnieChatClient";

// Ernie Projects — split out into its own page 2026-09-10, per Chad ("we
// need to separate them, instead of having them together, its too
// convoluted the way it is currently"). Previously the Project tiles,
// Completed Projects, and per-Project chat all lived inside /ernie
// alongside the personal/General conversation, switched between via tabs.
// Now /ernie is the personal chat only ("My Ernie AI" in the sidebar) and
// this page is the Projects experience ("Projects" in the sidebar) — same
// ErnieChatClient component underneath (it shares nearly all its state and
// logic either way), just rendered in "projects" mode. Available to every
// signed-in user with Ernie access, same as /ernie — the "ernie_ai" section
// grant is what actually gates being able to reach either page at all (see
// components/Sidebar.tsx); creating/managing a Project itself stays
// Administrator/Manager only, enforced inside ErnieChatClient and the API
// routes under app/api/ernie/projects/.
export default async function ErnieProjectsPage() {
  const profile = await getProfile();
  if (!profile) {
    redirect("/login");
  }
  const firstName =
    profile.full_name?.trim().split(/\s+/)[0] || profile.email.split("@")[0];

  return <ErnieChatClient firstName={firstName} canManageProjects={profile.role === "admin"} mode="projects" />;
}
