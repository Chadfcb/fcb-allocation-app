"use client";

import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

// Sidebar section expand/collapse state is remembered in localStorage
// across ordinary page loads/reloads (see components/Sidebar.tsx) so it
// doesn't reset every time someone navigates — but per Chad, 2026-09-05,
// a fresh login should always start with everything closed, not whatever
// was left open from the previous person's session on that browser.
// Clearing these keys on sign-out (rather than changing Sidebar's own
// defaults) keeps the "stays collapsed as you navigate" behavior intact
// during normal use and only resets it at the actual login boundary.
const SIDEBAR_STORAGE_KEYS = [
  "fcb-sidebar-operations-expanded",
  "fcb-sidebar-sales-expanded",
  "fcb-sidebar-calendars-expanded",
  "fcb-sidebar-pos-expanded",
];
const POS_TREE_STORAGE_KEY = "fcb-sidebar-pos-tree-expanded";

export default function SignOutButton() {
  const router = useRouter();
  const supabase = createClient();

  async function handleSignOut() {
    for (const key of SIDEBAR_STORAGE_KEYS) {
      localStorage.setItem(key, "false");
    }
    localStorage.setItem(POS_TREE_STORAGE_KEY, JSON.stringify({ "pos-labels": false, upcs: false }));
    await supabase.auth.signOut();
    router.push("/login");
    router.refresh();
  }

  return (
    <button onClick={handleSignOut} className="inline-flex h-10 items-center rounded-md border border-white/10 px-4 text-sm text-neutral-300 hover:bg-white/[0.07]">
      Sign out
    </button>
  );
}
