/**
 * The Guardian: a humpback (Megaptera novaeangliae) that crosses the whale lane now and then.
 * A presence, not a character: enormous, slow, fogged into the far water, and without an eye.
 *
 * The body hangs on a 12-node spine carrying a travelling wave (still at the head, 0.06L at the
 * fluke, one stroke every 6s). The outline is built from a dorsal and a ventral width profile:
 * a blunt head with six rostrum tubercles, the hump and small dorsal fin, a crescent fluke that
 * flexes against the stroke, and long scalloped pectoral fins that paddle slowly.
 *
 * Drawn in CSS px into the engine's half-resolution far buffer, behind the ruins shelf. By day it
 * carries caustic dapple on its back, at sunset a warm dorsal rim, and at midnight it is seen
 * almost only through the plankton it disturbs and the constellation on its back.
 */
import type { LightingMode } from '../../types/sanctuary';
import type { Lighting, WhaleEntity, WhaleInit, WorldFrame } from '../types';
import { C, adjustOK, mixOK, toLab } from '../palette';
import { glowSprite } from '../light';
import { hashString, mulberry32, range, valueNoise1D, type Rand } from '../rng';
import { art, drawArt, sceneTint, tinted } from '../art';

const TAU = Math.PI * 2;
const DEG = Math.PI / 180;

/** Spine nodes from the rostrum to the fluke insertion. */
const NODES = 12;
/** Rostrum to fluke insertion as a share of the whole length; the fluke reaches the rest. */
const BODY = 0.85;
/** How far the blunt head reaches ahead of the first spine node (share of L). */
const NOSE = 0.018;
/** Rearmost reach of the fluke tips behind the head node (share of L). */
const REACH = 0.96;
/** One fluke stroke, seconds. */
const STROKE = 6;
/** Body wave number, radians per body length (a wavelength of almost two body lengths). */
const WAVE_K = TAU * 0.55;
/** Heave of the fluke insertion, share of L. */
const HEAVE = 0.06;

const FIN_LEN = 1 / 3;
const FIN_ROOT_S = 0.255;
const FIN_ANGLE = 40 * DEG;
const FIN_PADDLE = 8 * DEG;
const FIN_PERIOD = 9;

const SIZE_DESKTOP = 0.55;
const SIZE_PHONE = 1.3;
const CROSS_DESKTOP = 80;
const CROSS_PHONE = 50;
/** Seconds of ease-in and ease-out at the ends of a crossing, and the speed it eases from. */
const EASE = 6;
const EASE_FLOOR = 0.25;
/** The crossing rises 3% of the viewport height along a gentle arc. */
const RISE = 0.03;
/** How much the water fogs her whale picture (it swims far behind everything). */
const PICTURE_FOG = 0.2;
/** Off-screen distance at the start and end of a crossing, px. */
const MARGIN = 30;
const PARALLAX = 1.5;
/** Bubbles are drawn on the engine's bubble layer, which has its own parallax. */
const BUBBLE_PARALLAX = 6;

const SAMPLES = 80;
const SPARK_MAX = 120;
const SPARK_LIFE = 1.6;
/** Sparks per second per unit of summed outline score (px/s of push into the water). */
const SPARK_GAIN = 0.42;
/** Exponent that evens out where along the outline the sparks appear. */
const SPARK_SOFTEN = 0.6;
const EXCITE_R = 30;
const EXHALE_PUFFS = 4;
const EXHALE_GAP = 0.32;
const HIT_PAD = 12;

/** The ventral countershade is 8% lighter than the fill. */
const BELLY_LIGHTER = 0.08;
const PLEATS = 8;
const PLEAT_ALPHA = 0.3;
const RIM_ALPHA = 0.45;
const STAR_ALPHA = 0.35;
/** Caustic dapple on the back by day (peak alpha of the brightest filaments). */
const CAUSTIC_ALPHA = 0.1;
const CAUSTIC_SQUASH = 0.62;
/** Two copies of the dapple tile drifting across each other: speed px/s, heading, scale, share. */
const CAUSTIC_COPIES: readonly (readonly [number, number, number, number])[] = [
  [6, 22 * DEG, 0.8, 0.55],
  [9, 158 * DEG, 1.05, 0.45],
];
/** Nested bands down from the dorsal ridge [depth as a share of the dorsal height, alpha share]. */
const CAUSTIC_BANDS: [number, number][] = [
  [0.14, 0.26],
  [0.28, 0.24],
  [0.42, 0.2],
  [0.56, 0.15],
  [0.7, 0.1],
  [0.84, 0.05],
];

const CAP_N = 11;
const FIN_LE_N = 52;
const FIN_TE_N = 22;
const FIN_N = FIN_LE_N + FIN_TE_N + 2;
const FLUKE_SEG = 10;
const FLUKE_N = FLUKE_SEG * 4;

const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);
/** Distance covered x seconds into an ease of length E, from EASE_FLOOR speed up to full. */
function easeRamp(x: number, E: number): number {
  const g0 = EASE_FLOOR;
  return g0 * x + (1 - g0) * (0.5 * x - ((0.5 * E) / Math.PI) * Math.sin((Math.PI * x) / E));
}
const smooth = (a: number, b: number, x: number) => {
  const t = clamp01((x - a) / (b - a));
  return t * t * (3 - 2 * t);
};

// ---------------------------------------------------------------------------
// Profiles (shares of the whole length L, measured from the spine)
// ---------------------------------------------------------------------------

/** Monotone cubic (Fritsch-Carlson) through key points, so profiles never overshoot. */
function monotone(keys: [number, number][]): (s: number) => number {
  const n = keys.length;
  const xs = keys.map((k) => k[0]);
  const ys = keys.map((k) => k[1]);
  const d: number[] = [];
  for (let i = 0; i < n - 1; i++) d.push((ys[i + 1] - ys[i]) / (xs[i + 1] - xs[i]));
  const m: number[] = new Array<number>(n);
  m[0] = d[0];
  m[n - 1] = d[n - 2];
  for (let i = 1; i < n - 1; i++) m[i] = d[i - 1] * d[i] <= 0 ? 0 : (d[i - 1] + d[i]) / 2;
  for (let i = 0; i < n - 1; i++) {
    if (d[i] === 0) {
      m[i] = 0;
      m[i + 1] = 0;
      continue;
    }
    const a = m[i] / d[i];
    const b = m[i + 1] / d[i];
    const q = a * a + b * b;
    if (q > 9) {
      const k = 3 / Math.sqrt(q);
      m[i] = k * a * d[i];
      m[i + 1] = k * b * d[i];
    }
  }
  return (s) => {
    if (s <= xs[0]) return ys[0];
    if (s >= xs[n - 1]) return ys[n - 1];
    let i = 0;
    while (s > xs[i + 1]) i++;
    const hh = xs[i + 1] - xs[i];
    const t = (s - xs[i]) / hh;
    const t2 = t * t;
    const t3 = t2 * t;
    return (
      (2 * t3 - 3 * t2 + 1) * ys[i] +
      (t3 - 2 * t2 + t) * hh * m[i] +
      (-2 * t3 + 3 * t2) * ys[i + 1] +
      (t3 - t2) * hh * m[i + 1]
    );
  };
}

/** Back of the whale above the spine: flat rostrum, rising behind the blowhole, long taper. */
const dorsalBase = monotone([
  [0, 0.022],
  [0.05, 0.034],
  [0.12, 0.047],
  [0.18, 0.06],
  [0.26, 0.075],
  [0.36, 0.085],
  [0.46, 0.085],
  [0.55, 0.079],
  [0.63, 0.071],
  [0.71, 0.059],
  [0.79, 0.046],
  [0.87, 0.032],
  [0.94, 0.02],
  [1, 0.011],
]);

/** Underside below the spine: protruding lower jaw, deep pleated throat, keeled tail stock. */
const ventralBase = monotone([
  [0, 0.034],
  [0.04, 0.054],
  [0.1, 0.078],
  [0.18, 0.097],
  [0.28, 0.109],
  [0.38, 0.107],
  [0.48, 0.098],
  [0.58, 0.084],
  [0.68, 0.067],
  [0.78, 0.05],
  [0.88, 0.033],
  [0.95, 0.021],
  [1, 0.011],
]);

/** Six knobs along the top of the rostrum (centre, height), shares of L. */
const TUBERCLES: [number, number][] = [
  [0.017, 0.0044],
  [0.035, 0.005],
  [0.053, 0.0042],
  [0.071, 0.0048],
  [0.089, 0.0039],
  [0.107, 0.0034],
];
const TUBERCLE_HALF = 0.0068;

function dorsalAt(s: number): number {
  let d = dorsalBase(s);
  for (const [c, hgt] of TUBERCLES) {
    const u = (s - c) / TUBERCLE_HALF;
    if (u > -1 && u < 1) d += hgt * Math.sqrt(1 - u * u);
  }
  // The hump the small dorsal fin sits on.
  const hu = (s - 0.62) / 0.11;
  if (hu > -1 && hu < 1) d += 0.006 * (0.5 + 0.5 * Math.cos(Math.PI * hu));
  // Dorsal fin: a long low leading edge, a short falcate trailing edge.
  const fu = (s - 0.592) / 0.078;
  if (fu > 0 && fu < 1) d += fu < 0.74 ? 0.019 * Math.pow(fu / 0.74, 1.7) : 0.019 * Math.sqrt(1 - ((fu - 0.74) / 0.26) ** 2);
  return d;
}

/** Body sample positions s (0 rostrum .. 1 fluke insertion), dense where the outline has detail. */
const GRID: Float64Array = (() => {
  const g: number[] = [];
  const seg = (a: number, b: number, step: number) => {
    const n = Math.round((b - a) / step);
    for (let i = 0; i < n; i++) g.push(a + ((b - a) * i) / n);
  };
  seg(0, 0.14, 0.0035);
  seg(0.14, 0.57, 0.02);
  seg(0.57, 0.69, 0.005);
  seg(0.69, 1, 0.02);
  g.push(1);
  return Float64Array.from(g);
})();
const NG = GRID.length;
const DORSAL = Float64Array.from(GRID, dorsalAt);
const VENTRAL = Float64Array.from(GRID, (s) => ventralBase(s));

function gridIndex(s: number): number {
  let j = 0;
  while (j < NG - 2 && GRID[j + 1] <= s) j++;
  return j;
}

const STRIP_END = gridIndex(0.72);
const CAUSTIC_A = gridIndex(0.02);
const CAUSTIC_B = gridIndex(0.93);
const RIM_END = gridIndex(0.95);
const BLOWHOLE = gridIndex(0.175);
const BELLY_GIFT = gridIndex(0.44);

/** Depth of the countershade strip above the ventral edge, as a share of the ventral height. */
function stripDepth(s: number): number {
  return 0.6 * (0.55 + 0.45 * smooth(0, 0.1, s)) * (1 - smooth(0.4, 0.72, s));
}
const STRIP = Float64Array.from(GRID, (s) => stripDepth(s));

/** Outline layout: dorsal edge head to tail, fluke, ventral edge tail to head, head cap. */
const O_DORSAL = 0;
const O_FLUKE = NG;
const O_VENTRAL = NG + FLUKE_N;
const O_CAP = O_VENTRAL + NG;
const NO = O_CAP + CAP_N;
const P_NEAR = NO;
const P_FAR = NO + FIN_N;
const NP = NO + 2 * FIN_N;

// ---------------------------------------------------------------------------
// Caustic dapple (one small seamless tile, made once)
// ---------------------------------------------------------------------------

let causticCanvas: HTMLCanvasElement | null = null;
const causticPatterns = new WeakMap<CanvasRenderingContext2D, CanvasPattern>();
const CAUSTIC_TILE = 160;

/** Sine-interference field raised to the 6th power: thin bright filaments around dark cells. */
function causticTile(): HTMLCanvasElement {
  if (causticCanvas) return causticCanvas;
  const S = CAUSTIC_TILE;
  const c = document.createElement('canvas');
  c.width = c.height = S;
  const g = c.getContext('2d')!;
  const img = g.createImageData(S, S);
  const k = TAU / S;
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      // Integer wave numbers only, so the tile repeats without a seam.
      const a = Math.sin(k * (2 * x + y) + 1.3 * Math.sin(k * (x - 2 * y)));
      const b = Math.sin(k * (-x + 3 * y) + 1.1 * Math.sin(k * (3 * x + y) + 0.7));
      const e = Math.sin(k * (3 * x - y) + 0.9 * Math.sin(k * (-2 * x + 2 * y) + 2.1));
      const v = (a + b + e) / 3;
      const lum = Math.pow(1 - Math.min(1, Math.abs(v)), 6);
      const i = (y * S + x) * 4;
      img.data[i] = 255;
      img.data[i + 1] = 255;
      img.data[i + 2] = 255;
      img.data[i + 3] = Math.round(255 * lum);
    }
  }
  g.putImageData(img, 0, 0);
  causticCanvas = c;
  return c;
}

function causticPattern(ctx: CanvasRenderingContext2D): CanvasPattern | null {
  const hit = causticPatterns.get(ctx);
  if (hit) return hit;
  const p = ctx.createPattern(causticTile(), 'repeat');
  if (p) causticPatterns.set(ctx, p);
  return p;
}

/** How much of mode `m` shows at height y (1 when settled in it, blending during a descent). */
function modeWeight(L: Lighting, m: LightingMode, y: number): number {
  const p = L.progressAt(y);
  return (L.mode === m ? p : 0) + (L.from === m ? 1 - p : 0);
}

// ---------------------------------------------------------------------------
// Constellation
// ---------------------------------------------------------------------------

interface Star {
  /** Grid segment and fraction along the body. */
  j: number;
  fj: number;
  /** Depth below the dorsal ridge, as a share of the dorsal height. */
  depth: number;
  big: boolean;
  /** Twinkle: noise offset and rate. */
  off: number;
  rate: number;
}

function placeStar(u: number, v: number, big: boolean, rand: Rand): Star {
  const s = 0.06 + clamp01(u) * 0.84;
  const j = gridIndex(s);
  return {
    j,
    fj: clamp01((s - GRID[j]) / (GRID[j + 1] - GRID[j])),
    depth: 0.07 + clamp01(v) * 0.8,
    big,
    off: range(rand, 0, 200),
    rate: range(rand, 0.55, 1.1),
  };
}

/**
 * Radius's points if given (the first four are the brighter 1.6px stars), otherwise 24 seeded
 * points strung along the dorsal ridge: 20 of 1px and 4 of 1.6px.
 */
function makeConstellation(points: [number, number][] | null, seed: number): Star[] {
  const rand = mulberry32((seed ^ hashString('whale:constellation')) >>> 0);
  if (points && points.length > 0) return points.map(([u, v], i) => placeStar(u, v, i < 4, rand));
  const n = 24;
  const stars: Star[] = [];
  const big = new Set<number>();
  while (big.size < 4) big.add(Math.floor(range(rand, 1, n - 1)));
  // Stratified along the ridge, with uneven gaps so it reads as stars, not stitching.
  for (let i = 0; i < n; i++) {
    const u = (i + range(rand, 0.1, 0.9)) / n;
    const v = 0.03 + 0.42 * Math.pow(rand(), 1.6);
    stars.push(placeStar(u, v, big.has(i), rand));
  }
  return stars;
}

// ---------------------------------------------------------------------------
// The whale
// ---------------------------------------------------------------------------

export function createWhale(init: WhaleInit): WhaleEntity {
  let w = init.w;
  let h = init.h;
  let phone = init.phone;
  const seed = init.seed >>> 0;
  const rand = mulberry32((seed ^ hashString('whale:wake')) >>> 0);
  const stars = makeConstellation(init.constellation, seed);
  const twinkle = valueNoise1D(mulberry32((seed ^ hashString('whale:twinkle')) >>> 0), 1);

  let L = 0;
  let T = CROSS_DESKTOP;
  let active = false;
  let built = false;
  let dir: 1 | -1 = 1;
  let tau = 0;
  let pass = 0;
  let laneY = 0.46;
  let wavePhase = 0;
  let finPhase = 0;
  let clock = 0;

  // Head node (pre-parallax CSS px) and the body frame's axes in screen space.
  let hx = 0;
  let hy = 0;
  let bx = -1;
  let by = 0;
  let vx = 0;
  let vy = 1;
  const par = { x: 0, y: 0 };

  // Body-frame spine nodes.
  const nodeX = new Float64Array(NODES);
  const nodeY = new Float64Array(NODES);
  // World-space spine samples and ventral normals on the grid.
  const gx = new Float64Array(NG);
  const gy = new Float64Array(NG);
  const gnx = new Float64Array(NG);
  const gny = new Float64Array(NG);
  // Perimeter: outline (body + fluke), near fin, far fin.
  const px = new Float64Array(NP);
  const py = new Float64Array(NP);
  const bbox = { x0: 0, y0: 0, x1: 0, y1: 0 };
  const polySign = [1, 1, 1];

  // Wake sampling.
  const sIdx = new Int32Array(SAMPLES);
  const sPoly = new Uint8Array(SAMPLES);
  const prevX = new Float64Array(SAMPLES);
  const prevY = new Float64Array(SAMPLES);
  const score = new Float64Array(SAMPLES);
  const snx = new Float64Array(SAMPLES);
  const sny = new Float64Array(SAMPLES);
  const srx = new Float64Array(SAMPLES);
  const sry = new Float64Array(SAMPLES);
  let prevHx = 0;
  let prevHy = 0;
  let prevValid = false;
  let sparkAcc = 0;
  let exciteCursor = 0;

  // Exhale: four puffs of three bubbles, spaced so they rise as a column rather than a clump.
  let exhaleAge = -1;
  let puffs = 0;

  const scratch = new Float64Array(4);
  /** The draw colours, kept while the lane colour and the water stay the same. */
  const tones = { fill: '', water: '', belly: '', pleat: '', nearFin: '', farFin: '' };

  function setSize() {
    L = (phone ? SIZE_PHONE : SIZE_DESKTOP) * w;
    T = phone ? CROSS_PHONE : CROSS_DESKTOP;
  }
  setSize();

  /** Fraction of the crossing covered after `t` seconds: sine ease in and out over EASE. */
  function travel(t: number): number {
    const E = Math.min(EASE, T / 2);
    const g0 = EASE_FLOOR;
    const total = T - E * (1 - g0);
    let d: number;
    if (t <= 0) d = 0;
    else if (t < E) d = easeRamp(t, E);
    else if (t < T - E) d = easeRamp(E, E) + (t - E);
    else if (t < T) d = total - easeRamp(T - t, E);
    else d = total;
    return d / total;
  }

  /** Catmull-Rom through the spine nodes: position and unit tangent in the body frame. */
  function spineAt(s: number, o: Float64Array) {
    const u = clamp01(s) * (NODES - 1);
    const i = Math.min(NODES - 2, Math.floor(u));
    const t = u - i;
    const x1 = nodeX[i];
    const y1 = nodeY[i];
    const x2 = nodeX[i + 1];
    const y2 = nodeY[i + 1];
    const x0 = i > 0 ? nodeX[i - 1] : 2 * x1 - x2;
    const y0 = i > 0 ? nodeY[i - 1] : 2 * y1 - y2;
    const x3 = i < NODES - 2 ? nodeX[i + 2] : 2 * x2 - x1;
    const y3 = i < NODES - 2 ? nodeY[i + 2] : 2 * y2 - y1;
    const t2 = t * t;
    const t3 = t2 * t;
    o[0] = 0.5 * (2 * x1 + (-x0 + x2) * t + (2 * x0 - 5 * x1 + 4 * x2 - x3) * t2 + (-x0 + 3 * x1 - 3 * x2 + x3) * t3);
    o[1] = 0.5 * (2 * y1 + (-y0 + y2) * t + (2 * y0 - 5 * y1 + 4 * y2 - y3) * t2 + (-y0 + 3 * y1 - 3 * y2 + y3) * t3);
    const dx = 0.5 * (-x0 + x2 + 2 * (2 * x0 - 5 * x1 + 4 * x2 - x3) * t + 3 * (-x0 + 3 * x1 - 3 * x2 + x3) * t2);
    const dy = 0.5 * (-y0 + y2 + 2 * (2 * y0 - 5 * y1 + 4 * y2 - y3) * t + 3 * (-y0 + 3 * y1 - 3 * y2 + y3) * t2);
    const len = Math.sqrt(dx * dx + dy * dy) || 1;
    o[2] = dx / len;
    o[3] = dy / len;
  }

  /** Writes a body-frame point (x toward the tail, y ventral) into the perimeter in screen px. */
  function put(i: number, x: number, y: number) {
    px[i] = hx + bx * x + vx * y;
    py[i] = hy + by * x + vy * y;
  }

  /** Builds this frame's pose: spine, outline, fluke and fins. */
  function build(t: number) {
    const p = travel(tau);
    const span = w + (NOSE + REACH) * L + 2 * MARGIN;
    const startX = dir === 1 ? -MARGIN - NOSE * L : w + MARGIN + NOSE * L;
    hx = startX + dir * span * p;
    hy = h * (laneY - RISE * (2 * p - p * p));
    const pitch = Math.atan((h * RISE * (2 - 2 * p)) / span);
    const cp = Math.cos(pitch);
    const sp = Math.sin(pitch);
    bx = -dir * cp;
    by = sp;
    vx = dir * sp;
    vy = cp;

    // Travelling wave: still at the head, HEAVE at the fluke, one stroke every STROKE seconds.
    const Lb = BODY * L;
    const om = (TAU / STROKE) * t + wavePhase;
    for (let i = 0; i < NODES; i++) {
      const s = i / (NODES - 1);
      // Rigid forward of the flippers; the motion gathers in the tail stock, so the body heaves
      // rather than snaking.
      const env = s <= 0.28 ? 0 : Math.pow((s - 0.28) / 0.72, 2.3);
      nodeX[i] = s * Lb;
      nodeY[i] = HEAVE * L * env * Math.sin(om - WAVE_K * s);
    }

    // Spine samples, body outline edges.
    const o = scratch;
    for (let j = 0; j < NG; j++) {
      spineAt(GRID[j], o);
      const sx = o[0];
      const sy = o[1];
      const nx = -o[3];
      const ny = o[2];
      gx[j] = hx + bx * sx + vx * sy;
      gy[j] = hy + by * sx + vy * sy;
      gnx[j] = bx * nx + vx * ny;
      gny[j] = by * nx + vy * ny;
      const D = DORSAL[j] * L;
      const V = VENTRAL[j] * L;
      put(O_DORSAL + j, sx - nx * D, sy - ny * D);
      put(O_VENTRAL + (NG - 1 - j), sx + nx * V, sy + ny * V);
    }

    // Blunt head: the lower jaw reaches a little further than the rostrum.
    spineAt(0, o);
    {
      const sx = o[0];
      const sy = o[1];
      const tx = o[2];
      const ty = o[3];
      const nx = -ty;
      const ny = tx;
      const D = DORSAL[0] * L;
      const V = VENTRAL[0] * L;
      const ry = (D + V) / 2;
      const yc = (V - D) / 2;
      for (let k = 0; k < CAP_N; k++) {
        const a = Math.PI / 2 - ((k + 1) / (CAP_N + 1)) * Math.PI;
        const rx = NOSE * L * (0.95 + 0.22 * Math.sin(a));
        const ca = Math.cos(a);
        const lx = -rx * Math.pow(ca, 0.8);
        const ly = yc + ry * Math.sin(a);
        put(O_CAP + k, sx + tx * lx + nx * ly, sy + ty * lx + ny * ly);
      }
    }

    // Fluke: a crescent in three-quarter view. It pivots at the insertion, following the tail
    // stock only part of the way, and its lobes trail the stroke.
    spineAt(1, o);
    {
      const heaveV = Math.cos(om - WAVE_K);
      const flex = -0.012 * heaveV;
      const fa = 0.45 * Math.atan2(o[3], o[2]) - 0.05 * heaveV;
      const tx = Math.cos(fa);
      const ty = Math.sin(fa);
      const nx = -ty;
      const ny = tx;
      flk.ox = o[0];
      flk.oy = o[1];
      flk.tx = tx;
      flk.ty = ty;
      flk.nx = nx;
      flk.ny = ny;
      flk.k = O_FLUKE;
      const D = DORSAL[NG - 1];
      const V = VENTRAL[NG - 1];
      // Pointed tips are the rearmost points; the notch sits forward of them, and each trailing
      // edge runs in a shallow S (convex by the notch, concave toward the tip), so it reads as a
      // swept crescent rather than a fish's caudal fin. The far (upper) lobe is foreshortened.
      const ua = 0.112;
      const ub = -0.044 + flex;
      const na = 0.08;
      const nb = 0.003 + flex * 0.2;
      const la = 0.113;
      const lb = 0.07 + flex * 1.1;
      // Upper leading edge, upper trailing edge to the notch, lower trailing edge, lower leading edge.
      flukeCubic(0, -D, 0.016, -0.024, 0.064, -0.042 + flex * 0.6, ua, ub, false, false);
      flukeCubic(ua, ub, 0.097, -0.031 + flex * 0.7, 0.09, -0.01 + flex * 0.35, na, nb, false, true);
      flukeCubic(na, nb, 0.091, 0.018 + flex * 0.35, 0.097, 0.052 + flex * 0.8, la, lb, false, true);
      flukeCubic(la, lb, 0.064, 0.066 + flex * 0.6, 0.016, 0.034, 0, V, true, false);
    }

    // Pectoral fins: near (over the flank) and far (behind the body, mostly hidden).
    const paddle = (TAU * t) / FIN_PERIOD + finPhase;
    buildFin(P_NEAR, 0.42, FIN_ANGLE + FIN_PADDLE * Math.sin(paddle), 0.11 + 0.035 * Math.cos(paddle), 1);
    buildFin(P_FAR, 0.12, FIN_ANGLE + 12 * DEG + FIN_PADDLE * Math.sin(paddle - 0.7), 0.1 + 0.035 * Math.cos(paddle - 0.7), 0.94);

    // Bounding box and winding of each polygon.
    let x0 = Infinity;
    let y0 = Infinity;
    let x1 = -Infinity;
    let y1 = -Infinity;
    for (let i = 0; i < NP; i++) {
      if (px[i] < x0) x0 = px[i];
      if (px[i] > x1) x1 = px[i];
      if (py[i] < y0) y0 = py[i];
      if (py[i] > y1) y1 = py[i];
    }
    bbox.x0 = x0;
    bbox.y0 = y0;
    bbox.x1 = x1;
    bbox.y1 = y1;
    polySign[0] = areaSign(0, NO);
    polySign[1] = areaSign(P_NEAR, FIN_N);
    polySign[2] = areaSign(P_FAR, FIN_N);
    built = true;
  }

  /** The fluke's frame for flukeCubic (set by build), and the next perimeter index it writes. */
  const flk = { ox: 0, oy: 0, tx: 0, ty: 0, nx: 0, ny: 0, k: 0 };

  /** One cubic edge of the fluke; `serrate` adds the humpback's fine scalloping along the trailing edge. */
  function flukeCubic(
    a0: number, b0: number, a1: number, b1: number, a2: number, b2: number, a3: number, b3: number,
    last: boolean, serrate: boolean,
  ) {
    const { ox, oy, tx, ty, nx, ny } = flk;
    for (let i = 1; i <= FLUKE_SEG; i++) {
      const u = last ? i / (FLUKE_SEG + 1) : i / FLUKE_SEG;
      const m = 1 - u;
      const ca = m * m * m;
      const cb = 3 * m * m * u;
      const cc = 3 * m * u * u;
      const cd = u * u * u;
      const fa2 = ca * a0 + cb * a1 + cc * a2 + cd * a3 + (serrate ? 0.0024 * Math.abs(Math.sin(u * Math.PI * 4.5)) * Math.sin(u * Math.PI) : 0);
      const fb2 = ca * b0 + cb * b1 + cc * b2 + cd * b3;
      put(flk.k++, ox + (tx * fa2 + nx * fb2) * L, oy + (ty * fa2 + ny * fb2) * L);
    }
  }

  /** The flipper being built (set by buildFin): root, axes, length, bend and widest chord. */
  const fin = { rx: 0, ry: 0, dx: 0, dy: 0, lx: 0, ly: 0, Lf: 0, bend: 0, chordMax: 0 };

  function finChord(u: number): number {
    const root = 0.68 + 0.32 * smooth(0, 0.3, u);
    const tip = u > 0.32 ? Math.pow(Math.max(0, 1 - ((u - 0.32) / 0.68) ** 1.6), 0.7) : 1;
    return fin.chordMax * root * tip;
  }

  /** Centreline: swept back a little, more so toward the tip. */
  function finCx(u: number): number {
    return fin.rx + fin.dx * u * fin.Lf - fin.lx * fin.bend * u * u * fin.Lf;
  }
  function finCy(u: number): number {
    return fin.ry + fin.dy * u * fin.Lf - fin.ly * fin.bend * u * u * fin.Lf;
  }

  /** One long scalloped flipper (a third of the body length) rooted low on the flank. */
  function buildFin(at: number, rootDepth: number, theta: number, bend: number, scale: number) {
    const o = scratch;
    spineAt(FIN_ROOT_S, o);
    const j = gridIndex(FIN_ROOT_S);
    const V = VENTRAL[j] * L;
    const tx = o[2];
    const ty = o[3];
    const nx = -ty;
    const ny = tx;
    const rx = o[0] + nx * V * rootDepth + tx * 0.01 * L;
    const ry = o[1] + ny * V * rootDepth + ty * 0.01 * L;
    const ct = Math.cos(theta);
    const st = Math.sin(theta);
    // Along the fin, and its leading side (facing forward and down).
    const dx = tx * ct + nx * st;
    const dy = ty * ct + ny * st;
    const lx = -tx * st + nx * ct;
    const ly = -ty * st + ny * ct;
    const Lf = FIN_LEN * L * scale;
    const chordMax = 0.064 * L * scale;
    const scallop = 0.0046 * L * scale;
    fin.rx = rx;
    fin.ry = ry;
    fin.dx = dx;
    fin.dy = dy;
    fin.lx = lx;
    fin.ly = ly;
    fin.Lf = Lf;
    fin.bend = bend;
    fin.chordMax = chordMax;
    // A rounded root, slightly buried in the flank.
    const ch0 = finChord(0);
    let k = at;
    put(k++, rx - dx * 0.3 * ch0 + lx * 0.22 * ch0, ry - dy * 0.3 * ch0 + ly * 0.22 * ch0);
    for (let i = 0; i < FIN_LE_N; i++) {
      const u = i / (FIN_LE_N - 1);
      let le = 0.42 * finChord(u);
      // Tubercles on the leading edge, larger mid-fin, fading at the root and tip.
      if (u > 0.16 && u < 0.97) {
        const ph = ((u - 0.16) / 0.81) * 9;
        const fade = Math.sin(Math.PI * ((u - 0.16) / 0.81));
        le += scallop * Math.pow(Math.abs(Math.sin(Math.PI * ph)), 0.85) * (0.45 + 0.55 * fade);
      }
      put(k++, finCx(u) + lx * le, finCy(u) + ly * le);
    }
    for (let i = 0; i < FIN_TE_N; i++) {
      const u = 1 - (i + 1) / (FIN_TE_N + 1);
      const te = 0.58 * finChord(u);
      put(k++, finCx(u) - lx * te, finCy(u) - ly * te);
    }
    put(k++, rx - dx * 0.3 * ch0 - lx * 0.36 * ch0, ry - dy * 0.3 * ch0 - ly * 0.36 * ch0);
  }

  function areaSign(start: number, n: number): number {
    let a = 0;
    for (let i = 0; i < n; i++) {
      const p = start + i;
      const q = start + ((i + 1) % n);
      a += px[p] * py[q] - px[q] * py[p];
    }
    return a >= 0 ? 1 : -1;
  }

  /** Spreads the 80 wake samples over the perimeter by arc length (once per pass). */
  function chooseSamples() {
    const polys: [number, number][] = [
      [0, NO],
      [P_NEAR, FIN_N],
      [P_FAR, FIN_N],
    ];
    const lens = polys.map(([s, n]) => {
      let len = 0;
      for (let i = 0; i < n; i++) {
        const p = s + i;
        const q = s + ((i + 1) % n);
        len += Math.hypot(px[q] - px[p], py[q] - py[p]);
      }
      return len;
    });
    const total = lens[0] + lens[1] + lens[2];
    let k = 0;
    polys.forEach(([s, n], pi) => {
      const want = pi === 2 ? SAMPLES - k : Math.round((SAMPLES * lens[pi]) / total);
      const step = lens[pi] / want;
      let acc = 0;
      let next = step * 0.5;
      for (let i = 0; i < n && k < SAMPLES; i++) {
        const p = s + i;
        const q = s + ((i + 1) % n);
        const seg = Math.hypot(px[q] - px[p], py[q] - py[p]);
        while (acc + seg >= next && k < SAMPLES && next < lens[pi]) {
          sIdx[k] = (next - acc) / (seg || 1) < 0.5 ? p : q;
          sPoly[k] = pi;
          k++;
          next += step;
        }
        acc += seg;
      }
    });
    for (; k < SAMPLES; k++) {
      sIdx[k] = 0;
      sPoly[k] = 0;
    }
  }

  function savePrev() {
    for (let k = 0; k < SAMPLES; k++) {
      prevX[k] = px[sIdx[k]];
      prevY[k] = py[sIdx[k]];
    }
    prevHx = hx;
    prevHy = hy;
  }

  /** Midnight: sparks where the outline pushes hardest into the water, and plankton nearby wake. */
  function stirWater(f: WorldFrame) {
    const dt = f.dt;
    const night = f.lighting.biolum(clamp01(centreY() / h));
    if (!prevValid || dt <= 0 || night < 0.02) {
      savePrev();
      prevValid = true;
      sparkAcc = 0;
      return;
    }
    const vbx = (hx - prevHx) / dt;
    const vby = (hy - prevHy) / dt;
    let total = 0;
    let wsum = 0;
    for (let k = 0; k < SAMPLES; k++) {
      const i = sIdx[k];
      const x = px[i];
      const y = py[i];
      const vxk = (x - prevX[k]) / dt;
      const vyk = (y - prevY[k]) / dt;
      const poly = sPoly[k];
      const start = poly === 0 ? 0 : poly === 1 ? P_NEAR : P_FAR;
      const n = poly === 0 ? NO : FIN_N;
      const li = i - start;
      const a = start + ((li - 1 + n) % n);
      const b = start + ((li + 1) % n);
      const ex = px[b] - px[a];
      const ey = py[b] - py[a];
      const el = Math.sqrt(ex * ex + ey * ey) || 1;
      const nx = (polySign[poly] * ey) / el;
      const ny = (-polySign[poly] * ex) / el;
      const vn = vxk * nx + vyk * ny;
      const rx = vxk - vbx;
      const ry = vyk - vby;
      // Push into the water (the rostrum's bow) plus motion relative to the body (fluke, fin tips).
      let sc = Math.max(0, vn - 7) + 1.1 * Math.max(0, Math.sqrt(rx * rx + ry * ry) - 4);
      const sxs = x + par.x;
      const sys = y + par.y;
      if (sxs < -6 || sxs > w + 6 || sys < -6 || sys > h + 6) sc = 0;
      total += sc;
      // Sparks are placed by a softened weight, so the rostrum's bow and the flipper tips still
      // trace the shape beside the fluke, which pushes hardest.
      const wgt = sc > 0 ? Math.pow(sc, SPARK_SOFTEN) : 0;
      score[k] = wgt;
      wsum += wgt;
      snx[k] = nx;
      sny[k] = ny;
      srx[k] = rx;
      sry[k] = ry;
    }

    const rate = Math.min(SPARK_MAX, total * SPARK_GAIN) * night * Math.max(0.3, f.quality);
    sparkAcc = Math.min(4, sparkAcc + rate * dt);
    while (sparkAcc >= 1 && wsum > 0) {
      sparkAcc -= 1;
      let r = rand() * wsum;
      let k = 0;
      while (k < SAMPLES - 1 && r > score[k]) {
        r -= score[k];
        k++;
      }
      const i = sIdx[k];
      const off = range(rand, 0.5, 2.5);
      const push = range(rand, 2.5, 7);
      f.spark(
        px[i] + par.x + snx[k] * off + range(rand, -1.5, 1.5),
        py[i] + par.y + sny[k] * off + range(rand, -1.5, 1.5),
        snx[k] * push + srx[k] * 0.16 + range(rand, -1.5, 1.5),
        sny[k] * push + sry[k] * 0.16 + range(rand, -1.5, 1.5),
        SPARK_LIFE,
      );
    }

    // Plankton within 30px of the outline catch, a tenth of the samples each frame.
    for (let k = exciteCursor; k < SAMPLES; k += 10) {
      const i = sIdx[k];
      const sxs = px[i] + par.x;
      const sys = py[i] + par.y;
      if (sxs < -EXCITE_R || sxs > w + EXCITE_R || sys < -EXCITE_R || sys > h + EXCITE_R) continue;
      f.exciteAt(sxs, sys, EXCITE_R, 0.3 + 0.7 * Math.min(1, score[k] / 8));
    }
    exciteCursor = (exciteCursor + 1) % 10;
    savePrev();
  }

  /** Middle of the body's depth, a little behind the flippers. */
  function centreOffset(): number {
    return (VENTRAL[BELLY_GIFT] - DORSAL[BELLY_GIFT]) * 0.5 * L;
  }
  function centreY(): number {
    return gy[BELLY_GIFT] + gny[BELLY_GIFT] * centreOffset();
  }

  function updateExhale(f: WorldFrame) {
    if (exhaleAge < 0) return;
    exhaleAge += f.dt;
    const due = Math.min(EXHALE_PUFFS, 1 + Math.floor(exhaleAge / EXHALE_GAP));
    while (puffs < due) {
      const D = DORSAL[BLOWHOLE] * L * 0.85;
      const pw = f.parallax(PARALLAX);
      const pb = f.parallax(BUBBLE_PARALLAX);
      f.bubbles(gx[BLOWHOLE] - gnx[BLOWHOLE] * D + pw.x - pb.x, gy[BLOWHOLE] - gny[BLOWHOLE] * D + pw.y - pb.y, {
        count: 12 / EXHALE_PUFFS,
        spread: 2,
        speed: [24, 38],
        size: [2, 4.6],
        color: C.biolum,
      });
      puffs++;
    }
    if (puffs >= EXHALE_PUFFS) exhaleAge = -1;
  }

  // ---------------------------------------------------------------------------
  // Drawing
  // ---------------------------------------------------------------------------

  function tracePoly(ctx: CanvasRenderingContext2D, start: number, n: number) {
    ctx.moveTo(px[start], py[start]);
    for (let i = 1; i < n; i++) ctx.lineTo(px[start + i], py[start + i]);
    ctx.closePath();
  }

  /** The ventral countershade strip, chin to navel. */
  function traceStrip(ctx: CanvasRenderingContext2D) {
    for (let j = 0; j <= STRIP_END; j++) {
      const V = VENTRAL[j] * L;
      const x = gx[j] + gnx[j] * V;
      const y = gy[j] + gny[j] * V;
      if (j === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    for (let j = STRIP_END; j >= 0; j--) {
      const V = VENTRAL[j] * L;
      const c = V * (1 - STRIP[j]);
      ctx.lineTo(gx[j] + gnx[j] * c, gy[j] + gny[j] * c);
    }
    ctx.closePath();
  }

  /** Throat pleats: long grooves from the chin, the higher ones ending sooner. */
  function tracePleats(ctx: CanvasRenderingContext2D) {
    for (let p = 0; p < PLEATS; p++) {
      const q = (p + 0.5) / PLEATS;
      const s0 = 0.012 + 0.005 * p;
      const s1 = 0.52 - 0.2 * q;
      let first = true;
      for (let j = 0; j < NG && GRID[j] <= s1; j++) {
        if (GRID[j] < s0) continue;
        const V = VENTRAL[j] * L;
        const c = V * (1 - STRIP[j] * q * 0.94);
        const x = gx[j] + gnx[j] * c;
        const y = gy[j] + gny[j] * c;
        if (first) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
        first = false;
      }
    }
  }

  /** A band of the back from the dorsal ridge down to `q` of the dorsal height. */
  function traceBand(ctx: CanvasRenderingContext2D, q: number) {
    for (let j = CAUSTIC_A; j <= CAUSTIC_B; j++) {
      const i = O_DORSAL + j;
      if (j === CAUSTIC_A) ctx.moveTo(px[i], py[i]);
      else ctx.lineTo(px[i], py[i]);
    }
    for (let j = CAUSTIC_B; j >= CAUSTIC_A; j--) {
      const D = DORSAL[j] * L * (1 - q);
      ctx.lineTo(gx[j] - gnx[j] * D, gy[j] - gny[j] * D);
    }
    ctx.closePath();
  }

  function drawCaustics(ctx: CanvasRenderingContext2D, t: number, alpha: number) {
    const pat = causticPattern(ctx);
    if (!pat) return;
    ctx.globalCompositeOperation = 'lighter';
    ctx.fillStyle = pat;
    for (let bi = 0; bi < CAUSTIC_BANDS.length; bi++) {
      const q = CAUSTIC_BANDS[bi][0];
      const bandShare = CAUSTIC_BANDS[bi][1];
      ctx.save();
      ctx.beginPath();
      traceBand(ctx, q);
      ctx.clip();
      for (let ci = 0; ci < CAUSTIC_COPIES.length; ci++) {
        const cp = CAUSTIC_COPIES[ci];
        const speed = cp[0];
        const head = cp[1];
        const sc = cp[2];
        const share = cp[3];
        const ox = Math.cos(head) * speed * t;
        const oy = Math.sin(head) * speed * t;
        ctx.save();
        ctx.translate(ox, oy);
        // Flattened a little, as if lying across the curve of the back.
        const sy = sc * CAUSTIC_SQUASH;
        ctx.scale(sc, sy);
        ctx.globalAlpha = alpha * share * 2 * bandShare;
        ctx.fillRect((bbox.x0 - ox) / sc - 2, (bbox.y0 - oy) / sy - 2, (bbox.x1 - bbox.x0) / sc + 4, (bbox.y1 - bbox.y0) / sy + 4);
        ctx.restore();
      }
      ctx.restore();
    }
    ctx.globalCompositeOperation = 'source-over';
    ctx.globalAlpha = 1;
  }

  /** Sunset: a 1px warm rim along the back, fading in from the rostrum and out down the tail. */
  function drawRim(ctx: CanvasRenderingContext2D, color: string, alpha: number, lw: number) {
    ctx.strokeStyle = color;
    ctx.lineWidth = lw;
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    const step = 6;
    for (let j = 0; j < RIM_END; j += step) {
      const end = Math.min(RIM_END, j + step);
      const s = GRID[Math.floor((j + end) / 2)];
      const a = alpha * smooth(0, 0.06, s) * (1 - smooth(0.72, 0.95, s));
      if (a < 0.005) continue;
      ctx.globalAlpha = a;
      ctx.beginPath();
      ctx.moveTo(px[O_DORSAL + j], py[O_DORSAL + j]);
      for (let i = j + 1; i <= end; i++) ctx.lineTo(px[O_DORSAL + i], py[O_DORSAL + i]);
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
  }

  function drawStars(ctx: CanvasRenderingContext2D, t: number, night: number) {
    const halo = glowSprite(C.biolum, 64);
    ctx.globalCompositeOperation = 'lighter';
    ctx.fillStyle = C.biolumCore;
    for (const st of stars) {
      const j = st.j;
      const k = st.fj;
      const x0 = gx[j] + (gx[j + 1] - gx[j]) * k;
      const y0 = gy[j] + (gy[j + 1] - gy[j]) * k;
      const nx = gnx[j] + (gnx[j + 1] - gnx[j]) * k;
      const ny = gny[j] + (gny[j + 1] - gny[j]) * k;
      const D = (DORSAL[j] + (DORSAL[j + 1] - DORSAL[j]) * k) * L * (1 - st.depth);
      const x = x0 - nx * D;
      const y = y0 - ny * D;
      const n = twinkle(st.off + t * st.rate);
      const tw = 0.18 + 0.82 * smooth(-0.7, 0.75, n);
      const a = STAR_ALPHA * tw * night;
      if (a < 0.01) continue;
      const r = st.big ? 0.8 : 0.5;
      const g = st.big ? 4.5 : 3;
      ctx.globalAlpha = a * 0.45;
      ctx.drawImage(halo, x - g, y - g, g * 2, g * 2);
      ctx.globalAlpha = a;
      ctx.beginPath();
      ctx.arc(x, y, r, 0, TAU);
      ctx.fill();
    }
    ctx.globalCompositeOperation = 'source-over';
    ctx.globalAlpha = 1;
  }

  function polyDist2(start: number, n: number, x: number, y: number): number {
    let best = Infinity;
    for (let i = 0; i < n; i++) {
      const a = start + i;
      const b = start + ((i + 1) % n);
      const ex = px[b] - px[a];
      const ey = py[b] - py[a];
      const l2 = ex * ex + ey * ey;
      let u = l2 > 0 ? ((x - px[a]) * ex + (y - py[a]) * ey) / l2 : 0;
      u = u < 0 ? 0 : u > 1 ? 1 : u;
      const dx = x - (px[a] + ex * u);
      const dy = y - (py[a] + ey * u);
      const d2 = dx * dx + dy * dy;
      if (d2 < best) best = d2;
    }
    return best;
  }

  function polyContains(start: number, n: number, x: number, y: number): boolean {
    let inside = false;
    for (let i = 0, k = n - 1; i < n; k = i++) {
      const xi = px[start + i];
      const yi = py[start + i];
      const xk = px[start + k];
      const yk = py[start + k];
      if (yi > y !== yk > y && x < ((xk - xi) * (y - yi)) / (yk - yi) + xi) inside = !inside;
    }
    return inside;
  }

  const whale: WhaleEntity = {
    get active() {
      return active;
    },

    start(f, direction) {
      const pr = mulberry32((seed ^ Math.imul(pass + 1, 0x9e3779b1)) >>> 0);
      pass++;
      dir = direction;
      tau = 0;
      laneY = range(pr, 0.44, 0.49);
      wavePhase = range(pr, 0, TAU);
      finPhase = range(pr, 0, TAU);
      active = true;
      prevValid = false;
      sparkAcc = 0;
      exhaleAge = -1;
      clock = f.t;
      const p = f.parallax(PARALLAX);
      par.x = p.x;
      par.y = p.y;
      build(clock);
      chooseSamples();
    },

    update(f) {
      if (!active) return;
      tau += f.dt;
      clock = f.t;
      if (tau >= T) {
        active = false;
        return;
      }
      const p = f.parallax(PARALLAX);
      par.x = p.x;
      par.y = p.y;
      build(clock);
      updateExhale(f);
      stirWater(f);
    },

    draw(ctx, f) {
      if (!active || !built) return;
      const Lt = f.lighting;
      const p = f.parallax(PARALLAX);
      par.x = p.x;
      par.y = p.y;
      const yN = clamp01((centreY() + p.y) / h);
      const fill = Lt.color('whaleLane', yN);
      const water = Lt.waterAt(yN);
      // The shades follow from the fill (and the water): recompute them only when those change.
      if (fill !== tones.fill) {
        const lum = toLab(fill)[0];
        tones.fill = fill;
        tones.belly = adjustOK(fill, lum * BELLY_LIGHTER);
        tones.pleat = adjustOK(fill, -lum * 0.1);
        tones.nearFin = adjustOK(fill, lum * BELLY_LIGHTER * 0.7);
        tones.water = '';
      }
      if (water !== tones.water) {
        tones.water = water;
        tones.farFin = mixOK(fill, water, 0.2);
      }
      const pic = art('whale');
      if (pic) {
        // Her drawing, facing right, nose to fluke tip across the picture's width, riding the
        // same arc and pitch as the drawn whale. Far away, so the water fogs it a little.
        const tint = sceneTint(Lt, yN, PICTURE_FOG);
        const fx = -bx;
        const fy = -by;
        ctx.save();
        ctx.translate(p.x + hx + fx * NOSE * L, p.y + hy + fy * NOSE * L);
        ctx.scale(dir, 1);
        ctx.rotate(Math.atan2(fy, fx * dir));
        drawArt(ctx, tinted(pic, tint.color, tint.amount), pic, (NOSE + REACH) * L, 1, 0.5);
        ctx.restore();
        return;
      }
      const { belly, pleat, nearFin, farFin } = tones;
      // The far buffer is half resolution: keep lines at least one buffer pixel wide.
      const lw = Math.max(1, 2 / Math.max(1, f.dpr), f.lineWidth);

      ctx.save();
      ctx.translate(p.x, p.y);
      ctx.globalCompositeOperation = 'source-over';
      ctx.globalAlpha = 1;

      ctx.fillStyle = farFin;
      ctx.beginPath();
      tracePoly(ctx, P_FAR, FIN_N);
      ctx.fill();

      ctx.fillStyle = fill;
      ctx.beginPath();
      tracePoly(ctx, 0, NO);
      ctx.fill();

      ctx.fillStyle = belly;
      ctx.beginPath();
      traceStrip(ctx);
      ctx.fill();

      ctx.strokeStyle = pleat;
      ctx.globalAlpha = PLEAT_ALPHA;
      ctx.lineWidth = lw;
      ctx.lineJoin = 'round';
      ctx.lineCap = 'round';
      ctx.beginPath();
      tracePleats(ctx);
      ctx.stroke();
      ctx.globalAlpha = 1;

      ctx.fillStyle = nearFin;
      ctx.beginPath();
      tracePoly(ctx, P_NEAR, FIN_N);
      ctx.fill();

      const day = clamp01(Lt.num('causticSeabedAlpha', yN) / 0.08);
      // Adaptive quality drops the caustics everywhere at its second step (quality 0.5).
      if (day > 0.01 && f.quality > 0.7) drawCaustics(ctx, f.t, CAUSTIC_ALPHA * day);

      const sunset = modeWeight(Lt, 'sunset', yN);
      if (sunset > 0.01) drawRim(ctx, Lt.color('rim', yN), RIM_ALPHA * sunset, lw);

      // The constellation is the last light to catch in the bottom-up cascade (and the first
      // out), so it reads its lantern state from the top of the water.
      const night = Lt.biolum(Math.min(yN, 0.02));
      if (night > 0.01) drawStars(ctx, f.t, night);

      ctx.restore();
    },

    hitTest(x, y) {
      if (!active || !built) return false;
      const qx = x - par.x;
      const qy = y - par.y;
      if (qx < bbox.x0 - HIT_PAD || qx > bbox.x1 + HIT_PAD || qy < bbox.y0 - HIT_PAD || qy > bbox.y1 + HIT_PAD) return false;
      if (polyContains(0, NO, qx, qy) || polyContains(P_NEAR, FIN_N, qx, qy)) return true;
      const r2 = HIT_PAD * HIT_PAD;
      return polyDist2(0, NO, qx, qy) <= r2 || polyDist2(P_NEAR, FIN_N, qx, qy) <= r2;
    },

    exhale() {
      if (!active) return;
      exhaleAge = 0;
      puffs = 0;
    },

    releasePoint() {
      const j = BELLY_GIFT;
      const V = VENTRAL[j] * L + 6;
      return { x: gx[j] + gnx[j] * V, y: gy[j] + gny[j] * V };
    },

    center() {
      return { x: gx[BELLY_GIFT] + gnx[BELLY_GIFT] * centreOffset(), y: centreY() };
    },

    resize(nw, nh, nphone) {
      const frac = T > 0 ? tau / T : 0;
      w = nw;
      h = nh;
      phone = nphone;
      setSize();
      tau = frac * T;
      prevValid = false;
      if (active) {
        build(clock);
        chooseSamples();
      }
    },
  };
  return whale;
}
