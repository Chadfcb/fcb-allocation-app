import { requireAccess } from "@/lib/access";

// Server-side access gate (2026-10-22, access lockdown): Distributor Inventory access.
export default async function Layout({ children }: { children: React.ReactNode }) {
  await requireAccess(["distributor_inventory"]);
  return <>{children}</>;
}
