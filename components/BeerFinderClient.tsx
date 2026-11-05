"use client";

// Beer Finder (added 2026-11-04, per Chad — Main, below Tasks). Step 1 of the
// "find our beer" map (plan: claude/beer-finder-plan.md in the project).
//
//   Map      every place our beer shows up on the finder — real street map
//            (Leaflet + OpenStreetMap, free), the same filters customers will
//            get (beer with its real can label, cans / draft, stores / bars &
//            restaurants, search a city or zip, distance, use my location),
//            plus our own detail on each place (distributor, rep, last buy,
//            CEs last 90 days).
//   Control  what the finder shows: how many days back a buy counts, each
//            beer on / off + the name and label customers see, distributors
//            on / off, each place (fix its name, hide, always show, fix its
//            pin), and the places that couldn't be put on the map.
//
// It updates itself: the weekday LilyPad sync refreshes the sales and then
// places any new accounts on the map (lib/beerFinderGeocode.ts). No taproom —
// FCB doesn't have one.
//
// Step 2 (added 2026-11-04): the PUBLIC website finder is
// www.fcb-data.com/beer-finder (components/BeerFinderPublic.tsx); this page
// moved to /beer-finder/manage. The website can't read the private POS →
// Labels files, so this page draws each beer's can and saves the finished
// picture for the website on its own (/api/beer-finder/can-image) whenever a
// label or its front changes.

import "leaflet/dist/leaflet.css";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Map as LMap, LayerGroup } from "leaflet";
import { createClient } from "@/lib/supabase/client";
import { REP_BY_DISTRIBUTOR } from "@/lib/salesAccounts";
import { canImage, defaultFront } from "@/lib/beerCan3d";
import {
  type BfBeer,
  type BfData,
  type BfLabel,
  type BfLocation,
  type Ctx,
  type Status,
  beerName,
  canKey,
  daysBetween,
  directionsUrl,
  isDraft,
  isLive,
  liveItems,
  makeCtx,
  milesBetween,
  packageLabel,
  shownName,
  statusOf,
  tidyName,
} from "@/lib/beerFinder";

type Supa = ReturnType<typeof createClient>;

const CARD = "rounded-xl border border-neutral-800 bg-neutral-950 p-4";
const MUTED = "text-neutral-400";
const INPUT =
  "min-h-9 rounded-lg border border-neutral-700 bg-neutral-950 px-3 py-1.5 text-sm text-neutral-100 placeholder:text-neutral-500 focus:border-[#6abc46] focus:outline-none";
const SMALL_BTN =
  "inline-flex min-h-8 items-center whitespace-nowrap rounded-full border border-neutral-700 px-3 text-xs font-semibold text-neutral-300 hover:border-[#6abc46]/40 hover:text-neutral-100 disabled:opacity-50";
const GREEN_BTN =
  "inline-flex min-h-9 items-center whitespace-nowrap rounded-full border border-[#6abc46] bg-[#6abc46] px-4 text-sm font-bold text-neutral-950 hover:brightness-110 disabled:opacity-50";
const STORE = "#5aa9f0";
const BAR = "#f0a63c";
// What goes in an Embed HTML box on fullcirclebrewing.com / fcbbrands.com (Wix).
const EMBED_CODE =
  '<iframe src="https://www.fcb-data.com/beer-finder" style="width:100%;height:1000px;border:0" title="Find Full Circle beer near you" loading="lazy" allow="geolocation"></iframe>';
const fmtDay = (d: string | null) => (d ? new Date(d + "T12:00:00").toLocaleDateString("en-US", { month: "numeric", day: "numeric", year: "2-digit" }) : "—");

function Seg<T extends string>({ value, options, onChange }: { value: T; options: [T, string][]; onChange: (v: T) => void }) {
  return (
    <div className="inline-flex rounded-full border border-neutral-800 bg-neutral-950 p-1">
      {options.map(([k, label]) => (
        <button
          key={k}
          type="button"
          onClick={() => onChange(k)}
          className={`rounded-full px-3 py-1 text-[13px] font-semibold ${value === k ? "bg-neutral-800 text-neutral-50" : "text-neutral-400 hover:text-neutral-200"}`}
        >
          {label}
        </button>
      ))}
    </div>
  );
}

function Switch({ on, onClick, label }: { on: boolean; onClick: () => void; label: string }) {
  return (
    <button type="button" role="switch" aria-checked={on} aria-label={label} onClick={onClick} className={`relative h-[22px] w-[40px] shrink-0 rounded-full transition ${on ? "bg-[#6abc46]" : "bg-neutral-700"}`}>
      <span className={`absolute top-[3px] h-4 w-4 rounded-full transition-all ${on ? "left-[21px] bg-neutral-950" : "left-[3px] bg-neutral-300"}`} />
    </button>
  );
}

// A real 3D can with the beer's label printed on it (lib/beerCan3d.ts) — the
// same tall can for every beer, front of the label facing you. Kegs for beers
// with no label in POS → Labels yet.
function Can({ url, path, front, title, w = 40, h = 60 }: { url: string | null | undefined; path?: string | null; front?: number | null; title: string; w?: number; h?: number }) {
  const [img, setImg] = useState<{ key: string; src: string } | null>(null);
  const f = front ?? defaultFront(path);
  const key = `${path ?? url ?? ""}@${f}`;
  useEffect(() => {
    if (!url) return;
    let live = true;
    canImage(path ?? url, url, f)
      .then((src) => live && setImg({ key, src }))
      .catch(() => live && setImg(null));
    return () => {
      live = false;
    };
  }, [url, path, f, key]);
  if (!url)
    return (
      <span title={`${title} (no label in POS → Labels yet)`} className="relative block shrink-0" style={{ width: w, height: h }}>
        <span className="absolute inset-x-[8%] inset-y-[6%] rounded-md" style={{ background: "linear-gradient(90deg,#5d635f,#e6eae7 35%,#9aa09c 70%,#4f5551)" }}>
          <span className="absolute inset-x-0 top-[24%] h-[3px] bg-neutral-600/80" />
          <span className="absolute inset-x-0 top-[70%] h-[3px] bg-neutral-600/80" />
        </span>
      </span>
    );
  return (
    <span title={title} className="relative block shrink-0" style={{ width: w, height: h }}>
      {img?.key === key ? (
        // eslint-disable-next-line @next/next/no-img-element -- a generated picture (data URL), not a page image
        <img src={img.src} alt={title} className="h-full w-full object-contain" draggable={false} />
      ) : (
        <span className="absolute inset-x-[22%] inset-y-[4%] animate-pulse rounded-md bg-neutral-700/60" />
      )}
    </span>
  );
}

export default function BeerFinderClient() {
  const supabase = useMemo(() => createClient(), []);
  const [data, setData] = useState<BfData | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [labels, setLabels] = useState<BfLabel[]>([]);
  const [tab, setTab] = useState<"map" | "control">("map");

  const load = useCallback(async () => {
    const { data: d, error } = await supabase.rpc("beer_finder_data");
    if (error) return setErr(error.message);
    setErr(null);
    setData(d as BfData);
  }, [supabase]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- first load from the database
    load();
    fetch("/api/beer-finder/labels")
      .then((r) => r.json())
      .then((j) => setLabels((j.labels as BfLabel[]) ?? []))
      .catch(() => setLabels([]));
  }, [load]);

  const labelUrl = useMemo(() => new Map(labels.map((l) => [l.path, l.url])), [labels]);

  // Keep the website's can pictures up to date: any beer whose label or front
  // changed since its picture was saved gets redrawn and saved (one at a time,
  // in the background). A beer whose label was removed gets its picture cleared.
  const syncing = useRef(false);
  useEffect(() => {
    if (!data || !labels.length || syncing.current) return;
    const todo = data.beers.filter((b) =>
      b.label_path ? !!labelUrl.get(b.label_path) && b.can_key !== canKey(b.label_path, b.label_front ?? defaultFront(b.label_path)) : !!b.can_key,
    );
    if (!todo.length) return;
    syncing.current = true;
    (async () => {
      let changed = false;
      for (const b of todo) {
        try {
          let body: { product: string; key: string | null; png?: string };
          if (!b.label_path) body = { product: b.product, key: null };
          else {
            const front = b.label_front ?? defaultFront(b.label_path);
            const png = await canImage(b.label_path, labelUrl.get(b.label_path)!, front);
            body = { product: b.product, key: canKey(b.label_path, front), png };
          }
          const r = await fetch("/api/beer-finder/can-image", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
          if (r.ok) changed = true;
        } catch {
          // try again next time the page opens
        }
      }
      syncing.current = false;
      if (changed) await load();
    })();
  }, [data, labels, labelUrl, load]);

  return (
    <div className="flex flex-col gap-4 p-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-neutral-100">Beer Finder</h1>
          <p className="text-sm text-neutral-500">
            Where customers can find our beer — updates itself every weekday after the LilyPad sync
            {data ? ` · sales data through ${fmtDay(data.as_of)}` : ""}
          </p>
        </div>
        <Seg value={tab} onChange={setTab} options={[["map", "Map"], ["control", "Control"]]} />
      </div>
      {err && <div className="rounded-md border border-red-500/40 bg-red-500/10 px-3 py-2 text-sm text-red-300">{err}</div>}
      {!data && !err && <div className={`${CARD} text-sm ${MUTED}`}>Loading…</div>}
      {data && tab === "map" && <MapTab data={data} labelUrl={labelUrl} />}
      {data && tab === "control" && <ControlTab supabase={supabase} data={data} labels={labels} labelUrl={labelUrl} onChanged={load} />}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Map tab
// ---------------------------------------------------------------------------
type Row = { l: BfLocation; items: ReturnType<typeof liveItems>; d: number | null };

function MapTab({ data, labelUrl }: { data: BfData; labelUrl: Map<string, string | null> }) {
  const ctx = useMemo(() => makeCtx(data), [data]);
  const [beer, setBeer] = useState<string>("all");
  const [fmt, setFmt] = useState<"all" | "can" | "draft">("all");
  const [typ, setTyp] = useState<"all" | "store" | "bar">("all");
  const [q, setQ] = useState("");
  const [center, setCenter] = useState<{ at: [number, number]; name: string } | null>(null);
  const [radius, setRadius] = useState(25);
  const [msg, setMsg] = useState<string | null>(null);
  const [sel, setSel] = useState<string | null>(null);

  const beers = useMemo(() => {
    // Shown beers that are on at least one live place, biggest first.
    const count = new Map<string, number>();
    for (const l of data.locations) {
      if (!isLive(statusOf(ctx, l))) continue;
      for (const p of new Set(liveItems(ctx, l).map((i) => i.product))) count.set(p, (count.get(p) ?? 0) + 1);
    }
    return [...count.entries()].sort((a, b) => b[1] - a[1]).map(([p]) => ({ product: p, b: ctx.beers.get(p) }));
  }, [data, ctx]);

  const rows: Row[] = useMemo(() => {
    const out: Row[] = [];
    for (const l of data.locations) {
      if (!isLive(statusOf(ctx, l))) continue;
      let items = liveItems(ctx, l);
      if (beer !== "all") items = items.filter((i) => i.product === beer);
      if (fmt === "can") items = items.filter((i) => !isDraft(i.size));
      if (fmt === "draft") items = items.filter((i) => isDraft(i.size));
      if (!items.length) continue;
      const bar = l.premise === "On";
      if (typ === "store" && bar) continue;
      if (typ === "bar" && !bar) continue;
      let d: number | null = null;
      if (center) {
        if (l.lat == null || l.lng == null) continue;
        d = milesBetween(center.at, [l.lat, l.lng]);
        if (d > radius) continue;
      }
      out.push({ l, items, d });
    }
    return out.sort((a, b) => (a.d ?? 0) - (b.d ?? 0) || shownName(a.l).localeCompare(shownName(b.l)));
  }, [data, ctx, beer, fmt, typ, center, radius]);

  const onMap = rows.filter((r) => r.l.lat != null && r.l.lng != null).length;

  function search() {
    const t = q.trim().toLowerCase();
    setSel(null);
    if (!t) {
      setCenter(null);
      setMsg(null);
      return;
    }
    const pinned = data.locations.filter((l) => l.lat != null && l.lng != null);
    const hits = /^\d{5}$/.test(t) ? pinned.filter((l) => (l.zip ?? "").startsWith(t)) : pinned.filter((l) => (l.city ?? "").toLowerCase() === t);
    if (!hits.length) {
      setMsg(`No places with a pin in "${q.trim()}" — try a nearby city or zip.`);
      return;
    }
    const at: [number, number] = [hits.reduce((s, l) => s + (l.lat as number), 0) / hits.length, hits.reduce((s, l) => s + (l.lng as number), 0) / hits.length];
    setCenter({ at, name: /^\d/.test(t) ? t : tidyName(t) });
    setMsg(null);
  }
  function useMyLocation() {
    if (!navigator.geolocation) return setMsg("This browser can't share your location.");
    navigator.geolocation.getCurrentPosition(
      (p) => {
        setCenter({ at: [p.coords.latitude, p.coords.longitude], name: "your location" });
        setMsg("Starlink can place you far from where you really are — if it looks wrong, search your city or zip instead.");
      },
      () => setMsg("Location wasn't shared — search a city or zip instead."),
    );
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && search()}
          placeholder="City or zip, e.g. Clovis or 93611"
          aria-label="Search a city or zip"
          className={`${INPUT} min-w-[220px] flex-1 rounded-full`}
        />
        <button type="button" className={GREEN_BTN} onClick={search}>
          Search
        </button>
        <button type="button" className={SMALL_BTN + " min-h-9"} onClick={useMyLocation}>
          ◎ Use my location
        </button>
        <select value={radius} onChange={(e) => setRadius(Number(e.target.value))} aria-label="Distance" className={INPUT}>
          {[5, 10, 25, 50, 100].map((r) => (
            <option key={r} value={r}>
              Within {r} mi
            </option>
          ))}
        </select>
        {center && (
          <button
            type="button"
            className={SMALL_BTN + " min-h-9"}
            onClick={() => {
              setCenter(null);
              setQ("");
              setMsg(null);
            }}
          >
            Show everywhere
          </button>
        )}
      </div>
      {msg && <p className="text-sm text-amber-300">{msg}</p>}

      <div className="flex gap-2 overflow-x-auto pb-1">
        <button
          type="button"
          onClick={() => setBeer("all")}
          className={`flex w-[96px] shrink-0 flex-col items-center gap-1.5 rounded-xl border px-1.5 py-2 text-center text-[12px] font-semibold leading-tight ${beer === "all" ? "border-[#6abc46] bg-[#6abc46]/10 text-neutral-50" : "border-neutral-800 bg-neutral-950 text-neutral-300"}`}
        >
          <span className="mt-1 block h-[66px] w-[36px] rounded-[6px]" style={{ background: "conic-gradient(#6abc46 0 25%,#f0b44c 0 50%,#e06a5a 0 75%,#5aa9f0 0)" }} />
          All our beers
        </button>
        {beers.map(({ product, b }) => (
          <button
            key={product}
            type="button"
            onClick={() => setBeer(product)}
            className={`flex w-[96px] shrink-0 flex-col items-center gap-1.5 rounded-xl border px-1.5 py-2 text-center text-[12px] font-semibold leading-tight ${beer === product ? "border-[#6abc46] bg-[#6abc46]/10 text-neutral-50" : "border-neutral-800 bg-neutral-950 text-neutral-300"}`}
          >
            <Can url={b?.label_path ? labelUrl.get(b.label_path) : null} path={b?.label_path} front={b?.label_front} title={beerName(b, product)} w={46} h={74} />
            <span className="line-clamp-2">{beerName(b, product)}</span>
          </button>
        ))}
      </div>

      <div className="flex flex-wrap gap-2">
        <Seg value={fmt} onChange={setFmt} options={[["all", "Cans & draft"], ["can", "Cans"], ["draft", "Draft"]]} />
        <Seg value={typ} onChange={setTyp} options={[["all", "Everywhere"], ["store", "Stores (to go)"], ["bar", "Bars & restaurants"]]} />
      </div>

      <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_400px]">
        <div className="relative h-[460px] overflow-hidden rounded-xl border border-neutral-800 lg:h-[640px]">
          <LeafletMap rows={rows} center={center} radius={radius} sel={sel} onSelect={setSel} />
          <div className="pointer-events-none absolute bottom-2 left-2 z-[500] flex gap-3 rounded-lg border border-neutral-800 bg-neutral-950/90 px-2.5 py-1.5 text-xs text-neutral-300">
            <span className="flex items-center gap-1.5">
              <i className="inline-block h-2.5 w-2.5 rounded-full" style={{ background: STORE }} />
              Store
            </span>
            <span className="flex items-center gap-1.5">
              <i className="inline-block h-2.5 w-2.5 rounded-full" style={{ background: BAR }} />
              Bar / restaurant
            </span>
          </div>
        </div>
        <div className="flex max-h-[640px] min-h-0 flex-col rounded-xl border border-neutral-800 bg-neutral-950">
          <div className="flex items-center justify-between gap-2 border-b border-neutral-800 px-3.5 py-2.5">
            <b className="text-[15px] text-neutral-100">
              {rows.length} place{rows.length === 1 ? "" : "s"}
            </b>
            <span className={`text-xs ${MUTED}`}>
              {center ? `Within ${radius} mi of ${center.name}` : "Everywhere"}
              {onMap < rows.length ? ` · ${rows.length - onMap} not on the map yet` : ""}
            </span>
          </div>
          <div className="flex flex-col gap-2 overflow-y-auto p-2">
            {rows.length === 0 && <p className={`p-6 text-center text-sm ${MUTED}`}>No places match. Try a bigger distance or a different beer.</p>}
            {rows.map((r) => (
              <PlaceCard key={r.l.outlet_id} r={r} ctx={ctx} sel={sel === r.l.outlet_id} onClick={() => setSel(r.l.outlet_id)} />
            ))}
          </div>
        </div>
      </div>
      <p className={`text-xs ${MUTED}`}>
        Customers see (www.fcb-data.com/beer-finder): name, address, phone, distance, which of our beers and packages, Directions — and a note that it&apos;s based on recent deliveries, so call ahead. Places not on the map yet don&apos;t show there.
        Distributor, rep, last buy and CEs are only shown here. Map © OpenStreetMap contributors.
      </p>
    </div>
  );
}

function PlaceCard({ r, ctx, sel, onClick }: { r: Row; ctx: Ctx; sel: boolean; onClick: () => void }) {
  const l = r.l;
  const bar = l.premise === "On";
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (sel) ref.current?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, [sel]);
  const rep = l.distributor ? REP_BY_DISTRIBUTOR[l.distributor] : undefined;
  const ce = r.items.reduce((s, i) => s + (Number(i.ce90) || 0), 0);
  return (
    <div
      ref={ref}
      role="button"
      tabIndex={0}
      onClick={onClick}
      onKeyDown={(e) => e.key === "Enter" && onClick()}
      className={`cursor-pointer rounded-lg border px-3 py-2.5 ${sel ? "border-[#6abc46] bg-[#6abc46]/5" : "border-neutral-800 bg-neutral-900/50 hover:border-neutral-600"}`}
    >
      <div className="flex items-start justify-between gap-2">
        <span className="text-sm font-semibold leading-snug text-neutral-100">{shownName(l)}</span>
        {r.d != null && <span className="shrink-0 text-[13px] font-bold text-[#9edc7f]">{r.d.toFixed(1)} mi</span>}
      </div>
      <div className={`text-[12.5px] ${MUTED}`}>{[l.address, l.city].filter(Boolean).map((s) => tidyName(s as string)).join(", ")}</div>
      <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
        <span className="rounded-full px-2 py-0.5 text-[11px] font-bold" style={{ color: bar ? BAR : STORE, background: bar ? "rgba(240,166,60,.12)" : "rgba(90,169,240,.12)" }}>
          {bar ? "Bar / restaurant" : "Store · to go"}
        </span>
        {l.mode === "always" && <span className="rounded-full bg-sky-400/10 px-2 py-0.5 text-[11px] font-bold text-sky-300">Always shown</span>}
        {l.lat == null && <span className="rounded-full bg-amber-400/10 px-2 py-0.5 text-[11px] font-bold text-amber-300">Not on the map yet</span>}
      </div>
      <div className="mt-1.5 flex flex-wrap gap-1">
        {r.items.map((i) => (
          <span key={i.product + i.size} className="rounded-full border border-neutral-800 px-2 py-0.5 text-[12px] text-neutral-200">
            {beerName(ctx.beers.get(i.product), i.product)} <span className="text-neutral-500">· {packageLabel(i.size)}</span>
          </span>
        ))}
      </div>
      <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
        <span className="text-[11.5px] text-neutral-500">
          {[l.distributor, rep && `rep ${rep}`, `last buy ${fmtDay(l.last_buy)}`, ce ? `${Math.round(ce * 10) / 10} CE last 90 days` : null].filter(Boolean).join(" · ")}
        </span>
        <a href={directionsUrl(l)} target="_blank" rel="noopener noreferrer" onClick={(e) => e.stopPropagation()} className="rounded-full bg-[#6abc46] px-2.5 py-1 text-[11.5px] font-bold text-neutral-950">
          Directions
        </a>
      </div>
    </div>
  );
}

// Real street map. Leaflet is loaded in the browser only.
function LeafletMap({
  rows,
  center,
  radius,
  sel,
  onSelect,
}: {
  rows: Row[];
  center: { at: [number, number]; name: string } | null;
  radius: number;
  sel: string | null;
  onSelect: (id: string) => void;
}) {
  const el = useRef<HTMLDivElement>(null);
  const map = useRef<LMap | null>(null);
  const layer = useRef<LayerGroup | null>(null);
  const L = useRef<typeof import("leaflet") | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let dead = false;
    import("leaflet").then((mod) => {
      if (dead || !el.current || map.current) return;
      const Lf = (mod as unknown as { default?: typeof import("leaflet") }).default ?? mod;
      L.current = Lf;
      map.current = Lf.map(el.current, { center: [36.75, -119.78], zoom: 8, scrollWheelZoom: true });
      Lf.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
        maxZoom: 19,
        attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
      }).addTo(map.current);
      layer.current = Lf.layerGroup().addTo(map.current);
      setReady(true);
    });
    return () => {
      dead = true;
      map.current?.remove();
      map.current = null;
    };
  }, []);

  // Redraw pins when the list changes; fit the map to them.
  const key = rows.map((r) => r.l.outlet_id).join(",") + (center ? center.at.join(",") + radius : "");
  useEffect(() => {
    const Lf = L.current;
    if (!ready || !Lf || !map.current || !layer.current) return;
    layer.current.clearLayers();
    const pts: [number, number][] = [];
    for (const r of rows) {
      if (r.l.lat == null || r.l.lng == null) continue;
      const at: [number, number] = [r.l.lat, r.l.lng];
      pts.push(at);
      const m = Lf.circleMarker(at, { radius: 7, weight: 2, color: "#0b0d0c", fillColor: r.l.premise === "On" ? BAR : STORE, fillOpacity: 0.95 });
      m.bindTooltip(shownName(r.l));
      m.on("click", () => onSelect(r.l.outlet_id));
      (m as unknown as { _bfId: string })._bfId = r.l.outlet_id;
      m.addTo(layer.current);
    }
    if (center) {
      Lf.circle(center.at, { radius: radius * 1609.34, color: "#6abc46", weight: 1.5, dashArray: "6 6", fillOpacity: 0.04 }).addTo(layer.current);
      map.current.fitBounds(Lf.latLng(center.at).toBounds(radius * 1609.34 * 2), { padding: [20, 20] });
    } else if (pts.length) {
      map.current.fitBounds(Lf.latLngBounds(pts), { padding: [30, 30], maxZoom: 13 });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `key` stands in for rows/center/radius
  }, [ready, key]);

  // Highlight the selected place and bring it into view.
  useEffect(() => {
    if (!ready || !layer.current || !map.current) return;
    layer.current.eachLayer((ly) => {
      const id = (ly as unknown as { _bfId?: string })._bfId;
      if (!id) return;
      const m = ly as import("leaflet").CircleMarker;
      const on = id === sel;
      m.setStyle({ radius: on ? 11 : 7, weight: on ? 3 : 2, color: on ? "#ffffff" : "#0b0d0c" });
      if (on) {
        m.bringToFront();
        if (!map.current!.getBounds().contains(m.getLatLng())) map.current!.panTo(m.getLatLng());
      }
    });
  }, [ready, sel, key]);

  return <div ref={el} className="h-full w-full bg-neutral-900" />;
}

// ---------------------------------------------------------------------------
// Control tab
// ---------------------------------------------------------------------------
const STATUS_LABEL: Record<Status, string> = {
  live: "On the finder",
  always: "Always shown",
  dropped: "Dropped off",
  hidden: "Hidden",
  off: "Removed from lists",
  dist: "Distributor off",
};
const STATUS_CLASS: Record<Status, string> = {
  live: "bg-[#6abc46]/15 text-[#9edc7f]",
  always: "bg-sky-400/10 text-sky-300",
  dropped: "bg-amber-400/10 text-amber-300",
  hidden: "bg-red-400/10 text-red-300",
  off: "bg-neutral-700/50 text-neutral-300",
  dist: "bg-neutral-700/50 text-neutral-300",
};

function ControlTab({
  supabase,
  data,
  labels,
  labelUrl,
  onChanged,
}: {
  supabase: Supa;
  data: BfData;
  labels: BfLabel[];
  labelUrl: Map<string, string | null>;
  onChanged: () => Promise<void> | void;
}) {
  const ctx = useMemo(() => makeCtx(data), [data]);
  const [days, setDays] = useState(ctx.days);
  const [err, setErr] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [placing, setPlacing] = useState(false);
  const [aq, setAq] = useState("");
  const [afil, setAfil] = useState<"all" | "live" | "dropped" | "hidden" | "nopin">("all");
  const [pinFor, setPinFor] = useState<BfLocation | null>(null);

  const by = async () => (await supabase.auth.getUser()).data.user?.id ?? null;
  const flash = (t: string) => {
    setNote(t);
    setTimeout(() => setNote(null), 2500);
  };
  async function run(p: PromiseLike<{ error: { message: string } | null }>, ok: string) {
    const { error } = await p;
    if (error) return setErr(error.message);
    setErr(null);
    flash(ok);
    await onChanged();
  }

  const liveCtx = useMemo(() => ({ ...ctx, days }), [ctx, days]);
  const statuses = useMemo(() => new Map(data.locations.map((l) => [l.outlet_id, statusOf(liveCtx, l)])), [data, liveCtx]);
  const liveCount = [...statuses.values()].filter(isLive).length;
  const droppedCount = [...statuses.values()].filter((s) => s === "dropped").length;
  const noPin = data.locations.filter((l) => isLive(statuses.get(l.outlet_id)!) && (l.lat == null || l.pin === "nomatch"));

  const beerRows = useMemo(() => {
    const count = new Map<string, number>();
    for (const l of data.locations) {
      if (!isLive(statuses.get(l.outlet_id)!)) continue;
      for (const p of new Set(liveItems(liveCtx, l).map((i) => i.product))) count.set(p, (count.get(p) ?? 0) + 1);
    }
    return [...data.beers].map((b) => ({ b, n: count.get(b.product) ?? 0 })).sort((x, y) => y.n - x.n || x.b.product.localeCompare(y.b.product));
  }, [data, statuses, liveCtx]);

  const distRows = useMemo(
    () =>
      data.distributors.map((d) => ({
        ...d,
        n: data.locations.filter((l) => l.distributor === d.distributor && isLive(statusOf({ ...liveCtx, distShown: new Map([[d.distributor, true]]) }, l))).length,
      })).sort((a, b) => b.n - a.n),
    [data, liveCtx],
  );

  const accRows = useMemo(() => {
    const t = aq.trim().toLowerCase();
    return data.locations
      .filter((l) => {
        const s = statuses.get(l.outlet_id)!;
        if (afil === "live" && !isLive(s)) return false;
        if (afil === "dropped" && s !== "dropped") return false;
        if (afil === "hidden" && s !== "hidden" && s !== "off" && s !== "dist") return false;
        if (afil === "nopin" && !(l.lat == null || l.pin === "nomatch")) return false;
        return !t || [l.name, l.display_name, l.city, l.address, l.zip].some((v) => v?.toLowerCase().includes(t));
      })
      .sort((a, b) => (b.last_buy ?? "").localeCompare(a.last_buy ?? ""));
  }, [data, statuses, aq, afil]);

  const saveBeer = async (product: string, patch: Partial<BfBeer>) => {
    const cur = ctx.beers.get(product);
    await run(
      supabase.from("beer_finder_beers").upsert({ product, public_name: cur?.public_name ?? null, show: cur?.show ?? true, label_path: cur?.label_path ?? null, label_front: cur?.label_front ?? null, ...patch, updated_at: new Date().toISOString(), updated_by: await by() }),
      "Saved",
    );
  };
  // Turn the can so the front of the label faces you (◀ ▶ next to each can).
  const turnCan = (b: BfBeer, step: number) => {
    const cur = b.label_front ?? defaultFront(b.label_path);
    saveBeer(b.product, { label_front: Math.round((((cur + step) % 1) + 1) % 1 * 1000) / 1000 });
  };
  const saveOverride = async (l: BfLocation, patch: Partial<{ mode: string; display_name: string | null; lat: number | null; lng: number | null }>) => {
    await run(
      supabase.from("beer_finder_overrides").upsert({
        outlet_id: l.outlet_id,
        mode: l.mode,
        display_name: l.display_name,
        lat: l.pin === "manual" ? l.lat : null,
        lng: l.pin === "manual" ? l.lng : null,
        ...patch,
        updated_at: new Date().toISOString(),
        updated_by: await by(),
      }),
      "Saved",
    );
  };

  async function placePins() {
    setPlacing(true);
    try {
      const r = await fetch("/api/beer-finder/geocode", { method: "POST" });
      const j = await r.json();
      if (!r.ok) setErr(j.error ?? "Couldn't place pins.");
      else {
        setErr(null);
        setNote(j.summary);
      }
      await onChanged();
    } finally {
      setPlacing(false);
    }
  }

  const sortedLabels = useMemo(() => [...labels].sort((a, b) => a.brand.localeCompare(b.brand) || a.name.localeCompare(b.name) || a.size.localeCompare(b.size)), [labels]);

  return (
    <div className="flex flex-col gap-4">
      {err && <div className="rounded-md border border-red-500/40 bg-red-500/10 px-3 py-2 text-sm text-red-300">{err}</div>}
      {note && <div className="rounded-md border border-[#6abc46]/40 bg-[#6abc46]/10 px-3 py-2 text-sm text-[#c3ecae]">{note}</div>}

      <div className="grid gap-3 sm:grid-cols-3">
        <div className={CARD}>
          <div className="text-sm font-semibold text-neutral-100">On the finder now</div>
          <div className="mt-1 text-3xl font-light text-neutral-50">{liveCount}</div>
          <div className={`text-xs ${MUTED}`}>places{noPin.length ? ` · ${noPin.length} not on the map yet` : ""}</div>
        </div>
        <div className={CARD}>
          <div className="text-sm font-semibold text-neutral-100">Dropped off automatically</div>
          <div className="mt-1 text-3xl font-light text-neutral-50">{droppedCount}</div>
          <div className={`text-xs ${MUTED}`}>no buy in the last {days} days — they come back on their own when they order again</div>
        </div>
        <div className={CARD}>
          <div className="text-sm font-semibold text-neutral-100">Website finder</div>
          <div className="mt-2 flex items-center gap-2.5">
            <Switch
              on={!!data.settings?.public_on}
              label="Website finder on or off"
              onClick={async () => run(supabase.from("beer_finder_settings").upsert({ id: 1, days: ctx.days, public_on: !data.settings?.public_on, updated_at: new Date().toISOString(), updated_by: await by() }), "Saved")}
            />
            <span className="text-sm text-neutral-200">{data.settings?.public_on ? "On" : "Off (shows \"Coming soon\")"}</span>
          </div>
          <div className={`mt-1 text-xs ${MUTED}`}>
            Live at{" "}
            <a href="/beer-finder" target="_blank" rel="noopener noreferrer" className="font-semibold text-[#9edc7f] underline">
              www.fcb-data.com/beer-finder
            </a>{" "}
            — changes here show there within 5 minutes.
          </div>
          <div className="mt-2 flex flex-wrap gap-1.5">
            <a href="/beer-finder" target="_blank" rel="noopener noreferrer" className={SMALL_BTN}>
              Preview public page
            </a>
            <button
              type="button"
              className={SMALL_BTN}
              onClick={async () => {
                try {
                  await navigator.clipboard.writeText(EMBED_CODE);
                  flash("Embed code copied — paste it into an Embed HTML box on the website");
                } catch {
                  setErr("Couldn't copy — select the code below and copy it.");
                }
              }}
            >
              Copy embed code
            </button>
          </div>
          <details className="mt-1.5">
            <summary className={`cursor-pointer text-xs ${MUTED}`}>Show embed code (for Eddie / Wix)</summary>
            <code className="mt-1 block break-all rounded-md border border-neutral-800 bg-neutral-900 p-2 text-[11px] text-neutral-300">{EMBED_CODE}</code>
          </details>
        </div>
      </div>

      <div className={CARD}>
        <div className="text-sm font-semibold text-neutral-100">Who shows up</div>
        <div className="mt-2 flex flex-wrap items-center gap-3">
          <span className="text-sm text-neutral-300">Show a place if it bought that beer in the last</span>
          <input
            type="range"
            min={30}
            max={180}
            step={15}
            value={days}
            onChange={(e) => setDays(Number(e.target.value))}
            onPointerUp={async () => days !== ctx.days && run(supabase.from("beer_finder_settings").upsert({ id: 1, days, public_on: data.settings?.public_on ?? true, updated_at: new Date().toISOString(), updated_by: await by() }), `Saved: ${days} days`)}
            onKeyUp={async () => days !== ctx.days && run(supabase.from("beer_finder_settings").upsert({ id: 1, days, public_on: data.settings?.public_on ?? true, updated_at: new Date().toISOString(), updated_by: await by() }), `Saved: ${days} days`)}
            aria-label="Days"
            className="min-w-[180px] flex-1 accent-[#6abc46]"
          />
          <b className="text-lg text-neutral-50">{days} days</b>
        </div>
        <p className={`mt-1 text-xs ${MUTED}`}>Counted back from the latest sales data ({fmtDay(data.as_of)}). Accounts removed from lists never show.</p>
      </div>

      <div className={CARD}>
        <div className="mb-2 text-sm font-semibold text-neutral-100">
          Beers <span className={`font-normal ${MUTED}`}>· show or hide · name and label customers see</span>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-[11.5px] text-neutral-500">
                <th className="px-2 py-1.5">Show</th>
                <th className="px-2 py-1.5">Can · ◀ ▶ to turn</th>
                <th className="px-2 py-1.5">Name customers see</th>
                <th className="px-2 py-1.5">Label from POS → Labels</th>
                <th className="px-2 py-1.5 text-right">Places</th>
              </tr>
            </thead>
            <tbody>
              {beerRows.map(({ b, n }) => (
                <tr key={b.product} className="border-t border-neutral-900">
                  <td className="px-2 py-1.5">
                    <Switch on={b.show} label={`Show ${b.product}`} onClick={() => saveBeer(b.product, { show: !b.show })} />
                  </td>
                  <td className="px-2 py-1.5">
                    <div className="flex items-center gap-1">
                      <Can url={b.label_path ? labelUrl.get(b.label_path) : null} path={b.label_path} front={b.label_front} title={beerName(b, b.product)} w={36} h={58} />
                      {b.label_path && (
                        <div className="flex flex-col gap-0.5">
                          <button type="button" title="Turn the can left" aria-label={`Turn the ${b.product} can left`} className="rounded border border-neutral-700 px-1 text-[11px] text-neutral-300 hover:text-white" onClick={() => turnCan(b, -0.02)}>
                            ◀
                          </button>
                          <button type="button" title="Turn the can right" aria-label={`Turn the ${b.product} can right`} className="rounded border border-neutral-700 px-1 text-[11px] text-neutral-300 hover:text-white" onClick={() => turnCan(b, 0.02)}>
                            ▶
                          </button>
                        </div>
                      )}
                    </div>
                  </td>
                  <td className="px-2 py-1.5">
                    <input
                      defaultValue={b.public_name ?? b.product}
                      key={b.public_name ?? b.product}
                      onBlur={(e) => {
                        const v = e.target.value.trim();
                        if (v !== (b.public_name ?? b.product)) saveBeer(b.product, { public_name: v && v !== b.product ? v : null });
                      }}
                      aria-label={`Name for ${b.product}`}
                      className={`${INPUT} w-full min-w-[200px]`}
                    />
                    {b.public_name && <div className="mt-0.5 text-[11px] text-neutral-500">Sales data: {b.product}</div>}
                  </td>
                  <td className="px-2 py-1.5">
                    <select value={b.label_path ?? ""} onChange={(e) => saveBeer(b.product, { label_path: e.target.value || null, label_front: null })} aria-label={`Label for ${b.product}`} className={`${INPUT} w-full min-w-[200px]`}>
                      <option value="">No label (keg picture)</option>
                      {sortedLabels.map((x) => (
                        <option key={x.path} value={x.path}>
                          {x.brand} · {x.name} · {x.size}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td className="px-2 py-1.5 text-right font-mono text-neutral-300">{b.show ? n : "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {!labels.length && <p className="mt-2 text-xs text-amber-300">Loading labels from POS → Labels…</p>}
      </div>

      <div className={CARD}>
        <div className="mb-2 text-sm font-semibold text-neutral-100">
          Distributors <span className={`font-normal ${MUTED}`}>· include their accounts</span>
        </div>
        <div className="flex flex-col divide-y divide-neutral-900">
          {distRows.map((d) => (
            <div key={d.distributor} className="flex items-center gap-3 py-1.5 text-sm">
              <Switch
                on={d.show}
                label={`Include ${d.distributor}`}
                onClick={async () => run(supabase.from("beer_finder_distributors").upsert({ distributor: d.distributor, show: !d.show, updated_at: new Date().toISOString(), updated_by: await by() }), "Saved")}
              />
              <span className="flex-1 text-neutral-200">{d.distributor}</span>
              <span className={`font-mono text-xs ${MUTED}`}>{d.n} places</span>
            </div>
          ))}
        </div>
        <p className={`mt-1 text-xs ${MUTED}`}>Coast doesn&apos;t report store sales, so its stores don&apos;t show.</p>
      </div>

      <div className={CARD}>
        <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
          <div className="text-sm font-semibold text-neutral-100">
            Couldn&apos;t place on the map <span className={`font-normal ${MUTED}`}>· {noPin.length} on the finder without a pin</span>
          </div>
          <button type="button" className={GREEN_BTN} onClick={placePins} disabled={placing}>
            {placing ? "Placing pins… (up to 4 minutes)" : "Place pins now"}
          </button>
        </div>
        <p className={`text-xs ${MUTED}`}>
          Pins come from the free US Census Bureau address lookup; anything it misses is retried automatically without the suite number and then with OpenStreetMap&apos;s free lookup (about one a second).
          New accounts are placed after the weekday LilyPad sync; Place pins now does it right away and keeps going for up to 4 minutes. Fix pin is only for a pin in the wrong spot.
        </p>
        {noPin.length > 0 && (
          <div className="mt-2 flex flex-col divide-y divide-neutral-900">
            {noPin.slice(0, 30).map((l) => (
              <div key={l.outlet_id} className="flex flex-wrap items-center gap-2 py-1.5 text-sm">
                <span className="flex-1 text-neutral-200">
                  {shownName(l)} <span className={MUTED}>· {[l.address, l.city, l.zip].filter(Boolean).join(", ") || "no address"}</span>
                </span>
                <span className="text-xs text-amber-300">{l.pin === "nomatch" ? "Address not matched" : "Not looked up yet"}</span>
                <button type="button" className={SMALL_BTN} onClick={() => setPinFor(l)}>
                  Fix pin
                </button>
              </div>
            ))}
            {noPin.length > 30 && <p className={`pt-1.5 text-xs ${MUTED}`}>+ {noPin.length - 30} more — press Place pins now first.</p>}
          </div>
        )}
      </div>

      <div className={CARD}>
        <div className="mb-2 text-sm font-semibold text-neutral-100">
          Places <span className={`font-normal ${MUTED}`}>· fix names, hide, always show, fix pins</span>
        </div>
        <div className="mb-2 flex flex-wrap items-center gap-2">
          <input value={aq} onChange={(e) => setAq(e.target.value)} placeholder="Search name, city, address or zip" aria-label="Search places" className={`${INPUT} min-w-[220px] flex-1 rounded-full`} />
          <Seg
            value={afil}
            onChange={setAfil}
            options={[
              ["all", "All"],
              ["live", "On the finder"],
              ["dropped", "Dropped off"],
              ["hidden", "Hidden / off"],
              ["nopin", "No pin"],
            ]}
          />
        </div>
        <div className="max-h-[560px] overflow-auto">
          <table className="w-full text-sm">
            <thead className="sticky top-0 bg-neutral-950">
              <tr className="text-left text-[11.5px] text-neutral-500">
                <th className="px-2 py-1.5">Name customers see</th>
                <th className="px-2 py-1.5">City</th>
                <th className="px-2 py-1.5">Distributor</th>
                <th className="px-2 py-1.5">Last buy</th>
                <th className="px-2 py-1.5">Status</th>
                <th className="px-2 py-1.5" />
              </tr>
            </thead>
            <tbody>
              {accRows.slice(0, 300).map((l) => {
                const s = statuses.get(l.outlet_id)!;
                return (
                  <tr key={l.outlet_id} className="border-t border-neutral-900 align-top">
                    <td className="px-2 py-1.5">
                      <input
                        defaultValue={shownName(l)}
                        key={shownName(l)}
                        onBlur={(e) => {
                          const v = e.target.value.trim();
                          if (v !== shownName(l)) saveOverride(l, { display_name: v && v !== tidyName(l.name) ? v : null });
                        }}
                        aria-label={`Name for ${l.name}`}
                        className={`${INPUT} w-full min-w-[200px]`}
                      />
                      <div className="mt-0.5 text-[11px] text-neutral-500">LilyPad: {l.name}</div>
                    </td>
                    <td className="px-2 py-1.5 text-neutral-300">{l.city ? tidyName(l.city) : "—"}</td>
                    <td className="px-2 py-1.5 text-neutral-300">{l.distributor ?? "—"}</td>
                    <td className="px-2 py-1.5 text-neutral-300">
                      {fmtDay(l.last_buy)}
                      {l.last_buy && <div className="text-[11px] text-neutral-500">{daysBetween(data.as_of, l.last_buy)} days ago</div>}
                    </td>
                    <td className="px-2 py-1.5">
                      <span className={`whitespace-nowrap rounded-full px-2 py-0.5 text-[11.5px] font-bold ${STATUS_CLASS[s]}`}>{STATUS_LABEL[s]}</span>
                      {(l.lat == null || l.pin === "nomatch") && <div className="mt-1 text-[11px] text-amber-300">No pin</div>}
                      {l.pin === "manual" && <div className="mt-1 text-[11px] text-sky-300">Pin moved by hand</div>}
                    </td>
                    <td className="whitespace-nowrap px-2 py-1.5">
                      <div className="flex flex-wrap justify-end gap-1">
                        {l.mode === "hide" ? (
                          <button type="button" className={SMALL_BTN} onClick={() => saveOverride(l, { mode: "auto" })}>
                            Unhide
                          </button>
                        ) : (
                          <button type="button" className={SMALL_BTN} onClick={() => saveOverride(l, { mode: "hide" })}>
                            Hide
                          </button>
                        )}
                        {l.mode === "always" ? (
                          <button type="button" className={SMALL_BTN} onClick={() => saveOverride(l, { mode: "auto" })}>
                            Back to automatic
                          </button>
                        ) : (
                          l.mode !== "hide" && (
                            <button type="button" className={SMALL_BTN} onClick={() => saveOverride(l, { mode: "always" })}>
                              Always show
                            </button>
                          )
                        )}
                        <button type="button" className={SMALL_BTN} onClick={() => setPinFor(l)}>
                          Fix pin
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {accRows.length > 300 && <p className={`p-2 text-xs ${MUTED}`}>Showing 300 of {accRows.length} — search to narrow it down.</p>}
          {!accRows.length && <p className={`p-2 text-sm ${MUTED}`}>Nothing here.</p>}
        </div>
      </div>

      {pinFor && (
        <PinPicker
          l={pinFor}
          onClose={() => setPinFor(null)}
          onSave={async (at) => {
            await saveOverride(pinFor, at ? { lat: at[0], lng: at[1] } : { lat: null, lng: null });
            setPinFor(null);
          }}
        />
      )}
    </div>
  );
}

// Fix pin: click the map where the place really is.
function PinPicker({ l, onClose, onSave }: { l: BfLocation; onClose: () => void; onSave: (at: [number, number] | null) => void }) {
  const el = useRef<HTMLDivElement>(null);
  const [at, setAt] = useState<[number, number] | null>(l.lat != null && l.lng != null ? [l.lat, l.lng] : null);
  useEffect(() => {
    let map: LMap | null = null;
    let dead = false;
    import("leaflet").then((mod) => {
      if (dead || !el.current) return;
      const Lf = (mod as unknown as { default?: typeof import("leaflet") }).default ?? mod;
      const start: [number, number] = l.lat != null && l.lng != null ? [l.lat, l.lng] : [36.75, -119.78];
      map = Lf.map(el.current, { center: start, zoom: l.lat != null ? 16 : 8 });
      Lf.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", { maxZoom: 19, attribution: "&copy; OpenStreetMap contributors" }).addTo(map);
      let pin: import("leaflet").CircleMarker | null = l.lat != null && l.lng != null ? Lf.circleMarker(start, { radius: 9, color: "#fff", weight: 3, fillColor: "#6abc46", fillOpacity: 1 }).addTo(map) : null;
      map.on("click", (e) => {
        const p: [number, number] = [e.latlng.lat, e.latlng.lng];
        setAt(p);
        if (pin) pin.setLatLng(e.latlng);
        else pin = Lf.circleMarker(p, { radius: 9, color: "#fff", weight: 3, fillColor: "#6abc46", fillOpacity: 1 }).addTo(map!);
      });
    });
    return () => {
      dead = true;
      map?.remove();
    };
  }, [l]);
  useEffect(() => {
    const k = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", k);
    return () => window.removeEventListener("keydown", k);
  }, [onClose]);
  return (
    <div className="fixed inset-0 z-[1000] flex items-start justify-center overflow-y-auto bg-black/70 p-4 pt-14" onClick={onClose}>
      <div role="dialog" aria-modal="true" className="w-full max-w-3xl rounded-xl border border-neutral-800 bg-neutral-950 p-4" onClick={(e) => e.stopPropagation()}>
        <div className="mb-2 flex items-start justify-between gap-3">
          <div>
            <div className="text-base font-bold text-neutral-100">Fix pin · {shownName(l)}</div>
            <div className={`text-sm ${MUTED}`}>{[l.address, l.city, l.zip].filter(Boolean).join(", ") || "No address on file"} — click the map where it really is.</div>
          </div>
          <button type="button" onClick={onClose} className="text-neutral-400 hover:text-neutral-100" aria-label="Close">
            ✕
          </button>
        </div>
        <div ref={el} className="h-[420px] w-full overflow-hidden rounded-lg border border-neutral-800 bg-neutral-900" />
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <button type="button" className={GREEN_BTN} disabled={!at} onClick={() => onSave(at)}>
            Save pin
          </button>
          {l.pin === "manual" && (
            <button type="button" className={SMALL_BTN + " min-h-9"} onClick={() => onSave(null)}>
              Go back to the looked-up pin
            </button>
          )}
          <button type="button" className={SMALL_BTN + " min-h-9"} onClick={onClose}>
            Cancel
          </button>
          {at && <span className={`text-xs ${MUTED}`}>{at[0].toFixed(5)}, {at[1].toFixed(5)}</span>}
        </div>
      </div>
    </div>
  );
}
