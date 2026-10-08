"use client";

// "New!" badges for buttons/features INSIDE a page (added 2026-09-23).
//
// Per Chad: every new thing added anywhere in the app should show New! for
// everyone until they click it for the first time — and it has to be a
// CHAIN: the top-level sidebar section shows New!, the page link under it
// shows New!, and on that page the new button itself shows New!. Clicking
// the button clears the whole trail for that person (on every device).
//
// STANDING RULE (see claude/deployment-workflow.md in the project): whenever
// a new button/feature is added to an existing page, add one entry to
// NEW_FEATURES below and render <NewBadge /> on it via useNewFeature(id).
// Brand-new PAGES still go in NEW_SIDEBAR_IDS in components/Sidebar.tsx.
// Sidebar.tsx reads this list too, so the page link and its section light up
// automatically — nothing else to remember.
//
// Seen state lives in the same per-person table the sidebar badges already
// use (sidebar_new_seen: user_id + item_id), so no new SQL. Once a feature
// has been out a while, just delete its entry.

import { useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";

export interface NewFeature {
  id: string; // unique, prefixed "feature:"
  page: string; // the sidebar href of the page it lives on
  label: string; // what it is (for humans reading this file)
  added: string; // YYYY-MM-DD
}

export const NEW_FEATURES: NewFeature[] = [
  {
    id: "feature:accounts-product-hide",
    page: "/sales/accounts",
    label: "Hide items / Unhide items buttons on Sales > Accounts > Product Lookup (shared list of products we don't make anymore)",
    added: "2026-10-08",
  },
  {
    id: "feature:accounts-product-lookup",
    page: "/sales/accounts",
    label: "Product Lookup tab on Sales > Accounts (cases by product, size, distributor, rep, account and month range)",
    added: "2026-10-08",
  },
  // "feature:ernie-customize" (the old Ernie-only Customize button) was
  // removed 2026-09-29 — that button is gone, replaced by the site-wide one
  // below. Leaving it here would light up the My Ernie AI link forever with
  // nothing on the page to click to clear it.
  {
    id: "feature:site-customize",
    // Lives in the top header on every page, not on one page — no sidebar
    // link matches this, so only the button itself shows New!.
    page: "header",
    label: "Customize button in the top header (per-person colors, text size, font for the whole site)",
    added: "2026-09-29",
  },
  {
    id: "feature:events-google-sync",
    page: "/events",
    label: "Google Calendar button on the Events Calendar (two-way Google sync)",
    added: "2026-09-23",
  },
];

// Fired whenever someone clicks a new feature, so the sidebar clears its
// trail immediately (no page reload).
export const NEW_SEEN_EVENT = "fcb:new-seen";

export function featureIdsOnPage(page: string): string[] {
  return NEW_FEATURES.filter((f) => f.page === page).map((f) => f.id);
}

export function isFlaggedFeature(id: string): boolean {
  return NEW_FEATURES.some((f) => f.id === id);
}

// For a button on a page: is it still new for this person, and a dismiss()
// to call from the button's onClick.
export function useNewFeature(id: string): { isNew: boolean; dismiss: () => void } {
  const supabase = useMemo(() => createClient(), []);
  const flagged = isFlaggedFeature(id);
  // Start hidden until we know, so a badge never flashes for someone who
  // already clicked it.
  const [seen, setSeen] = useState<boolean>(true);

  useEffect(() => {
    if (!flagged) return;
    let cancelled = false;
    (async () => {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) return;
      const { data } = await supabase
        .from("sidebar_new_seen")
        .select("item_id")
        .eq("user_id", user.id)
        .eq("item_id", id)
        .maybeSingle();
      if (!cancelled) setSeen(!!data);
    })().catch(() => {});
    const onSeen = (e: Event) => {
      if ((e as CustomEvent<string>).detail === id) setSeen(true);
    };
    window.addEventListener(NEW_SEEN_EVENT, onSeen);
    return () => {
      cancelled = true;
      window.removeEventListener(NEW_SEEN_EVENT, onSeen);
    };
  }, [supabase, id, flagged]);

  function dismiss() {
    if (!flagged || seen) return;
    setSeen(true);
    window.dispatchEvent(new CustomEvent(NEW_SEEN_EVENT, { detail: id }));
    (async () => {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) return;
      await supabase
        .from("sidebar_new_seen")
        .upsert({ user_id: user.id, item_id: id }, { onConflict: "user_id,item_id", ignoreDuplicates: true });
    })().catch(() => {});
  }

  return { isNew: flagged && !seen, dismiss };
}
