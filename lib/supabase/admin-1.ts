import { createClient as createSupabaseClient } from "@supabase/supabase-js";

// Service-role Supabase client — bypasses Row Level Security entirely.
// ONLY for server-side code with no signed-in user to act as (e.g. the
// scheduled task-reminders cron job below), never for anything a browser
// request can reach. The service role key must never be exposed to the
// client — it's read from an env var that's server-only (no NEXT_PUBLIC_
// prefix), and this file should only ever be imported from a Route Handler
// or other server-only code.
export function createAdminClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !serviceRoleKey) {
    throw new Error(
      "Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY — the admin client can't be created.",
    );
  }

  return createSupabaseClient(url, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}
