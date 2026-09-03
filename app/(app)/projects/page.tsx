import ProjectsPageClient from "@/components/ProjectsPageClient";

// Projects — the company-wide action/directive tracker. Unlike every other
// page here, there's no redirect/section guard: it's intentionally open to
// every signed-in user (see sql/projects.sql and ProjectsPageClient for
// why), so this route just renders straight through.
export default function ProjectsPage() {
  return <ProjectsPageClient />;
}
