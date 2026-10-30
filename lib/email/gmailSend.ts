import nodemailer from "nodemailer";

// Email Studio sending through ernie@fullcirclebrewing.com's own Gmail
// (added 2026-10-30, per Chad: "we dont want a seperate paid service" …
// "lets use ernies current email, capped at 1800 a day"). Same mailbox and
// App Password as the task reminders (GMAIL_USER / GMAIL_APP_PASSWORD in
// Vercel — lib/email/sendMail.ts). Server-only.

export const DEFAULT_FROM_ADDRESS = "ernie@fullcirclebrewing.com";
/** Placeholder in the frozen email; swapped for each person's own unsubscribe link. */
export const UNSUB_PLACEHOLDER = "-fcb-unsubscribe-url-";

export function gmailConfigured(): boolean {
  return !!process.env.GMAIL_USER && !!process.env.GMAIL_APP_PASSWORD;
}

export function fromAddress(): string {
  return process.env.GMAIL_USER || DEFAULT_FROM_ADDRESS;
}

let transporter: ReturnType<typeof nodemailer.createTransport> | null = null;
function getTransporter() {
  if (transporter) return transporter;
  const user = process.env.GMAIL_USER;
  const pass = process.env.GMAIL_APP_PASSWORD;
  if (!user || !pass) throw new Error("Missing GMAIL_USER or GMAIL_APP_PASSWORD — can't send email.");
  transporter = nodemailer.createTransport({
    host: "smtp.gmail.com",
    port: 465,
    secure: true,
    auth: { user, pass },
    pool: true,
    maxConnections: 1,
  });
  return transporter;
}

/** True when Gmail is saying "you've hit your sending limit" — the run stops
 *  and the email goes back in line instead of being marked failed. */
export function isGmailLimitError(message: string): boolean {
  return /(5\.4\.5|4\.7\.0|4\.7\.28|daily (user )?sending (quota|limit)|limit exceeded|too many|rate limit|try again later)/i.test(message);
}

export async function sendCampaignEmail(opts: {
  to: string;
  toName?: string | null;
  fromName: string;
  replyTo?: string | null;
  subject: string;
  html: string;
  text: string;
  oneClickUnsubscribeUrl: string;
}): Promise<void> {
  await getTransporter().sendMail({
    from: { name: opts.fromName, address: fromAddress() },
    to: opts.toName ? { name: opts.toName.slice(0, 100), address: opts.to } : opts.to,
    ...(opts.replyTo ? { replyTo: opts.replyTo } : {}),
    subject: opts.subject,
    html: opts.html,
    text: opts.text,
    // Gmail/Yahoo/Apple show their own "Unsubscribe" button from these.
    headers: {
      "List-Unsubscribe": `<${opts.oneClickUnsubscribeUrl}>`,
      "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
      Precedence: "bulk",
    },
  });
}
