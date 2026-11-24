import * as THREE from 'three';
import {
  GRAPHICS_PRESETS,
  type GraphicsPresetId,
  type GraphicsSettings,
  type MaterialTier,
  type ShadowMode,
  type TrackDefinition,
  type TrackInstance,
  type TrackSkyColors,
} from './contracts';
import type { TextureLibrary } from './textures';

export interface MaterialDef {
  color?: THREE.ColorRepresentation;
  map?: THREE.Texture | null;
  alphaMap?: THREE.Texture | null;
  emissive?: THREE.ColorRepresentation;
  emissiveIntensity?: number;
  roughness?: number;
  metalness?: number;
  clearcoat?: number;
  clearcoatRoughness?: number;
  envMapIntensity?: number;
  transparent?: boolean;
  opacity?: number;
  side?: THREE.Side;
  vertexColors?: boolean;
  flatShading?: boolean;
  isKartPaint?: boolean;
  isUnlit?: boolean;
  depthWrite?: boolean;
  depthTest?: boolean;
  blending?: THREE.Blending;
  alphaTest?: number;
  polygonOffset?: boolean;
  polygonOffsetFactor?: number;
  polygonOffsetUnits?: number;
}

export interface GraphicsStats {
  fps: number;
  frameMs: number;
  presetId: GraphicsPresetId | 'custom';
}

export type GraphicsSettingsWithPreset = GraphicsSettings & {
  presetId: GraphicsPresetId | 'custom';
};

export type GraphicsSettingsPatch = Partial<Omit<GraphicsSettings, 'presetId'>> & {
  presetId?: GraphicsPresetId | 'custom' | string;
};

interface NormalizedMaterialDef {
  color: THREE.ColorRepresentation;
  map: THREE.Texture | null;
  alphaMap: THREE.Texture | null;
  emissive: THREE.ColorRepresentation;
  emissiveIntensity: number;
  roughness: number;
  metalness: number;
  clearcoat?: number;
  clearcoatRoughness?: number;
  envMapIntensity?: number;
  transparent: boolean;
  opacity: number;
  side: THREE.Side;
  vertexColors: boolean;
  flatShading: boolean;
  isKartPaint: boolean;
  isUnlit: boolean;
  depthWrite: boolean;
  depthTest: boolean;
  blending: THREE.Blending;
  alphaTest: number;
  polygonOffset: boolean;
  polygonOffsetFactor: number;
  polygonOffsetUnits: number;
}

interface MaterialEntry {
  def: NormalizedMaterialDef;
  cache: Map<MaterialTier, THREE.Material>;
}

interface BaseFogState {
  color: THREE.ColorRepresentation;
  near: number;
  far: number;
}

interface SceneGfxState {
  dirLight: THREE.DirectionalLight;
  sunDir: THREE.Vector3;
  pointLights: THREE.PointLight[];
  baseFog: BaseFogState;
  skyMesh: THREE.Mesh;
}

interface PostResources {
  orthoCam: THREE.OrthographicCamera;
  postScene: THREE.Scene;
  quadMesh: THREE.Mesh<THREE.PlaneGeometry, THREE.ShaderMaterial>;
  quadGeo: THREE.PlaneGeometry;
  brightMat: THREE.ShaderMaterial;
  blurMat: THREE.ShaderMaterial;
  compMat: THREE.ShaderMaterial;
  sceneRT: THREE.WebGLRenderTarget;
  bloomRT1: THREE.WebGLRenderTarget;
  bloomRT2: THREE.WebGLRenderTarget;
}

const PRESET_COMPARE_KEYS: ReadonlyArray<keyof Omit<GraphicsSettings, 'id' | 'presetId' | 'label' | 'desc' | 'showFps'>> = [
  'resScale',
  'maxDpr',
  'shadowMode',
  'materialTier',
  'bloom',
  'speedFx',
  'sceneryDensity',
  'particleLevel',
  'drawDistance',
  'dynamicLights',
  'fpsCap',
  'pixelatedCanvas',
  'anisotropy',
  'toneMapping',
];

const SHADOW_SIZES: Record<ShadowMode, number> = {
  off: 0,
  blob: 0,
  low: 1024,
  high: 2048,
  ultra: 4096,
};

const PARTICLE_BUDGETS = [0, 0.35, 0.7, 1.0] as const;
const MAX_DYNAMIC_LIGHTS = 6;
const SHADOW_FRUSTUM_HALF = 72;

function clamp(v: number, min: number, max: number): number {
  return v < min ? min : v > max ? max : v;
}

function isPresetId(id: unknown): id is GraphicsPresetId {
  return typeof id === 'string' && Object.prototype.hasOwnProperty.call(GRAPHICS_PRESETS, id);
}

const POST_VERT = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = vec4(position.xy, 0.0, 1.0);
  }
`;

const BRIGHT_FRAG = /* glsl */ `
  uniform sampler2D tDiffuse;
  uniform float uThreshold;
  varying vec2 vUv;

  void main() {
    vec3 col = texture2D(tDiffuse, vUv).rgb;
    float lum = dot(col, vec3(0.2126, 0.7152, 0.0722));
    float soft = smoothstep(uThreshold - 0.16, uThreshold + 0.22, lum);
    gl_FragColor = vec4(col * soft, 1.0);
  }
`;

const BLUR_FRAG = /* glsl */ `
  uniform sampler2D tDiffuse;
  uniform vec2 uDirection;
  uniform vec2 uTexelSize;
  varying vec2 vUv;

  void main() {
    vec2 stepUv = uDirection * uTexelSize;
    vec3 sum = texture2D(tDiffuse, vUv).rgb * 0.227027;
    sum += texture2D(tDiffuse, vUv + stepUv * 1.384615).rgb * 0.316216;
    sum += texture2D(tDiffuse, vUv - stepUv * 1.384615).rgb * 0.316216;
    sum += texture2D(tDiffuse, vUv + stepUv * 3.230769).rgb * 0.070270;
    sum += texture2D(tDiffuse, vUv - stepUv * 3.230769).rgb * 0.070270;
    gl_FragColor = vec4(sum, 1.0);
  }
`;

const COMPOSITE_FRAG = /* glsl */ `
  uniform sampler2D tDiffuse;
  uniform sampler2D tBloom;
  uniform float uBloomEnabled;
  uniform float uBloomStrength;
  uniform float uSpeedFxEnabled;
  uniform float uBoost;
  varying vec2 vUv;

  void main() {
    vec2 center = vUv - 0.5;
    float dist = length(center);
    vec2 dir = dist > 0.0001 ? center / dist : vec2(0.0);

    vec3 col;
    if (uSpeedFxEnabled > 0.5 && uBoost > 0.01) {
      float edge = smoothstep(0.18, 0.72, dist);
      float ca = uBoost * 0.0085 * edge;
      float r = texture2D(tDiffuse, vUv + dir * ca).r;
      float g = texture2D(tDiffuse, vUv).g;
      float b = texture2D(tDiffuse, vUv - dir * ca).b;

      // Subtle radial speed streak taps toward outer edges
      float streak = uBoost * 0.012 * edge;
      vec3 blurSample = (
        texture2D(tDiffuse, vUv - dir * streak).rgb +
        texture2D(tDiffuse, vUv - dir * streak * 2.0).rgb
      ) * 0.5;

      col = mix(vec3(r, g, b), blurSample, clamp(uBoost * 0.32 * edge, 0.0, 0.38));
      // Energetic speed rim tint
      col += vec3(0.08, 0.24, 0.38) * (edge * uBoost * 0.24);
    } else {
      col = texture2D(tDiffuse, vUv).rgb;
    }

    if (uBloomEnabled > 0.5) {
      col += texture2D(tBloom, vUv).rgb * uBloomStrength;
    }

    gl_FragColor = vec4(col, 1.0);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`;

const SKY_VERT = /* glsl */ `
  varying vec3 vWorldDir;
  void main() {
    vWorldDir = normalize(position);
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const SKY_FRAG = /* glsl */ `
  uniform vec3 uTopColor;
  uniform vec3 uHorizonColor;
  uniform vec3 uBottomColor;
  uniform vec3 uSunColor;
  uniform vec3 uSunDir;
  varying vec3 vWorldDir;

  void main() {
    vec3 dir = normalize(vWorldDir);
    float y = dir.y;
    vec3 col = y >= 0.0
      ? mix(uHorizonColor, uTopColor, pow(clamp(y, 0.0, 1.0), 0.58))
      : mix(uHorizonColor, uBottomColor, pow(clamp(-y, 0.0, 1.0), 0.72));

    float sunDot = max(dot(dir, normalize(uSunDir)), 0.0);
    float sunHalo = pow(sunDot, 12.0) * 0.28 + pow(sunDot, 140.0) * 0.85;
    col += uSunColor * sunHalo;

    gl_FragColor = vec4(col, 1.0);
    #include <colorspace_fragment>
  }
`;

/**
 * Scalable WebGL GraphicsEngine managing presets, dynamic material tiers,
 * follow shadows, LODs, dynamic lights, post-processing bloom/speed FX,
 * and frame pacing.
 */
export class GraphicsEngine {
  texLib: TextureLibrary | null;
  containerEl: HTMLElement | null = null;
  canvas: HTMLCanvasElement | null = null;
  renderer: THREE.WebGLRenderer;
  presetId: GraphicsPresetId | 'custom';
  settings: GraphicsSettings;

  private _trackedScenes = new Set<THREE.Scene>();
  private _activeScene: THREE.Scene | null = null;
  private _currentTrack: Pick<TrackInstance, 'lodGroups'> | null = null;
  private _materialEntries: MaterialEntry[] = [];
  private _pointLightPool: THREE.PointLight[] = [];
  private _dirLight: THREE.DirectionalLight | null = null;
  private _sunDir = new THREE.Vector3(0.45, 0.78, 0.42).normalize();
  private _skyMesh: THREE.Mesh | null = null;
  private _baseFog: BaseFogState = { color: 0x9be0ff, near: 240, far: 1300 };

  private _envRT: THREE.WebGLRenderTarget | null = null;
  private _envTexture: THREE.Texture | null = null;

  private _post: PostResources | null = null;
  private _postFailed = false;
  private _postDirty = true;
  private _lastTargetW = 0;
  private _lastTargetH = 0;

  private _fps = 60;
  private _frameMs = 16.6;
  private _fpsAccumTime = 0;
  private _fpsAccumFrames = 0;
  private _lastRenderTime = -Infinity;
  private _width = 1280;
  private _height = 720;

  private _onWindowResize: () => void;

  constructor(
    containerEl: HTMLElement | HTMLCanvasElement | null = null,
    texLib: TextureLibrary | null = null,
    initialPreset: GraphicsPresetId | string = 'high'
  ) {
    this.texLib = texLib;

    if (typeof document !== 'undefined') {
      if (containerEl && containerEl.tagName === 'CANVAS') {
        this.canvas = containerEl as HTMLCanvasElement;
        this.containerEl = containerEl.parentElement || null;
      } else {
        this.containerEl = containerEl || null;
        this.canvas = document.createElement('canvas');
        this.canvas.className = 'tk8-canvas';
        this.canvas.style.width = '100%';
        this.canvas.style.height = '100%';
        this.canvas.style.display = 'block';
        if (this.containerEl && typeof this.containerEl.appendChild === 'function') {
          this.containerEl.appendChild(this.canvas);
        }
      }
    } else {
      this.canvas = null;
    }

    this.renderer = new THREE.WebGLRenderer({
      canvas: this.canvas || undefined,
      antialias: true,
      powerPreference: 'high-performance',
      stencil: false,
    });
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.shadowMap.enabled = false;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;

    const basePreset: GraphicsPresetId = isPresetId(initialPreset) ? initialPreset : 'high';
    this.presetId = basePreset;
    this.settings = {
      ...GRAPHICS_PRESETS[basePreset],
      showFps: true,
    };

    this._onWindowResize = () => this.resize();
    if (typeof window !== 'undefined') {
      window.addEventListener('resize', this._onWindowResize);
    }

    this._applyAllSettings();
    this.resize();
  }

  applyPreset(presetId: GraphicsPresetId | string): GraphicsSettingsWithPreset {
    if (!isPresetId(presetId)) return this.getSettings();
    const preset = GRAPHICS_PRESETS[presetId];
    const showFps = this.settings?.showFps ?? true;
    this.presetId = presetId;
    this.settings = { ...preset, showFps };
    this._applyAllSettings();
    return this.getSettings();
  }

  updateSettings(partialSettings: GraphicsSettingsPatch = {}): GraphicsSettingsWithPreset {
    if (!partialSettings || typeof partialSettings !== 'object') {
      return this.getSettings();
    }
    if (partialSettings.presetId && isPresetId(partialSettings.presetId)) {
      const targetPreset = partialSettings.presetId;
      const rest: GraphicsSettingsPatch = { ...partialSettings };
      delete rest.presetId;
      this.applyPreset(targetPreset);
      if (Object.keys(rest).length === 0) return this.getSettings();
      this.settings = { ...this.settings, ...rest } as GraphicsSettings;
    } else {
      this.settings = { ...this.settings, ...partialSettings } as GraphicsSettings;
    }

    // Check if current settings exactly match a named preset
    let matched: GraphicsPresetId | 'custom' = 'custom';
    for (const [id, preset] of Object.entries(GRAPHICS_PRESETS) as Array<[GraphicsPresetId, GraphicsSettings]>) {
      if (PRESET_COMPARE_KEYS.every((k) => this.settings[k] === preset[k])) {
        matched = id;
        break;
      }
    }
    this.presetId = matched;
    this._applyAllSettings();
    return this.getSettings();
  }

  getSettings(): GraphicsSettingsWithPreset {
    return {
      ...this.settings,
      presetId: this.presetId,
    };
  }

  getStats(): GraphicsStats {
    return {
      fps: Math.round(this._fps),
      frameMs: Math.round(this._frameMs * 10) / 10,
      presetId: this.presetId,
    };
  }

  useBlobShadows(): boolean {
    return this.settings.shadowMode === 'blob';
  }

  get particleBudget(): number {
    const idx = clamp(Math.round(this.settings.particleLevel ?? 2), 0, 3);
    return PARTICLE_BUDGETS[idx];
  }

  getParticleBudget(): number {
    return this.particleBudget;
  }

  /**
   * Create a tier-adaptive THREE.Material registered for automatic swaps across
   * 'flat', 'lambert', 'standard', and 'physical' material tiers.
   */
  createMaterial(def: MaterialDef = {}): THREE.Material {
    const normalized: NormalizedMaterialDef = {
      color: def.color !== undefined ? def.color : 0xffffff,
      map: def.map || null,
      alphaMap: def.alphaMap || null,
      emissive: def.emissive !== undefined ? def.emissive : 0x000000,
      emissiveIntensity: def.emissiveIntensity !== undefined ? def.emissiveIntensity : 1.0,
      roughness: def.roughness !== undefined ? def.roughness : (def.isKartPaint ? 0.26 : 0.68),
      metalness: def.metalness !== undefined ? def.metalness : (def.isKartPaint ? 0.22 : 0.04),
      clearcoat: def.clearcoat,
      clearcoatRoughness: def.clearcoatRoughness,
      envMapIntensity: def.envMapIntensity,
      transparent: Boolean(def.transparent),
      opacity: def.opacity !== undefined ? def.opacity : 1.0,
      side: def.side !== undefined ? def.side : THREE.FrontSide,
      vertexColors: Boolean(def.vertexColors),
      flatShading: Boolean(def.flatShading),
      isKartPaint: Boolean(def.isKartPaint),
      isUnlit: Boolean(def.isUnlit),
      depthWrite: def.depthWrite !== undefined ? def.depthWrite : true,
      depthTest: def.depthTest !== undefined ? def.depthTest : true,
      blending: def.blending !== undefined ? def.blending : THREE.NormalBlending,
      alphaTest: def.alphaTest !== undefined ? def.alphaTest : 0,
      polygonOffset: Boolean(def.polygonOffset),
      polygonOffsetFactor: def.polygonOffsetFactor || 0,
      polygonOffsetUnits: def.polygonOffsetUnits || 0,
    };

    const entry: MaterialEntry = {
      def: normalized,
      cache: new Map(),
    };
    this._materialEntries.push(entry);
    return this._getMaterialForEntry(entry, this.settings.materialTier);
  }

  registerMesh<T extends THREE.Object3D>(mesh: T, matDef: MaterialDef | null = null): T {
    if (!mesh) return mesh;
    if (matDef) {
      (mesh as unknown as THREE.Mesh).material = this.createMaterial(matDef);
    }
    return mesh;
  }

  trackMaterial<T extends THREE.Object3D>(mesh: T, matDef: MaterialDef | null = null): T {
    return this.registerMesh(mesh, matDef);
  }

  private _getMaterialForEntry(entry: MaterialEntry, tier: MaterialTier): THREE.Material {
    const effectiveTier: MaterialTier = entry.def.isUnlit ? 'flat' : tier;
    const cached = entry.cache.get(effectiveTier);
    if (cached) {
      return cached;
    }

    const d = entry.def;
    const baseOpts = {
      color: d.color,
      map: d.map,
      alphaMap: d.alphaMap,
      transparent: d.transparent,
      opacity: d.opacity,
      side: d.side,
      vertexColors: d.vertexColors,
      depthWrite: d.depthWrite,
      depthTest: d.depthTest,
      blending: d.blending,
      alphaTest: d.alphaTest,
      polygonOffset: d.polygonOffset,
      polygonOffsetFactor: d.polygonOffsetFactor,
      polygonOffsetUnits: d.polygonOffsetUnits,
    };

    let mat: THREE.Material;
    if (effectiveTier === 'flat') {
      const flatColor = new THREE.Color(d.color);
      // Bake emissive glow into MeshBasicMaterial so neon/lights remain vivid in Potato mode
      if (!d.isUnlit && d.emissive !== undefined && d.emissiveIntensity > 0) {
        const em = new THREE.Color(d.emissive);
        const boost = clamp(d.emissiveIntensity, 0, 1.5);
        flatColor.r = Math.min(1, flatColor.r + em.r * boost);
        flatColor.g = Math.min(1, flatColor.g + em.g * boost);
        flatColor.b = Math.min(1, flatColor.b + em.b * boost);
      }
      mat = new THREE.MeshBasicMaterial({
        ...baseOpts,
        color: flatColor,
      });
    } else if (effectiveTier === 'lambert') {
      mat = new THREE.MeshLambertMaterial({
        ...baseOpts,
        emissive: d.emissive,
        emissiveIntensity: d.emissiveIntensity,
        flatShading: d.flatShading,
      });
    } else if (effectiveTier === 'physical') {
      const glossy = d.isKartPaint || (d.clearcoat ?? 0) > 0 || d.roughness < 0.42;
      const clearcoat =
        d.clearcoat !== undefined ? d.clearcoat : (d.isKartPaint ? 0.92 : glossy ? 0.45 : 0);
      const clearcoatRoughness =
        d.clearcoatRoughness !== undefined
          ? d.clearcoatRoughness
          : (d.isKartPaint ? 0.08 : 0.22);
      const envMapIntensity =
        d.envMapIntensity !== undefined
          ? d.envMapIntensity
          : (d.isKartPaint ? 1.35 : glossy ? 0.85 : 0.22);

      mat = new THREE.MeshPhysicalMaterial({
        ...baseOpts,
        emissive: d.emissive,
        emissiveIntensity: d.emissiveIntensity,
        roughness: d.roughness,
        metalness: d.metalness,
        flatShading: d.flatShading,
        clearcoat,
        clearcoatRoughness,
        envMapIntensity,
      });
    } else {
      // 'standard'
      mat = new THREE.MeshStandardMaterial({
        ...baseOpts,
        emissive: d.emissive,
        emissiveIntensity: d.emissiveIntensity,
        roughness: d.roughness,
        metalness: d.metalness,
        flatShading: d.flatShading,
      });
    }

    mat.userData._gfxDef = d;
    mat.userData._gfxEntry = entry;
    entry.cache.set(effectiveTier, mat);
    return mat;
  }

  private _syncSceneMaterials(scene: THREE.Scene): void {
    if (!scene) return;
    const tier = this.settings.materialTier;
    scene.traverse((obj) => {
      const renderObj = obj as THREE.Mesh;
      if (!renderObj.material) return;
      if (Array.isArray(renderObj.material)) {
        let changed = false;
        const next = renderObj.material.map((m) => {
          if (m && m.userData && m.userData._gfxEntry) {
            const swapped = this._getMaterialForEntry(m.userData._gfxEntry as MaterialEntry, tier);
            if (swapped !== m) changed = true;
            return swapped;
          }
          return m;
        });
        if (changed) renderObj.material = next;
      } else if (renderObj.material.userData && renderObj.material.userData._gfxEntry) {
        const swapped = this._getMaterialForEntry(renderObj.material.userData._gfxEntry as MaterialEntry, tier);
        if (swapped !== renderObj.material) {
          renderObj.material = swapped;
        }
      } else if (renderObj.material.userData && renderObj.material.userData._gfxDef) {
        const entry: MaterialEntry = {
          def: renderObj.material.userData._gfxDef as NormalizedMaterialDef,
          cache: new Map(),
        };
        this._materialEntries.push(entry);
        renderObj.material = this._getMaterialForEntry(entry, tier);
      }
    });
    scene.userData._gfxTier = tier;
  }

  private _ensureEnvMap(): THREE.Texture | null {
    if (this._envTexture) return this._envTexture;
    try {
      const pmrem = new THREE.PMREMGenerator(this.renderer);
      pmrem.compileEquirectangularShader();

      const envScene = new THREE.Scene();
      envScene.background = new THREE.Color(0x5da9ff);

      const domeGeo = new THREE.SphereGeometry(20, 24, 16);
      const domeMat = new THREE.ShaderMaterial({
        side: THREE.BackSide,
        depthWrite: false,
        uniforms: {
          uTop: { value: new THREE.Color(0x3a8fff) },
          uHorizon: { value: new THREE.Color(0xffeedd) },
          uGround: { value: new THREE.Color(0x3d4b40) },
        },
        vertexShader: `
          varying vec3 vDir;
          void main() {
            vDir = normalize(position);
            gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
          }
        `,
        fragmentShader: `
          uniform vec3 uTop;
          uniform vec3 uHorizon;
          uniform vec3 uGround;
          varying vec3 vDir;
          void main() {
            float y = vDir.y;
            vec3 c = y >= 0.0
              ? mix(uHorizon, uTop, pow(y, 0.55))
              : mix(uHorizon, uGround, pow(-y, 0.65));
            gl_FragColor = vec4(c, 1.0);
          }
        `,
      });
      envScene.add(new THREE.Mesh(domeGeo, domeMat));

      const panelGeo = new THREE.PlaneGeometry(10, 4);
      const warmPanelMat = new THREE.MeshBasicMaterial({
        color: new THREE.Color(3.2, 2.9, 2.4),
        side: THREE.DoubleSide,
      });
      const warmPanel = new THREE.Mesh(panelGeo, warmPanelMat);
      warmPanel.position.set(8, 12, 8);
      warmPanel.lookAt(0, 0, 0);
      envScene.add(warmPanel);

      const coolPanelMat = new THREE.MeshBasicMaterial({
        color: new THREE.Color(0.9, 1.7, 2.8),
        side: THREE.DoubleSide,
      });
      const coolPanel = new THREE.Mesh(panelGeo, coolPanelMat);
      coolPanel.position.set(-10, 9, -6);
      coolPanel.lookAt(0, 0, 0);
      envScene.add(coolPanel);

      this._envRT = pmrem.fromScene(envScene, 0.035);
      this._envTexture = this._envRT.texture;

      domeGeo.dispose();
      domeMat.dispose();
      panelGeo.dispose();
      warmPanelMat.dispose();
      coolPanelMat.dispose();
      pmrem.dispose();
    } catch {
      this._envTexture = null;
    }
    return this._envTexture;
  }

  /**
   * Setup sky gradient dome, directional follow-shadow light, hemisphere bounce,
   * fog, and reusable dynamic PointLight pool for a track scene.
   */
  setupSceneLights(scene: THREE.Scene | null | undefined, trackDef: Partial<TrackDefinition> | null = null): void {
    if (!scene) return;
    this._trackedScenes.add(scene);
    this._activeScene = scene;

    // Remove previous gfx-managed lights/sky if re-initializing the same scene
    const prevGroup = scene.getObjectByName('__gfx_lights');
    if (prevGroup) {
      prevGroup.traverse((child) => {
        const mesh = child as THREE.Mesh;
        if (mesh.geometry) mesh.geometry.dispose();
        if (mesh.material) {
          if (Array.isArray(mesh.material)) {
            mesh.material.forEach((m) => m.dispose());
          } else {
            mesh.material.dispose();
          }
        }
      });
      scene.remove(prevGroup);
    }

    const lightsGroup = new THREE.Group();
    lightsGroup.name = '__gfx_lights';
    scene.add(lightsGroup);

    const sky: Partial<TrackSkyColors> = trackDef?.skyColors || {};
    const topColor = sky.top ?? 0x2574f5;
    const horizonColor = sky.horizon ?? 0x9be0ff;
    const bottomColor = sky.bottom ?? 0x3b6e3c;
    const sunColor = sky.sunColor ?? 0xfff3d1;
    const sunPos = sky.sunPos || [120, 180, 90];
    const fogColor = sky.fogColor ?? horizonColor;
    const fogNear = sky.fogNear ?? 240;
    const fogFar = sky.fogFar ?? 1300;

    this._sunDir.set(sunPos[0], sunPos[1], sunPos[2]).normalize();
    this._baseFog = { color: fogColor, near: fogNear, far: fogFar };

    scene.background = new THREE.Color(fogColor);
    scene.fog = new THREE.Fog(fogColor, fogNear, fogFar);

    // Sky gradient dome rendered first (renderOrder -1000, depthWrite/Test false)
    const skyGeo = new THREE.SphereGeometry(50, 24, 16);
    const skyMat = new THREE.ShaderMaterial({
      side: THREE.BackSide,
      depthWrite: false,
      depthTest: false,
      fog: false,
      toneMapped: false,
      uniforms: {
        uTopColor: { value: new THREE.Color(topColor) },
        uHorizonColor: { value: new THREE.Color(horizonColor) },
        uBottomColor: { value: new THREE.Color(bottomColor) },
        uSunColor: { value: new THREE.Color(sunColor) },
        uSunDir: { value: this._sunDir.clone() },
      },
      vertexShader: SKY_VERT,
      fragmentShader: SKY_FRAG,
    });
    const skyMesh = new THREE.Mesh(skyGeo, skyMat);
    skyMesh.name = '__gfx_sky';
    skyMesh.renderOrder = -1000;
    skyMesh.frustumCulled = false;
    lightsGroup.add(skyMesh);
    this._skyMesh = skyMesh;

    const ambientInt = trackDef?.ambientIntensity ?? 0.65;
    const hemi = new THREE.HemisphereLight(topColor, bottomColor, Math.max(0.4, ambientInt * 0.95));
    lightsGroup.add(hemi);

    const amb = new THREE.AmbientLight(0xffffff, Math.max(0.15, ambientInt * 0.25));
    lightsGroup.add(amb);

    const dirColor = trackDef?.dirLightColor ?? 0xfff5e0;
    const dirInt = trackDef?.dirLightIntensity ?? 1.45;
    const dirLight = new THREE.DirectionalLight(dirColor, dirInt);
    dirLight.position.copy(this._sunDir).multiplyScalar(145);
    dirLight.shadow.camera.left = -SHADOW_FRUSTUM_HALF;
    dirLight.shadow.camera.right = SHADOW_FRUSTUM_HALF;
    dirLight.shadow.camera.top = SHADOW_FRUSTUM_HALF;
    dirLight.shadow.camera.bottom = -SHADOW_FRUSTUM_HALF;
    dirLight.shadow.camera.near = 10;
    dirLight.shadow.camera.far = 360;
    dirLight.shadow.bias = -0.0005;
    dirLight.shadow.normalBias = 0.032;
    lightsGroup.add(dirLight);
    lightsGroup.add(dirLight.target);
    this._dirLight = dirLight;

    // Reusable dynamic PointLight pool
    const pointLights: THREE.PointLight[] = [];
    for (let i = 0; i < MAX_DYNAMIC_LIGHTS; i++) {
      const pl = new THREE.PointLight(0xffffff, 0, 45, 1.6);
      pl.visible = false;
      lightsGroup.add(pl);
      pointLights.push(pl);
    }
    this._pointLightPool = pointLights;

    const sceneState: SceneGfxState = {
      dirLight,
      sunDir: this._sunDir.clone(),
      pointLights,
      baseFog: { ...this._baseFog },
      skyMesh,
    };
    scene.userData._gfxSceneState = sceneState;

    this._applyShadowSettings();
    this._applyEnvironmentToScenes();
    this._applyFogToScene(scene);
    this._syncSceneMaterials(scene);
  }

  private _activateSceneState(scene: THREE.Scene): void {
    if (!scene || this._activeScene === scene) return;
    this._activeScene = scene;
    const st = scene.userData?._gfxSceneState as SceneGfxState | undefined;
    if (st) {
      this._dirLight = st.dirLight;
      this._sunDir.copy(st.sunDir);
      this._pointLightPool = st.pointLights;
      this._baseFog = st.baseFog;
      this._skyMesh = st.skyMesh;
      this._applyShadowSettings();
      this._applyFogToScene(scene);
    }
  }

  /**
   * Move the directional shadow frustum smoothly with the player, snapping to
   * shadow-map texels to prevent shadow crawling.
   */
  updateShadowTarget(playerPos: { x: number; y: number; z: number } | null | undefined): void {
    if (!this._dirLight || !playerPos) return;
    let tx = playerPos.x;
    const ty = playerPos.y;
    let tz = playerPos.z;

    const size = this._dirLight.shadow.mapSize.x;
    if (this._dirLight.castShadow && size > 0) {
      const texelSize = (SHADOW_FRUSTUM_HALF * 2) / size;
      tx = Math.round(tx / texelSize) * texelSize;
      tz = Math.round(tz / texelSize) * texelSize;
    }

    this._dirLight.target.position.set(tx, ty, tz);
    this._dirLight.target.updateMatrixWorld();
    this._dirLight.position.set(
      tx + this._sunDir.x * 145,
      ty + this._sunDir.y * 145,
      tz + this._sunDir.z * 145
    );
  }

  /**
   * Update a pooled dynamic PointLight (no-op when dynamicLights is disabled).
   */
  setDynamicLight(
    idx: number,
    pos: { x: number; y: number; z: number } | null | undefined,
    color: THREE.ColorRepresentation = 0xffffff,
    intensity = 2.0,
    distance = 45
  ): void {
    const light = this._pointLightPool[idx];
    if (!light) return;
    if (!this.settings.dynamicLights || !pos || intensity <= 0) {
      light.visible = false;
      light.intensity = 0;
      return;
    }
    light.visible = true;
    light.position.set(pos.x, pos.y, pos.z);
    light.color.set(color);
    light.intensity = intensity;
    light.distance = distance;
  }

  clearDynamicLights(): void {
    for (let i = 0; i < this._pointLightPool.length; i++) {
      const light = this._pointLightPool[i];
      light.visible = false;
      light.intensity = 0;
    }
  }

  applyTrackLOD(trackInstance: Pick<TrackInstance, 'lodGroups'> | null | undefined): void {
    if (!trackInstance) return;
    this._currentTrack = trackInstance;
    const density = clamp(Math.round(this.settings.sceneryDensity ?? 3), 0, 3);
    if (Array.isArray(trackInstance.lodGroups)) {
      for (let i = 0; i < trackInstance.lodGroups.length; i++) {
        const grp = trackInstance.lodGroups[i];
        if (grp) grp.visible = i <= density;
      }
    }
  }

  resize(width: number | null = null, height: number | null = null): void {
    let w = width;
    let h = height;
    if (w == null || h == null) {
      if (this.containerEl && this.containerEl.clientWidth > 0 && this.containerEl.clientHeight > 0) {
        w = this.containerEl.clientWidth;
        h = this.containerEl.clientHeight;
      } else if (typeof window !== 'undefined') {
        w = window.innerWidth || 1280;
        h = window.innerHeight || 720;
      } else {
        w = 1280;
        h = 720;
      }
    }

    w = Math.max(1, Math.floor(w));
    h = Math.max(1, Math.floor(h));
    this._width = w;
    this._height = h;

    const deviceDpr = typeof window !== 'undefined' ? (window.devicePixelRatio || 1) : 1;
    const maxDpr = this.settings.maxDpr ?? 1.5;
    const resScale = this.settings.resScale ?? 1.0;
    const effectiveRatio = clamp(Math.min(deviceDpr, maxDpr) * resScale, 0.25, 2.3);

    this.renderer.setPixelRatio(effectiveRatio);
    this.renderer.setSize(w, h, false);

    if (this.canvas && this.canvas.classList) {
      this.canvas.classList.toggle('pixelated', Boolean(this.settings.pixelatedCanvas));
    }
    this._postDirty = true;
  }

  private _applyShadowSettings(): void {
    const mode = this.settings.shadowMode || 'high';
    const maxTex = this.renderer.capabilities?.maxTextureSize || 4096;
    const desired = Math.min(SHADOW_SIZES[mode] ?? 0, maxTex);
    const enabled = desired > 0;

    this.renderer.shadowMap.enabled = enabled;
    if (this._dirLight) {
      this._dirLight.castShadow = enabled;
      if (enabled && this._dirLight.shadow.mapSize.x !== desired) {
        this._dirLight.shadow.mapSize.set(desired, desired);
        if (this._dirLight.shadow.map) {
          this._dirLight.shadow.map.dispose();
          this._dirLight.shadow.map = null;
        }
        this._dirLight.shadow.needsUpdate = true;
      }
    }
  }

  private _applyEnvironmentToScenes(): void {
    const useEnv = this.settings.materialTier === 'physical';
    const envTex = useEnv ? this._ensureEnvMap() : null;
    for (const scene of this._trackedScenes) {
      scene.environment = envTex;
    }
  }

  private _applyFogToScene(scene: THREE.Scene): void {
    if (!scene || !scene.fog) return;
    const drawDist = Math.max(180, this.settings.drawDistance || 1050);
    const ratio = drawDist / 1200;
    if (scene.fog instanceof THREE.Fog) {
      scene.fog.near = Math.min(drawDist * 0.42, Math.max(40, this._baseFog.near * ratio));
      scene.fog.far = drawDist * 0.98;
    }
  }

  private _applyAllSettings(): void {
    this.renderer.toneMapping = this.settings.toneMapping
      ? THREE.ACESFilmicToneMapping
      : THREE.NoToneMapping;
    this.renderer.toneMappingExposure = this.settings.toneMapping ? 1.05 : 1.0;

    if (this.texLib && typeof this.texLib.setAnisotropy === 'function') {
      const maxAniso = this.renderer.capabilities?.getMaxAnisotropy?.() || 16;
      this.texLib.setAnisotropy(Math.min(this.settings.anisotropy || 1, maxAniso));
    }

    this._applyShadowSettings();
    this._applyEnvironmentToScenes();

    if (!this.settings.dynamicLights) {
      this.clearDynamicLights();
    }

    for (const scene of this._trackedScenes) {
      this._applyFogToScene(scene);
      if (scene.userData._gfxTier !== this.settings.materialTier) {
        this._syncSceneMaterials(scene);
      }
    }

    if (this._currentTrack) {
      this.applyTrackLOD(this._currentTrack);
    }

    this.resize(this._width, this._height);
  }

  private _ensurePostResources(targetW: number, targetH: number): boolean {
    if (this._postFailed) return false;
    try {
      if (!this._post) {
        const gl = this.renderer.getContext();
        const isWebGL2 = typeof WebGL2RenderingContext !== 'undefined' && gl instanceof WebGL2RenderingContext;
        const canHalfFloat =
          (isWebGL2 && Boolean(gl.getExtension('EXT_color_buffer_float'))) ||
          Boolean(gl.getExtension('EXT_color_buffer_half_float'));
        const rtType = canHalfFloat ? THREE.HalfFloatType : THREE.UnsignedByteType;

        const quadGeo = new THREE.PlaneGeometry(2, 2);
        const orthoCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);

        const brightMat = new THREE.ShaderMaterial({
          vertexShader: POST_VERT,
          fragmentShader: BRIGHT_FRAG,
          toneMapped: false,
          depthTest: false,
          depthWrite: false,
          uniforms: {
            tDiffuse: { value: null },
            uThreshold: { value: 0.78 },
          },
        });
        const blurMat = new THREE.ShaderMaterial({
          vertexShader: POST_VERT,
          fragmentShader: BLUR_FRAG,
          toneMapped: false,
          depthTest: false,
          depthWrite: false,
          uniforms: {
            tDiffuse: { value: null },
            uDirection: { value: new THREE.Vector2(1, 0) },
            uTexelSize: { value: new THREE.Vector2(1 / 256, 1 / 256) },
          },
        });
        const compMat = new THREE.ShaderMaterial({
          vertexShader: POST_VERT,
          fragmentShader: COMPOSITE_FRAG,
          toneMapped: true,
          depthTest: false,
          depthWrite: false,
          uniforms: {
            tDiffuse: { value: null },
            tBloom: { value: null },
            uBloomEnabled: { value: 0 },
            uBloomStrength: { value: 0.58 },
            uSpeedFxEnabled: { value: 0 },
            uBoost: { value: 0 },
          },
        });

        const quadMesh = new THREE.Mesh(quadGeo, compMat);
        quadMesh.frustumCulled = false;
        const postScene = new THREE.Scene();
        postScene.add(quadMesh);

        const rtOpts: THREE.RenderTargetOptions = {
          minFilter: THREE.LinearFilter,
          magFilter: THREE.LinearFilter,
          format: THREE.RGBAFormat,
          type: rtType,
          depthBuffer: true,
          stencilBuffer: false,
        };
        const bloomOpts: THREE.RenderTargetOptions = {
          minFilter: THREE.LinearFilter,
          magFilter: THREE.LinearFilter,
          format: THREE.RGBAFormat,
          type: rtType,
          depthBuffer: false,
          stencilBuffer: false,
        };

        this._post = {
          orthoCam,
          postScene,
          quadMesh,
          quadGeo,
          brightMat,
          blurMat,
          compMat,
          sceneRT: new THREE.WebGLRenderTarget(targetW, targetH, rtOpts),
          bloomRT1: new THREE.WebGLRenderTarget(Math.max(2, targetW >> 2), Math.max(2, targetH >> 2), bloomOpts),
          bloomRT2: new THREE.WebGLRenderTarget(Math.max(2, targetW >> 2), Math.max(2, targetH >> 2), bloomOpts),
        };
        this._lastTargetW = targetW;
        this._lastTargetH = targetH;
        this._postDirty = false;
      } else if (this._postDirty || this._lastTargetW !== targetW || this._lastTargetH !== targetH) {
        const bw = Math.max(2, targetW >> 2);
        const bh = Math.max(2, targetH >> 2);
        this._post.sceneRT.setSize(targetW, targetH);
        this._post.bloomRT1.setSize(bw, bh);
        this._post.bloomRT2.setSize(bw, bh);
        this._lastTargetW = targetW;
        this._lastTargetH = targetH;
        this._postDirty = false;
      }
      return true;
    } catch {
      this._postFailed = true;
      return false;
    }
  }

  render(scene: THREE.Scene | null | undefined, camera: THREE.Camera | null | undefined, boostIntensity = 0): void {
    if (!scene || !camera) return;

    this._trackedScenes.add(scene);
    this._activateSceneState(scene);
    if (scene.userData._gfxTier !== this.settings.materialTier) {
      this._syncSceneMaterials(scene);
    }

    const drawDist = Math.max(180, this.settings.drawDistance || 1050);
    const targetFar = drawDist * 1.15;
    const projCam = camera as THREE.PerspectiveCamera;
    if (typeof projCam.far === 'number' && typeof projCam.updateProjectionMatrix === 'function') {
      if (Math.abs(projCam.far - targetFar) > 1) {
        projCam.far = targetFar;
        projCam.updateProjectionMatrix();
      }
    }
    if (scene.fog) {
      this._applyFogToScene(scene);
    }

    const skyMesh = scene.getObjectByName('__gfx_sky');
    if (skyMesh) {
      skyMesh.position.copy(camera.position);
    }

    const wantBloom = Boolean(this.settings.bloom);
    const wantSpeed = Boolean(this.settings.speedFx) && boostIntensity > 0.01;
    const usePost = (wantBloom || wantSpeed) && !this._postFailed;

    if (!usePost) {
      this.renderer.render(scene, camera);
      return;
    }

    const sizeVec = new THREE.Vector2();
    this.renderer.getDrawingBufferSize(sizeVec);
    const targetW = Math.max(2, Math.floor(sizeVec.x));
    const targetH = Math.max(2, Math.floor(sizeVec.y));

    if (!this._ensurePostResources(targetW, targetH)) {
      this.renderer.render(scene, camera);
      return;
    }

    const p = this._post!;
    const prevTarget = this.renderer.getRenderTarget();
    const prevShadowAuto = this.renderer.shadowMap.autoUpdate;

    try {
      // 1. Render scene to linear HDR render target
      this.renderer.setRenderTarget(p.sceneRT);
      this.renderer.clear();
      this.renderer.render(scene, camera);

      // Avoid running shadow map pass again on fullscreen post quads
      this.renderer.shadowMap.autoUpdate = false;

      if (wantBloom) {
        const bw = Math.max(2, targetW >> 2);
        const bh = Math.max(2, targetH >> 2);

        // 2. Bright-pass threshold
        p.brightMat.uniforms.tDiffuse.value = p.sceneRT.texture;
        p.quadMesh.material = p.brightMat;
        this.renderer.setRenderTarget(p.bloomRT1);
        this.renderer.render(p.postScene, p.orthoCam);

        // 3. Separable 5-tap blur (H then V)
        p.blurMat.uniforms.uTexelSize.value.set(1 / bw, 1 / bh);
        p.blurMat.uniforms.tDiffuse.value = p.bloomRT1.texture;
        p.blurMat.uniforms.uDirection.value.set(1.4, 0);
        p.quadMesh.material = p.blurMat;
        this.renderer.setRenderTarget(p.bloomRT2);
        this.renderer.render(p.postScene, p.orthoCam);

        p.blurMat.uniforms.tDiffuse.value = p.bloomRT2.texture;
        p.blurMat.uniforms.uDirection.value.set(0, 1.4);
        this.renderer.setRenderTarget(p.bloomRT1);
        this.renderer.render(p.postScene, p.orthoCam);
      }

      // 4. Composite + radial speed FX + toneMapping + sRGB output to screen
      p.compMat.uniforms.tDiffuse.value = p.sceneRT.texture;
      p.compMat.uniforms.tBloom.value = wantBloom ? p.bloomRT1.texture : p.sceneRT.texture;
      p.compMat.uniforms.uBloomEnabled.value = wantBloom ? 1.0 : 0.0;
      p.compMat.uniforms.uSpeedFxEnabled.value = wantSpeed ? 1.0 : 0.0;
      p.compMat.uniforms.uBoost.value = clamp(boostIntensity, 0, 1.5);
      p.quadMesh.material = p.compMat;

      this.renderer.setRenderTarget(prevTarget);
      this.renderer.render(p.postScene, p.orthoCam);
    } catch {
      this._postFailed = true;
      this.renderer.setRenderTarget(prevTarget);
      this.renderer.render(scene, camera);
    } finally {
      this.renderer.shadowMap.autoUpdate = prevShadowAuto;
    }
  }

  recordFrame(dtMs: number): void {
    if (!Number.isFinite(dtMs) || dtMs <= 0) return;
    const clamped = clamp(dtMs, 0.5, 250);
    this._frameMs = this._frameMs * 0.88 + clamped * 0.12;
    this._fpsAccumTime += clamped;
    this._fpsAccumFrames += 1;
    if (this._fpsAccumTime >= 250) {
      this._fps = (this._fpsAccumFrames * 1000) / this._fpsAccumTime;
      this._fpsAccumTime = 0;
      this._fpsAccumFrames = 0;
    }
  }

  shouldRenderFrame(nowMs: number): boolean {
    const cap = this.settings.fpsCap || 0;
    if (cap <= 0) {
      this._lastRenderTime = nowMs;
      return true;
    }
    const minInterval = 1000 / cap;
    // Slight tolerance avoids dropping 60Hz monitors to 30fps on sub-ms rAF jitter
    if (nowMs - this._lastRenderTime >= minInterval - 1.5) {
      this._lastRenderTime = nowMs;
      return true;
    }
    return false;
  }

  dispose(): void {
    if (typeof window !== 'undefined') {
      window.removeEventListener('resize', this._onWindowResize);
    }
    for (const entry of this._materialEntries) {
      for (const mat of entry.cache.values()) {
        mat.dispose();
      }
      entry.cache.clear();
    }
    this._materialEntries = [];

    if (this._envRT) {
      this._envRT.dispose();
      this._envRT = null;
      this._envTexture = null;
    }
    if (this._post) {
      this._post.quadGeo.dispose();
      this._post.brightMat.dispose();
      this._post.blurMat.dispose();
      this._post.compMat.dispose();
      this._post.sceneRT.dispose();
      this._post.bloomRT1.dispose();
      this._post.bloomRT2.dispose();
      this._post = null;
    }
    this.renderer.dispose();
  }
}
