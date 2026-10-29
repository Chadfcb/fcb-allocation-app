// Email Studio — shared email wrapping (added 2026-10-29, per Chad;
// claude/email-designer-plan.md). Every email that leaves Email Studio gets
// the same footer added here, on send — Eddie can't remove it by accident:
// the business address and an unsubscribe link (US CAN-SPAM rules for
// marketing email). Plain string helpers only — safe on server or browser.

export const EMAIL_FROM_NAME = "Full Circle Brewing";
export const BUSINESS_ADDRESS = "Full Circle Brewing Co. · 620 F St., Fresno, CA 93706";

function esc(s: string) {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

/** The fixed footer. unsubscribeUrl is filled in per recipient when real
 *  sending is built (Phase 5); test sends get a placeholder link. */
export function emailFooterHtml(unsubscribeUrl: string): string {
  return (
    `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="width:100%;border-collapse:collapse;">` +
    `<tr><td align="center" style="padding:24px 16px 32px 16px;font-family:Arial,Helvetica,sans-serif;font-size:12px;line-height:18px;color:#777777;">` +
    `${esc(BUSINESS_ADDRESS)}<br>` +
    `You're receiving this because you buy from or work with Full Circle Brewing.<br>` +
    `<a href="${esc(unsubscribeUrl)}" style="color:#777777;text-decoration:underline;">Unsubscribe</a>` +
    `</td></tr></table>`
  );
}

/** Wraps the designer's inlined HTML into a complete email document with the
 *  footer. preheader = the grey preview line most inboxes show after the
 *  subject. */
export function buildEmailDocument(opts: {
  bodyHtml: string;
  subject: string;
  preheader?: string | null;
  unsubscribeUrl: string;
}): string {
  const pre = opts.preheader?.trim()
    ? `<div style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent;">${esc(opts.preheader.trim())}</div>`
    : "";
  return (
    `<!doctype html><html lang="en"><head><meta charset="utf-8">` +
    `<meta name="viewport" content="width=device-width, initial-scale=1">` +
    `<meta http-equiv="X-UA-Compatible" content="IE=edge">` +
    `<title>${esc(opts.subject)}</title></head>` +
    `<body style="margin:0;padding:0;background-color:#f4f4f4;">${pre}${opts.bodyHtml}${emailFooterHtml(opts.unsubscribeUrl)}</body></html>`
  );
}

/** Rough plain-text version (some inboxes / spam filters want one). */
export function htmlToText(html: string): string {
  return html
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<(br|\/p|\/div|\/tr|\/h[1-6]|\/li)[^>]*>/gi, "\n")
    .replace(/<a [^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi, "$2 ($1)")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}
