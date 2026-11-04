/**
 * Seahorses (Curious Dwellers): Coral (Hippocampus bargibanti), Golden (H. kuda) and Lilac
 * (H. whitei). Each one is a single flat silhouette built the way an illustrator builds it: a
 * centerline from the snout tube through head, coronet, neck, belly and trunk into a
 * logarithmic-spiral tail, offset along its normals by a width profile. Twelve bony ring ticks,
 * a fluttering translucent dorsal fin, a pectoral fin and a pinhole eye cut through to the water
 * finish it. There is no face. Happiness shows as saturation and lightness, and at night as a
 * rim glow. The director at the bottom plays the pair's shared moments: the morning greeting,
 * the idle tail-link and the courtship twirl.
 */
import type {
  CreatureEntity,
  CreatureFactory,
  CreatureInit,
  DrawStyle,
  SeagrassAnchor,
  SeahorseDirector,
  SeahorseVariant,
  WorldFrame,
} from '../types';
import { C, adjustOK, mixOK } from '../palette';
import { envelope } from '../light';
import { mulberry32, range, type Rand } from '../rng';
import { artFor, drawArt, sceneTint, tinted, type ArtImage } from '../art';

const TAU = Math.PI * 2;
const DEG = Math.PI / 180;

/**
 * Total height (top of the coronet to the bottom of the coiled tail), CSS px. On a phone the
 * pair is the emotional centre of a small screen, so they are drawn larger there; shop plates
 * keep the brief's 40px phone size.
 */
const HS_DESKTOP = 46;
const HS_PHONE = 54;
const HS_SPECIMEN_PHONE = 40;
/** Seahorses live on the reef layer (L4 parallax). */
const PX = 6;
/** Atmospheric fog toward the water behind them. */
const FOG = 0.18;
const HIT_R = 28;

// Tail: the logarithmic spiral r = A e^(-B θ), θ from 0 to 3.2π, in units of Hs.
const SP_A = 0.3;
const SP_B = 0.18;
const SP_THETA = 3.2 * Math.PI;
const SP_S = Math.sqrt(1 + SP_B * SP_B);
const TAIL_N = 84;
const BODY_N = 190;
/** Tail half-width as a share of the spiral radius (0.12 Hs at the root, 0.02 at the tip). */
const TAIL_W = 0.2;
/** Lateral half-thickness as a share of the profile half-width (they are laterally flattened). */
const LATERAL = 0.78;

/** Visual centre (callouts, spin pivot) in local units: coil centre at the origin, facing +x. */
const CX = -0.05;
const CY = -0.25;

const BOB_PX = 6;
const BOB_ANG = 4 * DEG;
const TILT_MAX = 12 * DEG;
const LOOK_R = 160;
const SPRING_K = 60;
const SPRING_D = 14;
/** The roll is the same spring with a little more inertia, so it settles with a small overshoot. */
const SPIN_MASS = 1.45;
const SPIN_RAMP = 0.32;
/** Fin flutter: sin(t * 24) on the ray angles, about 3.8 Hz. */
const FIN_W = 24;
const FIN_RAYS = 8;
const RINGS = 12;
const PEC_RAYS = 5;
const DART_TIME = 1.4;
const DART_PITCH = 20 * DEG;
const SWIM_SPEED = 16;
const SPECKS = 5;
const LUNGES = 3;
const LUNGE_OUT = 0.16;
const LUNGE_BACK = 0.24;
const LUNGE_GAP = 0.5;
const FEED_FIRST = 0.42;
const SPIN_BUBBLES = 5;

const clamp = (v: number, a: number, b: number) => (v < a ? a : v > b ? b : v);
const clamp01 = (v: number) => clamp(v, 0, 1);
const smooth = (a: number, b: number, v: number) => {
  const t = clamp01((v - a) / (b - a));
  return t * t * (3 - 2 * t);
};
const easeSine = (t: number) => 0.5 - 0.5 * Math.cos(Math.PI * clamp01(t));
const easeOutCubic = (t: number) => 1 - (1 - clamp01(t)) ** 3;
/** Approaches `target` with time constant `tau` seconds, frame-rate independent. */
const approach = (v: number, target: number, tau: number, dt: number) => v + (target - v) * (1 - Math.exp(-dt / Math.max(1e-4, tau)));

/** CSS cubic-bezier timing function, solved by bisection. */
function cubicBezier(x1: number, y1: number, x2: number, y2: number): (x: number) => number {
  const bx = (t: number) => 3 * x1 * t * (1 - t) ** 2 + 3 * x2 * t * t * (1 - t) + t ** 3;
  const by = (t: number) => 3 * y1 * t * (1 - t) ** 2 + 3 * y2 * t * t * (1 - t) + t ** 3;
  return (x) => {
    if (x <= 0) return 0;
    if (x >= 1) return 1;
    let lo = 0;
    let hi = 1;
    for (let i = 0; i < 20; i++) {
      const mid = (lo + hi) / 2;
      if (bx(mid) < x) lo = mid;
      else hi = mid;
    }
    return by((lo + hi) / 2);
  };
}
const easeDart = cubicBezier(0.2, 0.8, 0.2, 1);

// ---------------------------------------------------------------------------
// Anatomy
// ---------------------------------------------------------------------------

// Key points along the centerline, snout tip first.
const K_EYE = 3;
const K_OCC = 5;
const K_NECK = 6;
const K_CHEST = 7;
const K_BELLY = 8;
const K_TRUNK = 9;

interface Shape {
  /** Centerline key points (x, y pairs) from snout tip to tail root, in Hs, coil centre at the origin, facing +x, y down. */
  keys: number[];
  /** Full width at each key point (Hs) and the share of it on the dorsal side. */
  width: number[];
  dorsal: number[];
  /** Three coronet spike heights (Hs) and where they stand (key-point parameter). */
  spikes: [number, number, number];
  crownAt: number;
  /** Tubercle bumps per side on the outline (H. bargibanti only). */
  tubercles: number;
  /** Dorsal fin ray length (Hs). */
  fin: number;
}

// Snout tip, snout middle, snout base, eye, crown, occiput, neck, chest, belly, trunk, tail root.

/** Hippocampus kuda: the classic profile the brief's proportions describe. */
const KUDA: Shape = {
  keys: [
    0.215, -0.468, 0.118, -0.519, 0.024, -0.566, -0.058, -0.606, -0.125, -0.622, -0.178, -0.583, -0.196, -0.5, -0.192, -0.405,
    -0.19, -0.285, -0.232, -0.13, -0.3, 0,
  ],
  width: [0.06, 0.056, 0.07, 0.165, 0.17, 0.15, 0.118, 0.18, 0.222, 0.16, 0.12],
  dorsal: [0.5, 0.5, 0.48, 0.44, 0.5, 0.56, 0.38, 0.36, 0.32, 0.42, 0.5],
  spikes: [0.026, 0.04, 0.03],
  crownAt: 4.15,
  tubercles: 0,
  fin: 0.105,
};

/** Hippocampus bargibanti: shorter snout, rounder belly, low knobbed crown, tubercles all over. */
const BARGIBANTI: Shape = {
  keys: [
    0.168, -0.5, 0.098, -0.535, 0.026, -0.57, -0.056, -0.608, -0.124, -0.624, -0.178, -0.585, -0.198, -0.5, -0.196, -0.405,
    -0.194, -0.285, -0.236, -0.13, -0.3, 0,
  ],
  width: [0.068, 0.066, 0.08, 0.175, 0.178, 0.158, 0.128, 0.195, 0.238, 0.172, 0.125],
  dorsal: [0.5, 0.5, 0.48, 0.44, 0.5, 0.56, 0.38, 0.36, 0.31, 0.42, 0.5],
  spikes: [0.018, 0.026, 0.02],
  crownAt: 4.15,
  tubercles: 26,
  fin: 0.092,
};

/** Hippocampus whitei: slender trunk and a tall, spined coronet. */
const WHITEI: Shape = {
  keys: [
    0.22, -0.47, 0.121, -0.521, 0.024, -0.568, -0.058, -0.607, -0.125, -0.622, -0.176, -0.583, -0.194, -0.5, -0.19, -0.405,
    -0.188, -0.285, -0.228, -0.13, -0.3, 0,
  ],
  width: [0.056, 0.052, 0.066, 0.155, 0.16, 0.14, 0.108, 0.164, 0.202, 0.148, 0.112],
  dorsal: [0.5, 0.5, 0.48, 0.44, 0.5, 0.56, 0.38, 0.37, 0.33, 0.42, 0.5],
  spikes: [0.036, 0.056, 0.04],
  crownAt: 4.15,
  tubercles: 0,
  fin: 0.11,
};

interface VariantSpec {
  body: string;
  ring: string;
  /** Night rim and glow hue. */
  glow: string;
  shape: Shape;
}

const VARIANTS: Record<SeahorseVariant, VariantSpec> = {
  coral: { body: C.coral, ring: C.coralDeep, glow: C.coral, shape: BARGIBANTI },
  gold: { body: C.seahorseGold, ring: C.goldRing, glow: C.seahorseGold, shape: KUDA },
  lilac: { body: C.lilac, ring: C.lilacRing, glow: C.lilacLight, shape: WHITEI },
};

/** The rest centerline of one individual, sampled evenly by arc length. */
interface Rest {
  n: number;
  x: Float32Array;
  y: Float32Array;
  /** Dorsal and ventral half-widths (Hs). */
  wd: Float32Array;
  wv: Float32Array;
  s: Float32Array;
  /** Sample index of each key point. */
  ki: number[];
  /** Tubercle bumps on the tail, per tail sample (dorsal, ventral). */
  tailD: Float32Array;
  tailV: Float32Array;
  /** Head-tilt and lunge weights per body sample (1 at the head, 0 from the chest down). */
  wTilt: Float32Array;
  wLunge: Float32Array;
  /** Where the dorsal fin, pectoral fin and eye sit (sample indices). */
  finA: number;
  finB: number;
  pec: number;
  eye: number;
  rings: number[];
}

function catmull(p0: number, p1: number, p2: number, p3: number, t: number): number {
  const t2 = t * t;
  const t3 = t2 * t;
  return 0.5 * (2 * p1 + (-p0 + p2) * t + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t2 + (-p0 + 3 * p1 - 3 * p2 + p3) * t3);
}

const bump = (x: number) => (x <= -1 || x >= 1 ? 0 : (1 - x * x) * (1 - x * x));

function buildRest(sh: Shape, rand: Rand): Rest {
  const k = sh.keys;
  const nk = k.length / 2;
  // Phantom end points: the snout continues straight, and the tail root leaves along the
  // spiral's own starting tangent so the trunk flows into the coil without a kink.
  const rx = SP_B / SP_S;
  const ry = 1 / SP_S;
  const m = Math.hypot(k[2 * nk - 2] - k[2 * nk - 4], k[2 * nk - 1] - k[2 * nk - 3]);
  const px = [2 * k[0] - k[2], ...k.filter((_, i) => i % 2 === 0), k[2 * nk - 4] + 2 * m * rx];
  const py = [2 * k[1] - k[3], ...k.filter((_, i) => i % 2 === 1), k[2 * nk - 3] + 2 * m * ry];
  const wk = sh.width;
  const dk = sh.dorsal;
  const at = (arr: number[], i: number) => arr[clamp(i, 0, arr.length - 1)];

  // Fine polyline with its key parameter u.
  const SUB = 48;
  const fx: number[] = [];
  const fy: number[] = [];
  const fu: number[] = [];
  for (let seg = 0; seg < nk - 1; seg++) {
    for (let j = 0; j < SUB; j++) {
      const t = j / SUB;
      fx.push(catmull(px[seg], px[seg + 1], px[seg + 2], px[seg + 3], t));
      fy.push(catmull(py[seg], py[seg + 1], py[seg + 2], py[seg + 3], t));
      fu.push(seg + t);
    }
  }
  fx.push(k[2 * nk - 2]);
  fy.push(k[2 * nk - 1]);
  fu.push(nk - 1);
  const fs = [0];
  for (let i = 1; i < fx.length; i++) fs.push(fs[i - 1] + Math.hypot(fx[i] - fx[i - 1], fy[i] - fy[i - 1]));
  const len = fs[fs.length - 1];

  const n = BODY_N;
  const x = new Float32Array(n);
  const y = new Float32Array(n);
  const s = new Float32Array(n);
  const u = new Float32Array(n);
  let j = 0;
  for (let i = 0; i < n; i++) {
    const si = (len * i) / (n - 1);
    while (j < fs.length - 2 && fs[j + 1] < si) j++;
    const f = (si - fs[j]) / Math.max(1e-9, fs[j + 1] - fs[j]);
    x[i] = fx[j] + (fx[j + 1] - fx[j]) * f;
    y[i] = fy[j] + (fy[j + 1] - fy[j]) * f;
    u[i] = fu[j] + (fu[j + 1] - fu[j]) * f;
    s[i] = si;
  }
  const idxOfU = (uu: number) => {
    let best = 0;
    for (let i = 1; i < n; i++) if (Math.abs(u[i] - uu) < Math.abs(u[best] - uu)) best = i;
    return best;
  };

  const wd = new Float32Array(n);
  const wv = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const seg = Math.min(nk - 2, Math.floor(u[i]));
    const t = u[i] - seg;
    const w = Math.max(0.02, catmull(at(wk, seg - 1), wk[seg], wk[seg + 1], at(wk, seg + 2), t));
    const d = clamp(catmull(at(dk, seg - 1), dk[seg], dk[seg + 1], at(dk, seg + 2), t), 0.25, 0.75);
    wd[i] = w * d;
    wv[i] = w * (1 - d);
  }

  // Coronet: three sharp spikes on the dorsal outline behind the eye.
  const ds = len / (n - 1);
  const ic = idxOfU(sh.crownAt);
  const gap = Math.max(2, Math.round(0.03 / ds));
  const hb = Math.max(2, Math.round(0.014 / ds));
  for (let q = 0; q < 3; q++) {
    const c = ic + (q - 1) * gap;
    for (let o = -hb; o <= hb; o++) {
      const i = c + o;
      if (i < 0 || i >= n) continue;
      wd[i] += sh.spikes[q] * (1 - Math.abs(o) / (hb + 0.5));
    }
  }

  // Tubercles: small rounded knobs on the outline (about 0.8px at sea size).
  const tailD = new Float32Array(TAIL_N);
  const tailV = new Float32Array(TAIL_N);
  const tub = 0.8 / HS_DESKTOP;
  for (let q = 0; q < sh.tubercles; q++) {
    const amp = tub * range(rand, 0.6, 1.05);
    const side = rand() < 0.5;
    const where = rand();
    if (where < 0.62) {
      const sc = range(rand, 0.2, 0.99) * len;
      const hw = range(rand, 0.012, 0.02);
      for (let i = 0; i < n; i++) {
        const b = amp * bump((s[i] - sc) / hw);
        if (side) wd[i] += b;
        else wv[i] += b;
      }
    } else {
      const tc = range(rand, 0.02, 0.6) * TAIL_N;
      const hw = range(rand, 1.4, 2.4);
      for (let i = 0; i < TAIL_N; i++) {
        const b = amp * bump((i - tc) / hw);
        if (side) tailD[i] += b;
        else tailV[i] += b;
      }
    }
  }

  const ki = Array.from({ length: nk }, (_, q) => idxOfU(q));
  const sOcc = s[ki[K_OCC]];
  const sEye = s[ki[K_EYE]];
  const sChest = s[ki[K_CHEST]];
  const wTilt = new Float32Array(n);
  const wLunge = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    wTilt[i] = 1 - smooth(sOcc, sChest, s[i]);
    wLunge[i] = 1 - smooth(sEye, sChest + 0.05, s[i]);
  }

  // Twelve rings from below the neck down into the start of the tail coil.
  const r0 = s[ki[K_NECK]] + 0.06;
  const tailLen = (SP_A * SP_S * (1 - Math.exp(-SP_B * SP_THETA))) / SP_B;
  const r1 = len + tailLen * 0.3;
  const rings: number[] = [];
  for (let q = 0; q < RINGS; q++) {
    const sr = r0 + ((r1 - r0) * q) / (RINGS - 1);
    if (sr <= len) rings.push(Math.round(sr / ds));
    else rings.push(n - 1 + tailIndexAt(sr - len));
  }

  return {
    n,
    x,
    y,
    wd,
    wv,
    s,
    ki,
    tailD,
    tailV,
    wTilt,
    wLunge,
    finA: idxOfU(K_BELLY + 0.55),
    finB: Math.min(n - 1, idxOfU(K_TRUNK + 0.95)),
    pec: idxOfU(K_OCC + 0.62),
    eye: idxOfU(K_EYE - 0.08),
    rings,
  };
}

/** Tail sample (1-based) whose arc length from the root is closest to `sl`. */
function tailIndexAt(sl: number): number {
  const dth = SP_THETA / TAIL_N;
  let acc = 0;
  for (let i = 1; i <= TAIL_N; i++) {
    const th = (i - 0.5) * dth;
    acc += SP_A * Math.exp(-SP_B * th) * SP_S * dth;
    if (acc >= sl) return i;
  }
  return TAIL_N;
}

// ---------------------------------------------------------------------------
// Colour
// ---------------------------------------------------------------------------

const adjustCache = new Map<string, string>();
/** adjustOK with quantized inputs and a cache, so per-frame calls stay cheap. */
function adjusted(color: string, dL: number, chroma: number): string {
  const qL = Math.round(dL * 200);
  const qC = Math.round(chroma * 100);
  const key = `${color}|${qL}|${qC}`;
  const hit = adjustCache.get(key);
  if (hit) return hit;
  const out = adjustOK(color, qL / 200, qC / 100);
  if (adjustCache.size > 2048) adjustCache.clear();
  adjustCache.set(key, out);
  return out;
}

/**
 * The last call of one adjusted() expression, remembered. adjusted() quantizes its inputs, so equal
 * quantized inputs give the identical string: steady frames reuse it without building a cache key.
 */
class AdjustMemo {
  private c = '';
  private qL = NaN;
  private qC = NaN;
  private out = '';
  get(color: string, dL: number, chroma: number): string {
    const qL = Math.round(dL * 200);
    const qC = Math.round(chroma * 100);
    if (qL !== this.qL || qC !== this.qC || color !== this.c) {
      this.c = color;
      this.qL = qL;
      this.qC = qC;
      this.out = adjusted(color, dL, chroma);
    }
    return this.out;
  }
}

/** The same for one mixOK() expression (mixOK quantizes t to 1/128 and passes the ends through). */
class MixMemo {
  private a = '';
  private b = '';
  private q = NaN;
  private out = '';
  get(a: string, b: string, t: number): string {
    const q = t <= 0 ? -1 : t >= 1 ? 129 : Math.round(t * 128);
    if (q !== this.q || a !== this.a || b !== this.b) {
      this.a = a;
      this.b = b;
      this.q = q;
      this.out = mixOK(a, b, t);
    }
    return this.out;
  }
}

// ---------------------------------------------------------------------------
// Anchors: which seagrass blade each seahorse holds
// ---------------------------------------------------------------------------

const claims = new Map<SeagrassAnchor, { id: string; t: number }>();

function claimedByOther(a: SeagrassAnchor, id: string, t: number): boolean {
  const c = claims.get(a);
  return !!c && c.id !== id && Math.abs(t - c.t) < 1;
}

/** claim()'s arguments for dropOtherClaim, passed as forEach's `this` so no closure is made per call. */
const claimArgs: { id: string; keep: SeagrassAnchor | null } = { id: '', keep: null };

function dropOtherClaim(this: typeof claimArgs, v: { id: string; t: number }, k: SeagrassAnchor): void {
  if (v.id === this.id && k !== this.keep) claims.delete(k);
}

function claim(a: SeagrassAnchor, id: string, t: number): void {
  claimArgs.id = id;
  claimArgs.keep = a;
  claims.forEach(dropOtherClaim, claimArgs);
  claimArgs.keep = null;
  // Refreshed every frame while held: update the record in place.
  const c = claims.get(a);
  if (c) {
    c.id = id;
    c.t = t;
  } else claims.set(a, { id, t });
}

function alongFor(a: SeagrassAnchor, hs: number): number {
  if (a.seaFan) return 0.55;
  return clamp(Math.max(0.5, (0.5 * hs) / Math.max(1, a.height)), 0.34, 0.72);
}

/** Point on the blade where the coil grips, at time t. */
function gripAt(a: SeagrassAnchor, along: number, t: number): { x: number; y: number } {
  return { x: a.x + a.swayAt(along, t), y: a.y - along * a.height };
}

// ---------------------------------------------------------------------------
// The seahorse
// ---------------------------------------------------------------------------

type Mode = 'free' | 'anchored' | 'travel' | 'directed';

interface Travel {
  dart: boolean;
  sx: number;
  sy: number;
  anchor: SeagrassAnchor | null;
  along: number;
  /** Fixed destination when there is no anchor. */
  px: number;
  py: number;
  t0: number;
  dur: number;
  lift: number;
}

interface Speck {
  x: number;
  y: number;
  vx: number;
  vy: number;
  age: number;
  life: number;
  hop: number;
  eaten: number;
}

interface Feed {
  t0: number;
  lunge: number;
  lungeT0: number;
  lx: number;
  ly: number;
  target: Speck | null;
  spinAt: number;
  spun: boolean;
}

/** What the director asks a seahorse to do in a shared moment. */
export interface Goal {
  x: number;
  y: number;
  /** Facing: 0 faces right, π faces left; may keep turning (the twirl). */
  yaw: number;
  curl: number;
  ang: number;
  tilt: number | null;
  /** Follow stiffness (rad/s) of the critically damped chase. */
  stiff: number;
  /** Saturation override (0.7..1) or null for happiness; extra brightness 0..1. */
  sat: number | null;
  bright: number;
  /** Depth for draw order (bigger is nearer) and a touch of extra fog when behind. */
  depth: number;
  /** Partner whose tail is linked with this one (drawn over-under). */
  partner: SeahorseHandle | null;
  /** True for the one whose tail passes in front at the upper crossing. */
  over: boolean;
}

/** The director's view of one seahorse. */
interface SeahorseHandle {
  readonly id: string;
  hs(): number;
  origin(): { x: number; y: number };
  yaw(): number;
  available(): boolean;
  feeding(): boolean;
  spinning(): boolean;
  satNow(): number;
  direct(goal: Goal): void;
  release(): void;
  cancelFeed(): void;
  /** Tail centerline in world px, root first, TAIL_N + 1 points (for the partner's over-under cut). */
  tailPath(): Float32Array;
  /** Tail half-width in px at tail sample i (0 = root). */
  tailHalfWidth(i: number): number;
  depth(): number;
}

const handles = new WeakMap<CreatureEntity, SeahorseHandle>();

// Drawing scratch shared by every seahorse (drawing is synchronous, one seahorse at a time).
const WRAP_STEPS = 6;
const WRAP_LX = new Float64Array(WRAP_STEPS + 1);
const WRAP_LY = new Float64Array(WRAP_STEPS + 1);
const WRAP_RX = new Float64Array(WRAP_STEPS + 1);
const WRAP_RY = new Float64Array(WRAP_STEPS + 1);
/** Tail crossings found by clipLink (grown on demand), and the partner strand around one. */
let linkKey = new Float64Array(16);
let linkJ = new Float64Array(16);
let linkX = new Float64Array(16);
let linkY = new Float64Array(16);
let linkOrder = new Int32Array(16);
const STRAND_LX = new Float64Array(TAIL_N + 1);
const STRAND_LY = new Float64Array(TAIL_N + 1);
const STRAND_RX = new Float64Array(TAIL_N + 1);
const STRAND_RY = new Float64Array(TAIL_N + 1);

function growLinkHits(): void {
  const n = linkKey.length * 2;
  const more = (a: Float64Array) => {
    const b = new Float64Array(n);
    b.set(a);
    return b;
  };
  linkKey = more(linkKey);
  linkJ = more(linkJ);
  linkX = more(linkX);
  linkY = more(linkY);
  linkOrder = new Int32Array(n);
}

class Seahorse implements CreatureEntity {
  readonly id: string;
  readonly kind = 'seahorse' as const;
  readonly variant: string;
  /** Capsule radius: 28px at the brief's size, growing with the larger phone body. */
  get hitRadius(): number {
    return this.specimen ? HIT_R : Math.round(HIT_R * Math.max(1, this.hs / Math.max(0.01, this.scale) / HS_DESKTOP));
  }
  x = 0;
  y = 0;
  z = 1;
  happiness = 60;

  private readonly spec: VariantSpec;
  private readonly rest: Rest;
  private readonly rand: Rand;
  private readonly scale: number;
  private readonly specimen: boolean;
  private home: { x: number; y: number };
  private w: number;
  private h: number;
  private hs = HS_DESKTOP;
  private par = { x: 0, y: 0 };
  private age = 0;
  private clock = 0;
  private readonly from: { x: number; y: number } | null;

  // Pose.
  private ox = 0;
  private oy = 0;
  private vx = 0;
  private vy = 0;
  private ang = 0;
  private yawV = 0;
  private yawNow = 0;
  private yawTarget = 0;
  private curl = 1;
  private curlTarget = 1;
  private tilt = 0;
  private tiltV = 0;
  private tiltTarget = 0;
  private spin = 0;
  private spinV = 0;
  private spinGoal = 0;
  private spinFrom = 0;
  private spinT0 = -1;
  private lungeX = 0;
  private lungeY = 0;
  private finRate = 1;
  private finAmp = 1;
  private finPhase = 0;
  private readonly bobPeriod: number;
  private readonly bobPhase: number;
  private readonly finSeed: number;

  // Where it lives.
  private mode: Mode = 'free';
  private anchor: SeagrassAnchor | null = null;
  private along = 0.5;
  private travel: Travel | null = null;
  private pitchTarget = 0;

  // Attention.
  private lookNext: number;
  private lookUntil = 0;
  private lookJelly: string | null = null;
  private dartNext: number;
  private behindSince = -1;
  private turnBlockedUntil = 0;
  private fanCheck = 0;

  // Feeding and light.
  private feed: Feed | null = null;
  private readonly specks: Speck[] = [];
  private spinBubbles = 0;
  private flashAt = -99;
  private wakeAt = -99;
  private wakeAmp = 0;
  private sat = 0.85;
  private bright = 0;
  /** 0..1: how firmly the coil is wound round its blade (drives the over-under gap). */
  private wrap = 0;

  /** This frame's colours, each remembered from the last frame. */
  private readonly tones = {
    bodyAdj: new AdjustMemo(),
    bodyDark: new MixMemo(),
    bodyFog: new MixMemo(),
    ringAdj: new AdjustMemo(),
    ringDark: new MixMemo(),
    ringFog: new MixMemo(),
    fin: new MixMemo(),
    hue: new MixMemo(),
    speck: new MixMemo(),
  };

  /** toWorld()'s result. */
  private wx = 0;
  private wy = 0;

  // The director.
  private goal: Goal | null = null;
  private tail = new Float32Array((TAIL_N + 1) * 2);
  /** Update count, and the update the posed geometry was last built for. */
  private ticks = 0;
  private geomTick = -1;

  // Geometry scratch (local pose, then screen).
  private readonly N: number;
  private readonly lx: Float32Array;
  private readonly ly: Float32Array;
  private readonly hd: Float32Array;
  private readonly hv: Float32Array;
  private readonly tx: Float32Array;
  private readonly ty: Float32Array;
  private readonly ax: Float32Array;
  private readonly ay: Float32Array;
  private readonly bx: Float32Array;
  private readonly by: Float32Array;
  private readonly mx: Float32Array;
  private readonly my: Float32Array;
  private readonly sx: Float32Array;
  private readonly sy: Float32Array;
  /** Fin rays this frame (world px, x, y pairs): base points and tips. */
  private readonly finBase = new Float64Array(FIN_RAYS * 2);
  private readonly finTips = new Float64Array(FIN_RAYS * 2);
  private readonly pecBase = new Float64Array(PEC_RAYS * 2);
  private readonly pecTips = new Float64Array(PEC_RAYS * 2);

  constructor(init: CreatureInit) {
    this.id = init.id;
    const variant = (init.variant in VARIANTS ? init.variant : 'coral') as SeahorseVariant;
    this.variant = variant;
    this.spec = VARIANTS[variant];
    this.rand = mulberry32(init.seed >>> 0);
    this.rest = buildRest(this.spec.shape, mulberry32((init.seed ^ 0x9e3779b9) >>> 0));
    this.scale = init.scale ?? 1;
    this.specimen = !!init.specimen;
    this.home = { x: init.home.x, y: init.home.y };
    this.w = init.w;
    this.h = init.h;
    this.from = init.from && !this.specimen ? { x: init.from.x, y: init.from.y } : null;
    const r = this.rand;
    this.bobPeriod = range(r, 6.6, 7.6);
    this.bobPhase = r() * TAU;
    this.finSeed = r() * TAU;
    this.lookNext = range(r, 3, 9);
    this.dartNext = range(r, 14, 30);
    // Face into the sea: toward the middle of the screen.
    const faceRight = this.specimen ? true : init.home.x < 0.5 ? r() < 0.85 : r() < 0.15;
    this.yawNow = this.yawTarget = faceRight ? 0 : Math.PI;

    const N = (this.N = this.rest.n + TAIL_N);
    this.lx = new Float32Array(N);
    this.ly = new Float32Array(N);
    this.hd = new Float32Array(N);
    this.hv = new Float32Array(N);
    this.tx = new Float32Array(N);
    this.ty = new Float32Array(N);
    this.ax = new Float32Array(N);
    this.ay = new Float32Array(N);
    this.bx = new Float32Array(N);
    this.by = new Float32Array(N);
    this.mx = new Float32Array(N);
    this.my = new Float32Array(N);
    this.sx = new Float32Array(N);
    this.sy = new Float32Array(N);

    const hs0 = this.baseHs(init.w < 640) * this.scale;
    this.hs = hs0;
    const start = this.from ?? { x: init.home.x * init.w, y: init.home.y * init.h };
    this.ox = start.x - CX * hs0;
    this.oy = start.y - CY * hs0;
    this.x = start.x;
    this.y = start.y;
    handles.set(this, this.handle());
  }

  // -------------------------------------------------------------------------
  // CreatureEntity
  // -------------------------------------------------------------------------

  update(f: WorldFrame): void {
    const dt = Math.min(0.05, Math.max(0, f.dt));
    this.age += dt;
    this.ticks++;
    this.clock = f.t;
    this.hs = this.baseHs(f.phone) * this.scale;
    if (!this.specimen) this.par = f.parallax(PX);
    const rm = f.lighting.reducedMotion ? 0.5 : 1;

    this.finRate = approach(this.finRate, 1, 0.5, dt);
    this.finAmp = approach(this.finAmp, 1, 0.5, dt);

    if (!this.specimen) this.syncAnchor(f);
    this.updateMotion(f, dt, rm);
    this.updateFeed(f, dt);
    this.updateLook(f);
    this.updateSprings(dt, rm);
    this.finPhase += dt * FIN_W * this.finRate * (rm < 1 ? 0.6 : 1);

    // Happiness as colour; the director may lift it during shared moments.
    const hsat = 0.7 + 0.3 * clamp01(this.happiness / 100);
    const want = this.goal?.sat ?? hsat;
    this.sat = approach(this.sat, want, this.goal ? 0.5 : 4, dt);
    this.bright = approach(this.bright, this.goal?.bright ?? 0, this.goal ? 0.25 : 1.6, dt);

    // The coil settles round its blade once it is anchored and fully curled; it lets go at once.
    const gripping = this.mode === 'anchored' && !!this.anchor && !this.spinning() && this.curl > 0.9;
    this.wrap = gripping ? approach(this.wrap, 1, 0.3, dt) : 0;

    this.toWorld(CX, CY);
    this.x = this.wx;
    this.y = this.wy;
  }

  draw(ctx: CanvasRenderingContext2D, f: WorldFrame, style?: DrawStyle): void {
    this.ensureGeometry();
    ctx.save();
    if (!this.specimen) ctx.translate(this.par.x, this.par.y);
    const pic = artFor('seahorse', this.variant);
    if (pic) this.drawPicture(ctx, f, pic, !!style?.outline);
    else if (style?.outline) this.drawOutline(ctx, f, style.outlineColor ?? '#E9F7F3');
    else this.drawFull(ctx, f);
    ctx.restore();
  }

  /** Local bounds of the body at rest (Hs units), measured on the first picture frame. */
  private picBox: { x0: number; y0: number; x1: number; y1: number } | null = null;

  /**
   * Her drawing in place of the drawn seahorse: upright, facing right, filling the body's
   * height. It moves on the same frame as the body (bob, pitch, the turn's squash, the
   * courtship spin), breathes slightly and darkens by night.
   */
  private drawPicture(ctx: CanvasRenderingContext2D, f: WorldFrame, pic: ArtImage, outline: boolean): void {
    if (!this.picBox) {
      let x0 = Infinity;
      let y0 = Infinity;
      let x1 = -Infinity;
      let y1 = -Infinity;
      for (let i = 0; i < this.N; i++) {
        const r = Math.max(this.hd[i], this.hv[i]);
        x0 = Math.min(x0, this.lx[i] - r);
        x1 = Math.max(x1, this.lx[i] + r);
        y0 = Math.min(y0, this.ly[i] - r);
        y1 = Math.max(y1, this.ly[i] + r);
      }
      this.picBox = { x0, y0, x1, y1 };
    }
    const b = this.picBox;
    const L = f.lighting;
    const yN = this.yNorm(f);
    const flash = envelope(f.t - this.flashAt);
    if (!outline && flash > 0.01) f.glow(C.lantern, this.x, this.y, this.hs * 0.9, flash * 0.5);
    const tint = sceneTint(L, yN, 0);
    const breathe = 1 + 0.012 * Math.sin((TAU * f.t) / this.bobPeriod + this.bobPhase);
    ctx.save();
    ctx.translate(this.ox, this.oy);
    ctx.scale(Math.cos(this.yawNow) * this.hs, this.hs);
    ctx.rotate(this.ang);
    if (this.spin !== 0) {
      ctx.translate(CX, CY);
      ctx.rotate(this.spin);
      ctx.translate(-CX, -CY);
    }
    ctx.translate((b.x0 + b.x1) / 2, b.y1);
    if (outline) ctx.globalAlpha *= 0.35;
    const height = b.y1 - b.y0;
    drawArt(ctx, outline ? pic.canvas : tinted(pic, tint.color, tint.amount), pic, (height * pic.w) / pic.h, 0.5, 1, 1, breathe);
    ctx.restore();
  }

  hitTest(px: number, py: number): boolean {
    const x = px - this.par.x;
    const y = py - this.par.y;
    this.toWorld(-0.06, -0.6);
    const ax = this.wx;
    const ay = this.wy;
    this.toWorld(0.02, 0.04);
    const abx = this.wx - ax;
    const aby = this.wy - ay;
    const t = clamp01(((x - ax) * abx + (y - ay) * aby) / Math.max(1e-6, abx * abx + aby * aby));
    return Math.hypot(x - (ax + abx * t), y - (ay + aby * t)) <= this.hitRadius;
  }

  private baseHs(phone: boolean): number {
    if (!phone) return HS_DESKTOP;
    return this.specimen ? HS_SPECIMEN_PHONE : HS_PHONE;
  }

  tap(f: WorldFrame): void {
    // Light first.
    this.flashAt = f.t;
    this.finRate = 2;
    this.finAmp = 1.6;
    if (this.feed || this.spinning() || this.goal) return;
    this.startFeed(f);
  }

  wake(f: WorldFrame, strength: number): void {
    this.wakeAt = f.t;
    this.wakeAmp = clamp01(strength);
    this.finRate = 2.2;
    this.finAmp = 1.8;
    this.tiltV -= 1.2 * this.wakeAmp;
  }

  resize(w: number, h: number): void {
    const kx = w / Math.max(1, this.w);
    const ky = h / Math.max(1, this.h);
    this.ox *= kx;
    this.oy *= ky;
    for (const s of this.specks) {
      s.x *= kx;
      s.y *= ky;
    }
    this.w = w;
    this.h = h;
    if (this.travel) this.travel = null;
    if (this.mode === 'travel') this.mode = 'free';
    // The scenery rebuilds its blades; hold on again to whatever is nearest.
    if (this.anchor) {
      this.anchor = null;
      this.mode = 'free';
      this.snapNext = true;
    }
  }

  private snapNext = false;

  // -------------------------------------------------------------------------
  // Where it lives
  // -------------------------------------------------------------------------

  private homePx(): { x: number; y: number } {
    return { x: this.home.x * this.w, y: this.home.y * this.h };
  }

  private faceSign(): number {
    return Math.cos(this.yawNow) >= 0 ? 1 : -1;
  }

  private pick(f: WorldFrame, near: { x: number; y: number }, exclude: SeagrassAnchor | null): { a: SeagrassAnchor; along: number } | null {
    const list = f.anchors;
    if (!list.length) return null;
    const fans = this.variant === 'coral' && list.some((a) => a.seaFan);
    let best: SeagrassAnchor | null = null;
    let bestScore = Infinity;
    for (const a of list) {
      if (a === exclude) continue;
      if (fans && !a.seaFan) continue;
      if (claimedByOther(a, this.id, f.t)) continue;
      const g = gripAt(a, alongFor(a, this.hs), f.t);
      let score = Math.hypot(g.x - near.x, g.y - near.y);
      // Keep a body's width from any other seahorse's blade.
      for (const [o, c] of claims) {
        if (c.id === this.id || o === a || Math.abs(f.t - c.t) >= 1) continue;
        const og = gripAt(o, alongFor(o, this.hs), f.t);
        if (Math.abs(og.x - g.x) < this.hs * 0.95) score += 400;
      }
      if (!fans && a.seaFan) score += 60;
      if (score < bestScore) {
        bestScore = score;
        best = a;
      }
    }
    return best ? { a: best, along: alongFor(best, this.hs) } : null;
  }

  private syncAnchor(f: WorldFrame): void {
    const list = f.anchors;
    if (this.anchor) claim(this.anchor, this.id, f.t);
    if (this.travel?.anchor) claim(this.travel.anchor, this.id, f.t);
    if (!list.length) {
      if (this.mode === 'anchored') this.mode = 'free';
      this.anchor = null;
      return;
    }
    if (this.mode === 'directed') return;
    if (this.anchor && !list.includes(this.anchor)) {
      this.anchor = null;
      if (this.mode === 'anchored') {
        this.mode = 'free';
        this.snapNext = true;
      }
    }
    if (this.travel?.anchor && !list.includes(this.travel.anchor)) {
      const p = this.pick(f, { x: this.ox, y: this.oy }, null);
      this.travel.anchor = p ? p.a : null;
      if (p) this.travel.along = p.along;
      else {
        this.travel.px = this.ox;
        this.travel.py = this.oy;
      }
    }
    if (this.mode === 'free') {
      const snap = this.snapNext || (this.age < 0.4 && !this.from);
      const near = snap && this.age >= 0.4 ? { x: this.ox, y: this.oy } : this.homePx();
      const p = this.pick(f, near, null);
      if (!p) return;
      this.snapNext = false;
      if (snap) {
        this.anchor = p.a;
        this.along = p.along;
        this.mode = 'anchored';
        claim(p.a, this.id, f.t);
        const g = gripAt(p.a, p.along, f.t);
        this.ox = g.x;
        this.oy = g.y;
      } else {
        this.swimTo(f, p.a, p.along, null, false);
      }
      return;
    }
    // H. bargibanti lives on sea fans: once one is placed, move house.
    if (this.variant === 'coral' && this.mode === 'anchored' && this.anchor && !this.anchor.seaFan && f.t >= this.fanCheck) {
      this.fanCheck = f.t + 2;
      if (list.some((a) => a.seaFan) && this.available()) {
        const p = this.pick(f, { x: this.ox, y: this.oy }, null);
        if (p && p.a.seaFan) this.swimTo(f, p.a, p.along, null, false);
      }
    }
  }

  /** Swim (or dart) to a blade, or to a fixed point when `anchor` is null. */
  private swimTo(f: WorldFrame, anchor: SeagrassAnchor | null, along: number, point: { x: number; y: number } | null, dart: boolean): void {
    const dest = anchor ? gripAt(anchor, along, f.t) : point ?? { x: this.ox, y: this.oy };
    const dx = dest.x - this.ox;
    const dist = Math.hypot(dx, dest.y - this.oy);
    let t0 = f.t;
    // Seahorses swim head first: turn around before setting off.
    if (Math.abs(dx) > 10 && Math.sign(dx) !== this.faceSign()) {
      this.yawTarget = dx > 0 ? 0 : Math.PI;
      t0 += 0.38;
    }
    const rm = f.lighting.reducedMotion ? 0.5 : 1;
    const dur = dart ? DART_TIME / Math.max(0.6, rm) : clamp(dist / (SWIM_SPEED * rm), 1.6, 12);
    this.travel = {
      dart,
      sx: this.ox,
      sy: this.oy,
      anchor,
      along,
      px: dest.x,
      py: dest.y,
      t0,
      dur,
      lift: dart ? range(this.rand, 6, 14) * this.scale : Math.min(18, dist * 0.18) * this.scale,
    };
    if (this.anchor && this.anchor !== anchor) claims.delete(this.anchor);
    this.anchor = null;
    this.mode = 'travel';
    if (anchor) claim(anchor, this.id, f.t);
  }

  available(): boolean {
    return (this.mode === 'anchored' || this.mode === 'free') && !this.feed && !this.spinning() && !this.goal;
  }

  spinning(): boolean {
    return this.spinT0 >= 0;
  }

  // -------------------------------------------------------------------------
  // Motion
  // -------------------------------------------------------------------------

  private updateMotion(f: WorldFrame, dt: number, rm: number): void {
    const t = f.t;
    const bobW = (TAU / this.bobPeriod) * rm;
    const bob = Math.sin(t * bobW + this.bobPhase);
    const bobLag = Math.sin(t * bobW + this.bobPhase - 1.3);
    let angTarget = BOB_ANG * bobLag;
    this.pitchTarget = 0;

    switch (this.mode) {
      case 'free': {
        const amp = BOB_PX * this.scale * (this.specimen ? 0.4 : 1);
        if (this.specimen) angTarget *= 0.6;
        const tx = this.home.x * this.w - CX * this.hs * Math.cos(this.yawNow);
        const ty = this.home.y * this.h - CY * this.hs + amp * bob;
        this.ox = approach(this.ox, tx, 0.6, dt);
        this.oy = approach(this.oy, ty, 0.6, dt);
        this.curlTarget = 1;
        break;
      }
      case 'anchored': {
        const a = this.anchor!;
        const along = clamp(this.along - (BOB_PX * this.scale * bob) / Math.max(20, a.height), 0.2, 0.86);
        // gripAt(), inline: this runs every frame.
        this.ox = a.x + a.swayAt(along, t);
        this.oy = a.y - along * a.height;
        this.curlTarget = 1;
        if (t >= this.dartNext && this.available()) this.tryDart(f);
        break;
      }
      case 'travel': {
        const tr = this.travel!;
        const p = clamp01((t - tr.t0) / tr.dur);
        const e = tr.dart ? easeDart(p) : easeSine(p);
        const destX = tr.anchor ? tr.anchor.x + tr.anchor.swayAt(tr.along, t) : tr.px;
        const destY = tr.anchor ? tr.anchor.y - tr.along * tr.anchor.height : tr.py;
        const lift = tr.lift * Math.sin(Math.PI * e);
        this.ox = tr.sx + (destX - tr.sx) * e;
        this.oy = tr.sy + (destY - tr.sy) * e - lift;
        const dir = Math.sign(destX - tr.sx) * this.faceSign();
        if (tr.dart) {
          this.pitchTarget = DART_PITCH * dir * Math.sin(Math.PI * Math.min(1, e * 1.05)) ** 0.6;
          this.curlTarget = p < 0.78 ? 0.58 : 1;
          this.finRate = Math.max(this.finRate, 1.9);
          this.finAmp = Math.max(this.finAmp, 1.6);
        } else {
          this.pitchTarget = 9 * DEG * dir * Math.sin(Math.PI * e);
          this.curlTarget = p < 0.8 ? 0.7 : 1;
          this.finRate = Math.max(this.finRate, 1.35);
          this.finAmp = Math.max(this.finAmp, 1.25);
        }
        angTarget *= 0.3;
        if (p >= 1) {
          this.travel = null;
          if (tr.anchor) {
            this.anchor = tr.anchor;
            this.along = tr.along;
            this.mode = 'anchored';
          } else {
            this.mode = 'free';
            this.snapNext = false;
            // Re-anchor on the nearest blade.
            const near = this.pick(f, { x: this.ox, y: this.oy }, null);
            if (near) this.swimTo(f, near.a, near.along, null, false);
            else this.home = { x: this.ox / Math.max(1, this.w), y: (this.oy + CY * this.hs) / Math.max(1, this.h) };
          }
          this.dartNext = t + range(this.rand, 20, 40) / rm;
        }
        break;
      }
      case 'directed': {
        const g = this.goal!;
        const w = g.stiff;
        this.vx += (w * w * (g.x - this.ox) - 2 * w * this.vx) * dt;
        this.vy += (w * w * (g.y - this.oy) - 2 * w * this.vy) * dt;
        this.ox += this.vx * dt;
        this.oy += this.vy * dt;
        this.yawTarget = g.yaw;
        this.curlTarget = g.curl;
        angTarget = g.ang + angTarget * 0.35;
        const speed = Math.hypot(this.vx, this.vy);
        if (speed > 6) {
          this.finRate = Math.max(this.finRate, 1.3);
          this.finAmp = Math.max(this.finAmp, 1.2);
        }
        break;
      }
    }

    this.ang = approach(this.ang, angTarget + this.pitchTarget, this.mode === 'travel' ? 0.12 : 0.3, dt);
    this.curl = approach(this.curl, this.curlTarget, this.curlTarget < this.curl ? 0.1 : 0.22, dt);
  }

  private tryDart(f: WorldFrame): void {
    const rm = f.lighting.reducedMotion ? 0.5 : 1;
    this.dartNext = f.t + range(this.rand, 20, 40) / rm;
    if (f.pointer.active && Math.hypot(f.pointer.x - this.x - this.par.x, f.pointer.y - this.y - this.par.y) < LOOK_R) return;
    const here = { x: this.ox, y: this.oy };
    const hp = this.homePx();
    const farFromHome = Math.hypot(hp.x - here.x, hp.y - here.y) > 70;
    const options: { a: SeagrassAnchor; along: number; d: number }[] = [];
    for (const a of f.anchors) {
      if (a === this.anchor || claimedByOther(a, this.id, f.t)) continue;
      if (this.variant === 'coral' && this.anchor?.seaFan && !a.seaFan) continue;
      const along = alongFor(a, this.hs);
      const g = gripAt(a, along, f.t);
      const d = Math.hypot(g.x - here.x, g.y - here.y);
      if (d < 36 || d > 92) continue;
      let crowded = false;
      for (const [o, c] of claims) {
        if (c.id === this.id || Math.abs(f.t - c.t) >= 1) continue;
        if (Math.abs(gripAt(o, alongFor(o, this.hs), f.t).x - g.x) < this.hs * 0.95) crowded = true;
      }
      if (!crowded) options.push({ a, along, d: Math.hypot(g.x - hp.x, g.y - hp.y) });
    }
    if (options.length) {
      options.sort((p, q) => p.d - q.d);
      const choice = farFromHome ? options[0] : options[Math.floor(this.rand() * options.length)];
      this.swimTo(f, choice.a, choice.along, null, true);
      return;
    }
    // Nowhere to land within reach: dart into open water, then settle on the nearest blade.
    const dir = farFromHome ? Math.sign(hp.x - here.x) || 1 : this.rand() < 0.5 ? -1 : 1;
    const dist = range(this.rand, 40, 80) * this.scale;
    const px = clamp(here.x + dir * dist, this.w * 0.06, this.w * 0.94);
    const py = clamp(here.y - range(this.rand, 4, 16), this.h * 0.72, this.h * 0.95);
    this.swimTo(f, null, 0.5, { x: px, y: py }, true);
  }

  // -------------------------------------------------------------------------
  // Attention: the head turns toward her finger, or now and then toward a jelly
  // -------------------------------------------------------------------------

  private updateLook(f: WorldFrame): void {
    const t = f.t;
    this.toWorld(-0.07, -0.62);
    const headX = this.wx;
    const headY = this.wy;
    const px = f.pointer.x - this.par.x;
    const py = f.pointer.y - this.par.y;
    // What it looks at, if anything (plain numbers: this runs every frame).
    let target = false;
    let targetX = 0;
    let targetY = 0;
    let pointer = false;
    if (f.pointer.active && Math.hypot(px - headX, py - headY) < LOOK_R * Math.max(1, this.scale * 0.5)) {
      target = true;
      targetX = px;
      targetY = py;
      pointer = true;
    } else if (this.lookJelly && t < this.lookUntil) {
      const jellies = f.jellies;
      let found = false;
      for (let i = 0; i < jellies.length; i++) {
        const j = jellies[i];
        if (j.id === this.lookJelly) {
          target = true;
          targetX = j.x;
          targetY = j.y;
          found = true;
          break;
        }
      }
      if (!found) this.lookJelly = null;
    } else if (t >= this.lookNext) {
      this.lookNext = t + range(this.rand, 8, 15);
      let best: (typeof f.jellies)[number] | null = null;
      let bd = Infinity;
      for (const j of f.jellies) {
        const d = Math.hypot(j.x - headX, j.y - headY);
        if (d < bd) {
          bd = d;
          best = j;
        }
      }
      if (best) {
        this.lookJelly = best.id;
        this.lookUntil = t + range(this.rand, 2.6, 4.4);
      }
    }

    const c = Math.cos(this.yawNow);
    const feeding = this.feed && this.feed.target;
    if (this.goal?.tilt != null) {
      this.tiltTarget = this.goal.tilt;
    } else if (feeding) {
      // Set by the lunge.
    } else if (target && Math.abs(c) > 0.5) {
      const fs = Math.sign(c);
      const dx = (targetX - headX) * fs;
      const dy = targetY - headY;
      const a = Math.atan2(dy, Math.max(Math.abs(dx) * 0.35, dx));
      const snout = Math.atan2(this.rest.y[0] - this.rest.y[this.rest.ki[2]], this.rest.x[0] - this.rest.x[this.rest.ki[2]]);
      this.tiltTarget = clamp(a - snout - this.ang, -TILT_MAX, TILT_MAX);
      // She is behind it: after a moment, it turns round to look.
      if (pointer && dx < -6 && this.available()) {
        if (this.behindSince < 0) this.behindSince = t;
        if (t - this.behindSince > 0.7 && t >= this.turnBlockedUntil) {
          this.yawTarget = this.yawTarget < Math.PI / 2 ? Math.PI : 0;
          this.turnBlockedUntil = t + 2.5;
          this.behindSince = -1;
        }
      } else this.behindSince = -1;
    } else {
      this.tiltTarget = 2.5 * DEG * Math.sin(t * 0.37 + this.finSeed);
      this.behindSince = -1;
    }
  }

  private updateSprings(dt: number, rm: number): void {
    // Head tilt: stiffness 60, damping 14.
    this.tiltV += (SPRING_K * (this.tiltTarget - this.tilt) - SPRING_D * this.tiltV) * dt;
    this.tilt += this.tiltV * dt;
    // Yaw (turning round): a critically damped chase.
    const wy = 8.5 * Math.max(0.7, rm);
    this.yawV += (wy * wy * (this.yawTarget - this.yawNow) - 2 * wy * this.yawV) * dt;
    this.yawNow += this.yawV * dt;
    // The happy spin: the creature spring following a short eased ramp to a full turn.
    if (this.spinT0 >= 0) {
      const p = clamp01((this.clock - this.spinT0) / SPIN_RAMP);
      const target = this.spinFrom + (this.spinGoal - this.spinFrom) * p * p * (3 - 2 * p);
      this.spinV += ((SPRING_K * (target - this.spin) - SPRING_D * this.spinV) / SPIN_MASS) * dt;
      this.spin += this.spinV * dt;
      if (p >= 1 && Math.abs(this.spin - this.spinGoal) < 0.004 && Math.abs(this.spinV) < 0.05) {
        this.spin = 0;
        this.spinV = 0;
        this.spinGoal = 0;
        this.spinT0 = -1;
      }
    }
  }

  // -------------------------------------------------------------------------
  // Feeding: brine shrimp, three snout lunges, then the happy spin
  // -------------------------------------------------------------------------

  private startFeed(f: WorldFrame): void {
    this.toWorld(this.rest.x[0], this.rest.y[0]);
    const tipX = this.wx;
    const tipY = this.wy;
    const fs = this.faceSign();
    const k = this.hs / HS_DESKTOP;
    for (let i = 0; i < SPECKS; i++) {
      this.specks.push({
        x: tipX + fs * range(this.rand, 2, 13) * k,
        y: tipY - range(this.rand, 2, 14) * k,
        vx: range(this.rand, -1.6, 1.6) * k,
        vy: range(this.rand, 3.5, 7) * k,
        age: -i * 0.06,
        life: range(this.rand, 4.2, 5.4),
        hop: range(this.rand, 0.3, 0.9),
        eaten: -1,
      });
    }
    this.feed = { t0: f.t, lunge: 0, lungeT0: -1, lx: 0, ly: 0, target: null, spinAt: f.t + FEED_FIRST + LUNGES * LUNGE_GAP + 0.12, spun: false };
  }

  cancelFeed(): void {
    this.feed = null;
  }

  private updateFeed(f: WorldFrame, dt: number): void {
    const t = f.t;
    const k = this.hs / HS_DESKTOP;
    for (let i = this.specks.length - 1; i >= 0; i--) {
      const s = this.specks[i];
      s.age += dt;
      if (s.age < 0) continue;
      if (s.eaten >= 0) {
        s.eaten += dt;
        if (s.eaten > 0.12) this.specks.splice(i, 1);
        continue;
      }
      // Brine shrimp drift down with little jerky hops.
      s.hop -= dt;
      if (s.hop <= 0) {
        s.hop = range(this.rand, 0.35, 0.9);
        s.vy -= range(this.rand, 6, 11) * k;
        s.vx += range(this.rand, -3, 3) * k;
      }
      s.vy += (range(this.rand, 4, 7) * k - s.vy) * Math.min(1, dt * 2.4);
      s.vx *= Math.exp(-dt * 1.5);
      s.x += s.vx * dt;
      s.y += s.vy * dt;
      if (s.age > s.life) this.specks.splice(i, 1);
    }

    const fd = this.feed;
    if (!fd) {
      this.lungeX = approach(this.lungeX, 0, 0.08, dt);
      this.lungeY = approach(this.lungeY, 0, 0.08, dt);
      return;
    }
    const tau = t - fd.t0;
    // Lunges at fixed beats.
    if (fd.lunge < LUNGES && tau >= FEED_FIRST + fd.lunge * LUNGE_GAP && fd.lungeT0 < 0) {
      fd.lungeT0 = t;
      fd.target = this.nearestSpeck();
      this.toWorld(this.rest.x[0], this.rest.y[0]);
      const tipX = this.wx;
      const tipY = this.wy;
      if (fd.target) {
        const fs = this.faceSign();
        let dx = ((fd.target.x - tipX) / this.hs) * fs;
        let dy = (fd.target.y - tipY) / this.hs;
        // Undo the body angle so the reach is in the seahorse's own frame.
        const ca = Math.cos(-this.ang);
        const sa = Math.sin(-this.ang);
        const rx = dx * ca - dy * sa;
        const ry = dx * sa + dy * ca;
        const len = Math.hypot(rx, ry);
        const reach = Math.min(0.16, len);
        dx = len > 1e-6 ? (rx / len) * reach : 0.1;
        dy = len > 1e-6 ? (ry / len) * reach : 0;
        fd.lx = dx;
        fd.ly = dy;
        const snout = Math.atan2(this.rest.y[0] - this.rest.y[this.rest.ki[2]], this.rest.x[0] - this.rest.x[this.rest.ki[2]]);
        this.tiltTarget = clamp(Math.atan2(ry, rx) - snout, -TILT_MAX, TILT_MAX);
      } else {
        fd.lx = 0.1;
        fd.ly = 0.02;
      }
      this.finRate = Math.max(this.finRate, 1.7);
    }
    if (fd.lungeT0 >= 0) {
      const lt = t - fd.lungeT0;
      const amt = lt < LUNGE_OUT ? easeOutCubic(lt / LUNGE_OUT) : 1 - easeSine((lt - LUNGE_OUT) / LUNGE_BACK);
      this.lungeX = fd.lx * amt;
      this.lungeY = fd.ly * amt;
      if (lt >= LUNGE_OUT && fd.target && fd.target.eaten < 0) {
        this.toWorld(this.rest.x[0] + 0, this.rest.y[0]);
        const tipX = this.wx;
        const tipY = this.wy;
        if (Math.hypot(fd.target.x - tipX, fd.target.y - tipY) < this.hs * 0.3) {
          fd.target.eaten = 0;
          fd.target.x = tipX;
          fd.target.y = tipY;
        }
        fd.target = null;
      }
      if (lt >= LUNGE_OUT + LUNGE_BACK) {
        fd.lungeT0 = -1;
        fd.lunge++;
        fd.target = null;
      }
    }
    if (!fd.spun && t >= fd.spinAt) {
      fd.spun = true;
      this.startSpin(t);
    }
    if (fd.spun && !this.spinning()) this.feed = null;
  }

  private nearestSpeck(): Speck | null {
    this.toWorld(this.rest.x[0], this.rest.y[0]);
    const tipX = this.wx;
    const tipY = this.wy;
    let best: Speck | null = null;
    let bd = Infinity;
    for (const s of this.specks) {
      if (s.eaten >= 0 || s.age < 0) continue;
      const d = Math.hypot(s.x - tipX, s.y - tipY);
      if (d < bd) {
        bd = d;
        best = s;
      }
    }
    return best;
  }

  private startSpin(t: number): void {
    this.spinT0 = t;
    this.spinFrom = this.spin;
    this.spinGoal = this.spin + TAU;
    this.spinBubbles = 0;
    this.finRate = Math.max(this.finRate, 2);
    this.finAmp = Math.max(this.finAmp, 1.7);
  }

  /** Emits the spiral of gold bubbles as the spin comes round. */
  private spinTrail(f: WorldFrame): void {
    if (this.spinT0 < 0 || this.spinBubbles >= SPIN_BUBBLES) return;
    const p = this.spin / TAU;
    const due = (this.spinBubbles + 0.6) / (SPIN_BUBBLES + 0.4);
    if (p < due) return;
    this.toWorld(this.rest.x[0], this.rest.y[0]);
    const k = this.hs / HS_DESKTOP;
    f.bubbles(this.wx + this.par.x, this.wy + this.par.y, {
      color: C.gold,
      count: 1,
      spread: 0,
      size: [1.1 * k, 1.9 * k],
      speed: [20, 28],
    });
    this.spinBubbles++;
  }

  // -------------------------------------------------------------------------
  // Pose to world
  // -------------------------------------------------------------------------

  /**
   * A local point (coil centre at the origin, facing +x) on the posed body, in world px. Written to
   * this.wx / this.wy rather than returned, so the per-frame callers allocate nothing.
   */
  private toWorld(lx: number, ly: number): void {
    const fs = Math.cos(this.yawNow);
    const spin = this.spin;
    let x = lx;
    let y = ly;
    if (spin !== 0) {
      const cs = Math.cos(spin);
      const sn = Math.sin(spin);
      const dx = x - CX;
      const dy = y - CY;
      x = CX + dx * cs - dy * sn;
      y = CY + dx * sn + dy * cs;
    }
    const ca = Math.cos(this.ang);
    const sa = Math.sin(this.ang);
    const rx = x * ca - y * sa;
    const ry = x * sa + y * ca;
    this.wx = this.ox + rx * fs * this.hs;
    this.wy = this.oy + ry * this.hs;
  }

  private ensureGeometry(): void {
    if (this.geomTick === this.ticks) return;
    this.geomTick = this.ticks;
    this.buildGeometry();
  }

  /** Builds the posed centerline, the projected outline (sides A and B) and the tail path. */
  private buildGeometry(): void {
    const R = this.rest;
    const n = R.n;
    const N = this.N;
    const { lx, ly, hd, hv, tx, ty } = this;

    // 1. Head tilt and lunge bend the neck smoothly; nothing is jointed.
    const pvx = R.x[R.ki[K_NECK]];
    const pvy = R.y[R.ki[K_NECK]];
    for (let i = 0; i < n; i++) {
      let x = R.x[i];
      let y = R.y[i];
      const wt = R.wTilt[i];
      if (wt > 0 && this.tilt !== 0) {
        const a = this.tilt * wt;
        const ca = Math.cos(a);
        const sa = Math.sin(a);
        const dx = x - pvx;
        const dy = y - pvy;
        x = pvx + dx * ca - dy * sa;
        y = pvy + dx * sa + dy * ca;
      }
      const wl = R.wLunge[i];
      if (wl > 0) {
        x += this.lungeX * wl;
        y += this.lungeY * wl;
      }
      lx[i] = x;
      ly[i] = y;
      hd[i] = R.wd[i];
      hv[i] = R.wv[i];
    }

    // 2. The tail: arc length of the log spiral, turning `curl` times as fast, so it uncurls
    // without ever stretching.
    const dth = SP_THETA / TAIL_N;
    let px = lx[n - 1];
    let py = ly[n - 1];
    const phi0 = Math.atan2(1, SP_B);
    for (let i = 1; i <= TAIL_N; i++) {
      const th = (i - 0.5) * dth;
      const r = SP_A * Math.exp(-SP_B * th);
      const ds = r * SP_S * dth;
      const phi = phi0 - this.curl * th;
      px += Math.cos(phi) * ds;
      py += Math.sin(phi) * ds;
      const j = n - 1 + i;
      lx[j] = px;
      ly[j] = py;
      const re = SP_A * Math.exp(-SP_B * i * dth);
      hd[j] = TAIL_W * re + R.tailD[i - 1];
      hv[j] = TAIL_W * re + R.tailV[i - 1];
    }

    // 3. Body pose: the roll about the middle, then the body angle about the coil.
    const spin = this.spin;
    const cs = Math.cos(spin);
    const sn = Math.sin(spin);
    const ca = Math.cos(this.ang);
    const sa = Math.sin(this.ang);
    for (let i = 0; i < N; i++) {
      let x = lx[i];
      let y = ly[i];
      if (spin !== 0) {
        const dx = x - CX;
        const dy = y - CY;
        x = CX + dx * cs - dy * sn;
        y = CY + dx * sn + dy * cs;
      }
      lx[i] = x * ca - y * sa;
      ly[i] = x * sa + y * ca;
    }
    for (let i = 0; i < N; i++) {
      const i0 = Math.max(0, i - 1);
      const i1 = Math.min(N - 1, i + 1);
      const dx = lx[i1] - lx[i0];
      const dy = ly[i1] - ly[i0];
      const l = Math.sqrt(dx * dx + dy * dy) || 1;
      tx[i] = dx / l;
      ty[i] = dy / l;
    }

    // 4. Turn about the vertical axis and project. Widths are offset in screen space around the
    // projected centerline, with the lateral thickness showing as it turns, so a seahorse seen
    // from the front is a narrow upright shape rather than a squashed one.
    const c = Math.cos(this.yawNow);
    const sY = Math.abs(Math.sin(this.yawNow));
    const hs = this.hs;
    let mxp = 0;
    let myp = -1;
    for (let i = 0; i < N; i++) {
      const sx = this.ox + lx[i] * c * hs;
      const sy = this.oy + ly[i] * hs;
      this.sx[i] = sx;
      this.sy[i] = sy;
      let Tx = tx[i] * c;
      let Ty = ty[i];
      const tl = Math.sqrt(Tx * Tx + Ty * Ty);
      let Mx: number;
      let My: number;
      if (tl < 0.08) {
        Mx = mxp;
        My = myp;
      } else {
        Tx /= tl;
        Ty /= tl;
        Mx = -Ty;
        My = Tx;
      }
      mxp = Mx;
      myp = My;
      // Dorsal normal (-ty, tx) projected.
      const k = -ty[i] * c * Mx + tx[i] * My;
      const lat = LATERAL * 0.5 * (hd[i] + hv[i]) * sY * Mx;
      const wA = k >= 0 ? hd[i] : hv[i];
      const wB = k >= 0 ? hv[i] : hd[i];
      const kA = wA * k;
      const kB = wB * k;
      const rA = Math.sqrt(kA * kA + lat * lat) * hs;
      const rB = Math.sqrt(kB * kB + lat * lat) * hs;
      this.mx[i] = Mx;
      this.my[i] = My;
      this.ax[i] = sx + Mx * rA;
      this.ay[i] = sy + My * rA;
      this.bx[i] = sx - Mx * rB;
      this.by[i] = sy - My * rB;
    }
    for (let i = 0; i <= TAIL_N; i++) {
      this.tail[i * 2] = this.sx[n - 1 + i];
      this.tail[i * 2 + 1] = this.sy[n - 1 + i];
    }
  }

  // -------------------------------------------------------------------------
  // Drawing
  // -------------------------------------------------------------------------

  private bodyPath(ctx: CanvasRenderingContext2D): void {
    const N = this.N;
    ctx.beginPath();
    ctx.moveTo(this.ax[0], this.ay[0]);
    for (let i = 1; i < N; i++) ctx.lineTo(this.ax[i], this.ay[i]);
    for (let i = N - 1; i >= 0; i--) ctx.lineTo(this.bx[i], this.by[i]);
    ctx.closePath();
  }

  /** Dorsal fin membrane and rays, in world px, into finBase / finTips (x, y pairs). */
  private finPoints(): void {
    const R = this.rest;
    const c = Math.cos(this.yawNow);
    const hs = this.hs;
    const base = this.finBase;
    const tips = this.finTips;
    const len = this.spec.shape.fin;
    for (let j = 0; j < FIN_RAYS; j++) {
      const q = j / (FIN_RAYS - 1);
      const i = Math.round(R.finA + (R.finB - R.finA) * q);
      const dx = this.tx[i];
      const dy = this.ty[i];
      // Dorsal normal and the base just inside the dorsal edge.
      const nx = -dy;
      const ny = dx;
      const bxl = this.lx[i] + nx * this.hd[i] * 0.72;
      const byl = this.ly[i] + ny * this.hd[i] * 0.72;
      const flutter = 13 * DEG * this.finAmp * Math.sin(this.finPhase - j * 0.85 + this.finSeed);
      const lean = (-14 + 62 * q) * DEG + flutter;
      const rl = len * (0.7 + 0.42 * Math.sin(Math.PI * Math.min(1, q * 1.25 + 0.12))) * (q > 0.85 ? 0.85 : 1);
      const rx = nx * Math.cos(lean) + dx * Math.sin(lean);
      const ry = ny * Math.cos(lean) + dy * Math.sin(lean);
      base[j * 2] = this.ox + bxl * c * hs;
      base[j * 2 + 1] = this.oy + byl * hs;
      tips[j * 2] = this.ox + (bxl + rx * rl) * c * hs;
      tips[j * 2 + 1] = this.oy + (byl + ry * rl) * hs;
    }
  }

  /** Pectoral fin, into pecBase / pecTips. */
  private pecPoints(): void {
    const R = this.rest;
    const c = Math.cos(this.yawNow);
    const hs = this.hs;
    const base = this.pecBase;
    const tips = this.pecTips;
    const rays = PEC_RAYS;
    for (let j = 0; j < rays; j++) {
      const q = j / (rays - 1);
      const i = R.pec + Math.round(q * 4);
      const dx = this.tx[i];
      const dy = this.ty[i];
      const nx = -dy;
      const ny = dx;
      const off = this.hd[i] * (0.15 + 0.1 * q);
      const bxl = this.lx[i] + nx * off;
      const byl = this.ly[i] + ny * off;
      const flutter = 16 * DEG * this.finAmp * Math.sin(this.finPhase * 1.05 - j * 0.9 + this.finSeed + 1.7);
      const lean = (28 + 26 * q) * DEG + flutter;
      const rl = 0.066 * (0.75 + 0.35 * Math.sin(Math.PI * q));
      const rx = nx * Math.cos(lean) + dx * Math.sin(lean);
      const ry = ny * Math.cos(lean) + dy * Math.sin(lean);
      base[j * 2] = this.ox + bxl * c * hs;
      base[j * 2 + 1] = this.oy + byl * hs;
      tips[j * 2] = this.ox + (bxl + rx * rl) * c * hs;
      tips[j * 2 + 1] = this.oy + (byl + ry * rl) * hs;
    }
  }

  private finPath(ctx: CanvasRenderingContext2D, base: Float64Array, tips: Float64Array): void {
    const m = base.length / 2;
    ctx.beginPath();
    ctx.moveTo(base[0], base[1]);
    for (let j = 1; j < m; j++) ctx.lineTo(base[j * 2], base[j * 2 + 1]);
    ctx.lineTo(tips[(m - 1) * 2], tips[(m - 1) * 2 + 1]);
    for (let j = m - 2; j >= 0; j--) {
      const x0 = tips[(j + 1) * 2];
      const y0 = tips[(j + 1) * 2 + 1];
      const x1 = tips[j * 2];
      const y1 = tips[j * 2 + 1];
      ctx.quadraticCurveTo(x0, y0, (x0 + x1) / 2, (y0 + y1) / 2);
    }
    ctx.lineTo(tips[0], tips[1]);
    ctx.closePath();
  }

  private finRays(ctx: CanvasRenderingContext2D, base: Float64Array, tips: Float64Array): void {
    ctx.beginPath();
    for (let j = 0; j < base.length / 2; j++) {
      ctx.moveTo(base[j * 2], base[j * 2 + 1]);
      ctx.lineTo(tips[j * 2], tips[j * 2 + 1]);
    }
  }

  private yNorm(f: WorldFrame): number {
    return this.specimen ? 0.8 : clamp01(this.y / Math.max(1, f.h));
  }

  private drawFull(ctx: CanvasRenderingContext2D, f: WorldFrame): void {
    const L = f.lighting;
    const yN = this.yNorm(f);
    const h01 = clamp01(this.happiness / 100);
    const t = f.t;
    const flash = envelope(t - this.flashAt);
    const wakeE = envelope(t - this.wakeAt) * this.wakeAmp;
    const night = L.biolum(yN);
    const dark = L.num('bodyDarken', yN);
    const gain = L.glowGain(yN);
    const water = L.waterAt(yN);
    const fog = this.specimen ? 0 : FOG + (this.goal && this.goal.depth < 0 ? 0.1 : 0);
    const c = Math.abs(Math.cos(this.yawNow));
    const lw = f.lineWidth;
    const sp = this.spec;

    const dL = 0.08 * h01 + 0.07 * this.bright + 0.09 * flash + 0.05 * wakeE;
    const sat = clamp(this.sat + 0.12 * this.bright, 0.4, 1.08);
    // shade(c) = mixOK(mixOK(adjusted(c, dL, sat), nightFloor, dark), water, fog), remembered per frame.
    const m = this.tones;
    const body = m.bodyFog.get(m.bodyDark.get(m.bodyAdj.get(sp.body, dL, sat), C.nightFloor, dark), water, fog);
    const ring = m.ringFog.get(m.ringDark.get(m.ringAdj.get(sp.ring, dL * 0.6, sat), C.nightFloor, dark), water, fog);
    const finCol = m.fin.get(body, '#FFFFFF', 0.3 - 0.15 * dark);
    const cx = this.x;
    const cy = this.y;

    // Glows behind the body: the night presence, the tap flash, the wake flare, the twirl.
    const hs = this.hs;
    if (night > 0.01) f.glow(sp.glow, cx, cy, hs * 1.2, gain * night * (0.1 + 0.16 * h01));
    if (flash > 0.02) f.glow(sp.glow, cx, cy, hs * 0.95, Math.max(0.35, gain) * flash * 0.7);
    if (wakeE > 0.02) f.glow(sp.glow, cx, cy, hs * 1.1, Math.max(0.2, gain) * wakeE * 0.6);
    if (this.bright > 0.02) f.glow(sp.glow, cx, cy, hs * 1.25, Math.max(0.12, gain * 0.55) * this.bright);

    // Dorsal fin first, so its root tucks under the body edge.
    this.finPoints();
    ctx.fillStyle = finCol;
    ctx.globalAlpha = 0.45 * (0.35 + 0.65 * c);
    this.finPath(ctx, this.finBase, this.finTips);
    ctx.fill();
    ctx.strokeStyle = ring;
    ctx.lineWidth = lw;
    ctx.globalAlpha = 0.5 * (0.4 + 0.6 * c);
    this.finRays(ctx, this.finBase, this.finTips);
    ctx.stroke();

    // One flat silhouette. While it holds a blade, the blade passes in front of the coil's lower
    // crossings: leaving a thin gap there lets the blade (already drawn behind) show through.
    ctx.save();
    this.clipWrap(ctx, f);
    this.clipLink(ctx);
    ctx.globalAlpha = 1;
    ctx.fillStyle = body;
    this.bodyPath(ctx);
    ctx.fill();

    // Bony rings: short ticks across the trunk and the start of the tail.
    ctx.strokeStyle = ring;
    ctx.lineWidth = lw;
    ctx.globalAlpha = 0.5;
    ctx.beginPath();
    for (const i of this.rest.rings) {
      const x0 = this.ax[i];
      const y0 = this.ay[i];
      const x1 = this.bx[i];
      const y1 = this.by[i];
      ctx.moveTo(x0 + (x1 - x0) * 0.16, y0 + (y1 - y0) * 0.16);
      ctx.lineTo(x0 + (x1 - x0) * 0.84, y0 + (y1 - y0) * 0.84);
    }
    ctx.stroke();

    // Pectoral fin over the neck, on the near side.
    if (c > 0.15) {
      this.pecPoints();
      ctx.fillStyle = finCol;
      ctx.globalAlpha = 0.45 * c;
      this.finPath(ctx, this.pecBase, this.pecTips);
      ctx.fill();
      ctx.strokeStyle = ring;
      ctx.globalAlpha = 0.4 * c;
      this.finRays(ctx, this.pecBase, this.pecTips);
      ctx.stroke();
    }

    // The eye: a pinhole through to the water behind.
    if (c > 0.3) {
      const R = this.rest;
      const i = R.eye;
      const ex = this.lx[i] - this.ty[i] * this.hd[i] * 0.2;
      const ey = this.ly[i] + this.tx[i] * this.hd[i] * 0.2;
      const cc = Math.cos(this.yawNow);
      ctx.globalAlpha = smooth(0.3, 0.6, c);
      ctx.fillStyle = water;
      ctx.beginPath();
      ctx.arc(this.ox + ex * cc * hs, this.oy + ey * hs, Math.max(1, hs / HS_DESKTOP), 0, TAU);
      ctx.fill();
    }

    // Rims: sunset light along the top edges; at night, its own hue all round.
    const sunset = L.num('rimAlpha', yN) * (1 - clamp01(dark / 0.4));
    const nightRim = night * (0.3 + 0.5 * h01);
    const flare = Math.max(wakeE, flash * 0.6);
    if (sunset > 0.01) this.rim(ctx, L.color('rim', yN), 0.55 * (1 - fog) * sunset, 0.25, lw);
    if (nightRim + flare * (1 - sunset) > 0.01) {
      const hue = m.hue.get(sp.glow, '#FFFFFF', 0.3);
      this.rim(ctx, hue, Math.min(1, nightRim + flare * 0.8), -1, lw);
    }

    ctx.restore();
    ctx.globalAlpha = 1;
    this.drawSpecks(ctx, dark);
    this.spinTrail(f);
  }

  /**
   * Clips out a band along the anchoring blade from just below the coil's eye to below the coil,
   * so each turn of the tail passes behind the blade at the bottom and in front of it at the top.
   * The band stays inside the narrowest blade the reef draws, so only the blade shows through.
   */
  private clipWrap(ctx: CanvasRenderingContext2D, f: WorldFrame): void {
    const a = this.anchor;
    // Sea-fan branches are finer than any gap worth cutting; the coil simply rests in front.
    if (!a || a.seaFan || this.wrap < 0.05 || this.mode !== 'anchored') return;
    const hs = this.hs;
    const h = Math.max(1, a.height);
    // The coil's eye sits on the blade at this.along (moved by the bob); recover it from the pose.
    const eyeAlong = clamp((a.y - this.oy) / h, 0, 1);
    const a0 = Math.max(0, eyeAlong - (0.035 * hs) / h);
    const a1 = Math.max(0, eyeAlong - (0.4 * hs) / h);
    const STEPS = WRAP_STEPS;
    const lx = WRAP_LX;
    const ly = WRAP_LY;
    const rx = WRAP_RX;
    const ry = WRAP_RY;
    for (let i = 0; i <= STEPS; i++) {
      const al = a0 + ((a1 - a0) * i) / STEPS;
      // Two grip points along the blade (gripAt, inline).
      const aq = Math.min(1, al + 0.02);
      const px = a.x + a.swayAt(al, f.t);
      const py = a.y - al * a.height;
      const dx = a.x + a.swayAt(aq, f.t) - px;
      const dy = a.y - aq * a.height - py;
      const l = Math.sqrt(dx * dx + dy * dy) || 1;
      const hw = this.wrap * 0.85 * (1.445 * Math.pow(1 - al, 0.7) + 0.15);
      lx[i] = px - (dy / l) * hw;
      ly[i] = py + (dx / l) * hw;
      rx[i] = px + (dy / l) * hw;
      ry[i] = py - (dx / l) * hw;
    }
    ctx.beginPath();
    ctx.rect(-1e4, -1e4, 2e4, 2e4);
    ctx.moveTo(lx[0], ly[0]);
    for (let i = 1; i <= STEPS; i++) ctx.lineTo(lx[i], ly[i]);
    for (let i = STEPS; i >= 0; i--) ctx.lineTo(rx[i], ry[i]);
    ctx.closePath();
    ctx.clip('evenodd');
  }

  /**
   * Linked tails: where the partner's tail should pass in front of this one, leave a gap a little
   * narrower than the partner's tail. Whichever of the two is drawn on top, the crossing then
   * shows the right strand in front, so the tails read as woven together. Crossings alternate
   * over and under along the tail of the one marked `over`, so both agree on every crossing.
   */
  private clipLink(ctx: CanvasRenderingContext2D): void {
    const g = this.goal;
    const pt = g?.partner;
    if (!g || !pt) return;
    // Mid-turn (seen end-on) the strands swap sides too fast to weave; let them pass.
    if (Math.abs(Math.cos(this.yawNow)) < 0.9 || Math.abs(Math.cos(pt.yaw())) < 0.9) return;
    const P = pt.tailPath();
    const M = this.tail;
    const n = TAIL_N;
    let hits = 0;
    for (let i = 0; i < n; i++) {
      const ax = M[i * 2];
      const ay = M[i * 2 + 1];
      const bx = M[i * 2 + 2];
      const by = M[i * 2 + 3];
      const minX = Math.min(ax, bx);
      const maxX = Math.max(ax, bx);
      const minY = Math.min(ay, by);
      const maxY = Math.max(ay, by);
      for (let j = 0; j < n; j++) {
        const cx = P[j * 2];
        const cy = P[j * 2 + 1];
        const dx = P[j * 2 + 2];
        const dy = P[j * 2 + 3];
        if (Math.max(cx, dx) < minX || Math.min(cx, dx) > maxX || Math.max(cy, dy) < minY || Math.min(cy, dy) > maxY) continue;
        const rx = bx - ax;
        const ry = by - ay;
        const sx = dx - cx;
        const sy = dy - cy;
        const den = rx * sy - ry * sx;
        if (Math.abs(den) < 1e-9) continue;
        const qx = cx - ax;
        const qy = cy - ay;
        const u = (qx * sy - qy * sx) / den;
        const v = (qx * ry - qy * rx) / den;
        if (u < 0 || u > 1 || v < 0 || v > 1) continue;
        if (hits === linkKey.length) growLinkHits();
        linkKey[hits] = g.over ? i : j;
        linkJ[hits] = j;
        linkX[hits] = ax + rx * u;
        linkY[hits] = ay + ry * u;
        hits++;
      }
    }
    if (!hits) return;
    // Crossings in key order; insertion sort keeps equal keys in the order found (a stable sort).
    const order = linkOrder;
    for (let k = 0; k < hits; k++) {
      const h = k;
      let m = k - 1;
      while (m >= 0 && linkKey[order[m]] > linkKey[h]) {
        order[m + 1] = order[m];
        m--;
      }
      order[m + 1] = h;
    }
    const lx = STRAND_LX;
    const ly = STRAND_LY;
    const rx = STRAND_RX;
    const ry = STRAND_RY;
    for (let k = 0; k < hits; k++) {
      const partnerOnTop = g.over ? k % 2 === 0 : k % 2 === 1;
      if (!partnerOnTop) continue;
      const h = order[k];
      const hj = linkJ[h];
      const hx = linkX[h];
      const hy = linkY[h];
      // The partner's strand around the crossing, far enough to clear this tail's width.
      const reach = TAIL_W * SP_A * this.hs * 1.6 + 2;
      let j0 = hj;
      const reach2 = reach * reach;
      while (j0 > 0 && (P[j0 * 2] - hx) ** 2 + (P[j0 * 2 + 1] - hy) ** 2 < reach2) j0--;
      let j1 = hj + 1;
      while (j1 < n && (P[j1 * 2] - hx) ** 2 + (P[j1 * 2 + 1] - hy) ** 2 < reach2) j1++;
      let m = 0;
      for (let j = j0; j <= j1; j++) {
        const pa = Math.max(0, j - 1);
        const pb = Math.min(n, j + 1);
        const tx = P[pb * 2] - P[pa * 2];
        const ty = P[pb * 2 + 1] - P[pa * 2 + 1];
        const l = Math.sqrt(tx * tx + ty * ty) || 1;
        const hw = 0.78 * pt.tailHalfWidth(j);
        lx[m] = P[j * 2] - (ty / l) * hw;
        ly[m] = P[j * 2 + 1] + (tx / l) * hw;
        rx[m] = P[j * 2] + (ty / l) * hw;
        ry[m] = P[j * 2 + 1] - (tx / l) * hw;
        m++;
      }
      ctx.beginPath();
      ctx.rect(-1e4, -1e4, 2e4, 2e4);
      ctx.moveTo(lx[0], ly[0]);
      for (let q = 1; q < m; q++) ctx.lineTo(lx[q], ly[q]);
      for (let q = m - 1; q >= 0; q--) ctx.lineTo(rx[q], ry[q]);
      ctx.closePath();
      ctx.clip('evenodd');
    }
  }

  /** Strokes the outline where it faces up more than `minUp` (-1 for all round), stronger on top. */
  private rim(ctx: CanvasRenderingContext2D, color: string, alpha: number, minUp: number, lw: number): void {
    const N = this.N;
    ctx.strokeStyle = color;
    ctx.lineWidth = lw;
    for (let pass = 0; pass < 2; pass++) {
      const thr = minUp < -0.99 ? (pass === 0 ? -1.01 : 0.15) : pass === 0 ? minUp : minUp + 0.35;
      ctx.globalAlpha = alpha * (pass === 0 ? 0.55 : 0.45);
      ctx.beginPath();
      for (let si = 0; si < 2; si++) {
        const side = si === 0 ? 1 : -1;
        let on = false;
        for (let i = 0; i < N; i++) {
          const up = -this.my[i] * side;
          const x = side > 0 ? this.ax[i] : this.bx[i];
          const y = side > 0 ? this.ay[i] : this.by[i];
          if (up > thr) {
            if (on) ctx.lineTo(x, y);
            else ctx.moveTo(x, y);
            on = true;
          } else on = false;
        }
      }
      ctx.stroke();
    }
  }

  private drawSpecks(ctx: CanvasRenderingContext2D, dark: number): void {
    if (!this.specks.length) return;
    const col = this.tones.speck.get(C.gold, C.nightFloor, dark * 0.5);
    const k = Math.max(1, this.hs / HS_DESKTOP);
    ctx.fillStyle = col;
    for (const s of this.specks) {
      if (s.age < 0) continue;
      const a = s.eaten >= 0 ? 1 - s.eaten / 0.12 : Math.min(1, s.age / 0.15) * Math.min(1, (s.life - s.age) / 0.8);
      if (a <= 0) continue;
      ctx.globalAlpha = a;
      ctx.fillRect(s.x - k, s.y - k, 2 * k, 2 * k);
    }
    ctx.globalAlpha = 1;
  }

  private drawOutline(ctx: CanvasRenderingContext2D, f: WorldFrame, color: string): void {
    const lw = f.lineWidth;
    ctx.strokeStyle = color;
    ctx.lineWidth = lw;
    ctx.globalAlpha = 0.55;
    this.bodyPath(ctx);
    ctx.stroke();
    ctx.globalAlpha = 0.4;
    this.finPoints();
    this.finPath(ctx, this.finBase, this.finTips);
    ctx.stroke();
    ctx.globalAlpha = 1;
  }

  // -------------------------------------------------------------------------
  // The director's handle
  // -------------------------------------------------------------------------

  private handle(): SeahorseHandle {
    const self = this;
    return {
      id: this.id,
      hs: () => self.hs,
      origin: () => ({ x: self.ox, y: self.oy }),
      yaw: () => self.yawNow,
      available: () => self.available(),
      feeding: () => !!self.feed,
      spinning: () => self.spinning(),
      satNow: () => self.sat,
      direct(goal: Goal) {
        if (self.mode !== 'directed') {
          self.vx = 0;
          self.vy = 0;
          if (self.anchor) claims.delete(self.anchor);
          self.anchor = null;
          self.travel = null;
          self.feed = null;
          self.mode = 'directed';
        }
        self.goal = goal;
      },
      release() {
        if (self.mode !== 'directed') return;
        self.goal = null;
        self.mode = 'free';
        self.snapNext = false;
      },
      cancelFeed: () => self.cancelFeed(),
      tailPath: () => {
        self.ensureGeometry();
        return self.tail;
      },
      tailHalfWidth: (i: number) => TAIL_W * SP_A * Math.exp((-SP_B * SP_THETA * i) / TAIL_N) * self.hs,
      depth: () => self.goal?.depth ?? 0,
    };
  }
}

/** Creates one seahorse (coral, gold or lilac). */
export const createSeahorse: CreatureFactory = (init) => new Seahorse(init);

// ---------------------------------------------------------------------------
// The pair: morning greeting, idle tail-link, courtship twirl
// ---------------------------------------------------------------------------

type ActKind = 'greeting' | 'link' | 'twirl';

interface Act {
  kind: ActKind;
  a: SeahorseHandle;
  b: SeahorseHandle;
  phase: string;
  pt0: number;
  /** Where each started, and the meeting point. */
  a0: { x: number; y: number };
  b0: { x: number; y: number };
  mx: number;
  my: number;
  /** Promenade direction. */
  dir: number;
  dur: number;
  satFrom: number;
}

const IDLE_LINK_AFTER = 120;
const IDLE_LINK_AGAIN = 240;
const LINK_HOLD = 6;
const TWIRL_WINDOW = 10;
const ORBIT_TIME = 2.4;
const PROMENADE = 120;
const PROMENADE_TIME = 6;
/**
 * Linked tails. Facing each other, half a body-width apart and leaning back a little, with the
 * tails let out to this curl, the two tails cross at the bottom and hook over each other's tips:
 * together they draw a small heart.
 */
const HEART_DX = 0.19;
const HEART_CURL = 0.57;
const HEART_LEAN = -6 * DEG;
/** Promenade: nose to tail, the one behind reaches forward under the leader and hooks into its coil. */
const PROM_DX = 0.27;
const PROM_CURL_LEAD = 0.8;
const PROM_CURL_FOLLOW = 0.42;

class Director implements SeahorseDirector {
  private act: Act | null = null;
  private readonly fed = new Map<string, number>();
  private idleArmed = IDLE_LINK_AFTER;

  get greeting(): boolean {
    return this.act?.kind === 'greeting';
  }

  noteFed(id: string, f: WorldFrame): void {
    this.fed.set(id, f.t);
  }

  startGreeting(seahorses: CreatureEntity[], f: WorldFrame): boolean {
    const pair = this.pair(seahorses, false);
    if (!pair) return false;
    this.end(f);
    this.begin('greeting', pair[0], pair[1], f);
    return true;
  }

  update(seahorses: CreatureEntity[], f: WorldFrame, idleSeconds: number): void {
    // Courtship: two different seahorses fed within 10s of each other.
    if (!this.act && this.fed.size >= 2) {
      const recent = [...this.fed.entries()].filter(([, t]) => f.t - t <= TWIRL_WINDOW).sort((p, q) => q[1] - p[1]);
      if (recent.length >= 2) {
        const ha = seahorses.map((e) => handles.get(e)).filter((h): h is SeahorseHandle => !!h);
        const a = ha.find((h) => h.id === recent[0][0]);
        const b = ha.find((h) => h.id === recent[1][0]);
        if (a && b) {
          this.fed.clear();
          this.begin('twirl', a, b, f);
        }
      }
    }
    if (this.fed.size) for (const [id, t] of this.fed) if (f.t - t > TWIRL_WINDOW) this.fed.delete(id);

    // Idle tail-link after two quiet minutes (and again every four while it stays quiet).
    if (idleSeconds < IDLE_LINK_AFTER) this.idleArmed = IDLE_LINK_AFTER;
    if (!this.act && idleSeconds >= this.idleArmed) {
      const pair = this.pair(seahorses, true);
      if (pair) {
        this.idleArmed = idleSeconds + IDLE_LINK_AGAIN;
        this.begin('link', pair[0], pair[1], f);
      }
    }

    if (this.act) this.step(this.act, seahorses, f);
  }

  private pair(seahorses: CreatureEntity[], needIdle: boolean): [SeahorseHandle, SeahorseHandle] | null {
    const hs = seahorses.map((e) => handles.get(e)).filter((h): h is SeahorseHandle => !!h);
    if (hs.length < 2) return null;
    const [a, b] = hs;
    if (needIdle && (!a.available() || !b.available())) return null;
    return [a, b];
  }

  private begin(kind: ActKind, a: SeahorseHandle, b: SeahorseHandle, f: WorldFrame): void {
    const pa = a.origin();
    const pb = b.origin();
    // The left one is A: it faces right in the heart.
    const [l, r, l0, r0] = pa.x <= pb.x ? [a, b, pa, pb] : [b, a, pb, pa];
    const hs = l.hs();
    let mx = (l0.x + r0.x) / 2;
    const my = Math.min(l0.y, r0.y) - hs * (kind === 'twirl' ? 0.55 : 0.3);
    const w = f.w;
    mx = clamp(mx, w * 0.1 + hs * 0.6, w * 0.9 - hs * 0.6);
    let dir = mx < w / 2 ? 1 : -1;
    if (kind === 'greeting') {
      const end = mx + dir * PROMENADE * 0.5;
      if (end < w * 0.08 + hs || end > w * 0.92 - hs) dir = -dir;
      mx -= dir * PROMENADE * 0.5 * 0.5;
    }
    const dist = Math.max(Math.hypot(l0.x - mx, l0.y - my), Math.hypot(r0.x - mx, r0.y - my));
    const gather = kind === 'twirl' ? clamp(dist / 60, 0.9, 2.2) : clamp(dist / SWIM_SPEED, 2.2, 9);
    this.act = {
      kind,
      a: l,
      b: r,
      phase: kind === 'twirl' ? 'wait' : 'gather',
      pt0: f.t,
      a0: l0,
      b0: r0,
      mx,
      my,
      dir,
      dur: gather,
      satFrom: Math.min(l.satNow(), r.satNow()),
    };
  }

  private next(act: Act, phase: string, f: WorldFrame, dur: number): void {
    act.phase = phase;
    act.pt0 = f.t;
    act.dur = dur;
    act.a0 = act.a.origin();
    act.b0 = act.b.origin();
  }

  private end(f: WorldFrame): void {
    const act = this.act;
    if (!act) return;
    act.a.release();
    act.b.release();
    this.act = null;
    void f;
  }

  /** Heart formation: facing each other, tails meeting below. */
  private heart(act: Act, hs: number): { a: { x: number; y: number }; b: { x: number; y: number } } {
    const dx = HEART_DX * hs;
    return { a: { x: act.mx - dx, y: act.my }, b: { x: act.mx + dx, y: act.my } };
  }

  private goal(x: number, y: number, yaw: number, extra: Partial<Goal> = {}): Goal {
    return {
      x,
      y,
      yaw,
      curl: 1,
      ang: 0,
      tilt: null,
      stiff: 7,
      sat: null,
      bright: 0,
      depth: 0,
      partner: null,
      over: false,
      ...extra,
    };
  }

  private step(act: Act, seahorses: CreatureEntity[], f: WorldFrame): void {
    const { a, b } = act;
    const hs = a.hs();
    const p = clamp01((f.t - act.pt0) / act.dur);
    const yawA = 0;
    const yawB = Math.PI;
    const lerp = (p0: { x: number; y: number }, p1: { x: number; y: number }, e: number) => ({ x: p0.x + (p1.x - p0.x) * e, y: p0.y + (p1.y - p0.y) * e });

    if (act.kind === 'twirl') {
      if (act.phase === 'wait') {
        a.cancelFeed();
        b.cancelFeed();
        if (!a.spinning() && !b.spinning()) this.next(act, 'converge', f, act.dur);
        return;
      }
      const R = 0.42 * hs;
      if (act.phase === 'converge') {
        const e = easeSine(p);
        const pa = lerp(act.a0, { x: act.mx - R, y: act.my }, e);
        const pb = lerp(act.b0, { x: act.mx + R, y: act.my }, e);
        a.direct(this.goal(pa.x, pa.y, yawA, { curl: 0.72, stiff: 9, bright: 0.3 * e, sat: 1 }));
        b.direct(this.goal(pb.x, pb.y, yawB, { curl: 0.72, stiff: 9, bright: 0.3 * e, sat: 1 }));
        if (p >= 1) this.next(act, 'orbit', f, ORBIT_TIME);
        return;
      }
      if (act.phase === 'orbit') {
        const e = easeSine(p);
        const al = Math.PI + TAU * e;
        const place = (h: SeahorseHandle, ang: number) => {
          const depth = -Math.sin(ang);
          h.direct(
            this.goal(act.mx + R * Math.cos(ang), act.my - 0.1 * R * Math.sin(ang) - Math.sin(Math.PI * e) * 0.18 * hs, ang + Math.PI, {
              curl: 0.72,
              stiff: 14,
              bright: 0.3 + 0.7 * Math.sin(Math.PI * Math.min(1, e * 1.4)) ** 0.5,
              sat: 1,
              depth,
            }),
          );
        };
        place(a, al);
        place(b, al + Math.PI);
        this.order(seahorses);
        if (p >= 1) this.next(act, 'part', f, 0.9);
        return;
      }
      // part
      a.direct(this.goal(act.mx - R * 1.2, act.my, TAU, { curl: 0.85, bright: 0.4 * (1 - p), sat: 1 }));
      b.direct(this.goal(act.mx + R * 1.2, act.my, Math.PI + TAU, { curl: 0.85, bright: 0.4 * (1 - p), sat: 1 }));
      if (p >= 1) this.end(f);
      return;
    }

    // Greeting and idle link share the gather and the heart.
    const greet = act.kind === 'greeting';
    const heart = this.heart(act, hs);
    const satAt = (v: number) => (greet ? v : null);
    if (act.phase === 'gather') {
      const e = easeSine(p);
      const pa = lerp(act.a0, heart.a, e);
      const pb = lerp(act.b0, heart.b, e);
      const s = act.satFrom + (0.7 - act.satFrom) * e;
      // Tails reach for each other as they arrive, and weave once they touch.
      const near = p > 0.7;
      const lean = HEART_LEAN * smooth(0.6, 1, p);
      a.direct(this.goal(pa.x, pa.y, yawA, { curl: near ? HEART_CURL : 0.72, ang: lean, sat: satAt(s), partner: near ? b : null, over: true }));
      b.direct(this.goal(pb.x, pb.y, yawB, { curl: near ? HEART_CURL : 0.72, ang: lean, sat: satAt(s), partner: near ? a : null, over: false }));
      if (p >= 1) this.next(act, 'link', f, greet ? 1.8 : LINK_HOLD);
      return;
    }
    if (act.phase === 'link') {
      const s = 0.7 + 0.08 * p;
      const sway = Math.sin(f.t * 0.9) * 1.5;
      const tilt = -6 * DEG * Math.sin(Math.PI * Math.min(1, p * 2));
      // Linked, they warm a little: light, not motion.
      const link = { sat: satAt(s), tilt, ang: HEART_LEAN, curl: HEART_CURL, bright: (greet ? 0.3 : 0.15) * smooth(0, 1, p * 2) };
      a.direct(this.goal(heart.a.x, heart.a.y + sway, yawA, { ...link, partner: b, over: true }));
      b.direct(this.goal(heart.b.x, heart.b.y + sway, yawB, { ...link, partner: a, over: false }));
      if (p >= 1) {
        if (greet) this.next(act, 'promenade', f, PROMENADE_TIME);
        else this.next(act, 'part', f, 1.2);
      }
      return;
    }
    if (act.phase === 'promenade') {
      // Side by side, both facing the way they go. The one already on that side turns round and
      // leads, a little nearer; the other follows with its tail hooked into the leader's coil.
      const e = easeSine(p);
      const turn = smooth(0, 0.12, p);
      const yaw = act.dir > 0 ? 0 : Math.PI;
      const cx = act.mx + act.dir * PROMENADE * e;
      const cy = act.my - Math.sin(Math.PI * e) * 8;
      const lead = act.dir > 0 ? b : a;
      const follow = lead === a ? b : a;
      const off = PROM_DX * hs;
      const s = 0.78 + 0.22 * e;
      const fromL = lead === a ? heart.a : heart.b;
      const fromF = follow === a ? heart.a : heart.b;
      const lp = lerp(fromL, { x: cx + act.dir * off, y: cy - 0.05 * hs }, turn);
      const fp = lerp(fromF, { x: cx - act.dir * off, y: cy }, turn);
      const ly0 = lead === a ? yawA : yawB;
      const fy0 = follow === a ? yawA : yawB;
      const linked = turn >= 1;
      const lean = HEART_LEAN * (1 - turn);
      lead.direct(
        this.goal(lp.x, lp.y, ly0 + (yaw - ly0) * turn, {
          sat: s, depth: 1, partner: linked ? follow : null, over: true, stiff: 9, ang: lean, bright: 0.3,
          curl: linked ? PROM_CURL_LEAD : 0.85,
        }),
      );
      follow.direct(
        this.goal(fp.x, fp.y, fy0 + (yaw - fy0) * turn, {
          sat: s, depth: -1, partner: linked ? lead : null, over: false, stiff: 9, ang: lean, bright: 0.3,
          curl: linked ? PROM_CURL_FOLLOW : 0.85,
        }),
      );
      this.order(seahorses);
      if (p >= 1) this.next(act, 'part', f, 1.2);
      return;
    }
    // part: tails let go, a little space, then each swims home.
    const ga = a.origin();
    const gb = b.origin();
    const yA = a.yaw();
    const yB = b.yaw();
    const glow = (greet ? 0.3 : 0.15) * (1 - p);
    a.direct(this.goal(ga.x + (ga.x <= gb.x ? -6 : 6), ga.y, yA, { curl: 0.8, sat: greet ? 1 : null, bright: glow }));
    b.direct(this.goal(gb.x + (gb.x < ga.x ? -6 : 6), gb.y, yB, { curl: 0.8, sat: greet ? 1 : null, bright: glow }));
    if (p >= 1) this.end(f);
  }

  /** Draw order follows depth while the pair moves in front of and behind each other. */
  private order(seahorses: CreatureEntity[]): void {
    const depth = (e: CreatureEntity) => handles.get(e)?.depth() ?? 0;
    let sorted = true;
    for (let i = 1; i < seahorses.length; i++) if (depth(seahorses[i - 1]) > depth(seahorses[i])) sorted = false;
    if (!sorted) seahorses.sort((p, q) => depth(p) - depth(q));
  }
}

/** Creates the director that plays the pair's shared behaviours. */
export function createSeahorseDirector(): SeahorseDirector {
  return new Director();
}
