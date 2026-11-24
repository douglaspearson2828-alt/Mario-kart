import * as THREE from 'three';
import {
  SURFACE_TYPES,
  type RuntimeShortcut,
  type ShortcutFrame,
  type StartGridSlot,
  type SurfaceType,
  type TrackBoostPad,
  type TrackCoin,
  type TrackControlPoint,
  type TrackDefinition,
  type TrackFrame,
  type TrackHazard,
  type TrackInstance,
  type TrackItemBox,
  type TrackQueryResult,
  type TrackRamp,
} from '../core/contracts';

const WORLD_UP = new THREE.Vector3(0, 1, 0);
const FRAME_COUNT = 360;
const LOCAL_SEARCH_WINDOW = 28;
const FALLBACK_DIST_SQ = 45 * 45;

// Shared reusable scratch vectors for hot queryTrack path (avoid GC churn at 60fps * 8 karts)
const _diff = new THREE.Vector3();
const _pA = new THREE.Vector3();
const _pB = new THREE.Vector3();
const _seg = new THREE.Vector3();
const _projPoint = new THREE.Vector3();
const _projTangent = new THREE.Vector3();
const _projNormal = new THREE.Vector3();
const _projBinormal = new THREE.Vector3();
const _scPoint = new THREE.Vector3();
const _scTangent = new THREE.Vector3();
const _scNormal = new THREE.Vector3();
const _scBinormal = new THREE.Vector3();

/**
 * Resolve a procedural texture from TextureLibrary regardless of lookup convention.
 */
function getTexture(texLib: any, name: string): THREE.Texture | null {
  if (!texLib || !name) return null;
  if (typeof texLib.get === 'function') return texLib.get(name) || null;
  if (texLib.textures && texLib.textures[name]) return texLib.textures[name];
  if (texLib[name]) return texLib[name];
  return null;
}

/**
 * Create a graphics-tier-aware material via GraphicsEngine, with safe Three.js fallback.
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
      vertexColors: Boolean(def.vertexColors),
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
    vertexColors: Boolean(def.vertexColors),
    flatShading: Boolean(def.flatShading),
  });
}

function wrap01(t: number): number {
  const m = t % 1;
  return m < 0 ? m + 1 : m;
}

function smoothstep01(w: number): number {
  return w * w * (3 - 2 * w);
}

/**
 * Map a surface or custom style token to a TextureLibrary road texture key.
 */
function resolveRoadTextureKey(surface: string, overrideTex?: string): string {
  if (overrideTex) return overrideTex;
  switch (surface) {
    case SURFACE_TYPES.COBBLE:
      return 'cobble';
    case SURFACE_TYPES.ICE:
      return 'ice';
    case SURFACE_TYPES.WOOD:
      return 'wood_pier';
    case SURFACE_TYPES.RAINBOW:
      return 'rainbow_road';
    case SURFACE_TYPES.OFFROAD_SAND:
    case 'sand':
      return 'sand_road';
    case 'neon':
    case 'neon_road':
      return 'neon_road';
    case 'lava':
    case 'lava_rock':
      return 'lava_rock';
    case SURFACE_TYPES.OFFROAD_GRASS:
      return 'grass';
    case SURFACE_TYPES.OFFROAD_SNOW:
      return 'snow';
    default:
      return 'asphalt';
  }
}

/**
 * Normalize control point surface string into a valid SURFACE_TYPES constant for physics.
 */
function normalizePhysicsSurface(surface?: string): SurfaceType | string {
  if (!surface) return SURFACE_TYPES.ROAD;
  if (surface === 'neon' || surface === 'neon_road' || surface === 'lava' || surface === 'lava_rock') {
    return SURFACE_TYPES.ROAD;
  }
  if (surface === 'sand') return SURFACE_TYPES.OFFROAD_SAND;
  return surface;
}

function inferDefaultOffroadSurface(trackDef: TrackDefinition): SurfaceType | string {
  if (trackDef.offroadSurface) return trackDef.offroadSurface;
  const id = (trackDef.id || '').toLowerCase();
  if (id.includes('frost') || id.includes('glacier') || id.includes('snow')) return SURFACE_TYPES.OFFROAD_SNOW;
  if (id.includes('harbor') || id.includes('oasis') || id.includes('sand') || id.includes('desert')) {
    return SURFACE_TYPES.OFFROAD_SAND;
  }
  if (id.includes('rainbow')) return SURFACE_TYPES.VOID;
  return SURFACE_TYPES.OFFROAD_GRASS;
}

function inferDefaultOffroadTexture(trackDef: TrackDefinition, offroadSurface: SurfaceType | string): string {
  if (trackDef.offroadTexture) return trackDef.offroadTexture;
  if (offroadSurface === SURFACE_TYPES.OFFROAD_SNOW) return 'snow';
  if (offroadSurface === SURFACE_TYPES.OFFROAD_SAND) return 'sand';
  if (trackDef.id?.includes('ember')) return 'lava_rock';
  if (trackDef.id?.includes('neon')) return 'neon_road';
  return 'grass';
}

function inferDefaultCurbTexture(trackDef: TrackDefinition, primaryRoadTex: string): string {
  if (trackDef.curbTexture) return trackDef.curbTexture;
  if (primaryRoadTex === 'neon_road' || primaryRoadTex === 'rainbow_road') return 'curb_neon';
  return 'curb_red_white';
}

/**
 * Interpolate scalar property smoothly along closed control points using curve parameter tCurve in [0, 1).
 */
function sampleClosedScalar(
  controlPoints: TrackControlPoint[],
  tCurve: number,
  key: 'width' | 'offroadL' | 'offroadR',
  defaultVal: number
): number {
  const m = controlPoints.length;
  const p = wrap01(tCurve) * m;
  const i1 = Math.floor(p) % m;
  const i2 = (i1 + 1) % m;
  const w = smoothstep01(p - Math.floor(p));
  const v1 = controlPoints[i1][key] ?? defaultVal;
  const v2 = controlPoints[i2][key] ?? defaultVal;
  return v1 + (v2 - v1) * w;
}

/**
 * Catmull-Rom scalar interpolation (for smooth banking transitions).
 */
function sampleClosedBank(controlPoints: TrackControlPoint[], tCurve: number): number {
  const m = controlPoints.length;
  const p = wrap01(tCurve) * m;
  const i1 = Math.floor(p) % m;
  const i0 = (i1 - 1 + m) % m;
  const i2 = (i1 + 1) % m;
  const i3 = (i1 + 2) % m;
  const t = p - Math.floor(p);
  const t2 = t * t;
  const t3 = t2 * t;
  const p0 = controlPoints[i0].bank ?? 0;
  const p1 = controlPoints[i1].bank ?? 0;
  const p2 = controlPoints[i2].bank ?? 0;
  const p3 = controlPoints[i3].bank ?? 0;
  return (
    0.5 *
    (2 * p1 +
      (-p0 + p2) * t +
      (2 * p0 - 5 * p1 + 4 * p2 - p3) * t2 +
      (-p0 + 3 * p1 - 3 * p2 + p3) * t3)
  );
}

function sampleNearestCP(controlPoints: TrackControlPoint[], tCurve: number): TrackControlPoint {
  const m = controlPoints.length;
  const p = wrap01(tCurve) * m;
  const idx = Math.round(p) % m;
  return controlPoints[idx];
}

/**
 * Build a BufferGeometry from accumulated typed arrays.
 */
function createBufferGeometry(
  positions: number[],
  normals: number[],
  uvs: number[],
  indices: number[],
  colors: number[] | null = null
): THREE.BufferGeometry {
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geo.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  if (colors) {
    geo.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  }
  geo.setIndex(indices);
  geo.computeBoundingSphere();
  return geo;
}

function pushVertex(
  arrPos: number[],
  arrNorm: number[],
  arrUv: number[],
  pos: THREE.Vector3,
  norm: THREE.Vector3,
  u: number,
  v: number,
  arrCol: number[] | null = null,
  col: number[] | null = null
): void {
  arrPos.push(pos.x, pos.y, pos.z);
  arrNorm.push(norm.x, norm.y, norm.z);
  arrUv.push(u, v);
  if (arrCol && col) {
    arrCol.push(col[0], col[1], col[2]);
  }
}

function pushQuad(indices: number[], a: number, b: number, c: number, d: number): void {
  indices.push(a, b, c, a, c, d);
}

interface MeshBucket {
  pos: number[];
  norm: number[];
  uv: number[];
  idx: number[];
}

/**
 * Construct a closed or open ribbon mesh along an array of frames.
 */
function buildRoadBuckets(
  frames: TrackFrame[],
  totalLength: number,
  closed: boolean,
  _trackDef: TrackDefinition,
  texLib: any,
  gfx: any,
  targetGroup: THREE.Group
): void {
  const buckets = new Map<string, MeshBucket>();
  const n = frames.length;
  const segCount = closed ? n : n - 1;
  const vRepeats = Math.max(1, Math.round(totalLength / 18));

  const getBucket = (texKey: string): MeshBucket => {
    let bucket = buckets.get(texKey);
    if (!bucket) {
      bucket = { pos: [], norm: [], uv: [], idx: [] };
      buckets.set(texKey, bucket);
    }
    return bucket;
  };

  for (let i = 0; i < segCount; i++) {
    const f0 = frames[i];
    const f1 = frames[(i + 1) % n];
    if (f0.surface === SURFACE_TYPES.VOID && f1.surface === SURFACE_TYPES.VOID) continue;

    const texKey = f0.roadTexture || 'asphalt';
    const b = getBucket(texKey);
    const base = b.pos.length / 3;

    const s0 = f0.s;
    const s1 = i + 1 === n && closed ? totalLength : f1.s;
    const v0 = (s0 / totalLength) * vRepeats;
    const v1 = (s1 / totalLength) * vRepeats;

    const l0 = f0.point.clone().addScaledVector(f0.binormal, -f0.halfWidth);
    const r0 = f0.point.clone().addScaledVector(f0.binormal, f0.halfWidth);
    const l1 = f1.point.clone().addScaledVector(f1.binormal, -f1.halfWidth);
    const r1 = f1.point.clone().addScaledVector(f1.binormal, f1.halfWidth);

    pushVertex(b.pos, b.norm, b.uv, l0, f0.normal, 0, v0);
    pushVertex(b.pos, b.norm, b.uv, r0, f0.normal, 1, v0);
    pushVertex(b.pos, b.norm, b.uv, r1, f1.normal, 1, v1);
    pushVertex(b.pos, b.norm, b.uv, l1, f1.normal, 0, v1);
    // Counter-clockwise top winding: l0 -> r0 -> r1 -> l1 faces +normal
    pushQuad(b.idx, base + 0, base + 1, base + 2, base + 3);
  }

  for (const [texKey, data] of buckets.entries()) {
    if (data.idx.length === 0) continue;
    const geo = createBufferGeometry(data.pos, data.norm, data.uv, data.idx);
    const map = getTexture(texLib, texKey);
    const isNeonOrRainbow = texKey === 'neon_road' || texKey === 'rainbow_road';
    const isIce = texKey === 'ice';
    const mat = makeMat(gfx, {
      color: map ? 0xffffff : isNeonOrRainbow ? 0x334477 : isIce ? 0xbbe8ff : 0x3a3f4a,
      map,
      emissive: texKey === 'rainbow_road' ? 0x221144 : texKey === 'neon_road' ? 0x051833 : 0x000000,
      emissiveIntensity: isNeonOrRainbow ? 0.55 : 0,
      roughness: isIce ? 0.18 : isNeonOrRainbow ? 0.32 : 0.78,
      metalness: isIce ? 0.15 : isNeonOrRainbow ? 0.25 : 0.05,
    });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.receiveShadow = true;
    mesh.name = `road_${texKey}`;
    targetGroup.add(mesh);
  }
}

/**
 * Construct raised alternating red-white or neon curbs along both edges of the road,
 * skipping open shortcut mouths so karts never clip through raised curbs.
 */
function buildCurbs(
  frames: TrackFrame[],
  totalLength: number,
  curbTexKey: string,
  texLib: any,
  gfx: any,
  targetGroup: THREE.Group
): void {
  const n = frames.length;
  const pos: number[] = [];
  const norm: number[] = [];
  const uv: number[] = [];
  const idx: number[] = [];
  const vRepeats = Math.max(2, Math.round(totalLength / 6));
  const curbW = 1.25;
  const curbH = 0.14;

  const addSide = (sideSign: -1 | 1) => {
    const openKey = sideSign < 0 ? 'openMouthL' : 'openMouthR';
    for (let i = 0; i < n; i++) {
      const f0 = frames[i];
      const f1 = frames[(i + 1) % n];
      if (f0.surface === SURFACE_TYPES.VOID) continue;
      if (f0[openKey] || f1[openKey]) continue;

      const s0 = f0.s;
      const s1 = i + 1 === n ? totalLength : f1.s;
      const v0 = (s0 / totalLength) * vRepeats;
      const v1 = (s1 / totalLength) * vRepeats;

      const inOff0 = sideSign * f0.halfWidth;
      const outOff0 = sideSign * (f0.halfWidth + curbW);
      const inOff1 = sideSign * f1.halfWidth;
      const outOff1 = sideSign * (f1.halfWidth + curbW);

      const pIn0 = f0.point.clone().addScaledVector(f0.binormal, inOff0).addScaledVector(f0.normal, 0.02);
      const pMid0 = f0.point
        .clone()
        .addScaledVector(f0.binormal, inOff0 + sideSign * 0.22)
        .addScaledVector(f0.normal, curbH);
      const pOut0 = f0.point.clone().addScaledVector(f0.binormal, outOff0).addScaledVector(f0.normal, curbH * 0.85);

      const pIn1 = f1.point.clone().addScaledVector(f1.binormal, inOff1).addScaledVector(f1.normal, 0.02);
      const pMid1 = f1.point
        .clone()
        .addScaledVector(f1.binormal, inOff1 + sideSign * 0.22)
        .addScaledVector(f1.normal, curbH);
      const pOut1 = f1.point.clone().addScaledVector(f1.binormal, outOff1).addScaledVector(f1.normal, curbH * 0.85);

      const base = pos.length / 3;
      pushVertex(pos, norm, uv, pIn0, f0.normal, 0, v0);
      pushVertex(pos, norm, uv, pMid0, f0.normal, 0.3, v0);
      pushVertex(pos, norm, uv, pOut0, f0.normal, 1, v0);
      pushVertex(pos, norm, uv, pIn1, f1.normal, 0, v1);
      pushVertex(pos, norm, uv, pMid1, f1.normal, 0.3, v1);
      pushVertex(pos, norm, uv, pOut1, f1.normal, 1, v1);

      if (sideSign > 0) {
        pushQuad(idx, base + 0, base + 1, base + 4, base + 3);
        pushQuad(idx, base + 1, base + 2, base + 5, base + 4);
      } else {
        pushQuad(idx, base + 1, base + 0, base + 3, base + 4);
        pushQuad(idx, base + 2, base + 1, base + 4, base + 5);
      }
    }
  };

  addSide(-1);
  addSide(1);

  if (idx.length === 0) return;
  const geo = createBufferGeometry(pos, norm, uv, idx);
  const map = getTexture(texLib, curbTexKey);
  const isNeon = curbTexKey === 'curb_neon';
  const mat = makeMat(gfx, {
    color: map ? 0xffffff : isNeon ? 0x00f0ff : 0xee3333,
    map,
    emissive: isNeon ? 0x0088aa : 0x000000,
    emissiveIntensity: isNeon ? 0.65 : 0,
    roughness: isNeon ? 0.25 : 0.6,
    metalness: isNeon ? 0.2 : 0.05,
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.receiveShadow = true;
  mesh.name = 'track_curbs';
  targetGroup.add(mesh);
}

/**
 * Build drivable off-road terrain aprons + sloped outer edge skirts,
 * flattening the outer skirt flush on open shortcut mouth frames.
 */
function buildOffroadAprons(
  frames: TrackFrame[],
  totalLength: number,
  offroadTexKey: string,
  texLib: any,
  gfx: any,
  targetGroup: THREE.Group
): void {
  const n = frames.length;
  const pos: number[] = [];
  const norm: number[] = [];
  const uv: number[] = [];
  const idx: number[] = [];
  const curbW = 1.25;
  const vRepeats = Math.max(2, Math.round(totalLength / 16));

  const addApron = (sideSign: -1 | 1, key: 'offroadL' | 'offroadR') => {
    const openKey = sideSign < 0 ? 'openMouthL' : 'openMouthR';
    for (let i = 0; i < n; i++) {
      const f0 = frames[i];
      const f1 = frames[(i + 1) % n];
      const w0 = f0[key];
      const w1 = f1[key];
      if (w0 <= curbW + 0.2 && w1 <= curbW + 0.2) continue;

      const s0 = f0.s;
      const s1 = i + 1 === n ? totalLength : f1.s;
      const v0 = (s0 / totalLength) * vRepeats;
      const v1 = (s1 / totalLength) * vRepeats;

      const inner0 = sideSign * (f0.halfWidth + curbW);
      const outer0 = sideSign * (f0.halfWidth + Math.max(curbW + 0.3, w0));
      const skirt0 = sideSign * (f0.halfWidth + Math.max(curbW + 0.3, w0) + 5.5);

      const inner1 = sideSign * (f1.halfWidth + curbW);
      const outer1 = sideSign * (f1.halfWidth + Math.max(curbW + 0.3, w1));
      const skirt1 = sideSign * (f1.halfWidth + Math.max(curbW + 0.3, w1) + 5.5);

      const open0 = f0[openKey];
      const open1 = f1[openKey];
      const skirtDrop0 = open0 ? -0.14 : -3.2;
      const skirtDrop1 = open1 ? -0.14 : -3.2;

      const pIn0 = f0.point.clone().addScaledVector(f0.binormal, inner0).addScaledVector(f0.normal, 0.01);
      const pOut0 = f0.point.clone().addScaledVector(f0.binormal, outer0).addScaledVector(f0.normal, -0.14);
      const pSk0 = f0.point.clone().addScaledVector(f0.binormal, skirt0).addScaledVector(f0.normal, skirtDrop0);

      const pIn1 = f1.point.clone().addScaledVector(f1.binormal, inner1).addScaledVector(f1.normal, 0.01);
      const pOut1 = f1.point.clone().addScaledVector(f1.binormal, outer1).addScaledVector(f1.normal, -0.14);
      const pSk1 = f1.point.clone().addScaledVector(f1.binormal, skirt1).addScaledVector(f1.normal, skirtDrop1);

      const uSpan0 = Math.max(0.5, Math.abs(outer0 - inner0) / 12);
      const uSpan1 = Math.max(0.5, Math.abs(outer1 - inner1) / 12);
      const slopeNorm0 = open0
        ? f0.normal
        : f0.normal.clone().addScaledVector(f0.binormal, sideSign * 0.45).normalize();
      const slopeNorm1 = open1
        ? f1.normal
        : f1.normal.clone().addScaledVector(f1.binormal, sideSign * 0.45).normalize();

      const base = pos.length / 3;
      pushVertex(pos, norm, uv, pIn0, f0.normal, 0, v0);
      pushVertex(pos, norm, uv, pOut0, f0.normal, uSpan0, v0);
      pushVertex(pos, norm, uv, pSk0, slopeNorm0, uSpan0 + 0.6, v0);

      pushVertex(pos, norm, uv, pIn1, f1.normal, 0, v1);
      pushVertex(pos, norm, uv, pOut1, f1.normal, uSpan1, v1);
      pushVertex(pos, norm, uv, pSk1, slopeNorm1, uSpan1 + 0.6, v1);

      if (sideSign > 0) {
        pushQuad(idx, base + 0, base + 1, base + 4, base + 3);
        pushQuad(idx, base + 1, base + 2, base + 5, base + 4);
      } else {
        pushQuad(idx, base + 1, base + 0, base + 3, base + 4);
        pushQuad(idx, base + 2, base + 1, base + 4, base + 5);
      }
    }
  };

  addApron(-1, 'offroadL');
  addApron(1, 'offroadR');

  if (idx.length === 0) return;
  const geo = createBufferGeometry(pos, norm, uv, idx);
  const map = getTexture(texLib, offroadTexKey);
  const fallbackColor =
    offroadTexKey === 'sand'
      ? 0xe5c88c
      : offroadTexKey === 'snow'
        ? 0xeef6ff
        : offroadTexKey === 'lava_rock'
          ? 0x2b2220
          : 0x4ca64c;
  const mat = makeMat(gfx, {
    color: map ? 0xffffff : fallbackColor,
    map,
    roughness: 0.9,
    metalness: 0.02,
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.receiveShadow = true;
  mesh.name = 'track_offroad';
  targetGroup.add(mesh);
}

/**
 * Build solid underside deck (~2.2 units thick) so bridges/overpasses look solid from below,
 * suppressing/recessing outer fascia along open shortcut mouths.
 */
function buildUndersideDeck(
  frames: TrackFrame[],
  totalLength: number,
  deckColor: number | undefined,
  gfx: any,
  targetGroup: THREE.Group
): void {
  const n = frames.length;
  const pos: number[] = [];
  const norm: number[] = [];
  const uv: number[] = [];
  const idx: number[] = [];
  const thickness = 2.2;
  const curbW = 1.25;

  for (let i = 0; i < n; i++) {
    const f0 = frames[i];
    const f1 = frames[(i + 1) % n];
    if (f0.surface === SURFACE_TYPES.VOID && f1.surface === SURFACE_TYPES.VOID) continue;

    const halfTopL0 = f0.openMouthL ? Math.max(2, f0.halfWidth - 0.5) : f0.halfWidth + curbW;
    const halfTopR0 = f0.openMouthR ? Math.max(2, f0.halfWidth - 0.5) : f0.halfWidth + curbW;
    const halfBot0 = Math.max(3, f0.halfWidth + curbW - 1.1);

    const halfTopL1 = f1.openMouthL ? Math.max(2, f1.halfWidth - 0.5) : f1.halfWidth + curbW;
    const halfTopR1 = f1.openMouthR ? Math.max(2, f1.halfWidth - 0.5) : f1.halfWidth + curbW;
    const halfBot1 = Math.max(3, f1.halfWidth + curbW - 1.1);

    const tl0 = f0.point
      .clone()
      .addScaledVector(f0.binormal, -halfTopL0)
      .addScaledVector(f0.normal, f0.openMouthL ? -0.25 : 0.05);
    const bl0 = f0.point.clone().addScaledVector(f0.binormal, -halfBot0).addScaledVector(f0.normal, -thickness);
    const br0 = f0.point.clone().addScaledVector(f0.binormal, halfBot0).addScaledVector(f0.normal, -thickness);
    const tr0 = f0.point
      .clone()
      .addScaledVector(f0.binormal, halfTopR0)
      .addScaledVector(f0.normal, f0.openMouthR ? -0.25 : 0.05);

    const tl1 = f1.point
      .clone()
      .addScaledVector(f1.binormal, -halfTopL1)
      .addScaledVector(f1.normal, f1.openMouthL ? -0.25 : 0.05);
    const bl1 = f1.point.clone().addScaledVector(f1.binormal, -halfBot1).addScaledVector(f1.normal, -thickness);
    const br1 = f1.point.clone().addScaledVector(f1.binormal, halfBot1).addScaledVector(f1.normal, -thickness);
    const tr1 = f1.point
      .clone()
      .addScaledVector(f1.binormal, halfTopR1)
      .addScaledVector(f1.normal, f1.openMouthR ? -0.25 : 0.05);

    const down0 = f0.normal.clone().negate();
    const down1 = f1.normal.clone().negate();
    const left0 = f0.binormal.clone().negate();
    const left1 = f1.binormal.clone().negate();
    const right0 = f0.binormal;
    const right1 = f1.binormal;

    const v0 = (f0.s / totalLength) * 40;
    const v1 = ((i + 1 === n ? totalLength : f1.s) / totalLength) * 40;

    // Left outer fascia (suppressed along open left shortcut mouths)
    if (!f0.openMouthL && !f1.openMouthL) {
      const base = pos.length / 3;
      pushVertex(pos, norm, uv, tl0, left0, 0, v0);
      pushVertex(pos, norm, uv, bl0, left0, 1, v0);
      pushVertex(pos, norm, uv, bl1, left1, 1, v1);
      pushVertex(pos, norm, uv, tl1, left1, 0, v1);
      pushQuad(idx, base, base + 3, base + 2, base + 1);
    }

    // Bottom underside face
    {
      const base = pos.length / 3;
      pushVertex(pos, norm, uv, bl0, down0, 0, v0);
      pushVertex(pos, norm, uv, br0, down0, 1, v0);
      pushVertex(pos, norm, uv, br1, down1, 1, v1);
      pushVertex(pos, norm, uv, bl1, down1, 0, v1);
      pushQuad(idx, base, base + 3, base + 2, base + 1);
    }

    // Right outer fascia (suppressed along open right shortcut mouths)
    if (!f0.openMouthR && !f1.openMouthR) {
      const base = pos.length / 3;
      pushVertex(pos, norm, uv, br0, right0, 0, v0);
      pushVertex(pos, norm, uv, tr0, right0, 1, v0);
      pushVertex(pos, norm, uv, tr1, right1, 1, v1);
      pushVertex(pos, norm, uv, br1, right1, 0, v1);
      pushQuad(idx, base, base + 3, base + 2, base + 1);
    }
  }

  if (idx.length === 0) return;
  const geo = createBufferGeometry(pos, norm, uv, idx);
  const mat = makeMat(gfx, {
    color: deckColor ?? 0x454d59,
    roughness: 0.85,
    metalness: 0.12,
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  mesh.name = 'track_underside_deck';
  targetGroup.add(mesh);
}

interface GuardrailPost {
  pos: THREE.Vector3;
  normal: THREE.Vector3;
  tangent: THREE.Vector3;
  binormal: THREE.Vector3;
}

/**
 * Build left and right guardrails ONLY where wallL / wallR are true.
 * Core rail beams sit in lod0 so walls are always clearly visible; detail posts sit in lod2.
 */
function buildGuardrails(
  frames: TrackFrame[],
  totalLength: number,
  trackDef: TrackDefinition,
  gfx: any,
  lod0: THREE.Group,
  lod2: THREE.Group
): void {
  const n = frames.length;
  const pos: number[] = [];
  const norm: number[] = [];
  const uv: number[] = [];
  const col: number[] = [];
  const idx: number[] = [];
  const curbW = 1.25;
  const accentCol = new THREE.Color(trackDef.railColor ?? trackDef.themeColor ?? 0xff3b30);
  const bodyRgb = [0.88, 0.9, 0.94];
  const accentRgb = [accentCol.r, accentCol.g, accentCol.b];

  const postPositions: GuardrailPost[] = [];

  const addRailSide = (sideSign: -1 | 1, wallKey: 'wallL' | 'wallR', offroadKey: 'offroadL' | 'offroadR') => {
    for (let i = 0; i < n; i++) {
      const f0 = frames[i];
      const f1 = frames[(i + 1) % n];
      if (!f0[wallKey]) continue;

      const lat0 = sideSign * (f0.halfWidth + Math.max(curbW, f0[offroadKey]));
      const lat1 = sideSign * (f1.halfWidth + Math.max(curbW, f1[offroadKey]));
      const thick = sideSign * 0.45;
      const hLow = 0.0;
      const hMid = 0.82;
      const hTop = 1.38;

      const inNormal0 = f0.binormal.clone().multiplyScalar(-sideSign);
      const inNormal1 = f1.binormal.clone().multiplyScalar(-sideSign);
      const outNormal0 = f0.binormal.clone().multiplyScalar(sideSign);
      const outNormal1 = f1.binormal.clone().multiplyScalar(sideSign);

      const pInBot0 = f0.point.clone().addScaledVector(f0.binormal, lat0).addScaledVector(f0.normal, hLow);
      const pInMid0 = f0.point.clone().addScaledVector(f0.binormal, lat0).addScaledVector(f0.normal, hMid);
      const pInTop0 = f0.point.clone().addScaledVector(f0.binormal, lat0).addScaledVector(f0.normal, hTop);
      const pOutBot0 = pInBot0.clone().addScaledVector(f0.binormal, thick);
      const pOutTop0 = pInTop0.clone().addScaledVector(f0.binormal, thick);

      const pInBot1 = f1.point.clone().addScaledVector(f1.binormal, lat1).addScaledVector(f1.normal, hLow);
      const pInMid1 = f1.point.clone().addScaledVector(f1.binormal, lat1).addScaledVector(f1.normal, hMid);
      const pInTop1 = f1.point.clone().addScaledVector(f1.binormal, lat1).addScaledVector(f1.normal, hTop);
      const pOutBot1 = pInBot1.clone().addScaledVector(f1.binormal, thick);
      const pOutTop1 = pInTop1.clone().addScaledVector(f1.binormal, thick);

      const v0 = (f0.s / totalLength) * 60;
      const v1 = ((i + 1 === n ? totalLength : f1.s) / totalLength) * 60;
      const cStrip = Math.floor(i / 2) % 2 === 0 ? accentRgb : bodyRgb;

      // Inner lower barrier face
      let base = pos.length / 3;
      pushVertex(pos, norm, uv, pInBot0, inNormal0, 0, v0, col, bodyRgb);
      pushVertex(pos, norm, uv, pInMid0, inNormal0, 1, v0, col, bodyRgb);
      pushVertex(pos, norm, uv, pInMid1, inNormal1, 1, v1, col, bodyRgb);
      pushVertex(pos, norm, uv, pInBot1, inNormal1, 0, v1, col, bodyRgb);
      if (sideSign > 0) pushQuad(idx, base, base + 1, base + 2, base + 3);
      else pushQuad(idx, base + 3, base + 2, base + 1, base);

      // Inner upper accent stripe face
      base = pos.length / 3;
      pushVertex(pos, norm, uv, pInMid0, inNormal0, 0, v0, col, cStrip);
      pushVertex(pos, norm, uv, pInTop0, inNormal0, 1, v0, col, cStrip);
      pushVertex(pos, norm, uv, pInTop1, inNormal1, 1, v1, col, cStrip);
      pushVertex(pos, norm, uv, pInMid1, inNormal1, 0, v1, col, cStrip);
      if (sideSign > 0) pushQuad(idx, base, base + 1, base + 2, base + 3);
      else pushQuad(idx, base + 3, base + 2, base + 1, base);

      // Top cap
      base = pos.length / 3;
      pushVertex(pos, norm, uv, pInTop0, f0.normal, 0, v0, col, cStrip);
      pushVertex(pos, norm, uv, pOutTop0, f0.normal, 1, v0, col, cStrip);
      pushVertex(pos, norm, uv, pOutTop1, f1.normal, 1, v1, col, cStrip);
      pushVertex(pos, norm, uv, pInTop1, f1.normal, 0, v1, col, cStrip);
      if (sideSign > 0) pushQuad(idx, base, base + 1, base + 2, base + 3);
      else pushQuad(idx, base + 3, base + 2, base + 1, base);

      // Outer wall face
      base = pos.length / 3;
      pushVertex(pos, norm, uv, pOutBot0, outNormal0, 0, v0, col, bodyRgb);
      pushVertex(pos, norm, uv, pOutTop0, outNormal0, 1, v0, col, cStrip);
      pushVertex(pos, norm, uv, pOutTop1, outNormal1, 1, v1, col, cStrip);
      pushVertex(pos, norm, uv, pOutBot1, outNormal1, 0, v1, col, bodyRgb);
      if (sideSign > 0) pushQuad(idx, base + 3, base + 2, base + 1, base);
      else pushQuad(idx, base, base + 1, base + 2, base + 3);

      if (i % 4 === 0) {
        postPositions.push({
          pos: pInBot0.clone().addScaledVector(f0.binormal, thick * 0.5).addScaledVector(f0.normal, 0.85),
          normal: f0.normal,
          tangent: f0.tangent,
          binormal: f0.binormal,
        });
      }
    }
  };

  addRailSide(-1, 'wallL', 'offroadL');
  addRailSide(1, 'wallR', 'offroadR');

  if (idx.length > 0) {
    const geo = createBufferGeometry(pos, norm, uv, idx, col);
    const mat = makeMat(gfx, {
      color: 0xffffff,
      vertexColors: true,
      roughness: 0.45,
      metalness: 0.2,
    });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.name = 'track_guardrails';
    lod0.add(mesh);
  }

  // Detail stanchion posts in lod2 (right-handed basis: +X = left = -binormal, +Y = normal, +Z = tangent -> det = +1)
  if (postPositions.length > 0) {
    const postGeo = new THREE.BoxGeometry(0.58, 1.75, 0.58);
    const postMat = makeMat(gfx, {
      color: 0x3b4252,
      roughness: 0.5,
      metalness: 0.5,
    });
    const inst = new THREE.InstancedMesh(postGeo, postMat, postPositions.length);
    const m4 = new THREE.Matrix4();
    const basis = new THREE.Matrix4();
    const left = new THREE.Vector3();
    for (let i = 0; i < postPositions.length; i++) {
      const p = postPositions[i];
      left.copy(p.binormal).negate();
      basis.makeBasis(left, p.normal, p.tangent);
      m4.copy(basis);
      m4.setPosition(p.pos);
      inst.setMatrixAt(i, m4);
    }
    inst.instanceMatrix.needsUpdate = true;
    inst.castShadow = true;
    inst.name = 'guardrail_posts';
    lod2.add(inst);
  }
}

/**
 * Create a clean checkered canvas texture fallback when texLib has no start_checker.
 */
function createFallbackCheckerTexture(): THREE.CanvasTexture | null {
  if (typeof document === 'undefined') return null;
  const c = document.createElement('canvas');
  c.width = 128;
  c.height = 64;
  const ctx = c.getContext('2d');
  if (!ctx) return null;
  const sq = 16;
  for (let y = 0; y < 4; y++) {
    for (let x = 0; x < 8; x++) {
      ctx.fillStyle = (x + y) % 2 === 0 ? '#ffffff' : '#181a20';
      ctx.fillRect(x * sq, y * sq, sq, sq);
    }
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  return tex;
}

/**
 * Align an Object3D using a proper right-handed basis (det === +1.0):
 * local +X = left (-binormal), +Y = normal, +Z = tangent (forward).
 */
export function orientToFrame(
  obj: THREE.Object3D,
  frame: Pick<TrackFrame | ShortcutFrame, 'point' | 'tangent' | 'normal' | 'binormal'>,
  pos: THREE.Vector3 = frame.point
): void {
  const left = frame.binormal.clone().negate();
  const m = new THREE.Matrix4().makeBasis(left, frame.normal, frame.tangent);
  obj.position.copy(pos);
  obj.quaternion.setFromRotationMatrix(m);
}

/**
 * Build Start/Finish checkered road strip, overhead gantry arch, banner, and 8 start grid markers.
 */
function buildStartFinishGantry(
  frames: TrackFrame[],
  sampleFrame: (t: number) => TrackFrame,
  trackDef: TrackDefinition,
  texLib: any,
  gfx: any,
  lod0: THREE.Group
): StartGridSlot[] {
  const f0 = frames[0];
  const group = new THREE.Group();
  group.name = 'start_finish_gantry';
  orientToFrame(group, f0);

  const checkerTex = getTexture(texLib, 'start_checker') || createFallbackCheckerTexture();
  const accentColor = trackDef.themeColor ?? '#ff3b30';

  // Flush checkered start/finish line across road width
  const lineGeo = new THREE.PlaneGeometry(f0.width, 5.2);
  lineGeo.rotateX(-Math.PI / 2);
  const lineMat = makeMat(gfx, {
    color: 0xffffff,
    map: checkerTex,
    roughness: 0.45,
    metalness: 0.05,
  });
  const lineMesh = new THREE.Mesh(lineGeo, lineMat);
  lineMesh.position.set(0, 0.04, 0);
  lineMesh.receiveShadow = true;
  group.add(lineMesh);

  // Twin side gantry pillars
  const pillarOffset = f0.halfWidth + 2.1;
  const pillarH = 12.2;
  const pillarMat = makeMat(gfx, {
    color: 0x262b35,
    roughness: 0.35,
    metalness: 0.65,
  });
  const accentMat = makeMat(gfx, {
    color: accentColor,
    emissive: accentColor,
    emissiveIntensity: 0.35,
    roughness: 0.3,
    metalness: 0.3,
  });

  for (const s of [-1, 1]) {
    const col = new THREE.Mesh(new THREE.BoxGeometry(1.8, pillarH, 2.2), pillarMat);
    col.position.set(s * pillarOffset, pillarH * 0.5, 0);
    col.castShadow = true;
    group.add(col);

    const trim = new THREE.Mesh(new THREE.BoxGeometry(2.05, 1.4, 2.4), accentMat);
    trim.position.set(s * pillarOffset, pillarH - 1.2, 0);
    group.add(trim);

    const basePlinth = new THREE.Mesh(new THREE.BoxGeometry(2.6, 1.2, 3.0), accentMat);
    basePlinth.position.set(s * pillarOffset, 0.6, 0);
    group.add(basePlinth);
  }

  // Overhead spanning gantry beam + checkered race banner
  const span = pillarOffset * 2 + 1.8;
  const beam = new THREE.Mesh(new THREE.BoxGeometry(span, 1.6, 2.4), pillarMat);
  beam.position.set(0, pillarH + 0.4, 0);
  beam.castShadow = true;
  group.add(beam);

  const bannerGeo = new THREE.BoxGeometry(f0.width * 0.92, 2.6, 0.7);
  const bannerMat = makeMat(gfx, {
    color: 0xffffff,
    map: checkerTex,
    roughness: 0.35,
    metalness: 0.1,
  });
  const banner = new THREE.Mesh(bannerGeo, bannerMat);
  banner.position.set(0, pillarH - 1.4, 0);
  banner.castShadow = true;
  group.add(banner);

  // Top marquee arch sign
  const topSign = new THREE.Mesh(new THREE.BoxGeometry(f0.width * 0.52, 1.4, 1.1), accentMat);
  topSign.position.set(0, pillarH + 1.8, 0);
  group.add(topSign);

  // 3 Signal light pods hanging beneath banner (visible from both grid & reverse view)
  const bulbMat = makeMat(gfx, {
    color: 0xffdd33,
    emissive: 0xff8800,
    emissiveIntensity: 0.9,
    roughness: 0.2,
  });
  const bulbGeo = new THREE.SphereGeometry(0.32, 10, 10);
  for (let i = -1; i <= 1; i++) {
    const pod = new THREE.Mesh(new THREE.CylinderGeometry(0.42, 0.42, 0.6, 12), pillarMat);
    pod.rotation.x = Math.PI / 2;
    pod.position.set(i * 3.0, pillarH - 3.1, 0);
    group.add(pod);

    for (const bz of [-0.3, 0.3]) {
      const bulb = new THREE.Mesh(bulbGeo, bulbMat);
      bulb.position.set(i * 3.0, pillarH - 3.1, bz);
      group.add(bulb);
    }
  }

  lod0.add(group);

  // 8 Painted Starting Grid Brackets behind the start line
  const gridSlots: StartGridSlot[] = [];
  const bracketMat = makeMat(gfx, {
    color: 0xf4f7ff,
    emissive: 0x222633,
    emissiveIntensity: 0.2,
    roughness: 0.5,
  });
  const totalLen = frames[frames.length - 1].s + frames[0].point.distanceTo(frames[frames.length - 1].point);

  for (let slot = 0; slot < 8; slot++) {
    const row = Math.floor(slot / 2);
    const col = slot % 2 === 0 ? -1 : 1;
    const distBack = 9 + row * 6.5;
    const tSlot = wrap01(1 - distBack / totalLen);
    const fSlot = sampleFrame(tSlot);
    const lat = col * Math.min(4.2, fSlot.halfWidth * 0.42);
    const slotPos = fSlot.point.clone().addScaledVector(fSlot.binormal, lat);

    const marker = new THREE.Group();
    orientToFrame(marker, fSlot, slotPos);
    const frontBar = new THREE.Mesh(new THREE.BoxGeometry(2.6, 0.05, 0.28), bracketMat);
    frontBar.position.set(0, 0.04, 1.3);
    const leftBar = new THREE.Mesh(new THREE.BoxGeometry(0.28, 0.05, 1.8), bracketMat);
    leftBar.position.set(-1.16, 0.04, 0.45);
    const rightBar = new THREE.Mesh(new THREE.BoxGeometry(0.28, 0.05, 1.8), bracketMat);
    rightBar.position.set(1.16, 0.04, 0.45);
    marker.add(frontBar, leftBar, rightBar);
    lod0.add(marker);

    gridSlots.push({
      slot,
      t: tSlot,
      lateral: lat,
      pos: slotPos,
      tangent: fSlot.tangent.clone(),
      normal: fSlot.normal.clone(),
      binormal: fSlot.binormal.clone(),
      heading: Math.atan2(fSlot.tangent.x, fSlot.tangent.z),
      frameIdx: Math.round(tSlot * frames.length) % frames.length,
    });
  }

  return gridSlots;
}

/**
 * Create a boost pad mesh at a given frame and lateral offset.
 */
function createBoostPadMesh(
  frame: Pick<TrackFrame | ShortcutFrame, 'point' | 'tangent' | 'normal' | 'binormal'>,
  lateral: number,
  width: number,
  length: number,
  texLib: any,
  gfx: any
): { group: THREE.Group; pos: THREE.Vector3; padMat: THREE.Material } {
  const group = new THREE.Group();
  const pos = frame.point.clone().addScaledVector(frame.binormal, lateral);
  orientToFrame(group, frame, pos);

  const chevTex = getTexture(texLib, 'boost_chevron');
  const padGeo = new THREE.PlaneGeometry(width, length);
  // Rotate flat with +normal up, then 180 deg around Y so +V chevron arrows point toward +Z (+tangent)
  padGeo.rotateX(-Math.PI / 2);
  padGeo.rotateY(Math.PI);

  const padMat = makeMat(gfx, {
    color: chevTex ? 0xffffff : 0x00f0ff,
    map: chevTex,
    emissive: 0x00bbff,
    emissiveIntensity: 0.95,
    roughness: 0.22,
    metalness: 0.2,
  });
  const padMesh = new THREE.Mesh(padGeo, padMat);
  padMesh.position.set(0, 0.06, 0);
  group.add(padMesh);

  // Subtle glowing side border frame
  const edgeMat = makeMat(gfx, {
    color: 0xffcc00,
    emissive: 0xff7700,
    emissiveIntensity: 0.85,
    roughness: 0.3,
  });
  for (const s of [-1, 1]) {
    const border = new THREE.Mesh(new THREE.BoxGeometry(0.24, 0.09, length + 0.3), edgeMat);
    border.position.set(s * (width * 0.5 + 0.12), 0.05, 0);
    group.add(border);
  }

  return { group, pos, padMat };
}

/**
 * Build angled 3D wedge ramp geometry (+ glowing glider ring if isGlider).
 */
function createRampMesh(
  frame: Pick<TrackFrame | ShortcutFrame, 'point' | 'tangent' | 'normal' | 'binormal'>,
  lateral: number,
  width: number,
  length: number,
  height: number,
  isGlider: boolean,
  texLib: any,
  gfx: any
): { group: THREE.Group; pos: THREE.Vector3; entryPos: THREE.Vector3; launchPos: THREE.Vector3 } {
  const group = new THREE.Group();
  const pos = frame.point.clone().addScaledVector(frame.binormal, lateral);
  orientToFrame(group, frame, pos);

  const hw = width * 0.5;
  const hl = length * 0.5;

  // Wedge vertices: entry at z = -hl (y = 0), launch lip at z = +hl (y = height), outward CCW winding
  const positions = new Float32Array([
    // Sloped top surface (2 tris)
    -hw, 0.02, -hl, -hw, height, hl, hw, height, hl,
    -hw, 0.02, -hl, hw, height, hl, hw, 0.02, -hl,
    // Back vertical face
    -hw, 0, hl, hw, 0, hl, hw, height, hl,
    -hw, 0, hl, hw, height, hl, -hw, height, hl,
    // Left side triangle
    -hw, 0.02, -hl, -hw, 0, hl, -hw, height, hl,
    // Right side triangle
    hw, 0.02, -hl, hw, height, hl, hw, 0, hl,
  ]);

  const uvs = new Float32Array([
    0, 0, 0, 2, 1, 2,
    0, 0, 1, 2, 1, 0,
    0, 0, 1, 0, 1, 1,
    0, 0, 1, 1, 0, 1,
    0, 0, 1, 0, 1, 1,
    0, 0, 1, 1, 1, 0,
  ]);

  const wedgeGeo = new THREE.BufferGeometry();
  wedgeGeo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  wedgeGeo.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
  wedgeGeo.computeVertexNormals();

  const chevTex = getTexture(texLib, 'boost_chevron');
  const rampColor = isGlider ? 0x38bdf8 : 0xffaa22;
  const rampEmissive = isGlider ? 0x0284c7 : 0xd95500;
  const wedgeMat = makeMat(gfx, {
    color: chevTex ? (isGlider ? 0x80e5ff : 0xffdf88) : rampColor,
    map: chevTex,
    emissive: rampEmissive,
    emissiveIntensity: 0.75,
    roughness: 0.3,
    metalness: 0.25,
    side: THREE.DoubleSide,
  });

  const wedgeMesh = new THREE.Mesh(wedgeGeo, wedgeMat);
  wedgeMesh.castShadow = true;
  wedgeMesh.receiveShadow = true;
  group.add(wedgeMesh);

  // Side accent trim rails
  const trimMat = makeMat(gfx, {
    color: isGlider ? 0x00f0ff : 0xff6600,
    emissive: isGlider ? 0x0088ff : 0xff3300,
    emissiveIntensity: 0.9,
    roughness: 0.25,
  });
  const slopeLen = Math.hypot(length, height);
  const slopeAngle = Math.atan2(height, length);
  for (const s of [-1, 1]) {
    const rail = new THREE.Mesh(new THREE.BoxGeometry(0.28, 0.26, slopeLen), trimMat);
    rail.position.set(s * (hw + 0.08), height * 0.5 + 0.1, 0);
    rail.rotation.x = -slopeAngle;
    group.add(rail);
  }

  // Glider boost ring floating ahead of the launch lip
  if (isGlider) {
    const ringMat = makeMat(gfx, {
      color: 0x38e8ff,
      emissive: 0x00c8ff,
      emissiveIntensity: 1.15,
      roughness: 0.2,
      metalness: 0.4,
    });
    const ring = new THREE.Mesh(new THREE.TorusGeometry(width * 0.58, 0.32, 10, 24), ringMat);
    ring.position.set(0, height + 3.2, hl + 4.0);
    group.add(ring);
  }

  const entryPos = pos.clone().addScaledVector(frame.tangent, -hl);
  const launchPos = pos.clone().addScaledVector(frame.tangent, hl).addScaledVector(frame.normal, height);

  return { group, pos, entryPos, launchPos };
}

/**
 * Smoothly raise any non-VOID shortcut frames that dip below overlapping main track frames
 * or below the track floor plane, while keeping entry/exit mouths flush with the local
 * banked road surface and blending interior lifts smoothly without lifting endpoints.
 */
function applyShortcutSafetyElevation(
  scFrames: ShortcutFrame[],
  mainFrames: TrackFrame[],
  minFloorAllowed: number
): void {
  const count = scFrames.length;
  if (count < 2) return;

  const origY = new Array<number>(count);
  const delta = new Array<number>(count);

  const findLocalMainSurfaceY = (sf: ShortcutFrame): number | null => {
    let bestY: number | null = null;
    for (let m = 0; m < mainFrames.length; m++) {
      const mf = mainFrames[m];
      const dx = sf.point.x - mf.point.x;
      const dz = sf.point.z - mf.point.z;
      const maxSpan = mf.halfWidth + Math.max(mf.offroadL, mf.offroadR) + 6;
      if (dx * dx + dz * dz > maxSpan * maxSpan) continue;

      const tanXZ = Math.hypot(mf.tangent.x, mf.tangent.z) || 1;
      const along = (dx * mf.tangent.x + dz * mf.tangent.z) / tanXZ;
      if (Math.abs(along) > 4.5) continue;

      const binXZ = Math.hypot(mf.binormal.x, mf.binormal.z) || 1;
      const lat = (dx * mf.binormal.x + dz * mf.binormal.z) / binXZ;
      if (lat < -(mf.halfWidth + mf.offroadL + 1.5) || lat > mf.halfWidth + mf.offroadR + 1.5) continue;

      if (Math.abs(sf.point.y - mf.point.y) < 8.0) {
        const clampedLat = Math.max(-(mf.halfWidth + mf.offroadL), Math.min(mf.halfWidth + mf.offroadR, lat));
        const bankedSurfaceY = mf.point.y + mf.binormal.y * clampedLat + mf.tangent.y * along;
        if (bestY === null || bankedSurfaceY > bestY) {
          bestY = bankedSurfaceY;
        }
      }
    }
    return bestY;
  };

  for (let k = 0; k < count; k++) {
    const sf = scFrames[k];
    origY[k] = sf.point.y;
    if (sf.surface === SURFACE_TYPES.VOID) {
      delta[k] = 0;
      continue;
    }

    let targetY = Number.isFinite(minFloorAllowed) ? Math.max(sf.point.y, minFloorAllowed) : sf.point.y;
    const localMainY = findLocalMainSurfaceY(sf);
    if (localMainY !== null) {
      targetY = Math.max(targetY, localMainY + 0.06);
    }

    delta[k] = Math.max(0, targetY - origY[k]);
  }

  // Feather interior lifts across neighbors, fading to 0 at endpoints k=0 and k=count-1
  const lift = delta.slice();
  const radius = 5;
  for (let k = 0; k < count; k++) {
    if (delta[k] <= 0) continue;
    for (let off = -radius; off <= radius; off++) {
      const j = k + off;
      if (j <= 0 || j >= count - 1) continue;
      const w = 0.5 * (1 + Math.cos((Math.PI * Math.abs(off)) / (radius + 1)));
      const edgeFade = Math.min(1, j / 3, (count - 1 - j) / 3);
      const val = delta[k] * w * edgeFade;
      if (val > lift[j]) {
        lift[j] = val;
      }
    }
  }

  // Gentle clamped Laplacian smoothing pass on interior frames (keep k=0 and k=count-1 pinned)
  for (let pass = 0; pass < 3; pass++) {
    const next = lift.slice();
    for (let k = 1; k < count - 1; k++) {
      const avg = 0.25 * lift[k - 1] + 0.5 * lift[k] + 0.25 * lift[k + 1];
      next[k] = Math.max(delta[k], avg);
    }
    for (let k = 1; k < count - 1; k++) {
      lift[k] = next[k];
    }
  }

  // Seat mouth endpoints k=0 and k=count-1 flush if original definition hovered > 0.35u above local banked road
  const seatMouthEndpoint = (endIdx: number, dir: 1 | -1) => {
    const sf = scFrames[endIdx];
    if (sf.surface === SURFACE_TYPES.VOID) return;
    const localMainY = findLocalMainSurfaceY(sf);
    if (localMainY === null) return;
    const currentY = origY[endIdx] + lift[endIdx];
    const desiredY = localMainY + 0.06;
    const excess = currentY - desiredY;
    if (excess > 0.35) {
      for (let step = 0; step <= 3; step++) {
        const idx = endIdx + dir * step;
        if (idx < 0 || idx >= count) break;
        const w = 0.5 * (1 + Math.cos((Math.PI * step) / 4));
        const candidateY = origY[idx] + lift[idx] - excess * w;
        const idxMainY = findLocalMainSurfaceY(scFrames[idx]);
        const floorClamp = Number.isFinite(minFloorAllowed) ? minFloorAllowed : -Infinity;
        const minAllowed = Math.max(floorClamp, idxMainY !== null ? idxMainY + 0.06 : -Infinity);
        const clampedY = Math.max(candidateY, minAllowed);
        lift[idx] = clampedY - origY[idx];
      }
    }
  };

  seatMouthEndpoint(0, 1);
  seatMouthEndpoint(count - 1, -1);

  let anyAdjusted = false;
  for (let k = 0; k < count; k++) {
    if (Math.abs(lift[k]) > 1e-5) {
      scFrames[k].point.y = origY[k] + lift[k];
      anyAdjusted = true;
    }
  }

  if (anyAdjusted) {
    const tan = new THREE.Vector3();
    for (let k = 0; k < count; k++) {
      const prev = scFrames[Math.max(0, k - 1)].point;
      const next = scFrames[Math.min(count - 1, k + 1)].point;
      tan.subVectors(next, prev);
      if (tan.lengthSq() > 1e-6) {
        tan.normalize();
        const bin = new THREE.Vector3().crossVectors(tan, WORLD_UP);
        if (bin.lengthSq() < 1e-6) bin.set(1, 0, 0);
        bin.normalize();
        const norm = new THREE.Vector3().crossVectors(bin, tan).normalize();
        scFrames[k].tangent.copy(tan);
        scFrames[k].binormal.copy(bin);
        scFrames[k].normal.copy(norm);
      }
    }
  }
}

/**
 * Build shortcuts: visible ribbons, boost pads at entry, ramps, and fast projection query data.
 */
function buildShortcuts(
  trackDef: TrackDefinition,
  mainFrames: TrackFrame[],
  sampleMainFrame: (t: number) => TrackFrame,
  offroadSurfaceDefault: SurfaceType | string,
  texLib: any,
  gfx: any,
  lod0: THREE.Group
): { shortcuts: RuntimeShortcut[]; extraBoostPads: TrackBoostPad[]; extraRamps: TrackRamp[] } {
  const built: RuntimeShortcut[] = [];
  const extraBoostPads: TrackBoostPad[] = [];
  const extraRamps: TrackRamp[] = [];
  const defs = trackDef.shortcuts || [];

  let minMainY = Infinity;
  for (let i = 0; i < mainFrames.length; i++) {
    if (mainFrames[i].point.y < minMainY) minMainY = mainFrames[i].point.y;
  }
  const inferredFloorY =
    typeof trackDef.floorY === 'number'
      ? trackDef.floorY
      : offroadSurfaceDefault !== SURFACE_TYPES.VOID
        ? minMainY - 4.5
        : -Infinity;
  const minFloorAllowed = Number.isFinite(inferredFloorY) ? inferredFloorY + 0.5 : -Infinity;

  for (let sIdx = 0; sIdx < defs.length; sIdx++) {
    const sc = defs[sIdx];
    if (!sc.points || sc.points.length < 2) continue;

    const pts3 = sc.points.map((p) => new THREE.Vector3(p.x, p.y, p.z));
    const initialCurve = new THREE.CatmullRomCurve3(pts3, false, 'centripetal', 0.5);
    initialCurve.arcLengthDivisions = 240;
    const totalLength = Math.max(1, initialCurve.getLength());
    const count = Math.max(14, Math.min(48, Math.round(totalLength / 4.5)));

    const defaultSurface =
      sc.type === 'split'
        ? SURFACE_TYPES.WOOD
        : sc.type === 'ramp'
          ? SURFACE_TYPES.ROAD
          : inferDefaultOffroadSurface(trackDef);

    const scFrames: ShortcutFrame[] = [];
    for (let i = 0; i <= count; i++) {
      const u = i / count;
      const tCurve = initialCurve.getUtoTmapping(u, 0);
      const pt = initialCurve.getPointAt(u);
      const tan = initialCurve.getTangentAt(u).normalize();
      const bin = new THREE.Vector3().crossVectors(tan, WORLD_UP);
      if (bin.lengthSq() < 1e-6) bin.set(1, 0, 0);
      bin.normalize();
      const norm = new THREE.Vector3().crossVectors(bin, tan).normalize();

      const pMapped = tCurve * (sc.points.length - 1);
      const p0Idx = Math.min(sc.points.length - 2, Math.floor(pMapped));
      const pw = pMapped - p0Idx;
      const cpA = sc.points[p0Idx];
      const cpB = sc.points[p0Idx + 1];
      const width = (cpA.width ?? 12) + ((cpB.width ?? 12) - (cpA.width ?? 12)) * pw;
      const rawSurf = (pw < 0.5 ? cpA.surface : cpB.surface) ?? defaultSurface;
      const surface = normalizePhysicsSurface(rawSurf);
      const roadTex = resolveRoadTextureKey(rawSurf, cpA.roadTexture || sc.roadTexture);

      scFrames.push({
        index: i,
        u,
        s: u * totalLength,
        point: pt,
        pos: pt,
        tangent: tan,
        normal: norm,
        binormal: bin,
        width,
        halfWidth: width * 0.5,
        surface,
        roadTexture: roadTex,
      });
    }

    // Apply smooth safety elevation pass so no non-VOID shortcut frame dips under road or floor
    applyShortcutSafetyElevation(scFrames, mainFrames, minFloorAllowed);

    const curve = new THREE.CatmullRomCurve3(
      scFrames.map((f) => f.point.clone()),
      false,
      'centripetal',
      0.5
    );
    curve.arcLengthDivisions = 240;

    // Render shortcut ribbon + underside deck (skip VOID segments for gap jumps)
    const buckets = new Map<string, MeshBucket>();
    const deckPos: number[] = [];
    const deckNorm: number[] = [];
    const deckUv: number[] = [];
    const deckIdx: number[] = [];

    for (let i = 0; i < scFrames.length - 1; i++) {
      const f0 = scFrames[i];
      const f1 = scFrames[i + 1];
      if (f0.surface === SURFACE_TYPES.VOID && f1.surface === SURFACE_TYPES.VOID) continue;

      const texKey = f0.roadTexture;
      let b = buckets.get(texKey);
      if (!b) {
        b = { pos: [], norm: [], uv: [], idx: [] };
        buckets.set(texKey, b);
      }
      const base = b.pos.length / 3;

      const v0 = f0.s / 14;
      const v1 = f1.s / 14;

      const l0 = f0.point.clone().addScaledVector(f0.binormal, -f0.halfWidth).addScaledVector(f0.normal, 0.04);
      const r0 = f0.point.clone().addScaledVector(f0.binormal, f0.halfWidth).addScaledVector(f0.normal, 0.04);
      const l1 = f1.point.clone().addScaledVector(f1.binormal, -f1.halfWidth).addScaledVector(f1.normal, 0.04);
      const r1 = f1.point.clone().addScaledVector(f1.binormal, f1.halfWidth).addScaledVector(f1.normal, 0.04);

      pushVertex(b.pos, b.norm, b.uv, l0, f0.normal, 0, v0);
      pushVertex(b.pos, b.norm, b.uv, r0, f0.normal, 1, v0);
      pushVertex(b.pos, b.norm, b.uv, r1, f1.normal, 1, v1);
      pushVertex(b.pos, b.norm, b.uv, l1, f1.normal, 0, v1);
      pushQuad(b.idx, base, base + 1, base + 2, base + 3);

      // Solid underside for elevated splits/ramps
      if (sc.type === 'split' || sc.type === 'ramp') {
        const thick = 1.6;
        const bl0 = l0.clone().addScaledVector(f0.normal, -thick).addScaledVector(f0.binormal, 0.4);
        const br0 = r0.clone().addScaledVector(f0.normal, -thick).addScaledVector(f0.binormal, -0.4);
        const bl1 = l1.clone().addScaledVector(f1.normal, -thick).addScaledVector(f1.binormal, 0.4);
        const br1 = r1.clone().addScaledVector(f1.normal, -thick).addScaledVector(f1.binormal, -0.4);

        let dBase = deckPos.length / 3;
        pushVertex(deckPos, deckNorm, deckUv, l0, f0.binormal.clone().negate(), 0, v0);
        pushVertex(deckPos, deckNorm, deckUv, bl0, f0.binormal.clone().negate(), 1, v0);
        pushVertex(deckPos, deckNorm, deckUv, bl1, f1.binormal.clone().negate(), 1, v1);
        pushVertex(deckPos, deckNorm, deckUv, l1, f1.binormal.clone().negate(), 0, v1);
        pushQuad(deckIdx, dBase, dBase + 3, dBase + 2, dBase + 1);

        dBase = deckPos.length / 3;
        pushVertex(deckPos, deckNorm, deckUv, bl0, f0.normal.clone().negate(), 0, v0);
        pushVertex(deckPos, deckNorm, deckUv, br0, f0.normal.clone().negate(), 1, v0);
        pushVertex(deckPos, deckNorm, deckUv, br1, f1.normal.clone().negate(), 1, v1);
        pushVertex(deckPos, deckNorm, deckUv, bl1, f1.normal.clone().negate(), 0, v1);
        pushQuad(deckIdx, dBase, dBase + 3, dBase + 2, dBase + 1);

        dBase = deckPos.length / 3;
        pushVertex(deckPos, deckNorm, deckUv, br0, f0.binormal, 0, v0);
        pushVertex(deckPos, deckNorm, deckUv, r0, f0.binormal, 1, v0);
        pushVertex(deckPos, deckNorm, deckUv, r1, f1.binormal, 1, v1);
        pushVertex(deckPos, deckNorm, deckUv, br1, f1.binormal, 0, v1);
        pushQuad(deckIdx, dBase, dBase + 3, dBase + 2, dBase + 1);
      }
    }

    for (const [texKey, data] of buckets.entries()) {
      if (data.idx.length === 0) continue;
      const geo = createBufferGeometry(data.pos, data.norm, data.uv, data.idx);
      const map = getTexture(texLib, texKey);
      const mat = makeMat(gfx, {
        color: map ? 0xffffff : 0x8b6e4e,
        map,
        emissive: texKey === 'rainbow_road' ? 0x221144 : texKey === 'neon_road' ? 0x051833 : 0x000000,
        emissiveIntensity: texKey === 'rainbow_road' || texKey === 'neon_road' ? 0.5 : 0,
        roughness: 0.72,
        metalness: 0.08,
      });
      const mesh = new THREE.Mesh(geo, mat);
      mesh.receiveShadow = true;
      mesh.name = `shortcut_${sIdx}_${texKey}`;
      lod0.add(mesh);
    }

    if (deckIdx.length > 0) {
      const dGeo = createBufferGeometry(deckPos, deckNorm, deckUv, deckIdx);
      const dMat = makeMat(gfx, {
        color: sc.type === 'split' ? 0x5c4734 : 0x454d59,
        roughness: 0.85,
      });
      const dMesh = new THREE.Mesh(dGeo, dMat);
      dMesh.castShadow = true;
      dMesh.receiveShadow = true;
      lod0.add(dMesh);
    }

    // Helper sampler along shortcut u in [0, 1]
    const sampleShortcut = (u: number): ShortcutFrame => {
      const uc = Math.max(0, Math.min(1, u));
      const fPos = uc * (scFrames.length - 1);
      const idx0 = Math.min(scFrames.length - 2, Math.floor(fPos));
      const w = fPos - idx0;
      const a = scFrames[idx0];
      const b = scFrames[idx0 + 1];
      const pt = a.point.clone().lerp(b.point, w);
      const tan = a.tangent.clone().lerp(b.tangent, w).normalize();
      const norm = a.normal.clone().lerp(b.normal, w).normalize();
      const bin = tan.clone().cross(norm).normalize();
      const width = a.width + (b.width - a.width) * w;
      return {
        index: w < 0.5 ? a.index : b.index,
        u: uc,
        s: uc * totalLength,
        point: pt,
        pos: pt,
        tangent: tan,
        normal: norm,
        binormal: bin,
        width,
        halfWidth: width * 0.5,
        surface: w < 0.5 ? a.surface : b.surface,
        roadTexture: w < 0.5 ? a.roadTexture : b.roadTexture,
      };
    };

    // Optional entry boost pad
    if (sc.boostAtEntry) {
      const fPad = sampleShortcut(0.14);
      const padW = Math.min(5.2, fPad.width * 0.6);
      const padL = 8.0;
      const { group, pos } = createBoostPadMesh(fPad, 0, padW, padL, texLib, gfx);
      lod0.add(group);
      extraBoostPads.push({
        id: `sc_${sIdx}_boost`,
        t: sc.entryT,
        s: sc.entryT * (mainFrames.length ? mainFrames[mainFrames.length - 1].s : 1),
        lateral: 0,
        width: padW,
        length: padL,
        pos,
        tangent: fPad.tangent.clone(),
        normal: fPad.normal.clone(),
        binormal: fPad.binormal.clone(),
        frameIdx: Math.round(wrap01(sc.entryT) * mainFrames.length) % mainFrames.length,
        onShortcut: true,
        shortcutName: sc.name,
        mesh: group,
      });
    }

    // Optional jump/glider ramp
    if (sc.type === 'ramp' || sc.isGlider) {
      const rampU = sc.rampU ?? 0.3;
      const fRamp = sampleShortcut(rampU);
      const rW = Math.min(8.2, fRamp.width * 0.78);
      const rL = sc.rampLength ?? 10.5;
      const rH = sc.rampHeight ?? (sc.isGlider ? 3.4 : 2.6);
      const { group, pos, entryPos, launchPos } = createRampMesh(
        fRamp,
        0,
        rW,
        rL,
        rH,
        Boolean(sc.isGlider),
        texLib,
        gfx
      );
      lod0.add(group);
      extraRamps.push({
        id: `sc_${sIdx}_ramp`,
        t: sc.entryT,
        s: sampleMainFrame(sc.entryT).s,
        lateral: 0,
        width: rW,
        length: rL,
        height: rH,
        isGlider: Boolean(sc.isGlider),
        pos,
        entryPos,
        launchPos,
        tangent: fRamp.tangent.clone(),
        normal: fRamp.normal.clone(),
        binormal: fRamp.binormal.clone(),
        frameIdx: Math.round(wrap01(sc.entryT) * mainFrames.length) % mainFrames.length,
        onShortcut: true,
        shortcutName: sc.name,
        mesh: group,
      });
    }

    built.push({
      id: `shortcut_${sIdx}`,
      name: sc.name,
      type: sc.type,
      entryT: sc.entryT,
      exitT: sc.exitT,
      entryFrameIdx: Math.round(wrap01(sc.entryT) * mainFrames.length) % mainFrames.length,
      exitFrameIdx: Math.round(wrap01(sc.exitT) * mainFrames.length) % mainFrames.length,
      boostAtEntry: Boolean(sc.boostAtEntry),
      isGlider: Boolean(sc.isGlider),
      requiresBoost: Boolean(sc.requiresBoost),
      hasWalls: Boolean(sc.wallL || sc.wallR),
      wallL: Boolean(sc.wallL),
      wallR: Boolean(sc.wallR),
      points: scFrames.map((f) => f.point.clone()),
      frames: scFrames,
      totalLength,
      sample: sampleShortcut,
      curve,
    });
  }

  return { shortcuts: built, extraBoostPads, extraRamps };
}

/**
 * Build floating rotating translucent rainbow `?` item boxes.
 */
function buildItemBoxes(
  trackDef: TrackDefinition,
  sampleFrame: (t: number) => TrackFrame,
  gfx: any,
  lod0: THREE.Group
): TrackItemBox[] {
  const boxes: TrackItemBox[] = [];
  const rows = trackDef.itemBoxRows || [];

  const outerGeo = new THREE.BoxGeometry(1.9, 1.9, 1.9);
  const edgeGeo = new THREE.EdgesGeometry(outerGeo);
  const qHookGeo = new THREE.TorusGeometry(0.32, 0.085, 6, 12, Math.PI * 1.45);
  const qStemGeo = new THREE.CylinderGeometry(0.085, 0.085, 0.28, 6);
  const qDotGeo = new THREE.SphereGeometry(0.11, 8, 8);

  const edgeMat = new THREE.LineBasicMaterial({ color: 0xffffff });
  const qMat = makeMat(gfx, {
    color: 0xffffff,
    emissive: 0xffe066,
    emissiveIntensity: 0.9,
    roughness: 0.2,
  });

  const palette = [0xff4d6d, 0xffbe0b, 0x38e8ff, 0xa855f7, 0x34d399];

  for (let rIdx = 0; rIdx < rows.length; rIdx++) {
    const row = rows[rIdx];
    const frame = sampleFrame(row.t);
    const count = Math.max(1, row.count ?? 4);
    const spread = row.spread ?? Math.min(frame.width * 0.72, (count - 1) * 3.8);

    for (let i = 0; i < count; i++) {
      const lat = count === 1 ? 0 : -spread * 0.5 + (spread * i) / (count - 1);
      const basePos = frame.point.clone().addScaledVector(frame.binormal, lat).addScaledVector(frame.normal, 2.05);

      const group = new THREE.Group();
      group.position.copy(basePos);

      const tint = palette[(rIdx + i) % palette.length];
      const boxMat = makeMat(gfx, {
        color: tint,
        emissive: tint,
        emissiveIntensity: 0.45,
        transparent: true,
        opacity: 0.62,
        roughness: 0.12,
        metalness: 0.35,
      });

      const cube = new THREE.Mesh(outerGeo, boxMat);
      cube.rotation.set(0.45, 0.75, 0.35);
      const wire = new THREE.LineSegments(edgeGeo, edgeMat);
      cube.add(wire);
      group.add(cube);

      // Inner 3D question mark
      const qGroup = new THREE.Group();
      const hook = new THREE.Mesh(qHookGeo, qMat);
      hook.position.set(0, 0.18, 0);
      hook.rotation.z = -0.35;
      const stem = new THREE.Mesh(qStemGeo, qMat);
      stem.position.set(0, -0.14, 0);
      const dot = new THREE.Mesh(qDotGeo, qMat);
      dot.position.set(0, -0.42, 0);
      qGroup.add(hook, stem, dot);
      group.add(qGroup);

      lod0.add(group);
      boxes.push({
        id: `item_${rIdx}_${i}`,
        t: wrap01(row.t),
        lateral: lat,
        pos: basePos.clone(),
        basePos,
        normal: frame.normal.clone(),
        radius: 1.95,
        active: true,
        respawnTimer: 0,
        mesh: group,
        cubeMesh: cube,
        innerMesh: qGroup,
        boxMat,
        phase: rIdx * 1.3 + i * 0.85,
      });
    }
  }

  return boxes;
}

/**
 * Build spinning gold coins along track lines.
 */
function buildCoins(
  trackDef: TrackDefinition,
  sampleFrame: (t: number) => TrackFrame,
  gfx: any,
  lod0: THREE.Group
): TrackCoin[] {
  const coins: TrackCoin[] = [];
  const lines = trackDef.coinLines || [];

  const diskGeo = new THREE.CylinderGeometry(0.72, 0.72, 0.16, 14);
  diskGeo.rotateX(Math.PI / 2);
  const rimGeo = new THREE.TorusGeometry(0.62, 0.08, 6, 14);

  const coinMat = makeMat(gfx, {
    color: 0xffd700,
    emissive: 0x996600,
    emissiveIntensity: 0.45,
    roughness: 0.22,
    metalness: 0.85,
  });

  for (let lIdx = 0; lIdx < lines.length; lIdx++) {
    const line = lines[lIdx];
    const count = Math.max(1, line.count ?? 4);
    const t0 = wrap01(line.tStart);
    let t1 = wrap01(line.tEnd);
    if (t1 < t0) t1 += 1;

    const latStart = line.lateral ?? 0;
    const latEnd = line.lateralEnd ?? latStart;

    for (let i = 0; i < count; i++) {
      const frac = count === 1 ? 0 : i / (count - 1);
      const t = wrap01(t0 + (t1 - t0) * frac);
      const lat = latStart + (latEnd - latStart) * frac;
      const frame = sampleFrame(t);
      const basePos = frame.point.clone().addScaledVector(frame.binormal, lat).addScaledVector(frame.normal, 1.25);

      const mesh = new THREE.Group();
      mesh.position.copy(basePos);
      const disk = new THREE.Mesh(diskGeo, coinMat);
      const rim = new THREE.Mesh(rimGeo, coinMat);
      mesh.add(disk, rim);
      lod0.add(mesh);

      coins.push({
        id: `coin_${lIdx}_${i}`,
        t,
        lateral: lat,
        pos: basePos.clone(),
        basePos,
        normal: frame.normal.clone(),
        radius: 1.4,
        active: true,
        respawnTimer: 0,
        mesh,
        phase: lIdx * 0.9 + i * 0.5,
      });
    }
  }

  return coins;
}

/**
 * Compute visual-matched 3D hitbox bounds for a hazard given its groundY and animation state.
 */
function computeHazardHitbox(
  type: string,
  radius: number,
  groundY: number,
  liftOrPulse: number
): { hitRadius: number; yMin: number; yMax: number; active: boolean } {
  if (type === 'thwomp') {
    const yMin = groundY + liftOrPulse;
    return {
      hitRadius: radius * 0.85,
      yMin,
      yMax: yMin + radius * 2.0,
      active: true,
    };
  }
  if (type === 'lava_geyser') {
    return {
      hitRadius: radius * 0.65,
      yMin: groundY,
      yMax: groundY + radius * 3.8 * liftOrPulse,
      active: liftOrPulse > 0.36,
    };
  }
  if (type === 'cyber_drone') {
    return {
      hitRadius: radius * 0.82,
      yMin: groundY + radius * 0.45,
      yMax: groundY + radius * 1.45,
      active: true,
    };
  }
  if (type === 'ice_spike') {
    return {
      hitRadius: radius * 0.82,
      yMin: groundY,
      yMax: groundY + radius * 2.4,
      active: true,
    };
  }
  if (type === 'crab') {
    return {
      hitRadius: radius * 0.82,
      yMin: groundY,
      yMax: groundY + radius * 1.35,
      active: true,
    };
  }
  if (type === 'asteroid' || type === 'star_mine') {
    return {
      hitRadius: radius * 0.82,
      yMin: groundY + radius * 0.1,
      yMax: groundY + radius * 1.8,
      active: true,
    };
  }
  // 'boulder' and fallback
  return {
    hitRadius: radius * 0.82,
    yMin: groundY,
    yMax: groundY + radius * 1.85,
    active: true,
  };
}

/**
 * Construct detailed 3D geometry for each themed track hazard type.
 */
function buildHazards(
  trackDef: TrackDefinition,
  sampleFrame: (t: number) => TrackFrame,
  gfx: any,
  lod0: THREE.Group
): TrackHazard[] {
  const hazards: TrackHazard[] = [];
  const defs = trackDef.hazards || [];

  for (let i = 0; i < defs.length; i++) {
    const h = defs[i];
    const frame = sampleFrame(h.t);
    const radius = h.radius ?? 2.3;
    const baseLateral = h.lateral ?? 0;
    const moveAmp = h.moveAmp ?? 0;
    const moveSpeed = h.moveSpeed ?? 1.6;
    const basePos = frame.point.clone().addScaledVector(frame.binormal, baseLateral);

    const group = new THREE.Group();
    orientToFrame(group, frame, basePos);

    let subParts: Record<string, any> = {};
    const type = h.type || 'boulder';

    if (type === 'thwomp') {
      const stoneMat = makeMat(gfx, { color: 0x5c6472, roughness: 0.78, metalness: 0.15 });
      const eyeMat = makeMat(gfx, { color: 0xff2222, emissive: 0xff0000, emissiveIntensity: 0.9 });
      const body = new THREE.Mesh(new THREE.BoxGeometry(radius * 1.6, radius * 2.0, radius * 1.2), stoneMat);
      body.castShadow = true;
      const thwompHead = new THREE.Group();
      thwompHead.add(body);
      for (const sx of [-1, 1]) {
        const eye = new THREE.Mesh(new THREE.BoxGeometry(radius * 0.35, radius * 0.22, 0.2), eyeMat);
        eye.position.set(sx * radius * 0.35, radius * 0.25, radius * 0.62);
        thwompHead.add(eye);
      }
      const spikeGeo = new THREE.ConeGeometry(radius * 0.28, radius * 0.65, 5);
      for (const [sx, sy] of [
        [-1, 1],
        [1, 1],
        [-1, -1],
        [1, -1],
      ]) {
        const sp = new THREE.Mesh(spikeGeo, stoneMat);
        sp.position.set(sx * radius * 0.88, sy * radius * 0.65, 0);
        sp.rotation.z = -sx * Math.PI * 0.5;
        thwompHead.add(sp);
      }
      thwompHead.position.y = radius * 1.1;
      group.add(thwompHead);
      subParts = { thwompHead, baseY: radius * 1.1 };
    } else if (type === 'lava_geyser') {
      const ventMat = makeMat(gfx, { color: 0x261d1c, roughness: 0.9 });
      const magmaMat = makeMat(gfx, {
        color: 0xff5500,
        emissive: 0xff3300,
        emissiveIntensity: 1.2,
        roughness: 0.25,
      });
      const vent = new THREE.Mesh(new THREE.TorusGeometry(radius * 0.85, radius * 0.25, 8, 16), ventMat);
      vent.rotation.x = Math.PI / 2;
      vent.position.y = 0.2;
      const pool = new THREE.Mesh(new THREE.CylinderGeometry(radius * 0.72, radius * 0.72, 0.25, 14), magmaMat);
      pool.position.y = 0.15;
      const plume = new THREE.Mesh(new THREE.CylinderGeometry(radius * 0.42, radius * 0.65, radius * 3.8, 12), magmaMat);
      plume.position.y = radius * 1.9;
      const cap = new THREE.Mesh(new THREE.SphereGeometry(radius * 0.72, 10, 8), magmaMat);
      cap.position.y = radius * 3.8;
      const eruptGroup = new THREE.Group();
      eruptGroup.add(plume, cap);
      group.add(vent, pool, eruptGroup);
      subParts = { eruptGroup };
    } else if (type === 'crab') {
      const shellMat = makeMat(gfx, { color: 0xe63946, roughness: 0.35, metalness: 0.1 });
      const eyeMat = makeMat(gfx, { color: 0x111111, roughness: 0.2 });
      const body = new THREE.Mesh(new THREE.SphereGeometry(radius * 0.75, 12, 10), shellMat);
      body.scale.set(1.3, 0.62, 1.0);
      body.position.y = radius * 0.65;
      body.castShadow = true;
      group.add(body);
      for (const s of [-1, 1]) {
        const claw = new THREE.Mesh(new THREE.SphereGeometry(radius * 0.36, 8, 8), shellMat);
        claw.scale.set(1.2, 0.8, 0.8);
        claw.position.set(s * radius * 1.05, radius * 0.9, radius * 0.45);
        group.add(claw);
        const eye = new THREE.Mesh(new THREE.SphereGeometry(radius * 0.14, 8, 8), eyeMat);
        eye.position.set(s * radius * 0.35, radius * 1.12, radius * 0.48);
        group.add(eye);
      }
    } else if (type === 'cyber_drone') {
      const hullMat = makeMat(gfx, { color: 0x1e2436, metalness: 0.75, roughness: 0.25 });
      const glowMat = makeMat(gfx, { color: 0xff00aa, emissive: 0xff0088, emissiveIntensity: 1.15 });
      const hull = new THREE.Mesh(new THREE.OctahedronGeometry(radius * 0.72, 1), hullMat);
      hull.scale.set(1.2, 0.55, 1.2);
      hull.position.y = radius * 0.95;
      hull.castShadow = true;
      const ring = new THREE.Mesh(new THREE.TorusGeometry(radius * 0.92, 0.16, 8, 18), glowMat);
      ring.rotation.x = Math.PI / 2;
      ring.position.y = radius * 0.95;
      group.add(hull, ring);
      subParts = { rotor: ring };
    } else if (type === 'ice_spike') {
      const iceMat = makeMat(gfx, {
        color: 0x99ebff,
        emissive: 0x2277aa,
        emissiveIntensity: 0.5,
        roughness: 0.15,
        transparent: true,
        opacity: 0.88,
      });
      const spike = new THREE.Mesh(new THREE.ConeGeometry(radius * 0.75, radius * 2.4, 6), iceMat);
      spike.position.y = radius * 1.2;
      spike.castShadow = true;
      group.add(spike);
      subParts = { spinMesh: spike };
    } else if (type === 'asteroid' || type === 'star_mine') {
      const isMine = type === 'star_mine';
      const rockMat = makeMat(gfx, {
        color: isMine ? 0x3b1f5e : 0x6b6070,
        emissive: isMine ? 0x9922ff : 0x110820,
        emissiveIntensity: isMine ? 0.65 : 0.15,
        roughness: 0.7,
        flatShading: true,
      });
      const rock = new THREE.Mesh(new THREE.DodecahedronGeometry(radius * 0.85, 0), rockMat);
      rock.position.y = radius * 0.95;
      rock.castShadow = true;
      group.add(rock);
      subParts = { spinMesh: rock };
    } else {
      // 'boulder' and general rolling sphere fallback
      const boulderMat = makeMat(gfx, {
        color: 0x8b7b6b,
        roughness: 0.88,
        flatShading: true,
      });
      const boulder = new THREE.Mesh(new THREE.IcosahedronGeometry(radius * 0.92, 1), boulderMat);
      boulder.position.y = radius * 0.92;
      boulder.castShadow = true;
      group.add(boulder);
      subParts = { boulderMesh: boulder };
    }

    lod0.add(group);
    const initParam = type === 'lava_geyser' ? 1.0 : 0.0;
    const hb = computeHazardHitbox(type, radius, basePos.y, initParam);

    hazards.push({
      id: `hazard_${i}`,
      type,
      t: wrap01(h.t),
      baseLateral,
      lateral: baseLateral,
      radius,
      hitRadius: hb.hitRadius,
      yMin: hb.yMin,
      yMax: hb.yMax,
      active: hb.active,
      height: h.height,
      moveAmp,
      moveSpeed,
      pos: basePos.clone().addScaledVector(frame.normal, radius * 0.8),
      basePos,
      tangent: frame.tangent.clone(),
      normal: frame.normal.clone(),
      binormal: frame.binormal.clone(),
      frameIdx: Math.round(wrap01(h.t) * FRAME_COUNT) % FRAME_COUNT,
      mesh: group,
      subParts,
      phase: i * 1.7,
    });
  }

  return hazards;
}

/**
 * Project a 3D point onto a piecewise-linear segment between two frames,
 * returning interpolated point, tangent, normal, binormal, and distance squared.
 */
function projectOntoFramePair(
  pos: THREE.Vector3,
  fA: { point: THREE.Vector3; tangent: THREE.Vector3; normal: THREE.Vector3 },
  fB: { point: THREE.Vector3; tangent: THREE.Vector3; normal: THREE.Vector3 },
  outPoint: THREE.Vector3,
  outTan: THREE.Vector3,
  outNorm: THREE.Vector3,
  outBin: THREE.Vector3
): { frac: number; distSq: number } {
  _seg.subVectors(fB.point, fA.point);
  const segLenSq = _seg.lengthSq();
  let frac = 0;
  if (segLenSq > 1e-6) {
    _diff.subVectors(pos, fA.point);
    frac = Math.max(0, Math.min(1, _diff.dot(_seg) / segLenSq));
  }
  outPoint.copy(fA.point).lerp(fB.point, frac);
  outTan.copy(fA.tangent).lerp(fB.tangent, frac).normalize();
  outNorm.copy(fA.normal).lerp(fB.normal, frac).normalize();
  outBin.crossVectors(outTan, outNorm).normalize();
  return { frac, distSq: pos.distanceToSquared(outPoint) };
}

/**
 * Build a complete playable TrackInstance from a TrackDefinition.
 */
export function buildTrack(trackDef: TrackDefinition, texLib: any, gfx: any): TrackInstance {
  const cps = trackDef.controlPoints;
  if (!cps || cps.length < 4) {
    throw new Error(`Track "${trackDef?.id}" must define at least 4 controlPoints.`);
  }

  const pts = cps.map((cp) => new THREE.Vector3(cp.x, cp.y, cp.z));
  const curve = new THREE.CatmullRomCurve3(pts, true, 'centripetal', 0.5);
  curve.arcLengthDivisions = 1440;
  const totalLength = curve.getLength();

  const offroadSurfaceDefault = inferDefaultOffroadSurface(trackDef);
  const offroadTexKey = inferDefaultOffroadTexture(trackDef, offroadSurfaceDefault);

  // 1. Sample N = 360 twist-free banked frames at uniform arc-length intervals
  const frames = new Array<TrackFrame>(FRAME_COUNT);
  const prevBinFlat = new THREE.Vector3(1, 0, 0);

  for (let i = 0; i < FRAME_COUNT; i++) {
    const u = i / FRAME_COUNT;
    const tCurve = curve.getUtoTmapping(u, 0);
    const point = curve.getPointAt(u);
    const tangent = curve.getTangentAt(u).normalize();

    const binFlat = new THREE.Vector3().crossVectors(tangent, WORLD_UP);
    if (binFlat.lengthSq() < 1e-6) {
      binFlat.copy(prevBinFlat);
    } else {
      binFlat.normalize();
      prevBinFlat.copy(binFlat);
    }
    const normFlat = new THREE.Vector3().crossVectors(binFlat, tangent).normalize();

    const bank = sampleClosedBank(cps, tCurve);
    const normal = normFlat.clone().applyAxisAngle(tangent, bank).normalize();
    const binormal = new THREE.Vector3().crossVectors(tangent, normal).normalize();

    const width = Math.max(10, sampleClosedScalar(cps, tCurve, 'width', 24));
    const halfWidth = width * 0.5;
    const offroadL = Math.max(0, sampleClosedScalar(cps, tCurve, 'offroadL', 10));
    const offroadR = Math.max(0, sampleClosedScalar(cps, tCurve, 'offroadR', 10));
    const nearestCP = sampleNearestCP(cps, tCurve);

    const rawSurface = nearestCP.surface ?? SURFACE_TYPES.ROAD;
    const physicsSurface = normalizePhysicsSurface(rawSurface);
    const roadTex = resolveRoadTextureKey(rawSurface, nearestCP.roadTexture || trackDef.roadTexture);
    const wallL = nearestCP.wallL !== undefined ? Boolean(nearestCP.wallL) : true;
    const wallR = nearestCP.wallR !== undefined ? Boolean(nearestCP.wallR) : true;

    frames[i] = {
      index: i,
      t: u,
      s: u * totalLength,
      point,
      tangent,
      normal,
      binormal,
      width,
      halfWidth,
      bank,
      curvature: 0,
      offroadL,
      offroadR,
      wallL,
      wallR,
      wallLatL: halfWidth + (wallL ? Math.max(1.25, offroadL) : offroadL),
      wallLatR: halfWidth + (wallR ? Math.max(1.25, offroadR) : offroadR),
      openMouthL: false,
      openMouthR: false,
      surface: physicsSurface,
      roadTexture: roadTex,
    };
  }

  // Compute signed curvature per frame for AI lookahead
  const stepLen = totalLength / FRAME_COUNT;
  const dT = new THREE.Vector3();
  for (let i = 0; i < FRAME_COUNT; i++) {
    const prev = frames[(i - 1 + FRAME_COUNT) % FRAME_COUNT];
    const next = frames[(i + 1) % FRAME_COUNT];
    dT.subVectors(next.tangent, prev.tangent);
    frames[i].curvature = dT.dot(frames[i].binormal) / (2 * stepLen);
  }

  // Automatically open guardrail mouths (wall=false & openMouth=true on ±3 frames) where shortcuts branch/rejoin
  if (trackDef.shortcuts && trackDef.shortcuts.length > 0) {
    const clearMouth = (anchorPt: THREE.Vector3, towardPt: THREE.Vector3) => {
      let bestIdx = 0;
      let bestDSq = Infinity;
      for (let i = 0; i < FRAME_COUNT; i++) {
        const dSq = frames[i].point.distanceToSquared(anchorPt);
        if (dSq < bestDSq) {
          bestDSq = dSq;
          bestIdx = i;
        }
      }
      const f = frames[bestIdx];
      const probePt = anchorPt.clone().lerp(towardPt, 0.4);
      const dirLat = _diff.subVectors(probePt, f.point).dot(f.binormal);
      const sideWallKey = dirLat < 0 ? 'wallL' : 'wallR';
      const sideOpenKey = dirLat < 0 ? 'openMouthL' : 'openMouthR';
      for (let off = -3; off <= 3; off++) {
        const mf = frames[(bestIdx + off + FRAME_COUNT) % FRAME_COUNT];
        mf[sideWallKey] = false;
        mf[sideOpenKey] = true;
      }
    };

    for (const sc of trackDef.shortcuts) {
      if (!sc.points || sc.points.length < 2) continue;
      const p0 = new THREE.Vector3(sc.points[0].x, sc.points[0].y, sc.points[0].z);
      const p1 = new THREE.Vector3(sc.points[1].x, sc.points[1].y, sc.points[1].z);
      const pPrev = new THREE.Vector3(
        sc.points[sc.points.length - 2].x,
        sc.points[sc.points.length - 2].y,
        sc.points[sc.points.length - 2].z
      );
      const pLast = new THREE.Vector3(
        sc.points[sc.points.length - 1].x,
        sc.points[sc.points.length - 1].y,
        sc.points[sc.points.length - 1].z
      );
      clearMouth(p0, p1);
      clearMouth(pLast, pPrev);
    }

    // Recompute visual-matched wallLatL / wallLatR after opening shortcut mouths
    for (let i = 0; i < FRAME_COUNT; i++) {
      const f = frames[i];
      f.wallLatL = f.wallL ? f.halfWidth + Math.max(1.25, f.offroadL) : f.halfWidth + f.offroadL;
      f.wallLatR = f.wallR ? f.halfWidth + Math.max(1.25, f.offroadR) : f.halfWidth + f.offroadR;
    }
  }

  const sampleFrame = (tInput: number): TrackFrame => {
    const t = wrap01(tInput);
    const fPos = t * FRAME_COUNT;
    const i0 = Math.floor(fPos) % FRAME_COUNT;
    const i1 = (i0 + 1) % FRAME_COUNT;
    const w = fPos - Math.floor(fPos);
    const a = frames[i0];
    const b = frames[i1];

    const point = a.point.clone().lerp(b.point, w);
    const tangent = a.tangent.clone().lerp(b.tangent, w).normalize();
    const normal = a.normal.clone().lerp(b.normal, w).normalize();
    const binormal = new THREE.Vector3().crossVectors(tangent, normal).normalize();
    const halfWidth = a.halfWidth + (b.halfWidth - a.halfWidth) * w;
    const offroadL = a.offroadL + (b.offroadL - a.offroadL) * w;
    const offroadR = a.offroadR + (b.offroadR - a.offroadR) * w;
    const wallL = w < 0.5 ? a.wallL : b.wallL;
    const wallR = w < 0.5 ? a.wallR : b.wallR;

    return {
      index: w < 0.5 ? a.index : b.index,
      t,
      s: t * totalLength,
      point,
      tangent,
      normal,
      binormal,
      width: halfWidth * 2,
      halfWidth,
      bank: a.bank + (b.bank - a.bank) * w,
      curvature: a.curvature + (b.curvature - a.curvature) * w,
      offroadL,
      offroadR,
      wallL,
      wallR,
      wallLatL: wallL ? halfWidth + Math.max(1.25, offroadL) : halfWidth + offroadL,
      wallLatR: wallR ? halfWidth + Math.max(1.25, offroadR) : halfWidth + offroadR,
      openMouthL: w < 0.5 ? a.openMouthL : b.openMouthL,
      openMouthR: w < 0.5 ? a.openMouthR : b.openMouthR,
      surface: w < 0.5 ? a.surface : b.surface,
      roadTexture: w < 0.5 ? a.roadTexture : b.roadTexture,
    };
  };

  // 2. Scene graph & 4 LOD groups
  const rootGroup = new THREE.Group();
  rootGroup.name = `track_${trackDef.id}`;
  const lodGroups = [0, 1, 2, 3].map((lvl) => {
    const g = new THREE.Group();
    g.name = `lod_${lvl}`;
    rootGroup.add(g);
    return g;
  });
  const [lod0, , lod2] = lodGroups;

  const primaryRoadTex = frames[0].roadTexture || 'asphalt';
  const curbTexKey = inferDefaultCurbTexture(trackDef, primaryRoadTex);

  // 3. Build core road ribbon, curbs, off-road aprons, underside deck, guardrails, gantry
  buildRoadBuckets(frames, totalLength, true, trackDef, texLib, gfx, lod0);
  buildCurbs(frames, totalLength, curbTexKey, texLib, gfx, lod0);
  buildOffroadAprons(frames, totalLength, offroadTexKey, texLib, gfx, lod0);
  buildUndersideDeck(frames, totalLength, trackDef.deckColor, gfx, lod0);
  buildGuardrails(frames, totalLength, trackDef, gfx, lod0, lod2);
  const startGridSlots = buildStartFinishGantry(frames, sampleFrame, trackDef, texLib, gfx, lod0);

  // 4. Build shortcuts (+ optional shortcut boost pads & ramps)
  const { shortcuts, extraBoostPads, extraRamps } = buildShortcuts(
    trackDef,
    frames,
    sampleFrame,
    offroadSurfaceDefault,
    texLib,
    gfx,
    lod0
  );

  // 5. Build boost pads, ramps, item boxes, coins, hazards
  const boostPads: TrackBoostPad[] = [...extraBoostPads];
  (trackDef.boostPads || []).forEach((bp, idx) => {
    const f = sampleFrame(bp.t);
    const w = bp.width ?? 4.6;
    const l = bp.length ?? 8.5;
    const lat = bp.lateral ?? 0;
    const { group, pos } = createBoostPadMesh(f, lat, w, l, texLib, gfx);
    lod0.add(group);
    boostPads.push({
      id: `boost_${idx}`,
      t: wrap01(bp.t),
      s: wrap01(bp.t) * totalLength,
      lateral: lat,
      width: w,
      length: l,
      pos,
      tangent: f.tangent.clone(),
      normal: f.normal.clone(),
      binormal: f.binormal.clone(),
      frameIdx: Math.round(wrap01(bp.t) * FRAME_COUNT) % FRAME_COUNT,
      onShortcut: false,
      mesh: group,
    });
  });

  const ramps: TrackRamp[] = [...extraRamps];
  (trackDef.ramps || []).forEach((r, idx) => {
    const f = sampleFrame(r.t);
    const w = r.width ?? 7.2;
    const l = r.length ?? 11.0;
    const h = r.height ?? (r.isGlider ? 3.5 : 2.6);
    const lat = r.lateral ?? 0;
    const isGlider = Boolean(r.isGlider);
    const { group, pos, entryPos, launchPos } = createRampMesh(f, lat, w, l, h, isGlider, texLib, gfx);
    lod0.add(group);
    ramps.push({
      id: `ramp_${idx}`,
      t: wrap01(r.t),
      s: wrap01(r.t) * totalLength,
      lateral: lat,
      width: w,
      length: l,
      height: h,
      isGlider,
      pos,
      entryPos,
      launchPos,
      tangent: f.tangent.clone(),
      normal: f.normal.clone(),
      binormal: f.binormal.clone(),
      frameIdx: Math.round(wrap01(r.t) * FRAME_COUNT) % FRAME_COUNT,
      onShortcut: false,
      mesh: group,
    });
  });

  const itemBoxes = buildItemBoxes(trackDef, sampleFrame, gfx, lod0);
  const coins = buildCoins(trackDef, sampleFrame, gfx, lod0);
  const hazards = buildHazards(trackDef, sampleFrame, gfx, lod0);

  // 6. Track spatial query (local ±28 frame search around hintIdx + 360 fallback + shortcut projection)
  const queryTrack = (pos: THREE.Vector3, hintIdx?: number): TrackQueryResult => {
    let bestIdx = 0;
    let bestDistSq = Infinity;

    const hasHint = typeof hintIdx === 'number' && Number.isFinite(hintIdx);
    if (hasHint) {
      const base = ((Math.round(hintIdx!) % FRAME_COUNT) + FRAME_COUNT) % FRAME_COUNT;
      for (let off = -LOCAL_SEARCH_WINDOW; off <= LOCAL_SEARCH_WINDOW; off++) {
        const idx = (base + off + FRAME_COUNT) % FRAME_COUNT;
        const dSq = pos.distanceToSquared(frames[idx].point);
        if (dSq < bestDistSq) {
          bestDistSq = dSq;
          bestIdx = idx;
        }
      }
    }

    // Full 360-frame fallback if hint missing or distance > 45 units
    if (!hasHint || bestDistSq > FALLBACK_DIST_SQ) {
      bestDistSq = Infinity;
      for (let idx = 0; idx < FRAME_COUNT; idx++) {
        const dSq = pos.distanceToSquared(frames[idx].point);
        if (dSq < bestDistSq) {
          bestDistSq = dSq;
          bestIdx = idx;
        }
      }
    }

    // Continuous sub-frame interpolation between bestIdx-1..bestIdx and bestIdx..bestIdx+1
    const prevIdx = (bestIdx - 1 + FRAME_COUNT) % FRAME_COUNT;
    const nextIdx = (bestIdx + 1) % FRAME_COUNT;
    const fCenter = frames[bestIdx];
    const fPrev = frames[prevIdx];
    const fNext = frames[nextIdx];

    const projA = projectOntoFramePair(pos, fPrev, fCenter, _pA, _projTangent, _projNormal, _projBinormal);
    let chosenFrac = projA.frac;

    const pBPoint = _pB;
    const pBTan = new THREE.Vector3();
    const pBNorm = new THREE.Vector3();
    const pBBin = new THREE.Vector3();
    const projB = projectOntoFramePair(pos, fCenter, fNext, pBPoint, pBTan, pBNorm, pBBin);

    let f0 = fPrev;
    let f1 = fCenter;
    if (projB.distSq < projA.distSq) {
      chosenFrac = projB.frac;
      _projPoint.copy(pBPoint);
      _projTangent.copy(pBTan);
      _projNormal.copy(pBNorm);
      _projBinormal.copy(pBBin);
      f0 = fCenter;
      f1 = fNext;
    } else {
      _projPoint.copy(_pA);
    }

    const tBase = f0.index / FRAME_COUNT;
    const tMain = wrap01(tBase + chosenFrac / FRAME_COUNT);
    const sMain = tMain * totalLength;

    _diff.subVectors(pos, _projPoint);
    const mainLateral = _diff.dot(_projBinormal);
    const mainElev = _diff.dot(_projNormal);
    const mainHalfWidth = f0.halfWidth + (f1.halfWidth - f0.halfWidth) * chosenFrac;
    const mainOffL = f0.offroadL + (f1.offroadL - f0.offroadL) * chosenFrac;
    const mainOffR = f0.offroadR + (f1.offroadR - f0.offroadR) * chosenFrac;
    const mainRef = chosenFrac < 0.5 ? f0 : f1;
    const mainWallLatL = mainRef.wallL ? mainHalfWidth + Math.max(1.25, mainOffL) : mainHalfWidth + mainOffL;
    const mainWallLatR = mainRef.wallR ? mainHalfWidth + Math.max(1.25, mainOffR) : mainHalfWidth + mainOffR;

    let mainSurface: SurfaceType | string = mainRef.surface;
    let isOverVoid = mainSurface === SURFACE_TYPES.VOID && mainElev < 1.5;

    if (mainSurface !== SURFACE_TYPES.VOID) {
      if (mainLateral < -(mainHalfWidth + mainOffL)) {
        if (!mainRef.wallL && mainElev < 1.5) {
          isOverVoid = true;
          mainSurface = SURFACE_TYPES.VOID;
        } else {
          mainSurface = mainOffL > 0 ? offroadSurfaceDefault : mainRef.surface;
        }
      } else if (mainLateral > mainHalfWidth + mainOffR) {
        if (!mainRef.wallR && mainElev < 1.5) {
          isOverVoid = true;
          mainSurface = SURFACE_TYPES.VOID;
        } else {
          mainSurface = mainOffR > 0 ? offroadSurfaceDefault : mainRef.surface;
        }
      } else if (mainLateral < -mainHalfWidth || mainLateral > mainHalfWidth) {
        mainSurface = offroadSurfaceDefault;
      }
    }

    const mainDistSq = _diff.lengthSq();

    // Check shortcuts: smooth transition at mouths without vertical snap/clipping
    let bestShortcutResult: TrackQueryResult | null = null;
    let bestScScore = Infinity;

    for (let sIdx = 0; sIdx < shortcuts.length; sIdx++) {
      const sc = shortcuts[sIdx];
      const scFrames = sc.frames;
      if (scFrames.length < 2) continue;

      let scBestIdx = 0;
      let scBestVertSq = Infinity;
      for (let k = 0; k < scFrames.length; k++) {
        const dSq = pos.distanceToSquared(scFrames[k].point);
        if (dSq < scBestVertSq) {
          scBestVertSq = dSq;
          scBestIdx = k;
        }
      }

      // Quick coarse reject
      if (scBestVertSq > 900) continue;

      const kA = Math.max(0, scBestIdx - 1);
      const kB = Math.min(scFrames.length - 1, scBestIdx + 1);
      const pair1 =
        kA < scBestIdx
          ? projectOntoFramePair(pos, scFrames[kA], scFrames[scBestIdx], _scPoint, _scTangent, _scNormal, _scBinormal)
          : null;

      const p2 = new THREE.Vector3();
      const t2 = new THREE.Vector3();
      const n2 = new THREE.Vector3();
      const b2 = new THREE.Vector3();
      const pair2 =
        scBestIdx < kB ? projectOntoFramePair(pos, scFrames[scBestIdx], scFrames[kB], p2, t2, n2, b2) : null;

      let sf0 = scFrames[scBestIdx];
      let sf1 = scFrames[scBestIdx];
      let sFrac = 0;
      if (pair1 && (!pair2 || pair1.distSq <= pair2.distSq)) {
        sf0 = scFrames[kA];
        sf1 = scFrames[scBestIdx];
        sFrac = pair1.frac;
      } else if (pair2) {
        _scPoint.copy(p2);
        _scTangent.copy(t2);
        _scNormal.copy(n2);
        _scBinormal.copy(b2);
        sf0 = scFrames[scBestIdx];
        sf1 = scFrames[kB];
        sFrac = pair2.frac;
      }

      _diff.subVectors(pos, _scPoint);
      const scLat = _diff.dot(_scBinormal);
      const scElev = _diff.dot(_scNormal);
      const scHalfWidth = sf0.halfWidth + (sf1.halfWidth - sf0.halfWidth) * sFrac;

      // Require tight downward bound (-1.35u) so elevated shortcuts never snap karts up from underneath
      if (Math.abs(scLat) <= scHalfWidth + 1.5 && scElev >= -1.35 && scElev <= 16.0) {
        const scDistSq = _diff.lengthSq();
        const isElevatedDeckAboveMain = _scPoint.y > _projPoint.y + 2.5 && pos.y > _projPoint.y + 2.0;
        const leftMainRibbon = Math.abs(mainLateral) > mainHalfWidth * 0.82;
        const closerToShortcut = scDistSq < mainDistSq;
        const nearMouthEdge =
          (mainRef.openMouthL || mainRef.openMouthR) &&
          Math.abs(scLat) <= scHalfWidth * 0.9 &&
          scDistSq < mainDistSq * 1.15;

        if ((isElevatedDeckAboveMain || leftMainRibbon || closerToShortcut || nearMouthEdge) && scDistSq < bestScScore) {
          bestScScore = scDistSq;
          const scSurf = sFrac < 0.5 ? sf0.surface : sf1.surface;
          const scOff = 1.5;
          const scWallLatL = sc.wallL ? scHalfWidth + Math.max(1.25, scOff) : scHalfWidth + scOff;
          const scWallLatR = sc.wallR ? scHalfWidth + Math.max(1.25, scOff) : scHalfWidth + scOff;
          bestShortcutResult = {
            frameIdx: bestIdx,
            t: tMain,
            s: sMain,
            point: _scPoint.clone(),
            tangent: _scTangent.clone(),
            normal: _scNormal.clone(),
            binormal: _scBinormal.clone(),
            lateral: scLat,
            elevationDiff: scElev,
            halfWidth: scHalfWidth,
            offroadL: scOff,
            offroadR: scOff,
            wallL: sc.wallL,
            wallR: sc.wallR,
            wallLatL: scWallLatL,
            wallLatR: scWallLatR,
            surface: scSurf,
            onShortcut: true,
            shortcutData: sc,
            isOverVoid: scSurf === SURFACE_TYPES.VOID && scElev < 1.5,
          };
        }
      }
    }

    if (bestShortcutResult) {
      return bestShortcutResult;
    }

    return {
      frameIdx: bestIdx,
      t: tMain,
      s: sMain,
      point: _projPoint.clone(),
      tangent: _projTangent.clone(),
      normal: _projNormal.clone(),
      binormal: _projBinormal.clone(),
      lateral: mainLateral,
      elevationDiff: mainElev,
      halfWidth: mainHalfWidth,
      offroadL: mainOffL,
      offroadR: mainOffR,
      wallL: mainRef.wallL,
      wallR: mainRef.wallR,
      wallLatL: mainWallLatL,
      wallLatR: mainWallLatR,
      surface: mainSurface,
      onShortcut: false,
      shortcutData: null,
      isOverVoid,
    };
  };

  // Assemble TrackInstance object prior to calling buildScenery so landmarks can query frames/shortcuts
  let sceneryUpdateFn: ((dt: number, time: number) => void) | null = null;

  const trackInstance: TrackInstance = {
    def: trackDef,
    rootGroup,
    lodGroups,
    curve,
    frames,
    totalLength,
    startGridSlots,
    sampleFrame,
    queryTrack,
    getSurfaceInfo: queryTrack,
    itemBoxes,
    coins,
    boostPads,
    ramps,
    hazards,
    shortcuts,
    update(dt: number, time: number) {
      // Animate & respawn item boxes
      for (let i = 0; i < itemBoxes.length; i++) {
        const box = itemBoxes[i];
        if (!box.active) {
          box.respawnTimer -= dt;
          if (box.respawnTimer <= 0) {
            box.active = true;
            box.respawnTimer = 0;
          }
        }
        box.mesh.visible = box.active;
        if (box.active) {
          const bob = Math.sin(time * 2.8 + box.phase) * 0.25;
          box.mesh.position.copy(box.basePos).addScaledVector(box.normal, bob);
          box.cubeMesh.rotation.y += dt * 1.45;
          box.cubeMesh.rotation.x = 0.45 + Math.sin(time * 1.7 + box.phase) * 0.2;
          box.innerMesh.rotation.y -= dt * 2.2;
        }
      }

      // Animate & respawn coins
      for (let i = 0; i < coins.length; i++) {
        const coin = coins[i];
        if (!coin.active) {
          coin.respawnTimer -= dt;
          if (coin.respawnTimer <= 0) {
            coin.active = true;
            coin.respawnTimer = 0;
          }
        }
        coin.mesh.visible = coin.active;
        if (coin.active) {
          coin.mesh.rotation.y += dt * 3.1;
          const bob = Math.sin(time * 3.5 + coin.phase) * 0.14;
          coin.mesh.position.copy(coin.basePos).addScaledVector(coin.normal, bob);
        }
      }

      // Animate moving & erupting hazards + sync live hitboxes
      for (let i = 0; i < hazards.length; i++) {
        const h = hazards[i];
        const latOffset = h.moveAmp ? Math.sin(time * h.moveSpeed + h.phase) * h.moveAmp : 0;
        h.lateral = h.baseLateral + latOffset;
        h.mesh.position.copy(h.basePos).addScaledVector(h.binormal, latOffset);
        h.pos.copy(h.mesh.position).addScaledVector(h.normal, h.radius * 0.8);

        let hbParam = 0;
        if (h.subParts.boulderMesh) {
          const rollRate = h.moveAmp ? Math.cos(time * h.moveSpeed + h.phase) * h.moveAmp * h.moveSpeed : 1.5;
          h.subParts.boulderMesh.rotation.z -= rollRate * dt * 0.7;
          h.subParts.boulderMesh.rotation.x += dt * 1.2;
        } else if (h.subParts.thwompHead) {
          const cycle = (Math.sin(time * 2.4 + h.phase) + 1) * 0.5;
          const slam = Math.pow(cycle, 3);
          const lift = slam * 4.2;
          h.subParts.thwompHead.position.y = h.subParts.baseY + lift;
          h.pos.copy(h.mesh.position).addScaledVector(h.normal, h.subParts.baseY + lift);
          hbParam = lift;
        } else if (h.subParts.eruptGroup) {
          const pulse = Math.max(0.18, 0.55 + 0.55 * Math.sin(time * 2.8 + h.phase));
          h.subParts.eruptGroup.scale.set(1, pulse, 1);
          h.pos.copy(h.mesh.position).addScaledVector(h.normal, h.radius * 1.4 * pulse);
          hbParam = pulse;
        } else if (h.subParts.rotor) {
          h.subParts.rotor.rotation.z += dt * 5.0;
          const hover = Math.sin(time * 3.2 + h.phase) * 0.4;
          h.mesh.position.addScaledVector(h.normal, hover);
          h.pos.copy(h.mesh.position).addScaledVector(h.normal, h.radius * 0.95);
        } else if (h.subParts.spinMesh) {
          h.subParts.spinMesh.rotation.y += dt * 1.8;
          h.subParts.spinMesh.rotation.x += dt * 0.6;
        }

        const hb = computeHazardHitbox(h.type, h.radius, h.mesh.position.y, hbParam);
        h.hitRadius = hb.hitRadius;
        h.yMin = hb.yMin;
        h.yMax = hb.yMax;
        h.active = hb.active;
      }

      if (sceneryUpdateFn) {
        sceneryUpdateFn(dt, time);
      }
    },
    dispose() {
      const disposedGeos = new Set<THREE.BufferGeometry>();
      const disposedMats = new Set<THREE.Material>();
      rootGroup.traverse((obj: any) => {
        if (obj.geometry && !disposedGeos.has(obj.geometry)) {
          obj.geometry.dispose();
          disposedGeos.add(obj.geometry);
        }
        if (obj.material) {
          const mats = Array.isArray(obj.material) ? obj.material : [obj.material];
          for (const m of mats) {
            if (m && !disposedMats.has(m)) {
              m.dispose();
              disposedMats.add(m);
            }
          }
        }
      });
      rootGroup.clear();
    },
  };

  // 7. Build track-specific themed scenery into lodGroups[0..3]
  if (typeof trackDef.buildScenery === 'function') {
    const cb = trackDef.buildScenery(lodGroups, trackInstance, texLib, gfx);
    if (typeof cb === 'function') {
      sceneryUpdateFn = cb;
    }
  }

  return trackInstance;
}
