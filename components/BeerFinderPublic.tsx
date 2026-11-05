"use client";

// PUBLIC Beer Finder (www.fcb-data.com/beer-finder) — step 2, added
// 2026-11-04 per Chad ("lets make the page live"). Plan:
// claude/beer-finder-step2-plan.md in the project. Sits inside our websites
// (fullcirclebrewing.com, fcbbrands.com) in an Embed HTML box, so it's a plain
// light page with no FCB-Data sidebar, header or login, and it fits a
// ~1000px-tall box (the list scrolls inside).
//
// Customers: search a city or zip (or use their location), pick a beer (its
// real 3D can), cans / draft, stores / bars & restaurants, distance → map +
// list with name, address, distance, beers + package, Directions, Call.
// Nothing internal (no distributor, rep, sales). Everything that shows is set
// on the internal page's Control tab (www.fcb-data.com/beer-finder/manage).
// Colors are plain hex on purpose (the app's gray scale follows each
// person's theme; this page must always look the same).
//
// 21+ AGE CHECK (added 2026-11-04, per Chad — the texting carriers rejected
// FCB once for missing age checks; they require one on every public page).
// This page loads FCB's own Age Check (/api/age-check/script — the same
// birth-date screen as our websites, design from Admin → Age Check, adults
// remembered 30 days). It's skipped ONLY when the finder sits inside one of
// our websites that already runs that check (GATED_SITES), so visitors aren't
// asked twice. Opened directly, or inside fcbbrands.com (no age check there,
// per Art), it shows. Browsers that can't say which site the finder is inside
// (Firefox) always show it. The finder stays hidden until the check is on.

import "leaflet/dist/leaflet.css";
import { useEffect, useMemo, useRef, useState } from "react";
import type { Map as LMap, LayerGroup } from "leaflet";
import { type PubData, type PubPlace, isDraft, milesBetween, packageLabel, tidyName } from "@/lib/beerFinder";

const GREEN = "#4f9a2f";
const GREEN_LIGHT = "#6abc46";
const INK = "#1c231f";
const MUTE = "#5f6b64";
const LINE = "#dfe5e1";
const STORE = "#2f7fd0";
const BAR = "#d9861c";

type Row = { p: PubPlace; items: PubPlace["items"]; d: number | null };

// Our websites that already run FCB's Age Check on every page.
const GATED_SITES = ["fullcirclebrewing.com", "goodbeer.com", "sonomaciderco.com"];

function insideGatedSite(): boolean {
  try {
    if (window.top === window.self) return false; // opened directly
    const anc = (window.location as Location & { ancestorOrigins?: DOMStringList }).ancestorOrigins;
    if (!anc || !anc.length) return false; // can't tell (Firefox) → ask
    for (let i = 0; i < anc.length; i++) {
      const host = new URL(anc[i]).hostname.toLowerCase();
      if (!GATED_SITES.some((g) => host === g || host.endsWith("." + g))) return false;
    }
    return true;
  } catch {
    return false;
  }
}

// "checking" until we know; then the page shows (the check, if needed, is on top).
function useAgeCheck(): boolean {
  const [ready, setReady] = useState(false);
  useEffect(() => {
    if (insideGatedSite()) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- decided once, in the browser
      setReady(true);
      return;
    }
    const sc = document.createElement("script");
    sc.src = "/api/age-check/script";
    sc.async = true;
    sc.onload = () => setReady(true);
    sc.onerror = () => setReady(true); // never leave the page blank
    document.body.appendChild(sc);
  }, []);
  return ready;
}

const placeName = (p: PubPlace) => (p.custom ? p.name : tidyName(p.name));
function phoneText(ph: string | null) {
  const d = (ph ?? "").replace(/\D/g, "").replace(/^1(?=\d{10}$)/, "");
  return d.length === 10 ? `(${d.slice(0, 3)}) ${d.slice(3, 6)}-${d.slice(6)}` : (ph ?? "").trim();
}
const directions = (p: PubPlace) =>
  `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent([placeName(p), p.address, p.city, p.state || "CA", p.zip].filter(Boolean).join(" "))}`;

function Seg<T extends string>({ value, options, onChange, label }: { value: T; options: [T, string][]; onChange: (v: T) => void; label: string }) {
  return (
    <div role="group" aria-label={label} className="inline-flex rounded-full border bg-white p-1" style={{ borderColor: LINE }}>
      {options.map(([k, t]) => (
        <button
          key={k}
          type="button"
          aria-pressed={value === k}
          onClick={() => onChange(k)}
          className="rounded-full px-3 py-1 text-[13px] font-semibold"
          style={value === k ? { background: INK, color: "#fff" } : { color: MUTE }}
        >
          {t}
        </button>
      ))}
    </div>
  );
}

function CanPic({ src, name }: { src: string | null; name: string }) {
  if (!src)
    return (
      <span aria-hidden className="relative block h-[70px] w-[44px]">
        <span className="absolute inset-x-[8%] inset-y-[8%] rounded-md" style={{ background: "linear-gradient(90deg,#7b817d,#eef1ef 35%,#a9afab 70%,#6c726e)" }}>
          <span className="absolute inset-x-0 top-[24%] h-[3px] bg-black/20" />
          <span className="absolute inset-x-0 top-[70%] h-[3px] bg-black/20" />
        </span>
      </span>
    );
  // eslint-disable-next-line @next/next/no-img-element -- picture from our public can folder
  return <img src={src} alt={name} className="block h-[70px] w-[44px] object-contain" loading="lazy" draggable={false} />;
}

export default function BeerFinderPublic({ data }: { data: PubData | null }) {
  const ready = useAgeCheck();
  return <div style={ready ? undefined : { visibility: "hidden" }}>{ready && <Content data={data} />}</div>;
}

function Content({ data }: { data: PubData | null }) {
  if (!data || !data.public_on || !data.places) {
    return (
      <div className="flex min-h-screen w-full items-center justify-center bg-white p-6 text-center" style={{ color: INK }}>
        <div>
          <h1 className="text-2xl font-bold">Find Full Circle near you</h1>
          <p className="mt-2 text-[15px]" style={{ color: MUTE }}>
            {data && !data.public_on ? "Our beer finder is coming soon." : "The beer finder is taking a short break — please check back soon."}
          </p>
        </div>
      </div>
    );
  }
  return <Finder data={data} />;
}

function Finder({ data }: { data: PubData }) {
  const places = data.places!;
  const beerInfo = useMemo(() => new Map((data.beers ?? []).map((b) => [b.product, b])), [data]);
  const [beer, setBeer] = useState("all");
  const [fmt, setFmt] = useState<"all" | "can" | "draft">("all");
  const [typ, setTyp] = useState<"all" | "store" | "bar">("all");
  const [q, setQ] = useState("");
  const [center, setCenter] = useState<{ at: [number, number]; name: string } | null>(null);
  const [radius, setRadius] = useState(25);
  const [msg, setMsg] = useState<string | null>(null);
  const [sel, setSel] = useState<string | null>(null);

  // Beers on at least one place, most places first.
  const beers = useMemo(() => {
    const n = new Map<string, number>();
    for (const p of places) for (const b of new Set(p.items.map((i) => i.p))) n.set(b, (n.get(b) ?? 0) + 1);
    return [...n.entries()].sort((a, b) => b[1] - a[1]).map(([product]) => ({ product, name: beerInfo.get(product)?.name ?? product, can: beerInfo.get(product)?.can ?? null }));
  }, [places, beerInfo]);
  const nameOf = (product: string) => beerInfo.get(product)?.name ?? product;

  const rows: Row[] = useMemo(() => {
    const out: Row[] = [];
    for (const p of places) {
      let items = p.items;
      if (beer !== "all") items = items.filter((i) => i.p === beer);
      if (fmt === "can") items = items.filter((i) => !isDraft(i.s));
      if (fmt === "draft") items = items.filter((i) => isDraft(i.s));
      if (!items.length) continue;
      if (typ === "store" && p.bar) continue;
      if (typ === "bar" && !p.bar) continue;
      let d: number | null = null;
      if (center) {
        d = milesBetween(center.at, [p.lat, p.lng]);
        if (d > radius) continue;
      }
      out.push({ p, items, d });
    }
    return out.sort((a, b) => (a.d ?? 0) - (b.d ?? 0) || placeName(a.p).localeCompare(placeName(b.p)));
  }, [places, beer, fmt, typ, center, radius]);

  function search() {
    const t = q.trim().toLowerCase().replace(/,?\s*ca(lifornia)?$/, "").trim();
    setSel(null);
    if (!t) {
      setCenter(null);
      setMsg(null);
      return;
    }
    let hits: PubPlace[];
    if (/^\d{5}$/.test(t)) {
      hits = places.filter((p) => (p.zip ?? "").startsWith(t));
      // No places in that exact zip → nearby zips (same first 4 digits, then 3).
      if (!hits.length) hits = places.filter((p) => (p.zip ?? "").startsWith(t.slice(0, 4)));
      if (!hits.length) hits = places.filter((p) => (p.zip ?? "").startsWith(t.slice(0, 3)));
    } else {
      hits = places.filter((p) => (p.city ?? "").toLowerCase() === t);
      if (!hits.length) hits = places.filter((p) => (p.city ?? "").toLowerCase().startsWith(t));
    }
    if (!hits.length) {
      setMsg(`We couldn't find "${q.trim()}". Try a nearby city or zip, or use your location.`);
      return;
    }
    const at: [number, number] = [hits.reduce((s, p) => s + p.lat, 0) / hits.length, hits.reduce((s, p) => s + p.lng, 0) / hits.length];
    setCenter({ at, name: /^\d/.test(t) ? t : tidyName(t) });
    setMsg(null);
  }
  function useMyLocation() {
    if (!navigator.geolocation) return setMsg("This browser can't share your location — search a city or zip instead.");
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setSel(null);
        setCenter({ at: [pos.coords.latitude, pos.coords.longitude], name: "you" });
        setMsg(null);
      },
      () => setMsg("Location wasn't shared — search a city or zip instead."),
      { timeout: 10000 },
    );
  }

  const field = "min-h-10 rounded-full border bg-white px-4 text-[15px] focus:outline-none";
  return (
    <div className="min-h-screen w-full bg-white" style={{ color: INK }}>
      <div className="mx-auto flex w-full max-w-[1200px] flex-col gap-3 px-3 py-4 sm:px-5">
        <div className="flex flex-wrap items-end justify-between gap-2">
          <div>
            <h1 className="text-[26px] font-extrabold leading-tight">Find Full Circle near you</h1>
            <p className="text-[14px]" style={{ color: MUTE }}>
              Stores, bars and restaurants that carry our beer.
            </p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && search()}
            placeholder="City or zip"
            aria-label="Search a city or zip"
            inputMode="search"
            className={`${field} min-w-[180px] flex-1`}
            style={{ borderColor: LINE }}
          />
          <button type="button" onClick={search} className="min-h-10 rounded-full px-5 text-[15px] font-bold text-white" style={{ background: GREEN }}>
            Search
          </button>
          <button type="button" onClick={useMyLocation} className="min-h-10 rounded-full border px-4 text-[14px] font-semibold" style={{ borderColor: LINE, color: INK }}>
            ◎ Use my location
          </button>
          <select value={radius} onChange={(e) => setRadius(Number(e.target.value))} aria-label="Distance" className={field} style={{ borderColor: LINE }}>
            {[5, 10, 25, 50, 100].map((r) => (
              <option key={r} value={r}>
                Within {r} miles
              </option>
            ))}
          </select>
          {center && (
            <button
              type="button"
              onClick={() => {
                setCenter(null);
                setQ("");
                setMsg(null);
              }}
              className="min-h-10 rounded-full px-3 text-[14px] font-semibold underline"
              style={{ color: MUTE }}
            >
              Clear
            </button>
          )}
        </div>
        {msg && <p className="text-[14px] font-medium" style={{ color: "#a4550a" }}>{msg}</p>}

        <div className="flex gap-2 overflow-x-auto pb-1" role="group" aria-label="Pick a beer">
          <BeerBtn on={beer === "all"} onClick={() => setBeer("all")} name="All our beers">
            <span aria-hidden className="mt-0.5 block h-[64px] w-[34px] rounded-[7px]" style={{ background: `conic-gradient(${GREEN_LIGHT} 0 25%,#f0b44c 0 50%,#e06a5a 0 75%,#5aa9f0 0)` }} />
          </BeerBtn>
          {beers.map((b) => (
            <BeerBtn key={b.product} on={beer === b.product} onClick={() => setBeer(b.product)} name={b.name}>
              <CanPic src={b.can} name={b.name} />
            </BeerBtn>
          ))}
        </div>

        <div className="flex flex-wrap gap-2">
          <Seg label="Cans or draft" value={fmt} onChange={setFmt} options={[["all", "Cans & draft"], ["can", "Cans"], ["draft", "On tap"]]} />
          <Seg label="Kind of place" value={typ} onChange={setTyp} options={[["all", "Everywhere"], ["store", "Stores (to go)"], ["bar", "Bars & restaurants"]]} />
        </div>

        <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_380px]">
          <div className="relative h-[320px] overflow-hidden rounded-2xl border md:h-[600px]" style={{ borderColor: LINE }}>
            <PubMap rows={rows} center={center} radius={radius} sel={sel} onSelect={setSel} />
            <div className="pointer-events-none absolute bottom-2 left-2 z-[500] flex gap-3 rounded-lg border bg-white/95 px-2.5 py-1.5 text-[12px]" style={{ borderColor: LINE }}>
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
          <div className="flex max-h-[460px] min-h-0 flex-col rounded-2xl border md:max-h-[600px]" style={{ borderColor: LINE }}>
            <div className="flex items-center justify-between gap-2 border-b px-3.5 py-2.5" style={{ borderColor: LINE }}>
              <b className="text-[15px]">
                {rows.length} place{rows.length === 1 ? "" : "s"}
              </b>
              <span className="text-[12.5px]" style={{ color: MUTE }}>
                {center ? `Within ${radius} mi of ${center.name}` : "Search to see the closest"}
              </span>
            </div>
            <div className="flex flex-col gap-2 overflow-y-auto p-2">
              {rows.length === 0 && (
                <p className="p-6 text-center text-[14px]" style={{ color: MUTE }}>
                  Nothing matches yet — try a bigger distance, a different beer, or “Everywhere”.
                </p>
              )}
              {rows.map((r) => (
                <Card key={r.p.id} r={r} nameOf={nameOf} sel={sel === r.p.id} onClick={() => setSel(r.p.id)} />
              ))}
            </div>
          </div>
        </div>
        <p className="text-[12px]" style={{ color: MUTE }}>
          Based on recent deliveries — please call ahead to make sure it&apos;s in stock. Map ©{" "}
          <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener noreferrer" className="underline">
            OpenStreetMap
          </a>{" "}
          contributors.
        </p>
      </div>
    </div>
  );
}

function BeerBtn({ on, onClick, name, children }: { on: boolean; onClick: () => void; name: string; children: React.ReactNode }) {
  return (
    <button
      type="button"
      aria-pressed={on}
      onClick={onClick}
      className="flex w-[92px] shrink-0 flex-col items-center gap-1 rounded-xl border-2 px-1.5 py-2 text-center text-[12px] font-semibold leading-tight"
      style={on ? { borderColor: GREEN, background: "#eef7ea" } : { borderColor: LINE, background: "#fff" }}
    >
      {children}
      <span className="line-clamp-2">{name}</span>
    </button>
  );
}

function Card({ r, nameOf, sel, onClick }: { r: Row; nameOf: (p: string) => string; sel: boolean; onClick: () => void }) {
  const p = r.p;
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (sel) ref.current?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, [sel]);
  const phone = phoneText(p.phone);
  const line = [p.address && tidyName(p.address), p.city && tidyName(p.city), [p.state || "CA", p.zip].filter(Boolean).join(" ")].filter(Boolean).join(", ");
  return (
    <div
      ref={ref}
      role="button"
      tabIndex={0}
      onClick={onClick}
      onKeyDown={(e) => e.key === "Enter" && onClick()}
      className="cursor-pointer rounded-xl border-2 px-3 py-2.5"
      style={sel ? { borderColor: GREEN, background: "#f4faf1" } : { borderColor: LINE, background: "#fff" }}
    >
      <div className="flex items-start justify-between gap-2">
        <span className="text-[15px] font-bold leading-snug">{placeName(p)}</span>
        {r.d != null && <span className="shrink-0 text-[13px] font-bold" style={{ color: GREEN }}>{r.d.toFixed(1)} mi</span>}
      </div>
      <div className="text-[13px]" style={{ color: MUTE }}>{line}</div>
      <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
        <span className="rounded-full px-2 py-0.5 text-[11.5px] font-bold" style={{ color: p.bar ? "#9a5a08" : "#1d5d9e", background: p.bar ? "#fdf1df" : "#e6f0fb" }}>
          {p.bar ? "Bar / restaurant" : "Store · to go"}
        </span>
      </div>
      <div className="mt-1.5 flex flex-wrap gap-1">
        {r.items.map((i) => (
          <span key={i.p + i.s} className="rounded-full border px-2 py-0.5 text-[12.5px]" style={{ borderColor: LINE }}>
            {nameOf(i.p)} <span style={{ color: MUTE }}>· {isDraft(i.s) ? "on tap" : packageLabel(i.s)}</span>
          </span>
        ))}
      </div>
      <div className="mt-2 flex flex-wrap gap-2">
        <a href={directions(p)} target="_blank" rel="noopener noreferrer" onClick={(e) => e.stopPropagation()} className="rounded-full px-3 py-1 text-[12.5px] font-bold text-white" style={{ background: GREEN }}>
          Directions
        </a>
        {phone && (
          <a href={`tel:${phone.replace(/[^\d+]/g, "")}`} onClick={(e) => e.stopPropagation()} className="rounded-full border px-3 py-1 text-[12.5px] font-bold" style={{ borderColor: LINE, color: INK }}>
            Call {phone}
          </a>
        )}
      </div>
    </div>
  );
}

function PubMap({ rows, center, radius, sel, onSelect }: { rows: Row[]; center: { at: [number, number]; name: string } | null; radius: number; sel: string | null; onSelect: (id: string) => void }) {
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
      // No scroll-wheel zoom: inside a website the wheel should scroll the page.
      map.current = Lf.map(el.current, { center: [36.75, -119.78], zoom: 8, scrollWheelZoom: false });
      Lf.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
        maxZoom: 19,
        attribution: '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a>',
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

  const key = rows.map((r) => r.p.id).join(",") + (center ? center.at.join(",") + radius : "");
  useEffect(() => {
    const Lf = L.current;
    if (!ready || !Lf || !map.current || !layer.current) return;
    layer.current.clearLayers();
    const pts: [number, number][] = [];
    for (const r of rows) {
      const at: [number, number] = [r.p.lat, r.p.lng];
      pts.push(at);
      const m = Lf.circleMarker(at, { radius: 7, weight: 2, color: "#ffffff", fillColor: r.p.bar ? BAR : STORE, fillOpacity: 1 });
      m.bindTooltip(placeName(r.p));
      m.on("click", () => onSelect(r.p.id));
      (m as unknown as { _bfId: string })._bfId = r.p.id;
      m.addTo(layer.current);
    }
    if (center) {
      Lf.circle(center.at, { radius: radius * 1609.34, color: GREEN, weight: 1.5, dashArray: "6 6", fillOpacity: 0.04 }).addTo(layer.current);
      map.current.fitBounds(Lf.latLng(center.at).toBounds(radius * 1609.34 * 2), { padding: [16, 16] });
    } else if (pts.length) {
      map.current.fitBounds(Lf.latLngBounds(pts), { padding: [24, 24], maxZoom: 13 });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `key` stands in for rows/center/radius
  }, [ready, key]);

  useEffect(() => {
    if (!ready || !layer.current || !map.current) return;
    layer.current.eachLayer((ly) => {
      const id = (ly as unknown as { _bfId?: string })._bfId;
      if (!id) return;
      const m = ly as import("leaflet").CircleMarker;
      const on = id === sel;
      m.setStyle({ radius: on ? 11 : 7, weight: on ? 3 : 2, color: on ? INK : "#ffffff" });
      if (on) {
        m.bringToFront();
        if (!map.current!.getBounds().contains(m.getLatLng())) map.current!.panTo(m.getLatLng());
      }
    });
  }, [ready, sel, key]);

  return <div ref={el} className="h-full w-full" style={{ background: "#eef1ef" }} />;
}
