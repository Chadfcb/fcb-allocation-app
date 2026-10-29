import { TWILIO } from "@/lib/twilio";

// Twilio → How It Works (added 2026-10-29, per Chad): how FCB new-item texts
// work from the customer's point of view — the same one-pager Chad wrote up
// for Art. Under Text Sign-ups in the sidebar. Update "Where it stands" as
// steps finish.

function Section({ n, title, children }: { n?: number; title: string; children: React.ReactNode }) {
  return (
    <section className="rounded-2xl border border-neutral-800 bg-neutral-900/40 p-4 sm:p-5">
      <h2 className="mb-3 flex items-center gap-2 text-base font-semibold text-neutral-100">
        {n !== undefined && (
          <span className="flex h-6 w-6 items-center justify-center rounded-full bg-brand/20 text-xs text-neutral-100">{n}</span>
        )}
        {title}
      </h2>
      <div className="space-y-2 text-sm leading-relaxed text-neutral-300">{children}</div>
    </section>
  );
}

function Bullets({ items }: { items: React.ReactNode[] }) {
  return (
    <ul className="list-disc space-y-1.5 pl-5">
      {items.map((item, i) => (
        <li key={i}>{item}</li>
      ))}
    </ul>
  );
}

export default function TwilioHowItWorksPage() {
  return (
    <div className="max-w-3xl space-y-5">
      <div>
        <h1 className="text-lg font-semibold text-neutral-100">Twilio — How It Works</h1>
        <p className="text-sm text-neutral-400">
          FCB new-item texts, from the customer&apos;s point of view. Store and bar buyers can get a text from{" "}
          {TWILIO.brand} when we have a new beer, a seasonal release, or new availability. Every text comes from one FCB
          number: <strong className="text-neutral-200">{TWILIO.numberDisplay}</strong>.
        </p>
      </div>

      <Section n={1} title="Signing up">
        <Bullets
          items={[
            <>
              Our rep tells the buyer: &ldquo;Text <strong className="text-neutral-100">{TWILIO.joinKeyword}</strong> to{" "}
              {TWILIO.numberDisplay}.&rdquo;
            </>,
            `The buyer texts ${TWILIO.joinKeyword} and immediately gets a confirmation text back.`,
            <>
              Buyers can also sign up on a short{" "}
              <a href="/sms-signup" target="_blank" rel="noreferrer" className="text-brand underline">
                web form
              </a>{" "}
              our rep can share or fill out with them.
            </>,
            "No app, no login, no cost to the buyer (normal message rates may apply).",
            "We only text people who signed up. By law we can't text our account list without their OK.",
          ]}
        />
      </Section>

      <Section n={2} title="Getting texts">
        <p>When we have something new, the buyer gets a short text, for example:</p>
        <p className="rounded-xl border border-neutral-800 bg-neutral-950 px-3 py-2 text-neutral-200">
          {TWILIO.brand}: Our fall seasonal Pumpkin Ale is back for a limited time. Want some for your store? Reply to
          this text and your sales rep will contact you.
        </p>
        <p>A few texts a month at most. Nothing personal, nothing spammy.</p>
      </Section>

      <Section n={3} title="Replying">
        <Bullets
          items={[
            "The buyer just replies to the text (“yes, send 2 cases,” “call me,” etc.).",
            "Their reply goes to their FCB sales rep, who follows up to take the order.",
            "The buyer never needs to know or save the rep's number. They just reply.",
          ]}
        />
      </Section>

      <Section n={4} title="Stopping">
        <Bullets
          items={[
            "Replying STOP ends all texts right away, and they won't be texted again.",
            "Replying HELP gets a help message.",
          ]}
        />
      </Section>

      <Section title="Where it stands">
        <Bullets
          items={[
            "Twilio account, phone number and business registration are done.",
            "The phone carriers still have to approve the texting campaign. That usually takes several days to two weeks.",
            "Sign-ups and the record of each buyer's consent are kept in FCB-Data (Twilio → Text Sign-ups).",
            "Next to build: automatically sending replies to the rep, and a screen to send new-item texts.",
          ]}
        />
      </Section>

      <Section title="Cost">
        <p>About 1 cent per text, plus $1.15 a month for the number and small carrier registration fees.</p>
      </Section>
    </div>
  );
}
