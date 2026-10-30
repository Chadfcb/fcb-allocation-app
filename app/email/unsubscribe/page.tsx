import type { Metadata } from "next";
import PublicPage from "@/components/PublicPage";
import UnsubscribeButton from "@/components/UnsubscribeButton";
import { verifyUnsubscribe } from "@/lib/email/unsubscribe";

// PUBLIC (no login) — the "Unsubscribe" link at the bottom of every email
// Email Studio sends (added 2026-10-30). Shows who's unsubscribing and a
// button (a button, not automatic, so email security scanners that open
// links can't unsubscribe people by accident).
export const metadata: Metadata = { title: "Unsubscribe | Full Circle Brewing" };
export const dynamic = "force-dynamic";

export default async function UnsubscribePage({ searchParams }: { searchParams: Promise<{ e?: string; s?: string }> }) {
  const { e, s } = await searchParams;
  const email = verifyUnsubscribe(e ?? null, s ?? null);
  return (
    <PublicPage title="Unsubscribe">
      {email ? (
        <>
          <p>
            Stop Full Circle Brewing emails to <strong>{email}</strong>?
          </p>
          <UnsubscribeButton e={e!} s={s!} />
        </>
      ) : (
        <p>This unsubscribe link isn&apos;t valid. Please use the link at the bottom of one of our emails, or reply to any email and we&apos;ll remove you.</p>
      )}
    </PublicPage>
  );
}
