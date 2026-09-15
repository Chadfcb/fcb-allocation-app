import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { checkVideoJob } from "@/lib/ernie/files";

// Checks on one animate_image render (see lib/ernie/tools.ts, lib/ernie/
// files.ts) — polled by the client every few seconds while a job is
// pending (ErnieChatClient.tsx), since a video render (1-3+ minutes) can
// never finish inside the single chat request that started it.
//
// RLS on ernie_video_jobs (owner-only, see sql/ernie_video_jobs.sql) means
// this naturally only ever lets someone poll their OWN job — a foreign or
// stale id just comes back "not found", same as every other per-user
// lookup in this app. Every call is cheap and safe to repeat: if the job
// is already done or already errored, checkVideoJob just returns that
// stored result without re-hitting Google; only a still-pending job
// actually checks in with the video service.
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  }

  try {
    const result = await checkVideoJob(supabase, id);
    return NextResponse.json(result);
  } catch (err) {
    return NextResponse.json(
      { status: "error", error: err instanceof Error ? err.message : "Couldn't check that job." },
      { status: 500 },
    );
  }
}
