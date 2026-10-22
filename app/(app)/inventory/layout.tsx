import { requireAccess } from "@/lib/access";

// Server-side access gate (2026-10-22, access lockdown): Inventory & Allocation access.
export default async function Layout({ children }: { children: React.ReactNode }) {
  await requireAccess(["inventory_allocation"]);
  return <>{children}</>;
}
