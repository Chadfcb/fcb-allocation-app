// Email Studio — {{Account Name}} (added 2026-11-25, per Chad: "when we send
// an email out, its going to be to an account in the system that has an
// email for it, so we would like the email to auto populate their account
// name into the email" … "we want the account names built in").
//
// The tag is typed ONCE in the design (e.g. "Hi {{Account Name}},") — and
// can also go in the subject line. When each email goes out, the sender
// (lib/email/queue.ts) swaps in that recipient's account name. Nobody types
// names per account.
//   * Account contacts → the account's name, tidied: "LAZY DOG RESTAURANT & BAR"
//     → "Lazy Dog Restaurant & Bar", "YARD HOUSE #8373" → "Yard House",
//     "KEZAR PUB THE" → "The Kezar Pub".
//   * Pasted lists / typed-in addresses: the list's business name if it has
//     one, otherwise "Friend" (never the raw {{Account Name}}).
//   * "Send me a test": "Sample Account".
// Safe for the browser and the server (no imports).

export const ACCOUNT_NAME_TAG = "{{Account Name}}";
export const ACCOUNT_NAME_FALLBACK = "Friend";
export const ACCOUNT_NAME_SAMPLE = "Sample Account";

// Tolerates what the editor can do to typed text: any capitals, extra spaces,
// non-breaking spaces (&nbsp;), and an underscore instead of the space.
const TAG_RE = /\{\{(?:\s|&nbsp;|&#160;| )*account(?:\s|&nbsp;|&#160;| |_)*name(?:\s|&nbsp;|&#160;| )*\}\}/gi;

export function hasAccountNameTag(text: string | null | undefined): boolean {
  if (!text) return false;
  TAG_RE.lastIndex = 0;
  const found = TAG_RE.test(text);
  TAG_RE.lastIndex = 0;
  return found;
}

const SMALL = new Set(["and", "of", "the", "at", "by", "for", "in", "on", "to", "a", "an", "n"]);

function titleWord(w: string, first: boolean): string {
  if (!/\p{L}/u.test(w)) return w; // "&", "-", "2020"
  const lower = w.toLocaleLowerCase();
  const plain = w.normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^A-Za-z]/g, "");
  // No vowels → an abbreviation: BBQ, SF, D&N, TV.
  if (plain && !/[aeiouy]/i.test(plain)) return w.toLocaleUpperCase();
  if (!first && SMALL.has(lower)) return lower;
  return lower
    .replace(/(^|[-/(&]|\d)(\p{Ll})/gu, (_m, p: string, c: string) => p + c.toLocaleUpperCase())
    .replace(/^(o'|mc)(\p{Ll})/iu, (_m, p: string, c: string) => p.charAt(0).toUpperCase() + p.slice(1) + c.toLocaleUpperCase());
}

/** Tidies an account name for a greeting. Names already in mixed case are
 *  kept as typed (just trimmed of store numbers). */
export function prettyAccountName(raw: string | null | undefined): string {
  let s = (raw ?? "").replace(/\s+/g, " ").trim();
  if (!s) return "";
  s = s.replace(/\s*#\s*[\w-]*$/, "").trim(); // "YARD HOUSE #8373", "SAFFRON #0"
  const the = s.match(/^(.*?)(?:,\s*|\s+)THE$/i); // "KEZAR PUB THE" → "THE KEZAR PUB"
  if (the && the[1]) s = `${s.slice(-3)} ${the[1]}`;
  const isShouting = s === s.toUpperCase();
  if (!isShouting) return s;
  return s
    .split(" ")
    .map((w, i) => titleWord(w, i === 0))
    .join(" ");
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

/** The name to use for one recipient. */
export function accountNameFor(business: string | null | undefined): string {
  return prettyAccountName(business) || ACCOUNT_NAME_FALLBACK;
}

/** Fills {{Account Name}} in an email's HTML. */
export function fillAccountNameHtml(html: string, name: string): string {
  return html.replace(TAG_RE, escapeHtml(name));
}

/** Fills {{Account Name}} in plain text (the subject line). */
export function fillAccountNameText(text: string, name: string): string {
  return text.replace(TAG_RE, name);
}
