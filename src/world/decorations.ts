/**
 * Decoration drawing for the Scenery track: Swaying kelp, the sea fan, the sunken chest and
 * the ancient ruins. Geometry is built once from a seeded stream; the draw functions take
 * resolved colors so the sea and the shop plates share the same code.
 */
import type { Rand } from './rng';
import { range, valueNoise1D } from './rng';
import { adjustOK, mixOK } from './palette';
import { glowSprite } from './light';

const TAU = Math.PI * 2;
const DEG = Math.PI / 180;

/** How to paint: filled flat planes, or a hairline outline for "not yet" shop plates. */
export interface Ink {
  /** Outline stroke color; null paints filled shapes. */
  outline: string | null;
  /** Thinnest stroke in CSS px. */
  lw: number;
}

/** Flat list of small additive lights: x, y, radius, alpha, colorIndex. */
export interface DotBatch {
  colors: string[];
  v: number[];
}

export function newDots(): DotBatch {
  return { colors: [], v: [] };
}

export function pushDot(b: DotBatch, color: string, x: number, y: number, r: number, a: number): void {
  if (a <= 0.004) return;
  let i = b.colors.indexOf(color);
  if (i < 0) i = b.colors.push(color) - 1;
  b.v.push(x, y, r, a, i);
}

/**
 * Draws a batch of small glow dots (pneumatocysts, polyps, plankton). Like spark dots these are
 * tiny pre-rendered sprites, so they sit outside the 24-sprite glow budget.
 */
export function flushDots(ctx: CanvasRenderingContext2D, b: DotBatch): void {
  if (!b.v.length) return;
  const op = ctx.globalCompositeOperation;
  const ga = ctx.globalAlpha;
  ctx.globalCompositeOperation = 'lighter';
  const sprites = b.colors.map((c) => glowSprite(c, 64));
  for (let i = 0; i < b.v.length; i += 5) {
    const r = b.v[i + 2];
    ctx.globalAlpha = Math.min(1, b.v[i + 3]);
    ctx.drawImage(sprites[b.v[i + 4]], b.v[i] - r, b.v[i + 1] - r, r * 2, r * 2);
  }
  ctx.globalCompositeOperation = op;
  ctx.globalAlpha = ga;
  b.v.length = 0;
  b.colors.length = 0;
}

function paint(ctx: CanvasRenderingContext2D, p: Path2D, color: string, ink: Ink): void {
  if (ink.outline) {
    ctx.strokeStyle = ink.outline;
    ctx.lineWidth = ink.lw;
    ctx.stroke(p);
  } else {
    ctx.fillStyle = color;
    ctx.fill(p);
  }
}

/**
 * Sediment caps (Alto's snowcap) along the up-facing runs of a polyline. Points are flat
 * [x0, y0, x1, y1, ...] travelling with the solid on the right (left to right along a top edge,
 * clockwise round a closed shape). The band thins out on steep faces and vanishes on overhangs.
 *
 * Caps are only ever filled, so each band is closed with an explicit line back to its start
 * instead of closePath(): a fill closes every subpath anyway, and in Chrome closePath() costs
 * time in proportion to the length of the subpath it closes (the same goes for ribbon and leaf).
 */
export function addCaps(
  path: Path2D | CanvasRenderingContext2D,
  pts: ArrayLike<number>,
  closed: boolean,
  thick: (x: number, i: number) => number,
): void {
  const n = pts.length >> 1;
  const outer: number[] = [];
  const inner: number[] = [];
  const flush = () => {
    if (outer.length >= 4) {
      path.moveTo(outer[0], outer[1]);
      for (let i = 2; i < outer.length; i += 2) path.lineTo(outer[i], outer[i + 1]);
      for (let i = inner.length - 2; i >= 0; i -= 2) path.lineTo(inner[i], inner[i + 1]);
      path.lineTo(outer[0], outer[1]);
    }
    outer.length = 0;
    inner.length = 0;
  };
  for (let i = 0; i < n; i++) {
    const a = i > 0 ? i - 1 : closed ? n - 1 : 0;
    const b = i < n - 1 ? i + 1 : closed ? 0 : n - 1;
    const dx = pts[b * 2] - pts[a * 2];
    const dy = pts[b * 2 + 1] - pts[a * 2 + 1];
    const len = Math.hypot(dx, dy) || 1;
    const nx = dy / len;
    const ny = -dx / len;
    const k = Math.min(1, Math.max(0, (-ny - 0.42) / 0.4));
    const x = pts[i * 2];
    const y = pts[i * 2 + 1];
    const tk = thick(x, i) * Math.pow(k, 0.8);
    if (tk > 0.3) {
      outer.push(x, y);
      inner.push(x - nx * tk, y - ny * tk);
    } else {
      // Close the band on the last point so its end tapers instead of snapping.
      if (outer.length) {
        outer.push(x, y);
        inner.push(x, y);
      }
      flush();
    }
  }
  flush();
}

/** Samples a Catmull-Rom spline through flat control points into a dense flat polyline. */
export function spline(ctrl: number[], closed: boolean, seg: number): number[] {
  const n = ctrl.length >> 1;
  const out: number[] = [];
  const P = (i: number, c: 0 | 1) => {
    const j = closed ? ((i % n) + n) % n : Math.min(n - 1, Math.max(0, i));
    return ctrl[j * 2 + c];
  };
  const last = closed ? n : n - 1;
  for (let i = 0; i < last; i++) {
    for (let s = 0; s < seg; s++) {
      const t = s / seg;
      const t2 = t * t;
      const t3 = t2 * t;
      for (const c of [0, 1] as const) {
        const p0 = P(i - 1, c);
        const p1 = P(i, c);
        const p2 = P(i + 1, c);
        const p3 = P(i + 2, c);
        out.push(0.5 * (2 * p1 + (-p0 + p2) * t + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t2 + (-p0 + 3 * p1 - 3 * p2 + p3) * t3));
      }
    }
  }
  if (!closed) out.push(ctrl[(n - 1) * 2], ctrl[(n - 1) * 2 + 1]);
  return out;
}

/** Returns the points ordered clockwise on screen (y down), so the solid is right of travel. */
export function clockwise(pts: number[]): number[] {
  let a = 0;
  for (let i = 0; i < pts.length; i += 2) {
    const j = (i + 2) % pts.length;
    a += pts[i] * pts[j + 1] - pts[j] * pts[i + 1];
  }
  if (a >= 0) return pts;
  const out: number[] = [];
  for (let i = pts.length - 2; i >= 0; i -= 2) out.push(pts[i], pts[i + 1]);
  return out;
}

export function polyPath(pts: ArrayLike<number>, path = new Path2D()): Path2D {
  path.moveTo(pts[0], pts[1]);
  for (let i = 2; i < pts.length; i += 2) path.lineTo(pts[i], pts[i + 1]);
  path.closePath();
  return path;
}

/** CSS cubic-bezier easing. */
export function cubicBezier(x1: number, y1: number, x2: number, y2: number): (t: number) => number {
  const bx = (t: number) => 3 * x1 * t * (1 - t) ** 2 + 3 * x2 * t * t * (1 - t) + t ** 3;
  const by = (t: number) => 3 * y1 * t * (1 - t) ** 2 + 3 * y2 * t * t * (1 - t) + t ** 3;
  return (x: number) => {
    if (x <= 0) return 0;
    if (x >= 1) return 1;
    let lo = 0;
    let hi = 1;
    for (let i = 0; i < 22; i++) {
      const mid = (lo + hi) / 2;
      if (bx(mid) < x) lo = mid;
      else hi = mid;
    }
    return by((lo + hi) / 2);
  };
}

export const easeEnter = cubicBezier(0.16, 1, 0.3, 1);

// ---------------------------------------------------------------------------
// Swaying kelp (Macrocystis pyrifera)
// ---------------------------------------------------------------------------

interface KelpBlade {
  /** Where it joins the stipe, 0 base .. 1 tip. */
  s: number;
  /** Which side of the stipe its stalk and bulb leave from. */
  side: 1 | -1;
  len: number;
  /** World angle (rad, y down) the blade leaves its bulb at; 0 streams downstream (right). */
  ang: number;
  /** How far the blade bends with the current (+x) and sags (+y), as fractions of its length. */
  cx: number;
  cy: number;
  /** Widest point as a fraction of its length. */
  wid: number;
  /** Undulations along each wavy edge. */
  waves: number;
  ph: number;
  /** Behind the stipe: drawn first, a shade darker. */
  back: boolean;
  /** Lantern strength of this blade's bulb at night (they are not all equal). */
  glow: number;
}

export interface KelpStalk {
  x: number;
  y: number;
  h: number;
  /** Tip swing in px. */
  swing: number;
  period: number;
  phase: number;
  lean: number;
  bend: number;
  /** Slow sinuous kinks in the stipe: amplitude (fraction of h), waves along it, phase. */
  wig: number;
  wigN: number;
  wigPh: number;
  unit: number;
  blades: KelpBlade[];
}

/**
 * Seeds one Macrocystis frond: a long sinuous stipe and 11-15 blades, each on a short stalk with
 * a gas bulb at its base. Most blades stream downstream; a few on the upstream side float up and
 * are bent back over by the current; young blades crowd short near the growing tip.
 */
export function buildKelpStalk(
  rand: Rand,
  x: number,
  y: number,
  h: number,
  unit: number,
  /** Blade length and blade spacing multipliers (short shop specimens want fewer, larger blades). */
  bladeK = 1,
  spaceK = 1,
): KelpStalk {
  const blades: KelpBlade[] = [];
  let s = range(rand, 0.1, 0.14);
  let side: 1 | -1 = rand() < 0.5 ? 1 : -1;
  while (s < 0.9) {
    const young = smoothstep(0.66, 0.9, s);
    const up = side < 0 && rand() < 0.4;
    blades.push({
      s,
      side,
      len: h * range(rand, 0.16, 0.25) * bladeK * (1 - 0.42 * young),
      ang: up ? -Math.PI / 2 - range(rand, 0.45, 0.85) : range(rand, -0.3, 0.75) - 0.3 * young,
      cx: up ? range(rand, 0.4, 0.55) : range(rand, 0.08, 0.2),
      cy: up ? range(rand, 0, 0.08) : range(rand, 0.12, 0.3),
      wid: range(rand, 0.14, 0.18),
      waves: range(rand, 5.5, 8),
      ph: rand() * TAU,
      back: rand() < 0.35,
      glow: range(rand, 0.5, 1),
    });
    s += range(rand, 0.055, 0.1) * spaceK * (1 - 0.3 * young);
    side = side === 1 ? -1 : 1;
  }
  // The growing tip: a narrow sickle-shaped blade bending over downstream.
  blades.push({
    s: 0.985,
    side: 1,
    len: h * range(rand, 0.13, 0.16) * bladeK,
    ang: -Math.PI / 2 + range(rand, 0.35, 0.55),
    cx: range(rand, 0.45, 0.6),
    cy: range(rand, 0.3, 0.4),
    wid: 0.12,
    waves: range(rand, 4, 5.5),
    ph: rand() * TAU,
    back: false,
    glow: range(rand, 0.5, 1),
  });
  return {
    x,
    y,
    h,
    swing: 18 * unit,
    period: range(rand, 9.1, 13.7),
    phase: rand() * TAU,
    lean: range(rand, 0, 0.07),
    bend: range(rand, -0.05, 0.07),
    wig: range(rand, 0.012, 0.022),
    wigN: range(rand, 1.6, 2.6),
    wigPh: rand() * TAU,
    unit,
    blades,
  };
}

/** Horizontal displacement of a kelp stalk at fraction s (0 base .. 1 tip). */
export function kelpSway(k: KelpStalk, s: number, t: number, mul: number): number {
  const w = (TAU * t) / k.period - 2.3 * s + k.phase;
  const kink = k.wig * k.h * Math.sin(s * Math.PI * k.wigN + k.wigPh) * Math.min(1, s * 3);
  return k.swing * mul * Math.pow(s, 1.5) * Math.sin(w) + k.lean * k.h * s + k.bend * k.h * s * s + kink;
}

/**
 * Outline of one kelp blade (a long strap with wavy edges, narrow at its bulb and blunt at the
 * tip), leaving (x, y) at world angle `a` and bending with the current. Writes the two edges into
 * `top` and `bot` (flat x, y lists, base to tip). `lit` is the light-facing edge: +1 top, -1 bottom.
 */
export function kelpBladeEdges(
  x: number,
  y: number,
  a: number,
  len: number,
  wid: number,
  cx: number,
  cy: number,
  waves: number,
  ph: number,
  wob: number,
  minHalf: number,
  top: number[],
  bot: number[],
  n = 12,
): number {
  top.length = 0;
  bot.length = 0;
  const ax = Math.cos(a);
  const ay = Math.sin(a);
  let lit = 1;
  for (let i = 0; i <= n; i++) {
    const q = i / n;
    const dx = ax + 2 * cx * q;
    const dy = ay + 2 * cy * q;
    const dl = Math.hypot(dx, dy) || 1;
    const px = -dy / dl;
    const py = dx / dl;
    // A slow ripple travels along the blade so it never hangs still.
    const rip = wob * len * Math.sin(q * 5.2 - ph) * q;
    const mx = x + (ax * q + cx * q * q) * len + px * rip;
    const my = y + (ay * q + cy * q * q) * len + py * rip;
    if (i === n >> 1) lit = py < 0 ? 1 : -1;
    const body = Math.pow(Math.sin((Math.PI / 2) * Math.min(1, q / 0.3)), 0.9) * (1 - 0.82 * smoothstep(0.5, 1, q));
    const hw = 0.5 * wid * len * body;
    const e = waves * TAU * q;
    const ht = hw * (1 + 0.2 * Math.sin(e + ph)) + minHalf;
    const hb = hw * (1 + 0.2 * Math.sin(e + ph + 1.9)) + minHalf;
    top.push(mx + px * ht, my + py * ht);
    bot.push(mx - px * hb, my - py * hb);
  }
  return lit;
}

export interface KelpColors {
  blade: string;
  edge: string;
  /** Lantern activation 0..1 at a height in CSS px (biolum). */
  lantern: (y: number) => number;
  lanternColor: string;
}

const KP = 16;
const kx = new Float32Array(KP);
const ky = new Float32Array(KP);
const eTop: number[] = [];
const eBot: number[] = [];
const iTop: number[] = [];
const iBot: number[] = [];
/** Bulb positions of the stalk being drawn (x, y, angle, glow), reused every frame. */
const kBulbs: number[] = [];
/**
 * The blades of the stalk being drawn, one record each: stalk (ox, oy, bx, by), back flag, lit
 * side, then the top edge, bottom edge and inset edge as 13 (x, y) pairs. Kept between frames so
 * a stalk is drawn with no Path2D or array made per frame.
 */
const KB_EDGE = 26;
const KB_STRIDE = 6 + 3 * KB_EDGE;
let kBlades = new Float64Array(16 * KB_STRIDE);
const KB_TOP = 6;
const KB_BOT = 6 + KB_EDGE;
const KB_INS = 6 + 2 * KB_EDGE;

/** Appends a blade outline read from kBlades (edges at offsets `top` and `bot`); `closed` as for ribbon(). */
function leafAt(ctx: CanvasRenderingContext2D, top: number, bot: number, closed: boolean): void {
  const b = kBlades;
  ctx.moveTo(b[top], b[top + 1]);
  for (let i = 2; i < KB_EDGE; i += 2) ctx.lineTo(b[top + i], b[top + i + 1]);
  for (let i = KB_EDGE - 2; i >= 0; i -= 2) ctx.lineTo(b[bot + i], b[bot + i + 1]);
  if (closed) ctx.closePath();
  else ctx.lineTo(b[top], b[top + 1]);
}

/**
 * One Macrocystis frond: a 16-point travelling-wave stipe; long wavy-edged blades on short
 * stalks, a gas bulb at each blade's base, streaming with the current. Blades carry a lit edge on
 * the side facing the light; those behind the stipe sit a shade darker.
 */
export function drawKelpStalk(
  ctx: CanvasRenderingContext2D,
  k: KelpStalk,
  t: number,
  mul: number,
  col: KelpColors,
  ink: Ink,
  dots: DotBatch,
): void {
  for (let i = 0; i < KP; i++) {
    const s = i / (KP - 1);
    kx[i] = k.x + kelpSway(k, s, t, mul);
    ky[i] = k.y - k.h * s;
  }
  const u = k.unit;
  const closed = !!ink.outline;
  const bulbs = kBulbs;
  bulbs.length = 0;
  const edgeW = 1.3 * u;
  const flow = Math.sin((TAU * t) / k.period + k.phase - 1.2);
  const nb = k.blades.length;
  if (kBlades.length < nb * KB_STRIDE) kBlades = new Float64Array(nb * KB_STRIDE);
  const kb = kBlades;

  for (let bi = 0; bi < nb; bi++) {
    const b = k.blades[bi];
    const o = bi * KB_STRIDE;
    const f = b.s * (KP - 1);
    const i0 = Math.min(KP - 2, Math.floor(f));
    const fr = Math.min(1, f - i0);
    const sx = kx[i0] + (kx[i0 + 1] - kx[i0]) * fr;
    const sy = ky[i0] + (ky[i0 + 1] - ky[i0]) * fr;
    const tan = Math.atan2(ky[i0 + 1] - ky[i0], kx[i0 + 1] - kx[i0]);
    // Blades follow the stipe's bend half-way and flutter with the passing wave.
    const flutter = 0.12 * mul * Math.sin((TAU * t) / k.period - 2.3 * b.s + k.phase - 0.8 + b.ph * 0.3);
    const a = b.ang + 0.5 * (tan + Math.PI / 2) + flutter;
    const ax = Math.cos(a);
    const ay = Math.sin(a);
    // Short stalk from the stipe's side out to the bulb.
    const nx = -Math.sin(tan) * b.side;
    const ny = Math.cos(tan) * b.side;
    const ox = sx + nx * 1.2 * u;
    const oy = sy + ny * 1.2 * u;
    const bx = ox + (nx * 0.5 + ax * 0.8) * 3.2 * u;
    const by = oy + (ny * 0.5 + ay * 0.8) * 3.2 * u;
    kb[o] = ox;
    kb[o + 1] = oy;
    kb[o + 2] = bx;
    kb[o + 3] = by;
    kb[o + 4] = b.back ? 1 : 0;
    bulbs.push(bx + ax * 1.2 * u, by + ay * 1.2 * u, a, b.glow);
    const cxk = b.cx * (1 + 0.3 * flow * mul);
    const lit = kelpBladeEdges(
      bx + ax * 2.6 * u, by + ay * 2.6 * u, a, b.len, b.wid, cxk, b.cy, b.waves, b.ph + t * 0.9, 0.035, 0.35 * u, eTop, eBot,
    );
    kb[o + 5] = lit;
    for (let i = 0; i < KB_EDGE; i++) {
      kb[o + KB_TOP + i] = eTop[i];
      kb[o + KB_BOT + i] = eBot[i];
    }
    if (b.back) continue;
    // The body keeps the full width on the shaded side, leaving a lit sliver on the other.
    const ins = lit > 0 ? iTop : iBot;
    inset(eTop, eBot, ins, lit > 0 ? eTop : eBot, edgeW);
    for (let i = 0; i < KB_EDGE; i++) kb[o + KB_INS + i] = ins[i];
  }

  // Back blades, stipe, stalks, lit edges, bodies: each one path on the context.
  const backLeaves = () => {
    ctx.beginPath();
    for (let bi = 0; bi < nb; bi++) {
      const o = bi * KB_STRIDE;
      if (kb[o + 4]) leafAt(ctx, o + KB_TOP, o + KB_BOT, closed);
    }
  };
  const stipe = () => {
    ctx.beginPath();
    ribbon(ctx, kx, ky, KP, 2.6 * u, 1.3 * u, closed);
  };
  const stalks = () => {
    ctx.beginPath();
    for (let bi = 0; bi < nb; bi++) {
      const o = bi * KB_STRIDE;
      ctx.moveTo(kb[o], kb[o + 1]);
      ctx.lineTo(kb[o + 2], kb[o + 3]);
    }
  };
  const edgeLeaves = () => {
    ctx.beginPath();
    for (let bi = 0; bi < nb; bi++) {
      const o = bi * KB_STRIDE;
      if (!kb[o + 4]) leafAt(ctx, o + KB_TOP, o + KB_BOT, closed);
    }
  };
  const bodyLeaves = () => {
    ctx.beginPath();
    for (let bi = 0; bi < nb; bi++) {
      const o = bi * KB_STRIDE;
      if (kb[o + 4]) continue;
      if (kb[o + 5] > 0) leafAt(ctx, o + KB_INS, o + KB_BOT, false);
      else leafAt(ctx, o + KB_TOP, o + KB_INS, false);
    }
  };

  const lw = Math.max(ink.lw, 0.9 * u);
  if (ink.outline) {
    ctx.strokeStyle = ink.outline;
    ctx.lineWidth = ink.lw;
    backLeaves();
    ctx.stroke();
    stipe();
    ctx.stroke();
    stalks();
    ctx.stroke();
    edgeLeaves();
    ctx.stroke();
    for (let i = 0; i < bulbs.length; i += 4) {
      ctx.beginPath();
      ctx.ellipse(bulbs[i], bulbs[i + 1], 2.5 * u, 1.8 * u, bulbs[i + 2], 0, TAU);
      ctx.stroke();
    }
    return;
  }
  const back = adjustOK(col.blade, -0.035);
  ctx.fillStyle = back;
  backLeaves();
  ctx.fill();
  ctx.fillStyle = col.blade;
  stipe();
  ctx.fill();
  ctx.strokeStyle = col.blade;
  ctx.lineWidth = lw;
  ctx.lineCap = 'round';
  stalks();
  ctx.stroke();
  ctx.fillStyle = col.edge;
  edgeLeaves();
  ctx.fill();
  ctx.fillStyle = col.blade;
  bodyLeaves();
  ctx.fill();
  const bulbDay = mixOK(col.blade, col.edge, 0.55);
  for (let i = 0; i < bulbs.length; i += 4) {
    const lit = col.lantern(bulbs[i + 1]) * bulbs[i + 3];
    ctx.fillStyle = lit > 0.01 ? mixOK(bulbDay, col.lanternColor, Math.min(1, lit * 0.9)) : bulbDay;
    ctx.beginPath();
    ctx.ellipse(bulbs[i], bulbs[i + 1], 2.5 * u, 1.8 * u, bulbs[i + 2], 0, TAU);
    ctx.fill();
    if (lit > 0.01) pushDot(dots, col.lanternColor, bulbs[i], bulbs[i + 1], 9 * u, 0.42 * lit);
  }
}

/** Moves one edge of a blade `d` px toward the other (the shaded body inside a lit rim). */
function inset(top: number[], bot: number[], out: number[], from: number[], d: number): void {
  out.length = 0;
  const other = from === top ? bot : top;
  for (let i = 0; i < from.length; i += 2) {
    const vx = other[i] - from[i];
    const vy = other[i + 1] - from[i + 1];
    const l = Math.hypot(vx, vy);
    const k = l > 1e-3 ? Math.min(d, l * 0.45) / l : 0;
    out.push(from[i] + vx * k, from[i + 1] + vy * k);
  }
}

/**
 * Appends a tapered ribbon along a polyline (allocation-free: it runs every frame). `closed` uses
 * closePath(), needed only when the ribbon will be stroked (a fill closes it with a plain line).
 */
export function ribbon(path: Path2D | CanvasRenderingContext2D, xs: ArrayLike<number>, ys: ArrayLike<number>, n: number, w0: number, w1: number, closed = true): void {
  let x0 = 0;
  let y0 = 0;
  for (let pass = 0; pass < 2; pass++) {
    const sgn = pass === 0 ? 1 : -1;
    for (let k = 0; k < n; k++) {
      const i = pass === 0 ? k : n - 1 - k;
      const j = Math.min(n - 1, i + 1);
      const h = Math.max(0, i - 1);
      const dx = xs[j] - xs[h];
      const dy = ys[j] - ys[h];
      const l = Math.hypot(dx, dy) || 1;
      const half = (w0 + (w1 - w0) * (i / (n - 1))) / 2;
      const x = xs[i] - sgn * (dy / l) * half;
      const y = ys[i] + sgn * (dx / l) * half;
      if (pass === 0 && k === 0) {
        x0 = x;
        y0 = y;
        path.moveTo(x, y);
      } else path.lineTo(x, y);
    }
  }
  if (closed) path.closePath();
  else path.lineTo(x0, y0);
}

function smoothstep(e0: number, e1: number, x: number): number {
  const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0)));
  return t * t * (3 - 2 * t);
}

// ---------------------------------------------------------------------------
// Sea fan (Gorgonia ventalina)
// ---------------------------------------------------------------------------

export interface SeaFan {
  /** Strokes in normalised units (base at 0, 0, top at y -1): flat x, y polylines with a width level. */
  lines: { pts: number[]; level: number }[];
  /** Polyp positions (normalised) and twinkle phases: x, y, phase. */
  polyps: number[];
  /** Half width of the fan relative to its height. */
  halfWidth: number;
  /** Upright runs of the central ribs a seahorse can hold: x0, y0, x1, y1 per hold (normalised). */
  holds: number[];
  cache: Map<string, Path2D[]>;
}

interface Rib {
  lo: number;
  hi: number;
  th: number;
  /** Smooth angular wander, so ribs meander instead of running dead straight. */
  drift: number;
  /** Radius it forked at, and the gap that will make it fork again. */
  born: number;
  forkAt: number;
  nextLink: number;
  /** Points per radial step, NaN where it has not grown or has ended. */
  xs: number[];
  ys: number[];
  alive: boolean;
}

const FAN_STEP = 0.028;
const FAN_GAP = 0.04;

/**
 * A flat gorgonian fan, wider than tall, on a short thick stalk. A few main ribs leave the stalk
 * and fork again and again as they spread (each fork 18-32 degrees), so the ribs stay evenly
 * spaced right out to the rounded edge; short cross-links fuse neighbouring ribs into a lacy mesh.
 * 40 polyps sit on the outer branches.
 */
export function buildSeaFan(rand: Rand): SeaFan {
  const TH = 1.22;
  const ox = 0;
  const oy = -0.075;
  const lobe = valueNoise1D(rand, 0.45);
  const tilt = range(rand, -0.06, 0.06);
  /** The fan's rounded outline: radius from the stalk top at angle th (0 straight up). */
  const rim = (th: number) => {
    const a = 0.8 * (th > 0 ? 1.04 : 0.97);
    const b = 0.925;
    return (1 / Math.hypot(Math.sin(th) / a, Math.cos(th) / b)) * (1 + 0.06 * lobe(th + 3) + 0.04 * Math.cos(th * 5 + 1));
  };
  const ribs: Rib[] = [];
  const mains = 5;
  const edges = [-TH];
  for (let i = 1; i < mains; i++) edges.push(-TH + ((2 * TH) / mains) * (i + range(rand, -0.22, 0.22)));
  edges.push(TH);
  for (let i = 0; i < mains; i++) {
    ribs.push({ lo: edges[i], hi: edges[i + 1], th: tilt, drift: 0, born: 0, forkAt: FAN_GAP * range(rand, 1.7, 2.3), nextLink: 0.1, xs: [], ys: [], alive: true });
  }
  const steps = Math.ceil(1.1 / FAN_STEP);
  const tips: number[] = [];
  const links: number[][] = [];
  for (let j = 0; j <= steps; j++) {
    const r = j * FAN_STEP;
    // Fork any rib whose sector has grown too wide.
    for (const rb of [...ribs]) {
      if (!rb.alive || r * (rb.hi - rb.lo) < rb.forkAt) continue;
      const cut = rb.lo + (rb.hi - rb.lo) * range(rand, 0.42, 0.58);
      const child: Rib = {
        lo: cut, hi: rb.hi, th: rb.th, drift: -rb.drift, born: r, forkAt: FAN_GAP * range(rand, 1.7, 2.3), nextLink: r + FAN_GAP * range(rand, 0.9, 1.5),
        xs: rb.xs.map(() => NaN), ys: rb.ys.map(() => NaN), alive: true,
      };
      // The child starts from the parent's last point so the fork is joined.
      const last = rb.xs.length - 1;
      if (last >= 0) {
        child.xs[last] = rb.xs[last];
        child.ys[last] = rb.ys[last];
      }
      rb.hi = cut;
      rb.born = r;
      rb.forkAt = FAN_GAP * range(rand, 1.7, 2.3);
      rb.nextLink = Math.max(rb.nextLink, r + FAN_GAP * range(rand, 0.9, 1.5));
      ribs.splice(ribs.indexOf(rb) + 1, 0, child);
    }
    for (const rb of ribs) {
      if (!rb.alive) {
        rb.xs.push(NaN);
        rb.ys.push(NaN);
        continue;
      }
      const mid = (rb.lo + rb.hi) / 2;
      // Ease toward the sector's centre: fast after a fork (an 18-32 degree split), then steady.
      rb.drift = rb.drift * 0.8 + range(rand, -1, 1) * 0.35;
      rb.th += (mid - rb.th) * (j < 3 ? 0.18 : 0.3) + (rb.drift * FAN_GAP * 0.4) / Math.max(0.15, r);
      const x = ox + Math.sin(rb.th) * r;
      const y = oy - Math.cos(rb.th) * r;
      rb.xs.push(x);
      rb.ys.push(y);
      if (r >= rim(rb.th) * range(rand, 0.95, 1)) {
        rb.alive = false;
        tips.push(x, y);
      }
    }
    // Cross-links between neighbouring ribs fuse the fan into a net.
    for (let i = 0; i + 1 < ribs.length; i++) {
      const a = ribs[i];
      const b = ribs[i + 1];
      if (!a.alive || !b.alive || r < a.nextLink || r - a.born < 0.05 || r - b.born < 0.05) continue;
      a.nextLink = r + FAN_GAP * range(rand, 0.65, 1.2);
      if (rand() < 0.1) continue;
      const ja = Math.max(0, j - (rand() < 0.3 ? 1 : 0));
      const ax = a.xs[ja];
      const ay = a.ys[ja];
      if (!Number.isFinite(ax)) continue;
      const jb = Math.max(0, j - (rand() < 0.3 ? 1 : 0));
      const bx = b.xs[jb];
      const by = b.ys[jb];
      if (!Number.isFinite(bx)) continue;
      const mx = (ax + bx) / 2;
      const my = (ay + by) / 2;
      const rr = Math.hypot(mx - ox, my - oy) || 1;
      const bow = range(rand, -0.25, 0.4) * Math.hypot(bx - ax, by - ay);
      links.push([ax, ay, mx + ((mx - ox) / rr) * bow, my + ((my - oy) / rr) * bow, bx, by]);
    }
  }
  // Rib polylines, split where their width steps down with distance from the stalk.
  const lines: { pts: number[]; level: number }[] = [];
  const levelAt = (r: number) => Math.min(5, 1 + Math.floor(r * 4.4));
  const holds: number[] = [];
  for (const rb of ribs) {
    let cur: number[] = [];
    let lvl = -1;
    for (let j = 0; j < rb.xs.length; j++) {
      const x = rb.xs[j];
      const y = rb.ys[j];
      if (!Number.isFinite(x)) continue;
      const l = levelAt(j * FAN_STEP);
      if (!cur.length) {
        cur.push(x, y);
        lvl = l;
        continue;
      }
      cur.push(x, y);
      if (l !== lvl) {
        lines.push({ pts: cur, level: lvl });
        cur = [x, y];
        lvl = l;
      }
    }
    if (cur.length >= 4) lines.push({ pts: cur, level: lvl });
  }
  for (const k of links) lines.push({ pts: k, level: 6 });
  // The stalk: short and thick, flaring into a holdfast.
  lines.push({ pts: [0, 0.006, 0.002, -0.035, ox + tilt * 0.3, oy], level: 0 });
  lines.push({ pts: [-0.03, 0.008, -0.008, -0.006, 0, -0.03], level: 1 });
  lines.push({ pts: [0.032, 0.007, 0.01, -0.008, 0.002, -0.03], level: 1 });
  // Holds: the central ribs' upright runs, between radius .2 and .55.
  const central = ribs
    .filter((rb) => Number.isFinite(rb.xs[Math.round(0.2 / FAN_STEP)]) && Number.isFinite(rb.xs[Math.round(0.55 / FAN_STEP)]))
    .sort((a, b) => Math.abs(a.th) - Math.abs(b.th))
    .slice(0, 3);
  for (const rb of central) {
    const j0 = Math.round(0.2 / FAN_STEP);
    const j1 = Math.round(0.55 / FAN_STEP);
    holds.push(rb.xs[j0], rb.ys[j0], rb.xs[j1], rb.ys[j1]);
  }
  // Normalise to height 1 (top at y -1).
  let minY = 0;
  let maxX = 0;
  for (const ln of lines) {
    for (let i = 0; i < ln.pts.length; i += 2) {
      minY = Math.min(minY, ln.pts[i + 1]);
      maxX = Math.max(maxX, Math.abs(ln.pts[i]));
    }
  }
  const sc = 1 / -minY;
  for (const ln of lines) for (let i = 0; i < ln.pts.length; i++) ln.pts[i] *= sc;
  for (let i = 0; i < holds.length; i++) holds[i] *= sc;
  // Polyps: on the outer branches and their tips.
  const spots: number[] = [];
  for (let i = 0; i < tips.length; i += 2) spots.push(tips[i] * sc, tips[i + 1] * sc);
  for (const rb of ribs) {
    for (let j = Math.round(0.4 / FAN_STEP); j < rb.xs.length; j += 3) {
      if (Number.isFinite(rb.xs[j])) spots.push(rb.xs[j] * sc, rb.ys[j] * sc);
    }
  }
  const order = Array.from({ length: spots.length >> 1 }, (_, i) => i);
  for (let i = order.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [order[i], order[j]] = [order[j], order[i]];
  }
  const polyps: number[] = [];
  for (const i of order.slice(0, 40)) polyps.push(spots[i * 2], spots[i * 2 + 1], rand() * TAU);
  return { lines, polyps, halfWidth: maxX * sc, holds, cache: new Map() };
}

/** Stroke width per level (CSS px at a 150px fan): stalk, ribs thinning outward, mesh. */
const FAN_WIDTHS = [4.4, 2.5, 1.9, 1.45, 1.15, 0.95, 0.8];

function fanPaths(fan: SeaFan, height: number, lwMin: number): Path2D[] {
  const key = `${height.toFixed(1)}|${lwMin}`;
  const hit = fan.cache.get(key);
  if (hit) return hit;
  const paths = FAN_WIDTHS.map(() => new Path2D());
  for (const ln of fan.lines) {
    const p = paths[ln.level];
    const g = ln.pts;
    p.moveTo(g[0] * height, g[1] * height);
    if (ln.level === 6 && g.length === 6) p.quadraticCurveTo(g[2] * height, g[3] * height, g[4] * height, g[5] * height);
    else for (let i = 2; i < g.length; i += 2) p.lineTo(g[i] * height, g[i + 1] * height);
  }
  if (fan.cache.size > 6) fan.cache.clear();
  fan.cache.set(key, paths);
  return paths;
}

export interface FanColors {
  branch: string;
  polyp: string;
  /** Polyp glow 0..1 at a height in CSS px (biolum). */
  lantern: (y: number) => number;
}

/** Skew amount of the fan's gentle sway at time t. */
export function fanSkew(t: number, phase: number, mul: number): number {
  return 0.028 * mul * Math.sin((TAU * t) / 11.1 + phase) + 0.012 * Math.sin((TAU * t) / 7.3 + phase * 1.7);
}

/** Draws the fan with its base at (x, y). */
export function drawSeaFan(
  ctx: CanvasRenderingContext2D,
  fan: SeaFan,
  x: number,
  y: number,
  height: number,
  skew: number,
  lwMin: number,
  col: FanColors,
  ink: Ink,
  dots: DotBatch,
  t: number,
): void {
  const paths = fanPaths(fan, height, lwMin);
  ctx.save();
  ctx.translate(x, y);
  ctx.transform(1, 0, skew, 1, 0, 0);
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.strokeStyle = ink.outline ?? col.branch;
  const ga = ctx.globalAlpha;
  for (let l = 0; l < paths.length; l++) {
    ctx.lineWidth = ink.outline ? ink.lw : Math.max(lwMin, FAN_WIDTHS[l] * Math.min(1.2, height / 150));
    // The fused mesh is finer and lighter than the ribs, so the fan reads as lace.
    if (l === 6) ctx.globalAlpha = ga * (ink.outline ? 0.5 : 0.75);
    ctx.stroke(paths[l]);
  }
  ctx.globalAlpha = ga;
  ctx.restore();
  const pr = Math.max(1, 1.25 * Math.min(1.2, height / 150));
  const night = fanNight;
  night.length = 0;
  ctx.beginPath();
  for (let i = 0; i < fan.polyps.length; i += 3) {
    const py = y + fan.polyps[i + 1] * height;
    const px = x + fan.polyps[i] * height + skew * (py - y);
    ctx.moveTo(px + pr, py);
    ctx.arc(px, py, pr, 0, TAU);
    const lit = col.lantern(py);
    if (lit > 0.01 && !ink.outline) night.push(px, py, lit * (0.72 + 0.28 * Math.sin(t * 1.3 + fan.polyps[i + 2] * 3)));
  }
  if (ink.outline) {
    ctx.strokeStyle = ink.outline;
    ctx.lineWidth = ink.lw;
    ctx.stroke();
    return;
  }
  ctx.fillStyle = col.polyp;
  ctx.fill();
  for (let i = 0; i < night.length; i += 3) pushDot(dots, col.polyp, night[i], night[i + 1], 6.5 * pr, 0.7 * night[i + 2]);
}

/** Lit polyps of the fan being drawn (x, y, strength), reused every frame. */
const fanNight: number[] = [];

// ---------------------------------------------------------------------------
// Sunken treasure chest
// ---------------------------------------------------------------------------

export interface ChestColors {
  body: string;
  band: string;
  sand: string;
  cap: string;
  capAlpha: number;
  lanternColor: string;
  /** 0 by day; how strongly lantern light leaks from the lid gap and keyhole (Midnight). */
  leak: number;
  /** 0..1, how much the flat planes fold into one silhouette (Midnight). */
  silhouette: number;
}

type V3 = [number, number, number];

/** The chest's paths and points for one position, size and lid angle (see chestGeometry). */
interface ChestGeom {
  above: Path2D | null;
  front: Path2D;
  end: Path2D;
  opening: Path2D;
  /** Lid facets back to front (k = 3..0) with their two bands, and whether an outline shows them. */
  facets: { f: Path2D; bands: Path2D[]; k: number; visible: boolean }[];
  lidEnd: Path2D;
  bands: Path2D[];
  plate: Path2D;
  hole: Path2D;
  kx0: number;
  ky0: number;
  kr: number;
  gap: [number, number, number, number];
  capP: Path2D;
  box: { x: number; y: number; w: number; h: number };
  line: Path2D | null;
  sand: Path2D | null;
  sandCaps: Path2D | null;
}

const chestCache = new Map<string, ChestGeom>();
const CHEST_CACHE = 16;

/**
 * Builds the chest's geometry: flat planes in a cabinet projection: body front and end, a
 * four-facet barrel lid hinged at the back edge and opened `lidDeg`, two metal bands, a keyhole
 * and a sediment cap on the lid, plus the drift of sand. Cached, since it only changes when the
 * lid moves or the sea is resized.
 */
function chestGeometry(x: number, groundY: number, cw: number, lidDeg: number, outline: boolean, mound: boolean, bury: number): ChestGeom {
  const key = `${x}|${groundY}|${cw}|${lidDeg}|${outline ? 1 : 0}|${mound ? 1 : 0}|${bury}`;
  const hit = chestCache.get(key);
  if (hit) return hit;
  const W = 1;
  const D = 0.5;
  const Hb = 0.46;
  const Lh = 0.22;
  const ox = 0.4;
  const oy = 0.28;
  const tilt = -6 * DEG;
  const ct = Math.cos(tilt);
  const st = Math.sin(tilt);
  const baseY = groundY + Hb * bury * cw;
  const cx0 = x - (W + D * ox) * 0.5 * cw;
  const proj = (p: V3): [number, number] => {
    const sx = (p[0] + p[2] * ox) * cw;
    const sy = -(p[1] + p[2] * oy) * cw;
    return [cx0 + sx * ct - sy * st, baseY + sx * st + sy * ct];
  };
  // The drift of sand it sits in: flat under the chest, falling away past its ends.
  const sandPts: number[] = [];
  const NS = 36;
  if (mound) {
    for (let i = 0; i <= NS; i++) {
      const d = -1 + (2 * i) / NS;
      const t = Math.min(1, Math.max(0, (Math.abs(d) - 0.45) / 0.55));
      const crest = groundY + cw * 0.02 - cw * 0.03 * Math.cos(Math.min(1, Math.abs(d) / 0.6) * Math.PI * 0.5);
      sandPts.push(x + d * cw, crest + cw * 0.5 * t * t * (3 - 2 * t) + Math.sin(i * 1.7) * 0.35);
    }
  }
  let above: Path2D | null = null;
  if (mound && outline) {
    // Hairline plates cannot hide the buried part by overpainting, so clip it away.
    above = new Path2D();
    above.moveTo(-1e4, -1e4);
    above.lineTo(1e4, -1e4);
    above.lineTo(1e4, sandPts[NS * 2 + 1]);
    for (let i = NS; i >= 0; i--) above.lineTo(sandPts[i * 2], sandPts[i * 2 + 1]);
    above.lineTo(-1e4, sandPts[1]);
    above.closePath();
  }
  const poly = (pts: V3[]) => {
    const p = new Path2D();
    pts.forEach((v, i) => {
      const [a, b] = proj(v);
      if (i === 0) p.moveTo(a, b);
      else p.lineTo(a, b);
    });
    p.closePath();
    return p;
  };
  // Lid profile (half octagon in z-y), rotated about the hinge at z = D, y = Hb.
  const prof: [number, number][] = [];
  for (let k = 0; k <= 4; k++) {
    const a = (Math.PI * k) / 4;
    prof.push([D / 2 - (D / 2) * Math.cos(a), Lh * Math.sin(a)]);
  }
  const rot = (z: number, y: number): [number, number] => {
    const rz = z - D;
    const c = Math.cos(lidDeg * DEG);
    const s = Math.sin(lidDeg * DEG);
    // Front edge lifts: rotate so that (-D, 0) goes up.
    return [D + rz * c + y * s, Hb - rz * s + y * c];
  };
  const L = prof.map(([z, y]) => rot(z, y));
  const front = poly([
    [0, 0, 0],
    [W, 0, 0],
    [W, Hb, 0],
    [0, Hb, 0],
  ]);
  const end = poly([
    [W, 0, 0],
    [W, 0, D],
    [W, Hb, D],
    [W, Hb, 0],
  ]);
  const opening = poly([
    [0, Hb, 0],
    [W, Hb, 0],
    [W, Hb, D],
    [0, Hb, D],
  ]);
  // Where lantern light leaks from the lid gap.
  const [gx, gy] = proj([W * 0.5, Hb, D * 0.3]);
  const [gx2, gy2] = proj([W * 0.85, Hb, D * 0.2]);
  // Outline plates stroke only the lid planes facing the viewer (same winding as the front
  // face once projected), so no hidden edges cross the chest.
  const area2 = (pts: V3[]) => {
    let s = 0;
    for (let i = 0; i < pts.length; i++) {
      const [ax, ay] = proj(pts[i]);
      const [bx, by] = proj(pts[(i + 1) % pts.length]);
      s += ax * by - bx * ay;
    }
    return s;
  };
  const frontSign = Math.sign(area2([[0, 0, 0], [W, 0, 0], [W, Hb, 0], [0, Hb, 0]]));
  const facets: ChestGeom['facets'] = [];
  for (let k = 3; k >= 0; k--) {
    const [z0, y0] = L[k];
    const [z1, y1] = L[k + 1];
    const fs = Math.sign(area2([[0, y0, z0], [W, y0, z0], [W, y1, z1], [0, y1, z1]]));
    const f = poly([
      [0, y0, z0],
      [W, y0, z0],
      [W, y1, z1],
      [0, y1, z1],
    ]);
    // Bands over the lid.
    const bands: Path2D[] = [];
    for (const bx of [0.17, 0.77]) {
      bands.push(poly([
        [bx, y0, z0],
        [bx + 0.07, y0, z0],
        [bx + 0.07, y1, z1],
        [bx, y1, z1],
      ]));
    }
    facets.push({ f, bands, k, visible: fs === frontSign });
  }
  const lidEnd = poly(L.map(([z, y]) => [W, y, z] as V3));
  const bands: Path2D[] = [];
  for (const bx of [0.17, 0.77]) {
    bands.push(poly([
      [bx, 0, 0],
      [bx + 0.07, 0, 0],
      [bx + 0.07, Hb, 0],
      [bx, Hb, 0],
    ]));
  }
  // Keyhole plate.
  const plate = poly([
    [0.45, Hb - 0.2, 0],
    [0.55, Hb - 0.2, 0],
    [0.55, Hb - 0.02, 0],
    [0.45, Hb - 0.02, 0],
  ]);
  const [kx0, ky0] = proj([0.5, Hb - 0.085, 0]);
  const kr = Math.max(1, cw * 0.016);
  const hole = new Path2D();
  hole.arc(kx0, ky0, kr, 0, TAU);
  hole.moveTo(kx0 - kr * 0.55, ky0);
  hole.lineTo(kx0 + kr * 0.55, ky0);
  hole.lineTo(kx0 + kr * 0.9, ky0 + kr * 3);
  hole.lineTo(kx0 - kr * 0.9, ky0 + kr * 3);
  hole.closePath();

  // Sediment cap along the lid's top ridge, left to right.
  const capP = new Path2D();
  const ridge: number[] = [];
  for (const xx of [0, 0.25, 0.5, 0.75, 1]) ridge.push(...proj([xx, L[2][1], L[2][0]]));
  for (const xx of [1]) ridge.push(...proj([xx, L[3][1], L[3][0]]));
  addCaps(capP, ridge, false, (_x, i) => (i === 0 || i === 5 ? 0.6 : Math.max(1.6, cw * 0.035)));

  const topY = Math.min(proj([0, L[2][1], L[2][0]])[1], proj([W, L[2][1], L[2][0]])[1]);
  const [rxEnd] = proj([W, 0, D]);
  const box = { x: cx0, y: topY, w: rxEnd - cx0, h: groundY - topY };
  let line: Path2D | null = null;
  let sand: Path2D | null = null;
  let sandCaps: Path2D | null = null;
  if (mound) {
    const sx0 = sandPts[0];
    const sx1 = sandPts[NS * 2];
    if (outline) {
      line = new Path2D();
      line.moveTo(sandPts[0], sandPts[1]);
      for (let i = 2; i < sandPts.length; i += 2) line.lineTo(sandPts[i], sandPts[i + 1]);
    } else {
      sand = new Path2D();
      sand.moveTo(sx0, groundY + cw * 1.2);
      for (let i = 0; i < sandPts.length; i += 2) sand.lineTo(sandPts[i], sandPts[i + 1]);
      sand.lineTo(sx1, groundY + cw * 1.2);
      sand.closePath();
      sandCaps = new Path2D();
      addCaps(sandCaps, sandPts, false, (_x, i) => Math.max(0.6, cw * 0.05) * Math.pow(Math.sin((Math.PI * i) / NS), 0.5));
    }
  }
  const geom: ChestGeom = { above, front, end, opening, facets, lidEnd, bands, plate, hole, kx0, ky0, kr, gap: [gx, gy, gx2, gy2], capP, box, line, sand, sandCaps };
  if (chestCache.size >= CHEST_CACHE) chestCache.delete(chestCache.keys().next().value!);
  chestCache.set(key, geom);
  return geom;
}

/**
 * Half-buried chest. (x, groundY) is the sand line under the chest's middle; cw its width in px.
 * Flat planes in a cabinet projection: body front and end, a four-facet barrel lid hinged at the
 * back edge and opened `lidDeg`, two metal bands, a keyhole and a sediment cap on the lid.
 * Returns the chest's screen bounding box.
 */
export function drawChest(
  ctx: CanvasRenderingContext2D,
  x: number,
  groundY: number,
  cw: number,
  lidDeg: number,
  col: ChestColors,
  ink: Ink,
  dots: DotBatch,
  /** Draw the drift of sand that half-buries it (the sea draws the seabed over it instead). */
  mound = true,
  bury = 0.36,
): { x: number; y: number; w: number; h: number } {
  const g = chestGeometry(x, groundY, cw, lidDeg, !!ink.outline, mound, bury);
  if (g.above) {
    ctx.save();
    ctx.clip(g.above);
  }
  const night = col.silhouette;
  const shade = (dl: number) => (ink.outline ? col.body : adjustOK(col.body, dl * (1 - night)));
  const bandCol = mixOK(col.band, col.body, night);
  const inside = mixOK(col.body, '#000000', 0.45);

  // Back to front: opening, body, lid facets, lid end, bands, keyhole.
  if (ink.outline) {
    paint(ctx, g.front, col.body, ink);
    paint(ctx, g.end, col.body, ink);
  } else {
    ctx.fillStyle = col.leak > 0.01 ? mixOK(inside, col.lanternColor, Math.min(1, col.leak * 0.9)) : inside;
    ctx.fill(g.opening);
    ctx.fillStyle = shade(0);
    ctx.fill(g.front);
    ctx.fillStyle = shade(-0.05);
    ctx.fill(g.end);
  }
  // Light leaking from the gap.
  if (col.leak > 0.01 && !ink.outline) {
    pushDot(dots, col.lanternColor, g.gap[0], g.gap[1], cw * 0.62, 0.55 * col.leak);
    pushDot(dots, col.lanternColor, g.gap[2], g.gap[3], cw * 0.3, 0.4 * col.leak);
  }
  const facetShade = [0.0, 0.035, 0.06, 0.07];
  for (const { f, bands, k, visible } of g.facets) {
    if (ink.outline && !visible) continue;
    paint(ctx, f, shade(facetShade[k]), ink);
    for (const b of bands) paint(ctx, b, mixOK(bandCol, col.body, 0.12 * k * (1 - night)), ink);
  }
  paint(ctx, g.lidEnd, shade(-0.03), ink);
  for (const b of g.bands) paint(ctx, b, bandCol, ink);
  paint(ctx, g.plate, bandCol, ink);
  if (!ink.outline) {
    ctx.fillStyle = col.leak > 0.01 ? mixOK(inside, col.lanternColor, Math.min(1, col.leak)) : inside;
    ctx.fill(g.hole);
    if (col.leak > 0.01) pushDot(dots, col.lanternColor, g.kx0, g.ky0 + g.kr, cw * 0.2, 0.7 * col.leak);
  }
  if (!ink.outline) {
    const ga = ctx.globalAlpha;
    ctx.globalAlpha = ga * col.capAlpha;
    ctx.fillStyle = col.cap;
    ctx.fill(g.capP);
    ctx.globalAlpha = ga;
  }
  if (!mound) return g.box;
  if (ink.outline) {
    ctx.restore();
    ctx.strokeStyle = ink.outline;
    ctx.lineWidth = ink.lw;
    ctx.stroke(g.line!);
  } else {
    ctx.fillStyle = col.sand;
    ctx.fill(g.sand!);
    const ga = ctx.globalAlpha;
    ctx.globalAlpha = ga * col.capAlpha;
    ctx.fillStyle = col.cap;
    ctx.fill(g.sandCaps!);
    ctx.globalAlpha = ga;
  }
  return g.box;
}

// ---------------------------------------------------------------------------
// Ancient ruins (a drowned colonnade)
// ---------------------------------------------------------------------------

export interface Ruins {
  /** Solid shapes in normalised units: x across the span 0..1, y up in column heights. */
  solids: number[][];
  /** Lit left planes of the standing shafts. */
  lit: number[][];
  /** Screen-space paths by span (see drawRuins). */
  cache: Map<string, RuinPaths>;
}

interface RuinPaths {
  solid: Path2D;
  caps: Path2D;
  lit: Path2D;
  /** One closed outline per solid, for hairline plates. */
  outlines: Path2D[];
}

/**
 * Five columns (two fallen), a broken arch and three steps. Built in column-height units;
 * `aspect` is the span width over the column height.
 */
export function buildRuins(rand: Rand, aspect: number): Ruins {
  const solids: number[][] = [];
  const lit: number[][] = [];
  // Points are given in column-height units on both axes, then x is mapped into the span.
  const add = (list: number[][], pts: number[]) => {
    const out: number[] = [];
    for (let i = 0; i < pts.length; i += 2) out.push(pts[i] / aspect, pts[i + 1]);
    list.push(out);
  };
  const stepH = 0.055;
  const shaftW = 0.13;
  const capHalf = shaftW * 0.86;
  const sp = Math.min(0.62, Math.max(0.42, (aspect - 2.06) / 2));
  const xA = 0.24;
  const xB = xA + sp;
  const xC = xB + sp;
  const stepEnd = xC + 0.42;
  // Three steps, the top one broken off at its right end.
  for (let k = 0; k < 3; k++) {
    const x0 = 0.04 + k * 0.07;
    const x1 = stepEnd - k * 0.07;
    const y0 = k * stepH;
    const y1 = y0 + stepH;
    if (k === 2) add(solids, [x0, y0, x1 - 0.12, y0, x1 - 0.2, y1, x0, y1]);
    else if (k === 1) add(solids, [x0, y0, x1, y0, x1 - 0.03, y1 - 0.012, x1 - 0.09, y1, x0, y1]);
    else add(solids, [x0, y0, x1, y0, x1, y1, x0, y1]);
  }
  const floor = 3 * stepH;
  const column = (cx: number, height: number, capital: boolean, broken = 0) => {
    const w0 = shaftW;
    const wt = w0 * 0.9;
    const baseH = 0.04;
    const y0 = floor;
    add(solids, [cx - w0 * 0.66, y0, cx + w0 * 0.66, y0, cx + w0 * 0.6, y0 + baseH, cx - w0 * 0.6, y0 + baseH]);
    const top = y0 + height;
    if (broken) {
      add(solids, [cx - w0 / 2, y0 + baseH, cx + w0 / 2, y0 + baseH, cx + wt / 2, top - broken, cx + wt * 0.15, top - broken * 0.25, cx - wt * 0.1, top, cx - wt / 2, top - broken * 0.55]);
      add(lit, [cx - w0 / 2, y0 + baseH, cx - w0 * 0.2, y0 + baseH, cx - wt * 0.2, top - broken * 0.4, cx - wt / 2, top - broken * 0.55]);
      return top;
    }
    add(solids, [cx - w0 / 2, y0 + baseH, cx + w0 / 2, y0 + baseH, cx + wt / 2, top, cx - wt / 2, top]);
    add(lit, [cx - w0 / 2, y0 + baseH, cx - w0 * 0.2, y0 + baseH, cx - wt * 0.2, top, cx - wt / 2, top]);
    if (!capital) return top;
    const eh = 0.045;
    const ah = 0.045;
    add(solids, [cx - wt / 2, top, cx + wt / 2, top, cx + capHalf * 0.92, top + eh, cx - capHalf * 0.92, top + eh]);
    add(solids, [cx - capHalf, top + eh, cx + capHalf, top + eh, cx + capHalf, top + eh + ah, cx - capHalf, top + eh + ah]);
    return top + eh + ah;
  };
  column(xA, range(rand, 0.56, 0.64), false, 0.08);
  const spring = column(xB, 0.84, true);
  column(xC, 0.84, true);
  // The arch between B and C: two springers in a block of masonry, the crown fallen.
  const acx = (xB + xC) / 2;
  const ri = (xC - xB) / 2 - capHalf * 0.5;
  const thick = 0.14;
  const top = spring + ri + thick;
  const arcPts = (a0: number, a1: number, n: number) => {
    const out: number[] = [];
    for (let i = 0; i <= n; i++) {
      const a = a0 + ((a1 - a0) * i) / n;
      out.push(acx + Math.cos(a) * ri, spring + Math.sin(a) * ri);
    }
    return out;
  };
  const aL = 1.78;
  add(solids, [
    xB - capHalf, spring,
    ...arcPts(Math.PI, aL, 8),
    acx + Math.cos(aL) * ri + 0.01, spring + Math.sin(aL) * ri + 0.06,
    acx - 0.03, top - 0.05,
    acx - 0.06, top,
    xB - capHalf, top,
  ]);
  const aR = 1.12;
  add(solids, [
    xC + capHalf, spring,
    xC + capHalf, top - 0.07,
    acx + 0.14, top - 0.03,
    acx + 0.1, top - 0.08,
    acx + Math.cos(aR) * ri + 0.02, spring + Math.sin(aR) * ri + 0.04,
    ...arcPts(aR, 0, 6),
  ]);
  // A fallen column lying on the shelf in three drums, its capital beside it.
  let fx = stepEnd + 0.16;
  const dr = shaftW * 0.95;
  for (const len of [0.34, 0.27, 0.22]) {
    const lean = range(rand, -0.01, 0.01);
    add(solids, [fx, 0, fx + len, 0, fx + len, dr + lean, fx, dr - lean]);
    fx += len + 0.035;
  }
  add(solids, [fx + 0.03, 0, fx + 0.25, 0, fx + 0.22, 0.075, fx + 0.06, 0.075]);
  // A second fallen column, slid down the broken end of the steps and resting at an angle.
  const ang = 0.24;
  const len = 0.62;
  const wv = shaftW * 0.95;
  const sx0 = stepEnd - 0.36;
  const sy0 = floor - 0.01;
  const ex = sx0 + Math.cos(ang) * len;
  const ey = Math.max(0, sy0 - Math.sin(ang) * len);
  const a2 = Math.atan2(sy0 - ey, ex - sx0);
  const nx = Math.sin(a2) * wv;
  const ny = Math.cos(a2) * wv;
  add(solids, [sx0, sy0, ex, ey, ex + nx, ey + ny, sx0 + nx, sy0 + ny]);
  return { solids, lit, cache: new Map() };
}

/** Width in column heights that buildRuins needs at the least. */
export const RUINS_MIN_ASPECT = 2.95;

export interface RuinColors {
  stone: string;
  lit: string;
  cap: string;
  capAlpha: number;
}

/** Draws the ruins spanning x0..x1 standing on groundY, column height colH (px). */
export function drawRuins(
  ctx: CanvasRenderingContext2D,
  r: Ruins,
  x0: number,
  x1: number,
  groundY: number,
  colH: number,
  col: RuinColors,
  ink: Ink,
): void {
  const key = `${x0}|${x1}|${groundY}|${colH}`;
  let paths = r.cache.get(key);
  if (!paths) {
    const span = x1 - x0;
    const P = (pts: number[]) => {
      const out: number[] = [];
      for (let i = 0; i < pts.length; i += 2) out.push(x0 + pts[i] * span, groundY - pts[i + 1] * colH);
      return out;
    };
    const solid = new Path2D();
    const caps = new Path2D();
    const outlines: Path2D[] = [];
    for (const s of r.solids) {
      const pts = P(s);
      polyPath(pts, solid);
      addCaps(caps, clockwise(pts), true, () => Math.max(1.4, colH * 0.035));
      outlines.push(polyPath(pts));
    }
    const lit = new Path2D();
    for (const s of r.lit) polyPath(P(s), lit);
    paths = { solid, caps, lit, outlines };
    if (r.cache.size >= 4) r.cache.delete(r.cache.keys().next().value!);
    r.cache.set(key, paths);
  }
  const { solid, caps, lit: litP, outlines } = paths;
  if (ink.outline) {
    ctx.strokeStyle = ink.outline;
    ctx.lineWidth = ink.lw;
    ctx.lineJoin = 'round';
    for (const p of outlines) ctx.stroke(p);
    return;
  }
  ctx.fillStyle = col.stone;
  ctx.fill(solid);
  ctx.fillStyle = col.lit;
  ctx.fill(litP);
  const ga = ctx.globalAlpha;
  ctx.globalAlpha = ga * col.capAlpha;
  ctx.fillStyle = col.cap;
  ctx.fill(caps);
  ctx.globalAlpha = ga;
}
