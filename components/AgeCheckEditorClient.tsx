"use client";

import { useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { uploadCreativeFiles } from "@/lib/creativeAssets";
import {
  APP_ORIGIN,
  DEFAULT_SETTINGS,
  FONTS,
  MIN_AGE,
  REMEMBER_DAYS,
  cleanSettings,
  previewPage,
  type AgeCheckSettings,
  type AgeLogo,
} from "@/lib/ageCheck";

// Admin → Age Check editor (added 2026-10-30, per Chad). Change the look and
// wording of the 21+ check on FCB's websites with a live preview; Save and
// both sites update within about a minute. Birth date / 21+ / every page /
// remembered 30 days are locked (lib/ageCheck.ts).

export type LibraryImage = { id: string; name: string; public_url: string; mime_type: string | null; width: number | null; height: number | null };

const SCRIPT_TAG = `<script src="${APP_ORIGIN}/api/age-check/script"></script>`;

function fmt(iso: string) {
  return new Date(iso).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit", timeZone: "America/Los_Angeles" });
}

export default function AgeCheckEditorClient({
  initial,
  hasSaved,
  updatedAt,
  updatedByName,
  library: initialLibrary,
  loadError,
}: {
  initial: AgeCheckSettings;
  hasSaved: boolean;
  updatedAt: string | null;
  updatedByName: string | null;
  library: LibraryImage[];
  loadError: string | null;
}) {
  const router = useRouter();
  const [supabase] = useState(() => createClient());
  const [s, setS] = useState<AgeCheckSettings>(initial);
  const [saved, setSaved] = useState<string>(JSON.stringify(initial));
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<{ text: string; bad?: boolean } | null>(null);
  const [showDenied, setShowDenied] = useState(false);
  const [phone, setPhone] = useState(false);
  const [picker, setPicker] = useState<null | "logo" | "background">(null);
  const [library, setLibrary] = useState<LibraryImage[]>(initialLibrary);
  const [uploading, setUploading] = useState(false);
  const [copied, setCopied] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const dirty = JSON.stringify(s) !== saved;
  const preview = useMemo(() => previewPage(cleanSettings(s), showDenied), [s, showDenied]);
  const set = <K extends keyof AgeCheckSettings>(k: K, v: AgeCheckSettings[K]) => setS((p) => ({ ...p, [k]: v }));
  const setLogo = (i: number, patch: Partial<AgeLogo>) => setS((p) => ({ ...p, logos: p.logos.map((l, j) => (j === i ? { ...l, ...patch } : l)) }));
  const moveLogo = (i: number, dir: -1 | 1) =>
    setS((p) => {
      const j = i + dir;
      if (j < 0 || j >= p.logos.length) return p;
      const logos = p.logos.slice();
      [logos[i], logos[j]] = [logos[j], logos[i]];
      return { ...p, logos };
    });

  async function save() {
    setSaving(true);
    setMsg(null);
    const clean = cleanSettings(s);
    const {
      data: { user },
    } = await supabase.auth.getUser();
    const { error } = await supabase
      .from("site_age_check")
      .update({ settings: clean, updated_at: new Date().toISOString(), updated_by: user?.id ?? null })
      .eq("id", 1);
    setSaving(false);
    if (error) {
      setMsg({ text: `Couldn't save: ${error.message}`, bad: true });
      return;
    }
    setS(clean);
    setSaved(JSON.stringify(clean));
    setMsg({ text: "Saved — both websites will show it within about a minute." });
    router.refresh();
  }

  function choose(img: LibraryImage) {
    if (picker === "background") set("backgroundUrl", img.public_url);
    else if (picker === "logo") {
      if (s.logos.length >= 6) {
        setMsg({ text: "Up to 6 logos.", bad: true });
      } else {
        set("logos", [...s.logos, { url: img.public_url, name: img.name.replace(/\.[^.]+$/, ""), height: 78 }]);
      }
    }
    setPicker(null);
  }

  async function upload(files: FileList | null) {
    if (!files?.length) return;
    setUploading(true);
    try {
      for (const f of Array.from(files)) {
        const { rows } = await uploadCreativeFiles(supabase, f);
        const imgs = rows.filter((r) => r.mime_type?.startsWith("image/") && r.mime_type !== "image/vnd.adobe.photoshop");
        setLibrary((l) => [...imgs.map((r) => ({ id: r.id, name: r.name, public_url: r.public_url, mime_type: r.mime_type, width: r.width, height: r.height })), ...l]);
      }
    } catch (e) {
      setMsg({
        text: `Upload failed: ${e instanceof Error ? e.message : String(e)} (uploading uses the Creative Library — it needs Email Studio access).`,
        bad: true,
      });
    } finally {
      setUploading(false);
    }
  }

  const field = "w-full rounded-lg border border-neutral-700 bg-neutral-900 px-3 py-1.5 text-sm text-neutral-100";
  const label = "block text-xs text-neutral-400";
  const btn = "rounded-full border border-neutral-700 px-3 py-1 text-xs text-neutral-200 hover:border-neutral-500 disabled:opacity-50";
  const colorField = (k: "textColor" | "buttonColor" | "buttonTextColor" | "boxBorderColor" | "backgroundColor", text: string) => (
    <label className={label}>
      {text}
      <span className="mt-1 flex items-center gap-2">
        <input type="color" value={s[k].length === 4 ? `#${s[k][1]}${s[k][1]}${s[k][2]}${s[k][2]}${s[k][3]}${s[k][3]}` : s[k]} onChange={(e) => set(k, e.target.value)} className="h-8 w-10 cursor-pointer rounded border border-neutral-700 bg-transparent" />
        <input value={s[k]} onChange={(e) => set(k, e.target.value)} className={`${field} w-28 font-mono`} />
      </span>
    </label>
  );

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-lg font-semibold text-neutral-100">Age Check</h1>
          <p className="max-w-3xl text-sm text-neutral-400">
            The 21+ birth-date screen visitors must pass on fcbbrands.com and fullcirclebrewing.com. Change how it looks here — when you
            Save, both websites update within about a minute.
          </p>
          <p className="mt-1 text-xs text-neutral-500">
            {updatedAt && hasSaved ? `Last saved ${fmt(updatedAt)}${updatedByName ? ` by ${updatedByName}` : ""}` : "Using the built-in design (not changed yet)."}
            {dirty ? " · unsaved changes" : ""}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button type="button" className={btn} onClick={() => setS(DEFAULT_SETTINGS)}>
            Reset to the FCB design
          </button>
          <button
            type="button"
            disabled={saving || !dirty || !!loadError}
            onClick={() => void save()}
            className="rounded-full bg-brand px-4 py-1.5 text-sm font-semibold text-black disabled:opacity-60"
          >
            {saving ? "Saving…" : dirty ? "Save" : "Saved"}
          </button>
        </div>
      </div>

      {loadError && <p className="rounded-lg border border-red-900 bg-red-950/40 px-3 py-2 text-sm text-red-300">{loadError}</p>}
      {msg && <p className={msg.bad ? "text-sm font-semibold text-red-300" : "text-sm font-semibold text-green-300"}>{msg.text}</p>}

      <div className="grid gap-5 xl:grid-cols-[minmax(340px,440px)_1fr]">
        {/* Settings */}
        <div className="space-y-5">
          <section className="space-y-2 rounded-2xl border border-neutral-800 bg-neutral-900/40 p-4">
            <h2 className="font-semibold text-neutral-100">Logos</h2>
            {s.logos.length === 0 && <p className="text-xs text-neutral-500">No logos.</p>}
            {s.logos.map((l, i) => (
              <div key={`${l.url}-${i}`} className="flex items-center gap-2 rounded-lg border border-neutral-800 bg-neutral-950 p-2">
                <div className="flex h-12 w-16 shrink-0 items-center justify-center rounded bg-neutral-800">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={l.url} alt={l.name} className="max-h-10 max-w-14 object-contain" />
                </div>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-xs text-neutral-200">{l.name}</p>
                  <label className="flex items-center gap-2 text-[11px] text-neutral-500">
                    Size
                    <input type="range" min={16} max={160} value={l.height} onChange={(e) => setLogo(i, { height: Number(e.target.value) })} className="flex-1" />
                    {l.height}px
                  </label>
                </div>
                <div className="flex shrink-0 flex-col gap-0.5 text-[11px]">
                  <button type="button" className="text-neutral-400 hover:text-neutral-100 disabled:opacity-30" disabled={i === 0} onClick={() => moveLogo(i, -1)} aria-label="Move left">
                    ◀
                  </button>
                  <button type="button" className="text-neutral-400 hover:text-neutral-100 disabled:opacity-30" disabled={i === s.logos.length - 1} onClick={() => moveLogo(i, 1)} aria-label="Move right">
                    ▶
                  </button>
                </div>
                <button type="button" className="shrink-0 text-xs text-red-300 underline" onClick={() => set("logos", s.logos.filter((_, j) => j !== i))}>
                  Remove
                </button>
              </div>
            ))}
            <button type="button" className={btn} disabled={s.logos.length >= 6} onClick={() => setPicker("logo")}>
              + Add a logo
            </button>
          </section>

          <section className="space-y-3 rounded-2xl border border-neutral-800 bg-neutral-900/40 p-4">
            <h2 className="font-semibold text-neutral-100">Wording</h2>
            <label className={label}>
              Heading
              <input value={s.heading} onChange={(e) => set("heading", e.target.value)} className={field} />
            </label>
            <label className={label}>
              Message under the heading (optional)
              <textarea value={s.message} onChange={(e) => set("message", e.target.value)} rows={2} className={field} />
            </label>
            <label className={label}>
              Button text
              <input value={s.buttonText} onChange={(e) => set("buttonText", e.target.value)} className={field} />
            </label>
            <label className={label}>
              Small print
              <textarea value={s.termsText} onChange={(e) => set("termsText", e.target.value)} rows={2} className={field} />
            </label>
            <label className={label}>
              Small print link (optional — e.g. the website&apos;s privacy page, starting with https://)
              <input value={s.termsUrl} onChange={(e) => set("termsUrl", e.target.value)} className={field} placeholder="https://" />
            </label>
            <label className={label}>
              Under-21 heading
              <input value={s.deniedHeading} onChange={(e) => set("deniedHeading", e.target.value)} className={field} />
            </label>
            <label className={label}>
              Under-21 message
              <textarea value={s.deniedMessage} onChange={(e) => set("deniedMessage", e.target.value)} rows={2} className={field} />
            </label>
          </section>

          <section className="space-y-3 rounded-2xl border border-neutral-800 bg-neutral-900/40 p-4">
            <h2 className="font-semibold text-neutral-100">Background</h2>
            <div className="flex items-center gap-3">
              <div className="h-14 w-24 shrink-0 overflow-hidden rounded bg-neutral-800">
                {s.backgroundUrl && (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={s.backgroundUrl} alt="Background" className="h-full w-full object-cover" />
                )}
              </div>
              <div className="flex flex-wrap gap-2">
                <button type="button" className={btn} onClick={() => setPicker("background")}>
                  Choose a picture
                </button>
                {s.backgroundUrl && (
                  <button type="button" className={btn} onClick={() => set("backgroundUrl", "")}>
                    No picture (color only)
                  </button>
                )}
              </div>
            </div>
            <label className={label}>
              Darken the picture: {s.darkness}%
              <input type="range" min={0} max={90} value={s.darkness} onChange={(e) => set("darkness", Number(e.target.value))} className="w-full" />
            </label>
            {colorField("backgroundColor", "Background color (shows while the picture loads, or with no picture)")}
          </section>

          <section className="grid grid-cols-2 gap-3 rounded-2xl border border-neutral-800 bg-neutral-900/40 p-4">
            <h2 className="col-span-2 font-semibold text-neutral-100">Colors &amp; font</h2>
            {colorField("textColor", "Text")}
            {colorField("boxBorderColor", "Date box outline")}
            {colorField("buttonColor", "Button")}
            {colorField("buttonTextColor", "Button text")}
            <label className={`${label} col-span-2`}>
              Font
              <select value={s.font} onChange={(e) => set("font", e.target.value)} className={field}>
                {FONTS.map((f) => (
                  <option key={f.value} value={f.value}>
                    {f.label}
                  </option>
                ))}
              </select>
            </label>
          </section>

          <section className="space-y-1 rounded-2xl border border-neutral-800 bg-neutral-900/40 p-4 text-xs text-neutral-400">
            <h2 className="text-sm font-semibold text-neutral-100">Always on (can&apos;t be changed)</h2>
            <p>
              Visitors must enter a birth date and be {MIN_AGE} or older. It covers every page they land on, can&apos;t be clicked past,
              and is remembered for {REMEMBER_DAYS} days on that device. The phone carriers require this for FCB&apos;s texting.
            </p>
          </section>
        </div>

        {/* Preview + install */}
        <div className="space-y-4">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-sm font-semibold text-neutral-100">Preview</span>
            <button type="button" className={btn} onClick={() => setShowDenied((v) => !v)}>
              {showDenied ? "Show the birth-date screen" : "Show the under-21 screen"}
            </button>
            <button type="button" className={btn} onClick={() => setPhone((v) => !v)}>
              {phone ? "Computer size" : "Phone size"}
            </button>
            <span className="text-xs text-neutral-500">Try typing a birth date in the preview — it tells you if it would be let in.</span>
          </div>
          <div className={`overflow-hidden rounded-2xl border border-neutral-800 ${phone ? "mx-auto w-[390px]" : "w-full"}`}>
            <iframe title="Age check preview" srcDoc={preview} sandbox="allow-scripts" className={`block w-full ${phone ? "h-[760px]" : "h-[620px]"}`} />
          </div>

          <section className="space-y-2 rounded-2xl border border-neutral-800 bg-neutral-900/40 p-4 text-sm text-neutral-300">
            <h2 className="font-semibold text-neutral-100">Putting it on a website (one time per site)</h2>
            <ol className="list-decimal space-y-1 pl-5 text-xs">
              <li>
                In Wix, open the site&apos;s <strong>Dashboard</strong> → <strong>Settings</strong> → scroll to{" "}
                <strong>Development &amp; integrations</strong> → <strong>Custom Code</strong>.
              </li>
              <li>
                <strong>+ Add Custom Code</strong>, paste the line below, name it <strong>FCB Age Check</strong>.
              </li>
              <li>
                Add Code to Pages: <strong>All pages</strong> (Load code once). Place Code in: <strong>Body – start</strong>. Apply.
              </li>
              <li>Turn off any other age popup on that site (the old Wix &ldquo;Are you 21?&rdquo; lightbox, or Elfsight) so there aren&apos;t two.</li>
              <li>Test in a private/incognito window by going straight to an inner page.</li>
            </ol>
            <div className="flex items-center gap-2">
              <code className="flex-1 overflow-x-auto whitespace-nowrap rounded-lg bg-neutral-950 px-3 py-2 text-xs text-neutral-200">{SCRIPT_TAG}</code>
              <button
                type="button"
                className={btn}
                onClick={async () => {
                  try {
                    await navigator.clipboard.writeText(SCRIPT_TAG);
                    setCopied(true);
                    setTimeout(() => setCopied(false), 1500);
                  } catch {
                    setMsg({ text: "Couldn't copy — select the line and copy it by hand.", bad: true });
                  }
                }}
              >
                {copied ? "Copied!" : "Copy"}
              </button>
            </div>
          </section>
        </div>
      </div>

      {picker && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4" onClick={() => setPicker(null)}>
          <div className="flex max-h-[85vh] w-full max-w-3xl flex-col overflow-hidden rounded-2xl border border-neutral-800 bg-neutral-950" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between border-b border-neutral-800 px-4 py-3">
              <h2 className="font-semibold text-neutral-100">{picker === "logo" ? "Add a logo" : "Choose a background picture"}</h2>
              <div className="flex items-center gap-2">
                <button type="button" className={btn} disabled={uploading} onClick={() => fileRef.current?.click()}>
                  {uploading ? "Uploading…" : "Upload a new picture"}
                </button>
                <button type="button" onClick={() => setPicker(null)} className="text-sm text-neutral-400 hover:text-neutral-100">
                  Close
                </button>
              </div>
              <input ref={fileRef} type="file" accept="image/*,.psd,.ai" multiple className="hidden" onChange={(e) => { void upload(e.target.files); e.target.value = ""; }} />
            </div>
            <div className="grid grid-cols-3 gap-2 overflow-y-auto p-4 sm:grid-cols-4">
              {library.length === 0 && <p className="col-span-full text-sm text-neutral-500">No pictures in the Creative Library yet — upload one.</p>}
              {library.map((img) => (
                <button key={img.id} type="button" onClick={() => choose(img)} title={img.name} className="group overflow-hidden rounded-lg border border-neutral-800 bg-neutral-800 text-left hover:border-brand">
                  <div className="flex aspect-square items-center justify-center bg-[repeating-conic-gradient(#2a2a2a_0_25%,#202020_0_50%)] bg-[length:16px_16px]">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={img.public_url} alt={img.name} className="max-h-full max-w-full object-contain" loading="lazy" />
                  </div>
                  <p className="truncate px-2 py-1 text-[11px] text-neutral-300">{img.name}</p>
                </button>
              ))}
            </div>
            <p className="border-t border-neutral-800 px-4 py-2 text-xs text-neutral-500">
              Pictures come from the Creative Library. Logos look best as PNGs with see-through backgrounds; backgrounds about 1920 px wide.
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
