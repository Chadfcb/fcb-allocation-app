import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

// Manage-access for one Ernie Project — Administrators/Managers only,
// enforced here and by ernie_project_access's own RLS write policy.
// GET returns every FCB user (profiles is world-readable by RLS design,
// same carve-out run_read_only_query relies on) alongside whether each one
// currently has an access row for this project, so the UI can render one
// checkbox per person. POST grants a user; DELETE (?userId=) revokes one.

async function requireAdmin(supabase: Awaited<ReturnType<typeof createClient>>) {
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: NextResponse.json({ error: "Not signed in" }, { status: 401 }) };

  const { data: profile } = await supabase.from("profiles").select("role").eq("id", user.id).single();
  if (profile?.role !== "admin") {
    return {
      error: NextResponse.json(
        { error: "Only Administrators and Managers can manage a Project's access." },
        { status: 403 },
      ),
    };
  }
  return { user };
}

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id: projectId } = await params;
  const supabase = await createClient();
  const gate = await requireAdmin(supabase);
  if (gate.error) return gate.error;

  const [{ data: profiles, error: profilesErr }, { data: access, error: accessErr }] = await Promise.all([
    supabase.from("profiles").select("id, full_name, email, role").order("full_name", { ascending: true }),
    supabase.from("ernie_project_access").select("user_id, granted_at").eq("project_id", projectId),
  ]);

  if (profilesErr) return NextResponse.json({ error: profilesErr.message }, { status: 500 });
  if (accessErr) return NextResponse.json({ error: accessErr.message }, { status: 500 });

  const grantedByUserId = new Map((access ?? []).map((a) => [a.user_id, a.granted_at]));

  const users = (profiles ?? []).map((p) => ({
    id: p.id,
    full_name: p.full_name,
    email: p.email,
    role: p.role,
    has_access: grantedByUserId.has(p.id),
    granted_at: grantedByUserId.get(p.id) ?? null,
  }));

  return NextResponse.json({ users });
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id: projectId } = await params;
  const supabase = await createClient();
  const gate = await requireAdmin(supabase);
  if (gate.error) return gate.error;

  const body = (await req.json().catch(() => ({}))) as { userId?: string };
  if (!body.userId) {
    return NextResponse.json({ error: "userId is required" }, { status: 400 });
  }

  const { error } = await supabase
    .from("ernie_project_access")
    .upsert(
      { project_id: projectId, user_id: body.userId, granted_by: gate.user!.id },
      { onConflict: "project_id,user_id" },
    );

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id: projectId } = await params;
  const supabase = await createClient();
  const gate = await requireAdmin(supabase);
  if (gate.error) return gate.error;

  const userId = req.nextUrl.searchParams.get("userId");
  if (!userId) {
    return NextResponse.json({ error: "userId is required" }, { status: 400 });
  }

  const { error } = await supabase
    .from("ernie_project_access")
    .delete()
    .eq("project_id", projectId)
    .eq("user_id", userId);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
