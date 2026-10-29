import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { TWILIO, JOIN_CONFIRMATION, WEB_CONSENT_TEXT, formatPhone } from "@/lib/twilio";

// Twilio → Setup & Compliance (added 2026-10-29, per Chad): everything about
// FCB's texting setup in one place — the number, the registrations, the
// wording carriers approved, and the public pages. Secrets (the Auth Token)
// are never shown here; they live only in Vercel's env vars.
//
// Registration status is typed in below by hand (Twilio has no simple way to
// read it back) — update REGISTRATION when a status changes.
export const dynamic = "force-dynamic";

const REGISTRATION: { step: string; status: string; note: string }[] = [
  { step: "Twilio account", status: "Active", note: "Paid account, $50 balance, auto-recharge to $50 when under $10." },
  { step: "Compliance profile", status: "Submitted", note: `Primary Customer Profile ${TWILIO.complianceProfileSid}` },
  { step: "Phone number", status: "Active", note: `${TWILIO.numberDisplay} — Voice, SMS, MMS. $1.15/month.` },
  { step: "Messaging service", status: "Created", note: TWILIO.messagingService },
  { step: "A2P brand", status: "Submitted", note: `${TWILIO.brand} (${TWILIO.legalName})` },
  { step: "A2P campaign", status: "Not submitted", note: "Waiting on these public pages going live. Use case: Marketing. Opt-in: keyword (text JOIN)." },
];

const CAMPAIGN_DESCRIPTION =
  "Full Circle Brewing Co., a licensed brewery in Fresno, CA, sends text messages to existing business accounts (licensed bars, restaurants, liquor stores and grocery retailers) to announce new beer releases, seasonal products and availability. Recipients are buyers and managers at these businesses who gave their mobile number to their Full Circle Brewing sales rep. Replies are routed to the account's assigned sales rep.";

const MESSAGE_FLOW = `End users opt in by texting the keyword ${TWILIO.joinKeyword} to ${TWILIO.numberDisplay}. ${TWILIO.brand} sales reps share the keyword with buyers and managers at licensed retail and on-premise accounts during sales visits, and it is printed on our sell sheets with the disclosure "Text ${TWILIO.joinKeyword} to ${TWILIO.numberDisplay} for new-item texts from ${TWILIO.brand}. Msg frequency varies. Msg & data rates may apply. Reply HELP for help, STOP to opt out. Terms & Privacy: www.fcb-data.com/terms". After texting ${TWILIO.joinKeyword}, the user immediately receives: "${JOIN_CONFIRMATION}" Users can also opt in on our web form at https://www.fcb-data.com/sms-signup, which has an unchecked consent box. Opt-in date, time, method and wording are recorded.`;

const SAMPLE_MESSAGES = [
  `${TWILIO.brand}: New release! Our Hazy IPA is now available in 16oz cans and 1/6 kegs. Reply to this text and your rep will reach out to place an order. Reply STOP to opt out.`,
  `${TWILIO.brand}: Our fall seasonal Pumpkin Ale is back for a limited time. Want some for your store? Reply to this text and your sales rep will contact you. Reply STOP to opt out.`,
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
  const [{ count: optedIn }, { count: optedOut }] = await Promise.all([
    supabase.from("sms_contacts").select("id", { count: "exact", head: true }).eq("status", "opted_in"),
    supabase.from("sms_contacts").select("id", { count: "exact", head: true }).eq("status", "opted_out"),
  ]);

  const publicPages = [
    { href: "/sms-signup", label: "Text sign-up form", note: "Backup to texting JOIN. Share with buyers or fill in with them." },
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
          <p className="mt-1 text-sm text-neutral-400">to {TWILIO.numberDisplay} — the main way buyers sign up.</p>
        </Card>
        <Card title="Sign-ups">
          <p className="text-2xl font-light text-neutral-100">{optedIn ?? 0} opted in</p>
          <p className="mt-1 text-sm text-neutral-400">
            {optedOut ?? 0} opted out ·{" "}
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

      <Card title="Campaign wording (as registered with Twilio)">
        <div className="space-y-4">
          <Copy label="Use case" text="Marketing" />
          <Copy label="Campaign description" text={CAMPAIGN_DESCRIPTION} />
          <Copy label="Message flow (how people opt in)" text={MESSAGE_FLOW} />
          <Copy label="Opt-in keyword" text={TWILIO.joinKeyword} />
          <Copy label="Opt-in confirmation message" text={JOIN_CONFIRMATION} />
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
