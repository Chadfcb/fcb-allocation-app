import { createAdminClient } from "@/lib/supabase/admin";
import { emailStudioProfile } from "@/lib/email/studioAccess";
import { ASPECTS, checkAnimation, ernieImage, monthlyUsage, startAnimation, type Aspect } from "@/lib/email/ernieStudio";

// Ernie inside Email Studio (added 2026-10-30, per Chad). Email Studio access
// only. Results go into the Creative Library. The monthly cap is enforced in
// lib/email/ernieStudio.ts before anything is sent to Google.
//   GET  → this month's usage + animations still rendering (to resume polling)
//   POST { action: "create" | "edit", prompt, sourceAssetId?, aspect?, high? } → new Creative Library image
//   POST { action: "animate", prompt, sourceAssetId, seconds, tall } → { jobId }
//   POST { action: "check", jobId } → pending / done (with the video) / error
export const dynamic = "force-dynamic";
export const maxDuration = 120;

export async function GET() {
  if (!(await emailStudioProfile())) return Response.json({ error: "No access" }, { status: 403 });
  const admin = createAdminClient();
  try {
    const usage = await monthlyUsage(admin);
    const { data: pending } = await admin
      .from("creative_ernie_jobs")
      .select("id, prompt, source_asset_id, created_at")
      .eq("kind", "animate")
      .eq("status", "pending")
      .order("created_at", { ascending: false })
      .limit(10);
    return Response.json({ usage, pending: pending ?? [], ready: !!process.env.GEMINI_API_KEY });
  } catch (e) {
    return Response.json({ error: e instanceof Error ? e.message : "Couldn't load" }, { status: 500 });
  }
}

export async function POST(request: Request) {
  const profile = await emailStudioProfile();
  if (!profile) return Response.json({ error: "No access" }, { status: 403 });
  let body: {
    action?: string;
    prompt?: string;
    sourceAssetId?: string | null;
    aspect?: string | null;
    high?: boolean;
    seconds?: number;
    tall?: boolean;
    jobId?: string;
  };
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Bad request" }, { status: 400 });
  }
  const admin = createAdminClient();
  try {
    if (body.action === "create" || body.action === "edit") {
      if (body.action === "edit" && !body.sourceAssetId) return Response.json({ error: "Pick an image to edit." }, { status: 400 });
      const aspect = ASPECTS.includes(body.aspect as Aspect) ? (body.aspect as Aspect) : null;
      const asset = await ernieImage(admin, profile.id, {
        prompt: body.prompt ?? "",
        sourceAssetId: body.action === "edit" ? body.sourceAssetId : null,
        aspect,
        high: !!body.high,
      });
      return Response.json({ asset, usage: await monthlyUsage(admin) });
    }
    if (body.action === "animate") {
      if (!body.sourceAssetId) return Response.json({ error: "Pick an image to animate." }, { status: 400 });
      const seconds = body.seconds === 4 || body.seconds === 6 ? body.seconds : 8;
      const jobId = await startAnimation(admin, profile.id, {
        prompt: body.prompt ?? "",
        sourceAssetId: body.sourceAssetId,
        seconds,
        tall: !!body.tall,
      });
      return Response.json({ jobId, usage: await monthlyUsage(admin) });
    }
    if (body.action === "check") {
      if (!body.jobId) return Response.json({ error: "Bad request" }, { status: 400 });
      return Response.json(await checkAnimation(admin, body.jobId));
    }
    return Response.json({ error: "Bad request" }, { status: 400 });
  } catch (e) {
    return Response.json({ error: e instanceof Error ? e.message : "Something went wrong." }, { status: 400 });
  }
}
