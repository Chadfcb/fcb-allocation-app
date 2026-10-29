import type { Metadata } from "next";
import PublicPage, { H2 } from "@/components/PublicPage";
import { TWILIO } from "@/lib/twilio";

// PUBLIC (no login) — FCB's Terms & Conditions, added 2026-10-29 for Twilio
// A2P campaign registration. Twilio requires: a page titled "Terms &
// Conditions" (or "Terms of Service"), an SMS Terms section, a "message and
// data rates may apply" disclosure, and the brand name.
export const metadata: Metadata = { title: "Terms & Conditions | Full Circle Brewing" };

const UPDATED = "October 29, 2026";

export default function TermsPage() {
  return (
    <PublicPage title="Terms & Conditions">
      <p className="text-sm text-neutral-500">Last updated: {UPDATED}</p>
      <p>
        These Terms &amp; Conditions apply to text messages sent by {TWILIO.legalName} (&quot;{TWILIO.brand}&quot;,
        &quot;we&quot;, &quot;us&quot;) and to our sign-up pages.
      </p>

      <H2>SMS Terms</H2>
      <ol className="list-decimal space-y-2 pl-6">
        <li>
          <strong>Program.</strong> The {TWILIO.brand} New Items program sends recurring marketing text messages to
          buyers and managers at licensed retail and on-premise businesses about new beer releases, seasonal
          products and availability. Replies are passed to your {TWILIO.brand} sales representative.
        </li>
        <li>
          <strong>How to join.</strong> Text <strong>{TWILIO.joinKeyword}</strong> to {TWILIO.numberDisplay}, or sign up
          at <a href="/sms-signup" className="underline">our text sign-up page</a>. You will receive a confirmation
          text. Consent is not a condition of purchase.
        </li>
        <li>
          <strong>Message frequency.</strong> Message frequency varies, typically a few messages per month.
        </li>
        <li>
          <strong>Costs.</strong> Message and data rates may apply. Check your mobile plan for details.
        </li>
        <li>
          <strong>Opt out.</strong> Reply <strong>STOP</strong> to any message to stop receiving texts. You will get one
          confirmation that you have been unsubscribed, and no further messages. To rejoin, text{" "}
          <strong>{TWILIO.joinKeyword}</strong> or <strong>START</strong>.
        </li>
        <li>
          <strong>Help.</strong> Reply <strong>HELP</strong> for help, or contact us through{" "}
          <a href={TWILIO.website} className="underline">fullcirclebrewing.com</a>.
        </li>
        <li>
          <strong>Carriers.</strong> Carriers are not liable for delayed or undelivered messages.
        </li>
        <li>
          <strong>Age.</strong> Our messages promote alcoholic beverages and are intended only for business contacts who
          are 21 years of age or older.
        </li>
        <li>
          <strong>Privacy.</strong> See our <a href="/privacy" className="underline">Privacy Policy</a>. We do not sell or
          share your SMS opt-in data or personal information with third parties for marketing purposes.
        </li>
      </ol>

      <H2>Changes</H2>
      <p>
        We may update these terms. The &quot;last updated&quot; date above shows when they last changed.
      </p>

      <H2>Contact</H2>
      <p>
        {TWILIO.legalName}, {TWILIO.address}.
      </p>
    </PublicPage>
  );
}
