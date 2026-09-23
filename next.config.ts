import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Ernie's own web browser (lib/ernie/browser.ts) — these must load as
  // normal Node packages at runtime rather than being bundled, or the
  // serverless Chromium can't find/unpack itself.
  serverExternalPackages: ["@sparticuz/chromium-min", "puppeteer-core"],
};

export default nextConfig;
