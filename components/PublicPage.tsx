import Image from "next/image";
import Link from "next/link";

// Shell for the PUBLIC Twilio pages (Privacy Policy, Terms & Conditions, Text
// sign-up) — added 2026-10-29. Open to anyone with no login (carriers review
// them when approving FCB's texting campaign; buyers use the sign-up page).
// Plain light page on purpose: no sidebar, nothing from the app.
export default function PublicPage({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="min-h-screen w-full bg-white text-neutral-800">
      <div className="mx-auto w-full max-w-3xl px-4 py-10 sm:px-6">
        <div className="mb-8 flex items-center gap-3 border-b border-neutral-200 pb-6">
          <Image src="/branding/fcb-logo.png" alt="Full Circle Brewing" width={56} height={56} className="h-14 w-14 object-contain" />
          <div>
            <p className="text-sm font-semibold uppercase tracking-wide text-neutral-500">Full Circle Brewing</p>
            <h1 className="text-2xl font-bold text-neutral-900 sm:text-3xl">{title}</h1>
          </div>
        </div>
        <div className="public-doc space-y-4 text-[15px] leading-relaxed">{children}</div>
        <footer className="mt-12 border-t border-neutral-200 pt-6 text-sm text-neutral-500">
          <p>Full Circle Brewing Co. Ltd. LLC · 620 F St., Fresno, CA 93706</p>
          <p className="mt-2 flex flex-wrap gap-4">
            <Link href="/privacy" className="underline hover:text-neutral-800">Privacy Policy</Link>
            <Link href="/terms" className="underline hover:text-neutral-800">Terms &amp; Conditions</Link>
            <Link href="/sms-signup" className="underline hover:text-neutral-800">Text sign-up</Link>
          </p>
        </footer>
      </div>
    </div>
  );
}

export function H2({ children }: { children: React.ReactNode }) {
  return <h2 className="pt-4 text-lg font-bold text-neutral-900">{children}</h2>;
}
