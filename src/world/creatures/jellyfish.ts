/**
 * Jellyfish (Dreamers): Moon (Aurelia), Dream (Atolla), Sunset (Pelagia) and the gift-only
 * Ribbon (Chrysaora). Drawn the way a natural-history illustrator draws them: flat translucent
 * shapes with correct anatomy and no faces. The bell is a surface of revolution seen slightly
 * from above, so canals, gonads and stripes foreshorten with it. Happiness shows only as light
 * (lit rim lanterns, glow) and pulse rate.
 */
import type { CreatureEntity, CreatureFactory, CreatureInit, DrawStyle, JellyVariant, WorldFrame } from '../types';
import { C, mixOK } from '../palette';
import { candle, envelope } from '../light';
import { hashString, mulberry32, range, valueNoise1D, type Rand } from '../rng';
import { artFor, drawArt, sceneTint, tinted, type ArtImage } from '../art';

const TAU = Math.PI * 2;
/** Margin ellipse ry / rx: the bell is seen about 10 degrees from above. */
const E = 0.18;
const CA = Math.sqrt(1 - E * E);
const NODES = 12;
const GRAVITY = 6;
const OMEGA = TAU * 0.7;
const CONTRACT = 0.35;
const RELAX = 1.2;
const IMPULSE = 18;
const SINK = 4;
const DRAG_TAU = 2.6;
const MAX_SPEED = 19;
const BAND_TOP = 0.14;
const BAND_BOTTOM = 0.72;
const CEILING = 0.1;
/** Profile samples (apex to margin) and silhouette samples (left to right). */
const U = 20;
const M = 23;
const LANTERNS = 16;
const LANTERN_STEP = 0.04;
const CASCADE_SPEED = 220;
const PINWHEEL_TIME = 1.6;
const SPARKLE_SPREAD = 1.2;
const RIBBON_RUN_TIME = 1.1;
const WARTS = 30;
/** Shop plates: the specimen (bell top to longest tentacle) fills this much of its box. */
const SPECIMEN_FILL = 0.76;
/** Phone layout (w < 640): bells read larger on a 402px screen held close (a moon jelly ~80px across). */
const PHONE_SCALE = 1.25;

type Display = 'cascade' | 'pinwheel' | 'sparkle' | 'ribbon';
type Mark = 'gonads' | 'groove' | 'warts' | 'stripes';

interface TentacleSpec {
  count: number;
  /** Length in multiples of R. */
  len: number;
  /** Line width in CSS px at full size (never below f.lineWidth). */
  width: number;
  alpha: number;
  /** Pull toward the rest pose (1/s^2), strongest at the root. */
  stiff: number;
  /** Rest angle from straight down, outward (rad), and extra bend toward the tip. */
  splay: number;
  curl: number;
  /** Lateral sine displacement scale (1 = the brief's 2px root to 7px tip). */
  amp: number;
  /** Fixed azimuth for a single tentacle (Atolla's trailing one). */
  at?: number;
}

interface ArmSpec {
  len: number;
  width: number;
  color: string;
  alpha: number;
  /** Outward rest angle (rad) so the four arms read apart. */
  splay: number;
  /** Ruffle on the ribbon edge (frilly lips), 0 for smooth ribbons. */
  frill: number;
}

interface Species {
  bell: string;
  /** Night rim, glow and bubble hue. */
  hue: string;
  /** Rim lantern and display light. */
  lantern: string;
  bellAlpha: number;
  /** Bell height H as a multiple of R, and the profile bezier shape. */
  h: number;
  p1x: number;
  p2x: number;
  p2y: number;
  tentacles: TentacleSpec[];
  arms: ArmSpec;
  mark: Mark;
  display: Display;
  canalAlpha: number;
}

const SPECIES: Record<JellyVariant, Species> = {
  // Aurelia aurita: a saucer with a fine fringe, four short frilly arms and four horseshoe gonads.
  cyan: {
    bell: C.moonBell,
    hue: C.biolum,
    lantern: C.biolumCore,
    bellAlpha: 0.32,
    h: 0.45,
    p1x: 0.66,
    p2x: 1,
    p2y: 0.38,
    tentacles: [{ count: 16, len: 0.8, width: 0.8, alpha: 0.42, stiff: 6, splay: 0.3, curl: 0.35, amp: 0.55 }],
    arms: { len: 1.2, width: 0.24, color: '#D2FAF6', alpha: 0.36, splay: 0.07, frill: 0.55 },
    mark: 'gonads',
    display: 'cascade',
    canalAlpha: 0.3,
  },
  // Atolla wyvillei: a flat disc with a coronal groove, a crown of short stiff tentacles and
  // one long trailing tentacle.
  lilac: {
    bell: C.lilac,
    hue: C.lilac,
    lantern: C.lilacLight,
    bellAlpha: 0.33,
    h: 0.4,
    p1x: 0.4,
    p2x: 0.96,
    p2y: 0.36,
    tentacles: [
      { count: 22, len: 0.55, width: 0.9, alpha: 0.5, stiff: 10, splay: 1.15, curl: 0.75, amp: 0.25 },
      { count: 1, len: 2.4, width: 1.25, alpha: 0.55, stiff: 0.5, splay: 0.12, curl: 0, amp: 1, at: 1.95 },
    ],
    // Atolla's manubrium is short and hidden in the bell: no oral arms to draw.
    arms: { len: 0, width: 0, color: C.lilacLight, alpha: 0, splay: 0, frill: 0 },
    mark: 'groove',
    display: 'pinwheel',
    canalAlpha: 0.22,
  },
  // Pelagia noctiluca: a tall warty bell, eight long tentacles and four long coral arms.
  gold: {
    bell: C.sunsetBell,
    hue: C.sunsetBell,
    lantern: C.wart,
    bellAlpha: 0.35,
    h: 0.9,
    p1x: 0.6,
    p2x: 1,
    p2y: 0.62,
    tentacles: [{ count: 8, len: 2.7, width: 1.05, alpha: 0.48, stiff: 1.1, splay: 0.22, curl: 0, amp: 1 }],
    arms: { len: 2.1, width: 0.2, color: C.coral, alpha: 0.5, splay: 0.16, frill: 0.4 },
    mark: 'warts',
    display: 'sparkle',
    canalAlpha: 0.22,
  },
  // Chrysaora: a striped coral bell, eight marginal tentacles and four long gold ribbons.
  ribbon: {
    bell: C.coral,
    hue: C.coral,
    lantern: C.lantern,
    bellAlpha: 0.32,
    h: 0.7,
    p1x: 0.58,
    p2x: 1,
    p2y: 0.5,
    tentacles: [{ count: 8, len: 2.6, width: 0.95, alpha: 0.44, stiff: 0.9, splay: 0.28, curl: 0, amp: 1 }],
    arms: { len: 3.5, width: 0.19, color: '#F6D47E', alpha: 0.55, splay: 0.24, frill: 0.18 },
    mark: 'stripes',
    display: 'ribbon',
    canalAlpha: 0.2,
  },
};

interface Chain {
  /** Index of the tentacle spec this chain came from (arms: -1); drawn in one batch per group. */
  group: number;
  theta: number;
  /** Root radius as a fraction of the margin radius, and root height as a fraction of H. */
  rootR: number;
  rootY: number;
  width: number;
  alpha: number;
  stiff: number;
  amp: number;
  phase: number;
  /** Arms: phase offset of the ribbon twist. */
  twist: number;
  x: Float32Array;
  y: Float32Array;
  px: Float32Array;
  py: Float32Array;
  /** Rest pose offsets from the root (bell frame, untilted), and segment lengths. */
  rest: Float32Array;
  seg: Float32Array;
  /** Total rest length in px. */
  len: number;
}

const clamp = (v: number, a: number, b: number) => (v < a ? a : v > b ? b : v);
const clamp01 = (v: number) => clamp(v, 0, 1);
const easeOutCubic = (s: number) => 1 - (1 - s) ** 3;
const easeInOutSine = (s: number) => 0.5 - 0.5 * Math.cos(Math.PI * s);

function bez(a: number, b: number, c: number, d: number, u: number): number {
  const m = 1 - u;
  return m * m * m * a + 3 * m * m * u * b + 3 * m * u * u * c + u * u * u * d;
}

/**
 * The last call of one mixOK() expression, remembered. mixOK quantizes t to 1/128 and passes the
 * ends through, so equal quantized inputs give the identical string: steady frames reuse it
 * without building a cache key.
 */
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

/** body(c) = mixOK(mixOK(c, nightFloor, dark), water, fog) for one call site, remembered. */
class BodyTone {
  private readonly dk = new MixMemo();
  private readonly fg = new MixMemo();
  get(c: string, dark: number, water: string, fog: number): string {
    return this.fg.get(this.dk.get(c, C.nightFloor, dark), water, fog);
  }
}

/** Tentacle alpha runs (first node, last node, alpha), drawn with butt caps. */
const RUN_I0 = [1, 5, 9];
const RUN_I1 = [4, 8, NODES - 2];
const RUN_A = [1, 0.62, 0.3];
/** Lantern layers, halo to core: radius and alpha (the core uses the lighter core colour). */
const LANTERN_RAD = [2.9, 1.8, 1.2];
const LANTERN_A = [0.09, 0.22, 1];

/** Bell radius that fits the whole figure of a species into a w x h shop plate. */
function specimenRadius(sp: Species, w: number, h: number): number {
  let reach = sp.arms.len;
  let side = 0.2;
  for (const t of sp.tentacles) {
    reach = Math.max(reach, t.len);
    side = Math.max(side, t.len * Math.sin(Math.min(Math.PI / 2, t.splay + t.curl)) * 0.9);
  }
  const tall = sp.h * CA * 1.12 + E + reach * 0.92;
  const wide = 2 + 2 * side;
  return Math.min((SPECIMEN_FILL * h) / tall, (SPECIMEN_FILL * w) / wide);
}

/** Bit-reversed index, so the first n lanterns of this order are spread evenly round the rim. */
function bitrev4(k: number): number {
  return ((k & 1) << 3) | ((k & 2) << 1) | ((k & 4) >> 1) | ((k & 8) >> 3);
}

/** Traces a midpoint-quadratic curve through chain nodes, pieces i0..i1 (1-based). */
function traceRun(ctx: CanvasRenderingContext2D, x: Float32Array, y: Float32Array, i0: number, i1: number, n: number) {
  if (i0 === 1) ctx.moveTo(x[0], y[0]);
  else ctx.moveTo((x[i0 - 1] + x[i0]) / 2, (y[i0 - 1] + y[i0]) / 2);
  for (let i = i0; i <= i1; i++) ctx.quadraticCurveTo(x[i], y[i], (x[i] + x[i + 1]) / 2, (y[i] + y[i + 1]) / 2);
  if (i1 === n - 2) ctx.lineTo(x[n - 1], y[n - 1]);
}

/** Traces an open polyline (x, y pairs) smoothed through its midpoints; the ends stay put. */
function smoothOpen(ctx: CanvasRenderingContext2D, q: Float32Array, n: number, move: boolean) {
  if (move) ctx.moveTo(q[0], q[1]);
  else ctx.lineTo(q[0], q[1]);
  for (let i = 1; i < n - 1; i++) {
    ctx.quadraticCurveTo(q[i * 2], q[i * 2 + 1], (q[i * 2] + q[i * 2 + 2]) / 2, (q[i * 2 + 1] + q[i * 2 + 3]) / 2);
  }
  ctx.lineTo(q[n * 2 - 2], q[n * 2 - 1]);
}

/** Traces the stretch of a polyline between arc distances d0 and d1. */
function traceAlong(
  ctx: CanvasRenderingContext2D,
  x: ArrayLike<number>,
  y: ArrayLike<number>,
  n: number,
  d0: number,
  d1: number,
  stride = 1,
  xOff = 0,
  yOff = 0,
): void {
  if (d1 <= d0) return;
  let acc = 0;
  let started = false;
  for (let i = 0; i < n - 1; i++) {
    const ax = x[xOff + i * stride];
    const ay = y[yOff + i * stride];
    const bx = x[xOff + (i + 1) * stride];
    const by = y[yOff + (i + 1) * stride];
    const l = Math.sqrt((bx - ax) * (bx - ax) + (by - ay) * (by - ay));
    if (l <= 0) continue;
    const e = acc + l;
    if (e >= d0 && acc <= d1) {
      if (!started) {
        const k = clamp01((d0 - acc) / l);
        ctx.moveTo(ax + (bx - ax) * k, ay + (by - ay) * k);
        started = true;
      }
      const k = clamp01((d1 - acc) / l);
      ctx.lineTo(ax + (bx - ax) * k, ay + (by - ay) * k);
      if (d1 <= e) return;
    }
    acc = e;
  }
}

class Jellyfish implements CreatureEntity {
  readonly id: string;
  readonly kind = 'jellyfish' as const;
  readonly variant: string;
  x: number;
  y: number;
  z: number;
  happiness = 70;
  readonly hitRadius: number;

  private readonly sp: Species;
  private readonly rand: Rand;
  private readonly specimen: boolean;
  /** Layout size factor: PHONE_SCALE in the phone sea, else 1. */
  private readonly sizeK: number;
  private readonly R: number;
  private readonly H: number;
  /** Size factor for strokes and wave amplitudes (z-scale x init scale). */
  private readonly k: number;
  /** Distance from the bell centre down to the margin plane. */
  private readonly mOff: number;
  /** Height of the bell's silhouette top above the margin plane, fully contracted. */
  private readonly rise: number;
  /** Margin radius at rest (her drawing is fitted to it, then breathes with the pulse). */
  private readonly rmRest: number;
  private w: number;
  private h: number;
  private readonly home: { x: number; y: number };
  private approach: boolean;

  private vx = 0;
  private vy = 0;
  private tilt = 0;
  private t = 0;
  private dtPrev = 0;
  private par = { x: 0, y: 0 };
  private readonly wanderX: (x: number) => number;
  private readonly wanderY: (x: number) => number;
  private readonly sway: (x: number) => number;

  // Pulse.
  private readonly basePeriod: number;
  private nextPulse: number;
  private pulseT = 99;
  /** Visual depth of the current contraction, and how much of the 18px/s impulse it gives. */
  private pulseAmp = 0;
  private pulseThrust = 0;
  private pulseFrom = 0;
  private contraction = 0;
  private sx = 1;
  private sy = 1;
  private boutLeft: number;
  private skipLeft = 0;
  private startleAt = -1;
  private startleAmp = 0;

  // Light.
  private tapT = -99;
  private tapK = 0;
  private displayT = -99;
  private displayK = 0;
  private displayAngle = 0;
  private catchStart = -1;
  private bio = 0;
  private readonly sparkleOff = new Float32Array(WARTS);
  private readonly lanternGain = new Float32Array(LANTERNS);
  private readonly levels = new Uint8Array(LANTERNS);
  private readonly wartLevel = new Uint8Array(WARTS);
  private readonly lanternCore: string;
  /** Fixed tints of this species: the light hue, and the bell lifted toward white by 30..60%. */
  private readonly tint: { hue: string; b30: string; b35: string; b45: string; b50: string; b60: string };
  /** Per-frame colours, each remembered from the last frame (see MixMemo). */
  private readonly tones = {
    tent: new BodyTone(),
    tentNight: new MixMemo(),
    bell50: new BodyTone(),
    gonads: new BodyTone(),
    bell: new BodyTone(),
    bellFlash: new MixMemo(),
    stripes: new BodyTone(),
    canals: new BodyTone(),
    groove: new BodyTone(),
    warts: new BodyTone(),
    edge: new BodyTone(),
    rim: new MixMemo(),
    margin: new MixMemo(),
    arm: new BodyTone(),
    armFront: new MixMemo(),
    armBack: new MixMemo(),
    armEdge: new MixMemo(),
    beads: new BodyTone(),
    wartCore: new MixMemo(),
    pinCore: new MixMemo(),
    runColor: new MixMemo(),
  };
  /** This frame's darkening, water and fog for body() (set by drawLit). */
  private shDark = 0;
  private shWater = '';
  private shFog = 0;

  // Anatomy.
  private readonly chains: Chain[] = [];
  private readonly arms: Chain[] = [];
  private all: Chain[] = [];
  private readonly markRot: number;
  private readonly grooveU: number;
  private readonly warts: Float32Array;
  private readonly armPhase: number;

  // Per-frame geometry scratch (bell frame: origin at the margin centre, y down).
  private readonly ur = new Float32Array(U);
  private readonly uy = new Float32Array(U);
  private readonly sil = new Float32Array(M * 2);
  private Rm = 0;
  private rootWX = 0;
  private rootWY = 0;
  private readonly canal = new Float32Array(8 * U * 2);
  private readonly canalLen = new Float32Array(8);
  private readonly rib = new Float32Array(4 * 23 * 5);
  private readonly poly = new Float32Array(64);

  constructor(init: CreatureInit) {
    this.id = init.id;
    this.variant = init.variant;
    this.sp = SPECIES[(init.variant as JellyVariant) in SPECIES ? (init.variant as JellyVariant) : 'cyan'];
    this.rand = mulberry32((hashString(`jelly:${init.seed}`) ^ init.seed) >>> 0);
    const r = this.rand;
    this.specimen = !!init.specimen;
    const scale = init.scale ?? 1;
    this.z = this.specimen ? 1 : range(r, 0.35, 1);
    const zs = 0.55 + 0.45 * this.z;
    this.sizeK = !this.specimen && init.w < 640 ? PHONE_SCALE : 1;
    const baseR = this.specimen ? specimenRadius(this.sp, init.w, init.h) : range(r, 22, 40) * this.sizeK;
    this.R = baseR * zs * scale;
    this.H = this.sp.h * this.R;
    this.k = zs * scale;
    this.mOff = 0.5 * (this.H * CA - E * this.R);
    this.hitRadius = Math.max(28, 1.4 * this.R);
    this.w = init.w;
    this.h = init.h;
    this.home = { x: init.home.x, y: init.home.y };

    this.basePeriod = range(r, 2.4, 3.6);
    this.nextPulse = range(r, 0.2, this.basePeriod);
    this.boutLeft = 3 + Math.floor(r() * 5);
    this.wanderX = valueNoise1D(r, 37);
    this.wanderY = valueNoise1D(r, 53);
    this.sway = valueNoise1D(r, 11.1);
    this.markRot = range(r, -0.35, 0.35);
    // Rest geometry, and how far the bell rises above the margin centre (specimen framing).
    this.computeGeometry();
    let top = 0;
    for (let j = 0; j < M; j++) top = Math.min(top, this.sil[j * 2 + 1]);
    this.rise = -top * 1.08;
    this.rmRest = this.Rm;
    this.armPhase = range(r, 0, TAU);
    this.displayAngle = range(r, 0, TAU);
    for (let i = 0; i < LANTERNS; i++) this.lanternGain[i] = range(r, 0.72, 1);
    this.lanternCore = mixOK(this.sp.lantern, '#FFFFFF', 0.45);
    const bell = this.sp.bell;
    this.tint = {
      hue: mixOK(this.sp.hue, '#FFFFFF', 0.35),
      b30: mixOK(bell, '#FFFFFF', 0.3),
      b35: mixOK(bell, '#FFFFFF', 0.35),
      b45: mixOK(bell, '#FFFFFF', 0.45),
      b50: mixOK(bell, '#FFFFFF', 0.5),
      b60: mixOK(bell, '#FFFFFF', 0.6),
    };

    // Coronal groove (Atolla): the profile height where the bell radius is 0.6R.
    let lo = 0;
    let hi = 1;
    for (let i = 0; i < 24; i++) {
      const mid = (lo + hi) / 2;
      if (bez(0, this.sp.p1x, this.sp.p2x, 1, mid) < 0.6) lo = mid;
      else hi = mid;
    }
    this.grooveU = (lo + hi) / 2;

    // Pelagia warts: spread over the visible front of the bell, denser toward the margin.
    this.warts = new Float32Array(WARTS * 2);
    for (let i = 0; i < WARTS; i++) {
      this.warts[i * 2] = 0.14 + 0.82 * Math.sqrt(r());
      this.warts[i * 2 + 1] = range(r, 0.22, Math.PI - 0.22);
    }

    const start = init.from && !this.specimen ? init.from : this.restingPoint();
    this.x = start.x;
    this.y = start.y;
    this.approach = !!init.from && !this.specimen;

    this.buildChains();
  }

  // -------------------------------------------------------------------------
  // Construction
  // -------------------------------------------------------------------------

  private restingPoint(): { x: number; y: number } {
    if (this.specimen) {
      // Centre the whole figure (bell top to the longest hanging part) on the home point.
      let reach = this.sp.arms.len;
      for (const t of this.sp.tentacles) reach = Math.max(reach, t.len);
      const top = this.rise - this.mOff;
      const bottom = this.mOff + E * this.R + reach * this.R * 0.92;
      return { x: this.home.x * this.w, y: this.home.y * this.h - (bottom - top) / 2 };
    }
    return {
      x: clamp(this.home.x, 0.08, 0.92) * this.w,
      y: clamp(this.home.y, BAND_TOP + 0.04, BAND_BOTTOM - 0.04) * this.h,
    };
  }

  private makeChain(group: number, theta: number, rootR: number, rootY: number, len: number, spec: {
    width: number;
    alpha: number;
    stiff: number;
    splay: number;
    curl: number;
    amp: number;
  }): Chain {
    const r = this.rand;
    const rest = new Float32Array(NODES * 2);
    const seg = new Float32Array(NODES - 1);
    const step = len / (NODES - 1);
    const out = Math.cos(theta);
    const toward = Math.sin(theta);
    let px = 0;
    let py = 0;
    let total = 0;
    for (let i = 1; i < NODES; i++) {
      const a = spec.splay + spec.curl * ((i - 1) / (NODES - 2)) ** 1.2;
      // Outward splay shows sideways at the bell's sides and foreshortens toward the viewer.
      const dx = step * Math.sin(a) * out;
      const dy = step * (Math.cos(a) + Math.sin(a) * toward * E);
      px += dx;
      py += dy;
      rest[i * 2] = px;
      rest[i * 2 + 1] = py;
      const l = Math.hypot(dx, dy);
      seg[i - 1] = l;
      total += l;
    }
    const c: Chain = {
      group,
      theta,
      rootR,
      rootY,
      width: spec.width,
      alpha: spec.alpha,
      stiff: spec.stiff,
      amp: spec.amp * range(r, 0.8, 1.2),
      phase: range(r, 0, TAU),
      twist: range(r, 0, TAU),
      x: new Float32Array(NODES),
      y: new Float32Array(NODES),
      px: new Float32Array(NODES),
      py: new Float32Array(NODES),
      rest,
      seg,
      len: total,
    };
    return c;
  }

  private buildChains() {
    const r = this.rand;
    this.sp.tentacles.forEach((t, g) => {
      const off = range(r, 0, TAU / t.count);
      for (let i = 0; i < t.count; i++) {
        const theta = t.at ?? off + (i * TAU) / t.count + range(r, -0.08, 0.08);
        const len = t.len * this.R * range(r, 0.9, 1.08);
        this.chains.push(this.makeChain(g, theta, 1, 0, len, t));
      }
    });
    const a = this.sp.arms;
    for (let i = 0; i < (a.len > 0 ? 4 : 0); i++) {
      const theta = Math.PI / 4 + (i * Math.PI) / 2 + this.markRot;
      const len = a.len * this.R * range(r, 0.88, 1.08);
      this.arms.push(
        this.makeChain(-1, theta, 0.14, -0.12, len, {
          width: a.width,
          alpha: a.alpha,
          stiff: 1.2,
          splay: a.splay,
          curl: -a.splay * 0.4,
          amp: 0.85,
        }),
      );
    }
    this.all = this.chains.concat(this.arms);
    this.placeChains();
  }

  /** Puts every chain at its rest pose (spawn). */
  private placeChains() {
    const ct = Math.cos(this.tilt);
    const st = Math.sin(this.tilt);
    for (const c of this.all) {
      this.rootWorld(c, ct, st);
      const rx = this.rootWX;
      const ry = this.rootWY;
      for (let i = 0; i < NODES; i++) {
        const lx = c.rest[i * 2];
        const ly = c.rest[i * 2 + 1];
        c.x[i] = c.px[i] = rx + lx * ct - ly * st;
        c.y[i] = c.py[i] = ry + lx * st + ly * ct;
      }
    }
  }

  // -------------------------------------------------------------------------
  // Geometry
  // -------------------------------------------------------------------------

  /** Root of a chain in world space (before parallax), written to rootWX / rootWY. */
  private rootWorld(c: Chain, ct: number, st: number) {
    const rr = c.rootR * this.R * this.sx;
    const lx = rr * Math.cos(c.theta);
    const ly = this.mOff + c.rootY * this.H * this.sy * CA + rr * Math.sin(c.theta) * E;
    this.rootWX = this.x + lx * ct - ly * st;
    this.rootWY = this.y + lx * st + ly * ct;
  }

  /** A point on the bell surface at profile u (0 apex .. 1 margin), azimuth theta; bell frame. */
  private surf(u: number, theta: number, out: Float32Array, i: number) {
    const sp = this.sp;
    const r = bez(0, sp.p1x * this.R, sp.p2x * this.R, this.R, u) * (1 - (1 - this.sx) * u);
    const y = bez(-this.H, -this.H, -sp.p2y * this.H, 0, u) * this.sy * CA;
    out[i] = r * Math.cos(theta);
    out[i + 1] = y + r * Math.sin(theta) * E;
  }

  /** Profile rings, the silhouette (upper envelope of the rings) and the canals. */
  private computeGeometry() {
    const sp = this.sp;
    const { R, H } = this;
    for (let i = 0; i < U; i++) {
      const u = i / (U - 1);
      this.ur[i] = bez(0, sp.p1x * R, sp.p2x * R, R, u) * (1 - (1 - this.sx) * u);
      this.uy[i] = bez(-H, -H, -sp.p2y * H, 0, u) * this.sy * CA;
    }
    const Rm = this.ur[U - 1];
    this.Rm = Rm;
    for (let j = 0; j < M; j++) {
      const x = -Rm * Math.cos((Math.PI * j) / (M - 1));
      const ax = Math.abs(x);
      let best = 0;
      if (ax < 1e-3) best = this.uy[0];
      for (let i = 1; i < U; i++) {
        const r = this.ur[i];
        if (r <= ax) continue;
        const q = x / r;
        const top = this.uy[i] - r * E * Math.sqrt(1 - q * q);
        if (top < best) best = top;
      }
      this.sil[j * 2] = x;
      this.sil[j * 2 + 1] = best;
    }
    for (let c = 0; c < 8; c++) {
      const th = ((c + 0.5) * TAU) / 8 + this.markRot * 0.5;
      const cos = Math.cos(th);
      const sin = Math.sin(th) * E;
      let len = 0;
      for (let i = 1; i < U; i++) {
        const o = (c * U + i) * 2;
        this.canal[o] = this.ur[i] * cos;
        this.canal[o + 1] = this.uy[i] + this.ur[i] * sin;
        if (i > 1) {
          const dx = this.canal[o] - this.canal[o - 2];
          const dy = this.canal[o + 1] - this.canal[o - 1];
          len += Math.sqrt(dx * dx + dy * dy);
        }
      }
      this.canalLen[c] = len;
    }
  }

  private traceSilhouette(ctx: CanvasRenderingContext2D, j0 = 0, j1 = M - 1) {
    const s = this.sil;
    ctx.moveTo(j0 === 0 ? s[0] : (s[j0 * 2 - 2] + s[j0 * 2]) / 2, j0 === 0 ? s[1] : (s[j0 * 2 - 1] + s[j0 * 2 + 1]) / 2);
    const end = Math.min(j1, M - 2);
    for (let j = Math.max(1, j0); j <= end; j++) {
      ctx.quadraticCurveTo(s[j * 2], s[j * 2 + 1], (s[j * 2] + s[j * 2 + 2]) / 2, (s[j * 2 + 1] + s[j * 2 + 3]) / 2);
    }
    if (j1 === M - 1) ctx.lineTo(s[M * 2 - 2], s[M * 2 - 1]);
  }

  /** The scalloped front margin from the right side (theta 0) to the left (theta pi): 8 lappets. */
  private traceMargin(ctx: CanvasRenderingContext2D, move: boolean) {
    const Rm = this.Rm;
    const depth = 0.06 * this.R;
    if (move) ctx.moveTo(Rm, 0);
    for (let k = 0; k < 8; k++) {
      const a = (k * Math.PI) / 8;
      const b = ((k + 1) * Math.PI) / 8;
      const m = (a + b) / 2;
      const ax = Rm * Math.cos(a);
      const ay = E * Rm * Math.sin(a);
      const bx = Rm * Math.cos(b);
      const by = E * Rm * Math.sin(b);
      // Quadratic control so the lobe's midpoint hangs `depth` below the margin ellipse.
      const cx = 2 * Rm * Math.cos(m) - (ax + bx) / 2;
      const cy = 2 * (E * Rm * Math.sin(m) + depth) - (ay + by) / 2;
      ctx.quadraticCurveTo(cx, cy, bx, by);
    }
  }

  private traceBell(ctx: CanvasRenderingContext2D) {
    this.traceSilhouette(ctx);
    this.traceMargin(ctx, false);
    ctx.closePath();
  }

  // -------------------------------------------------------------------------
  // Behaviour
  // -------------------------------------------------------------------------

  private yNorm(f: WorldFrame): number {
    if (this.specimen) return clamp01(this.y / Math.max(1, this.h));
    return clamp01((this.y + this.par.y) / Math.max(1, f.h || this.h));
  }

  private contractionAt(t: number): number {
    if (t < CONTRACT) return this.pulseFrom + (this.pulseAmp - this.pulseFrom) * easeOutCubic(t / CONTRACT);
    if (t < CONTRACT + RELAX) return this.pulseAmp * (1 - easeInOutSine((t - CONTRACT) / RELAX));
    return 0;
  }

  private startPulse(amp: number) {
    // Real jellies keep full strokes and vary the push; the bell always visibly contracts.
    this.pulseFrom = this.contraction;
    this.pulseAmp = Math.max(0.7 + 0.3 * amp, this.contraction);
    this.pulseThrust = amp / this.pulseAmp;
    this.pulseT = 0;
  }

  /** How hard the next pulse should be (0 = skip it and coast). */
  private pulseIntent(): number {
    if (this.specimen) return 0.85;
    const top = this.y - (this.rise - this.mOff);
    if (top < CEILING * this.h || this.y < BAND_TOP * this.h) {
      this.skipLeft = 0;
      return 0;
    }
    const target = this.approach ? this.home.y * this.h : this.targetY();
    if (this.y > BAND_BOTTOM * this.h || this.approach) return this.y > target - 6 ? 1 : 0.35;
    if (this.skipLeft > 0) {
      this.skipLeft--;
      return 0;
    }
    if (--this.boutLeft <= 0) {
      this.boutLeft = 3 + Math.floor(this.rand() * 5);
      this.skipLeft = this.rand() < 0.6 ? 1 : 2;
    }
    const err = (this.y - target) / (0.1 * this.h);
    return clamp(0.3 + 0.5 * err, 0.12, 1);
  }

  private targetY(): number {
    const y = clamp(this.home.y, BAND_TOP + 0.05, BAND_BOTTOM - 0.05) + this.wanderY(this.t) * 0.08;
    return clamp(y, BAND_TOP + 0.04, BAND_BOTTOM - 0.04) * this.h;
  }

  update(f: WorldFrame): void {
    const dt = f.dt;
    this.t = f.t;
    if (!this.specimen) this.par = f.parallax(4 + 4 * this.z);
    if (dt <= 0) return;
    const L = f.lighting;
    const rm = L.reducedMotion ? 0.5 : 1;

    // Night lanterns: when the candle catch reaches this height, they light running round the rim.
    const bio = L.biolum(this.yNorm(f));
    if (bio <= 0.02) this.catchStart = -1;
    else if (this.catchStart < 0) this.catchStart = f.t;
    this.bio = bio;

    // Pulse: contraction, relax, coast.
    const hN = clamp01(this.happiness / 100);
    const rate = (0.85 + 0.25 * hN) * (L.reducedMotion ? 0.6 : 1) * (this.approach ? 1.35 : 1);
    this.pulseT += dt;
    this.nextPulse -= dt;
    if (this.startleAt >= 0 && f.t >= this.startleAt) {
      this.startleAt = -1;
      const nearTop = this.y - this.H < (CEILING + 0.06) * this.h;
      if (!nearTop || this.specimen) this.startPulse(this.startleAmp);
      this.nextPulse = Math.max(this.nextPulse, CONTRACT + RELAX + 0.4);
    }
    if (this.nextPulse <= 0) {
      this.nextPulse = (this.basePeriod / rate) * range(this.rand, 0.94, 1.06);
      const amp = this.pulseIntent();
      if (amp > 0) this.startPulse(amp);
    }
    const prevC = this.contraction;
    this.contraction = this.contractionAt(this.pulseT);
    this.sx = 1 - 0.14 * this.contraction;
    this.sy = 1 + 0.08 * this.contraction;
    const thrust = IMPULSE * this.pulseThrust * Math.max(0, this.contraction - prevC) * (this.specimen ? 0.3 : rm);

    if (this.specimen) {
      // Shop plate: stay centred, bob a few px with each pulse.
      const anchor = this.restingPoint();
      const kd = 1 - Math.exp(-dt / 0.9);
      this.vy += -(this.y - anchor.y) * 4 * dt;
      this.vy += (0 - this.vy) * kd;
      this.vy -= thrust;
      this.y += this.vy * dt;
      this.x = anchor.x;
      this.tilt = this.sway(this.t) * 0.05;
    } else {
      // Drift sideways round home, keep clear of jellies at a similar depth.
      let xT = this.home.x * this.w + this.wanderX(this.t) * 0.07 * this.w;
      const zs = 0.55 + 0.45 * this.z;
      for (const o of f.jellies) {
        if (o.id === this.id || Math.abs(o.z - this.z) > 0.3) continue;
        const dx = this.x - o.x;
        const dy = this.y - o.y;
        const d = Math.sqrt(dx * dx + dy * dy);
        const minD = 70 * zs * this.sizeK + 24;
        if (d < minD) xT += (dx >= 0 ? 1 : -1) * (minD - d) * 1.2;
      }
      const edge = this.R + 10;
      xT = clamp(xT, edge, this.w - edge);
      const vmax = this.approach ? 9 : 3;
      const vxDes = clamp((xT - this.x) * 0.05, -vmax, vmax) * rm;
      const kd = 1 - Math.exp(-dt / DRAG_TAU);
      this.vx += (vxDes - this.vx) * kd;
      this.vy += (SINK * rm - this.vy) * kd;
      this.vx += Math.sin(this.tilt) * thrust;
      this.vy -= Math.cos(this.tilt) * thrust;
      const sp = Math.sqrt(this.vx * this.vx + this.vy * this.vy);
      if (sp > MAX_SPEED) {
        this.vx *= MAX_SPEED / sp;
        this.vy *= MAX_SPEED / sp;
      }
      this.x += this.vx * dt;
      this.y += this.vy * dt;
      if (this.approach && Math.hypot(this.x - this.home.x * this.w, this.y - this.home.y * this.h) < 0.06 * this.h) {
        this.approach = false;
      }
      const tiltT = clamp(this.vx * 0.045, -0.22, 0.22) + this.sway(this.t) * 0.05;
      this.tilt += (tiltT - this.tilt) * (1 - Math.exp(-dt / 1.6));
    }

    this.stepChains(dt, f.t);
    this.dtPrev = dt;
  }

  private stepChains(dt: number, t: number) {
    const damp = Math.pow(0.96, dt * 60);
    const ratio = this.dtPrev > 0 ? clamp(dt / this.dtPrev, 0.5, 2) : 1;
    const dt2 = dt * dt;
    const ct = Math.cos(this.tilt);
    const st = Math.sin(this.tilt);
    const ampK = this.k;
    const all = this.all;
    for (let ci = 0; ci < all.length; ci++) {
      const c = all[ci];
      this.rootWorld(c, ct, st);
      const rx = this.rootWX;
      const ry = this.rootWY;
      const base = OMEGA * t + c.phase;
      const prev = base - OMEGA * dt;
      for (let i = 1; i < NODES; i++) {
        // Lateral sine wave travelling down the chain, A from 2px at the root to 7px at the tip.
        // Applied as a displacement (no momentum), so it never winds the tip into hooks.
        const A = (2 + (5 * i) / (NODES - 1)) * c.amp * ampK;
        const lat = A * (Math.sin(base - 0.45 * i) - Math.sin(prev - 0.45 * i));
        c.x[i] += lat * ct;
        c.px[i] += lat * ct;
        c.y[i] += lat * st;
        c.py[i] += lat * st;
        const vx = (c.x[i] - c.px[i]) * damp * ratio;
        const vy = (c.y[i] - c.py[i]) * damp * ratio;
        const lx = c.rest[i * 2];
        const ly = c.rest[i * 2 + 1];
        const tx = rx + lx * ct - ly * st;
        const ty = ry + lx * st + ly * ct;
        const ks = c.stiff * (0.3 + 0.7 * (1 - i / NODES) ** 1.5);
        const ax = ks * (tx - c.x[i]);
        const ay = GRAVITY + ks * (ty - c.y[i]);
        c.px[i] = c.x[i];
        c.py[i] = c.y[i];
        c.x[i] += vx + ax * dt2;
        c.y[i] += vy + ay * dt2;
      }
      c.x[0] = c.px[0] = rx;
      c.y[0] = c.py[0] = ry;
      for (let it = 0; it < 2; it++) {
        for (let i = 0; i < NODES - 1; i++) {
          const dx = c.x[i + 1] - c.x[i];
          const dy = c.y[i + 1] - c.y[i];
          const d = Math.sqrt(dx * dx + dy * dy) || 1e-6;
          const diff = (d - c.seg[i]) / d;
          if (i === 0) {
            c.x[1] -= dx * diff;
            c.y[1] -= dy * diff;
          } else {
            c.x[i] += dx * diff * 0.5;
            c.y[i] += dy * diff * 0.5;
            c.x[i + 1] -= dx * diff * 0.5;
            c.y[i + 1] -= dy * diff * 0.5;
          }
        }
      }
    }
  }

  // -------------------------------------------------------------------------
  // Touch
  // -------------------------------------------------------------------------

  hitTest(x: number, y: number): boolean {
    const dx = x - this.par.x - this.x;
    const dy = y - this.par.y - this.y;
    return dx * dx + dy * dy <= this.hitRadius * this.hitRadius;
  }

  tap(f: WorldFrame): void {
    this.light(f, 1);
    const n = 6 + Math.floor(this.rand() * 5);
    f.bubbles(this.x, this.y - this.H * 0.45, {
      count: n,
      color: this.sp.hue,
      spread: Math.max(6, this.R * 0.5),
      speed: [30, 45],
    });
    // Light first, motion second: a startled pulse a beat after the flash.
    this.startleAt = f.t + 0.12;
    this.startleAmp = 1;
  }

  wake(f: WorldFrame, strength: number): void {
    const k = clamp(strength, 0.25, 1);
    this.light(f, k);
    this.startleAt = f.t + 0.15;
    this.startleAmp = 0.5 + 0.4 * k;
  }

  private light(f: WorldFrame, k: number) {
    this.tapT = f.t;
    this.tapK = k;
    this.displayT = f.t;
    this.displayK = k;
    this.displayAngle = range(this.rand, 0, TAU);
    for (let i = 0; i < WARTS; i++) this.sparkleOff[i] = this.rand() * SPARKLE_SPREAD;
  }

  resize(w: number, h: number): void {
    const ox = this.x;
    const oy = this.y;
    if (this.specimen) {
      this.w = w;
      this.h = h;
      const p = this.restingPoint();
      this.x = p.x;
      this.y = p.y;
    } else {
      this.x = (this.x / Math.max(1, this.w)) * w;
      this.y = (this.y / Math.max(1, this.h)) * h;
      this.w = w;
      this.h = h;
    }
    const dx = this.x - ox;
    const dy = this.y - oy;
    for (const c of this.all) {
      for (let i = 0; i < NODES; i++) {
        c.x[i] += dx;
        c.px[i] += dx;
        c.y[i] += dy;
        c.py[i] += dy;
      }
    }
  }

  // -------------------------------------------------------------------------
  // Drawing
  // -------------------------------------------------------------------------

  draw(ctx: CanvasRenderingContext2D, f: WorldFrame, style?: DrawStyle): void {
    this.computeGeometry();
    ctx.save();
    if (!this.specimen) ctx.translate(this.par.x, this.par.y);
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    const pic = artFor('jellyfish', this.variant);
    if (pic) this.drawPicture(ctx, f, pic, !!style?.outline);
    else if (style?.outline) this.drawOutline(ctx, f, style.outlineColor ?? '#E9F7F3');
    else this.drawLit(ctx, f);
    ctx.restore();
  }

  /**
   * Her drawing in place of the drawn jelly: the bell spans the picture's width, its top at the
   * picture's top. It breathes with the pulse (narrower and taller as the bell contracts),
   * tilts with the swim, fogs with distance and glows by night.
   */
  private drawPicture(ctx: CanvasRenderingContext2D, f: WorldFrame, pic: ArtImage, outline: boolean) {
    const L = f.lighting;
    const yN = this.yNorm(f);
    const fog = this.specimen ? 0 : L.fogForZ(this.z);
    const flash = this.tapT > -50 ? envelope(this.t - this.tapT) * this.tapK : 0;
    const glow = outline ? 0 : L.biolum(yN) * (0.25 + 0.35 * clamp01(this.happiness / 100)) * (1 - fog) + flash * 0.6;
    if (glow > 0.01) f.glow(this.sp.lantern, this.x, this.y + this.mOff - this.rise * 0.4, this.R * 2.4, Math.min(1, glow));
    const sx = this.rmRest > 0 ? this.Rm / this.rmRest : 1;
    const sy = 1 + (1 - sx) * 0.8;
    const tint = sceneTint(L, yN, fog);
    this.enterBell(ctx);
    ctx.translate(0, (-this.rise / 1.08) * sy);
    if (outline) ctx.globalAlpha *= 0.35;
    drawArt(ctx, outline ? pic.canvas : tinted(pic, tint.color, tint.amount), pic, 2 * this.rmRest, 0.5, 0, sx, sy);
    ctx.restore();
  }

  private enterBell(ctx: CanvasRenderingContext2D) {
    ctx.save();
    ctx.translate(this.x, this.y);
    ctx.rotate(this.tilt);
    ctx.translate(0, this.mOff);
  }

  private drawLit(ctx: CanvasRenderingContext2D, f: WorldFrame) {
    const sp = this.sp;
    const L = f.lighting;
    const t = this.t;
    const yN = this.yNorm(f);
    const water = L.waterAt(yN);
    const fog = this.specimen ? 0 : L.fogForZ(this.z);
    const dark = L.num('bodyDarken', yN);
    const night = clamp01(dark / 0.4);
    // body(c) = mixOK(mixOK(c, nightFloor, dark), water, fog), through this.body().
    this.shDark = dark;
    this.shWater = water;
    this.shFog = fog;
    const tn = this.tones;
    const hueLight = this.tint.hue;
    const lw = f.lineWidth;
    const flash = this.tapT > -50 ? envelope(t - this.tapT) * this.tapK : 0;
    const dT = t - this.displayT;

    // Tentacles behind the bell, then the oral arms hanging inside it.
    const tentColor = tn.tentNight.get(this.body(tn.tent, this.tint.b30), hueLight, night * 0.45);
    this.drawTentacles(ctx, f, tentColor, false, 1);
    this.drawArms(ctx, f, true, night, null);

    this.enterBell(ctx);
    // Back of the margin, seen through the bell.
    ctx.lineWidth = lw;
    ctx.strokeStyle = this.body(tn.bell50, this.tint.b50);
    ctx.globalAlpha = 0.22;
    ctx.beginPath();
    ctx.ellipse(0, 0, this.Rm, E * this.Rm, 0, Math.PI, TAU);
    ctx.stroke();
    if (sp.mark === 'gonads') this.drawGonads(ctx, f, this.body(tn.gonads, C.coral), 0.7);

    // The bell itself: one flat translucent fill.
    ctx.globalAlpha = Math.min(0.6, sp.bellAlpha + 0.12 * flash);
    const bellCol = this.body(tn.bell, sp.bell);
    ctx.fillStyle = flash > 0.02 ? tn.bellFlash.get(bellCol, hueLight, flash * 0.35) : bellCol;
    ctx.beginPath();
    this.traceBell(ctx);
    ctx.fill();

    // Surface anatomy.
    if (sp.mark === 'stripes') this.drawStripes(ctx, this.body(tn.stripes, C.coralDeep));
    this.drawCanals(ctx, lw, this.body(tn.canals, this.tint.b45), sp.canalAlpha, f.quality >= 0.8);
    if (sp.mark === 'groove') this.drawGroove(ctx, lw, this.body(tn.groove, C.lilacLight));
    if (sp.mark === 'warts') this.drawWarts(ctx, this.body(tn.warts, C.wart), sp.lantern, dT);

    // Exumbrella edge, then the light rim (sunset top light, or the night rim in its own hue).
    ctx.lineWidth = lw;
    ctx.strokeStyle = this.body(tn.edge, this.tint.b35);
    ctx.globalAlpha = 0.3 + 0.3 * flash;
    ctx.beginPath();
    this.traceSilhouette(ctx);
    ctx.stroke();
    const rimA = L.num('rimAlpha', yN);
    if (rimA > 0.01) {
      const rimC = tn.rim.get(L.color('rim', yN), hueLight, night);
      const a = rimA * (0.45 + 0.25 * night) * (1 - fog);
      const span = 0.3 + 0.2 * night;
      ctx.strokeStyle = rimC;
      const mid = (M - 1) / 2;
      const outer = Math.round(mid - span * (M - 1));
      const inner = Math.round(mid - span * 0.6 * (M - 1));
      ctx.globalAlpha = a * 0.5;
      ctx.beginPath();
      this.traceSilhouette(ctx, Math.max(0, outer), M - 1 - Math.max(0, outer));
      ctx.stroke();
      ctx.globalAlpha = a * 0.6;
      ctx.beginPath();
      this.traceSilhouette(ctx, Math.max(1, inner), M - 1 - Math.max(1, inner));
      ctx.stroke();
    }

    // The crisp scalloped margin.
    ctx.lineWidth = Math.max(lw, 0.9 * Math.min(1, this.k));
    ctx.strokeStyle = tn.margin.get(this.body(tn.bell50, this.tint.b50), hueLight, night * 0.7);
    ctx.globalAlpha = Math.min(1, 0.7 + 0.3 * flash);
    ctx.beginPath();
    this.traceMargin(ctx, true);
    ctx.stroke();
    ctx.restore();

    // Tentacles in front of the bell.
    this.drawTentacles(ctx, f, tentColor, true, 1);

    // Displays and lanterns.
    this.enterBell(ctx);
    if (sp.display === 'cascade') this.drawCascadeCanals(ctx, f, dT);
    if (sp.display === 'pinwheel') this.drawPinwheel(ctx, f, dT);
    this.drawLanterns(ctx, f, night);
    ctx.restore();
    if (sp.display === 'cascade') this.drawCascadeTentacles(ctx, f, dT);

    // One body glow (ambient + tap flash), scattered by depth.
    const gain = L.glowGain(yN);
    const gR = 1 + 0.6 * (1 - this.z);
    const gI = 0.5 + 0.5 * this.z;
    const base = Math.min(gain, 0.5);
    const effGain = gain > 0.2 ? base + (gain - base) * this.bio : 0;
    const ambient = effGain * (0.25 + 0.5 * clamp01(this.happiness / 100));
    const flashA = Math.max(0.35, gain) * flash;
    const alpha = (ambient + flashA) * gI;
    if (alpha > 0.01) f.glow(sp.hue, this.x, this.y, 1.6 * this.R * gR * (1 + 0.2 * flash), alpha);
  }

  /** body(c) for this frame (drawLit sets the darkening, water and fog). */
  private body(tone: BodyTone, c: string): string {
    return tone.get(c, this.shDark, this.shWater, this.shFog);
  }

  private drawTentacles(ctx: CanvasRenderingContext2D, f: WorldFrame, color: string, front: boolean, alphaMul: number) {
    ctx.strokeStyle = color;
    // Butt caps so the alpha runs meet without bright beads at the joins.
    ctx.lineCap = 'butt';
    const steps = f.quality < 0.6 ? 1 : 3;
    const chains = this.chains;
    for (let g = 0; g < this.sp.tentacles.length; g++) {
      // One batch per tentacle spec (Atolla's heavier trailing tentacle is its own group).
      let any = false;
      for (let ci = 0; ci < chains.length; ci++) {
        const c = chains[ci];
        if (c.group === g && Math.sin(c.theta) >= 0 === front) any = true;
      }
      if (!any) continue;
      for (let r = 0; r < steps; r++) {
        const i0 = steps === 1 ? 1 : RUN_I0[r];
        const i1 = steps === 1 ? NODES - 2 : RUN_I1[r];
        const a = steps === 1 ? 0.6 : RUN_A[r];
        ctx.beginPath();
        let width = f.lineWidth;
        let alpha = 0;
        for (let ci = 0; ci < chains.length; ci++) {
          const c = chains[ci];
          if (c.group !== g || Math.sin(c.theta) >= 0 !== front) continue;
          traceRun(ctx, c.x, c.y, i0, i1, NODES);
          width = Math.max(f.lineWidth, c.width * Math.min(1.2, this.k));
          alpha = c.alpha;
        }
        ctx.lineWidth = width;
        ctx.globalAlpha = alpha * a * alphaMul * (front ? 1 : 0.8);
        ctx.stroke();
      }
    }
  }

  /** Oral arms as twisting ribbon strips; the back face shows 20% lighter as it turns over. */
  /** `lit`: shaded by this frame's body() (drawLit); otherwise the plain arm colour. */
  private drawArms(ctx: CanvasRenderingContext2D, f: WorldFrame, lit: boolean, night: number, outline: string | null) {
    const sp = this.sp;
    if (this.arms.length === 0) return;
    const P = 23;
    const rib = this.rib;
    const twist = 0.8 * this.t + this.armPhase;
    const baseW = sp.arms.width * this.R;
    for (let a = 0; a < 4; a++) {
      const c = this.arms[a];
      const o = a * P * 5;
      // Subdivide the chain once (Catmull-Rom midpoints) for a smooth strip.
      for (let j = 0; j < P; j++) {
        const i = j >> 1;
        let x: number;
        let y: number;
        if ((j & 1) === 0) {
          x = c.x[i];
          y = c.y[i];
        } else {
          const i0 = Math.max(0, i - 1);
          const i3 = Math.min(NODES - 1, i + 2);
          x = (-c.x[i0] + 9 * c.x[i] + 9 * c.x[i + 1] - c.x[i3]) / 16;
          y = (-c.y[i0] + 9 * c.y[i] + 9 * c.y[i + 1] - c.y[i3]) / 16;
        }
        rib[o + j * 5] = x;
        rib[o + j * 5 + 1] = y;
      }
      for (let j = 0; j < P; j++) {
        const jp = Math.max(0, j - 1);
        const jn = Math.min(P - 1, j + 1);
        const dx = rib[o + jn * 5] - rib[o + jp * 5];
        const dy = rib[o + jn * 5 + 1] - rib[o + jp * 5 + 1];
        const d = Math.sqrt(dx * dx + dy * dy) || 1;
        const s = j / 2;
        const taper = Math.min(1, 0.3 + s * 0.7) * (1 - 0.6 * (s / (NODES - 1)));
        rib[o + j * 5 + 2] = -dy / d;
        rib[o + j * 5 + 3] = dx / d;
        const ruffle = 1 + sp.arms.frill * Math.sin(s * 2.7 + c.twist - this.t * 1.3);
        rib[o + j * 5 + 4] = baseW * taper * ruffle * Math.cos(twist + c.twist + 0.4 * s) * 0.5;
      }
    }

    const tn = this.tones;
    const front = outline ?? (lit ? tn.armFront.get(this.body(tn.arm, sp.arms.color), sp.arms.color, night * 0.3) : sp.arms.color);
    const back = outline ?? tn.armBack.get(front, '#FFFFFF', 0.2);
    for (let face = 0; face < 2; face++) {
      const sign = face === 0 ? 1 : -1;
      ctx.beginPath();
      for (let a = 0; a < 4; a++) this.traceRibbonFace(ctx, a * P * 5, P, sign);
      if (outline) {
        ctx.strokeStyle = outline;
        ctx.lineWidth = f.lineWidth;
        ctx.globalAlpha = 0.4;
        ctx.stroke();
      } else {
        ctx.fillStyle = face === 0 ? front : back;
        ctx.globalAlpha = sp.arms.alpha * (1 - 0.35 * night);
        ctx.fill();
      }
    }
    if (outline) return;
    if (f.quality < 0.8) {
      if (sp.display === 'ribbon') this.drawRibbonRun(ctx, f, P);
      return;
    }
    // Both physical edges as hairlines; with the signed width they spiral as the ribbon turns.
    ctx.strokeStyle = tn.armEdge.get(front, '#FFFFFF', 0.4);
    ctx.lineWidth = f.lineWidth;
    ctx.globalAlpha = 0.4 * (1 - 0.4 * night);
    ctx.beginPath();
    for (let a = 0; a < 4; a++) {
      const o = a * P * 5;
      for (let side = -1; side <= 1; side += 2) {
        const q = this.poly;
        for (let j = 1; j < P; j++) {
          const w = rib[o + j * 5 + 4] * side;
          q[(j - 1) * 2] = rib[o + j * 5] + rib[o + j * 5 + 2] * w;
          q[(j - 1) * 2 + 1] = rib[o + j * 5 + 1] + rib[o + j * 5 + 3] * w;
        }
        smoothOpen(ctx, q, P - 1, true);
      }
    }
    ctx.stroke();
    if (sp.display === 'ribbon') this.drawRibbonRun(ctx, f, P);
  }

  /** Adds the runs of one ribbon whose face points `sign` to the current path. */
  private traceRibbonFace(ctx: CanvasRenderingContext2D, o: number, P: number, sign: number) {
    const rib = this.rib;
    let j = 0;
    while (j < P) {
      while (j < P && rib[o + j * 5 + 4] * sign <= 0) j++;
      if (j >= P) return;
      const start = j;
      while (j < P && rib[o + j * 5 + 4] * sign > 0) j++;
      const end = j - 1;
      // Zero-width crossing points where the ribbon turns over.
      let sx = rib[o + start * 5];
      let sy = rib[o + start * 5 + 1];
      if (start > 0) {
        const w0 = rib[o + (start - 1) * 5 + 4];
        const w1 = rib[o + start * 5 + 4];
        const k = w0 / (w0 - w1);
        sx = rib[o + (start - 1) * 5] + (sx - rib[o + (start - 1) * 5]) * k;
        sy = rib[o + (start - 1) * 5 + 1] + (sy - rib[o + (start - 1) * 5 + 1]) * k;
      }
      let ex = rib[o + end * 5];
      let ey = rib[o + end * 5 + 1];
      if (end < P - 1) {
        const w0 = rib[o + end * 5 + 4];
        const w1 = rib[o + (end + 1) * 5 + 4];
        const k = w0 / (w0 - w1);
        ex = ex + (rib[o + (end + 1) * 5] - ex) * k;
        ey = ey + (rib[o + (end + 1) * 5 + 1] - ey) * k;
      }
      // Each edge runs pinch to pinch, smoothed through midpoints so the frill stays soft.
      const q = this.poly;
      let n = 0;
      q[n++] = sx;
      q[n++] = sy;
      for (let i = start; i <= end; i++) {
        const w = rib[o + i * 5 + 4];
        q[n++] = rib[o + i * 5] + rib[o + i * 5 + 2] * w;
        q[n++] = rib[o + i * 5 + 1] + rib[o + i * 5 + 3] * w;
      }
      q[n++] = ex;
      q[n++] = ey;
      smoothOpen(ctx, q, n / 2, true);
      n = 0;
      q[n++] = ex;
      q[n++] = ey;
      for (let i = end; i >= start; i--) {
        const w = rib[o + i * 5 + 4];
        q[n++] = rib[o + i * 5] - rib[o + i * 5 + 2] * w;
        q[n++] = rib[o + i * 5 + 1] - rib[o + i * 5 + 3] * w;
      }
      q[n++] = sx;
      q[n++] = sy;
      smoothOpen(ctx, q, n / 2, false);
      ctx.closePath();
    }
  }

  /** Ribbon run (Chrysaora): a band of light runs down all four ribbons. */
  private drawRibbonRun(ctx: CanvasRenderingContext2D, f: WorldFrame, P: number) {
    const dT = this.t - this.displayT;
    if (dT < 0 || dT > RIBBON_RUN_TIME + 0.6) return;
    const fade = this.displayK * (dT < 0.08 ? dT / 0.08 : 1) * (dT > RIBBON_RUN_TIME ? 1 - (dT - RIBBON_RUN_TIME) / 0.6 : 1);
    const rib = this.rib;
    const color = this.tones.runColor.get(this.sp.lantern, '#FFFFFF', 0.15);
    const band = this.R * 0.55;
    ctx.globalCompositeOperation = 'lighter';
    ctx.fillStyle = color;
    let headX = 0;
    let headY = 0;
    for (let a = 0; a < 4; a++) {
      const o = a * P * 5;
      const c = this.arms[a];
      const run = (Math.min(dT, RIBBON_RUN_TIME) / RIBBON_RUN_TIME) * (c.len + band);
      let acc = 0;
      for (let j = 0; j < P - 1; j++) {
        const x0 = rib[o + j * 5];
        const y0 = rib[o + j * 5 + 1];
        const x1 = rib[o + (j + 1) * 5];
        const y1 = rib[o + (j + 1) * 5 + 1];
        const l = Math.sqrt((x1 - x0) * (x1 - x0) + (y1 - y0) * (y1 - y0));
        const mid = acc + l / 2;
        acc += l;
        const q = (mid - run) / band;
        const k = Math.exp(-q * q) * fade;
        if (k < 0.04) continue;
        if (a === 0 && Math.abs(q) < 0.3) {
          headX = x0;
          headY = y0;
        }
        const w0 = Math.max(Math.abs(rib[o + j * 5 + 4]), 0.6);
        const w1 = Math.max(Math.abs(rib[o + (j + 1) * 5 + 4]), 0.6);
        ctx.globalAlpha = 0.75 * k;
        ctx.beginPath();
        ctx.moveTo(x0 + rib[o + j * 5 + 2] * w0, y0 + rib[o + j * 5 + 3] * w0);
        ctx.lineTo(x1 + rib[o + (j + 1) * 5 + 2] * w1, y1 + rib[o + (j + 1) * 5 + 3] * w1);
        ctx.lineTo(x1 - rib[o + (j + 1) * 5 + 2] * w1, y1 - rib[o + (j + 1) * 5 + 3] * w1);
        ctx.lineTo(x0 - rib[o + j * 5 + 2] * w0, y0 - rib[o + j * 5 + 3] * w0);
        ctx.closePath();
        ctx.fill();
      }
    }
    ctx.globalCompositeOperation = 'source-over';
    if (headX !== 0 || headY !== 0) {
      const gain = f.lighting.glowGain(this.yNorm(f));
      f.glow(this.sp.lantern, headX, headY, this.R * 0.7, Math.max(0.35, gain) * 0.6 * fade);
    }
  }

  /** Moon jelly gonads: four horseshoe bands, filled; with strokeWidth, outlined only (outline plates). */
  private drawGonads(ctx: CanvasRenderingContext2D, f: WorldFrame, color: string, alpha: number, strokeWidth?: number) {
    const { R, H } = this;
    const plane = -0.4 * H * this.sy * CA;
    const ring = 0.31 * R * (1 - (1 - this.sx) * 0.5);
    const rg = 0.15 * R;
    const eg = 0.34;
    const gap = 0.3;
    const inner = 0.64;
    ctx.beginPath();
    for (let k = 0; k < 4; k++) {
      const a = (k * Math.PI) / 2 + this.markRot;
      const cx = ring * Math.cos(a);
      const cz = ring * Math.sin(a);
      // Horseshoe band, open toward the centre of the bell.
      const open = a + Math.PI;
      for (let i = 0; i <= 14; i++) {
        const b = open + gap + ((TAU - 2 * gap) * i) / 14;
        const x = cx + rg * Math.cos(b);
        const y = plane + (cz + rg * Math.sin(b)) * eg;
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      if (strokeWidth !== undefined) continue;
      for (let i = 14; i >= 0; i--) {
        // The band thins toward both tips, like the real horseshoe gonad.
        const b = open + gap + ((TAU - 2 * gap) * i) / 14;
        const ri = rg * (1 - (1 - inner) * Math.sqrt(Math.sin((Math.PI * i) / 14)));
        ctx.lineTo(cx + ri * Math.cos(b), plane + (cz + ri * Math.sin(b)) * eg);
      }
      ctx.closePath();
    }
    ctx.globalAlpha = alpha;
    if (strokeWidth !== undefined) {
      ctx.strokeStyle = color;
      ctx.lineWidth = Math.max(f.lineWidth, strokeWidth);
      ctx.stroke();
    } else {
      ctx.fillStyle = color;
      ctx.fill();
    }
  }

  private drawCanals(ctx: CanvasRenderingContext2D, lw: number, color: string, alpha: number, back = true) {
    ctx.strokeStyle = color;
    ctx.lineWidth = lw;
    for (let pass = back ? 0 : 1; pass < 2; pass++) {
      ctx.beginPath();
      for (let c = 0; c < 8; c++) {
        const th = ((c + 0.5) * TAU) / 8 + this.markRot * 0.5;
        if (Math.sin(th) >= 0 !== (pass === 1)) continue;
        const o0 = (c * U + 1) * 2;
        ctx.moveTo(this.canal[o0], this.canal[o0 + 1]);
        for (let i = 2; i < U; i++) {
          const o = (c * U + i) * 2;
          ctx.lineTo(this.canal[o], this.canal[o + 1]);
        }
      }
      ctx.globalAlpha = pass === 1 ? alpha : alpha * 0.5;
      ctx.stroke();
    }
  }

  /** Atolla: the coronal groove ring and the short pedal grooves below it. */
  private drawGroove(ctx: CanvasRenderingContext2D, lw: number, color: string, alphaMul = 1) {
    const sp = this.sp;
    const u = this.grooveU;
    const r = bez(0, sp.p1x * this.R, sp.p2x * this.R, this.R, u) * (1 - (1 - this.sx) * u);
    const y = bez(-this.H, -this.H, -sp.p2y * this.H, 0, u) * this.sy * CA;
    ctx.strokeStyle = color;
    ctx.lineWidth = Math.max(lw, 0.025 * this.R);
    ctx.globalAlpha = 0.16 * alphaMul;
    ctx.beginPath();
    ctx.ellipse(0, y, r, r * E, 0, Math.PI, TAU);
    ctx.stroke();
    ctx.globalAlpha = 0.34 * alphaMul;
    ctx.beginPath();
    ctx.ellipse(0, y, r, r * E, 0, 0, Math.PI);
    ctx.stroke();
    // Pedal grooves between the thick marginal lappets.
    ctx.lineWidth = lw;
    ctx.globalAlpha = 0.16 * alphaMul;
    ctx.beginPath();
    const tmp = this.rib;
    for (let i = 0; i < 22; i++) {
      const th = ((i + 0.5) * TAU) / 22 + this.markRot;
      if (Math.sin(th) < 0.05) continue;
      this.surf(u + 0.04, th, tmp, 0);
      this.surf(1, th, tmp, 2);
      ctx.moveTo(tmp[0], tmp[1]);
      ctx.lineTo(tmp[2], tmp[3]);
    }
    ctx.stroke();
  }

  /** Chrysaora: 16 dark radial stripes, tapering toward the apex. */
  private drawStripes(ctx: CanvasRenderingContext2D, color: string) {
    const tmp = this.rib;
    ctx.fillStyle = color;
    ctx.globalAlpha = 0.42;
    ctx.beginPath();
    const S = 6;
    for (let k = 0; k < 16; k++) {
      const th = ((k + 0.5) * TAU) / 16 + this.markRot * 0.5;
      if (Math.sin(th) < 0.04) continue;
      for (let i = 0; i < S; i++) {
        const u = 0.16 + (0.82 * i) / (S - 1);
        const d = 0.075 * (0.2 + 0.8 * u);
        this.surf(u, th - d, tmp, 0);
        if (i === 0) ctx.moveTo(tmp[0], tmp[1]);
        else ctx.lineTo(tmp[0], tmp[1]);
      }
      for (let i = S - 1; i >= 0; i--) {
        const u = 0.16 + (0.82 * i) / (S - 1);
        const d = 0.075 * (0.2 + 0.8 * u);
        this.surf(u, th + d, tmp, 0);
        ctx.lineTo(tmp[0], tmp[1]);
      }
      ctx.closePath();
    }
    ctx.fill();
  }

  /** Pelagia: 30 nematocyst warts; on touch each fires its own envelope (the sparkle). */
  private drawWarts(ctx: CanvasRenderingContext2D, color: string, light: string, dT: number) {
    const tmp = this.rib;
    const r = Math.max(0.6, 0.034 * this.R);
    ctx.fillStyle = color;
    ctx.globalAlpha = 0.55;
    ctx.beginPath();
    for (let i = 0; i < WARTS; i++) {
      this.surf(this.warts[i * 2], this.warts[i * 2 + 1], tmp, 0);
      const ri = Math.max(0.55, r * (0.55 + 0.45 * ((i * 7) % 5) / 4));
      ctx.moveTo(tmp[0] + ri, tmp[1]);
      ctx.arc(tmp[0], tmp[1], ri, 0, TAU);
    }
    ctx.fill();
    if (dT < 0 || dT > SPARKLE_SPREAD + 3) return;
    // Each wart's own envelope, quantized to eighths so warts of one brightness share a path.
    const q = this.wartLevel;
    for (let i = 0; i < WARTS; i++) {
      const e = envelope(dT - this.sparkleOff[i]) * this.displayK;
      q[i] = e < 0.03 ? 0 : Math.min(8, Math.max(1, Math.round(e * 8)));
    }
    // Two layers: a halo in the light's colour (2.8r, 0.16) and a whiter core (1r, 0.9).
    const core = this.tones.wartCore.get(light, '#FFFFFF', 0.5);
    ctx.globalCompositeOperation = 'lighter';
    for (let lvl = 1; lvl <= 8; lvl++) {
      let any = false;
      for (let i = 0; i < WARTS; i++) if (q[i] === lvl) any = true;
      if (!any) continue;
      for (let layer = 0; layer < 2; layer++) {
        const col = layer === 0 ? light : core;
        const k = layer === 0 ? 2.8 : 1;
        const a = layer === 0 ? 0.16 : 0.9;
        const rr = Math.max(0.7, r * k);
        ctx.fillStyle = col;
        ctx.globalAlpha = (a * lvl) / 8;
        ctx.beginPath();
        for (let i = 0; i < WARTS; i++) {
          if (q[i] !== lvl) continue;
          this.surf(this.warts[i * 2], this.warts[i * 2 + 1], tmp, 0);
          ctx.moveTo(tmp[0] + rr, tmp[1]);
          ctx.arc(tmp[0], tmp[1], rr, 0, TAU);
        }
        ctx.fill();
      }
    }
    ctx.globalCompositeOperation = 'source-over';
  }

  /** Rim lanterns: 16 dots in the margin notches. Lit count follows happiness. */
  private drawLanterns(ctx: CanvasRenderingContext2D, f: WorldFrame, night: number) {
    const sp = this.sp;
    const t = this.t;
    const hN = clamp01(this.happiness / 100);
    const lit = 6 + Math.round(10 * hN);
    const reduced = f.lighting.reducedMotion;
    const runAge = this.catchStart >= 0 ? t - this.catchStart : -1;
    const running = !reduced && runAge >= 0 && runAge < 0.5 + LANTERNS * LANTERN_STEP;
    const depth = 0.55 + 0.45 * this.z;
    const Rm = this.Rm;
    const s = clamp(this.k, 0.7, 1.15);
    let beads = 0;
    // Levels quantized to eighths so all lanterns of one brightness share one path per layer.
    const lv = this.levels;
    for (let k = 0; k < LANTERNS; k++) {
      const th = (k * TAU) / LANTERNS;
      const sin = Math.sin(th);
      const order = (LANTERNS + 8 - k) % LANTERNS;
      const isLit = bitrev4(k) < lit;
      let nightLevel = running ? candle(runAge - order * LANTERN_STEP) : this.bio;
      nightLevel *= isLit ? 1 : 0.18;
      const tapLevel = this.tapT > -50 ? envelope(t - this.tapT - order * LANTERN_STEP) * this.tapK : 0;
      const back = sin < -0.02;
      const level = Math.max(nightLevel, tapLevel) * (back ? 0.28 : 1) * this.lanternGain[k] * depth;
      lv[k] = level < 0.04 ? 0 : Math.min(8, Math.max(1, Math.round(level * 8)));
      if (lv[k] === 0 && sin >= 0 && night <= 0.6) beads |= 1 << k;
    }
    // Halo, body, core: a small candle, not a bulb.
    ctx.globalCompositeOperation = 'lighter';
    for (let q = 1; q <= 8; q++) {
      let any = false;
      for (let k = 0; k < LANTERNS; k++) if (lv[k] === q) any = true;
      if (!any) continue;
      for (let layer = 0; layer < 3; layer++) {
        const col = layer < 2 ? sp.lantern : this.lanternCore;
        const rad = LANTERN_RAD[layer];
        const a = LANTERN_A[layer];
        if (rad > 2 && f.quality < 0.8) continue;
        ctx.fillStyle = col;
        ctx.globalAlpha = Math.min(1, (a * q) / 8);
        ctx.beginPath();
        for (let k = 0; k < LANTERNS; k++) {
          if (lv[k] !== q) continue;
          const th = (k * TAU) / LANTERNS;
          const back = Math.sin(th) < -0.02;
          if (back && rad > 2) continue;
          const r = (back ? rad * 0.7 : rad) * s;
          const x = Rm * Math.cos(th);
          const y = E * Rm * Math.sin(th);
          ctx.moveTo(x + r, y);
          ctx.arc(x, y, r, 0, TAU);
        }
        ctx.fill();
      }
    }
    ctx.globalCompositeOperation = 'source-over';
    if (!beads) return;
    // Unlit: the rhopalium is still there, a tiny pale bead in its notch.
    ctx.fillStyle = this.body(this.tones.beads, this.tint.b60);
    ctx.globalAlpha = 0.4;
    ctx.beginPath();
    for (let k = 0; k < LANTERNS; k++) {
      if (!(beads & (1 << k))) continue;
      const th = (k * TAU) / LANTERNS;
      const x = Rm * Math.cos(th);
      const y = E * Rm * Math.sin(th);
      ctx.moveTo(x + 0.8 * s, y);
      ctx.arc(x, y, 0.8 * s, 0, TAU);
    }
    ctx.fill();
  }

  /** Moon jelly canal cascade, part 1: a 6px bright segment runs down all 8 canals. */
  private drawCascadeCanals(ctx: CanvasRenderingContext2D, f: WorldFrame, dT: number) {
    if (dT < 0 || dT > 1.2) return;
    const s = CASCADE_SPEED * dT;
    const k = this.displayK * Math.exp(-dT / 0.9);
    ctx.globalCompositeOperation = 'lighter';
    ctx.strokeStyle = this.sp.lantern;
    for (let pass = 0; pass < 2; pass++) {
      ctx.lineWidth = Math.max(f.lineWidth, 1.1);
      ctx.globalAlpha = pass === 0 ? 0.22 * k : 0.85 * k;
      ctx.beginPath();
      for (let c = 0; c < 8; c++) {
        const len = this.canalLen[c];
        if (s - 26 > len) continue;
        const front = Math.sin(((c + 0.5) * TAU) / 8 + this.markRot * 0.5) >= 0;
        if (!front && pass === 1) continue;
        const d0 = pass === 0 ? s - 26 : s - 6;
        const o = (c * U + 1) * 2;
        traceAlong(ctx, this.canal, this.canal, U - 1, Math.max(0, d0), Math.min(len, s), 2, o, o + 1);
      }
      ctx.stroke();
    }
    ctx.globalCompositeOperation = 'source-over';
  }

  /** Canal cascade, part 2: the light carries on down every tentacle. */
  private drawCascadeTentacles(ctx: CanvasRenderingContext2D, f: WorldFrame, dT: number) {
    if (dT < 0 || dT > 1.6) return;
    let canal = 0;
    for (let c = 0; c < 8; c++) canal += this.canalLen[c] / 8;
    const s = CASCADE_SPEED * dT - canal;
    if (s < 0) return;
    const k = this.displayK * Math.exp(-dT / 0.9);
    ctx.globalCompositeOperation = 'lighter';
    ctx.strokeStyle = this.sp.lantern;
    for (let pass = 0; pass < 2; pass++) {
      ctx.lineWidth = Math.max(f.lineWidth, 1.1);
      ctx.globalAlpha = pass === 0 ? 0.22 * k : 0.85 * k;
      ctx.beginPath();
      for (const c of this.chains) {
        if (s - 26 > c.len) continue;
        traceAlong(ctx, c.x, c.y, NODES, Math.max(0, pass === 0 ? s - 26 : s - 6), s);
      }
      for (const c of this.arms) {
        if (s - 26 > c.len) continue;
        traceAlong(ctx, c.x, c.y, NODES, Math.max(0, pass === 0 ? s - 26 : s - 6), s);
      }
      ctx.stroke();
    }
    ctx.globalCompositeOperation = 'source-over';
  }

  /** Dream jelly pinwheel: a 3-dot bright arc chases round the rim at 2 rev/s for 1.6s. */
  private drawPinwheel(ctx: CanvasRenderingContext2D, f: WorldFrame, dT: number) {
    if (dT < 0 || dT > PINWHEEL_TIME) return;
    const fade = this.displayK * Math.min(1, dT / 0.08) * (dT > PINWHEEL_TIME - 0.45 ? (PINWHEEL_TIME - dT) / 0.45 : 1);
    const head = this.displayAngle + TAU * 2 * dT;
    const Rm = this.Rm;
    const s = clamp(this.k, 0.7, 1.15);
    const light = this.sp.lantern;
    const core = this.tones.pinCore.get(light, '#FFFFFF', 0.55);
    ctx.globalCompositeOperation = 'lighter';
    // A faint comet arc behind the dots.
    ctx.strokeStyle = light;
    ctx.lineWidth = Math.max(f.lineWidth, 1.2);
    ctx.globalAlpha = 0.25 * fade;
    ctx.beginPath();
    for (let i = 0; i <= 10; i++) {
      const a = head - (i / 10) * 1.2;
      const x = Rm * Math.cos(a);
      const y = E * Rm * Math.sin(a);
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.stroke();
    for (let d = 0; d < 3; d++) {
      const a = head - d * 0.3;
      const x = Rm * Math.cos(a);
      const y = E * Rm * Math.sin(a);
      const lv = fade * (1 - d * 0.28) * (Math.sin(a) < 0 ? 0.55 : 1);
      ctx.fillStyle = light;
      ctx.globalAlpha = 0.3 * lv;
      ctx.beginPath();
      ctx.arc(x, y, 3.6 * s, 0, TAU);
      ctx.fill();
      ctx.fillStyle = core;
      ctx.globalAlpha = lv;
      ctx.beginPath();
      ctx.arc(x, y, 1.7 * s, 0, TAU);
      ctx.fill();
    }
    ctx.globalCompositeOperation = 'source-over';
    const gain = f.lighting.glowGain(this.yNorm(f));
    f.glow(light, Rm * Math.cos(head), E * Rm * Math.sin(head), this.R * 0.55, Math.max(0.35, gain) * 0.7 * fade);
  }

  /** Shop "not yet" plate: the same creature as a hairline drawing. No fill, no glow. */
  private drawOutline(ctx: CanvasRenderingContext2D, f: WorldFrame, color: string) {
    const lw = f.lineWidth;
    ctx.strokeStyle = color;
    ctx.lineWidth = lw;
    for (let side = 0; side < 2; side++) {
      const front = side === 1;
      ctx.globalAlpha = 0.55 * 0.6;
      ctx.beginPath();
      for (const c of this.chains) {
        if (Math.sin(c.theta) >= 0 !== front) continue;
        traceRun(ctx, c.x, c.y, 1, NODES - 2, NODES);
      }
      ctx.stroke();
    }
    this.drawArms(ctx, f, false, 0, color);
    this.enterBell(ctx);
    ctx.strokeStyle = color;
    ctx.lineWidth = lw;
    ctx.globalAlpha = 0.55 * 0.4;
    ctx.beginPath();
    ctx.ellipse(0, 0, this.Rm, E * this.Rm, 0, Math.PI, TAU);
    ctx.stroke();
    this.drawCanals(ctx, lw, color, 0.55 * 0.45);
    const mark = this.sp.mark;
    if (mark === 'gonads') this.drawGonads(ctx, f, color, 0.55 * 0.5, lw);
    if (mark === 'groove') this.drawGroove(ctx, lw, color, 0.8);
    ctx.strokeStyle = color;
    ctx.lineWidth = lw;
    ctx.globalAlpha = 0.55;
    ctx.beginPath();
    this.traceBell(ctx);
    ctx.stroke();
    ctx.restore();
  }
}

/** Creates one jellyfish. Variants: cyan (Moon), lilac (Dream), gold (Sunset), ribbon (Ribbon). */
export const createJellyfish: CreatureFactory = (init) => new Jellyfish(init);
