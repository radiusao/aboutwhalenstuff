/**
 * "Light descends": the time-of-day transition, and the Lighting every drawer reads.
 *
 * The new light enters at the surface and sinks. Each height starts its OKLab blend when the
 * front reaches it (delay = y * 2.4s, then a 1.6s blend). Going to Midnight, the night lanterns
 * then catch from the seabed upward like candles. Leaving Midnight, they go out top-down over
 * 1s first, and only then does the new daylight descend. Under reduced motion the whole change
 * is one uniform 1.2s crossfade with no flicker.
 */
import type { LightingMode } from '../types/sanctuary';
import type { Lighting } from './types';
import { layerHorizon, mixOK, modeTokens, parseColor, waterAtMode, type ModeColor, type ModeNumber } from './palette';
import { candle } from './light';

/** Seconds for the front to sink from the surface (y 0) to the bottom of the screen (y 1). */
const SINK = 2.4;
/** Seconds each height takes to blend once the front reaches it. */
const BLEND = 1.6;
/** The visible front (mid-blend) reaches the seabed here; Midnight's lanterns start catching. */
const FRONT_AT_SEABED = SINK + BLEND / 2;
/** Bottom-up spread of the candle catch, and the length of one candle. */
const CATCH = 1.5;
const CANDLE = 0.5;
/** Leaving Midnight: lanterns go out top-down over 1s (each fades in OUT_FADE). */
const LIGHTS_OUT = 1;
const OUT_FADE = 0.35;
/** Reduced motion: one uniform crossfade. */
const CROSSFADE = 1.2;
/**
 * UI inks switch quickly (over INK_BLEND) instead of greying through the blend. inkDeep switches
 * at 2.4s; inkTop switches when the water behind the HUD has actually turned, see inkStart().
 */
const INK_BLEND = 0.4;
const INK_DEEP_START = 2.4;
/** Heights the HUD row sits at (desktop ~5%, phone ~9.5% under the Dynamic Island). */
const HUD_YS = [0.05, 0.095, 0.12];
/** Share of the Snell's window alpha that still reaches the HUD row (its two outer bands). */
const HUD_WINDOW_SHARE = 0.13;
/** Interrupted transitions nest; past this depth a new mode waits for the current one. */
const MAX_DEPTH = 3;

export interface EngineLighting extends Lighting {
  /** Start "Light descends" toward `mode` (immediate on the first call, with `instant`, or same mode). */
  setMode(mode: LightingMode, opts?: { instant?: boolean }): void;
  update(dt: number): void;
  /** True while a transition (lights-out, descent or candle catch) is running. */
  readonly active: boolean;
  /** Progress of the whole transition 0..1 (1 when idle). */
  readonly progress: number;
}

interface Phase {
  from: LightingMode;
  to: LightingMode;
  /** The interrupted transition this one blends away from (frozen), or null to start from `from`. */
  prev: Phase | null;
  /** Seconds since this transition began. */
  t: number;
  /** Seconds of top-down lights-out before the descent (only when lanterns were lit). */
  out: number;
  reduced: boolean;
  duration: number;
}

const sine = (s: number) => 0.5 - 0.5 * Math.cos(Math.PI * s);
const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);

/** Small smooth per-height jitter so lanterns at nearby heights don't catch in one scanline. */
function catchJitter(y: number): number {
  return 0.06 * Math.sin(y * 41.3 + 0.7) + 0.035 * Math.sin(y * 97.1 + 2.1);
}

function depthOf(p: Phase | null): number {
  let d = 0;
  for (let q = p; q; q = q.prev) d++;
  return d;
}

/** Blend progress 0..1 of phase `p` at height y (eased). */
function blendAt(p: Phase, y: number): number {
  if (p.reduced) return sine(clamp01(p.t / CROSSFADE));
  const tau = p.t - p.out - clamp01(y) * SINK;
  return sine(clamp01(tau / BLEND));
}

/** What the HUD row sees at height y, t seconds into a plain from -> to descent (no lights-out). */
function hudBackdrop(from: LightingMode, to: LightingMode, t: number, y: number): [number, number, number] {
  const k = (yy: number) => sine(clamp01((t - clamp01(yy) * SINK) / BLEND));
  const water = parseColor(mixOK(waterAtMode(from, y), waterAtMode(to, y), k(y)));
  const kw = k(layerHorizon.surface);
  const win = parseColor(mixOK(modeTokens[from].color.window, modeTokens[to].color.window, kw));
  const wa = (modeTokens[from].num.windowAlpha + (modeTokens[to].num.windowAlpha - modeTokens[from].num.windowAlpha) * kw) * HUD_WINDOW_SHARE;
  return [0, 1, 2].map((i) => water[i] + (1 - (1 - water[i]) * (1 - win[i]) - water[i]) * wa) as [number, number, number];
}

function relLum([r, g, b]: [number, number, number]): number {
  const lin = (c: number) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}

const inkStartCache = new Map<string, number>();

/**
 * Seconds after the light starts sinking (after any lights-out) at which `token` begins its
 * INK_BLEND switch. inkTop switches when the new ink starts to out-read the old one against the
 * water behind the HUD (Snell's window glow included), so the HUD never shows light ink on a
 * still-pale top band (or dark ink on one that has already darkened). Where the two inks read
 * about the same throughout (Day <-> Sunset), it follows the water's own mid-blend.
 * The DOM overlay uses this too, so its --ink-top var keeps time with the canvas.
 */
export function inkStart(from: LightingMode, to: LightingMode, token: 'inkTop' | 'inkDeep'): number {
  if (token === 'inkDeep' || from === to) return INK_DEEP_START;
  const key = `${from}>${to}`;
  const hit = inkStartCache.get(key);
  if (hit !== undefined) return hit;
  const la = relLum(parseColor(modeTokens[from].color.inkTop));
  const lb = relLum(parseColor(modeTokens[to].color.inkTop));
  const cr = (x: number, y: number) => (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
  const mid = HUD_YS[1] * SINK + BLEND / 2;
  let center = mid;
  // Only a real crossover counts: the old ink better at first, the new one better later.
  let before = false;
  for (let t = 0; t <= SINK + BLEND; t += 0.02) {
    let ca = Infinity;
    let cb = Infinity;
    for (const y of HUD_YS) {
      const lbg = relLum(hudBackdrop(from, to, t, y));
      ca = Math.min(ca, cr(la, lbg));
      cb = Math.min(cb, cr(lb, lbg));
    }
    if (ca > cb * 1.02) before = true;
    else if (before && cb >= ca) {
      center = t;
      break;
    }
  }
  const start = Math.max(0, center - INK_BLEND / 2);
  inkStartCache.set(key, start);
  return start;
}

function inkBlend(p: Phase, start: number): number {
  if (p.reduced) return sine(clamp01(p.t / CROSSFADE));
  return sine(clamp01((p.t - p.out - start) / INK_BLEND));
}

function colorOf(p: Phase, token: ModeColor, y: number): string {
  const base = p.prev ? colorOf(p.prev, token, y) : modeTokens[p.from].color[token];
  const k = token === 'inkTop' || token === 'inkDeep' ? inkBlend(p, inkStart(p.from, p.to, token)) : blendAt(p, y);
  return mixOK(base, modeTokens[p.to].color[token], k);
}

function numOf(p: Phase, token: ModeNumber, y: number): number {
  const base = p.prev ? numOf(p.prev, token, y) : modeTokens[p.from].num[token];
  const k = blendAt(p, y);
  return base + (modeTokens[p.to].num[token] - base) * k;
}

function waterOf(p: Phase, y: number): string {
  const base = p.prev ? waterOf(p.prev, y) : waterAtMode(p.from, y);
  return mixOK(base, waterAtMode(p.to, y), blendAt(p, y));
}

function biolumOf(p: Phase, y: number): number {
  const start = p.prev ? biolumOf(p.prev, y) : p.from === 'midnight' ? 1 : 0;
  if (p.to === 'midnight') {
    if (p.reduced) return start + (1 - start) * clamp01(p.t / CROSSFADE);
    const turn = FRONT_AT_SEABED + (1 - clamp01(y)) * CATCH + catchJitter(y);
    return Math.max(start, candle(p.t - turn));
  }
  if (start <= 0) return 0;
  if (p.reduced) return start * (1 - clamp01(p.t / CROSSFADE));
  const off = clamp01((p.t - clamp01(y) * (LIGHTS_OUT - OUT_FADE)) / OUT_FADE);
  return start * (1 - off) * (1 - off);
}

function anyLit(p: Phase | null, from: LightingMode): boolean {
  if (!p) return from === 'midnight';
  for (const y of [0.1, 0.4, 0.7, 0.95]) if (biolumOf(p, y) > 0.02) return true;
  return false;
}

/** Creates the engine's Lighting. Starts at Midnight until the first setMode. */
export function createLighting(): EngineLighting {
  let mode: LightingMode = 'midnight';
  let from: LightingMode = 'midnight';
  let phase: Phase | null = null;
  let pending: LightingMode | null = null;
  let first = true;

  const mq = typeof matchMedia === 'function' ? matchMedia('(prefers-reduced-motion: reduce)') : null;
  let reduced = mq?.matches ?? false;
  mq?.addEventListener?.('change', (e) => {
    reduced = e.matches;
  });

  function begin(to: LightingMode) {
    const prev = phase;
    const startFrom = prev ? prev.to : mode;
    const lit = anyLit(prev, startFrom);
    const out = !reduced && to !== 'midnight' && lit ? LIGHTS_OUT : 0;
    const duration = reduced
      ? CROSSFADE
      : out + (to === 'midnight' ? FRONT_AT_SEABED + CATCH + CANDLE + 0.1 : SINK + BLEND);
    phase = { from: startFrom, to, prev, t: 0, out, reduced, duration };
    from = startFrom;
    mode = to;
  }

  const lighting: EngineLighting = {
    get mode() {
      return mode;
    },
    get from() {
      return from;
    },
    get reducedMotion() {
      return reduced;
    },
    get active() {
      return phase !== null;
    },
    get progress() {
      return phase ? clamp01(phase.t / phase.duration) : 1;
    },

    progressAt: (y) => (phase ? blendAt(phase, y) : 1),

    color: (token, y) => (phase ? colorOf(phase, token, y) : modeTokens[mode].color[token]),

    num: (token, y) => (phase ? numOf(phase, token, y) : modeTokens[mode].num[token]),

    waterAt: (y) => (phase ? waterOf(phase, y) : waterAtMode(mode, y)),

    glowGain: (y) => (phase ? numOf(phase, 'glowGain', y) : modeTokens[mode].num.glowGain),

    biolum: (y) => (phase ? biolumOf(phase, y) : mode === 'midnight' ? 1 : 0),

    fogForZ: (z) => 0.5 * (1 - z),

    setMode(next, opts) {
      if (first || opts?.instant) {
        first = false;
        phase = null;
        pending = null;
        mode = from = next;
        return;
      }
      if (next === mode) {
        pending = null;
        return;
      }
      if (depthOf(phase) >= MAX_DEPTH) {
        pending = next;
        return;
      }
      begin(next);
    },

    update(dt) {
      if (!phase) return;
      phase.t += dt;
      if (phase.t >= phase.duration) {
        phase = null;
        from = mode;
        if (pending && pending !== mode) begin(pending);
        pending = null;
      }
    },
  };
  return lighting;
}
