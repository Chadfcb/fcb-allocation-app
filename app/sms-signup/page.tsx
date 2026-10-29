import type { Metadata } from "next";
import PublicPage from "@/components/PublicPage";
import SmsSignupForm from "@/components/SmsSignupForm";
import { TWILIO, WEB_CONSENT_TEXT } from "@/lib/twilio";

// PUBLIC (no login) — text sign-up form, added 2026-10-29. The backup to
// text-to-join (texting JOIN to the FCB number is the main way). Posts to
// /api/sms-signup; sign-ups show in the app under Twilio → Text Sign-ups.
export const metadata: Metadata = { title: "Text Sign-up | Full Circle Brewing" };

export default function SmsSignupPage() {
  return (
    <PublicPage title="Get new-item texts">
      <p>
        Be the first to hear about new {TWILIO.brand} releases, seasonal beers and availability for your store or bar.
        Your {TWILIO.brand} sales rep gets your replies, so you can order right from a text.
      </p>
      <p className="rounded-lg bg-neutral-100 px-4 py-3">
        Fastest way: text <strong>{TWILIO.joinKeyword}</strong> to <strong>{TWILIO.numberDisplay}</strong>.
      </p>
      <SmsSignupForm consentText={WEB_CONSENT_TEXT} />
    </PublicPage>
  );
}
