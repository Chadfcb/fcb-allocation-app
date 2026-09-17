import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";

// Skeleton Hero — first-playable game engine, plain three.js (no React in
// this file at all, on purpose — see the technical plan doc for why: a
// side-scrolling action game needs a manual requestAnimationFrame loop that
// fights React's render cycle if routed through it). SkeletonHeroPageClient
// mounts this against a <canvas>, wires its callbacks to React state for the
// score/leaderboard overlay, and disposes it on unmount.
//
// Scope, deliberately: this is the FIRST PLAYABLE build the technical plan
// described, nothing more. The ground/backdrop below is flat placeholder
// color, not the city-street-with-beer-billboards environment Chad described
// as his idea for the level — that's real environment art, a separate asset
// task Chad hasn't asked to start yet. Same for enemies: plain placeholder
// capsules, not modeled characters — Chad's explicit answer (2026-09-16) was
// "placeholder" for this first build.

export type GameStatus = "loading" | "playing" | "complete" | "error";

export interface SkeletonHeroCallbacks {
  onStatusChange: (status: GameStatus) => void;
  onScoreChange: (score: number) => void;
  onError: (message: string) => void;
}

// Tuning constants — all in one place so these are easy to hand-tune later
// without hunting through the update loop.
const GROUND_Y = 0;
const GRAVITY = -30;
const JUMP_SPEED = 11;
const MOVE_SPEED = 6;
const LEVEL_LENGTH = 70; // world units, x = 0 (start) to LEVEL_LENGTH (end marker)
const ENEMY_COUNT = 8;
const ENEMY_SPEED = 2.5;
const ENEMY_SPAWN_INTERVAL = 1.4; // seconds between spawns
const ENEMY_SPAWN_X = LEVEL_LENGTH - 4; // enemies come from near the far end
const SHOOT_COOLDOWN = 0.25;
const SHOOT_RANGE = 22;
const SHOOT_CORRIDOR_HALF_WIDTH = 1.1; // how close an enemy needs to be to the aim ray to count as hit
const POINTS_PER_ENEMY = 10;
// The rigged/animated model's own root-to-head height in its rest pose is
// small-scale (meters, matching build_model.py's own units) — this scales
// the loaded glTF up to a comfortable on-screen size. Tune this first if the
// character looks too big/small once this is actually running.
const CHARACTER_SCALE = 1.0;

// Names baked into the exported glTF by animate_character.py — see
// claude/ernie-skeleton-hero-rigging-status.md for how these were verified
// against the actual exported file (not just the live Blender session).
const CLIP_NAMES = {
  idle: "Idle_Rig",
  run: "Run_Rig",
  jump: "Jump_Rig",
  shoot: "Shoot_Rig",
} as const;

type AimDir = "left" | "right" | "up";

interface Enemy {
  mesh: THREE.Mesh;
  alive: boolean;
}

export class SkeletonHeroGame {
  private canvas: HTMLCanvasElement;
  private callbacks: SkeletonHeroCallbacks;
  private renderer!: THREE.WebGLRenderer;
  private scene!: THREE.Scene;
  private camera!: THREE.PerspectiveCamera;
  private clock = new THREE.Clock();
  private resizeObserver?: ResizeObserver;
  private rafId: number | null = null;
  private disposed = false;

  // Player
  private playerRoot!: THREE.Group;
  private mixer?: THREE.AnimationMixer;
  private actions: Partial<Record<keyof typeof CLIP_NAMES, THREE.AnimationAction>> = {};
  private currentClip: keyof typeof CLIP_NAMES | null = null;
  private playerX = 2;
  private playerY = GROUND_Y;
  private velY = 0;
  private grounded = true;
  private facing: 1 | -1 = 1;
  private aimDir: AimDir = "right";
  private shootCooldown = 0;
  private shootTimer = 0; // remaining time the one-shot Shoot clip should keep playing

  // Enemies
  private enemies: Enemy[] = [];
  private enemiesSpawned = 0;
  private spawnTimer = 0;
  private enemyGeometry?: THREE.CapsuleGeometry;
  private enemyMaterial?: THREE.MeshStandardMaterial;

  // Input
  private keys = new Set<string>();
  private mouseScreenX = 0;
  private mouseScreenY = 0;
  private shootRequested = false;

  private score = 0;
  private status: GameStatus = "loading";
  private endMarker?: THREE.Object3D;

  constructor(canvas: HTMLCanvasElement, callbacks: SkeletonHeroCallbacks) {
    this.canvas = canvas;
    this.callbacks = callbacks;
  }

  async init(characterGlbUrl: string) {
    this.setupScene();
    this.setupInput();
    try {
      await this.loadCharacter(characterGlbUrl);
    } catch (err) {
      this.callbacks.onError(
        err instanceof Error ? err.message : "Could not load the Skeleton Hero character model.",
      );
      this.setStatus("error");
      return;
    }
    this.spawnLevel();
    this.setStatus("playing");
    this.clock.start();
    this.loop();
  }

  private setStatus(status: GameStatus) {
    this.status = status;
    this.callbacks.onStatusChange(status);
  }

  private setScore(score: number) {
    this.score = score;
    this.callbacks.onScoreChange(score);
  }

  // --- Setup ---------------------------------------------------------------

  private setupScene() {
    this.renderer = new THREE.WebGLRenderer({ canvas: this.canvas, antialias: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x1a1d24); // flat placeholder backdrop, see file header

    this.camera = new THREE.PerspectiveCamera(45, 1, 0.1, 200);
    this.camera.position.set(this.playerX, 4.5, 11);
    this.camera.lookAt(this.playerX, 1.6, 0);

    const hemi = new THREE.HemisphereLight(0xffffff, 0x30302a, 1.1);
    this.scene.add(hemi);
    const dir = new THREE.DirectionalLight(0xffffff, 1.2);
    dir.position.set(5, 10, 8);
    this.scene.add(dir);

    // Ground — a long flat strip standing in for the level. Real city-street
    // environment art (per Chad's stated idea) is a separate task.
    const groundGeo = new THREE.BoxGeometry(LEVEL_LENGTH + 20, 1, 6);
    const groundMat = new THREE.MeshStandardMaterial({ color: 0x33363f });
    const ground = new THREE.Mesh(groundGeo, groundMat);
    ground.position.set(LEVEL_LENGTH / 2, GROUND_Y - 0.5, 0);
    this.scene.add(ground);

    // End-of-level marker — a simple flagpole placeholder.
    const marker = new THREE.Group();
    const poleGeo = new THREE.CylinderGeometry(0.06, 0.06, 4, 8);
    const poleMat = new THREE.MeshStandardMaterial({ color: 0xcccccc });
    const pole = new THREE.Mesh(poleGeo, poleMat);
    pole.position.y = 2;
    marker.add(pole);
    const flagGeo = new THREE.PlaneGeometry(1, 0.6);
    const flagMat = new THREE.MeshStandardMaterial({ color: 0x6abc46, side: THREE.DoubleSide });
    const flag = new THREE.Mesh(flagGeo, flagMat);
    flag.position.set(0.55, 3.6, 0);
    marker.add(flag);
    marker.position.set(LEVEL_LENGTH, GROUND_Y, 0);
    this.scene.add(marker);
    this.endMarker = marker;

    this.resizeObserver = new ResizeObserver(() => this.handleResize());
    this.resizeObserver.observe(this.canvas);
    this.handleResize();
  }

  private handleResize() {
    const rect = this.canvas.getBoundingClientRect();
    const width = Math.max(1, Math.floor(rect.width));
    const height = Math.max(1, Math.floor(rect.height));
    this.renderer.setSize(width, height, false);
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
  }

  private setupInput() {
    window.addEventListener("keydown", this.handleKeyDown);
    window.addEventListener("keyup", this.handleKeyUp);
    this.canvas.addEventListener("mousemove", this.handleMouseMove);
    this.canvas.addEventListener("mousedown", this.handleMouseDown);
  }

  private handleKeyDown = (e: KeyboardEvent) => {
    this.keys.add(e.code);
    if (e.code === "Space") e.preventDefault();
  };

  private handleKeyUp = (e: KeyboardEvent) => {
    this.keys.delete(e.code);
  };

  private handleMouseMove = (e: MouseEvent) => {
    const rect = this.canvas.getBoundingClientRect();
    this.mouseScreenX = e.clientX - rect.left;
    this.mouseScreenY = e.clientY - rect.top;
  };

  private handleMouseDown = () => {
    this.shootRequested = true;
  };

  private async loadCharacter(url: string) {
    const loader = new GLTFLoader();
    const gltf = await loader.loadAsync(url);
    const root = gltf.scene;
    root.scale.setScalar(CHARACTER_SCALE);
    this.playerRoot = new THREE.Group();
    this.playerRoot.add(root);
    this.scene.add(this.playerRoot);

    this.mixer = new THREE.AnimationMixer(root);
    for (const clip of gltf.animations) {
      const key = (Object.keys(CLIP_NAMES) as (keyof typeof CLIP_NAMES)[]).find(
        (k) => CLIP_NAMES[k] === clip.name,
      );
      if (!key) continue;
      const action = this.mixer.clipAction(clip);
      if (key === "jump" || key === "shoot") {
        action.setLoop(THREE.LoopOnce, 1);
        action.clampWhenFinished = true;
      }
      this.actions[key] = action;
    }
    this.playCurrentIdle();
  }

  private spawnLevel() {
    this.enemyGeometry = new THREE.CapsuleGeometry(0.4, 1.1, 4, 8);
    this.enemyMaterial = new THREE.MeshStandardMaterial({ color: 0xb4392f });
  }

  private spawnEnemy() {
    if (!this.enemyGeometry || !this.enemyMaterial) return;
    const mesh = new THREE.Mesh(this.enemyGeometry, this.enemyMaterial);
    mesh.position.set(ENEMY_SPAWN_X, GROUND_Y + 0.95, 0);
    this.scene.add(mesh);
    this.enemies.push({ mesh, alive: true });
    this.enemiesSpawned += 1;
  }

  // --- Animation state -------------------------------------------------------

  private playClip(name: keyof typeof CLIP_NAMES, fade = 0.15) {
    const next = this.actions[name];
    if (!next) return;
    if (this.currentClip === name && next.isRunning()) return;
    const prev = this.currentClip ? this.actions[this.currentClip] : undefined;
    next.reset().fadeIn(fade).play();
    if (prev && prev !== next) prev.fadeOut(fade);
    this.currentClip = name;
  }

  private playCurrentIdle() {
    this.playClip("idle", 0);
  }

  // --- Main loop -------------------------------------------------------------

  private loop = () => {
    if (this.disposed) return;
    this.rafId = requestAnimationFrame(this.loop);
    const dt = Math.min(this.clock.getDelta(), 0.1); // clamp so a tab-switch stall doesn't teleport anything
    this.update(dt);
    this.renderer.render(this.scene, this.camera);
  };

  private update(dt: number) {
    if (this.status !== "playing") return;

    this.updatePlayer(dt);
    this.updateAim();
    this.updateShooting(dt);
    this.updateEnemies(dt);
    this.updateCamera();
    this.mixer?.update(dt);

    if (this.playerX >= LEVEL_LENGTH - 1.5) {
      this.setStatus("complete");
    }
  }

  private updatePlayer(dt: number) {
    const left = this.keys.has("KeyA") || this.keys.has("ArrowLeft");
    const right = this.keys.has("KeyD") || this.keys.has("ArrowRight");
    const jumpPressed = this.keys.has("Space") || this.keys.has("KeyW") || this.keys.has("ArrowUp");

    let moveX = 0;
    if (left) moveX -= 1;
    if (right) moveX += 1;

    if (moveX !== 0) {
      this.playerX += moveX * MOVE_SPEED * dt;
      this.playerX = Math.max(0, Math.min(LEVEL_LENGTH, this.playerX));
      this.facing = moveX > 0 ? 1 : -1;
    }

    if (this.grounded && jumpPressed) {
      this.velY = JUMP_SPEED;
      this.grounded = false;
    }

    if (!this.grounded) {
      this.velY += GRAVITY * dt;
      this.playerY += this.velY * dt;
      if (this.playerY <= GROUND_Y) {
        this.playerY = GROUND_Y;
        this.velY = 0;
        this.grounded = true;
      }
    }

    this.playerRoot.position.set(this.playerX, this.playerY, 0);
    this.playerRoot.rotation.y = this.facing === 1 ? 0 : Math.PI;

    // Animation state — Shoot takes priority for its short duration, then
    // falls back to whatever movement state applies.
    if (this.shootTimer > 0) {
      this.shootTimer -= dt;
    } else if (!this.grounded) {
      this.playClip("jump");
    } else if (moveX !== 0) {
      this.playClip("run");
    } else {
      this.playClip("idle");
    }
  }

  private updateAim() {
    const rect = this.canvas.getBoundingClientRect();
    const screenCenterY = rect.height * 0.5;
    // Simple 3-way aim: mouse well above the player's on-screen position
    // means aim up; otherwise aim along the direction the player is facing,
    // matching a classic run-and-gun's straight/up aiming without needing
    // full mouse-vector aiming for this first pass.
    if (this.mouseScreenY < screenCenterY - 60) {
      this.aimDir = "up";
    } else {
      this.aimDir = this.facing === 1 ? "right" : "left";
    }
  }

  private updateShooting(dt: number) {
    this.shootCooldown = Math.max(0, this.shootCooldown - dt);
    if (!this.shootRequested) return;
    this.shootRequested = false;
    if (this.shootCooldown > 0) return;
    this.shootCooldown = SHOOT_COOLDOWN;
    this.shootTimer = 8 / 24; // Shoot clip is 8 frames @ 24fps, see animate_character.py
    this.playClip("shoot", 0.05);
    this.fireShot();
  }

  private fireShot() {
    if (this.aimDir === "up") return; // no enemies fly yet in this first pass
    const dir = this.aimDir === "right" ? 1 : -1;
    for (const enemy of this.enemies) {
      if (!enemy.alive) continue;
      const dx = enemy.mesh.position.x - this.playerX;
      const inFront = dir === 1 ? dx > 0 : dx < 0;
      if (!inFront) continue;
      if (Math.abs(dx) > SHOOT_RANGE) continue;
      const dy = Math.abs(enemy.mesh.position.y - (this.playerY + 1.2));
      if (dy > SHOOT_CORRIDOR_HALF_WIDTH) continue;
      this.killEnemy(enemy);
      break; // hitscan hits the first enemy in the corridor, not all of them
    }
  }

  private killEnemy(enemy: Enemy) {
    enemy.alive = false;
    this.scene.remove(enemy.mesh);
    this.setScore(this.score + POINTS_PER_ENEMY);
  }

  private updateEnemies(dt: number) {
    if (this.enemiesSpawned < ENEMY_COUNT) {
      this.spawnTimer -= dt;
      if (this.spawnTimer <= 0) {
        this.spawnEnemy();
        this.spawnTimer = ENEMY_SPAWN_INTERVAL;
      }
    }

    for (const enemy of this.enemies) {
      if (!enemy.alive) continue;
      enemy.mesh.position.x -= ENEMY_SPEED * dt;
      if (enemy.mesh.position.x < this.playerX - 40) {
        // wandered off the back of the level — just remove, no penalty
        enemy.alive = false;
        this.scene.remove(enemy.mesh);
      }
    }
  }

  private updateCamera() {
    this.camera.position.x = this.playerX;
    this.camera.lookAt(this.playerX, 1.6, 0);
  }

  // --- Cleanup ---------------------------------------------------------------

  dispose() {
    this.disposed = true;
    if (this.rafId !== null) cancelAnimationFrame(this.rafId);
    this.resizeObserver?.disconnect();
    window.removeEventListener("keydown", this.handleKeyDown);
    window.removeEventListener("keyup", this.handleKeyUp);
    this.canvas.removeEventListener("mousemove", this.handleMouseMove);
    this.canvas.removeEventListener("mousedown", this.handleMouseDown);
    this.mixer?.stopAllAction();

    this.scene?.traverse((obj) => {
      if (obj instanceof THREE.Mesh) {
        obj.geometry?.dispose();
        const materials = Array.isArray(obj.material) ? obj.material : [obj.material];
        for (const mat of materials) mat?.dispose();
      }
    });
    this.renderer?.dispose();
  }

  getScore() {
    return this.score;
  }
}
