import { createClient as createSupabaseClient } from "@supabase/supabase-js";

// Admin-privileged Supabase client — uses the SERVICE ROLE key, which
// bypasses Row Level Security entirely and can perform privileged Auth
// operations like creating users directly. This must NEVER be imported
// into a "use client" component or otherwise exposed to the browser — it
// is only safe to use inside server-only code (Route Handlers, Server
// Actions, Server Components). SUPABASE_SERVICE_ROLE_KEY is intentionally
// NOT prefixed with NEXT_PUBLIC_ so Next.js never bundles it into
// client-side JavaScript.
export function createAdminClient() {
  return createSupabaseClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
      },
    }
  );
}
