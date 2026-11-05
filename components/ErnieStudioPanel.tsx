"use client";

import { useCallback, useEffect, useState } from "react";
import type { CreativeAsset } from "@/lib/creativeAssets";
import NewBadge from "@/components/NewBadge";
import { useNewFeature } from "@/lib/newFeatures";

// Ernie inside the email designer (added 2026-10-30, per Chad: "we need to
// do ernie and canva now" … "execute"). A side panel with four jobs:
//   Edit email — (added 2026-11-05, Eddie's ask: "an edit button where it
//             goes in and writes or fixes stuff when asked") Ernie changes the
//             email ITSELF: the whole email, just the selected part, or a new
//             section — and can rebuild a picture of a design as a real,
//             editable email. Undo puts the email back the way it was.
//   Create  — describe an image, Ernie makes it.
//   Edit    — pick a Creative Library image and say what to change (the
//             original stays; the result is a new image).
//   Animate — pick an image and describe the motion; a short video renders
//             in 1–3 minutes. Most email apps can't play video, so it goes
//             into the email as the still image linked to the video, with a
//             "Watch the video" button.
// Everything Ernie makes is saved to the Creative Library. Each use costs
// money, so there's a monthly cap (100 images + 10 animations) and a usage
// line at the top. Costs shown are estimates.

type Usage = {
  images: number;
  animations: number;
  emailEdits?: number;
  imageCap: number;
  animationCap: number;
  emailEditCap?: number;
  costEstimate: number;
};
type Mode = "email" | "create" | "edit" | "animate";
export type EmailScope = "email" | "selection" | "add";
export type EmailContent = { html: string; css?: string | null; fullEmailHtml?: string | null };
type Pending = { id: string; prompt: string; source_asset_id: string | null; created_at: string };

const EDITABLE = ["image/png", "image/jpeg", "image/webp"];
const ASPECT_OPTIONS: { v: string; label: string }[] = [
  { v: "16:9", label: "Wide banner (16:9)" },
  { v: "1:1", label: "Square (1:1)" },
  { v: "4:3", label: "Landscape (4:3)" },
  { v: "4:5", label: "Portrait (4:5)" },
  { v: "9:16", label: "Tall / story (9:16)" },
];

export default function ErnieStudioPanel({
  assets,
  onClose,
  onNewAsset,
  onInsertImage,
  onInsertVideo,
  selectedLabel,
  getEmailContent,
  onApplyEmail,
  onUndoEmail,
  onUpload,
}: {
  assets: CreativeAsset[];
  onClose: () => void;
  onNewAsset: (a: CreativeAsset) => void;
  onInsertImage: (a: CreativeAsset) => void;
  onInsertVideo: (video: CreativeAsset, poster: CreativeAsset | null) => void;
  /** What's selected in the email right now ("Text", "Image"…), or null. */
  selectedLabel: string | null;
  getEmailContent: (scope: EmailScope) => EmailContent | null;
  /** Puts Ernie's HTML into the email; false if it couldn't. */
  onApplyEmail: (html: string, scope: EmailScope) => boolean;
  onUndoEmail: () => void;
  onUpload: (file: File) => Promise<CreativeAsset[]>;
}) {
  const [mode, setMode] = useState<Mode>("email");
  const editEmailNew = useNewFeature("feature:email-studio-ernie-edit-email");
  // Edit email
  const [scope, setScope] = useState<EmailScope>("email");
  const [picId, setPicId] = useState<string | null>(null);
  const [showPics, setShowPics] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [emailDone, setEmailDone] = useState<{ note: string; swaps: number; undone: boolean } | null>(null);
  const [usage, setUsage] = useState<Usage | null>(null);
  const [ready, setReady] = useState(true);
  const [prompt, setPrompt] = useState("");
  const [aspect, setAspect] = useState("16:9");
  const [high, setHigh] = useState(false);
  const [sourceId, setSourceId] = useState<string | null>(null);
  const [seconds, setSeconds] = useState<4 | 6 | 8>(8);
  const [tall, setTall] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [result, setResult] = useState<CreativeAsset | null>(null);
  const [rendering, setRendering] = useState<Pending[]>([]);
  const [videos, setVideos] = useState<{ video: CreativeAsset; posterId: string | null }[]>([]);

  const images = assets.filter((a) => a.mime_type && EDITABLE.includes(a.mime_type));

  useEffect(() => {
    fetch("/api/email-studio/ernie")
      .then((r) => r.json())
      .then((j) => {
        if (j.usage) setUsage(j.usage);
        if (j.pending) setRendering(j.pending);
        if (j.ready === false) setReady(false);
      })
      .catch(() => {});
  }, []);

  // Check on animations that are still rendering every 8 seconds.
  const check = useCallback(async () => {
    for (const job of rendering) {
      try {
        const r = await fetch("/api/email-studio/ernie", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "check", jobId: job.id }),
        });
        const j = await r.json();
        if (j.status === "done") {
          const video = j.asset as CreativeAsset;
          onNewAsset(video);
          setVideos((v) => (v.some((x) => x.video.id === video.id) ? v : [{ video, posterId: j.posterAssetId ?? null }, ...v]));
          setRendering((list) => list.filter((x) => x.id !== job.id));
        } else if (j.status === "error") {
          setErr(`Animation failed: ${j.error}`);
          setRendering((list) => list.filter((x) => x.id !== job.id));
        }
      } catch {
        // try again next round
      }
    }
  }, [rendering, onNewAsset]);
  useEffect(() => {
    if (rendering.length === 0) return;
    const t = setInterval(() => void check(), 8000);
    return () => clearInterval(t);
  }, [rendering, check]);

  async function goEmail() {
    const content = getEmailContent(scope);
    if (!content) {
      setErr(scope === "selection" ? "Click the part of the email you want changed first." : "The designer isn't ready yet.");
      return;
    }
    setBusy(true);
    setErr(null);
    setEmailDone(null);
    try {
      const r = await fetch("/api/email-studio/ernie", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "email", prompt, scope, sourceAssetId: picId, ...content }),
      });
      const j = await r.json().catch(() => ({ error: "Ernie took too long or something went wrong — try again." }));
      if (!r.ok) throw new Error(j.error ?? "Something went wrong.");
      if (j.usage) setUsage(j.usage);
      if (!onApplyEmail(j.html as string, scope)) throw new Error("Couldn't put Ernie's change into the email — try again.");
      setEmailDone({ note: (j.note as string) || "Done.", swaps: Number(j.swaps) || 0, undone: false });
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  async function uploadPic(files: FileList | null) {
    const f = files?.[0];
    if (!f) return;
    setUploading(true);
    setErr(null);
    try {
      const rows = await onUpload(f);
      const pic = rows.find((a) => a.mime_type && EDITABLE.includes(a.mime_type));
      if (pic) setPicId(pic.id);
      else setErr("Ernie can only read PNG, JPG or WebP pictures (Photoshop/Illustrator files get a PNG copy automatically).");
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setUploading(false);
    }
  }

  async function go() {
    if (mode === "email") return goEmail();
    setBusy(true);
    setErr(null);
    setResult(null);
    try {
      const r = await fetch("/api/email-studio/ernie", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(
          mode === "animate"
            ? { action: "animate", prompt, sourceAssetId: sourceId, seconds, tall }
            : { action: mode, prompt, sourceAssetId: mode === "edit" ? sourceId : null, aspect, high },
        ),
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error ?? "Something went wrong.");
      if (j.usage) setUsage(j.usage);
      if (mode === "animate") {
        setRendering((list) => [{ id: j.jobId, prompt, source_asset_id: sourceId, created_at: new Date().toISOString() }, ...list]);
        setPrompt("");
      } else {
        const a = j.asset as CreativeAsset;
        onNewAsset(a);
        setResult(a);
      }
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  const cost =
    mode === "email"
      ? "about 2–5¢"
      : mode === "animate"
        ? `about $${(seconds * 0.4).toFixed(2)}`
        : high
          ? "about $0.24"
          : "about $0.13";
  const overCap =
    !!usage &&
    (mode === "email"
      ? (usage.emailEdits ?? 0) >= (usage.emailEditCap ?? Infinity)
      : mode === "animate"
        ? usage.animations >= usage.animationCap
        : usage.images >= usage.imageCap);
  const canGo =
    ready &&
    !busy &&
    !overCap &&
    (mode === "email"
      ? (!!prompt.trim() || !!picId) && (scope !== "selection" || !!selectedLabel)
      : !!prompt.trim() && (mode === "create" || !!sourceId));
  const pic = picId ? (images.find((a) => a.id === picId) ?? null) : null;

  const tab = (m: Mode, label: string) => (
    <button
      type="button"
      onClick={() => {
        if (m !== mode) setPrompt("");
        setMode(m);
        setErr(null);
        setResult(null);
        if (m === "email") editEmailNew.dismiss();
      }}
      className={`rounded-full px-3 py-1 text-sm ${mode === m ? "bg-brand/20 font-semibold text-neutral-100" : "text-neutral-400 hover:text-neutral-200"}`}
    >
      {label}
      {m === "email" && editEmailNew.isNew && <NewBadge inline />}
    </button>
  );
  const field = "w-full rounded-lg border border-neutral-700 bg-neutral-900 px-3 py-1.5 text-sm text-neutral-100";
  const btn = "rounded-full border border-neutral-700 px-3 py-1 text-xs text-neutral-200 hover:border-neutral-500";

  return (
    <aside className="fixed inset-y-0 right-0 z-40 flex w-full max-w-[440px] flex-col border-l border-neutral-800 bg-neutral-950 shadow-2xl">
      <div className="flex items-center justify-between border-b border-neutral-800 px-4 py-3">
        <div>
          <h2 className="text-base font-semibold text-neutral-100">Ernie</h2>
          {usage && (
            <p className="text-xs text-neutral-500">
              This month: {usage.emailEdits ?? 0} of {usage.emailEditCap ?? 300} email edits · {usage.images} of {usage.imageCap} images ·{" "}
              {usage.animations} of {usage.animationCap} animations · about ${usage.costEstimate.toFixed(2)}
            </p>
          )}
        </div>
        <button type="button" onClick={onClose} className="text-sm text-neutral-400 hover:text-neutral-100">
          Close
        </button>
      </div>

      <div className="flex gap-1 border-b border-neutral-800 px-3 py-2">
        {tab("email", "Edit email")}
        {tab("create", "Create")}
        {tab("edit", "Edit picture")}
        {tab("animate", "Animate")}
      </div>

      <div className="flex-1 space-y-4 overflow-y-auto px-4 py-4 text-sm text-neutral-300">
        {!ready && (
          <p className="rounded-lg border border-amber-800 bg-amber-950/40 px-3 py-2 text-amber-200">
            Ernie&apos;s image tools aren&apos;t set up on the server.
          </p>
        )}

        {mode === "email" && (
          <>
            <section className="space-y-1.5">
              <p className="font-semibold text-neutral-100">What should Ernie work on?</p>
              {(
                [
                  ["email", "The whole email"],
                  ["selection", selectedLabel ? `Just the selected part (${selectedLabel})` : "Just the selected part"],
                  ["add", selectedLabel ? "Add a new section below the selected part" : "Add a new section at the end"],
                ] as [EmailScope, string][]
              ).map(([v, label]) => (
                <label key={v} className="flex items-center gap-2">
                  <input type="radio" name="ernie-scope" checked={scope === v} onChange={() => setScope(v)} />
                  <span>{label}</span>
                </label>
              ))}
              {scope === "selection" && !selectedLabel && (
                <p className="text-xs text-amber-300">Click the part of the email you want changed (a headline, a section, a button…).</p>
              )}
            </section>

            <section className="space-y-2">
              <p className="font-semibold text-neutral-100">
                Copy a picture <span className="font-normal text-neutral-500">(optional)</span>
              </p>
              <p className="text-xs text-neutral-500">
                Have a flyer or mockup? Pick or upload it and Ernie rebuilds it as a real email — text you can edit, real buttons and colors.
              </p>
              {pic ? (
                <div className="flex items-center gap-3">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={pic.public_url} alt={pic.name} className="h-16 w-16 rounded-md object-cover" />
                  <span className="flex-1 truncate text-xs text-neutral-400">{pic.name}</span>
                  <button type="button" className={btn} onClick={() => setPicId(null)}>
                    Remove
                  </button>
                </div>
              ) : (
                <div className="flex flex-wrap gap-2">
                  <button type="button" className={btn} onClick={() => setShowPics((v) => !v)}>
                    {showPics ? "Hide the Creative Library" : "Pick from the Creative Library"}
                  </button>
                  <label className={`${btn} cursor-pointer`}>
                    {uploading ? "Uploading…" : "Upload a picture"}
                    <input
                      type="file"
                      accept="image/png,image/jpeg,image/webp,.psd,.ai"
                      className="hidden"
                      disabled={uploading}
                      onChange={(e) => {
                        void uploadPic(e.target.files);
                        e.target.value = "";
                      }}
                    />
                  </label>
                </div>
              )}
              {!pic && showPics && (
                <div className="grid max-h-48 grid-cols-4 gap-1.5 overflow-y-auto">
                  {images.map((a) => (
                    <div
                      key={a.id}
                      role="button"
                      tabIndex={0}
                      onClick={() => {
                        setPicId(a.id);
                        setShowPics(false);
                      }}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" || e.key === " ") {
                          setPicId(a.id);
                          setShowPics(false);
                        }
                      }}
                      title={a.name}
                      className="aspect-square cursor-pointer overflow-hidden rounded-md border-2 border-transparent opacity-80 hover:opacity-100"
                    >
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={a.public_url} alt={a.name} className="h-full w-full object-cover" />
                    </div>
                  ))}
                </div>
              )}
            </section>
          </>
        )}

        {(mode === "edit" || mode === "animate") && (
          <section className="space-y-2">
            <p className="font-semibold text-neutral-100">{mode === "edit" ? "Pick the image to change" : "Pick the image to animate"}</p>
            {images.length === 0 ? (
              <p className="text-xs text-neutral-500">No PNG/JPG images in the Creative Library yet.</p>
            ) : (
              <div className="grid max-h-56 grid-cols-4 gap-1.5 overflow-y-auto">
                {images.map((a) => (
                  <div
                    key={a.id}
                    role="button"
                    tabIndex={0}
                    onClick={() => setSourceId(a.id)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" || e.key === " ") setSourceId(a.id);
                    }}
                    title={a.name}
                    aria-pressed={sourceId === a.id}
                    className={`aspect-square cursor-pointer overflow-hidden rounded-md border-2 ${sourceId === a.id ? "border-brand" : "border-transparent opacity-80 hover:opacity-100"}`}
                  >
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={a.public_url} alt={a.name} className="h-full w-full object-cover" />
                  </div>
                ))}
              </div>
            )}
          </section>
        )}

        <section className="space-y-1">
          <p className="font-semibold text-neutral-100">
            {mode === "email"
              ? pic
                ? "Anything else? (optional)"
                : "What should Ernie do?"
              : mode === "create"
                ? "Describe the image"
                : mode === "edit"
                  ? "What should change?"
                  : "Describe the motion"}
          </p>
          <textarea
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            rows={4}
            className={field}
            placeholder={
              mode === "email"
                ? scope === "add"
                  ? "e.g. Add a section with three upcoming events, each with a date, a short line and a button"
                  : scope === "selection"
                    ? "e.g. Make this headline punchier and bigger"
                    : "e.g. Fix any typos, make the button say Find Our Beer, and change the background to dark green"
                : mode === "create"
                ? "e.g. A frosty can of pumpkin ale on a rustic wooden bar, autumn leaves, warm evening light, no text"
                : mode === "edit"
                  ? "e.g. Change the background to a sunset over a vineyard"
                  : "e.g. Slow camera push in, condensation drips down the can, leaves drift past"
            }
          />
          <p className="text-xs text-neutral-500">
            {mode === "email"
              ? "Say it like you'd tell a person. Ernie changes the words and layout — it doesn't make pictures (use Create for that)."
              : "Be specific: subject, style, colors, mood. Ernie can't do real people or other brands' logos."}
          </p>
        </section>

        {mode === "create" && (
          <section className="grid grid-cols-2 gap-2">
            <label className="text-xs text-neutral-400">
              Shape
              <select value={aspect} onChange={(e) => setAspect(e.target.value)} className={field}>
                {ASPECT_OPTIONS.map((o) => (
                  <option key={o.v} value={o.v}>
                    {o.label}
                  </option>
                ))}
              </select>
            </label>
            <label className="text-xs text-neutral-400">
              Quality
              <select value={high ? "high" : "std"} onChange={(e) => setHigh(e.target.value === "high")} className={field}>
                <option value="std">Standard (best for email)</option>
                <option value="high">Highest (print size)</option>
              </select>
            </label>
          </section>
        )}
        {mode === "edit" && (
          <label className="flex items-center gap-2 text-xs text-neutral-400">
            <input type="checkbox" checked={high} onChange={(e) => setHigh(e.target.checked)} /> Highest quality (print size)
          </label>
        )}
        {mode === "animate" && (
          <section className="grid grid-cols-2 gap-2">
            <label className="text-xs text-neutral-400">
              Length
              <select value={seconds} onChange={(e) => setSeconds(Number(e.target.value) as 4 | 6 | 8)} className={field}>
                <option value={4}>4 seconds</option>
                <option value={6}>6 seconds</option>
                <option value={8}>8 seconds</option>
              </select>
            </label>
            <label className="text-xs text-neutral-400">
              Shape
              <select value={tall ? "tall" : "wide"} onChange={(e) => setTall(e.target.value === "tall")} className={field}>
                <option value="wide">Wide (16:9)</option>
                <option value="tall">Tall (9:16)</option>
              </select>
            </label>
            <p className="col-span-2 text-xs text-neutral-500">
              Takes 1–3 minutes. Most email apps can&apos;t play video, so it goes in the email as the picture with a &ldquo;Watch the
              video&rdquo; button.
            </p>
          </section>
        )}

        <div className="flex items-center gap-3">
          <button
            type="button"
            disabled={!canGo}
            onClick={() => void go()}
            className="rounded-full bg-brand px-4 py-1.5 text-sm font-semibold text-black disabled:opacity-50"
          >
            {busy ? "Working…" : mode === "email" ? "Ask Ernie" : mode === "create" ? "Create image" : mode === "edit" ? "Make the change" : "Start animation"}
          </button>
          <span className="text-xs text-neutral-500">
            {cost} per {mode === "email" ? "edit" : mode === "animate" ? "animation" : "image"}
          </span>
        </div>
        {busy && mode === "email" && (
          <p className="text-xs text-neutral-500">Ernie is working on the email — usually 20 seconds to 2 minutes. Keep this panel open.</p>
        )}
        {busy && mode !== "animate" && mode !== "email" && <p className="text-xs text-neutral-500">Ernie is drawing — usually 15–40 seconds.</p>}
        {overCap && <p className="text-xs text-amber-300">This month&apos;s limit is used up. It resets on the 1st.</p>}
        {err && <p className="text-sm text-red-300">{err}</p>}

        {mode === "email" && emailDone && (
          <section className="space-y-2 rounded-xl border border-neutral-800 p-3">
            {emailDone.undone ? (
              <p className="text-neutral-300">Undone — the email is back the way it was.</p>
            ) : (
              <>
                <p className="text-neutral-100">{emailDone.note}</p>
                <p className="text-xs text-neutral-500">It&apos;s in the email now — look it over, then Save. Not what you wanted? Undo it.</p>
                {emailDone.swaps > 0 && (
                  <p className="rounded-lg border border-amber-800 bg-amber-950/40 px-3 py-2 text-xs text-amber-200">
                    {emailDone.swaps === 1 ? "There's 1 gray" : `There are ${emailDone.swaps} gray`} &ldquo;Swap this picture&rdquo;{" "}
                    {emailDone.swaps === 1 ? "box" : "boxes"} where a photo goes. Double-click each one and pick a picture (or make one on the
                    Create tab). The email can&apos;t be sent until they&apos;re swapped.
                  </p>
                )}
                <button
                  type="button"
                  className={btn}
                  onClick={() => {
                    onUndoEmail();
                    setEmailDone({ ...emailDone, undone: true });
                  }}
                >
                  Undo Ernie&apos;s change
                </button>
              </>
            )}
          </section>
        )}

        {result && (
          <section className="space-y-2 rounded-xl border border-neutral-800 p-3">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={result.public_url} alt={result.name} className="w-full rounded-md" />
            <p className="text-xs text-neutral-500">Saved to the Creative Library.</p>
            <div className="flex flex-wrap gap-2">
              <button type="button" className={btn} onClick={() => onInsertImage(result)}>
                Put it in the email
              </button>
              <button
                type="button"
                className={btn}
                onClick={() => {
                  setSourceId(result.id);
                  setMode("edit");
                  setPrompt("");
                  setResult(null);
                }}
              >
                Make changes to it
              </button>
              <button
                type="button"
                className={btn}
                onClick={() => {
                  setSourceId(result.id);
                  setMode("animate");
                  setPrompt("");
                  setResult(null);
                }}
              >
                Animate it
              </button>
            </div>
          </section>
        )}

        {rendering.length > 0 && (
          <section className="space-y-1 rounded-xl border border-neutral-800 p-3">
            <p className="font-semibold text-neutral-100">Rendering</p>
            {rendering.map((r) => (
              <p key={r.id} className="text-xs text-neutral-400">
                ⏳ {r.prompt.slice(0, 80)}
                {r.prompt.length > 80 ? "…" : ""} — usually 1–3 minutes. You can keep working; it&apos;ll show up here.
              </p>
            ))}
          </section>
        )}

        {videos.map(({ video, posterId }) => {
          const poster = assets.find((a) => a.id === posterId) ?? null;
          return (
            <section key={video.id} className="space-y-2 rounded-xl border border-neutral-800 p-3">
              <video src={video.public_url} controls muted className="w-full rounded-md" poster={poster?.public_url} />
              <p className="text-xs text-neutral-500">Saved to the Creative Library.</p>
              <button type="button" className={btn} onClick={() => onInsertVideo(video, poster)}>
                Put it in the email
              </button>
            </section>
          );
        })}
      </div>
    </aside>
  );
}
