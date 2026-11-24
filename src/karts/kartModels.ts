import * as THREE from 'three';
import type {
  CharacterDef,
  GraphicsSettings,
  KartDef,
  KartState,
  WheelDef,
} from '../core/contracts';
import type { MaterialDef } from '../core/graphics';

export interface TextureLibLike {
  get?: (key: string) => THREE.Texture | null;
  textures?: Record<string, THREE.Texture | undefined>;
  [key: string]: any;
}

export interface GraphicsLike {
  createMaterial?: (def: MaterialDef) => THREE.Material;
  useBlobShadows?: () => boolean;
  getSettings?: () => Partial<GraphicsSettings>;
}

export interface KartRig {
  root: THREE.Group;
  bodyPivot: THREE.Group;
  wheels: [THREE.Group, THREE.Group, THREE.Group, THREE.Group];
  steerPivots: [THREE.Group, THREE.Group];
  headPivot: THREE.Group;
  armsPivot: THREE.Group;
  gliderGroup: THREE.Group;
  exhaustFlames: [THREE.Group, THREE.Group];
  driftSparks: [THREE.Group, THREE.Group];
  itemMount: THREE.Group;
  blobShadow: THREE.Mesh;
  updateVisuals: (
    kartState?: Partial<KartState> | null,
    dt?: number,
    time?: number,
    gfxArg?: GraphicsLike | null
  ) => void;
}

type LitOrBasicMaterial = THREE.Material & {
  color?: THREE.Color;
  emissive?: THREE.Color;
  emissiveIntensity?: number;
  opacity: number;
};

interface AddPartOpts {
  pos?: [number, number, number];
  rot?: [number, number, number];
  scale?: number | [number, number, number];
  castShadow?: boolean;
  receiveShadow?: boolean;
  name?: string;
  blending?: THREE.Blending;
  depthWrite?: boolean;
  shimmer?: boolean;
}

type AddPartFn = (
  parent: THREE.Object3D,
  geo: THREE.BufferGeometry,
  mat: THREE.Material,
  opts?: AddPartOpts
) => THREE.Mesh;

interface KartMats {
  paint: THREE.Material;
  secondary: THREE.Material;
  accent: THREE.Material;
  stripes: THREE.Material;
  carbon: THREE.Material;
  gunmetal: THREE.Material;
  chrome: THREE.Material;
  gold: THREE.Material;
  tire: THREE.Material;
  tireTread: THREE.Material;
  glass: THREE.Material;
  headlight: THREE.Material;
  taillight: THREE.Material;
  neon: THREE.Material;
  white: THREE.Material;
  leather: THREE.Material;
  charPrimary: THREE.Material;
  charSecondary: THREE.Material;
  charAccent: THREE.Material;
  skin: THREE.Material;
  hairDark: THREE.Material;
  hairGold: THREE.Material;
  hairPlat: THREE.Material;
}

interface KartBodyLayout {
  frontAxleZ: number;
  rearAxleZ: number;
  frontHalfTrack: number;
  rearHalfTrack: number;
  chassisAttachX: number;
  chassisAttachY: number;
  wheelCenterY: number;
  seatPos: [number, number, number];
  gliderAnchor: [number, number, number];
  exhaustTips: [[number, number, number], [number, number, number]];
  sparkAnchorZ: number;
}

const MAX_STEER_RAD = (28 * Math.PI) / 180;
const DEG2RAD = Math.PI / 180;

let _fallbackShadowTex: THREE.CanvasTexture | null = null;
let _fallbackSparkTex: THREE.CanvasTexture | null = null;

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * clamp(t, 0, 1);
}

function getTex(texLib: TextureLibLike | null | undefined, key: string): THREE.Texture | null {
  if (!texLib) return null;
  if (typeof texLib.get === 'function') {
    const t = texLib.get(key);
    if (t) return t;
  }
  if (texLib.textures && texLib.textures[key]) return texLib.textures[key] || null;
  if (texLib[key]) return texLib[key] as THREE.Texture;
  return null;
}

function getFallbackBlobShadowTex(): THREE.CanvasTexture | null {
  if (_fallbackShadowTex || typeof document === 'undefined') return _fallbackShadowTex;
  const canvas = document.createElement('canvas');
  canvas.width = 128;
  canvas.height = 128;
  const ctx = canvas.getContext('2d');
  if (ctx) {
    const grad = ctx.createRadialGradient(64, 64, 8, 64, 64, 60);
    grad.addColorStop(0, 'rgba(0,0,0,0.85)');
    grad.addColorStop(0.55, 'rgba(0,0,0,0.45)');
    grad.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, 128, 128);
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  _fallbackShadowTex = tex;
  return tex;
}

function getFallbackSparkTex(): THREE.CanvasTexture | null {
  if (_fallbackSparkTex || typeof document === 'undefined') return _fallbackSparkTex;
  const canvas = document.createElement('canvas');
  canvas.width = 64;
  canvas.height = 64;
  const ctx = canvas.getContext('2d');
  if (ctx) {
    const grad = ctx.createRadialGradient(32, 32, 2, 32, 32, 30);
    grad.addColorStop(0, 'rgba(255,255,255,1)');
    grad.addColorStop(0.35, 'rgba(255,255,255,0.75)');
    grad.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, 64, 64);
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  _fallbackSparkTex = tex;
  return tex;
}

function makeMat(gfx: GraphicsLike | null | undefined, def: MaterialDef): THREE.Material {
  let mat: THREE.Material;
  if (gfx && typeof gfx.createMaterial === 'function') {
    mat = gfx.createMaterial(def);
  } else if (def.isUnlit) {
    mat = new THREE.MeshBasicMaterial({
      color: def.color ?? 0xffffff,
      map: def.map ?? null,
      transparent: Boolean(def.transparent),
      opacity: def.opacity ?? 1,
      side: def.side ?? THREE.FrontSide,
    });
  } else {
    mat = new THREE.MeshStandardMaterial({
      color: def.color ?? 0xffffff,
      map: def.map ?? null,
      emissive: def.emissive ?? 0x000000,
      emissiveIntensity: def.emissiveIntensity ?? 1,
      roughness: def.roughness ?? 0.5,
      metalness: def.metalness ?? 0.1,
      transparent: Boolean(def.transparent),
      opacity: def.opacity ?? 1,
      side: def.side ?? THREE.FrontSide,
      flatShading: Boolean(def.flatShading),
    });
  }
  if (def.depthWrite !== undefined) mat.depthWrite = def.depthWrite;
  if (def.blending !== undefined) mat.blending = def.blending;
  return mat;
}

function createExtrudedProfile(
  points2D: Array<[number, number]>,
  width: number,
  bevel = 0.04
): THREE.ExtrudeGeometry {
  const shape = new THREE.Shape();
  shape.moveTo(points2D[0][0], points2D[0][1]);
  for (let i = 1; i < points2D.length; i++) {
    shape.lineTo(points2D[i][0], points2D[i][1]);
  }
  shape.closePath();

  const geo = new THREE.ExtrudeGeometry(shape, {
    depth: width,
    bevelEnabled: bevel > 0,
    bevelThickness: bevel,
    bevelSize: bevel,
    bevelSegments: 2,
    curveSegments: 8,
  });
  // ExtrudeGeometry extrudes along +Z from 2D (x, y).
  // Map profile X -> local Z (forward), profile Y -> local Y (up), extrusion depth -> local X (width).
  geo.translate(0, 0, -width * 0.5);
  geo.rotateY(-Math.PI / 2);
  geo.computeVertexNormals();
  return geo;
}

function createGearTreadGeometry(
  outerR: number,
  innerR: number,
  width: number,
  teeth = 12
): THREE.ExtrudeGeometry {
  const shape = new THREE.Shape();
  const step = (Math.PI * 2) / teeth;
  for (let i = 0; i < teeth; i++) {
    const a0 = i * step;
    const a1 = a0 + step * 0.22;
    const a2 = a0 + step * 0.48;
    const a3 = a0 + step * 0.70;
    const x0 = Math.cos(a0) * innerR;
    const y0 = Math.sin(a0) * innerR;
    if (i === 0) shape.moveTo(x0, y0);
    else shape.lineTo(x0, y0);
    shape.lineTo(Math.cos(a1) * outerR, Math.sin(a1) * outerR);
    shape.lineTo(Math.cos(a2) * outerR, Math.sin(a2) * outerR);
    shape.lineTo(Math.cos(a3) * innerR, Math.sin(a3) * innerR);
  }
  shape.closePath();

  const hole = new THREE.Path();
  hole.absarc(0, 0, innerR * 0.88, 0, Math.PI * 2, true);
  shape.holes.push(hole);

  const geo = new THREE.ExtrudeGeometry(shape, { depth: width, bevelEnabled: false });
  geo.translate(0, 0, -width * 0.5);
  geo.rotateY(Math.PI / 2);
  geo.computeVertexNormals();
  return geo;
}

function createSpokeStarGeometry(
  radius: number,
  depth: number,
  numSpokes: number,
  twist = 0
): THREE.ExtrudeGeometry {
  const shape = new THREE.Shape();
  const hubR = radius * 0.28;
  const spokeHalfAngle = (Math.PI / numSpokes) * 0.28;
  for (let i = 0; i < numSpokes; i++) {
    const baseA = (i / numSpokes) * Math.PI * 2;
    const tipA = baseA + twist;
    const b1 = baseA - spokeHalfAngle * 1.4;
    const b2 = baseA + spokeHalfAngle * 1.4;
    const t1 = tipA - spokeHalfAngle * 0.75;
    const t2 = tipA + spokeHalfAngle * 0.75;
    if (i === 0) shape.moveTo(Math.cos(b1) * hubR, Math.sin(b1) * hubR);
    else shape.lineTo(Math.cos(b1) * hubR, Math.sin(b1) * hubR);
    shape.lineTo(Math.cos(t1) * radius, Math.sin(t1) * radius);
    shape.lineTo(Math.cos(t2) * radius, Math.sin(t2) * radius);
    shape.lineTo(Math.cos(b2) * hubR, Math.sin(b2) * hubR);
  }
  shape.closePath();

  const geo = new THREE.ExtrudeGeometry(shape, { depth, bevelEnabled: false });
  geo.translate(0, 0, -depth * 0.5);
  geo.rotateY(Math.PI / 2);
  geo.computeVertexNormals();
  return geo;
}

function createMeshHelper(shimmerMeshes: THREE.Mesh[]): AddPartFn {
  return function addPart(
    parent: THREE.Object3D,
    geo: THREE.BufferGeometry,
    mat: THREE.Material,
    opts: AddPartOpts = {}
  ): THREE.Mesh {
    const mesh = new THREE.Mesh(geo, mat);
    if (opts.pos) mesh.position.set(opts.pos[0], opts.pos[1], opts.pos[2]);
    if (opts.rot) mesh.rotation.set(opts.rot[0], opts.rot[1], opts.rot[2]);
    if (opts.scale !== undefined) {
      if (Array.isArray(opts.scale)) mesh.scale.set(opts.scale[0], opts.scale[1], opts.scale[2]);
      else mesh.scale.setScalar(opts.scale);
    }
    const cast = opts.castShadow !== undefined ? opts.castShadow : true;
    const recv = opts.receiveShadow !== undefined ? opts.receiveShadow : true;
    mesh.castShadow = cast;
    mesh.receiveShadow = recv;
    if (opts.name) mesh.name = opts.name;

    const litMat = mat as LitOrBasicMaterial;
    mesh.userData._baseColor = litMat.color ? litMat.color.clone() : new THREE.Color(0xffffff);
    mesh.userData._baseEmissive = litMat.emissive ? litMat.emissive.clone() : new THREE.Color(0x000000);
    mesh.userData._baseEmissiveIntensity = litMat.emissiveIntensity ?? 1;
    if (opts.blending !== undefined) mesh.userData._forceBlending = opts.blending;
    if (opts.depthWrite !== undefined) mesh.userData._forceDepthWrite = opts.depthWrite;

    if (opts.shimmer) {
      shimmerMeshes.push(mesh);
    }
    parent.add(mesh);
    return mesh;
  };
}

/**
 * Builds one detailed wheel assembly centered at origin (axle along X).
 * `sideSign`: +1 for Left (+X outward), -1 for Right (-X outward).
 */
function buildWheelAssembly(
  wheelDef: Partial<WheelDef> | null | undefined,
  sideSign: 1 | -1,
  mats: KartMats,
  addPart: AddPartFn
): THREE.Group {
  const wheelGroup = new THREE.Group();
  const r = wheelDef?.radius || 0.44;
  const w = wheelDef?.width || 0.34;
  const styleId = wheelDef?.id || 'standard';
  const out = sideSign; // +1 left, -1 right

  // Main tire tread cylinder (axis along X)
  const tireBodyGeo = new THREE.CylinderGeometry(r * 0.94, r * 0.94, w * 0.84, 14);
  tireBodyGeo.rotateZ(Math.PI / 2);
  addPart(wheelGroup, tireBodyGeo, mats.tire, { name: `tire_core_${styleId}` });

  // Rounded tire shoulder rings for authentic sidewall silhouette
  const shoulderGeo = new THREE.TorusGeometry(r * 0.78, r * 0.20, 6, 14);
  shoulderGeo.rotateY(Math.PI / 2);
  addPart(wheelGroup, shoulderGeo, mats.tire, {
    pos: [out * w * 0.24, 0, 0],
    scale: [1, 1, 0.72],
  });
  addPart(wheelGroup, shoulderGeo, mats.tire, {
    pos: [-out * w * 0.24, 0, 0],
    scale: [1, 1, 0.72],
  });

  // Inner brake disc & caliper
  const discGeo = new THREE.CylinderGeometry(r * 0.56, r * 0.56, w * 0.14, 12);
  discGeo.rotateZ(Math.PI / 2);
  addPart(wheelGroup, discGeo, mats.chrome, { pos: [-out * w * 0.24, 0, 0], castShadow: false });

  // Style-specific tread, rim & hub details
  if (styleId === 'monster') {
    // 12 chunky off-road tread lugs combined into 2 clean tread rings
    const treadRingGeo = createGearTreadGeometry(r * 1.03, r * 0.91, w * 0.34, 12);
    addPart(wheelGroup, treadRingGeo, mats.tireTread, { pos: [w * 0.22, 0, 0] });
    addPart(wheelGroup, treadRingGeo, mats.tireTread, {
      pos: [-w * 0.22, 0, 0],
      rot: [Math.PI / 12, 0, 0],
    });
    // Deep dish heavy rim
    const dishGeo = new THREE.CylinderGeometry(r * 0.55, r * 0.48, w * 0.55, 14);
    dishGeo.rotateZ(Math.PI / 2);
    addPart(wheelGroup, dishGeo, mats.gunmetal, { pos: [out * w * 0.1, 0, 0] });

    const beadlockGeo = new THREE.TorusGeometry(r * 0.52, r * 0.055, 6, 14);
    beadlockGeo.rotateY(Math.PI / 2);
    addPart(wheelGroup, beadlockGeo, mats.accent, { pos: [out * w * 0.36, 0, 0], shimmer: true });
  } else if (styleId === 'roller') {
    // Cute compact colored outer lip + smooth domed hubcap + cross spoke
    const lipGeo = new THREE.TorusGeometry(r * 0.62, r * 0.075, 6, 14);
    lipGeo.rotateY(Math.PI / 2);
    addPart(wheelGroup, lipGeo, mats.accent, { pos: [out * w * 0.32, 0, 0], shimmer: true });

    const domeGeo = new THREE.SphereGeometry(r * 0.54, 12, 8);
    addPart(wheelGroup, domeGeo, mats.chrome, {
      pos: [out * w * 0.22, 0, 0],
      scale: [0.42, 1, 1],
    });

    const crossGeo = createSpokeStarGeometry(r * 0.50, w * 0.14, 4, 0);
    addPart(wheelGroup, crossGeo, mats.secondary, { pos: [out * w * 0.38, 0, 0] });
  } else if (styleId === 'cyber') {
    // Glowing outer + inner neon alloy rings + single 6-blade turbine star
    const rimBackGeo = new THREE.CylinderGeometry(r * 0.64, r * 0.64, w * 0.62, 14);
    rimBackGeo.rotateZ(Math.PI / 2);
    addPart(wheelGroup, rimBackGeo, mats.carbon);

    const glowRingGeo = new THREE.TorusGeometry(r * 0.63, r * 0.055, 6, 16);
    glowRingGeo.rotateY(Math.PI / 2);
    addPart(wheelGroup, glowRingGeo, mats.neon, { pos: [out * w * 0.33, 0, 0], castShadow: false });
    addPart(wheelGroup, glowRingGeo, mats.neon, { pos: [-out * w * 0.33, 0, 0], castShadow: false });

    const turbineGeo = createSpokeStarGeometry(r * 0.58, w * 0.14, 6, out * 0.35);
    addPart(wheelGroup, turbineGeo, mats.chrome, { pos: [out * w * 0.31, 0, 0] });

    const coreGlowGeo = new THREE.CylinderGeometry(r * 0.18, r * 0.18, w * 0.22, 10);
    coreGlowGeo.rotateZ(Math.PI / 2);
    addPart(wheelGroup, coreGlowGeo, mats.neon, { pos: [out * w * 0.32, 0, 0], castShadow: false });
  } else {
    // Standard 5-spoke star alloy racing slick
    const dishGeo = new THREE.CylinderGeometry(r * 0.58, r * 0.58, w * 0.62, 14);
    dishGeo.rotateZ(Math.PI / 2);
    addPart(wheelGroup, dishGeo, mats.gunmetal);

    const rimLipGeo = new THREE.TorusGeometry(r * 0.60, r * 0.05, 6, 14);
    rimLipGeo.rotateY(Math.PI / 2);
    addPart(wheelGroup, rimLipGeo, mats.chrome, { pos: [out * w * 0.33, 0, 0] });

    const starGeo = createSpokeStarGeometry(r * 0.56, w * 0.15, 5, 0);
    addPart(wheelGroup, starGeo, mats.chrome, { pos: [out * w * 0.31, 0, 0] });
  }

  // Central colored hub nut
  const hubGeo = new THREE.CylinderGeometry(r * 0.18, r * 0.21, w * 0.26, 10);
  hubGeo.rotateZ(Math.PI / 2);
  addPart(wheelGroup, hubGeo, mats.paint, {
    pos: [out * w * 0.34, 0, 0],
    shimmer: true,
    castShadow: false,
  });

  return wheelGroup;
}

/**
 * Adds tubular suspension wishbones from chassis side to wheel hub.
 */
function addSuspensionArms(
  parent: THREE.Object3D,
  chassisX: number,
  chassisY: number,
  chassisZ: number,
  wheelX: number,
  wheelY: number,
  wheelZ: number,
  isMonster: boolean,
  mats: KartMats,
  addPart: AddPartFn
): void {
  const dx = wheelX - chassisX;
  const dy = wheelY - chassisY;
  const dz = wheelZ - chassisZ;
  const len = Math.sqrt(dx * dx + dy * dy + dz * dz);
  if (len < 0.05) return;

  const armGeo = new THREE.CylinderGeometry(0.042, 0.042, len, 8);
  const dir = new THREE.Vector3(dx, dy, dz).normalize();
  const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir);

  const offsets = [-0.14, 0.14];
  for (const zo of offsets) {
    const mesh = addPart(parent, armGeo, mats.gunmetal, {
      pos: [chassisX + dx * 0.5, chassisY + dy * 0.5, chassisZ + dz * 0.5 + zo * 0.45],
      castShadow: true,
    });
    mesh.quaternion.copy(q);
  }

  // Coilover shock strut for off-road / monster wheel setups
  if (isMonster) {
    const shockGeo = new THREE.CylinderGeometry(0.055, 0.055, len * 0.72, 8);
    const shock = addPart(parent, shockGeo, mats.accent, {
      pos: [chassisX + dx * 0.48, chassisY + dy * 0.5 + 0.14, chassisZ + dz * 0.48],
      shimmer: true,
    });
    shock.quaternion.copy(q);
  }
}

/**
 * Builds the selected kart body geometry and returns layout anchors for wheels, driver, and exhausts.
 */
function buildKartBody(
  kartDef: Partial<KartDef> | null | undefined,
  wheelDef: Partial<WheelDef> | null | undefined,
  mats: KartMats,
  addPart: AddPartFn,
  bodyPivot: THREE.Group
): KartBodyLayout {
  const kartId = kartDef?.id || 'standard_gp';
  const r = wheelDef?.radius || 0.44;
  const w = wheelDef?.width || 0.34;
  const rideLift = Math.max(0, (r - 0.38) * 0.65);
  const floorY = 0.25 + rideLift;
  const trackPad = w * 0.48;

  // Helper for common headlights/taillights
  const addHeadlight = (x: number, y: number, z: number, radius = 0.11, isBar = false): void => {
    if (isBar) {
      addPart(bodyPivot, new THREE.BoxGeometry(radius * 2.2, radius * 0.55, 0.08), mats.headlight, {
        pos: [x, y, z],
        castShadow: false,
      });
    } else {
      const bezel = new THREE.CylinderGeometry(radius * 1.18, radius * 1.18, 0.09, 12);
      bezel.rotateX(Math.PI / 2);
      addPart(bodyPivot, bezel, mats.chrome, { pos: [x, y, z - 0.02], castShadow: false });
      const lens = new THREE.CylinderGeometry(radius * 0.92, radius * 0.92, 0.06, 12);
      lens.rotateX(Math.PI / 2);
      addPart(bodyPivot, lens, mats.headlight, { pos: [x, y, z + 0.02], castShadow: false });
    }
  };

  const addTaillight = (x: number, y: number, z: number, wBar = 0.22, hBar = 0.09): void => {
    addPart(bodyPivot, new THREE.BoxGeometry(wBar, hBar, 0.08), mats.taillight, {
      pos: [x, y, z],
      castShadow: false,
    });
  };

  // Common floor pan & seat anchor defaults
  const layout: KartBodyLayout = {
    frontAxleZ: 1.24,
    rearAxleZ: -1.16,
    frontHalfTrack: 0.96 + trackPad,
    rearHalfTrack: 1.04 + trackPad,
    chassisAttachX: 0.52,
    chassisAttachY: floorY + 0.14,
    wheelCenterY: r,
    seatPos: [0, floorY + 0.22, -0.22],
    gliderAnchor: [0, floorY + 1.18, -0.45],
    exhaustTips: [
      [0.34, floorY + 0.55, -1.68],
      [-0.34, floorY + 0.55, -1.68],
    ],
    sparkAnchorZ: -1.16 - r * 0.78,
  };

  if (kartId === 'standard_gp') {
    // Carbon lower floor tub
    addPart(bodyPivot, new THREE.BoxGeometry(1.12, 0.14, 2.55), mats.carbon, {
      pos: [0, floorY, 0.06],
    });
    // Sculpted nose profile
    const noseGeo = createExtrudedProfile(
      [
        [0.32, 0.05],
        [1.82, 0.10],
        [1.76, 0.34],
        [1.05, 0.50],
        [0.34, 0.54],
      ],
      0.72,
      0.04
    );
    addPart(bodyPivot, noseGeo, mats.paint, { pos: [0, floorY + 0.02, 0], shimmer: true });

    // Racing center stripe & number badge on nose
    addPart(bodyPivot, new THREE.BoxGeometry(0.24, 0.03, 1.10), mats.accent, {
      pos: [0, floorY + 0.51, 1.02],
      rot: [0.16, 0, 0],
      shimmer: true,
    });
    const badgeGeo = new THREE.CylinderGeometry(0.22, 0.22, 0.04, 16);
    addPart(bodyPivot, badgeGeo, mats.white, {
      pos: [0, floorY + 0.45, 1.32],
      rot: [0.22, 0, 0],
    });

    // Front bumper winglet
    addPart(bodyPivot, new THREE.BoxGeometry(1.48, 0.10, 0.32), mats.secondary, {
      pos: [0, floorY + 0.10, 1.72],
      shimmer: true,
    });

    // Sidepods with air intake grilles & stripe panels
    for (const s of [1, -1]) {
      addPart(bodyPivot, new THREE.BoxGeometry(0.36, 0.34, 1.36), mats.paint, {
        pos: [s * 0.62, floorY + 0.20, -0.05],
        shimmer: true,
      });
      addPart(bodyPivot, new THREE.BoxGeometry(0.06, 0.16, 1.08), mats.stripes, {
        pos: [s * 0.81, floorY + 0.22, -0.04],
        shimmer: true,
      });
      addPart(bodyPivot, new THREE.BoxGeometry(0.26, 0.24, 0.08), mats.carbon, {
        pos: [s * 0.62, floorY + 0.21, 0.64],
      });
    }

    // Seat bucket + rear engine cowl
    addPart(bodyPivot, new THREE.BoxGeometry(0.68, 0.52, 0.14), mats.carbon, {
      pos: [0, floorY + 0.36, -0.52],
      rot: [-0.22, 0, 0],
    });
    addPart(bodyPivot, new THREE.BoxGeometry(0.84, 0.44, 0.82), mats.paint, {
      pos: [0, floorY + 0.26, -1.04],
      shimmer: true,
    });
    // Engine cooling block
    addPart(bodyPivot, new THREE.BoxGeometry(0.56, 0.24, 0.48), mats.gunmetal, {
      pos: [0, floorY + 0.50, -1.06],
    });
    // Rear spoiler
    addPart(bodyPivot, new THREE.BoxGeometry(1.36, 0.09, 0.28), mats.secondary, {
      pos: [0, floorY + 0.68, -1.46],
      rot: [-0.15, 0, 0],
      shimmer: true,
    });
    for (const s of [1, -1]) {
      addPart(bodyPivot, new THREE.BoxGeometry(0.08, 0.26, 0.20), mats.carbon, {
        pos: [s * 0.42, floorY + 0.54, -1.40],
      });
    }

    // Twin chrome exhaust pipes
    const pipeGeo = new THREE.CylinderGeometry(0.095, 0.075, 0.58, 12);
    pipeGeo.rotateX(Math.PI / 2 - 0.36);
    for (const s of [1, -1]) {
      addPart(bodyPivot, pipeGeo, mats.chrome, { pos: [s * 0.32, floorY + 0.46, -1.52] });
      addHeadlight(s * 0.36, floorY + 0.32, 1.62, 0.10);
      addTaillight(s * 0.30, floorY + 0.32, -1.48, 0.20, 0.08);
    }
    layout.exhaustTips = [
      [0.32, floorY + 0.56, -1.78],
      [-0.32, floorY + 0.56, -1.78],
    ];
  } else if (kartId === 'mach_8') {
    layout.frontAxleZ = 1.38;
    layout.rearAxleZ = -1.24;
    layout.frontHalfTrack = 1.02 + trackPad;
    layout.rearHalfTrack = 1.10 + trackPad;
    layout.seatPos = [0, floorY + 0.18, -0.18];

    // Needle-nose F1 monocoque
    const f1NoseGeo = createExtrudedProfile(
      [
        [0.10, 0.08],
        [2.05, 0.12],
        [1.92, 0.28],
        [0.95, 0.50],
        [-0.35, 0.56],
        [-1.55, 0.48],
        [-1.62, 0.06],
      ],
      0.66,
      0.03
    );
    addPart(bodyPivot, f1NoseGeo, mats.paint, { pos: [0, floorY, 0], shimmer: true });

    // Wide multi-plane F1 front wing + endplates
    addPart(bodyPivot, new THREE.BoxGeometry(1.94, 0.07, 0.36), mats.carbon, {
      pos: [0, floorY + 0.07, 1.88],
    });
    addPart(bodyPivot, new THREE.BoxGeometry(1.88, 0.06, 0.22), mats.accent, {
      pos: [0, floorY + 0.14, 1.78],
      rot: [0.16, 0, 0],
      shimmer: true,
    });
    for (const s of [1, -1]) {
      addPart(bodyPivot, new THREE.BoxGeometry(0.06, 0.24, 0.42), mats.secondary, {
        pos: [s * 0.96, floorY + 0.15, 1.86],
        shimmer: true,
      });
    }

    // Twin sleek jet-intake pods along sides
    const intakeTubeGeo = new THREE.CylinderGeometry(0.24, 0.20, 1.48, 16);
    intakeTubeGeo.rotateX(Math.PI / 2);
    const intakeRingGeo = new THREE.TorusGeometry(0.22, 0.04, 8, 16);
    for (const s of [1, -1]) {
      addPart(bodyPivot, intakeTubeGeo, mats.paint, {
        pos: [s * 0.56, floorY + 0.28, -0.35],
        shimmer: true,
      });
      addPart(bodyPivot, intakeRingGeo, mats.chrome, {
        pos: [s * 0.56, floorY + 0.28, 0.39],
      });
      // Turbine fan dark face & center cone
      const fanDisk = new THREE.CylinderGeometry(0.18, 0.18, 0.05, 12);
      fanDisk.rotateX(Math.PI / 2);
      addPart(bodyPivot, fanDisk, mats.carbon, { pos: [s * 0.56, floorY + 0.28, 0.36] });
      const cone = new THREE.ConeGeometry(0.08, 0.16, 10);
      cone.rotateX(Math.PI / 2);
      addPart(bodyPivot, cone, mats.accent, { pos: [s * 0.56, floorY + 0.28, 0.40], shimmer: true });
    }

    // Twin swept tail fins!
    const finGeo = createExtrudedProfile(
      [
        [-0.70, 0.42],
        [-1.30, 0.44],
        [-1.78, 1.02],
        [-1.42, 1.02],
      ],
      0.08,
      0.015
    );
    for (const s of [1, -1]) {
      addPart(bodyPivot, finGeo, mats.secondary, {
        pos: [s * 0.38, floorY + 0.02, 0],
        rot: [0, 0, s * -0.18],
        shimmer: true,
      });
      // Jet afterburner nozzles
      const burnerGeo = new THREE.CylinderGeometry(0.14, 0.18, 0.42, 14);
      burnerGeo.rotateX(Math.PI / 2);
      addPart(bodyPivot, burnerGeo, mats.gunmetal, { pos: [s * 0.28, floorY + 0.34, -1.52] });
      addHeadlight(s * 0.25, floorY + 0.30, 1.56, 0.09, true);
      addTaillight(s * 0.28, floorY + 0.22, -1.62, 0.22, 0.07);
    }

    // Center canopy cowl & seat back
    addPart(bodyPivot, new THREE.BoxGeometry(0.56, 0.48, 0.14), mats.carbon, {
      pos: [0, floorY + 0.36, -0.52],
      rot: [-0.25, 0, 0],
    });
    layout.exhaustTips = [
      [0.28, floorY + 0.34, -1.75],
      [-0.28, floorY + 0.34, -1.75],
    ];
  } else if (kartId === 'circuit_special') {
    layout.frontAxleZ = 1.42;
    layout.rearAxleZ = -1.30;
    layout.frontHalfTrack = 1.04 + trackPad;
    layout.rearHalfTrack = 1.12 + trackPad;
    layout.seatPos = [0, floorY + 0.18, -0.20];

    // Long sculpted Le Mans supercar body
    const superBodyGeo = createExtrudedProfile(
      [
        [-1.68, 0.06],
        [2.05, 0.08],
        [1.98, 0.26],
        [1.15, 0.46],
        [0.42, 0.48],
        [-0.25, 0.44],
        [-0.55, 0.62],
        [-1.64, 0.48],
      ],
      1.18,
      0.04
    );
    addPart(bodyPivot, superBodyGeo, mats.paint, { pos: [0, floorY, 0], shimmer: true });

    // Carbon front splitter & side aero skirts
    addPart(bodyPivot, new THREE.BoxGeometry(1.74, 0.07, 0.45), mats.carbon, {
      pos: [0, floorY + 0.04, 1.88],
    });
    for (const s of [1, -1]) {
      addPart(bodyPivot, new THREE.BoxGeometry(0.24, 0.10, 2.55), mats.carbon, {
        pos: [s * 0.72, floorY + 0.07, 0.10],
      });
      // Sculpted wheel arch aero fenders
      addPart(bodyPivot, new THREE.BoxGeometry(0.38, 0.24, 0.72), mats.paint, {
        pos: [s * 0.68, floorY + 0.30, 1.32],
        rot: [0.12, 0, 0],
        shimmer: true,
      });
      addPart(bodyPivot, new THREE.BoxGeometry(0.38, 0.28, 0.78), mats.paint, {
        pos: [s * 0.70, floorY + 0.34, -1.22],
        shimmer: true,
      });
      addPart(bodyPivot, new THREE.BoxGeometry(0.06, 0.10, 1.65), mats.stripes, {
        pos: [s * 0.63, floorY + 0.28, 0.10],
        shimmer: true,
      });
    }

    // Center hood racing stripe & sleek aero windscreen
    addPart(bodyPivot, new THREE.BoxGeometry(0.32, 0.03, 1.25), mats.accent, {
      pos: [0, floorY + 0.47, 1.15],
      rot: [0.14, 0, 0],
      shimmer: true,
    });
    addPart(bodyPivot, new THREE.BoxGeometry(0.78, 0.20, 0.24), mats.glass, {
      pos: [0, floorY + 0.54, 0.42],
      rot: [-0.55, 0, 0],
      castShadow: false,
    });

    // Wide carbon GT rear wing on swan-neck pylons
    addPart(bodyPivot, new THREE.BoxGeometry(2.04, 0.08, 0.40), mats.carbon, {
      pos: [0, floorY + 0.90, -1.52],
      rot: [-0.12, 0, 0],
    });
    addPart(bodyPivot, new THREE.BoxGeometry(1.98, 0.04, 0.12), mats.accent, {
      pos: [0, floorY + 0.94, -1.66],
      shimmer: true,
    });
    for (const s of [1, -1]) {
      addPart(bodyPivot, new THREE.BoxGeometry(0.06, 0.34, 0.46), mats.paint, {
        pos: [s * 1.02, floorY + 0.86, -1.52],
        shimmer: true,
      });
      addPart(bodyPivot, new THREE.BoxGeometry(0.07, 0.42, 0.24), mats.gunmetal, {
        pos: [s * 0.40, floorY + 0.68, -1.45],
        rot: [0.22, 0, 0],
      });
      // Exhaust pipes
      const exGeo = new THREE.CylinderGeometry(0.10, 0.09, 0.30, 12);
      exGeo.rotateX(Math.PI / 2);
      addPart(bodyPivot, exGeo, mats.chrome, { pos: [s * 0.36, floorY + 0.22, -1.68] });
      addHeadlight(s * 0.52, floorY + 0.28, 1.88, 0.11, true);
    }
    // Wide supercar tail light bar
    addTaillight(0, floorY + 0.38, -1.67, 1.10, 0.08);
    layout.exhaustTips = [
      [0.36, floorY + 0.22, -1.84],
      [-0.36, floorY + 0.22, -1.84],
    ];
  } else if (kartId === 'biddybuggy') {
    layout.frontAxleZ = 0.98;
    layout.rearAxleZ = -0.94;
    layout.frontHalfTrack = 0.88 + trackPad;
    layout.rearHalfTrack = 0.96 + trackPad;
    layout.chassisAttachX = 0.44;
    layout.seatPos = [0, floorY + 0.22, -0.14];
    layout.gliderAnchor = [0, floorY + 1.10, -0.35];

    // Rounded cute dome buggy shell
    const bellyGeo = new THREE.SphereGeometry(0.84, 18, 14);
    addPart(bodyPivot, bellyGeo, mats.secondary, {
      pos: [0, floorY + 0.22, 0.04],
      scale: [0.95, 0.46, 1.48],
      shimmer: true,
    });
    const upperShellGeo = new THREE.SphereGeometry(0.78, 18, 14, 0, Math.PI * 2, 0, Math.PI * 0.56);
    addPart(bodyPivot, upperShellGeo, mats.paint, {
      pos: [0, floorY + 0.24, 0.04],
      scale: [0.94, 0.62, 1.44],
      shimmer: true,
    });
    // Cute polka spots on hood & rear shell
    const spotGeo = new THREE.CylinderGeometry(0.14, 0.14, 0.04, 12);
    addPart(bodyPivot, spotGeo, mats.accent, {
      pos: [0.30, floorY + 0.60, 0.72],
      rot: [0.42, 0, -0.35],
      shimmer: true,
    });
    addPart(bodyPivot, spotGeo, mats.accent, {
      pos: [-0.30, floorY + 0.60, 0.72],
      rot: [0.42, 0, 0.35],
      shimmer: true,
    });

    // Twin protruding bug-eyed dome headlights on stalks!
    const stalkGeo = new THREE.CylinderGeometry(0.055, 0.065, 0.24, 8);
    const eyeShellGeo = new THREE.SphereGeometry(0.19, 14, 12);
    const eyeGlowGeo = new THREE.SphereGeometry(0.13, 12, 10);
    for (const s of [1, -1]) {
      addPart(bodyPivot, stalkGeo, mats.chrome, {
        pos: [s * 0.34, floorY + 0.56, 0.88],
        rot: [0.35, 0, -s * 0.22],
      });
      addPart(bodyPivot, eyeShellGeo, mats.white, {
        pos: [s * 0.38, floorY + 0.68, 0.96],
      });
      addPart(bodyPivot, eyeGlowGeo, mats.headlight, {
        pos: [s * 0.38, floorY + 0.68, 1.05],
        castShadow: false,
      });
    }

    // Cheeky rear seat backrest + curved bumper + spring antenna
    addPart(bodyPivot, new THREE.CylinderGeometry(0.36, 0.40, 0.44, 14), mats.carbon, {
      pos: [0, floorY + 0.40, -0.50],
      scale: [1, 1, 0.45],
    });
    const rearLoopGeo = new THREE.TorusGeometry(0.45, 0.06, 8, 14, Math.PI);
    addPart(bodyPivot, rearLoopGeo, mats.chrome, {
      pos: [0, floorY + 0.28, -1.16],
      rot: [Math.PI / 2, 0, 0],
    });

    // Twin upturned stubby exhausts
    const stubPipe = new THREE.CylinderGeometry(0.085, 0.065, 0.40, 10);
    stubPipe.rotateX(Math.PI / 2 - 0.55);
    for (const s of [1, -1]) {
      addPart(bodyPivot, stubPipe, mats.chrome, { pos: [s * 0.30, floorY + 0.42, -1.14] });
      addTaillight(s * 0.26, floorY + 0.32, -1.18, 0.16, 0.09);
    }
    // Cute whip antenna
    addPart(bodyPivot, new THREE.CylinderGeometry(0.02, 0.02, 0.52, 6), mats.chrome, {
      pos: [0.36, floorY + 0.72, -0.82],
      rot: [-0.22, 0, -0.12],
    });
    addPart(bodyPivot, new THREE.SphereGeometry(0.07, 10, 8), mats.accent, {
      pos: [0.40, floorY + 0.98, -0.88],
      shimmer: true,
    });

    layout.exhaustTips = [
      [0.30, floorY + 0.54, -1.32],
      [-0.30, floorY + 0.54, -1.32],
    ];
  } else if (kartId === 'badwagon') {
    layout.frontAxleZ = 1.28;
    layout.rearAxleZ = -1.20;
    layout.frontHalfTrack = 1.06 + trackPad;
    layout.rearHalfTrack = 1.18 + trackPad;
    layout.chassisAttachX = 0.62;
    layout.seatPos = [0, floorY + 0.24, -0.26];

    // Wide muscular boxy hot-rod body
    addPart(bodyPivot, new THREE.BoxGeometry(1.48, 0.36, 3.05), mats.paint, {
      pos: [0, floorY + 0.20, 0.05],
      shimmer: true,
    });
    // Heavy chrome front bumper + classic slatted muscle grille
    addPart(bodyPivot, new THREE.BoxGeometry(1.62, 0.14, 0.18), mats.chrome, {
      pos: [0, floorY + 0.10, 1.66],
    });
    addPart(bodyPivot, new THREE.BoxGeometry(1.10, 0.26, 0.10), mats.carbon, {
      pos: [0, floorY + 0.26, 1.59],
    });
    for (let i = -3; i <= 3; i++) {
      addPart(bodyPivot, new THREE.BoxGeometry(0.04, 0.24, 0.12), mats.chrome, {
        pos: [i * 0.14, floorY + 0.26, 1.60],
      });
    }

    // Flared wide fenders
    for (const s of [1, -1]) {
      addPart(bodyPivot, new THREE.BoxGeometry(0.24, 0.22, 0.78), mats.secondary, {
        pos: [s * 0.80, floorY + 0.30, 1.15],
        shimmer: true,
      });
      addPart(bodyPivot, new THREE.BoxGeometry(0.26, 0.26, 0.88), mats.secondary, {
        pos: [s * 0.82, floorY + 0.34, -1.06],
        shimmer: true,
      });
      addPart(bodyPivot, new THREE.BoxGeometry(0.06, 0.12, 1.48), mats.stripes, {
        pos: [s * 0.76, floorY + 0.26, 0.05],
        shimmer: true,
      });
    }

    // Iconic V8 supercharger blower + triple intake scoop on hood!
    addPart(bodyPivot, new THREE.BoxGeometry(0.56, 0.28, 0.62), mats.chrome, {
      pos: [0, floorY + 0.48, 0.90],
    });
    addPart(bodyPivot, new THREE.BoxGeometry(0.62, 0.20, 0.48), mats.accent, {
      pos: [0, floorY + 0.68, 0.94],
      shimmer: true,
    });
    const barrelGeo = new THREE.CylinderGeometry(0.07, 0.07, 0.12, 10);
    barrelGeo.rotateX(Math.PI / 2);
    for (const bx of [-0.18, 0, 0.18]) {
      addPart(bodyPivot, barrelGeo, mats.carbon, { pos: [bx, floorY + 0.68, 1.18] });
    }

    // Ducktail spoiler & seat back
    addPart(bodyPivot, new THREE.BoxGeometry(0.76, 0.52, 0.14), mats.carbon, {
      pos: [0, floorY + 0.42, -0.58],
      rot: [-0.20, 0, 0],
    });
    addPart(bodyPivot, new THREE.BoxGeometry(1.52, 0.20, 0.18), mats.paint, {
      pos: [0, floorY + 0.50, -1.48],
      rot: [-0.42, 0, 0],
      shimmer: true,
    });

    // Quad megaphone exhausts (2 per side!)
    const megaGeo = new THREE.CylinderGeometry(0.095, 0.065, 0.62, 12);
    megaGeo.rotateX(Math.PI / 2 - 0.22);
    for (const s of [1, -1]) {
      addPart(bodyPivot, megaGeo, mats.chrome, { pos: [s * 0.48, floorY + 0.36, -1.56] });
      addPart(bodyPivot, megaGeo, mats.chrome, { pos: [s * 0.66, floorY + 0.36, -1.52] });
      addHeadlight(s * 0.56, floorY + 0.28, 1.60, 0.09);
      addHeadlight(s * 0.38, floorY + 0.28, 1.60, 0.08);
      addTaillight(s * 0.48, floorY + 0.26, -1.50, 0.32, 0.11);
    }
    layout.exhaustTips = [
      [0.57, floorY + 0.43, -1.84],
      [-0.57, floorY + 0.43, -1.84],
    ];
  } else if (kartId === 'cyber_comet') {
    layout.frontAxleZ = 1.32;
    layout.rearAxleZ = -1.24;
    layout.frontHalfTrack = 1.00 + trackPad;
    layout.rearHalfTrack = 1.08 + trackPad;
    layout.seatPos = [0, floorY + 0.20, -0.20];

    // Angular wedge stealth hull
    const wedgeGeo = createExtrudedProfile(
      [
        [-1.60, 0.08],
        [1.96, 0.12],
        [1.76, 0.34],
        [0.58, 0.54],
        [-0.36, 0.42],
        [-0.65, 0.64],
        [-1.56, 0.46],
      ],
      1.04,
      0.03
    );
    addPart(bodyPivot, wedgeGeo, mats.paint, { pos: [0, floorY, 0], shimmer: true });

    // Carbon armored lower hover-skirt
    addPart(bodyPivot, new THREE.BoxGeometry(1.36, 0.12, 3.12), mats.carbon, {
      pos: [0, floorY + 0.06, 0.10],
    });

    // Continuous glowing neon energy strips along sides & nose
    addPart(bodyPivot, new THREE.BoxGeometry(1.40, 0.055, 0.08), mats.neon, {
      pos: [0, floorY + 0.14, 1.72],
      castShadow: false,
    });
    for (const s of [1, -1]) {
      addPart(bodyPivot, new THREE.BoxGeometry(0.06, 0.055, 2.92), mats.neon, {
        pos: [s * 0.70, floorY + 0.14, 0.12],
        castShadow: false,
      });
      // Swept hover-pod side blades
      addPart(bodyPivot, new THREE.BoxGeometry(0.24, 0.16, 1.75), mats.gunmetal, {
        pos: [s * 0.64, floorY + 0.28, -0.10],
        rot: [0, s * -0.06, s * 0.20],
      });
      // Twin split V-fins at rear
      addPart(bodyPivot, new THREE.BoxGeometry(0.08, 0.46, 0.62), mats.paint, {
        pos: [s * 0.58, floorY + 0.56, -1.28],
        rot: [-0.28, 0, s * -0.38],
        shimmer: true,
      });
      addPart(bodyPivot, new THREE.BoxGeometry(0.09, 0.06, 0.64), mats.neon, {
        pos: [s * 0.66, floorY + 0.74, -1.32],
        rot: [-0.28, 0, s * -0.38],
        castShadow: false,
      });
      // Hexagonal plasma thruster nozzles
      const thrusterGeo = new THREE.CylinderGeometry(0.16, 0.13, 0.34, 6);
      thrusterGeo.rotateX(Math.PI / 2);
      addPart(bodyPivot, thrusterGeo, mats.gunmetal, { pos: [s * 0.34, floorY + 0.30, -1.58] });
      addPart(bodyPivot, new THREE.CylinderGeometry(0.11, 0.11, 0.05, 6), mats.neon, {
        pos: [s * 0.34, floorY + 0.30, -1.73],
        rot: [Math.PI / 2, 0, 0],
        castShadow: false,
      });
    }

    // Glowing front laser visor & rear chevron tail bar
    addPart(bodyPivot, new THREE.BoxGeometry(0.96, 0.07, 0.10), mats.headlight, {
      pos: [0, floorY + 0.31, 1.72],
      castShadow: false,
    });
    addTaillight(0, floorY + 0.40, -1.58, 0.92, 0.07);
    layout.exhaustTips = [
      [0.34, floorY + 0.30, -1.77],
      [-0.34, floorY + 0.30, -1.77],
    ];
  } else if (kartId === 'dune_buggy') {
    layout.frontAxleZ = 1.32;
    layout.rearAxleZ = -1.22;
    layout.frontHalfTrack = 1.04 + trackPad;
    layout.rearHalfTrack = 1.12 + trackPad;
    layout.seatPos = [0, floorY + 0.24, -0.18];
    layout.gliderAnchor = [0, floorY + 1.48, -0.35];

    // Rugged skid-plate & open floor tub
    addPart(bodyPivot, new THREE.BoxGeometry(1.14, 0.14, 2.55), mats.carbon, {
      pos: [0, floorY, 0.04],
    });
    addPart(bodyPivot, new THREE.BoxGeometry(0.88, 0.10, 0.72), mats.gunmetal, {
      pos: [0, floorY + 0.14, 1.48],
      rot: [-0.42, 0, 0],
    });
    // Painted hood cowl & rear side plates
    addPart(bodyPivot, new THREE.BoxGeometry(0.96, 0.24, 1.05), mats.paint, {
      pos: [0, floorY + 0.24, 0.92],
      rot: [0.12, 0, 0],
      shimmer: true,
    });
    for (const s of [1, -1]) {
      addPart(bodyPivot, new THREE.BoxGeometry(0.14, 0.34, 1.35), mats.paint, {
        pos: [s * 0.56, floorY + 0.24, -0.25],
        shimmer: true,
      });
    }

    // Full tubular steel roll-cage framing cockpit!
    const tubeMat = mats.accent;
    const addCageBar = (
      x1: number,
      y1: number,
      z1: number,
      x2: number,
      y2: number,
      z2: number,
      rad = 0.048
    ): void => {
      const dx = x2 - x1;
      const dy = y2 - y1;
      const dz = z2 - z1;
      const len = Math.sqrt(dx * dx + dy * dy + dz * dz);
      const barGeo = new THREE.CylinderGeometry(rad, rad, len, 8);
      const q = new THREE.Quaternion().setFromUnitVectors(
        new THREE.Vector3(0, 1, 0),
        new THREE.Vector3(dx, dy, dz).normalize()
      );
      const m = addPart(bodyPivot, barGeo, tubeMat, {
        pos: [(x1 + x2) * 0.5, (y1 + y2) * 0.5, (z1 + z2) * 0.5],
        shimmer: true,
      });
      m.quaternion.copy(q);
    };

    const yBot = floorY + 0.32;
    const yTop = floorY + 1.36;
    for (const s of [1, -1]) {
      // Front A-pillars
      addCageBar(s * 0.50, yBot, 0.85, s * 0.42, yTop, 0.08);
      // Roof side rails
      addCageBar(s * 0.42, yTop, 0.08, s * 0.44, yTop, -0.78);
      // Rear B-pillars & rear diagonal engine struts
      addCageBar(s * 0.44, yTop, -0.78, s * 0.52, yBot, -0.75);
      addCageBar(s * 0.44, yTop, -0.78, s * 0.46, floorY + 0.34, -1.48);
      // Side sill bars
      addCageBar(s * 0.52, yBot + 0.04, 0.85, s * 0.54, yBot + 0.04, -0.78);
    }
    // Crossbars + roof lightbar mount
    addCageBar(-0.42, yTop, 0.08, 0.42, yTop, 0.08);
    addCageBar(-0.44, yTop, -0.78, 0.44, yTop, -0.78);
    addCageBar(-0.48, floorY + 0.34, -1.48, 0.48, floorY + 0.34, -1.48, 0.055);

    // 4-Pod overhead rally lightbar!
    for (const lx of [-0.30, -0.10, 0.10, 0.30]) {
      addHeadlight(lx, yTop + 0.09, 0.10, 0.075);
    }
    // Front caged rally lights
    for (const s of [1, -1]) {
      addHeadlight(s * 0.30, floorY + 0.38, 1.44, 0.11);
      addTaillight(s * 0.32, floorY + 0.34, -1.48, 0.18, 0.09);
    }

    // Exposed rear desert engine block + twin upright rally exhaust stacks
    addPart(bodyPivot, new THREE.BoxGeometry(0.66, 0.36, 0.58), mats.gunmetal, {
      pos: [0, floorY + 0.28, -1.10],
    });
    const stackGeo = new THREE.CylinderGeometry(0.075, 0.065, 0.54, 10);
    stackGeo.rotateX(Math.PI / 2 - 0.65);
    for (const s of [1, -1]) {
      addPart(bodyPivot, stackGeo, mats.chrome, { pos: [s * 0.36, floorY + 0.48, -1.42] });
    }
    layout.exhaustTips = [
      [0.36, floorY + 0.64, -1.62],
      [-0.36, floorY + 0.64, -1.62],
    ];
  } else {
    // 'royal_sovereign' — Sculpted luxury coupe w/ gold crest grille
    layout.frontAxleZ = 1.38;
    layout.rearAxleZ = -1.26;
    layout.frontHalfTrack = 1.02 + trackPad;
    layout.rearHalfTrack = 1.08 + trackPad;
    layout.seatPos = [0, floorY + 0.22, -0.24];

    // Flowing sculpted coupe hull
    const coupeGeo = createExtrudedProfile(
      [
        [-1.65, 0.08],
        [1.96, 0.10],
        [1.94, 0.44],
        [0.62, 0.56],
        [-0.30, 0.40],
        [-0.62, 0.62],
        [-1.62, 0.38],
      ],
      1.10,
      0.05
    );
    addPart(bodyPivot, coupeGeo, mats.paint, { pos: [0, floorY, 0], shimmer: true });

    // Sweeping front & rear pontoon fenders + gold trim spear
    for (const s of [1, -1]) {
      addPart(bodyPivot, new THREE.BoxGeometry(0.30, 0.28, 1.05), mats.paint, {
        pos: [s * 0.68, floorY + 0.26, 1.18],
        shimmer: true,
      });
      addPart(bodyPivot, new THREE.BoxGeometry(0.32, 0.30, 1.08), mats.paint, {
        pos: [s * 0.70, floorY + 0.28, -1.06],
        shimmer: true,
      });
      addPart(bodyPivot, new THREE.BoxGeometry(0.05, 0.07, 2.72), mats.gold, {
        pos: [s * 0.60, floorY + 0.34, 0.12],
      });
    }

    // Tall vertical gold-crested radiator grille at nose + golden hood ornament!
    addPart(bodyPivot, new THREE.BoxGeometry(0.68, 0.44, 0.12), mats.gold, {
      pos: [0, floorY + 0.30, 1.98],
    });
    addPart(bodyPivot, new THREE.BoxGeometry(0.54, 0.36, 0.14), mats.carbon, {
      pos: [0, floorY + 0.30, 1.99],
    });
    for (let i = -2; i <= 2; i++) {
      addPart(bodyPivot, new THREE.BoxGeometry(0.035, 0.34, 0.15), mats.gold, {
        pos: [i * 0.10, floorY + 0.30, 2.00],
      });
    }
    // Hood ornament (miniature winged gold crown crest)
    addPart(bodyPivot, new THREE.CylinderGeometry(0.08, 0.05, 0.12, 6), mats.gold, {
      pos: [0, floorY + 0.60, 1.90],
    });
    addPart(bodyPivot, new THREE.BoxGeometry(0.22, 0.04, 0.06), mats.gold, {
      pos: [0, floorY + 0.64, 1.88],
    });

    // Plush leather cockpit trim bolster + chrome windscreen frame
    addPart(bodyPivot, new THREE.BoxGeometry(0.84, 0.14, 0.90), mats.leather, {
      pos: [0, floorY + 0.48, -0.22],
    });
    addPart(bodyPivot, new THREE.BoxGeometry(0.82, 0.18, 0.18), mats.glass, {
      pos: [0, floorY + 0.56, 0.42],
      rot: [-0.45, 0, 0],
      castShadow: false,
    });

    // Twin gold-tipped exhausts + classic headlights & ruby taillights
    const royalPipe = new THREE.CylinderGeometry(0.085, 0.085, 0.46, 12);
    royalPipe.rotateX(Math.PI / 2);
    for (const s of [1, -1]) {
      addPart(bodyPivot, royalPipe, mats.gold, { pos: [s * 0.34, floorY + 0.22, -1.62] });
      addHeadlight(s * 0.52, floorY + 0.34, 1.86, 0.12);
      addTaillight(s * 0.44, floorY + 0.32, -1.64, 0.18, 0.12);
    }
    layout.exhaustTips = [
      [0.34, floorY + 0.22, -1.86],
      [-0.34, floorY + 0.22, -1.86],
    ];
  }

  return layout;
}

/**
 * Builds the seated 3D driver, steering wheel/arms pivot, and character-specific headgear.
 */
function buildDriver(
  charDef: Partial<CharacterDef> | null | undefined,
  seatPos: [number, number, number],
  mats: KartMats,
  addPart: AddPartFn,
  parentGroup: THREE.Object3D
): { driverGroup: THREE.Group; headPivot: THREE.Group; armsPivot: THREE.Group } {
  const [sx, sy, sz] = seatPos;
  const driverGroup = new THREE.Group();
  driverGroup.position.set(sx, sy, sz);
  parentGroup.add(driverGroup);

  const isHeavy = charDef?.weightClass === 'Heavy';
  const isLight = charDef?.weightClass === 'Light';
  const scaleFactor = isHeavy ? 1.12 : isLight ? 0.90 : 1.0;
  driverGroup.scale.setScalar(scaleFactor);

  // Seated hips & knees
  addPart(driverGroup, new THREE.BoxGeometry(0.46, 0.18, 0.36), mats.charSecondary, {
    pos: [0, 0.09, 0.08],
    shimmer: true,
  });
  for (const s of [1, -1]) {
    addPart(driverGroup, new THREE.CapsuleGeometry(0.095, 0.22, 4, 8), mats.charSecondary, {
      pos: [s * 0.15, 0.10, 0.32],
      rot: [Math.PI / 2 - 0.15, 0, 0],
      shimmer: true,
    });
    // Racing boots
    addPart(driverGroup, new THREE.BoxGeometry(0.14, 0.13, 0.20), mats.leather, {
      pos: [s * 0.15, 0.08, 0.52],
    });
  }

  // Torso (suit / overalls / armor / fur)
  const torsoGeo = new THREE.CapsuleGeometry(0.22, 0.26, 6, 12);
  addPart(driverGroup, torsoGeo, mats.charPrimary, {
    pos: [0, 0.36, 0.0],
    scale: [1.05, 1.0, 0.85],
    shimmer: true,
  });
  // Overalls / vest / armor front panel
  addPart(driverGroup, new THREE.BoxGeometry(0.36, 0.32, 0.26), mats.charSecondary, {
    pos: [0, 0.31, 0.06],
    shimmer: true,
  });

  // Character-specific torso accessories
  const headgear = charDef?.headgear || 'cap_m';
  if (headgear === 'cap_m' || headgear === 'cap_l') {
    // Classic twin gold overall buttons
    for (const s of [1, -1]) {
      addPart(driverGroup, new THREE.SphereGeometry(0.04, 8, 6), mats.gold, {
        pos: [s * 0.10, 0.40, 0.20],
      });
    }
  } else if (headgear === 'dragon_helm') {
    // Heavy spiked back carapace shell!
    addPart(driverGroup, new THREE.SphereGeometry(0.32, 12, 10), mats.charSecondary, {
      pos: [0, 0.38, -0.20],
      scale: [0.95, 1.08, 0.65],
      shimmer: true,
    });
    const spikeGeo = new THREE.ConeGeometry(0.065, 0.16, 6);
    const spikeCoords: Array<[number, number, number, number]> = [
      [0, 0.54, -0.34, -0.8],
      [0, 0.36, -0.38, -1.4],
      [0.18, 0.42, -0.32, -1.1],
      [-0.18, 0.42, -0.32, -1.1],
    ];
    for (const [px, py, pz, rx] of spikeCoords) {
      addPart(driverGroup, spikeGeo, mats.white, { pos: [px, py, pz], rot: [rx, 0, 0] });
    }
  } else if (headgear === 'shades_tie') {
    // Konga's crimson power necktie!
    addPart(driverGroup, new THREE.BoxGeometry(0.11, 0.28, 0.05), mats.charSecondary, {
      pos: [0, 0.32, 0.21],
    });
    addPart(driverGroup, new THREE.ConeGeometry(0.075, 0.11, 4), mats.charSecondary, {
      pos: [0, 0.14, 0.21],
      rot: [Math.PI, Math.PI / 4, 0],
    });
  } else if (headgear === 'star_tiara') {
    // Nova's flowing cosmic star cape + chest star brooch
    addPart(driverGroup, new THREE.BoxGeometry(0.50, 0.46, 0.06), mats.charSecondary, {
      pos: [0, 0.36, -0.22],
      rot: [0.32, 0, 0],
      shimmer: true,
    });
    addPart(driverGroup, new THREE.OctahedronGeometry(0.07, 0), mats.gold, {
      pos: [0, 0.44, 0.20],
    });
  } else if (headgear === 'crest_goggles') {
    // Yoshiro's back dino shell/ridges
    for (let i = 0; i < 3; i++) {
      addPart(driverGroup, new THREE.ConeGeometry(0.06, 0.14, 5), mats.charSecondary, {
        pos: [0, 0.50 - i * 0.12, -0.20 - i * 0.02],
        rot: [-1.2, 0, 0],
      });
    }
  }

  // Tilted steering shaft + armsPivot (rotates steering wheel + forearms/gloves cleanly)
  const steerMount = new THREE.Group();
  steerMount.position.set(0, 0.42, 0.48);
  steerMount.rotation.x = -0.45;
  driverGroup.add(steerMount);

  // Steering column shaft
  addPart(steerMount, new THREE.CylinderGeometry(0.032, 0.038, 0.34, 8), mats.gunmetal, {
    pos: [0, 0, -0.14],
    rot: [Math.PI / 2, 0, 0],
  });

  const armsPivot = new THREE.Group();
  steerMount.add(armsPivot);

  // Racing steering wheel ring + spokes
  addPart(armsPivot, new THREE.TorusGeometry(0.17, 0.026, 8, 18), mats.carbon, {
    pos: [0, 0, 0],
  });
  addPart(armsPivot, new THREE.BoxGeometry(0.32, 0.04, 0.025), mats.accent, {
    pos: [0, 0, 0],
    shimmer: true,
  });
  addPart(armsPivot, new THREE.BoxGeometry(0.04, 0.16, 0.025), mats.gunmetal, {
    pos: [0, -0.07, 0],
  });

  // Driver forearms & gloved hands gripping steering wheel
  for (const s of [1, -1]) {
    addPart(armsPivot, new THREE.SphereGeometry(0.068, 10, 8), mats.white, {
      pos: [s * 0.16, 0.02, -0.01],
    });
    addPart(armsPivot, new THREE.CapsuleGeometry(0.052, 0.24, 4, 8), mats.charPrimary, {
      pos: [s * 0.21, 0.02, -0.18],
      rot: [Math.PI / 2 - 0.12, -s * 0.26, 0],
      shimmer: true,
    });
  }

  // Head pivot (turns smoothly into corners!)
  const headPivot = new THREE.Group();
  headPivot.position.set(0, 0.66, -0.01);
  driverGroup.add(headPivot);

  // Base head sphere
  const headGeo = new THREE.SphereGeometry(0.24, 16, 14);
  addPart(headPivot, headGeo, mats.skin, { pos: [0, 0.14, 0], scale: [1, 0.96, 1.02] });

  // Ears
  for (const s of [1, -1]) {
    addPart(headPivot, new THREE.SphereGeometry(0.06, 8, 8), mats.skin, {
      pos: [s * 0.23, 0.13, -0.01],
      scale: [0.5, 1.0, 0.8],
    });
  }

  // Eyes (left & right)
  for (const s of [1, -1]) {
    addPart(headPivot, new THREE.SphereGeometry(0.045, 8, 8), mats.white, {
      pos: [s * 0.088, 0.16, 0.20],
      scale: [0.85, 1.15, 0.55],
      castShadow: false,
    });
    addPart(headPivot, new THREE.SphereGeometry(0.026, 8, 8), mats.carbon, {
      pos: [s * 0.088, 0.16, 0.225],
      scale: [0.85, 1.1, 0.5],
      castShadow: false,
    });
  }

  // Nose / Snout + Headgear per character
  if (headgear === 'cap_m' || headgear === 'cap_l') {
    // Nose + iconic mustache
    addPart(headPivot, new THREE.SphereGeometry(0.068, 10, 8), mats.skin, {
      pos: [0, 0.10, 0.24],
    });
    addPart(headPivot, new THREE.BoxGeometry(0.22, 0.055, 0.07), mats.hairDark, {
      pos: [0, 0.055, 0.22],
      scale: [1, 0.85, 1],
    });
    // Racing cap dome + visor brim
    addPart(headPivot, new THREE.SphereGeometry(0.255, 14, 10, 0, Math.PI * 2, 0, Math.PI * 0.55), mats.charPrimary, {
      pos: [0, 0.17, -0.01],
      rot: [-0.15, 0, 0],
      shimmer: true,
    });
    const brimGeo = new THREE.CylinderGeometry(0.23, 0.24, 0.04, 14, 1, false, -Math.PI * 0.42, Math.PI * 0.84);
    addPart(headPivot, brimGeo, mats.charPrimary, {
      pos: [0, 0.22, 0.16],
      rot: [0.18, 0, 0],
      shimmer: true,
    });
    // White front emblem circle
    const badge = new THREE.CylinderGeometry(0.085, 0.085, 0.04, 12);
    badge.rotateX(Math.PI / 2);
    addPart(headPivot, badge, mats.white, { pos: [0, 0.30, 0.22] });
    // Bold 3D 'M' or 'L' emblem strokes
    if (headgear === 'cap_m') {
      addPart(headPivot, new THREE.BoxGeometry(0.022, 0.08, 0.02), mats.charPrimary, { pos: [-0.036, 0.30, 0.24] });
      addPart(headPivot, new THREE.BoxGeometry(0.022, 0.08, 0.02), mats.charPrimary, { pos: [0.036, 0.30, 0.24] });
      addPart(headPivot, new THREE.BoxGeometry(0.02, 0.06, 0.02), mats.charPrimary, {
        pos: [-0.015, 0.31, 0.24],
        rot: [0, 0, -0.52],
      });
      addPart(headPivot, new THREE.BoxGeometry(0.02, 0.06, 0.02), mats.charPrimary, {
        pos: [0.015, 0.31, 0.24],
        rot: [0, 0, 0.52],
      });
    } else {
      addPart(headPivot, new THREE.BoxGeometry(0.024, 0.085, 0.02), mats.charPrimary, { pos: [-0.02, 0.30, 0.24] });
      addPart(headPivot, new THREE.BoxGeometry(0.065, 0.024, 0.02), mats.charPrimary, { pos: [0.005, 0.268, 0.24] });
    }
  } else if (headgear === 'crown') {
    // Princess Aria: golden hair curls + jeweled crown
    addPart(headPivot, new THREE.SphereGeometry(0.255, 14, 12), mats.hairGold, {
      pos: [0, 0.16, -0.04],
    });
    addPart(headPivot, new THREE.ConeGeometry(0.18, 0.38, 10), mats.hairGold, {
      pos: [0, -0.02, -0.20],
      rot: [Math.PI + 0.25, 0, 0],
    });
    // Crown band + 5 gold points + sapphire/ruby gems
    addPart(headPivot, new THREE.CylinderGeometry(0.14, 0.12, 0.09, 12), mats.gold, {
      pos: [0, 0.40, 0.01],
    });
    for (let i = 0; i < 5; i++) {
      const a = (i / 5) * Math.PI * 2;
      addPart(headPivot, new THREE.ConeGeometry(0.035, 0.10, 5), mats.gold, {
        pos: [Math.sin(a) * 0.11, 0.48, Math.cos(a) * 0.11 + 0.01],
      });
    }
    addPart(headPivot, new THREE.OctahedronGeometry(0.035, 0), mats.charAccent, {
      pos: [0, 0.42, 0.14],
    });
  } else if (headgear === 'dragon_helm') {
    // Rexor: horned dragon helm + fierce reptilian snout
    addPart(headPivot, new THREE.BoxGeometry(0.26, 0.16, 0.24), mats.skin, {
      pos: [0, 0.08, 0.20],
    });
    // Helm dome + crimson crest + twin curved ivory horns
    addPart(headPivot, new THREE.SphereGeometry(0.265, 14, 10, 0, Math.PI * 2, 0, Math.PI * 0.62), mats.charPrimary, {
      pos: [0, 0.17, -0.01],
      shimmer: true,
    });
    addPart(headPivot, new THREE.BoxGeometry(0.07, 0.14, 0.30), mats.charAccent, {
      pos: [0, 0.42, 0.0],
      shimmer: true,
    });
    for (const s of [1, -1]) {
      addPart(headPivot, new THREE.ConeGeometry(0.055, 0.24, 8), mats.white, {
        pos: [s * 0.22, 0.36, 0.02],
        rot: [0.2, 0, -s * 0.72],
      });
    }
  } else if (headgear === 'mushroom_cap') {
    // Toady: oversized cream mushroom cap with 5 bold red spots!
    addPart(headPivot, new THREE.SphereGeometry(0.36, 16, 14), mats.white, {
      pos: [0, 0.34, -0.02],
      scale: [1.10, 0.84, 1.08],
    });
    const spotPositions: Array<[number, number, number]> = [
      [0, 0.56, 0.16],
      [0.27, 0.38, 0.14],
      [-0.27, 0.38, 0.14],
      [0.22, 0.40, -0.22],
      [-0.22, 0.40, -0.22],
    ];
    for (const [sx2, sy2, sz2] of spotPositions) {
      addPart(headPivot, new THREE.SphereGeometry(0.11, 10, 8), mats.charAccent, {
        pos: [sx2, sy2, sz2],
        shimmer: true,
      });
    }
  } else if (headgear === 'crest_goggles') {
    // Yoshiro: elongated dino snout + emerald spine crest + amber aviator goggles!
    addPart(headPivot, new THREE.SphereGeometry(0.17, 12, 10), mats.skin, {
      pos: [0, 0.08, 0.22],
      scale: [1.05, 0.85, 1.28],
    });
    for (let i = 0; i < 3; i++) {
      addPart(headPivot, new THREE.ConeGeometry(0.055, 0.14, 6), mats.charSecondary, {
        pos: [0, 0.40 - i * 0.06, 0.02 - i * 0.15],
        rot: [-0.35 - i * 0.45, 0, 0],
      });
    }
    // Goggle strap + twin amber lenses on brow
    addPart(headPivot, new THREE.TorusGeometry(0.245, 0.025, 6, 16), mats.carbon, {
      pos: [0, 0.24, -0.01],
      rot: [Math.PI / 2, 0, 0],
    });
    for (const s of [1, -1]) {
      const lensRing = new THREE.CylinderGeometry(0.075, 0.075, 0.06, 10);
      lensRing.rotateX(Math.PI / 2);
      addPart(headPivot, lensRing, mats.charAccent, { pos: [s * 0.10, 0.26, 0.21] });
    }
  } else if (headgear === 'shades_tie') {
    // Konga: sculpted tan muzzle + dark swept hair tuft + cool black sunglasses
    addPart(headPivot, new THREE.SphereGeometry(0.15, 12, 10), mats.skin, {
      pos: [0, 0.06, 0.20],
      scale: [1.15, 0.85, 0.95],
    });
    addPart(headPivot, new THREE.SphereGeometry(0.25, 14, 12), mats.charPrimary, {
      pos: [0, 0.16, -0.02],
      shimmer: true,
    });
    // Swept ape crest tuft
    addPart(headPivot, new THREE.ConeGeometry(0.11, 0.20, 7), mats.charPrimary, {
      pos: [0, 0.42, 0.04],
      rot: [0.35, 0, 0],
    });
    // Jet-black aviator sunglasses
    addPart(headPivot, new THREE.BoxGeometry(0.32, 0.03, 0.04), mats.chrome, {
      pos: [0, 0.19, 0.22],
    });
    for (const s of [1, -1]) {
      addPart(headPivot, new THREE.BoxGeometry(0.12, 0.085, 0.05), mats.charAccent, {
        pos: [s * 0.09, 0.16, 0.23],
      });
    }
  } else {
    // 'star_tiara' (Nova): platinum bangs + silver celestial tiara + 3D star
    addPart(headPivot, new THREE.SphereGeometry(0.255, 14, 12), mats.hairPlat, {
      pos: [0, 0.16, -0.04],
    });
    addPart(headPivot, new THREE.ConeGeometry(0.16, 0.34, 10), mats.hairPlat, {
      pos: [0, -0.02, -0.20],
      rot: [Math.PI + 0.25, 0, 0],
    });
    // Tiara arc + central glowing silver-gold star
    addPart(headPivot, new THREE.TorusGeometry(0.15, 0.025, 8, 16, Math.PI), mats.chrome, {
      pos: [0, 0.35, 0.06],
      rot: [-0.35, 0, 0],
    });
    addPart(headPivot, new THREE.OctahedronGeometry(0.065, 0), mats.gold, {
      pos: [0, 0.44, 0.12],
    });
  }

  return { driverGroup, headPivot, armsPivot };
}

/**
 * Builds the deployable 3D hang-glider wing with folding left & right wing pivots.
 */
function buildGlider(
  anchorPos: [number, number, number],
  mats: KartMats,
  addPart: AddPartFn,
  parentGroup: THREE.Object3D
): { gliderGroup: THREE.Group; leftWingPivot: THREE.Group; rightWingPivot: THREE.Group } {
  const gliderGroup = new THREE.Group();
  gliderGroup.position.set(anchorPos[0], anchorPos[1], anchorPos[2]);
  gliderGroup.visible = false;
  gliderGroup.scale.setScalar(0.001);
  parentGroup.add(gliderGroup);

  // Telescoping support mast & spine keel
  addPart(gliderGroup, new THREE.CylinderGeometry(0.038, 0.048, 0.72, 8), mats.carbon, {
    pos: [0, 0.28, -0.05],
    rot: [-0.15, 0, 0],
  });
  addPart(gliderGroup, new THREE.CylinderGeometry(0.035, 0.035, 1.55, 8), mats.carbon, {
    pos: [0, 0.62, -0.10],
    rot: [Math.PI / 2, 0, 0],
  });

  // Left & Right sweeping wing panels
  const leftWingPivot = new THREE.Group();
  leftWingPivot.position.set(0, 0.62, 0.12);
  gliderGroup.add(leftWingPivot);

  const rightWingPivot = new THREE.Group();
  rightWingPivot.position.set(0, 0.62, 0.12);
  gliderGroup.add(rightWingPivot);

  const buildHalfWing = (pivot: THREE.Group, s: 1 | -1): void => {
    const wingShape = new THREE.Shape();
    wingShape.moveTo(0, 0.56);
    wingShape.lineTo(s * 1.95, -0.35);
    wingShape.lineTo(s * 1.72, -0.78);
    wingShape.lineTo(0, -0.54);
    wingShape.closePath();

    const wingGeo = new THREE.ExtrudeGeometry(wingShape, {
      depth: 0.045,
      bevelEnabled: false,
    });
    // Shape X -> X, Shape Y -> +Z (forward/back), depth -> Y thickness
    wingGeo.translate(0, 0, -0.0225);
    wingGeo.rotateX(Math.PI / 2);
    addPart(pivot, wingGeo, mats.paint, {
      pos: [0, 0, 0],
      shimmer: true,
    });

    // Leading edge carbon spar
    const sparLen = 2.15;
    const sparGeo = new THREE.CylinderGeometry(0.03, 0.03, sparLen, 8);
    sparGeo.rotateZ(Math.PI / 2);
    addPart(pivot, sparGeo, mats.carbon, {
      pos: [s * 0.96, 0.02, 0.11],
      rot: [0, s * 0.43, 0],
    });

    // Accent racing stripe + tip winglet fin
    addPart(pivot, new THREE.BoxGeometry(1.10, 0.055, 0.16), mats.accent, {
      pos: [s * 0.85, 0.03, -0.22],
      rot: [0, s * 0.35, 0],
      shimmer: true,
    });
    addPart(pivot, new THREE.BoxGeometry(0.04, 0.24, 0.42), mats.secondary, {
      pos: [s * 1.80, -0.06, -0.56],
      shimmer: true,
    });
  };

  buildHalfWing(leftWingPivot, 1);
  buildHalfWing(rightWingPivot, -1);

  return { gliderGroup, leftWingPivot, rightWingPivot };
}

/**
 * Builds an exhaust flame cluster (nested inner white core + outer plasma cone + glow halo).
 */
function buildExhaustFlame(
  tipPos: [number, number, number],
  texLib: TextureLibLike | null | undefined,
  gfx: GraphicsLike | null | undefined
): THREE.Group {
  const flameGroup = new THREE.Group();
  flameGroup.position.set(tipPos[0], tipPos[1], tipPos[2]);
  flameGroup.visible = false;

  const sparkTex = getTex(texLib, 'particle_soft') || getFallbackSparkTex();

  const outerGeo = new THREE.ConeGeometry(0.18, 0.92, 10);
  outerGeo.rotateX(-Math.PI / 2);
  outerGeo.translate(0, 0, -0.46);
  const outerMat = makeMat(gfx, {
    color: 0xff7700,
    emissive: 0xff5500,
    emissiveIntensity: 1.8,
    transparent: true,
    opacity: 0.82,
    isUnlit: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    side: THREE.DoubleSide,
  });
  const outerMesh = new THREE.Mesh(outerGeo, outerMat);
  outerMesh.userData._flameRole = 'outer';
  flameGroup.add(outerMesh);

  const innerGeo = new THREE.ConeGeometry(0.095, 0.56, 10);
  innerGeo.rotateX(-Math.PI / 2);
  innerGeo.translate(0, 0, -0.28);
  const innerMat = makeMat(gfx, {
    color: 0xbef8ff,
    emissive: 0x7df9ff,
    emissiveIntensity: 2.2,
    transparent: true,
    opacity: 0.95,
    isUnlit: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    side: THREE.DoubleSide,
  });
  const innerMesh = new THREE.Mesh(innerGeo, innerMat);
  innerMesh.userData._flameRole = 'inner';
  flameGroup.add(innerMesh);

  const haloGeo = new THREE.PlaneGeometry(0.55, 0.55);
  const haloMat = makeMat(gfx, {
    color: 0xff9933,
    map: sparkTex,
    transparent: true,
    opacity: 0.75,
    isUnlit: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    side: THREE.DoubleSide,
  });
  const haloMesh = new THREE.Mesh(haloGeo, haloMat);
  haloMesh.position.set(0, 0, -0.10);
  haloMesh.userData._flameRole = 'halo';
  flameGroup.add(haloMesh);

  return flameGroup;
}

/**
 * Builds a multi-blade 3-tier drift spark cluster anchored behind a rear tire.
 */
function buildDriftSparkCluster(
  x: number,
  y: number,
  z: number,
  texLib: TextureLibLike | null | undefined,
  gfx: GraphicsLike | null | undefined
): THREE.Group {
  const sparkGroup = new THREE.Group();
  sparkGroup.position.set(x, y, z);
  sparkGroup.visible = false;

  const sparkTex = getTex(texLib, 'particle_soft') || getFallbackSparkTex();

  // Soft additive core aura
  const auraMat = makeMat(gfx, {
    color: 0x38bdf8,
    map: sparkTex,
    transparent: true,
    opacity: 0.9,
    isUnlit: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    side: THREE.DoubleSide,
  });
  const aura = new THREE.Mesh(new THREE.PlaneGeometry(0.90, 0.90), auraMat);
  aura.userData._sparkRole = 'aura';
  sparkGroup.add(aura);

  // Hot white-tinted spark core
  const coreMat = makeMat(gfx, {
    color: 0xffffff,
    emissive: 0xffffff,
    emissiveIntensity: 2.0,
    transparent: true,
    opacity: 0.95,
    isUnlit: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });
  const core = new THREE.Mesh(new THREE.OctahedronGeometry(0.16, 0), coreMat);
  core.userData._sparkRole = 'core';
  sparkGroup.add(core);

  // Crossed starburst flare streaks shooting diagonally out-and-back
  const spikeGeo = new THREE.ConeGeometry(0.085, 0.72, 4);
  spikeGeo.rotateX(-Math.PI / 2);
  spikeGeo.translate(0, 0, -0.34);
  const spikeAngles: Array<[number, number, number]> = [
    [0.25, 0.32, 0],
    [-0.18, -0.28, 0.4],
    [0.42, -0.12, 0.8],
    [-0.08, 0.45, 1.2],
  ];
  const spikeMat = makeMat(gfx, {
    color: 0x38bdf8,
    emissive: 0x38bdf8,
    emissiveIntensity: 1.8,
    transparent: true,
    opacity: 0.9,
    isUnlit: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    side: THREE.DoubleSide,
  });
  for (const [rx, ry, rz] of spikeAngles) {
    const spike = new THREE.Mesh(spikeGeo, spikeMat);
    spike.rotation.set(rx, ry, rz);
    spike.userData._sparkRole = 'spike';
    sparkGroup.add(spike);
  }

  return sparkGroup;
}

/**
 * Creates a complete animated 3D kart + driver + glider rig registered with `gfx.createMaterial`.
 */
export function createKartRig(
  charDef?: Partial<CharacterDef> | null,
  kartDef?: Partial<KartDef> | null,
  wheelDef?: Partial<WheelDef> | null,
  texLib?: TextureLibLike | null,
  gfx?: GraphicsLike | null
): KartRig {
  const root = new THREE.Group();
  root.name = `kart_rig_${charDef?.id || 'driver'}_${kartDef?.id || 'kart'}`;

  const bodyPivot = new THREE.Group();
  bodyPivot.rotation.order = 'YXZ';
  root.add(bodyPivot);

  const shimmerMeshes: THREE.Mesh[] = [];
  const addPart = createMeshHelper(shimmerMeshes);

  const carbonTex = getTex(texLib, 'kart_carbon');
  const stripesTex = getTex(texLib, 'kart_stripes');
  const shadowTex = getTex(texLib, 'blob_shadow') || getFallbackBlobShadowTex();

  const pColor = charDef?.primaryColor ?? '#e52521';
  const sColor = charDef?.secondaryColor ?? '#1e56d9';
  const aColor = charDef?.accentColor ?? '#ffd426';
  const skinCol = charDef?.skinColor ?? '#f6c39b';

  const mats: KartMats = {
    paint: makeMat(gfx, {
      color: pColor,
      roughness: 0.24,
      metalness: 0.18,
      clearcoat: 0.9,
      clearcoatRoughness: 0.12,
      isKartPaint: true,
    }),
    secondary: makeMat(gfx, {
      color: sColor,
      roughness: 0.30,
      metalness: 0.16,
      clearcoat: 0.75,
      clearcoatRoughness: 0.18,
      isKartPaint: true,
    }),
    accent: makeMat(gfx, {
      color: aColor,
      roughness: 0.28,
      metalness: 0.25,
      clearcoat: 0.7,
      isKartPaint: true,
    }),
    stripes: makeMat(gfx, {
      color: pColor,
      map: stripesTex,
      roughness: 0.26,
      metalness: 0.18,
      clearcoat: 0.85,
      isKartPaint: true,
    }),
    carbon: makeMat(gfx, {
      color: 0x22262e,
      map: carbonTex,
      roughness: 0.52,
      metalness: 0.30,
    }),
    gunmetal: makeMat(gfx, {
      color: 0x454c58,
      roughness: 0.38,
      metalness: 0.78,
    }),
    chrome: makeMat(gfx, {
      color: 0xe6edf5,
      roughness: 0.16,
      metalness: 0.92,
      clearcoat: 0.5,
    }),
    gold: makeMat(gfx, {
      color: 0xf7c948,
      roughness: 0.20,
      metalness: 0.88,
      clearcoat: 0.6,
    }),
    tire: makeMat(gfx, {
      color: 0x1b1d22,
      roughness: 0.85,
      metalness: 0.06,
    }),
    tireTread: makeMat(gfx, {
      color: 0x121418,
      roughness: 0.92,
      metalness: 0.04,
    }),
    glass: makeMat(gfx, {
      color: 0x18304a,
      roughness: 0.10,
      metalness: 0.25,
      transparent: true,
      opacity: 0.62,
      clearcoat: 1.0,
    }),
    headlight: makeMat(gfx, {
      color: 0xfff8dc,
      emissive: 0xfff2b2,
      emissiveIntensity: 1.6,
      isUnlit: true,
    }),
    taillight: makeMat(gfx, {
      color: 0xff2a2a,
      emissive: 0xff1e1e,
      emissiveIntensity: 1.4,
      isUnlit: true,
    }),
    neon: makeMat(gfx, {
      color: kartDef?.id === 'cyber_comet' ? 0x00f0ff : aColor,
      emissive: kartDef?.id === 'cyber_comet' ? 0x00e5ff : aColor,
      emissiveIntensity: 2.0,
      isUnlit: true,
    }),
    white: makeMat(gfx, {
      color: 0xf8fafc,
      roughness: 0.45,
      metalness: 0.05,
    }),
    leather: makeMat(gfx, {
      color: 0x4a2c1d,
      roughness: 0.65,
      metalness: 0.05,
    }),
    // Character materials
    charPrimary: makeMat(gfx, { color: pColor, roughness: 0.55, metalness: 0.06 }),
    charSecondary: makeMat(gfx, { color: sColor, roughness: 0.55, metalness: 0.06 }),
    charAccent: makeMat(gfx, { color: aColor, roughness: 0.40, metalness: 0.15 }),
    skin: makeMat(gfx, { color: skinCol, roughness: 0.68, metalness: 0.02 }),
    hairDark: makeMat(gfx, { color: 0x1f1713, roughness: 0.72, metalness: 0.04 }),
    hairGold: makeMat(gfx, { color: 0xfacc15, roughness: 0.42, metalness: 0.12 }),
    hairPlat: makeMat(gfx, { color: 0xfef3c7, roughness: 0.40, metalness: 0.10 }),
  };

  // 1. Build selected kart chassis
  const layout = buildKartBody(kartDef, wheelDef, mats, addPart, bodyPivot);
  const isMonster = wheelDef?.id === 'monster';

  // 2. Build 4 wheels + 2 front steer pivots + suspension arms
  const flPivot = new THREE.Group();
  flPivot.position.set(layout.frontHalfTrack, layout.wheelCenterY, layout.frontAxleZ);
  bodyPivot.add(flPivot);

  const frPivot = new THREE.Group();
  frPivot.position.set(-layout.frontHalfTrack, layout.wheelCenterY, layout.frontAxleZ);
  bodyPivot.add(frPivot);

  const rlHub = new THREE.Group();
  rlHub.position.set(layout.rearHalfTrack, layout.wheelCenterY, layout.rearAxleZ);
  bodyPivot.add(rlHub);

  const rrHub = new THREE.Group();
  rrHub.position.set(-layout.rearHalfTrack, layout.wheelCenterY, layout.rearAxleZ);
  bodyPivot.add(rrHub);

  const fl = buildWheelAssembly(wheelDef, 1, mats, addPart);
  const fr = buildWheelAssembly(wheelDef, -1, mats, addPart);
  const rl = buildWheelAssembly(wheelDef, 1, mats, addPart);
  const rr = buildWheelAssembly(wheelDef, -1, mats, addPart);

  flPivot.add(fl);
  frPivot.add(fr);
  rlHub.add(rl);
  rrHub.add(rr);

  addSuspensionArms(
    bodyPivot,
    layout.chassisAttachX,
    layout.chassisAttachY,
    layout.frontAxleZ,
    layout.frontHalfTrack,
    layout.wheelCenterY,
    layout.frontAxleZ,
    isMonster,
    mats,
    addPart
  );
  addSuspensionArms(
    bodyPivot,
    -layout.chassisAttachX,
    layout.chassisAttachY,
    layout.frontAxleZ,
    -layout.frontHalfTrack,
    layout.wheelCenterY,
    layout.frontAxleZ,
    isMonster,
    mats,
    addPart
  );
  addSuspensionArms(
    bodyPivot,
    layout.chassisAttachX,
    layout.chassisAttachY,
    layout.rearAxleZ,
    layout.rearHalfTrack,
    layout.wheelCenterY,
    layout.rearAxleZ,
    isMonster,
    mats,
    addPart
  );
  addSuspensionArms(
    bodyPivot,
    -layout.chassisAttachX,
    layout.chassisAttachY,
    layout.rearAxleZ,
    -layout.rearHalfTrack,
    layout.wheelCenterY,
    layout.rearAxleZ,
    isMonster,
    mats,
    addPart
  );

  // 3. Build seated 3D driver
  const { headPivot, armsPivot } = buildDriver(charDef, layout.seatPos, mats, addPart, bodyPivot);

  // 4. Build deployable hang-glider
  const { gliderGroup, leftWingPivot, rightWingPivot } = buildGlider(
    layout.gliderAnchor,
    mats,
    addPart,
    bodyPivot
  );

  // 5. Build exhaust boost flames [left, right]
  const leftFlame = buildExhaustFlame(layout.exhaustTips[0], texLib, gfx);
  const rightFlame = buildExhaustFlame(layout.exhaustTips[1], texLib, gfx);
  bodyPivot.add(leftFlame);
  bodyPivot.add(rightFlame);

  // 6. Build 3-tier rear drift sparks [left, right]
  const leftSpark = buildDriftSparkCluster(
    layout.rearHalfTrack * 0.96,
    0.16,
    layout.sparkAnchorZ,
    texLib,
    gfx
  );
  const rightSpark = buildDriftSparkCluster(
    -layout.rearHalfTrack * 0.96,
    0.16,
    layout.sparkAnchorZ,
    texLib,
    gfx
  );
  bodyPivot.add(leftSpark);
  bodyPivot.add(rightSpark);

  // 7. Rear trailing item mount (child of root so trailing shells/bananas stay upright behind kart)
  const itemMount = new THREE.Group();
  itemMount.position.set(0, 0.65, -2.20);
  root.add(itemMount);

  // 8. Blob shadow (child of root, flat on ground)
  const shadowMat = makeMat(gfx, {
    color: 0x000000,
    map: shadowTex,
    transparent: true,
    opacity: 0.56,
    isUnlit: true,
    depthWrite: false,
  }) as LitOrBasicMaterial;
  const blobShadow = new THREE.Mesh(new THREE.PlaneGeometry(3.2, 4.3), shadowMat);
  blobShadow.rotation.x = -Math.PI / 2;
  blobShadow.position.set(0, 0.025, 0);
  blobShadow.castShadow = false;
  blobShadow.receiveShadow = false;
  blobShadow.visible = typeof gfx?.useBlobShadows === 'function' ? gfx.useBlobShadows() : false;
  root.add(blobShadow);

  // Internal animation state across frames
  const animState = {
    elapsed: 0,
    smoothSteer: 0,
    smoothDriftYaw: 0,
    smoothDriftRoll: 0,
    gliderDeploy: 0,
    shrinkScale: 1,
    wheelSpin: 0,
    wasStar: false,
    wasInvuln: false,
    wasTricking: false,
    trickPeak: 0,
    trickMode: 0,
    trickCount: 0,
    wasSpinning: false,
    spinPeak: 0,
    sparkColor: new THREE.Color(),
    tempColor: new THREE.Color(),
    tempEmissive: new THREE.Color(),
  };

  const wheelRadius = wheelDef?.radius || 0.44;
  const wheels: [THREE.Group, THREE.Group, THREE.Group, THREE.Group] = [fl, fr, rl, rr];
  const steerPivots: [THREE.Group, THREE.Group] = [flPivot, frPivot];
  const exhaustFlames: [THREE.Group, THREE.Group] = [leftFlame, rightFlame];
  const driftSparks: [THREE.Group, THREE.Group] = [leftSpark, rightSpark];

  function ensureAdditiveProps(mesh: THREE.Object3D): void {
    const mat = (mesh as THREE.Mesh).material as THREE.Material | undefined;
    if (!mat) return;
    if (mat.blending !== THREE.AdditiveBlending) mat.blending = THREE.AdditiveBlending;
    if (mat.depthWrite !== false) mat.depthWrite = false;
  }

  function updateVisuals(
    kartState?: Partial<KartState> | null,
    dt = 0,
    time?: number,
    gfxArg?: GraphicsLike | null
  ): void {
    const safeDt = clamp(dt || 0, 0, 0.1);
    animState.elapsed += safeDt;
    const t = typeof time === 'number' ? time : animState.elapsed;
    const activeGfx = gfxArg || gfx;

    const speed = kartState?.speed ?? 0;
    const driftDir = kartState?.driftDir ?? 0;
    const driftTier = kartState?.driftTier ?? 0;
    const boostTimer = kartState?.boostTimer ?? 0;
    const starTimer = kartState?.starTimer ?? 0;
    const shrinkTimer = kartState?.shrinkTimer ?? 0;
    const spinoutTimer = kartState?.spinoutTimer ?? 0;
    const trickTimer = kartState?.trickTimer ?? 0;
    const invulnTimer = kartState?.invulnTimer ?? 0;
    const gliding = Boolean(kartState?.gliding);
    const grounded = kartState?.grounded !== undefined ? Boolean(kartState.grounded) : true;
    const airTime = kartState?.airTime ?? 0;
    const pitch = kartState?.pitch ?? 0;
    const roll = kartState?.roll ?? 0;

    // 1. Steering & wheel spin
    const targetSteer =
      typeof kartState?.steer === 'number'
        ? clamp(kartState.steer, -1, 1)
        : driftDir !== 0
          ? clamp(driftDir * 0.65, -1, 1)
          : 0;
    animState.smoothSteer = lerp(animState.smoothSteer, targetSteer, safeDt * 14 || 1);

    const steerAngle = -animState.smoothSteer * MAX_STEER_RAD;
    flPivot.rotation.y = steerAngle;
    frPivot.rotation.y = steerAngle;

    const spinDelta = (speed * safeDt) / Math.max(0.2, wheelRadius);
    animState.wheelSpin = (animState.wheelSpin + spinDelta) % (Math.PI * 2);
    for (let i = 0; i < 4; i++) {
      wheels[i].rotation.x = animState.wheelSpin;
    }

    // 2. Driver head look-into-turn & steering wheel arms rotation
    headPivot.rotation.y = -animState.smoothSteer * 0.36 - driftDir * 0.14;
    headPivot.rotation.x = boostTimer > 0 ? -0.10 : gliding ? -0.06 : 0;
    headPivot.rotation.z = driftDir * 0.08 + animState.smoothSteer * 0.06;
    armsPivot.rotation.z = -animState.smoothSteer * 0.48;

    // 3. Body pivot dynamics: drift kick-out, lean, trick flips, spinouts, engine vibration
    const targetDriftYaw = driftDir !== 0 ? -driftDir * 0.24 : 0;
    const targetDriftRoll = driftDir !== 0 ? driftDir * 0.11 : animState.smoothSteer * 0.045;
    animState.smoothDriftYaw = lerp(animState.smoothDriftYaw, targetDriftYaw, safeDt * 10 || 1);
    animState.smoothDriftRoll = lerp(animState.smoothDriftRoll, targetDriftRoll, safeDt * 10 || 1);

    let flipPitch = 0;
    let flipRoll = 0;
    if (trickTimer > 0) {
      if (!animState.wasTricking) {
        animState.wasTricking = true;
        animState.trickPeak = Math.max(trickTimer, 0.45);
        animState.trickMode = animState.trickCount++ % 2;
      }
      animState.trickPeak = Math.max(animState.trickPeak, trickTimer);
      const u = clamp(1 - trickTimer / animState.trickPeak, 0, 1);
      const ease = u < 0.5 ? 2 * u * u : 1 - Math.pow(-2 * u + 2, 2) / 2;
      if (animState.trickMode === 0) {
        flipRoll = ease * Math.PI * 2;
        flipPitch = -Math.sin(u * Math.PI) * 0.35;
      } else {
        flipPitch = ease * Math.PI * 2;
        flipRoll = Math.sin(u * Math.PI) * 0.22;
      }
    } else {
      animState.wasTricking = false;
      animState.trickPeak = 0;
    }

    let spinYaw = 0;
    let spinRoll = 0;
    if (spinoutTimer > 0) {
      if (!animState.wasSpinning) {
        animState.wasSpinning = true;
        animState.spinPeak = Math.max(spinoutTimer, 0.75);
      }
      animState.spinPeak = Math.max(animState.spinPeak, spinoutTimer);
      const su = clamp(1 - spinoutTimer / animState.spinPeak, 0, 1);
      spinYaw = su * Math.PI * 4;
      spinRoll = Math.sin(su * Math.PI * 4) * 0.12;
    } else {
      animState.wasSpinning = false;
      animState.spinPeak = 0;
    }

    const vibeAmp = boostTimer > 0 ? 0.013 : Math.abs(speed) > 1 ? 0.006 : 0.003;
    const engineBob = Math.sin(t * 32) * vibeAmp;
    bodyPivot.position.y = engineBob;
    bodyPivot.rotation.set(
      pitch + flipPitch - (boostTimer > 0 ? 0.045 : 0),
      animState.smoothDriftYaw + spinYaw,
      roll + animState.smoothDriftRoll + flipRoll + spinRoll
    );

    // 4. Deployable hang-glider animation
    const targetGlider = gliding ? 1 : 0;
    animState.gliderDeploy = lerp(animState.gliderDeploy, targetGlider, safeDt * 9 || 1);
    if (animState.gliderDeploy > 0.02) {
      gliderGroup.visible = true;
      const g = animState.gliderDeploy;
      const pop = g < 0.7 ? g / 0.7 : 1 + Math.sin(((g - 0.7) / 0.3) * Math.PI) * 0.08;
      gliderGroup.scale.setScalar(clamp(pop, 0.01, 1.12));
      const foldAngle = (1 - g) * (76 * DEG2RAD);
      leftWingPivot.rotation.y = foldAngle;
      rightWingPivot.rotation.y = -foldAngle;
      leftWingPivot.rotation.z = 7 * DEG2RAD;
      rightWingPivot.rotation.z = -7 * DEG2RAD;
      gliderGroup.rotation.z = -animState.smoothSteer * 0.16;
      gliderGroup.rotation.x = 0.08;
    } else {
      gliderGroup.visible = false;
      gliderGroup.scale.setScalar(0.001);
    }

    // 5. Boost exhaust flames
    const flamesActive = boostTimer > 0 || starTimer > 0;
    for (let i = 0; i < 2; i++) {
      const fg = exhaustFlames[i];
      fg.visible = flamesActive;
      if (flamesActive) {
        const flicker = 0.85 + Math.sin(t * 58 + i * 2.1) * 0.22;
        const boostMul = starTimer > 0 && boostTimer <= 0 ? 0.85 : 1.15;
        fg.scale.set(
          0.95 + Math.cos(t * 44 + i) * 0.12,
          0.95 + Math.sin(t * 48 + i) * 0.12,
          flicker * boostMul
        );
        for (const child of fg.children) {
          ensureAdditiveProps(child);
          const childMesh = child as THREE.Mesh;
          const mat = childMesh.material as LitOrBasicMaterial | undefined;
          if (mat && child.userData._flameRole === 'outer') {
            if (starTimer > 0) {
              animState.tempColor.setHSL((t * 3 + i * 0.25) % 1, 1, 0.58);
              if (mat.color) mat.color.copy(animState.tempColor);
              if (mat.emissive) mat.emissive.copy(animState.tempColor);
            } else {
              if (mat.color) mat.color.setHex(0xff7700);
              if (mat.emissive) mat.emissive.setHex(0xff5500);
            }
          }
        }
      }
    }

    // 6. 3-tier Drift Sparks (Blue -> Orange -> Purple)
    const showSparks = grounded && driftDir !== 0 && driftTier >= 1;
    if (showSparks) {
      let hex = 0x38bdf8;
      let baseScale = 0.72;
      if (driftTier === 2) {
        hex = 0xff9100;
        baseScale = 1.05;
      } else if (driftTier >= 3) {
        hex = 0xd946ef;
        baseScale = 1.40;
      }
      animState.sparkColor.setHex(hex);
      const pulse = 0.85 + Math.sin(t * 45) * 0.22;

      for (let i = 0; i < 2; i++) {
        const sg = driftSparks[i];
        sg.visible = true;
        sg.scale.setScalar(baseScale * pulse);
        sg.rotation.z = Math.sin(t * 36 + i * 1.7) * 0.35;
        for (const child of sg.children) {
          ensureAdditiveProps(child);
          const mat = (child as THREE.Mesh).material as LitOrBasicMaterial | undefined;
          if (!mat) continue;
          const role = child.userData._sparkRole;
          if (role === 'aura' || role === 'spike') {
            if (mat.color) mat.color.copy(animState.sparkColor);
            if (mat.emissive) mat.emissive.copy(animState.sparkColor);
          } else if (role === 'core') {
            if (mat.color) mat.color.setHex(driftTier >= 3 ? 0xfdf4ff : 0xffffff);
            if (mat.emissive) mat.emissive.copy(animState.sparkColor);
          }
        }
      }
    } else {
      leftSpark.visible = false;
      rightSpark.visible = false;
    }

    // 7. Super Star rainbow shimmer & post-hit invulnerability flash
    if (starTimer > 0) {
      animState.wasStar = true;
      const hue = (t * 2.5) % 1;
      animState.tempColor.setHSL(hue, 0.92, 0.56);
      animState.tempEmissive.setHSL((hue + 0.14) % 1, 1.0, 0.44);
      for (let i = 0; i < shimmerMeshes.length; i++) {
        const mat = shimmerMeshes[i].material as LitOrBasicMaterial | undefined;
        if (!mat) continue;
        if (mat.color) mat.color.copy(animState.tempColor);
        if (mat.emissive) {
          mat.emissive.copy(animState.tempEmissive);
          mat.emissiveIntensity = 0.85;
        }
      }
    } else if (invulnTimer > 0 && spinoutTimer <= 0) {
      animState.wasInvuln = true;
      const flash = Math.sin(t * 38) > 0 ? 0.35 : 0;
      for (let i = 0; i < shimmerMeshes.length; i++) {
        const mesh = shimmerMeshes[i];
        const mat = mesh.material as LitOrBasicMaterial | undefined;
        if (!mat) continue;
        if (mat.color && mesh.userData._baseColor) {
          mat.color.copy(mesh.userData._baseColor as THREE.Color);
          if (flash > 0) mat.color.lerp(animState.tempColor.setHex(0xffffff), flash);
        }
        if (mat.emissive && mesh.userData._baseEmissive) {
          mat.emissive.copy(mesh.userData._baseEmissive as THREE.Color);
          mat.emissiveIntensity = (mesh.userData._baseEmissiveIntensity as number) ?? 1;
        }
      }
    } else if (animState.wasStar || animState.wasInvuln) {
      animState.wasStar = false;
      animState.wasInvuln = false;
      for (let i = 0; i < shimmerMeshes.length; i++) {
        const mesh = shimmerMeshes[i];
        const mat = mesh.material as LitOrBasicMaterial | undefined;
        if (!mat) continue;
        if (mat.color && mesh.userData._baseColor) {
          mat.color.copy(mesh.userData._baseColor as THREE.Color);
        }
        if (mat.emissive && mesh.userData._baseEmissive) {
          mat.emissive.copy(mesh.userData._baseEmissive as THREE.Color);
          mat.emissiveIntensity = (mesh.userData._baseEmissiveIntensity as number) ?? 1;
        }
      }
    }

    // 8. Lightning shrink scaling
    const targetShrink = shrinkTimer > 0 ? 0.56 : 1.0;
    animState.shrinkScale = lerp(animState.shrinkScale, targetShrink, safeDt * 10 || 1);
    root.scale.setScalar(animState.shrinkScale);

    // 9. Blob shadow toggling & airborne fade
    const showBlob =
      typeof activeGfx?.useBlobShadows === 'function'
        ? activeGfx.useBlobShadows()
        : Boolean(activeGfx?.getSettings?.()?.shadowMode === 'blob');
    blobShadow.visible = showBlob;
    if (showBlob) {
      const airFade = grounded ? 1 : clamp(1 - airTime * 0.28, 0.35, 1);
      blobShadow.scale.setScalar(0.82 + 0.18 * airFade);
      const bMat = blobShadow.material as LitOrBasicMaterial | undefined;
      if (bMat) {
        bMat.opacity = 0.56 * airFade;
        if (bMat.depthWrite !== false) bMat.depthWrite = false;
      }
    }
  }

  return {
    root,
    bodyPivot,
    wheels,
    steerPivots,
    headPivot,
    armsPivot,
    gliderGroup,
    exhaustFlames,
    driftSparks,
    itemMount,
    blobShadow,
    updateVisuals,
  };
}
