import * as THREE from 'three';
import { CUP_IDS, SURFACE_TYPES, type TrackDefinition, type TrackInstance } from '../core/contracts';
import { orientToFrame } from './trackBuilder';

/**
 * Resolve texture from TextureLibrary cleanly.
 */
function getTex(texLib: any, name: string): THREE.Texture | null {
  if (!texLib || !name) return null;
  if (typeof texLib.get === 'function') return texLib.get(name) || null;
  if (texLib.textures && texLib.textures[name]) return texLib.textures[name];
  return texLib[name] || null;
}

/**
 * Create graphics-preset-aware material via GraphicsEngine with fallback.
 */
function makeMat(gfx: any, def: Record<string, any>): THREE.Material {
  if (gfx && typeof gfx.createMaterial === 'function') {
    return gfx.createMaterial(def);
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
  });
}

/**
 * Check horizontal (XZ) distance from all main track frames AND every shortcut ribbon
 * so placed landmarks never encroach into any drivable surface.
 */
function isClearOfTrack(x: number, z: number, trackInstance: TrackInstance, minClearance = 32): boolean {
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
 * Place a landmark alongside a specific normalized track t and signed lateral offset.
 */
function placeAlongTrack(trackInstance: TrackInstance, t: number, lateralOffset: number, yOffset = 0) {
  const f = trackInstance.sampleFrame(t);
  const pos = f.point.clone().addScaledVector(f.binormal, lateralOffset);
  pos.y += yOffset;
  return { pos, frame: f };
}

/**
 * Build a stylized stone arch spanning the road at normalized t using right-handed orientToFrame.
 */
function createTrackArch(
  trackInstance: TrackInstance,
  t: number,
  archMat: THREE.Material,
  accentMat: THREE.Material,
  height = 13,
  thickness = 2.4
): THREE.Group {
  const f = trackInstance.sampleFrame(t);
  const group = new THREE.Group();
  orientToFrame(group, f);

  const span = f.halfWidth + 2.6;
  for (const s of [-1, 1]) {
    const col = new THREE.Mesh(new THREE.BoxGeometry(thickness, height, thickness * 1.15), archMat);
    col.position.set(s * span, height * 0.5, 0);
    col.castShadow = true;
    col.receiveShadow = true;
    group.add(col);

    const cap = new THREE.Mesh(new THREE.ConeGeometry(thickness * 0.85, 2.5, 4), accentMat);
    cap.rotation.y = Math.PI / 4;
    cap.position.set(s * span, height + 1.25, 0);
    group.add(cap);
  }
  const lintel = new THREE.Mesh(new THREE.BoxGeometry(span * 2 + thickness, thickness, thickness * 1.2), archMat);
  lintel.position.set(0, height - thickness * 0.35, 0);
  lintel.castShadow = true;
  group.add(lintel);

  return group;
}

/**
 * Deterministic pseudo-random helper for reproducible procedural scenery placement.
 */
function seededRand(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

/* ============================================================================
 * 1. SUNBURST CIRCUIT (Mushroom Meadows)
 * ========================================================================== */
const sunburstCircuit: TrackDefinition = {
  id: 'sunburst_circuit',
  cupId: CUP_IDS.MUSHROOM,
  name: 'Sunburst Circuit',
  subtitle: 'Mushroom Meadows & Stone River Bridge',
  themeColor: '#34c759',
  roadTexture: 'asphalt',
  curbTexture: 'curb_red_white',
  offroadTexture: 'grass',
  offroadSurface: SURFACE_TYPES.OFFROAD_GRASS,
  floorY: -4.5,
  railColor: 0x0a84ff,
  deckColor: 0x62707a,
  skyColors: {
    top: 0x1b6ef3,
    horizon: 0x8be0ff,
    bottom: 0x5cc464,
    sunColor: 0xfff2b2,
    sunPos: [220, 280, -180],
    fogColor: 0xa6e3ff,
    fogNear: 300,
    fogFar: 1380,
  },
  ambientIntensity: 0.72,
  dirLightColor: 0xfff7e2,
  dirLightIntensity: 1.35,
  bgmStyle: {
    tempo: 136,
    scale: [60, 62, 64, 67, 69, 72, 74, 76],
    bassPattern: [0, 0, 3, 4, 2, 2, 3, 4],
  },
  laps: 3,
  controlPoints: [
    { x: 0, y: 0, z: 65, width: 28, bank: 0, surface: SURFACE_TYPES.ROAD, offroadL: 11, offroadR: 11, wallL: true, wallR: true },
    { x: 0, y: 2, z: -40, width: 28, bank: 0.04, surface: SURFACE_TYPES.ROAD, offroadL: 12, offroadR: 12, wallL: true, wallR: true },
    { x: 45, y: 10, z: -145, width: 26, bank: 0.14, surface: SURFACE_TYPES.ROAD, offroadL: 14, offroadR: 11, wallL: true, wallR: true },
    { x: 162, y: 16, z: -178, width: 26, bank: 0.16, surface: SURFACE_TYPES.ROAD, offroadL: 13, offroadR: 13, wallL: true, wallR: true },
    { x: 256, y: 8, z: -118, width: 25, bank: 0.18, surface: SURFACE_TYPES.ROAD, offroadL: 12, offroadR: 10, wallL: true, wallR: true },
    { x: 235, y: 2, z: -14, width: 25, bank: 0.14, surface: SURFACE_TYPES.ROAD, offroadL: 12, offroadR: 12, wallL: true, wallR: true },
    { x: 128, y: 0, z: 10, width: 25, bank: -0.04, surface: SURFACE_TYPES.ROAD, offroadL: 12, offroadR: 12, wallL: true, wallR: true },
    { x: 115, y: 2, z: 95, width: 25, bank: -0.12, surface: SURFACE_TYPES.ROAD, offroadL: 12, offroadR: 12, wallL: true, wallR: true },
    { x: 198, y: 5, z: 170, width: 25, bank: 0.14, surface: SURFACE_TYPES.ROAD, offroadL: 13, offroadR: 11, wallL: true, wallR: true },
    { x: 145, y: 7, z: 255, width: 23, bank: 0.05, surface: SURFACE_TYPES.COBBLE, offroadL: 6, offroadR: 6, wallL: true, wallR: true },
    { x: 36, y: 13, z: 282, width: 21, bank: 0, surface: SURFACE_TYPES.COBBLE, offroadL: 0, offroadR: 0, wallL: true, wallR: true },
    { x: -75, y: 7, z: 264, width: 23, bank: -0.04, surface: SURFACE_TYPES.COBBLE, offroadL: 6, offroadR: 6, wallL: true, wallR: true },
    { x: -176, y: 2, z: 250, width: 25, bank: -0.12, surface: SURFACE_TYPES.ROAD, offroadL: 12, offroadR: 12, wallL: true, wallR: true },
    { x: -226, y: 2, z: 178, width: 25, bank: 0.10, surface: SURFACE_TYPES.ROAD, offroadL: 12, offroadR: 14, wallL: true, wallR: true },
    { x: -156, y: 4, z: 118, width: 24, bank: -0.11, surface: SURFACE_TYPES.ROAD, offroadL: 10, offroadR: 14, wallL: true, wallR: true },
    { x: -88, y: 2, z: 170, width: 25, bank: 0.08, surface: SURFACE_TYPES.ROAD, offroadL: 12, offroadR: 12, wallL: true, wallR: true },
    { x: -8, y: 0, z: 155, width: 28, bank: 0, surface: SURFACE_TYPES.ROAD, offroadL: 11, offroadR: 11, wallL: true, wallR: true },
  ],
  shortcuts: [
    {
      name: 'Brook Jump-Ramp Cut',
      type: 'ramp',
      entryT: 0.20,
      exitT: 0.36,
      boostAtEntry: true,
      isGlider: false,
      requiresBoost: false,
      rampU: 0.35,
      rampHeight: 3.0,
      points: [
        { x: 168, y: 16.0, z: -169, width: 13, surface: SURFACE_TYPES.OFFROAD_GRASS },
        { x: 176, y: 14.2, z: -112, width: 12, surface: SURFACE_TYPES.WOOD },
        { x: 178, y: 6.2, z: -56, width: 12, surface: SURFACE_TYPES.WOOD },
        { x: 171, y: 0.55, z: -7, width: 13, surface: SURFACE_TYPES.OFFROAD_GRASS },
      ],
    },
    {
      name: 'Meadow Chicane Dirt Cut',
      type: 'offroad',
      entryT: 0.80,
      exitT: 0.89,
      boostAtEntry: false,
      isGlider: false,
      requiresBoost: true,
      points: [
        { x: -218, y: 2.35, z: 174, width: 13, surface: SURFACE_TYPES.OFFROAD_SAND },
        { x: -182, y: 3.0, z: 170, width: 12, surface: SURFACE_TYPES.OFFROAD_SAND },
        { x: -144, y: 3.2, z: 168, width: 12, surface: SURFACE_TYPES.OFFROAD_SAND },
        { x: -108, y: 2.75, z: 165, width: 13, surface: SURFACE_TYPES.OFFROAD_GRASS },
      ],
    },
  ],
  boostPads: [
    { t: 0.06, lateral: -5.5, width: 4.6, length: 8.5 },
    { t: 0.44, lateral: 5.0, width: 4.6, length: 8.5 },
    { t: 0.62, lateral: 0, width: 5.0, length: 9.0 },
    { t: 0.94, lateral: 4.5, width: 4.6, length: 8.5 },
  ],
  ramps: [
    { t: 0.52, lateral: -4.0, width: 7.2, length: 10.5, height: 2.7, isGlider: false },
    { t: 0.71, lateral: 0, width: 7.6, length: 11.0, height: 2.5, isGlider: false },
  ],
  itemBoxRows: [
    { t: 0.11, count: 4, spread: 14 },
    { t: 0.40, count: 4, spread: 14 },
    { t: 0.67, count: 4, spread: 13 },
    { t: 0.91, count: 4, spread: 14 },
  ],
  coinLines: [
    { tStart: 0.03, tEnd: 0.07, lateral: 6.5, count: 4 },
    { tStart: 0.25, tEnd: 0.31, lateral: -6.0, count: 5 },
    { tStart: 0.56, tEnd: 0.60, lateral: 0, count: 4 },
    { tStart: 0.74, tEnd: 0.78, lateral: 5.5, count: 4 },
  ],
  hazards: [
    { type: 'boulder', t: 0.48, lateral: 0, radius: 2.1, moveAmp: 6.0, moveSpeed: 1.7 },
    { type: 'boulder', t: 0.85, lateral: 2.0, radius: 2.0, moveAmp: 5.2, moveSpeed: 1.9 },
  ],
  buildScenery(sceneGroups, trackInstance, texLib, gfx) {
    const [lod0, lod1, lod2, lod3] = sceneGroups;
    const rand = seededRand(101);
    const windmills: Array<{ hub: THREE.Group; speed: number }> = [];

    // Ground meadow floor (lod0)
    const grassTex = getTex(texLib, 'grass');
    const meadowGeo = new THREE.PlaneGeometry(1600, 1600);
    meadowGeo.rotateX(-Math.PI / 2);
    const meadowMat = makeMat(gfx, {
      color: grassTex ? 0x99d98c : 0x52b758,
      map: grassTex,
      roughness: 0.95,
    });
    const meadow = new THREE.Mesh(meadowGeo, meadowMat);
    meadow.position.set(20, -4.5, 60);
    meadow.receiveShadow = true;
    lod0.add(meadow);

    // Sparkling blue river beneath the Stone River Bridge (lod0)
    const riverGeo = new THREE.PlaneGeometry(180, 1400);
    riverGeo.rotateX(-Math.PI / 2);
    const riverMat = makeMat(gfx, {
      color: 0x2299ee,
      emissive: 0x0a4488,
      emissiveIntensity: 0.25,
      roughness: 0.18,
      metalness: 0.3,
    });
    const river = new THREE.Mesh(riverGeo, riverMat);
    river.position.set(36, -3.2, 60);
    lod0.add(river);

    // Sparkling brook beneath the Brook Jump-Ramp shortcut (lod0)
    const brookGeo = new THREE.PlaneGeometry(24, 95);
    brookGeo.rotateX(-Math.PI / 2);
    const brook = new THREE.Mesh(brookGeo, riverMat);
    brook.rotation.y = Math.PI * 0.45;
    brook.position.set(177, -1.8, -84);
    lod0.add(brook);

    // Stone River Bridge side arches & bridge piers (lod0)
    const stoneMat = makeMat(gfx, {
      color: 0xb8b2a6,
      map: getTex(texLib, 'cobble'),
      roughness: 0.85,
    });
    const roofBlueMat = makeMat(gfx, { color: 0x246eb9, roughness: 0.55 });
    const woodMat = makeMat(gfx, { color: 0x7f4f24, map: getTex(texLib, 'wood_pier'), roughness: 0.85 });

    for (const tBridge of [0.58, 0.61, 0.64]) {
      const fB = trackInstance.sampleFrame(tBridge);
      for (const s of [-1, 1]) {
        const pier = new THREE.Mesh(new THREE.BoxGeometry(3.5, 16, 4.5), stoneMat);
        const pPos = fB.point.clone().addScaledVector(fB.binormal, s * (fB.halfWidth + 2.2));
        pier.position.set(pPos.x, fB.point.y - 8, pPos.z);
        pier.castShadow = true;
        lod0.add(pier);
      }
    }
    lod0.add(createTrackArch(trackInstance, 0.56, stoneMat, roofBlueMat, 12.5, 2.2));

    // Coastal hills around perimeter (lod1)
    const hillMat = makeMat(gfx, { color: 0x43a047, roughness: 0.9, flatShading: true });
    const hillCoords = [
      [380, -240, 85, 52],
      [-340, -180, 95, 64],
      [-370, 290, 90, 48],
      [330, 340, 105, 58],
      [40, -340, 80, 44],
      [390, 60, 75, 42],
    ];
    for (const [hx, hz, hr, hh] of hillCoords) {
      const hill = new THREE.Mesh(new THREE.ConeGeometry(hr, hh, 9), hillMat);
      hill.position.set(hx, hh * 0.42 - 4.5, hz);
      hill.castShadow = true;
      hill.receiveShadow = true;
      lod1.add(hill);
    }

    // Grandstands near start/finish straight (lod1): right-handed orientToFrame (+X = left = -binormal, so -X = toward track)
    const standFrame = trackInstance.sampleFrame(0.015);
    const standPos = standFrame.point.clone().addScaledVector(standFrame.binormal, -(standFrame.halfWidth + 24));
    const standGroup = new THREE.Group();
    orientToFrame(standGroup, standFrame, standPos);
    const standBase = new THREE.Mesh(new THREE.BoxGeometry(14, 10, 58), stoneMat);
    standBase.position.set(0, 5, 0);
    standBase.castShadow = true;
    const standCanopy = new THREE.Mesh(new THREE.BoxGeometry(16, 1.4, 62), roofBlueMat);
    standCanopy.position.set(-2, 13.5, 0);
    standGroup.add(standBase, standCanopy);
    lod1.add(standGroup);

    // Spinning Windmills (lod1/lod2)
    const sailMat = makeMat(gfx, { color: 0xfff8e7, roughness: 0.5 });
    const towerMat = makeMat(gfx, { color: 0xf4efe6, roughness: 0.75 });
    const redRoofMat = makeMat(gfx, { color: 0xe63946, roughness: 0.55 });
    for (const [wt, wLat] of [
      [0.46, 36],
      [0.51, -38],
      [0.89, 34],
    ] as const) {
      const { pos, frame } = placeAlongTrack(trackInstance, wt, wLat, -4);
      const wm = new THREE.Group();
      wm.position.copy(pos);
      wm.lookAt(frame.point.x, pos.y, frame.point.z);
      const body = new THREE.Mesh(new THREE.CylinderGeometry(3.2, 5.0, 22, 10), towerMat);
      body.position.y = 11;
      body.castShadow = true;
      const dome = new THREE.Mesh(new THREE.ConeGeometry(4.0, 6.0, 10), redRoofMat);
      dome.position.y = 24.5;
      const hub = new THREE.Group();
      hub.position.set(0, 19, 3.6);
      for (let b = 0; b < 4; b++) {
        const blade = new THREE.Mesh(new THREE.BoxGeometry(1.5, 11, 0.35), sailMat);
        blade.position.set(0, 5.5, 0);
        const pivot = new THREE.Group();
        pivot.rotation.z = (b * Math.PI) / 2;
        pivot.add(blade);
        hub.add(pivot);
      }
      wm.add(body, dome, hub);
      lod1.add(wm);
      windmills.push({ hub, speed: 1.1 + rand() * 0.5 });
    }

    // Lush trees (lod2) + Mushroom meadow toadstools & flowers (lod3)
    const leafMat1 = makeMat(gfx, { color: 0x2d9342, roughness: 0.85 });
    const leafMat2 = makeMat(gfx, { color: 0x52b788, roughness: 0.85 });
    for (let i = 0; i < 65; i++) {
      const rx = (rand() - 0.5) * 740;
      const rz = (rand() - 0.5) * 740;
      if (!isClearOfTrack(rx, rz, trackInstance, 38)) continue;
      const tree = new THREE.Group();
      tree.position.set(rx, -4.5, rz);
      const s = 0.85 + rand() * 0.7;
      const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.8 * s, 1.1 * s, 6 * s, 6), woodMat);
      trunk.position.y = 3 * s;
      const crown = new THREE.Mesh(new THREE.DodecahedronGeometry(3.8 * s, 0), i % 2 === 0 ? leafMat1 : leafMat2);
      crown.position.y = 7.8 * s;
      crown.castShadow = true;
      tree.add(trunk, crown);
      lod2.add(tree);
    }

    // Giant Mushroom meadow landmarks & roadside flower clusters (lod3)
    const stemMat = makeMat(gfx, { color: 0xfff3d6, roughness: 0.75 });
    const flowerPalette = [0xff4d6d, 0xffbe0b, 0x38b6ff, 0xffffff];
    for (let i = 0; i < 45; i++) {
      const t = (i + 0.3) / 45;
      const side = i % 2 === 0 ? 1 : -1;
      const f = trackInstance.sampleFrame(t);
      const dist = f.halfWidth + Math.max(f.offroadL, f.offroadR) + 5 + rand() * 10;
      const p = f.point.clone().addScaledVector(f.binormal, side * dist);
      if (!isClearOfTrack(p.x, p.z, trackInstance, f.halfWidth + 4)) continue;

      if (i % 5 === 0) {
        const shroom = new THREE.Group();
        shroom.position.set(p.x, p.y - 1.5, p.z);
        const st = new THREE.Mesh(new THREE.CylinderGeometry(1.1, 1.4, 4.5, 8), stemMat);
        st.position.y = 2.25;
        const cap = new THREE.Mesh(
          new THREE.SphereGeometry(2.8, 10, 8, 0, Math.PI * 2, 0, Math.PI * 0.55),
          redRoofMat
        );
        cap.position.y = 4.2;
        shroom.add(st, cap);
        lod3.add(shroom);
      } else {
        const flMat = makeMat(gfx, { color: flowerPalette[i % flowerPalette.length], roughness: 0.5 });
        const bloom = new THREE.Mesh(new THREE.DodecahedronGeometry(0.85, 0), flMat);
        bloom.position.set(p.x, p.y - 0.5, p.z);
        lod3.add(bloom);
      }
    }

    return (dt: number) => {
      for (const wm of windmills) {
        wm.hub.rotation.z += dt * wm.speed;
      }
    };
  },
};

/* ============================================================================
 * 2. TOADSTOOL HARBOR (Sunset Seaside)
 * ========================================================================== */
const toadstoolHarbor: TrackDefinition = {
  id: 'toadstool_harbor',
  cupId: CUP_IDS.MUSHROOM,
  name: 'Toadstool Harbor',
  subtitle: 'Sunset Seaside, Boardwalk & Lighthouse',
  themeColor: '#ff7b54',
  roadTexture: 'cobble',
  curbTexture: 'curb_red_white',
  offroadTexture: 'sand',
  offroadSurface: SURFACE_TYPES.OFFROAD_SAND,
  floorY: -3.5,
  railColor: 0xff9f1c,
  deckColor: 0x6b5b4e,
  skyColors: {
    top: 0x3b2667,
    horizon: 0xff8a5b,
    bottom: 0xffcb77,
    sunColor: 0xffb347,
    sunPos: [-300, 110, -260],
    fogColor: 0xffa07a,
    fogNear: 260,
    fogFar: 1320,
  },
  ambientIntensity: 0.72,
  dirLightColor: 0xffcf99,
  dirLightIntensity: 1.4,
  bgmStyle: {
    tempo: 132,
    scale: [60, 64, 65, 67, 71, 72, 76],
    bassPattern: [0, 2, 3, 2, 0, 4, 3, 1],
  },
  laps: 3,
  controlPoints: [
    { x: 0, y: 2, z: 84, width: 28, bank: 0, surface: SURFACE_TYPES.COBBLE, offroadL: 9, offroadR: 9, wallL: true, wallR: true },
    { x: 0, y: 2, z: -26, width: 27, bank: 0.03, surface: SURFACE_TYPES.COBBLE, offroadL: 10, offroadR: 10, wallL: true, wallR: true },
    { x: 58, y: 7, z: -138, width: 26, bank: 0.14, surface: SURFACE_TYPES.ROAD, offroadL: 11, offroadR: 11, wallL: true, wallR: true },
    { x: 170, y: 16, z: -174, width: 25, bank: 0.15, surface: SURFACE_TYPES.ROAD, offroadL: 10, offroadR: 9, wallL: true, wallR: true },
    { x: 262, y: 18, z: -102, width: 24, bank: 0.16, surface: SURFACE_TYPES.ROAD, offroadL: 8, offroadR: 8, wallL: true, wallR: true },
    { x: 228, y: 8, z: 0, width: 25, bank: 0.10, surface: SURFACE_TYPES.COBBLE, offroadL: 9, offroadR: 9, wallL: true, wallR: true },
    { x: 138, y: 2, z: 58, width: 24, bank: -0.10, surface: SURFACE_TYPES.WOOD, offroadL: 4, offroadR: 4, wallL: true, wallR: true },
    { x: 210, y: 2, z: 148, width: 24, bank: 0.13, surface: SURFACE_TYPES.WOOD, offroadL: 4, offroadR: 4, wallL: true, wallR: false },
    { x: 156, y: 2, z: 240, width: 24, bank: 0.12, surface: SURFACE_TYPES.WOOD, offroadL: 4, offroadR: 4, wallL: true, wallR: false },
    { x: 40, y: 3, z: 268, width: 26, bank: 0, surface: SURFACE_TYPES.COBBLE, offroadL: 8, offroadR: 8, wallL: true, wallR: true },
    { x: -85, y: 2, z: 246, width: 27, bank: -0.06, surface: SURFACE_TYPES.COBBLE, offroadL: 12, offroadR: 10, wallL: true, wallR: true },
    { x: -192, y: 4, z: 228, width: 25, bank: -0.14, surface: SURFACE_TYPES.ROAD, offroadL: 11, offroadR: 11, wallL: true, wallR: true },
    { x: -218, y: 8, z: 130, width: 25, bank: 0.12, surface: SURFACE_TYPES.ROAD, offroadL: 12, offroadR: 10, wallL: true, wallR: true },
    { x: -148, y: 5, z: 82, width: 25, bank: -0.10, surface: SURFACE_TYPES.COBBLE, offroadL: 10, offroadR: 10, wallL: true, wallR: true },
    { x: -96, y: 2, z: 166, width: 26, bank: 0.08, surface: SURFACE_TYPES.COBBLE, offroadL: 10, offroadR: 10, wallL: true, wallR: true },
    { x: -8, y: 2, z: 170, width: 28, bank: 0, surface: SURFACE_TYPES.COBBLE, offroadL: 9, offroadR: 9, wallL: true, wallR: true },
  ],
  shortcuts: [
    {
      name: 'Sunset Pier Boost Split',
      type: 'split',
      entryT: 0.41,
      exitT: 0.55,
      boostAtEntry: true,
      isGlider: false,
      requiresBoost: false,
      roadTexture: 'wood_pier',
      points: [
        { x: 142, y: 1.9, z: 82, width: 12, surface: SURFACE_TYPES.WOOD },
        { x: 128, y: 2.0, z: 142, width: 11, surface: SURFACE_TYPES.WOOD },
        { x: 122, y: 2.2, z: 202, width: 11, surface: SURFACE_TYPES.WOOD },
        { x: 118, y: 2.55, z: 250, width: 12, surface: SURFACE_TYPES.WOOD },
      ],
    },
    {
      name: 'Lighthouse Cliff Glider',
      type: 'ramp',
      entryT: 0.25,
      exitT: 0.38,
      boostAtEntry: true,
      isGlider: true,
      requiresBoost: false,
      rampU: 0.26,
      rampHeight: 3.6,
      points: [
        { x: 234, y: 18.7, z: -128, width: 14, surface: SURFACE_TYPES.WOOD },
        { x: 212, y: 18.2, z: -78, width: 13, surface: SURFACE_TYPES.WOOD },
        { x: 182, y: 11.5, z: -20, width: 13, surface: SURFACE_TYPES.VOID },
        { x: 157, y: 3.75, z: 32, width: 14, surface: SURFACE_TYPES.COBBLE },
      ],
    },
  ],
  boostPads: [
    { t: 0.08, lateral: 5.5, width: 4.8, length: 8.5 },
    { t: 0.50, lateral: -3.5, width: 4.6, length: 8.5 },
    { t: 0.65, lateral: 0, width: 5.2, length: 9.0 },
    { t: 0.92, lateral: -4.5, width: 4.6, length: 8.5 },
  ],
  ramps: [
    { t: 0.58, lateral: 3.5, width: 7.4, length: 10.5, height: 2.7, isGlider: false },
    { t: 0.77, lateral: 0, width: 7.6, length: 11.0, height: 2.6, isGlider: false },
  ],
  itemBoxRows: [
    { t: 0.13, count: 4, spread: 14 },
    { t: 0.39, count: 4, spread: 14 },
    { t: 0.63, count: 4, spread: 15 },
    { t: 0.87, count: 4, spread: 14 },
  ],
  coinLines: [
    { tStart: 0.04, tEnd: 0.08, lateral: -6.0, count: 4 },
    { tStart: 0.31, tEnd: 0.36, lateral: 5.0, count: 4 },
    { tStart: 0.45, tEnd: 0.49, lateral: 0, count: 4 },
    { tStart: 0.70, tEnd: 0.75, lateral: -5.5, count: 5 },
  ],
  hazards: [
    { type: 'crab', t: 0.48, lateral: 2.0, radius: 2.2, moveAmp: 6.5, moveSpeed: 1.8 },
    { type: 'crab', t: 0.66, lateral: -2.0, radius: 2.2, moveAmp: 7.0, moveSpeed: 2.0 },
    { type: 'boulder', t: 0.82, lateral: 0, radius: 2.0, moveAmp: 5.0, moveSpeed: 1.5 },
  ],
  buildScenery(sceneGroups, trackInstance, texLib, gfx) {
    const [lod0, lod1, lod2, lod3] = sceneGroups;
    const rand = seededRand(202);
    const sailboats: Array<{ boat: THREE.Group; phase: number; baseY: number }> = [];
    let lighthouseBeam: THREE.Group | null = null;

    const woodMatFallback = (g: any) => makeMat(g, { color: 0x6f4e37, roughness: 0.8 });

    // Golden sunset ocean plane (lod0)
    const waterGeo = new THREE.PlaneGeometry(1800, 1800);
    waterGeo.rotateX(-Math.PI / 2);
    const waterMat = makeMat(gfx, {
      color: 0x1e6091,
      emissive: 0xd96b27,
      emissiveIntensity: 0.26,
      roughness: 0.14,
      metalness: 0.48,
    });
    const ocean = new THREE.Mesh(waterGeo, waterMat);
    ocean.position.set(30, -3.5, 40);
    lod0.add(ocean);

    // Sandy beach island core (lod0)
    const sandTex = getTex(texLib, 'sand');
    const sandMat = makeMat(gfx, { color: sandTex ? 0xf5deb3 : 0xe9c46a, map: sandTex, roughness: 0.92 });
    const island = new THREE.Mesh(new THREE.CylinderGeometry(165, 220, 4.5, 20), sandMat);
    island.position.set(-40, -3.5, 45);
    island.receiveShadow = true;
    lod0.add(island);

    // Harbor stone archway (lod0)
    const cobbleMat = makeMat(gfx, { color: 0xd9c5b2, map: getTex(texLib, 'cobble'), roughness: 0.82 });
    const coralMat = makeMat(gfx, { color: 0xff6b6b, roughness: 0.5 });
    lod0.add(createTrackArch(trackInstance, 0.63, cobbleMat, coralMat, 13.0, 2.3));

    // Rotating-Beam Lighthouse on coastal headland (lod0/lod1)
    const lhFrame = trackInstance.sampleFrame(0.27);
    const lhPos = lhFrame.point.clone().addScaledVector(lhFrame.binormal, -(lhFrame.halfWidth + 28));
    const lhGroup = new THREE.Group();
    lhGroup.position.set(lhPos.x, -3.5, lhPos.z);
    const whiteMat = makeMat(gfx, { color: 0xf8f9fa, roughness: 0.65 });
    const redMat = makeMat(gfx, { color: 0xe63946, roughness: 0.55 });
    const rockMat = makeMat(gfx, { color: 0x6c757d, roughness: 0.9, flatShading: true });

    const cliff = new THREE.Mesh(new THREE.CylinderGeometry(16, 22, 16, 10), rockMat);
    cliff.position.y = 8;
    const baseTower = new THREE.Mesh(new THREE.CylinderGeometry(5.5, 7.5, 18, 12), whiteMat);
    baseTower.position.y = 25;
    baseTower.castShadow = true;
    const stripeTower = new THREE.Mesh(new THREE.CylinderGeometry(4.4, 5.5, 14, 12), redMat);
    stripeTower.position.y = 41;
    const lantern = new THREE.Mesh(
      new THREE.CylinderGeometry(3.8, 3.8, 5, 12),
      makeMat(gfx, { color: 0xfff3b0, emissive: 0xffcc33, emissiveIntensity: 1.3 })
    );
    lantern.position.y = 50.5;
    const roof = new THREE.Mesh(new THREE.ConeGeometry(4.6, 5, 12), redMat);
    roof.position.y = 55;

    lighthouseBeam = new THREE.Group();
    lighthouseBeam.position.y = 50.5;
    const beamMat = makeMat(gfx, {
      color: 0xffe066,
      emissive: 0xffcc33,
      emissiveIntensity: 0.95,
      transparent: true,
      opacity: 0.24,
      isUnlit: true,
    });
    for (const dir of [-1, 1]) {
      const cone = new THREE.Mesh(new THREE.ConeGeometry(16, 95, 12, 1, true), beamMat);
      cone.rotation.z = dir * Math.PI * 0.5;
      cone.position.x = dir * 48;
      lighthouseBeam.add(cone);
    }
    lhGroup.add(cliff, baseTower, stripeTower, lantern, roof, lighthouseBeam);
    lod0.add(lhGroup);

    // Colorful Waterfront Houses along the cobblestone harbor (lod1)
    const wallColors = [0xffe5d9, 0xfff1c1, 0xd8f3dc, 0xcaf0f8];
    const roofColors = [0xe76f51, 0x2a9d8f, 0xe63946, 0x457b9d];
    for (let i = 0; i < 14; i++) {
      const tH = 0.62 + (i / 14) * 0.34;
      const side = i % 2 === 0 ? -1 : 1;
      const fH = trackInstance.sampleFrame(tH);
      const hp = fH.point.clone().addScaledVector(fH.binormal, side * (fH.halfWidth + 24 + (i % 3) * 4));
      if (!isClearOfTrack(hp.x, hp.z, trackInstance, 24)) continue;

      const house = new THREE.Group();
      house.position.set(hp.x, hp.y - 1.5, hp.z);
      house.lookAt(fH.point.x, hp.y - 1.5, fH.point.z);
      const w = 9 + rand() * 5;
      const h = 8 + rand() * 6;
      const d = 8 + rand() * 4;
      const wall = new THREE.Mesh(
        new THREE.BoxGeometry(w, h, d),
        makeMat(gfx, { color: wallColors[i % wallColors.length], roughness: 0.78 })
      );
      wall.position.y = h * 0.5;
      wall.castShadow = true;
      const rMesh = new THREE.Mesh(
        new THREE.ConeGeometry(Math.max(w, d) * 0.78, 4.5, 4),
        makeMat(gfx, { color: roofColors[i % roofColors.length], roughness: 0.6 })
      );
      rMesh.rotation.y = Math.PI / 4;
      rMesh.position.y = h + 2.2;
      house.add(wall, rMesh);
      lod1.add(house);
    }

    // Bobbing Sailboats in the Sunset Harbor Bay (lod1/lod2)
    const hullMat = makeMat(gfx, { color: 0x8d5524, roughness: 0.75 });
    const sailMat = makeMat(gfx, { color: 0xfffdf7, roughness: 0.45, side: THREE.DoubleSide });
    const boatSpots = [
      [80, 120],
      [115, 210],
      [295, 225],
      [340, 110],
      [-145, -145],
      [220, -290],
    ];
    for (let b = 0; b < boatSpots.length; b++) {
      const [bx, bz] = boatSpots[b];
      if (!isClearOfTrack(bx, bz, trackInstance, 30)) continue;
      const boat = new THREE.Group();
      boat.position.set(bx, -3.2, bz);
      boat.rotation.y = rand() * Math.PI * 2;
      const hull = new THREE.Mesh(new THREE.BoxGeometry(5.5, 2.2, 13), hullMat);
      hull.position.y = 0.8;
      hull.castShadow = true;
      const mast = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.28, 13, 6), woodMatFallback(gfx));
      mast.position.y = 7.5;
      const sail = new THREE.Mesh(new THREE.ConeGeometry(4.5, 10, 3), sailMat);
      sail.position.set(0, 8.0, 0.8);
      sail.scale.set(0.2, 1, 1);
      boat.add(hull, mast, sail);
      (b < 3 ? lod1 : lod2).add(boat);
      sailboats.push({ boat, phase: b * 1.1, baseY: -3.2 });
    }

    // Palm Trees & Harbor Lantern Posts (lod2/lod3)
    const trunkMat = makeMat(gfx, { color: 0x8b5a2b, roughness: 0.88 });
    const palmMat = makeMat(gfx, { color: 0x38b000, roughness: 0.78 });
    for (let i = 0; i < 36; i++) {
      const rx = (rand() - 0.5) * 650;
      const rz = (rand() - 0.5) * 650;
      if (!isClearOfTrack(rx, rz, trackInstance, 36)) continue;
      if (Math.hypot(rx + 40, rz - 45) > 205) continue;
      const palm = new THREE.Group();
      palm.position.set(rx, -1.6, rz);
      const t = new THREE.Mesh(new THREE.CylinderGeometry(0.45, 0.75, 10, 6), trunkMat);
      t.position.y = 5;
      t.rotation.z = (rand() - 0.5) * 0.22;
      for (let f = 0; f < 5; f++) {
        const frond = new THREE.Mesh(new THREE.ConeGeometry(1.1, 5.5, 4), palmMat);
        frond.position.set(Math.cos((f * 2 * Math.PI) / 5) * 2.2, 9.8, Math.sin((f * 2 * Math.PI) / 5) * 2.2);
        frond.rotation.z = -Math.cos((f * 2 * Math.PI) / 5) * 1.15;
        frond.rotation.x = Math.sin((f * 2 * Math.PI) / 5) * 1.15;
        palm.add(frond);
      }
      palm.add(t);
      lod2.add(palm);
    }

    // Harbor market banners & warm dock lanterns (lod3) — skip open shortcut mouths
    const lampGlow = makeMat(gfx, { color: 0xffe699, emissive: 0xffaa00, emissiveIntensity: 1.2 });
    for (let i = 0; i < 24; i++) {
      const t = 0.43 + (i / 24) * 0.50;
      const f = trackInstance.sampleFrame(t);
      const side = i % 2 === 0 ? 1 : -1;
      if (side < 0 ? f.openMouthL : f.openMouthR) continue;
      const lp = f.point.clone().addScaledVector(f.binormal, side * (f.halfWidth + 5.5));
      if (!isClearOfShortcuts(lp.x, lp.z, trackInstance, 3.5)) continue;
      const post = new THREE.Group();
      post.position.set(lp.x, f.point.y, lp.z);
      const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.18, 0.22, 5.2, 6), rockMat);
      pole.position.y = 2.6;
      const bulb = new THREE.Mesh(new THREE.SphereGeometry(0.55, 8, 8), lampGlow);
      bulb.position.y = 5.4;
      post.add(pole, bulb);
      lod3.add(post);
    }

    return (dt: number, time: number) => {
      if (lighthouseBeam) {
        lighthouseBeam.rotation.y += dt * 0.85;
      }
      for (const s of sailboats) {
        s.boat.position.y = s.baseY + Math.sin(time * 1.4 + s.phase) * 0.45;
        s.boat.rotation.z = Math.sin(time * 1.1 + s.phase) * 0.05;
        s.boat.rotation.x = Math.cos(time * 0.9 + s.phase) * 0.03;
      }
    };
  },
};

/* ============================================================================
 * 3. FROSTBITE GLACIER (Alpine Ice Palace)
 * ========================================================================== */
const frostbiteGlacier: TrackDefinition = {
  id: 'frostbite_glacier',
  cupId: CUP_IDS.MUSHROOM,
  name: 'Frostbite Glacier',
  subtitle: 'Alpine Ice Palace & Crystal Canyon',
  themeColor: '#38bdf8',
  roadTexture: 'ice',
  curbTexture: 'curb_neon',
  offroadTexture: 'snow',
  offroadSurface: SURFACE_TYPES.OFFROAD_SNOW,
  floorY: -4.5,
  railColor: 0x38bdf8,
  deckColor: 0x688ea8,
  skyColors: {
    top: 0x1d4e89,
    horizon: 0xbde8ff,
    bottom: 0xeaf7ff,
    sunColor: 0xe6f8ff,
    sunPos: [200, 260, 160],
    fogColor: 0xcbeeff,
    fogNear: 250,
    fogFar: 1260,
  },
  ambientIntensity: 0.78,
  dirLightColor: 0xebf8ff,
  dirLightIntensity: 1.3,
  bgmStyle: {
    tempo: 140,
    scale: [62, 64, 65, 69, 71, 74, 76],
    bassPattern: [0, 3, 4, 3, 0, 2, 4, 5],
  },
  laps: 3,
  controlPoints: [
    { x: 0, y: 2, z: 76, width: 28, bank: 0, surface: SURFACE_TYPES.ROAD, roadTexture: 'asphalt', offroadL: 10, offroadR: 10, wallL: true, wallR: true },
    { x: 0, y: 7, z: -34, width: 27, bank: 0.06, surface: SURFACE_TYPES.ICE, offroadL: 11, offroadR: 11, wallL: true, wallR: true },
    { x: 64, y: 16, z: -144, width: 26, bank: 0.16, surface: SURFACE_TYPES.ICE, offroadL: 10, offroadR: 10, wallL: true, wallR: true },
    { x: 182, y: 22, z: -166, width: 25, bank: 0.17, surface: SURFACE_TYPES.ICE, offroadL: 9, offroadR: 9, wallL: true, wallR: true },
    { x: 254, y: 12, z: -80, width: 25, bank: 0.15, surface: SURFACE_TYPES.ICE, offroadL: 10, offroadR: 10, wallL: true, wallR: true },
    { x: 200, y: 5, z: 22, width: 26, bank: -0.10, surface: SURFACE_TYPES.ICE, offroadL: 11, offroadR: 11, wallL: true, wallR: true },
    { x: 115, y: 3, z: 76, width: 25, bank: -0.14, surface: SURFACE_TYPES.ICE, offroadL: 12, offroadR: 10, wallL: true, wallR: true },
    { x: 192, y: 1, z: 160, width: 25, bank: 0.16, surface: SURFACE_TYPES.ICE, offroadL: 12, offroadR: 10, wallL: true, wallR: true },
    { x: 158, y: 2, z: 248, width: 24, bank: 0.15, surface: SURFACE_TYPES.ICE, offroadL: 10, offroadR: 10, wallL: true, wallR: true },
    { x: 38, y: 8, z: 268, width: 25, bank: 0, surface: SURFACE_TYPES.ROAD, roadTexture: 'cobble', offroadL: 8, offroadR: 8, wallL: true, wallR: true },
    { x: -80, y: 14, z: 246, width: 25, bank: -0.12, surface: SURFACE_TYPES.ICE, offroadL: 11, offroadR: 11, wallL: true, wallR: true },
    { x: -190, y: 16, z: 220, width: 24, bank: -0.16, surface: SURFACE_TYPES.ICE, offroadL: 12, offroadR: 12, wallL: true, wallR: true },
    { x: -234, y: 10, z: 124, width: 25, bank: -0.18, surface: SURFACE_TYPES.ICE, offroadL: 14, offroadR: 10, wallL: true, wallR: true },
    { x: -148, y: 5, z: 72, width: 25, bank: 0.12, surface: SURFACE_TYPES.ICE, offroadL: 12, offroadR: 12, wallL: true, wallR: true },
    { x: -98, y: 2, z: 148, width: 25, bank: 0.14, surface: SURFACE_TYPES.ROAD, roadTexture: 'asphalt', offroadL: 12, offroadR: 12, wallL: true, wallR: true },
    { x: -8, y: 2, z: 166, width: 28, bank: 0, surface: SURFACE_TYPES.ROAD, roadTexture: 'asphalt', offroadL: 10, offroadR: 10, wallL: true, wallR: true },
  ],
  shortcuts: [
    {
      name: 'Elevated Glacier Boost Bridge',
      type: 'split',
      entryT: 0.38,
      exitT: 0.55,
      boostAtEntry: true,
      isGlider: false,
      requiresBoost: false,
      roadTexture: 'ice',
      points: [
        { x: 134, y: 3.4, z: 58, width: 12, surface: SURFACE_TYPES.ICE },
        { x: 128, y: 4.2, z: 78, width: 12, surface: SURFACE_TYPES.ICE },
        { x: 120, y: 10.5, z: 118, width: 11, surface: SURFACE_TYPES.ICE },
        { x: 112, y: 10.5, z: 196, width: 11, surface: SURFACE_TYPES.ICE },
        { x: 104, y: 4.85, z: 259, width: 12, surface: SURFACE_TYPES.ICE },
      ],
    },
    {
      name: 'Snowbank Final Hairpin Cut',
      type: 'offroad',
      entryT: 0.77,
      exitT: 0.89,
      boostAtEntry: false,
      isGlider: false,
      requiresBoost: true,
      points: [
        { x: -225, y: 12.6, z: 143, width: 13, surface: SURFACE_TYPES.OFFROAD_SNOW },
        { x: -188, y: 10.6, z: 144, width: 12, surface: SURFACE_TYPES.OFFROAD_SNOW },
        { x: -148, y: 6.2, z: 146, width: 12, surface: SURFACE_TYPES.OFFROAD_SNOW },
        { x: -108, y: 2.35, z: 148, width: 13, surface: SURFACE_TYPES.OFFROAD_SNOW },
      ],
    },
  ],
  boostPads: [
    { t: 0.08, lateral: 0, width: 5.0, length: 9.0 },
    { t: 0.32, lateral: -5.0, width: 4.6, length: 8.5 },
    { t: 0.62, lateral: 4.5, width: 4.6, length: 8.5 },
    { t: 0.93, lateral: -4.0, width: 4.8, length: 8.5 },
  ],
  ramps: [
    { t: 0.22, lateral: 0, width: 7.5, length: 11.0, height: 3.0, isGlider: true },
    { t: 0.68, lateral: -4.0, width: 7.2, length: 10.5, height: 2.6, isGlider: false },
  ],
  itemBoxRows: [
    { t: 0.13, count: 4, spread: 14 },
    { t: 0.42, count: 4, spread: 14 },
    { t: 0.65, count: 4, spread: 14 },
    { t: 0.89, count: 4, spread: 14 },
  ],
  coinLines: [
    { tStart: 0.03, tEnd: 0.06, lateral: -5.5, count: 4 },
    { tStart: 0.27, tEnd: 0.32, lateral: 5.0, count: 4 },
    { tStart: 0.56, tEnd: 0.60, lateral: 0, count: 4 },
    { tStart: 0.72, tEnd: 0.77, lateral: -5.0, count: 4 },
  ],
  hazards: [
    { type: 'ice_spike', t: 0.45, lateral: 0, radius: 2.2, moveAmp: 6.0, moveSpeed: 1.8 },
    { type: 'boulder', t: 0.60, lateral: -2.0, radius: 2.1, moveAmp: 5.5, moveSpeed: 1.6 },
    { type: 'ice_spike', t: 0.84, lateral: 2.5, radius: 2.0, moveAmp: 4.5, moveSpeed: 2.1 },
  ],
  buildScenery(sceneGroups, trackInstance, texLib, gfx) {
    const [lod0, lod1, lod2, lod3] = sceneGroups;
    const rand = seededRand(303);
    const crystals: Array<{ spire: THREE.Mesh; phase: number }> = [];

    // Snowy alpine valley floor (lod0)
    const snowTex = getTex(texLib, 'snow');
    const floorGeo = new THREE.PlaneGeometry(1700, 1700);
    floorGeo.rotateX(-Math.PI / 2);
    const floorMat = makeMat(gfx, {
      color: snowTex ? 0xf2f9ff : 0xe2f1ff,
      map: snowTex,
      roughness: 0.88,
    });
    const floor = new THREE.Mesh(floorGeo, floorMat);
    floor.position.set(10, -4.5, 50);
    floor.receiveShadow = true;
    lod0.add(floor);

    // Translucent glowing ice crystal arch & pillars (lod0 & lod1)
    const crystalMat = makeMat(gfx, {
      color: 0x7be4ff,
      emissive: 0x168aad,
      emissiveIntensity: 0.55,
      transparent: true,
      opacity: 0.84,
      roughness: 0.14,
      metalness: 0.25,
    });
    const icePalaceMat = makeMat(gfx, {
      color: 0xcaf0f8,
      emissive: 0x226688,
      emissiveIntensity: 0.25,
      roughness: 0.2,
      metalness: 0.15,
    });
    lod0.add(createTrackArch(trackInstance, 0.59, icePalaceMat, crystalMat, 13.5, 2.3));

    // Towering glacial peaks & frozen waterfall cliff (lod1)
    const mtnMat = makeMat(gfx, { color: 0xa9cce3, roughness: 0.8, flatShading: true });
    const peakMat = makeMat(gfx, { color: 0xffffff, roughness: 0.75, flatShading: true });
    const peaks = [
      [390, -230, 95, 110],
      [-360, -180, 105, 125],
      [-380, 290, 100, 105],
      [350, 320, 90, 95],
      [50, -330, 95, 115],
    ];
    for (const [px, pz, pr, ph] of peaks) {
      const mtn = new THREE.Mesh(new THREE.ConeGeometry(pr, ph, 7), mtnMat);
      mtn.position.set(px, ph * 0.45 - 4.5, pz);
      mtn.castShadow = true;
      const cap = new THREE.Mesh(new THREE.ConeGeometry(pr * 0.48, ph * 0.46, 7), peakMat);
      cap.position.set(px, ph * 0.72 - 4.5, pz);
      lod1.add(mtn, cap);
    }

    // Frozen Waterfall beside bridge curve (lod1)
    const wfFrame = trackInstance.sampleFrame(0.61);
    const wfPos = wfFrame.point.clone().addScaledVector(wfFrame.binormal, -(wfFrame.halfWidth + 32));
    const wfGroup = new THREE.Group();
    wfGroup.position.set(wfPos.x, -4.5, wfPos.z);
    const cliffBody = new THREE.Mesh(new THREE.BoxGeometry(28, 42, 20), mtnMat);
    cliffBody.position.y = 21;
    const iceFall = new THREE.Mesh(new THREE.BoxGeometry(14, 38, 3), crystalMat);
    iceFall.position.set(0, 19, 10.5);
    wfGroup.lookAt(wfFrame.point.x, -4.5, wfFrame.point.z);
    wfGroup.add(cliffBody, iceFall);
    lod1.add(wfGroup);

    // Timber Ski Chalet near start/finish straight (lod1)
    const chaletF = trackInstance.sampleFrame(0.03);
    const chaletPos = chaletF.point.clone().addScaledVector(chaletF.binormal, -(chaletF.halfWidth + 28));
    const chalet = new THREE.Group();
    chalet.position.set(chaletPos.x, chaletPos.y - 2, chaletPos.z);
    chalet.lookAt(chaletF.point.x, chaletPos.y - 2, chaletF.point.z);
    const timberMat = makeMat(gfx, { color: 0x6f4518, map: getTex(texLib, 'wood_pier'), roughness: 0.85 });
    const cabin = new THREE.Mesh(new THREE.BoxGeometry(22, 11, 16), timberMat);
    cabin.position.y = 5.5;
    cabin.castShadow = true;
    const chaletRoof = new THREE.Mesh(new THREE.ConeGeometry(18, 9, 4), peakMat);
    chaletRoof.rotation.y = Math.PI / 4;
    chaletRoof.position.y = 15;
    const warmWinMat = makeMat(gfx, { color: 0xffe066, emissive: 0xffaa00, emissiveIntensity: 1.0 });
    for (const wx of [-5, 0, 5]) {
      const win = new THREE.Mesh(new THREE.BoxGeometry(2.8, 3.2, 0.5), warmWinMat);
      win.position.set(wx, 5.8, 8.1);
      chalet.add(win);
    }
    chalet.add(cabin, chaletRoof);
    lod1.add(chalet);

    // Glowing Ice Crystals along curves (lod1/lod2)
    for (let i = 0; i < 24; i++) {
      const t = (i + 0.5) / 24;
      const f = trackInstance.sampleFrame(t);
      const side = i % 2 === 0 ? 1 : -1;
      const cp = f.point.clone().addScaledVector(f.binormal, side * (f.halfWidth + 16 + rand() * 14));
      if (!isClearOfTrack(cp.x, cp.z, trackInstance, f.halfWidth + 10)) continue;
      const h = 8 + rand() * 14;
      const spire = new THREE.Mesh(new THREE.ConeGeometry(2.5 + rand() * 1.5, h, 5), crystalMat);
      spire.position.set(cp.x, cp.y + h * 0.42 - 2, cp.z);
      spire.rotation.z = (rand() - 0.5) * 0.35;
      spire.rotation.x = (rand() - 0.5) * 0.35;
      (i % 2 === 0 ? lod1 : lod2).add(spire);
      crystals.push({ spire, phase: i * 0.7 });
    }

    // Snow-capped Alpine Pine Forest (lod2) + Snowdrifts (lod3)
    const pineMat = makeMat(gfx, { color: 0x1b4332, roughness: 0.88 });
    for (let i = 0; i < 65; i++) {
      const rx = (rand() - 0.5) * 720;
      const rz = (rand() - 0.5) * 720;
      if (!isClearOfTrack(rx, rz, trackInstance, 36)) continue;
      const pine = new THREE.Group();
      pine.position.set(rx, -4.5, rz);
      const sc = 0.8 + rand() * 0.8;
      const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.6 * sc, 0.9 * sc, 4 * sc, 6), timberMat);
      trunk.position.y = 2 * sc;
      const tier1 = new THREE.Mesh(new THREE.ConeGeometry(3.8 * sc, 7 * sc, 7), pineMat);
      tier1.position.y = 6.5 * sc;
      tier1.castShadow = true;
      const tier2 = new THREE.Mesh(new THREE.ConeGeometry(2.6 * sc, 5.5 * sc, 7), peakMat);
      tier2.position.y = 10.5 * sc;
      pine.add(trunk, tier1, tier2);
      lod2.add(pine);
    }

    for (let i = 0; i < 36; i++) {
      const rx = (rand() - 0.5) * 620;
      const rz = (rand() - 0.5) * 620;
      if (!isClearOfTrack(rx, rz, trackInstance, 26)) continue;
      const drift = new THREE.Mesh(new THREE.SphereGeometry(4 + rand() * 5, 8, 6), peakMat);
      drift.scale.set(1.5, 0.38, 1.1);
      drift.position.set(rx, -4.2, rz);
      lod3.add(drift);
    }

    return (_dt: number, time: number) => {
      for (const c of crystals) {
        c.spire.rotation.y = Math.sin(time * 0.5 + c.phase) * 0.25;
      }
    };
  },
};

/* ============================================================================
 * 4. EMBER CITADEL (Volcanic Fortress)
 * ========================================================================== */
const emberCitadel: TrackDefinition = {
  id: 'ember_citadel',
  cupId: CUP_IDS.MUSHROOM,
  name: 'Ember Citadel',
  subtitle: 'Volcanic Fortress & Magma Chasms',
  themeColor: '#ff4500',
  roadTexture: 'lava_rock',
  curbTexture: 'curb_red_white',
  offroadTexture: 'lava_rock',
  offroadSurface: SURFACE_TYPES.OFFROAD_SAND,
  floorY: -12.0,
  railColor: 0xff5400,
  deckColor: 0x261c1d,
  skyColors: {
    top: 0x19060c,
    horizon: 0xb83316,
    bottom: 0xff5d1a,
    sunColor: 0xff7b29,
    sunPos: [-200, 170, 240],
    fogColor: 0x5c180c,
    fogNear: 230,
    fogFar: 1180,
  },
  ambientIntensity: 0.68,
  dirLightColor: 0xffae73,
  dirLightIntensity: 1.35,
  bgmStyle: {
    tempo: 148,
    scale: [57, 60, 62, 63, 64, 67, 69],
    bassPattern: [0, 0, 4, 3, 0, 2, 5, 4],
  },
  laps: 3,
  controlPoints: [
    { x: 0, y: 8, z: 74, width: 27, bank: 0, surface: SURFACE_TYPES.COBBLE, offroadL: 6, offroadR: 6, wallL: true, wallR: true },
    { x: 0, y: 11, z: -38, width: 26, bank: 0.04, surface: SURFACE_TYPES.ROAD, offroadL: 5, offroadR: 5, wallL: true, wallR: true },
    { x: 56, y: 18, z: -150, width: 25, bank: 0.14, surface: SURFACE_TYPES.ROAD, offroadL: 4, offroadR: 4, wallL: true, wallR: true },
    // Open magma chasm bridge #1 (wallL/wallR = false!)
    { x: 168, y: 22, z: -176, width: 23, bank: 0.10, surface: SURFACE_TYPES.ROAD, offroadL: 0, offroadR: 0, wallL: false, wallR: false },
    { x: 258, y: 16, z: -104, width: 23, bank: 0.15, surface: SURFACE_TYPES.ROAD, offroadL: 0, offroadR: 0, wallL: false, wallR: false },
    { x: 228, y: 10, z: 10, width: 25, bank: 0.12, surface: SURFACE_TYPES.COBBLE, offroadL: 5, offroadR: 5, wallL: true, wallR: true },
    { x: 125, y: 8, z: 50, width: 25, bank: -0.10, surface: SURFACE_TYPES.ROAD, offroadL: 6, offroadR: 6, wallL: true, wallR: true },
    { x: 164, y: 14, z: 142, width: 24, bank: 0.14, surface: SURFACE_TYPES.ROAD, offroadL: 5, offroadR: 5, wallL: true, wallR: true },
    { x: 220, y: 20, z: 230, width: 24, bank: 0.16, surface: SURFACE_TYPES.ROAD, offroadL: 4, offroadR: 4, wallL: true, wallR: true },
    { x: 112, y: 22, z: 280, width: 24, bank: 0.12, surface: SURFACE_TYPES.ROAD, offroadL: 4, offroadR: 4, wallL: true, wallR: true },
    // Open chasm bridge #2 across volcanic crater!
    { x: -8, y: 18, z: 258, width: 22, bank: 0, surface: SURFACE_TYPES.ROAD, offroadL: 0, offroadR: 0, wallL: false, wallR: false },
    { x: -125, y: 13, z: 248, width: 23, bank: -0.10, surface: SURFACE_TYPES.ROAD, offroadL: 0, offroadR: 0, wallL: false, wallR: false },
    { x: -220, y: 9, z: 194, width: 25, bank: -0.15, surface: SURFACE_TYPES.COBBLE, offroadL: 6, offroadR: 6, wallL: true, wallR: true },
    { x: -172, y: 11, z: 108, width: 25, bank: -0.12, surface: SURFACE_TYPES.ROAD, offroadL: 6, offroadR: 6, wallL: true, wallR: true },
    { x: -95, y: 9, z: 160, width: 26, bank: 0.10, surface: SURFACE_TYPES.ROAD, offroadL: 6, offroadR: 6, wallL: true, wallR: true },
    { x: -10, y: 8, z: 165, width: 27, bank: 0, surface: SURFACE_TYPES.COBBLE, offroadL: 6, offroadR: 6, wallL: true, wallR: true },
  ],
  shortcuts: [
    {
      name: 'Fiery Chasm Leap-Ramp',
      type: 'ramp',
      entryT: 0.44,
      exitT: 0.60,
      boostAtEntry: true,
      isGlider: true,
      requiresBoost: false,
      rampU: 0.25,
      rampHeight: 3.6,
      roadTexture: 'lava_rock',
      points: [
        { x: 141, y: 12.25, z: 118, width: 13, surface: SURFACE_TYPES.ROAD },
        { x: 128, y: 15.6, z: 170, width: 12, surface: SURFACE_TYPES.ROAD },
        { x: 108, y: 21.2, z: 224, width: 12, surface: SURFACE_TYPES.VOID },
        { x: 91, y: 21.95, z: 272, width: 14, surface: SURFACE_TYPES.ROAD },
      ],
    },
    {
      name: 'Basalt Boost Ledge',
      type: 'split',
      entryT: 0.20,
      exitT: 0.36,
      boostAtEntry: true,
      isGlider: false,
      requiresBoost: false,
      roadTexture: 'lava_rock',
      points: [
        { x: 164, y: 22.25, z: -169, width: 11, surface: SURFACE_TYPES.ROAD },
        { x: 176, y: 19.8, z: -108, width: 10, surface: SURFACE_TYPES.ROAD },
        { x: 186, y: 14.2, z: -45, width: 10, surface: SURFACE_TYPES.ROAD },
        { x: 190, y: 8.95, z: 20, width: 11, surface: SURFACE_TYPES.ROAD },
      ],
    },
  ],
  boostPads: [
    { t: 0.08, lateral: -4.5, width: 4.8, length: 8.5 },
    { t: 0.39, lateral: 0, width: 5.0, length: 9.0 },
    { t: 0.67, lateral: 4.5, width: 4.6, length: 8.5 },
    { t: 0.93, lateral: 0, width: 5.0, length: 9.0 },
  ],
  ramps: [
    { t: 0.26, lateral: 0, width: 7.4, length: 10.5, height: 2.8, isGlider: false },
    { t: 0.74, lateral: -3.5, width: 7.4, length: 11.0, height: 3.0, isGlider: false },
  ],
  itemBoxRows: [
    { t: 0.13, count: 4, spread: 13 },
    { t: 0.41, count: 4, spread: 13 },
    { t: 0.69, count: 4, spread: 13 },
    { t: 0.89, count: 4, spread: 14 },
  ],
  coinLines: [
    { tStart: 0.03, tEnd: 0.07, lateral: 5.0, count: 4 },
    { tStart: 0.31, tEnd: 0.36, lateral: -4.5, count: 4 },
    { tStart: 0.55, tEnd: 0.59, lateral: 0, count: 4 },
    { tStart: 0.78, tEnd: 0.83, lateral: 5.0, count: 5 },
  ],
  hazards: [
    { type: 'lava_geyser', t: 0.36, lateral: 0, radius: 2.4, moveAmp: 0, moveSpeed: 1.5 },
    { type: 'thwomp', t: 0.57, lateral: 2.5, radius: 2.3, moveAmp: 5.5, moveSpeed: 1.4 },
    { type: 'lava_geyser', t: 0.71, lateral: -3.5, radius: 2.3, moveAmp: 0, moveSpeed: 1.8 },
    { type: 'thwomp', t: 0.86, lateral: 0, radius: 2.3, moveAmp: 5.8, moveSpeed: 1.5 },
  ],
  buildScenery(sceneGroups, trackInstance, texLib, gfx) {
    const [lod0, lod1, lod2, lod3] = sceneGroups;
    const rand = seededRand(404);
    const flames: Array<{ flame: THREE.Mesh; phase: number; baseScaleY: number }> = [];

    // Glowing molten magma sea below (lod0)
    const lavaTex = getTex(texLib, 'lava_glow');
    const magmaGeo = new THREE.PlaneGeometry(1800, 1800);
    magmaGeo.rotateX(-Math.PI / 2);
    const magmaMat = makeMat(gfx, {
      color: lavaTex ? 0xffffff : 0xff4500,
      map: lavaTex,
      emissive: 0xff3b00,
      emissiveIntensity: 0.88,
      roughness: 0.35,
    });
    const magma = new THREE.Mesh(magmaGeo, magmaMat);
    magma.position.set(20, -12.0, 50);
    lod0.add(magma);

    // Obsidian fortress spiked arches (lod0)
    const obsidianMat = makeMat(gfx, { color: 0x1e1a24, roughness: 0.55, metalness: 0.35 });
    const emberMat = makeMat(gfx, { color: 0xff6600, emissive: 0xff3300, emissiveIntensity: 1.15, roughness: 0.25 });
    lod0.add(createTrackArch(trackInstance, 0.38, obsidianMat, emberMat, 14.0, 2.6));
    lod0.add(createTrackArch(trackInstance, 0.75, obsidianMat, emberMat, 14.0, 2.6));

    // Towering Obsidian Fortress Towers & Volcano Crater Spires (lod1)
    const volcanoMat = makeMat(gfx, { color: 0x2f2322, roughness: 0.9, flatShading: true });
    const towerSpots = [
      [115, -55, 56],
      [360, -230, 72],
      [-340, -160, 78],
      [-350, 290, 68],
      [335, 340, 74],
      [30, 415, 65],
    ];
    for (let i = 0; i < towerSpots.length; i++) {
      const [tx, tz, th] = towerSpots[i];
      if (!isClearOfTrack(tx, tz, trackInstance, 34)) continue;
      const tower = new THREE.Group();
      tower.position.set(tx, -12, tz);
      const base = new THREE.Mesh(new THREE.CylinderGeometry(16, 26, th, 8), i % 2 === 0 ? obsidianMat : volcanoMat);
      base.position.y = th * 0.5;
      base.castShadow = true;
      const crown = new THREE.Mesh(new THREE.TorusGeometry(13, 2.2, 6, 8), emberMat);
      crown.rotation.x = Math.PI / 2;
      crown.position.y = th;
      tower.add(base, crown);
      lod1.add(tower);
    }

    // Obsidian Citadel Keep along start straight (lod1)
    const keepF = trackInstance.sampleFrame(0.01);
    const keepPos = keepF.point.clone().addScaledVector(keepF.binormal, -(keepF.halfWidth + 30));
    const keep = new THREE.Group();
    keep.position.set(keepPos.x, -12, keepPos.z);
    const keepBody = new THREE.Mesh(new THREE.BoxGeometry(26, 46, 42), obsidianMat);
    keepBody.position.y = 23;
    keepBody.castShadow = true;
    for (const sz of [-16, 0, 16]) {
      const spire = new THREE.Mesh(new THREE.ConeGeometry(5, 16, 4), emberMat);
      spire.position.set(0, 52, sz);
      keep.add(spire);
    }
    keep.add(keepBody);
    lod1.add(keep);

    // Flaming Roadside Braziers (lod2) — skip open shortcut mouths & shortcut ribbons
    for (let i = 0; i < 24; i++) {
      const t = (i + 0.4) / 24;
      const f = trackInstance.sampleFrame(t);
      if (!f.wallL && !f.wallR) continue;
      const side = i % 2 === 0 ? 1 : -1;
      if (side < 0 ? f.openMouthL || !f.wallL : f.openMouthR || !f.wallR) continue;
      const bp = f.point.clone().addScaledVector(f.binormal, side * (f.halfWidth + 7.5));
      if (!isClearOfShortcuts(bp.x, bp.z, trackInstance, 4)) continue;
      const brazier = new THREE.Group();
      brazier.position.set(bp.x, f.point.y, bp.z);
      const bowl = new THREE.Mesh(new THREE.CylinderGeometry(1.6, 0.9, 2.8, 8), obsidianMat);
      bowl.position.y = 1.4;
      const flame = new THREE.Mesh(new THREE.ConeGeometry(1.2, 3.6, 7), emberMat);
      flame.position.y = 4.2;
      brazier.add(bowl, flame);
      lod2.add(brazier);
      flames.push({ flame, phase: i * 0.9, baseScaleY: 1 });
    }

    for (let i = 0; i < 36; i++) {
      const rx = (rand() - 0.5) * 680;
      const rz = (rand() - 0.5) * 680;
      if (!isClearOfTrack(rx, rz, trackInstance, 36)) continue;
      const shard = new THREE.Mesh(new THREE.ConeGeometry(3 + rand() * 3, 12 + rand() * 14, 5), obsidianMat);
      shard.position.set(rx, -6, rz);
      shard.rotation.z = (rand() - 0.5) * 0.4;
      lod3.add(shard);
    }

    return (_dt: number, time: number) => {
      for (const fl of flames) {
        const flicker = 0.82 + Math.sin(time * 8.5 + fl.phase) * 0.24 + Math.cos(time * 13 + fl.phase) * 0.12;
        fl.flame.scale.set(1, flicker, 1);
      }
    };
  },
};

export const CUP1_TRACKS: TrackDefinition[] = [
  sunburstCircuit,
  toadstoolHarbor,
  frostbiteGlacier,
  emberCitadel,
];
