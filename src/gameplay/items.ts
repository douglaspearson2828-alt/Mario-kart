import * as THREE from 'three';
import {
  ITEM_IDS,
  ITEM_META,
  type ItemId,
  type KartState,
  type TrackInstance,
} from '../core/contracts';
import { KART_HALF_WIDTH } from './physics';

/**
 * Authentic 1st–8th rank-weighted item roll tables across all 11 ITEM_IDS.
 */
export const ROLL_WEIGHTS: Record<number, Partial<Record<ItemId, number>>> = {
  1: {
    [ITEM_IDS.COIN]: 36,
    [ITEM_IDS.BANANA]: 32,
    [ITEM_IDS.GREEN_SHELL]: 22,
    [ITEM_IDS.RED_SHELL]: 4,
    [ITEM_IDS.MUSHROOM]: 4,
    [ITEM_IDS.BOBOMB]: 2,
  },
  2: {
    [ITEM_IDS.COIN]: 18,
    [ITEM_IDS.BANANA]: 22,
    [ITEM_IDS.GREEN_SHELL]: 24,
    [ITEM_IDS.RED_SHELL]: 20,
    [ITEM_IDS.MUSHROOM]: 10,
    [ITEM_IDS.TRIPLE_GREEN]: 4,
    [ITEM_IDS.BOBOMB]: 2,
  },
  3: {
    [ITEM_IDS.COIN]: 8,
    [ITEM_IDS.BANANA]: 14,
    [ITEM_IDS.GREEN_SHELL]: 20,
    [ITEM_IDS.RED_SHELL]: 24,
    [ITEM_IDS.MUSHROOM]: 16,
    [ITEM_IDS.TRIPLE_GREEN]: 10,
    [ITEM_IDS.BOBOMB]: 6,
    [ITEM_IDS.TRIPLE_MUSHROOM]: 2,
  },
  4: {
    [ITEM_IDS.BANANA]: 8,
    [ITEM_IDS.GREEN_SHELL]: 14,
    [ITEM_IDS.RED_SHELL]: 22,
    [ITEM_IDS.MUSHROOM]: 20,
    [ITEM_IDS.TRIPLE_GREEN]: 12,
    [ITEM_IDS.TRIPLE_MUSHROOM]: 10,
    [ITEM_IDS.BOBOMB]: 10,
    [ITEM_IDS.STAR]: 2,
    [ITEM_IDS.BLUE_SHELL]: 2,
  },
  5: {
    [ITEM_IDS.GREEN_SHELL]: 10,
    [ITEM_IDS.RED_SHELL]: 18,
    [ITEM_IDS.MUSHROOM]: 20,
    [ITEM_IDS.TRIPLE_GREEN]: 12,
    [ITEM_IDS.TRIPLE_MUSHROOM]: 16,
    [ITEM_IDS.BOBOMB]: 10,
    [ITEM_IDS.STAR]: 8,
    [ITEM_IDS.BLUE_SHELL]: 6,
  },
  6: {
    [ITEM_IDS.RED_SHELL]: 14,
    [ITEM_IDS.MUSHROOM]: 14,
    [ITEM_IDS.TRIPLE_GREEN]: 10,
    [ITEM_IDS.TRIPLE_MUSHROOM]: 22,
    [ITEM_IDS.BOBOMB]: 10,
    [ITEM_IDS.STAR]: 16,
    [ITEM_IDS.BLUE_SHELL]: 10,
    [ITEM_IDS.LIGHTNING]: 4,
  },
  7: {
    [ITEM_IDS.RED_SHELL]: 8,
    [ITEM_IDS.MUSHROOM]: 10,
    [ITEM_IDS.TRIPLE_MUSHROOM]: 24,
    [ITEM_IDS.BOBOMB]: 8,
    [ITEM_IDS.STAR]: 24,
    [ITEM_IDS.BLUE_SHELL]: 14,
    [ITEM_IDS.LIGHTNING]: 12,
  },
  8: {
    [ITEM_IDS.RED_SHELL]: 6,
    [ITEM_IDS.TRIPLE_MUSHROOM]: 26,
    [ITEM_IDS.BOBOMB]: 4,
    [ITEM_IDS.STAR]: 30,
    [ITEM_IDS.BLUE_SHELL]: 16,
    [ITEM_IDS.LIGHTNING]: 18,
  },
};

const ALL_ITEM_LIST: ItemId[] = Object.values(ITEM_IDS);

/**
 * Rolls an item ID weighted by racer rank (1..8).
 */
export function rollItemForRank(rank: number, rng: () => number = Math.random): ItemId {
  const clampedRank = Math.max(1, Math.min(8, Math.round(rank || 1)));
  const table = ROLL_WEIGHTS[clampedRank] || ROLL_WEIGHTS[4];
  let total = 0;
  const entries = Object.entries(table) as [ItemId, number][];
  for (let i = 0; i < entries.length; i++) {
    total += entries[i][1];
  }
  let roll = rng() * total;
  for (let i = 0; i < entries.length; i++) {
    roll -= entries[i][1];
    if (roll <= 0) return entries[i][0];
  }
  return entries[entries.length - 1][0];
}

const ROULETTE_DURATION = 1.4;
const ROULETTE_EARLY_LOCK_DELAY = 0.55;
const MAX_DROPPED_HAZARDS = 28;
const _tmpVec = new THREE.Vector3();
const _tmpVec2 = new THREE.Vector3();

export interface ActiveProjectile {
  type: ItemId;
  ownerId: string | null;
  targetRank?: number;
  pos: THREE.Vector3;
  vel: THREE.Vector3;
  heading: number;
  speed: number;
  bouncesLeft?: number;
  age: number;
  life: number;
  armDelay: number;
  trackIdx: number;
  hoverTimer?: number;
  hovering?: boolean;
  _warnedPlayer?: boolean;
  mesh: THREE.Group;
}

export interface ActiveExplosion {
  pos: THREE.Vector3;
  radius: number;
  age: number;
  duration: number;
  isBlue: boolean;
  mesh: THREE.Mesh;
}

interface TrailVisualEntry {
  itemId: ItemId;
  mesh: THREE.Group;
}

interface OrbitVisualEntry {
  angle: number;
  meshes: THREE.Group[];
}

interface ItemGeometries {
  bananaCone: THREE.ConeGeometry;
  bananaBase: THREE.CylinderGeometry;
  shellBody: THREE.SphereGeometry;
  shellRim: THREE.TorusGeometry;
  bombBody: THREE.SphereGeometry;
  bombFuse: THREE.CylinderGeometry;
  blueSpike: THREE.ConeGeometry;
  shockwave: THREE.SphereGeometry;
  ringWave: THREE.RingGeometry;
}

interface ItemMaterials {
  banana: THREE.Material;
  greenShell: THREE.Material;
  redShell: THREE.Material;
  blueShell: THREE.Material;
  shellRim: THREE.Material;
  bobomb: THREE.Material;
  bobombFlash: THREE.Material;
  gold: THREE.Material;
  shockOrange: THREE.Material;
  shockBlue: THREE.Material;
}

function clamp(v: number, min: number, max: number): number {
  return v < min ? min : v > max ? max : v;
}

function wrapAngle(a: number): number {
  while (a > Math.PI) a -= Math.PI * 2;
  while (a < -Math.PI) a += Math.PI * 2;
  return a;
}

function getProjectileHitRadius(type: ItemId): number {
  if (type === ITEM_IDS.BANANA) return 1.45;
  if (type === ITEM_IDS.BOBOMB) return 1.65;
  return 1.55;
}

function makeMat(gfx: any, def: Record<string, any>): THREE.Material {
  if (gfx && typeof gfx.createMaterial === 'function') {
    return gfx.createMaterial(def);
  }
  return new THREE.MeshStandardMaterial({
    color: def.color ?? 0xffffff,
    emissive: def.emissive ?? 0x000000,
    emissiveIntensity: def.emissiveIntensity ?? 0,
    roughness: def.roughness ?? 0.4,
    metalness: def.metalness ?? 0.1,
    transparent: Boolean(def.transparent),
    opacity: def.opacity ?? 1,
    side: def.side ?? THREE.FrontSide,
  });
}

/**
 * Manages Item Box pickups, roulette timing, trailing/orbiting shields,
 * projectiles (shells, bob-ombs, spiny shells), shockwaves, and dynamic lights.
 */
export class ItemManager {
  gfx: any;
  texLib: any;
  group: THREE.Group;
  _attachedTrack: TrackInstance | null;
  projectiles: ActiveProjectile[];
  explosions: ActiveExplosion[];
  trailVisuals: Map<string, TrailVisualEntry>;
  orbitVisuals: Map<string, OrbitVisualEntry>;
  screenFlashTimer: number;
  screenFlash: number;
  _geos: ItemGeometries | null;
  _mats: ItemMaterials | null;

  constructor(gfx: any = null, texLib: any = null) {
    this.gfx = gfx;
    this.texLib = texLib;
    this.group = new THREE.Group();
    this.group.name = 'ItemManagerGroup';
    this._attachedTrack = null;

    this.projectiles = [];
    this.explosions = [];
    this.trailVisuals = new Map();
    this.orbitVisuals = new Map();

    this.screenFlashTimer = 0;
    this.screenFlash = 0;
    this._geos = null;
    this._mats = null;
  }

  _ensureAssets(gfx?: any): void {
    const activeGfx = gfx || this.gfx;
    if (activeGfx && !this.gfx) this.gfx = activeGfx;
    if (this._geos) return;

    this._geos = {
      bananaCone: new THREE.ConeGeometry(0.58, 1.35, 8),
      bananaBase: new THREE.CylinderGeometry(0.62, 0.72, 0.28, 8),
      shellBody: new THREE.SphereGeometry(0.75, 14, 10, 0, Math.PI * 2, 0, Math.PI * 0.65),
      shellRim: new THREE.TorusGeometry(0.72, 0.14, 8, 16),
      bombBody: new THREE.SphereGeometry(0.72, 12, 10),
      bombFuse: new THREE.CylinderGeometry(0.1, 0.1, 0.45, 6),
      blueSpike: new THREE.ConeGeometry(0.24, 0.55, 6),
      shockwave: new THREE.SphereGeometry(1, 18, 14),
      ringWave: new THREE.RingGeometry(0.65, 1.0, 24),
    };

    this._mats = {
      banana: makeMat(this.gfx, { color: 0xffe119, emissive: 0x443300, emissiveIntensity: 0.25, roughness: 0.4 }),
      greenShell: makeMat(this.gfx, { color: 0x26c948, emissive: 0x093a12, emissiveIntensity: 0.35, roughness: 0.3, isKartPaint: true }),
      redShell: makeMat(this.gfx, { color: 0xff2d24, emissive: 0x550806, emissiveIntensity: 0.45, roughness: 0.3, isKartPaint: true }),
      blueShell: makeMat(this.gfx, { color: 0x0a84ff, emissive: 0x043a88, emissiveIntensity: 0.75, roughness: 0.25, isKartPaint: true }),
      shellRim: makeMat(this.gfx, { color: 0xf4f4ea, roughness: 0.5 }),
      bobomb: makeMat(this.gfx, { color: 0x1e2230, emissive: 0x111122, roughness: 0.35, metalness: 0.4 }),
      bobombFlash: makeMat(this.gfx, { color: 0xff4422, emissive: 0xff3300, emissiveIntensity: 1.4, isUnlit: true }),
      gold: makeMat(this.gfx, { color: 0xffd700, emissive: 0x554400, metalness: 0.6, roughness: 0.2 }),
      shockOrange: makeMat(this.gfx, { color: 0xff6a00, emissive: 0xff4500, emissiveIntensity: 1.4, transparent: true, opacity: 0.65, isUnlit: true, side: THREE.DoubleSide }),
      shockBlue: makeMat(this.gfx, { color: 0x22aaff, emissive: 0x0088ff, emissiveIntensity: 1.6, transparent: true, opacity: 0.68, isUnlit: true, side: THREE.DoubleSide }),
    };
  }

  _buildItemMesh(itemId: ItemId, gfx?: any): THREE.Group {
    this._ensureAssets(gfx);
    const geos = this._geos!;
    const mats = this._mats!;
    const g = new THREE.Group();

    if (itemId === ITEM_IDS.BANANA) {
      const cone = new THREE.Mesh(geos.bananaCone, mats.banana);
      cone.position.y = 0.68;
      const base = new THREE.Mesh(geos.bananaBase, mats.banana);
      base.position.y = 0.14;
      g.add(cone, base);
    } else if (
      itemId === ITEM_IDS.GREEN_SHELL ||
      itemId === ITEM_IDS.RED_SHELL ||
      itemId === ITEM_IDS.BLUE_SHELL
    ) {
      const mat =
        itemId === ITEM_IDS.BLUE_SHELL
          ? mats.blueShell
          : itemId === ITEM_IDS.RED_SHELL
            ? mats.redShell
            : mats.greenShell;
      const dome = new THREE.Mesh(geos.shellBody, mat);
      dome.scale.set(1, 0.85, 1.12);
      dome.position.y = 0.12;
      const rim = new THREE.Mesh(geos.shellRim, mats.shellRim);
      rim.rotation.x = Math.PI * 0.5;
      rim.position.y = 0.15;
      g.add(dome, rim);

      if (itemId === ITEM_IDS.BLUE_SHELL) {
        for (let i = 0; i < 6; i++) {
          const spike = new THREE.Mesh(geos.blueSpike, mats.shellRim);
          const ang = (i / 6) * Math.PI * 2;
          spike.position.set(Math.sin(ang) * 0.45, 0.58, Math.cos(ang) * 0.45);
          spike.rotation.z = -Math.sin(ang) * 0.55;
          spike.rotation.x = Math.cos(ang) * 0.55;
          g.add(spike);
        }
      }
    } else if (itemId === ITEM_IDS.BOBOMB) {
      const body = new THREE.Mesh(geos.bombBody, mats.bobomb);
      body.position.y = 0.72;
      const fuse = new THREE.Mesh(geos.bombFuse, mats.gold);
      fuse.position.y = 1.48;
      g.add(body, fuse);
      g.userData.bodyMesh = body;
    }

    return g;
  }

  _lockRolledItem(kart: KartState, audio?: any): void {
    const rolled = rollItemForRank(kart.rank);
    kart.item = rolled;
    kart.itemCount = ITEM_META[rolled]?.count ?? 1;
    kart.itemRouletteTimer = 0;
    kart._rouletteTickAccum = 0;
    kart.rouletteDisplayItem = rolled;
    if (kart.isPlayer && audio && typeof audio.playSfx === 'function') {
      audio.playSfx('item_lock');
    }
  }

  _spawnExplosion(
    pos: THREE.Vector3,
    radius: number,
    isBlue: boolean,
    karts: KartState[],
    audio?: any,
    particles?: any
  ): void {
    this._ensureAssets();
    const geos = this._geos!;
    const mats = this._mats!;
    const mesh = new THREE.Mesh(
      geos.shockwave,
      (isBlue ? mats.shockBlue : mats.shockOrange).clone()
    );
    mesh.position.copy(pos);
    mesh.scale.setScalar(0.5);
    this.group.add(mesh);

    this.explosions.push({
      pos: pos.clone(),
      radius,
      age: 0,
      duration: 0.55,
      isBlue,
      mesh,
    });

    if (audio && typeof audio.playSfx === 'function') {
      audio.playSfx('explosion');
    }
    if (particles && typeof particles.spawnExplosion === 'function') {
      particles.spawnExplosion(pos, isBlue ? 0x22aaff : 0xff6600);
    }

    if (Array.isArray(karts)) {
      for (let i = 0; i < karts.length; i++) {
        const target = karts[i];
        if (!target || target.rescueTimer > 0) continue;
        const dist = target.pos.distanceTo(pos);
        if (dist <= radius) {
          if (target.starTimer <= 0 && target.invulnTimer <= 0) {
            target.spinoutTimer = 1.35;
            target.invulnTimer = 1.85;
            target.driftDir = 0;
            target.driftTime = 0;
            target.driftTier = 0;
            target.boostTimer = 0;
            target._activeRamp = null;
            target.coins = Math.max(0, target.coins - 2);
            target.speed *= 0.25;
            target._vy = Math.max(target._vy || 0, 10.5);
            target.grounded = false;
            target.vel.multiplyScalar(0.25);
            if (target.isPlayer && audio && typeof audio.playSfx === 'function') {
              audio.playSfx('hit');
            }
          }
        }
      }
    }
  }

  _hitKartWithProjectile(
    target: KartState,
    _proj: { type: ItemId; ownerId: string | null },
    _karts: KartState[],
    audio?: any,
    particles?: any
  ): boolean {
    if (!target || target.rescueTimer > 0) return false;

    if (target.trailingItem) {
      this._destroyTrailVisual(target.id);
      target.trailingItem = null;
      if (audio && typeof audio.playSfx === 'function') {
        audio.playSfx('shell_bounce');
      }
      return true;
    }

    if (target.item === ITEM_IDS.TRIPLE_GREEN && target.itemCount > 0) {
      target.itemCount -= 1;
      if (target.itemCount <= 0) {
        target.item = null;
        target.itemCount = 0;
      }
      if (audio && typeof audio.playSfx === 'function') {
        audio.playSfx('shell_bounce');
      }
      return true;
    }

    if (target.starTimer > 0) {
      if (audio && typeof audio.playSfx === 'function') {
        audio.playSfx('shell_bounce');
      }
      return true;
    }

    if (target.invulnTimer > 0) return false;

    target.spinoutTimer = 1.15;
    target.invulnTimer = 1.65;
    target.driftDir = 0;
    target.driftTime = 0;
    target.driftTier = 0;
    target.boostTimer = 0;
    target._activeRamp = null;
    target.coins = Math.max(0, target.coins - 2);
    target.speed *= 0.32;
    target.vel.multiplyScalar(0.32);

    if (audio && typeof audio.playSfx === 'function') {
      audio.playSfx('hit');
    }
    if (particles && typeof particles.spawnBurst === 'function') {
      particles.spawnBurst(target.pos, 0xffaa33, 10);
    }
    return true;
  }

  _spawnDroppedHazard(itemId: ItemId, pos: THREE.Vector3, gfx?: any): void {
    if (itemId === ITEM_IDS.BANANA) {
      let bananaCount = 0;
      let oldestIdx = -1;
      for (let i = 0; i < this.projectiles.length; i++) {
        if (this.projectiles[i].type === ITEM_IDS.BANANA) {
          bananaCount++;
          if (oldestIdx === -1) oldestIdx = i;
        }
      }
      if (bananaCount >= MAX_DROPPED_HAZARDS && oldestIdx !== -1) {
        this._removeProjectileAt(oldestIdx);
      }
    }

    const mesh = this._buildItemMesh(itemId, gfx);
    mesh.position.copy(pos);
    this.group.add(mesh);

    this.projectiles.push({
      type: itemId,
      ownerId: null,
      pos: pos.clone(),
      vel: new THREE.Vector3(),
      heading: 0,
      speed: 0,
      bouncesLeft: 0,
      age: 0,
      life: 60,
      armDelay: 0.25,
      trackIdx: 0,
      mesh,
    });
  }

  _fireProjectile(
    itemId: ItemId,
    kart: KartState,
    direction: number,
    _track: TrackInstance | null,
    gfx?: any,
    audio?: any
  ): void {
    this._ensureAssets(gfx);
    const fwdX = Math.sin(kart.heading);
    const fwdZ = Math.cos(kart.heading);

    if (itemId === ITEM_IDS.BANANA) {
      const dropPos = kart.pos.clone();
      dropPos.x -= fwdX * 2.5 * direction;
      dropPos.z -= fwdZ * 2.5 * direction;
      const mesh = this._buildItemMesh(ITEM_IDS.BANANA, gfx);
      mesh.position.copy(dropPos);
      this.group.add(mesh);
      this.projectiles.push({
        type: ITEM_IDS.BANANA,
        ownerId: kart.id,
        pos: dropPos,
        vel: new THREE.Vector3(),
        heading: kart.heading,
        speed: 0,
        bouncesLeft: 0,
        age: 0,
        life: 60,
        armDelay: 0.28,
        trackIdx: kart.trackIdx,
        mesh,
      });
      if (audio && typeof audio.playSfx === 'function') audio.playSfx('shell_fire');
      return;
    }

    if (itemId === ITEM_IDS.BOBOMB) {
      const spawnPos = kart.pos.clone();
      const throwForward = direction >= 0;
      spawnPos.x += fwdX * (throwForward ? 2.2 : -2.4);
      spawnPos.z += fwdZ * (throwForward ? 2.2 : -2.4);
      spawnPos.y += 0.6;
      const spd = throwForward ? Math.max(36, kart.speed + 26) : -6;
      const mesh = this._buildItemMesh(ITEM_IDS.BOBOMB, gfx);
      mesh.position.copy(spawnPos);
      this.group.add(mesh);
      this.projectiles.push({
        type: ITEM_IDS.BOBOMB,
        ownerId: kart.id,
        pos: spawnPos,
        vel: new THREE.Vector3(fwdX * spd, throwForward ? 13.5 : 3.5, fwdZ * spd),
        heading: kart.heading,
        speed: spd,
        bouncesLeft: 1,
        age: 0,
        life: 2.5,
        armDelay: 0.25,
        trackIdx: kart.trackIdx,
        mesh,
      });
      if (audio && typeof audio.playSfx === 'function') audio.playSfx('shell_fire');
      return;
    }

    if (itemId === ITEM_IDS.GREEN_SHELL) {
      const spawnPos = kart.pos.clone();
      spawnPos.x += fwdX * 2.5 * direction;
      spawnPos.z += fwdZ * 2.5 * direction;
      spawnPos.y += 0.15;
      const spd = 92 + Math.max(0, kart.speed * 0.35);
      const mesh = this._buildItemMesh(ITEM_IDS.GREEN_SHELL, gfx);
      mesh.position.copy(spawnPos);
      this.group.add(mesh);
      this.projectiles.push({
        type: ITEM_IDS.GREEN_SHELL,
        ownerId: kart.id,
        pos: spawnPos,
        vel: new THREE.Vector3(fwdX * spd * direction, 0, fwdZ * spd * direction),
        heading: direction >= 0 ? kart.heading : wrapAngle(kart.heading + Math.PI),
        speed: spd,
        bouncesLeft: 4,
        age: 0,
        life: 8.5,
        armDelay: 0.2,
        trackIdx: kart.trackIdx,
        mesh,
      });
      if (audio && typeof audio.playSfx === 'function') audio.playSfx('shell_fire');
      return;
    }

    if (itemId === ITEM_IDS.RED_SHELL) {
      const spawnPos = kart.pos.clone();
      spawnPos.x += fwdX * 2.6;
      spawnPos.z += fwdZ * 2.6;
      spawnPos.y += 0.2;
      const spd = 88 + Math.max(0, kart.speed * 0.3);
      const mesh = this._buildItemMesh(ITEM_IDS.RED_SHELL, gfx);
      mesh.position.copy(spawnPos);
      this.group.add(mesh);
      this.projectiles.push({
        type: ITEM_IDS.RED_SHELL,
        ownerId: kart.id,
        targetRank: kart.rank > 1 ? kart.rank - 1 : 1,
        pos: spawnPos,
        vel: new THREE.Vector3(fwdX * spd, 0, fwdZ * spd),
        heading: kart.heading,
        speed: spd,
        bouncesLeft: 1,
        age: 0,
        life: 9.0,
        armDelay: 0.22,
        trackIdx: kart.trackIdx,
        mesh,
      });
      if (audio && typeof audio.playSfx === 'function') audio.playSfx('shell_fire');
      return;
    }

    if (itemId === ITEM_IDS.BLUE_SHELL) {
      const spawnPos = kart.pos.clone();
      spawnPos.x += fwdX * 2.6;
      spawnPos.z += fwdZ * 2.6;
      spawnPos.y += 1.5;
      const spd = 118;
      const mesh = this._buildItemMesh(ITEM_IDS.BLUE_SHELL, gfx);
      mesh.position.copy(spawnPos);
      this.group.add(mesh);
      this.projectiles.push({
        type: ITEM_IDS.BLUE_SHELL,
        ownerId: kart.id,
        pos: spawnPos,
        vel: new THREE.Vector3(fwdX * spd, 0, fwdZ * spd),
        heading: kart.heading,
        speed: spd,
        age: 0,
        life: 16.0,
        hoverTimer: 0,
        hovering: false,
        armDelay: 0.3,
        trackIdx: kart.trackIdx,
        mesh,
      });
      if (audio && typeof audio.playSfx === 'function') audio.playSfx('shell_fire');
    }
  }

  /**
   * Uses or equips/releases a kart's held item.
   */
  useItem(
    kart: KartState,
    holdTrail = false,
    karts: KartState[] = [],
    track: TrackInstance | null = null,
    audio: any = null,
    particles: any = null
  ): boolean {
    if (!kart || kart.rescueTimer > 0) return false;

    if (kart.itemRouletteTimer > 0) {
      const elapsed = ROULETTE_DURATION - kart.itemRouletteTimer;
      if (elapsed >= ROULETTE_EARLY_LOCK_DELAY) {
        this._lockRolledItem(kart, audio);
        return true;
      }
      return false;
    }

    if (kart.trailingItem) {
      if (holdTrail) return false;
      const itemToFire = kart.trailingItem;
      this._destroyTrailVisual(kart.id);
      kart.trailingItem = null;
      const dir = itemToFire === ITEM_IDS.BOBOMB ? -1 : 1;
      this._fireProjectile(itemToFire, kart, dir, track, this.gfx, audio);
      return true;
    }

    if (!kart.item) return false;

    const itemId = kart.item;
    const meta = ITEM_META[itemId];

    if (holdTrail && meta?.canTrail) {
      kart.trailingItem = itemId;
      kart.item = null;
      kart.itemCount = 0;
      return true;
    }

    if (itemId === ITEM_IDS.COIN) {
      kart.coins = Math.min(10, kart.coins + 2);
      kart.speed += 3.5;
      kart.boostTimer = Math.max(kart.boostTimer, 0.25);
      kart.boostStrength = Math.max(kart.boostStrength, 0.14);
      kart.item = null;
      kart.itemCount = 0;
      if (audio && typeof audio.playSfx === 'function') audio.playSfx('coin');
      return true;
    }

    if (itemId === ITEM_IDS.MUSHROOM || itemId === ITEM_IDS.TRIPLE_MUSHROOM) {
      kart.boostTimer = Math.max(kart.boostTimer, 1.35);
      kart.boostStrength = Math.max(kart.boostStrength, 0.42);
      kart.speed = Math.max(kart.speed, kart.stats.maxSpeed * 1.18);
      if (itemId === ITEM_IDS.TRIPLE_MUSHROOM && kart.itemCount > 1) {
        kart.itemCount -= 1;
      } else {
        kart.item = null;
        kart.itemCount = 0;
      }
      if (audio && typeof audio.playSfx === 'function') audio.playSfx('boost_pad');
      if (particles && typeof particles.spawnBurst === 'function') {
        particles.spawnBurst(kart.pos, 0xff5522, 12);
      }
      return true;
    }

    if (itemId === ITEM_IDS.STAR) {
      kart.starTimer = 7.5;
      kart.shrinkTimer = 0;
      kart.spinoutTimer = 0;
      kart.item = null;
      kart.itemCount = 0;
      if (audio && typeof audio.playSfx === 'function') audio.playSfx('boost_pad');
      return true;
    }

    if (itemId === ITEM_IDS.LIGHTNING) {
      kart.item = null;
      kart.itemCount = 0;
      this.screenFlashTimer = 0.48;
      this.screenFlash = 1.0;

      if (Array.isArray(karts)) {
        const hasSomeoneAhead = karts.some((k) => k !== kart && k.rank < kart.rank);
        for (let i = 0; i < karts.length; i++) {
          const other = karts[i];
          if (!other || other === kart) continue;
          if (hasSomeoneAhead && other.rank >= kart.rank) continue;
          if (other.starTimer > 0 || other.rescueTimer > 0) continue;

          other.shrinkTimer = 6.5;
          other.spinoutTimer = 0.85;
          other.driftDir = 0;
          other.driftTime = 0;
          other.driftTier = 0;
          other.boostTimer = 0;
          other._activeRamp = null;
          other.coins = Math.max(0, other.coins - 2);
          other.speed *= 0.35;
          other.vel.multiplyScalar(0.35);
        }
      }
      if (audio && typeof audio.playSfx === 'function') audio.playSfx('lightning');
      return true;
    }

    if (itemId === ITEM_IDS.TRIPLE_GREEN) {
      this._fireProjectile(ITEM_IDS.GREEN_SHELL, kart, 1, track, this.gfx, audio);
      if (kart.itemCount > 1) {
        kart.itemCount -= 1;
      } else {
        kart.item = null;
        kart.itemCount = 0;
      }
      return true;
    }

    kart.item = null;
    kart.itemCount = 0;
    this._fireProjectile(itemId, kart, 1, track, this.gfx, audio);
    return true;
  }

  /**
   * Explicitly releases an actively trailed item behind or forward.
   */
  releaseTrail(
    kart: KartState,
    karts: KartState[] = [],
    track: TrackInstance | null = null,
    audio: any = null,
    particles: any = null
  ): boolean {
    return this.useItem(kart, false, karts, track, audio, particles);
  }

  _destroyTrailVisual(kartId: string): void {
    const entry = this.trailVisuals.get(kartId);
    if (entry) {
      if (entry.mesh && entry.mesh.parent) entry.mesh.parent.remove(entry.mesh);
      this.trailVisuals.delete(kartId);
    }
  }

  _syncKartVisuals(dt: number, karts: KartState[], gfx?: any): void {
    const activeIds = new Set<string>();
    for (let i = 0; i < karts.length; i++) {
      const kart = karts[i];
      if (!kart) continue;
      activeIds.add(kart.id);

      if (kart.trailingItem) {
        let entry = this.trailVisuals.get(kart.id);
        if (!entry || entry.itemId !== kart.trailingItem) {
          this._destroyTrailVisual(kart.id);
          const mesh = this._buildItemMesh(kart.trailingItem, gfx);
          this.group.add(mesh);
          entry = { itemId: kart.trailingItem, mesh };
          this.trailVisuals.set(kart.id, entry);
        }
        const fwdX = Math.sin(kart.heading);
        const fwdZ = Math.cos(kart.heading);
        entry.mesh.position.set(
          kart.pos.x - fwdX * 2.35,
          kart.pos.y + 0.15,
          kart.pos.z - fwdZ * 2.35
        );
        entry.mesh.rotation.y = kart.heading;
      } else if (this.trailVisuals.has(kart.id)) {
        this._destroyTrailVisual(kart.id);
      }

      const wantCount = kart.item === ITEM_IDS.TRIPLE_GREEN ? Math.max(0, kart.itemCount || 0) : 0;
      let orb = this.orbitVisuals.get(kart.id);
      if (wantCount > 0) {
        if (!orb) {
          orb = { angle: 0, meshes: [] };
          this.orbitVisuals.set(kart.id, orb);
        }
        while (orb.meshes.length < wantCount) {
          const m = this._buildItemMesh(ITEM_IDS.GREEN_SHELL, gfx);
          m.scale.setScalar(0.75);
          this.group.add(m);
          orb.meshes.push(m);
        }
        while (orb.meshes.length > wantCount) {
          const m = orb.meshes.pop();
          if (m && m.parent) m.parent.remove(m);
        }
        orb.angle = (orb.angle + dt * 3.4) % (Math.PI * 2);
        for (let s = 0; s < orb.meshes.length; s++) {
          const a = orb.angle + (s * Math.PI * 2) / orb.meshes.length;
          orb.meshes[s].position.set(
            kart.pos.x + Math.sin(a) * 2.2,
            kart.pos.y + 0.35,
            kart.pos.z + Math.cos(a) * 2.2
          );
          orb.meshes[s].rotation.y += dt * 4;
        }
      } else if (orb) {
        for (const m of orb.meshes) {
          if (m.parent) m.parent.remove(m);
        }
        this.orbitVisuals.delete(kart.id);
      }
    }

    for (const id of this.trailVisuals.keys()) {
      if (!activeIds.has(id)) this._destroyTrailVisual(id);
    }
    for (const [id, orb] of this.orbitVisuals.entries()) {
      if (!activeIds.has(id)) {
        for (const m of orb.meshes) {
          if (m.parent) m.parent.remove(m);
        }
        this.orbitVisuals.delete(id);
      }
    }
  }

  _removeProjectileAt(idx: number): void {
    const p = this.projectiles[idx];
    if (p?.mesh && p.mesh.parent) p.mesh.parent.remove(p.mesh);
    this.projectiles.splice(idx, 1);
  }

  _updateProjectiles(
    dt: number,
    karts: KartState[],
    track: TrackInstance | null,
    _gfx?: any,
    audio?: any,
    particles?: any
  ): void {
    for (let i = this.projectiles.length - 1; i >= 0; i--) {
      const p = this.projectiles[i];
      p.age += dt;
      p.life -= dt;

      if (p.life <= 0) {
        if (p.type === ITEM_IDS.BOBOMB) {
          this._spawnExplosion(p.pos, 11.0, false, karts, audio, particles);
        }
        this._removeProjectileAt(i);
        continue;
      }

      if (p.type === ITEM_IDS.BANANA) {
        if (p.mesh) p.mesh.rotation.y += dt * 0.8;
      } else if (p.type === ITEM_IDS.GREEN_SHELL) {
        p.pos.x += p.vel.x * dt;
        p.pos.z += p.vel.z * dt;
        if (p.mesh) p.mesh.rotation.y += dt * 14;

        if (track && track.queryTrack) {
          const q = track.queryTrack(p.pos, p.trackIdx);
          if (q) {
            p.trackIdx = q.frameIdx;
            const surfY = q.point.y + (q.binormal?.y || 0) * (q.lateral || 0);
            p.pos.y = surfY + 0.15;

            const wallEdgeL = q.wallLatL ?? (q.halfWidth ?? 12) + (q.offroadL ?? 0);
            const wallEdgeR = q.wallLatR ?? (q.halfWidth ?? 12) + (q.offroadR ?? 0);
            const shellR = 0.72;
            const bounceSide =
              q.lateral < -wallEdgeL + shellR && q.wallL
                ? -1
                : q.lateral > wallEdgeR - shellR && q.wallR
                  ? 1
                  : 0;

            let bounced = false;
            if (bounceSide !== 0) {
              const edge = bounceSide < 0 ? wallEdgeL : wallEdgeR;
              p.pos.addScaledVector(q.binormal, bounceSide * (edge - shellR) - q.lateral);
              const vn = p.vel.x * q.binormal.x + p.vel.z * q.binormal.z;
              if (vn * bounceSide > 0) {
                p.vel.x -= 2 * vn * q.binormal.x;
                p.vel.z -= 2 * vn * q.binormal.z;
                bounced = true;
              }
            }

            if (bounced) {
              p.bouncesLeft = (p.bouncesLeft ?? 0) - 1;
              if (audio && typeof audio.playSfx === 'function') audio.playSfx('shell_bounce');
              if (p.bouncesLeft < 0) {
                if (particles && typeof particles.spawnBurst === 'function') {
                  particles.spawnBurst(p.pos, 0x34c759, 8);
                }
                this._removeProjectileAt(i);
                continue;
              }
            }
          }
        }
      } else if (p.type === ITEM_IDS.RED_SHELL) {
        let target: KartState | null = null;
        if (Array.isArray(karts) && karts.length > 0) {
          target = karts.find((k) => k.id !== p.ownerId && k.rank === p.targetRank && k.rescueTimer <= 0) || null;
          if (!target) {
            let bestDist = Infinity;
            for (const k of karts) {
              if (k.id === p.ownerId || k.rescueTimer > 0) continue;
              const d = k.pos.distanceToSquared(p.pos);
              if (d < bestDist) {
                bestDist = d;
                target = k;
              }
            }
          }
        }

        let desiredYaw = p.heading;
        if (target && target.pos.distanceTo(p.pos) < 55) {
          desiredYaw = Math.atan2(target.pos.x - p.pos.x, target.pos.z - p.pos.z);
        } else if (track && track.queryTrack) {
          const q = track.queryTrack(p.pos, p.trackIdx);
          if (q && track.frames?.length) {
            p.trackIdx = q.frameIdx;
            const lookIdx = (q.frameIdx + 6) % track.frames.length;
            const lookFrame = track.frames[lookIdx];
            if (lookFrame) {
              desiredYaw = Math.atan2(lookFrame.point.x - p.pos.x, lookFrame.point.z - p.pos.z);
            }
          }
        }

        const yawDiff = wrapAngle(desiredYaw - p.heading);
        p.heading = wrapAngle(p.heading + clamp(yawDiff, -6.5 * dt, 6.5 * dt));
        p.vel.set(Math.sin(p.heading) * p.speed, 0, Math.cos(p.heading) * p.speed);
        p.pos.x += p.vel.x * dt;
        p.pos.z += p.vel.z * dt;

        if (track && track.queryTrack) {
          const q = track.queryTrack(p.pos, p.trackIdx);
          if (q) {
            p.trackIdx = q.frameIdx;
            p.pos.y = q.point.y + (q.binormal?.y || 0) * (q.lateral || 0) + 0.15;
          }
        }
        if (p.mesh) p.mesh.rotation.y += dt * 16;
      } else if (p.type === ITEM_IDS.BOBOMB) {
        p.vel.y -= 36 * dt;
        p.pos.addScaledVector(p.vel, dt);

        if (track && track.queryTrack) {
          const q = track.queryTrack(p.pos, p.trackIdx);
          if (q) {
            p.trackIdx = q.frameIdx;
            const surfY = q.point.y + (q.binormal?.y || 0) * (q.lateral || 0);
            if (p.pos.y <= surfY + 0.1) {
              p.pos.y = surfY + 0.1;
              if (p.vel.y < -3 && (p.bouncesLeft ?? 0) > 0) {
                p.vel.y = -p.vel.y * 0.45;
                p.vel.x *= 0.55;
                p.vel.z *= 0.55;
                p.bouncesLeft = (p.bouncesLeft ?? 1) - 1;
              } else {
                p.vel.set(0, 0, 0);
              }
            }
          }
        }

        if (p.mesh && p.mesh.userData.bodyMesh && this._mats) {
          const blink = p.life < 1.2 ? Math.sin(p.age * 28) > 0 : Math.sin(p.age * 10) > 0.5;
          (p.mesh.userData.bodyMesh as THREE.Mesh).material = blink
            ? this._mats.bobombFlash
            : this._mats.bobomb;
        }
      } else if (p.type === ITEM_IDS.BLUE_SHELL) {
        const leader = Array.isArray(karts) ? karts.find((k) => k.rank === 1) || karts[0] : null;

        if (leader) {
          leader.incomingBlueShellWarning = true;
          if (!p._warnedPlayer && leader.isPlayer && audio && typeof audio.playSfx === 'function') {
            p._warnedPlayer = true;
            audio.playSfx('warning');
          }
          const distToLeader = leader.pos.distanceTo(p.pos);

          if (!p.hovering && distToLeader < 11) {
            p.hovering = true;
            p.hoverTimer = 0.65;
          }

          if (p.hovering) {
            p.hoverTimer = (p.hoverTimer ?? 0) - dt;
            p.pos.set(leader.pos.x, leader.pos.y + 3.4, leader.pos.z);
            if (p.mesh) {
              p.mesh.rotation.y += dt * 20;
              p.mesh.rotation.z = Math.sin(p.age * 18) * 0.25;
            }
            if (p.hoverTimer <= 0) {
              leader.incomingBlueShellWarning = false;
              this._spawnExplosion(leader.pos, 11.5, true, karts, audio, particles);
              this._removeProjectileAt(i);
              continue;
            }
          } else {
            let desiredYaw = p.heading;
            if (distToLeader < 48) {
              desiredYaw = Math.atan2(leader.pos.x - p.pos.x, leader.pos.z - p.pos.z);
            } else if (track && track.queryTrack) {
              const q = track.queryTrack(p.pos, p.trackIdx);
              if (q && track.frames?.length) {
                p.trackIdx = q.frameIdx;
                const lookFrame = track.frames[(q.frameIdx + 7) % track.frames.length];
                if (lookFrame) {
                  desiredYaw = Math.atan2(lookFrame.point.x - p.pos.x, lookFrame.point.z - p.pos.z);
                }
              }
            }
            const yawDiff = wrapAngle(desiredYaw - p.heading);
            p.heading = wrapAngle(p.heading + clamp(yawDiff, -8 * dt, 8 * dt));
            p.pos.x += Math.sin(p.heading) * p.speed * dt;
            p.pos.z += Math.cos(p.heading) * p.speed * dt;
            if (track && track.queryTrack) {
              const q = track.queryTrack(p.pos, p.trackIdx);
              if (q) {
                p.trackIdx = q.frameIdx;
                p.pos.y = q.point.y + (q.binormal?.y || 0) * (q.lateral || 0) + 1.85;
              }
            }
            if (p.mesh) p.mesh.rotation.y += dt * 18;
          }
        }
      }

      if (p.mesh) {
        p.mesh.position.copy(p.pos);
      }

      // Check collisions against karts & rear trailing shields
      if (p.type !== ITEM_IDS.BLUE_SHELL && Array.isArray(karts)) {
        let consumed = false;
        for (let k = 0; k < karts.length; k++) {
          const target = karts[k];
          if (!target || target.rescueTimer > 0) continue;
          if (p.age < p.armDelay && target.id === p.ownerId) continue;

          if (target.trailingItem) {
            const fwdX = Math.sin(target.heading);
            const fwdZ = Math.cos(target.heading);
            const tx = target.pos.x - fwdX * 2.35;
            const tz = target.pos.z - fwdZ * 2.35;
            if (Math.hypot(p.pos.x - tx, p.pos.z - tz) < 1.7 && Math.abs(p.pos.y - target.pos.y) < 2.0) {
              if (p.type === ITEM_IDS.BOBOMB) {
                this._spawnExplosion(p.pos, 11.0, false, karts, audio, particles);
              } else {
                this._destroyTrailVisual(target.id);
                target.trailingItem = null;
                if (audio && typeof audio.playSfx === 'function') audio.playSfx('shell_bounce');
              }
              consumed = true;
              break;
            }
          }

          const dist = Math.hypot(p.pos.x - target.pos.x, p.pos.z - target.pos.z);
          const hitRadius = getProjectileHitRadius(p.type);
          if (dist < hitRadius && Math.abs(p.pos.y - target.pos.y) < 2.0) {
            if (p.type === ITEM_IDS.BOBOMB) {
              this._spawnExplosion(p.pos, 11.0, false, karts, audio, particles);
              consumed = true;
              break;
            } else {
              const hit = this._hitKartWithProjectile(target, p, karts, audio, particles);
              if (hit) {
                consumed = true;
                break;
              }
            }
          }
        }
        if (consumed) {
          this._removeProjectileAt(i);
          continue;
        }
      }
    }

    // Check kart collisions against active trailing shields directly
    if (Array.isArray(karts)) {
      for (let a = 0; a < karts.length; a++) {
        const owner = karts[a];
        if (!owner || !owner.trailingItem || owner.rescueTimer > 0) continue;
        const fwdX = Math.sin(owner.heading);
        const fwdZ = Math.cos(owner.heading);
        const sx = owner.pos.x - fwdX * 2.35;
        const sz = owner.pos.z - fwdZ * 2.35;
        const trailHitR = getProjectileHitRadius(owner.trailingItem);

        for (let b = 0; b < karts.length; b++) {
          if (a === b) continue;
          const victim = karts[b];
          if (!victim || victim.rescueTimer > 0) continue;
          if (Math.hypot(victim.pos.x - sx, victim.pos.z - sz) < trailHitR && Math.abs(victim.pos.y - owner.pos.y) < 2.0) {
            const trailType = owner.trailingItem;
            this._destroyTrailVisual(owner.id);
            owner.trailingItem = null;
            if (trailType === ITEM_IDS.BOBOMB) {
              this._spawnExplosion(_tmpVec.set(sx, owner.pos.y, sz), 11.0, false, karts, audio, particles);
            } else {
              this._hitKartWithProjectile(victim, { type: trailType, ownerId: owner.id }, karts, audio, particles);
            }
            break;
          }
        }
      }
    }
  }

  _updateExplosions(dt: number): void {
    for (let i = this.explosions.length - 1; i >= 0; i--) {
      const ex = this.explosions[i];
      ex.age += dt;
      const u = clamp(ex.age / ex.duration, 0, 1);
      if (ex.mesh) {
        const s = 1.0 + u * ex.radius;
        ex.mesh.scale.setScalar(s);
        const mat = ex.mesh.material as THREE.Material & { opacity?: number };
        if (mat && typeof mat.opacity === 'number') {
          mat.opacity = (1 - u) * 0.72;
        }
      }
      if (u >= 1) {
        if (ex.mesh && ex.mesh.parent) ex.mesh.parent.remove(ex.mesh);
        if (ex.mesh && ex.mesh.material) {
          (ex.mesh.material as THREE.Material).dispose();
        }
        this.explosions.splice(i, 1);
      }
    }
  }

  _updateDynamicLights(karts: KartState[], gfx?: any): void {
    if (!gfx || typeof gfx.setDynamicLight !== 'function') return;

    if (typeof gfx.clearDynamicLights === 'function') {
      gfx.clearDynamicLights();
    } else {
      const zeroPos = _tmpVec.set(0, -500, 0);
      for (let s = 0; s < 4; s++) {
        gfx.setDynamicLight(s, zeroPos, 0x000000, 0, 0);
      }
    }

    let slot = 0;
    if (this.explosions.length > 0 && slot < 4) {
      const ex = this.explosions[this.explosions.length - 1];
      const fade = 1 - clamp(ex.age / ex.duration, 0, 1);
      gfx.setDynamicLight(slot++, ex.pos, ex.isBlue ? 0x22aaff : 0xff7722, 6 * fade, 28);
    }

    if (Array.isArray(karts)) {
      for (let i = 0; i < karts.length && slot < 4; i++) {
        if (karts[i].starTimer > 0) {
          const hue = (performance.now() * 0.004) % 1;
          const color = new THREE.Color().setHSL(hue, 1, 0.55).getHex();
          gfx.setDynamicLight(slot++, _tmpVec2.copy(karts[i].pos).setY(karts[i].pos.y + 1.5), color, 3.5, 16);
        }
      }
    }

    for (let i = 0; i < this.projectiles.length && slot < 4; i++) {
      const p = this.projectiles[i];
      if (p.type === ITEM_IDS.BLUE_SHELL) {
        gfx.setDynamicLight(slot++, p.pos, 0x0a84ff, 3.0, 14);
      } else if (p.type === ITEM_IDS.RED_SHELL) {
        gfx.setDynamicLight(slot++, p.pos, 0xff3b30, 2.0, 10);
      } else if (p.type === ITEM_IDS.BOBOMB && p.life < 1.0) {
        gfx.setDynamicLight(slot++, p.pos, 0xff4500, 2.5, 12);
      }
    }
  }

  /**
   * Main per-frame update for Item Boxes, roulettes, projectiles, shields, explosions, and lights.
   */
  update(
    dt: number,
    karts: KartState[] = [],
    track: TrackInstance | null = null,
    gfx: any = null,
    audio: any = null,
    particles: any = null
  ): void {
    if (dt <= 0) return;
    if (gfx && !this.gfx) this.gfx = gfx;

    if (track?.rootGroup && this._attachedTrack !== track) {
      this.clear();
      track.rootGroup.add(this.group);
      this._attachedTrack = track;
    }

    if (this.screenFlashTimer > 0) {
      this.screenFlashTimer = Math.max(0, this.screenFlashTimer - dt);
      this.screenFlash = this.screenFlashTimer / 0.48;
    } else {
      this.screenFlash = 0;
    }

    for (let i = 0; i < karts.length; i++) {
      if (karts[i]) karts[i].incomingBlueShellWarning = false;
    }

    const boxes = track?.itemBoxes;
    const itemBoxPickupR = 1.05 + KART_HALF_WIDTH;
    for (let i = 0; i < karts.length; i++) {
      const kart = karts[i];
      if (!kart) continue;

      if (kart.itemRouletteTimer > 0) {
        kart.itemRouletteTimer = Math.max(0, kart.itemRouletteTimer - dt);
        kart._rouletteTickAccum = (kart._rouletteTickAccum || 0) + dt;
        if (kart._rouletteTickAccum >= 0.1) {
          kart._rouletteTickAccum = 0;
          kart.rouletteDisplayItem = ALL_ITEM_LIST[Math.floor(Math.random() * ALL_ITEM_LIST.length)];
          if (kart.isPlayer && audio && typeof audio.playSfx === 'function') {
            audio.playSfx('item_tick');
          }
        }
        if (kart.itemRouletteTimer === 0) {
          this._lockRolledItem(kart, audio);
        }
      }

      if (boxes && boxes.length > 0 && kart.rescueTimer <= 0 && !kart.finished) {
        for (let b = 0; b < boxes.length; b++) {
          const box = boxes[b];
          if (!box.active || !box.pos) continue;
          const dx = kart.pos.x - box.pos.x;
          const dz = kart.pos.z - box.pos.z;
          const dy = kart.pos.y - box.pos.y;
          if (Math.abs(dy) < 2.2 && dx * dx + dz * dz <= itemBoxPickupR * itemBoxPickupR) {
            box.active = false;
            box.respawnTimer = 4.0;
            if (box.mesh) box.mesh.visible = false;
            if (particles && typeof particles.spawnBurst === 'function') {
              particles.spawnBurst(box.pos, 0x66e0ff, 10);
            }
            if (!kart.item && kart.itemRouletteTimer <= 0) {
              kart.itemRouletteTimer = ROULETTE_DURATION;
              kart._rouletteTickAccum = 0;
              if (kart.isPlayer && audio && typeof audio.playSfx === 'function') {
                audio.playSfx('item_tick');
              }
            }
          }
        }
      }
    }

    this._syncKartVisuals(dt, karts, gfx);
    this._updateProjectiles(dt, karts, track, gfx, audio, particles);
    this._updateExplosions(dt);
    this._updateDynamicLights(karts, gfx);
  }

  /**
   * Returns active hazards on track (bananas, bob-ombs, shells) for AI avoidance.
   */
  getActiveHazards(): ActiveProjectile[] {
    return this.projectiles;
  }

  /**
   * Removes all active projectiles, explosions, and shield meshes.
   */
  clear(): void {
    for (let i = 0; i < this.projectiles.length; i++) {
      const m = this.projectiles[i].mesh;
      if (m && m.parent) m.parent.remove(m);
    }
    this.projectiles.length = 0;

    for (let i = 0; i < this.explosions.length; i++) {
      const m = this.explosions[i].mesh;
      if (m && m.parent) m.parent.remove(m);
      if (m && m.material) (m.material as THREE.Material).dispose();
    }
    this.explosions.length = 0;

    for (const entry of this.trailVisuals.values()) {
      if (entry.mesh && entry.mesh.parent) entry.mesh.parent.remove(entry.mesh);
    }
    this.trailVisuals.clear();

    for (const orb of this.orbitVisuals.values()) {
      for (const m of orb.meshes) {
        if (m.parent) m.parent.remove(m);
      }
    }
    this.orbitVisuals.clear();
    this.screenFlash = 0;
    this.screenFlashTimer = 0;
  }

  reset(): void {
    this.clear();
  }

  dispose(): void {
    this.clear();
    if (this.group.parent) this.group.parent.remove(this.group);
    if (this._geos) {
      for (const g of Object.values(this._geos) as THREE.BufferGeometry[]) g.dispose();
      this._geos = null;
    }
    if (this._mats) {
      for (const m of Object.values(this._mats) as THREE.Material[]) m.dispose();
      this._mats = null;
    }
  }
}
