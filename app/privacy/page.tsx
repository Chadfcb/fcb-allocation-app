import type { Metadata } from "next";
import PublicPage, { H2 } from "@/components/PublicPage";
import { TWILIO } from "@/lib/twilio";

// PUBLIC (no login) — FCB's Privacy Policy, added 2026-10-29 for Twilio A2P
// campaign registration. Twilio requires: a page titled "Privacy Policy",
// what data is collected and how it's used, the brand name, and this exact
// sentence: "We do not sell or share your SMS opt-in data or personal
// information with third parties for marketing purposes." Don't remove it.
export const metadata: Metadata = { title: "Privacy Policy | Full Circle Brewing" };

const UPDATED = "October 29, 2026";

export default function PrivacyPage() {
  return (
    <PublicPage title="Privacy Policy">
      <p className="text-sm text-neutral-500">Last updated: {UPDATED}</p>
      <p>
        This Privacy Policy explains how {TWILIO.legalName} (&quot;{TWILIO.brand}&quot;, &quot;we&quot;, &quot;us&quot;)
        collects and uses information from the businesses and people we work with, including people who sign up
        to receive text messages from {TWILIO.brand}.
      </p>

      <H2>Information we collect</H2>
      <ul className="list-disc space-y-1 pl-6">
        <li>Your name, business name, and the business you buy for.</li>
        <li>Your mobile phone number, and the date, time and method you agreed to receive text messages (for example, texting JOIN or using our sign-up form).</li>
        <li>Messages you send to our text number, and your opt-out requests.</li>
        <li>Ordinary business records such as your account&apos;s purchase history and the sales representative assigned to your account.</li>
      </ul>

      <H2>How we use your information</H2>
      <ul className="list-disc space-y-1 pl-6">
        <li>To send you text messages you agreed to receive about new beer releases, seasonal products and availability.</li>
        <li>To route your replies to your {TWILIO.brand} sales representative so they can follow up.</li>
        <li>To keep a record of your consent and honor opt-out requests.</li>
        <li>To serve your business account and fulfill orders through your distributor.</li>
      </ul>

      <H2>Text messaging (SMS)</H2>
      <p>
        We do not sell or share your SMS opt-in data or personal information with third parties for marketing
        purposes.
      </p>
      <p>
        Text messaging originator opt-in data and consent will not be shared with any third parties. We use a
        messaging service provider (Twilio) only to deliver our messages to you; it may not use your information
        for any other purpose.
      </p>
      <p>
        You can opt out at any time by replying STOP to any message from {TWILIO.brand} at {TWILIO.numberDisplay}.
        Reply HELP for help. Message frequency varies. Message and data rates may apply. See our{" "}
        <a href="/terms" className="underline">Terms &amp; Conditions</a> for full SMS terms.
      </p>

      <H2>Sharing</H2>
      <p>
        Apart from the messaging service provider described above and service providers that host our systems,
        we do not sell, rent or share your personal information. We may disclose information if required by law.
      </p>

      <H2>Security and retention</H2>
      <p>
        We keep your information in access-controlled systems and only for as long as needed for the purposes
        above or as required by law. We keep a record of your opt-in and opt-out so we can honor your choice.
      </p>

      <H2>Contact us</H2>
      <p>
        {TWILIO.legalName}, {TWILIO.address}. Questions about this policy or your information can be sent to us
        by replying HELP to our text number or through{" "}
        <a href={TWILIO.website} className="underline">fullcirclebrewing.com</a>.
      </p>
    </PublicPage>
  );
}
