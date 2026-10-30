"use client";

import { useCallback, useEffect, useState } from "react";
import type { CreativeAsset } from "@/lib/creativeAssets";

// Ernie inside the email designer (added 2026-10-30, per Chad: "we need to
// do ernie and canva now" … "execute"). A side panel with three jobs:
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

type Usage = { images: number; animations: number; imageCap: number; animationCap: number; costEstimate: number };
type Mode = "create" | "edit" | "animate";
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
}: {
  assets: CreativeAsset[];
  onClose: () => void;
  onNewAsset: (a: CreativeAsset) => void;
  onInsertImage: (a: CreativeAsset) => void;
  onInsertVideo: (video: CreativeAsset, poster: CreativeAsset | null) => void;
}) {
  const [mode, setMode] = useState<Mode>("create");
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

  async function go() {
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
    mode === "animate" ? `about $${(seconds * 0.4).toFixed(2)}` : high ? "about $0.24" : "about $0.13";
  const overCap =
    !!usage && (mode === "animate" ? usage.animations >= usage.animationCap : usage.images >= usage.imageCap);
  const canGo = ready && !busy && !overCap && !!prompt.trim() && (mode === "create" || !!sourceId);

  const tab = (m: Mode, label: string) => (
    <button
      type="button"
      onClick={() => {
        if (m !== mode) setPrompt("");
        setMode(m);
        setErr(null);
        setResult(null);
      }}
      className={`rounded-full px-3 py-1 text-sm ${mode === m ? "bg-brand/20 font-semibold text-neutral-100" : "text-neutral-400 hover:text-neutral-200"}`}
    >
      {label}
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
              This month: {usage.images} of {usage.imageCap} images · {usage.animations} of {usage.animationCap} animations · about $
              {usage.costEstimate.toFixed(2)}
            </p>
          )}
        </div>
        <button type="button" onClick={onClose} className="text-sm text-neutral-400 hover:text-neutral-100">
          Close
        </button>
      </div>

      <div className="flex gap-1 border-b border-neutral-800 px-3 py-2">
        {tab("create", "Create")}
        {tab("edit", "Edit")}
        {tab("animate", "Animate")}
      </div>

      <div className="flex-1 space-y-4 overflow-y-auto px-4 py-4 text-sm text-neutral-300">
        {!ready && (
          <p className="rounded-lg border border-amber-800 bg-amber-950/40 px-3 py-2 text-amber-200">
            Ernie&apos;s image tools aren&apos;t set up on the server.
          </p>
        )}

        {mode !== "create" && (
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
            {mode === "create" ? "Describe the image" : mode === "edit" ? "What should change?" : "Describe the motion"}
          </p>
          <textarea
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            rows={4}
            className={field}
            placeholder={
              mode === "create"
                ? "e.g. A frosty can of pumpkin ale on a rustic wooden bar, autumn leaves, warm evening light, no text"
                : mode === "edit"
                  ? "e.g. Change the background to a sunset over a vineyard"
                  : "e.g. Slow camera push in, condensation drips down the can, leaves drift past"
            }
          />
          <p className="text-xs text-neutral-500">Be specific: subject, style, colors, mood. Ernie can&apos;t do real people or other brands&apos; logos.</p>
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
            {busy ? "Working…" : mode === "create" ? "Create image" : mode === "edit" ? "Make the change" : "Start animation"}
          </button>
          <span className="text-xs text-neutral-500">{cost} per {mode === "animate" ? "animation" : "image"}</span>
        </div>
        {busy && mode !== "animate" && <p className="text-xs text-neutral-500">Ernie is drawing — usually 15–40 seconds.</p>}
        {overCap && <p className="text-xs text-amber-300">This month&apos;s limit is used up. It resets on the 1st.</p>}
        {err && <p className="text-sm text-red-300">{err}</p>}

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
