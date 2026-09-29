"use client";

// "Customize" button in the top header on every page (added 2026-09-29).
// Opens the site-wide Customize window (components/SiteAppearanceProvider.tsx)
// — each person's own theme / colors / text size / font for all of FCB-Data,
// Ernie included. Replaces the old Ernie-only Customize button that lived
// on the Ernie chat.
//
// New! badge: shows until this person clicks the button once. It lives in
// the header rather than on one page, so there's no sidebar link/section to
// light up — the badge is on the button itself.
import NewBadge from "@/components/NewBadge";
import { useSiteAppearance } from "@/components/SiteAppearanceProvider";
import { useNewFeature } from "@/lib/newFeatures";

export default function CustomizeButton() {
  const { openCustomize } = useSiteAppearance();
  const customizeNew = useNewFeature("feature:site-customize");

  return (
    <button
      type="button"
      onClick={() => {
        customizeNew.dismiss();
        openCustomize();
      }}
      title="Change FCB-Data's colors, text size, and font (just for you)"
      className="inline-flex items-center rounded-md border border-neutral-700 bg-neutral-900 px-3 py-1.5 text-sm font-medium text-neutral-200 hover:bg-neutral-800"
    >
      Customize
      {customizeNew.isNew && <NewBadge inline />}
    </button>
  );
}
