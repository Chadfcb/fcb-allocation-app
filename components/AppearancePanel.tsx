"use client";

// The Customize window (site-wide since 2026-09-29 — see lib/appearance.ts).
// Opened from the Customize button in the top header. Styled with the
// site's own gray scale, so it recolors itself live along with the page
// behind it as the person tries themes. Replaces the Ernie-only
// components/ErnieAppearancePanel.tsx (no longer used anywhere).

import { useMemo, useState } from "react";
import {
  DEFAULT_ERNIE_APPEARANCE,
  ERNIE_FONTS,
  ERNIE_PRESETS,
  ERNIE_TEXT_SIZES,
  baseColorsFor,
  isDarkBackground,
  readabilityWarnings,
  type ErnieAppearance,
  type ErnieBaseColors,
} from "@/lib/ernie/appearance";
import { siteFontStack } from "@/lib/appearance";

const pill =
  "rounded-full border border-neutral-700 bg-neutral-900 px-3 py-1.5 text-xs font-medium text-neutral-200 transition-colors hover:border-brand/60 hover:text-white";
const pillActive =
  "rounded-full border border-brand bg-brand px-3 py-1.5 text-xs font-semibold text-on-brand";

const SITE_COLOR_FIELDS: { key: keyof ErnieBaseColors; label: string }[] = [
  { key: "background", label: "Background" },
  { key: "text", label: "Text" },
  { key: "accent", label: "Buttons & highlights" },
];
const ERNIE_COLOR_FIELDS: { key: keyof ErnieBaseColors; label: string }[] = [
  { key: "userBubble", label: "Your messages" },
  { key: "ernieBubble", label: "Ernie's replies" },
];

export default function AppearancePanel({
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

  const colorRow = (f: { key: keyof ErnieBaseColors; label: string }) => {
    const v = colors[f.key];
    const isErnie = f.key === "ernieBubble";
    return (
      <div key={f.key} className="flex items-center justify-between gap-3">
        <span className="text-xs text-neutral-200">{f.label}</span>
        <div className="flex items-center gap-2">
          {isErnie && (
            <label className="flex items-center gap-1 text-[11px] text-neutral-400">
              <input
                type="checkbox"
                className="accent-brand"
                checked={v === null}
                onChange={(e) =>
                  setColor("ernieBubble", e.target.checked ? null : colors.background === "#ffffff" ? "#f1f3ef" : "#ffffff")
                }
              />
              No bubble
            </label>
          )}
          <input
            type="color"
            value={v ?? colors.background}
            disabled={isErnie && v === null}
            onChange={(e) => setColor(f.key, e.target.value)}
            className="h-7 w-10 cursor-pointer rounded border border-neutral-700 bg-transparent disabled:cursor-not-allowed disabled:opacity-40"
            aria-label={f.label}
          />
        </div>
      </div>
    );
  };

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 p-4" onClick={onCancel}>
      <div
        className="flex max-h-[88vh] w-full max-w-lg flex-col rounded-xl border border-neutral-800 bg-neutral-950 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-neutral-800 px-5 py-4">
          <h2 className="text-base font-bold text-white">Customize</h2>
          <button type="button" onClick={onCancel} className="text-neutral-400 hover:text-white" aria-label="Close">
            ✕
          </button>
        </div>

        <div className="min-h-0 flex-1 space-y-5 overflow-y-auto px-5 py-4">
          <p className="text-xs text-neutral-400">
            Changes how FCB-Data looks for you on every page, Ernie included. Nobody else sees your
            choices. Changes preview live behind this window.
          </p>

          {/* Light / dark */}
          <div className="flex items-center justify-between">
            <span className="text-sm font-medium text-neutral-100">Light / dark</span>
            <button type="button" onClick={toggleLightDark} className={pill}>
              {isDark ? "☀ Switch to light" : "☾ Switch to dark"}
            </button>
          </div>

          {/* Themes */}
          <div className="space-y-2">
            <span className="text-sm font-medium text-neutral-100">Theme</span>
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
                    className={`flex items-center gap-2 rounded-lg border px-2.5 py-2 text-left text-xs text-neutral-100 transition-colors ${
                      active ? "border-brand" : "border-neutral-700 hover:border-brand/60"
                    }`}
                  >
                    {/* Swatches show each theme's real colors, not the current theme's. */}
                    <span
                      className="flex h-7 w-10 shrink-0 items-center justify-end rounded border px-1"
                      style={{
                        background: p.key === "fcb-dark" ? "#000000" : p.colors.background,
                        borderColor: "rgba(128,128,128,0.35)",
                      }}
                    >
                      <span className="h-3 w-5 rounded-sm" style={{ background: p.colors.accent }} />
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
                    ? "border-brand text-neutral-100"
                    : "border-neutral-700 text-neutral-400 hover:border-brand/60"
                }`}
              >
                <span className="flex h-7 w-10 shrink-0 items-center justify-center rounded border border-neutral-700">
                  🎨
                </span>
                <span>My own colors</span>
              </button>
            </div>
          </div>

          {/* Custom colors */}
          {showCustom && (
            <div className="space-y-2 rounded-lg border border-neutral-800 bg-neutral-900 p-3">
              {SITE_COLOR_FIELDS.map(colorRow)}
              <p className="pt-2 text-[11px] font-semibold uppercase tracking-wide text-neutral-500">Ernie chat</p>
              {ERNIE_COLOR_FIELDS.map(colorRow)}
            </div>
          )}

          {/* Text size */}
          <div className="space-y-2">
            <span className="text-sm font-medium text-neutral-100">Text size</span>
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
            <span className="text-sm font-medium text-neutral-100">Font</span>
            <div className="flex flex-wrap gap-2">
              {ERNIE_FONTS.map((f) => (
                <button
                  key={f.key}
                  type="button"
                  onClick={() => onChange({ ...value, font: f.key })}
                  className={value.font === f.key ? pillActive : pill}
                  style={{ fontFamily: siteFontStack(f.key) ?? "Arial, Helvetica, sans-serif" }}
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

        <div className="flex items-center justify-between gap-2 border-t border-neutral-800 px-5 py-3">
          <button
            type="button"
            onClick={() => {
              onChange({ ...DEFAULT_ERNIE_APPEARANCE, colors: { ...DEFAULT_ERNIE_APPEARANCE.colors } });
              setShowCustom(false);
            }}
            className="text-xs font-medium text-neutral-400 hover:text-white"
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
              className="rounded-full bg-brand px-4 py-1.5 text-xs font-semibold text-on-brand transition-opacity hover:opacity-90 disabled:opacity-50"
            >
              {saving ? "Saving…" : warnings.length ? "Save anyway" : "Save"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
