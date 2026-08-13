import { createClient } from "@/lib/supabase/server";
import type { Profile } from "@/lib/types/db";

// Fetches the signed-in user's profile (including their role). Returns null
// if nobody is signed in — middleware already redirects that case to /login,
// so this is mostly a type-safety convenience for server components.
export async function getProfile(): Promise<Profile | null> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) return null;

  const { data } = await supabase.from("profiles").select("*").eq("id", user.id).single();

  return (data as Profile) ?? null;
}
