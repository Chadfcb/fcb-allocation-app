"use client";

// "Customize" panel for the Ernie chat (added 2026-09-23 — see
// lib/ernie/appearance.ts for the why). Rendered inside ErnieChatClient's
// themed wrapper, so every change previews live on the real chat behind it;
// Cancel puts things back exactly as they were, Save stores it on this
// person's account (ernie_user_preferences).

import { useMemo, useState } from "react";
import {
  DEFAULT_ERNIE_APPEARANCE,
  ERNIE_FONTS,
  ERNIE_PRESETS,
  ERNIE_TEXT_SIZES,
  baseColorsFor,
  fontStackFor,
  isDarkBackground,
  readabilityWarnings,
  type ErnieAppearance,
  type ErnieBaseColors,
} from "@/lib/ernie/appearance";

const pill =
  "rounded-full border border-[color:var(--e-border)] bg-[color:var(--e-surface)] px-3 py-1.5 text-xs font-medium text-[color:var(--e-text)] transition-colors hover:border-[color:var(--e-accent)]/50 hover:text-[color:var(--e-accent-hover)]";
const pillActive =
  "rounded-full border border-[color:var(--e-accent)] bg-[color:var(--e-accent)] px-3 py-1.5 text-xs font-semibold text-[color:var(--e-on-accent)]";

const COLOR_FIELDS: { key: keyof ErnieBaseColors; label: string }[] = [
  { key: "background", label: "Background" },
  { key: "text", label: "Text" },
  { key: "userBubble", label: "Your messages" },
  { key: "ernieBubble", label: "Ernie's replies" },
  { key: "accent", label: "Buttons & highlights" },
];

export default function ErnieAppearancePanel({
  value,
  onChange,
  onSave,
  onCancel,
  saving,
  error,
}: {
  value: ErnieAppearance;
  onChange: (next: ErnieAppearance) => void;
  onSave: () => void;
  onCancel: () => void;
  saving: boolean;
  error: string | null;
}) {
  const [showCustom, setShowCustom] = useState(value.preset === "custom");
  const colors = baseColorsFor(value);
  const isDark = isDarkBackground(colors.background);
  const warnings = useMemo(() => readabilityWarnings(value), [value]);

  const setColor = (key: keyof ErnieBaseColors, v: string | null) => {
    // Editing any color turns the current theme into your own custom one,
    // starting from whatever you were looking at.
    onChange({ ...value, preset: "custom", colors: { ...colors, [key]: v } });
  };

  const toggleLightDark = () => {
    onChange({ ...value, preset: isDark ? "light" : "fcb-dark" });
    setShowCustom(false);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" onClick={onCancel}>
      <div
        className="flex max-h-[88vh] w-full max-w-lg flex-col rounded-xl border border-[color:var(--e-border)] bg-[color:var(--e-modal)] shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-[color:var(--e-divider)] px-5 py-4">
          <h2 className="font-[family-name:var(--e-font-head)] text-base font-bold text-[color:var(--e-text)]">
            Customize Ernie
          </h2>
          <button
            type="button"
            onClick={onCancel}
            className="text-[color:var(--e-muted)] hover:text-[color:var(--e-text)]"
            aria-label="Close"
          >
            ✕
          </button>
        </div>

        <div className="min-h-0 flex-1 space-y-5 overflow-y-auto px-5 py-4 font-[family-name:var(--e-font-body)]">
          <p className="text-xs text-[color:var(--e-muted)]">
            Only changes how Ernie looks for you. Changes preview live behind this window.
          </p>

          {/* Light / dark */}
          <div className="flex items-center justify-between">
            <span className="text-sm font-medium text-[color:var(--e-text)]">Light / dark</span>
            <button type="button" onClick={toggleLightDark} className={pill}>
              {isDark ? "☀ Switch to light" : "☾ Switch to dark"}
            </button>
          </div>

          {/* Themes */}
          <div className="space-y-2">
            <span className="text-sm font-medium text-[color:var(--e-text)]">Theme</span>
            <div className="grid grid-cols-2 gap-2">
              {ERNIE_PRESETS.map((p) => {
                const active = value.preset === p.key;
                return (
                  <button
                    key={p.key}
                    type="button"
                    onClick={() => {
                      onChange({ ...value, preset: p.key });
                      setShowCustom(false);
                    }}
                    className={`flex items-center gap-2 rounded-lg border px-2.5 py-2 text-left text-xs transition-colors ${
                      active
                        ? "border-[color:var(--e-accent)] text-[color:var(--e-text)]"
                        : "border-[color:var(--e-border)] text-[color:var(--e-text)] hover:border-[color:var(--e-accent)]/50"
                    }`}
                  >
                    <span
                      className="flex h-7 w-10 shrink-0 items-center justify-end rounded border border-black/20 px-1"
                      style={{ background: p.colors.background }}
                    >
                      <span className="h-3 w-5 rounded-sm" style={{ background: p.colors.userBubble }} />
                    </span>
                    <span className="truncate">{p.label}</span>
                  </button>
                );
              })}
              <button
                type="button"
                onClick={() => {
                  setShowCustom(true);
                  if (value.preset !== "custom") onChange({ ...value, preset: "custom", colors: { ...colors } });
                }}
                className={`flex items-center gap-2 rounded-lg border border-dashed px-2.5 py-2 text-left text-xs transition-colors ${
                  value.preset === "custom"
                    ? "border-[color:var(--e-accent)] text-[color:var(--e-text)]"
                    : "border-[color:var(--e-border)] text-[color:var(--e-muted)] hover:border-[color:var(--e-accent)]/50"
                }`}
              >
                <span className="flex h-7 w-10 shrink-0 items-center justify-center rounded border border-[color:var(--e-border)]">
                  🎨
                </span>
                <span>My own colors</span>
              </button>
            </div>
          </div>

          {/* Custom colors */}
          {showCustom && (
            <div className="space-y-2 rounded-lg border border-[color:var(--e-border)] bg-[color:var(--e-surface)] p-3">
              {COLOR_FIELDS.map((f) => {
                const v = colors[f.key];
                const isErnie = f.key === "ernieBubble";
                return (
                  <div key={f.key} className="flex items-center justify-between gap-3">
                    <span className="text-xs text-[color:var(--e-text)]">{f.label}</span>
                    <div className="flex items-center gap-2">
                      {isErnie && (
                        <label className="flex items-center gap-1 text-[11px] text-[color:var(--e-muted)]">
                          <input
                            type="checkbox"
                            className="accent-[color:var(--e-accent)]"
                            checked={v === null}
                            onChange={(e) => setColor("ernieBubble", e.target.checked ? null : colors.background === "#ffffff" ? "#f1f3ef" : "#ffffff")}
                          />
                          No bubble
                        </label>
                      )}
                      <input
                        type="color"
                        value={v ?? colors.background}
                        disabled={isErnie && v === null}
                        onChange={(e) => setColor(f.key, e.target.value)}
                        className="h-7 w-10 cursor-pointer rounded border border-[color:var(--e-border)] bg-transparent disabled:cursor-not-allowed disabled:opacity-40"
                        aria-label={f.label}
                      />
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          {/* Text size */}
          <div className="space-y-2">
            <span className="text-sm font-medium text-[color:var(--e-text)]">Text size</span>
            <div className="flex flex-wrap gap-2">
              {ERNIE_TEXT_SIZES.map((s) => (
                <button
                  key={s.key}
                  type="button"
                  onClick={() => onChange({ ...value, textSize: s.key })}
                  className={value.textSize === s.key ? pillActive : pill}
                >
                  {s.label}
                </button>
              ))}
            </div>
          </div>

          {/* Font */}
          <div className="space-y-2">
            <span className="text-sm font-medium text-[color:var(--e-text)]">Font</span>
            <div className="flex flex-wrap gap-2">
              {ERNIE_FONTS.map((f) => (
                <button
                  key={f.key}
                  type="button"
                  onClick={() => onChange({ ...value, font: f.key })}
                  className={value.font === f.key ? pillActive : pill}
                  style={{ fontFamily: fontStackFor(f.key).body }}
                >
                  {f.label}
                </button>
              ))}
            </div>
          </div>

          {warnings.length > 0 && (
            <div className="space-y-1 rounded-lg border border-amber-500/50 bg-amber-500/10 p-3">
              {warnings.map((w) => (
                <p key={w} className="text-xs text-amber-500">
                  ⚠ {w}
                </p>
              ))}
            </div>
          )}
          {error && <p className="text-xs text-red-400">{error}</p>}
        </div>

        <div className="flex items-center justify-between gap-2 border-t border-[color:var(--e-divider)] px-5 py-3">
          <button
            type="button"
            onClick={() => {
              onChange({ ...DEFAULT_ERNIE_APPEARANCE, colors: { ...DEFAULT_ERNIE_APPEARANCE.colors } });
              setShowCustom(false);
            }}
            className="text-xs font-medium text-[color:var(--e-muted)] hover:text-[color:var(--e-text)]"
          >
            Reset to default
          </button>
          <div className="flex items-center gap-2">
            <button type="button" onClick={onCancel} className={pill}>
              Cancel
            </button>
            <button
              type="button"
              onClick={onSave}
              disabled={saving}
              className="rounded-full bg-[color:var(--e-accent)] px-4 py-1.5 text-xs font-semibold text-[color:var(--e-on-accent)] transition-opacity hover:opacity-90 disabled:opacity-50"
            >
              {saving ? "Saving…" : warnings.length ? "Save anyway" : "Save"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
