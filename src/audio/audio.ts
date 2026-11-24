import type { TrackBgmStyle } from '../core/contracts';

export interface AudioVolumes {
  master: number;
  sfx: number;
  music: number;
}

export type SfxName =
  | 'hop'
  | 'mt_charge'
  | 'mt_release'
  | 'coin'
  | 'item_tick'
  | 'item_lock'
  | 'shell_fire'
  | 'shell_bounce'
  | 'hit'
  | 'explosion'
  | 'boost_pad'
  | 'countdown'
  | 'go'
  | 'lap'
  | 'final_lap'
  | 'finish'
  | 'lightning'
  | 'warning'
  | 'trick'
  | 'ui_click'
  | (string & {});

interface EngineNodes {
  oscMain: OscillatorNode;
  oscSub: OscillatorNode;
  filter: BiquadFilterNode;
  engineGain: GainNode;
  screechSrc: AudioBufferSourceNode;
  screechFilter: BiquadFilterNode;
  screechGain: GainNode;
}

interface NormalizedBgmStyle {
  tempo: number;
  scaleFreqs: number[];
  bassFreqs: number[];
}

type WindowWithWebkitAudio = Window &
  typeof globalThis & {
    webkitAudioContext?: typeof AudioContext;
  };

function clamp(v: number, min: number, max: number): number {
  return v < min ? min : v > max ? max : v;
}

function midiToFreq(midi: number): number {
  return 440 * Math.pow(2, (midi - 69) / 12);
}

const DEFAULT_BGM_STYLE: TrackBgmStyle = {
  tempo: 134,
  scale: [60, 62, 64, 67, 69, 72, 74, 76],
  bassPattern: [0, 0, 3, 4],
};

// Catchy 16-step melody index offsets & rhythm accents for procedural race BGM
const LEAD_MOTIF_STEPS = [0, -1, 2, 4, -1, 3, 2, 1, 0, 2, 4, 5, 4, -1, 3, 2];
const ARP_PATTERN = [0, 2, 4, 2, 0, 2, 5, 4];

/**
 * Zero-dependency Web Audio API engine providing lazy gesture unlock,
 * master/SFX/music mixers, continuous kart engine & drift synth,
 * 20 arcade SFX cues, and a lookahead procedural BGM sequencer.
 */
export class AudioEngine {
  ctx: AudioContext | null = null;
  unlocked = false;

  volumes: AudioVolumes = {
    master: 0.75,
    sfx: 0.85,
    music: 0.55,
  };

  private _masterGain: GainNode | null = null;
  private _sfxGain: GainNode | null = null;
  private _musicGain: GainNode | null = null;
  private _bgmBusGain: GainNode | null = null;
  private _compressor: DynamicsCompressorNode | null = null;
  private _noiseBuffer: AudioBuffer | null = null;

  // Continuous engine synth nodes
  private _engineNodes: EngineNodes | null = null;
  private _engineActive = false;

  // Procedural BGM scheduler state
  private _bgmTimer: ReturnType<typeof setInterval> | null = null;
  private _bgmPlaying = false;
  private _bgmStyle: NormalizedBgmStyle | null = null;
  private _bgmStep = 0;
  private _bgmNextNoteTime = 0;

  // Rate limiting for rapid repeated SFX
  private _lastSfxTime = new Map<string, number>();
  private _ctxCloseSafe = false;
  private _boundUnlock: () => void;

  constructor() {
    this._boundUnlock = () => {
      this.unlock();
    };
    if (typeof window !== 'undefined') {
      window.addEventListener('pointerdown', this._boundUnlock, { passive: true });
      window.addEventListener('keydown', this._boundUnlock, { passive: true });
      window.addEventListener('touchstart', this._boundUnlock, { passive: true });
    }
  }

  private _ensureContext(): AudioContext | null {
    if (this.ctx) return this.ctx;
    if (typeof window === 'undefined') return null;
    const win = window as WindowWithWebkitAudio;
    const AudioCtx = win.AudioContext || win.webkitAudioContext;
    if (!AudioCtx) return null;

    try {
      const ctx = new AudioCtx();
      this.ctx = ctx;

      // Soft dynamics compressor protects speakers during overlapping hits/explosions
      const comp = ctx.createDynamicsCompressor();
      comp.threshold.value = -14;
      comp.knee.value = 18;
      comp.ratio.value = 4;
      comp.attack.value = 0.005;
      comp.release.value = 0.14;
      comp.connect(ctx.destination);
      this._compressor = comp;

      const master = ctx.createGain();
      master.gain.value = this.volumes.master;
      master.connect(comp);
      this._masterGain = master;

      const sfx = ctx.createGain();
      sfx.gain.value = this.volumes.sfx;
      sfx.connect(master);
      this._sfxGain = sfx;

      const music = ctx.createGain();
      music.gain.value = this.volumes.music;
      music.connect(master);
      this._musicGain = music;

      this._noiseBuffer = this._createNoiseBuffer(ctx);
      return ctx;
    } catch {
      return null;
    }
  }

  private _createNoiseBuffer(ctx: AudioContext): AudioBuffer {
    const length = Math.floor(ctx.sampleRate * 1.0);
    const buffer = ctx.createBuffer(1, length, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < length; i++) {
      data[i] = Math.random() * 2 - 1;
    }
    return buffer;
  }

  unlock(): boolean {
    const ctx = this._ensureContext();
    if (!ctx) return false;

    if (ctx.state === 'suspended') {
      ctx
        .resume()
        .then(() => {
          this.unlocked = true;
          if (this._bgmPlaying && !this._bgmTimer) {
            this._startBgmScheduler();
          }
        })
        .catch(() => {});
    } else if (ctx.state === 'running') {
      this.unlocked = true;
    }
    return this.unlocked;
  }

  setVolumes(vols: Partial<AudioVolumes> = {}): AudioVolumes {
    if (!vols || typeof vols !== 'object') return this.getVolumes();
    if (vols.master !== undefined) this.volumes.master = clamp(Number(vols.master) || 0, 0, 1);
    if (vols.sfx !== undefined) this.volumes.sfx = clamp(Number(vols.sfx) || 0, 0, 1);
    if (vols.music !== undefined) this.volumes.music = clamp(Number(vols.music) || 0, 0, 1);

    if (this.ctx) {
      const now = this.ctx.currentTime;
      if (this._masterGain) this._masterGain.gain.setTargetAtTime(this.volumes.master, now, 0.02);
      if (this._sfxGain) this._sfxGain.gain.setTargetAtTime(this.volumes.sfx, now, 0.02);
      if (this._musicGain) this._musicGain.gain.setTargetAtTime(this.volumes.music, now, 0.02);
    }
    return this.getVolumes();
  }

  getVolumes(): AudioVolumes {
    return { ...this.volumes };
  }

  private _ensureEngineNodes(): EngineNodes | null {
    const ctx = this._ensureContext();
    if (!ctx || ctx.state !== 'running') return null;
    if (this._engineNodes) return this._engineNodes;

    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = 280;
    filter.Q.value = 2.6;

    const engineGain = ctx.createGain();
    engineGain.gain.value = 0;

    const oscMain = ctx.createOscillator();
    oscMain.type = 'sawtooth';
    oscMain.frequency.value = 54;

    const oscSub = ctx.createOscillator();
    oscSub.type = 'triangle';
    oscSub.frequency.value = 27;

    const subGain = ctx.createGain();
    subGain.gain.value = 0.65;

    oscMain.connect(filter);
    oscSub.connect(subGain);
    subGain.connect(filter);
    filter.connect(engineGain);
    if (this._sfxGain) engineGain.connect(this._sfxGain);

    // Drift tire screech channel (bandpass white noise)
    const screechSrc = ctx.createBufferSource();
    screechSrc.buffer = this._noiseBuffer;
    screechSrc.loop = true;

    const screechFilter = ctx.createBiquadFilter();
    screechFilter.type = 'bandpass';
    screechFilter.frequency.value = 1350;
    screechFilter.Q.value = 5.5;

    const screechGain = ctx.createGain();
    screechGain.gain.value = 0;

    screechSrc.connect(screechFilter);
    screechFilter.connect(screechGain);
    if (this._sfxGain) screechGain.connect(this._sfxGain);

    oscMain.start();
    oscSub.start();
    screechSrc.start();

    this._engineNodes = {
      oscMain,
      oscSub,
      filter,
      engineGain,
      screechSrc,
      screechFilter,
      screechGain,
    };
    return this._engineNodes;
  }

  updateEngine(speedRatio = 0, drifting = false, boostActive = false, starActive = false): void {
    if (!this.ctx || this.ctx.state !== 'running') return;
    const nodes = this._ensureEngineNodes();
    if (!nodes) return;

    this._engineActive = true;
    const now = this.ctx.currentTime;
    const spd = clamp(speedRatio, 0, 1.5);

    const boostMult = boostActive ? 1.24 : 1.0;
    const starShimmer = starActive ? 1.08 + Math.sin(now * 24) * 0.04 : 1.0;
    const baseFreq = (50 + spd * 112) * boostMult * starShimmer;

    nodes.oscMain.frequency.setTargetAtTime(baseFreq, now, 0.04);
    nodes.oscSub.frequency.setTargetAtTime(baseFreq * 0.5, now, 0.04);
    nodes.filter.frequency.setTargetAtTime(220 + spd * 980 + (boostActive ? 380 : 0), now, 0.05);

    const targetGain = 0.045 + Math.min(1, spd) * 0.06 + (boostActive ? 0.025 : 0);
    nodes.engineGain.gain.setTargetAtTime(targetGain, now, 0.05);

    const screechLevel = drifting && spd > 0.22 ? clamp(0.032 + spd * 0.024, 0, 0.065) : 0;
    nodes.screechFilter.frequency.setTargetAtTime(1150 + spd * 550, now, 0.04);
    nodes.screechGain.gain.setTargetAtTime(screechLevel, now, 0.04);
  }

  stopEngine(): void {
    if (!this.ctx || !this._engineNodes) return;
    this._engineActive = false;
    const now = this.ctx.currentTime;
    this._engineNodes.engineGain.gain.setTargetAtTime(0, now, 0.05);
    this._engineNodes.screechGain.gain.setTargetAtTime(0, now, 0.04);
  }

  private _playTone(
    freqStart: number,
    freqEnd: number,
    duration: number,
    type: OscillatorType = 'sine',
    gainPeak = 0.16,
    delay = 0,
    targetGainNode: AudioNode | null = null
  ): void {
    const ctx = this.ctx;
    const dest = targetGainNode || this._sfxGain;
    if (!ctx || ctx.state !== 'running' || !dest) return;

    const t0 = ctx.currentTime + delay;
    const t1 = t0 + Math.max(0.02, duration);

    const osc = ctx.createOscillator();
    osc.type = type;
    osc.frequency.setValueAtTime(Math.max(20, freqStart), t0);
    if (freqEnd !== freqStart) {
      osc.frequency.exponentialRampToValueAtTime(Math.max(20, freqEnd), t1);
    }

    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.linearRampToValueAtTime(gainPeak, t0 + Math.min(0.015, duration * 0.25));
    g.gain.exponentialRampToValueAtTime(0.0001, t1);

    osc.connect(g);
    g.connect(dest);

    osc.start(t0);
    osc.stop(t1 + 0.02);
    osc.onended = () => {
      osc.disconnect();
      g.disconnect();
    };
  }

  private _playNoise(
    duration: number,
    filterType: BiquadFilterType,
    freqStart: number,
    freqEnd: number,
    gainPeak = 0.14,
    delay = 0,
    q = 1.5,
    targetGainNode: AudioNode | null = null
  ): void {
    const ctx = this.ctx;
    const dest = targetGainNode || this._sfxGain;
    if (!ctx || ctx.state !== 'running' || !this._noiseBuffer || !dest) return;

    const t0 = ctx.currentTime + delay;
    const t1 = t0 + Math.max(0.02, duration);

    const src = ctx.createBufferSource();
    src.buffer = this._noiseBuffer;

    const filter = ctx.createBiquadFilter();
    filter.type = filterType;
    filter.Q.value = q;
    filter.frequency.setValueAtTime(Math.max(30, freqStart), t0);
    if (freqEnd !== freqStart) {
      filter.frequency.exponentialRampToValueAtTime(Math.max(30, freqEnd), t1);
    }

    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.linearRampToValueAtTime(gainPeak, t0 + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, t1);

    src.connect(filter);
    filter.connect(g);
    g.connect(dest);

    src.start(t0);
    src.stop(t1 + 0.02);
    src.onended = () => {
      src.disconnect();
      filter.disconnect();
      g.disconnect();
    };
  }

  playSfx(name: SfxName, arg = 0): void {
    const ctx = this._ensureContext();
    if (!ctx) return;
    if (ctx.state === 'suspended') {
      this.unlock();
      return;
    }
    if (ctx.state !== 'running') return;

    const nowMs = performance.now();
    const minCooldown = name === 'item_tick' || name === 'shell_bounce' ? 30 : 12;
    const prevMs = this._lastSfxTime.get(name) ?? -Infinity;
    if (nowMs - prevMs < minCooldown) return;
    this._lastSfxTime.set(name, nowMs);

    switch (name) {
      case 'hop':
        this._playTone(210, 480, 0.095, 'triangle', 0.18);
        this._playTone(320, 620, 0.06, 'sine', 0.09, 0.015);
        break;

      case 'mt_charge': {
        const tier = clamp(Number(arg) || 1, 1, 3);
        const mult = tier === 1 ? 1.0 : tier === 2 ? 1.25 : 1.5;
        this._playTone(580 * mult, 1080 * mult, 0.12, 'triangle', 0.14);
        this._playTone(880 * mult, 1460 * mult, 0.09, 'sine', 0.09, 0.03);
        break;
      }

      case 'mt_release':
        this._playNoise(0.24, 'bandpass', 600, 2600, 0.18, 0, 1.4);
        this._playTone(220, 740, 0.22, 'sawtooth', 0.12);
        this._playTone(330, 990, 0.2, 'triangle', 0.12, 0.03);
        break;

      case 'coin':
        this._playTone(987.77, 987.77, 0.075, 'triangle', 0.16, 0);
        this._playTone(1318.51, 1318.51, 0.24, 'triangle', 0.17, 0.068);
        break;

      case 'item_tick':
        this._playTone(760, 620, 0.038, 'square', 0.075);
        break;

      case 'item_lock':
        this._playTone(523.25, 523.25, 0.07, 'triangle', 0.14, 0);
        this._playTone(659.25, 659.25, 0.07, 'triangle', 0.14, 0.055);
        this._playTone(783.99, 783.99, 0.08, 'triangle', 0.15, 0.11);
        this._playTone(1046.5, 1046.5, 0.22, 'triangle', 0.18, 0.165);
        break;

      case 'shell_fire':
        this._playTone(360, 120, 0.11, 'sawtooth', 0.16);
        this._playNoise(0.1, 'highpass', 900, 2800, 0.14);
        break;

      case 'shell_bounce':
        this._playTone(440, 260, 0.08, 'triangle', 0.14);
        this._playTone(320, 480, 0.06, 'sine', 0.09, 0.02);
        break;

      case 'hit':
        this._playTone(260, 68, 0.24, 'sawtooth', 0.2);
        this._playNoise(0.18, 'lowpass', 1400, 260, 0.18);
        break;

      case 'explosion':
        this._playTone(125, 30, 0.45, 'sawtooth', 0.26);
        this._playNoise(0.5, 'lowpass', 1800, 140, 0.28, 0, 0.9);
        break;

      case 'boost_pad':
        this._playTone(280, 1020, 0.25, 'sawtooth', 0.13);
        this._playTone(420, 1380, 0.24, 'triangle', 0.12, 0.02);
        this._playNoise(0.22, 'bandpass', 900, 3200, 0.1);
        break;

      case 'countdown':
        this._playTone(440, 440, 0.18, 'triangle', 0.18);
        this._playTone(880, 880, 0.14, 'sine', 0.08);
        break;

      case 'go':
        this._playTone(880, 880, 0.42, 'triangle', 0.2);
        this._playTone(1318.51, 1318.51, 0.42, 'sine', 0.14);
        this._playTone(1760, 1760, 0.35, 'sine', 0.08);
        break;

      case 'lap':
        this._playTone(523.25, 523.25, 0.09, 'triangle', 0.16, 0);
        this._playTone(659.25, 659.25, 0.09, 'triangle', 0.16, 0.08);
        this._playTone(783.99, 783.99, 0.09, 'triangle', 0.16, 0.16);
        this._playTone(1046.5, 1046.5, 0.32, 'triangle', 0.2, 0.24);
        break;

      case 'final_lap':
        this._playTone(587.33, 587.33, 0.075, 'sawtooth', 0.14, 0);
        this._playTone(739.99, 739.99, 0.075, 'sawtooth', 0.14, 0.065);
        this._playTone(880, 880, 0.075, 'sawtooth', 0.14, 0.13);
        this._playTone(1174.66, 1174.66, 0.38, 'triangle', 0.2, 0.195);
        break;

      case 'finish': {
        const notes = [523.25, 659.25, 783.99, 1046.5, 1318.51, 1567.98];
        notes.forEach((f, i) => {
          this._playTone(f, f, i === notes.length - 1 ? 0.55 : 0.1, 'triangle', 0.16, i * 0.075);
        });
        this._playTone(523.25, 523.25, 0.55, 'sine', 0.12, 0.38);
        this._playTone(783.99, 783.99, 0.55, 'sine', 0.12, 0.38);
        break;
      }

      case 'lightning':
        this._playNoise(0.36, 'bandpass', 3200, 420, 0.22, 0, 2.2);
        this._playTone(1350, 140, 0.32, 'sawtooth', 0.18);
        break;

      case 'warning':
        this._playTone(880, 880, 0.075, 'square', 0.1, 0);
        this._playTone(660, 660, 0.075, 'square', 0.1, 0.09);
        this._playTone(880, 880, 0.09, 'square', 0.11, 0.18);
        break;

      case 'trick':
        this._playTone(523.25, 659.25, 0.08, 'triangle', 0.14, 0);
        this._playTone(783.99, 1046.5, 0.12, 'triangle', 0.15, 0.06);
        this._playTone(1318.51, 1567.98, 0.18, 'sine', 0.13, 0.12);
        break;

      case 'ui_click':
      default:
        this._playTone(680, 940, 0.045, 'triangle', 0.12);
        break;
    }
  }

  private _normalizeBgmStyle(bgmStyle: Partial<TrackBgmStyle> | null | undefined): NormalizedBgmStyle {
    const raw = bgmStyle && typeof bgmStyle === 'object' ? bgmStyle : DEFAULT_BGM_STYLE;
    const tempo = clamp(Number(raw.tempo) || 134, 80, 190);

    const rawScale = Array.isArray(raw.scale) && raw.scale.length > 0 ? raw.scale : DEFAULT_BGM_STYLE.scale;
    const scaleFreqs = rawScale.map((val) => {
      const n = Number(val) || 60;
      if (n < 24) return midiToFreq(60 + n);
      if (n <= 108) return midiToFreq(n);
      return n;
    });

    const rawBass =
      Array.isArray(raw.bassPattern) && raw.bassPattern.length > 0
        ? raw.bassPattern
        : DEFAULT_BGM_STYLE.bassPattern;
    const bassFreqs = rawBass.map((val) => {
      const n = Number(val) || 0;
      let freq: number;
      if (n >= 0 && n < scaleFreqs.length && Number.isInteger(n)) {
        freq = scaleFreqs[n] * 0.25;
      } else if (n < 24) {
        freq = midiToFreq(36 + n);
      } else if (n <= 108) {
        freq = midiToFreq(n > 54 ? n - 24 : n);
      } else {
        freq = n;
      }
      while (freq > 155) freq *= 0.5;
      while (freq < 45) freq *= 2;
      return freq;
    });

    return { tempo, scaleFreqs, bassFreqs };
  }

  startMusic(bgmStyle: Partial<TrackBgmStyle> | null = null): void {
    this.stopMusic();
    this._bgmStyle = this._normalizeBgmStyle(bgmStyle);
    this._bgmPlaying = true;
    this._bgmStep = 0;

    const ctx = this._ensureContext();
    if (!ctx) return;
    if (ctx.state === 'suspended') {
      this.unlock();
      return;
    }
    this._startBgmScheduler();
  }

  private _startBgmScheduler(): void {
    if (!this.ctx || !this._bgmStyle) return;
    if (this._bgmTimer) {
      clearInterval(this._bgmTimer);
      this._bgmTimer = null;
    }
    if (this._bgmBusGain) {
      try {
        this._bgmBusGain.disconnect();
      } catch {
        // Ignore already-disconnected bus
      }
    }
    this._bgmBusGain = this.ctx.createGain();
    this._bgmBusGain.gain.setValueAtTime(1.0, this.ctx.currentTime);
    if (this._musicGain) {
      this._bgmBusGain.connect(this._musicGain);
    }

    this._bgmNextNoteTime = this.ctx.currentTime + 0.04;
    this._bgmTimer = setInterval(() => this._scheduleBgmAhead(), 45);
  }

  private _scheduleBgmAhead(): void {
    if (!this._bgmPlaying || !this.ctx || this.ctx.state !== 'running' || !this._bgmStyle) return;

    const stepDur = 60 / this._bgmStyle.tempo / 4; // 16th note
    const lookahead = 0.14;

    while (this._bgmNextNoteTime < this.ctx.currentTime + lookahead) {
      this._triggerBgmStep(this._bgmStep, this._bgmNextNoteTime, stepDur);
      this._bgmNextNoteTime += stepDur;
      this._bgmStep = (this._bgmStep + 1) % 64;
    }
  }

  private _triggerBgmStep(step: number, when: number, stepDur: number): void {
    if (!this._bgmStyle) return;
    const { scaleFreqs, bassFreqs } = this._bgmStyle;
    const barIdx = Math.floor(step / 16);
    const stepInBar = step % 16;

    const bassRoot = bassFreqs[barIdx % bassFreqs.length];

    // Driving octave bassline on 8th notes + syncopated kicks
    if (stepInBar % 2 === 0) {
      const oct = stepInBar % 4 === 2 ? 2.0 : 1.0;
      this._playMusicVoice(bassRoot * oct, 'sawtooth', 'lowpass', 620, when, stepDur * 1.45, 0.14);
    }

    // Energetic synth lead motif
    const motifVal = LEAD_MOTIF_STEPS[stepInBar];
    if (motifVal >= 0) {
      const idx = (motifVal + (barIdx % 2 === 1 ? 1 : 0)) % scaleFreqs.length;
      const leadFreq = scaleFreqs[idx] * (barIdx === 3 && stepInBar >= 12 ? 2.0 : 1.0);
      this._playMusicVoice(leadFreq, 'triangle', 'lowpass', 2400, when, stepDur * 1.7, 0.095);
    }

    // Sparkle background arpeggio
    if (stepInBar % 2 === 1) {
      const arpIdx = ARP_PATTERN[(stepInBar >> 1) % ARP_PATTERN.length] % scaleFreqs.length;
      this._playMusicVoice(scaleFreqs[arpIdx] * 1.0, 'sine', 'lowpass', 3000, when, stepDur * 0.9, 0.045);
    }

    // Percussive groove: Kick (0, 4, 8, 12 + syncopated 10), Snare (4, 12), Hi-hat (off-beats)
    if (stepInBar % 4 === 0 || stepInBar === 10) {
      this._playMusicKick(when);
    }
    if (stepInBar === 4 || stepInBar === 12) {
      this._playMusicSnare(when);
    }
    if (stepInBar % 2 === 1) {
      this._playMusicHat(when);
    }
  }

  private _playMusicVoice(
    freq: number,
    oscType: OscillatorType,
    filterType: BiquadFilterType,
    cutoff: number,
    when: number,
    dur: number,
    gainPeak: number
  ): void {
    const ctx = this.ctx;
    const dest = this._bgmBusGain || this._musicGain;
    if (!ctx || !dest) return;

    const osc = ctx.createOscillator();
    osc.type = oscType;
    osc.frequency.setValueAtTime(freq, when);

    const filter = ctx.createBiquadFilter();
    filter.type = filterType;
    filter.frequency.setValueAtTime(cutoff, when);

    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, when);
    g.gain.linearRampToValueAtTime(gainPeak, when + 0.012);
    g.gain.exponentialRampToValueAtTime(0.0001, when + dur);

    osc.connect(filter);
    filter.connect(g);
    g.connect(dest);

    osc.start(when);
    osc.stop(when + dur + 0.02);
    osc.onended = () => {
      osc.disconnect();
      filter.disconnect();
      g.disconnect();
    };
  }

  private _playMusicKick(when: number): void {
    const ctx = this.ctx;
    const dest = this._bgmBusGain || this._musicGain;
    if (!ctx || !dest) return;

    const osc = ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(145, when);
    osc.frequency.exponentialRampToValueAtTime(42, when + 0.09);

    const g = ctx.createGain();
    g.gain.setValueAtTime(0.22, when);
    g.gain.exponentialRampToValueAtTime(0.0001, when + 0.11);

    osc.connect(g);
    g.connect(dest);
    osc.start(when);
    osc.stop(when + 0.13);
    osc.onended = () => {
      osc.disconnect();
      g.disconnect();
    };
  }

  private _playMusicSnare(when: number): void {
    const ctx = this.ctx;
    const dest = this._bgmBusGain || this._musicGain;
    if (!ctx || !this._noiseBuffer || !dest) return;

    const src = ctx.createBufferSource();
    src.buffer = this._noiseBuffer;

    const hp = ctx.createBiquadFilter();
    hp.type = 'highpass';
    hp.frequency.setValueAtTime(1200, when);

    const g = ctx.createGain();
    g.gain.setValueAtTime(0.11, when);
    g.gain.exponentialRampToValueAtTime(0.0001, when + 0.09);

    src.connect(hp);
    hp.connect(g);
    g.connect(dest);
    src.start(when);
    src.stop(when + 0.11);
    src.onended = () => {
      src.disconnect();
      hp.disconnect();
      g.disconnect();
    };
  }

  private _playMusicHat(when: number): void {
    const ctx = this.ctx;
    const dest = this._bgmBusGain || this._musicGain;
    if (!ctx || !this._noiseBuffer || !dest) return;

    const src = ctx.createBufferSource();
    src.buffer = this._noiseBuffer;

    const hp = ctx.createBiquadFilter();
    hp.type = 'highpass';
    hp.frequency.setValueAtTime(6500, when);

    const g = ctx.createGain();
    g.gain.setValueAtTime(0.042, when);
    g.gain.exponentialRampToValueAtTime(0.0001, when + 0.035);

    src.connect(hp);
    hp.connect(g);
    g.connect(dest);
    src.start(when);
    src.stop(when + 0.045);
    src.onended = () => {
      src.disconnect();
      hp.disconnect();
      g.disconnect();
    };
  }

  stopMusic(): void {
    this._bgmPlaying = false;
    if (this._bgmTimer) {
      clearInterval(this._bgmTimer);
      this._bgmTimer = null;
    }
    if (this.ctx && this._bgmBusGain) {
      const bus = this._bgmBusGain;
      this._bgmBusGain = null;
      const now = this.ctx.currentTime;
      try {
        bus.gain.cancelScheduledValues(now);
        bus.gain.setTargetAtTime(0, now, 0.01);
        setTimeout(() => {
          try {
            bus.disconnect();
          } catch {
            // Ignore already-disconnected bus
          }
        }, 80);
      } catch {
        try {
          bus.disconnect();
        } catch {
          // Ignore already-disconnected bus
        }
      }
    }
  }

  dispose(): void {
    this.stopMusic();
    this.stopEngine();
    if (typeof window !== 'undefined') {
      window.removeEventListener('pointerdown', this._boundUnlock);
      window.removeEventListener('keydown', this._boundUnlock);
      window.removeEventListener('touchstart', this._boundUnlock);
    }
    if (this._engineNodes) {
      try {
        this._engineNodes.oscMain.stop();
        this._engineNodes.oscSub.stop();
        this._engineNodes.screechSrc.stop();
      } catch {
        // Ignore already-stopped nodes
      }
      this._engineNodes = null;
    }
    if (!this._ctxCloseSafe && this.ctx && typeof this.ctx.close === 'function') {
      this._ctxCloseSafe = true;
      this.ctx.close().catch(() => {});
    }
    this.ctx = null;
  }
}
