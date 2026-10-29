import { requireAccess } from "@/lib/access";

// Server-side access gate (2026-10-29): Email Studio access (Admin → Users →
// Email Studio). Admins always have it.
export default async function Layout({ children }: { children: React.ReactNode }) {
  await requireAccess(["email_studio"]);
  return <>{children}</>;
}
