import { redirect } from "next/navigation";
import { getProfile } from "@/lib/getProfile";
import { hasSection } from "@/lib/permissions";
import TasksPageClient from "@/components/TasksPageClient";

// Tasks (formerly "Projects") — the company-wide action/directive tracker.
// Gated by the "tasks" section (see lib/permissions.ts), same as every
// other page — added 2026-09-04 per Chad's standing rule that any new
// sidebar section needs a real Users > Edit access toggle. Previously this
// was deliberately left open to every signed-in user; anyone who now has
// the "tasks" section checked still gets full, unrestricted use of it
// (create/assign/resolve/delete) — the only thing this guard changes is
// who can get into the page at all.
export default async function TasksPage() {
  const profile = await getProfile();
  if (!hasSection(profile?.role, profile?.sections, "tasks")) {
    redirect("/inventory");
  }

  return <TasksPageClient />;
}
