import type { Metadata } from "next";
import { createClient } from "@supabase/supabase-js";
import BeerFinderPublic from "@/components/BeerFinderPublic";
import type { PubData } from "@/lib/beerFinder";

// PUBLIC (no login) — the Beer Finder for our websites, step 2 (added
// 2026-11-04, per Chad: "lets make the page live" at "beer-finder"). Shown
// inside fullcirclebrewing.com and fcbbrands.com with an Embed HTML box (Wix):
//   <iframe src="https://www.fcb-data.com/beer-finder" style="width:100%;height:1000px;border:0"
//     title="Find Full Circle beer near you" loading="lazy" allow="geolocation"></iframe>
// No FCB-Data sidebar or header (it sits outside the app's (app) pages). Only
// public info (beer_finder_public() in sql/beer_finder_public.sql); what shows
// is set on the internal page's Control tab (www.fcb-data.com/beer-finder/manage).
// Refreshed every 5 minutes, so Control tab changes show here within 5 minutes.
export const revalidate = 300;

export const metadata: Metadata = {
  title: "Find Our Beer | Full Circle Brewing",
  description: "Find stores, bars and restaurants near you that carry Full Circle Brewing beer.",
};

async function load(): Promise<PubData | null> {
  try {
    const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { data, error } = await sb.rpc("beer_finder_public");
    if (error) return null;
    return data as PubData;
  } catch {
    return null;
  }
}

export default async function PublicBeerFinderPage() {
  const data = await load();
  return <BeerFinderPublic data={data} />;
}
