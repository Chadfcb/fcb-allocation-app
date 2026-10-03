import { NextRequest, NextResponse } from "next/server";
import { getProfile } from "@/lib/getProfile";
import { createClient } from "@/lib/supabase/server";
import { runAutoSyncs, SYNC_SOURCES } from "@/lib/syncs/autoSyncs";

// Admin → Ekos Sync controls (added 2026-10-03). Admins only.
//   { action: "run_now" }                         — run every switched-on source now
//   { action: "set_enabled", key, enabled }       — flip a source's on/off switch
export const maxDuration = 300;

export async function POST(req: NextRequest) {
  const profile = await getProfile();
  if (!profile || profile.role !== "admin") {
    return NextResponse.json({ error: "Admins only" }, { status: 403 });
  }

  const body = ((await req.json().catch(() => ({}))) ?? {}) as {
    action?: string;
    key?: string;
    enabled?: boolean;
  };

  if (body.action === "run_now") {
    const summary = await runAutoSyncs("run_now", profile.id);
    return NextResponse.json({ ok: true, ...summary });
  }

  if (body.action === "set_enabled") {
    const source = SYNC_SOURCES.find((s) => s.key === body.key);
    if (!source) return NextResponse.json({ error: "Unknown sync source" }, { status: 400 });
    if (body.enabled && !source.run) {
      return NextResponse.json(
        { error: `${source.label} can't be switched on yet — its automatic reading step hasn't been built.` },
        { status: 400 },
      );
    }
    const supabase = await createClient();
    const { error } = await supabase
      .from("sync_sources")
      .update({ enabled: !!body.enabled, updated_at: new Date().toISOString() })
      .eq("key", source.key);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ ok: true });
  }

  return NextResponse.json({ error: "Unknown action" }, { status: 400 });
}
