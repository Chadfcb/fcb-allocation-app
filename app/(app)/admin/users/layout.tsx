import { requireAccess } from "@/lib/access";

// Server-side access gate (2026-10-22, access lockdown): admins only.
export default async function Layout({ children }: { children: React.ReactNode }) {
  await requireAccess(["admin_users"]);
  return <>{children}</>;
}
