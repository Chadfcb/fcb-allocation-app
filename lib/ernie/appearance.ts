// Per-person Ernie chat appearance (added 2026-09-23).
//
// Per Chad, after Shanelle asked Ernie to "change the background to white
// and the text to black": "If shanelle isnt happy with the color of ernie she
// wont use him." Each person can pick a theme, flip light/dark, set their own
// colors, text size, and font for the Ernie page + Project chats ONLY — the
// rest of FCB-Data is untouched. Saved per person in
// ernie_user_preferences (sql/ernie_user_preferences.sql), so it follows them
// to any device.
//
// How it's applied: ErnieChatClient.tsx's colors are CSS variables (--e-*),
// set from these settings on the chat's outer <div>. The default ("FCB
// Dark") reproduces the original hand-picked colors exactly, so anyone who
// never opens Customize sees no change at all.

export type ErnieFontKey = "standard" | "simple" | "serif" | "rounded" | "typewriter";
export type ErnieTextSize = "small" | "medium" | "large" | "xlarge";
export type ErniePresetKey = "fcb-dark" | "light" | "fcb-green" | "midnight" | "high-contrast" | "custom";

// The five colors a person can set by hand. Everything else is derived.
export interface ErnieBaseColors {
  background: string; // chat panel background
  text: string; // main text
  accent: string; // buttons, links, highlights
  userBubble: string; // your own message bubbles
  ernieBubble: string | null; // Ernie's replies (null = no bubble, just text)
}

export interface ErnieAppearance {
  preset: ErniePresetKey;
  colors: ErnieBaseColors; // only used when preset === "custom"
  font: ErnieFontKey;
  textSize: ErnieTextSize;
}

export interface ErniePreset {
  key: Exclude<ErniePresetKey, "custom">;
  label: string;
  mode: "light" | "dark";
  colors: ErnieBaseColors;
  // Optional exact overrides for derived tokens (used by FCB Dark so the
  // default is pixel-identical to the original design).
  exact?: Partial<ErnieTokens>;
}

export const ERNIE_PRESETS: ErniePreset[] = [
  {
    key: "fcb-dark",
    label: "FCB Dark (default)",
    mode: "dark",
    colors: { background: "#12150f", text: "#eef1e9", accent: "#6ABC46", userBubble: "#6ABC46", ernieBubble: null },
    exact: {
      "--e-panel": "#12150f",
      "--e-modal": "#12150e",
      "--e-surface": "#181c13",
      "--e-border": "#262c1f",
      "--e-divider": "#1c2117",
      "--e-text": "#eef1e9",
      "--e-muted": "#8f9885",
      "--e-faint": "#5d6456",
      "--e-accent": "#6ABC46",
      "--e-accent-hover": "#7fce5c",
      "--e-accent-dark": "#4c8a32",
      "--e-on-accent": "#0b0e09",
      "--e-deep": "#0b0e09",
      "--e-user-bg": "#6ABC46",
      "--e-user-text": "#0b0e09",
    },
  },
  {
    key: "light",
    label: "White & Black",
    mode: "light",
    colors: { background: "#ffffff", text: "#111111", accent: "#3f8f24", userBubble: "#3f8f24", ernieBubble: null },
  },
  {
    key: "fcb-green",
    label: "FCB Green",
    mode: "light",
    colors: { background: "#f2f8ee", text: "#16210f", accent: "#4c8a32", userBubble: "#6ABC46", ernieBubble: "#ffffff" },
  },
  {
    key: "midnight",
    label: "Midnight Blue",
    mode: "dark",
    colors: { background: "#0f1624", text: "#e8edf6", accent: "#5b9cff", userBubble: "#5b9cff", ernieBubble: null },
  },
  {
    key: "high-contrast",
    label: "High Contrast",
    mode: "dark",
    colors: { background: "#000000", text: "#ffffff", accent: "#ffd400", userBubble: "#ffd400", ernieBubble: null },
  },
];

export const ERNIE_FONTS: { key: ErnieFontKey; label: string }[] = [
  { key: "standard", label: "Standard" },
  { key: "simple", label: "Simple" },
  { key: "serif", label: "Classic serif" },
  { key: "rounded", label: "Rounded" },
  { key: "typewriter", label: "Typewriter" },
];

export const ERNIE_TEXT_SIZES: { key: ErnieTextSize; label: string; scale: number }[] = [
  { key: "small", label: "Small", scale: 0.9 },
  { key: "medium", label: "Medium", scale: 1 },
  { key: "large", label: "Large", scale: 1.15 },
  { key: "xlarge", label: "Extra large", scale: 1.3 },
];

export const DEFAULT_ERNIE_APPEARANCE: ErnieAppearance = {
  preset: "fcb-dark",
  colors: { ...ERNIE_PRESETS[0].colors },
  font: "standard",
  textSize: "medium",
};

export type ErnieTokens = Record<
  | "--e-panel"
  | "--e-modal"
  | "--e-surface"
  | "--e-border"
  | "--e-divider"
  | "--e-text"
  | "--e-muted"
  | "--e-faint"
  | "--e-accent"
  | "--e-accent-hover"
  | "--e-accent-dark"
  | "--e-on-accent"
  | "--e-deep"
  | "--e-user-bg"
  | "--e-user-text"
  | "--e-ernie-bg"
  | "--e-ernie-text"
  | "--e-ernie-pad",
  string
>;

// ---- color math -------------------------------------------------------

const HEX_RE = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i;

export function isHexColor(v: unknown): v is string {
  return typeof v === "string" && HEX_RE.test(v.trim());
}

function toRgb(hex: string): [number, number, number] {
  let h = hex.trim().replace("#", "");
  if (h.length === 3) h = h.split("").map((c) => c + c).join("");
  const n = parseInt(h, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function toHex([r, g, b]: [number, number, number]): string {
  return "#" + [r, g, b].map((v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, "0")).join("");
}

// weight = how much of `b` to mix into `a` (0..1)
function mix(a: string, b: string, weight: number): string {
  const x = toRgb(a);
  const y = toRgb(b);
  return toHex([x[0] + (y[0] - x[0]) * weight, x[1] + (y[1] - x[1]) * weight, x[2] + (y[2] - x[2]) * weight]);
}

function luminance(hex: string): number {
  const [r, g, b] = toRgb(hex).map((v) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

export function contrastRatio(a: string, b: string): number {
  const la = luminance(a);
  const lb = luminance(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

// Black or white — whichever reads better on this color.
function readableOn(bg: string): string {
  return contrastRatio(bg, "#0b0e09") >= contrastRatio(bg, "#ffffff") ? "#0b0e09" : "#ffffff";
}

// ---- resolving settings into CSS variables ----------------------------

export function baseColorsFor(a: ErnieAppearance): ErnieBaseColors {
  if (a.preset === "custom") return a.colors;
  return (ERNIE_PRESETS.find((p) => p.key === a.preset) ?? ERNIE_PRESETS[0]).colors;
}

export function isDarkBackground(hex: string): boolean {
  return luminance(hex) < 0.2;
}

export function resolveErnieTokens(a: ErnieAppearance): ErnieTokens {
  const c = baseColorsFor(a);
  const dark = isDarkBackground(c.background);
  const tokens: ErnieTokens = {
    "--e-panel": c.background,
    "--e-modal": c.background,
    "--e-surface": mix(c.background, c.text, dark ? 0.05 : 0.04),
    "--e-border": mix(c.background, c.text, dark ? 0.12 : 0.14),
    "--e-divider": mix(c.background, c.text, dark ? 0.07 : 0.09),
    "--e-text": c.text,
    "--e-muted": mix(c.text, c.background, 0.42),
    "--e-faint": mix(c.text, c.background, 0.6),
    "--e-accent": c.accent,
    "--e-accent-hover": dark ? mix(c.accent, "#ffffff", 0.15) : mix(c.accent, "#000000", 0.15),
    "--e-accent-dark": mix(c.accent, "#000000", 0.28),
    "--e-on-accent": readableOn(c.accent),
    "--e-deep": dark ? mix(c.background, "#000000", 0.4) : mix(c.background, "#000000", 0.05),
    "--e-user-bg": c.userBubble,
    "--e-user-text": readableOn(c.userBubble),
    "--e-ernie-bg": c.ernieBubble ?? "transparent",
    "--e-ernie-text": c.ernieBubble ? readableOn(c.ernieBubble) : c.text,
    "--e-ernie-pad": c.ernieBubble ? "0.625rem" : "0px",
  };
  if (a.preset !== "custom") {
    const exact = ERNIE_PRESETS.find((p) => p.key === a.preset)?.exact;
    if (exact) Object.assign(tokens, exact);
  }
  return tokens;
}

export function fontStackFor(font: ErnieFontKey): { body: string; head: string } {
  switch (font) {
    case "simple":
      return { body: "Arial, Helvetica, system-ui, sans-serif", head: "Arial, Helvetica, system-ui, sans-serif" };
    case "serif":
      return { body: "Georgia, 'Times New Roman', serif", head: "Georgia, 'Times New Roman', serif" };
    case "rounded":
      return { body: "var(--font-nunito), ui-rounded, system-ui, sans-serif", head: "var(--font-nunito), ui-rounded, system-ui, sans-serif" };
    case "typewriter":
      return { body: "var(--font-plex-mono), ui-monospace, monospace", head: "var(--font-plex-mono), ui-monospace, monospace" };
    default:
      return { body: "var(--font-plex-sans), system-ui, sans-serif", head: "var(--font-archivo), system-ui, sans-serif" };
  }
}

export function textScaleFor(size: ErnieTextSize): number {
  return ERNIE_TEXT_SIZES.find((s) => s.key === size)?.scale ?? 1;
}

// Scoped CSS that scales the chat's text-size utility classes. Written as a
// plain (un-layered) stylesheet so it wins over Tailwind's utilities, and
// scoped to .ernie-theme so nothing outside Ernie changes. Only rendered
// when the scale isn't 1.
export function textScaleCss(scale: number): string {
  if (scale === 1) return "";
  const rem = (v: number) => `${(v * scale).toFixed(4)}rem`;
  return [
    `.ernie-theme .text-\\[10px\\]{font-size:${rem(0.625)}}`,
    `.ernie-theme .text-\\[11px\\]{font-size:${rem(0.6875)}}`,
    `.ernie-theme .text-xs{font-size:${rem(0.75)}}`,
    `.ernie-theme .text-sm{font-size:${rem(0.875)}}`,
    `.ernie-theme .text-base{font-size:${rem(1)}}`,
    `.ernie-theme .text-lg{font-size:${rem(1.125)}}`,
    `.ernie-theme .text-xl{font-size:${rem(1.25)}}`,
  ].join("\n");
}

// Accepts whatever is stored in the database (possibly from an older
// version, or hand-edited) and always returns a complete, valid setting.
export function normalizeErnieAppearance(raw: unknown): ErnieAppearance {
  const d = DEFAULT_ERNIE_APPEARANCE;
  if (!raw || typeof raw !== "object") return { ...d, colors: { ...d.colors } };
  const r = raw as Partial<ErnieAppearance> & { colors?: Partial<ErnieBaseColors> };
  const presetKeys: ErniePresetKey[] = [...ERNIE_PRESETS.map((p) => p.key), "custom"];
  const preset = presetKeys.includes(r.preset as ErniePresetKey) ? (r.preset as ErniePresetKey) : d.preset;
  const rc: Partial<ErnieBaseColors> = r.colors ?? {};
  const colors: ErnieBaseColors = {
    background: isHexColor(rc.background) ? rc.background : d.colors.background,
    text: isHexColor(rc.text) ? rc.text : d.colors.text,
    accent: isHexColor(rc.accent) ? rc.accent : d.colors.accent,
    userBubble: isHexColor(rc.userBubble) ? rc.userBubble : d.colors.userBubble,
    ernieBubble: rc.ernieBubble === null ? null : isHexColor(rc.ernieBubble) ? rc.ernieBubble : d.colors.ernieBubble,
  };
  const font = ERNIE_FONTS.some((f) => f.key === r.font) ? (r.font as ErnieFontKey) : d.font;
  const textSize = ERNIE_TEXT_SIZES.some((s) => s.key === r.textSize) ? (r.textSize as ErnieTextSize) : d.textSize;
  return { preset, colors, font, textSize };
}

// Readability problems worth warning about before saving.
export function readabilityWarnings(a: ErnieAppearance): string[] {
  const c = baseColorsFor(a);
  const warnings: string[] = [];
  if (contrastRatio(c.text, c.background) < 4.5) {
    warnings.push("The text color is hard to read on this background.");
  }
  if (c.ernieBubble && contrastRatio(c.ernieBubble, c.background) < 1.08) {
    warnings.push("Ernie's bubble color is almost the same as the background, so it won't stand out.");
  }
  if (contrastRatio(c.accent, c.background) < 2) {
    warnings.push("The accent color blends into the background, so buttons may be hard to see.");
  }
  return warnings;
}
