import { requireAccess } from "@/lib/access";

// Server-side access gate (2026-10-22, access lockdown): Cost Per Case access.
export default async function Layout({ children }: { children: React.ReactNode }) {
  await requireAccess(["cost_per_case"]);
  return <>{children}</>;
}
