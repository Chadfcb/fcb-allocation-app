import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

// Creates a new user with a temporary password an admin sets directly —
// no invite email involved. The new account shows up in Admin > Users
// immediately (via the existing handle_new_user trigger, same as any
// other new sign-in) as a Basic user with must_change_password = true, so
// they're walked through /account-setup (choose their own password + name)
// the first time they sign in with the temporary password.
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

    const { email, password } = await req.json();

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
