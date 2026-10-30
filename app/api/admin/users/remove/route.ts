import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

// Admin → Users: "Remove access" / "Restore" (added 2026-10-19, per Chad —
// Ryan was let go and there was no way to remove someone in the app).
// SQL: sql/user_removal.sql.
//
//   { action: "remove", userId }   blocks their login (Supabase ban, ~100
//       years), Employee tier, every section grant removed (incl. Ernie AI —
//       app and Slack), marks removed_at / removed_by. History is kept.
//   { action: "restore", userId }  lifts the login block and clears the
//       removed mark. They come back as an Employee with NO sections — an
//       admin re-grants what they should see with Edit access.
//
// Who can: any admin (Manager or Administrator). Removing or restoring a
// Manager / Administrator takes an Administrator. Nobody can remove
// themselves.
const BAN_FOREVER = "876000h"; // ~100 years

export async function POST(req: NextRequest) {
  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: "Not signed in" }, { status: 401 });

    const { data: me } = await supabase.from("profiles").select("role, is_super_admin").eq("id", user.id).single();
    if (me?.role !== "admin") return NextResponse.json({ error: "Only admins can remove users." }, { status: 403 });
    // 2026-10-29: Users page access — Administrators, or a Manager granted it.
    if (!me.is_super_admin) {
      const { data: grant } = await supabase
        .from("user_section_access")
        .select("section_key")
        .eq("user_id", user.id)
        .eq("section_key", "admin_users")
        .maybeSingle();
      if (!grant) return NextResponse.json({ error: "You don't have access to Users." }, { status: 403 });
    }

    const { action, userId } = ((await req.json().catch(() => ({}))) ?? {}) as { action?: string; userId?: string };
    if (action !== "remove" && action !== "restore") {
      return NextResponse.json({ error: "Unknown action" }, { status: 400 });
    }
    if (typeof userId !== "string" || !userId) return NextResponse.json({ error: "No user picked." }, { status: 400 });
    if (userId === user.id) return NextResponse.json({ error: "You can't remove yourself." }, { status: 400 });

    const admin = createAdminClient();
    const { data: target } = await admin
      .from("profiles")
      .select("id, email, role, is_super_admin, removed_at")
      .eq("id", userId)
      .single();
    if (!target) return NextResponse.json({ error: "That user wasn't found." }, { status: 404 });
    if (target.role === "admin" && !me.is_super_admin) {
      return NextResponse.json(
        { error: "Only an Administrator can remove or restore a Manager or Administrator." },
        { status: 403 },
      );
    }

    if (action === "remove") {
      // 1. Block the login first — the part that matters most.
      const { error: banError } = await admin.auth.admin.updateUserById(userId, { ban_duration: BAN_FOREVER });
      if (banError) return NextResponse.json({ error: `Couldn't block their login: ${banError.message}` }, { status: 500 });
      // 2. No sections, Employee tier, marked removed.
      const { error: grantsError } = await admin.from("user_section_access").delete().eq("user_id", userId);
      if (grantsError) {
        return NextResponse.json(
          { error: `Login blocked, but their section access couldn't be cleared: ${grantsError.message}` },
          { status: 500 },
        );
      }
      const { error: profileError } = await admin
        .from("profiles")
        .update({ role: "basic", is_super_admin: false, removed_at: new Date().toISOString(), removed_by: user.id })
        .eq("id", userId);
      if (profileError) {
        return NextResponse.json(
          { error: `Login blocked and sections cleared, but the profile couldn't be updated: ${profileError.message}` },
          { status: 500 },
        );
      }
      return NextResponse.json({ ok: true });
    }

    // restore
    const { error: unbanError } = await admin.auth.admin.updateUserById(userId, { ban_duration: "none" });
    if (unbanError) return NextResponse.json({ error: `Couldn't lift the login block: ${unbanError.message}` }, { status: 500 });
    const { error: restoreError } = await admin
      .from("profiles")
      .update({ removed_at: null, removed_by: null })
      .eq("id", userId);
    if (restoreError) return NextResponse.json({ error: restoreError.message }, { status: 500 });
    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 });
  }
}
