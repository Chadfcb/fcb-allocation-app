// Types for tankScene.js (the 3D tank scene, plain JavaScript ported from the preview).
export interface TankSceneInfo {
  name: string;
  capacity: number;
  volume: number;
  status: string;
  product: string;
  batch: string;
  color: string;
}

export interface TankScene {
  dispose: () => void;
  /** Select a tank by name (null closes the details card). */
  select: (name: string | null) => void;
  /** Where the camera is (to put it back after a rebuild). */
  getView: () => TankSceneView;
  setView: (view: TankSceneView | null) => void;
}

export interface TankSceneView {
  p: number[];
  t: number[];
}

export function createTankScene(opts: {
  canvas: HTMLCanvasElement;
  snapEl: HTMLElement;
  onSelect?: (info: TankSceneInfo | null) => void;
  font?: string;
  mono?: string;
  /** Rows of table ekos_tanks from the Ekos tank sync (empty = sample data). */
  live?: unknown[];
  /** 1/2 and 1/6 bbl kegs On Hand (Packaging Inventory, current week) — drawn as keg pallets. */
  kegs?: { half: number; sixth: number } | null;
  /** Cans On Hand (19.2oz / 16oz / 12oz, individual cans) — drawn as can pallets. */
  cans?: { c19: number; c16: number; c12: number } | null;
  /** 202 LOE ends (lids) On Hand, individual lids — drawn as a lid pallet (500 per chute). */
  lids?: number | null;
  /** Label Inventory On Hand per can product (individual labels) — drawn as label rolls on the steel rack. */
  labels?: { name: string; size: "c19" | "c16" | "c12"; onHand: number }[] | null;
}): TankScene;
