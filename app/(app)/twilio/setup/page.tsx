import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { TWILIO, AGE_DENIED, AGE_QUESTION, JOIN_CONFIRMATION, WEB_CONSENT_TEXT, formatPhone } from "@/lib/twilio";

// Twilio → Setup & Compliance (added 2026-10-29, per Chad): everything about
// FCB's texting setup in one place — the number, the registrations, the
// wording carriers approved, and the public pages. Secrets (the Auth Token)
// are never shown here; they live only in Vercel's env vars.
//
// Registration status is typed in below by hand (Twilio has no simple way to
// read it back) — update REGISTRATION when a status changes.
export const dynamic = "force-dynamic";

// Updated 2026-11-13 (per Chad) for the new campaign after the 10/30 rejection.
const REGISTRATION: { step: string; status: string; note: string }[] = [
  { step: "Twilio account", status: "Active", note: "Paid account (\"My First Twilio Account\")." },
  {
    step: "Compliance profile",
    status: "Approved — website change requested",
    note: `Primary Customer Profile ${TWILIO.complianceProfileSid}. 11/13: asked Twilio support to change the website from fcbbrands.com (no age check) to fullcirclebrewing.com (age check on every page). Twilio escalated it; waiting on them.`,
  },
  { step: "Phone number", status: "Active", note: `${TWILIO.numberDisplay} — Voice, SMS, MMS.` },
  { step: "Messaging service", status: "Created", note: "Incoming texts go to www.fcb-data.com/api/twilio/incoming." },
  {
    step: "A2P brand",
    status: "Registered — website change requested",
    note: `${TWILIO.brand} (${TWILIO.legalName}), Low Volume Standard. 11/13: asked Twilio to apply the same website change to the brand.`,
  },
  {
    step: "A2P campaign (first)",
    status: "Rejected 10/30",
    note: "Rejected for alcohol without a strong 21+ age check (error 30955 — can't be resubmitted) and for not showing proof of how people sign up (error 30909).",
  },
  {
    step: "A2P campaign (new)",
    status: "Not submitted yet",
    note: "Fixed since: 21+ age check on fullcirclebrewing.com and on every public page here; birth-date step before anyone is signed up (text and form); public Text JOIN page as sign-up proof. Submit once Twilio confirms the website change. About $15 review fee; approval not guaranteed (carriers restrict alcohol texting).",
  },
];

const CAMPAIGN_DESCRIPTION =
  "Full Circle Brewing Co., a licensed brewery in Fresno, CA, sends text messages to buyers and managers at its existing licensed business accounts (bars, restaurants, liquor stores and grocery retailers) about new beer releases, seasonal products, availability and how to order through their Full Circle Brewing sales rep. Messages go only to business contacts who are 21 or older: every subscriber must confirm their birth date (21+) before they are signed up. Replies are routed to the account's assigned sales rep.";

const MESSAGE_FLOW = `Sales reps share our printed card with buyers and managers at licensed accounts during sales visits (the card is shown publicly at https://www.fcb-data.com/text-join). The card reads: "Text ${TWILIO.joinKeyword} to ${TWILIO.numberDisplay}. For licensed business contacts 21+. You'll be asked for your birth date to confirm you're 21 or older. Recurring texts about new releases, seasonal beers and availability. Msg frequency varies. Msg & data rates may apply. Reply HELP for help, STOP to opt out. Consent is not a condition of purchase. Terms & Privacy: www.fcb-data.com/terms · www.fcb-data.com/privacy". When the user texts ${TWILIO.joinKeyword}, they are NOT subscribed yet; they receive: "${AGE_QUESTION}" Only if the birth date they reply with shows they are 21 or older are they subscribed, and they receive: "${JOIN_CONFIRMATION}" If they are under 21 they receive "${AGE_DENIED}" and are never subscribed. Users can also opt in on our web form at https://www.fcb-data.com/sms-signup, which requires a 21+ birth date and has an unchecked consent box. All of these pages, and our website https://www.fullcirclebrewing.com, are behind a 21+ date-of-birth age check. Opt-in date, time, method, wording and age confirmation are recorded.`;

const SAMPLE_MESSAGES = [
  `${TWILIO.brand}: Now available for your account: Hazy IPA in 16oz cans and 1/6 kegs. Reply to this text and your sales rep will contact you to place an order. Reply STOP to opt out.`,
  `${TWILIO.brand}: Our fall seasonal is back for a limited time for licensed accounts. Want it on your shelf or on tap? Reply and your sales rep will follow up. Reply STOP to opt out.`,
];

function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="rounded-2xl border border-neutral-800 bg-neutral-900/40 p-4 sm:p-5">
      <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-neutral-400">{title}</h2>
      {children}
    </section>
  );
}

function Copy({ label, text }: { label: string; text: string }) {
  return (
    <div className="space-y-1">
      <p className="text-xs font-semibold text-neutral-400">{label}</p>
      <p className="whitespace-pre-wrap rounded-lg border border-neutral-800 bg-neutral-950 px-3 py-2 text-sm text-neutral-200 select-all">
        {text}
      </p>
    </div>
  );
}

export default async function TwilioSetupPage() {
  const supabase = await createClient();
  const [{ count: optedIn }, { count: optedOut }, { count: waiting }] = await Promise.all([
    supabase.from("sms_contacts").select("id", { count: "exact", head: true }).eq("status", "opted_in"),
    supabase.from("sms_contacts").select("id", { count: "exact", head: true }).eq("status", "opted_out"),
    supabase.from("sms_contacts").select("id", { count: "exact", head: true }).eq("status", "pending_age"),
  ]);

  const publicPages = [
    { href: "/text-join", label: "Text JOIN card", note: "What reps hand out + how the 21+ birth-date step works. Paste into Twilio as the opt-in proof." },
    { href: "/sms-signup", label: "Text sign-up form", note: "Backup to texting JOIN (asks for a 21+ birth date). Share with buyers or fill in with them." },
    { href: "/privacy", label: "Privacy Policy", note: "Paste this link into Twilio's privacy policy field." },
    { href: "/terms", label: "Terms & Conditions", note: "Paste this link into Twilio's terms and conditions field." },
  ];

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-lg font-semibold text-neutral-100">Twilio — Setup &amp; Compliance</h1>
        <p className="text-sm text-neutral-400">
          FCB&apos;s texting number, its carrier registration, and the exact wording carriers were given. Plan:
          text accounts about new items from one number; replies go to the account&apos;s rep.
        </p>
      </div>

      <div className="grid gap-4 md:grid-cols-3">
        <Card title="Texting number">
          <p className="text-2xl font-light text-neutral-100">{formatPhone(TWILIO.number)}</p>
          <p className="mt-1 text-sm text-neutral-400">Fresno, CA · Messaging service: {TWILIO.messagingService}</p>
        </Card>
        <Card title="Text-to-join">
          <p className="text-2xl font-light text-neutral-100">Text {TWILIO.joinKeyword}</p>
          <p className="mt-1 text-sm text-neutral-400">
            to {TWILIO.numberDisplay} — the main way buyers sign up. We then ask for their birth date (21+ only).
          </p>
        </Card>
        <Card title="Sign-ups">
          <p className="text-2xl font-light text-neutral-100">{optedIn ?? 0} opted in</p>
          <p className="mt-1 text-sm text-neutral-400">
            {waiting ?? 0} waiting on age · {optedOut ?? 0} opted out ·{" "}
            <Link href="/twilio/sign-ups" className="text-brand underline">
              see Text Sign-ups
            </Link>
          </p>
        </Card>
      </div>

      <Card title="Registration status">
        <div className="overflow-x-auto">
          <table className="min-w-full text-sm">
            <tbody className="divide-y divide-neutral-800">
              {REGISTRATION.map((r) => (
                <tr key={r.step}>
                  <td className="py-2 pr-4 font-semibold text-neutral-200">{r.step}</td>
                  <td className="py-2 pr-4 whitespace-nowrap text-neutral-300">{r.status}</td>
                  <td className="py-2 text-neutral-400">{r.note}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      <Card title="Public pages (no login — carriers check these)">
        <ul className="space-y-2 text-sm">
          {publicPages.map((p) => (
            <li key={p.href}>
              <a href={p.href} target="_blank" rel="noreferrer" className="font-semibold text-brand underline">
                www.fcb-data.com{p.href}
              </a>{" "}
              <span className="text-neutral-300">— {p.label}.</span>{" "}
              <span className="text-neutral-500">{p.note}</span>
            </li>
          ))}
        </ul>
      </Card>

      <Card title="Campaign wording for the NEW campaign (copy into Twilio)">
        <div className="space-y-4">
          <Copy label="Use case" text="Low Volume Mixed" />
          <Copy label="Campaign description" text={CAMPAIGN_DESCRIPTION} />
          <Copy label="Message flow (how people opt in)" text={MESSAGE_FLOW} />
          <Copy label="Opt-in keyword" text={TWILIO.joinKeyword} />
          <Copy label="Birth-date question (sent after JOIN)" text={AGE_QUESTION} />
          <Copy label="Opt-in confirmation message (sent once 21+ is confirmed)" text={JOIN_CONFIRMATION} />
          <Copy label="Under-21 message" text={AGE_DENIED} />
          <Copy label="Opt-in proof link" text="https://www.fcb-data.com/text-join" />
          <Copy label="Web form consent wording" text={WEB_CONSENT_TEXT} />
          {SAMPLE_MESSAGES.map((m, i) => (
            <Copy key={i} label={`Sample message ${i + 1}`} text={m} />
          ))}
          <p className="text-sm text-neutral-400">
            Message contents: <strong className="text-neutral-200">age-gated content = yes</strong> (beer), phone numbers =
            yes, links = only if texts will include them.
          </p>
        </div>
      </Card>

      <Card title="App settings (Vercel → Settings → Environment Variables)">
        <ul className="list-disc space-y-1 pl-5 text-sm text-neutral-300">
          <li><code>TWILIO_ACCOUNT_SID</code> — Twilio Console home page (starts with AC).</li>
          <li><code>TWILIO_AUTH_TOKEN</code> — Twilio Console home page. Never share it or paste it anywhere else.</li>
          <li><code>TWILIO_MESSAGING_SERVICE_SID</code> — Messaging → Services → {TWILIO.messagingService} (starts with MG).</li>
          <li>
            In Twilio, set the messaging service&apos;s incoming-message webhook to{" "}
            <code>https://www.fcb-data.com/api/twilio/incoming</code> (HTTP POST).
          </li>
        </ul>
      </Card>
    </div>
  );
}
