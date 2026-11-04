"use client";

// Beer Finder cans — a real 3D can with the beer's label printed on it
// (added 2026-11-04, per Chad: "they need to look like actual cans with labels
// on them" + his Metropolis render: "this is what we need to use for the
// labels" + "Please make them all the same"). Notes:
// claude/beer-finder-can-look.md in the project.
//
// Every beer uses the SAME can (a 16oz tall can), whatever size its label was
// made for. A 12oz label is wider for its height, so instead of cropping it
// the whole label goes in the middle and the extra height above and below is
// filled with the label's own edge (its background) — like a printed can.
// `front` = where the front of the label sits across the wrap (0–1); that
// spot faces the viewer.
//
// Drawn once per label + front with three.js (already used by Tanks) into a
// transparent PNG, then cached, so the picker and lists just show pictures.

import type * as THREE_NS from "three";

type Three = typeof THREE_NS;

const R_BODY = 1.3; // 2.6" can
const R_LID = 1.06;
const CAN_H = 6.18; // 16oz tall can
const LABEL_Y: [number, number] = [0.42, 5.42];
const LABEL_R = 1.302;

function profile(T: Three) {
  const p: THREE_NS.Vector2[] = [];
  const add = (x: number, y: number) => p.push(new T.Vector2(x, y));
  const h = CAN_H;
  const bodyTop = h - 0.62;
  add(0.001, 0.16); add(0.55, 0.12); add(0.85, 0.04); add(0.98, 0.0); add(1.08, 0.02);
  add(1.2, 0.12); add(1.27, 0.26); add(R_BODY, 0.4);
  add(R_BODY, bodyTop);
  for (let i = 1; i <= 10; i++) {
    const t = i / 10;
    const e = t * t * (3 - 2 * t);
    add(R_BODY - (R_BODY - (R_LID - 0.02)) * e, bodyTop + 0.5 * t);
  }
  add(R_LID - 0.02, h - 0.1); add(R_LID, h - 0.05); add(R_LID + 0.02, h - 0.01); add(R_LID - 0.01, h);
  add(R_LID - 0.07, h - 0.03); add(R_LID - 0.1, h - 0.2); add(0.9, h - 0.22); add(0.001, h - 0.22);
  return p;
}

// A label shaped for the tall can's label area (whole label, edges extended).
function fitLabel(img: HTMLImageElement): HTMLCanvasElement | HTMLImageElement {
  const circ = 2 * Math.PI * LABEL_R;
  const want = circ / (LABEL_Y[1] - LABEL_Y[0]);
  if (img.width / img.height <= want * 1.02) return img;
  const c = document.createElement("canvas");
  c.width = img.width;
  c.height = Math.round(img.width / want);
  const g = c.getContext("2d")!;
  const top = Math.round((c.height - img.height) / 2);
  const inset = Math.max(1, Math.round(img.height * 0.015)); // skip a thin white margin
  g.drawImage(img, 0, inset, img.width, 1, 0, 0, c.width, top + 1);
  g.drawImage(img, 0, img.height - 1 - inset, img.width, 1, 0, top + img.height - 1, c.width, c.height - top - img.height + 1);
  g.drawImage(img, 0, top);
  return c;
}

interface Stage {
  T: Three;
  renderer: THREE_NS.WebGLRenderer;
  scene: THREE_NS.Scene;
  cam: THREE_NS.PerspectiveCamera;
  label: THREE_NS.Mesh;
  ink: THREE_NS.MeshStandardMaterial;
  canvas: HTMLCanvasElement;
}

let stage: Promise<Stage> | null = null;
const PX_W = 360;
const PX_H = Math.round(PX_W * 1.6);

function getStage(): Promise<Stage> {
  if (stage) return stage;
  stage = (async () => {
    const T = (await import("three")) as Three;
    const { RoomEnvironment } = await import("three/examples/jsm/environments/RoomEnvironment.js");
    const canvas = document.createElement("canvas");
    canvas.width = PX_W;
    canvas.height = PX_H;
    const renderer = new T.WebGLRenderer({ canvas, antialias: true, alpha: true, preserveDrawingBuffer: true });
    renderer.setClearColor(0x000000, 0);
    renderer.outputEncoding = T.sRGBEncoding;
    renderer.toneMapping = T.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 0.95;
    const scene = new T.Scene();
    const pm = new T.PMREMGenerator(renderer);
    scene.environment = pm.fromScene(new RoomEnvironment(), 0.04).texture;
    const key = new T.DirectionalLight(0xffffff, 1.6);
    key.position.set(-5, 7, 7);
    scene.add(key);
    const fill = new T.DirectionalLight(0xffffff, 0.35);
    fill.position.set(6, 2, 4);
    scene.add(fill);
    const metal = new T.MeshStandardMaterial({ color: 0xc9cdd0, metalness: 1, roughness: 0.2, envMapIntensity: 0.85 });
    scene.add(new T.Mesh(new T.LatheGeometry(profile(T), 96), metal));
    const tab = new T.Mesh(new T.TorusGeometry(0.28, 0.06, 8, 32), metal);
    tab.rotation.x = Math.PI / 2;
    tab.scale.set(1, 1.5, 1);
    tab.position.set(0, CAN_H - 0.17, -0.35);
    scene.add(tab);
    // Label printed on the body; thetaStart π puts the seam at the back, so
    // u = 0.5 faces the camera.
    const ink = new T.MeshStandardMaterial({ metalness: 0.45, roughness: 0.3, envMapIntensity: 0.75 });
    const label = new T.Mesh(new T.CylinderGeometry(LABEL_R, LABEL_R, LABEL_Y[1] - LABEL_Y[0], 128, 1, true, Math.PI), ink);
    label.position.y = (LABEL_Y[0] + LABEL_Y[1]) / 2;
    scene.add(label);
    const cam = new T.PerspectiveCamera(22, PX_W / PX_H, 0.1, 100);
    const midY = CAN_H / 2;
    const dist = ((CAN_H / 2) * 1.12) / Math.tan((11 * Math.PI) / 180) + 1.3;
    const el = (12 * Math.PI) / 180;
    cam.position.set(0, midY + dist * Math.sin(el), dist * Math.cos(el));
    cam.lookAt(0, midY, 0);
    return { T, renderer, scene, cam, label, ink, canvas };
  })();
  return stage;
}

function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((res, rej) => {
    const i = new Image();
    i.crossOrigin = "anonymous";
    i.onload = () => res(i);
    i.onerror = () => rej(new Error("Couldn't load the label"));
    i.src = url;
  });
}

// Cache by label (path, not the short-lived link) + front.
const cache = new Map<string, Promise<string>>();
let queue: Promise<unknown> = Promise.resolve();

export function canImage(key: string, url: string, front: number): Promise<string> {
  const k = `${key}@${front.toFixed(3)}`;
  const hit = cache.get(k);
  if (hit) return hit;
  // One can at a time on the shared 3D stage.
  const job = queue.then(async () => {
    const [s, img] = await Promise.all([getStage(), loadImage(url)]);
    const tex = new s.T.Texture(fitLabel(img));
    tex.encoding = s.T.sRGBEncoding;
    tex.wrapS = s.T.RepeatWrapping;
    tex.anisotropy = s.renderer.capabilities.getMaxAnisotropy();
    const src = tex.image as { width: number; height: number };
    const circ = 2 * Math.PI * LABEL_R;
    tex.repeat.x = Math.min(1, circ / ((LABEL_Y[1] - LABEL_Y[0]) * (src.width / src.height)));
    tex.offset.x = front - 0.5 * tex.repeat.x;
    tex.needsUpdate = true;
    const old = s.ink.map;
    s.ink.map = tex;
    s.ink.needsUpdate = true;
    s.renderer.render(s.scene, s.cam);
    const out = s.canvas.toDataURL("image/png");
    old?.dispose();
    return out;
  });
  queue = job.catch(() => undefined);
  cache.set(k, job);
  job.catch(() => cache.delete(k));
  return job;
}

// Where the front of a label usually is, until someone turns the can.
export function defaultFront(labelPath: string | null | undefined): number {
  const p = (labelPath ?? "").toLowerCase();
  if (p.includes("peachyvibes") && p.includes("12oz")) return 0.295;
  if (p.includes("prohibition")) return 0.56;
  if (p.startsWith("previews/speakeasy/")) return 0.535;
  if (p.includes("nectarine")) return 0.46;
  return 0.45;
}
