import { requireAccess } from "@/lib/access";

// Server-side access gate (2026-10-30): the Age Check page (Admin → Age
// Check). Administrators always have it; others only if granted.
export default async function Layout({ children }: { children: React.ReactNode }) {
  await requireAccess(["age_check"]);
  return <>{children}</>;
}
