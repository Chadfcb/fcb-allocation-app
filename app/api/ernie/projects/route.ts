import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

// Ernie Projects — named containers with their own file library and their
// own conversation history, visible only to whoever has been granted
// access (see sql/ernie_projects.sql). GET lists whichever projects RLS
// lets the signed-in user see — for a Basic/Employee user that's only
// projects they've been explicitly granted; for an admin (Manager or
// Administrator) that's every active project, no grant needed, same
// "admin bypasses everything" convention as the rest of the app.
//
// POST creates a brand-new project. Only Administrators/Managers can do
// this (enforced here AND by ernie_projects' own RLS write policy) — the
// creator is automatically granted access too, so their own new project
// tab shows up immediately rather than requiring a separate self-grant.

export async function GET() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  }

  const { data, error } = await supabase
    .from("ernie_projects")
    .select("id, name, description, created_by, created_at")
    .eq("active", true)
    .order("name", { ascending: true });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ projects: data ?? [] });
}

export async function POST(req: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  }

  const { data: profile } = await supabase.from("profiles").select("role").eq("id", user.id).single();
  if (profile?.role !== "admin") {
    return NextResponse.json(
      { error: "Only Administrators and Managers can create a Project." },
      { status: 403 },
    );
  }

  const body = (await req.json().catch(() => ({}))) as { name?: string; description?: string };
  const name = body.name?.trim();
  if (!name) {
    return NextResponse.json({ error: "A project name is required." }, { status: 400 });
  }

  const { data: project, error } = await supabase
    .from("ernie_projects")
    .insert({ name, description: body.description?.trim() || null, created_by: user.id })
    .select("id, name, description, created_by, created_at")
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  // Auto-grant the creator so their new project's tab appears right away.
  const { error: grantErr } = await supabase
    .from("ernie_project_access")
    .insert({ project_id: project.id, user_id: user.id, granted_by: user.id });

  if (grantErr) {
    // The project itself was created fine — surface this but don't fail
    // the whole request over it (an admin sees every project regardless).
    return NextResponse.json({ project, warning: "Project created, but the self-grant failed: " + grantErr.message });
  }

  return NextResponse.json({ project });
}
