// FCB's own 21+ age check for its websites (added 2026-10-30, per Chad:
// replaces the Elfsight widget, whose free plan stops showing after 200
// views a month — "yes execute"). Design from Eddie's mockup with all four
// brand logos (Full Circle, Speakeasy, Sonoma Cider, Oobli).
//
// How it works:
//   * Each Wix site (fcbbrands.com, fullcirclebrewing.com) has ONE line in
//     Settings → Custom Code (All pages, Body – start):
//       <script src="https://www.fcb-data.com/api/age-check/script"></script>
//   * That route (app/api/age-check/script) sends back a small script with
//     the current settings baked in. Edits on Admin → Age Check show up on
//     both sites within about a minute — nobody touches Wix again.
//   * Visitors must enter a birth date and be 21+. The check covers the
//     whole page on whatever page they land on, can't be clicked past, and
//     is remembered for 30 days in that browser. Under 21 → "Sorry" screen
//     (remembered until the browser is closed).
//   * LOCKED (not editable — the texting carriers require them): birth
//     date, 21+, every page, remembered 30 days.
// Shared by the script route and the editor's live preview, so they always
// look the same. Plain string helpers — safe on server or browser.

export const MIN_AGE = 21;
export const REMEMBER_DAYS = 30;
export const APP_ORIGIN = "https://www.fcb-data.com";

export const FONTS: { value: string; label: string; css: string }[] = [
  { value: "arial", label: "Arial (default)", css: "Arial, Helvetica, sans-serif" },
  { value: "helvetica", label: "Helvetica", css: "'Helvetica Neue', Helvetica, Arial, sans-serif" },
  { value: "georgia", label: "Georgia (serif)", css: "Georgia, 'Times New Roman', serif" },
  { value: "trebuchet", label: "Trebuchet", css: "'Trebuchet MS', Arial, sans-serif" },
  { value: "verdana", label: "Verdana", css: "Verdana, Geneva, sans-serif" },
  { value: "impact", label: "Impact (bold, condensed)", css: "Impact, 'Arial Narrow Bold', sans-serif" },
  { value: "system", label: "Phone / computer default", css: "system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif" },
];

export type AgeLogo = { url: string; name: string; height: number };

export type AgeCheckSettings = {
  logos: AgeLogo[];
  heading: string;
  message: string;
  buttonText: string;
  termsText: string;
  termsUrl: string;
  deniedHeading: string;
  deniedMessage: string;
  backgroundUrl: string;
  backgroundColor: string;
  darkness: number; // 0–90 (% black over the photo)
  textColor: string;
  buttonColor: string;
  buttonTextColor: string;
  boxBorderColor: string;
  font: string;
};

export const DEFAULT_SETTINGS: AgeCheckSettings = {
  logos: [
    { url: `${APP_ORIGIN}/age-check/full-circle.png`, name: "Full Circle Brewing", height: 78 },
    { url: `${APP_ORIGIN}/age-check/speakeasy.png`, name: "Speakeasy Ales & Lagers", height: 78 },
    { url: `${APP_ORIGIN}/age-check/sonoma-cider.png`, name: "Sonoma Cider", height: 78 },
    { url: `${APP_ORIGIN}/age-check/oobli-white.png`, name: "Oobli", height: 30 },
  ],
  heading: "Are you 21? 🍻",
  message: "",
  buttonText: "ENTER",
  termsText: "By entering this site you are agreeing to the Terms of Use and Privacy Policy.",
  termsUrl: "",
  deniedHeading: "Sorry!",
  deniedMessage: "You must be 21 or older to visit this site.",
  backgroundUrl: `${APP_ORIGIN}/age-check/background.jpg`,
  backgroundColor: "#111111",
  darkness: 35,
  textColor: "#ffffff",
  buttonColor: "#f2c14e",
  buttonTextColor: "#222222",
  boxBorderColor: "#8a8a8a",
  font: "arial",
};

const HEX = /^#[0-9a-f]{3}([0-9a-f]{3})?$/i;
const str = (v: unknown, max: number, fallback: string) => (typeof v === "string" ? v.slice(0, max) : fallback);
const color = (v: unknown, fallback: string) => (typeof v === "string" && HEX.test(v.trim()) ? v.trim() : fallback);
const httpsUrl = (v: unknown, fallback: string) => {
  if (typeof v !== "string") return fallback;
  const t = v.trim();
  if (t === "") return "";
  return /^https:\/\/[^\s"'<>]+$/i.test(t) ? t : fallback;
};

/** Cleans whatever is stored/typed so the script can never break or be hijacked. */
export function cleanSettings(raw: unknown): AgeCheckSettings {
  const r = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const d = DEFAULT_SETTINGS;
  const logos = Array.isArray(r.logos)
    ? (r.logos as unknown[])
        .map((l) => {
          const o = (l && typeof l === "object" ? l : {}) as Record<string, unknown>;
          const url = httpsUrl(o.url, "");
          const h = Math.round(Number(o.height));
          return url ? { url, name: str(o.name, 80, "Logo"), height: Number.isFinite(h) ? Math.min(160, Math.max(16, h)) : 78 } : null;
        })
        .filter((l): l is AgeLogo => !!l)
        .slice(0, 6)
    : d.logos;
  const dark = Math.round(Number(r.darkness));
  return {
    logos,
    heading: str(r.heading, 120, d.heading),
    message: str(r.message, 400, d.message),
    buttonText: str(r.buttonText, 40, d.buttonText) || d.buttonText,
    termsText: str(r.termsText, 300, d.termsText),
    termsUrl: httpsUrl(r.termsUrl, ""),
    deniedHeading: str(r.deniedHeading, 120, d.deniedHeading),
    deniedMessage: str(r.deniedMessage, 400, d.deniedMessage),
    backgroundUrl: httpsUrl(r.backgroundUrl, d.backgroundUrl),
    backgroundColor: color(r.backgroundColor, d.backgroundColor),
    darkness: Number.isFinite(dark) ? Math.min(90, Math.max(0, dark)) : d.darkness,
    textColor: color(r.textColor, d.textColor),
    buttonColor: color(r.buttonColor, d.buttonColor),
    buttonTextColor: color(r.buttonTextColor, d.buttonTextColor),
    boxBorderColor: color(r.boxBorderColor, d.boxBorderColor),
    font: FONTS.some((f) => f.value === r.font) ? (r.font as string) : d.font,
  };
}

function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

/** The check's CSS — everything scoped under #fcb-age-gate so it can't
 *  clash with the Wix site, and the site's styles can't leak in. */
export function gateCss(s: AgeCheckSettings): string {
  const font = FONTS.find((f) => f.value === s.font)?.css ?? FONTS[0].css;
  const bg = s.backgroundUrl ? `, url("${s.backgroundUrl}") center / cover no-repeat` : "";
  const shade = `rgba(0,0,0,${(s.darkness / 100).toFixed(2)})`;
  const G = "#fcb-age-gate";
  return [
    `${G}{position:fixed!important;inset:0!important;z-index:2147483647!important;display:flex!important;align-items:center;justify-content:center;overflow:auto;background:linear-gradient(${shade},${shade})${bg},${s.backgroundColor};font-family:${font};color:${s.textColor};-webkit-font-smoothing:antialiased;box-sizing:border-box;padding:24px 16px;margin:0;opacity:1!important;visibility:visible!important}`,
    `${G} *{box-sizing:border-box;margin:0;padding:0;font-family:inherit;line-height:1.3;letter-spacing:normal;text-transform:none}`,
    `${G} .fag-box{width:100%;max-width:560px;text-align:center}`,
    `${G} .fag-logos{display:flex;flex-wrap:wrap;align-items:center;justify-content:center;gap:18px 26px;margin-bottom:26px}`,
    `${G} .fag-logos img{display:block;width:auto;max-width:42vw;border:0}`,
    `${G} .fag-h{font-size:23px;font-weight:700;margin-bottom:14px;color:${s.textColor}}`,
    `${G} .fag-msg{font-size:15px;margin-bottom:18px;color:${s.textColor};opacity:.9}`,
    `${G} .fag-row{display:flex;gap:8px;justify-content:center;margin:20px 0 22px}`,
    `${G} .fag-row input{width:100px;max-width:30%;height:42px;background:rgba(0,0,0,.25);border:1px solid ${s.boxBorderColor};border-radius:0;color:${s.textColor};padding:0 12px;font-size:15px;outline:none;-webkit-appearance:none;appearance:none}`,
    `${G} .fag-row input::placeholder{color:${s.textColor};opacity:.6}`,
    `${G} .fag-row input:focus{border-color:${s.buttonColor}}`,
    `${G} .fag-btn{display:block;width:316px;max-width:100%;height:36px;margin:0 auto;border:0;border-radius:0;background:${s.buttonColor};color:${s.buttonTextColor};font-size:14px;letter-spacing:.3px;cursor:pointer}`,
    `${G} .fag-btn:hover{filter:brightness(1.07)}`,
    `${G} .fag-err{min-height:18px;margin-top:10px;font-size:13px;color:#ffb4a8}`,
    `${G} .fag-terms{font-size:10px;margin-top:10px;color:${s.textColor};opacity:.85}`,
    `${G} .fag-terms a{color:inherit;text-decoration:underline}`,
    `${G} [hidden]{display:none!important}`,
  ].join("");
}

/** The check's HTML (both the birth-date screen and the "Sorry" screen). */
export function gateHtml(s: AgeCheckSettings): string {
  const logos = s.logos.length
    ? `<div class="fag-logos">${s.logos.map((l) => `<img src="${esc(l.url)}" alt="${esc(l.name)}" style="height:${l.height}px">`).join("")}</div>`
    : "";
  const terms = s.termsText
    ? `<p class="fag-terms">${s.termsUrl ? `<a href="${esc(s.termsUrl)}" target="_blank" rel="noopener">${esc(s.termsText)}</a>` : esc(s.termsText)}</p>`
    : "";
  return (
    `<div class="fag-box" role="dialog" aria-modal="true" aria-labelledby="fag-h">${logos}` +
    `<form class="fag-ask" novalidate>` +
    `<h1 class="fag-h" id="fag-h">${esc(s.heading)}</h1>` +
    (s.message ? `<p class="fag-msg">${esc(s.message)}</p>` : "") +
    `<div class="fag-row">` +
    `<input name="m" inputmode="numeric" autocomplete="bday-month" maxlength="2" placeholder="MM" aria-label="Birth month">` +
    `<input name="d" inputmode="numeric" autocomplete="bday-day" maxlength="2" placeholder="DD" aria-label="Birth day">` +
    `<input name="y" inputmode="numeric" autocomplete="bday-year" maxlength="4" placeholder="YYYY" aria-label="Birth year">` +
    `</div>` +
    `<button type="submit" class="fag-btn">${esc(s.buttonText)}</button>` +
    `<p class="fag-err" role="alert"></p>` +
    terms +
    `</form>` +
    `<div class="fag-no" hidden><h1 class="fag-h">${esc(s.deniedHeading)}</h1><p class="fag-msg">${esc(s.deniedMessage)}</p></div>` +
    `</div>`
  );
}

/** Age in whole years on `today`, or null if the date isn't real / is in the future. */
export function ageFrom(m: number, d: number, y: number, today = new Date()): number | null {
  if (!Number.isInteger(m) || !Number.isInteger(d) || !Number.isInteger(y)) return null;
  if (y < 1900 || m < 1 || m > 12 || d < 1 || d > 31) return null;
  const dob = new Date(y, m - 1, d);
  if (dob.getFullYear() !== y || dob.getMonth() !== m - 1 || dob.getDate() !== d) return null;
  if (dob > today) return null;
  let age = today.getFullYear() - y;
  if (today.getMonth() < m - 1 || (today.getMonth() === m - 1 && today.getDate() < d)) age--;
  return age;
}

/** The browser script each website loads. preview = true runs it inside the
 *  editor's preview (always shows, never remembers). */
export function gateScript(s: AgeCheckSettings, opts: { preview?: boolean; showDenied?: boolean } = {}): string {
  const cfg = JSON.stringify({
    css: gateCss(s),
    html: gateHtml(s),
    min: MIN_AGE,
    days: REMEMBER_DAYS,
    preview: !!opts.preview,
    showDenied: !!opts.showDenied,
  })
    .replace(/</g, "\\u003c")
    // Plain-ASCII script: emoji/accents survive even if a site reads it in the wrong text encoding.
    .replace(/[\u007f-\uffff]/g, (c) => "\\u" + c.charCodeAt(0).toString(16).padStart(4, "0"));
  // Plain ES5 so it runs in every browser Wix supports.
  return `/* FCB age check - managed in FCB-Data (Admin > Age Check). */
(function () {
  var C = ${cfg};
  var OK = "fcb_age_ok", NO = "fcb_age_no", G = "fcb-age-gate";
  function passed() {
    if (C.preview) return false;
    try { var v = window.localStorage.getItem(OK); if (v && +v > Date.now()) return true; } catch (e) {}
    return document.cookie.indexOf(OK + "=1") > -1;
  }
  function denied() {
    if (C.preview) return C.showDenied;
    try { return window.sessionStorage.getItem(NO) === "1"; } catch (e) { return false; }
  }
  if (passed() || window.__fcbAgeGate) return;
  window.__fcbAgeGate = true;

  var style = document.createElement("style");
  style.textContent = C.css;
  (document.head || document.documentElement).appendChild(style);

  var root = document.createElement("div");
  root.id = G;
  root.innerHTML = C.html;
  var done = false;
  var prevHtml = document.documentElement.style.overflow, prevBody = "";

  function lock() {
    document.documentElement.style.overflow = "hidden";
    if (document.body) { prevBody = document.body.style.overflow; document.body.style.overflow = "hidden"; }
  }
  function mount() {
    if (done) return;
    var host = document.body || document.documentElement;
    if (root.parentNode !== host || host.lastChild !== root) host.appendChild(root);
    lock();
  }
  mount();
  if (!document.body) document.addEventListener("DOMContentLoaded", mount);
  // Keep it on top even if the site redraws the page.
  var keep = window.setInterval(mount, 1000);

  var form = root.querySelector(".fag-ask"), no = root.querySelector(".fag-no");
  var err = root.querySelector(".fag-err");
  var m = form.elements.m, d = form.elements.d, y = form.elements.y;

  function showDenied() { form.hidden = true; no.hidden = false; }
  if (denied()) showDenied();

  function digits(el) { el.value = el.value.replace(/[^0-9]/g, ""); }
  m.addEventListener("input", function () { digits(m); if (m.value.length === 2) d.focus(); });
  d.addEventListener("input", function () { digits(d); if (d.value.length === 2) y.focus(); });
  y.addEventListener("input", function () { digits(y); });
  if (!C.preview) { try { m.focus({ preventScroll: true }); } catch (e) {} }

  function age(mm, dd, yy) {
    if (yy < 1900 || mm < 1 || mm > 12 || dd < 1 || dd > 31) return null;
    var b = new Date(yy, mm - 1, dd), t = new Date();
    if (b.getFullYear() !== yy || b.getMonth() !== mm - 1 || b.getDate() !== dd || b > t) return null;
    var a = t.getFullYear() - yy;
    if (t.getMonth() < mm - 1 || (t.getMonth() === mm - 1 && t.getDate() < dd)) a--;
    return a;
  }

  form.addEventListener("submit", function (e) {
    e.preventDefault();
    var a = age(parseInt(m.value, 10), parseInt(d.value, 10), parseInt(y.value, 10));
    if (a === null) { err.textContent = "Please enter your full birth date (MM / DD / YYYY)."; return; }
    if (C.preview) { err.textContent = a >= C.min ? "Preview: this birth date would be let in." : "Preview: this birth date would be turned away."; return; }
    if (a < C.min) {
      try { window.sessionStorage.setItem(NO, "1"); } catch (e2) {}
      showDenied();
      return;
    }
    try { window.localStorage.setItem(OK, String(Date.now() + C.days * 864e5)); } catch (e3) {}
    document.cookie = OK + "=1; max-age=" + C.days * 86400 + "; path=/; SameSite=Lax";
    done = true;
    window.clearInterval(keep);
    if (root.parentNode) root.parentNode.removeChild(root);
    document.documentElement.style.overflow = prevHtml;
    if (document.body) document.body.style.overflow = prevBody;
  });
})();
`;
}

/** A full standalone page showing the check (the editor's live preview). */
export function previewPage(s: AgeCheckSettings, showDenied: boolean): string {
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head><body style="margin:0;background:#fff"><div style="padding:40px;font:16px Arial">Your website would be here, hidden behind the age check.</div><script>${gateScript(s, { preview: true, showDenied })}</script></body></html>`;
}
