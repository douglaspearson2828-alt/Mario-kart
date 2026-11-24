import * as THREE from 'three';
import {
  BASE_RACE_CONFIG,
  SURFACE_TYPES,
  computeCombinedStats,
  type CharacterDef,
  type DifficultyConfig,
  type KartDef,
  type KartInput,
  type KartState,
  type PhysicsEvent,
  type RaceState,
  type TrackBoostPad,
  type TrackFrame,
  type TrackInstance,
  type TrackQueryResult,
  type TrackRamp,
  type WheelDef,
} from '../core/contracts';

export const KART_HALF_WIDTH = 0.96;
export const KART_HALF_LENGTH = 1.55;

const KART_CAPSULE_OFFSET = 0.62;
const KART_CAPSULE_RADIUS = 0.94;
const KART_COLLISION_HEIGHT = 1.85;
const GRAVITY = 44;
const HOP_DURATION = 0.18;
const HOP_IMPULSE = 8.4;
const MT_BLUE_TIME = 0.75;
const MT_ORANGE_TIME = 1.65;
const MT_PURPLE_TIME = 2.75;

const _tmpDelta = new THREE.Vector3();

export interface CreateKartParams {
  id: string;
  name: string;
  isPlayer?: boolean;
  charDef: CharacterDef;
  kartDef: KartDef;
  wheelDef: WheelDef;
  track?: TrackInstance | null;
  gridIndex?: number;
}

interface RampMatch {
  ramp: TrackRamp;
  u: number;
  baseY: number;
}

function clamp(v: number, min: number, max: number): number {
  return v < min ? min : v > max ? max : v;
}

function wrapAngle(a: number): number {
  while (a > Math.PI) a -= Math.PI * 2;
  while (a < -Math.PI) a += Math.PI * 2;
  return a;
}

function getFrameAt(track: TrackInstance | null | undefined, idx: number): TrackFrame | null {
  const frames = track?.frames;
  if (!frames || frames.length === 0) return null;
  const n = frames.length;
  return frames[((idx % n) + n) % n];
}

function emitEvent(eventsOut: PhysicsEvent[] | null | undefined, evt: PhysicsEvent): void {
  if (Array.isArray(eventsOut)) {
    eventsOut.push(evt);
  }
}

/**
 * Compute world surface Y directly under a track query point at its lateral offset.
 */
function computeSurfaceY(query: TrackQueryResult | null | undefined): number {
  if (!query || !query.point) return 0;
  const bY = query.binormal ? query.binormal.y : 0;
  return query.point.y + bY * (query.lateral || 0);
}

/**
 * Creates a fresh KartState matching contracts.ts and visual rig fields.
 */
export function createKartState({
  id,
  name,
  isPlayer = false,
  charDef,
  kartDef,
  wheelDef,
  track,
  gridIndex = 0,
}: CreateKartParams): KartState {
  const stats = computeCombinedStats(charDef, kartDef, wheelDef);
  const pos = new THREE.Vector3();
  const vel = new THREE.Vector3();

  let heading = 0;
  let trackIdx = 0;
  let initT = 0;
  let totalProgress = 0;

  if (track && track.startGridSlots && track.startGridSlots[gridIndex]) {
    const slot = track.startGridSlots[gridIndex];
    initT = slot.t ?? 0.99;
    pos.copy(slot.pos);
    pos.y += 0.05;
    heading = slot.heading ?? Math.atan2(slot.tangent.x, slot.tangent.z);
    trackIdx = slot.frameIdx ?? 0;
    totalProgress = initT - 1;
  } else if (track && track.frames && track.frames.length > 0) {
    const totalLen = track.totalLength || 1500;
    const row = Math.floor(gridIndex / 2);
    const col = gridIndex % 2;
    const sBack = 7.5 + row * 7.2 + col * 2.2;
    initT = ((1 - sBack / totalLen) % 1 + 1) % 1;

    const frame = track.sampleFrame
      ? track.sampleFrame(initT)
      : getFrameAt(track, Math.round(initT * track.frames.length));

    if (frame && frame.point) {
      const halfW = frame.halfWidth ?? 12;
      const latSign = col === 0 ? -1 : 1;
      const latOffset = latSign * Math.min(halfW * 0.45, 3.6);
      pos.copy(frame.point).addScaledVector(frame.binormal, latOffset);
      pos.y += 0.05;
      heading = Math.atan2(frame.tangent.x, frame.tangent.z);
      trackIdx = Math.round(initT * track.frames.length) % track.frames.length;
    }
    totalProgress = initT - 1;
  } else {
    pos.set(gridIndex % 2 === 0 ? -3.4 : 3.4, 0, -7.5 - Math.floor(gridIndex / 2) * 7.2);
    totalProgress = -0.01 * (gridIndex + 1);
  }

  return {
    id,
    name,
    isPlayer: Boolean(isPlayer),
    charDef,
    kartDef,
    wheelDef,
    stats,
    pos,
    vel,
    heading,
    pitch: 0,
    roll: 0,
    speed: 0,
    steer: 0,
    grounded: true,
    airTime: 0,
    gliding: false,
    driftDir: 0,
    driftTime: 0,
    driftTier: 0,
    boostTimer: 0,
    boostStrength: 0,
    starTimer: 0,
    shrinkTimer: 0,
    spinoutTimer: 0,
    invulnTimer: 0,
    rescueTimer: 0,
    trickTimer: 0,
    coins: 0,
    item: null,
    itemCount: 0,
    itemRouletteTimer: 0,
    rouletteDisplayItem: null,
    trailingItem: null,
    incomingBlueShellWarning: false,
    lap: 1,
    maxProgress: 0,
    totalProgress,
    rank: gridIndex + 1,
    finished: false,
    finishTime: 0,
    trackIdx,
    wrongWay: false,
    modelRig: null,

    // Internal simulation state
    _vy: 0,
    _hopTimer: 0,
    _rampCooldown: 0,
    _trickWindowTimer: 0,
    _trickBufferTimer: 0,
    _tricked: false,
    _lastSafeIdx: trackIdx,
    _lastT: initT,
    _cpStage: 0,
    _wrongWayTimer: 0,
    _countdownThrottleTime: 0,
    _countdownDone: false,
    _bumpCooldown: 0,
    _padCooldown: 0,
    _hazardCooldown: 0,
    _postRescueTimer: 0,
    _onShortcutFlag: false,
    _activeRamp: null,
    _activeRampStartY: 0,
    _justLaunchedRamp: false,
    _rescueStartPos: new THREE.Vector3(),
    _rescueTargetPos: new THREE.Vector3(),
    _rescueTargetHeading: heading,
    _rescueTargetIdx: trackIdx,
  };
}

/**
 * Evaluates countdown throttle hold duration and applies Rocket Start boost or over-rev burnout.
 */
export function applyCountdownRocketStart(
  kart: KartState,
  throttleHeldDuration?: number | null,
  rocketInput: { speedMult?: number } = {},
  eventsOut: PhysicsEvent[] | null = null
): 'none' | 'good' | 'perfect' | 'burnout' {
  if (!kart || kart._countdownDone) return 'none';
  kart._countdownDone = true;

  const held = Math.max(0, throttleHeldDuration ?? kart._countdownThrottleTime ?? 0);
  const diffMult = rocketInput?.speedMult ?? 1.0;
  const baseMax = kart.stats.maxSpeed * diffMult;

  // Over-revved from the start of the countdown (> 2.25s) -> burnout stall
  if (held > 2.25) {
    kart.spinoutTimer = 0.85;
    kart.boostTimer = 0;
    kart.speed = 0;
    emitEvent(eventsOut, { type: 'burnout', kartId: kart.id });
    return 'burnout';
  }

  // Sweet-spot hold (~0.70s .. 1.85s) -> Tier 2 Rocket Boost
  if (held >= 0.7 && held <= 1.85) {
    kart.boostTimer = 1.45;
    kart.boostStrength = 0.44;
    kart.speed = Math.max(kart.speed, baseMax * 1.15);
    kart.vel.set(Math.sin(kart.heading) * kart.speed, 0, Math.cos(kart.heading) * kart.speed);
    emitEvent(eventsOut, { type: 'rocket_start', kartId: kart.id, tier: 2 });
    return 'perfect';
  }

  // Partial timing (0.25s .. 0.70s or slightly late 1.85s .. 2.25s) -> Tier 1 mini-launch
  if (held >= 0.25) {
    kart.boostTimer = 0.8;
    kart.boostStrength = 0.30;
    kart.speed = Math.max(kart.speed, baseMax * 0.88);
    kart.vel.set(Math.sin(kart.heading) * kart.speed, 0, Math.cos(kart.heading) * kart.speed);
    emitEvent(eventsOut, { type: 'rocket_start', kartId: kart.id, tier: 1 });
    return 'good';
  }

  return 'none';
}

/**
 * Triggers Lakitu rescue back to the nearest safe road frame.
 */
function triggerRescue(
  kart: KartState,
  track: TrackInstance | null | undefined,
  query: TrackQueryResult | null | undefined,
  eventsOut: PhysicsEvent[] | null | undefined
): void {
  if (kart.rescueTimer > 0) return;

  kart.rescueTimer = 1.15;
  kart._postRescueTimer = 3.5;
  kart.coins = Math.max(0, kart.coins - 2);
  kart.driftDir = 0;
  kart.driftTime = 0;
  kart.driftTier = 0;
  kart.boostTimer = 0;
  kart.boostStrength = 0;
  kart.spinoutTimer = 0;
  kart.gliding = false;
  kart._hopTimer = 0;
  kart._tricked = false;
  kart._activeRamp = null;
  kart._activeRampStartY = 0;
  kart._justLaunchedRamp = false;
  kart._vy = 0;
  kart.speed = 0;
  kart.vel.set(0, 0, 0);
  kart.wrongWay = false;
  kart._wrongWayTimer = 0;

  let safeIdx = kart._lastSafeIdx ?? query?.frameIdx ?? 0;
  const frames = track?.frames;
  let safeFrame = getFrameAt(track, safeIdx);

  if (frames && safeFrame && safeFrame.surface === SURFACE_TYPES.VOID) {
    for (let offset = 1; offset < frames.length; offset++) {
      const candidate = getFrameAt(track, safeIdx - offset);
      if (candidate && candidate.surface !== SURFACE_TYPES.VOID) {
        safeIdx = ((safeIdx - offset) % frames.length + frames.length) % frames.length;
        safeFrame = candidate;
        break;
      }
    }
  }

  kart._rescueStartPos.copy(kart.pos);
  if (safeFrame && safeFrame.point) {
    kart._rescueTargetPos.copy(safeFrame.point).addScaledVector(safeFrame.normal, 0.3);
    kart._rescueTargetHeading = Math.atan2(safeFrame.tangent.x, safeFrame.tangent.z);
    kart._rescueTargetIdx = safeIdx;
  } else {
    kart._rescueTargetPos.copy(kart.pos);
    kart._rescueTargetPos.y = Math.max(0, kart.pos.y + 4);
    kart._rescueTargetHeading = kart.heading;
    kart._rescueTargetIdx = safeIdx;
  }

  emitEvent(eventsOut, { type: 'rescue', kartId: kart.id });
}

function triggerTrick(kart: KartState, eventsOut: PhysicsEvent[] | null | undefined): void {
  if (kart._tricked) return;
  kart._tricked = true;
  kart.trickTimer = 0.55;
  if (kart.gliding) {
    kart.boostTimer = Math.max(kart.boostTimer, 0.75);
    kart.boostStrength = Math.max(kart.boostStrength, 0.28);
  }
  emitEvent(eventsOut, { type: 'trick', kartId: kart.id });
}

function getBoostPadHit(
  kart: KartState,
  track: TrackInstance | null | undefined,
  query: TrackQueryResult | null | undefined
): TrackBoostPad | null {
  const pads = track?.boostPads;
  if (!pads || pads.length === 0) return null;

  for (let i = 0; i < pads.length; i++) {
    const pad = pads[i];
    const halfW = (pad.width ?? 4.6) * 0.5 + 0.45;
    const halfL = (pad.length ?? 8.5) * 0.5 + 0.6;

    if (pad.pos) {
      _tmpDelta.subVectors(kart.pos, pad.pos);
      if (Math.abs(_tmpDelta.y) > 2.4) continue;

      if (pad.tangent && pad.binormal) {
        const along = Math.abs(_tmpDelta.dot(pad.tangent));
        const across = Math.abs(_tmpDelta.dot(pad.binormal));
        if (along <= halfL && across <= halfW) return pad;
      } else if (_tmpDelta.x * _tmpDelta.x + _tmpDelta.z * _tmpDelta.z <= halfW * halfW + halfL * halfL * 0.5) {
        return pad;
      }
    } else if (query && track?.totalLength) {
      let ds = query.s - pad.t * track.totalLength;
      if (ds > track.totalLength * 0.5) ds -= track.totalLength;
      if (ds < -track.totalLength * 0.5) ds += track.totalLength;
      if (Math.abs(ds) <= halfL && Math.abs((query.lateral || 0) - (pad.lateral || 0)) <= halfW) {
        return pad;
      }
    }
  }
  return null;
}

function getRampMatch(
  kart: KartState,
  track: TrackInstance | null | undefined,
  query: TrackQueryResult | null | undefined
): RampMatch | null {
  const ramps = track?.ramps;
  if (!ramps || ramps.length === 0) return null;

  for (let i = 0; i < ramps.length; i++) {
    const ramp = ramps[i];
    const len = ramp.length ?? 9;
    const wid = ramp.width ?? 6.5;
    const height = ramp.height ?? 3.5;

    if (ramp.pos && ramp.tangent && ramp.binormal) {
      _tmpDelta.subVectors(kart.pos, ramp.pos);
      const vert = Math.abs(_tmpDelta.y);
      if (vert > height + 2.4) continue;

      const along = _tmpDelta.dot(ramp.tangent);
      const acrossSigned = _tmpDelta.dot(ramp.binormal);
      const across = Math.abs(acrossSigned);
      if (across <= wid * 0.5 + 0.45 && along >= -len * 0.5 && along <= len * 0.55) {
        const u = clamp((along + len * 0.5) / len, 0, 1);
        const baseY = ramp.pos.y + ramp.tangent.y * along + ramp.binormal.y * acrossSigned;
        return { ramp, u, baseY };
      }
    } else if (query && track?.totalLength) {
      let ds = query.s - ramp.t * track.totalLength;
      if (ds > track.totalLength * 0.5) ds -= track.totalLength;
      if (ds < -track.totalLength * 0.5) ds += track.totalLength;
      if (ds >= -len * 0.5 && ds <= len * 0.55 && Math.abs((query.lateral || 0) - (ramp.lateral || 0)) <= wid * 0.5 + 0.45) {
        const u = clamp((ds + len * 0.5) / len, 0, 1);
        return { ramp, u, baseY: computeSurfaceY(query) };
      }
    }
  }
  return null;
}

/**
 * Checks if a kart that was climbing `ramp` just crossed past its launch lip in one step.
 */
function hasCrossedRampLip(
  kart: KartState,
  ramp: TrackRamp,
  track: TrackInstance | null | undefined,
  query: TrackQueryResult | null | undefined
): { crossed: boolean; launchSurfaceY: number } {
  const len = ramp.length ?? 9;
  const wid = ramp.width ?? 6.5;
  const height = ramp.height ?? 3.5;

  if (ramp.pos && ramp.tangent && ramp.binormal) {
    _tmpDelta.subVectors(kart.pos, ramp.pos);
    if (Math.abs(_tmpDelta.y) > height + 3.0) {
      return { crossed: false, launchSurfaceY: kart.pos.y };
    }
    const along = _tmpDelta.dot(ramp.tangent);
    const acrossSigned = _tmpDelta.dot(ramp.binormal);
    const across = Math.abs(acrossSigned);
    if (along >= len * 0.42 && along <= len * 1.15 && across <= wid * 0.5 + 0.95) {
      const baseY = ramp.pos.y + ramp.tangent.y * (len * 0.5) + ramp.binormal.y * acrossSigned;
      return { crossed: true, launchSurfaceY: baseY + height };
    }
    return { crossed: false, launchSurfaceY: kart.pos.y };
  }

  if (query && track?.totalLength) {
    let ds = query.s - ramp.t * track.totalLength;
    if (ds > track.totalLength * 0.5) ds -= track.totalLength;
    if (ds < -track.totalLength * 0.5) ds += track.totalLength;
    if (ds >= len * 0.42 && ds <= len * 1.15 && Math.abs((query.lateral || 0) - (ramp.lateral || 0)) <= wid * 0.5 + 0.95) {
      const baseY = kart._activeRampStartY ?? computeSurfaceY(query);
      return { crossed: true, launchSurfaceY: baseY + height };
    }
  }
  return { crossed: false, launchSurfaceY: kart.pos.y };
}

function launchFromRamp(
  kart: KartState,
  ramp: TrackRamp,
  launchSurfaceY: number,
  eventsOut: PhysicsEvent[] | null | undefined
): void {
  const rampHeight = ramp.height ?? 3.5;
  const launchVy = Math.max(15.5, 11.5 + rampHeight * 2.1 + Math.min(Math.max(0, kart.speed), 90) * 0.14);
  kart.pos.y = Math.max(kart.pos.y, launchSurfaceY);
  kart._vy = launchVy;
  kart.grounded = false;
  kart._hopTimer = 0;
  kart._rampCooldown = 0.45;
  kart._trickWindowTimer = 0.28;
  kart._tricked = false;
  kart._activeRamp = null;
  kart._activeRampStartY = 0;
  kart._justLaunchedRamp = true;

  if (ramp.isGlider) {
    kart.gliding = true;
    kart._vy = Math.max(kart._vy, 16.5);
    emitEvent(eventsOut, { type: 'glider_open', kartId: kart.id });
  } else {
    emitEvent(eventsOut, { type: 'ramp_launch', kartId: kart.id });
  }

  if (kart._trickBufferTimer > 0) {
    triggerTrick(kart, eventsOut);
  }
}

/**
 * Applies left (-1) or right (+1) visual-matched guardrail sliding or open-edge void check.
 */
function applyWallConstraint(
  kart: KartState,
  postQ: TrackQueryResult,
  wallLat: number,
  outerLat: number,
  hasWall: boolean,
  sideSign: -1 | 1,
  eventsOut: PhysicsEvent[] | null | undefined
): boolean {
  const signedLat = (postQ.lateral ?? 0) * sideSign;
  if (hasWall) {
    const limit = wallLat - KART_HALF_WIDTH;
    if (signedLat > limit) {
      const pushIn = (limit - signedLat) * sideSign;
      kart.pos.addScaledVector(postQ.binormal, pushIn);

      const outVel = (kart.vel.x * postQ.binormal.x + kart.vel.z * postQ.binormal.z) * sideSign;
      if (outVel > 0) {
        const pushVel = -outVel * 1.25 * sideSign;
        kart.vel.x += postQ.binormal.x * pushVel;
        kart.vel.z += postQ.binormal.z * pushVel;
        kart.vel.x *= 0.94;
        kart.vel.z *= 0.94;
        kart.speed = Math.hypot(kart.vel.x, kart.vel.z) * (kart.speed >= 0 ? 1 : -1);

        const trackYaw = Math.atan2(postQ.tangent.x, postQ.tangent.z);
        const yawDiff = wrapAngle(trackYaw - kart.heading);
        if (Math.abs(yawDiff) < Math.PI * 0.48) {
          kart.heading = wrapAngle(kart.heading + yawDiff * 0.22);
        }

        if (outVel > 7) {
          emitEvent(eventsOut, { type: 'wall_hit', kartId: kart.id });
        }
      }
    }
    return false;
  }

  return signedLat > outerLat + 0.35;
}

function collectTrackCoinsAndCheckHazards(
  kart: KartState,
  track: TrackInstance | null | undefined,
  eventsOut: PhysicsEvent[] | null | undefined
): void {
  // World coins
  const coins = track?.coins;
  if (coins && coins.length > 0) {
    for (let i = 0; i < coins.length; i++) {
      const coin = coins[i];
      if (!coin.active || !coin.pos) continue;
      const dx = kart.pos.x - coin.pos.x;
      const dy = kart.pos.y - coin.pos.y;
      const dz = kart.pos.z - coin.pos.z;
      const r = (coin.radius ?? 0.85) + KART_HALF_WIDTH;
      if (Math.abs(dy) < 1.9 && dx * dx + dz * dz <= r * r) {
        coin.active = false;
        coin.respawnTimer = 4.0;
        if (coin.mesh) coin.mesh.visible = false;

        kart.coins = Math.min(10, kart.coins + 1);
        kart.speed += 1.6;
        emitEvent(eventsOut, { type: 'coin', kartId: kart.id, coins: kart.coins, pos: coin.pos });
      }
    }
  }

  // Track hazards (Thwomps, boulders, lava geysers, crabs, cyber drones, etc.)
  const hazards = track?.hazards;
  if (hazards && hazards.length > 0 && kart._hazardCooldown <= 0) {
    for (let i = 0; i < hazards.length; i++) {
      const h = hazards[i];
      if (!h.pos || h.active === false) continue;

      const hYMin = h.yMin ?? h.pos.y - 1.5;
      const hYMax = h.yMax ?? h.pos.y + 3.4;
      if (!(kart.pos.y < hYMax && kart.pos.y + 1.8 > hYMin)) continue;

      const dx = kart.pos.x - h.pos.x;
      const dz = kart.pos.z - h.pos.z;
      const r = (h.hitRadius ?? (h.radius ?? 2.0) * 0.82) + KART_HALF_WIDTH;
      if (dx * dx + dz * dz <= r * r) {
        if (kart.starTimer > 0) {
          kart._hazardCooldown = 0.4;
          emitEvent(eventsOut, { type: 'hazard_smash', kartId: kart.id, hazardType: h.type, pos: h.pos });
          break;
        }
        if (kart.invulnTimer <= 0) {
          kart._hazardCooldown = 0.6;
          kart.spinoutTimer = 1.15;
          kart.invulnTimer = 1.75;
          kart.driftDir = 0;
          kart.driftTime = 0;
          kart.driftTier = 0;
          kart.boostTimer = 0;
          kart._activeRamp = null;
          kart.coins = Math.max(0, kart.coins - 2);
          kart.speed *= 0.25;
          kart.vel.multiplyScalar(0.25);
          emitEvent(eventsOut, { type: 'hit', kartId: kart.id, source: h.type || 'hazard', pos: kart.pos.clone() });
          break;
        }
      }
    }
  }
}

function updateLapAndProgress(
  kart: KartState,
  track: TrackInstance | null | undefined,
  query: TrackQueryResult | null | undefined,
  raceState: RaceState | null | undefined,
  eventsOut: PhysicsEvent[] | null | undefined
): void {
  if (!query || !track) return;
  const totalLaps = track.def?.laps || BASE_RACE_CONFIG.LAPS;
  const t = clamp(query.t ?? 0, 0, 0.999999);
  const prevT = kart._lastT ?? t;

  // Monotonic checkpoint gates (0.25, 0.50, 0.75) allow shortcuts while blocking reverse lap cheating
  if (!kart.finished) {
    if (kart._cpStage === 0 && t >= 0.22 && t < 0.70) {
      kart._cpStage = 1;
    }
    if (kart._cpStage === 1 && t >= 0.48 && t < 0.88) {
      kart._cpStage = 2;
    }
    if (kart._cpStage === 2 && t >= 0.72) {
      kart._cpStage = 3;
    }

    // Valid lap crossing from near t=1 across t=0 only after all 3 checkpoints are cleared
    if (kart._cpStage === 3 && prevT > 0.75 && t < 0.25) {
      if (kart.lap < totalLaps) {
        kart.lap += 1;
        kart._cpStage = 0;
        emitEvent(eventsOut, {
          type: 'lap',
          kartId: kart.id,
          lap: kart.lap,
          isFinalLap: kart.lap === totalLaps,
        });
      } else {
        kart.finished = true;
        kart.finishTime = raceState?.raceTime ?? 0;
        kart.totalProgress = totalLaps + t;
        kart.maxProgress = Math.max(kart.maxProgress, kart.totalProgress);
        emitEvent(eventsOut, {
          type: 'finish',
          kartId: kart.id,
          finishTime: kart.finishTime,
        });
      }
    }
  }

  if (!kart.finished) {
    const lapFrac = kart._cpStage === 0 && t > 0.78 ? t - 1 : t;
    kart.totalProgress = kart.lap - 1 + lapFrac;
    kart.maxProgress = Math.max(kart.maxProgress, kart.totalProgress);
  } else {
    const postLapFrac = kart._cpStage === 0 && t > 0.78 ? t - 1 : t;
    kart.totalProgress = totalLaps + Math.max(0, postLapFrac);
  }

  kart._lastT = t;

  // Wrong-way detection (ignore during spinout, rescue, or stationary)
  if (query.tangent && kart.rescueTimer <= 0 && kart.spinoutTimer <= 0 && !kart.finished) {
    const fwdX = Math.sin(kart.heading);
    const fwdZ = Math.cos(kart.heading);
    const tLen = Math.hypot(query.tangent.x, query.tangent.z) || 1;
    const dot = (fwdX * query.tangent.x + fwdZ * query.tangent.z) / tLen;

    if (dot < -0.35 && Math.abs(kart.speed) > 4) {
      kart._wrongWayTimer += BASE_RACE_CONFIG.FIXED_DT;
      if (kart._wrongWayTimer > 0.45) {
        kart.wrongWay = true;
      }
    } else if (dot > 0.1 || Math.abs(kart.speed) < 2) {
      kart._wrongWayTimer = 0;
      kart.wrongWay = false;
    }
  } else {
    kart._wrongWayTimer = 0;
    kart.wrongWay = false;
  }
}

function applyStarKnockout(
  victim: KartState,
  attacker: KartState,
  pushNx: number,
  pushNz: number,
  eventsOut: PhysicsEvent[] | null | undefined
): void {
  victim.spinoutTimer = 1.15;
  victim.invulnTimer = 1.65;
  victim.driftDir = 0;
  victim.driftTime = 0;
  victim.driftTier = 0;
  victim.boostTimer = 0;
  victim.coins = Math.max(0, victim.coins - 2);
  victim.speed *= 0.3;
  victim.vel.x += pushNx * 16;
  victim.vel.z += pushNz * 16;
  emitEvent(eventsOut, {
    type: 'hit',
    kartId: victim.id,
    byKartId: attacker.id,
    source: 'star',
    pos: victim.pos.clone(),
  });
}

function closestSegmentPairXZ(
  ax: number,
  az: number,
  fxA: number,
  fzA: number,
  halfLenA: number,
  bx: number,
  bz: number,
  fxB: number,
  fzB: number,
  halfLenB: number
): { dx: number; dz: number; distSq: number } {
  const rx = ax - bx;
  const rz = az - bz;
  const e = fxA * fxB + fzA * fzB;
  const c1 = fxA * rx + fzA * rz;
  const c2 = fxB * rx + fzB * rz;
  const denom = 1 - e * e;

  let s = denom > 1e-6 ? clamp((e * c2 - c1) / denom, -halfLenA, halfLenA) : 0;
  let t = clamp(s * e + c2, -halfLenB, halfLenB);
  const sNew = clamp(t * e - c1, -halfLenA, halfLenA);
  if (sNew !== s) {
    s = sNew;
    t = clamp(s * e + c2, -halfLenB, halfLenB);
  }

  const dx = ax + s * fxA - (bx + t * fxB);
  const dz = az + s * fzA - (bz + t * fzB);
  return { dx, dz, distSq: dx * dx + dz * dz };
}

/**
 * Resolves oriented capsule kart-to-kart collisions (weight-based push + Super Star knockouts).
 */
function resolveKartCollisions(
  kart: KartState,
  allKarts: KartState[] | null | undefined,
  eventsOut: PhysicsEvent[] | null | undefined
): void {
  if (!allKarts || allKarts.length <= 1 || kart.rescueTimer > 0) return;

  const scaleA = kart.shrinkTimer > 0 ? 0.65 : 1.0;
  const offA = KART_CAPSULE_OFFSET * scaleA;
  const rA = KART_CAPSULE_RADIUS * scaleA;
  const fxA = Math.sin(kart.heading);
  const fzA = Math.cos(kart.heading);

  for (let i = 0; i < allKarts.length; i++) {
    const other = allKarts[i];
    if (!other || other === kart || other.rescueTimer > 0) continue;

    const dy = Math.abs(kart.pos.y - other.pos.y);
    if (dy > KART_COLLISION_HEIGHT) continue;

    const scaleB = other.shrinkTimer > 0 ? 0.65 : 1.0;
    const offB = KART_CAPSULE_OFFSET * scaleB;
    const rB = KART_CAPSULE_RADIUS * scaleB;
    const minDist = rA + rB;
    const minDistSq = minDist * minDist;

    // Coarse XZ broadphase before exact oriented capsule segment distance
    const centerDx = kart.pos.x - other.pos.x;
    const centerDz = kart.pos.z - other.pos.z;
    const maxReach = offA + offB + minDist;
    if (centerDx * centerDx + centerDz * centerDz >= maxReach * maxReach) continue;

    const fxB = Math.sin(other.heading);
    const fzB = Math.cos(other.heading);

    const { dx, dz, distSq } = closestSegmentPairXZ(
      kart.pos.x,
      kart.pos.z,
      fxA,
      fzA,
      offA,
      other.pos.x,
      other.pos.z,
      fxB,
      fzB,
      offB
    );
    if (distSq >= minDistSq) continue;

    const dist = Math.sqrt(distSq);
    const overlap = minDist - dist;
    let nx: number;
    let nz: number;
    if (dist > 1e-4) {
      nx = dx / dist;
      nz = dz / dist;
    } else {
      const cDist = Math.hypot(centerDx, centerDz);
      if (cDist > 1e-4) {
        nx = centerDx / cDist;
        nz = centerDz / cDist;
      } else {
        nx = fzA;
        nz = -fxA;
      }
    }

    const wA = kart.stats.weight * (kart.shrinkTimer > 0 ? 0.55 : 1.0);
    const wB = other.stats.weight * (other.shrinkTimer > 0 ? 0.55 : 1.0);
    const totalW = wA + wB || 1;
    const shareA = wB / totalW;
    const shareB = wA / totalW;

    // Positional separation
    kart.pos.x += nx * overlap * shareA;
    kart.pos.z += nz * overlap * shareA;
    other.pos.x -= nx * overlap * shareB;
    other.pos.z -= nz * overlap * shareB;

    // Velocity exchange along contact normal
    const relVx = kart.vel.x - other.vel.x;
    const relVz = kart.vel.z - other.vel.z;
    const sepVel = relVx * nx + relVz * nz;
    if (sepVel < 0) {
      const impulse = -sepVel * 0.85;
      kart.vel.x += nx * impulse * shareA;
      kart.vel.z += nz * impulse * shareA;
      other.vel.x -= nx * impulse * shareB;
      other.vel.z -= nz * impulse * shareB;

      if (impulse > 5 && kart._bumpCooldown <= 0) {
        kart._bumpCooldown = 0.25;
        emitEvent(eventsOut, { type: 'bump', kartId: kart.id, otherId: other.id });
      }
    }

    // Super Star knockout
    if (kart.starTimer > 0 && other.starTimer <= 0 && other.invulnTimer <= 0) {
      applyStarKnockout(other, kart, -nx, -nz, eventsOut);
    } else if (other.starTimer > 0 && kart.starTimer <= 0 && kart.invulnTimer <= 0) {
      applyStarKnockout(kart, other, nx, nz, eventsOut);
    }
  }
}

/**
 * Advances one kart by fixed step `dt` (typically 1/60s).
 */
export function stepKartPhysics(
  kart: KartState,
  input: Partial<KartInput> | null | undefined,
  track: TrackInstance | null | undefined,
  diffConfig: DifficultyConfig | null | undefined,
  allKarts: KartState[] | null | undefined,
  dt: number,
  raceState?: RaceState | null,
  eventsOut?: PhysicsEvent[] | null
): void {
  if (!kart || dt <= 0) return;

  kart._justLaunchedRamp = false;

  const safeInput = input || {};
  const throttle = clamp(safeInput.throttle ?? 0, -1, 1);
  const steer = clamp(safeInput.steer ?? 0, -1, 1);
  const driftHeld = Boolean(safeInput.drift);
  const driftJustPressed = Boolean(safeInput.driftJustPressed);
  const trickJustPressed = Boolean(safeInput.trickJustPressed);

  kart.steer = steer;

  // Countdown phase: keep kart locked on grid, track rev hold duration for Rocket Start
  if (raceState && raceState.phase === 'countdown') {
    if (throttle > 0.25) {
      kart._countdownThrottleTime += dt;
    } else {
      kart._countdownThrottleTime = Math.max(0, kart._countdownThrottleTime - dt * 1.4);
    }
    kart.speed = 0;
    kart.vel.set(0, 0, 0);
    return;
  }

  // Trigger Rocket Start automatically on countdown -> racing transition if not already called
  if ((!raceState || raceState.phase === 'racing') && !kart._countdownDone) {
    applyCountdownRocketStart(kart, kart._countdownThrottleTime, { speedMult: diffConfig?.speedMult ?? 1.0 }, eventsOut);
  }

  // Tick status & cooldown timers
  if (kart.boostTimer > 0) {
    kart.boostTimer = Math.max(0, kart.boostTimer - dt);
    if (kart.boostTimer === 0) kart.boostStrength = 0;
  }
  if (kart.starTimer > 0) kart.starTimer = Math.max(0, kart.starTimer - dt);
  if (kart.shrinkTimer > 0) kart.shrinkTimer = Math.max(0, kart.shrinkTimer - dt);
  if (kart.spinoutTimer > 0) kart.spinoutTimer = Math.max(0, kart.spinoutTimer - dt);
  if (kart.invulnTimer > 0) kart.invulnTimer = Math.max(0, kart.invulnTimer - dt);
  if (kart.trickTimer > 0) kart.trickTimer = Math.max(0, kart.trickTimer - dt);
  if (kart._rampCooldown > 0) kart._rampCooldown = Math.max(0, kart._rampCooldown - dt);
  if (kart._trickWindowTimer > 0) kart._trickWindowTimer = Math.max(0, kart._trickWindowTimer - dt);
  if (kart._trickBufferTimer > 0) kart._trickBufferTimer = Math.max(0, kart._trickBufferTimer - dt);
  if (kart._bumpCooldown > 0) kart._bumpCooldown = Math.max(0, kart._bumpCooldown - dt);
  if (kart._padCooldown > 0) kart._padCooldown = Math.max(0, kart._padCooldown - dt);
  if (kart._hazardCooldown > 0) kart._hazardCooldown = Math.max(0, kart._hazardCooldown - dt);
  if (kart._postRescueTimer > 0) kart._postRescueTimer = Math.max(0, kart._postRescueTimer - dt);

  if (trickJustPressed) {
    kart._trickBufferTimer = 0.22;
    if (kart._trickWindowTimer > 0 && !kart.grounded) {
      triggerTrick(kart, eventsOut);
    }
  }

  // Handle active rescue sequence (Lakitu drop back onto track)
  if (kart.rescueTimer > 0) {
    kart.rescueTimer = Math.max(0, kart.rescueTimer - dt);
    const progress = 1 - kart.rescueTimer / 1.15;
    kart.pos.lerpVectors(kart._rescueStartPos, kart._rescueTargetPos, clamp(progress * 1.15, 0, 1));
    kart.pos.y += Math.sin(clamp(progress, 0, 1) * Math.PI) * 5.2;
    kart.heading = kart.heading + wrapAngle(kart._rescueTargetHeading - kart.heading) * Math.min(1, dt * 8);
    kart.pitch = 0;
    kart.roll = 0;

    if (kart.rescueTimer === 0) {
      kart.pos.copy(kart._rescueTargetPos);
      kart.heading = kart._rescueTargetHeading;
      kart.trackIdx = kart._rescueTargetIdx;
      kart.grounded = true;
      kart.invulnTimer = 1.6;
      const frame = getFrameAt(track, kart.trackIdx);
      if (frame) kart._lastT = frame.t;
    }
    return;
  }

  const wasGrounded = kart.grounded;
  const wasHopping = kart._hopTimer > 0;
  const wasAirTime = kart.airTime;
  const prevActiveRamp = kart._activeRamp ?? null;

  // Query track geometry around current position
  const query = track && track.queryTrack ? track.queryTrack(kart.pos, kart.trackIdx) : null;
  if (query) {
    kart.trackIdx = query.frameIdx;
    if (query.onShortcut && !kart._onShortcutFlag) {
      kart._onShortcutFlag = true;
      emitEvent(eventsOut, { type: 'shortcut', kartId: kart.id, name: query.shortcutData?.name || 'Shortcut' });
    } else if (!query.onShortcut) {
      kart._onShortcutFlag = false;
    }
  }

  const surface = query?.surface || SURFACE_TYPES.ROAD;
  const isOffroad =
    surface === SURFACE_TYPES.OFFROAD_GRASS ||
    surface === SURFACE_TYPES.OFFROAD_SAND ||
    surface === SURFACE_TYPES.OFFROAD_SNOW;
  const isIce = surface === SURFACE_TYPES.ICE;

  // Boost pad detection (surface flag OR explicit boostPads proximity)
  if (kart._padCooldown <= 0 && (surface === SURFACE_TYPES.BOOST || getBoostPadHit(kart, track, query))) {
    if (kart.grounded || kart.airTime < 0.25) {
      kart._padCooldown = 0.35;
      kart.boostTimer = Math.max(kart.boostTimer, 0.9);
      kart.boostStrength = Math.max(kart.boostStrength, 0.36);
      const padCap = kart.stats.maxSpeed * (diffConfig?.speedMult ?? 1.0) * (1 + kart.boostStrength);
      kart.speed = Math.max(kart.speed, padCap * 0.85);
      emitEvent(eventsOut, { type: 'boost_pad', kartId: kart.id });
    }
  }

  // Hop & Drift state machine
  if (kart.spinoutTimer > 0) {
    kart.driftDir = 0;
    kart.driftTime = 0;
    kart.driftTier = 0;
    kart._hopTimer = 0;
  } else {
    // Initiate hop on driftJustPressed while grounded
    if (driftJustPressed && kart.grounded && kart._hopTimer <= 0 && !kart.gliding) {
      kart._hopTimer = HOP_DURATION;
      kart._vy = HOP_IMPULSE;
      kart.grounded = false;
      emitEvent(eventsOut, { type: 'hop', kartId: kart.id });
    }

    if (kart._hopTimer > 0) {
      kart._hopTimer = Math.max(0, kart._hopTimer - dt);
    }

    // Engage drift lock when steering while landing from hop (or right as hop completes)
    if (kart.driftDir === 0 && driftHeld && Math.abs(steer) > 0.16 && kart.speed > 14 && !kart.gliding) {
      if (kart.grounded || kart._hopTimer <= 0.04) {
        kart.driftDir = steer < 0 ? -1 : 1;
        kart.driftTime = 0;
        kart.driftTier = 0;
      }
    }

    // Active drift charging & release
    if (kart.driftDir !== 0) {
      if (!driftHeld || kart.speed < 10 || kart.gliding) {
        if (driftHeld === false && kart.driftTier > 0) {
          const tier = kart.driftTier;
          const bonus = kart.stats.mtDurationBonus || 0;
          const durations = [0, 0.65 + bonus, 1.25 + bonus, 2.0 + bonus];
          const strengths = [0, 0.25, 0.33, 0.42];
          kart.boostTimer = Math.max(kart.boostTimer, durations[tier]);
          kart.boostStrength = Math.max(kart.boostStrength, strengths[tier]);
          const boostCap = kart.stats.maxSpeed * (diffConfig?.speedMult ?? 1.0) * (1 + kart.boostStrength);
          kart.speed = Math.max(kart.speed, boostCap * 0.82);
          emitEvent(eventsOut, { type: 'mt_release', kartId: kart.id, tier });
        }
        kart.driftDir = 0;
        kart.driftTime = 0;
        kart.driftTier = 0;
      } else if (kart.grounded) {
        const intoDrift = kart.driftDir * steer;
        const chargeMult = 1.0 + intoDrift * 0.32;
        kart.driftTime += dt * kart.stats.mtChargeRate * chargeMult;

        let newTier = 0;
        if (kart.driftTime >= MT_PURPLE_TIME) newTier = 3;
        else if (kart.driftTime >= MT_ORANGE_TIME) newTier = 2;
        else if (kart.driftTime >= MT_BLUE_TIME) newTier = 1;

        if (newTier > kart.driftTier) {
          kart.driftTier = newTier;
          emitEvent(eventsOut, { type: 'mt_charge', kartId: kart.id, tier: newTier });
        }
      }
    }
  }

  // Calculate speed cap & forward speed acceleration
  const diffMult = diffConfig?.speedMult ?? 1.0;
  const coinBonus = 1 + Math.min(10, Math.max(0, kart.coins)) * 0.01;
  const baseMax = kart.stats.maxSpeed * diffMult * coinBonus;
  const shrinkMult = kart.shrinkTimer > 0 ? 0.72 : 1.0;
  const offroadMult =
    isOffroad && kart.grounded && kart.boostTimer <= 0 && kart.starTimer <= 0 ? kart.stats.offroadMult : 1.0;

  let boostMult = 1.0;
  if (kart.starTimer > 0) boostMult = Math.max(boostMult, 1.30);
  if (kart.boostTimer > 0) boostMult = Math.max(boostMult, 1.0 + (kart.boostStrength || 0.32));

  let effectiveMax = baseMax * shrinkMult * offroadMult * boostMult;
  if (kart.gliding) effectiveMax = Math.max(effectiveMax, baseMax * 0.96);

  if (kart.spinoutTimer > 0) {
    kart.speed *= Math.max(0, 1 - 4.2 * dt);
  } else if (kart.boostTimer > 0 || kart.starTimer > 0) {
    const accelRate = kart.stats.accel * 2.1;
    if (kart.speed < effectiveMax) {
      kart.speed = Math.min(effectiveMax, kart.speed + accelRate * dt);
    } else {
      kart.speed -= (kart.speed - effectiveMax) * Math.min(1, 3.0 * dt);
    }
  } else if (throttle > 0.02) {
    const accelRate =
      kart.stats.accel *
      (diffMult > 1 ? 1 + (diffMult - 1) * 0.65 : 1) *
      (kart.shrinkTimer > 0 ? 0.75 : 1);
    if (kart.speed < effectiveMax) {
      kart.speed = Math.min(effectiveMax, kart.speed + accelRate * throttle * dt);
    } else {
      const decelRate = isOffroad ? 5.8 : 3.2;
      kart.speed -= (kart.speed - effectiveMax) * Math.min(1, decelRate * dt);
    }
  } else if (throttle < -0.02) {
    if (kart.speed > 1.5) {
      kart.speed = Math.max(0, kart.speed + throttle * kart.stats.accel * 1.85 * dt);
    } else {
      const revCap = -baseMax * 0.36 * offroadMult;
      kart.speed = Math.max(revCap, kart.speed + throttle * kart.stats.accel * 0.95 * dt);
    }
  } else {
    const drag = isOffroad ? 4.4 : 1.55;
    kart.speed *= Math.max(0, 1 - drag * dt);
    if (Math.abs(kart.speed) < 0.08) kart.speed = 0;
  }

  // Steering & heading integration (+Z nose, steer=-1 left increases heading)
  const isDriftHop = !kart.grounded && !kart.gliding && kart._rampCooldown <= 0 && kart.airTime < 0.42;
  if (kart.spinoutTimer <= 0) {
    if (kart.driftDir !== 0) {
      const intoDrift = kart.driftDir * steer;
      const arcMult = 0.86 + intoDrift * 0.56;
      kart.heading = wrapAngle(kart.heading - kart.driftDir * kart.stats.driftSteer * arcMult * dt);
    } else {
      const speedTurnScale = clamp(Math.abs(kart.speed) / 14, 0.25, 1.0);
      const revSign = kart.speed < -0.5 ? -0.75 : 1.0;
      const airTurnScale = kart.gliding ? 0.85 : kart.grounded ? 1.0 : isDriftHop ? 0.90 : 0.45;
      kart.heading = wrapAngle(
        kart.heading - steer * kart.stats.handling * speedTurnScale * revSign * airTurnScale * dt
      );
    }
  }

  // Blend horizontal velocity toward heading (arcade grip vs drift slide vs ice)
  let traction = 13.0;
  if (!kart.grounded) traction = kart.gliding ? 5.2 : isDriftHop ? 8.5 : 1.8;
  else if (isIce) traction = 3.1;
  else if (kart.driftDir !== 0) traction = 7.4;

  const targetVx = Math.sin(kart.heading) * kart.speed;
  const targetVz = Math.cos(kart.heading) * kart.speed;
  const blend = Math.min(1, traction * dt);
  kart.vel.x += (targetVx - kart.vel.x) * blend;
  kart.vel.z += (targetVz - kart.vel.z) * blend;

  // Apply horizontal motion
  kart.pos.x += kart.vel.x * dt;
  kart.pos.z += kart.vel.z * dt;

  // Vertical physics (gravity & gliding)
  if (kart.gliding) {
    const targetGlideVy = -4.2 + throttle * 2.2;
    kart._vy += (targetGlideVy - kart._vy) * Math.min(1, 3.6 * dt);
    kart._vy = clamp(kart._vy, -14, 14);
  } else if (!kart.grounded) {
    kart._vy -= GRAVITY * dt;
  }

  kart.pos.y += kart._vy * dt;

  // Re-query track after motion for surface, walls, void, ramps, and height snapping
  const postQ = track && track.queryTrack ? track.queryTrack(kart.pos, kart.trackIdx) : query;
  let overEdge = false;

  if (postQ) {
    kart.trackIdx = postQ.frameIdx;
    const halfW = postQ.halfWidth ?? 12;
    const offL = postQ.offroadL ?? 0;
    const offR = postQ.offroadR ?? 0;
    const outerL = halfW + offL;
    const outerR = halfW + offR;
    const wallEdgeL = postQ.wallLatL ?? outerL;
    const wallEdgeR = postQ.wallLatR ?? outerR;

    const overLeft = applyWallConstraint(kart, postQ, wallEdgeL, outerL, Boolean(postQ.wallL), -1, eventsOut);
    const overRight = applyWallConstraint(kart, postQ, wallEdgeR, outerR, Boolean(postQ.wallR), 1, eventsOut);
    overEdge = overLeft || overRight;

    const isVoid = Boolean(postQ.isOverVoid || postQ.surface === SURFACE_TYPES.VOID || overEdge);
    const roadSurfaceY = computeSurfaceY(postQ);
    let surfaceY = roadSurfaceY;
    let climbingRamp: TrackRamp | null = null;

    // Accurate visual-wedge ramp climb & lip launch (evaluate even over VOID chasms)
    const rampHit = getRampMatch(kart, track, postQ);
    if (rampHit) {
      const rampBaseY = Math.max(roadSurfaceY, rampHit.baseY);
      const rampSurfaceY = rampBaseY + clamp(rampHit.u, 0, 1) * (rampHit.ramp.height ?? 3.5);
      const validApproach =
        prevActiveRamp === rampHit.ramp || rampHit.u < 0.5 || kart.pos.y >= rampSurfaceY - 1.4;
      const canLaunch =
        kart._rampCooldown <= 0 &&
        (wasGrounded || wasHopping || wasAirTime < 0.15 || prevActiveRamp === rampHit.ramp);

      if (validApproach && canLaunch && rampHit.u >= 0.84) {
        launchFromRamp(kart, rampHit.ramp, rampSurfaceY, eventsOut);
      } else if (validApproach && rampHit.u < 0.86) {
        surfaceY = rampSurfaceY;
        climbingRamp = rampHit.ramp;
        kart._activeRamp = rampHit.ramp;
        kart._activeRampStartY = rampBaseY;
      } else {
        kart._activeRamp = null;
      }
    } else if (prevActiveRamp && kart._rampCooldown <= 0) {
      const lipCheck = hasCrossedRampLip(kart, prevActiveRamp, track, postQ);
      if (lipCheck.crossed) {
        launchFromRamp(kart, prevActiveRamp, Math.max(roadSurfaceY, lipCheck.launchSurfaceY), eventsOut);
      } else {
        kart._activeRamp = null;
      }
    } else {
      kart._activeRamp = null;
    }

    const heightAboveRoad = kart.pos.y - surfaceY;
    const onSolidSurface = !isVoid || Boolean(climbingRamp);

    // Grounded check & landing
    if (
      !kart._justLaunchedRamp &&
      onSolidSurface &&
      kart._hopTimer <= 0 &&
      kart._vy <= 0 &&
      heightAboveRoad <= 0.45 &&
      heightAboveRoad >= -3.5
    ) {
      const wasAirborne = !kart.grounded;
      kart.pos.y = surfaceY;
      kart._vy = 0;
      kart.grounded = true;
      kart.gliding = false;
      kart.airTime = 0;

      if (wasAirborne && kart._tricked) {
        kart._tricked = false;
        kart.boostTimer = Math.max(kart.boostTimer, 0.95);
        kart.boostStrength = Math.max(kart.boostStrength, 0.32);
        const cap = kart.stats.maxSpeed * diffMult * (1 + kart.boostStrength);
        kart.speed = Math.max(kart.speed, cap * 0.85);
        emitEvent(eventsOut, { type: 'trick_boost', kartId: kart.id });
      } else if (wasAirborne) {
        kart._tricked = false;
        emitEvent(eventsOut, { type: 'land', kartId: kart.id });
      }

      // Record safe centered non-void frame index for Lakitu rescue
      if (
        !climbingRamp &&
        !postQ.onShortcut &&
        postQ.surface !== SURFACE_TYPES.VOID &&
        Math.abs(postQ.lateral) < (postQ.halfWidth ?? 12) * 0.68 &&
        (postQ.wallL !== false || postQ.wallR !== false || Math.abs(postQ.lateral) < 6.5)
      ) {
        kart._lastSafeIdx = postQ.frameIdx;
      }
    } else {
      kart.grounded = false;
      kart.airTime += dt;
      if (!kart._justLaunchedRamp && !climbingRamp) {
        kart._activeRamp = null;
      }

      // Void or deep fall > 10.5 units below track height triggers rescue
      if ((postQ.surface === SURFACE_TYPES.VOID && !kart.gliding && heightAboveRoad < -2.2) || heightAboveRoad < -10.5) {
        triggerRescue(kart, track, postQ, eventsOut);
        return;
      }
    }

    // Visual pitch & roll
    if (kart.grounded && postQ.tangent && postQ.normal) {
      const basePitch = -Math.asin(clamp(postQ.tangent.y, -0.7, 0.7));
      const rampSlopePitch = climbingRamp
        ? -Math.atan2(climbingRamp.height ?? 3.5, Math.max(1, climbingRamp.length ?? 9))
        : 0;
      const targetPitch = climbingRamp ? rampSlopePitch : basePitch;
      const bankAngle = Math.atan2(
        postQ.normal.x * postQ.binormal.y - postQ.normal.y * postQ.binormal.x,
        postQ.normal.y
      );
      const lean = kart.driftDir !== 0 ? kart.driftDir * 0.05 : steer * 0.02;
      kart.pitch += (targetPitch - kart.pitch) * Math.min(1, 12 * dt);
      kart.roll += (bankAngle * 0.55 + lean - kart.roll) * Math.min(1, 12 * dt);
    } else {
      const airPitch = -Math.atan2(kart._vy, Math.max(18, Math.abs(kart.speed))) * 0.55;
      const airRoll = kart.gliding ? steer * 0.28 : kart.driftDir * 0.12;
      kart.pitch += (airPitch - kart.pitch) * Math.min(1, 8 * dt);
      kart.roll += (airRoll - kart.roll) * Math.min(1, 8 * dt);
    }

    // Track coins, hazards, and lap checkpoints
    collectTrackCoinsAndCheckHazards(kart, track, eventsOut);
    updateLapAndProgress(kart, track, postQ, raceState, eventsOut);
  } else {
    // Fallback planar ground if no track provided (e.g. unit test)
    if (kart.pos.y <= 0 && kart._vy <= 0 && kart._hopTimer <= 0) {
      kart.pos.y = 0;
      kart._vy = 0;
      kart.grounded = true;
      kart.gliding = false;
      kart.airTime = 0;
    } else {
      kart.grounded = false;
      kart.airTime += dt;
    }
  }

  kart.vel.y = kart._vy;

  // Oriented capsule kart-to-kart collisions
  resolveKartCollisions(kart, allKarts, eventsOut);
}

/**
 * Sorts karts in-place or by rank: finished karts sorted by finishTime ascending,
 * active karts sorted by totalProgress descending. Assigns rank = 1..N.
 */
export function updateRankings(karts: KartState[]): KartState[] {
  if (!Array.isArray(karts) || karts.length === 0) return [];

  const sorted = [...karts].sort((a, b) => {
    if (a.finished && b.finished) {
      return (a.finishTime || 0) - (b.finishTime || 0);
    }
    if (a.finished) return -1;
    if (b.finished) return 1;
    return (b.totalProgress ?? 0) - (a.totalProgress ?? 0);
  });

  for (let i = 0; i < sorted.length; i++) {
    sorted[i].rank = i + 1;
  }
  return sorted;
}
