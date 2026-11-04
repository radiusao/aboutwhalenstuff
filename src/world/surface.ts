/**
 * The water column and the lit surface for the Scenery track: the dithered water cache,
 * Snell's window with its rippling edge, the caustic tile, light shafts, and the sun or the
 * real moon seen through the window.
 */
import type { LightingMode } from '../types/sanctuary';
import type { Lighting, WorldFrame } from './types';
import { layerHorizon, modeTokens } from './palette';
import { mulberry32, range, stream } from './rng';
import { drawMoon, moonPhase } from './moon';

const TAU = Math.PI * 2;
const DEG = Math.PI / 180;
const YS = layerHorizon.surface;

/** How much of a mode's light is present at height y during a descent (1 when it is the mode). */
export function modeWeight(L: Lighting, m: LightingMode, y: number): number {
  const p = L.progressAt(y);
  return (L.mode === m ? p : 0) + (L.from === m ? 1 - p : 0);
}

/** 0 by day and sunset, 1 at Midnight, blended by the descent at height y. */
export function nightAt(L: Lighting, y: number): number {
  return Math.min(1, Math.max(0, L.num('bodyDarken', y) / 0.4));
}

// ---------------------------------------------------------------------------
// Shared tiles
// ---------------------------------------------------------------------------

let causticTile: HTMLCanvasElement | null = null;

/** 256x256 caustic tile: a sine-interference field raised to the 6th power. Tiles seamlessly. */
export function getCausticTile(): HTMLCanvasElement {
  if (causticTile) return causticTile;
  const S = 256;
  const c = document.createElement('canvas');
  c.width = c.height = S;
  const g = c.getContext('2d')!;
  const img = g.createImageData(S, S);
  const waves: [number, number, number][] = [
    [3, 1, 0.3],
    [-1, 3, 1.7],
    [2, -3, 2.9],
    [-4, -2, 4.1],
    [1, 5, 5.3],
  ];
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      let s = 0;
      for (const [a, b, p] of waves) s += Math.cos((TAU * (a * x + b * y)) / S + p);
      s /= waves.length;
      const v = Math.pow(Math.max(0, 1 - Math.abs(s) * 2.1), 6);
      const i = (y * S + x) * 4;
      img.data[i] = img.data[i + 1] = img.data[i + 2] = 255;
      img.data[i + 3] = Math.round(v * 255);
    }
  }
  g.putImageData(img, 0, 0);
  causticTile = c;
  return c;
}

let ditherTile: HTMLCanvasElement | null = null;

function getDitherTile(): HTMLCanvasElement {
  if (ditherTile) return ditherTile;
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d')!;
  const img = g.createImageData(64, 64);
  const r = stream('dither');
  for (let i = 0; i < 64 * 64; i++) {
    const v = Math.round(r() * 255);
    img.data[i * 4] = img.data[i * 4 + 1] = img.data[i * 4 + 2] = v;
    img.data[i * 4 + 3] = 255;
  }
  g.putImageData(img, 0, 0);
  ditherTile = c;
  return c;
}

const tinted = new Map<string, HTMLCanvasElement>();
const patterns = new WeakMap<CanvasRenderingContext2D, Map<string, CanvasPattern>>();

/**
 * The caustic tile tinted to one mode's token color. Only the per-mode tokens ever reach this
 * (a mode change crossfades two of them, see CausticTint), so at most three are ever made.
 */
function causticTinted(color: string): HTMLCanvasElement {
  const hit = tinted.get(color);
  if (hit) return hit;
  const base = getCausticTile();
  if (color.toUpperCase() === '#FFFFFF') {
    tinted.set(color, base);
    return base;
  }
  const c = document.createElement('canvas');
  c.width = c.height = base.width;
  const g = c.getContext('2d')!;
  g.drawImage(base, 0, 0);
  g.globalCompositeOperation = 'source-in';
  g.fillStyle = color;
  g.fillRect(0, 0, c.width, c.height);
  tinted.set(color, c);
  return c;
}

function causticPattern(ctx: CanvasRenderingContext2D, color: string): CanvasPattern | null {
  let m = patterns.get(ctx);
  if (!m) {
    m = new Map();
    patterns.set(ctx, m);
  }
  let p = m.get(color);
  if (!p) {
    p = ctx.createPattern(causticTinted(color), 'repeat') ?? undefined;
    if (!p) return null;
    m.set(color, p);
  }
  return p;
}

/** The caustic tint at a height: the outgoing and incoming mode tokens and the blend between them. */
export interface CausticTint {
  a: string;
  b: string;
  k: number;
}

/**
 * Caustic tint at height y. During a mode change this is a crossfade of the two modes' cached
 * tiles (drawn with `lighter`, so two weighted passes add up to the blended tint) instead of a
 * freshly tinted tile per frame. Returns a shared object; use it before the next call.
 */
export function causticTintAt(L: Lighting, y: number): CausticTint {
  const a = modeTokens[L.from].color.caustic;
  const b = modeTokens[L.mode].color.caustic;
  tintOut.a = a;
  tintOut.b = b;
  tintOut.k = a === b ? 1 : L.progressAt(y);
  return tintOut;
}
const tintOut: CausticTint = { a: '#FFFFFF', b: '#FFFFFF', k: 1 };

/**
 * Two copies of the caustic tile scrolling at 6 and 9 px/s in different directions, added with
 * `lighter` inside `clip`. `squash` < 1 flattens them onto a receding floor.
 */
export function drawCaustics(
  ctx: CanvasRenderingContext2D,
  /** A path, or a function that traces the clip onto the context's path. */
  clip: Path2D | (() => void),
  bounds: { x: number; y: number; w: number; h: number },
  t: number,
  tint: CausticTint,
  alpha: number,
  scale = 1,
  squash = 1,
): void {
  if (alpha <= 0.002) return;
  const k = tint.a === tint.b ? 1 : Math.min(1, Math.max(0, tint.k));
  ctx.save();
  if (typeof clip === 'function') {
    clip();
    ctx.clip();
  } else ctx.clip(clip);
  ctx.globalCompositeOperation = 'lighter';
  for (let pass = 0; pass < 2; pass++) {
    const weight = pass === 0 ? 1 - k : k;
    if (alpha * weight <= 0.002) continue;
    const pat = causticPattern(ctx, pass === 0 ? tint.a : tint.b);
    if (!pat) continue;
    for (let c = 0; c < 2; c++) {
      const speed = c === 0 ? 6 : 9;
      const dir = c === 0 ? -0.35 : 2.45;
      ctx.save();
      const ox = (Math.cos(dir) * speed * t) % 256;
      const oy = (Math.sin(dir) * speed * t) % 256;
      ctx.translate(bounds.x, bounds.y);
      ctx.scale(scale, scale * squash);
      ctx.translate(ox, oy);
      ctx.globalAlpha = alpha * weight * (c === 0 ? 1 : 0.8);
      ctx.fillStyle = pat;
      ctx.fillRect(-ox - 256, -oy - 256, bounds.w / scale + 512, bounds.h / (scale * squash) + 512);
      ctx.restore();
    }
  }
  ctx.restore();
}

// ---------------------------------------------------------------------------
// Water column cache
// ---------------------------------------------------------------------------

export interface WaterCache {
  resize(w: number, h: number, dpr: number): void;
  draw(ctx: CanvasRenderingContext2D, f: WorldFrame): void;
}

/** Half-resolution water gradient, dithered with a 64x64 noise tile at 3% soft-light. */
export function createWaterCache(): WaterCache {
  const canvas = document.createElement('canvas');
  const g = canvas.getContext('2d')!;
  let key = '';
  let dirty = true;
  const rebuild = (L: Lighting) => {
    const ch = canvas.height;
    const grad = g.createLinearGradient(0, 0, 0, ch);
    const N = 32;
    for (let i = 0; i <= N; i++) grad.addColorStop(i / N, L.waterAt(i / N));
    g.globalCompositeOperation = 'source-over';
    g.globalAlpha = 1;
    g.fillStyle = grad;
    g.fillRect(0, 0, canvas.width, ch);
    const pat = g.createPattern(getDitherTile(), 'repeat');
    if (pat) {
      g.globalCompositeOperation = 'soft-light';
      g.globalAlpha = 0.03;
      g.fillStyle = pat;
      g.fillRect(0, 0, canvas.width, ch);
      g.globalCompositeOperation = 'source-over';
      g.globalAlpha = 1;
    }
  };
  return {
    resize(w, h, dpr) {
      canvas.width = Math.max(2, Math.ceil((w * dpr) / 2));
      canvas.height = Math.max(2, Math.ceil((h * dpr) / 2));
      dirty = true;
    },
    draw(ctx, f) {
      const L = f.lighting;
      if (canvas.width <= 2) this.resize(f.w, f.h, f.dpr);
      const moving = L.from !== L.mode;
      const k = moving ? '' : L.mode;
      if (dirty || moving || k !== key) {
        rebuild(L);
        key = k;
        dirty = false;
      }
      ctx.drawImage(canvas, 0, 0, f.w, f.h);
    },
  };
}

// ---------------------------------------------------------------------------
// Snell's window, shafts, sun and moon
// ---------------------------------------------------------------------------

interface Shaft {
  spread: number;
  len: number;
  width: number;
  alpha: number;
  phase: number;
}

export interface Surface {
  resize(w: number, h: number, phone: boolean): void;
  draw(ctx: CanvasRenderingContext2D, f: WorldFrame, shaftBoost: number, ta: number): void;
}

const shaftSprite = (() => {
  let base: HTMLCanvasElement | null = null;
  let tinted: HTMLCanvasElement | null = null;
  let tint = '';
  const W = 64;
  const H = 256;
  const TOP = 0.42;
  const make = () => {
    const c = document.createElement('canvas');
    c.width = W;
    c.height = H;
    const g = c.getContext('2d')!;
    const img = g.createImageData(W, H);
    for (let y = 0; y < H; y++) {
      const v = y / (H - 1);
      const along = Math.pow(1 - v, 1.6) * Math.min(1, v / 0.07);
      const half = (TOP + (1 - TOP) * v) / 2;
      for (let x = 0; x < W; x++) {
        const u = (x + 0.5) / W - 0.5;
        const e = Math.abs(u) / half;
        const across = e >= 1 ? 0 : 1 - smooth(0.45, 1, e);
        const i = (y * W + x) * 4;
        img.data[i] = img.data[i + 1] = img.data[i + 2] = 255;
        img.data[i + 3] = Math.round(255 * along * across);
      }
    }
    g.putImageData(img, 0, 0);
    return c;
  };
  return (color: string): HTMLCanvasElement => {
    if (!base) base = make();
    if (!tinted) {
      tinted = document.createElement('canvas');
      tinted.width = W;
      tinted.height = H;
    }
    if (tint !== color) {
      const g = tinted.getContext('2d')!;
      g.globalCompositeOperation = 'source-over';
      g.clearRect(0, 0, W, H);
      g.drawImage(base, 0, 0);
      g.globalCompositeOperation = 'source-in';
      g.fillStyle = color;
      g.fillRect(0, 0, W, H);
      g.globalCompositeOperation = 'source-over';
      tint = color;
    }
    return tinted;
  };
})();

function smooth(e0: number, e1: number, x: number): number {
  const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0)));
  return t * t * (3 - 2 * t);
}

/**
 * Window bands, outer to inner: scale of the ellipse, share of the window alpha, ripple speed and
 * ripple amplitude. The rim (scale 1) is reached in several small steps, so the window's lower
 * edge stays soft rather than reading as the hard rim of a lamp.
 */
const BANDS: [number, number, number, number][] = [
  [2.3, 0.05, 0.55, 0.028],
  [1.55, 0.07, 0.75, 0.04],
  [1.3, 0.08, 0.85, 0.044],
  [1.13, 0.1, 0.95, 0.048],
  [1.0, 0.12, 1.0, 0.052],
  [0.74, 0.2, 1.3, 0.064],
  [0.5, 0.18, 1.6, 0.076],
];
/** The band that is the window proper (scale 1): it pulses, and the caustics live inside it. */
const RIM_BAND = 4;
const CORE_BAND = 5;

export function createSurface(): Surface {
  let w = 0;
  let h = 0;
  let phone = false;
  const shafts: Shaft[] = [];
  const rand = stream('surface');
  for (let i = 0; i < 5; i++) {
    shafts.push({
      spread: range(rand, -0.22, 0.22),
      len: range(rand, 0.55, 0.8),
      width: range(rand, 0.8, 1.25),
      alpha: range(rand, 0.77, 1.23),
      phase: rand() * TAU,
    });
  }
  const ripple = mulberry32(0x51e11);
  const ph = Array.from({ length: 12 }, () => ripple() * TAU);
  const phase = moonPhase();

  const moonX = () => (phone ? 0.7 : 0.64);

  const windowGeom = () => {
    const cy = phone ? -0.015 * h : -0.04 * h;
    return { cx: 0.5 * w, cy, rx: 0.38 * w * (phone ? 1.08 : 1), ry: 0.09 * h };
  };

  /** Traces band k onto the context's path (fill or clip it next; no Path2D is made). */
  const traceBand = (ctx: CanvasRenderingContext2D, k: number, scale: number, t: number, amp: number) => {
    const { cx, cy, rx, ry } = windowGeom();
    ctx.beginPath();
    const N = 72;
    const a1 = (TAU * t) / 7.3;
    const a2 = (TAU * t) / 11.1;
    for (let i = 0; i <= N; i++) {
      const th = (i / N) * TAU;
      const r =
        1 +
        amp * Math.sin(5 * th + a1 + ph[k]) +
        amp * 0.8 * Math.sin(8 * th - a2 + ph[k + 5]) +
        amp * 0.35 * Math.sin(13 * th + a1 * 1.6 + ph[(k + 2) % 12]);
      const sx = 1 + (scale - 1) * (scale > 1 ? 0.28 : 0.8);
      const x = cx + Math.cos(th) * rx * sx * r;
      const y = cy + Math.sin(th) * ry * scale * r;
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.closePath();
  };

  return {
    resize(nw, nh, nphone) {
      w = nw;
      h = nh;
      phone = nphone;
    },
    draw(ctx, f, shaftBoost, ta) {
      if (f.w !== w || f.h !== h) this.resize(f.w, f.h, f.phone);
      const L = f.lighting;
      const pa = f.parallax(0.5);
      const winColor = L.color('window', YS);
      const winAlpha = L.num('windowAlpha', YS);
      const night = nightAt(L, YS);
      const t = ta;
      ctx.save();
      ctx.translate(pa.x, pa.y);

      // Snell's window: stacked flat bands, each edge rippling on 7.3s and 11.1s sines.
      ctx.globalCompositeOperation = 'screen';
      ctx.fillStyle = winColor;
      const pulse = 1 + 0.1 * Math.sin((TAU * t) / 7.3) + 0.07 * Math.sin((TAU * t) / 11.1 + 1.1);
      for (let k = 0; k < BANDS.length; k++) {
        const [scale, share, wob, amp] = BANDS[k];
        traceBand(ctx, k, scale, t * wob, amp);
        ctx.globalAlpha = Math.min(1, winAlpha * share * (k === RIM_BAND || k === CORE_BAND ? pulse : 1));
        ctx.fill();
      }
      ctx.globalCompositeOperation = 'source-over';
      ctx.globalAlpha = 1;

      // Caustics inside the window (Day, Sunset): fainter in the outer ring, so the net fades out
      // toward the rim instead of stopping at a hard edge.
      const ca = L.num('causticWindowAlpha', YS);
      if (ca > 0.002 && f.quality > 0.7) {
        const { cx, cy, rx, ry } = windowGeom();
        const bounds = { x: cx - rx * 1.2, y: 0, w: rx * 2.4, h: cy + ry * 1.2 };
        const tint = causticTintAt(L, YS);
        const [rs, , rw, ra] = BANDS[RIM_BAND];
        const [cs, , cw, caAmp] = BANDS[CORE_BAND];
        drawCaustics(ctx, () => traceBand(ctx, RIM_BAND, rs, t * rw, ra), bounds, t, tint, ca * 0.4, 0.7);
        drawCaustics(ctx, () => traceBand(ctx, CORE_BAND, cs, t * cw, caAmp), bounds, t, tint, ca * 0.6, 0.7);
      }

      // Sun (Sunset) and the real moon (Midnight), wobbling with the surface.
      const wobX = 1.5 * Math.sin((TAU * t) / 7.3 + ph[3]);
      const wobY = 1.0 * Math.sin((TAU * t) / 11.1 + ph[7]);
      const sunW = modeWeight(L, 'sunset', YS);
      const moonW = modeWeight(L, 'midnight', YS);
      const disc = L.color('disc', YS);
      if (sunW > 0.01) {
        // A low sun near the window's edge, flattened by refraction; added light so it reads
        // against the gold window it shares a color with.
        const r = phone ? 11 : 15;
        const x = 0.7 * w + wobX;
        const y = (phone ? 0.048 : 0.036) * h + wobY;
        const sq = 0.8 + 0.04 * Math.sin((TAU * t) / 7.3);
        ctx.fillStyle = disc;
        ctx.globalCompositeOperation = 'lighter';
        ctx.globalAlpha = 0.035 * sunW;
        ellipse(ctx, x, y, r * 5.5, r * 3.6);
        ctx.globalAlpha = 0.05 * sunW;
        ellipse(ctx, x, y, r * 2.6, r * 1.9);
        ctx.globalCompositeOperation = 'source-over';
        ctx.globalAlpha = L.num('discAlpha', YS) * sunW;
        ellipse(ctx, x, y, r * (1 + 0.03 * Math.sin((TAU * t) / 11.1)), r * sq);
        ctx.globalCompositeOperation = 'lighter';
        ctx.globalAlpha = 0.18 * sunW;
        ellipse(ctx, x, y, r * (1 + 0.03 * Math.sin((TAU * t) / 11.1)), r * sq);
        ctx.globalCompositeOperation = 'source-over';
        ctx.globalAlpha = 1;
      }
      if (moonW > 0.01) {
        // On a phone it sits right of the Dynamic Island (which spans about x 34-66%, y < 48px).
        const r = phone ? 10.5 : 12;
        const x = moonX() * w + wobX;
        const y = (phone ? 0.066 : 0.036) * h + wobY;
        ctx.fillStyle = disc;
        ctx.globalAlpha = 0.022 * moonW;
        ellipse(ctx, x, y, r * 5, r * 4.2);
        ctx.globalAlpha = 0.028 * moonW;
        ellipse(ctx, x, y, r * 3.2, r * 2.8);
        ctx.globalAlpha = 0.035 * moonW;
        ellipse(ctx, x, y, r * 1.9, r * 1.8);
        // Earthshine keeps the whole disc faintly present on a thin crescent.
        ctx.globalAlpha = 0.15 * moonW;
        ellipse(ctx, x, y, r, r);
        ctx.globalAlpha = 1;
        ctx.save();
        ctx.translate(x, y);
        ctx.scale(1 + 0.025 * Math.sin((TAU * t) / 7.3 + 0.6), 1 - 0.025 * Math.sin((TAU * t) / 7.3 + 0.6));
        drawMoon(ctx, 0, 0, r, phase, disc, L.num('discAlpha', YS) * moonW);
        ctx.restore();
      }
      ctx.restore();

      // Light shafts fanning down from the window.
      const count = Math.max(0, L.num('rayCount', YS));
      const rayA = L.num('rayAlpha', YS) * (1 + 0.2 * shaftBoost);
      if (count < 0.05 || rayA < 0.002) return;
      const tilt = L.num('rayTiltDeg', YS) * DEG;
      const dayW = modeWeight(L, 'day', YS);
      const ox = dayW * 0.5 * w + sunW * 0.7 * w + moonW * moonX() * w;
      const spreadPx = (dayW * 0.82 + sunW * 0.5 + moonW * 0.22) * 0.38 * w * 2;
      const sW = Math.max(w, 0.75 * h);
      const sprite = shaftSprite(L.color('ray', YS));
      const pb = f.parallax(0.5);
      ctx.save();
      ctx.globalCompositeOperation = night > 0.5 ? 'lighter' : 'screen';
      const n = Math.ceil(count);
      for (let i = 0; i < n && i < shafts.length; i++) {
        const s = shafts[i];
        const frac = i < Math.floor(count) ? 1 : count - Math.floor(count);
        const off = (i + 0.5) / Math.max(1, count) - 0.5 + s.spread / Math.max(1, count);
        const x0 = ox + off * spreadPx + pb.x;
        const y0 = (phone ? -0.01 : -0.03) * h + pb.y;
        const sway = 3 * DEG * Math.sin((TAU * t) / 20 + s.phase);
        const ang = tilt - off * 16 * DEG + sway;
        const len = s.len * h;
        const bw = s.width * (0.075 + 0.025 * dayW) * sW * (1 + 0.3 * moonW);
        ctx.save();
        ctx.translate(x0, y0);
        ctx.rotate(ang);
        ctx.globalAlpha = Math.min(1, rayA * s.alpha * frac);
        ctx.drawImage(sprite, -bw / 2, 0, bw, len);
        ctx.restore();
      }
      ctx.restore();
    },
  };
}

function ellipse(ctx: CanvasRenderingContext2D, x: number, y: number, rx: number, ry: number): void {
  ctx.beginPath();
  ctx.ellipse(x, y, rx, ry, 0, 0, TAU);
  ctx.fill();
}
