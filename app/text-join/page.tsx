import type { Metadata } from "next";
import PublicPage, { H2 } from "@/components/PublicPage";
import { AGE_QUESTION, JOIN_CONFIRMATION, TWILIO } from "@/lib/twilio";

// PUBLIC (no login) — the "Text JOIN" card, added 2026-11-13 for the new
// texting campaign (the 10/30 one was rejected partly because carriers
// couldn't see how people sign up — error 30909). Shows exactly what our reps
// hand to buyers and managers at licensed accounts, the texts they get back,
// and the 21+ birth-date step. Built as a page (not a picture) so the wording
// always matches what the app really sends (lib/twilio.ts). Printable.
export const metadata: Metadata = { title: "Text JOIN | Full Circle Brewing" };

function Bubble({ from, children }: { from: "them" | "us"; children: React.ReactNode }) {
  return (
    <div className={`flex ${from === "them" ? "justify-end" : "justify-start"}`}>
      <p
        className={`max-w-[85%] rounded-2xl px-4 py-2 text-[14px] leading-snug ${
          from === "them" ? "bg-blue-600 text-white" : "bg-neutral-100 text-neutral-900"
        }`}
      >
        {children}
      </p>
    </div>
  );
}

export default function TextJoinPage() {
  return (
    <PublicPage title="Text JOIN for new-item texts">
      <p>
        This is the card {TWILIO.brand} sales reps share with buyers and managers at the licensed bars, restaurants and
        stores we sell to, so they can sign up for texts about our new beers.
      </p>

      {/* The card itself */}
      <div className="mx-auto max-w-md rounded-2xl border-2 border-neutral-900 p-6 text-center">
        <p className="text-sm font-semibold uppercase tracking-widest text-neutral-500">{TWILIO.brand}</p>
        <p className="mt-2 text-2xl font-bold text-neutral-900">New beers first, by text</p>
        <p className="mt-4 text-lg">
          Text <strong className="rounded bg-neutral-900 px-2 py-0.5 text-white">{TWILIO.joinKeyword}</strong> to{" "}
          <strong>{TWILIO.numberDisplay}</strong>
        </p>
        <p className="mt-4 text-[13px] leading-snug text-neutral-600">
          For licensed business contacts 21+. You&apos;ll be asked for your birth date to confirm you&apos;re 21 or
          older. Recurring texts about new releases, seasonal beers and availability. Msg frequency varies. Msg &amp;
          data rates may apply. Reply HELP for help, STOP to opt out. Consent is not a condition of purchase. Terms
          &amp; Privacy: www.fcb-data.com/terms · www.fcb-data.com/privacy
        </p>
      </div>

      <H2>What happens when you text {TWILIO.joinKeyword}</H2>
      <div className="mx-auto max-w-md space-y-2 rounded-2xl border border-neutral-200 p-4">
        <Bubble from="them">{TWILIO.joinKeyword}</Bubble>
        <Bubble from="us">{AGE_QUESTION}</Bubble>
        <Bubble from="them">06/15/1985</Bubble>
        <Bubble from="us">{JOIN_CONFIRMATION}</Bubble>
      </div>
      <ul className="list-disc space-y-1 pl-6">
        <li>You are not signed up until you reply with a birth date showing you are 21 or older.</li>
        <li>If the birth date is under 21, you are not signed up and that number can&apos;t sign up again.</li>
        <li>Reply STOP at any time to stop all texts. Reply HELP for help.</li>
      </ul>

      <H2>Prefer a form?</H2>
      <p>
        You can also sign up on our{" "}
        <a href="/sms-signup" className="underline">
          text sign-up page
        </a>
        . It asks for your birth date too, and the consent box starts unchecked.
      </p>

      <p className="text-sm text-neutral-500">
        See our <a href="/terms" className="underline">Terms &amp; Conditions</a> and{" "}
        <a href="/privacy" className="underline">Privacy Policy</a>.
      </p>
    </PublicPage>
  );
}
