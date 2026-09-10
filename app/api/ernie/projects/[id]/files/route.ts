import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

// A Project's file library (see sql/ernie_projects.sql). GET is open to
// anyone with access to the project (RLS on ernie_project_files handles
// that automatically — this route doesn't need its own check). Adding or
// removing a file is Administrator/Manager only, same as creating a
// Project in the first place — enforced here and by ernie_project_files'
// own RLS write policy.
//
// The file's bytes are uploaded straight from the client to the
// "ernie-project-files" Storage bucket (same direct-to-storage pattern as
// ErnieChatClient's own file attach) — this route only ever records the
// resulting metadata row, never handles raw bytes itself.

async function requireAdmin(supabase: Awaited<ReturnType<typeof createClient>>) {
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: NextResponse.json({ error: "Not signed in" }, { status: 401 }) };

  const { data: profile } = await supabase.from("profiles").select("role").eq("id", user.id).single();
  if (profile?.role !== "admin") {
    return {
      error: NextResponse.json(
        { error: "Only Administrators and Managers can add or remove a Project's files." },
        { status: 403 },
      ),
    };
  }
  return { user };
}

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id: projectId } = await params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  }

  const { data, error } = await supabase
    .from("ernie_project_files")
    .select("id, file_name, storage_path, description, mime_type, size_bytes, added_by, created_at")
    .eq("project_id", projectId)
    .order("created_at", { ascending: false });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ files: data ?? [] });
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id: projectId } = await params;
  const supabase = await createClient();
  const gate = await requireAdmin(supabase);
  if (gate.error) return gate.error;

  const body = (await req.json().catch(() => ({}))) as {
    file_name?: string;
    storage_path?: string;
    description?: string;
    mime_type?: string;
    size_bytes?: number;
  };

  if (!body.file_name || !body.storage_path) {
    return NextResponse.json({ error: "file_name and storage_path are required" }, { status: 400 });
  }

  const { data, error } = await supabase
    .from("ernie_project_files")
    .insert({
      project_id: projectId,
      file_name: body.file_name,
      storage_path: body.storage_path,
      description: body.description?.trim() || null,
      mime_type: body.mime_type || null,
      size_bytes: body.size_bytes ?? null,
      added_by: gate.user!.id,
    })
    .select("id, file_name, storage_path, description, mime_type, size_bytes, added_by, created_at")
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ file: data });
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id: projectId } = await params;
  const supabase = await createClient();
  const gate = await requireAdmin(supabase);
  if (gate.error) return gate.error;

  const fileId = req.nextUrl.searchParams.get("fileId");
  if (!fileId) {
    return NextResponse.json({ error: "fileId is required" }, { status: 400 });
  }

  const { data: file, error: fetchErr } = await supabase
    .from("ernie_project_files")
    .select("id, storage_path")
    .eq("id", fileId)
    .eq("project_id", projectId)
    .maybeSingle();
  if (fetchErr) return NextResponse.json({ error: fetchErr.message }, { status: 500 });
  if (!file) return NextResponse.json({ error: "File not found" }, { status: 404 });

  // Best-effort — an orphaned storage object with no metadata row left
  // behind is harmless (nobody can find or read it without the row).
  await supabase.storage.from("ernie-project-files").remove([file.storage_path]);

  const { error } = await supabase.from("ernie_project_files").delete().eq("id", fileId);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ ok: true });
}
