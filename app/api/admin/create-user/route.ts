import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { ALL_SECTION_KEYS, ERNIE_SECTION, type AnySectionKey } from "@/lib/permissions";

const VALID_SECTIONS = new Set<AnySectionKey>([...ALL_SECTION_KEYS, ERNIE_SECTION]);

// Creates a new user with a temporary password an admin sets directly —
// no invite email involved. The new account shows up in Admin > Users
// immediately (via the existing handle_new_user trigger, same as any
// other new sign-in) as a Basic user with must_change_password = true, so
// they're walked through /account-setup (choose their own password + name)
// the first time they sign in with the temporary password.
//
// Role + initial section grants (see lib/permissions.ts) are applied right
// after, using the admin client — the trigger's own insert always defaults
// role to 'basic' with no sections, so an "Admin" pick or any checked
// section is a follow-up update/insert, not part of the trigger itself.
export async function POST(req: NextRequest) {
  // Wrapped in try/catch so this route can never crash into a bare/hung
  // response — the client's fetch always gets back valid JSON with a real
  // error message, instead of the "Add User" button spinning forever on an
  // unhandled exception.
  try {
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
        { error: "Only admins can add users" },
        { status: 403 },
      );
    }

    const { email, password, role, sections } = (await req.json()) as {
      email?: string;
      password?: string;
      role?: string;
      sections?: string[];
    };

    if (typeof email !== "string" || !email.trim() || !email.includes("@")) {
      return NextResponse.json(
        { error: "Enter a valid email address" },
        { status: 400 },
      );
    }
    if (typeof password !== "string" || password.length < 8) {
      return NextResponse.json(
        { error: "Temporary password must be at least 8 characters" },
        { status: 400 },
      );
    }
    if (role !== undefined && role !== "admin" && role !== "basic") {
      return NextResponse.json({ error: "Role must be admin or basic" }, { status: 400 });
    }
    const requestedSections = (sections ?? []).filter((s): s is AnySectionKey =>
      VALID_SECTIONS.has(s as AnySectionKey),
    );

    if (!process.env.SUPABASE_SERVICE_ROLE_KEY) {
      // This is the most likely real-world cause of this route failing —
      // the service role key (needed to create auth users directly) isn't
      // set in this environment's variables. Surface that plainly instead
      // of letting the request fail deep inside the Supabase client.
      return NextResponse.json(
        {
          error:
            "Server is missing SUPABASE_SERVICE_ROLE_KEY — add it in Vercel's Environment Variables and redeploy.",
        },
        { status: 500 },
      );
    }

    const adminClient = createAdminClient();
    const { data: created, error } = await adminClient.auth.admin.createUser({
      email: email.trim(),
      password,
      email_confirm: true,
    });

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }

    const newUserId = created.user?.id;

    if (newUserId) {
      if (role === "admin") {
        await adminClient.from("profiles").update({ role: "admin" }).eq("id", newUserId);
      }
      // role === "basic" needs no update — the handle_new_user trigger
      // already defaults every new profile to basic.
      if (role !== "admin" && requestedSections.length > 0) {
        await adminClient
          .from("user_section_access")
          .insert(requestedSections.map((section_key) => ({ user_id: newUserId, section_key })));
      }
    }

    return NextResponse.json({
      id: created.user?.id,
      email: created.user?.email,
    });
  } catch (err) {
    return NextResponse.json(
      {
        error:
          err instanceof Error
            ? err.message
            : "Unexpected server error creating user",
      },
      { status: 500 },
    );
  }
}
