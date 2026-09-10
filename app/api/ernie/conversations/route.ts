import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

// Lists the signed-in user's own Ernie conversations, most recently
// updated first — powers the history list in the Ernie chat UI. Open to
// every signed-in user (Basic and admin alike); RLS on ernie_conversations
// already restricts this to the caller's own rows regardless of role.
//
// A Project's conversation history is its own separate list (added
// 2026-09-10, see sql/ernie_projects.sql) — pass ?projectId=<id> to get
// only that project's conversations; omit it for the normal, general
// history (project_id is null). The two never mix, in either direction.

export async function GET(req: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  }

  const projectId = req.nextUrl.searchParams.get("projectId");

  let query = supabase
    .from("ernie_conversations")
    .select("id, title, created_at, updated_at")
    .order("updated_at", { ascending: false });

  query = projectId ? query.eq("project_id", projectId) : query.is("project_id", null);

  const { data, error } = await query;

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ conversations: data ?? [] });
}
