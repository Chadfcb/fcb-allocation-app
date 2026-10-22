import { requireAccess } from "@/lib/access";
import { ERNIE_SECTION } from "@/lib/permissions";

// Server-side access gate (2026-10-22, access lockdown): Ernie AI access (covers Projects too).
export default async function Layout({ children }: { children: React.ReactNode }) {
  await requireAccess([ERNIE_SECTION]);
  return <>{children}</>;
}
