import { createHash } from "crypto";
import { NextResponse } from "next/server";
import { getProfile } from "@/lib/getProfile";
import { hasSection } from "@/lib/permissions";
import { createAdminClient } from "@/lib/supabase/admin";

// Beer Finder step 2 (added 2026-11-04, per Chad: "lets make the page live").
// The public website finder can't read the private POS → Labels files, so the
// Beer Finder page draws each beer's 3D can (lib/beerCan3d.ts) and sends the
// finished picture here; it's saved to the PUBLIC beer-finder-public bucket
// and linked on the beer (beer_finder_beers.can_image / can_key). Happens on
// its own whenever a label or its front changes. Beer Finder access only.
//
// POST { product, key, png: "data:image/png;base64,…" }  → save the picture
// POST { product, key: null }                           → beer has no label now: clear it
const BUCKET = "beer-finder-public";
const MAX_BYTES = 3_000_000;

export async function POST(req: Request) {
  const profile = await getProfile();
  if (!profile) return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  if (!hasSection(profile.role, profile.sections, "beer_finder", profile.is_super_admin)) {
    return NextResponse.json({ error: "You don't have access to the Beer Finder." }, { status: 403 });
  }
  const body = (await req.json().catch(() => null)) as { product?: string; key?: string | null; png?: string } | null;
  const product = body?.product?.trim();
  if (!product) return NextResponse.json({ error: "Missing beer." }, { status: 400 });
  const admin = createAdminClient();

  if (!body?.key) {
    const { error } = await admin.from("beer_finder_beers").update({ can_image: null, can_key: null }).eq("product", product);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ ok: true });
  }

  const m = /^data:image\/png;base64,([A-Za-z0-9+/=]+)$/.exec(body.png ?? "");
  if (!m) return NextResponse.json({ error: "Missing can picture." }, { status: 400 });
  const bytes = Buffer.from(m[1], "base64");
  if (!bytes.length || bytes.length > MAX_BYTES) return NextResponse.json({ error: "Can picture is too big." }, { status: 400 });

  // A new file name for every label/front, so websites never show an old cached can.
  const h = (s: string) => createHash("sha1").update(s).digest("hex").slice(0, 12);
  const path = `cans/${h(product)}-${h(body.key)}.png`;
  const bucket = admin.storage.from(BUCKET);
  const up = await bucket.upload(path, bytes, { contentType: "image/png", upsert: true, cacheControl: "31536000" });
  if (up.error) return NextResponse.json({ error: up.error.message }, { status: 500 });
  const url = bucket.getPublicUrl(path).data.publicUrl;

  // Tidy up this beer's older pictures (best effort).
  const old = await bucket.list("cans", { limit: 1000, search: h(product) });
  const stale = (old.data ?? []).map((o) => `cans/${o.name}`).filter((p) => p !== path);
  if (stale.length) await bucket.remove(stale);

  const { error } = await admin.from("beer_finder_beers").update({ can_image: url, can_key: body.key }).eq("product", product);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true, url });
}
