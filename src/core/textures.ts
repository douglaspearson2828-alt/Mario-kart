import * as THREE from 'three';

type ProceduralCanvas =
  | HTMLCanvasElement
  | OffscreenCanvas
  | {
      width: number;
      height: number;
      getContext: (contextId: '2d') => CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D | null;
    };

export interface TextureOptions {
  repeat?: boolean;
  srgb?: boolean;
  anisotropy?: number;
  generateMipmaps?: boolean;
}

export type TextureKey =
  | 'asphalt'
  | 'cobble'
  | 'ice'
  | 'lava_rock'
  | 'lava_glow'
  | 'neon_road'
  | 'wood_pier'
  | 'sand_road'
  | 'rainbow_road'
  | 'grass'
  | 'sand'
  | 'snow'
  | 'boost_chevron'
  | 'start_checker'
  | 'curb_red_white'
  | 'curb_neon'
  | 'kart_carbon'
  | 'kart_stripes'
  | 'blob_shadow'
  | 'sun_flare'
  | 'particle_soft';

export interface BoostScrollTarget {
  isTexture?: boolean;
  offset?: THREE.Vector2;
  textures?: Record<string, THREE.Texture | undefined>;
  boost_chevron?: THREE.Texture;
}

/**
 * Deterministic fast PRNG (Mulberry32) so procedural textures are crisp and repeatable.
 */
function createRng(seed: number): () => number {
  let a = seed >>> 0;
  return function next(): number {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function makeCanvas(width: number, height: number): ProceduralCanvas {
  if (typeof document !== 'undefined') {
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    return canvas;
  }
  if (typeof OffscreenCanvas !== 'undefined') {
    return new OffscreenCanvas(width, height);
  }
  return {
    width,
    height,
    getContext: () => null,
  };
}

type Canvas2DContext = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;

/**
 * Draw callback wrapped across 3x3 tile offsets so stamps never clip at texture borders.
 */
function drawWrapped(ctx: Canvas2DContext, w: number, h: number, fn: (g: Canvas2DContext) => void): void {
  for (let ox = -1; ox <= 1; ox++) {
    for (let oy = -1; oy <= 1; oy++) {
      ctx.save();
      ctx.translate(ox * w, oy * h);
      fn(ctx);
      ctx.restore();
    }
  }
}

function clampByte(v: number): number {
  return v < 0 ? 0 : v > 255 ? 255 : v | 0;
}

const TEXTURE_ALIASES: Record<string, TextureKey> = {
  road: 'asphalt',
  wood: 'wood_pier',
  neon: 'neon_road',
  rainbow: 'rainbow_road',
  lava: 'lava_glow',
  offroad_grass: 'grass',
  offroad_sand: 'sand',
  offroad_snow: 'snow',
};

/**
 * Scroll boost_chevron texture UV.y smoothly in the forward (+V) direction.
 * Accepts either a TextureLibrary instance or a THREE.Texture directly.
 */
export function scrollBoost(texLibOrTex: BoostScrollTarget | THREE.Texture | null | undefined, dt = 0): void {
  if (!texLibOrTex || !Number.isFinite(dt)) return;
  const tex = (texLibOrTex as THREE.Texture).isTexture
    ? (texLibOrTex as THREE.Texture)
    : (texLibOrTex as BoostScrollTarget).textures?.boost_chevron ||
      (texLibOrTex as BoostScrollTarget).boost_chevron;
  if (!tex) return;
  tex.offset.y -= dt * 2.2;
  if (tex.offset.y < -1) tex.offset.y += Math.ceil(-tex.offset.y);
  if (tex.offset.y > 1) tex.offset.y -= Math.floor(tex.offset.y);
}

/**
 * Procedural Canvas2D TextureLibrary (zero external image assets).
 */
export class TextureLibrary {
  textures: Record<string, THREE.CanvasTexture> = {};
  private _anisotropy = 4;

  asphalt!: THREE.CanvasTexture;
  cobble!: THREE.CanvasTexture;
  ice!: THREE.CanvasTexture;
  lava_rock!: THREE.CanvasTexture;
  lava_glow!: THREE.CanvasTexture;
  neon_road!: THREE.CanvasTexture;
  wood_pier!: THREE.CanvasTexture;
  sand_road!: THREE.CanvasTexture;
  rainbow_road!: THREE.CanvasTexture;
  grass!: THREE.CanvasTexture;
  sand!: THREE.CanvasTexture;
  snow!: THREE.CanvasTexture;
  boost_chevron!: THREE.CanvasTexture;
  start_checker!: THREE.CanvasTexture;
  curb_red_white!: THREE.CanvasTexture;
  curb_neon!: THREE.CanvasTexture;
  kart_carbon!: THREE.CanvasTexture;
  kart_stripes!: THREE.CanvasTexture;
  blob_shadow!: THREE.CanvasTexture;
  sun_flare!: THREE.CanvasTexture;
  particle_soft!: THREE.CanvasTexture;

  [key: string]: any;

  constructor() {
    this._buildAll();
  }

  _register(name: TextureKey | string, canvas: ProceduralCanvas, options: TextureOptions = {}): THREE.CanvasTexture {
    const {
      repeat = true,
      srgb = true,
      anisotropy = this._anisotropy,
      generateMipmaps = true,
    } = options;

    const tex = new THREE.CanvasTexture(canvas as HTMLCanvasElement);
    tex.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
    tex.wrapS = repeat ? THREE.RepeatWrapping : THREE.ClampToEdgeWrapping;
    tex.wrapT = repeat ? THREE.RepeatWrapping : THREE.ClampToEdgeWrapping;
    tex.generateMipmaps = generateMipmaps;
    tex.minFilter = generateMipmaps ? THREE.LinearMipmapLinearFilter : THREE.LinearFilter;
    tex.magFilter = THREE.LinearFilter;
    tex.anisotropy = Math.max(1, anisotropy);
    tex.needsUpdate = true;

    this.textures[name] = tex;
    (this as Record<string, unknown>)[name] = tex;
    return tex;
  }

  get(name?: string | null): THREE.CanvasTexture | null {
    if (!name) return null;
    if (this.textures[name]) return this.textures[name];
    const alias = TEXTURE_ALIASES[name];
    return alias ? this.textures[alias] || null : null;
  }

  scrollBoost(dt: number): void {
    scrollBoost(this, dt);
  }

  setAnisotropy(n: number): void {
    const target = Math.max(1, Number(n) || 1);
    this._anisotropy = target;
    for (const key of Object.keys(this.textures)) {
      const tex = this.textures[key];
      if (tex) {
        tex.anisotropy = target;
      }
    }
  }

  dispose(): void {
    for (const key of Object.keys(this.textures)) {
      const tex = this.textures[key];
      if (tex && typeof tex.dispose === 'function') {
        tex.dispose();
      }
      delete (this as Record<string, unknown>)[key];
    }
    this.textures = {};
  }

  private _buildAll(): void {
    this._register('asphalt', this._genAsphalt(512));
    this._register('cobble', this._genCobble(256));
    this._register('ice', this._genIce(256));
    this._register('lava_rock', this._genLavaRock(256));
    this._register('lava_glow', this._genLavaGlow(256));
    this._register('neon_road', this._genNeonRoad(512));
    this._register('wood_pier', this._genWoodPier(256));
    this._register('sand_road', this._genSandRoad(256));
    this._register('rainbow_road', this._genRainbowRoad(512));
    this._register('grass', this._genGrass(256));
    this._register('sand', this._genSand(256));
    this._register('snow', this._genSnow(256));
    this._register('boost_chevron', this._genBoostChevron(256));
    this._register('start_checker', this._genStartChecker(256));
    this._register('curb_red_white', this._genCurbRedWhite(128, 256));
    this._register('curb_neon', this._genCurbNeon(128, 256));
    this._register('kart_carbon', this._genKartCarbon(256));
    this._register('kart_stripes', this._genKartStripes(256));
    this._register('blob_shadow', this._genBlobShadow(128), { repeat: false });
    this._register('sun_flare', this._genSunFlare(256), { repeat: false });
    this._register('particle_soft', this._genParticleSoft(128), { repeat: false });
  }

  private _genAsphalt(size: number): ProceduralCanvas {
    const canvas = makeCanvas(size, size);
    const ctx = canvas.getContext('2d');
    if (!ctx) return canvas;

    const img = ctx.createImageData(size, size);
    const data = img.data;
    const rng = createRng(101);
    for (let y = 0; y < size; y++) {
      const u = y / size;
      for (let x = 0; x < size; x++) {
        const vx = x / size;
        // Subtle dual tire-wear grooves on left/right lanes
        const laneWear =
          Math.exp(-Math.pow((vx - 0.3) * 8.0, 2)) +
          Math.exp(-Math.pow((vx - 0.7) * 8.0, 2));
        const macro =
          Math.sin(vx * Math.PI * 6) * Math.cos(u * Math.PI * 4) * 3.0;
        const grit = (rng() - 0.5) * 26;
        const spark = rng() > 0.985 ? 24 : 0;
        const base = 48 - laneWear * 6 + macro + grit + spark;
        const idx = (y * size + x) * 4;
        data[idx] = clampByte(base);
        data[idx + 1] = clampByte(base + 2);
        data[idx + 2] = clampByte(base + 7);
        data[idx + 3] = 255;
      }
    }
    ctx.putImageData(img, 0, 0);

    // Crisp outer shoulder lines and subtle dashed racing centerline
    ctx.fillStyle = 'rgba(236, 242, 248, 0.72)';
    ctx.fillRect(size * 0.035, 0, size * 0.022, size);
    ctx.fillRect(size * 0.943, 0, size * 0.022, size);

    ctx.fillStyle = 'rgba(245, 224, 130, 0.42)';
    const dashCount = 4;
    const step = size / dashCount;
    for (let i = 0; i < dashCount; i++) {
      ctx.fillRect(size * 0.49, i * step + step * 0.14, size * 0.02, step * 0.56);
    }
    return canvas;
  }

  private _genCobble(size: number): ProceduralCanvas {
    const canvas = makeCanvas(size, size);
    const ctx = canvas.getContext('2d');
    if (!ctx) return canvas;
    const rng = createRng(202);

    ctx.fillStyle = '#403932';
    ctx.fillRect(0, 0, size, size);

    const rows = 8;
    const cols = 6;
    const rowH = size / rows;
    const colW = size / cols;
    const palette = ['#9b8f80', '#8b8073', '#a89c8d', '#7b7267', '#948777'];

    for (let r = 0; r < rows; r++) {
      const offset = (r % 2) * (colW * 0.5);
      for (let c = 0; c < cols; c++) {
        const cx = (c * colW + offset) % size;
        const cy = r * rowH;
        const baseColor = palette[(rng() * palette.length) | 0];
        const bw = colW - 5;
        const bh = rowH - 5;
        const jitterX = (rng() - 0.5) * 2.5;
        const jitterY = (rng() - 0.5) * 2.5;

        drawWrapped(ctx, size, size, (g) => {
          const x = cx + jitterX + 2.5;
          const y = cy + jitterY + 2.5;
          g.fillStyle = '#5c5349';
          g.beginPath();
          g.roundRect(x, y, bw, bh, 6);
          g.fill();

          g.fillStyle = baseColor;
          g.beginPath();
          g.roundRect(x + 1, y + 1, bw - 3, bh - 3, 5);
          g.fill();

          g.fillStyle = 'rgba(255,248,235,0.18)';
          g.beginPath();
          g.roundRect(x + 3, y + 2, bw - 8, bh * 0.35, 3);
          g.fill();
        });
      }
    }
    return canvas;
  }

  private _genIce(size: number): ProceduralCanvas {
    const canvas = makeCanvas(size, size);
    const ctx = canvas.getContext('2d');
    if (!ctx) return canvas;
    const rng = createRng(303);

    const grad = ctx.createLinearGradient(0, 0, size, size);
    grad.addColorStop(0, '#a8e8ff');
    grad.addColorStop(0.5, '#cff4ff');
    grad.addColorStop(1, '#9be0fa');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, size, size);

    // Glossy diagonal specular sheen bands
    ctx.fillStyle = 'rgba(255, 255, 255, 0.22)';
    for (let i = -2; i <= 4; i++) {
      ctx.beginPath();
      const x0 = i * (size * 0.35);
      ctx.moveTo(x0, 0);
      ctx.lineTo(x0 + size * 0.14, 0);
      ctx.lineTo(x0 - size * 0.25 + size * 0.14, size);
      ctx.lineTo(x0 - size * 0.25, size);
      ctx.closePath();
      ctx.fill();
    }

    // Crisp crystalline fracture lines wrapped seamlessly
    ctx.lineWidth = 1.6;
    for (let i = 0; i < 24; i++) {
      const x1 = rng() * size;
      const y1 = rng() * size;
      const ang = rng() * Math.PI * 2;
      const len = 26 + rng() * 54;
      const x2 = x1 + Math.cos(ang) * len;
      const y2 = y1 + Math.sin(ang) * len;
      const bright = rng() > 0.4;
      drawWrapped(ctx, size, size, (g) => {
        g.strokeStyle = bright ? 'rgba(255,255,255,0.65)' : 'rgba(65,155,205,0.35)';
        g.beginPath();
        g.moveTo(x1, y1);
        g.lineTo((x1 + x2) * 0.5 + 5, (y1 + y2) * 0.5 - 4);
        g.lineTo(x2, y2);
        g.stroke();
      });
    }
    return canvas;
  }

  private _genLavaRock(size: number): ProceduralCanvas {
    const canvas = makeCanvas(size, size);
    const ctx = canvas.getContext('2d');
    if (!ctx) return canvas;
    const rng = createRng(404);

    // Dark basalt base
    ctx.fillStyle = '#211c21';
    ctx.fillRect(0, 0, size, size);

    // Subtle stone pockets
    for (let i = 0; i < 90; i++) {
      const x = rng() * size;
      const y = rng() * size;
      const r = 6 + rng() * 14;
      const shade = 26 + ((rng() * 24) | 0);
      drawWrapped(ctx, size, size, (g) => {
        g.fillStyle = `rgb(${shade + 4}, ${shade}, ${shade + 5})`;
        g.beginPath();
        g.arc(x, y, r, 0, Math.PI * 2);
        g.fill();
      });
    }

    // Glowing magma fissure cracks
    for (let i = 0; i < 16; i++) {
      let x = rng() * size;
      let y = rng() * size;
      const pts: Array<{ x: number; y: number }> = [{ x, y }];
      let ang = rng() * Math.PI * 2;
      const segs = 4 + ((rng() * 4) | 0);
      for (let s = 0; s < segs; s++) {
        ang += (rng() - 0.5) * 1.4;
        x += Math.cos(ang) * (14 + rng() * 16);
        y += Math.sin(ang) * (14 + rng() * 16);
        pts.push({ x, y });
      }
      drawWrapped(ctx, size, size, (g) => {
        g.lineCap = 'round';
        g.lineJoin = 'round';
        g.strokeStyle = 'rgba(255, 72, 0, 0.45)';
        g.lineWidth = 6;
        g.beginPath();
        g.moveTo(pts[0].x, pts[0].y);
        for (let k = 1; k < pts.length; k++) g.lineTo(pts[k].x, pts[k].y);
        g.stroke();

        g.strokeStyle = '#ff8c1a';
        g.lineWidth = 2.4;
        g.stroke();

        g.strokeStyle = '#ffe58f';
        g.lineWidth = 1.0;
        g.stroke();
      });
    }
    return canvas;
  }

  private _genLavaGlow(size: number): ProceduralCanvas {
    const canvas = makeCanvas(size, size);
    const ctx = canvas.getContext('2d');
    if (!ctx) return canvas;

    const img = ctx.createImageData(size, size);
    const data = img.data;
    const TWO_PI = Math.PI * 2;
    for (let y = 0; y < size; y++) {
      const v = (y / size) * TWO_PI;
      for (let x = 0; x < size; x++) {
        const u = (x / size) * TWO_PI;
        const w1 = Math.sin(u * 2 + Math.cos(v * 2));
        const w2 = Math.cos(v * 3 - Math.sin(u * 2 + v));
        const w3 = Math.sin((u + v) * 3) * 0.5;
        const val = (w1 + w2 + w3 + 2.5) / 5.0;
        const heat = Math.max(0, Math.min(1, val));

        // Crust islands vs bright incandescent lava streams
        let r: number;
        let g: number;
        let b: number;
        if (heat < 0.34) {
          const t = heat / 0.34;
          r = 50 + t * 110;
          g = 12 + t * 20;
          b = 8;
        } else if (heat < 0.72) {
          const t = (heat - 0.34) / 0.38;
          r = 160 + t * 95;
          g = 32 + t * 108;
          b = 8 + t * 12;
        } else {
          const t = (heat - 0.72) / 0.28;
          r = 255;
          g = 140 + t * 110;
          b = 20 + t * 140;
        }
        const idx = (y * size + x) * 4;
        data[idx] = clampByte(r);
        data[idx + 1] = clampByte(g);
        data[idx + 2] = clampByte(b);
        data[idx + 3] = 255;
      }
    }
    ctx.putImageData(img, 0, 0);
    return canvas;
  }

  private _genNeonRoad(size: number): ProceduralCanvas {
    const canvas = makeCanvas(size, size);
    const ctx = canvas.getContext('2d');
    if (!ctx) return canvas;

    ctx.fillStyle = '#0b1024';
    ctx.fillRect(0, 0, size, size);

    // Subtle hexagonal/square cyber circuit grid
    ctx.strokeStyle = 'rgba(0, 224, 255, 0.14)';
    ctx.lineWidth = 1.5;
    const step = size / 8;
    for (let i = 0; i <= 8; i++) {
      const p = i * step;
      ctx.beginPath();
      ctx.moveTo(p, 0);
      ctx.lineTo(p, size);
      ctx.stroke();

      ctx.beginPath();
      ctx.moveTo(0, p);
      ctx.lineTo(size, p);
      ctx.stroke();
    }

    // Glowing cyan road border lanes
    const leftGrad = ctx.createLinearGradient(0, 0, size * 0.1, 0);
    leftGrad.addColorStop(0, '#00f6ff');
    leftGrad.addColorStop(0.5, 'rgba(0,246,255,0.65)');
    leftGrad.addColorStop(1, 'rgba(0,246,255,0)');
    ctx.fillStyle = leftGrad;
    ctx.fillRect(0, 0, size * 0.1, size);

    const rightGrad = ctx.createLinearGradient(size * 0.9, 0, size, 0);
    rightGrad.addColorStop(0, 'rgba(0,246,255,0)');
    rightGrad.addColorStop(0.5, 'rgba(0,246,255,0.65)');
    rightGrad.addColorStop(1, '#00f6ff');
    ctx.fillStyle = rightGrad;
    ctx.fillRect(size * 0.9, 0, size * 0.1, size);

    // Hot magenta center lane dashes
    ctx.fillStyle = '#ff2a85';
    const dashes = 4;
    const dStep = size / dashes;
    for (let i = 0; i < dashes; i++) {
      ctx.fillRect(size * 0.486, i * dStep + dStep * 0.15, size * 0.028, dStep * 0.52);
    }
    return canvas;
  }

  private _genWoodPier(size: number): ProceduralCanvas {
    const canvas = makeCanvas(size, size);
    const ctx = canvas.getContext('2d');
    if (!ctx) return canvas;
    const rng = createRng(606);

    ctx.fillStyle = '#3b2412';
    ctx.fillRect(0, 0, size, size);

    const planks = 8;
    const pH = size / planks;
    const tones = ['#945d34', '#86522d', '#a26a3e', '#7b4926'];

    for (let i = 0; i < planks; i++) {
      const y = i * pH;
      ctx.fillStyle = tones[i % tones.length];
      ctx.fillRect(0, y + 2, size, pH - 4);

      // Wood grain lines
      ctx.strokeStyle = 'rgba(55, 28, 10, 0.25)';
      ctx.lineWidth = 1.2;
      for (let g = 0; g < 6; g++) {
        const gy = y + 4 + rng() * (pH - 8);
        ctx.beginPath();
        ctx.moveTo(0, gy);
        ctx.bezierCurveTo(size * 0.33, gy + (rng() - 0.5) * 4, size * 0.66, gy + (rng() - 0.5) * 4, size, gy);
        ctx.stroke();
      }

      // Plank nails
      ctx.fillStyle = '#2d241e';
      for (const nx of [size * 0.08, size * 0.92]) {
        ctx.beginPath();
        ctx.arc(nx, y + pH * 0.35, 2.2, 0, Math.PI * 2);
        ctx.arc(nx, y + pH * 0.65, 2.2, 0, Math.PI * 2);
        ctx.fill();
      }
    }
    return canvas;
  }

  private _genSandRoad(size: number): ProceduralCanvas {
    const canvas = makeCanvas(size, size);
    const ctx = canvas.getContext('2d');
    if (!ctx) return canvas;
    const img = ctx.createImageData(size, size);
    const data = img.data;
    const rng = createRng(707);
    const TWO_PI = Math.PI * 2;
    for (let y = 0; y < size; y++) {
      const v = (y / size) * TWO_PI;
      for (let x = 0; x < size; x++) {
        const u = x / size;
        const ripple = Math.sin(v * 8 + Math.sin(u * TWO_PI * 2) * 1.1) * 7;
        const rut =
          (Math.exp(-Math.pow((u - 0.3) * 7, 2)) + Math.exp(-Math.pow((u - 0.7) * 7, 2))) * -10;
        const noise = (rng() - 0.5) * 16;
        const idx = (y * size + x) * 4;
        data[idx] = clampByte(206 + ripple + rut + noise);
        data[idx + 1] = clampByte(162 + ripple * 0.8 + rut + noise);
        data[idx + 2] = clampByte(106 + ripple * 0.5 + rut * 0.8 + noise);
        data[idx + 3] = 255;
      }
    }
    ctx.putImageData(img, 0, 0);
    return canvas;
  }

  private _genRainbowRoad(size: number): ProceduralCanvas {
    const canvas = makeCanvas(size, size);
    const ctx = canvas.getContext('2d');
    if (!ctx) return canvas;

    const img = ctx.createImageData(size, size);
    const data = img.data;
    const TWO_PI = Math.PI * 2;

    for (let y = 0; y < size; y++) {
      const vy = y / size;
      for (let x = 0; x < size; x++) {
        const ux = x / size;
        // Seamless iridescent rainbow wave across width + length
        const hue = (ux * 1.0 + vy * 2.0 + Math.sin(vy * TWO_PI) * 0.08) % 1;
        const h6 = hue * 6;
        const sect = Math.floor(h6) % 6;
        const f = h6 - Math.floor(h6);
        let r = 0;
        let g = 0;
        let b = 0;
        if (sect === 0) { r = 1; g = f; b = 0.12; }
        else if (sect === 1) { r = 1 - f; g = 1; b = 0.18; }
        else if (sect === 2) { r = 0.12; g = 1; b = f; }
        else if (sect === 3) { r = 0.14; g = 1 - f; b = 1; }
        else if (sect === 4) { r = f; g = 0.18; b = 1; }
        else { r = 1; g = 0.14; b = 1 - f; }

        // Crisp luminous tile grid
        const gx = Math.abs(((ux * 8) % 1) - 0.5);
        const gy = Math.abs(((vy * 8) % 1) - 0.5);
        const gridLine = gx > 0.44 || gy > 0.44 ? 0.35 : 0;
        const edgeGlow = ux < 0.05 || ux > 0.95 ? 0.4 : 0;

        const idx = (y * size + x) * 4;
        data[idx] = clampByte((r * 0.85 + gridLine + edgeGlow) * 255);
        data[idx + 1] = clampByte((g * 0.85 + gridLine + edgeGlow) * 255);
        data[idx + 2] = clampByte((b * 0.9 + gridLine + edgeGlow) * 255);
        data[idx + 3] = 255;
      }
    }
    ctx.putImageData(img, 0, 0);

    // Sparkling star flecks
    const rng = createRng(909);
    ctx.fillStyle = 'rgba(255, 255, 255, 0.85)';
    for (let i = 0; i < 64; i++) {
      const x = rng() * size;
      const y = rng() * size;
      const r = 1.2 + rng() * 2.2;
      drawWrapped(ctx, size, size, (g) => {
        g.beginPath();
        g.arc(x, y, r, 0, Math.PI * 2);
        g.fill();
      });
    }
    return canvas;
  }

  private _genGrass(size: number): ProceduralCanvas {
    const canvas = makeCanvas(size, size);
    const ctx = canvas.getContext('2d');
    if (!ctx) return canvas;

    const img = ctx.createImageData(size, size);
    const data = img.data;
    const rng = createRng(1111);
    const TWO_PI = Math.PI * 2;
    for (let y = 0; y < size; y++) {
      const v = (y / size) * TWO_PI;
      for (let x = 0; x < size; x++) {
        const u = (x / size) * TWO_PI;
        const patch = Math.sin(u * 2 + Math.cos(v * 2)) * 10 + Math.cos(v * 3 - u) * 6;
        const noise = (rng() - 0.5) * 20;
        const idx = (y * size + x) * 4;
        data[idx] = clampByte(62 + patch * 0.7 + noise * 0.7);
        data[idx + 1] = clampByte(154 + patch + noise);
        data[idx + 2] = clampByte(54 + patch * 0.5 + noise * 0.6);
        data[idx + 3] = 255;
      }
    }
    ctx.putImageData(img, 0, 0);

    // Tiny grass blade tufts wrapped seamlessly
    for (let i = 0; i < 80; i++) {
      const x = rng() * size;
      const y = rng() * size;
      const lighter = rng() > 0.45;
      drawWrapped(ctx, size, size, (g) => {
        g.strokeStyle = lighter ? '#6fd45b' : '#2d7a28';
        g.lineWidth = 1.6;
        g.beginPath();
        g.moveTo(x, y);
        g.lineTo(x - 3, y - 7);
        g.moveTo(x, y);
        g.lineTo(x + 2, y - 8);
        g.stroke();
      });
    }
    return canvas;
  }

  private _genSand(size: number): ProceduralCanvas {
    const canvas = makeCanvas(size, size);
    const ctx = canvas.getContext('2d');
    if (!ctx) return canvas;

    const img = ctx.createImageData(size, size);
    const data = img.data;
    const rng = createRng(1212);
    const TWO_PI = Math.PI * 2;
    for (let y = 0; y < size; y++) {
      const v = (y / size) * TWO_PI;
      for (let x = 0; x < size; x++) {
        const u = (x / size) * TWO_PI;
        const wave = Math.sin(u * 4 + Math.sin(v * 2) * 1.4) * 9;
        const grain = (rng() - 0.5) * 16;
        const glint = rng() > 0.992 ? 28 : 0;
        const idx = (y * size + x) * 4;
        data[idx] = clampByte(234 + wave + grain + glint);
        data[idx + 1] = clampByte(202 + wave * 0.9 + grain + glint);
        data[idx + 2] = clampByte(136 + wave * 0.7 + grain + glint);
        data[idx + 3] = 255;
      }
    }
    ctx.putImageData(img, 0, 0);
    return canvas;
  }

  private _genSnow(size: number): ProceduralCanvas {
    const canvas = makeCanvas(size, size);
    const ctx = canvas.getContext('2d');
    if (!ctx) return canvas;

    const img = ctx.createImageData(size, size);
    const data = img.data;
    const rng = createRng(1313);
    const TWO_PI = Math.PI * 2;
    for (let y = 0; y < size; y++) {
      const v = (y / size) * TWO_PI;
      for (let x = 0; x < size; x++) {
        const u = (x / size) * TWO_PI;
        const drift = Math.sin(u * 2 + v * 2) * 10 + Math.cos(u * 3 - v) * 5;
        const grain = (rng() - 0.5) * 10;
        const sparkle = rng() > 0.99 ? 18 : 0;
        const idx = (y * size + x) * 4;
        data[idx] = clampByte(228 + drift * 0.7 + grain + sparkle);
        data[idx + 1] = clampByte(241 + drift * 0.5 + grain + sparkle);
        data[idx + 2] = clampByte(253 + drift * 0.2 + grain + sparkle);
        data[idx + 3] = 255;
      }
    }
    ctx.putImageData(img, 0, 0);
    return canvas;
  }

  private _genBoostChevron(size: number): ProceduralCanvas {
    const canvas = makeCanvas(size, size);
    const ctx = canvas.getContext('2d');
    if (!ctx) return canvas;

    ctx.fillStyle = '#091126';
    ctx.fillRect(0, 0, size, size);

    // Side glowing rails
    ctx.fillStyle = '#00e5ff';
    ctx.fillRect(0, 0, size * 0.08, size);
    ctx.fillRect(size * 0.92, 0, size * 0.08, size);

    // Three vivid stacked chevrons pointing UP (toward +V forward)
    const colors = ['#00f5ff', '#ffe600', '#ff2d78'];
    const count = 3;
    const step = size / count;
    for (let i = 0; i < count; i++) {
      const cy = i * step + step * 0.55;
      drawWrapped(ctx, size, size, (g) => {
        g.strokeStyle = colors[i % colors.length];
        g.lineWidth = size * 0.13;
        g.lineCap = 'round';
        g.lineJoin = 'round';
        g.beginPath();
        g.moveTo(size * 0.18, cy + step * 0.24);
        g.lineTo(size * 0.5, cy - step * 0.24);
        g.lineTo(size * 0.82, cy + step * 0.24);
        g.stroke();

        g.strokeStyle = 'rgba(255,255,255,0.6)';
        g.lineWidth = size * 0.04;
        g.stroke();
      });
    }
    return canvas;
  }

  private _genStartChecker(size: number): ProceduralCanvas {
    const canvas = makeCanvas(size, size);
    const ctx = canvas.getContext('2d');
    if (!ctx) return canvas;

    const cells = 8;
    const cell = size / cells;
    for (let r = 0; r < cells; r++) {
      for (let c = 0; c < cells; c++) {
        ctx.fillStyle = (r + c) % 2 === 0 ? '#f8fafc' : '#161922';
        ctx.fillRect(c * cell, r * cell, cell, cell);
      }
    }
    return canvas;
  }

  private _genCurbRedWhite(w: number, h: number): ProceduralCanvas {
    const canvas = makeCanvas(w, h);
    const ctx = canvas.getContext('2d');
    if (!ctx) return canvas;

    const blocks = 4;
    const bh = h / blocks;
    for (let i = 0; i < blocks; i++) {
      ctx.fillStyle = i % 2 === 0 ? '#e62429' : '#f4f6f9';
      ctx.fillRect(0, i * bh, w, bh);
      // Subtle concrete edge bevel
      ctx.fillStyle = 'rgba(0,0,0,0.16)';
      ctx.fillRect(0, i * bh, w * 0.12, bh);
      ctx.fillStyle = 'rgba(255,255,255,0.22)';
      ctx.fillRect(w * 0.88, i * bh, w * 0.12, bh);
    }
    return canvas;
  }

  private _genCurbNeon(w: number, h: number): ProceduralCanvas {
    const canvas = makeCanvas(w, h);
    const ctx = canvas.getContext('2d');
    if (!ctx) return canvas;

    ctx.fillStyle = '#0e1326';
    ctx.fillRect(0, 0, w, h);

    const blocks = 4;
    const bh = h / blocks;
    for (let i = 0; i < blocks; i++) {
      const color = i % 2 === 0 ? '#00f6ff' : '#ff1f8f';
      ctx.fillStyle = color;
      ctx.fillRect(w * 0.08, i * bh + 3, w * 0.84, bh - 6);
      ctx.fillStyle = 'rgba(255,255,255,0.55)';
      ctx.fillRect(w * 0.3, i * bh + 6, w * 0.4, bh - 12);
    }
    return canvas;
  }

  private _genKartCarbon(size: number): ProceduralCanvas {
    const canvas = makeCanvas(size, size);
    const ctx = canvas.getContext('2d');
    if (!ctx) return canvas;

    ctx.fillStyle = '#181b22';
    ctx.fillRect(0, 0, size, size);

    const step = 16;
    for (let y = 0; y < size; y += step) {
      for (let x = 0; x < size; x += step) {
        const alt = ((x / step) + (y / step)) % 2 === 0;
        const grad = ctx.createLinearGradient(x, y, x + step, y + step);
        if (alt) {
          grad.addColorStop(0, '#2c3240');
          grad.addColorStop(0.5, '#3b4254');
          grad.addColorStop(1, '#1d212b');
        } else {
          grad.addColorStop(0, '#14171f');
          grad.addColorStop(0.5, '#252a36');
          grad.addColorStop(1, '#101218');
        }
        ctx.fillStyle = grad;
        ctx.fillRect(x, y, step - 1, step - 1);
      }
    }
    return canvas;
  }

  private _genKartStripes(size: number): ProceduralCanvas {
    const canvas = makeCanvas(size, size);
    const ctx = canvas.getContext('2d');
    if (!ctx) return canvas;

    // Bright neutral white base so material.color tints cleanly without darkening
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, size, size);

    // Subtle metallic flank shading
    ctx.fillStyle = '#eaeef4';
    ctx.fillRect(0, 0, size * 0.34, size);
    ctx.fillRect(size * 0.66, 0, size * 0.34, size);

    // Twin racing pinstripes + bold center stripe
    ctx.fillStyle = '#3c4252';
    ctx.fillRect(size * 0.34, 0, size * 0.03, size);
    ctx.fillRect(size * 0.63, 0, size * 0.03, size);

    ctx.fillStyle = '#ffffff';
    ctx.fillRect(size * 0.39, 0, size * 0.09, size);
    ctx.fillRect(size * 0.52, 0, size * 0.09, size);

    ctx.fillStyle = '#cfd6e2';
    ctx.fillRect(size * 0.48, 0, size * 0.04, size);
    return canvas;
  }

  private _genBlobShadow(size: number): ProceduralCanvas {
    const canvas = makeCanvas(size, size);
    const ctx = canvas.getContext('2d');
    if (!ctx) return canvas;

    const c = size * 0.5;
    const grad = ctx.createRadialGradient(c, c, size * 0.06, c, c, size * 0.48);
    grad.addColorStop(0, 'rgba(6, 10, 18, 0.78)');
    grad.addColorStop(0.5, 'rgba(6, 10, 18, 0.46)');
    grad.addColorStop(0.82, 'rgba(6, 10, 18, 0.14)');
    grad.addColorStop(1, 'rgba(6, 10, 18, 0.0)');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, size, size);
    return canvas;
  }

  private _genSunFlare(size: number): ProceduralCanvas {
    const canvas = makeCanvas(size, size);
    const ctx = canvas.getContext('2d');
    if (!ctx) return canvas;

    const c = size * 0.5;
    const halo = ctx.createRadialGradient(c, c, 2, c, c, size * 0.49);
    halo.addColorStop(0, 'rgba(255, 255, 245, 1.0)');
    halo.addColorStop(0.18, 'rgba(255, 240, 185, 0.88)');
    halo.addColorStop(0.45, 'rgba(255, 195, 95, 0.32)');
    halo.addColorStop(1, 'rgba(255, 170, 60, 0.0)');
    ctx.fillStyle = halo;
    ctx.fillRect(0, 0, size, size);

    // 6-point crisp diffraction rays
    ctx.save();
    ctx.translate(c, c);
    for (let i = 0; i < 6; i++) {
      ctx.rotate(Math.PI / 3);
      const rayGrad = ctx.createLinearGradient(0, -size * 0.48, 0, size * 0.48);
      rayGrad.addColorStop(0, 'rgba(255,255,255,0)');
      rayGrad.addColorStop(0.5, 'rgba(255,250,220,0.48)');
      rayGrad.addColorStop(1, 'rgba(255,255,255,0)');
      ctx.fillStyle = rayGrad;
      ctx.fillRect(-3, -size * 0.46, 6, size * 0.92);
    }
    ctx.restore();
    return canvas;
  }

  private _genParticleSoft(size: number): ProceduralCanvas {
    const canvas = makeCanvas(size, size);
    const ctx = canvas.getContext('2d');
    if (!ctx) return canvas;

    const c = size * 0.5;
    const grad = ctx.createRadialGradient(c, c, 1, c, c, size * 0.48);
    grad.addColorStop(0, 'rgba(255, 255, 255, 1.0)');
    grad.addColorStop(0.35, 'rgba(255, 255, 255, 0.72)');
    grad.addColorStop(0.7, 'rgba(255, 255, 255, 0.2)');
    grad.addColorStop(1, 'rgba(255, 255, 255, 0.0)');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, size, size);
    return canvas;
  }
}
