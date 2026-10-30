import { createHmac, timingSafeEqual } from "node:crypto";
import { APP_BASE_URL, emailLinkSecret } from "@/lib/email/unsubscribe";

// Email Studio open + click tracking (added 2026-10-30, replacing SendGrid's,
// per Chad: no separate paid service). Server-only.
//   * Opens: a 1×1 invisible image at /api/email/o?s=<send id>. When the
//     reader's email app loads images, we record "opened". Approximate —
//     some apps load images for everyone (Apple Mail), some never do.
//   * Clicks: every link in the email goes through /api/email/c first,
//     which records "clicked" and forwards to the real address. The link is
//     signed so nobody can use our address to forward people to other sites.

const b64url = (b: Buffer) => b.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const fromB64url = (s: string) => Buffer.from(s.replace(/-/g, "+").replace(/_/g, "/"), "base64");

function clickSig(sendId: string, url: string): string {
  return b64url(createHmac("sha256", emailLinkSecret()).update(`click:${sendId}:${url}`).digest()).slice(0, 24);
}

export function openPixelUrl(sendId: string): string {
  return `${APP_BASE_URL}/api/email/o?s=${encodeURIComponent(sendId)}`;
}

export function clickUrl(sendId: string, url: string): string {
  return `${APP_BASE_URL}/api/email/c?s=${encodeURIComponent(sendId)}&u=${b64url(Buffer.from(url, "utf-8"))}&k=${clickSig(sendId, url)}`;
}

/** Returns the real address if the click link is genuine, else null. */
export function verifyClick(sendId: string | null, u: string | null, k: string | null): string | null {
  if (!sendId || !u || !k) return null;
  let url: string;
  try {
    url = fromB64url(u).toString("utf-8");
  } catch {
    return null;
  }
  if (!/^https?:\/\//i.test(url)) return null;
  const expected = Buffer.from(clickSig(sendId, url));
  const given = Buffer.from(k);
  return expected.length === given.length && timingSafeEqual(expected, given) ? url : null;
}

const decodeAttr = (s: string) => s.replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&#39;/g, "'");
const encodeAttr = (s: string) => s.replace(/&/g, "&amp;").replace(/"/g, "&quot;");

/** Makes one recipient's copy of the email: their own unsubscribe link,
 *  links routed through click tracking (except unsubscribe / mailto / tel),
 *  and the open pixel at the end. */
export function personalizeEmail(opts: {
  html: string;
  sendId: string;
  unsubscribePlaceholder: string;
  unsubscribeUrl: string;
}): string {
  let html = opts.html.split(opts.unsubscribePlaceholder).join(encodeAttr(opts.unsubscribeUrl));
  html = html.replace(/(<a\b[^>]*?\bhref\s*=\s*")([^"]+)(")/gi, (whole, pre: string, href: string, post: string) => {
    const real = decodeAttr(href.trim());
    if (!/^https?:\/\//i.test(real)) return whole; // mailto:, tel:, #anchors
    if (real.startsWith(`${APP_BASE_URL}/email/unsubscribe`)) return whole;
    return `${pre}${encodeAttr(clickUrl(opts.sendId, real))}${post}`;
  });
  const pixel = `<img src="${encodeAttr(openPixelUrl(opts.sendId))}" width="1" height="1" alt="" style="display:block;width:1px;height:1px;border:0;" />`;
  return html.includes("</body>") ? html.replace("</body>", `${pixel}</body>`) : html + pixel;
}
