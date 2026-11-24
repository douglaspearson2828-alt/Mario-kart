import * as THREE from 'three';
import {
  DIFFICULTIES,
  ITEM_IDS,
  ITEM_META,
  type DifficultyConfig,
  type KartInput,
  type KartState,
  type RaceState,
  type RuntimeShortcut,
  type ShortcutFrame,
  type TrackFrame,
  type TrackInstance,
  type TrackQueryResult,
} from '../core/contracts';
import type { ItemManager } from './items';

const _tmpVec = new THREE.Vector3();

interface BotState {
  laneBias: number;
  prevDrift: boolean;
  prevGrounded: boolean;
  stuckTimer: number;
  reverseTimer: number;
  itemHoldTimer: number;
  reactionTimer: number;
  lastItemRef: string | null;
  activeShortcut: RuntimeShortcut | null;
  activeShortcutKey: string | null;
  shortcutDecisions: Map<string, boolean>;
  rocketDecision: boolean | null;
  rocketTargetTime: number;
  trailingActive: boolean;
}

interface ItemDecision {
  useItem: boolean;
  holdTrail: boolean;
}

function clamp(v: number, min: number, max: number): number {
  return v < min ? min : v > max ? max : v;
}

function wrapAngle(a: number): number {
  while (a > Math.PI) a -= Math.PI * 2;
  while (a < -Math.PI) a += Math.PI * 2;
  return a;
}

function wrappedDeltaS(fromS: number, toS: number, totalLen: number): number {
  if (!totalLen) return toS - fromS;
  let ds = toS - fromS;
  if (ds < -totalLen * 0.5) ds += totalLen;
  if (ds > totalLen * 0.5) ds -= totalLen;
  return ds;
}

function wrappedForwardT(fromT: number, toT: number): number {
  let dt = toT - fromT;
  if (dt < 0) dt += 1;
  return dt;
}

/**
 * Intelligent MK8-style AI driver controller supporting Easy/Medium/Hard/Master difficulties,
 * outside-inside-outside apex lines, multi-tier drifting, shortcut targeting, hazard dodging,
 * smart item tactics, countdown rocket starts, ramp tricks, and anti-stuck recovery.
 */
export class AIController {
  diffConfig: DifficultyConfig;
  botStates: Map<string, BotState>;

  constructor(diffConfig: DifficultyConfig = DIFFICULTIES.medium) {
    this.diffConfig = diffConfig || DIFFICULTIES.medium;
    this.botStates = new Map();
  }

  setDifficulty(diffConfig?: DifficultyConfig | null): void {
    if (diffConfig) this.diffConfig = diffConfig;
  }

  reset(): void {
    this.botStates.clear();
  }

  _getBotState(kart: KartState): BotState {
    let st = this.botStates.get(kart.id);
    if (!st) {
      const hash = Array.from(String(kart.id || 'bot')).reduce((acc, ch) => acc + ch.charCodeAt(0), 0);
      st = {
        laneBias: ((hash % 7) - 3) * 0.45,
        prevDrift: false,
        prevGrounded: true,
        stuckTimer: 0,
        reverseTimer: 0,
        itemHoldTimer: 0,
        reactionTimer: 0,
        lastItemRef: null,
        activeShortcut: null,
        activeShortcutKey: null,
        shortcutDecisions: new Map(),
        rocketDecision: null,
        rocketTargetTime: 0,
        trailingActive: false,
      };
      this.botStates.set(kart.id, st);
    }
    return st;
  }

  _getFrame(track: TrackInstance | null | undefined, idx: number): TrackFrame | null {
    const frames = track?.frames;
    if (!frames || frames.length === 0) return null;
    const n = frames.length;
    return frames[((idx % n) + n) % n];
  }

  _measureCurvature(track: TrackInstance | null | undefined, startIdx: number, offsetStart: number, offsetEnd: number): number {
    const frames = track?.frames;
    if (!frames || frames.length < 4) return 0;
    const n = frames.length;
    let sum = 0;
    for (let k = offsetStart; k < offsetEnd; k++) {
      const fA = frames[((startIdx + k) % n + n) % n];
      const fB = frames[((startIdx + k + 1) % n + n) % n];
      if (!fA?.tangent || !fB?.tangent) continue;
      const yawA = Math.atan2(fA.tangent.x, fA.tangent.z);
      const yawB = Math.atan2(fB.tangent.x, fB.tangent.z);
      sum += wrapAngle(yawB - yawA);
    }
    return sum;
  }

  _abandonShortcut(st: BotState): void {
    if (st.activeShortcutKey) {
      st.shortcutDecisions.set(st.activeShortcutKey, false);
    }
    st.activeShortcut = null;
    st.activeShortcutKey = null;
  }

  _chooseShortcut(
    kart: KartState,
    st: BotState,
    track: TrackInstance | null | undefined,
    query: TrackQueryResult | null | undefined,
    diff: DifficultyConfig
  ): RuntimeShortcut | null {
    const shortcuts = track?.shortcuts;
    if (!shortcuts || shortcuts.length === 0 || !query) {
      st.activeShortcut = null;
      st.activeShortcutKey = null;
      return null;
    }

    if (kart.rescueTimer > 0 || (kart._postRescueTimer ?? 0) > 0 || st.reverseTimer > 0 || st.stuckTimer > 0.35) {
      if (st.activeShortcut) this._abandonShortcut(st);
      return null;
    }

    if (st.activeShortcut) {
      const sc = st.activeShortcut;
      const distFromExit = wrappedForwardT(query.t, sc.exitT);
      const pastEntry = wrappedForwardT(sc.entryT, query.t);
      const p0 = sc.points?.[0];
      let missedOrBlocked = false;

      if (!query.onShortcut && pastEntry > 0.007 && pastEntry < 0.5) {
        missedOrBlocked = true;
      } else if (!query.onShortcut && pastEntry > 0.001 && pastEntry < 0.5 && p0) {
        const dx = p0.x - kart.pos.x;
        const dz = p0.z - kart.pos.z;
        const distToEntry = Math.hypot(dx, dz);
        const fwdDot = dx * Math.sin(kart.heading) + dz * Math.cos(kart.heading);
        if (fwdDot <= 0 && distToEntry > 3) {
          missedOrBlocked = true;
        } else if (query.point && query.binormal) {
          const sideLat = (p0.x - query.point.x) * query.binormal.x + (p0.z - query.point.z) * query.binormal.z;
          const wallEdgeL = (query.wallLatL ?? (query.halfWidth ?? 12) + (query.offroadL ?? 0)) - 1.5;
          const wallEdgeR = (query.wallLatR ?? (query.halfWidth ?? 12) + (query.offroadR ?? 0)) - 1.5;
          if ((sideLat > 2 && query.wallR && query.lateral > wallEdgeR) || (sideLat < -2 && query.wallL && query.lateral < -wallEdgeL)) {
            missedOrBlocked = true;
          }
        }
      }

      const scSpan = wrappedForwardT(sc.entryT, sc.exitT);
      const nearApproachOrEntry = pastEntry > 0.90 || pastEntry < 0.028;
      if (missedOrBlocked) {
        this._abandonShortcut(st);
      } else if (
        query.onShortcut ||
        (nearApproachOrEntry && distFromExit > 0 && distFromExit < Math.max(0.16, scSpan + 0.02))
      ) {
        return sc;
      } else {
        st.activeShortcut = null;
        st.activeShortcutKey = null;
      }
    }

    if (kart.speed < 25) return null;

    const hasBoostItem =
      kart.item === ITEM_IDS.MUSHROOM ||
      kart.item === ITEM_IDS.TRIPLE_MUSHROOM ||
      kart.item === ITEM_IDS.STAR ||
      kart.boostTimer > 0.35 ||
      kart.starTimer > 0;

    for (let i = 0; i < shortcuts.length; i++) {
      const sc = shortcuts[i];
      const fwdDistT = wrappedForwardT(query.t, sc.entryT);
      if (fwdDistT > 0.0 && fwdDistT < 0.025) {
        const key = `${kart.lap}:${sc.id || sc.name || i}`;
        let shouldTake = st.shortcutDecisions.get(key);
        if (shouldTake === undefined) {
          let prob = diff.shortcutEagerness ?? 0.5;
          if (sc.requiresBoost && !hasBoostItem) prob *= 0.12;
          else if (sc.requiresBoost && hasBoostItem) prob = Math.min(0.98, prob + 0.25);
          shouldTake = Math.random() < prob;
          st.shortcutDecisions.set(key, shouldTake);
        }
        if (shouldTake && (!sc.requiresBoost || hasBoostItem)) {
          st.activeShortcut = sc;
          st.activeShortcutKey = key;
          return sc;
        }
      }
    }
    return null;
  }

  _sampleShortcutTarget(
    kart: KartState,
    sc: RuntimeShortcut,
    track: TrackInstance | null | undefined,
    query: TrackQueryResult | null | undefined
  ): THREE.Vector3 | null {
    if (!sc) return null;
    const list: Array<ShortcutFrame | THREE.Vector3> =
      sc.frames && sc.frames.length > 0 ? sc.frames : sc.points;
    if (!list || list.length === 0) return null;

    const getPt = (item: ShortcutFrame | THREE.Vector3): THREE.Vector3 =>
      'point' in item ? item.point : item;
    const p0 = getPt(list[0]);

    const distToEntry = Math.hypot(p0.x - kart.pos.x, p0.z - kart.pos.z);
    if (distToEntry > 8 && !query?.onShortcut) {
      const fwdDot = (p0.x - kart.pos.x) * Math.sin(kart.heading) + (p0.z - kart.pos.z) * Math.cos(kart.heading);
      if (fwdDot > 0) {
        return _tmpVec.set(p0.x, p0.y, p0.z);
      }
    }

    let bestIdx = 0;
    let bestDist = Infinity;
    for (let i = 0; i < list.length; i++) {
      const p = getPt(list[i]);
      const d = (p.x - kart.pos.x) ** 2 + (p.z - kart.pos.z) ** 2;
      if (d < bestDist) {
        bestDist = d;
        bestIdx = i;
      }
    }

    const isNarrowOrOpen =
      query?.onShortcut && ((query.halfWidth ?? 12) <= 8 || query.wallL === false || query.wallR === false);
    const farOffCenter = query?.onShortcut && Math.abs(query.lateral || 0) > (query.halfWidth ?? 6) * 0.45;
    const lookDist = isNarrowOrOpen ? (farOffCenter ? 5 : 8) : 13;

    let accumDist = 0;
    let targetIdx = bestIdx;
    while (targetIdx < list.length - 1 && accumDist < lookDist) {
      const pA = getPt(list[targetIdx]);
      const pB = getPt(list[targetIdx + 1]);
      accumDist += Math.hypot(pB.x - pA.x, pB.z - pA.z);
      targetIdx++;
    }

    if (bestIdx >= list.length - 2 && bestDist < 100 && track?.sampleFrame) {
      const exitF = track.sampleFrame((sc.exitT + 0.015) % 1);
      if (exitF?.point) return exitF.point;
    }

    const chosen = getPt(list[targetIdx]);
    return _tmpVec.set(chosen.x, chosen.y, chosen.z);
  }

  _computeDynamicLateralTarget(
    kart: KartState,
    st: BotState,
    allKarts: KartState[],
    track: TrackInstance | null | undefined,
    query: TrackQueryResult,
    itemManager: ItemManager | null | undefined,
    diff: DifficultyConfig,
    curveNear: number,
    curveFar: number
  ): { targetLat: number; dodgingCloseHazard: boolean } {
    const halfW = query?.halfWidth ?? 12;
    const idx = query?.frameIdx ?? kart.trackIdx ?? 0;
    let wallLOpen = query?.wallL === false;
    let wallROpen = query?.wallR === false;
    for (let look = 1; look <= 14; look++) {
      const f = this._getFrame(track, idx + look);
      if (f) {
        if (f.wallL === false) wallLOpen = true;
        if (f.wallR === false) wallROpen = true;
      }
    }
    const safeMinLat = wallLOpen ? -Math.max(1.5, halfW * 0.42) : -Math.max(2, halfW - 2.5);
    const safeMaxLat = wallROpen ? Math.max(1.5, halfW * 0.42) : Math.max(2, halfW - 2.5);
    const dodgeMinLat = wallLOpen ? -Math.max(2.0, halfW - 3.4) : -Math.max(2, halfW - 2.2);
    const dodgeMaxLat = wallROpen ? Math.max(2.0, halfW - 3.4) : Math.max(2, halfW - 2.2);
    const safeEdge = Math.min(Math.abs(safeMinLat), safeMaxLat);
    const apexSkill = diff.apexSkill ?? 0.6;

    // 1. Outside-inside-outside racing line
    let targetLat = st.laneBias * (1 - apexSkill * 0.65);
    if (Math.abs(curveNear) > 0.14) {
      const insideSign = curveNear > 0 ? -1 : 1;
      targetLat = insideSign * safeEdge * 0.72 * apexSkill;
    } else if (Math.abs(curveFar) > 0.24) {
      const outsideSign = curveFar > 0 ? 1 : -1;
      targetLat = outsideSign * safeEdge * 0.58 * apexSkill;
    }

    const totalLen = track?.totalLength || 1500;
    const currentS = query?.s ?? 0;

    // 2. Seek boost pads ahead
    const pads = track?.boostPads;
    if (pads && pads.length > 0) {
      let bestDs = 46;
      let bestPad = null;
      for (let i = 0; i < pads.length; i++) {
        const pad = pads[i];
        if (pad.onShortcut) continue;
        const ds = wrappedDeltaS(currentS, (pad.t ?? 0) * totalLen, totalLen);
        if (ds > 2 && ds < bestDs) {
          bestDs = ds;
          bestPad = pad;
        }
      }
      if (bestPad) {
        const padWeight = 0.55 + apexSkill * 0.4;
        targetLat = targetLat * (1 - padWeight) + (bestPad.lateral || 0) * padWeight;
      }
    }

    // 3. Seek item boxes if holding no item
    if (!kart.item && kart.itemRouletteTimer <= 0 && track?.itemBoxes?.length) {
      let bestDs = 38;
      let bestBox = null;
      for (let i = 0; i < track.itemBoxes.length; i++) {
        const box = track.itemBoxes[i];
        if (!box.active) continue;
        const ds = wrappedDeltaS(currentS, (box.t ?? 0) * totalLen, totalLen);
        if (ds > 2 && ds < bestDs) {
          bestDs = ds;
          bestBox = box;
        }
      }
      if (bestBox) {
        targetLat = targetLat * 0.35 + (bestBox.lateral || 0) * 0.65;
      }
    }

    // 4. Seek coins when < 10
    if (kart.coins < 10 && (diff.coinSeeking ?? 0.5) > 0.25 && track?.coins?.length) {
      let bestDs = 28;
      let bestCoin = null;
      for (let i = 0; i < track.coins.length; i++) {
        const coin = track.coins[i];
        if (!coin.active) continue;
        const ds = wrappedDeltaS(currentS, (coin.t ?? 0) * totalLen, totalLen);
        if (ds > 2 && ds < bestDs && Math.abs((coin.lateral || 0) - targetLat) < 8) {
          bestDs = ds;
          bestCoin = coin;
        }
      }
      if (bestCoin) {
        const w = (diff.coinSeeking ?? 0.5) * 0.55;
        targetLat = targetLat * (1 - w) + (bestCoin.lateral || 0) * w;
      }
    }

    // 5. Overtake slower karts directly ahead
    if (Array.isArray(allKarts)) {
      for (let i = 0; i < allKarts.length; i++) {
        const other = allKarts[i];
        if (!other || other === kart || other.rescueTimer > 0) continue;
        const dx = other.pos.x - kart.pos.x;
        const dz = other.pos.z - kart.pos.z;
        const fwdDist = dx * Math.sin(kart.heading) + dz * Math.cos(kart.heading);
        if (fwdDist > 2 && fwdDist < 16 && other.speed < kart.speed + 5) {
          const latSep = dx * -Math.cos(kart.heading) + dz * Math.sin(kart.heading);
          if (Math.abs(latSep) < 3.2) {
            const passDir = targetLat > 0 ? -1 : 1;
            targetLat += passDir * 3.8;
            break;
          }
        }
      }
    }

    // 6. Dodge active 3D track hazards and dropped items
    const reactionFactor = clamp(1 - (diff.reactionDelay ?? 0.2) * 1.1, 0.35, 1.0);
    const maxHazardFwd = clamp(Math.max(28, kart.speed * 0.62), 28, 54);
    const maxHazardDistSq = (maxHazardFwd + 4) * (maxHazardFwd + 4);
    const curLat = query?.lateral ?? 0;
    let dodgingCloseHazard = false;

    const dodgeHazard = (hzPos: THREE.Vector3 | undefined, hzRadius: number | undefined): void => {
      if (!hzPos) return;
      const dx = hzPos.x - kart.pos.x;
      const dz = hzPos.z - kart.pos.z;
      const distSq = dx * dx + dz * dz;
      if (distSq > maxHazardDistSq) return;
      const fwd = dx * Math.sin(kart.heading) + dz * Math.cos(kart.heading);
      if (fwd < 1 || fwd > maxHazardFwd) return;
      const relLat = dx * query.binormal.x + dz * query.binormal.z;
      const hzWorldLat = curLat + relLat;
      const avoidRadius = (hzRadius || 2.0) + 2.4;
      if (Math.abs(targetLat - hzWorldLat) < avoidRadius || Math.abs(curLat - hzWorldLat) < avoidRadius) {
        const clearance = (avoidRadius + 1.5) * reactionFactor;
        const sideFromKart = curLat >= hzWorldLat ? 1 : -1;
        const candKartSide = hzWorldLat + sideFromKart * clearance;
        const canStayOnSide =
          sideFromKart > 0 ? candKartSide <= dodgeMaxLat : candKartSide >= dodgeMinLat;
        const dodgeDir = canStayOnSide ? sideFromKart : hzWorldLat >= 0 ? -1 : 1;
        targetLat = clamp(hzWorldLat + dodgeDir * clearance, dodgeMinLat, dodgeMaxLat);
        if (fwd < 38) dodgingCloseHazard = true;
      }
    };

    if (track?.hazards) {
      for (let i = 0; i < track.hazards.length; i++) {
        const hz = track.hazards[i];
        if (!hz.pos || hz.active === false) continue;
        const yMin = hz.yMin ?? hz.pos.y - 1.5;
        const yMax = hz.yMax ?? hz.pos.y + 3.4;
        if (kart.pos.y < yMax + 0.8 && kart.pos.y + 2.0 > yMin) {
          dodgeHazard(hz.pos, hz.hitRadius ?? hz.radius);
        }
      }
    }

    const activeItems = itemManager?.getActiveHazards?.();
    if (activeItems && activeItems.length > 0) {
      for (let i = 0; i < activeItems.length; i++) {
        const p = activeItems[i];
        if (p.ownerId === kart.id && p.age < 0.6) continue;
        if (Math.abs(p.pos.y - kart.pos.y) > 2.5) continue;
        const itemR = p.type === ITEM_IDS.BANANA ? 1.45 : p.type === ITEM_IDS.BOBOMB ? 1.65 : 1.55;
        dodgeHazard(p.pos, itemR);
      }
    }

    // Smooth edge-repulsion toward centerline when approaching an unwalled cliff (unless lining up for a shortcut)
    if (!st.activeShortcut) {
      if (wallLOpen && curLat < -halfW * 0.48) {
        const dangerL = clamp((-curLat - halfW * 0.48) / (halfW * 0.42), 0, 1);
        targetLat = targetLat * (1 - dangerL) + halfW * 0.16 * dangerL;
      } else if (wallROpen && curLat > halfW * 0.48) {
        const dangerR = clamp((curLat - halfW * 0.48) / (halfW * 0.42), 0, 1);
        targetLat = targetLat * (1 - dangerR) - halfW * 0.16 * dangerR;
      }
    }

    const minBound = dodgingCloseHazard ? dodgeMinLat : safeMinLat;
    const maxBound = dodgingCloseHazard ? dodgeMaxLat : safeMaxLat;
    return { targetLat: clamp(targetLat, minBound, maxBound), dodgingCloseHazard };
  }

  _decideItemAction(
    kart: KartState,
    st: BotState,
    allKarts: KartState[],
    _track: TrackInstance | null | undefined,
    _itemManager: ItemManager | null | undefined,
    diff: DifficultyConfig,
    query: TrackQueryResult | null | undefined,
    curveNear: number,
    dt: number
  ): ItemDecision {
    const currentSig = `${kart.item || ''}:${kart.itemCount}:${kart.trailingItem || ''}`;
    if (currentSig !== st.lastItemRef) {
      st.lastItemRef = currentSig;
      st.reactionTimer = diff.reactionDelay ?? 0.2;
      st.itemHoldTimer = 0;
    }

    if (kart.itemRouletteTimer > 0) {
      const elapsed = 1.4 - kart.itemRouletteTimer;
      if ((diff.itemAimAccuracy ?? 0.5) > 0.7 && elapsed > 0.72) {
        return { useItem: true, holdTrail: false };
      }
      return { useItem: false, holdTrail: false };
    }

    if (!kart.item && !kart.trailingItem) return { useItem: false, holdTrail: false };

    st.itemHoldTimer += dt;
    if (st.reactionTimer > 0) {
      st.reactionTimer = Math.max(0, st.reactionTimer - dt);
      if (kart.trailingItem) return { useItem: true, holdTrail: true };
      return { useItem: false, holdTrail: false };
    }

    let threatBehind = false;
    let closeTailgater = false;
    if (Array.isArray(allKarts)) {
      const fwdX = Math.sin(kart.heading);
      const fwdZ = Math.cos(kart.heading);
      for (let i = 0; i < allKarts.length; i++) {
        const other = allKarts[i];
        if (!other || other === kart) continue;
        const dx = other.pos.x - kart.pos.x;
        const dz = other.pos.z - kart.pos.z;
        const dist = Math.hypot(dx, dz);
        const along = dx * fwdX + dz * fwdZ;
        if (along < -2 && dist < 22) threatBehind = true;
        if (along < -2 && dist < 9.5) closeTailgater = true;
      }
    }

    if (kart.trailingItem) {
      if (kart.trailingItem === ITEM_IDS.BANANA && closeTailgater) {
        return { useItem: true, holdTrail: false };
      }
      if (kart.trailingItem === ITEM_IDS.GREEN_SHELL || kart.trailingItem === ITEM_IDS.RED_SHELL) {
        const shot = this._findAlignedTargetAhead(kart, allKarts, diff);
        if (shot && !threatBehind) {
          return { useItem: true, holdTrail: false };
        }
        if (st.itemHoldTimer > 7.0 && !threatBehind) {
          return { useItem: true, holdTrail: false };
        }
      }
      return { useItem: true, holdTrail: true };
    }

    const item = kart.item;
    if (item === ITEM_IDS.COIN || item === ITEM_IDS.STAR || item === ITEM_IDS.LIGHTNING || item === ITEM_IDS.BLUE_SHELL) {
      return { useItem: true, holdTrail: false };
    }

    if (item === ITEM_IDS.MUSHROOM || item === ITEM_IDS.TRIPLE_MUSHROOM) {
      const isOffroad =
        String(query?.surface || '').startsWith('offroad') ||
        Boolean(st.activeShortcut && st.activeShortcut.requiresBoost);
      const onStraight = Math.abs(curveNear) < 0.25 && Math.abs(kart.driftDir) === 0;
      if (isOffroad || onStraight || st.itemHoldTimer > 4.5) {
        return { useItem: true, holdTrail: false };
      }
      return { useItem: false, holdTrail: false };
    }

    if (item === ITEM_IDS.BANANA) {
      if (closeTailgater) return { useItem: true, holdTrail: false };
      if ((diff.itemAimAccuracy ?? 0.5) > 0.4 && ITEM_META[item]?.canTrail) {
        return { useItem: true, holdTrail: true };
      }
      if (st.itemHoldTimer > 3.5) return { useItem: true, holdTrail: false };
      return { useItem: false, holdTrail: false };
    }

    if (item === ITEM_IDS.GREEN_SHELL || item === ITEM_IDS.TRIPLE_GREEN) {
      const shot = this._findAlignedTargetAhead(kart, allKarts, diff);
      if (shot) return { useItem: true, holdTrail: false };
      if (item === ITEM_IDS.GREEN_SHELL && threatBehind && (diff.itemAimAccuracy ?? 0.5) > 0.45) {
        return { useItem: true, holdTrail: true };
      }
      if (st.itemHoldTimer > 6.5) return { useItem: true, holdTrail: false };
      return { useItem: false, holdTrail: false };
    }

    if (item === ITEM_IDS.RED_SHELL) {
      if (threatBehind && kart.rank <= 2 && (diff.itemAimAccuracy ?? 0.5) > 0.6) {
        return { useItem: true, holdTrail: true };
      }
      if (kart.rank > 1 || st.itemHoldTimer > 3.0) {
        return { useItem: true, holdTrail: false };
      }
      return { useItem: false, holdTrail: false };
    }

    if (item === ITEM_IDS.BOBOMB) {
      if (Array.isArray(allKarts)) {
        const fwdX = Math.sin(kart.heading);
        const fwdZ = Math.cos(kart.heading);
        for (let i = 0; i < allKarts.length; i++) {
          const o = allKarts[i];
          if (!o || o === kart) continue;
          const dx = o.pos.x - kart.pos.x;
          const dz = o.pos.z - kart.pos.z;
          const dist = Math.hypot(dx, dz);
          const along = dx * fwdX + dz * fwdZ;
          if (along > 14 && dist < 44) {
            return { useItem: true, holdTrail: false };
          }
        }
      }
      if (closeTailgater) return { useItem: true, holdTrail: true };
      if (st.itemHoldTimer > 6.5) return { useItem: true, holdTrail: false };
    }

    return { useItem: false, holdTrail: false };
  }

  _findAlignedTargetAhead(kart: KartState, allKarts: KartState[], diff: DifficultyConfig): KartState | null {
    if (!Array.isArray(allKarts)) return null;
    const accuracy = diff.itemAimAccuracy ?? 0.55;
    const maxAngle = 0.14 + (1 - accuracy) * 0.24;
    const shellSpeed = 92;

    for (let i = 0; i < allKarts.length; i++) {
      const other = allKarts[i];
      if (!other || other === kart || other.rescueTimer > 0) continue;
      const dist = kart.pos.distanceTo(other.pos);
      if (dist < 4 || dist > 60) continue;

      const tFlight = (dist / shellSpeed) * accuracy;
      const aimX = other.pos.x + other.vel.x * tFlight - kart.pos.x;
      const aimZ = other.pos.z + other.vel.z * tFlight - kart.pos.z;
      const targetYaw = Math.atan2(aimX, aimZ);
      const err = Math.abs(wrapAngle(targetYaw - kart.heading));
      if (err <= maxAngle) return other;
    }
    return null;
  }

  /**
   * Computes MK8 control inputs `{ throttle, steer, drift, driftJustPressed, trickJustPressed, useItem, holdTrail }`
   * for one AI kart.
   */
  computeInput(
    kart: KartState,
    track: TrackInstance | null | undefined,
    allKarts: KartState[] = [],
    itemManager: ItemManager | null = null,
    diffConfig: DifficultyConfig | null = null,
    raceState: RaceState | null = null,
    dt = 1 / 60
  ): KartInput {
    const diff = diffConfig || this.diffConfig || DIFFICULTIES.medium;
    const st = this._getBotState(kart);

    // Countdown Rocket Start timing
    if (raceState && raceState.phase === 'countdown') {
      if (st.rocketDecision === null) {
        st.rocketDecision = Math.random() < (diff.rocketStartChance ?? 0.45);
        st.rocketTargetTime = st.rocketDecision
          ? 0.9 + Math.random() * 0.75
          : Math.random() < 0.35
            ? 2.4
            : 0.15;
      }
      const rem = raceState.countdownRemaining ?? 1.5;
      const throttle = rem <= st.rocketTargetTime ? 1 : 0;
      return {
        throttle,
        steer: 0,
        drift: false,
        driftJustPressed: false,
        trickJustPressed: false,
        useItem: false,
        holdTrail: false,
      };
    }

    st.rocketDecision = null;

    if (!track || !track.queryTrack) {
      return {
        throttle: 1,
        steer: 0,
        drift: false,
        driftJustPressed: false,
        trickJustPressed: false,
        useItem: false,
        holdTrail: false,
      };
    }

    const query = track.queryTrack(kart.pos, kart.trackIdx);

    if (kart.rescueTimer > 0) {
      this._abandonShortcut(st);
      st.stuckTimer = 0;
      st.reverseTimer = 0;
      st.prevDrift = false;
      return {
        throttle: 1,
        steer: 0,
        drift: false,
        driftJustPressed: false,
        trickJustPressed: false,
        useItem: false,
        holdTrail: false,
      };
    }

    if ((kart._postRescueTimer ?? 0) > 2.6 && st.activeShortcut) {
      this._abandonShortcut(st);
    }

    // Ramp trick detection inside the 0.28s launch window
    let trickJustPressed = false;
    const justLaunched =
      Boolean(kart._justLaunchedRamp) || (!kart.grounded && st.prevGrounded && kart._vy > 9);
    if (justLaunched && kart._trickWindowTimer > 0 && !kart._tricked) {
      if (Math.random() < (diff.trickChance ?? 0.55)) {
        trickJustPressed = true;
      }
    }
    st.prevGrounded = kart.grounded;

    // Anti-stuck failsafe (> 1.2s stalled -> brief reverse & steer back toward center)
    if (kart.rescueTimer <= 0 && kart.spinoutTimer <= 0 && (!raceState || raceState.phase === 'racing')) {
      if (Math.abs(kart.speed) < 4.5 && st.reverseTimer <= 0) {
        st.stuckTimer += dt;
        if (st.stuckTimer > 1.2) {
          st.reverseTimer = 0.78;
          st.stuckTimer = 0;
        }
      } else if (Math.abs(kart.speed) >= 6) {
        st.stuckTimer = Math.max(0, st.stuckTimer - dt * 2);
      }
    } else {
      st.stuckTimer = 0;
    }

    if (st.reverseTimer > 0) {
      st.reverseTimer = Math.max(0, st.reverseTimer - dt);
      const latSign = (query?.lateral ?? 0) >= 0 ? 1 : -1;
      st.prevDrift = false;
      return {
        throttle: -1,
        steer: latSign * 0.85,
        drift: false,
        driftJustPressed: false,
        trickJustPressed: false,
        useItem: false,
        holdTrail: false,
      };
    }

    // Curvature lookahead (8..26 frames)
    const lookFrames = Math.round(clamp(8 + (Math.max(0, kart.speed) / 62) * 14, 8, 26));
    const idx = query?.frameIdx ?? kart.trackIdx ?? 0;
    const curveNear = this._measureCurvature(track, idx, 2, Math.min(14, lookFrames));
    const curveFar = this._measureCurvature(track, idx, Math.min(14, lookFrames), lookFrames);

    // Check shortcut choice and target point
    const activeSc = this._chooseShortcut(kart, st, track, query, diff);
    let targetWorldPos: THREE.Vector3 | null = null;
    if (activeSc) {
      const preEntryT = wrappedForwardT(query.t, activeSc.entryT);
      const entryLeadT = kart.gliding ? 0.018 : 0.008;
      if (query.onShortcut || preEntryT > 0.96 || preEntryT < entryLeadT) {
        targetWorldPos = this._sampleShortcutTarget(kart, activeSc, track, query);
      }
    }

    if (!targetWorldPos) {
      const latRes = this._computeDynamicLateralTarget(
        kart,
        st,
        allKarts,
        track,
        query,
        itemManager,
        diff,
        curveNear,
        curveFar
      );
      let targetLat = latRes.targetLat;
      if (activeSc && activeSc.points?.length > 0) {
        const p0 = activeSc.points[0];
        const sideLat = (p0.x - query.point.x) * query.binormal.x + (p0.z - query.point.z) * query.binormal.z;
        const halfW = query.halfWidth ?? 12;
        targetLat = clamp(sideLat, -(halfW - 2.0), halfW - 2.0);
      }
      const halfW = query?.halfWidth ?? 12;
      const curLat = query?.lateral ?? 0;
      const edgeDanger =
        !activeSc &&
        ((query?.wallL === false && curLat < -halfW * 0.52) || (query?.wallR === false && curLat > halfW * 0.52))
          ? clamp((Math.abs(curLat) - halfW * 0.52) / (halfW * 0.35), 0, 1)
          : 0;
      const speedLook = Math.max(0, kart.speed) * (Math.abs(curveNear) > 0.3 ? 0.045 : 0.075);
      const baseAim = latRes.dodgingCloseHazard ? 4 : clamp(5 + speedLook, 5, 10);
      const aimOffset = Math.round(baseAim * (1 - edgeDanger * 0.55));
      const targetFrame = this._getFrame(track, idx + Math.max(3, aimOffset));
      if (targetFrame?.point && targetFrame?.binormal) {
        targetWorldPos = _tmpVec.copy(targetFrame.point).addScaledVector(targetFrame.binormal, targetLat);
      }
    }

    // Steering toward target point (+Z forward, -1 = left increases heading)
    let steer = 0;
    let headingErr = 0;
    if (targetWorldPos) {
      const desiredYaw = Math.atan2(targetWorldPos.x - kart.pos.x, targetWorldPos.z - kart.pos.z);
      headingErr = wrapAngle(desiredYaw - kart.heading);
      steer = clamp(-headingErr * 2.45, -1, 1);
    }

    // Deliberate drifting + Mini-Turbo charging/releasing
    const absCurve = Math.abs(curveNear);
    const is200cc = (diff.speedMult ?? 1.0) >= 1.18;
    const effDriftThresh = is200cc ? Math.max(diff.driftThreshold ?? 0.52, 0.38) : (diff.driftThreshold ?? 0.52);
    const targetMtTier = diff.mtTargetTier ?? 2;
    const onNarrowRiskyShortcut = Boolean(
      query?.onShortcut && ((query.halfWidth ?? 12) <= 8 || query.wallL === false || query.wallR === false)
    );
    const onRampWedge = Boolean(kart._activeRamp);
    const openCliffAhead =
      query?.wallL === false ||
      query?.wallR === false ||
      this._getFrame(track, idx + 4)?.wallL === false ||
      this._getFrame(track, idx + 4)?.wallR === false ||
      this._getFrame(track, idx + 8)?.wallL === false ||
      this._getFrame(track, idx + 8)?.wallR === false;
    const enteringOrOnShortcut = Boolean(activeSc) || onNarrowRiskyShortcut;
    let drift = false;

    if (enteringOrOnShortcut || onRampWedge) {
      drift = false;
    } else if (kart.driftDir !== 0) {
      const farCurve = this._measureCurvature(track, idx, 2, 18);
      const straightening = Math.abs(farCurve) < 0.16 && absCurve < 0.16;
      const cornerEnded = absCurve < 0.14;
      const reachedTargetMT = kart.driftTier >= targetMtTier;
      const overturnedOrReversed = kart.driftDir * headingErr > 0.28;
      const tooMisaligned = Math.abs(headingErr) > 0.52;
      const halfW = query?.halfWidth ?? 12;
      const lat = query?.lateral ?? 0;
      const nearOuterWall =
        (kart.driftDir < 0 && lat > halfW - 3.3) || (kart.driftDir > 0 && lat < -(halfW - 3.3));
      const nearInsideEdge =
        (kart.driftDir < 0 && lat < -(halfW - (query?.wallL === false ? 4.4 : 2.8))) ||
        (kart.driftDir > 0 && lat > halfW - (query?.wallR === false ? 4.4 : 2.8));

      if (
        (reachedTargetMT && Math.abs(curveNear) < 0.34) ||
        (straightening && kart.driftTier >= 1) ||
        (cornerEnded && kart.driftTime > 0.4) ||
        overturnedOrReversed ||
        tooMisaligned ||
        nearOuterWall ||
        nearInsideEdge ||
        kart.speed < 18
      ) {
        drift = false;
      } else {
        drift = true;
        steer = clamp(-headingErr * 2.2, -1, 1);
      }
    } else if (kart._hopTimer > 0 && st.prevDrift && !kart.gliding) {
      drift = true;
    } else if (
      kart.grounded &&
      !kart.gliding &&
      kart.speed > 26 &&
      absCurve > effDriftThresh &&
      Math.abs(steer) > 0.28 &&
      !(openCliffAhead && kart.speed > 86 && (kart.boostTimer > 0 || kart.starTimer > 0))
    ) {
      const halfW = query?.halfWidth ?? 12;
      const lat = query?.lateral ?? 0;
      const marginL = query?.wallL === false ? 4.4 : 2.8;
      const marginR = query?.wallR === false ? 4.4 : 2.8;
      const unsafeEdge = lat < -(halfW - marginL) || lat > halfW - marginR;
      if (!unsafeEdge) {
        drift = true;
      }
    }

    const driftJustPressed = drift && !st.prevDrift;
    st.prevDrift = drift;

    // Speed pacing via diffConfig.aiBaseSpeedScale & adaptive 200cc corner feathering
    const speedScale = diff.aiBaseSpeedScale ?? 1.0;
    const targetBaseMax = kart.stats.maxSpeed * (diff.speedMult ?? 1.0) * speedScale;
    let throttle = 1;
    if (speedScale < 1.0 && kart.boostTimer <= 0 && kart.starTimer <= 0 && kart.speed > targetBaseMax) {
      throttle = 0.72;
    } else if (onNarrowRiskyShortcut && Math.abs(headingErr) > 0.25 && kart.speed > 55) {
      throttle = 0.76;
    } else if (is200cc && kart.speed > 76 && absCurve > 0.80 && Math.abs(headingErr) > 0.28) {
      throttle = clamp(0.95 - (absCurve - 0.80) * 0.18, 0.84, 0.95);
    } else if (openCliffAhead && kart.speed > 68 && absCurve > 0.78 && Math.abs(headingErr) > 0.28) {
      throttle = 0.90;
    }

    const itemDecision = this._decideItemAction(kart, st, allKarts, track, itemManager, diff, query, curveNear, dt);

    return {
      throttle,
      steer,
      drift,
      driftJustPressed,
      trickJustPressed,
      useItem: itemDecision.useItem,
      holdTrail: itemDecision.holdTrail,
    };
  }

  /**
   * Convenience step helper that computes AI input AND triggers ItemManager actions when provided.
   */
  stepAI(
    kart: KartState,
    track: TrackInstance | null | undefined,
    allKarts: KartState[] = [],
    itemManager: ItemManager | null = null,
    diffConfig: DifficultyConfig | null = null,
    raceState: RaceState | null = null,
    dt = 1 / 60,
    audio: any = null,
    particles: any = null
  ): KartInput {
    const input = this.computeInput(kart, track, allKarts, itemManager, diffConfig, raceState, dt);
    const st = this._getBotState(kart);

    if (itemManager && (!raceState || raceState.phase === 'racing')) {
      if (input.useItem) {
        itemManager.useItem(kart, Boolean(input.holdTrail), allKarts, track || null, audio, particles);
        st.trailingActive = Boolean(kart.trailingItem);
      } else if (st.trailingActive && kart.trailingItem && !input.holdTrail) {
        itemManager.useItem(kart, false, allKarts, track || null, audio, particles);
        st.trailingActive = false;
      }
    }

    return input;
  }
}
