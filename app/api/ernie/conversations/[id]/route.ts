import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

// Loads one Ernie conversation's full message history — used both to
// restore "the conversation I was just in" after navigating back to /ernie,
// and to reopen a past conversation picked from the history list. RLS on
// ernie_conversations/ernie_messages already restricts this to the caller's
// own rows, so a foreign or stale id just comes back as "not found".

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

  const { data: profile } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", user.id)
    .single();

  if (profile?.role !== "admin") {
    return NextResponse.json(
      { error: "Ernie is only available to admins" },
      { status: 403 },
    );
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
    .select("role, content, created_at")
    .eq("conversation_id", id)
    .order("created_at", { ascending: true });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({
    conversation,
    messages: (messages ?? []).map((m) => ({ role: m.role, text: m.content })),
  });
}
