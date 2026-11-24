import type * as THREE from 'three';

/**
 * Shared Architecture Contracts, TypeScript Interfaces, Enums, Presets & Stat Combiner for Turbo Kart 8.
 * All modules and swarm workers MUST adhere strictly to these contracts.
 */

export const CUP_IDS = {
  MUSHROOM: 'mushroom_cup',
  STAR: 'star_cup',
} as const;

export type CupId = (typeof CUP_IDS)[keyof typeof CUP_IDS];

export interface CupDef {
  id: CupId;
  name: string;
  subtitle: string;
  accent: string;
}

export const CUPS: CupDef[] = [
  {
    id: CUP_IDS.MUSHROOM,
    name: 'Mushroom Cup',
    subtitle: 'Coastal Circuits & Elemental Peaks',
    accent: '#ff3b30',
  },
  {
    id: CUP_IDS.STAR,
    name: 'Star Cup',
    subtitle: 'Midnight Neon, Ancient Ruins & Cosmos',
    accent: '#ffcc00',
  },
];

export type DifficultyId = 'easy' | 'medium' | 'hard' | 'master';

export interface DifficultyConfig {
  id: DifficultyId;
  label: string;
  cc: number;
  speedMult: number;
  aiBaseSpeedScale: number;
  driftThreshold: number;
  mtTargetTier: number;
  shortcutEagerness: number;
  itemAimAccuracy: number;
  coinSeeking: number;
  reactionDelay: number;
  rocketStartChance: number;
  trickChance: number;
  apexSkill: number;
}

export const DIFFICULTIES: Record<DifficultyId, DifficultyConfig> = {
  easy: {
    id: 'easy',
    label: '50cc Easy',
    cc: 50,
    speedMult: 0.78,
    aiBaseSpeedScale: 0.88,
    driftThreshold: 0.9,
    mtTargetTier: 1,
    shortcutEagerness: 0.15,
    itemAimAccuracy: 0.25,
    coinSeeking: 0.2,
    reactionDelay: 0.45,
    rocketStartChance: 0.15,
    trickChance: 0.2,
    apexSkill: 0.25,
  },
  medium: {
    id: 'medium',
    label: '100cc Medium',
    cc: 100,
    speedMult: 0.92,
    aiBaseSpeedScale: 0.96,
    driftThreshold: 0.52,
    mtTargetTier: 2,
    shortcutEagerness: 0.5,
    itemAimAccuracy: 0.55,
    coinSeeking: 0.5,
    reactionDelay: 0.24,
    rocketStartChance: 0.45,
    trickChance: 0.55,
    apexSkill: 0.6,
  },
  hard: {
    id: 'hard',
    label: '150cc Hard',
    cc: 150,
    speedMult: 1.08,
    aiBaseSpeedScale: 1.01,
    driftThreshold: 0.34,
    mtTargetTier: 2,
    shortcutEagerness: 0.82,
    itemAimAccuracy: 0.82,
    coinSeeking: 0.82,
    reactionDelay: 0.11,
    rocketStartChance: 0.78,
    trickChance: 0.85,
    apexSkill: 0.86,
  },
  master: {
    id: 'master',
    label: '200cc Master',
    cc: 200,
    speedMult: 1.24,
    aiBaseSpeedScale: 1.04,
    driftThreshold: 0.24,
    mtTargetTier: 3,
    shortcutEagerness: 0.96,
    itemAimAccuracy: 0.95,
    coinSeeking: 0.95,
    reactionDelay: 0.05,
    rocketStartChance: 0.92,
    trickChance: 0.96,
    apexSkill: 0.97,
  },
};

export type GraphicsPresetId = 'potato' | 'low' | 'medium' | 'high' | 'ultra';
export type ShadowMode = 'off' | 'blob' | 'low' | 'high' | 'ultra';
export type MaterialTier = 'flat' | 'lambert' | 'standard' | 'physical';

export interface GraphicsSettings {
  id: GraphicsPresetId | 'custom';
  presetId?: GraphicsPresetId | 'custom';
  label: string;
  desc: string;
  resScale: number;
  maxDpr: number;
  shadowMode: ShadowMode;
  materialTier: MaterialTier;
  bloom: boolean;
  speedFx: boolean;
  sceneryDensity: number;
  particleLevel: number;
  drawDistance: number;
  dynamicLights: boolean;
  fpsCap: number;
  pixelatedCanvas: boolean;
  anisotropy: number;
  toneMapping: boolean;
  showFps?: boolean;
}

export const GRAPHICS_PRESETS: Record<GraphicsPresetId, GraphicsSettings> = {
  potato: {
    id: 'potato',
    label: 'Potato (10-Gen Old CPU)',
    desc: '0.45x pixelated scale, unlit basic shaders, zero shadows, minimal scenery, 30 FPS cap.',
    resScale: 0.45,
    maxDpr: 1.0,
    shadowMode: 'off',
    materialTier: 'flat',
    bloom: false,
    speedFx: false,
    sceneryDensity: 0,
    particleLevel: 0,
    drawDistance: 420,
    dynamicLights: false,
    fpsCap: 30,
    pixelatedCanvas: true,
    anisotropy: 1,
    toneMapping: false,
  },
  low: {
    id: 'low',
    label: 'Low (Integrated GPU)',
    desc: '0.70x scale, fast Lambert lighting, blob kart shadows, sparse scenery, 60 FPS cap.',
    resScale: 0.7,
    maxDpr: 1.0,
    shadowMode: 'blob',
    materialTier: 'lambert',
    bloom: false,
    speedFx: false,
    sceneryDensity: 1,
    particleLevel: 1,
    drawDistance: 680,
    dynamicLights: false,
    fpsCap: 60,
    pixelatedCanvas: false,
    anisotropy: 2,
    toneMapping: false,
  },
  medium: {
    id: 'medium',
    label: 'Medium (Balanced)',
    desc: '1.0x native scale, Lambert/Standard shading, 1024px real-time shadows, boost FX.',
    resScale: 1.0,
    maxDpr: 1.25,
    shadowMode: 'low',
    materialTier: 'standard',
    bloom: false,
    speedFx: true,
    sceneryDensity: 2,
    particleLevel: 2,
    drawDistance: 1050,
    dynamicLights: false,
    fpsCap: 60,
    pixelatedCanvas: false,
    anisotropy: 4,
    toneMapping: true,
  },
  high: {
    id: 'high',
    label: 'High (Gaming GPU)',
    desc: '1.0x crisp scale (1.5x DPR), full PBR materials, 2048px soft shadows, bloom & lights.',
    resScale: 1.0,
    maxDpr: 1.5,
    shadowMode: 'high',
    materialTier: 'standard',
    bloom: true,
    speedFx: true,
    sceneryDensity: 3,
    particleLevel: 3,
    drawDistance: 1550,
    dynamicLights: true,
    fpsCap: 0,
    pixelatedCanvas: false,
    anisotropy: 8,
    toneMapping: true,
  },
  ultra: {
    id: 'ultra',
    label: 'Ultra (Current-Gen GPU)',
    desc: 'Up to 2.0x DPR, ACES Filmic HDR, clearcoat + env reflections, 4096px shadows, full bloom.',
    resScale: 1.15,
    maxDpr: 2.0,
    shadowMode: 'ultra',
    materialTier: 'physical',
    bloom: true,
    speedFx: true,
    sceneryDensity: 3,
    particleLevel: 3,
    drawDistance: 2200,
    dynamicLights: true,
    fpsCap: 0,
    pixelatedCanvas: false,
    anisotropy: 16,
    toneMapping: true,
  },
};

export const ITEM_IDS = {
  COIN: 'coin',
  BANANA: 'banana',
  GREEN_SHELL: 'green_shell',
  TRIPLE_GREEN: 'triple_green',
  RED_SHELL: 'red_shell',
  MUSHROOM: 'mushroom',
  TRIPLE_MUSHROOM: 'triple_mushroom',
  BOBOMB: 'bobomb',
  STAR: 'star',
  BLUE_SHELL: 'blue_shell',
  LIGHTNING: 'lightning',
} as const;

export type ItemId = (typeof ITEM_IDS)[keyof typeof ITEM_IDS];

export interface ItemMetaEntry {
  id: ItemId;
  name: string;
  short: string;
  color: string;
  icon: string;
  canTrail: boolean;
  count: number;
}

export const ITEM_META: Record<ItemId, ItemMetaEntry> = {
  [ITEM_IDS.COIN]: { id: ITEM_IDS.COIN, name: 'Coin', short: 'COIN', color: '#ffd60a', icon: '🪙', canTrail: false, count: 1 },
  [ITEM_IDS.BANANA]: { id: ITEM_IDS.BANANA, name: 'Banana', short: 'BANANA', color: '#ffe600', icon: '🍌', canTrail: true, count: 1 },
  [ITEM_IDS.GREEN_SHELL]: { id: ITEM_IDS.GREEN_SHELL, name: 'Green Shell', short: 'G-SHELL', color: '#34c759', icon: '🟢', canTrail: true, count: 1 },
  [ITEM_IDS.TRIPLE_GREEN]: { id: ITEM_IDS.TRIPLE_GREEN, name: 'Triple Green Shells', short: '3x SHELL', color: '#28cd41', icon: '❇️', canTrail: false, count: 3 },
  [ITEM_IDS.RED_SHELL]: { id: ITEM_IDS.RED_SHELL, name: 'Red Shell', short: 'R-SHELL', color: '#ff3b30', icon: '🔴', canTrail: true, count: 1 },
  [ITEM_IDS.MUSHROOM]: { id: ITEM_IDS.MUSHROOM, name: 'Dash Mushroom', short: 'BOOST', color: '#ff453a', icon: '🍄', canTrail: false, count: 1 },
  [ITEM_IDS.TRIPLE_MUSHROOM]: { id: ITEM_IDS.TRIPLE_MUSHROOM, name: 'Triple Mushrooms', short: '3x BOOST', color: '#ff6961', icon: '🍄×3', canTrail: false, count: 3 },
  [ITEM_IDS.BOBOMB]: { id: ITEM_IDS.BOBOMB, name: 'Bob-omb', short: 'BOMB', color: '#5e5ce6', icon: '💣', canTrail: true, count: 1 },
  [ITEM_IDS.STAR]: { id: ITEM_IDS.STAR, name: 'Super Star', short: 'STAR', color: '#ffcc00', icon: '⭐', canTrail: false, count: 1 },
  [ITEM_IDS.BLUE_SHELL]: { id: ITEM_IDS.BLUE_SHELL, name: 'Spiny Shell', short: 'SPINY', color: '#0a84ff', icon: '💠', canTrail: false, count: 1 },
  [ITEM_IDS.LIGHTNING]: { id: ITEM_IDS.LIGHTNING, name: 'Lightning Bolt', short: 'ZAP!', color: '#ffd426', icon: '⚡', canTrail: false, count: 1 },
};

export const SURFACE_TYPES = {
  ROAD: 'road',
  BOOST: 'boost',
  OFFROAD_GRASS: 'offroad_grass',
  OFFROAD_SAND: 'offroad_sand',
  OFFROAD_SNOW: 'offroad_snow',
  ICE: 'ice',
  COBBLE: 'cobble',
  WOOD: 'wood',
  RAINBOW: 'rainbow',
  VOID: 'void',
} as const;

export type SurfaceType = (typeof SURFACE_TYPES)[keyof typeof SURFACE_TYPES];

export const GRAND_PRIX_POINTS: readonly number[] = [15, 12, 10, 8, 6, 4, 2, 1];

export const BASE_RACE_CONFIG = {
  LAPS: 3,
  RACER_COUNT: 8,
  FIXED_DT: 1 / 60,
  BASE_MAX_SPEED: 62,
} as const;

export interface StatProfile {
  speed: number;
  accel: number;
  weight: number;
  handling: number;
  offroad: number;
  miniTurbo: number;
}

export interface CombinedStats {
  bars: StatProfile;
  maxSpeed: number;
  accel: number;
  weight: number;
  handling: number;
  driftSteer: number;
  offroadMult: number;
  mtChargeRate: number;
  mtDurationBonus: number;
}

export interface CharacterDef {
  id: string;
  name: string;
  weightClass: 'Light' | 'Medium' | 'Heavy';
  primaryColor: string | number;
  secondaryColor: string | number;
  accentColor: string | number;
  skinColor: string | number;
  headgear: string;
  tagline: string;
  stats: StatProfile;
}

export interface KartDef {
  id: string;
  name: string;
  style: string;
  tagline: string;
  stats: StatProfile;
}

export interface WheelDef {
  id: string;
  name: string;
  radius: number;
  width: number;
  tagline: string;
  stats: StatProfile;
}

/**
 * Combines Character + Kart Body + Wheel Style definitions into:
 * - normalized 1..10 UI display bars
 * - deterministic physics parameters consumed by physics.ts and ai.ts
 */
export function computeCombinedStats(
  charDef?: Partial<CharacterDef> | null,
  kartDef?: Partial<KartDef> | null,
  wheelDef?: Partial<WheelDef> | null
): CombinedStats {
  const c = charDef?.stats || { speed: 5, accel: 5, weight: 5, handling: 5, offroad: 5, miniTurbo: 5 };
  const k = kartDef?.stats || { speed: 5, accel: 5, weight: 5, handling: 5, offroad: 5, miniTurbo: 5 };
  const w = wheelDef?.stats || { speed: 5, accel: 5, weight: 5, handling: 5, offroad: 5, miniTurbo: 5 };

  const avg = (key: keyof StatProfile) => {
    const raw = c[key] * 0.42 + k[key] * 0.36 + w[key] * 0.22;
    return Math.max(1, Math.min(10, Math.round(raw * 10) / 10));
  };

  const bars: StatProfile = {
    speed: avg('speed'),
    accel: avg('accel'),
    weight: avg('weight'),
    handling: avg('handling'),
    offroad: avg('offroad'),
    miniTurbo: avg('miniTurbo'),
  };

  return {
    bars,
    maxSpeed: BASE_RACE_CONFIG.BASE_MAX_SPEED * (0.91 + (bars.speed / 10) * 0.17),
    accel: 34 + bars.accel * 4.2,
    weight: 0.75 + bars.weight * 0.065,
    handling: 1.55 + bars.handling * 0.14,
    driftSteer: 1.15 + bars.handling * 0.11,
    offroadMult: 0.48 + bars.offroad * 0.025,
    mtChargeRate: 0.82 + bars.miniTurbo * 0.04,
    mtDurationBonus: (bars.miniTurbo - 5) * 0.04,
  };
}

export interface TrackControlPoint {
  x: number;
  y: number;
  z: number;
  width?: number;
  bank?: number;
  surface?: SurfaceType | string;
  roadTexture?: string;
  offroadL?: number;
  offroadR?: number;
  wallL?: boolean;
  wallR?: boolean;
}

export interface ShortcutPoint {
  x: number;
  y: number;
  z: number;
  width: number;
  surface?: SurfaceType | string;
  roadTexture?: string;
}

export interface TrackShortcut {
  name: string;
  type: 'offroad' | 'ramp' | 'split';
  entryT: number;
  exitT: number;
  points: ShortcutPoint[];
  boostAtEntry?: boolean;
  isGlider?: boolean;
  requiresBoost?: boolean;
  rampU?: number;
  rampHeight?: number;
  rampLength?: number;
  roadTexture?: string;
  wallL?: boolean;
  wallR?: boolean;
}

export interface TrackBoostPadDef {
  t: number;
  lateral: number;
  width?: number;
  length?: number;
}

export interface TrackRampDef {
  t: number;
  lateral: number;
  width?: number;
  length?: number;
  height?: number;
  isGlider?: boolean;
}

export interface TrackItemBoxRowDef {
  t: number;
  count: number;
  spread?: number;
}

export interface TrackCoinLineDef {
  tStart: number;
  tEnd: number;
  lateral: number;
  lateralEnd?: number;
  count: number;
}

export interface TrackHazardDef {
  type: string;
  t: number;
  lateral: number;
  radius: number;
  moveAmp?: number;
  moveSpeed?: number;
  height?: number;
}

export interface TrackSkyColors {
  top: number;
  horizon: number;
  bottom: number;
  sunColor: number;
  sunPos: [number, number, number];
  fogColor: number;
  fogNear: number;
  fogFar: number;
}

export interface TrackBgmStyle {
  tempo: number;
  scale: number[];
  bassPattern: number[];
}

export interface TrackFrame {
  index: number;
  t: number;
  s: number;
  point: THREE.Vector3;
  tangent: THREE.Vector3;
  normal: THREE.Vector3;
  binormal: THREE.Vector3;
  width: number;
  halfWidth: number;
  bank: number;
  curvature: number;
  offroadL: number;
  offroadR: number;
  wallL: boolean;
  wallR: boolean;
  wallLatL: number;
  wallLatR: number;
  openMouthL: boolean;
  openMouthR: boolean;
  surface: SurfaceType | string;
  roadTexture: string;
}

export interface TrackQueryResult {
  frameIdx: number;
  t: number;
  s: number;
  point: THREE.Vector3;
  tangent: THREE.Vector3;
  normal: THREE.Vector3;
  binormal: THREE.Vector3;
  lateral: number;
  elevationDiff: number;
  halfWidth: number;
  offroadL: number;
  offroadR: number;
  wallL: boolean;
  wallR: boolean;
  wallLatL: number;
  wallLatR: number;
  surface: SurfaceType | string;
  onShortcut: boolean;
  shortcutData: RuntimeShortcut | null;
  isOverVoid: boolean;
}

export interface TrackItemBox {
  id: string;
  t: number;
  lateral: number;
  pos: THREE.Vector3;
  basePos: THREE.Vector3;
  normal: THREE.Vector3;
  radius: number;
  active: boolean;
  respawnTimer: number;
  mesh: THREE.Group;
  cubeMesh: THREE.Mesh;
  innerMesh: THREE.Group;
  boxMat: THREE.Material;
  phase: number;
}

export interface TrackCoin {
  id: string;
  t: number;
  lateral: number;
  pos: THREE.Vector3;
  basePos: THREE.Vector3;
  normal: THREE.Vector3;
  radius: number;
  active: boolean;
  respawnTimer: number;
  mesh: THREE.Group;
  phase: number;
}

export interface TrackBoostPad {
  id: string;
  t: number;
  s: number;
  lateral: number;
  width: number;
  length: number;
  pos: THREE.Vector3;
  tangent: THREE.Vector3;
  normal: THREE.Vector3;
  binormal: THREE.Vector3;
  frameIdx: number;
  onShortcut: boolean;
  shortcutName?: string;
  mesh: THREE.Group;
}

export interface TrackRamp {
  id: string;
  t: number;
  s: number;
  lateral: number;
  width: number;
  length: number;
  height: number;
  isGlider: boolean;
  pos: THREE.Vector3;
  entryPos: THREE.Vector3;
  launchPos: THREE.Vector3;
  tangent: THREE.Vector3;
  normal: THREE.Vector3;
  binormal: THREE.Vector3;
  frameIdx: number;
  onShortcut: boolean;
  shortcutName?: string;
  mesh: THREE.Group;
}

export interface TrackHazard {
  id: string;
  type: string;
  t: number;
  baseLateral: number;
  lateral: number;
  radius: number;
  hitRadius: number;
  yMin: number;
  yMax: number;
  active: boolean;
  height?: number;
  moveAmp: number;
  moveSpeed: number;
  pos: THREE.Vector3;
  basePos: THREE.Vector3;
  tangent: THREE.Vector3;
  normal: THREE.Vector3;
  binormal: THREE.Vector3;
  frameIdx: number;
  mesh: THREE.Group;
  subParts: Record<string, any>;
  phase: number;
}

export interface ShortcutFrame {
  index: number;
  u: number;
  s: number;
  point: THREE.Vector3;
  pos: THREE.Vector3;
  tangent: THREE.Vector3;
  normal: THREE.Vector3;
  binormal: THREE.Vector3;
  width: number;
  halfWidth: number;
  surface: SurfaceType | string;
  roadTexture: string;
}

export interface RuntimeShortcut {
  id: string;
  name: string;
  type: 'offroad' | 'ramp' | 'split';
  entryT: number;
  exitT: number;
  entryFrameIdx: number;
  exitFrameIdx: number;
  boostAtEntry: boolean;
  isGlider: boolean;
  requiresBoost: boolean;
  hasWalls: boolean;
  wallL: boolean;
  wallR: boolean;
  points: THREE.Vector3[];
  frames: ShortcutFrame[];
  totalLength: number;
  sample: (u: number) => ShortcutFrame;
  curve: THREE.CatmullRomCurve3;
}

export interface StartGridSlot {
  slot: number;
  t: number;
  lateral: number;
  pos: THREE.Vector3;
  tangent: THREE.Vector3;
  normal: THREE.Vector3;
  binormal: THREE.Vector3;
  heading: number;
  frameIdx: number;
}

export interface TrackDefinition {
  id: string;
  cupId: CupId;
  name: string;
  subtitle: string;
  themeColor: string;
  roadTexture?: string;
  curbTexture?: string;
  offroadTexture?: string;
  offroadSurface?: SurfaceType | string;
  floorY?: number;
  railColor?: number;
  deckColor?: number;
  skyColors: TrackSkyColors;
  ambientIntensity: number;
  dirLightColor: number;
  dirLightIntensity: number;
  bgmStyle: TrackBgmStyle;
  laps: number;
  controlPoints: TrackControlPoint[];
  shortcuts: TrackShortcut[];
  boostPads: TrackBoostPadDef[];
  ramps: TrackRampDef[];
  itemBoxRows: TrackItemBoxRowDef[];
  coinLines: TrackCoinLineDef[];
  hazards: TrackHazardDef[];
  buildScenery?: (
    sceneGroups: THREE.Group[],
    trackInstance: TrackInstance,
    texLib: any,
    gfx: any
  ) => ((dt: number, time: number) => void) | void;
}

export interface TrackInstance {
  def: TrackDefinition;
  rootGroup: THREE.Group;
  lodGroups: THREE.Group[];
  curve: THREE.CatmullRomCurve3;
  frames: TrackFrame[];
  totalLength: number;
  startGridSlots: StartGridSlot[];
  sampleFrame: (t: number) => TrackFrame;
  queryTrack: (pos: THREE.Vector3, hintIdx?: number) => TrackQueryResult;
  getSurfaceInfo: (pos: THREE.Vector3, hintIdx?: number) => TrackQueryResult;
  itemBoxes: TrackItemBox[];
  coins: TrackCoin[];
  boostPads: TrackBoostPad[];
  ramps: TrackRamp[];
  hazards: TrackHazard[];
  shortcuts: RuntimeShortcut[];
  update: (dt: number, time: number) => void;
  dispose: () => void;
}

export interface KartInput {
  throttle: number;
  steer: number;
  drift: boolean;
  driftJustPressed: boolean;
  trickJustPressed: boolean;
  useItem?: boolean;
  holdTrail?: boolean;
}

export interface RaceState {
  phase: 'countdown' | 'racing' | 'finished';
  raceTime: number;
  countdownRemaining?: number;
}

export interface PhysicsEvent {
  type: string;
  kartId?: string;
  [key: string]: any;
}

export interface KartState {
  id: string;
  name: string;
  isPlayer: boolean;
  charDef: CharacterDef;
  kartDef: KartDef;
  wheelDef: WheelDef;
  stats: CombinedStats;
  pos: THREE.Vector3;
  vel: THREE.Vector3;
  heading: number;
  pitch: number;
  roll: number;
  speed: number;
  steer: number;
  grounded: boolean;
  airTime: number;
  gliding: boolean;
  driftDir: number;
  driftTime: number;
  driftTier: number;
  boostTimer: number;
  boostStrength: number;
  starTimer: number;
  shrinkTimer: number;
  spinoutTimer: number;
  invulnTimer: number;
  rescueTimer: number;
  trickTimer: number;
  coins: number;
  item: ItemId | null;
  itemCount: number;
  itemRouletteTimer: number;
  rouletteDisplayItem: ItemId | null;
  trailingItem: ItemId | null;
  incomingBlueShellWarning: boolean;
  lap: number;
  maxProgress: number;
  totalProgress: number;
  rank: number;
  finished: boolean;
  finishTime: number;
  trackIdx: number;
  wrongWay: boolean;
  modelRig: any;
  _vy: number;
  _hopTimer: number;
  _rampCooldown: number;
  _trickWindowTimer: number;
  _trickBufferTimer: number;
  _tricked: boolean;
  _bumpCooldown: number;
  _padCooldown: number;
  _hazardCooldown: number;
  _postRescueTimer: number;
  _lastSafeIdx: number;
  _rescueStartPos: THREE.Vector3;
  _rescueTargetPos: THREE.Vector3;
  _rescueTargetHeading: number;
  _rescueTargetIdx: number;
  _lastT: number;
  _cpStage: number;
  _wrongWayTimer: number;
  _countdownThrottleTime: number;
  _countdownDone: boolean;
  _onShortcutFlag: boolean;
  _activeRamp?: TrackRamp | null;
  _activeRampStartY?: number;
  _justLaunchedRamp?: boolean;
  [key: string]: any;
}
