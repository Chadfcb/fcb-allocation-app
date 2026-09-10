import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

// Close/reopen and permanent delete for one Ernie Project (see
// sql/ernie_projects.sql). Both admin-only, enforced here AND by
// ernie_projects' own RLS write policy.
//
// PATCH { active } — non-destructive close (active: false) / reopen
// (active: true). Closing just drops the Project out of the active tab
// row's query (GET in ../route.ts filters on `active`) — it never touches
// the Project's files, access grants, or conversation history, so
// reopening brings all of that straight back exactly as it was.
//
// DELETE — the one permanent/hard-delete exception in this app, mirroring
// Purchase Orders Holding's own permanent-delete precedent (see
// PurchaseOrdersPageClient.tsx). Irreversible: cascades to
// ernie_project_access and ernie_project_files (both `on delete cascade`),
// and any ernie_conversations rows that belonged to this Project are kept
// but detached (`on delete set null` — same as closing, this never deletes
// someone's conversation history). The Project's Storage objects in the
// "ernie-project-files" bucket are left as harmless orphans, same
// reasoning as the per-file DELETE in ../[id]/files/route.ts.

async function requireAdmin(supabase: Awaited<ReturnType<typeof createClient>>) {
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: NextResponse.json({ error: "Not signed in" }, { status: 401 }) };

  const { data: profile } = await supabase.from("profiles").select("role").eq("id", user.id).single();
  if (profile?.role !== "admin") {
    return {
      error: NextResponse.json(
        { error: "Only Administrators and Managers can close, reopen, or delete a Project." },
        { status: 403 },
      ),
    };
  }
  return { user };
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id: projectId } = await params;
  const supabase = await createClient();
  const gate = await requireAdmin(supabase);
  if (gate.error) return gate.error;

  const body = (await req.json().catch(() => ({}))) as { active?: boolean };
  if (typeof body.active !== "boolean") {
    return NextResponse.json({ error: "active (boolean) is required" }, { status: 400 });
  }

  const { data: project, error } = await supabase
    .from("ernie_projects")
    .update({ active: body.active })
    .eq("id", projectId)
    .select("id, name, description, created_by, created_at")
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ project });
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id: projectId } = await params;
  const supabase = await createClient();
  const gate = await requireAdmin(supabase);
  if (gate.error) return gate.error;

  const { error } = await supabase.from("ernie_projects").delete().eq("id", projectId);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ ok: true });
}
