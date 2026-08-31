import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

// Loads one Ernie conversation's full message history — used both to
// restore "the conversation I was just in" after navigating back to /ernie,
// and to reopen a past conversation picked from the history list. Open to
// every signed-in user (Basic and admin alike); RLS on
// ernie_conversations/ernie_messages already restricts this to the caller's
// own rows, so a foreign or stale id just comes back as "not found".
//
// Each message's attached/produced files (added 2026-08-31) are resolved
// into real file metadata here (RLS on ernie_files scopes this to the
// caller's own files too) so reopening an old conversation still shows
// download chips for whatever was uploaded or produced in it. source_bucket
// (added 2026-08-31) is included so a file Ernie fetched from elsewhere in
// the app (e.g. via get_file_for_download) still downloads from wherever
// it actually lives, not from the default ernie-files bucket.

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

  const { data: conversation, error: convErr } = await supabase
    .from("ernie_conversations")
    .select("id, title")
    .eq("id", id)
    .maybeSingle();

  if (convErr) {
    return NextResponse.json({ error: convErr.message }, { status: 500 });
  }
  if (!conversation) {
    return NextResponse.json({ error: "Conversation not found" }, { status: 404 });
  }

  const { data: messages, error } = await supabase
    .from("ernie_messages")
    .select("role, content, file_ids, created_at")
    .eq("conversation_id", id)
    .order("created_at", { ascending: true });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const allFileIds = Array.from(new Set((messages ?? []).flatMap((m) => m.file_ids ?? [])));
  const filesById = new Map<
    string,
    {
      id: string;
      file_name: string;
      mime_type: string | null;
      size_bytes: number | null;
      source_bucket: string | null;
    }
  >();
  if (allFileIds.length > 0) {
    const { data: fileRows } = await supabase
      .from("ernie_files")
      .select("id, file_name, mime_type, size_bytes, source_bucket")
      .in("id", allFileIds);
    for (const f of fileRows ?? []) filesById.set(f.id, f);
  }

  return NextResponse.json({
    conversation,
    messages: (messages ?? []).map((m) => ({
      role: m.role,
      text: m.content,
      files: (m.file_ids ?? [])
        .map((fid: string) => filesById.get(fid))
        .filter((f: unknown): f is NonNullable<typeof f> => Boolean(f)),
    })),
  });
}
