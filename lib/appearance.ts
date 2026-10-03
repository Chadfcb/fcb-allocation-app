// Site-wide per-person appearance (added 2026-09-29).
//
// Per Chad: the Customize feature that used to only restyle the Ernie chat
// is now "available for everyone for the entire website". Each person picks
// ONE setting (theme / light-dark / their own colors / text size / font)
// from the Customize button in the top header, and it applies to every page
// of FCB-Data, Ernie included. The settings model lives in
// lib/ernie/appearance.ts (shared with Ernie's chat colors); this file turns
// those same settings into CSS for the rest of the site.
//
// HOW IT WORKS (so future changes don't have to touch every page):
// Nearly every page in the app is styled with Tailwind's gray scale
// (bg-neutral-900, text-neutral-400, border-neutral-800, bg-black,
// text-white...). Tailwind reads those colors from CSS variables
// (--color-neutral-900 etc.), so instead of editing every page, a theme
// simply redefines that gray scale: "black" becomes the person's background
// color, "white" becomes their text color, and each gray in between becomes
// the matching blend of the two. Text size works the same way through
// Tailwind's --text-* variables. Status colors (red/yellow/green badges,
// distributor colors, calendar colors) are left alone, except that on a
// LIGHT background the pale shades used for warning text are swapped for
// darker ones so they stay readable.
//
// For inline style={{ }} colors that don't go through Tailwind, use tone()
// below instead of a raw gray hex so they follow the theme too.
//
// The default ("FCB Dark") produces NO overrides here; since the facelift
// (2026-10-03) its look — green-tinted charcoal grays, card hue, pill
// buttons, soft status pills — is defined directly in app/globals.css.

import {
  baseColorsFor,
  isDarkBackground,
  mix,
  readableOn,
  textScaleFor,
  type ErnieAppearance,
  type ErnieFontKey,
} from "@/lib/ernie/appearance";

// Gray hex codes used directly in inline styles around the app. Each gets a
// --tone-XXXXXX variable when a non-default theme is active; tone() falls
// back to the original hex otherwise.
export const TONE_HEXES = [
  "#171717",
  "#191919",
  "#2a2a2a",
  "#404040",
  "#525252",
  "#6b6b68",
  "#737373",
  "#9a9a97",
  "#a3a3a3",
  "#f5f5f5",
] as const;
export type ToneHex = (typeof TONE_HEXES)[number];

// A gray from the original dark design, as a color that follows the
// person's theme. e.g. style={{ backgroundColor: tone("#171717") }}
export function tone(hex: ToneHex): string {
  return `var(--tone-${hex.slice(1)}, ${hex})`;
}

// Text in a data color (a calendar event's color, a distributor's color)
// sitting on a pale tint of itself. Exactly that color normally; on a light
// background it's darkened toward the text color so it stays readable.
export function chipText(color: string): string {
  return `color-mix(in srgb, ${color}, var(--color-white, #ffffff) var(--site-chip-shade, 0%))`;
}

// Tailwind's own gray scale (the hex equivalents of its default values) —
// the position of each shade between black and white decides how much of
// the person's text color gets blended into their background color.
const NEUTRAL_SCALE: Record<string, string> = {
  "50": "#fafafa",
  "100": "#f5f5f5",
  "200": "#e5e5e5",
  "300": "#d4d4d4",
  "400": "#a3a3a3",
  "500": "#737373",
  "600": "#525252",
  "700": "#404040",
  "800": "#262626",
  "900": "#171717",
  "950": "#0a0a0a",
};

// On a light background, pale status shades (text-yellow-400 etc.) would be
// nearly invisible, and the very dark tinted boxes (bg-red-950 etc.) would
// look like holes in the page — so they swap to their opposite shade.
// Values are Tailwind v4's own palette.
const LIGHT_MODE_STATUS_SWAP: Record<string, string> = {
  "--color-red-300": "oklch(50.5% 0.213 27.518)",
  "--color-red-400": "oklch(50.5% 0.213 27.518)",
  "--color-red-500": "oklch(50.5% 0.213 27.518)",
  "--color-red-800": "oklch(88.5% 0.062 18.334)",
  "--color-red-900": "oklch(93.6% 0.032 17.717)",
  "--color-red-950": "oklch(97.1% 0.013 17.38)",
  "--color-orange-300": "oklch(55.3% 0.195 38.402)",
  "--color-orange-400": "oklch(55.3% 0.195 38.402)",
  "--color-orange-500": "oklch(55.3% 0.195 38.402)",
  "--color-orange-800": "oklch(90.1% 0.076 70.697)",
  "--color-orange-900": "oklch(95.4% 0.038 75.164)",
  "--color-orange-950": "oklch(98% 0.016 73.684)",
  "--color-amber-300": "oklch(55.5% 0.163 48.998)",
  "--color-amber-400": "oklch(55.5% 0.163 48.998)",
  "--color-amber-500": "oklch(55.5% 0.163 48.998)",
  "--color-amber-800": "oklch(92.4% 0.12 95.746)",
  "--color-amber-900": "oklch(96.2% 0.059 95.617)",
  "--color-amber-950": "oklch(98.7% 0.022 95.277)",
  "--color-yellow-300": "oklch(55.4% 0.135 66.442)",
  "--color-yellow-400": "oklch(55.4% 0.135 66.442)",
  "--color-yellow-500": "oklch(55.4% 0.135 66.442)",
  "--color-yellow-800": "oklch(94.5% 0.129 101.54)",
  "--color-yellow-900": "oklch(97.3% 0.071 103.193)",
  "--color-yellow-950": "oklch(98.7% 0.026 102.212)",
  "--color-lime-300": "oklch(53.2% 0.157 131.589)",
  "--color-lime-400": "oklch(53.2% 0.157 131.589)",
  "--color-lime-500": "oklch(53.2% 0.157 131.589)",
  "--color-lime-800": "oklch(93.8% 0.127 124.321)",
  "--color-lime-900": "oklch(96.7% 0.067 122.328)",
  "--color-lime-950": "oklch(98.6% 0.031 120.757)",
  "--color-green-300": "oklch(52.7% 0.154 150.069)",
  "--color-green-400": "oklch(52.7% 0.154 150.069)",
  "--color-green-500": "oklch(52.7% 0.154 150.069)",
  "--color-green-800": "oklch(92.5% 0.084 155.995)",
  "--color-green-900": "oklch(96.2% 0.044 156.743)",
  "--color-green-950": "oklch(98.2% 0.018 155.826)",
  "--color-emerald-300": "oklch(50.8% 0.118 165.612)",
  "--color-emerald-400": "oklch(50.8% 0.118 165.612)",
  "--color-emerald-500": "oklch(50.8% 0.118 165.612)",
  "--color-emerald-800": "oklch(90.5% 0.093 164.15)",
  "--color-emerald-900": "oklch(95% 0.052 163.051)",
  "--color-emerald-950": "oklch(97.9% 0.021 166.113)",
  "--color-teal-300": "oklch(51.1% 0.096 186.391)",
  "--color-teal-400": "oklch(51.1% 0.096 186.391)",
  "--color-teal-500": "oklch(51.1% 0.096 186.391)",
  "--color-teal-800": "oklch(91% 0.096 180.426)",
  "--color-teal-900": "oklch(95.3% 0.051 180.801)",
  "--color-teal-950": "oklch(98.4% 0.014 180.72)",
  "--color-cyan-300": "oklch(52% 0.105 223.128)",
  "--color-cyan-400": "oklch(52% 0.105 223.128)",
  "--color-cyan-500": "oklch(52% 0.105 223.128)",
  "--color-cyan-800": "oklch(91.7% 0.08 205.041)",
  "--color-cyan-900": "oklch(95.6% 0.045 203.388)",
  "--color-cyan-950": "oklch(98.4% 0.019 200.873)",
  "--color-sky-300": "oklch(50% 0.134 242.749)",
  "--color-sky-400": "oklch(50% 0.134 242.749)",
  "--color-sky-500": "oklch(50% 0.134 242.749)",
  "--color-sky-800": "oklch(90.1% 0.058 230.902)",
  "--color-sky-900": "oklch(95.1% 0.026 236.824)",
  "--color-sky-950": "oklch(97.7% 0.013 236.62)",
  "--color-blue-300": "oklch(48.8% 0.243 264.376)",
  "--color-blue-400": "oklch(48.8% 0.243 264.376)",
  "--color-blue-500": "oklch(48.8% 0.243 264.376)",
  "--color-blue-800": "oklch(88.2% 0.059 254.128)",
  "--color-blue-900": "oklch(93.2% 0.032 255.585)",
  "--color-blue-950": "oklch(97% 0.014 254.604)",
  "--color-indigo-300": "oklch(45.7% 0.24 277.023)",
  "--color-indigo-400": "oklch(45.7% 0.24 277.023)",
  "--color-indigo-500": "oklch(45.7% 0.24 277.023)",
  "--color-indigo-800": "oklch(87% 0.065 274.039)",
  "--color-indigo-900": "oklch(93% 0.034 272.788)",
  "--color-indigo-950": "oklch(96.2% 0.018 272.314)",
  "--color-violet-300": "oklch(49.1% 0.27 292.581)",
  "--color-violet-400": "oklch(49.1% 0.27 292.581)",
  "--color-violet-500": "oklch(49.1% 0.27 292.581)",
  "--color-violet-800": "oklch(89.4% 0.057 293.283)",
  "--color-violet-900": "oklch(94.3% 0.029 294.588)",
  "--color-violet-950": "oklch(96.9% 0.016 293.756)",
  "--color-purple-300": "oklch(49.6% 0.265 301.924)",
  "--color-purple-400": "oklch(49.6% 0.265 301.924)",
  "--color-purple-500": "oklch(49.6% 0.265 301.924)",
  "--color-purple-800": "oklch(90.2% 0.063 306.703)",
  "--color-purple-900": "oklch(94.6% 0.033 307.174)",
  "--color-purple-950": "oklch(97.7% 0.014 308.299)",
  "--color-fuchsia-300": "oklch(51.8% 0.253 323.949)",
  "--color-fuchsia-400": "oklch(51.8% 0.253 323.949)",
  "--color-fuchsia-500": "oklch(51.8% 0.253 323.949)",
  "--color-fuchsia-800": "oklch(90.3% 0.076 319.62)",
  "--color-fuchsia-900": "oklch(95.2% 0.037 318.852)",
  "--color-fuchsia-950": "oklch(97.7% 0.017 320.058)",
  "--color-pink-300": "oklch(52.5% 0.223 3.958)",
  "--color-pink-400": "oklch(52.5% 0.223 3.958)",
  "--color-pink-500": "oklch(52.5% 0.223 3.958)",
  "--color-pink-800": "oklch(89.9% 0.061 343.231)",
  "--color-pink-900": "oklch(94.8% 0.028 342.258)",
  "--color-pink-950": "oklch(97.1% 0.014 343.198)",
  "--color-rose-300": "oklch(51.4% 0.222 16.935)",
  "--color-rose-400": "oklch(51.4% 0.222 16.935)",
  "--color-rose-500": "oklch(51.4% 0.222 16.935)",
  "--color-rose-800": "oklch(89.2% 0.058 10.001)",
  "--color-rose-900": "oklch(94.1% 0.03 12.58)",
  "--color-rose-950": "oklch(96.9% 0.015 12.422)",
};

// Arbitrary pixel text sizes used around the app (text-[11px] etc.) — these
// don't go through Tailwind's --text-* variables, so they're scaled here.
const PX_TEXT_SIZES = ["8", "9", "9.5", "10", "10.5", "11", "11.5", "12", "13", "13.5", "14", "15", "16"];

const TEXT_VARS: Record<string, number> = {
  "--text-xs": 0.75,
  "--text-sm": 0.875,
  "--text-base": 1,
  "--text-lg": 1.125,
  "--text-xl": 1.25,
  "--text-2xl": 1.5,
  "--text-3xl": 1.875,
  "--text-4xl": 2.25,
  "--text-5xl": 3,
};

function grayWeight(hex: string): number {
  // 0 = black (the person's background), 1 = white (the person's text)
  return parseInt(hex.slice(1, 3), 16) / 255;
}

export function siteFontStack(font: ErnieFontKey): string | null {
  switch (font) {
    case "simple":
      return "system-ui, 'Segoe UI', Roboto, sans-serif";
    case "serif":
      return "Georgia, 'Times New Roman', serif";
    case "rounded":
      return "var(--font-nunito), ui-rounded, system-ui, sans-serif";
    case "typewriter":
      return "var(--font-plex-mono), ui-monospace, monospace";
    default:
      return null; // the site's default font (Plus Jakarta Sans since 2026-10-03)
  }
}

// The CSS variables for this person's colors. Empty for FCB Dark.
export function siteColorVars(a: ErnieAppearance): Record<string, string> {
  if (a.preset === "fcb-dark") return {};
  const c = baseColorsFor(a);
  const bg = c.background;
  const fg = c.text;
  const dark = isDarkBackground(bg);
  const vars: Record<string, string> = {
    "--color-black": bg,
    "--color-white": fg,
    "--background": bg,
    "--foreground": mix(bg, fg, grayWeight("#e5e5e5")),
    "--site-accent": c.accent,
    "--site-accent-hover": dark ? mix(c.accent, "#ffffff", 0.15) : mix(c.accent, "#000000", 0.15),
    "--site-on-accent": readableOn(c.accent),
  };
  for (const [shade, hex] of Object.entries(NEUTRAL_SCALE)) {
    vars[`--color-neutral-${shade}`] = mix(bg, fg, grayWeight(hex));
  }
  for (const hex of TONE_HEXES) {
    vars[`--tone-${hex.slice(1)}`] = mix(bg, fg, grayWeight(hex));
  }
  if (!dark) {
    Object.assign(vars, LIGHT_MODE_STATUS_SWAP);
    vars["--site-chip-shade"] = "45%";
    // Facelift status pills (app/globals.css #6): darker text on light pages.
    vars["--st-green"] = "#2f7a1f";
    vars["--st-orange"] = "#9a5a00";
    vars["--st-blue"] = "#1f5fae";
    vars["--st-gray"] = mix(bg, fg, 0.65);
  }
  return vars;
}

// The complete stylesheet for this person's settings ("" for the default
// look). Rendered once on the server (no flash of the default colors on
// page load) and again live while the Customize window previews changes.
export function siteAppearanceCss(a: ErnieAppearance): string {
  const rules: string[] = [];
  const vars = siteColorVars(a);
  const scale = textScaleFor(a.textSize);
  if (scale !== 1) {
    for (const [name, rem] of Object.entries(TEXT_VARS)) vars[name] = `${(rem * scale).toFixed(4)}rem`;
  }
  const decls = Object.entries(vars).map(([k, v]) => `${k}:${v}`);
  if (decls.length) rules.push(`:root{${decls.join(";")}}`);

  const font = siteFontStack(a.font);
  if (font) rules.push(`.site-theme{font-family:${font}}`);
  if (scale !== 1) {
    rules.push(`.site-theme{font-size:${scale.toFixed(4)}rem}`);
    for (const px of PX_TEXT_SIZES) {
      const cls = `text-\\[${px.replace(".", "\\.")}px\\]`;
      rules.push(`.site-theme .${cls}{font-size:${(parseFloat(px) * scale).toFixed(2)}px}`);
    }
  }
  return rules.join("\n");
}
