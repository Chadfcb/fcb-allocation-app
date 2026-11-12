// Web fonts used by the per-person Customize settings (and Ernie's chat
// design). Moved here from components/ErnieChatClient.tsx on 2026-09-29 when
// Customize became site-wide, so the font options work on every page — the
// (app) layout puts these variables on the whole app; Ernie still uses them
// for its own look. Plus Jakarta Sans (added 2026-10-03, the app facelift)
// is the site's default font — see .site-theme in app/globals.css.
//
// 2026-11-12: switched from next/font/google to font files kept in the app
// (lib/font-files/, latin, from Fontsource — SIL Open Font License). Vercel
// builds kept failing when Google Fonts didn't answer ("Can't resolve
// '@vercel/turbopack-next/internal/font/google/font'" — IBM Plex Sans on one
// try, Archivo on the next), so builds no longer download fonts. Same fonts,
// same weights, same CSS variable names.
import localFont from "next/font/local";

export const archivo = localFont({
  src: [
    { path: "./font-files/archivo-latin-600-normal.woff2", weight: "600", style: "normal" },
    { path: "./font-files/archivo-latin-700-normal.woff2", weight: "700", style: "normal" },
    { path: "./font-files/archivo-latin-800-normal.woff2", weight: "800", style: "normal" },
  ],
  variable: "--font-archivo",
  display: "swap",
});
export const plexSans = localFont({
  src: [
    { path: "./font-files/ibm-plex-sans-latin-400-normal.woff2", weight: "400", style: "normal" },
    { path: "./font-files/ibm-plex-sans-latin-500-normal.woff2", weight: "500", style: "normal" },
    { path: "./font-files/ibm-plex-sans-latin-600-normal.woff2", weight: "600", style: "normal" },
  ],
  variable: "--font-plex-sans",
  display: "swap",
});
export const plexMono = localFont({
  src: [
    { path: "./font-files/ibm-plex-mono-latin-400-normal.woff2", weight: "400", style: "normal" },
    { path: "./font-files/ibm-plex-mono-latin-500-normal.woff2", weight: "500", style: "normal" },
  ],
  variable: "--font-plex-mono",
  display: "swap",
});
export const nunito = localFont({
  src: [
    { path: "./font-files/nunito-latin-400-normal.woff2", weight: "400", style: "normal" },
    { path: "./font-files/nunito-latin-600-normal.woff2", weight: "600", style: "normal" },
    { path: "./font-files/nunito-latin-700-normal.woff2", weight: "700", style: "normal" },
  ],
  variable: "--font-nunito",
  display: "swap",
});

export const jakarta = localFont({
  src: [
    { path: "./font-files/plus-jakarta-sans-latin-400-normal.woff2", weight: "400", style: "normal" },
    { path: "./font-files/plus-jakarta-sans-latin-500-normal.woff2", weight: "500", style: "normal" },
    { path: "./font-files/plus-jakarta-sans-latin-600-normal.woff2", weight: "600", style: "normal" },
    { path: "./font-files/plus-jakarta-sans-latin-700-normal.woff2", weight: "700", style: "normal" },
  ],
  variable: "--font-jakarta",
  display: "swap",
});

export const fontVariables = `${jakarta.variable} ${archivo.variable} ${plexSans.variable} ${plexMono.variable} ${nunito.variable}`;
