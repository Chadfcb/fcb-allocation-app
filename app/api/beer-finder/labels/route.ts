import { NextResponse } from "next/server";
import { getProfile } from "@/lib/getProfile";
import { hasSection } from "@/lib/permissions";
import { createAdminClient } from "@/lib/supabase/admin";
import { POS_LABEL_FILES_BUCKET, POS_LABEL_BRAND_OPTIONS, POS_LABEL_SIZE_OPTIONS } from "@/lib/posLabels";

// Beer Finder: the can labels from POS → Labels (their JPG previews), with
// short-lived links to show them (added 2026-11-04, per Chad: "you need to use
// actual labels on those cans"). Server side so Beer Finder people see the
// labels even without POS → Labels access. Beer Finder access only.
export async function GET() {
  const profile = await getProfile();
  if (!profile) return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  if (!hasSection(profile.role, profile.sections, "beer_finder", profile.is_super_admin)) {
    return NextResponse.json({ error: "You don't have access to the Beer Finder." }, { status: 403 });
  }
  const admin = createAdminClient();
  const bucket = admin.storage.from(POS_LABEL_FILES_BUCKET);
  const folders = POS_LABEL_BRAND_OPTIONS.flatMap((b) => POS_LABEL_SIZE_OPTIONS.map((s) => ({ brand: b, size: s, dir: `previews/${b.value}/${s.value}` })));
  const lists = await Promise.all(folders.map(async (f) => ({ f, res: await bucket.list(f.dir, { limit: 200 }) })));
  const files: { path: string; brand: string; size: string; name: string }[] = [];
  for (const { f, res } of lists) {
    for (const o of res.data ?? []) {
      if (!/\.(jpe?g|png|webp)$/i.test(o.name)) continue;
      const pretty = o.name
        .replace(/\.[a-z]+$/i, "")
        .replace(new RegExp(`^${f.brand.value}_[0-9-]+oz_`, "i"), "")
        .replace(/[_-]+/g, " ")
        .replace(/\b\w/g, (c) => c.toUpperCase());
      files.push({ path: `${f.dir}/${o.name}`, brand: f.brand.label, size: f.size.value, name: pretty });
    }
  }
  const signed = files.length ? await bucket.createSignedUrls(files.map((x) => x.path), 60 * 60) : { data: [] };
  const url = new Map((signed.data ?? []).map((s) => [s.path, s.signedUrl]));
  return NextResponse.json({ labels: files.map((x) => ({ ...x, url: url.get(x.path) ?? null })) });
}
