import TasksPageClient from "@/components/TasksPageClient";

// Tasks (formerly "Projects") — the company-wide action/directive tracker.
// No redirect/section guard: it's intentionally open to every signed-in
// user (see sql/tasks.sql and TasksPageClient for why), so this route just
// renders straight through.
export default function TasksPage() {
  return <TasksPageClient />;
}
