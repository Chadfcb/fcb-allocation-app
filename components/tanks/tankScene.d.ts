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
}): TankScene;
