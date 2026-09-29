"use client";

// Site-wide per-person appearance (added 2026-09-29 — see lib/appearance.ts
// for the why and how). Wraps every signed-in page via app/(app)/layout.tsx.
//
// - `initial` is this person's saved setting, read on the server, so the
//   page is already in their colors on first paint (no flash of FCB Dark).
// - The Customize button in the header (components/CustomizeButton.tsx)
//   calls openCustomize(); while the window is open every change previews
//   live on the real page behind it. Cancel puts things back exactly as they
//   were; Save stores it on this person's account (ernie_user_preferences —
//   same table Ernie's old Customize used, so nobody loses their choices).
// - Ernie's chat reads the same setting through useSiteAppearance().

import { createContext, useCallback, useContext, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import AppearancePanel from "@/components/AppearancePanel";
import { siteAppearanceCss } from "@/lib/appearance";
import { DEFAULT_ERNIE_APPEARANCE, type ErnieAppearance } from "@/lib/ernie/appearance";

interface SiteAppearanceContextValue {
  // What's showing right now (the live preview while Customize is open).
  appearance: ErnieAppearance;
  openCustomize: () => void;
}

const SiteAppearanceContext = createContext<SiteAppearanceContextValue>({
  appearance: DEFAULT_ERNIE_APPEARANCE,
  openCustomize: () => {},
});

export function useSiteAppearance(): SiteAppearanceContextValue {
  return useContext(SiteAppearanceContext);
}

export default function SiteAppearanceProvider({
  initial,
  children,
}: {
  initial: ErnieAppearance;
  children: React.ReactNode;
}) {
  const supabase = useMemo(() => createClient(), []);
  const [saved, setSaved] = useState<ErnieAppearance>(initial);
  const [draft, setDraft] = useState<ErnieAppearance | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const shown = draft ?? saved;
  const css = useMemo(() => siteAppearanceCss(shown), [shown]);

  const openCustomize = useCallback(() => {
    setError(null);
    setDraft({ ...saved, colors: { ...saved.colors } });
  }, [saved]);

  async function save() {
    if (!draft) return;
    setSaving(true);
    setError(null);
    try {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) throw new Error("Not signed in.");
      const { error: dbError } = await supabase
        .from("ernie_user_preferences")
        .upsert(
          { user_id: user.id, appearance: draft, updated_at: new Date().toISOString() },
          { onConflict: "user_id" },
        );
      if (dbError) throw dbError;
      setSaved(draft);
      setDraft(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't save your settings.");
    } finally {
      setSaving(false);
    }
  }

  const value = useMemo(() => ({ appearance: shown, openCustomize }), [shown, openCustomize]);

  return (
    <SiteAppearanceContext.Provider value={value}>
      {/* Empty for the default look, so FCB Dark is exactly the original site. */}
      {css && <style>{css}</style>}
      {children}
      {draft && (
        <AppearancePanel
          value={draft}
          onChange={setDraft}
          onSave={save}
          onCancel={() => {
            setDraft(null);
            setError(null);
          }}
          saving={saving}
          error={error}
        />
      )}
    </SiteAppearanceContext.Provider>
  );
}
