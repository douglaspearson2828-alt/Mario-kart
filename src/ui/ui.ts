import {
  CUPS,
  CUP_IDS,
  DIFFICULTIES,
  GRAPHICS_PRESETS,
  ITEM_META,
  GRAND_PRIX_POINTS,
  computeCombinedStats,
  type CharacterDef,
  type CupId,
  type DifficultyId,
  type GraphicsPresetId,
  type GraphicsSettings,
  type ItemId,
  type KartDef,
  type KartState,
  type StatProfile,
  type TrackDefinition,
  type TrackInstance,
  type WheelDef,
} from '../core/contracts';

export type RaceMode = 'gp' | 'vs';
export type ScreenId = 'title' | 'garage' | 'tracks' | 'race' | 'results';
export type PresetSelectionId = GraphicsPresetId | 'custom';
export type HudBannerVariant = 'boost' | 'danger' | 'lap' | 'spiny';

export interface GameSelection {
  mode: RaceMode;
  cupId: CupId;
  trackId: string;
  charId: string;
  kartId: string;
  wheelId: string;
  difficultyId: DifficultyId;
}

export interface UIGraphicsSettings extends GraphicsSettings {
  presetId: PresetSelectionId;
  showFps: boolean;
}

export interface AudioVolumes {
  master: number;
  sfx: number;
  music: number;
}

export interface GraphicsStats {
  fps: number;
  frameMs?: number;
  presetId?: PresetSelectionId;
}

export interface GameUICallbacks {
  onPlaySfx?: (name: string) => void;
  onScreenChange?: (screen: ScreenId) => void;
  onSelectionChange?: (selection: GameSelection) => void;
  onGarageDrag?: (dx: number, dy: number) => void;
  onGarageReset?: () => void;
  onStartGrandPrix?: (selection: GameSelection) => void;
  onStartVsRace?: (selection: GameSelection) => void;
  onApplyGraphicsPreset?: (presetId: GraphicsPresetId) => void;
  onUpdateGraphicsSettings?: (patch: Partial<UIGraphicsSettings>) => void;
  onUpdateAudioVolumes?: (volumes: AudioVolumes) => void;
  onResumeRace?: () => void;
  onRestartRace?: () => void;
  onNextRace?: () => void;
  onQuitToTitle?: () => void;
}

export interface GameUIOptions {
  characters?: CharacterDef[];
  karts?: KartDef[];
  wheels?: WheelDef[];
  tracks?: TrackDefinition[];
  initialSettings?: Partial<UIGraphicsSettings>;
  initialVolumes?: Partial<AudioVolumes>;
  callbacks?: GameUICallbacks;
}

export interface RaceHudUpdateParams {
  player: KartState | null | undefined;
  karts: KartState[];
  trackInstance?: TrackInstance | null;
  trackDef?: TrackDefinition | null;
  raceTime: number;
  countdownText?: string;
  totalLaps?: number;
  incomingBlueShell?: boolean;
  gfxStats?: GraphicsStats | null;
  dt?: number;
}

export interface ResultsRow {
  id: string;
  name: string;
  isPlayer: boolean;
  rank: number;
  color?: string | number;
  kartName?: string;
  finished: boolean;
  finishTime: number;
  totalPoints: number;
}

export interface ShowResultsParams {
  isGrandPrix: boolean;
  cupName?: string;
  raceNumber: number;
  totalRaces: number;
  trackName: string;
  rows: ResultsRow[];
  isFinalPodium: boolean;
}

interface Point2D {
  x: number;
  z: number;
}

interface TrackBounds2D {
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
  spanX: number;
  spanZ: number;
  cx: number;
  cz: number;
}

interface MinimapTransform {
  toX: (x: number) => number;
  toY: (z: number) => number;
}

interface UIDomRefs {
  title: HTMLElement;
  garage: HTMLElement;
  tracks: HTMLElement;
  race: HTMLElement;
  results: HTMLElement;
  pauseModal: HTMLElement;
  settingsModal: HTMLElement;
  controlsModal: HTMLElement;
}

interface HudDomRefs {
  itemBox: HTMLElement;
  itemIcon: HTMLElement;
  itemName: HTMLElement;
  itemCount: HTMLElement;
  trailHint: HTMLElement;
  lap: HTMLElement;
  timer: HTMLElement;
  preset: HTMLElement;
  fps: HTMLElement;
  trackName: HTMLElement;
  minimap: HTMLCanvasElement;
  coins: HTMLElement;
  speed: HTMLElement;
  mtFill: HTMLElement;
  mtLabel: HTMLElement;
  rankBadge: HTMLElement;
  rankNum: HTMLElement;
  rankSup: HTMLElement;
  countdown: HTMLElement;
  alerts: HTMLElement;
  stripKeys: HTMLElement;
  stripToggle: HTMLElement;
}

type BooleanSettingKey = 'showFps' | 'bloom' | 'speedFx' | 'dynamicLights' | 'pixelatedCanvas';
type RangeSettingKey = 'resScale' | 'drawDistance';
type StringSelectSettingKey = 'shadowMode' | 'materialTier';
type NumberSelectSettingKey = 'sceneryDensity' | 'particleLevel' | 'fpsCap';
type VolumeKey = keyof AudioVolumes;

const RANK_SUFFIXES = ['st', 'nd', 'rd', 'th', 'th', 'th', 'th', 'th'] as const;
const STAT_ROWS: readonly { key: keyof StatProfile; label: string }[] = [
  { key: 'speed', label: 'Speed' },
  { key: 'accel', label: 'Accel' },
  { key: 'weight', label: 'Weight' },
  { key: 'handling', label: 'Handling' },
  { key: 'offroad', label: 'Off-Road' },
  { key: 'miniTurbo', label: 'Mini-Turbo' },
];
const ROULETTE_KEYS = Object.keys(ITEM_META) as ItemId[];

function escHtml(str: unknown): string {
  return String(str ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function toCssColor(color: string | number | null | undefined, fallback = '#ffffff'): string {
  if (typeof color === 'number' && Number.isFinite(color)) {
    return `#${(color >>> 0).toString(16).padStart(6, '0')}`;
  }
  if (typeof color === 'string' && color.trim().length > 0) {
    return color;
  }
  return fallback;
}

function getPresetDef(id: PresetSelectionId | undefined): GraphicsSettings | undefined {
  if (!id || id === 'custom') return undefined;
  return GRAPHICS_PRESETS[id];
}

function formatTime(sec: number): string {
  if (!Number.isFinite(sec) || sec < 0) return '--:--.--';
  const totalMs = Math.floor(sec * 1000);
  const mins = Math.floor(totalMs / 60000);
  const secs = Math.floor((totalMs % 60000) / 1000);
  const cs = Math.floor((totalMs % 1000) / 10);
  return `${mins}:${String(secs).padStart(2, '0')}.${String(cs).padStart(2, '0')}`;
}

function evalCatmullRom2D(p0: Point2D, p1: Point2D, p2: Point2D, p3: Point2D, t: number): Point2D {
  const t2 = t * t;
  const t3 = t2 * t;
  const x =
    0.5 *
    (2 * p1.x +
      (-p0.x + p2.x) * t +
      (2 * p0.x - 5 * p1.x + 4 * p2.x - p3.x) * t2 +
      (-p0.x + 3 * p1.x - 3 * p2.x + p3.x) * t3);
  const z =
    0.5 *
    (2 * p1.z +
      (-p0.z + p2.z) * t +
      (2 * p0.z - 5 * p1.z + 4 * p2.z - p3.z) * t2 +
      (-p0.z + 3 * p1.z - 3 * p2.z + p3.z) * t3);
  return { x, z };
}

function sampleClosedSplineXZ(controlPoints: readonly Point2D[] | undefined, samples = 180): Point2D[] {
  const n = controlPoints?.length || 0;
  if (n < 3 || !controlPoints) return [];
  const pts: Point2D[] = [];
  for (let i = 0; i < samples; i++) {
    const u = (i / samples) * n;
    const seg = Math.floor(u) % n;
    const t = u - Math.floor(u);
    const p0 = controlPoints[(seg - 1 + n) % n];
    const p1 = controlPoints[seg];
    const p2 = controlPoints[(seg + 1) % n];
    const p3 = controlPoints[(seg + 2) % n];
    pts.push(evalCatmullRom2D(p0, p1, p2, p3, t));
  }
  return pts;
}

function sampleOpenSplineXZ(points: readonly Point2D[] | undefined, samples = 24): Point2D[] {
  const n = points?.length || 0;
  if (!points || n < 2) return points ? [...points] : [];
  if (n === 2) {
    const out: Point2D[] = [];
    for (let i = 0; i <= samples; i++) {
      const t = i / samples;
      out.push({
        x: points[0].x + (points[1].x - points[0].x) * t,
        z: points[0].z + (points[1].z - points[0].z) * t,
      });
    }
    return out;
  }
  const out: Point2D[] = [];
  const segCount = n - 1;
  for (let i = 0; i <= samples; i++) {
    const u = (i / samples) * segCount;
    const seg = Math.min(segCount - 1, Math.floor(u));
    const t = u - seg;
    const p0 = points[Math.max(0, seg - 1)];
    const p1 = points[seg];
    const p2 = points[seg + 1];
    const p3 = points[Math.min(n - 1, seg + 2)];
    out.push(evalCatmullRom2D(p0, p1, p2, p3, t));
  }
  return out;
}

function computeTrackBounds(mainPts: readonly Point2D[], shortcutCurves: readonly Point2D[][]): TrackBounds2D {
  let minX = Infinity;
  let maxX = -Infinity;
  let minZ = Infinity;
  let maxZ = -Infinity;
  for (const p of mainPts) {
    if (p.x < minX) minX = p.x;
    if (p.x > maxX) maxX = p.x;
    if (p.z < minZ) minZ = p.z;
    if (p.z > maxZ) maxZ = p.z;
  }
  for (const sc of shortcutCurves) {
    for (const p of sc) {
      if (p.x < minX) minX = p.x;
      if (p.x > maxX) maxX = p.x;
      if (p.z < minZ) minZ = p.z;
      if (p.z > maxZ) maxZ = p.z;
    }
  }
  if (!Number.isFinite(minX)) {
    return { minX: -1, maxX: 1, minZ: -1, maxZ: 1, spanX: 2, spanZ: 2, cx: 0, cz: 0 };
  }
  const spanX = Math.max(10, maxX - minX);
  const spanZ = Math.max(10, maxZ - minZ);
  return {
    minX,
    maxX,
    minZ,
    maxZ,
    spanX,
    spanZ,
    cx: (minX + maxX) * 0.5,
    cz: (minZ + maxZ) * 0.5,
  };
}

/**
 * Renders and manages all Turbo Kart 8 UI screens, HUD, minimap, settings & overlays.
 */
export class GameUI {
  rootEl: HTMLElement;
  characters: CharacterDef[];
  karts: KartDef[];
  wheels: WheelDef[];
  tracks: TrackDefinition[];
  callbacks: GameUICallbacks;

  selection: GameSelection;
  settings: UIGraphicsSettings;
  volumes: AudioVolumes;

  currentScreen: ScreenId;
  settingsOpen: boolean;
  controlsOpen: boolean;
  pauseOpen: boolean;
  controlStripHidden: boolean;

  private _hudBannerTimer: number;
  private _hudBannerText: string;
  private _hudBannerClass: string;
  private _lastCountdownLabel: string;
  private _lastRank: number;

  private _minimapCacheKey: string;
  private _minimapTransform: MinimapTransform | null;
  private _minimapBgCanvas: HTMLCanvasElement;

  private _dom!: UIDomRefs;
  private _hud!: HudDomRefs;

  constructor(rootEl: HTMLElement, options: GameUIOptions = {}) {
    this.rootEl = rootEl;
    this.rootEl.classList.add('tk-ui-root');

    this.characters = options.characters || [];
    this.karts = options.karts || [];
    this.wheels = options.wheels || [];
    this.tracks = options.tracks || [];
    this.callbacks = options.callbacks || {};

    this.selection = {
      mode: 'gp',
      cupId: CUP_IDS.MUSHROOM,
      trackId: this.tracks[0]?.id || '',
      charId: this.characters[0]?.id || 'marco',
      kartId: this.karts[0]?.id || 'standard_gp',
      wheelId: this.wheels[0]?.id || 'standard',
      difficultyId: 'medium',
    };

    const initialPresetId: PresetSelectionId =
      options.initialSettings?.presetId || options.initialSettings?.id || 'medium';
    this.settings = {
      ...GRAPHICS_PRESETS.medium,
      presetId: initialPresetId,
      showFps: true,
      ...(options.initialSettings || {}),
    };
    this.volumes = {
      master: 0.8,
      sfx: 0.85,
      music: 0.6,
      ...(options.initialVolumes || {}),
    };

    this.currentScreen = 'title';
    this.settingsOpen = false;
    this.controlsOpen = false;
    this.pauseOpen = false;
    this.controlStripHidden = false;

    this._hudBannerTimer = 0;
    this._hudBannerText = '';
    this._hudBannerClass = 'tk-alert-boost';
    this._lastCountdownLabel = '';
    this._lastRank = 0;

    this._minimapCacheKey = '';
    this._minimapTransform = null;
    this._minimapBgCanvas = document.createElement('canvas');

    this._buildShell();
    this.showTitle();
  }

  setCatalog({ characters, karts, wheels, tracks }: Pick<GameUIOptions, 'characters' | 'karts' | 'wheels' | 'tracks'>): void {
    if (characters) this.characters = characters;
    if (karts) this.karts = karts;
    if (wheels) this.wheels = wheels;
    if (tracks) this.tracks = tracks;
    if (!this.selection.charId && this.characters[0]) this.selection.charId = this.characters[0].id;
    if (!this.selection.kartId && this.karts[0]) this.selection.kartId = this.karts[0].id;
    if (!this.selection.wheelId && this.wheels[0]) this.selection.wheelId = this.wheels[0].id;
    if (!this.selection.trackId && this.tracks[0]) this.selection.trackId = this.tracks[0].id;
  }

  getSelection(): GameSelection {
    return { ...this.selection };
  }

  private _sfx(name = 'ui_click'): void {
    this.callbacks.onPlaySfx?.(name);
  }

  private _buildShell(): void {
    this.rootEl.innerHTML = `
      <div class="tk-screen tk-title-screen" data-screen="title"></div>
      <div class="tk-screen tk-garage-screen tk-hidden" data-screen="garage"></div>
      <div class="tk-screen tk-tracks-screen tk-hidden" data-screen="tracks"></div>
      <div class="tk-hud tk-hidden" data-screen="race"></div>
      <div class="tk-screen tk-results-screen tk-hidden" data-screen="results"></div>
      <div class="tk-modal-backdrop tk-hidden" data-modal="pause"></div>
      <div class="tk-modal-backdrop tk-hidden" data-modal="settings"></div>
      <div class="tk-modal-backdrop tk-hidden" data-modal="controls"></div>
    `;
    this._dom = {
      title: this.rootEl.querySelector<HTMLElement>('[data-screen="title"]')!,
      garage: this.rootEl.querySelector<HTMLElement>('[data-screen="garage"]')!,
      tracks: this.rootEl.querySelector<HTMLElement>('[data-screen="tracks"]')!,
      race: this.rootEl.querySelector<HTMLElement>('[data-screen="race"]')!,
      results: this.rootEl.querySelector<HTMLElement>('[data-screen="results"]')!,
      pauseModal: this.rootEl.querySelector<HTMLElement>('[data-modal="pause"]')!,
      settingsModal: this.rootEl.querySelector<HTMLElement>('[data-modal="settings"]')!,
      controlsModal: this.rootEl.querySelector<HTMLElement>('[data-modal="controls"]')!,
    };

    this._buildHudDom();
  }

  private _setScreen(screen: ScreenId): void {
    this.currentScreen = screen;
    for (const key of ['title', 'garage', 'tracks', 'race', 'results'] as const) {
      this._dom[key].classList.toggle('tk-hidden', key !== screen);
    }
    this.callbacks.onScreenChange?.(screen);
  }

  // ---------------- 1. TITLE SCREEN ----------------

  showTitle(demoTrackName = 'Sunburst Circuit'): void {
    this.closeAllModals();
    this._setScreen('title');

    const presetLabel = getPresetDef(this.settings.presetId)?.label || 'Custom';
    this._dom.title.innerHTML = `
      <div class="tk-title-topbar">
        <div class="tk-badge-pill">
          <span>● LIVE 3D DEMO</span>
          <span data-title-demo-track>${escHtml(demoTrackName)}</span>
        </div>
        <button class="tk-hud-gfx-pill" data-action="open-settings" title="Click to adjust graphics & audio live">
          <span>⚙ ${escHtml(presetLabel)}</span>
          <span class="tk-fps-val" data-title-fps>-- FPS</span>
        </button>
      </div>

      <div class="tk-title-hero">
        <div class="tk-logo-wrap">
          <div class="tk-logo-kicker">Grand Prix Arcade Racing</div>
          <h1 class="tk-logo-title">Turbo Kart<span class="tk-logo-num">8</span></h1>
          <p class="tk-logo-sub">8 Tracks • 2 Cups • 8 Racers • Drift Mini-Turbos • Shortcuts • Potato-to-Ultra 3D</p>
        </div>

        <div class="tk-title-actions">
          <button class="tk-btn tk-btn-primary tk-title-btn-big" data-action="start-gp">
            <span>🏆 Grand Prix</span>
            <span class="tk-title-btn-sub">4-Race Championship Cup</span>
          </button>
          <button class="tk-btn tk-btn-cyan tk-title-btn-big" data-action="start-vs">
            <span>🏁 VS Race</span>
            <span class="tk-title-btn-sub">Pick Any of 8 Tracks</span>
          </button>
          <div class="tk-title-row">
            <button class="tk-btn" data-action="open-settings">⚙ Graphics &amp; Audio</button>
            <button class="tk-btn" data-action="open-controls">🎮 Controls</button>
          </div>
        </div>
      </div>

      <div class="tk-title-footer">
        <span>Keyboard + Mouse Supported • Press <strong>ESC</strong> anytime for Live Graphics Tweaks</span>
        <span>All 3D Textures, Shaders &amp; Synth Audio Generated Live</span>
      </div>
    `;

    this._dom.title.querySelector<HTMLElement>('[data-action="start-gp"]')!.onclick = () => {
      this._sfx();
      this.selection.mode = 'gp';
      this.showGarage();
    };
    this._dom.title.querySelector<HTMLElement>('[data-action="start-vs"]')!.onclick = () => {
      this._sfx();
      this.selection.mode = 'vs';
      this.showGarage();
    };
    this._dom.title.querySelectorAll<HTMLElement>('[data-action="open-settings"]').forEach((btn) => {
      btn.onclick = () => {
        this._sfx();
        this.openSettings();
      };
    });
    this._dom.title.querySelector<HTMLElement>('[data-action="open-controls"]')!.onclick = () => {
      this._sfx();
      this.openControls();
    };
  }

  updateTitleTelemetry(stats?: GraphicsStats | null, demoTrackName?: string): void {
    if (this.currentScreen !== 'title') return;
    const fpsEl = this._dom.title.querySelector<HTMLElement>('[data-title-fps]');
    if (fpsEl) {
      fpsEl.textContent = this.settings.showFps ? `${Math.round(stats?.fps || 0)} FPS` : 'LIVE';
    }
    if (demoTrackName) {
      const trkEl = this._dom.title.querySelector<HTMLElement>('[data-title-demo-track]');
      if (trkEl && trkEl.textContent !== demoTrackName) trkEl.textContent = demoTrackName;
    }
  }

  // ---------------- 2. GARAGE SCREEN ----------------

  showGarage(): void {
    this.closeAllModals();
    this._setScreen('garage');
    this._renderGarage();
    this.callbacks.onSelectionChange?.(this.getSelection());
  }

  private _renderGarage(): void {
    const sel = this.selection;
    const charDef = this.characters.find((c) => c.id === sel.charId) || this.characters[0];
    const kartDef = this.karts.find((k) => k.id === sel.kartId) || this.karts[0];
    const wheelDef = this.wheels.find((w) => w.id === sel.wheelId) || this.wheels[0];
    const combined = computeCombinedStats(charDef, kartDef, wheelDef);

    const modeTitle = sel.mode === 'gp' ? 'Grand Prix Setup' : 'VS Race Setup';
    const nextBtnLabel = sel.mode === 'gp' ? 'Choose Cup →' : 'Choose Track →';

    this._dom.garage.innerHTML = `
      <div class="tk-glass-panel tk-header">
        <div class="tk-header-title">
          <button class="tk-btn tk-btn-sm" data-action="back-title">← Title</button>
          <h2>Garage</h2>
          <span class="tk-header-step">${escHtml(modeTitle)}</span>
        </div>
        <div style="display:flex;gap:10px;align-items:center;">
          <button class="tk-btn tk-btn-sm" data-action="open-settings">⚙ Settings</button>
          <button class="tk-btn tk-btn-gold" data-action="next-tracks">${escHtml(nextBtnLabel)}</button>
        </div>
      </div>

      <div class="tk-garage-body">
        <div class="tk-glass-panel tk-garage-left">
          <div>
            <div class="tk-section-label">
              <span>1. Driver (8 Racers)</span>
              <span class="tk-section-selected">${escHtml(charDef?.name || '')} • ${escHtml(charDef?.weightClass || '')}</span>
            </div>
            <div class="tk-tile-grid-4">
              ${this.characters
                .map(
                  (c) => `
                <button class="tk-tile ${c.id === sel.charId ? 'active' : ''}" data-pick-char="${escHtml(c.id)}" title="${escHtml(c.tagline || '')}">
                  <div class="tk-tile-head">
                    <span class="tk-color-dot" style="background:${escHtml(toCssColor(c.primaryColor, '#ff4444'))}"></span>
                    <span class="tk-tile-name">${escHtml(c.name)}</span>
                  </div>
                  <div class="tk-tile-meta">${escHtml(c.weightClass || '')}</div>
                </button>
              `
                )
                .join('')}
            </div>
          </div>

          <div>
            <div class="tk-section-label">
              <span>2. Kart Body (8 Frames)</span>
              <span class="tk-section-selected">${escHtml(kartDef?.name || '')}</span>
            </div>
            <div class="tk-tile-grid-4">
              ${this.karts
                .map(
                  (k) => `
                <button class="tk-tile ${k.id === sel.kartId ? 'active' : ''}" data-pick-kart="${escHtml(k.id)}" title="${escHtml(k.tagline || '')}">
                  <div class="tk-tile-name">${escHtml(k.name)}</div>
                  <div class="tk-tile-meta">${escHtml(k.style || '')}</div>
                </button>
              `
                )
                .join('')}
            </div>
          </div>

          <div>
            <div class="tk-section-label">
              <span>3. Wheel Style (4 Sets)</span>
              <span class="tk-section-selected">${escHtml(wheelDef?.name || '')}</span>
            </div>
            <div class="tk-tile-grid-4">
              ${this.wheels
                .map(
                  (w) => `
                <button class="tk-tile ${w.id === sel.wheelId ? 'active' : ''}" data-pick-wheel="${escHtml(w.id)}" title="${escHtml(w.tagline || '')}">
                  <div class="tk-tile-name">${escHtml(w.name)}</div>
                  <div class="tk-tile-meta">${escHtml(w.tagline || '')}</div>
                </button>
              `
                )
                .join('')}
            </div>
          </div>

          <div>
            <div class="tk-section-label">
              <span>4. Engine Class / AI Difficulty</span>
              <span class="tk-section-selected">${escHtml(DIFFICULTIES[sel.difficultyId]?.label || '')}</span>
            </div>
            <div class="tk-diff-pills">
              ${Object.values(DIFFICULTIES)
                .map(
                  (d) => `
                <button class="tk-diff-pill ${d.id === sel.difficultyId ? 'active' : ''}" data-pick-diff="${escHtml(d.id)}">
                  ${escHtml(d.label)}
                </button>
              `
                )
                .join('')}
            </div>
          </div>
        </div>

        <div class="tk-garage-right">
          <div class="tk-garage-stage" data-garage-stage>
            <div class="tk-stage-top">
              <div>
                <div class="tk-stage-combo-title" data-stage-title>${escHtml(charDef?.name || '')} — ${escHtml(kartDef?.name || '')}</div>
                <div class="tk-stage-combo-sub" data-stage-sub>${escHtml(charDef?.tagline || '')}</div>
              </div>
              <div class="tk-drag-hint">↔ Drag 3D Kart to Rotate</div>
            </div>
            <div style="display:flex;justify-content:flex-end;gap:8px;">
              <button class="tk-btn tk-btn-sm" data-action="reset-orbit">Reset Angle</button>
            </div>
          </div>

          <div class="tk-glass-panel tk-stats-panel" data-stats-panel>
            ${STAT_ROWS.map((row) => {
              const val = combined.bars[row.key] ?? 5;
              const pct = Math.min(100, Math.max(8, val * 10));
              return `
                <div class="tk-stat-row" data-stat-row="${row.key}">
                  <span class="tk-stat-label">${row.label}</span>
                  <div class="tk-stat-track">
                    <div class="tk-stat-fill" style="width:${pct}%"></div>
                  </div>
                  <span class="tk-stat-val">${val.toFixed(1)}</span>
                </div>
              `;
            }).join('')}
          </div>
        </div>
      </div>
    `;

    const bindPick = <K extends 'charId' | 'kartId' | 'wheelId' | 'difficultyId'>(
      selector: string,
      attr: string,
      key: K
    ): void => {
      this._dom.garage.querySelectorAll<HTMLElement>(selector).forEach((el) => {
        el.onclick = () => {
          const val = el.getAttribute(attr);
          if (!val) return;
          this._sfx();
          this.selection[key] = val as GameSelection[K];
          this._updateGarageSelectionUI();
          this.callbacks.onSelectionChange?.(this.getSelection());
        };
      });
    };
    bindPick('[data-pick-char]', 'data-pick-char', 'charId');
    bindPick('[data-pick-kart]', 'data-pick-kart', 'kartId');
    bindPick('[data-pick-wheel]', 'data-pick-wheel', 'wheelId');
    bindPick('[data-pick-diff]', 'data-pick-diff', 'difficultyId');

    this._dom.garage.querySelector<HTMLElement>('[data-action="back-title"]')!.onclick = () => {
      this._sfx();
      this.showTitle();
    };
    this._dom.garage.querySelector<HTMLElement>('[data-action="open-settings"]')!.onclick = () => {
      this._sfx();
      this.openSettings();
    };
    this._dom.garage.querySelector<HTMLElement>('[data-action="next-tracks"]')!.onclick = () => {
      this._sfx();
      this.showTrackSelect();
    };
    this._dom.garage.querySelector<HTMLElement>('[data-action="reset-orbit"]')!.onclick = (e) => {
      e.stopPropagation();
      this._sfx();
      this.callbacks.onGarageReset?.();
    };

    // Interactive 3D drag-to-rotate on the stage area
    const stage = this._dom.garage.querySelector<HTMLElement>('[data-garage-stage]')!;
    let dragging = false;
    let lastX = 0;
    let lastY = 0;
    stage.addEventListener('pointerdown', (e: PointerEvent) => {
      if ((e.target as HTMLElement | null)?.closest('button')) return;
      dragging = true;
      lastX = e.clientX;
      lastY = e.clientY;
      stage.setPointerCapture?.(e.pointerId);
    });
    stage.addEventListener('pointermove', (e: PointerEvent) => {
      if (!dragging) return;
      const dx = e.clientX - lastX;
      const dy = e.clientY - lastY;
      lastX = e.clientX;
      lastY = e.clientY;
      this.callbacks.onGarageDrag?.(dx, dy);
    });
    const endDrag = (): void => {
      dragging = false;
    };
    stage.addEventListener('pointerup', endDrag);
    stage.addEventListener('pointercancel', endDrag);
  }

  private _updateGarageSelectionUI(): void {
    const sel = this.selection;
    const charDef = this.characters.find((c) => c.id === sel.charId) || this.characters[0];
    const kartDef = this.karts.find((k) => k.id === sel.kartId) || this.karts[0];
    const wheelDef = this.wheels.find((w) => w.id === sel.wheelId) || this.wheels[0];
    const combined = computeCombinedStats(charDef, kartDef, wheelDef);

    const markActive = (attr: string, val: string): void => {
      this._dom.garage.querySelectorAll<HTMLElement>(`[${attr}]`).forEach((el) => {
        el.classList.toggle('active', el.getAttribute(attr) === val);
      });
    };
    markActive('data-pick-char', sel.charId);
    markActive('data-pick-kart', sel.kartId);
    markActive('data-pick-wheel', sel.wheelId);
    markActive('data-pick-diff', sel.difficultyId);

    const titleEl = this._dom.garage.querySelector<HTMLElement>('[data-stage-title]');
    const subEl = this._dom.garage.querySelector<HTMLElement>('[data-stage-sub]');
    if (titleEl) titleEl.textContent = `${charDef?.name || ''} — ${kartDef?.name || ''}`;
    if (subEl) subEl.textContent = `${wheelDef?.name || ''} • ${charDef?.tagline || ''}`;

    const labels = this._dom.garage.querySelectorAll<HTMLElement>('.tk-section-selected');
    if (labels[0]) labels[0].textContent = `${charDef?.name || ''} • ${charDef?.weightClass || ''}`;
    if (labels[1]) labels[1].textContent = kartDef?.name || '';
    if (labels[2]) labels[2].textContent = wheelDef?.name || '';
    if (labels[3]) labels[3].textContent = DIFFICULTIES[sel.difficultyId]?.label || '';

    for (const row of STAT_ROWS) {
      const rowEl = this._dom.garage.querySelector<HTMLElement>(`[data-stat-row="${row.key}"]`);
      if (!rowEl) continue;
      const val = combined.bars[row.key] ?? 5;
      const pct = Math.min(100, Math.max(8, val * 10));
      const fillEl = rowEl.querySelector<HTMLElement>('.tk-stat-fill');
      const valEl = rowEl.querySelector<HTMLElement>('.tk-stat-val');
      if (fillEl) fillEl.style.width = `${pct}%`;
      if (valEl) valEl.textContent = val.toFixed(1);
    }
  }

  getGarageStageBounds(): DOMRect | null {
    const stage = this._dom.garage?.querySelector<HTMLElement>('[data-garage-stage]');
    if (!stage || this.currentScreen !== 'garage') return null;
    const rect = stage.getBoundingClientRect();
    if (rect.width < 10 || rect.height < 10) return null;
    return rect;
  }

  // ---------------- 3. TRACK / CUP SELECT SCREEN ----------------

  showTrackSelect(): void {
    this.closeAllModals();
    this._setScreen('tracks');
    this._renderTrackSelect();
  }

  private _renderTrackSelect(): void {
    const sel = this.selection;
    const isGp = sel.mode === 'gp';
    const charDef = this.characters.find((c) => c.id === sel.charId);
    const kartDef = this.karts.find((k) => k.id === sel.kartId);
    const diffDef = DIFFICULTIES[sel.difficultyId];
    const cupTracks = this.tracks.filter((t) => t.cupId === sel.cupId);
    const activeCup = CUPS.find((c) => c.id === sel.cupId) || CUPS[0];

    this._dom.tracks.innerHTML = `
      <div class="tk-glass-panel tk-header">
        <div class="tk-header-title">
          <button class="tk-btn tk-btn-sm" data-action="back-garage">← Garage</button>
          <h2>${isGp ? 'Grand Prix — Select Cup' : 'VS Race — Select Track'}</h2>
          <span class="tk-header-step">${escHtml(charDef?.name || '')} • ${escHtml(kartDef?.name || '')} • ${escHtml(diffDef?.label || '')}</span>
        </div>
        <div style="display:flex;gap:10px;align-items:center;">
          <button class="tk-btn tk-btn-sm" data-action="open-settings">⚙ Settings</button>
          ${
            isGp
              ? `<button class="tk-btn tk-btn-gold" data-action="launch-gp">🏆 Start ${escHtml(activeCup.name)} (4 Races)</button>`
              : ''
          }
        </div>
      </div>

      <div class="tk-cup-tabs">
        ${CUPS.map(
          (cup) => `
          <button class="tk-cup-tab ${cup.id === sel.cupId ? 'active' : ''}" data-cup-id="${escHtml(cup.id)}" style="--cup-accent:${escHtml(cup.accent)}">
            <div>
              <div class="tk-cup-tab-name">${escHtml(cup.name)}</div>
              <div class="tk-cup-tab-sub">${escHtml(cup.subtitle)}</div>
            </div>
            <span class="tk-badge-pill" style="color:${escHtml(cup.accent)};border-color:${escHtml(cup.accent)}">4 Tracks</span>
          </button>
        `
        ).join('')}
      </div>

      <div class="tk-track-grid">
        ${cupTracks
          .map(
            (trk, idx) => `
          <div class="tk-track-card" style="--track-accent:${escHtml(trk.themeColor || '#00d4ff')}">
            <div>
              <div class="tk-track-card-top">
                <span class="tk-track-num">${isGp ? `GP Race ${idx + 1}` : `Track ${idx + 1}`}</span>
                <span class="tk-theme-badge" style="color:${escHtml(trk.themeColor || '#00d4ff')}">${escHtml(activeCup.name)}</span>
              </div>
              <div class="tk-track-canvas-box">
                <canvas width="280" height="210" data-track-preview="${escHtml(trk.id)}"></canvas>
              </div>
              <h3 class="tk-track-title">${escHtml(trk.name)}</h3>
              <p class="tk-track-sub">${escHtml(trk.subtitle)}</p>
            </div>
            <div>
              <div class="tk-track-meta-row">
                <span>${trk.laps || 3} Laps</span>
                <span>${trk.shortcuts?.length || 0} Shortcuts • ${trk.ramps?.length || 0} Ramps</span>
              </div>
              ${
                isGp
                  ? `<button class="tk-btn tk-btn-sm tk-btn-gold" style="width:100%" data-launch-gp-cup="${escHtml(activeCup.id)}">Start Cup from Race 1</button>`
                  : `<button class="tk-btn tk-btn-sm tk-btn-cyan" style="width:100%" data-launch-vs="${escHtml(trk.id)}">Race Here →</button>`
              }
            </div>
          </div>
        `
          )
          .join('')}
      </div>
    `;

    this._dom.tracks.querySelector<HTMLElement>('[data-action="back-garage"]')!.onclick = () => {
      this._sfx();
      this.showGarage();
    };
    this._dom.tracks.querySelector<HTMLElement>('[data-action="open-settings"]')!.onclick = () => {
      this._sfx();
      this.openSettings();
    };
    this._dom.tracks.querySelectorAll<HTMLElement>('[data-cup-id]').forEach((tab) => {
      tab.onclick = () => {
        const cupId = tab.getAttribute('data-cup-id') as CupId | null;
        if (!cupId) return;
        this._sfx();
        this.selection.cupId = cupId;
        this._renderTrackSelect();
      };
    });

    const startGpBtn = this._dom.tracks.querySelector<HTMLElement>('[data-action="launch-gp"]');
    if (startGpBtn) {
      startGpBtn.onclick = () => {
        this._sfx();
        this.callbacks.onStartGrandPrix?.(this.getSelection());
      };
    }
    this._dom.tracks.querySelectorAll<HTMLElement>('[data-launch-gp-cup]').forEach((btn) => {
      btn.onclick = () => {
        this._sfx();
        this.callbacks.onStartGrandPrix?.(this.getSelection());
      };
    });
    this._dom.tracks.querySelectorAll<HTMLElement>('[data-launch-vs]').forEach((btn) => {
      btn.onclick = () => {
        const trackId = btn.getAttribute('data-launch-vs');
        if (!trackId) return;
        this._sfx();
        this.selection.trackId = trackId;
        this.callbacks.onStartVsRace?.(this.getSelection());
      };
    });

    // Draw procedural 2D top-down spline silhouettes + dashed shortcuts
    for (const trk of cupTracks) {
      const canvas = this._dom.tracks.querySelector<HTMLCanvasElement>(`[data-track-preview="${trk.id}"]`);
      if (canvas) this._drawTrackPreviewCanvas(canvas, trk);
    }
  }

  private _drawTrackPreviewCanvas(canvas: HTMLCanvasElement, trackDef: TrackDefinition): void {
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const w = canvas.width;
    const h = canvas.height;
    ctx.clearRect(0, 0, w, h);

    const mainPts = sampleClosedSplineXZ(trackDef.controlPoints, 200);
    if (mainPts.length < 3) return;
    const shortcutCurves = (trackDef.shortcuts || []).map((sc) => sampleOpenSplineXZ(sc.points, 28));
    const bounds = computeTrackBounds(mainPts, shortcutCurves);

    const pad = 22;
    const scale = Math.min((w - pad * 2) / bounds.spanX, (h - pad * 2) / bounds.spanZ);
    const toX = (x: number): number => w * 0.5 + (x - bounds.cx) * scale;
    const toY = (z: number): number => h * 0.5 + (z - bounds.cz) * scale;

    const accent = trackDef.themeColor || '#00d4ff';

    // Outer glow & road base
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';

    ctx.beginPath();
    mainPts.forEach((p, i) => (i === 0 ? ctx.moveTo(toX(p.x), toY(p.z)) : ctx.lineTo(toX(p.x), toY(p.z))));
    ctx.closePath();
    ctx.strokeStyle = 'rgba(0, 0, 0, 0.6)';
    ctx.lineWidth = 13;
    ctx.stroke();

    ctx.strokeStyle = accent;
    ctx.globalAlpha = 0.38;
    ctx.lineWidth = 11;
    ctx.stroke();
    ctx.globalAlpha = 1;

    ctx.strokeStyle = '#eef5ff';
    ctx.lineWidth = 5.5;
    ctx.stroke();

    // Dashed shortcut paths
    for (const scPts of shortcutCurves) {
      if (scPts.length < 2) continue;
      ctx.save();
      ctx.beginPath();
      scPts.forEach((p, i) => (i === 0 ? ctx.moveTo(toX(p.x), toY(p.z)) : ctx.lineTo(toX(p.x), toY(p.z))));
      ctx.setLineDash([5, 4]);
      ctx.strokeStyle = '#ffd426';
      ctx.lineWidth = 3;
      ctx.stroke();
      ctx.restore();
    }

    // Start/finish line marker + forward arrow
    const p0 = mainPts[0];
    const p1 = mainPts[3 % mainPts.length];
    const dx = toX(p1.x) - toX(p0.x);
    const dy = toY(p1.z) - toY(p0.z);
    const len = Math.hypot(dx, dy) || 1;
    const nx = -dy / len;
    const ny = dx / len;
    const sx = toX(p0.x);
    const sy = toY(p0.z);

    ctx.beginPath();
    ctx.moveTo(sx - nx * 9, sy - ny * 9);
    ctx.lineTo(sx + nx * 9, sy + ny * 9);
    ctx.strokeStyle = '#ff3355';
    ctx.lineWidth = 3.5;
    ctx.stroke();

    // Direction dot ahead of start
    ctx.beginPath();
    ctx.arc(sx + (dx / len) * 11, sy + (dy / len) * 11, 3.2, 0, Math.PI * 2);
    ctx.fillStyle = '#00d4ff';
    ctx.fill();
  }

  // ---------------- 4. IN-RACE HUD ----------------

  private _buildHudDom(): void {
    this._dom.race.innerHTML = `
      <div class="tk-hud-item-wrap">
        <div class="tk-item-box" data-hud-itembox>
          <span class="tk-item-icon" data-hud-item-icon>—</span>
          <span class="tk-item-name" data-hud-item-name>EMPTY</span>
          <span class="tk-item-count tk-hidden" data-hud-item-count>1</span>
        </div>
        <div class="tk-trail-hint tk-hidden" data-hud-trail-hint>Hold E / Click to Trail</div>
      </div>

      <div class="tk-hud-topright">
        <div class="tk-lap-timer-card">
          <div class="tk-lap-block">
            <span class="tk-hud-kicker">LAP</span>
            <span class="tk-lap-value" data-hud-lap>1/3</span>
          </div>
          <div class="tk-timer-block">
            <span class="tk-hud-kicker">TIME</span>
            <span class="tk-timer-value" data-hud-timer>0:00.00</span>
          </div>
        </div>
        <button class="tk-hud-gfx-pill" data-action="hud-settings" title="Live Graphics & Audio Settings (Esc)">
          <span data-hud-preset>⚙ Medium</span>
          <span class="tk-fps-val" data-hud-fps>60 FPS</span>
        </button>
      </div>

      <div class="tk-minimap-wrap">
        <div class="tk-minimap-title" data-hud-track-name>TRACK</div>
        <canvas class="tk-minimap-canvas" width="320" height="320" data-hud-minimap></canvas>
      </div>

      <div class="tk-hud-bottomleft">
        <div class="tk-coin-pill">
          <span>🪙</span>
          <span data-hud-coins>0/10</span>
        </div>
        <div class="tk-speedo-card">
          <div class="tk-speedo-inner">
            <span class="tk-speed-num" data-hud-speed>0</span>
            <span class="tk-speed-unit">KM/H</span>
          </div>
          <div class="tk-mt-bar-wrap">
            <div class="tk-mt-bar-fill tier-0" data-hud-mt-fill></div>
          </div>
          <div class="tk-mt-label" data-hud-mt-label></div>
        </div>
      </div>

      <div class="tk-rank-badge rank-1" data-hud-rank-badge>
        <span class="tk-rank-num" data-hud-rank-num>1</span>
        <span class="tk-rank-sup" data-hud-rank-sup>st</span>
      </div>

      <div class="tk-center-banner" data-hud-countdown></div>
      <div class="tk-alert-stack" data-hud-alerts></div>

      <div class="tk-control-strip" data-hud-strip>
        <span data-strip-keys>
          <kbd>W/S</kbd> Drive &nbsp;
          <kbd>A/D</kbd> Steer &nbsp;
          <kbd>Space</kbd> Hop/Drift/Trick &nbsp;
          <kbd>E</kbd>/<kbd>LMB</kbd> Item &nbsp;
          <kbd>Q</kbd>/<kbd>RMB</kbd> Rear &nbsp;
          <kbd>Esc</kbd> Pause
        </span>
        <button class="tk-strip-toggle" data-action="toggle-strip">Hide [H]</button>
      </div>
    `;

    this._hud = {
      itemBox: this._dom.race.querySelector<HTMLElement>('[data-hud-itembox]')!,
      itemIcon: this._dom.race.querySelector<HTMLElement>('[data-hud-item-icon]')!,
      itemName: this._dom.race.querySelector<HTMLElement>('[data-hud-item-name]')!,
      itemCount: this._dom.race.querySelector<HTMLElement>('[data-hud-item-count]')!,
      trailHint: this._dom.race.querySelector<HTMLElement>('[data-hud-trail-hint]')!,
      lap: this._dom.race.querySelector<HTMLElement>('[data-hud-lap]')!,
      timer: this._dom.race.querySelector<HTMLElement>('[data-hud-timer]')!,
      preset: this._dom.race.querySelector<HTMLElement>('[data-hud-preset]')!,
      fps: this._dom.race.querySelector<HTMLElement>('[data-hud-fps]')!,
      trackName: this._dom.race.querySelector<HTMLElement>('[data-hud-track-name]')!,
      minimap: this._dom.race.querySelector<HTMLCanvasElement>('[data-hud-minimap]')!,
      coins: this._dom.race.querySelector<HTMLElement>('[data-hud-coins]')!,
      speed: this._dom.race.querySelector<HTMLElement>('[data-hud-speed]')!,
      mtFill: this._dom.race.querySelector<HTMLElement>('[data-hud-mt-fill]')!,
      mtLabel: this._dom.race.querySelector<HTMLElement>('[data-hud-mt-label]')!,
      rankBadge: this._dom.race.querySelector<HTMLElement>('[data-hud-rank-badge]')!,
      rankNum: this._dom.race.querySelector<HTMLElement>('[data-hud-rank-num]')!,
      rankSup: this._dom.race.querySelector<HTMLElement>('[data-hud-rank-sup]')!,
      countdown: this._dom.race.querySelector<HTMLElement>('[data-hud-countdown]')!,
      alerts: this._dom.race.querySelector<HTMLElement>('[data-hud-alerts]')!,
      stripKeys: this._dom.race.querySelector<HTMLElement>('[data-strip-keys]')!,
      stripToggle: this._dom.race.querySelector<HTMLElement>('[data-action="toggle-strip"]')!,
    };

    this._dom.race.querySelector<HTMLElement>('[data-action="hud-settings"]')!.onclick = () => {
      this._sfx();
      this.openSettings();
    };
    this._hud.stripToggle.onclick = () => {
      this._sfx();
      this.toggleControlStrip();
    };
  }

  showRaceHud(trackDef?: TrackDefinition | null): void {
    this.closeAllModals();
    this._setScreen('race');
    this._hudBannerTimer = 0;
    this._hudBannerText = '';
    this._lastCountdownLabel = '';
    this._lastRank = 0;
    this._minimapCacheKey = '';
    if (this._hud?.trackName && trackDef?.name) {
      this._hud.trackName.textContent = trackDef.name;
    }
  }

  toggleControlStrip(): void {
    this.controlStripHidden = !this.controlStripHidden;
    if (this._hud?.stripKeys) {
      this._hud.stripKeys.classList.toggle('tk-hidden', this.controlStripHidden);
      this._hud.stripToggle.textContent = this.controlStripHidden ? 'Keys [H]' : 'Hide [H]';
    }
  }

  triggerHudBanner(text: string, variant: HudBannerVariant = 'boost', duration = 1.6): void {
    this._hudBannerText = text;
    this._hudBannerClass =
      variant === 'danger'
        ? 'tk-alert-danger'
        : variant === 'lap'
          ? 'tk-alert-lap'
          : variant === 'spiny'
            ? 'tk-alert-spiny'
            : 'tk-alert-boost';
    this._hudBannerTimer = duration;
  }

  updateRaceHud({
    player,
    karts,
    trackInstance,
    trackDef,
    raceTime,
    countdownText,
    totalLaps = 3,
    incomingBlueShell = false,
    gfxStats,
    dt = 0.016,
  }: RaceHudUpdateParams): void {
    if (this.currentScreen !== 'race' || !player) return;

    // 1. Item Box
    const isRolling = player.itemRouletteTimer > 0;
    this._hud.itemBox.classList.toggle('rolling', isRolling);
    this._hud.itemBox.classList.toggle('has-item', Boolean(player.item) && !isRolling);
    this._hud.itemBox.classList.toggle('trailing', Boolean(player.trailingItem));

    if (isRolling) {
      const idx = Math.floor(performance.now() / 75) % ROULETTE_KEYS.length;
      const meta = ITEM_META[ROULETTE_KEYS[idx]];
      this._hud.itemIcon.textContent = meta?.icon || '❓';
      this._hud.itemName.textContent = 'ROLLING';
      this._hud.itemCount.classList.add('tk-hidden');
      this._hud.trailHint.classList.add('tk-hidden');
    } else if (player.item && ITEM_META[player.item]) {
      const meta = ITEM_META[player.item];
      this._hud.itemIcon.textContent = meta.icon;
      this._hud.itemName.textContent = meta.short;
      const count = player.itemCount || 1;
      this._hud.itemCount.textContent = `×${count}`;
      this._hud.itemCount.classList.toggle('tk-hidden', count <= 1);

      if (player.trailingItem) {
        this._hud.trailHint.textContent = 'TRAILING SHIELD';
        this._hud.trailHint.classList.remove('tk-hidden');
      } else if (meta.canTrail) {
        this._hud.trailHint.textContent = 'Hold E / Click to Trail';
        this._hud.trailHint.classList.remove('tk-hidden');
      } else {
        this._hud.trailHint.classList.add('tk-hidden');
      }
    } else if (player.trailingItem && ITEM_META[player.trailingItem]) {
      const meta = ITEM_META[player.trailingItem];
      this._hud.itemIcon.textContent = meta.icon;
      this._hud.itemName.textContent = 'SHIELD';
      this._hud.itemCount.classList.add('tk-hidden');
      this._hud.trailHint.textContent = 'Release to Drop/Fire';
      this._hud.trailHint.classList.remove('tk-hidden');
    } else {
      this._hud.itemIcon.textContent = '—';
      this._hud.itemName.textContent = 'EMPTY';
      this._hud.itemCount.classList.add('tk-hidden');
      this._hud.trailHint.classList.add('tk-hidden');
    }

    // 2. Lap, Timer & Live Graphics/FPS Pill
    const displayLap = Math.min(totalLaps, Math.max(1, player.lap || 1));
    this._hud.lap.textContent = `${displayLap}/${totalLaps}`;
    this._hud.timer.textContent = formatTime(raceTime);

    const presetName = getPresetDef(this.settings.presetId)?.id?.toUpperCase() || 'CUSTOM';
    this._hud.preset.textContent = `⚙ ${presetName}`;
    if (this.settings.showFps && gfxStats) {
      this._hud.fps.textContent = `${Math.round(gfxStats.fps)} FPS`;
      this._hud.fps.classList.remove('tk-hidden');
    } else {
      this._hud.fps.classList.add('tk-hidden');
    }

    // 3. Coins, Speedometer & Mini-Turbo Glow Bar
    this._hud.coins.textContent = `${Math.min(10, Math.max(0, player.coins || 0))}/10`;
    const kmh = Math.max(0, Math.round(Math.abs(player.speed || 0) * 2.45));
    this._hud.speed.textContent = String(kmh);

    const tier = player.driftDir !== 0 ? Math.min(3, Math.max(0, player.driftTier || 0)) : 0;
    let mtPct = 0;
    let mtText = '';
    if (player.driftDir !== 0) {
      mtPct = Math.min(100, Math.max(6, (player.driftTime / 2.75) * 100));
      mtText = tier === 3 ? 'ULTRA MINI-TURBO!' : tier === 2 ? 'SUPER MINI-TURBO!' : tier === 1 ? 'MINI-TURBO!' : 'CHARGING DRIFT...';
    } else if (player.boostTimer > 0) {
      mtPct = 100;
      mtText = player.starTimer > 0 ? 'SUPER STAR!' : 'BOOSTING!';
    }
    this._hud.mtFill.style.width = `${mtPct}%`;
    this._hud.mtFill.className = `tk-mt-bar-fill tier-${player.boostTimer > 0 && tier === 0 ? 2 : tier}`;
    this._hud.mtLabel.textContent = mtText;

    // 4. Rank Badge
    const rank = Math.min(8, Math.max(1, player.rank || 1));
    if (rank !== this._lastRank) {
      this._lastRank = rank;
      this._hud.rankNum.textContent = String(rank);
      this._hud.rankSup.textContent = RANK_SUFFIXES[rank - 1] || 'th';
      this._hud.rankBadge.className = `tk-rank-badge rank-${rank}`;
    }

    // 5. Countdown & Alerts
    const cdText = countdownText || '';
    if (cdText !== this._lastCountdownLabel) {
      this._lastCountdownLabel = cdText;
      if (cdText) {
        const isGo = cdText.includes('GO');
        this._hud.countdown.innerHTML = `<div class="tk-countdown-text ${isGo ? 'go' : ''}">${escHtml(cdText)}</div>`;
      } else {
        this._hud.countdown.innerHTML = '';
      }
    }

    if (this._hudBannerTimer > 0) {
      this._hudBannerTimer = Math.max(0, this._hudBannerTimer - dt);
    }

    const alerts: string[] = [];
    if (player.wrongWay) alerts.push(`<div class="tk-alert-pill tk-alert-danger">⚠ WRONG WAY!</div>`);
    if (incomingBlueShell) alerts.push(`<div class="tk-alert-pill tk-alert-spiny">💠 INCOMING SPINY SHELL!</div>`);
    if (this._hudBannerTimer > 0 && this._hudBannerText) {
      alerts.push(`<div class="tk-alert-pill ${this._hudBannerClass}">${escHtml(this._hudBannerText)}</div>`);
    }
    this._hud.alerts.innerHTML = alerts.join('');

    // 6. Live 2D Minimap
    if (trackDef || trackInstance) {
      this._drawLiveMinimap(trackInstance, trackDef, karts, player);
    }
  }

  private _ensureMinimapCache(trackInstance?: TrackInstance | null, trackDef?: TrackDefinition | null): void {
    const id = trackDef?.id || trackInstance?.def?.id || 'track';
    if (this._minimapCacheKey === id && this._minimapTransform) return;

    const canvas = this._minimapBgCanvas;
    canvas.width = 320;
    canvas.height = 320;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.clearRect(0, 0, 320, 320);

    const def = trackDef || trackInstance?.def;
    const mainPts: Point2D[] =
      trackInstance?.frames && trackInstance.frames.length > 10
        ? trackInstance.frames.map((f) => ({ x: f.point.x, z: f.point.z }))
        : sampleClosedSplineXZ(def?.controlPoints || [], 220);

    const shortcutCurves = (def?.shortcuts || []).map((sc) => sampleOpenSplineXZ(sc.points, 28));
    if (mainPts.length < 3) return;

    const bounds = computeTrackBounds(mainPts, shortcutCurves);
    const pad = 26;
    const scale = Math.min((320 - pad * 2) / bounds.spanX, (320 - pad * 2) / bounds.spanZ);
    const toX = (x: number): number => 160 + (x - bounds.cx) * scale;
    const toY = (z: number): number => 160 + (z - bounds.cz) * scale;

    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';

    ctx.beginPath();
    mainPts.forEach((p, i) => (i === 0 ? ctx.moveTo(toX(p.x), toY(p.z)) : ctx.lineTo(toX(p.x), toY(p.z))));
    ctx.closePath();
    ctx.strokeStyle = 'rgba(0, 0, 0, 0.72)';
    ctx.lineWidth = 15;
    ctx.stroke();

    ctx.strokeStyle = 'rgba(220, 234, 255, 0.85)';
    ctx.lineWidth = 8;
    ctx.stroke();

    for (const scPts of shortcutCurves) {
      if (scPts.length < 2) continue;
      ctx.save();
      ctx.beginPath();
      scPts.forEach((p, i) => (i === 0 ? ctx.moveTo(toX(p.x), toY(p.z)) : ctx.lineTo(toX(p.x), toY(p.z))));
      ctx.setLineDash([7, 5]);
      ctx.strokeStyle = '#ffd426';
      ctx.lineWidth = 4;
      ctx.stroke();
      ctx.restore();
    }

    // Start line tick
    const p0 = mainPts[0];
    const p1 = mainPts[3 % mainPts.length];
    const dx = toX(p1.x) - toX(p0.x);
    const dy = toY(p1.z) - toY(p0.z);
    const len = Math.hypot(dx, dy) || 1;
    const nx = -dy / len;
    const ny = dx / len;
    ctx.beginPath();
    ctx.moveTo(toX(p0.x) - nx * 11, toY(p0.z) - ny * 11);
    ctx.lineTo(toX(p0.x) + nx * 11, toY(p0.z) + ny * 11);
    ctx.strokeStyle = '#ff3355';
    ctx.lineWidth = 5;
    ctx.stroke();

    this._minimapTransform = { toX, toY };
    this._minimapCacheKey = id;
  }

  private _drawLiveMinimap(
    trackInstance: TrackInstance | null | undefined,
    trackDef: TrackDefinition | null | undefined,
    karts: KartState[],
    _player: KartState
  ): void {
    this._ensureMinimapCache(trackInstance, trackDef);
    const tr = this._minimapTransform;
    if (!tr) return;

    const canvas = this._hud.minimap;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.clearRect(0, 0, 320, 320);
    ctx.drawImage(this._minimapBgCanvas, 0, 0);

    const pulse = (Math.sin(performance.now() * 0.008) + 1) * 0.5;
    // Draw bots first, player on top
    const ordered = [...(karts || [])].sort((a, b) => (a.isPlayer ? 1 : b.isPlayer ? -1 : 0));
    for (const k of ordered) {
      if (!k?.pos) continue;
      const x = tr.toX(k.pos.x);
      const y = tr.toY(k.pos.z);
      const color = toCssColor(k.charDef?.primaryColor, '#ffffff');

      if (k.isPlayer) {
        ctx.beginPath();
        ctx.arc(x, y, 12 + pulse * 6, 0, Math.PI * 2);
        ctx.strokeStyle = `rgba(255, 212, 38, ${0.85 - pulse * 0.55})`;
        ctx.lineWidth = 3;
        ctx.stroke();

        // Player directional dot
        ctx.beginPath();
        ctx.arc(x, y, 9, 0, Math.PI * 2);
        ctx.fillStyle = '#ffd426';
        ctx.fill();
        ctx.lineWidth = 3;
        ctx.strokeStyle = '#ffffff';
        ctx.stroke();
      } else {
        ctx.beginPath();
        ctx.arc(x, y, 6.5, 0, Math.PI * 2);
        ctx.fillStyle = color;
        ctx.fill();
        ctx.lineWidth = 2;
        ctx.strokeStyle = '#091022';
        ctx.stroke();
      }
    }
  }

  // ---------------- 5. GRAPHICS & AUDIO SETTINGS MODAL ----------------

  syncSettings(
    settings?: Partial<UIGraphicsSettings> | null,
    volumes?: Partial<AudioVolumes> | null,
    rerender = false
  ): void {
    if (settings) this.settings = { ...this.settings, ...settings };
    if (volumes) this.volumes = { ...this.volumes, ...volumes };
    if (this.settingsOpen) {
      if (rerender) {
        this._renderSettingsModal();
      } else {
        const s = this.settings;
        this._dom.settingsModal.querySelectorAll<HTMLElement>('[data-preset-id]').forEach((b) => {
          b.classList.toggle('active', b.getAttribute('data-preset-id') === s.presetId);
        });
        const lbl = this._dom.settingsModal.querySelector<HTMLElement>('[data-settings-fps]');
        if (lbl) lbl.textContent = getPresetDef(s.presetId)?.label || 'Custom Settings';
      }
    }
  }

  openSettings(): void {
    this.settingsOpen = true;
    this._dom.settingsModal.classList.remove('tk-hidden');
    this._renderSettingsModal();
  }

  closeSettings(): void {
    this.settingsOpen = false;
    this._dom.settingsModal.classList.add('tk-hidden');
  }

  private _renderSettingsModal(): void {
    const s = this.settings;
    const v = this.volumes;
    const presets = Object.values(GRAPHICS_PRESETS);

    this._dom.settingsModal.innerHTML = `
      <div class="tk-modal">
        <div class="tk-modal-head">
          <div>
            <h3>⚙ Graphics &amp; Audio Settings</h3>
            <div style="font-size:12px;color:var(--tk-muted)">All changes apply LIVE immediately — test Potato to Ultra in real time!</div>
          </div>
          <button class="tk-btn tk-btn-sm tk-btn-primary" data-action="close-settings">Done</button>
        </div>

        <div class="tk-modal-scroll">
          <div>
            <div class="tk-section-label">
              <span>One-Click Quality Presets</span>
              <span class="tk-section-selected" data-settings-fps>${escHtml(getPresetDef(s.presetId)?.label || 'Custom Settings')}</span>
            </div>
            <div class="tk-preset-grid">
              ${presets
                .map(
                  (p) => `
                <button class="tk-preset-btn ${s.presetId === p.id ? 'active' : ''}" data-preset-id="${escHtml(p.id)}">
                  <span class="tk-preset-title">${escHtml(p.label.split(' ')[0])}</span>
                  <span class="tk-preset-desc">${escHtml(p.desc)}</span>
                </button>
              `
                )
                .join('')}
            </div>
          </div>

          <div>
            <div class="tk-section-label"><span>Granular Graphics Tuning</span></div>
            <div class="tk-settings-grid">
              <div class="tk-setting-row">
                <div class="tk-setting-top">
                  <span>Resolution Scale</span>
                  <span class="tk-setting-val" data-val-res>${Number(s.resScale).toFixed(2)}x</span>
                </div>
                <input type="range" min="0.35" max="2.0" step="0.05" value="${Number(s.resScale)}" data-set-range="resScale" />
              </div>

              <div class="tk-setting-row">
                <div class="tk-setting-top">
                  <span>Draw Distance</span>
                  <span class="tk-setting-val" data-val-dist>${Math.round(s.drawDistance)}u</span>
                </div>
                <input type="range" min="300" max="2500" step="50" value="${Number(s.drawDistance)}" data-set-range="drawDistance" />
              </div>

              <div class="tk-setting-row">
                <div class="tk-setting-inline">
                  <span>Shadows</span>
                  <select class="tk-select" data-set-select="shadowMode">
                    ${['off', 'blob', 'low', 'high', 'ultra']
                      .map((m) => `<option value="${m}" ${s.shadowMode === m ? 'selected' : ''}>${m.toUpperCase()}</option>`)
                      .join('')}
                  </select>
                </div>
              </div>

              <div class="tk-setting-row">
                <div class="tk-setting-inline">
                  <span>Material Shaders</span>
                  <select class="tk-select" data-set-select="materialTier">
                    ${[
                      ['flat', 'Flat (Unlit Basic)'],
                      ['lambert', 'Lambert'],
                      ['standard', 'Standard PBR'],
                      ['physical', 'Physical Clearcoat'],
                    ]
                      .map(([m, lbl]) => `<option value="${m}" ${s.materialTier === m ? 'selected' : ''}>${lbl}</option>`)
                      .join('')}
                  </select>
                </div>
              </div>

              <div class="tk-setting-row">
                <div class="tk-setting-inline">
                  <span>Scenery Density</span>
                  <select class="tk-select" data-set-select-num="sceneryDensity">
                    ${[
                      [0, '0 — Minimal (Road Only)'],
                      [1, '1 — Low'],
                      [2, '2 — Medium'],
                      [3, '3 — Full Detail'],
                    ]
                      .map(([val, lbl]) => `<option value="${val}" ${Number(s.sceneryDensity) === val ? 'selected' : ''}>${lbl}</option>`)
                      .join('')}
                  </select>
                </div>
              </div>

              <div class="tk-setting-row">
                <div class="tk-setting-inline">
                  <span>Particles</span>
                  <select class="tk-select" data-set-select-num="particleLevel">
                    ${[
                      [0, '0 — Off'],
                      [1, '1 — Low'],
                      [2, '2 — Medium'],
                      [3, '3 — Full'],
                    ]
                      .map(([val, lbl]) => `<option value="${val}" ${Number(s.particleLevel) === val ? 'selected' : ''}>${lbl}</option>`)
                      .join('')}
                  </select>
                </div>
              </div>

              <div class="tk-setting-row">
                <div class="tk-setting-inline">
                  <span>FPS Cap</span>
                  <select class="tk-select" data-set-select-num="fpsCap">
                    ${[
                      [30, '30 FPS'],
                      [60, '60 FPS'],
                      [0, 'Uncapped'],
                    ]
                      .map(([val, lbl]) => `<option value="${val}" ${Number(s.fpsCap) === val ? 'selected' : ''}>${lbl}</option>`)
                      .join('')}
                  </select>
                </div>
              </div>

              <div class="tk-setting-row">
                <div class="tk-setting-inline">
                  <span>Show FPS Counter</span>
                  <button class="tk-toggle ${s.showFps ? 'on' : ''}" data-set-toggle="showFps"></button>
                </div>
              </div>

              <div class="tk-setting-row">
                <div class="tk-setting-inline">
                  <span>Bloom Glow</span>
                  <button class="tk-toggle ${s.bloom ? 'on' : ''}" data-set-toggle="bloom"></button>
                </div>
              </div>

              <div class="tk-setting-row">
                <div class="tk-setting-inline">
                  <span>Speed FX Vignette</span>
                  <button class="tk-toggle ${s.speedFx ? 'on' : ''}" data-set-toggle="speedFx"></button>
                </div>
              </div>

              <div class="tk-setting-row">
                <div class="tk-setting-inline">
                  <span>Dynamic Point Lights</span>
                  <button class="tk-toggle ${s.dynamicLights ? 'on' : ''}" data-set-toggle="dynamicLights"></button>
                </div>
              </div>

              <div class="tk-setting-row">
                <div class="tk-setting-inline">
                  <span>Pixelated Canvas (Retro)</span>
                  <button class="tk-toggle ${s.pixelatedCanvas ? 'on' : ''}" data-set-toggle="pixelatedCanvas"></button>
                </div>
              </div>
            </div>
          </div>

          <div>
            <div class="tk-section-label"><span>Audio Mix</span></div>
            <div class="tk-settings-grid">
              <div class="tk-setting-row">
                <div class="tk-setting-top">
                  <span>Master Volume</span>
                  <span class="tk-setting-val" data-val-vol="master">${Math.round(v.master * 100)}%</span>
                </div>
                <input type="range" min="0" max="1" step="0.02" value="${v.master}" data-set-vol="master" />
              </div>
              <div class="tk-setting-row">
                <div class="tk-setting-top">
                  <span>SFX Volume</span>
                  <span class="tk-setting-val" data-val-vol="sfx">${Math.round(v.sfx * 100)}%</span>
                </div>
                <input type="range" min="0" max="1" step="0.02" value="${v.sfx}" data-set-vol="sfx" />
              </div>
              <div class="tk-setting-row">
                <div class="tk-setting-top">
                  <span>Music Volume</span>
                  <span class="tk-setting-val" data-val-vol="music">${Math.round(v.music * 100)}%</span>
                </div>
                <input type="range" min="0" max="1" step="0.02" value="${v.music}" data-set-vol="music" />
              </div>
            </div>
          </div>
        </div>
      </div>
    `;

    this._dom.settingsModal.querySelector<HTMLElement>('[data-action="close-settings"]')!.onclick = () => {
      this._sfx();
      this.closeSettings();
    };
    this._dom.settingsModal.onclick = (e: MouseEvent) => {
      if (e.target === this._dom.settingsModal) {
        this._sfx();
        this.closeSettings();
      }
    };

    this._dom.settingsModal.querySelectorAll<HTMLElement>('[data-preset-id]').forEach((btn) => {
      btn.onclick = () => {
        const presetId = btn.getAttribute('data-preset-id') as GraphicsPresetId | null;
        if (!presetId || !GRAPHICS_PRESETS[presetId]) return;
        this._sfx();
        this.settings = { ...this.settings, ...GRAPHICS_PRESETS[presetId], presetId };
        this.callbacks.onApplyGraphicsPreset?.(presetId);
        this._renderSettingsModal();
      };
    });

    const emitPartial = (patch: Partial<UIGraphicsSettings>): void => {
      this.settings = { ...this.settings, ...patch, presetId: 'custom' };
      if (patch.resScale !== undefined && patch.resScale > 1.0 && !('maxDpr' in patch)) {
        this.settings.maxDpr = Math.max(1.5, Math.min(2.0, patch.resScale));
        patch.maxDpr = this.settings.maxDpr;
      }
      this.callbacks.onUpdateGraphicsSettings?.(patch);
      this._dom.settingsModal.querySelectorAll<HTMLElement>('[data-preset-id]').forEach((b) => b.classList.remove('active'));
      const lbl = this._dom.settingsModal.querySelector<HTMLElement>('[data-settings-fps]');
      if (lbl) lbl.textContent = 'Custom Settings';
    };

    this._dom.settingsModal.querySelectorAll<HTMLInputElement>('[data-set-range]').forEach((inp) => {
      inp.oninput = () => {
        const key = inp.getAttribute('data-set-range') as RangeSettingKey | null;
        if (!key) return;
        const val = parseFloat(inp.value);
        if (key === 'resScale') {
          const el = this._dom.settingsModal.querySelector<HTMLElement>('[data-val-res]');
          if (el) el.textContent = `${val.toFixed(2)}x`;
        } else if (key === 'drawDistance') {
          const el = this._dom.settingsModal.querySelector<HTMLElement>('[data-val-dist]');
          if (el) el.textContent = `${Math.round(val)}u`;
        }
        emitPartial({ [key]: val });
      };
    });

    this._dom.settingsModal.querySelectorAll<HTMLSelectElement>('[data-set-select]').forEach((selEl) => {
      selEl.onchange = () => {
        const key = selEl.getAttribute('data-set-select') as StringSelectSettingKey | null;
        if (!key) return;
        this._sfx();
        emitPartial({ [key]: selEl.value } as Partial<UIGraphicsSettings>);
      };
    });

    this._dom.settingsModal.querySelectorAll<HTMLSelectElement>('[data-set-select-num]').forEach((selEl) => {
      selEl.onchange = () => {
        const key = selEl.getAttribute('data-set-select-num') as NumberSelectSettingKey | null;
        if (!key) return;
        this._sfx();
        emitPartial({ [key]: Number(selEl.value) });
      };
    });

    this._dom.settingsModal.querySelectorAll<HTMLElement>('[data-set-toggle]').forEach((btn) => {
      btn.onclick = () => {
        const key = btn.getAttribute('data-set-toggle') as BooleanSettingKey | null;
        if (!key) return;
        this._sfx();
        const next = !this.settings[key];
        btn.classList.toggle('on', next);
        if (key === 'showFps') {
          this.settings.showFps = next;
          this.callbacks.onUpdateGraphicsSettings?.({ showFps: next });
        } else {
          emitPartial({ [key]: next });
        }
      };
    });

    this._dom.settingsModal.querySelectorAll<HTMLInputElement>('[data-set-vol]').forEach((inp) => {
      inp.oninput = () => {
        const key = inp.getAttribute('data-set-vol') as VolumeKey | null;
        if (!key) return;
        const val = parseFloat(inp.value);
        this.volumes[key] = val;
        const valEl = this._dom.settingsModal.querySelector<HTMLElement>(`[data-val-vol="${key}"]`);
        if (valEl) valEl.textContent = `${Math.round(val * 100)}%`;
        this.callbacks.onUpdateAudioVolumes?.({ ...this.volumes });
      };
    });
  }

  // ---------------- CONTROLS & PAUSE MODALS ----------------

  openControls(): void {
    this.controlsOpen = true;
    this._dom.controlsModal.classList.remove('tk-hidden');
    this._dom.controlsModal.innerHTML = `
      <div class="tk-modal">
        <div class="tk-modal-head">
          <h3>🎮 Controls &amp; Racing Techniques</h3>
          <button class="tk-btn tk-btn-sm tk-btn-primary" data-action="close-controls">Got It</button>
        </div>
        <div class="tk-modal-scroll">
          <div class="tk-controls-table">
            <div class="tk-control-item"><span>Accelerate / Brake-Reverse</span><span><kbd>W</kbd> / <kbd>S</kbd> or <kbd>↑</kbd> / <kbd>↓</kbd></span></div>
            <div class="tk-control-item"><span>Steer Left / Right</span><span><kbd>A</kbd> / <kbd>D</kbd> or <kbd>←</kbd> / <kbd>→</kbd></span></div>
            <div class="tk-control-item"><span>Hop / Drift / Ramp Trick</span><span><kbd>Space</kbd> or <kbd>Shift</kbd></span></div>
            <div class="tk-control-item"><span>Use / Hold to Trail Item</span><span><kbd>E</kbd> / <kbd>F</kbd> / <kbd>X</kbd> / <kbd>LMB</kbd></span></div>
            <div class="tk-control-item"><span>Rear-View Camera</span><span><kbd>Q</kbd> / <kbd>C</kbd> / <kbd>RMB</kbd></span></div>
            <div class="tk-control-item"><span>Pause / Live Settings</span><span><kbd>Esc</kbd> or <kbd>P</kbd></span></div>
          </div>
          <div class="tk-glass-panel" style="padding:14px 16px;font-size:13px;line-height:1.5;color:#dbe7ff;">
            <div><strong>🚀 Rocket Start:</strong> Hold <kbd>W</kbd> just as <strong>"2"</strong> fades into <strong>"1"</strong> for a launch turbo!</div>
            <div><strong>🔥 3-Tier Mini-Turbo:</strong> Hold <kbd>Space</kbd> while steering into a turn to drift. Sparks charge <strong>Blue → Orange → Purple</strong> — release to boost!</div>
            <div><strong>🤸 Trick Boost:</strong> Tap <kbd>Space</kbd> as you launch off any ramp or glider pad for an air flip + landing boost.</div>
            <div><strong>🛣 Hidden Shortcuts:</strong> Look for dashed yellow paths on the minimap — mushrooms and ramps let you cut major corners!</div>
          </div>
        </div>
      </div>
    `;
    this._dom.controlsModal.querySelector<HTMLElement>('[data-action="close-controls"]')!.onclick = () => {
      this._sfx();
      this.closeControls();
    };
    this._dom.controlsModal.onclick = (e: MouseEvent) => {
      if (e.target === this._dom.controlsModal) {
        this._sfx();
        this.closeControls();
      }
    };
  }

  closeControls(): void {
    this.controlsOpen = false;
    this._dom.controlsModal.classList.add('tk-hidden');
  }

  openPause(): void {
    this.pauseOpen = true;
    this._dom.pauseModal.classList.remove('tk-hidden');
    this._dom.pauseModal.innerHTML = `
      <div class="tk-modal tk-modal-sm">
        <div class="tk-modal-head">
          <h3>⏸ Race Paused</h3>
        </div>
        <div class="tk-pause-menu-list">
          <button class="tk-btn tk-btn-cyan" data-pause="resume">▶ Resume Race</button>
          <button class="tk-btn" data-pause="settings">⚙ Graphics &amp; Audio Settings</button>
          <button class="tk-btn" data-pause="controls">🎮 Controls</button>
          <button class="tk-btn" data-pause="restart">🔄 Restart Race</button>
          <button class="tk-btn" data-pause="garage">🏎 Garage / Change Setup</button>
          <button class="tk-btn tk-btn-primary" data-pause="quit">🏠 Quit to Title</button>
        </div>
      </div>
    `;
    this._dom.pauseModal.querySelector<HTMLElement>('[data-pause="resume"]')!.onclick = () => {
      this._sfx();
      this.closePause();
      this.callbacks.onResumeRace?.();
    };
    this._dom.pauseModal.querySelector<HTMLElement>('[data-pause="settings"]')!.onclick = () => {
      this._sfx();
      this.openSettings();
    };
    this._dom.pauseModal.querySelector<HTMLElement>('[data-pause="controls"]')!.onclick = () => {
      this._sfx();
      this.openControls();
    };
    this._dom.pauseModal.querySelector<HTMLElement>('[data-pause="restart"]')!.onclick = () => {
      this._sfx();
      this.closePause();
      this.callbacks.onRestartRace?.();
    };
    this._dom.pauseModal.querySelector<HTMLElement>('[data-pause="garage"]')!.onclick = () => {
      this._sfx();
      this.closePause();
      this.showGarage();
    };
    this._dom.pauseModal.querySelector<HTMLElement>('[data-pause="quit"]')!.onclick = () => {
      this._sfx();
      this.closePause();
      this.callbacks.onQuitToTitle?.();
    };
  }

  closePause(): void {
    this.pauseOpen = false;
    this._dom.pauseModal.classList.add('tk-hidden');
  }

  closeAllModals(): void {
    this.closeSettings();
    this.closeControls();
    this.closePause();
  }

  // ---------------- 6. FINISH / STANDINGS / GRAND PRIX PODIUM ----------------

  showResults({ isGrandPrix, cupName, raceNumber, totalRaces, trackName, rows, isFinalPodium }: ShowResultsParams): void {
    this.closeAllModals();
    this._setScreen('results');

    const sorted = [...(rows || [])].sort((a, b) => {
      if (isFinalPodium) {
        return (b.totalPoints || 0) - (a.totalPoints || 0) || (a.rank || 9) - (b.rank || 9);
      }
      return (a.rank || 9) - (b.rank || 9);
    });

    const p1 = sorted[0];
    const p2 = sorted[1];
    const p3 = sorted[2];

    const titleText = isFinalPodium
      ? `🏆 ${cupName || 'Grand Prix'} Podium!`
      : isGrandPrix
        ? `Race ${raceNumber}/${totalRaces}: ${trackName}`
        : `🏁 ${trackName} — Results`;

    const showPodiumStage = isFinalPodium || !isGrandPrix;

    this._dom.results.innerHTML = `
      <div class="tk-glass-panel tk-results-card">
        <div class="tk-results-head">
          <div>
            <h2 class="tk-results-title">${escHtml(titleText)}</h2>
            <div style="font-size:13px;color:var(--tk-muted)">
              ${isFinalPodium ? 'Final Championship Standings across all 4 races' : isGrandPrix ? `${escHtml(cupName)} Standings` : 'Single VS Race Finish Standings'}
            </div>
          </div>
          ${
            sorted.find((r) => r.isPlayer)
              ? `<span class="tk-badge-pill" style="color:var(--tk-gold);border-color:var(--tk-gold)">You placed #${
                  sorted.findIndex((r) => r.isPlayer) + 1
                }!</span>`
              : ''
          }
        </div>

        ${
          showPodiumStage && p1 && p2 && p3
            ? `
          <div class="tk-podium-stage">
            <div class="tk-podium-col">
              <div class="tk-podium-driver">${escHtml(p2.name)}</div>
              <div class="tk-podium-pts">${isGrandPrix ? `${p2.totalPoints} pts` : formatTime(p2.finishTime)}</div>
              <div class="tk-podium-pedestal tk-podium-2">2nd</div>
            </div>
            <div class="tk-podium-col">
              <div class="tk-podium-driver">👑 ${escHtml(p1.name)}</div>
              <div class="tk-podium-pts">${isGrandPrix ? `${p1.totalPoints} pts` : formatTime(p1.finishTime)}</div>
              <div class="tk-podium-pedestal tk-podium-1">1st</div>
            </div>
            <div class="tk-podium-col">
              <div class="tk-podium-driver">${escHtml(p3.name)}</div>
              <div class="tk-podium-pts">${isGrandPrix ? `${p3.totalPoints} pts` : formatTime(p3.finishTime)}</div>
              <div class="tk-podium-pedestal tk-podium-3">3rd</div>
            </div>
          </div>
        `
            : ''
        }

        <div class="tk-standings-list">
          ${sorted
            .map((r, i) => {
              const displayPos = isFinalPodium ? i + 1 : r.rank || i + 1;
              const racePts = GRAND_PRIX_POINTS[(r.rank || i + 1) - 1] ?? 1;
              return `
                <div class="tk-standing-row ${r.isPlayer ? 'player' : ''}">
                  <span class="tk-standing-rank">${displayPos}${RANK_SUFFIXES[displayPos - 1] || 'th'}</span>
                  <div class="tk-standing-driver">
                    <span class="tk-color-dot" style="background:${escHtml(toCssColor(r.color, '#ffffff'))}"></span>
                    <span>${escHtml(r.name)}${r.isPlayer ? ' (YOU)' : ''}</span>
                  </div>
                  <span class="tk-standing-kart">${escHtml(r.kartName || '')}</span>
                  <span class="tk-standing-time">${r.finished ? formatTime(r.finishTime) : 'Finish'}</span>
                  <span class="tk-standing-pts">${isGrandPrix ? `${r.totalPoints} pts` : `+${racePts} pts`}</span>
                </div>
              `;
            })
            .join('')}
        </div>

        <div class="tk-results-actions">
          ${
            isGrandPrix && !isFinalPodium
              ? `<button class="tk-btn tk-btn-gold" data-res="next">Next Race (${raceNumber + 1}/${totalRaces}) →</button>`
              : `<button class="tk-btn tk-btn-cyan" data-res="rematch">🔄 ${isGrandPrix ? 'Replay Cup' : 'Rematch'}</button>`
          }
          <button class="tk-btn" data-res="garage">🏎 Garage</button>
          <button class="tk-btn tk-btn-primary" data-res="menu">🏠 Main Menu</button>
        </div>
      </div>
    `;

    const nextBtn = this._dom.results.querySelector<HTMLElement>('[data-res="next"]');
    if (nextBtn) {
      nextBtn.onclick = () => {
        this._sfx();
        this.callbacks.onNextRace?.();
      };
    }
    const rematchBtn = this._dom.results.querySelector<HTMLElement>('[data-res="rematch"]');
    if (rematchBtn) {
      rematchBtn.onclick = () => {
        this._sfx();
        if (isGrandPrix) this.callbacks.onStartGrandPrix?.(this.getSelection());
        else this.callbacks.onRestartRace?.();
      };
    }
    this._dom.results.querySelector<HTMLElement>('[data-res="garage"]')!.onclick = () => {
      this._sfx();
      this.showGarage();
    };
    this._dom.results.querySelector<HTMLElement>('[data-res="menu"]')!.onclick = () => {
      this._sfx();
      this.callbacks.onQuitToTitle?.();
    };
  }
}
