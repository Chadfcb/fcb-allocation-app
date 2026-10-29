import { requireAccess } from "@/lib/access";

// Server-side access gate (2026-10-29): Twilio pages need the "twilio" section
// (Admin → Users → Twilio). Admins always have it.
export default async function Layout({ children }: { children: React.ReactNode }) {
  await requireAccess(["twilio"]);
  return <>{children}</>;
}
