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
      className="inline-flex h-10 items-center rounded-md border border-white/10 bg-white/[0.03] px-4 text-sm font-medium text-neutral-200 hover:bg-white/[0.07]"
    >
      Customize
      {customizeNew.isNew && <NewBadge inline />}
    </button>
  );
}
