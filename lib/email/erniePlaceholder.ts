// The gray "Swap this picture" box Ernie's "Edit email" puts where a photo
// belongs (added 2026-11-05). Ernie can't cut photos out of an uploaded
// design or invent picture links, so it leaves this box instead. Safe to use
// in the browser and on the server. The designer won't send a test or a real
// email while one of these is still in the email.

export const ERNIE_SWAP_MARKER = "ernie-swap-picture";

const SVG =
  `<svg xmlns="http://www.w3.org/2000/svg" id="${ERNIE_SWAP_MARKER}" width="1200" height="600" viewBox="0 0 1200 600">` +
  `<rect width="1200" height="600" fill="#e5e5e5"/>` +
  `<rect x="12" y="12" width="1176" height="576" fill="none" stroke="#9ca3af" stroke-width="6" stroke-dasharray="24 16"/>` +
  `<text x="600" y="285" text-anchor="middle" font-family="Arial, Helvetica, sans-serif" font-size="56" font-weight="bold" fill="#4b5563">Swap this picture</text>` +
  `<text x="600" y="355" text-anchor="middle" font-family="Arial, Helvetica, sans-serif" font-size="34" fill="#6b7280">Double-click to pick one from the Creative Library</text>` +
  `</svg>`;

export const ERNIE_SWAP_SRC = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(SVG)}`;

/** True if the email still has one of Ernie's "Swap this picture" boxes. */
export function hasSwapPictures(html: string): boolean {
  return html.includes(ERNIE_SWAP_MARKER) || html.includes(encodeURIComponent(ERNIE_SWAP_MARKER));
}
