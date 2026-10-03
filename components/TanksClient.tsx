"use client";

// Tanks (added 2026-10-03, per Chad) — a 3D "x-ray" view of every FCB
// unitank, in the real cellar layout, at true size. Design notes and every
// decision: claude/tank-view-direction.md and claude/tank-floor-layout.md
// (project docs). Approved preview: "FCB Tanks Preview" artifact.
//
// - Full tank  = see-through glass + soft-green wireframe + colored liquid at
//   its real level (cone fills first, then the straight wall). Fermenting
//   tanks show a churning foam layer with popping bubbles and CO2 bubbles
//   rising through the beer.
// - Empty tank = solid brushed stainless (Chad: "if a tank is empty, i dont
//   want it to be wireframe, i want it to be solid").
// - Click a tank → details card (product, level, Status, Batch, and the
//   "See Batch Details" button — it does nothing yet; later it opens the
//   batch's tasks).
//
// DATA: until the Ekos tank sync is built, the tank list + levels below are
// the snapshot from the Ekos tank map Chad shared on 2026-10-03, and every
// full tank's status is a sample ("Fermenting"). When the sync lands, only
// TANKS (and status) need to come from the database — the 3D code stays.

import { useEffect, useRef, useState } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { RoomEnvironment } from "three/examples/jsm/environments/RoomEnvironment.js";

// ---------- Real tank sizes (inches). Scene units = feet. ----------
// 7 + 30 bbl: G.W. Kent unitank spec sheets. 60 bbl: Allied Beverage Tanks
// FV-60BBL. Swap in FCB's own measurements if Chad gives them.
const SIZES: Record<number, { dia: number; h: number }> = {
  7: { dia: 43.5, h: 95 },
  30: { dia: 63, h: 157.5 },
  60: { dia: 68.9, h: 173.8 },
};

type Status = "Fermenting" | "Conditioning" | "Ready" | "Empty";

interface TankSpec {
  name: string;
  bbl: 7 | 30 | 60;
  px: number; // circle center on the Ekos tank map (x)
  py: number; // circle center on the Ekos tank map (y)
  vol?: number; // bbl in the tank
  code?: string; // Ekos product code
  batch?: string;
  color?: string; // Ekos map color
}

// Cellar layout + contents, from the Ekos tank map (2026-10-03 snapshot).
const TANKS: TankSpec[] = [
  { name: "FV06", bbl: 60, px: 67, py: 85 },
  { name: "FV05", bbl: 30, px: 190, py: 80, vol: 9.657629, code: "CHZY", batch: "#1299 Captain Hazy", color: "#2B5FDC" },
  { name: "FV04", bbl: 30, px: 299, py: 78 },
  { name: "FV03", bbl: 30, px: 409, py: 80, vol: 14.12, code: "CHZY", batch: "#1303 15bbl hazy", color: "#2563EB" },
  { name: "FV02", bbl: 30, px: 518, py: 78, vol: 17.368684, code: "PV", batch: "1298 Peachy Vibes", color: "#EF9A9A" },
  { name: "FV01", bbl: 30, px: 629, py: 80, vol: 9.899968, code: "BDIPA", batch: "1301 BDIPA", color: "#B5D6A7" },
  { name: "CID-1", bbl: 7, px: 760, py: 68, vol: 7, code: "BDIPA", batch: "1301 BDIPA 1", color: "#B5D6A7" },
  { name: "CID-2", bbl: 7, px: 838, py: 68, vol: 4.5, code: "LTL", batch: "#1302 Lime 30.1", color: "#22DD22" },
  { name: "CID-3", bbl: 7, px: 917, py: 68, vol: 6, code: "THC", batch: "CID021", color: "#00EEEE" },
  { name: "FV11", bbl: 60, px: 133, py: 208 },
  { name: "FV10", bbl: 60, px: 265, py: 207 },
  { name: "FV9", bbl: 60, px: 445, py: 212 },
  { name: "FV08", bbl: 60, px: 577, py: 212 },
  { name: "FV07", bbl: 30, px: 704, py: 205, vol: 22.548387, code: "VICTOR", batch: "#1302 Lime 30", color: "#C8F000" },
  { name: "FV18", bbl: 30, px: 815, py: 203 },
  { name: "FV17", bbl: 60, px: 131, py: 343 },
  { name: "FV14", bbl: 60, px: 263, py: 342 },
  { name: "FV13", bbl: 60, px: 394, py: 345 },
  { name: "FV12", bbl: 60, px: 523, py: 345 },
  { name: "FV16", bbl: 30, px: 646, py: 337, vol: 18.662471, code: "NPT", batch: "1295", color: "#FFAE6B" },
  { name: "FV15", bbl: 60, px: 767, py: 340 },
];
// Map px → feet. 0.135 = the spacing Chad approved (≈11 ft between tanks).
const FT_PER_PX = 0.135;
const CX = 490;
const CZ = 210;

const STATUS_PILL: Record<Status, { bg: string; fg: string }> = {
  Fermenting: { bg: "rgba(255,153,0,0.16)", fg: "#FFC266" },
  Conditioning: { bg: "rgba(51,153,255,0.16)", fg: "#8EC3FF" },
  Ready: { bg: "rgba(106,188,70,0.16)", fg: "#A6DC8B" },
  Empty: { bg: "rgba(255,255,255,0.07)", fg: "#A3ADA8" },
};

// Bubble amounts Chad tuned on the preview.
const POP_N = 420;
const RISE_N = 240;
const STREAMS = 7;
const INSET = 0.975;

interface TankInfo {
  name: string;
  capacity: number;
  volume: number;
  status: Status;
  code: string;
  batch: string;
  color: string;
}

interface TankRuntime extends TankInfo {
  spec: TankSpec;
  Rft: number;
  TIP: number;
  group: THREE.Group;
  hover: number;
  shownFrac: number;
  foamLevel: number;
  liquidLevel: number;
  heightFor: (frac: number) => number;
  radiusAt: (y: number) => number;
  buildLiquid: (y: number) => void;
  liquid: THREE.Mesh<THREE.BufferGeometry, THREE.MeshStandardMaterial>;
  liquidMat: THREE.MeshStandardMaterial;
  surface: THREE.Mesh;
  surfMat: THREE.MeshStandardMaterial;
  foam: THREE.Mesh;
  foamTop: THREE.Mesh;
  foamTopGeo: THREE.RingGeometry;
  foamBase: Float32Array;
  pops: THREE.InstancedMesh;
  popState: { a: number; r: number; life: number; dur: number; size: number }[];
  rising: THREE.Points;
  riseGeo: THREE.BufferGeometry;
  risePos: Float32Array;
  streams: { a: number; r: number }[];
  riseState: { s: number; y: number; v: number; w: number }[];
  shell: THREE.Mesh;
  shellMat: THREE.ShaderMaterial;
  wire: THREE.LineSegments;
  lineMat: THREE.LineBasicMaterial;
  bands: THREE.Mesh[];
  solid: THREE.Mesh;
  solidMat: THREE.MeshStandardMaterial;
  solidBands: THREE.Group;
  plateCanvas: HTMLCanvasElement;
  plateTex: THREE.CanvasTexture;
}

const SHELL_VS = `varying vec3 vN; varying vec3 vV;
  void main(){ vec4 mv = modelViewMatrix*vec4(position,1.0); vN = normalize(normalMatrix*normal); vV = normalize(-mv.xyz); gl_Position = projectionMatrix*mv; }`;
const SHELL_FS = `uniform vec3 uColor; uniform vec3 uGlow; uniform float uHover; varying vec3 vN; varying vec3 vV;
  void main(){ float f = pow(1.0 - abs(dot(normalize(vN), normalize(vV))), 2.2);
    vec3 c = mix(uColor, uGlow, 0.35 + 0.25*uHover);
    float a = 0.05 + f*(0.42 + 0.25*uHover);
    gl_FragColor = vec4(c, a); }`;

function roundRect(g: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  g.beginPath();
  g.moveTo(x + r, y);
  g.arcTo(x + w, y, x + w, y + h, r);
  g.arcTo(x + w, y + h, x, y + h, r);
  g.arcTo(x, y + h, x, y, r);
  g.arcTo(x, y, x + w, y, r);
  g.closePath();
}

// Foam height at a point on the foam top (x,y = -1..1), churning over time.
function foamH(x: number, y: number, tm: number) {
  const r = Math.hypot(x, y);
  const a = Math.atan2(y, x);
  const edge = Math.min(1, Math.max(0, (1 - r) * 5));
  const h =
    0.045 * Math.sin(a * 5 + tm * 1.4 + r * 7) +
    0.032 * Math.sin(r * 13 - tm * 2.1 + a * 2) +
    0.022 * Math.sin(x * 17 + y * 11 + tm * 3.2);
  return (0.05 + h) * edge;
}

// Concrete floor texture, drawn in code (no image file).
function concreteTexture(maxAniso: number) {
  const N = 512;
  const c = document.createElement("canvas");
  c.width = c.height = N;
  const g = c.getContext("2d")!;
  g.fillStyle = "#6a6e6b";
  g.fillRect(0, 0, N, N);
  let seed = 7;
  const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  for (let i = 0; i < 260; i++) {
    const x = rnd() * N, y = rnd() * N, r = 20 + rnd() * 90, light = rnd() > 0.5;
    for (const [dx, dy] of [[0, 0], [N, 0], [-N, 0], [0, N], [0, -N]]) {
      const gr = g.createRadialGradient(x + dx, y + dy, 0, x + dx, y + dy, r);
      gr.addColorStop(0, light ? "rgba(255,255,255,0.025)" : "rgba(0,0,0,0.035)");
      gr.addColorStop(1, "rgba(0,0,0,0)");
      g.fillStyle = gr;
      g.fillRect(x + dx - r, y + dy - r, r * 2, r * 2);
    }
  }
  const img = g.getImageData(0, 0, N, N);
  const d = img.data;
  for (let i = 0; i < d.length; i += 4) {
    const n = (rnd() - 0.5) * 16;
    d[i] += n;
    d[i + 1] += n;
    d[i + 2] += n;
  }
  g.putImageData(img, 0, 0);
  for (let i = 0; i < 900; i++) {
    const x = rnd() * N, y = rnd() * N, r = 0.6 + rnd() * 1.4;
    g.fillStyle = rnd() > 0.5 ? "rgba(30,32,31,0.35)" : "rgba(210,212,208,0.25)";
    g.beginPath();
    g.arc(x, y, r, 0, Math.PI * 2);
    g.fill();
  }
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.encoding = THREE.sRGBEncoding;
  t.anisotropy = maxAniso;
  return t;
}

export default function TanksClient() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [selected, setSelected] = useState<TankInfo | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    let renderer: THREE.WebGLRenderer;
    try {
      renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
    } catch {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- one-time fallback when the browser can't start WebGL
      setFailed(true);
      return;
    }
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.outputEncoding = THREE.sRGBEncoding;
    const plateFont = getComputedStyle(canvas).fontFamily || "system-ui, sans-serif";
    const disposables: { dispose: () => void }[] = [];
    const track = <T extends { dispose: () => void }>(x: T) => {
      disposables.push(x);
      return x;
    };

    const scene = new THREE.Scene();
    scene.fog = new THREE.Fog(0x0b100e, 160, 340);
    const camera = new THREE.PerspectiveCamera(36, 1, 0.5, 900);
    camera.position.set(12, 68, 113);

    scene.add(new THREE.HemisphereLight(0xdfeee6, 0x0b100e, 0.6));
    const key = new THREE.DirectionalLight(0xffffff, 1.0);
    key.position.set(30, 50, 35);
    scene.add(key);
    const rim = new THREE.DirectionalLight(0x9fd88a, 0.35);
    rim.position.set(-35, 25, -30);
    scene.add(rim);

    // Concrete floor
    const floorTex = track(concreteTexture(renderer.capabilities.getMaxAnisotropy()));
    floorTex.repeat.set(700 / 14, 700 / 14);
    const floor = new THREE.Mesh(
      track(new THREE.PlaneGeometry(700, 700)),
      track(new THREE.MeshStandardMaterial({ map: floorTex, color: 0x5c605e, roughness: 0.92, metalness: 0 })),
    );
    floor.rotation.x = -Math.PI / 2;
    scene.add(floor);

    // Soft round shadow under each tank
    const sc = document.createElement("canvas");
    sc.width = sc.height = 256;
    const sg = sc.getContext("2d")!;
    const sgr = sg.createRadialGradient(128, 128, 0, 128, 128, 128);
    sgr.addColorStop(0, "rgba(0,0,0,0.55)");
    sgr.addColorStop(1, "rgba(0,0,0,0)");
    sg.fillStyle = sgr;
    sg.fillRect(0, 0, 256, 256);
    const shadowTex = track(new THREE.CanvasTexture(sc));

    // Green ring under the selected tank
    const ringMat = track(new THREE.MeshBasicMaterial({ color: 0x6abc46, transparent: true, opacity: 0, depthWrite: false, side: THREE.DoubleSide }));
    const ring = new THREE.Mesh(track(new THREE.RingGeometry(1.45, 1.52, 96)), ringMat);
    ring.rotation.x = -Math.PI / 2;
    ring.position.y = 0.04;
    scene.add(ring);

    // Studio reflections for the solid stainless (empty) tanks only
    const pmrem = new THREE.PMREMGenerator(renderer);
    const steelEnv = track(pmrem.fromScene(new RoomEnvironment(), 0.04).texture);
    pmrem.dispose();

    // Shared materials / geometry
    const steel = track(new THREE.MeshStandardMaterial({ color: 0xa9b4ae, metalness: 0.85, roughness: 0.32 }));
    const steelDark = track(new THREE.MeshStandardMaterial({ color: 0x6f7a74, metalness: 0.8, roughness: 0.4 }));
    const bandMat = track(new THREE.MeshBasicMaterial({ color: 0x8fd16e, transparent: true, opacity: 0.1, depthWrite: false, side: THREE.DoubleSide }));
    const foamMat = track(new THREE.MeshStandardMaterial({ color: 0xf3ead2, roughness: 0.9, transparent: true, opacity: 0.55, depthWrite: false }));
    const popMat = track(new THREE.MeshStandardMaterial({ color: 0xfffbef, roughness: 0.15, metalness: 0, transparent: true, opacity: 0.55, emissive: 0x3a3528, depthWrite: false }));
    const seamMat = track(new THREE.MeshStandardMaterial({ color: 0x8d968f, metalness: 0.8, roughness: 0.4, envMap: steelEnv, envMapIntensity: 0.7 }));
    const popGeo = track(new THREE.SphereGeometry(1, 10, 8));

    const pickables: THREE.Object3D[] = [];
    const reduce = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;

    // One tank = the approved example tank, with only its straight wall
    // stretched so overall height + diameter match the real size. Built at
    // radius 1, then scaled by the real radius in feet.
    function makeTank(spec: TankSpec): TankRuntime {
      const S = SIZES[spec.bbl];
      const Rft = S.dia / 2 / 12;
      const Hft = S.h / 12;
      const R = 1, TIP = 0.75, CONE = 1.15, DOME = 0.42, LID = 0.15;
      const CYL = Hft / Rft - (TIP + CONE + DOME + LID);
      const Y_CONE = TIP + CONE, Y_CYL = Y_CONE + CYL, Y_TOP = Y_CYL + DOME;

      const group = new THREE.Group();
      group.position.set((spec.px - CX) * FT_PER_PX, 0, (spec.py - CZ) * FT_PER_PX);
      group.scale.setScalar(Rft);
      scene.add(group);

      const profile: THREE.Vector2[] = [new THREE.Vector2(0.09, TIP - 0.02), new THREE.Vector2(0.12, TIP)];
      for (let i = 1; i <= 6; i++) { const k = i / 6; profile.push(new THREE.Vector2(0.12 + (R - 0.12) * k, TIP + CONE * k)); }
      for (let i = 1; i <= 8; i++) profile.push(new THREE.Vector2(R, Y_CONE + (CYL * i) / 8));
      for (let i = 1; i <= 10; i++) { const a = (i / 10) * Math.PI / 2; profile.push(new THREE.Vector2(Math.max(R * Math.cos(a), 0.001), Y_CYL + DOME * Math.sin(a))); }

      // Liquid level from volume: real cone + cylinder volume (dome = headspace)
      const vCone = (Math.PI * R * R * CONE) / 3;
      const vCap = vCone + Math.PI * R * R * CYL;
      const heightFor = (frac: number) => {
        const v = Math.max(0, Math.min(1, frac)) * vCap;
        return v <= vCone ? TIP + CONE * Math.cbrt(v / vCone) : Y_CONE + (v - vCone) / (Math.PI * R * R);
      };
      const radiusAt = (y: number) => (y <= TIP ? 0.12 : y <= Y_CONE ? 0.12 + ((R - 0.12) * (y - TIP)) / CONE : R);

      const shadow = new THREE.Mesh(track(new THREE.PlaneGeometry(3.4, 3.4)), track(new THREE.MeshBasicMaterial({ map: shadowTex, transparent: true, depthWrite: false })));
      shadow.rotation.x = -Math.PI / 2;
      shadow.position.y = 0.025 / Rft;
      group.add(shadow);

      // Liquid, foam, bubbles
      const liquidMat = track(new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.35, metalness: 0, transparent: true, opacity: 0.88, depthWrite: false }));
      const liquid = new THREE.Mesh(new THREE.BufferGeometry(), liquidMat);
      liquid.renderOrder = 1;
      group.add(liquid);
      const surfMat = track(new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.2, transparent: true, opacity: 0.95 }));
      const surface = new THREE.Mesh(track(new THREE.CircleGeometry(1, 64)), surfMat);
      surface.rotation.x = -Math.PI / 2;
      surface.renderOrder = 2;
      group.add(surface);
      const foam = new THREE.Mesh(track(new THREE.CylinderGeometry(1, 1, 1, 64, 1, true)), foamMat);
      foam.renderOrder = 2;
      group.add(foam);
      const foamTopGeo = track(new THREE.RingGeometry(0.0001, 1, 72, 14));
      const foamBase = (foamTopGeo.attributes.position.array as Float32Array).slice();
      const foamTop = new THREE.Mesh(foamTopGeo, foamMat);
      foamTop.rotation.x = -Math.PI / 2;
      foamTop.renderOrder = 2;
      group.add(foamTop);
      const pops = new THREE.InstancedMesh(popGeo, popMat, POP_N);
      pops.renderOrder = 2;
      pops.frustumCulled = false;
      const zero = new THREE.Matrix4().makeScale(0, 0, 0);
      for (let i = 0; i < POP_N; i++) pops.setMatrixAt(i, zero);
      group.add(pops);
      const riseGeo = track(new THREE.BufferGeometry());
      const risePos = new Float32Array(RISE_N * 3);
      riseGeo.setAttribute("position", new THREE.BufferAttribute(risePos, 3));
      const rising = new THREE.Points(riseGeo, track(new THREE.PointsMaterial({ color: 0xfffbe8, size: 0.045 * Rft, sizeAttenuation: true, transparent: true, opacity: 0.7, depthWrite: false })));
      rising.renderOrder = 1.5;
      rising.frustumCulled = false;
      group.add(rising);

      // X-ray glass shell
      const shellMat = track(new THREE.ShaderMaterial({
        transparent: true, depthWrite: false, side: THREE.DoubleSide,
        uniforms: { uColor: { value: new THREE.Color(0xcfe6d8) }, uGlow: { value: new THREE.Color(0x8fd16e) }, uHover: { value: 0 } },
        vertexShader: SHELL_VS, fragmentShader: SHELL_FS,
      }));
      const shellGeo = track(new THREE.LatheGeometry(profile, 96));
      const shell = new THREE.Mesh(shellGeo, shellMat);
      shell.renderOrder = 3;
      group.add(shell);
      pickables.push(shell);

      // Solid brushed stainless (empty tanks)
      const solidMat = track(new THREE.MeshStandardMaterial({ color: 0x9aa39e, metalness: 0.85, roughness: 0.3, envMap: steelEnv, envMapIntensity: 0.55, emissive: 0x6abc46, emissiveIntensity: 0, side: THREE.DoubleSide }));
      const solid = new THREE.Mesh(shellGeo, solidMat);
      group.add(solid);
      pickables.push(solid);
      const solidBands = new THREE.Group();
      const seamGeo = track(new THREE.CylinderGeometry(R * 1.006, R * 1.006, 0.03, 72, 1, true));
      for (const f of [0.12, 0.36, 0.59, 0.84]) {
        const seam = new THREE.Mesh(seamGeo, seamMat);
        seam.position.y = Y_CONE + CYL * f;
        solidBands.add(seam);
      }
      group.add(solidBands);

      // Wireframe
      const lineMat = track(new THREE.LineBasicMaterial({ color: 0x8fd16e, transparent: true, opacity: 0.32, depthWrite: false }));
      const seg: number[] = [];
      for (let m = 0; m < 24; m++) {
        const a = (m / 24) * Math.PI * 2, s = Math.sin(a), c = Math.cos(a);
        for (let i = 1; i < profile.length; i++) {
          const p0 = profile[i - 1], p1 = profile[i];
          seg.push(p0.x * s, p0.y, p0.x * c, p1.x * s, p1.y, p1.x * c);
        }
      }
      for (const y of [TIP, TIP + CONE * 0.5, Y_CONE, Y_CONE + CYL * 0.25, Y_CONE + CYL * 0.5, Y_CONE + CYL * 0.75, Y_CYL, Y_CYL + DOME * 0.55]) {
        const r = y <= Y_CYL ? radiusAt(y) : R * Math.cos(Math.asin(Math.min(1, (y - Y_CYL) / DOME)));
        for (let i = 0; i < 72; i++) {
          const a0 = (i / 72) * Math.PI * 2, a1 = ((i + 1) / 72) * Math.PI * 2;
          seg.push(r * Math.sin(a0), y, r * Math.cos(a0), r * Math.sin(a1), y, r * Math.cos(a1));
        }
      }
      const wireGeo = track(new THREE.BufferGeometry());
      wireGeo.setAttribute("position", new THREE.Float32BufferAttribute(seg, 3));
      const wire = new THREE.LineSegments(wireGeo, lineMat);
      wire.renderOrder = 4;
      group.add(wire);

      // Glycol jacket bands (glass version)
      const bands: THREE.Mesh[] = [];
      for (const [a, b] of [[0.12, 0.36], [0.59, 0.84]]) {
        const band = new THREE.Mesh(track(new THREE.CylinderGeometry(R * 1.012, R * 1.012, CYL * (b - a), 72, 1, true)), bandMat);
        band.position.y = Y_CONE + (CYL * (a + b)) / 2;
        band.renderOrder = 3;
        group.add(band);
        bands.push(band);
      }

      // Steel: legs, outlet, valves, racking arm, manway, CIP arm, thermowell
      const legTop = Y_CONE + 0.25;
      const legGeo = track(new THREE.CylinderGeometry(0.045, 0.045, legTop, 16));
      const footGeo = track(new THREE.CylinderGeometry(0.11, 0.12, 0.04, 20));
      const padGeo = track(new THREE.BoxGeometry(0.14, 0.32, 0.05));
      for (let i = 0; i < 4; i++) {
        const a = Math.PI / 4 + (i * Math.PI) / 2, x = Math.sin(a) * R * 1.03, z = Math.cos(a) * R * 1.03;
        const leg = new THREE.Mesh(legGeo, steel);
        leg.position.set(x, legTop / 2, z);
        group.add(leg);
        pickables.push(leg);
        const foot = new THREE.Mesh(footGeo, steelDark);
        foot.position.set(x, 0.02, z);
        group.add(foot);
        const pad = new THREE.Mesh(padGeo, steel);
        pad.position.set(x * 0.985, legTop - 0.12, z * 0.985);
        pad.lookAt(0, legTop - 0.12, 0);
        group.add(pad);
      }
      const add = (geo: THREE.BufferGeometry, mat: THREE.Material, x: number, y: number, z: number, rx = 0, rz = 0) => {
        const m = new THREE.Mesh(track(geo), mat);
        m.position.set(x, y, z);
        m.rotation.x = rx;
        m.rotation.z = rz;
        group.add(m);
      };
      add(new THREE.CylinderGeometry(0.06, 0.06, 0.42, 16), steel, 0, TIP - 0.22, 0);
      add(new THREE.CylinderGeometry(0.11, 0.11, 0.06, 20), steelDark, 0, TIP - 0.3, 0);
      add(new THREE.BoxGeometry(0.34, 0.025, 0.05), steel, 0.15, TIP - 0.25, 0);
      const rackY = TIP + CONE * 0.55, rackR = radiusAt(rackY);
      add(new THREE.CylinderGeometry(0.05, 0.05, 0.42, 16), steel, rackR + 0.17, rackY, 0, 0, Math.PI / 2);
      add(new THREE.CylinderGeometry(0.09, 0.09, 0.05, 20), steelDark, rackR + 0.36, rackY, 0, 0, Math.PI / 2);
      add(new THREE.CylinderGeometry(0.022, 0.022, 0.16, 10), steel, -0.55, Y_CONE + 0.6, Math.sqrt(R * R - 0.55 * 0.55) + 0.07, Math.PI / 2);
      add(new THREE.CylinderGeometry(0.24, 0.24, 0.14, 32), steel, 0, Y_TOP + 0.04, 0);
      add(new THREE.CylinderGeometry(0.27, 0.27, 0.04, 32), steelDark, 0, Y_TOP + 0.13, 0);
      add(new THREE.CylinderGeometry(0.045, 0.045, 0.42, 12), steel, 0.55, Y_CYL + 0.33, 0.1);
      add(new THREE.CylinderGeometry(0.045, 0.045, 0.3, 12), steel, 0.7, Y_CYL + 0.54, 0.1, 0, Math.PI / 2);
      add(new THREE.CylinderGeometry(0.03, 0.03, 0.18, 10), steelDark, -R - 0.07, Y_CONE + CYL * 0.45, 0, 0, Math.PI / 2);

      // Curved label plate on the front
      const plateCanvas = document.createElement("canvas");
      plateCanvas.width = 640;
      plateCanvas.height = 300;
      const plateTex = track(new THREE.CanvasTexture(plateCanvas));
      plateTex.encoding = THREE.sRGBEncoding;
      plateTex.anisotropy = 4;
      const plate = new THREE.Mesh(track(new THREE.CylinderGeometry(R * 1.03, R * 1.03, 0.66, 48, 1, true, -0.5, 1.0)), track(new THREE.MeshBasicMaterial({ map: plateTex, transparent: true })));
      plate.position.y = Y_CONE + CYL * 0.62;
      plate.renderOrder = 5;
      group.add(plate);
      pickables.push(plate);

      const volume = spec.vol ?? 0;
      const t: TankRuntime = {
        spec, name: spec.name, capacity: spec.bbl, volume,
        status: volume > 0.05 ? "Fermenting" : "Empty",
        code: spec.code ?? "", batch: spec.batch ?? "", color: spec.color ?? "#888888",
        Rft, TIP, group, hover: 0, shownFrac: volume / spec.bbl, foamLevel: 0, liquidLevel: 0,
        heightFor, radiusAt, buildLiquid: () => {},
        liquid, liquidMat, surface, surfMat, foam, foamTop, foamTopGeo, foamBase, pops,
        popState: Array.from({ length: POP_N }, () => ({ a: 0, r: 0, life: Math.random() * 2.5, dur: 1, size: 0.03 })),
        rising, riseGeo, risePos,
        streams: Array.from({ length: STREAMS }, (_, i) => ({ a: (i / STREAMS) * Math.PI * 2 + Math.random() * 0.5, r: 0.15 + Math.random() * 0.55 })),
        riseState: Array.from({ length: RISE_N }, (_, i) => ({ s: i % STREAMS, y: TIP + Math.random() * (CYL + CONE), v: 0.35 + Math.random() * 0.35, w: Math.random() * 6 })),
        shell, shellMat, wire, lineMat, bands, solid, solidMat, solidBands, plateCanvas, plateTex,
      };
      t.buildLiquid = (y: number) => {
        const pts = [new THREE.Vector2(0.001, TIP), new THREE.Vector2(0.11 * INSET, TIP)];
        for (let i = 1; i <= 40; i++) { const yy = TIP + ((y - TIP) * i) / 40; pts.push(new THREE.Vector2(radiusAt(yy) * INSET, yy)); }
        t.liquid.geometry.dispose();
        t.liquid.geometry = new THREE.LatheGeometry(pts, 72);
        const r = radiusAt(y) * INSET;
        surface.position.y = y;
        surface.scale.set(r, r, 1);
        const fh = 0.14;
        t.foamLevel = y + fh;
        t.liquidLevel = y;
        foam.position.y = y + fh / 2;
        foam.scale.set(r * 0.995, fh, r * 0.995);
        foamTop.position.y = y + fh;
        foamTop.scale.set(r * 0.995, r * 0.995, 1);
      };
      for (const o of [shell, solid, plate, ...group.children.filter((c) => pickables.includes(c))]) o.userData.tank = t;
      t.buildLiquid(heightFor(t.shownFrac));
      return t;
    }

    function drawPlate(t: TankRuntime) {
      const g = t.plateCanvas.getContext("2d")!;
      const W = 640, H = 300, full = t.volume > 0.05;
      g.clearRect(0, 0, W, H);
      g.fillStyle = "rgba(236,242,238,0.94)";
      roundRect(g, 6, 6, W - 12, H - 12, 30);
      g.fill();
      g.fillStyle = "#0D1210";
      g.font = `700 92px ${plateFont}`;
      g.textBaseline = "alphabetic";
      g.fillText(t.name, 40, 112);
      if (full) {
        g.fillStyle = t.color;
        roundRect(g, 42, 146, 30, 30, 8);
        g.fill();
      }
      g.fillStyle = full ? "#1d2621" : "#7a857f";
      g.font = `600 40px ${plateFont}`;
      const label = full ? `${t.code} · ${t.batch}` : "Empty";
      let bn = label;
      while (g.measureText(bn).width > W - 140 && bn.length > 4) bn = bn.slice(0, -2);
      if (bn !== label) bn = bn.trim() + "…";
      g.fillText(bn, full ? 88 : 40, 174);
      g.fillStyle = "#4a5650";
      g.font = '500 38px ui-monospace, "SFMono-Regular", Consolas, monospace';
      g.fillText(`${t.volume.toFixed(1)} / ${t.capacity} bbl`, 40, 248);
      g.textAlign = "right";
      g.fillStyle = "#2f6f19";
      g.font = '700 46px ui-monospace, "SFMono-Regular", Consolas, monospace';
      g.fillText(`${Math.round((t.volume / t.capacity) * 100)}%`, W - 40, 250);
      g.textAlign = "left";
      t.plateTex.needsUpdate = true;
    }

    function applyLook(t: TankRuntime) {
      const col = new THREE.Color(t.color).convertSRGBToLinear();
      const full = t.volume > 0.05;
      t.liquidMat.color.copy(col);
      t.liquidMat.emissive.copy(col).multiplyScalar(0.22);
      t.surfMat.color.copy(col).offsetHSL(0, -0.05, 0.05);
      t.surfMat.emissive.copy(col).multiplyScalar(0.3);
      const ferm = full && t.status === "Fermenting";
      t.foam.visible = t.foamTop.visible = t.pops.visible = t.rising.visible = ferm;
      t.surface.visible = full;
      t.liquid.visible = full;
      // Empty = solid stainless; full = x-ray glass + wireframe
      t.solid.visible = t.solidBands.visible = !full;
      t.shell.visible = t.wire.visible = full;
      t.bands.forEach((b) => (b.visible = full));
    }

    const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _v = new THREE.Vector3(), _s = new THREE.Vector3();
    function animateFerment(t: TankRuntime, dt: number, tm: number) {
      const phase = tm + t.spec.px * 0.01;
      const pos = t.foamTopGeo.attributes.position.array as Float32Array;
      for (let i = 0; i < pos.length; i += 3) pos[i + 2] = foamH(t.foamBase[i], t.foamBase[i + 1], phase);
      t.foamTopGeo.attributes.position.needsUpdate = true;
      t.foamTopGeo.computeVertexNormals();
      const fr = t.radiusAt(t.liquidLevel) * INSET * 0.995;
      for (let i = 0; i < POP_N; i++) {
        const p = t.popState[i];
        p.life += dt;
        if (p.life >= p.dur) {
          p.a = Math.random() * Math.PI * 2;
          p.r = Math.sqrt(Math.random()) * 0.85;
          p.life = 0;
          p.dur = 0.5 + Math.random();
          p.size = 0.014 + Math.random() * 0.03;
        }
        const k = p.life / p.dur;
        const sz = k < 0.8 ? p.size * (0.2 + k) : p.size * (1.0 + (k - 0.8) * 2.5) * Math.max(0, 1 - (k - 0.8) / 0.2);
        const lx = Math.cos(p.a) * p.r, ly = Math.sin(p.a) * p.r;
        const top = t.foamLevel + foamH(lx, -ly, phase);
        _v.set(lx * fr, top + sz * (k < 0.8 ? 0.15 + k * 0.5 : 0.55), ly * fr);
        _s.set(sz, sz * 0.9, sz);
        _m.compose(_v, _q, _s);
        t.pops.setMatrixAt(i, _m);
      }
      t.pops.instanceMatrix.needsUpdate = true;
      for (let i = 0; i < RISE_N; i++) {
        const b = t.riseState[i], st = t.streams[b.s];
        b.y += b.v * dt;
        if (b.y > t.liquidLevel - 0.02) {
          b.y = t.TIP + 0.15 + Math.random() * 0.6;
          b.v = 0.35 + Math.random() * 0.35;
        }
        const rr = Math.min(st.r, t.radiusAt(b.y) * 0.85);
        t.risePos[i * 3] = Math.cos(st.a) * rr + 0.03 * Math.sin(tm * 3 + b.w + b.y * 4);
        t.risePos[i * 3 + 1] = b.y;
        t.risePos[i * 3 + 2] = Math.sin(st.a) * rr + 0.03 * Math.cos(tm * 2.5 + b.w);
      }
      t.riseGeo.attributes.position.needsUpdate = true;
    }

    const tanks = TANKS.map(makeTank);
    tanks.forEach((t) => {
      applyLook(t);
      drawPlate(t);
      if (t.foam.visible) animateFerment(t, 0.016, 0);
    });
    document.fonts?.ready.then(() => tanks.forEach(drawPlate));

    // Selection
    let selectedTank: TankRuntime | null = null;
    const select = (t: TankRuntime | null) => {
      selectedTank = t;
      if (t) {
        ring.position.set(t.group.position.x, 0.04, t.group.position.z);
        ring.scale.setScalar(t.Rft);
        setSelected({ name: t.name, capacity: t.capacity, volume: t.volume, status: t.status, code: t.code, batch: t.batch, color: t.color });
      } else {
        setSelected(null);
      }
    };

    // Camera controls: left-drag turns, right-drag slides, scroll zooms
    const controls = new OrbitControls(camera, canvas);
    controls.target.set(0, 4, 0);
    controls.enableDamping = true;
    controls.dampingFactor = 0.08;
    controls.minDistance = 6;
    controls.maxDistance = 260;
    controls.maxPolarAngle = 1.48;
    controls.minPolarAngle = 0.15;
    controls.enablePan = true;
    controls.screenSpacePanning = true;
    controls.panSpeed = 0.8;
    controls.mouseButtons = { LEFT: THREE.MOUSE.ROTATE, MIDDLE: THREE.MOUSE.DOLLY, RIGHT: THREE.MOUSE.PAN };
    controls.touches = { ONE: THREE.TOUCH.ROTATE, TWO: THREE.TOUCH.DOLLY_PAN };
    const PAN_MIN = new THREE.Vector3(-75, 0.5, -48), PAN_MAX = new THREE.Vector3(75, 16, 48);
    controls.addEventListener("change", () => {
      const tg = controls.target, before = tg.clone();
      tg.clamp(PAN_MIN, PAN_MAX);
      if (!tg.equals(before)) camera.position.add(tg.clone().sub(before));
    });

    // Hover + click
    const ray = new THREE.Raycaster(), mouse = new THREE.Vector2();
    let hovered: TankRuntime | null = null;
    let downAt: [number, number] | null = null;
    const hitTest = (e: PointerEvent): TankRuntime | null => {
      const r = canvas.getBoundingClientRect();
      mouse.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
      ray.setFromCamera(mouse, camera);
      const hit = ray.intersectObjects(pickables, false).find((h) => h.object.visible);
      return (hit?.object.userData.tank as TankRuntime | undefined) ?? null;
    };
    const onMove = (e: PointerEvent) => {
      hovered = hitTest(e);
      canvas.style.cursor = hovered ? "pointer" : "grab";
    };
    const onLeave = () => { hovered = null; };
    const onDown = (e: PointerEvent) => { downAt = [e.clientX, e.clientY]; };
    const onUp = (e: PointerEvent) => {
      if (!downAt) return;
      const moved = Math.hypot(e.clientX - downAt[0], e.clientY - downAt[1]);
      downAt = null;
      if (moved > 6) return;
      select(hitTest(e));
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") select(null); };
    canvas.addEventListener("pointermove", onMove);
    canvas.addEventListener("pointerleave", onLeave);
    canvas.addEventListener("pointerdown", onDown);
    canvas.addEventListener("pointerup", onUp);
    canvas.addEventListener("keydown", onKey);
    const closeHandler = () => select(null);
    window.addEventListener("fcb-tanks-close", closeHandler);

    // Resize
    const resize = () => {
      const w = canvas.clientWidth, h = canvas.clientHeight;
      if (!w || !h) return;
      renderer.setSize(w, h, false);
      camera.aspect = w / h;
      camera.fov = w < 600 ? 50 : 36;
      camera.updateProjectionMatrix();
    };
    const ro = new ResizeObserver(resize);
    ro.observe(canvas);
    resize();
    if (canvas.clientWidth < 600) camera.position.sub(controls.target).setLength(230).add(controls.target);

    // Loop
    const clock = new THREE.Clock();
    let raf = 0;
    const frame = () => {
      const dt = Math.min(clock.getDelta(), 0.05), tm = clock.elapsedTime;
      for (const t of tanks) {
        if (t.foam.visible && !reduce) animateFerment(t, dt, tm);
        const target = hovered === t ? 1 : 0;
        t.hover += (target - t.hover) * Math.min(1, dt * 10);
        t.shellMat.uniforms.uHover.value = t.hover;
        t.lineMat.opacity = 0.3 + 0.3 * t.hover + (selectedTank === t ? 0.12 : 0);
        t.solidMat.emissiveIntensity = 0.1 * t.hover + (selectedTank === t ? 0.05 : 0);
      }
      ringMat.opacity += ((selectedTank ? 0.6 : 0) - ringMat.opacity) * Math.min(1, dt * 8);
      controls.update();
      renderer.render(scene, camera);
      raf = requestAnimationFrame(frame);
    };
    frame();

    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      canvas.removeEventListener("pointermove", onMove);
      canvas.removeEventListener("pointerleave", onLeave);
      canvas.removeEventListener("pointerdown", onDown);
      canvas.removeEventListener("pointerup", onUp);
      canvas.removeEventListener("keydown", onKey);
      window.removeEventListener("fcb-tanks-close", closeHandler);
      controls.dispose();
      tanks.forEach((t) => t.liquid.geometry.dispose());
      disposables.forEach((d) => d.dispose());
      renderer.dispose();
    };
  }, []);

  const full = !!selected && selected.volume > 0.05;
  const pct = selected ? Math.round((selected.volume / selected.capacity) * 100) : 0;
  const pill = selected ? STATUS_PILL[selected.status] : STATUS_PILL.Empty;

  return (
    <div className="flex flex-col gap-5">
      <div>
        <h1 className="text-3xl font-semibold tracking-tight">Tanks</h1>
        <p className="mt-1 text-sm text-neutral-400">
          21 unitanks at true size, in the cellar layout. Levels from the Ekos tank map (Oct 3); status is sample until the
          tank sync is built.
        </p>
      </div>

      <section
        aria-label="3D tank view"
        className="relative overflow-hidden rounded-xl border border-neutral-800"
        style={{ height: "clamp(440px, 70vh, 780px)" }}
      >
        <canvas
          ref={canvasRef}
          tabIndex={0}
          aria-label="3D view of the FCB cellar's 21 fermenters. Drag to turn, right-click drag to slide, scroll to zoom, click a tank for details."
          className="absolute inset-0 block h-full w-full outline-none"
          style={{ touchAction: "none" }}
          onContextMenu={(e) => e.preventDefault()}
        />
        {failed && (
          <div className="absolute inset-0 flex items-center justify-center text-sm text-neutral-400">
            This browser couldn&apos;t start the 3D view.
          </div>
        )}
        <div className="pointer-events-none absolute bottom-3 left-3.5 rounded-full bg-black/60 px-2.5 py-1 text-xs text-neutral-300">
          Drag to turn · Right-click drag to slide · Scroll to zoom · Click a tank
        </div>

        {selected && (
          <aside
            aria-live="polite"
            className="absolute right-4 top-4 w-[280px] max-w-[calc(100%-32px)] rounded-xl border border-neutral-700 bg-neutral-950 p-4 shadow-2xl max-sm:bottom-12 max-sm:left-3 max-sm:right-3 max-sm:top-auto max-sm:w-auto"
          >
            <div className="flex items-start justify-between gap-2.5">
              <div>
                <b className="text-xl tracking-tight">{selected.name}</b>
                <small className="mt-0.5 block text-xs text-neutral-400">{selected.capacity} bbl unitank · fermenter</small>
              </div>
              <button
                type="button"
                aria-label="Close tank details"
                onClick={() => window.dispatchEvent(new Event("fcb-tanks-close"))}
                className="h-7 w-7 rounded-lg border border-white/10 bg-white/[0.03] text-sm text-neutral-400 hover:text-white"
              >
                ✕
              </button>
            </div>
            <div className="mb-2.5 mt-3.5 flex items-center gap-2 text-[15px] font-semibold">
              <span
                className="h-3 w-3 flex-none rounded"
                style={{ background: full ? selected.color : "transparent", boxShadow: "0 0 0 1px rgba(255,255,255,0.15)" }}
              />
              {full ? selected.code : "Empty"}
            </div>
            <div className="h-2 overflow-hidden rounded-full bg-white/[0.06]">
              <i className="block h-full rounded-full" style={{ width: `${pct}%`, background: selected.color }} />
            </div>
            <div className="mb-2.5 mt-1.5 flex justify-between text-[12.5px] text-neutral-400 tabular-nums">
              <span>
                {selected.volume.toFixed(2)} of {selected.capacity} bbl
              </span>
              <span>{pct}%</span>
            </div>
            <div className="flex flex-col">
              <div className="flex justify-between gap-3 border-t border-white/5 py-2 text-[13.5px]">
                <span className="text-neutral-400">Status</span>
                <span
                  className="inline-block rounded-full px-2.5 py-0.5 text-[11px] font-semibold uppercase tracking-wide"
                  style={{ background: pill.bg, color: pill.fg }}
                >
                  {selected.status}
                </span>
              </div>
              <div className="flex justify-between gap-3 border-t border-white/5 py-2 text-[13.5px]">
                <span className="text-neutral-400">Batch</span>
                <span>{full ? selected.batch : "—"}</span>
              </div>
            </div>
            {full && (
              <button
                type="button"
                className="mt-3 h-[38px] w-full rounded-full text-[13.5px] font-semibold"
                style={{
                  color: "#F2F7F0",
                  background: "linear-gradient(90deg, var(--hl-strong, rgba(106,188,70,0.20)), var(--hl-soft, rgba(106,188,70,0.06)))",
                  boxShadow: "inset 0 0 0 1px var(--hl-line, rgba(106,188,70,0.30)), 0 0 24px var(--hl-glow, rgba(106,188,70,0.12))",
                }}
                // Placeholder (Chad, 2026-10-03): will open a popup with all
                // the batch's tasks. Does nothing yet.
              >
                See Batch Details
              </button>
            )}
          </aside>
        )}
      </section>
    </div>
  );
}
