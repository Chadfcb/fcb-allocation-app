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
}

export function createTankScene(opts: {
  canvas: HTMLCanvasElement;
  snapEl: HTMLElement;
  onSelect?: (info: TankSceneInfo | null) => void;
  font?: string;
  mono?: string;
}): TankScene;
