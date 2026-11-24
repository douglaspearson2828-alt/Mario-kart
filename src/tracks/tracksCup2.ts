import * as THREE from 'three';
import {
  BASE_RACE_CONFIG,
  CUP_IDS,
  SURFACE_TYPES,
  type TrackDefinition,
  type TrackInstance,
} from '../core/contracts';
import { orientToFrame } from './trackBuilder';

/**
 * Resolve a procedural texture from TextureLibrary regardless of lookup convention.
 */
function getTex(texLib: any, name: string): THREE.Texture | null {
  if (!texLib || !name) return null;
  if (typeof texLib.get === 'function') return texLib.get(name) || null;
  if (texLib.textures && texLib.textures[name]) return texLib.textures[name];
  return texLib[name] || null;
}

/**
 * Create a graphics-preset-aware material via GraphicsEngine with safe Three.js fallback.
 */
function makeMat(gfx: any, def: Record<string, any>): THREE.Material {
  if (gfx && typeof gfx.createMaterial === 'function') {
    return gfx.createMaterial(def);
  }
  if (def.isUnlit) {
    return new THREE.MeshBasicMaterial({
      color: def.color ?? 0xffffff,
      map: def.map ?? null,
      transparent: Boolean(def.transparent),
      opacity: def.opacity ?? 1,
      side: def.side ?? THREE.FrontSide,
      depthWrite: def.depthWrite !== undefined ? def.depthWrite : true,
    });
  }
  return new THREE.MeshStandardMaterial({
    color: def.color ?? 0xffffff,
    map: def.map ?? null,
    emissive: def.emissive ?? 0x000000,
    emissiveIntensity: def.emissiveIntensity ?? 0,
    roughness: def.roughness ?? 0.65,
    metalness: def.metalness ?? 0.1,
    transparent: Boolean(def.transparent),
    opacity: def.opacity ?? 1,
    side: def.side ?? THREE.FrontSide,
    flatShading: Boolean(def.flatShading),
    depthWrite: def.depthWrite !== undefined ? def.depthWrite : true,
  });
}

/**
 * Deterministic PRNG for reproducible procedural scenery placement.
 */
function seededRand(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

/**
 * Check horizontal (XZ) distance from all main track frames AND every shortcut ribbon
 * so placed landmarks never encroach into any drivable surface.
 */
function isClearOfTrack(x: number, z: number, trackInstance: TrackInstance, minClearance = 34): boolean {
  const minSq = minClearance * minClearance;
  const frames = trackInstance.frames || [];
  for (let i = 0; i < frames.length; i++) {
    const p = frames[i].point;
    const dx = x - p.x;
    const dz = z - p.z;
    if (dx * dx + dz * dz < minSq) return false;
  }
  const shortcuts = trackInstance.shortcuts || [];
  for (let s = 0; s < shortcuts.length; s++) {
    const scFrames = shortcuts[s].frames || [];
    for (let k = 0; k < scFrames.length; k++) {
      const p = scFrames[k].point;
      const dx = x - p.x;
      const dz = z - p.z;
      if (dx * dx + dz * dz < minSq) return false;
    }
  }
  return true;
}

/**
 * Check horizontal (XZ) clearance strictly against shortcut ribbons for roadside props.
 */
function isClearOfShortcuts(x: number, z: number, trackInstance: TrackInstance, extraMargin = 4): boolean {
  const shortcuts = trackInstance.shortcuts || [];
  for (let s = 0; s < shortcuts.length; s++) {
    const scFrames = shortcuts[s].frames || [];
    for (let k = 0; k < scFrames.length; k++) {
      const sf = scFrames[k];
      const minD = sf.halfWidth + extraMargin;
      const dx = x - sf.point.x;
      const dz = z - sf.point.z;
      if (dx * dx + dz * dz < minD * minD) return false;
    }
  }
  return true;
}

/**
 * Check horizontal (XZ) clearance strictly against main road frames (for shortcut-side bamboo/props).
 */
function isClearOfMainRoad(x: number, z: number, trackInstance: TrackInstance, extraMargin = 3): boolean {
  const frames = trackInstance.frames || [];
  for (let i = 0; i < frames.length; i++) {
    const mf = frames[i];
    const minD = mf.halfWidth + extraMargin;
    const dx = x - mf.point.x;
    const dz = z - mf.point.z;
    if (dx * dx + dz * dz < minD * minD) return false;
  }
  return true;
}

/**
 * Create a glowing procedural CanvasTexture for cyber billboards or signage.
 */
function createSignTexture(
  title: string,
  sub: string,
  accentHex: string,
  bgHex = '#070a1f'
): THREE.CanvasTexture | null {
  if (typeof document === 'undefined') return null;
  const c = document.createElement('canvas');
  c.width = 256;
  c.height = 128;
  const ctx = c.getContext('2d');
  if (!ctx) return null;
  ctx.fillStyle = bgHex;
  ctx.fillRect(0, 0, 256, 128);

  ctx.strokeStyle = accentHex;
  ctx.lineWidth = 6;
  ctx.strokeRect(6, 6, 244, 116);

  ctx.fillStyle = accentHex;
  ctx.font = 'bold 34px sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(title, 128, 48);

  ctx.fillStyle = '#ffffff';
  ctx.font = 'bold 20px sans-serif';
  ctx.fillText(sub, 128, 90);

  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

/* ============================================================================
 * 5. NEON METROPOLIS (Cyber Midnight Highway + 24u Overpass)
 * ========================================================================== */
const neonMetropolis: TrackDefinition = {
  id: 'neon_metropolis',
  cupId: CUP_IDS.STAR,
  name: 'Neon Metropolis',
  subtitle: 'Cyber Midnight Highway & Skyway Overpass',
  themeColor: '#00f5ff',
  roadTexture: 'neon_road',
  curbTexture: 'curb_neon',
  offroadTexture: 'cobble',
  offroadSurface: SURFACE_TYPES.OFFROAD_GRASS,
  floorY: -10.0,
  railColor: 0x00f5ff,
  deckColor: 0x0e1430,
  skyColors: {
    top: 0x040214,
    horizon: 0x1b0b42,
    bottom: 0x060418,
    sunColor: 0xff2ec4,
    sunPos: [-130, 140, -190],
    fogColor: 0x0c0628,
    fogNear: 260,
    fogFar: 1380,
  },
  ambientIntensity: 0.62,
  dirLightColor: 0x9ed8ff,
  dirLightIntensity: 1.05,
  bgmStyle: {
    tempo: 138,
    scale: [60, 63, 65, 67, 70, 72, 75, 79],
    bassPattern: [0, 0, 3, 2, 0, 4, 3, 2],
  },
  laps: BASE_RACE_CONFIG.LAPS,
  controlPoints: [
    // Start/Finish Grand Cyber Boulevard (passes UNDER the y=24 overpass at z ~ 45)
    { x: 0, y: 0, z: -40, width: 28, bank: 0, surface: SURFACE_TYPES.ROAD, offroadL: 6, offroadR: 6, wallL: true, wallR: true },
    { x: 0, y: 0, z: 45, width: 28, bank: 0, surface: SURFACE_TYPES.ROAD, offroadL: 6, offroadR: 6, wallL: true, wallR: true },
    { x: 0, y: 0, z: 135, width: 28, bank: 0, surface: SURFACE_TYPES.ROAD, offroadL: 6, offroadR: 6, wallL: true, wallR: true },
    // East banked climb onto the elevated skyway
    { x: 25, y: 2, z: 220, width: 26, bank: 0.14, surface: SURFACE_TYPES.ROAD, offroadL: 6, offroadR: 6, wallL: true, wallR: true },
    { x: 105, y: 8, z: 265, width: 26, bank: 0.22, surface: SURFACE_TYPES.ROAD, offroadL: 6, offroadR: 6, wallL: true, wallR: true },
    { x: 190, y: 15, z: 245, width: 25, bank: 0.20, surface: SURFACE_TYPES.ROAD, offroadL: 4, offroadR: 6, wallL: false, wallR: true },
    { x: 235, y: 21, z: 170, width: 24, bank: 0.14, surface: SURFACE_TYPES.ROAD, offroadL: 4, offroadR: 4, wallL: true, wallR: true },
    { x: 205, y: 24, z: 90, width: 24, bank: 0.08, surface: SURFACE_TYPES.ROAD, offroadL: 4, offroadR: 4, wallL: true, wallR: true },
    // Elevated Overpass crossing cleanly 24u above lower road!
    { x: 125, y: 24, z: 52, width: 24, bank: 0, surface: SURFACE_TYPES.ROAD, offroadL: 2, offroadR: 2, wallL: true, wallR: true },
    { x: 40, y: 24, z: 45, width: 24, bank: 0, surface: SURFACE_TYPES.ROAD, offroadL: 0, offroadR: 0, wallL: false, wallR: true },
    { x: -45, y: 24, z: 45, width: 24, bank: 0, surface: SURFACE_TYPES.ROAD, offroadL: 0, offroadR: 0, wallL: false, wallR: true },
    { x: -135, y: 23, z: 38, width: 24, bank: -0.08, surface: SURFACE_TYPES.ROAD, offroadL: 3, offroadR: 3, wallL: true, wallR: true },
    // West skyway sweeper & steep plunge into downtown
    { x: -210, y: 19, z: -15, width: 24, bank: -0.18, surface: SURFACE_TYPES.ROAD, offroadL: 5, offroadR: 5, wallL: true, wallR: true },
    { x: -230, y: 12, z: -100, width: 24, bank: -0.16, surface: SURFACE_TYPES.ROAD, offroadL: 6, offroadR: 6, wallL: true, wallR: true },
    { x: -175, y: 5, z: -170, width: 25, bank: 0.08, surface: SURFACE_TYPES.ROAD, offroadL: 6, offroadR: 6, wallL: true, wallR: true },
    { x: -200, y: 2, z: -250, width: 25, bank: -0.12, surface: SURFACE_TYPES.ROAD, offroadL: 7, offroadR: 7, wallL: true, wallR: true },
    // Downtown chicane & midnight hairpin (open right wall for Neon Cyber Alley Cut)
    { x: -140, y: 0, z: -320, width: 26, bank: -0.12, surface: SURFACE_TYPES.ROAD, offroadL: 7, offroadR: 8, wallL: true, wallR: false },
    { x: -55, y: 0, z: -295, width: 25, bank: 0.08, surface: SURFACE_TYPES.ROAD, offroadL: 7, offroadR: 8, wallL: true, wallR: false },
    { x: 35, y: 0, z: -335, width: 26, bank: -0.14, surface: SURFACE_TYPES.ROAD, offroadL: 7, offroadR: 7, wallL: true, wallR: true },
    { x: 120, y: 0, z: -305, width: 26, bank: -0.16, surface: SURFACE_TYPES.ROAD, offroadL: 7, offroadR: 7, wallL: true, wallR: true },
    { x: 145, y: 0, z: -225, width: 26, bank: -0.14, surface: SURFACE_TYPES.ROAD, offroadL: 7, offroadR: 7, wallL: true, wallR: true },
    { x: 85, y: 0, z: -190, width: 27, bank: -0.08, surface: SURFACE_TYPES.ROAD, offroadL: 6, offroadR: 6, wallL: true, wallR: true },
    { x: 20, y: 0, z: -165, width: 28, bank: -0.02, surface: SURFACE_TYPES.ROAD, offroadL: 6, offroadR: 6, wallL: true, wallR: false },
    { x: 0, y: 0, z: -105, width: 28, bank: 0, surface: SURFACE_TYPES.ROAD, offroadL: 6, offroadR: 6, wallL: true, wallR: false },
  ],
  shortcuts: [
    {
      name: 'Skyway Upper-Deck Ramp',
      type: 'ramp',
      entryT: 0.21,
      exitT: 0.41,
      boostAtEntry: true,
      isGlider: false,
      requiresBoost: false,
      rampU: 0.28,
      rampHeight: 2.8,
      roadTexture: 'neon_road',
      points: [
        { x: 178.7, y: 14.2, z: 251.9, width: 15, surface: SURFACE_TYPES.ROAD, roadTexture: 'neon_road' },
        { x: 215, y: 20.6, z: 185, width: 14, surface: SURFACE_TYPES.ROAD, roadTexture: 'neon_road' },
        { x: 165, y: 26.8, z: 115, width: 14, surface: SURFACE_TYPES.ROAD, roadTexture: 'neon_road' },
        { x: 80, y: 27.2, z: 68, width: 14, surface: SURFACE_TYPES.ROAD, roadTexture: 'neon_road' },
        { x: -8.2, y: 24.3, z: 45.1, width: 15, surface: SURFACE_TYPES.ROAD, roadTexture: 'neon_road' },
      ],
    },
    {
      name: 'Neon Cyber Alley Cut',
      type: 'offroad',
      entryT: 0.69,
      exitT: 0.95,
      boostAtEntry: true,
      isGlider: false,
      requiresBoost: true,
      roadTexture: 'cobble',
      points: [
        { x: -142.2, y: 0.2, z: -319.2, width: 14, surface: SURFACE_TYPES.COBBLE, roadTexture: 'cobble' },
        { x: -75, y: 0.6, z: -265, width: 13, surface: SURFACE_TYPES.COBBLE, roadTexture: 'cobble' },
        { x: -20, y: 0.3, z: -210, width: 13, surface: SURFACE_TYPES.COBBLE, roadTexture: 'cobble' },
        { x: -2, y: 0.25, z: -155, width: 14, surface: SURFACE_TYPES.COBBLE, roadTexture: 'cobble' },
        { x: 7.7, y: 0.15, z: -142.6, width: 14, surface: SURFACE_TYPES.ROAD, roadTexture: 'neon_road' },
      ],
    },
  ],
  boostPads: [
    { t: 0.06, lateral: -5.5, width: 5.0, length: 9.0 },
    { t: 0.16, lateral: 4.5, width: 5.0, length: 9.0 },
    { t: 0.36, lateral: 0, width: 5.4, length: 9.5 },
    { t: 0.50, lateral: -4.5, width: 5.0, length: 9.0 },
    { t: 0.75, lateral: 4.5, width: 5.0, length: 9.0 },
    { t: 0.96, lateral: 0, width: 5.4, length: 9.0 },
  ],
  ramps: [
    { t: 0.30, lateral: 3.5, width: 7.4, length: 11.0, height: 2.6, isGlider: false },
    { t: 0.56, lateral: 0, width: 8.4, length: 12.0, height: 3.4, isGlider: true },
  ],
  itemBoxRows: [
    { t: 0.09, count: 5, spread: 17 },
    { t: 0.33, count: 4, spread: 14 },
    { t: 0.61, count: 5, spread: 16 },
    { t: 0.85, count: 5, spread: 16 },
  ],
  coinLines: [
    { tStart: 0.11, tEnd: 0.15, lateral: -5.5, count: 5 },
    { tStart: 0.38, tEnd: 0.42, lateral: 4.0, count: 5 },
    { tStart: 0.46, tEnd: 0.50, lateral: 0, count: 5 },
    { tStart: 0.78, tEnd: 0.82, lateral: -5.0, count: 5 },
    { tStart: 0.90, tEnd: 0.94, lateral: 4.5, count: 5 },
  ],
  hazards: [
    { type: 'cyber_drone', t: 0.25, lateral: 0, radius: 2.2, moveAmp: 7.5, moveSpeed: 1.7 },
    { type: 'cyber_drone', t: 0.48, lateral: 0, radius: 2.2, moveAmp: 7.0, moveSpeed: 1.9 },
    { type: 'cyber_drone', t: 0.72, lateral: -2.0, radius: 2.2, moveAmp: 6.5, moveSpeed: 1.6 },
    { type: 'cyber_drone', t: 0.88, lateral: 2.0, radius: 2.2, moveAmp: 7.0, moveSpeed: 1.8 },
  ],
  buildScenery(sceneGroups, trackInstance, _texLib, gfx) {
    const [lod0, lod1, lod2, lod3] = sceneGroups;
    const rand = seededRand(505);

    const floorMat = makeMat(gfx, { color: 0x070a18, roughness: 0.65, metalness: 0.3 });
    const floor = new THREE.Mesh(new THREE.PlaneGeometry(1600, 1600), floorMat);
    floor.rotation.x = -Math.PI / 2;
    floor.position.y = -10;
    floor.receiveShadow = true;
    lod0.add(floor);

    const towerDarkMat = makeMat(gfx, { color: 0x10172f, roughness: 0.45, metalness: 0.65 });
    const towerAltMat = makeMat(gfx, { color: 0x151e3d, roughness: 0.5, metalness: 0.55 });
    const cyanGlowMat = makeMat(gfx, { color: 0x00f5ff, emissive: 0x00d8ff, emissiveIntensity: 1.05, roughness: 0.2 });
    const magentaGlowMat = makeMat(gfx, { color: 0xff2ec4, emissive: 0xff00aa, emissiveIntensity: 1.05, roughness: 0.2 });
    const violetGlowMat = makeMat(gfx, { color: 0xa855f7, emissive: 0x7c3aed, emissiveIntensity: 0.95, roughness: 0.2 });
    const goldGlowMat = makeMat(gfx, { color: 0xffd60a, emissive: 0xffaa00, emissiveIntensity: 0.95, roughness: 0.2 });
    const darkMetalMat = makeMat(gfx, { color: 0x1c233a, roughness: 0.4, metalness: 0.7 });
    const glowMats = [cyanGlowMat, magentaGlowMat, violetGlowMat, goldGlowMat];

    // Structural overpass support piers flanking lower road at t~0.045
    const underF = trackInstance.sampleFrame(0.045);
    for (const s of [-1, 1]) {
      const pierPos = underF.point.clone().addScaledVector(underF.binormal, s * (underF.halfWidth + 9.5));
      const pier = new THREE.Group();
      pier.position.set(pierPos.x, 0, pierPos.z);
      const col = new THREE.Mesh(new THREE.BoxGeometry(3.4, 24.5, 4.4), darkMetalMat);
      col.position.y = 11.2;
      col.castShadow = true;
      const neonBand = new THREE.Mesh(new THREE.BoxGeometry(3.7, 1.2, 4.7), cyanGlowMat);
      neonBand.position.y = 14;
      pier.add(col, neonBand);
      lod0.add(pier);
    }

    // Skyscrapers around and inside the cyber district
    const towerPlacements = [
      { x: 92, z: 145, w: 34, d: 34, h: 120 },
      { x: -102, z: 145, w: 36, d: 36, h: 138 },
      { x: -95, z: -72, w: 32, d: 32, h: 105 },
      { x: 95, z: -85, w: 34, d: 34, h: 112 },
      { x: 295, z: 220, w: 42, d: 42, h: 148 },
      { x: 300, z: 40, w: 38, d: 38, h: 128 },
      { x: -305, z: 120, w: 40, d: 40, h: 142 },
      { x: -305, z: -135, w: 42, d: 42, h: 155 },
      { x: -245, z: -345, w: 38, d: 38, h: 130 },
      { x: 185, z: -355, w: 44, d: 44, h: 162 },
      { x: 245, z: -145, w: 36, d: 36, h: 118 },
      { x: -35, z: 335, w: 46, d: 38, h: 144 },
    ];
    for (let i = 0; i < 22; i++) {
      const ang = (i / 22) * Math.PI * 2;
      const rad = 335 + rand() * 145;
      towerPlacements.push({
        x: Math.cos(ang) * rad,
        z: Math.sin(ang) * rad - 45,
        w: 30 + rand() * 28,
        d: 30 + rand() * 28,
        h: 95 + rand() * 115,
      });
    }

    const holoShapes: Array<{ mesh: THREE.Mesh; baseY: number; phase: number }> = [];
    towerPlacements.forEach((tp, idx) => {
      if (!isClearOfTrack(tp.x, tp.z, trackInstance, tp.w * 0.65 + 22)) return;
      const accent = glowMats[idx % glowMats.length];
      const baseMat = idx % 2 === 0 ? towerDarkMat : towerAltMat;
      const baseY = -10;

      const body = new THREE.Mesh(new THREE.BoxGeometry(tp.w, tp.h, tp.d), baseMat);
      body.position.set(tp.x, baseY + tp.h * 0.5, tp.z);
      body.castShadow = idx < 12;
      body.receiveShadow = true;
      (idx < 10 ? lod0 : lod1).add(body);

      const floors = Math.max(3, Math.floor(tp.h / 22));
      for (let f = 1; f < floors; f++) {
        const band = new THREE.Mesh(new THREE.BoxGeometry(tp.w + 0.6, 1.35, tp.d + 0.6), accent);
        band.position.set(tp.x, baseY + f * 20, tp.z);
        lod1.add(band);
      }
      const crown = new THREE.Mesh(new THREE.BoxGeometry(tp.w * 0.65, 6, tp.d * 0.65), accent);
      crown.position.set(tp.x, baseY + tp.h + 3, tp.z);
      lod1.add(crown);

      if (idx % 3 === 0) {
        const spire = new THREE.Mesh(new THREE.CylinderGeometry(0.4, 1.4, 24, 6), accent);
        spire.position.set(tp.x, baseY + tp.h + 15, tp.z);
        lod2.add(spire);
      }
    });

    // Holographic Billboards along straightaways & corners (lod1) + animated toppers (lod3)
    const signTexA = createSignTexture('TURBO 8', 'CYBER EXPRESS', '#00f5ff');
    const signTexB = createSignTexture('STAR CUP', 'NEON SKYWAY >>>', '#ff2ec4');
    const signMatA = makeMat(gfx, { color: 0xffffff, map: signTexA, emissive: 0x00aacc, emissiveIntensity: 0.85, isUnlit: true });
    const signMatB = makeMat(gfx, { color: 0xffffff, map: signTexB, emissive: 0xaa0066, emissiveIntensity: 0.85, isUnlit: true });

    const billboardSpots = [
      { t: 0.10, side: 1, mat: signMatA, accent: cyanGlowMat },
      { t: 0.27, side: 1, mat: signMatB, accent: magentaGlowMat },
      { t: 0.44, side: -1, mat: signMatA, accent: cyanGlowMat },
      { t: 0.62, side: -1, mat: signMatB, accent: violetGlowMat },
      { t: 0.84, side: 1, mat: signMatA, accent: goldGlowMat },
    ];
    billboardSpots.forEach((bs, idx) => {
      const f = trackInstance.sampleFrame(bs.t);
      const pos = f.point.clone().addScaledVector(f.binormal, bs.side * (f.halfWidth + 13));
      const grp = new THREE.Group();
      // Right-handed: +X = left = -binormal, so -bs.side * 0.35 sits behind board (away from track)
      orientToFrame(grp, f, pos);

      const post = new THREE.Mesh(new THREE.BoxGeometry(1.4, 14, 1.4), darkMetalMat);
      post.position.set(0, 5, 0);
      const board = new THREE.Mesh(new THREE.BoxGeometry(1.2, 8.5, 17), bs.mat);
      board.position.set(0, 12.5, 0);
      const frame = new THREE.Mesh(new THREE.BoxGeometry(0.9, 9.2, 17.8), bs.accent);
      frame.position.set(-bs.side * 0.35, 12.5, 0);
      grp.add(post, frame, board);
      lod1.add(grp);

      const holo = new THREE.Mesh(new THREE.OctahedronGeometry(2.6, 0), bs.accent);
      holo.position.set(pos.x, pos.y + 20.5, pos.z);
      lod3.add(holo);
      holoShapes.push({ mesh: holo, baseY: pos.y + 20.5, phase: idx * 1.4 });
    });

    // Glowing Neon Light Arches spanning the highway (lod2)
    for (let i = 0; i < 10; i++) {
      const t = (i + 0.35) / 10;
      const f = trackInstance.sampleFrame(t);
      const archGrp = new THREE.Group();
      orientToFrame(archGrp, f);
      const span = f.halfWidth + f.offroadR + 1.2;
      const archMat = glowMats[i % glowMats.length];
      const archGeo = new THREE.TorusGeometry(span, 0.58, 8, 22, Math.PI);
      const arch = new THREE.Mesh(archGeo, archMat);
      arch.position.set(0, 1.5, 0);
      archGrp.add(arch);
      lod2.add(archGrp);
    }

    // Animated Cyber Sky-Traffic Cruisers gliding above the city (lod3)
    const cruisers: Array<{ mesh: THREE.Mesh; radius: number; y: number; speed: number; phase: number }> = [];
    for (let i = 0; i < 10; i++) {
      const mat = glowMats[i % glowMats.length];
      const ship = new THREE.Mesh(new THREE.BoxGeometry(2.4, 1.1, 7.5), mat);
      const radius = 140 + (i % 4) * 55;
      const y = 42 + (i % 5) * 11;
      lod3.add(ship);
      cruisers.push({
        mesh: ship,
        radius,
        y,
        speed: (i % 2 === 0 ? 1 : -1) * (0.18 + (i % 3) * 0.07),
        phase: i * 0.9,
      });
    }

    return (_dt: number, time: number) => {
      for (const h of holoShapes) {
        h.mesh.rotation.y = time * 1.6 + h.phase;
        h.mesh.position.y = h.baseY + Math.sin(time * 2.4 + h.phase) * 1.1;
      }
      for (const c of cruisers) {
        const ang = time * c.speed + c.phase;
        c.mesh.position.set(
          Math.cos(ang) * c.radius,
          c.y + Math.sin(time * 1.5 + c.phase) * 1.5,
          Math.sin(ang) * c.radius - 30
        );
        c.mesh.rotation.y = -ang + (c.speed > 0 ? Math.PI : 0);
      }
    };
  },
};

/* ============================================================================
 * 6. SAKURA CANYON (Autumn Temple Highlands + Wooden Bridge + Waterfall)
 * ========================================================================== */
const sakuraCanyon: TrackDefinition = {
  id: 'sakura_canyon',
  cupId: CUP_IDS.STAR,
  name: 'Sakura Canyon',
  subtitle: 'Autumn Temple Highlands & Bamboo Gorge',
  themeColor: '#ff6b9d',
  curbTexture: 'curb_red_white',
  offroadTexture: 'grass',
  offroadSurface: SURFACE_TYPES.OFFROAD_GRASS,
  floorY: -18.0,
  railColor: 0xc23838,
  deckColor: 0x4d3726,
  skyColors: {
    top: 0x3b508f,
    horizon: 0xffaa80,
    bottom: 0x5d3b32,
    sunColor: 0xffd296,
    sunPos: [-160, 115, -140],
    fogColor: 0xe69e86,
    fogNear: 260,
    fogFar: 1360,
  },
  ambientIntensity: 0.72,
  dirLightColor: 0xffe2bc,
  dirLightIntensity: 1.2,
  bgmStyle: {
    tempo: 128,
    scale: [62, 64, 67, 69, 71, 74, 76, 79],
    bassPattern: [0, 0, 2, 4, 0, 3, 2, 1],
  },
  laps: BASE_RACE_CONFIG.LAPS,
  controlPoints: [
    // Temple Courtyard Start/Finish (Cobble plaza)
    { x: 0, y: 0, z: -35, width: 26, bank: 0, surface: SURFACE_TYPES.COBBLE, offroadL: 9, offroadR: 9, wallL: true, wallR: true },
    { x: 0, y: 0, z: 45, width: 26, bank: 0, surface: SURFACE_TYPES.COBBLE, offroadL: 9, offroadR: 9, wallL: true, wallR: true },
    // Mountain touge climbing switchbacks
    { x: 22, y: 2, z: 125, width: 25, bank: 0.12, surface: SURFACE_TYPES.ROAD, offroadL: 9, offroadR: 9, wallL: true, wallR: true },
    { x: 95, y: 6, z: 175, width: 24, bank: 0.18, surface: SURFACE_TYPES.ROAD, offroadL: 10, offroadR: 9, wallL: false, wallR: true },
    { x: 175, y: 11, z: 155, width: 23, bank: 0.18, surface: SURFACE_TYPES.ROAD, offroadL: 11, offroadR: 9, wallL: false, wallR: true },
    { x: 195, y: 15, z: 80, width: 23, bank: 0.10, surface: SURFACE_TYPES.ROAD, offroadL: 9, offroadR: 9, wallL: true, wallR: true },
    { x: 135, y: 17, z: 25, width: 23, bank: -0.10, surface: SURFACE_TYPES.ROAD, offroadL: 9, offroadR: 9, wallL: true, wallR: true },
    { x: 130, y: 19, z: -55, width: 23, bank: 0.10, surface: SURFACE_TYPES.ROAD, offroadL: 9, offroadR: 10, wallL: true, wallR: false },
    { x: 195, y: 19, z: -120, width: 23, bank: 0.16, surface: SURFACE_TYPES.ROAD, offroadL: 9, offroadR: 10, wallL: true, wallR: false },
    { x: 205, y: 17, z: -200, width: 23, bank: 0.14, surface: SURFACE_TYPES.ROAD, offroadL: 9, offroadR: 9, wallL: true, wallR: true },
    { x: 135, y: 15, z: -255, width: 23, bank: 0.06, surface: SURFACE_TYPES.ROAD, offroadL: 7, offroadR: 7, wallL: true, wallR: true },
    // Wooden Canyon Bridge spanning high over the rushing gorge river
    { x: 55, y: 15, z: -260, width: 22, bank: 0, surface: SURFACE_TYPES.WOOD, offroadL: 0, offroadR: 0, wallL: true, wallR: true },
    { x: -30, y: 15, z: -260, width: 22, bank: 0, surface: SURFACE_TYPES.WOOD, offroadL: 0, offroadR: 0, wallL: true, wallR: true },
    { x: -115, y: 13, z: -245, width: 23, bank: 0.08, surface: SURFACE_TYPES.ROAD, offroadL: 8, offroadR: 8, wallL: true, wallR: true },
    // Downhill temple steps & blossom forest hairpins
    { x: -185, y: 9, z: -195, width: 24, bank: 0.14, surface: SURFACE_TYPES.ROAD, offroadL: 10, offroadR: 9, wallL: false, wallR: true },
    { x: -205, y: 5, z: -115, width: 24, bank: 0.10, surface: SURFACE_TYPES.ROAD, offroadL: 9, offroadR: 9, wallL: true, wallR: true },
    { x: -165, y: 3, z: -40, width: 24, bank: -0.10, surface: SURFACE_TYPES.ROAD, offroadL: 9, offroadR: 9, wallL: true, wallR: true },
    { x: -200, y: 2, z: 45, width: 24, bank: 0.14, surface: SURFACE_TYPES.ROAD, offroadL: 10, offroadR: 9, wallL: false, wallR: true },
    { x: -175, y: 1, z: 125, width: 24, bank: 0.16, surface: SURFACE_TYPES.ROAD, offroadL: 10, offroadR: 9, wallL: false, wallR: true },
    { x: -95, y: 0, z: 115, width: 24, bank: 0.10, surface: SURFACE_TYPES.ROAD, offroadL: 9, offroadR: 9, wallL: true, wallR: true },
    { x: -85, y: 0, z: 25, width: 24, bank: -0.04, surface: SURFACE_TYPES.ROAD, offroadL: 9, offroadR: 9, wallL: true, wallR: true },
    { x: -110, y: 0, z: -75, width: 24, bank: 0.08, surface: SURFACE_TYPES.ROAD, offroadL: 9, offroadR: 9, wallL: true, wallR: true },
    { x: -100, y: 0, z: -165, width: 25, bank: 0.12, surface: SURFACE_TYPES.COBBLE, offroadL: 9, offroadR: 9, wallL: true, wallR: true },
    { x: -30, y: 0, z: -180, width: 26, bank: 0.04, surface: SURFACE_TYPES.COBBLE, offroadL: 9, offroadR: 9, wallL: true, wallR: true },
    { x: 0, y: 0, z: -110, width: 26, bank: 0, surface: SURFACE_TYPES.COBBLE, offroadL: 9, offroadR: 9, wallL: true, wallR: true },
  ],
  shortcuts: [
    {
      name: 'Bamboo Grove Dirt Cut',
      type: 'offroad',
      entryT: 0.16,
      exitT: 0.30,
      boostAtEntry: false,
      isGlider: false,
      requiresBoost: true,
      points: [
        { x: 177.2, y: 11.6, z: 152.5, width: 13, surface: SURFACE_TYPES.OFFROAD_GRASS },
        { x: 158, y: 15.6, z: 95, width: 12, surface: SURFACE_TYPES.OFFROAD_GRASS },
        { x: 150, y: 18.2, z: 15, width: 12, surface: SURFACE_TYPES.OFFROAD_GRASS },
        { x: 155, y: 19.5, z: -45, width: 13, surface: SURFACE_TYPES.OFFROAD_GRASS },
        { x: 171.1, y: 19.5, z: -94.7, width: 13, surface: SURFACE_TYPES.OFFROAD_GRASS },
      ],
    },
    {
      name: 'Temple Steps Glider Jump',
      type: 'ramp',
      entryT: 0.54,
      exitT: 0.72,
      boostAtEntry: true,
      isGlider: true,
      requiresBoost: false,
      rampU: 0.25,
      rampHeight: 2.2,
      points: [
        { x: -161.0, y: 11.0, z: -219.2, width: 14, surface: SURFACE_TYPES.COBBLE },
        { x: -168, y: 7.6, z: -135, width: 14, surface: SURFACE_TYPES.COBBLE },
        { x: -168, y: 5.0, z: -45, width: 14, surface: SURFACE_TYPES.VOID },
        { x: -176, y: 2.4, z: 45, width: 14, surface: SURFACE_TYPES.ROAD },
        { x: -173.8, y: 1.2, z: 125.6, width: 14, surface: SURFACE_TYPES.ROAD },
      ],
    },
  ],
  boostPads: [
    { t: 0.05, lateral: 4.5, width: 4.8, length: 8.5 },
    { t: 0.24, lateral: -4.0, width: 4.8, length: 8.5 },
    { t: 0.48, lateral: 0, width: 5.2, length: 9.0 },
    { t: 0.67, lateral: 4.5, width: 4.8, length: 8.5 },
    { t: 0.91, lateral: 0, width: 5.2, length: 9.0 },
  ],
  ramps: [
    { t: 0.34, lateral: 3.5, width: 7.4, length: 10.5, height: 2.5, isGlider: false },
    { t: 0.79, lateral: -4.0, width: 8.0, length: 11.0, height: 3.2, isGlider: true },
  ],
  itemBoxRows: [
    { t: 0.10, count: 5, spread: 16 },
    { t: 0.38, count: 4, spread: 14 },
    { t: 0.61, count: 5, spread: 16 },
    { t: 0.85, count: 5, spread: 16 },
  ],
  coinLines: [
    { tStart: 0.11, tEnd: 0.15, lateral: -5.0, count: 5 },
    { tStart: 0.45, tEnd: 0.50, lateral: -4.0, count: 5 },
    { tStart: 0.56, tEnd: 0.60, lateral: 4.0, count: 4 },
    { tStart: 0.73, tEnd: 0.77, lateral: 5.0, count: 5 },
    { tStart: 0.88, tEnd: 0.92, lateral: -4.0, count: 5 },
  ],
  hazards: [
    { type: 'thwomp', t: 0.08, lateral: 4.2, radius: 2.1, moveAmp: 0, moveSpeed: 0 },
    { type: 'boulder', t: 0.31, lateral: 0, radius: 2.2, moveAmp: 6.2, moveSpeed: 1.6 },
    { type: 'boulder', t: 0.64, lateral: 0, radius: 2.2, moveAmp: 6.8, moveSpeed: 1.8 },
    { type: 'thwomp', t: 0.87, lateral: -4.2, radius: 2.1, moveAmp: 0, moveSpeed: 0 },
  ],
  buildScenery(sceneGroups, trackInstance, texLib, gfx) {
    const [lod0, lod1, lod2, lod3] = sceneGroups;
    const rand = seededRand(606);

    const grassTex = getTex(texLib, 'grass');
    const valleyMat = makeMat(gfx, { color: grassTex ? 0xa4b878 : 0x5c7c44, map: grassTex, roughness: 0.92 });
    const canyonFloor = new THREE.Mesh(new THREE.PlaneGeometry(1600, 1600), valleyMat);
    canyonFloor.rotation.x = -Math.PI / 2;
    canyonFloor.position.y = -18;
    canyonFloor.receiveShadow = true;
    lod0.add(canyonFloor);

    // Canyon gorge river running under the wooden bridge (x=12, z=-260)
    const riverMat = makeMat(gfx, {
      color: 0x1ea8c6,
      emissive: 0x0b4c63,
      emissiveIntensity: 0.45,
      roughness: 0.18,
      metalness: 0.2,
    });
    const river = new THREE.Mesh(new THREE.PlaneGeometry(46, 720), riverMat);
    river.rotation.x = -Math.PI / 2;
    river.position.set(14, -17.4, -310);
    lod0.add(river);

    const vermilionMat = makeMat(gfx, { color: 0xd93228, roughness: 0.45, metalness: 0.08 });
    const darkRoofMat = makeMat(gfx, { color: 0x222633, roughness: 0.6, metalness: 0.25 });
    const creamWallMat = makeMat(gfx, { color: 0xf4ead5, roughness: 0.75 });
    const woodMat = makeMat(gfx, { color: 0x6b4426, roughness: 0.85 });
    const goldMat = makeMat(gfx, { color: 0xffc833, emissive: 0x805500, emissiveIntensity: 0.4, metalness: 0.8, roughness: 0.25 });
    const cliffMat = makeMat(gfx, { color: 0x6e5548, roughness: 0.9, flatShading: true });
    const blossomMatA = makeMat(gfx, { color: 0xff8ab5, emissive: 0x661a38, emissiveIntensity: 0.2, roughness: 0.65 });
    const blossomMatB = makeMat(gfx, { color: 0xffb3cf, emissive: 0x662244, emissiveIntensity: 0.2, roughness: 0.65 });
    const bambooMat = makeMat(gfx, { color: 0x3b8c3b, roughness: 0.65 });
    const stoneMat = makeMat(gfx, { color: 0x8d8f94, roughness: 0.85, flatShading: true });
    const lanternGlowMat = makeMat(gfx, { color: 0xffdd77, emissive: 0xff9922, emissiveIntensity: 1.05 });

    // Helper: Vermilion Torii Gate
    const buildToriiGate = (scale = 1): THREE.Group => {
      const grp = new THREE.Group();
      const span = 16 * scale;
      const h = 13.5 * scale;
      for (const s of [-1, 1]) {
        const base = new THREE.Mesh(new THREE.CylinderGeometry(1.25 * scale, 1.4 * scale, 2.2 * scale, 10), darkRoofMat);
        base.position.set(s * span, 1.1 * scale, 0);
        const col = new THREE.Mesh(new THREE.CylinderGeometry(0.9 * scale, 1.05 * scale, h, 10), vermilionMat);
        col.position.set(s * span, h * 0.5 + 0.5 * scale, 0);
        col.castShadow = true;
        grp.add(base, col);
      }
      const lowerBeam = new THREE.Mesh(new THREE.BoxGeometry(span * 2.25, 1.1 * scale, 1.2 * scale), vermilionMat);
      lowerBeam.position.set(0, h - 2.3 * scale, 0);
      const topBeam = new THREE.Mesh(new THREE.BoxGeometry(span * 2.55, 1.5 * scale, 1.8 * scale), darkRoofMat);
      topBeam.position.set(0, h + 0.4 * scale, 0);
      const topTrim = new THREE.Mesh(new THREE.BoxGeometry(span * 2.45, 0.9 * scale, 1.5 * scale), vermilionMat);
      topTrim.position.set(0, h - 0.5 * scale, 0);
      grp.add(lowerBeam, topTrim, topBeam);
      return grp;
    };

    // Place 3 Vermilion Torii Gates: Start Courtyard, Bamboo Shortcut Entry, Bridge Approach
    for (const gt of [0.025, 0.435]) {
      const f = trackInstance.sampleFrame(gt);
      const torii = buildToriiGate(1.05);
      orientToFrame(torii, f);
      lod0.add(torii);
    }
    const bambooEntryF = trackInstance.sampleFrame(0.16);
    const bambooTorii = buildToriiGate(0.72);
    const bPos = bambooEntryF.point.clone().addScaledVector(bambooEntryF.binormal, -(bambooEntryF.halfWidth + 4.5));
    orientToFrame(bambooTorii, bambooEntryF, bPos);
    bambooTorii.rotateY(0.55);
    lod0.add(bambooTorii);

    // Multi-Tiered Traditional 5-Story Pagoda overlooking the courtyard & canyon (lod0)
    const pagoda = new THREE.Group();
    const pagPos = { x: -42, y: -2, z: 22 };
    if (isClearOfTrack(pagPos.x, pagPos.z, trackInstance, 24)) {
      pagoda.position.set(pagPos.x, pagPos.y, pagPos.z);
    } else {
      pagoda.position.set(42, -2, -32);
    }
    const plinth = new THREE.Mesh(new THREE.BoxGeometry(22, 6, 22), stoneMat);
    plinth.position.y = 3;
    pagoda.add(plinth);
    for (let tier = 0; tier < 5; tier++) {
      const w = 15 - tier * 1.9;
      const y = 6 + tier * 7.5;
      const body = new THREE.Mesh(new THREE.BoxGeometry(w * 0.72, 5.2, w * 0.72), creamWallMat);
      body.position.y = y + 2.6;
      body.castShadow = true;
      const trim = new THREE.Mesh(new THREE.BoxGeometry(w * 0.76, 1.1, w * 0.76), vermilionMat);
      trim.position.y = y + 5.1;
      const roof = new THREE.Mesh(new THREE.ConeGeometry(w * 0.92, 3.2, 4), darkRoofMat);
      roof.rotation.y = Math.PI / 4;
      roof.position.y = y + 6.8;
      roof.castShadow = true;
      pagoda.add(body, trim, roof);
    }
    const spire = new THREE.Mesh(new THREE.CylinderGeometry(0.25, 0.8, 9, 8), goldMat);
    spire.position.y = 48;
    pagoda.add(spire);
    lod0.add(pagoda);

    // Autumn Canyon Cliffs & Mountain Peaks (lod0)
    for (let i = 0; i < 20; i++) {
      const ang = (i / 20) * Math.PI * 2;
      const rad = 285 + (i % 3) * 65;
      const mx = Math.cos(ang) * rad;
      const mz = Math.sin(ang) * rad - 45;
      if (!isClearOfTrack(mx, mz, trackInstance, 45)) continue;
      const mh = 55 + rand() * 65;
      const mr = 32 + rand() * 24;
      const peak = new THREE.Mesh(new THREE.ConeGeometry(mr, mh, 6), cliffMat);
      peak.position.set(mx, -18 + mh * 0.5, mz);
      lod0.add(peak);
    }

    // Cascading Cliff Waterfall feeding the canyon river north of the bridge (lod1)
    const wfGroup = new THREE.Group();
    wfGroup.position.set(14, 0, -345);
    const cliffBack = new THREE.Mesh(new THREE.BoxGeometry(56, 52, 24), cliffMat);
    cliffBack.position.set(0, 6, -12);
    const fallMat = makeMat(gfx, {
      color: 0x8ef2ff,
      emissive: 0x2288bb,
      emissiveIntensity: 0.65,
      transparent: true,
      opacity: 0.88,
      roughness: 0.15,
    });
    const cascade = new THREE.Mesh(new THREE.BoxGeometry(24, 48, 3.2), fallMat);
    cascade.position.set(0, 6, 1.5);
    const foamMat = makeMat(gfx, { color: 0xffffff, emissive: 0x99efff, emissiveIntensity: 0.7, roughness: 0.4 });
    const splashRing = new THREE.Mesh(new THREE.TorusGeometry(14, 2.2, 8, 20), foamMat);
    splashRing.rotation.x = Math.PI / 2;
    splashRing.position.set(0, -17, 6);
    wfGroup.add(cliffBack, cascade, splashRing);
    lod1.add(wfGroup);

    // Wooden Bridge Timber Support Trestles underneath bridge frames (lod1)
    for (const bt of [0.46, 0.485, 0.51]) {
      const bf = trackInstance.sampleFrame(bt);
      const trestle = new THREE.Group();
      orientToFrame(trestle, bf);
      for (const s of [-1, 1]) {
        const leg = new THREE.Mesh(new THREE.BoxGeometry(1.8, 33, 1.8), woodMat);
        leg.position.set(s * (bf.halfWidth - 2.5), -17.5, 0);
        trestle.add(leg);
      }
      const cross = new THREE.Mesh(new THREE.BoxGeometry(bf.width - 2, 1.6, 1.6), woodMat);
      cross.position.set(0, -8, 0);
      trestle.add(cross);
      lod1.add(trestle);
    }

    // Cherry Blossom (Sakura) Trees (lod2)
    const trunkGeo = new THREE.CylinderGeometry(0.65, 1.05, 8.5, 7);
    const puffGeo = new THREE.IcosahedronGeometry(4.2, 1);
    const placeSakuraTree = (x: number, y: number, z: number, scale = 1, mat: THREE.Material = blossomMatA) => {
      const tree = new THREE.Group();
      tree.position.set(x, y, z);
      tree.scale.setScalar(scale);
      const trunk = new THREE.Mesh(trunkGeo, woodMat);
      trunk.position.y = 4.25;
      trunk.castShadow = true;
      const p1 = new THREE.Mesh(puffGeo, mat);
      p1.position.set(0, 9.2, 0);
      p1.scale.set(1.25, 0.8, 1.25);
      const p2 = new THREE.Mesh(puffGeo, blossomMatB);
      p2.position.set(2.4, 8.2, 1.2);
      p2.scale.set(0.8, 0.7, 0.8);
      const p3 = new THREE.Mesh(puffGeo, mat);
      p3.position.set(-2.2, 8.0, -1.4);
      p3.scale.set(0.78, 0.68, 0.78);
      tree.add(trunk, p1, p2, p3);
      lod2.add(tree);
    };

    for (let i = 0; i < 34; i++) {
      const t = (i + 0.3) / 34;
      const f = trackInstance.sampleFrame(t);
      if (f.surface === SURFACE_TYPES.WOOD) continue;
      const side = i % 2 === 0 ? 1 : -1;
      const lat = side * (f.halfWidth + f.offroadR + 7.5 + rand() * 8);
      const tp = f.point.clone().addScaledVector(f.binormal, lat);
      if (!isClearOfTrack(tp.x, tp.z, trackInstance, 21)) continue;
      placeSakuraTree(tp.x, tp.y - 0.5, tp.z, 0.85 + rand() * 0.45, i % 3 === 0 ? blossomMatB : blossomMatA);
    }

    // Tall Green Bamboo Grove flanking the Bamboo Grove Dirt Cut shortcut (lod2) — keep clear of main road
    const bambooGeo = new THREE.CylinderGeometry(0.32, 0.38, 17, 6);
    const scBamboo = trackInstance.shortcuts?.[0];
    if (scBamboo && scBamboo.frames) {
      for (let k = 2; k < scBamboo.frames.length - 2; k += 2) {
        const sf = scBamboo.frames[k];
        for (const s of [-1, 1]) {
          for (let b = 0; b < 2; b++) {
            const bp = sf.point.clone().addScaledVector(sf.binormal, s * (sf.halfWidth + 2.5 + b * 2.2));
            const sx = bp.x + (rand() - 0.5) * 1.4;
            const sz = bp.z + (rand() - 0.5) * 1.4;
            if (!isClearOfMainRoad(sx, sz, trackInstance, 3.5)) continue;
            const stalk = new THREE.Mesh(bambooGeo, bambooMat);
            stalk.position.set(sx, sf.point.y + 8, sz);
            stalk.rotation.z = (rand() - 0.5) * 0.12;
            lod2.add(stalk);
          }
        }
      }
    }

    // Stone Lanterns (Tōrō) along temple courtyard and downhill road (lod2) — skip open shortcut mouths
    for (let i = 0; i < 16; i++) {
      const t = (i + 0.5) / 16;
      const f = trackInstance.sampleFrame(t);
      if (f.surface === SURFACE_TYPES.WOOD) continue;
      const side = i % 2 === 0 ? -1 : 1;
      if (side < 0 ? f.openMouthL : f.openMouthR) continue;
      const lp = f.point.clone().addScaledVector(f.binormal, side * (f.halfWidth + 2.8));
      if (!isClearOfShortcuts(lp.x, lp.z, trackInstance, 3)) continue;
      const lantern = new THREE.Group();
      lantern.position.copy(lp);
      const post = new THREE.Mesh(new THREE.CylinderGeometry(0.35, 0.5, 2.4, 6), stoneMat);
      post.position.y = 1.2;
      const box = new THREE.Mesh(new THREE.BoxGeometry(0.95, 0.95, 0.95), lanternGlowMat);
      box.position.y = 2.8;
      const cap = new THREE.Mesh(new THREE.ConeGeometry(1.15, 0.85, 4), stoneMat);
      cap.rotation.y = Math.PI / 4;
      cap.position.y = 3.65;
      lantern.add(post, box, cap);
      lod2.add(lantern);
    }

    // Drifting Pink Sakura Petals across the wind (lod3)
    const petalGeo = new THREE.PlaneGeometry(0.55, 0.38);
    const petalMat = makeMat(gfx, { color: 0xffa6c9, emissive: 0x661a38, emissiveIntensity: 0.35, side: THREE.DoubleSide });
    const petals: Array<{ mesh: THREE.Mesh; bx: number; by: number; bz: number; phase: number; speed: number }> = [];
    for (let i = 0; i < 72; i++) {
      const p = new THREE.Mesh(petalGeo, petalMat);
      const bx = (rand() - 0.5) * 440;
      const by = 4 + rand() * 26;
      const bz = (rand() - 0.5) * 480 - 40;
      p.position.set(bx, by, bz);
      lod3.add(p);
      petals.push({ mesh: p, bx, by, bz, phase: rand() * Math.PI * 2, speed: 0.7 + rand() * 0.9 });
    }

    return (_dt: number, time: number) => {
      splashRing.scale.setScalar(0.92 + Math.sin(time * 5.0) * 0.1);
      for (const pt of petals) {
        pt.mesh.position.x = pt.bx + Math.sin(time * 0.65 * pt.speed + pt.phase) * 14;
        pt.mesh.position.y = (((pt.by - time * 1.9 * pt.speed) % 24) + 24) % 24 + 1;
        pt.mesh.rotation.x = time * 1.9 + pt.phase;
        pt.mesh.rotation.y = time * 1.3 + pt.phase;
      }
    };
  },
};

/* ============================================================================
 * 7. SANDSTONE OASIS (Desert Pyramid Ruins + Aqueduct + Rolling Boulders)
 * ========================================================================== */
const sandstoneOasis: TrackDefinition = {
  id: 'sandstone_oasis',
  cupId: CUP_IDS.STAR,
  name: 'Sandstone Oasis',
  subtitle: 'Desert Pyramid Ruins & Emerald Lagoon',
  themeColor: '#f5a623',
  roadTexture: 'sand_road',
  curbTexture: 'curb_red_white',
  offroadTexture: 'sand',
  offroadSurface: SURFACE_TYPES.OFFROAD_SAND,
  floorY: -7.0,
  railColor: 0xe09f3e,
  deckColor: 0x9b743c,
  skyColors: {
    top: 0x1668b2,
    horizon: 0xf7cf86,
    bottom: 0xc98a42,
    sunColor: 0xfff0b3,
    sunPos: [145, 175, 85],
    fogColor: 0xebd19c,
    fogNear: 280,
    fogFar: 1450,
  },
  ambientIntensity: 0.78,
  dirLightColor: 0xfff2cc,
  dirLightIntensity: 1.28,
  bgmStyle: {
    tempo: 132,
    scale: [62, 63, 67, 69, 70, 74, 75, 79],
    bassPattern: [0, 0, 4, 3, 0, 2, 4, 3],
  },
  laps: BASE_RACE_CONFIG.LAPS,
  controlPoints: [
    // Oasis Plaza Start/Finish
    { x: 0, y: 0, z: -40, width: 28, bank: 0, surface: SURFACE_TYPES.ROAD, offroadL: 10, offroadR: 10, wallL: true, wallR: true },
    { x: 0, y: 0, z: 50, width: 28, bank: 0, surface: SURFACE_TYPES.ROAD, offroadL: 10, offroadR: 10, wallL: true, wallR: true },
    // Emerald Oasis Lagoon sweeping curve
    { x: 25, y: 1, z: 140, width: 26, bank: 0.12, surface: SURFACE_TYPES.ROAD, offroadL: 10, offroadR: 10, wallL: false, wallR: true },
    { x: 105, y: 3, z: 195, width: 26, bank: 0.16, surface: SURFACE_TYPES.ROAD, offroadL: 10, offroadR: 10, wallL: false, wallR: true },
    { x: 195, y: 6, z: 175, width: 26, bank: 0.14, surface: SURFACE_TYPES.ROAD, offroadL: 10, offroadR: 10, wallL: true, wallR: true },
    { x: 235, y: 10, z: 95, width: 25, bank: 0.10, surface: SURFACE_TYPES.ROAD, offroadL: 10, offroadR: 10, wallL: false, wallR: true },
    // Sandstone Mesa S-climb up to the Stone Aqueduct
    { x: 195, y: 13, z: 10, width: 25, bank: -0.10, surface: SURFACE_TYPES.ROAD, offroadL: 10, offroadR: 10, wallL: false, wallR: true },
    { x: 235, y: 16, z: -75, width: 25, bank: 0.12, surface: SURFACE_TYPES.ROAD, offroadL: 10, offroadR: 10, wallL: true, wallR: true },
    { x: 205, y: 17, z: -170, width: 24, bank: 0.14, surface: SURFACE_TYPES.ROAD, offroadL: 9, offroadR: 9, wallL: true, wallR: true },
    // Monumental Stone Aqueduct Bridge
    { x: 120, y: 16, z: -240, width: 24, bank: 0.04, surface: SURFACE_TYPES.COBBLE, roadTexture: 'cobble', offroadL: 4, offroadR: 4, wallL: true, wallR: true },
    { x: 30, y: 16, z: -255, width: 23, bank: 0, surface: SURFACE_TYPES.COBBLE, roadTexture: 'cobble', offroadL: 0, offroadR: 0, wallL: true, wallR: true },
    { x: -60, y: 16, z: -250, width: 23, bank: 0, surface: SURFACE_TYPES.COBBLE, roadTexture: 'cobble', offroadL: 0, offroadR: 0, wallL: true, wallR: true },
    // Pyramid Gorge Descent & Ruins Chicane
    { x: -150, y: 12, z: -215, width: 25, bank: 0.10, surface: SURFACE_TYPES.ROAD, offroadL: 10, offroadR: 10, wallL: true, wallR: true },
    { x: -220, y: 7, z: -145, width: 26, bank: 0.14, surface: SURFACE_TYPES.ROAD, offroadL: 10, offroadR: 10, wallL: true, wallR: true },
    { x: -235, y: 3, z: -50, width: 26, bank: 0.12, surface: SURFACE_TYPES.ROAD, offroadL: 10, offroadR: 10, wallL: true, wallR: true },
    { x: -205, y: 2, z: 45, width: 26, bank: 0.12, surface: SURFACE_TYPES.ROAD, offroadL: 11, offroadR: 10, wallL: false, wallR: true },
    { x: -135, y: 2, z: 80, width: 25, bank: 0.12, surface: SURFACE_TYPES.ROAD, offroadL: 11, offroadR: 10, wallL: false, wallR: true },
    { x: -95, y: 1, z: 10, width: 25, bank: -0.04, surface: SURFACE_TYPES.ROAD, offroadL: 10, offroadR: 10, wallL: true, wallR: true },
    { x: -115, y: 0, z: -80, width: 26, bank: 0.08, surface: SURFACE_TYPES.ROAD, offroadL: 10, offroadR: 10, wallL: true, wallR: true },
    { x: -95, y: 0, z: -165, width: 26, bank: 0.12, surface: SURFACE_TYPES.ROAD, offroadL: 10, offroadR: 10, wallL: true, wallR: false },
    { x: -25, y: 0, z: -175, width: 27, bank: 0.04, surface: SURFACE_TYPES.ROAD, offroadL: 10, offroadR: 10, wallL: true, wallR: false },
    { x: 0, y: 0, z: -115, width: 28, bank: 0, surface: SURFACE_TYPES.ROAD, offroadL: 10, offroadR: 10, wallL: true, wallR: true },
  ],
  shortcuts: [
    {
      name: 'Dune-Crest Oasis Glider',
      type: 'ramp',
      entryT: 0.12,
      exitT: 0.25,
      boostAtEntry: true,
      isGlider: true,
      requiresBoost: false,
      rampU: 0.30,
      rampHeight: 3.4,
      roadTexture: 'sand',
      points: [
        { x: 66.8, y: 2.2, z: 178.6, width: 14, surface: SURFACE_TYPES.OFFROAD_SAND, roadTexture: 'sand' },
        { x: 112, y: 11.0, z: 158, width: 14, surface: SURFACE_TYPES.OFFROAD_SAND, roadTexture: 'sand' },
        { x: 162, y: 10.5, z: 125, width: 14, surface: SURFACE_TYPES.VOID },
        { x: 202, y: 11.05, z: 92, width: 14, surface: SURFACE_TYPES.ROAD, roadTexture: 'sand_road' },
        { x: 223.1, y: 11.35, z: 64.3, width: 14, surface: SURFACE_TYPES.ROAD, roadTexture: 'sand_road' },
      ],
    },
    {
      name: 'Ruined Arch Sand Cut',
      type: 'offroad',
      entryT: 0.70,
      exitT: 0.92,
      boostAtEntry: false,
      isGlider: false,
      requiresBoost: true,
      roadTexture: 'sand',
      points: [
        { x: -224.0, y: 2.4, z: 8.2, width: 14, surface: SURFACE_TYPES.OFFROAD_SAND, roadTexture: 'sand' },
        { x: -160, y: 2.2, z: 15, width: 13, surface: SURFACE_TYPES.OFFROAD_SAND, roadTexture: 'sand' },
        { x: -135, y: 1.1, z: -75, width: 13, surface: SURFACE_TYPES.OFFROAD_SAND, roadTexture: 'sand' },
        { x: -85, y: 0.35, z: -155, width: 13, surface: SURFACE_TYPES.OFFROAD_SAND, roadTexture: 'sand' },
        { x: -43.6, y: 0.2, z: -179.4, width: 14, surface: SURFACE_TYPES.OFFROAD_SAND, roadTexture: 'sand' },
      ],
    },
  ],
  boostPads: [
    { t: 0.06, lateral: -5.0, width: 5.0, length: 8.5 },
    { t: 0.34, lateral: 4.5, width: 5.0, length: 8.5 },
    { t: 0.50, lateral: 0, width: 5.4, length: 9.0 },
    { t: 0.74, lateral: -4.5, width: 5.0, length: 8.5 },
    { t: 0.94, lateral: 0, width: 5.4, length: 9.0 },
  ],
  ramps: [
    { t: 0.21, lateral: -4.0, width: 7.4, length: 10.5, height: 2.6, isGlider: false },
    { t: 0.61, lateral: 0, width: 8.4, length: 11.5, height: 3.3, isGlider: true },
  ],
  itemBoxRows: [
    { t: 0.09, count: 5, spread: 17 },
    { t: 0.42, count: 4, spread: 14 },
    { t: 0.65, count: 5, spread: 16 },
    { t: 0.86, count: 5, spread: 16 },
  ],
  coinLines: [
    { tStart: 0.15, tEnd: 0.19, lateral: 5.0, count: 5 },
    { tStart: 0.47, tEnd: 0.52, lateral: -4.0, count: 5 },
    { tStart: 0.55, tEnd: 0.59, lateral: 4.0, count: 5 },
    { tStart: 0.77, tEnd: 0.81, lateral: 5.0, count: 5 },
    { tStart: 0.90, tEnd: 0.94, lateral: -4.0, count: 5 },
  ],
  hazards: [
    { type: 'boulder', t: 0.29, lateral: 0, radius: 2.3, moveAmp: 7.0, moveSpeed: 1.7 },
    { type: 'boulder', t: 0.45, lateral: 2.0, radius: 2.2, moveAmp: 6.5, moveSpeed: 1.9 },
    { type: 'boulder', t: 0.57, lateral: -2.0, radius: 2.3, moveAmp: 7.0, moveSpeed: 1.6 },
    { type: 'boulder', t: 0.79, lateral: 0, radius: 2.2, moveAmp: 7.2, moveSpeed: 1.8 },
    { type: 'boulder', t: 0.89, lateral: 2.5, radius: 2.1, moveAmp: 6.0, moveSpeed: 2.0 },
  ],
  buildScenery(sceneGroups, trackInstance, texLib, gfx) {
    const [lod0, lod1, lod2, lod3] = sceneGroups;
    const rand = seededRand(707);

    const sandTex = getTex(texLib, 'sand');
    const desertMat = makeMat(gfx, { color: sandTex ? 0xf6db9d : 0xe0b56c, map: sandTex, roughness: 0.94 });
    const floor = new THREE.Mesh(new THREE.PlaneGeometry(1700, 1700), desertMat);
    floor.rotation.x = -Math.PI / 2;
    floor.position.y = -7;
    floor.receiveShadow = true;
    lod0.add(floor);

    const sandstoneMat = makeMat(gfx, { color: 0xd9a15b, roughness: 0.88, flatShading: true });
    const mesaMat = makeMat(gfx, { color: 0xb95f3c, roughness: 0.9, flatShading: true });
    const goldMat = makeMat(gfx, { color: 0xffcf40, emissive: 0x805a00, emissiveIntensity: 0.4, metalness: 0.82, roughness: 0.22 });
    const trunkMat = makeMat(gfx, { color: 0x7c5333, roughness: 0.88 });
    const palmMat = makeMat(gfx, { color: 0x2d9c45, roughness: 0.65, side: THREE.DoubleSide });
    const oasisMat = makeMat(gfx, {
      color: 0x10d4a8,
      emissive: 0x056e58,
      emissiveIntensity: 0.45,
      roughness: 0.15,
      metalness: 0.25,
    });

    // Emerald Oasis Pond inside the East lagoon curve (x=112, z=102)
    const oasisGroup = new THREE.Group();
    oasisGroup.position.set(112, -1.2, 102);
    const pond = new THREE.Mesh(new THREE.CylinderGeometry(42, 44, 1.2, 24), oasisMat);
    pond.receiveShadow = true;
    const shore = new THREE.Mesh(new THREE.TorusGeometry(43, 3.2, 8, 28), desertMat);
    shore.rotation.x = Math.PI / 2;
    shore.position.y = 0.2;
    oasisGroup.add(pond, shore);
    lod0.add(oasisGroup);

    // 3 Towering Sandstone Pyramids with Golden Capstones (lod0)
    const pyramidSpecs = [
      { x: 65, z: -85, r: 54, h: 66 },
      { x: -310, z: -265, r: 72, h: 86 },
      { x: 325, z: 240, r: 64, h: 76 },
    ];
    for (const ps of pyramidSpecs) {
      if (!isClearOfTrack(ps.x, ps.z, trackInstance, ps.r * 0.72 + 18)) continue;
      const pyr = new THREE.Group();
      pyr.position.set(ps.x, -7, ps.z);
      const body = new THREE.Mesh(new THREE.ConeGeometry(ps.r, ps.h, 4), sandstoneMat);
      body.rotation.y = Math.PI / 4;
      body.position.y = ps.h * 0.5;
      body.castShadow = true;
      body.receiveShadow = true;
      const cap = new THREE.Mesh(new THREE.ConeGeometry(ps.r * 0.22, ps.h * 0.22, 4), goldMat);
      cap.rotation.y = Math.PI / 4;
      cap.position.y = ps.h * 0.89 + 0.5;
      pyr.add(body, cap);
      lod0.add(pyr);
    }

    // Sun-Baked Red-Ochre Desert Mesas (lod0)
    for (let i = 0; i < 16; i++) {
      const ang = (i / 16) * Math.PI * 2;
      const rad = 290 + (i % 3) * 65;
      const mx = Math.cos(ang) * rad;
      const mz = Math.sin(ang) * rad - 30;
      if (!isClearOfTrack(mx, mz, trackInstance, 48)) continue;
      const mh = 34 + rand() * 36;
      const topR = 18 + rand() * 18;
      const mesa = new THREE.Mesh(new THREE.CylinderGeometry(topR, topR * 1.45, mh, 7), mesaMat);
      mesa.position.set(mx, -7 + mh * 0.5, mz);
      mesa.castShadow = true;
      lod0.add(mesa);
    }

    // Monumental Stone Aqueduct Support Colonnade beneath the cobble aqueduct (lod1)
    for (const at of [0.46, 0.49, 0.52, 0.55]) {
      const af = trackInstance.sampleFrame(at);
      const pier = new THREE.Group();
      orientToFrame(pier, af);
      for (const s of [-1, 1]) {
        const leg = new THREE.Mesh(new THREE.BoxGeometry(2.8, 25, 4.0), sandstoneMat);
        leg.position.set(s * (af.halfWidth - 2.2), -13.5, 0);
        leg.castShadow = true;
        pier.add(leg);
      }
      const archBeam = new THREE.Mesh(new THREE.BoxGeometry(af.width - 2, 2.6, 3.8), sandstoneMat);
      archBeam.position.set(0, -4.5, 0);
      pier.add(archBeam);
      lod1.add(pier);
    }

    // Ruined Stone Arch straddling the Ruined Arch Sand Cut shortcut (lod1)
    const scArch = trackInstance.shortcuts?.[1];
    if (scArch && scArch.frames && scArch.frames.length > 6) {
      const midF = scArch.frames[Math.floor(scArch.frames.length * 0.48)];
      const arch = new THREE.Group();
      orientToFrame(arch, midF);
      const span = midF.halfWidth + 2.5;
      for (const s of [-1, 1]) {
        const col = new THREE.Mesh(new THREE.BoxGeometry(2.6, 13, 3.2), sandstoneMat);
        col.position.set(s * span, 6.5, 0);
        col.castShadow = true;
        arch.add(col);
      }
      const lintel = new THREE.Mesh(new THREE.BoxGeometry(span * 2 + 4, 2.8, 3.4), sandstoneMat);
      lintel.position.set(0, 13.5, 0);
      lintel.rotation.z = 0.05;
      arch.add(lintel);
      lod1.add(arch);
    }

    // Carved Sandstone Obelisks flanking the plaza & ruins (lod1)
    for (const ot of [0.02, 0.39, 0.63, 0.94]) {
      const of = trackInstance.sampleFrame(ot);
      for (const s of [-1, 1]) {
        const op = of.point.clone().addScaledVector(of.binormal, s * (of.halfWidth + of.offroadR + 6));
        if (!isClearOfTrack(op.x, op.z, trackInstance, 22)) continue;
        const ob = new THREE.Group();
        ob.position.set(op.x, op.y - 1, op.z);
        const shaft = new THREE.Mesh(new THREE.CylinderGeometry(1.1, 2.0, 18, 4), sandstoneMat);
        shaft.rotation.y = Math.PI / 4;
        shaft.position.y = 9;
        shaft.castShadow = true;
        const tip = new THREE.Mesh(new THREE.ConeGeometry(1.15, 3.0, 4), goldMat);
        tip.rotation.y = Math.PI / 4;
        tip.position.y = 19.5;
        ob.add(shaft, tip);
        lod1.add(ob);
      }
    }

    // Oasis Palm Trees around emerald pond & plaza edges (lod2)
    const placePalm = (x: number, y: number, z: number, scale = 1) => {
      const palm = new THREE.Group();
      palm.position.set(x, y, z);
      palm.scale.setScalar(scale);
      const seg1 = new THREE.Mesh(new THREE.CylinderGeometry(0.45, 0.72, 6, 7), trunkMat);
      seg1.position.y = 3;
      seg1.rotation.z = 0.08;
      const seg2 = new THREE.Mesh(new THREE.CylinderGeometry(0.32, 0.46, 5.5, 7), trunkMat);
      seg2.position.set(-0.4, 8.2, 0);
      seg2.rotation.z = 0.18;
      palm.add(seg1, seg2);

      for (let f = 0; f < 6; f++) {
        const frond = new THREE.Mesh(new THREE.ConeGeometry(1.2, 5.2, 4), palmMat);
        const ang = (f / 6) * Math.PI * 2;
        frond.position.set(-0.9 + Math.cos(ang) * 2.1, 10.6, Math.sin(ang) * 2.1);
        frond.rotation.order = 'YXZ';
        frond.rotation.y = -ang;
        frond.rotation.z = -Math.PI * 0.36;
        palm.add(frond);
      }
      lod2.add(palm);
    };

    for (let i = 0; i < 14; i++) {
      const ang = (i / 14) * Math.PI * 2;
      const rad = 45 + (i % 2) * 5;
      const px = 112 + Math.cos(ang) * rad;
      const pz = 102 + Math.sin(ang) * rad;
      if (!isClearOfTrack(px, pz, trackInstance, 21)) continue;
      placePalm(px, -1.0, pz, 0.9 + rand() * 0.4);
    }
    for (let i = 0; i < 12; i++) {
      const t = (i + 0.4) / 12;
      const f = trackInstance.sampleFrame(t);
      const pp = f.point.clone().addScaledVector(f.binormal, (i % 2 === 0 ? 1 : -1) * (f.halfWidth + f.offroadR + 7));
      if (!isClearOfTrack(pp.x, pp.z, trackInstance, 23)) continue;
      placePalm(pp.x, pp.y - 0.5, pp.z, 0.95 + rand() * 0.35);
    }

    // Animated Oasis Water Ripple Ring & Circling Desert Hawks (lod3)
    const rippleMat = makeMat(gfx, { color: 0xaaf7e2, emissive: 0x33bb99, emissiveIntensity: 0.65, transparent: true, opacity: 0.7 });
    const ripple = new THREE.Mesh(new THREE.TorusGeometry(24, 0.6, 6, 28), rippleMat);
    ripple.rotation.x = Math.PI / 2;
    ripple.position.set(112, -0.5, 102);
    lod3.add(ripple);

    const hawkMat = makeMat(gfx, { color: 0x4a2e1b, roughness: 0.7 });
    const hawks: Array<{ mesh: THREE.Mesh; cx: number; cz: number; rad: number; y: number; speed: number; phase: number }> = [];
    for (let i = 0; i < 5; i++) {
      const hawk = new THREE.Mesh(new THREE.ConeGeometry(1.6, 4.2, 3), hawkMat);
      hawk.rotation.x = Math.PI / 2;
      lod3.add(hawk);
      hawks.push({
        mesh: hawk,
        cx: i < 3 ? 65 : 112,
        cz: i < 3 ? -85 : 102,
        rad: 42 + i * 10,
        y: 46 + i * 7,
        speed: 0.32 + i * 0.05,
        phase: i * 1.4,
      });
    }

    return (_dt: number, time: number) => {
      const s = 0.85 + ((time * 0.4) % 1) * 0.6;
      ripple.scale.set(s, s, 1);
      for (const h of hawks) {
        const a = time * h.speed + h.phase;
        h.mesh.position.set(
          h.cx + Math.cos(a) * h.rad,
          h.y + Math.sin(time * 2 + h.phase) * 1.8,
          h.cz + Math.sin(a) * h.rad
        );
        h.mesh.rotation.z = a;
      }
    };
  },
};

/* ============================================================================
 * 8. STARLIGHT RAINBOW ROAD (Orbital Space Station + Open No-Rail Sections)
 * ========================================================================== */
const starlightRainbow: TrackDefinition = {
  id: 'starlight_rainbow',
  cupId: CUP_IDS.STAR,
  name: 'Starlight Rainbow Road',
  subtitle: 'Orbital Space Station & Cosmic Ribbon',
  themeColor: '#c77dff',
  roadTexture: 'rainbow_road',
  curbTexture: 'curb_neon',
  offroadTexture: 'rainbow_road',
  offroadSurface: SURFACE_TYPES.VOID,
  railColor: 0x7df9ff,
  deckColor: 0x160a38,
  skyColors: {
    top: 0x010008,
    horizon: 0x0b0426,
    bottom: 0x020012,
    sunColor: 0xd8b4ff,
    sunPos: [180, 150, -160],
    fogColor: 0x050214,
    fogNear: 780,
    fogFar: 2200,
  },
  ambientIntensity: 0.68,
  dirLightColor: 0xdce8ff,
  dirLightIntensity: 1.05,
  bgmStyle: {
    tempo: 142,
    scale: [64, 66, 68, 71, 73, 76, 78, 83],
    bassPattern: [0, 0, 4, 5, 3, 4, 2, 0],
  },
  laps: BASE_RACE_CONFIG.LAPS,
  controlPoints: [
    // Orbital Station Docking Bay Start/Finish (guarded rails inside station)
    { x: 0, y: 0, z: -40, width: 26, bank: 0, surface: SURFACE_TYPES.RAINBOW, offroadL: 0, offroadR: 0, wallL: true, wallR: true },
    { x: 0, y: 0, z: 50, width: 26, bank: 0, surface: SURFACE_TYPES.RAINBOW, offroadL: 0, offroadR: 0, wallL: true, wallR: true },
    // Open no-rail deep-space Rainbow Road climb & 25u Overpass!
    { x: 20, y: 3, z: 140, width: 24, bank: 0.14, surface: SURFACE_TYPES.RAINBOW, offroadL: 0, offroadR: 0, wallL: false, wallR: false },
    { x: 95, y: 9, z: 205, width: 23, bank: 0.24, surface: SURFACE_TYPES.RAINBOW, offroadL: 0, offroadR: 0, wallL: false, wallR: false },
    { x: 185, y: 17, z: 200, width: 22, bank: 0.24, surface: SURFACE_TYPES.RAINBOW, offroadL: 0, offroadR: 0, wallL: false, wallR: false },
    { x: 235, y: 23, z: 120, width: 22, bank: 0.18, surface: SURFACE_TYPES.RAINBOW, offroadL: 0, offroadR: 0, wallL: false, wallR: false },
    { x: 195, y: 27, z: 45, width: 22, bank: 0.08, surface: SURFACE_TYPES.RAINBOW, offroadL: 0, offroadR: 0, wallL: false, wallR: false },
    { x: 105, y: 27, z: 35, width: 21, bank: 0, surface: SURFACE_TYPES.RAINBOW, offroadL: 0, offroadR: 0, wallL: false, wallR: false },
    { x: 10, y: 25, z: 48, width: 21, bank: 0, surface: SURFACE_TYPES.RAINBOW, offroadL: 0, offroadR: 0, wallL: false, wallR: false },
    { x: -85, y: 22, z: 55, width: 22, bank: -0.10, surface: SURFACE_TYPES.RAINBOW, offroadL: 0, offroadR: 0, wallL: false, wallR: false },
    { x: -175, y: 17, z: 20, width: 22, bank: -0.22, surface: SURFACE_TYPES.RAINBOW, offroadL: 0, offroadR: 0, wallL: false, wallR: false },
    { x: -225, y: 10, z: -55, width: 22, bank: -0.20, surface: SURFACE_TYPES.RAINBOW, offroadL: 0, offroadR: 0, wallL: false, wallR: false },
    { x: -195, y: 3, z: -145, width: 23, bank: -0.10, surface: SURFACE_TYPES.RAINBOW, offroadL: 0, offroadR: 0, wallL: false, wallR: false },
    { x: -175, y: -3, z: -230, width: 23, bank: 0.12, surface: SURFACE_TYPES.RAINBOW, offroadL: 0, offroadR: 0, wallL: false, wallR: false },
    { x: -95, y: -6, z: -275, width: 23, bank: 0.16, surface: SURFACE_TYPES.RAINBOW, offroadL: 0, offroadR: 0, wallL: false, wallR: false },
    { x: -15, y: -6, z: -235, width: 22, bank: -0.14, surface: SURFACE_TYPES.RAINBOW, offroadL: 0, offroadR: 0, wallL: false, wallR: false },
    { x: 65, y: -4, z: -290, width: 23, bank: 0.16, surface: SURFACE_TYPES.RAINBOW, offroadL: 0, offroadR: 0, wallL: false, wallR: false },
    { x: 145, y: -2, z: -255, width: 23, bank: 0.18, surface: SURFACE_TYPES.RAINBOW, offroadL: 0, offroadR: 0, wallL: false, wallR: false },
    { x: 140, y: 0, z: -180, width: 24, bank: 0.14, surface: SURFACE_TYPES.RAINBOW, offroadL: 0, offroadR: 0, wallL: false, wallR: false },
    { x: 70, y: 0, z: -170, width: 25, bank: 0.06, surface: SURFACE_TYPES.RAINBOW, offroadL: 0, offroadR: 0, wallL: false, wallR: false },
    { x: 12, y: 0, z: -155, width: 26, bank: 0.02, surface: SURFACE_TYPES.RAINBOW, offroadL: 0, offroadR: 0, wallL: true, wallR: false },
    { x: 0, y: 0, z: -100, width: 26, bank: 0, surface: SURFACE_TYPES.RAINBOW, offroadL: 0, offroadR: 0, wallL: true, wallR: true },
  ],
  shortcuts: [
    {
      name: 'Twin Rainbow Fast Ribbon',
      type: 'split',
      entryT: 0.44,
      exitT: 0.63,
      boostAtEntry: true,
      isGlider: false,
      requiresBoost: false,
      roadTexture: 'rainbow_road',
      points: [
        { x: -85.7, y: 22.25, z: 54.9, width: 13, surface: SURFACE_TYPES.RAINBOW, roadTexture: 'rainbow_road' },
        { x: -145, y: 17.5, z: -20, width: 12, surface: SURFACE_TYPES.RAINBOW, roadTexture: 'rainbow_road' },
        { x: -155, y: 6.8, z: -115, width: 12, surface: SURFACE_TYPES.RAINBOW, roadTexture: 'rainbow_road' },
        { x: -179.3, y: -2.35, z: -223.0, width: 13, surface: SURFACE_TYPES.RAINBOW, roadTexture: 'rainbow_road' },
      ],
    },
    {
      name: 'Nebula Glider Gap-Jump',
      type: 'ramp',
      entryT: 0.72,
      exitT: 0.94,
      boostAtEntry: true,
      isGlider: true,
      requiresBoost: false,
      rampU: 0.25,
      rampHeight: 3.6,
      roadTexture: 'rainbow_road',
      points: [
        { x: -34.5, y: -6.0, z: -240.5, width: 14, surface: SURFACE_TYPES.RAINBOW, roadTexture: 'rainbow_road' },
        { x: -12, y: -2.2, z: -215, width: 14, surface: SURFACE_TYPES.RAINBOW, roadTexture: 'rainbow_road' },
        { x: 8, y: 0.4, z: -190, width: 14, surface: SURFACE_TYPES.VOID },
        { x: 10.9, y: 0.2, z: -153.5, width: 14, surface: SURFACE_TYPES.RAINBOW, roadTexture: 'rainbow_road' },
      ],
    },
  ],
  boostPads: [
    { t: 0.06, lateral: -4.5, width: 4.8, length: 8.5 },
    { t: 0.21, lateral: 4.0, width: 4.8, length: 8.5 },
    { t: 0.38, lateral: 0, width: 5.2, length: 9.0 },
    { t: 0.52, lateral: -4.0, width: 4.8, length: 8.5 },
    { t: 0.66, lateral: 4.0, width: 4.8, length: 8.5 },
    { t: 0.80, lateral: -3.5, width: 4.8, length: 8.5 },
    { t: 0.95, lateral: 0, width: 5.2, length: 9.0 },
  ],
  ramps: [
    { t: 0.14, lateral: 0, width: 8.2, length: 11.5, height: 3.4, isGlider: true },
    { t: 0.34, lateral: 0, width: 7.8, length: 11.0, height: 3.0, isGlider: false },
    { t: 0.58, lateral: 0, width: 8.2, length: 11.5, height: 3.5, isGlider: true },
  ],
  itemBoxRows: [
    { t: 0.10, count: 5, spread: 16 },
    { t: 0.41, count: 4, spread: 13 },
    { t: 0.69, count: 5, spread: 15 },
    { t: 0.88, count: 5, spread: 16 },
  ],
  coinLines: [
    { tStart: 0.17, tEnd: 0.22, lateral: -4.0, count: 5 },
    { tStart: 0.35, tEnd: 0.39, lateral: 3.5, count: 5 },
    { tStart: 0.49, tEnd: 0.54, lateral: 4.0, count: 5 },
    { tStart: 0.74, tEnd: 0.78, lateral: -4.0, count: 5 },
    { tStart: 0.91, tEnd: 0.94, lateral: 4.0, count: 5 },
  ],
  hazards: [
    { type: 'star_mine', t: 0.26, lateral: 0, radius: 2.1, moveAmp: 5.5, moveSpeed: 1.6 },
    { type: 'asteroid', t: 0.47, lateral: 2.0, radius: 2.2, moveAmp: 5.0, moveSpeed: 1.5 },
    { type: 'star_mine', t: 0.64, lateral: -2.0, radius: 2.1, moveAmp: 5.5, moveSpeed: 1.8 },
    { type: 'cyber_drone', t: 0.85, lateral: 0, radius: 2.1, moveAmp: 6.0, moveSpeed: 1.7 },
  ],
  buildScenery(sceneGroups, trackInstance, _texLib, gfx) {
    const [lod0, lod1, lod2, lod3] = sceneGroups;
    const rand = seededRand(808);

    // 3D Starfield Shell via InstancedMesh (renders even on Potato drawDistance=420!)
    const starGeo = new THREE.OctahedronGeometry(1.1, 0);
    const starWhiteMat = makeMat(gfx, { color: 0xffffff, emissive: 0xffffff, emissiveIntensity: 1.2, isUnlit: true });
    const starCount = 260;
    const starInst = new THREE.InstancedMesh(starGeo, starWhiteMat, starCount);
    const m4 = new THREE.Matrix4();
    const posV = new THREE.Vector3();
    const quat = new THREE.Quaternion();
    const scaleV = new THREE.Vector3();
    for (let i = 0; i < starCount; i++) {
      const u = rand() * 2 - 1;
      const theta = rand() * Math.PI * 2;
      const r = 310 + rand() * 95;
      const f = Math.sqrt(1 - u * u);
      posV.set(r * f * Math.cos(theta), r * u * 0.85 + 25, r * f * Math.sin(theta) - 35);
      scaleV.setScalar(0.55 + rand() * 1.45);
      m4.compose(posV, quat, scaleV);
      starInst.setMatrixAt(i, m4);
    }
    starInst.instanceMatrix.needsUpdate = true;
    lod0.add(starInst);

    // Giant Ringed Planet visible on ALL graphics presets (distance ~385 from origin)
    const planetGroup = new THREE.Group();
    planetGroup.position.set(-285, 118, -225);
    const planetMat = makeMat(gfx, { color: 0x7a42f5, emissive: 0x2d0e73, emissiveIntensity: 0.55, roughness: 0.45 });
    const planetBandMat = makeMat(gfx, { color: 0x45d9ff, emissive: 0x1680b8, emissiveIntensity: 0.5, roughness: 0.35 });
    const planet = new THREE.Mesh(new THREE.SphereGeometry(68, 28, 20), planetMat);
    const eqBand = new THREE.Mesh(new THREE.CylinderGeometry(69, 69, 14, 28, 1, true), planetBandMat);
    const ringMatA = makeMat(gfx, {
      color: 0xff80e5,
      emissive: 0xaa30a8,
      emissiveIntensity: 0.6,
      transparent: true,
      opacity: 0.72,
      side: THREE.DoubleSide,
    });
    const ringMatB = makeMat(gfx, {
      color: 0x62f2ff,
      emissive: 0x1f8fb8,
      emissiveIntensity: 0.55,
      transparent: true,
      opacity: 0.62,
      side: THREE.DoubleSide,
    });
    const ringA = new THREE.Mesh(new THREE.RingGeometry(86, 118, 48), ringMatA);
    ringA.rotation.set(Math.PI * 0.42, 0.25, 0.3);
    const ringB = new THREE.Mesh(new THREE.RingGeometry(124, 146, 48), ringMatB);
    ringB.rotation.copy(ringA.rotation);
    planetGroup.add(planet, eqBand, ringA, ringB);
    lod0.add(planetGroup);

    // Orbital Space Station Docking Hub encircling the Start/Finish straight (lod0 + lod1)
    const stationMat = makeMat(gfx, { color: 0x2d375a, roughness: 0.3, metalness: 0.78 });
    const stationCyanMat = makeMat(gfx, { color: 0x45f3ff, emissive: 0x00c8ff, emissiveIntensity: 1.0, roughness: 0.2 });
    const stationMagMat = makeMat(gfx, { color: 0xff5ce0, emissive: 0xd91eb8, emissiveIntensity: 0.95, roughness: 0.2 });
    const stationGoldMat = makeMat(gfx, { color: 0xffd166, emissive: 0x996600, emissiveIntensity: 0.45, metalness: 0.85, roughness: 0.25 });

    const startF = trackInstance.sampleFrame(0);
    const hub = new THREE.Group();
    orientToFrame(hub, startF);
    const hubRing = new THREE.Mesh(new THREE.TorusGeometry(32, 2.2, 12, 32), stationMat);
    const hubGlow = new THREE.Mesh(new THREE.TorusGeometry(29.8, 0.55, 8, 32), stationCyanMat);
    hub.add(hubRing, hubGlow);
    lod0.add(hub);

    // Rotating Concentric Orbital Station Rings & Solar Wings (lod1)
    const orbitalCore = new THREE.Group();
    orbitalCore.position.set(18, 52, -35);
    const orbRingOuter = new THREE.Mesh(new THREE.TorusGeometry(135, 2.8, 10, 48), stationMat);
    orbRingOuter.rotation.x = Math.PI * 0.45;
    const orbTrimOuter = new THREE.Mesh(new THREE.TorusGeometry(132, 0.7, 8, 48), stationMagMat);
    orbTrimOuter.rotation.copy(orbRingOuter.rotation);
    orbitalCore.add(orbRingOuter, orbTrimOuter);

    const orbRingInner = new THREE.Mesh(new THREE.TorusGeometry(85, 2.2, 10, 40), stationMat);
    orbRingInner.rotation.set(Math.PI * 0.52, 0.35, 0);
    const orbSolar = new THREE.Mesh(new THREE.BoxGeometry(110, 0.8, 12), stationGoldMat);
    orbRingInner.add(orbSolar);
    lod1.add(orbitalCore, orbRingInner);

    // Luminous Sweeping Cosmic Aurora Ribbons (lod1)
    const auroraMatA = makeMat(gfx, {
      color: 0x3ef7c5,
      emissive: 0x10c898,
      emissiveIntensity: 0.85,
      transparent: true,
      opacity: 0.48,
      side: THREE.DoubleSide,
      depthWrite: false,
    });
    const auroraMatB = makeMat(gfx, {
      color: 0xc77dff,
      emissive: 0x8a2be2,
      emissiveIntensity: 0.85,
      transparent: true,
      opacity: 0.44,
      side: THREE.DoubleSide,
      depthWrite: false,
    });
    const auroraA = new THREE.Mesh(new THREE.TorusGeometry(210, 12, 6, 42, Math.PI * 1.15), auroraMatA);
    auroraA.position.set(-20, 95, -60);
    auroraA.rotation.set(0.35, 0.6, 0.25);
    const auroraB = new THREE.Mesh(new THREE.TorusGeometry(235, 10, 6, 42, Math.PI * 1.1), auroraMatB);
    auroraB.position.set(45, 110, -25);
    auroraB.rotation.set(-0.28, -0.5, 0.4);
    lod1.add(auroraA, auroraB);

    // Floating Sculpted Asteroids around the cosmic circuit (lod1 & lod3)
    const rockMat = makeMat(gfx, { color: 0x4b4266, roughness: 0.82, flatShading: true });
    const crystalMat = makeMat(gfx, { color: 0xb565ff, emissive: 0x7b2cbf, emissiveIntensity: 0.9, roughness: 0.2 });
    const asteroids: Array<{ mesh: THREE.Group; rx: number; ry: number; baseY: number; phase: number }> = [];
    for (let i = 0; i < 24; i++) {
      const ang = (i / 24) * Math.PI * 2;
      const rad = 120 + rand() * 195;
      const ax = Math.cos(ang) * rad;
      const az = Math.sin(ang) * rad - 45;
      if (!isClearOfTrack(ax, az, trackInstance, 36)) continue;
      const ay = (rand() - 0.5) * 70 + 10;
      const ast = new THREE.Group();
      ast.position.set(ax, ay, az);
      const r = 4.5 + rand() * 8.5;
      const body = new THREE.Mesh(new THREE.DodecahedronGeometry(r, 0), rockMat);
      ast.add(body);
      if (i % 2 === 0) {
        const shard = new THREE.Mesh(new THREE.ConeGeometry(r * 0.35, r * 1.2, 5), crystalMat);
        shard.position.set(r * 0.5, r * 0.5, 0);
        shard.rotation.z = -0.6;
        ast.add(shard);
      }
      (i < 12 ? lod1 : lod3).add(ast);
      asteroids.push({ mesh: ast, rx: (rand() - 0.5) * 0.45, ry: (rand() - 0.5) * 0.65, baseY: ay, phase: rand() * Math.PI * 2 });
    }

    // Neon Star-Gate Ring Portals straddling jumps & key straights (lod2)
    const starGates: Array<{ ring: THREE.Mesh; phase: number }> = [];
    for (const [idx, gt] of [0.14, 0.34, 0.58, 0.83].entries()) {
      const gf = trackInstance.sampleFrame(gt);
      const gateGrp = new THREE.Group();
      orientToFrame(gateGrp, gf);
      const ring = new THREE.Mesh(
        new THREE.TorusGeometry(gf.halfWidth + 4.5, 0.72, 10, 28),
        idx % 2 === 0 ? stationCyanMat : stationMagMat
      );
      ring.position.set(0, 4.5, 0);
      gateGrp.add(ring);
      lod2.add(gateGrp);
      starGates.push({ ring, phase: idx * 1.1 });
    }

    // Orbiting Space Satellites (lod3)
    const satellites: Array<{ mesh: THREE.Group; rad: number; y: number; speed: number; phase: number }> = [];
    for (let i = 0; i < 6; i++) {
      const sat = new THREE.Group();
      const core = new THREE.Mesh(new THREE.OctahedronGeometry(2.2, 0), stationGoldMat);
      const wing = new THREE.Mesh(new THREE.BoxGeometry(10, 0.25, 2.4), stationCyanMat);
      sat.add(core, wing);
      lod3.add(sat);
      satellites.push({ mesh: sat, rad: 155 + i * 28, y: 28 + (i % 3) * 18, speed: 0.22 + i * 0.04, phase: i * 1.2 });
    }

    return (dt: number, time: number) => {
      orbitalCore.rotation.y = time * 0.09;
      orbRingInner.rotation.y = -time * 0.14;
      planetGroup.rotation.y = time * 0.025;
      auroraA.rotation.z = 0.25 + Math.sin(time * 0.35) * 0.06;
      auroraB.rotation.z = 0.4 + Math.cos(time * 0.3) * 0.06;

      for (const ast of asteroids) {
        ast.mesh.rotation.x += dt * ast.rx;
        ast.mesh.rotation.y += dt * ast.ry;
        ast.mesh.position.y = ast.baseY + Math.sin(time * 0.8 + ast.phase) * 2.2;
      }
      for (const sg of starGates) {
        sg.ring.rotation.z = time * 0.8 + sg.phase;
      }
      for (const sat of satellites) {
        const a = time * sat.speed + sat.phase;
        sat.mesh.position.set(
          Math.cos(a) * sat.rad,
          sat.y + Math.sin(time * 1.4 + sat.phase) * 3,
          Math.sin(a) * sat.rad - 30
        );
        sat.mesh.rotation.y = -a;
      }
    };
  },
};

export const CUP2_TRACKS: TrackDefinition[] = [
  neonMetropolis,
  sakuraCanyon,
  sandstoneOasis,
  starlightRainbow,
];
