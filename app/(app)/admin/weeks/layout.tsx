import { requireAccess } from "@/lib/access";

// Server-side access gate (2026-10-22, access lockdown): Weeks access (covers each week page too).
export default async function Layout({ children }: { children: React.ReactNode }) {
  await requireAccess(["weeks"]);
  return <>{children}</>;
}
