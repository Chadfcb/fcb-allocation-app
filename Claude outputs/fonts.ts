// Web fonts used by the per-person Customize settings (and Ernie's chat
// design). Moved here from components/ErnieChatClient.tsx on 2026-09-29 when
// Customize became site-wide, so the font options work on every page — the
// (app) layout puts these variables on the whole app; Ernie still uses them
// for its own look. Nothing here changes the site's default font (Arial).
import { Archivo, IBM_Plex_Mono, IBM_Plex_Sans, Nunito } from "next/font/google";

export const archivo = Archivo({ subsets: ["latin"], weight: ["600", "700", "800"], variable: "--font-archivo" });
export const plexSans = IBM_Plex_Sans({ subsets: ["latin"], weight: ["400", "500", "600"], variable: "--font-plex-sans" });
export const plexMono = IBM_Plex_Mono({ subsets: ["latin"], weight: ["400", "500"], variable: "--font-plex-mono" });
export const nunito = Nunito({ subsets: ["latin"], weight: ["400", "600", "700"], variable: "--font-nunito" });

export const fontVariables = `${archivo.variable} ${plexSans.variable} ${plexMono.variable} ${nunito.variable}`;
