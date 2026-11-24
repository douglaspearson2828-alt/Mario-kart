/// <reference types="vite/client" />
import './ui/styles.css';
import * as THREE from 'three';
import {
  BASE_RACE_CONFIG,
  CUPS,
  DIFFICULTIES,
  GRAND_PRIX_POINTS,
  ITEM_META,
  SURFACE_TYPES,
  type CharacterDef,
  type CupId,
  type DifficultyConfig,
  type KartDef,
  type KartInput,
  type KartState,
  type PhysicsEvent,
  type RaceState,
  type TrackDefinition,
  type TrackInstance,
  type TrackQueryResult,
  type WheelDef,
} from './core/contracts';
import { TextureLibrary } from './core/textures';
import { GraphicsEngine } from './core/graphics';
import { AudioEngine } from './audio/audio';
import { buildTrack } from './tracks/trackBuilder';
import { CUP1_TRACKS } from './tracks/tracksCup1';
import { CUP2_TRACKS } from './tracks/tracksCup2';
import {
  CHARACTERS,
  KARTS,
  WHEELS,
  getCharacterById,
  getKartById,
  getWheelById,
} from './karts/roster';
import { createKartRig } from './karts/kartModels';
import {
  createKartState,
  stepKartPhysics,
  updateRankings,
} from './gameplay/physics';
import { ItemManager } from './gameplay/items';
import { AIController } from './gameplay/ai';
import { GameUI, type GameSelection, type ResultsRow, type ScreenId } from './ui/ui';

type KartRig = ReturnType<typeof createKartRig>;
type AppMode = 'demo' | 'garage' | 'race';

interface RacerConfig {
  id: string;
  isPlayer: boolean;
  charDef: CharacterDef;
  kartDef: KartDef;
  wheelDef: WheelDef;
}

interface AppRaceState extends RaceState {
  countdownRemaining: number;
  goBannerTimer: number;
  lastCountdownDigit: number;
  finishWaitTimer: number;
  totalLaps?: number;
}

interface GrandPrixState {
  active: boolean;
  cupId: CupId;
  raceIndex: number;
  trackIds: string[];
  racersConfig: RacerConfig[];
  pointsById: Map<string, number>;
}

interface PlayerInput extends KartInput {
  itemHeld: boolean;
  itemJustPressed: boolean;
  itemJustReleased: boolean;
  rearView: boolean;
}

const ALL_TRACKS: TrackDefinition[] = [...CUP1_TRACKS, ...CUP2_TRACKS];
const FIXED_DT = BASE_RACE_CONFIG.FIXED_DT || 1 / 60;
const COUNTDOWN_SECONDS = 3.0;

function clamp(v: number, min: number, max: number): number {
  return v < min ? min : v > max ? max : v;
}

function getTrackById(id: string): TrackDefinition {
  return ALL_TRACKS.find((t) => t.id === id) || ALL_TRACKS[0];
}

/**
 * Lightweight 1-draw-call pooled Points particle system respecting gfx.getParticleBudget().
 */
class ParticleSystem {
  texLib: TextureLibrary;
  gfx: GraphicsEngine;
  maxCount: number;
  group: THREE.Group;
  positions: Float32Array;
  colors: Float32Array;
  velocities: Float32Array;
  ages: Float32Array;
  lives: Float32Array;
  gravities: Float32Array;
  baseColors: Float32Array;
  activeCount: number;
  geometry: THREE.BufferGeometry;
  material: THREE.PointsMaterial;
  points: THREE.Points;
  private _tmpColor: THREE.Color;
  private _weatherAccum: number;

  constructor(texLib: TextureLibrary, gfx: GraphicsEngine) {
    this.texLib = texLib;
    this.gfx = gfx;
    this.maxCount = 480;
    this.group = new THREE.Group();
    this.group.name = 'ParticleSystemGroup';

    this.positions = new Float32Array(this.maxCount * 3);
    this.colors = new Float32Array(this.maxCount * 3);
    this.velocities = new Float32Array(this.maxCount * 3);
    this.ages = new Float32Array(this.maxCount);
    this.lives = new Float32Array(this.maxCount);
    this.gravities = new Float32Array(this.maxCount);
    this.baseColors = new Float32Array(this.maxCount * 3);
    this.activeCount = 0;

    this.geometry = new THREE.BufferGeometry();
    this.geometry.setAttribute('position', new THREE.BufferAttribute(this.positions, 3));
    this.geometry.setAttribute('color', new THREE.BufferAttribute(this.colors, 3));
    this.geometry.setDrawRange(0, 0);

    const spriteTex = texLib?.get ? texLib.get('particle_soft') : null;
    this.material = new THREE.PointsMaterial({
      size: 1.05,
      map: spriteTex,
      vertexColors: true,
      transparent: true,
      opacity: 0.9,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      sizeAttenuation: true,
    });

    this.points = new THREE.Points(this.geometry, this.material);
    this.points.frustumCulled = false;
    this.group.add(this.points);
    this._tmpColor = new THREE.Color();
    this._weatherAccum = 0;
  }

  private _budget(): number {
    if (!this.gfx) return 1;
    if (typeof this.gfx.getParticleBudget === 'function') return this.gfx.getParticleBudget();
    return this.gfx.particleBudget ?? 1;
  }

  private _emit(
    x: number,
    y: number,
    z: number,
    vx: number,
    vy: number,
    vz: number,
    colorHex: number,
    life = 0.5,
    gravity = 0
  ): void {
    if (this.activeCount >= this.maxCount) return;
    const idx = this.activeCount++;
    const i3 = idx * 3;
    this.positions[i3] = x;
    this.positions[i3 + 1] = y;
    this.positions[i3 + 2] = z;
    this.velocities[i3] = vx;
    this.velocities[i3 + 1] = vy;
    this.velocities[i3 + 2] = vz;
    this._tmpColor.set(colorHex);
    this.baseColors[i3] = this._tmpColor.r;
    this.baseColors[i3 + 1] = this._tmpColor.g;
    this.baseColors[i3 + 2] = this._tmpColor.b;
    this.colors[i3] = this._tmpColor.r;
    this.colors[i3 + 1] = this._tmpColor.g;
    this.colors[i3 + 2] = this._tmpColor.b;
    this.ages[idx] = 0;
    this.lives[idx] = life;
    this.gravities[idx] = gravity;
  }

  spawnBurst(pos: THREE.Vector3 | null | undefined, colorHex = 0xffaa22, count = 10): void {
    const budget = this._budget();
    if (budget <= 0 || !pos) return;
    const n = Math.max(1, Math.round(count * budget));
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2;
      const spd = 4 + Math.random() * 12;
      this._emit(
        pos.x + (Math.random() - 0.5) * 0.6,
        pos.y + 0.5 + Math.random() * 0.6,
        pos.z + (Math.random() - 0.5) * 0.6,
        Math.cos(a) * spd,
        4 + Math.random() * 9,
        Math.sin(a) * spd,
        colorHex,
        0.38 + Math.random() * 0.25,
        18
      );
    }
  }

  spawnExplosion(pos: THREE.Vector3 | null | undefined, colorHex = 0xff6600): void {
    const budget = this._budget();
    if (budget <= 0 || !pos) return;
    const n = Math.max(4, Math.round(28 * budget));
    for (let i = 0; i < n; i++) {
      const theta = Math.random() * Math.PI * 2;
      const phi = Math.random() * Math.PI * 0.7;
      const spd = 8 + Math.random() * 20;
      this._emit(
        pos.x,
        pos.y + 0.8,
        pos.z,
        Math.sin(phi) * Math.cos(theta) * spd,
        Math.cos(phi) * spd + 5,
        Math.sin(phi) * Math.sin(theta) * spd,
        i % 3 === 0 ? 0xfff0aa : colorHex,
        0.45 + Math.random() * 0.35,
        14
      );
    }
  }

  spawnKartEffects(kart: KartState | null | undefined, trackQuery: TrackQueryResult | null | undefined, dt: number): void {
    const budget = this._budget();
    if (budget <= 0 || !kart || kart.rescueTimer > 0) return;

    const fwdX = Math.sin(kart.heading);
    const fwdZ = Math.cos(kart.heading);
    const rightX = -Math.cos(kart.heading);
    const rightZ = Math.sin(kart.heading);

    // 1. Drift sparks
    if (kart.grounded && kart.driftDir !== 0 && kart.driftTier >= 1 && Math.random() < budget * (dt * 42)) {
      const sparkColor =
        kart.driftTier >= 3 ? 0xd946ef : kart.driftTier === 2 ? 0xff9100 : 0x38bdf8;
      const side = Math.random() < 0.5 ? -0.95 : 0.95;
      this._emit(
        kart.pos.x - fwdX * 1.15 + rightX * side,
        kart.pos.y + 0.25,
        kart.pos.z - fwdZ * 1.15 + rightZ * side,
        -fwdX * 8 + (Math.random() - 0.5) * 6,
        2.5 + Math.random() * 4.5,
        -fwdZ * 8 + (Math.random() - 0.5) * 6,
        sparkColor,
        0.24 + Math.random() * 0.14,
        12
      );
    }

    // 2. Boost / Star exhaust bursts
    if ((kart.boostTimer > 0 || kart.starTimer > 0) && Math.random() < budget * (dt * 50)) {
      const col = kart.starTimer > 0 ? Math.floor(Math.random() * 0xffffff) : 0xff8822;
      const side = Math.random() < 0.5 ? -0.45 : 0.45;
      this._emit(
        kart.pos.x - fwdX * 1.55 + rightX * side,
        kart.pos.y + 0.55,
        kart.pos.z - fwdZ * 1.55 + rightZ * side,
        -fwdX * 11 + (Math.random() - 0.5) * 3,
        1 + Math.random() * 2.5,
        -fwdZ * 11 + (Math.random() - 0.5) * 3,
        col,
        0.22 + Math.random() * 0.12,
        -2
      );
    }

    // 3. Off-road dust plumes
    const surf = trackQuery?.surface;
    if (
      kart.grounded &&
      Math.abs(kart.speed) > 12 &&
      (surf === SURFACE_TYPES.OFFROAD_GRASS ||
        surf === SURFACE_TYPES.OFFROAD_SAND ||
        surf === SURFACE_TYPES.OFFROAD_SNOW) &&
      Math.random() < budget * (dt * 26)
    ) {
      const dustCol =
        surf === SURFACE_TYPES.OFFROAD_SNOW
          ? 0xe8f6ff
          : surf === SURFACE_TYPES.OFFROAD_SAND
            ? 0xe9c987
            : 0x86c462;
      const side = Math.random() < 0.5 ? -0.9 : 0.9;
      this._emit(
        kart.pos.x - fwdX * 1.1 + rightX * side,
        kart.pos.y + 0.18,
        kart.pos.z - fwdZ * 1.1 + rightZ * side,
        (Math.random() - 0.5) * 4,
        2.2 + Math.random() * 3,
        (Math.random() - 0.5) * 4,
        dustCol,
        0.34,
        8
      );
    }
  }

  spawnWeather(cameraPos: THREE.Vector3 | null | undefined, trackDef: TrackDefinition | null | undefined, dt: number): void {
    const budget = this._budget();
    if (budget <= 0 || !cameraPos || !trackDef) return;
    const id = trackDef.id;
    let color = 0;
    let vy = -6;
    let drift = 3;
    let rate = 0;

    if (id === 'frostbite_glacier') {
      color = 0xe8f7ff;
      vy = -8;
      drift = 5;
      rate = 28;
    } else if (id === 'ember_citadel') {
      color = 0xff621a;
      vy = 7;
      drift = 4;
      rate = 24;
    } else if (id === 'sakura_canyon') {
      color = 0xffa6c9;
      vy = -4;
      drift = 7;
      rate = 22;
    } else if (id === 'starlight_rainbow') {
      color = 0x88e5ff;
      vy = -1.5;
      drift = 2;
      rate = 20;
    } else if (id === 'neon_metropolis') {
      color = 0x00e5ff;
      vy = -18;
      drift = 1.5;
      rate = 22;
    }

    if (rate <= 0) return;
    this._weatherAccum += rate * budget * dt;
    while (this._weatherAccum >= 1) {
      this._weatherAccum -= 1;
      this._emit(
        cameraPos.x + (Math.random() - 0.5) * 56,
        cameraPos.y + (vy > 0 ? -8 : 14) + Math.random() * 10,
        cameraPos.z + (Math.random() - 0.5) * 56,
        (Math.random() - 0.5) * drift,
        vy,
        (Math.random() - 0.5) * drift,
        color,
        1.6,
        0
      );
    }
  }

  update(dt: number): void {
    const budget = this._budget();
    this.points.visible = budget > 0;
    if (budget <= 0) {
      this.activeCount = 0;
      this.geometry.setDrawRange(0, 0);
      return;
    }

    let i = 0;
    while (i < this.activeCount) {
      this.ages[i] += dt;
      const life = this.lives[i];
      if (this.ages[i] >= life) {
        const last = --this.activeCount;
        if (i < last) {
          const i3 = i * 3;
          const l3 = last * 3;
          this.positions[i3] = this.positions[l3];
          this.positions[i3 + 1] = this.positions[l3 + 1];
          this.positions[i3 + 2] = this.positions[l3 + 2];
          this.velocities[i3] = this.velocities[l3];
          this.velocities[i3 + 1] = this.velocities[l3 + 1];
          this.velocities[i3 + 2] = this.velocities[l3 + 2];
          this.baseColors[i3] = this.baseColors[l3];
          this.baseColors[i3 + 1] = this.baseColors[l3 + 1];
          this.baseColors[i3 + 2] = this.baseColors[l3 + 2];
          this.colors[i3] = this.colors[l3];
          this.colors[i3 + 1] = this.colors[l3 + 1];
          this.colors[i3 + 2] = this.colors[l3 + 2];
          this.ages[i] = this.ages[last];
          this.lives[i] = this.lives[last];
          this.gravities[i] = this.gravities[last];
        }
        continue;
      }

      const i3 = i * 3;
      this.velocities[i3 + 1] -= this.gravities[i] * dt;
      this.positions[i3] += this.velocities[i3] * dt;
      this.positions[i3 + 1] += this.velocities[i3 + 1] * dt;
      this.positions[i3 + 2] += this.velocities[i3 + 2] * dt;

      const fade = Math.max(0, 1 - this.ages[i] / life);
      this.colors[i3] = this.baseColors[i3] * fade;
      this.colors[i3 + 1] = this.baseColors[i3 + 1] * fade;
      this.colors[i3 + 2] = this.baseColors[i3 + 2] * fade;
      i++;
    }

    (this.geometry.attributes.position as THREE.BufferAttribute).needsUpdate = true;
    (this.geometry.attributes.color as THREE.BufferAttribute).needsUpdate = true;
    this.geometry.setDrawRange(0, this.activeCount);
  }

  clear(): void {
    this.activeCount = 0;
    this.geometry.setDrawRange(0, 0);
  }

  dispose(): void {
    if (this.group.parent) this.group.parent.remove(this.group);
    this.geometry.dispose();
    this.material.dispose();
  }
}

/**
 * Main Game Application Controller
 */
class TurboKartApp {
  appEl: HTMLElement;
  canvasWrap: HTMLDivElement;
  uiWrap: HTMLDivElement;
  flashEl: HTMLDivElement;

  texLib: TextureLibrary;
  gfx: GraphicsEngine;
  audio: AudioEngine;
  particles: ParticleSystem;
  itemManager: ItemManager;
  ai: AIController;

  raceScene: THREE.Scene;
  raceCamera: THREE.PerspectiveCamera;
  garageScene: THREE.Scene;
  garageCamera: THREE.PerspectiveCamera;
  garagePlinth: THREE.Group | null;
  garageYaw: number;
  garagePitch: number;
  garageAutoSpinTimer: number;
  garageRig: KartRig | null;
  garageDummyKart: Partial<KartState>;

  mode: AppMode;
  paused: boolean;
  trackInstance: TrackInstance | null;
  trackDef: TrackDefinition | null;
  karts: KartState[];
  player: KartState | null;
  diffConfig: DifficultyConfig;
  raceState: AppRaceState;
  gpState: GrandPrixState;

  camPos: THREE.Vector3;
  camTarget: THREE.Vector3;
  camSwing: number;
  camFov: number;
  camShake: number;
  victoryOrbitAngle: number;
  demoSwitchTimer: number;
  demoTrackIdx: number;

  keys: Set<string>;
  mouseLeftDown: boolean;
  mouseRightDown: boolean;
  driftPressedEdge: boolean;
  trickPressedEdge: boolean;
  itemPressedEdge: boolean;
  wasItemHeld: boolean;

  ui: GameUI;

  private _lastNowMs: number;
  private _simAccum: number;
  private _elapsedTime: number;

  constructor() {
    this.appEl = document.getElementById('app') || document.body;
    this.canvasWrap = document.createElement('div');
    this.canvasWrap.className = 'tk-canvas-container';
    this.uiWrap = document.createElement('div');
    this.flashEl = document.createElement('div');
    this.flashEl.style.cssText =
      'position:absolute;inset:0;z-index:8;pointer-events:none;background:#fff;opacity:0;';
    this.appEl.append(this.canvasWrap, this.flashEl, this.uiWrap);

    this.texLib = new TextureLibrary();
    this.gfx = new GraphicsEngine(this.canvasWrap, this.texLib, 'high');
    this.audio = new AudioEngine();
    this.particles = new ParticleSystem(this.texLib, this.gfx);
    this.itemManager = new ItemManager(this.gfx, this.texLib);
    this.ai = new AIController(DIFFICULTIES.medium);

    // Core simulation scenes & cameras
    this.raceScene = new THREE.Scene();
    this.raceCamera = new THREE.PerspectiveCamera(62, window.innerWidth / Math.max(1, window.innerHeight), 0.35, 1800);

    this.garageScene = new THREE.Scene();
    this.garageCamera = new THREE.PerspectiveCamera(42, window.innerWidth / Math.max(1, window.innerHeight), 0.25, 400);
    this.garagePlinth = null;
    this.garageYaw = 0.55;
    this.garagePitch = 0.24;
    this.garageAutoSpinTimer = 0;
    this.garageRig = null;
    this.garageDummyKart = {
      speed: 14,
      steer: 0.2,
      driftDir: 0,
      driftTier: 0,
      boostTimer: 0,
      starTimer: 0,
      shrinkTimer: 0,
      spinoutTimer: 0,
      trickTimer: 0,
      invulnTimer: 0,
      gliding: false,
      grounded: true,
      airTime: 0,
      pitch: 0,
      roll: 0,
    };
    this._setupGarageScene();

    // Active mode & race state
    this.mode = 'demo';
    this.paused = false;
    this.trackInstance = null;
    this.trackDef = null;
    this.karts = [];
    this.player = null;
    this.diffConfig = DIFFICULTIES.medium;
    this.raceState = {
      phase: 'racing',
      countdownRemaining: 0,
      raceTime: 0,
      goBannerTimer: 0,
      lastCountdownDigit: 0,
      finishWaitTimer: -1,
    };

    // Grand Prix session state
    this.gpState = {
      active: false,
      cupId: CUPS[0].id,
      raceIndex: 0,
      trackIds: [],
      racersConfig: [],
      pointsById: new Map(),
    };

    // Camera state
    this.camPos = new THREE.Vector3(0, 6, -12);
    this.camTarget = new THREE.Vector3(0, 1.5, 0);
    this.camSwing = 0;
    this.camFov = 62;
    this.camShake = 0;
    this.victoryOrbitAngle = 0;
    this.demoSwitchTimer = 0;
    this.demoTrackIdx = 0;

    // Input state
    this.keys = new Set();
    this.mouseLeftDown = false;
    this.mouseRightDown = false;
    this.driftPressedEdge = false;
    this.trickPressedEdge = false;
    this.itemPressedEdge = false;
    this.wasItemHeld = false;

    this.ui = new GameUI(this.uiWrap, {
      characters: CHARACTERS,
      karts: KARTS,
      wheels: WHEELS,
      tracks: ALL_TRACKS,
      initialSettings: this.gfx.getSettings(),
      initialVolumes: this.audio.getVolumes(),
      callbacks: {
        onPlaySfx: (name) => this.audio.playSfx(name),
        onScreenChange: (screen) => this._handleScreenChange(screen),
        onSelectionChange: (sel) => this._rebuildGarageKart(sel),
        onGarageDrag: (dx, dy) => {
          this.garageYaw -= dx * 0.011;
          this.garagePitch = clamp(this.garagePitch + dy * 0.007, 0.06, 0.85);
          this.garageAutoSpinTimer = 2.5;
        },
        onGarageReset: () => {
          this.garageYaw = 0.55;
          this.garagePitch = 0.24;
          this.garageAutoSpinTimer = 1.5;
        },
        onStartGrandPrix: (sel) => this.startGrandPrix(sel),
        onStartVsRace: (sel) => this.startVsRace(sel),
        onApplyGraphicsPreset: (presetId) => {
          const updated = this.gfx.applyPreset(presetId);
          this.ui.syncSettings(updated, this.audio.getVolumes(), true);
        },
        onUpdateGraphicsSettings: (patch) => {
          const updated = this.gfx.updateSettings(patch);
          this.ui.syncSettings(updated, this.audio.getVolumes(), false);
        },
        onUpdateAudioVolumes: (vols) => {
          this.audio.setVolumes(vols);
        },
        onResumeRace: () => this.resumeRace(),
        onRestartRace: () => this.restartCurrentRace(),
        onNextRace: () => this.advanceGrandPrixRace(),
        onQuitToTitle: () => this.returnToTitle(),
      },
    });

    this._bindInputs();
    this._startDemoRace(ALL_TRACKS[0]);

    this._lastNowMs = performance.now();
    this._simAccum = 0;
    this._elapsedTime = 0;
    this._loop = this._loop.bind(this);
    requestAnimationFrame(this._loop);
  }

  private _setupGarageScene(): void {
    const garageLightingDef: Partial<TrackDefinition> = {
      skyColors: {
        top: 0x10224a,
        horizon: 0x1b376b,
        bottom: 0x070d1f,
        sunColor: 0xffeed0,
        sunPos: [30, 50, 40],
        fogColor: 0x0d1834,
        fogNear: 35,
        fogFar: 180,
      },
      ambientIntensity: 0.9,
      dirLightColor: 0xfff6e8,
      dirLightIntensity: 1.7,
    };
    this.gfx.setupSceneLights(this.garageScene, garageLightingDef);

    // Showroom floor
    const floorMat = this.gfx.createMaterial({
      color: 0x13203d,
      roughness: 0.45,
      metalness: 0.35,
    });
    const floor = new THREE.Mesh(new THREE.CircleGeometry(45, 48), floorMat);
    floor.rotation.x = -Math.PI / 2;
    floor.receiveShadow = true;
    this.garageScene.add(floor);

    // Checkered rotating plinth
    const plinthGroup = new THREE.Group();
    const checkerTex = this.texLib.get('start_checker');
    const topMat = this.gfx.createMaterial({
      color: 0xffffff,
      map: checkerTex,
      roughness: 0.3,
      metalness: 0.2,
    });
    const plinthTop = new THREE.Mesh(new THREE.CylinderGeometry(3.5, 3.65, 0.28, 36), topMat);
    plinthTop.position.y = 0.14;
    plinthTop.receiveShadow = true;
    plinthGroup.add(plinthTop);

    const rimMat = this.gfx.createMaterial({
      color: 0x00d4ff,
      emissive: 0x00a8ff,
      emissiveIntensity: 1.1,
      roughness: 0.2,
    });
    const rim = new THREE.Mesh(new THREE.TorusGeometry(3.62, 0.08, 12, 48), rimMat);
    rim.rotation.x = Math.PI / 2;
    rim.position.y = 0.24;
    plinthGroup.add(rim);

    // Subtle overhead studio arches
    const archMat = this.gfx.createMaterial({
      color: 0x264488,
      emissive: 0x0b2a66,
      emissiveIntensity: 0.65,
      metalness: 0.6,
      roughness: 0.3,
    });
    for (let i = 0; i < 3; i++) {
      const arch = new THREE.Mesh(new THREE.TorusGeometry(9 + i * 3.5, 0.14, 10, 48, Math.PI), archMat);
      arch.position.set(0, 0, -3 - i * 4.5);
      this.garageScene.add(arch);
    }

    this.garagePlinth = plinthGroup;
    this.garageScene.add(plinthGroup);
  }

  private _rebuildGarageKart(sel: GameSelection): void {
    if (this.garageRig?.root?.parent) {
      this.garageRig.root.parent.remove(this.garageRig.root);
    }
    const charDef = getCharacterById(sel.charId);
    const kartDef = getKartById(sel.kartId);
    const wheelDef = getWheelById(sel.wheelId);
    this.garageRig = createKartRig(charDef, kartDef, wheelDef, this.texLib, this.gfx);
    this.garageRig.root.position.set(0, 0.28, 0);
    this.garageRig.root.traverse((obj) => {
      if ((obj as THREE.Mesh).isMesh && obj !== this.garageRig?.blobShadow) {
        obj.castShadow = true;
      }
    });
    this.garageScene.add(this.garageRig.root);
  }

  private _handleScreenChange(screen: ScreenId): void {
    if (screen === 'garage') {
      if (this.mode === 'race') {
        this._clearRaceScene();
      }
      this.mode = 'garage';
      this.paused = false;
      this.audio.stopEngine();
      this.audio.stopMusic();
      this._rebuildGarageKart(this.ui.getSelection());
    } else if (screen === 'title' || screen === 'tracks') {
      this.paused = false;
      if (this.mode !== 'demo') {
        this.audio.stopEngine();
        this.audio.stopMusic();
        this._startDemoRace(ALL_TRACKS[this.demoTrackIdx % ALL_TRACKS.length]);
      }
    } else if (screen === 'race') {
      this.mode = 'race';
    }
  }

  private _bindInputs(): void {
    window.addEventListener('resize', () => {
      const aspect = window.innerWidth / Math.max(1, window.innerHeight);
      this.raceCamera.aspect = aspect;
      this.raceCamera.updateProjectionMatrix();
      this.garageCamera.aspect = aspect;
      this.garageCamera.updateProjectionMatrix();
    });

    window.addEventListener('keydown', (e: KeyboardEvent) => {
      const code = e.code;

      if (code === 'Escape' || code === 'KeyP') {
        if (this.ui.controlsOpen) {
          this.ui.closeControls();
        } else if (this.ui.settingsOpen) {
          this.ui.closeSettings();
        } else if (this.mode === 'race' && this.ui.currentScreen === 'race') {
          if (this.paused) {
            this.resumeRace();
          } else {
            this.pauseRace();
          }
        }
        return;
      }

      if (code === 'KeyH' && this.mode === 'race' && this.ui.currentScreen === 'race') {
        this.ui.toggleControlStrip();
        return;
      }

      if (
        ['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(code) &&
        this.ui.currentScreen === 'race'
      ) {
        e.preventDefault();
      }

      if (!this.keys.has(code)) {
        this.keys.add(code);
        if (code === 'Space' || code === 'ShiftLeft') {
          this.driftPressedEdge = true;
          this.trickPressedEdge = true;
        }
        if (['KeyE', 'KeyF', 'KeyX', 'ShiftRight'].includes(code)) {
          this.itemPressedEdge = true;
        }
      }
    });

    window.addEventListener('keyup', (e: KeyboardEvent) => {
      this.keys.delete(e.code);
    });

    window.addEventListener('mousedown', (e: MouseEvent) => {
      if (this.mode !== 'race' || this.paused || this.ui.currentScreen !== 'race') return;
      if (this.ui.settingsOpen || this.ui.controlsOpen || this.ui.pauseOpen) return;
      if ((e.target as HTMLElement | null)?.closest('button, input, select')) return;

      if (e.button === 0) {
        this.mouseLeftDown = true;
        this.itemPressedEdge = true;
      } else if (e.button === 2) {
        this.mouseRightDown = true;
      }
    });

    window.addEventListener('mouseup', (e: MouseEvent) => {
      if (e.button === 0) this.mouseLeftDown = false;
      if (e.button === 2) this.mouseRightDown = false;
    });

    window.addEventListener('contextmenu', (e: MouseEvent) => {
      if (this.mode === 'race' && this.ui.currentScreen === 'race') {
        e.preventDefault();
      }
    });

    window.addEventListener('blur', () => {
      this.keys.clear();
      this.mouseLeftDown = false;
      this.mouseRightDown = false;
    });
  }

  private _clearRaceScene(): void {
    this.itemManager.clear();
    this.particles.clear();
    for (const k of this.karts) {
      if (k.modelRig?.root?.parent) {
        k.modelRig.root.parent.remove(k.modelRig.root);
      }
    }
    this.karts = [];
    this.player = null;
    if (this.trackInstance) {
      if (this.trackInstance.rootGroup?.parent) {
        this.trackInstance.rootGroup.parent.remove(this.trackInstance.rootGroup);
      }
      this.trackInstance.dispose();
      this.trackInstance = null;
    }
  }

  private _buildRacersForTrack(trackInst: TrackInstance, racersConfig: RacerConfig[], isDemo: boolean): void {
    this.karts = [];
    this.player = null;
    const count = racersConfig.length;

    for (let i = 0; i < count; i++) {
      const cfg = racersConfig[i];
      const kartState = createKartState({
        id: cfg.id,
        name: cfg.charDef.name,
        isPlayer: !isDemo && Boolean(cfg.isPlayer),
        charDef: cfg.charDef,
        kartDef: cfg.kartDef,
        wheelDef: cfg.wheelDef,
        track: trackInst,
        gridIndex: i,
      });
      const rig = createKartRig(cfg.charDef, cfg.kartDef, cfg.wheelDef, this.texLib, this.gfx);
      rig.root.position.copy(kartState.pos);
      rig.root.rotation.y = kartState.heading;
      rig.root.traverse((obj) => {
        if ((obj as THREE.Mesh).isMesh && obj !== rig.blobShadow) {
          obj.castShadow = true;
        }
      });
      kartState.modelRig = rig;
      this.raceScene.add(rig.root);
      this.karts.push(kartState);
      if (kartState.isPlayer) {
        this.player = kartState;
      }
    }

    updateRankings(this.karts);
  }

  private _buildDefaultRosterConfig(sel: GameSelection): RacerConfig[] {
    const playerChar = getCharacterById(sel.charId);
    const playerKart = getKartById(sel.kartId);
    const playerWheel = getWheelById(sel.wheelId);

    const others = CHARACTERS.filter((c) => c.id !== playerChar.id);
    const bots: RacerConfig[] = others.map((c, idx) => ({
      id: `bot_${c.id}`,
      isPlayer: false,
      charDef: c,
      kartDef: KARTS[(idx + 1) % KARTS.length],
      wheelDef: WHEELS[(idx + 1) % WHEELS.length],
    }));

    // Place player at grid slot 7 (8th on starting grid)
    const grid: RacerConfig[] = [...bots];
    grid.splice(7, 0, {
      id: 'player',
      isPlayer: true,
      charDef: playerChar,
      kartDef: playerKart,
      wheelDef: playerWheel,
    });
    return grid;
  }

  private _startDemoRace(trackDef: TrackDefinition): void {
    this._clearRaceScene();
    this.mode = 'demo';
    this.paused = false;
    this.trackDef = trackDef;
    this.diffConfig = DIFFICULTIES.hard;
    this.ai.setDifficulty(this.diffConfig);
    this.ai.reset();

    this.trackInstance = buildTrack(trackDef, this.texLib, this.gfx);
    this.raceScene.add(this.trackInstance.rootGroup);
    this.raceScene.add(this.itemManager.group);
    this.raceScene.add(this.particles.group);
    this.gfx.setupSceneLights(this.raceScene, trackDef);
    this.gfx.applyTrackLOD(this.trackInstance);

    const demoGrid: RacerConfig[] = CHARACTERS.map((c, i) => ({
      id: `demo_${c.id}`,
      isPlayer: false,
      charDef: c,
      kartDef: KARTS[i % KARTS.length],
      wheelDef: WHEELS[i % WHEELS.length],
    }));
    this._buildRacersForTrack(this.trackInstance, demoGrid, true);

    this.raceState = {
      phase: 'racing',
      countdownRemaining: 0,
      raceTime: 0,
      goBannerTimer: 0,
      lastCountdownDigit: 0,
      finishWaitTimer: -1,
    };
    this.demoSwitchTimer = 42;
    this._snapCameraBehind(this.karts[0]);
  }

  startGrandPrix(sel: GameSelection): void {
    const cupTracks = ALL_TRACKS.filter((t) => t.cupId === sel.cupId);
    const racersConfig = this._buildDefaultRosterConfig(sel);
    this.gpState = {
      active: true,
      cupId: sel.cupId,
      raceIndex: 0,
      trackIds: cupTracks.map((t) => t.id),
      racersConfig,
      pointsById: new Map(racersConfig.map((r) => [r.id, 0])),
    };
    this._launchRace(getTrackById(this.gpState.trackIds[0]), sel, racersConfig);
  }

  startVsRace(sel: GameSelection): void {
    const racersConfig = this._buildDefaultRosterConfig(sel);
    this.gpState = {
      active: false,
      cupId: sel.cupId,
      raceIndex: 0,
      trackIds: [sel.trackId],
      racersConfig,
      pointsById: new Map(),
    };
    this._launchRace(getTrackById(sel.trackId), sel, racersConfig);
  }

  advanceGrandPrixRace(): void {
    if (!this.gpState.active) return;
    this.gpState.raceIndex += 1;
    const nextTrackId = this.gpState.trackIds[this.gpState.raceIndex];
    if (!nextTrackId) return;

    // Order starting grid by reverse GP points so leader starts 8th or ordered nicely
    const sorted = [...this.gpState.racersConfig].sort((a, b) => {
      const pa = this.gpState.pointsById.get(a.id) || 0;
      const pb = this.gpState.pointsById.get(b.id) || 0;
      return pa - pb;
    });
    this._launchRace(getTrackById(nextTrackId), this.ui.getSelection(), sorted);
  }

  restartCurrentRace(): void {
    if (!this.trackDef) return;
    const sel = this.ui.getSelection();
    const roster = this.gpState.active ? this.gpState.racersConfig : this._buildDefaultRosterConfig(sel);
    this._launchRace(this.trackDef, sel, roster);
  }

  private _launchRace(trackDef: TrackDefinition, sel: GameSelection, racersConfig: RacerConfig[]): void {
    this._clearRaceScene();
    this.mode = 'race';
    this.paused = false;
    this.trackDef = trackDef;
    this.diffConfig = DIFFICULTIES[sel.difficultyId] || DIFFICULTIES.medium;
    this.ai.setDifficulty(this.diffConfig);
    this.ai.reset();

    this.trackInstance = buildTrack(trackDef, this.texLib, this.gfx);
    this.raceScene.add(this.trackInstance.rootGroup);
    this.raceScene.add(this.itemManager.group);
    this.raceScene.add(this.particles.group);
    this.gfx.setupSceneLights(this.raceScene, trackDef);
    this.gfx.applyTrackLOD(this.trackInstance);

    this._buildRacersForTrack(this.trackInstance, racersConfig, false);

    this.raceState = {
      phase: 'countdown',
      countdownRemaining: COUNTDOWN_SECONDS,
      raceTime: 0,
      goBannerTimer: 0,
      lastCountdownDigit: 4,
      finishWaitTimer: -1,
    };
    this.victoryOrbitAngle = 0;
    this.driftPressedEdge = false;
    this.trickPressedEdge = false;
    this.itemPressedEdge = false;
    this.wasItemHeld = false;

    this._snapCameraBehind(this.player);
    this.ui.showRaceHud(trackDef);
    this.audio.unlock();
    this.audio.startMusic(trackDef.bgmStyle);
  }

  pauseRace(): void {
    if (this.mode !== 'race' || this.paused) return;
    this.paused = true;
    this.audio.stopEngine();
    this.ui.openPause();
  }

  resumeRace(): void {
    if (!this.paused) return;
    this.paused = false;
    this.ui.closeAllModals();
  }

  returnToTitle(): void {
    this.paused = false;
    this.audio.stopEngine();
    this.audio.stopMusic();
    this._startDemoRace(ALL_TRACKS[this.demoTrackIdx % ALL_TRACKS.length]);
    this.ui.showTitle(this.trackDef?.name);
  }

  private _snapCameraBehind(kart: KartState | null | undefined): void {
    if (!kart) return;
    const fx = Math.sin(kart.heading);
    const fz = Math.cos(kart.heading);
    this.camPos.set(kart.pos.x - fx * 9.0, kart.pos.y + 4.0, kart.pos.z - fz * 9.0);
    this.camTarget.set(kart.pos.x + fx * 3.0, kart.pos.y + 1.4, kart.pos.z + fz * 3.0);
    this.camSwing = 0;
    this.camFov = 62;
    this.camShake = 0;
  }

  private _readPlayerInput(): PlayerInput {
    const fwd = this.keys.has('KeyW') || this.keys.has('ArrowUp');
    const back = this.keys.has('KeyS') || this.keys.has('ArrowDown');
    const left = this.keys.has('KeyA') || this.keys.has('ArrowLeft');
    const right = this.keys.has('KeyD') || this.keys.has('ArrowRight');

    const throttle = fwd ? 1 : back ? -1 : 0;
    const steer = (left ? -1 : 0) + (right ? 1 : 0);
    const drift = this.keys.has('Space') || this.keys.has('ShiftLeft');
    const itemHeld =
      this.keys.has('KeyE') ||
      this.keys.has('KeyF') ||
      this.keys.has('KeyX') ||
      this.keys.has('ShiftRight') ||
      this.mouseLeftDown;
    const rearView =
      this.keys.has('KeyQ') || this.keys.has('KeyC') || this.mouseRightDown;

    const driftJustPressed = this.driftPressedEdge;
    const trickJustPressed = this.trickPressedEdge;
    const itemJustPressed = this.itemPressedEdge;
    const itemJustReleased = this.wasItemHeld && !itemHeld;

    this.driftPressedEdge = false;
    this.trickPressedEdge = false;
    this.itemPressedEdge = false;
    this.wasItemHeld = itemHeld;

    return {
      throttle,
      steer,
      drift,
      driftJustPressed,
      trickJustPressed,
      itemHeld,
      itemJustPressed,
      itemJustReleased,
      rearView,
    };
  }

  private _handlePhysicsEvents(events: PhysicsEvent[], isPlayerRace: boolean): void {
    for (let i = 0; i < events.length; i++) {
      const evt = events[i];
      const isPlayerEvt = isPlayerRace && this.player && evt.kartId === this.player.id;

      if (isPlayerEvt && this.player) {
        switch (evt.type) {
          case 'hop':
            this.audio.playSfx('hop');
            break;
          case 'mt_charge':
            this.audio.playSfx('mt_charge', evt.tier);
            break;
          case 'mt_release':
            this.audio.playSfx('mt_release');
            this.particles.spawnBurst(this.player.pos, 0xffa033, 10);
            break;
          case 'rocket_start':
            this.audio.playSfx('boost_pad');
            this.ui.triggerHudBanner('🚀 ROCKET START!', 'boost', 1.4);
            this.particles.spawnBurst(this.player.pos, 0xffd426, 16);
            break;
          case 'burnout':
            this.audio.playSfx('hit');
            this.ui.triggerHudBanner('💨 BURNOUT!', 'danger', 1.2);
            this.camShake = Math.max(this.camShake, 0.45);
            break;
          case 'boost_pad':
            this.audio.playSfx('boost_pad');
            this.particles.spawnBurst(this.player.pos, 0x00d4ff, 8);
            break;
          case 'trick':
          case 'trick_boost':
            this.audio.playSfx('trick');
            this.ui.triggerHudBanner('🤸 TRICK BOOST!', 'boost', 1.1);
            this.particles.spawnBurst(this.player.pos, 0xffd426, 10);
            break;
          case 'land':
            this.camShake = Math.max(this.camShake, 0.22);
            break;
          case 'coin':
            this.audio.playSfx('coin');
            this.particles.spawnBurst(this.player.pos, 0xffd700, 6);
            break;
          case 'hit':
            this.audio.playSfx('hit');
            this.camShake = Math.max(this.camShake, 0.55);
            break;
          case 'hazard_smash':
            this.audio.playSfx('explosion');
            this.particles.spawnExplosion(this.player.pos, 0xff6600);
            this.camShake = Math.max(this.camShake, 0.7);
            break;
          case 'rescue':
            this.audio.playSfx('warning');
            this.ui.triggerHudBanner('☁ LAKITU RESCUE', 'danger', 1.2);
            break;
          case 'shortcut':
            this.audio.playSfx('trick');
            this.ui.triggerHudBanner(`⚡ SHORTCUT: ${evt.name || 'NICE!'}`, 'boost', 1.5);
            break;
          case 'lap': {
            const totalLaps = this.trackDef?.laps || BASE_RACE_CONFIG.LAPS;
            if (evt.lap >= totalLaps) {
              this.audio.playSfx('final_lap');
              this.ui.triggerHudBanner('🔥 FINAL LAP!', 'lap', 2.1);
            } else {
              this.audio.playSfx('lap');
              this.ui.triggerHudBanner(`LAP ${evt.lap}/${totalLaps}`, 'lap', 1.5);
            }
            break;
          }
          case 'finish':
            this.audio.playSfx('finish');
            this.ui.triggerHudBanner('🏁 FINISH!', 'lap', 2.4);
            this.raceState.finishWaitTimer = 2.0;
            break;
          default:
            break;
        }
      }
    }
  }

  private _finalizeAndShowResults(): void {
    this.audio.stopEngine();
    // Assign projected finish times for bots still on track
    const remaining = this.karts
      .filter((k) => !k.finished)
      .sort((a, b) => (b.totalProgress ?? 0) - (a.totalProgress ?? 0));
    let extraTime = Math.max(this.raceState.raceTime + 0.6, (this.player?.finishTime || this.raceState.raceTime) + 0.8);
    for (const k of remaining) {
      const gap = Math.max(0.4, (3 - (k.totalProgress || 0)) * 22);
      k.finishTime = extraTime + gap * 0.15;
      k.finished = true;
      extraTime = k.finishTime + 0.35;
    }
    updateRankings(this.karts);

    if (this.gpState.active) {
      for (const k of this.karts) {
        const pts = GRAND_PRIX_POINTS[(k.rank || 8) - 1] ?? 1;
        this.gpState.pointsById.set(k.id, (this.gpState.pointsById.get(k.id) || 0) + pts);
      }
    }

    const rows: ResultsRow[] = this.karts.map((k) => ({
      id: k.id,
      name: k.name,
      isPlayer: k.isPlayer,
      rank: k.rank,
      color: k.charDef?.primaryColor,
      kartName: k.kartDef?.name,
      finished: k.finished,
      finishTime: k.finishTime,
      totalPoints: this.gpState.pointsById.get(k.id) || 0,
    }));

    const cup = CUPS.find((c) => c.id === this.gpState.cupId);
    const totalRaces = this.gpState.trackIds.length || 4;
    const isFinalPodium = this.gpState.active && this.gpState.raceIndex >= totalRaces - 1;

    this.ui.showResults({
      isGrandPrix: this.gpState.active,
      cupName: cup?.name || 'Grand Prix',
      raceNumber: this.gpState.raceIndex + 1,
      totalRaces,
      trackName: this.trackDef?.name || 'Circuit',
      rows,
      isFinalPodium,
    });
  }

  private _stepRaceSimulation(dt: number, pInput: PlayerInput | null): void {
    const isDemo = this.mode === 'demo';
    const rs = this.raceState;
    const trackInst = this.trackInstance;
    if (!trackInst) return;

    // Countdown tick
    if (rs.phase === 'countdown') {
      rs.countdownRemaining = Math.max(0, rs.countdownRemaining - dt);
      const digit = Math.ceil(rs.countdownRemaining);
      if (digit >= 1 && digit <= 3 && digit !== rs.lastCountdownDigit) {
        rs.lastCountdownDigit = digit;
        if (!isDemo) this.audio.playSfx('countdown');
      }
      if (rs.countdownRemaining <= 0) {
        rs.phase = 'racing';
        rs.goBannerTimer = 0.95;
        if (!isDemo) this.audio.playSfx('go');
      }
    } else if (rs.phase === 'racing') {
      rs.raceTime += dt;
      if (rs.goBannerTimer > 0) rs.goBannerTimer = Math.max(0, rs.goBannerTimer - dt);
    }

    const events: PhysicsEvent[] = [];
    const totalLaps = this.trackDef?.laps || BASE_RACE_CONFIG.LAPS;
    const simRaceState: AppRaceState = { ...rs, totalLaps };

    for (let i = 0; i < this.karts.length; i++) {
      const kart = this.karts[i];
      let input: KartInput;

      if (!isDemo && kart.isPlayer && !kart.finished && pInput) {
        input = pInput;
        if (rs.phase === 'racing') {
          if (pInput.itemJustPressed) {
            const trailable = Boolean(kart.item && ITEM_META[kart.item]?.canTrail);
            this.itemManager.useItem(kart, trailable, this.karts, trackInst, this.audio, this.particles);
          } else if (pInput.itemJustReleased && kart.trailingItem) {
            this.itemManager.releaseTrail(kart, this.karts, trackInst, this.audio, this.particles);
          }
        }
      } else {
        input = this.ai.stepAI(
          kart,
          trackInst,
          this.karts,
          this.itemManager,
          this.diffConfig,
          simRaceState,
          dt,
          isDemo ? null : this.audio,
          this.particles
        );
      }

      stepKartPhysics(kart, input, trackInst, this.diffConfig, this.karts, dt, simRaceState, events);

      const q = trackInst.queryTrack(kart.pos, kart.trackIdx);
      this.particles.spawnKartEffects(kart, q, dt);
    }

    updateRankings(this.karts);
    this.itemManager.update(
      dt,
      this.karts,
      trackInst,
      this.gfx,
      isDemo ? null : this.audio,
      this.particles
    );
    trackInst.update(dt, this._elapsedTime);
    this.particles.update(dt);

    if (!isDemo) {
      this._handlePhysicsEvents(events, true);

      // Update continuous engine audio for player
      if (this.player && !this.paused && this.ui.currentScreen === 'race') {
        const speedRatio = Math.abs(this.player.speed) / Math.max(1, this.player.stats.maxSpeed);
        this.audio.updateEngine(
          speedRatio,
          this.player.grounded && this.player.driftDir !== 0,
          this.player.boostTimer > 0,
          this.player.starTimer > 0
        );
      } else {
        this.audio.stopEngine();
      }

      // Transition to standings overlay shortly after player crosses line
      if (rs.finishWaitTimer > 0) {
        rs.finishWaitTimer -= dt;
        if (rs.finishWaitTimer <= 0 && this.ui.currentScreen === 'race') {
          this._finalizeAndShowResults();
        }
      }
    } else {
      // Demo loop track switching
      this.demoSwitchTimer -= dt;
      if (this.demoSwitchTimer <= 0 && (this.ui.currentScreen === 'title' || this.ui.currentScreen === 'tracks')) {
        this.demoTrackIdx = (this.demoTrackIdx + 1) % ALL_TRACKS.length;
        this._startDemoRace(ALL_TRACKS[this.demoTrackIdx]);
      }
    }
  }

  private _updateRaceVisualsAndCamera(dt: number, rearView: boolean): void {
    // Sync kart 3D rigs
    for (let i = 0; i < this.karts.length; i++) {
      const kart = this.karts[i];
      const rig = kart.modelRig as KartRig | undefined;
      if (!rig) continue;
      rig.root.position.copy(kart.pos);
      rig.root.rotation.y = kart.heading;
      rig.updateVisuals(kart, dt, this._elapsedTime, this.gfx);
    }

    // Lightning flash overlay
    this.flashEl.style.opacity = String(clamp(this.itemManager.screenFlash || 0, 0, 0.85));

    if (this.mode === 'demo') {
      const lead = this.karts.find((k) => k.rank === 1) || this.karts[0];
      if (!lead) return;
      const sweep = Math.sin(this._elapsedTime * 0.28) * 0.48;
      const angle = lead.heading + sweep;
      const dist = 10.5;
      const desiredX = lead.pos.x - Math.sin(angle) * dist;
      const desiredZ = lead.pos.z - Math.cos(angle) * dist;
      const desiredY = lead.pos.y + 4.4;
      const lerpFactor = 1 - Math.exp(-5 * dt);
      this.camPos.lerp(new THREE.Vector3(desiredX, desiredY, desiredZ), lerpFactor);
      this.camTarget.lerp(new THREE.Vector3(lead.pos.x, lead.pos.y + 1.5, lead.pos.z), lerpFactor * 1.4);
      this.raceCamera.fov = 64;
      this.raceCamera.updateProjectionMatrix();
      this.raceCamera.position.copy(this.camPos);
      this.raceCamera.lookAt(this.camTarget);
      this.particles.spawnWeather(this.camPos, this.trackDef, dt);
      this.gfx.updateShadowTarget(lead.pos);
      return;
    }

    const player = this.player;
    if (!player) return;

    this.gfx.updateShadowTarget(player.pos);
    this.particles.spawnWeather(this.camPos, this.trackDef, dt);

    if (player.finished) {
      this.victoryOrbitAngle += dt * 0.65;
      const orbitDist = 9.5;
      const ox = player.pos.x + Math.sin(this.victoryOrbitAngle) * orbitDist;
      const oz = player.pos.z + Math.cos(this.victoryOrbitAngle) * orbitDist;
      const oy = player.pos.y + 3.8;
      const f = 1 - Math.exp(-5 * dt);
      this.camPos.lerp(new THREE.Vector3(ox, oy, oz), f);
      this.camTarget.lerp(new THREE.Vector3(player.pos.x, player.pos.y + 1.2, player.pos.z), f * 1.5);
      this.raceCamera.fov = 60;
      this.raceCamera.updateProjectionMatrix();
      this.raceCamera.position.copy(this.camPos);
      this.raceCamera.lookAt(this.camTarget);
      return;
    }

    const fx = Math.sin(player.heading);
    const fz = Math.cos(player.heading);
    const rx = -Math.cos(player.heading);
    const rz = Math.sin(player.heading);

    const speedRatio = clamp(Math.abs(player.speed) / Math.max(1, player.stats.maxSpeed), 0, 1.4);
    const boosting = player.boostTimer > 0 || player.starTimer > 0;

    // Speed-FOV widening & boost kickback
    const targetFov = 62 + speedRatio * 9 + (boosting ? 7 : 0);
    this.camFov += (targetFov - this.camFov) * (1 - Math.exp(-7 * dt));
    if (Math.abs(this.raceCamera.fov - this.camFov) > 0.05) {
      this.raceCamera.fov = this.camFov;
      this.raceCamera.updateProjectionMatrix();
    }

    if (rearView) {
      const lookPos = new THREE.Vector3(player.pos.x + fx * 8.6, player.pos.y + 3.6, player.pos.z + fz * 8.6);
      const targetPos = new THREE.Vector3(player.pos.x - fx * 6.0, player.pos.y + 1.3, player.pos.z - fz * 6.0);
      this.raceCamera.position.copy(lookPos);
      this.raceCamera.lookAt(targetPos);
      return;
    }

    const targetSwing = player.driftDir !== 0 ? player.driftDir * 1.35 : 0;
    this.camSwing += (targetSwing - this.camSwing) * (1 - Math.exp(-6 * dt));

    const dist = 8.4 + (boosting ? 1.45 : 0) + speedRatio * 0.65;
    const height = 3.55 + (player.gliding ? 0.9 : 0);

    const desiredPos = new THREE.Vector3(
      player.pos.x - fx * dist + rx * this.camSwing,
      player.pos.y + height,
      player.pos.z - fz * dist + rz * this.camSwing
    );
    const desiredTarget = new THREE.Vector3(
      player.pos.x + fx * 4.2 + rx * (this.camSwing * 0.35),
      player.pos.y + 1.35,
      player.pos.z + fz * 4.2 + rz * (this.camSwing * 0.35)
    );

    const posLerp = 1 - Math.exp(-11 * dt);
    const tgtLerp = 1 - Math.exp(-16 * dt);
    this.camPos.lerp(desiredPos, posLerp);
    this.camTarget.lerp(desiredTarget, tgtLerp);

    this.raceCamera.position.copy(this.camPos);
    if (this.camShake > 0.01) {
      this.camShake = Math.max(0, this.camShake - dt * 2.2);
      this.raceCamera.position.x += Math.sin(this._elapsedTime * 52) * this.camShake * 0.35;
      this.raceCamera.position.y += Math.cos(this._elapsedTime * 46) * this.camShake * 0.3;
    }
    this.raceCamera.lookAt(this.camTarget);
  }

  private _updateGarage(dt: number): void {
    if (this.garageAutoSpinTimer > 0) {
      this.garageAutoSpinTimer = Math.max(0, this.garageAutoSpinTimer - dt);
    } else {
      this.garageYaw += dt * 0.52;
    }

    if (this.garagePlinth) {
      this.garagePlinth.rotation.y = this.garageYaw;
    }
    if (this.garageRig) {
      this.garageRig.root.rotation.y = this.garageYaw;
      this.garageRig.updateVisuals(this.garageDummyKart, dt, this._elapsedTime, this.gfx);
    }

    const w = window.innerWidth || 1280;
    const h = window.innerHeight || 720;
    const rect = this.ui.getGarageStageBounds();
    if (rect) {
      const cx = rect.left + rect.width * 0.5;
      const cy = rect.top + rect.height * 0.52;
      this.garageCamera.setViewOffset(w, h, w * 0.5 - cx, h * 0.5 - cy, w, h);
    } else {
      this.garageCamera.clearViewOffset();
    }

    const dist = 6.2;
    this.garageCamera.position.set(
      Math.sin(0.15) * dist * Math.cos(this.garagePitch),
      1.1 + Math.sin(this.garagePitch) * dist,
      Math.cos(0.15) * dist * Math.cos(this.garagePitch)
    );
    this.garageCamera.lookAt(0, 1.0, 0);
    this.gfx.updateShadowTarget(new THREE.Vector3(0, 0, 0));
  }

  private _loop(nowMs: number): void {
    requestAnimationFrame(this._loop);

    if (!this.gfx.shouldRenderFrame(nowMs)) {
      return;
    }

    const frameDeltaMs = Math.max(1, nowMs - this._lastNowMs);
    this._lastNowMs = nowMs;
    const rawDt = Math.min(0.1, frameDeltaMs / 1000);
    if (!this.paused) {
      this._elapsedTime += rawDt;
      this.texLib.scrollBoost(rawDt);
    }

    let boostIntensity = 0;

    if (this.mode === 'garage') {
      this._updateGarage(rawDt);
      this.gfx.render(this.garageScene, this.garageCamera, 0);
    } else {
      let rearView = false;
      if (!this.paused) {
        const pInput = this.mode === 'race' ? this._readPlayerInput() : null;
        rearView = Boolean(pInput?.rearView);

        this._simAccum = Math.min(0.12, this._simAccum + rawDt);
        let stepInput = pInput;
        while (this._simAccum >= FIXED_DT) {
          this._stepRaceSimulation(FIXED_DT, stepInput);
          // Edge triggers fire only on the first fixed step of this frame
          if (stepInput) {
            stepInput = {
              ...stepInput,
              driftJustPressed: false,
              trickJustPressed: false,
              itemJustPressed: false,
              itemJustReleased: false,
            };
          }
          this._simAccum -= FIXED_DT;
        }
        this._updateRaceVisualsAndCamera(rawDt, rearView);
      } else {
        // Keep visuals & shadow toggle responsive to live settings while paused
        for (let i = 0; i < this.karts.length; i++) {
          const k = this.karts[i];
          k.modelRig?.updateVisuals(k, 0, this._elapsedTime, this.gfx);
        }
      }

      if (this.mode === 'race' && this.player) {
        const isBoost = this.player.boostTimer > 0 || this.player.starTimer > 0;
        boostIntensity = isBoost ? clamp(0.6 + this.player.boostStrength, 0.4, 1.2) : 0;

        let cdText = '';
        if (this.raceState.phase === 'countdown') {
          cdText = String(Math.max(1, Math.ceil(this.raceState.countdownRemaining)));
        } else if (this.raceState.goBannerTimer > 0) {
          cdText = 'GO!';
        }

        this.ui.updateRaceHud({
          player: this.player,
          karts: this.karts,
          trackInstance: this.trackInstance,
          trackDef: this.trackDef,
          raceTime: this.raceState.raceTime,
          countdownText: cdText,
          totalLaps: this.trackDef?.laps || BASE_RACE_CONFIG.LAPS,
          incomingBlueShell: Boolean(this.player.incomingBlueShellWarning),
          gfxStats: this.gfx.getStats(),
          dt: this.paused ? 0 : rawDt,
        });
      } else if (this.ui.currentScreen === 'title') {
        this.ui.updateTitleTelemetry(this.gfx.getStats(), this.trackDef?.name);
      }

      this.gfx.render(this.raceScene, this.raceCamera, boostIntensity);
    }

    this.gfx.recordFrame(frameDeltaMs);
  }
}

declare global {
  interface Window {
    __turboKartApp?: TurboKartApp;
  }
}

window.addEventListener('DOMContentLoaded', () => {
  window.__turboKartApp = new TurboKartApp();
});
