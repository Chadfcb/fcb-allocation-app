import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

// Lists the signed-in user's own Ernie conversations, most recently
// updated first — powers the history list in the Ernie chat UI. Open to
// every signed-in user (Basic and admin alike); RLS on ernie_conversations
// already restricts this to the caller's own rows regardless of role.

export async function GET() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  }

  const { data, error } = await supabase
    .from("ernie_conversations")
    .select("id, title, created_at, updated_at")
    .order("updated_at", { ascending: false });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ conversations: data ?? [] });
}
