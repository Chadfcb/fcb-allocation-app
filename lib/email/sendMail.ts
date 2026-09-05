import nodemailer from "nodemailer";

// Sends email through Full Circle's own Google Workspace mailbox
// (ernie@fullcirclebrewing.com — a dedicated mailbox Chad set up for this),
// via Gmail's SMTP server — no separate email service/account needed.
// Authenticates with an "App Password" (a 16-character code generated in
// that mailbox's Google Account settings, used only by this app, separate
// from its real sign-in password). See task-reminders-setup.md for the
// one-time setup steps.
//
// GMAIL_USER / GMAIL_APP_PASSWORD are set as environment variables in
// Vercel (Project Settings → Environment Variables), never committed to the
// repo.
let transporter: ReturnType<typeof nodemailer.createTransport> | null = null;

function getTransporter() {
  if (transporter) return transporter;

  const user = process.env.GMAIL_USER;
  const pass = process.env.GMAIL_APP_PASSWORD;
  if (!user || !pass) {
    throw new Error("Missing GMAIL_USER or GMAIL_APP_PASSWORD — can't send email.");
  }

  transporter = nodemailer.createTransport({
    host: "smtp.gmail.com",
    port: 465,
    secure: true,
    auth: { user, pass },
  });
  return transporter;
}

export async function sendMail(opts: { to: string; subject: string; text: string; html?: string }) {
  const t = getTransporter();
  const from = process.env.GMAIL_USER;
  await t.sendMail({
    from: `Ernie <${from}>`,
    to: opts.to,
    subject: opts.subject,
    text: opts.text,
    // Only send an html body when one was actually built as html (with real
    // <p>/<br> tags). Plain newlines in `text` don't render as line/
    // paragraph breaks in HTML, so falling back to `opts.text` here used to
    // squish every paragraph onto one line — leaving html unset lets email
    // clients render the plain-text version's line breaks correctly instead.
    ...(opts.html ? { html: opts.html } : {}),
  });
}
