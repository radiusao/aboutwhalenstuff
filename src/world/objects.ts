/**
 * World objects: today's bottle, the kept bottles on the seabed shelf, and the Guardian pearl.
 * Positions are stored before parallax; each draw adds its layer's parallax and hit()
 * subtracts the same offsets (it receives raw screen CSS px).
 */
import type { LightingMode } from '../types/sanctuary';
import type { BottleState, Lighting, WorldFrame } from './types';
import { C, adjustOK, contrastRatio, mixOK, withAlpha } from './palette';
import { envelope } from './light';
import { hashString } from './rng';
import { art, drawArt, sceneTint, tinted } from './art';

export type ObjectHit =
  | { kind: 'bottle' }
  | { kind: 'shelf'; messageId: string }
  | { kind: 'pearl' };

export interface WorldObjects {
  resize(w: number, h: number, phone: boolean): void;
  /** Where kept bottles rest (from Scenery.shelf()) and which message ids are kept (oldest first, last 7 shown). */
  setShelf(shelf: { x: number; y: number; w: number }, messageIds: string[]): void;
  /** Scenery.seabedY, so things can land on the seabed. */
  setSeabed(seabedY: (x: number) => number): void;

  // Daily bottle
  readonly bottleState: BottleState;
  /** Bottle enters the surface band from the left and drifts; "for you" writes on after 3s; sinks to the shelf after 60s untapped. */
  bottleArrive(f: WorldFrame): void;
  /** Drift toward the camera (scale 1 -> 2.2), cork pop with 5 bubbles. Calls onBottle('open', x, y) when the paper should unroll. */
  openBottle(f: WorldFrame): void;
  /** Bottle drifts back and sinks to the shelf over 1.6s, becoming the newest kept bottle. */
  closeBottle(f: WorldFrame): void;
  bottlePosition(): { x: number; y: number };

  // Guardian pearl
  /** Released at the whale's belly; sinks toward the camera over 8s (fog .72 -> 0, size .4 -> 1) and lands on the seabed. Auto-collects after 30s. */
  releasePearl(from: { x: number; y: number }, f: WorldFrame): void;
  /** Collect (tap or auto). */
  collectPearl(f: WorldFrame): void;
  pearlPosition(): { x: number; y: number } | null;

  /** Screen position of a kept bottle (for anchoring a reread note), or null if it is not on the shelf. */
  keptPosition(messageId: string): { x: number; y: number } | null;

  update(f: WorldFrame): void;
  /** Bottle while floating in the surface band (drawn after the far stack). */
  drawSurfaceBand(ctx: CanvasRenderingContext2D, f: WorldFrame): void;
  /** Sinking pearl (drawn after the jelly zone so it crosses layers). */
  drawMidwater(ctx: CanvasRenderingContext2D, f: WorldFrame): void;
  /** Kept bottles, waiting bottle, landed pearl (drawn right after Scenery.drawSeabed). */
  drawSeabed(ctx: CanvasRenderingContext2D, f: WorldFrame): void;
  /** The opening bottle in front of everything (drawn after the occluders). */
  drawForeground(ctx: CanvasRenderingContext2D, f: WorldFrame): void;

  /**
   * What a tap at (x, y) lands on. `which` limits it to the live things (the Guardian pearl and
   * today's bottle) or to the kept bottles resting on the ledge; the engine checks creatures
   * between the two, so a seahorse in front of the ledge gets the tap.
   */
  hit(x: number, y: number, which?: 'live' | 'kept' | 'all'): ObjectHit | null;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const TAU = Math.PI * 2;
const DEG = Math.PI / 180;

/** Layer parallax (max px), §4.1. */
const PX_SURFACE = 0.5;

/** The top safe-area inset in CSS px (0 where there is none, or no DOM). */
function measureSafeTop(): number {
  if (typeof document === 'undefined' || !document.body) return 0;
  const probe = document.createElement('div');
  probe.style.cssText = 'position:fixed;top:0;left:0;width:0;height:env(safe-area-inset-top, 0px);visibility:hidden;pointer-events:none';
  document.body.appendChild(probe);
  const v = probe.getBoundingClientRect().height;
  probe.remove();
  return Number.isFinite(v) ? v : 0;
}
const PX_WHALE = 1.5;
const PX_SEABED = 9;

/** Fog of the floating bottle (it sits just under the surface, in front of the far stack). */
const FOG_SURFACE = 0.24;
const FOG_SEABED = 0.08;

const DRIFT_SPEED = 10;
const WRITE_DELAY = 3;
const WRITE_TIME = 0.7;
const ARROW_TIME = 0.42;
const SINK_AFTER = 60;
const OPEN_SCALE = 2.2;
const POP_TIME = 0.22;
const CLOSE_TIME = 1.6;
const KEPT_MAX = 7;
/** Kept bottles and the one waiting on the ledge, relative to the floating bottle. */
const KEPT_SCALE = 0.5;
const WAIT_SCALE = 0.64;

const PEARL_SINK = 8;
const PEARL_AUTO = 30;
const PEARL_FOG = 0.72;
/** Guardian pearl radius at full size: the brief's 9px pearl. */
const PEARL_R = 4.5;

const HAND_FONT = '20px "Nothing You Could Do", "Segoe Print", cursive';
const HAND_FONT_LOAD = '20px "Nothing You Could Do"';

// ---------------------------------------------------------------------------
// Small maths
// ---------------------------------------------------------------------------

const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const smoothstep = (t: number) => {
  const x = clamp01(t);
  return x * x * (3 - 2 * x);
};
const easeInOutSine = (t: number) => 0.5 - 0.5 * Math.cos(Math.PI * clamp01(t));
const easeOutCubic = (t: number) => 1 - (1 - clamp01(t)) ** 3;
const easeInOutCubic = (t: number) => {
  const x = clamp01(t);
  return x < 0.5 ? 4 * x * x * x : 1 - (-2 * x + 2) ** 3 / 2;
};

/** CSS-style cubic-bezier easing (x1, y1, x2, y2). */
function bezier(x1: number, y1: number, x2: number, y2: number): (t: number) => number {
  const cx = 3 * x1;
  const bx = 3 * (x2 - x1) - cx;
  const ax = 1 - cx - bx;
  const cy = 3 * y1;
  const by = 3 * (y2 - y1) - cy;
  const ay = 1 - cy - by;
  const sx = (u: number) => ((ax * u + bx) * u + cx) * u;
  const sy = (u: number) => ((ay * u + by) * u + cy) * u;
  return (t: number) => {
    const x = clamp01(t);
    let u = x;
    for (let i = 0; i < 6; i++) {
      const d = (3 * ax * u + 2 * bx) * u + cx;
      if (Math.abs(d) < 1e-5) break;
      u -= (sx(u) - x) / d;
    }
    return sy(clamp01(u));
  };
}
/** The opening drift: answers at once, settles slowly. */
const easeDriftIn = bezier(0.3, 0.1, 0.18, 1);

/** Lantern pulse at 0.4Hz: a quicker swell and a long, soft fall (lights rise fast, fade slowly). */
function lanternPulse(t: number, phase: number): number {
  const p = (((t * 0.4 + phase) % 1) + 1) % 1;
  return p < 0.32 ? Math.sin((p / 0.32) * (Math.PI / 2)) : 0.5 + 0.5 * Math.cos(((p - 0.32) / 0.68) * Math.PI);
}

function angleLerp(a: number, b: number, t: number): number {
  let d = (b - a) % TAU;
  if (d > Math.PI) d -= TAU;
  if (d < -Math.PI) d += TAU;
  return a + d * t;
}

// ---------------------------------------------------------------------------
// Colors
// ---------------------------------------------------------------------------

const legibleCache = new Map<string, string>();

/**
 * The nearest shade of `ink` (moved only in OKLab lightness) that reaches `target`:1
 * against `bg`. Keeps the brief's hue while meeting its §3 contrast rule.
 */
function legibleInk(ink: string, bg: string, target: number): string {
  const key = `${ink}|${bg}|${target}`;
  const hit = legibleCache.get(key);
  if (hit) return hit;
  let c = ink;
  if (contrastRatio(c, bg) < target) {
    const lighten = contrastRatio('#ffffff', bg) > contrastRatio('#000000', bg);
    for (let i = 0; i < 40 && contrastRatio(c, bg) < target; i++) c = adjustOK(c, lighten ? 0.012 : -0.012);
  }
  if (legibleCache.size > 512) legibleCache.clear();
  legibleCache.set(key, c);
  return c;
}

/** "for you" ink per the brief: gold-deep by Day, lantern at Sunset and Midnight. */
const handInk = (m: LightingMode) => (m === 'day' ? C.goldDeep : C.lantern);

interface BottleLook {
  glass: string;
  glassAlpha: number;
  deep: string;
  edge: string;
  edgeAlpha: number;
  paper: string;
  ink: string;
  cork: string;
  string: string;
  /** 0..1, how much of the rolled paper is still inside. */
  roll: number;
  /** 0..1, the roll sliding out through the neck. */
  rollSlide: number;
  /** Sediment settled along the top of an old bottle: color and alpha. */
  cap: string;
  capAlpha: number;
  /** Cork offset in screen px and its extra rotation, or null when seated. */
  corkOff: { dx: number; dy: number; rot: number } | null;
  t: number;
  lw: number;
  /** How the light falls on her bottle drawing, when there is one. */
  tint: { color: string; amount: number };
}

function lookFor(L: Lighting, yN: number, fog: number, lit: number, t: number, lw: number): BottleLook {
  const water = L.waterAt(yN);
  const dark = L.num('bodyDarken', yN);
  const night = (c: string) => (dark > 0.001 ? mixOK(c, C.nightFloor, dark) : c);
  const paperSeen = mixOK(night(mixOK(L.color('paper', yN), C.glass, 0.06)), C.lantern, clamp01(lit));
  return {
    glass: mixOK(C.glass, water, fog),
    glassAlpha: 0.25,
    deep: mixOK(mixOK(C.glass, L.color('l5', yN), 0.62), water, fog),
    edge: L.color('rim', yN),
    edgeAlpha: 0.72 * (1 - fog * 0.6),
    paper: mixOK(paperSeen, water, fog),
    ink: mixOK(C.paperInk, water, fog * 0.5 + 0.25),
    cork: mixOK(night(C.cork), water, fog),
    string: mixOK(night(C.coral), water, fog),
    roll: 1,
    rollSlide: 0,
    cap: L.color('ridgeCap', yN),
    capAlpha: 0,
    corkOff: null,
    t,
    lw,
    tint: sceneTint(L, yN, fog),
  };
}

// ---------------------------------------------------------------------------
// Drawing: the bottle (axis along +x, neck to the right, length L)
// ---------------------------------------------------------------------------

/** Proportions as fractions of the bottle length. */
const B = {
  R: 0.16, // body radius
  rc: 0.05, // base corner
  u0: -0.5, // base
  us: 0.07, // shoulder start
  un: 0.25, // neck start
  rn: 0.062, // neck radius
  ul: 0.425, // lip start
  rl: 0.078, // lip radius
  ue: 0.5, // mouth
};

function traceOutline(ctx: CanvasRenderingContext2D, L: number) {
  const R = B.R * L;
  const rc = B.rc * L;
  const u0 = B.u0 * L;
  const us = B.us * L;
  const un = B.un * L;
  const rn = B.rn * L;
  const ul = B.ul * L;
  const rl = B.rl * L;
  const ue = B.ue * L;
  const k = 0.008 * L;
  ctx.beginPath();
  ctx.moveTo(u0, -R + rc);
  ctx.quadraticCurveTo(u0, -R, u0 + rc, -R);
  ctx.lineTo(us, -R);
  ctx.bezierCurveTo(us + 0.11 * L, -R, un - 0.08 * L, -rn, un, -rn);
  ctx.lineTo(ul, -rn);
  ctx.quadraticCurveTo(ul + k * 0.4, -rl, ul + 2 * k, -rl);
  ctx.lineTo(ue - k, -rl);
  ctx.quadraticCurveTo(ue, -rl, ue, -rl + k);
  ctx.lineTo(ue, rl - k);
  ctx.quadraticCurveTo(ue, rl, ue - k, rl);
  ctx.lineTo(ul + 2 * k, rl);
  ctx.quadraticCurveTo(ul + k * 0.4, rl, ul, rn);
  ctx.lineTo(un, rn);
  ctx.bezierCurveTo(un - 0.08 * L, rn, us + 0.11 * L, R, us, R);
  ctx.lineTo(u0 + rc, R);
  ctx.quadraticCurveTo(u0, R, u0, R - rc);
  ctx.closePath();
}

/** One side of the glass wall, base to lip, inset by `inset` px. sgn -1 = top, 1 = bottom. */
function traceSide(ctx: CanvasRenderingContext2D, L: number, sgn: number, inset: number, fromU = B.u0 + B.rc, toU = B.ul) {
  const R = B.R * L - inset;
  const rn = B.rn * L - inset;
  const us = B.us * L;
  const un = B.un * L;
  ctx.beginPath();
  ctx.moveTo(fromU * L, sgn * R);
  ctx.lineTo(Math.min(us, toU * L), sgn * R);
  if (toU * L > us) {
    ctx.bezierCurveTo(us + 0.11 * L, sgn * R, un - 0.08 * L, sgn * rn, un, sgn * rn);
    ctx.lineTo(toU * L, sgn * rn);
  }
}

/** Cork centred on (cx, 0) along the bottle axis: a short plug that widens toward its top. */
function traceCork(ctx: CanvasRenderingContext2D, L: number, cx: number) {
  const a = cx - 0.078 * L;
  const b = cx + 0.078 * L;
  const h0 = 0.051 * L;
  const h1 = 0.063 * L;
  const r = 0.018 * L;
  ctx.beginPath();
  ctx.moveTo(a, -h0);
  ctx.lineTo(b - r, -h1);
  ctx.quadraticCurveTo(b, -h1, b, -h1 + r);
  ctx.lineTo(b, h1 - r);
  ctx.quadraticCurveTo(b, h1, b - r, h1);
  ctx.lineTo(a, h0);
  ctx.closePath();
}

/** Seated cork centre along the axis (it reaches 0.085 L out of the mouth). */
const CORK_U = 0.507;

function fillCork(ctx: CanvasRenderingContext2D, L: number, cx: number, k: BottleLook, detail: boolean) {
  traceCork(ctx, L, cx);
  ctx.fillStyle = k.cork;
  ctx.fill();
  if (!detail) return;
  // End grain at the top, and a slightly darker underside.
  const a0 = ctx.globalAlpha;
  ctx.globalAlpha = a0 * 0.3;
  ctx.fillStyle = k.deep;
  ctx.fillRect(cx + 0.06 * L, -0.06 * L, Math.max(k.lw, 0.014 * L), 0.12 * L);
  ctx.globalAlpha = a0 * 0.18;
  ctx.fillRect(cx - 0.078 * L, 0.024 * L, 0.15 * L, 0.036 * L);
  ctx.globalAlpha = a0;
}

/** Draws a bottle centred at (x, y), rotated `rot`, mirrored when sx < 0, length L px. */
function drawBottle(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  rot: number,
  sx: number,
  L: number,
  k: BottleLook,
): void {
  const pic = art('bottle');
  if (pic) {
    // Her drawing: lying on its side, neck to the right, base to neck across the picture.
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(rot);
    ctx.scale(sx === 0 ? 0.001 : sx, 1);
    drawArt(ctx, tinted(pic, k.tint.color, k.tint.amount), pic, L, 0.5, 0.5);
    ctx.restore();
    return;
  }
  const detail = L >= 30;
  const fine = L >= 58;
  const lw = k.lw;
  const R = B.R * L;
  const rn = B.rn * L;
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(rot);
  ctx.scale(sx === 0 ? 0.001 : sx, 1);
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';

  // The seated cork sits inside the neck, so it is drawn before the glass tints it.
  if (!k.corkOff) fillCork(ctx, L, CORK_U * L, k, detail);

  // Glass: a flat translucent fill and a thicker base.
  traceOutline(ctx, L);
  ctx.fillStyle = withAlpha(k.glass, k.glassAlpha);
  ctx.fill();
  ctx.fillStyle = withAlpha(k.glass, 0.2);
  ctx.fillRect(B.u0 * L + 0.5, -R + 0.03 * L, 0.028 * L, 2 * R - 0.06 * L);

  // Rolled paper resting on the lower inner wall of the body.
  if (k.roll > 0.01) {
    const rr = 0.074 * L;
    const vc = R - 0.034 * L - rr;
    const slide = k.rollSlide * 0.42 * L;
    const ua = -0.415 * L + slide;
    const ub = 0.1 * L + slide;
    const e = 0.016 * L;
    const a0 = ctx.globalAlpha;
    ctx.globalAlpha = a0 * k.roll;
    ctx.beginPath();
    ctx.moveTo(ua, vc - rr);
    ctx.lineTo(ub, vc - rr);
    ctx.ellipse(ub, vc, e, rr, 0, -Math.PI / 2, Math.PI / 2);
    ctx.lineTo(ua, vc + rr);
    ctx.ellipse(ua, vc, e, rr, 0, Math.PI / 2, Math.PI * 1.5);
    ctx.closePath();
    ctx.fillStyle = k.paper;
    ctx.fill();
    if (detail) {
      ctx.strokeStyle = k.ink;
      ctx.lineWidth = lw;
      // The free edge of the sheet along the roll, and the spiral at its end.
      ctx.globalAlpha = a0 * k.roll * 0.24;
      ctx.beginPath();
      ctx.moveTo(ua + 0.03 * L, vc - rr * 0.36);
      ctx.lineTo(ub - 0.015 * L, vc - rr * 0.3);
      ctx.stroke();
      ctx.globalAlpha = a0 * k.roll * 0.3;
      ctx.beginPath();
      ctx.ellipse(ua, vc, e, rr, 0, 0, TAU);
      ctx.stroke();
      if (fine) {
        ctx.beginPath();
        ctx.ellipse(ua + 0.002 * L, vc + rr * 0.06, e * 0.55, rr * 0.48, 0, -Math.PI * 0.5, Math.PI * 1.15);
        ctx.stroke();
      }
    }
    ctx.globalAlpha = a0;
  }

  // A dark wall below and a 1px light edge on the lit side.
  ctx.lineWidth = lw;
  ctx.strokeStyle = withAlpha(k.deep, 0.42);
  traceSide(ctx, L, 1, lw * 0.5);
  ctx.stroke();
  ctx.strokeStyle = withAlpha(k.deep, 0.22);
  ctx.beginPath();
  ctx.moveTo(B.u0 * L + lw * 0.5, -R + B.rc * L);
  ctx.lineTo(B.u0 * L + lw * 0.5, R - B.rc * L);
  ctx.stroke();

  ctx.strokeStyle = withAlpha(k.edge, k.edgeAlpha);
  ctx.lineWidth = Math.max(lw, 1);
  traceSide(ctx, L, -1, 0.9, B.u0 + B.rc * 0.6, B.ul - 0.01);
  ctx.stroke();
  if (detail) {
    // A short specular streak along the upper body.
    ctx.strokeStyle = withAlpha(k.edge, k.edgeAlpha * 0.4);
    ctx.lineWidth = Math.max(lw, 0.02 * L);
    ctx.beginPath();
    ctx.moveTo(-0.34 * L, -R * 0.58);
    ctx.lineTo(-0.04 * L, -R * 0.58);
    ctx.stroke();
  }
  if (k.capAlpha > 0.004) {
    ctx.strokeStyle = withAlpha(k.cap, k.capAlpha);
    ctx.lineWidth = Math.max(lw, 1.3);
    traceSide(ctx, L, -1, -0.5, B.u0 + B.rc, B.us + 0.04);
    ctx.stroke();
  }

  // Coral string: two turns round the neck under the lip, knotted on top.
  ctx.strokeStyle = k.string;
  ctx.fillStyle = k.string;
  const sw = Math.max(lw, Math.min(1.5, L / 64));
  ctx.lineWidth = sw;
  ctx.beginPath();
  for (const u of detail ? [0.392, 0.411] : [0.4]) {
    ctx.moveTo(u * L - 0.005 * L, -rn - 0.2);
    ctx.lineTo(u * L + 0.005 * L, rn + 0.2);
  }
  ctx.stroke();
  const knotX = 0.4 * L;
  const knotY = -rn - 0.004 * L;
  if (detail) {
    ctx.beginPath();
    ctx.arc(knotX, knotY, Math.max(0.6, sw * 0.85), 0, TAU);
    ctx.fill();
  }

  if (!k.corkOff) {
    if (!detail) {
      ctx.restore();
      return;
    }
    // Tied over the top of the cork: both strands meet at its crown.
    const top = (CORK_U + 0.078) * L;
    ctx.beginPath();
    ctx.moveTo(knotX + 0.01 * L, -rn);
    ctx.quadraticCurveTo(0.52 * L, -0.074 * L, top, -0.012 * L);
    ctx.moveTo(0.415 * L, rn);
    ctx.quadraticCurveTo(0.52 * L, 0.074 * L, top, 0.012 * L);
    ctx.stroke();
    if (fine) tails(ctx, L, knotX, knotY, k.t);
  } else {
    // Popped: the cork floats up on its string, still tied to the neck.
    const o = k.corkOff;
    const c = Math.cos(-rot);
    const s = Math.sin(-rot);
    const sxx = sx === 0 ? 0.001 : sx;
    const ccx = CORK_U * L + (o.dx * c - o.dy * s) / sxx;
    const ccy = o.dx * s + o.dy * c;
    // The string meets the cork at its waist, on the side nearer the neck.
    const wx = ccx - Math.cos(o.rot) * 0.02 * L + Math.sin(o.rot) * 0.05 * L;
    const wy = ccy - Math.sin(o.rot) * 0.02 * L - Math.cos(o.rot) * 0.05 * L;
    ctx.beginPath();
    ctx.moveTo(knotX, knotY);
    ctx.quadraticCurveTo((knotX + wx) / 2 - 0.035 * L, (knotY + wy) / 2 + 0.02 * L, wx, wy);
    ctx.stroke();
    if (fine) tails(ctx, L, knotX, knotY, k.t);
    ctx.save();
    ctx.translate(ccx, ccy);
    ctx.rotate(o.rot);
    fillCork(ctx, L, 0, k, true);
    ctx.strokeStyle = k.string;
    ctx.lineWidth = sw;
    ctx.beginPath();
    ctx.moveTo(-0.02 * L, -0.056 * L);
    ctx.lineTo(-0.012 * L, 0.057 * L);
    ctx.stroke();
    ctx.restore();
  }
  ctx.restore();
}

/** The two loose ends of the knot, stirring in the water. */
function tails(ctx: CanvasRenderingContext2D, L: number, kx: number, ky: number, t: number) {
  const s1 = Math.sin(t * 1.3) * 0.01 * L;
  const s2 = Math.sin(t * 1.1 + 1.7) * 0.012 * L;
  ctx.beginPath();
  ctx.moveTo(kx, ky);
  ctx.quadraticCurveTo(kx - 0.035 * L, ky - 0.012 * L, kx - 0.075 * L, ky - 0.018 * L + s1);
  ctx.moveTo(kx, ky);
  ctx.quadraticCurveTo(kx - 0.025 * L, ky - 0.035 * L, kx - 0.055 * L + s2 * 0.5, ky - 0.05 * L + s2);
  ctx.stroke();
}

/** A local point of the bottle frame to screen. */
function bottlePoint(x: number, y: number, rot: number, sx: number, u: number, v: number) {
  const c = Math.cos(rot);
  const s = Math.sin(rot);
  const lu = u * sx;
  return { x: x + lu * c - v * s, y: y + lu * s + v * c };
}

// ---------------------------------------------------------------------------
// Drawing: the Guardian pearl (pre-rendered once)
// ---------------------------------------------------------------------------

let pearlSprite: HTMLCanvasElement | null = null;
const PEARL_SPRITE_R = 44;

function getPearlSprite(): HTMLCanvasElement {
  if (pearlSprite) return pearlSprite;
  const size = PEARL_SPRITE_R * 2 + 8;
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const g = c.getContext('2d')!;
  const m = size / 2;
  const r = PEARL_SPRITE_R;
  const grad = g.createRadialGradient(m - r * 0.32, m - r * 0.36, r * 0.05, m, m, r);
  grad.addColorStop(0, C.whalePearl1);
  grad.addColorStop(0.34, C.whalePearl1);
  grad.addColorStop(0.68, C.whalePearl2);
  grad.addColorStop(1, C.whalePearl3);
  g.fillStyle = grad;
  g.beginPath();
  g.arc(m, m, r, 0, TAU);
  g.fill();
  // A cool sheen low on the far side, then the crescent highlight.
  g.globalCompositeOperation = 'source-atop';
  const sheen = g.createRadialGradient(m + r * 0.45, m + r * 0.5, 0, m + r * 0.45, m + r * 0.5, r * 0.75);
  sheen.addColorStop(0, withAlpha(C.whalePearl3, 0.55));
  sheen.addColorStop(1, withAlpha(C.whalePearl3, 0));
  g.fillStyle = sheen;
  g.fillRect(0, 0, size, size);
  g.globalCompositeOperation = 'source-over';
  g.strokeStyle = 'rgba(255,255,255,0.85)';
  g.lineWidth = r * 0.09;
  g.lineCap = 'round';
  g.beginPath();
  g.arc(m, m, r * 0.72, Math.PI * 1.08, Math.PI * 1.42);
  g.stroke();
  pearlSprite = c;
  return c;
}

// ---------------------------------------------------------------------------
// Kept bottles. Each keeps the place where it first landed; age only buries it deeper.
// ---------------------------------------------------------------------------

interface Slot {
  /** Where along a wide ledge it lies, 0..1 of the ledge width. */
  u: number;
  /**
   * On a narrow (phone) ledge: offset in bottle lengths from the ledge centre (`c`),
   * its left end (`l`) or its right end (`r`). Past an end it lies on the sand at the foot.
   */
  narrow: [anchor: 'c' | 'l' | 'r', lengths: number];
  /** How far forward on the ledge's top face it lies, px (0 = back edge); nearer ones draw later. */
  depth: number;
  /** Direction the neck points, screen degrees (0 = right, 180 = left). */
  ang: number;
}

/** Filled in order: the first bottle takes the middle, later ones settle around it. */
const SLOTS: Slot[] = [
  { u: 0.53, narrow: ['c', 0.12], depth: 4.4, ang: -4 },
  { u: 0.3, narrow: ['l', 0.44], depth: 1.6, ang: 185 },
  { u: 0.75, narrow: ['r', -0.42], depth: 2.6, ang: -8 },
  { u: 0.42, narrow: ['l', -0.62], depth: 3, ang: 172 },
  { u: 0.11, narrow: ['r', 0.62], depth: 3.4, ang: -5 },
  { u: 0.9, narrow: ['c', -0.1], depth: 0, ang: 183 },
  { u: 0.64, narrow: ['l', -1.5], depth: 5.4, ang: 4 },
];

/** How lit a kept bottle's paper is: faint by day, a lantern glow at night. */
const keptLit = (biolum: number, bury: number) => 0.08 + 0.42 * biolum * (1 - bury * 0.5);
/** A kept bottle's lantern sprite alpha (α .25 at night, §6). */
const keptGlow = (biolum: number, bury: number) => 0.25 * biolum * (1 - bury * 0.6);

/** Sediment over a kept bottle by age (0 = newest), as a fraction of its height. */
const BURY = [0, 0.1, 0.2, 0.3, 0.38, 0.46, 0.54];

interface Kept {
  id: string;
  slot: number;
  x: number;
  y: number;
  bury: number;
  depth: number;
  rot: number;
  sx: number;
  alpha: number;
  leaving: boolean;
  flashAt: number;
  rank: number;
}

// ---------------------------------------------------------------------------
// The module
// ---------------------------------------------------------------------------

type Phase = 'float' | 'sink' | 'rest';

interface Pose {
  x: number;
  y: number;
  rot: number;
  s: number;
  sx: number;
  fog: number;
  par: number;
}

export function createWorldObjects(callbacks: {
  onBottle: (state: BottleState, x: number, y: number) => void;
  onPearl: (phase: 'released' | 'landed' | 'collected', x: number, y: number) => void;
}): WorldObjects {
  let w = 1;
  let h = 1;
  let phone = true;
  /** Height of the screen's top safe area (status bar, Dynamic Island), CSS px. */
  let safeTop = 0;
  let now = 0;
  let reduced = false;
  let shelf = { x: 0, y: 0, w: 0 };
  let seabedY: ((x: number) => number) | null = null;

  // Parallax offsets from the last update, for hit-testing between frames.
  const par = new Map<number, { x: number; y: number }>();
  const parOf = (f: WorldFrame | null, px: number) => {
    if (f) return f.parallax(px);
    const k = Math.round(px * 100) / 100;
    return par.get(k) ?? par.get(PX_SEABED) ?? { x: 0, y: 0 };
  };

  // --- fonts --------------------------------------------------------------
  let fontReady = false;
  let fontReadyAt: number | null = null;
  if (typeof document !== 'undefined' && document.fonts?.load) {
    const done = () => {
      fontReady = true;
    };
    document.fonts.load(HAND_FONT_LOAD).then(done, done);
    setTimeout(done, 4000);
  } else fontReady = true;

  // --- bottle ---------------------------------------------------------------
  let state: BottleState = 'hidden';
  let phase: Phase = 'float';
  let arrivedAt = 0;
  let x0 = 0;
  let xRest = 0;
  let bobPhase = 0;
  let sinkFrom: Pose | null = null;
  let sinkAt = 0;
  let sinkDur = 20;
  let pose: Pose = { x: -100, y: 0, rot: 0, s: 1, sx: 1, fog: FOG_SURFACE, par: PX_SURFACE };
  let tween: { from: Pose; at: number; dur: number; kind: 'open' | 'close' } | null = null;
  let popAt = -1;
  let corkOut = false;
  let openedAt = -1;
  let flashAt = -100;
  let textOutAt = -1;
  let fadeIn = 1;
  let ghostAt = -1;
  let screen = { x: -100, y: -100 };
  /** Kept ids at the moment today's bottle arrived; newer ids stay hidden until it is shelved. */
  let frozen: string[] | null = null;
  let closeTarget: { id: string | null; pose: Pose } | null = null;

  // --- kept bottles -----------------------------------------------------------
  let keptIds: string[] = [];
  const kept = new Map<string, Kept>();
  let keptInit = false;

  // --- pearl ----------------------------------------------------------------
  interface Pearl {
    from: { x: number; y: number };
    land: { x: number; y: number };
    at: number;
    landedAt: number;
    collectedAt: number;
    sway: number;
    x: number;
    y: number;
    size: number;
    fog: number;
    par: number;
    /** Screen position at the last update (parallax included), for hit-testing. */
    sx: number;
    sy: number;
    puff: { x: number; y: number; vx: number; vy: number }[];
  }
  let pearl: Pearl | null = null;

  const bottleLen = () => (phone ? 40 : 54);
  // Desktop floats it clear of the HUD row (pearl count), "for you" included.
  /**
   * The bottle's waterline. On a phone it floats clear of the HUD row, which sits 20px under the
   * safe area and is drawn 12% larger (about 50px tall), so its buttons never cover the bottle.
   */
  const bandY = () => (phone ? Math.max(0.16 * h, 128, safeTop + 20 + 50 + 32) : Math.max(0.15 * h, 120));
  const ledge = () => (shelf.w > 0 ? shelf : { x: 0.39 * w, y: 0.84 * h, w: 0.122 * w });
  const groundAt = (x: number) => {
    if (seabedY) {
      const y = seabedY(x);
      if (Number.isFinite(y) && y > 0) return y;
    }
    const lg = ledge();
    return x >= lg.x && x <= lg.x + lg.w ? lg.y : lg.y + 14;
  };

  function openTarget(): { x: number; y: number } {
    return phone ? { x: 0.24 * w, y: 0.18 * h } : { x: 0.3 * w, y: 0.34 * h };
  }

  /** Kept-pile layout: a wide ledge holds the whole pile; a narrow one spills onto the sand. */
  function pile() {
    const L = bottleLen() * KEPT_SCALE;
    const lg = ledge();
    return { L, lg, wide: lg.w >= 4.2 * L, cx: lg.x + lg.w * 0.52 };
  }

  /** The waiting bottle's resting place: lying at the front of the ledge. */
  function restPose(): Pose {
    const s = WAIT_SCALE;
    const L = bottleLen() * s;
    const pl = pile();
    const x = pl.cx + pl.L * 0.2;
    const rot = -3 * DEG;
    return { x, y: groundAt(x) + 6.6 - B.R * L, rot, s, sx: 1, fog: FOG_SEABED, par: PX_SEABED };
  }

  /** Where a kept bottle in `slot` lies at age `rank` (0 = newest). */
  function slotPose(slot: number, rank: number, id: string): Pose & { bury: number; depth: number } {
    const s = KEPT_SCALE;
    const pl = pile();
    const L = pl.L;
    const sl = SLOTS[slot % SLOTS.length];
    const lap = Math.floor(slot / SLOTS.length) * 0.2 * L;
    const lg = pl.lg;
    const [anchor, n] = sl.narrow;
    const x =
      lap +
      (pl.wide
        ? lg.x + lg.w * (0.06 + 0.88 * sl.u)
        : (anchor === 'c' ? pl.cx : anchor === 'l' ? lg.x : lg.x + lg.w) + n * L);
    const jitter = ((hashString(id) % 1000) / 1000 - 0.5) * 6;
    const ang = sl.ang + jitter;
    const flip = Math.abs(ang) > 90;
    const rot = (flip ? ang - 180 : ang) * DEG;
    const bury = BURY[Math.min(rank, BURY.length - 1)];
    // Half its vertical extent: lying it is the body radius, tipped it grows toward half the length.
    const ext = Math.abs(Math.sin(rot)) * L * 0.5 + Math.abs(Math.cos(rot)) * B.R * L;
    const y = groundAt(x) + sl.depth - ext + bury * 2 * ext;
    return { x, y, rot, s, sx: flip ? -1 : 1, fog: FOG_SEABED, par: PX_SEABED, bury, depth: sl.depth };
  }

  function shownIds(): string[] {
    return (frozen ?? keptIds).slice(-KEPT_MAX);
  }

  /** Slots for `ids`: bottles keep theirs, newcomers take the first free one. */
  function assignSlots(ids: string[]): Map<string, number> {
    const m = new Map<string, number>();
    const used = new Set<number>();
    for (const id of ids) {
      const k = kept.get(id);
      if (k && !k.leaving && !used.has(k.slot)) {
        m.set(id, k.slot);
        used.add(k.slot);
      }
    }
    for (const id of ids) {
      if (m.has(id)) continue;
      let sl = 0;
      while (used.has(sl)) sl++;
      m.set(id, sl);
      used.add(sl);
    }
    return m;
  }

  function syncKept(snap: boolean) {
    const ids = shownIds();
    const n = ids.length;
    const keep = new Set(ids);
    for (const k of kept.values()) if (!keep.has(k.id)) k.leaving = true;
    const slots = assignSlots(ids);
    ids.forEach((id, i) => {
      const rank = n - 1 - i;
      const slot = slots.get(id)!;
      const p = slotPose(slot, rank, id);
      let k = kept.get(id);
      if (!k || k.leaving) {
        k = { id, slot, x: p.x, y: p.y, bury: p.bury, depth: p.depth, rot: p.rot, sx: p.sx, alpha: snap ? 1 : 0, leaving: false, flashAt: -100, rank };
        kept.set(id, k);
      }
      k.slot = slot;
      k.rank = rank;
      if (snap) {
        k.x = p.x;
        k.y = p.y;
        k.bury = p.bury;
        k.depth = p.depth;
        k.rot = p.rot;
        k.sx = p.sx;
        k.alpha = 1;
      }
    });
  }

  function updateKept(dt: number) {
    const a = 1 - Math.exp(-dt * 1.6);
    for (const k of [...kept.values()]) {
      if (k.leaving) {
        // The oldest is taken by the sediment.
        k.bury = Math.min(1.1, k.bury + dt * 0.45);
        k.alpha = Math.max(0, k.alpha - dt * 0.55);
        const p = slotPose(k.slot, BURY.length - 1, k.id);
        k.y = p.y + (k.bury - p.bury) * B.R * 2 * bottleLen() * KEPT_SCALE;
        if (k.alpha <= 0) kept.delete(k.id);
        continue;
      }
      const p = slotPose(k.slot, k.rank, k.id);
      k.x += (p.x - k.x) * a;
      k.y += (p.y - k.y) * a;
      k.bury += (p.bury - k.bury) * a;
      k.depth = p.depth;
      k.rot = p.rot;
      k.sx = p.sx;
      k.alpha = Math.min(1, k.alpha + dt * 1.5);
    }
  }

  function setState(next: BottleState, f: WorldFrame | null) {
    if (state === next) return;
    state = next;
    if (next !== 'hidden') {
      const p = screenOfPose(pose, f);
      callbacks.onBottle(next, p.x, p.y);
    }
  }

  function screenOfPose(p: Pose, f: WorldFrame | null) {
    const o = parOf(f, p.par);
    return { x: p.x + o.x, y: p.y + o.y };
  }

  function floatPose(t: number): Pose {
    const age = t - arrivedAt;
    const span = Math.max(1, xRest - x0);
    // Drifts in at 10px/s, then eases into its resting point over the last few px.
    const ease = Math.min(span, 36);
    const t1 = (span - ease) / DRIFT_SPEED;
    const travel = reduced
      ? xRest
      : age < t1
        ? x0 + DRIFT_SPEED * age
        : xRest - ease * Math.exp((-DRIFT_SPEED * (age - t1)) / ease);
    const wander = 6 * Math.sin((TAU * age) / 20 + bobPhase) * clamp01(age / 30);
    const sp = reduced ? 0.5 : 1;
    const bob = 4 * Math.sin((TAU * age * sp) / 4.6 + bobPhase) * 0.82 + 0.72 * Math.sin((TAU * age * sp) / 7.3 + bobPhase * 2);
    const rock = (5 * Math.sin((TAU * age * sp) / 4.6 + bobPhase - 0.9) + 1.5 * Math.sin((TAU * age * sp) / 9.1)) * DEG;
    return { x: travel + wander, y: bandY() + bob, rot: -9 * DEG + rock, s: 1, sx: 1, fog: FOG_SURFACE, par: PX_SURFACE };
  }

  function sinkPose(t: number): Pose {
    const from = sinkFrom!;
    const to = restPose();
    const p = clamp01((t - sinkAt) / sinkDur);
    const e = easeInOutSine(p);
    const settle = 1 - smoothstep((p - 0.82) / 0.18);
    const sway = Math.sin((TAU * (t - sinkAt)) / 5.3) * 9 * Math.sin(Math.PI * p) * settle;
    const tilt = Math.sin((TAU * (t - sinkAt)) / 5.3 + 0.8) * 9 * DEG * Math.sin(Math.PI * p);
    return {
      x: lerp(from.x, to.x, e) + sway,
      y: lerp(from.y, to.y, e),
      rot: angleLerp(from.rot, to.rot, smoothstep(p)) + tilt,
      s: lerp(from.s, to.s, e),
      sx: 1,
      fog: lerp(from.fog, to.fog, e),
      par: lerp(from.par, to.par, e),
    };
  }

  function openPose(): Pose {
    const t = openTarget();
    return { x: t.x, y: t.y, rot: -26 * DEG, s: OPEN_SCALE, sx: 1, fog: 0, par: 0 };
  }

  function tweenPose(t: number): Pose {
    const tw = tween!;
    const p = clamp01((t - tw.at) / tw.dur);
    const a = tw.from;
    const b = tw.kind === 'open' ? openPose() : closeTarget!.pose;
    if (reduced) {
      // Reduced motion: no flight, the bottle fades out and in at its new place.
      return p < 0.5 ? a : b;
    }
    if (tw.kind === 'open') {
      const e = easeDriftIn(p);
      const lift = Math.sin(Math.PI * e) * (phone ? 10 : 18);
      return {
        x: lerp(a.x, b.x, e),
        y: lerp(a.y, b.y, e) - lift,
        rot: angleLerp(a.rot, b.rot, easeInOutSine(p)),
        s: lerp(a.s, b.s, e),
        sx: 1,
        fog: lerp(a.fog, b.fog, e),
        par: lerp(a.par, b.par, e),
      };
    }
    // Closing: drifts back (shrinks first), then sinks onto the ledge.
    const ex = easeInOutSine(p);
    const ey = easeInOutCubic(p);
    const es = easeOutCubic(p * 1.15);
    const back = Math.sin(Math.PI * Math.min(1, p * 1.6)) * (phone ? 8 : 14);
    return {
      x: lerp(a.x, b.x, ex),
      y: lerp(a.y, b.y, ey) - back,
      rot: angleLerp(a.rot, b.rot, easeInOutSine(p)),
      s: lerp(a.s, b.s, es),
      sx: lerp(a.sx, b.sx, smoothstep((p - 0.35) / 0.55)),
      fog: lerp(a.fog, b.fog, ex),
      par: lerp(a.par, b.par, ey),
    };
  }

  function corkOffset(t: number): { dx: number; dy: number; rot: number } | null {
    if (state === 'closing' && tween) {
      // Re-seated in the first 300ms of closing.
      const p = clamp01((t - tween.at) / 0.3);
      if (p >= 1 || !corkOut) return null;
      const e = 1 - easeInOutSine(p);
      return { dx: 4 * e, dy: -16 * e, rot: 25 * DEG * e };
    }
    if (popAt < 0 || t < popAt) return null;
    const age = t - popAt;
    if (reduced) return { dx: 4, dy: -16, rot: 25 * DEG };
    const p = clamp01(age / POP_TIME);
    const e = easeOutCubic(p);
    const after = Math.max(0, age - POP_TIME);
    const rise = (1 - Math.exp(-after * 1.4)) * 2;
    return {
      dx: 4 * e + 1.4 * Math.sin((TAU * after) / 4.3) * clamp01(after),
      dy: -14 * e - rise + 1.2 * Math.sin((TAU * after) / 3.1) * clamp01(after),
      rot: 25 * DEG * e + 5 * DEG * Math.sin((TAU * after) / 3.7) * clamp01(after),
    };
  }

  function mouthOf(p: Pose) {
    const L = bottleLen() * p.s;
    return bottlePoint(p.x, p.y, p.rot, p.sx, B.ue * L, 0);
  }

  function computeCloseTarget(): { id: string | null; pose: Pose } {
    const before = new Set(frozen ?? []);
    const latest = keptIds.slice(-KEPT_MAX);
    const fresh = latest.filter((id) => !before.has(id));
    const id = fresh.length ? fresh[fresh.length - 1] : null;
    const key = id ?? '\u0000today';
    const slot = assignSlots(id ? latest : [...latest, key]).get(key) ?? 0;
    const p = slotPose(slot, 0, key);
    return { id, pose: { x: p.x, y: p.y, rot: p.rot, s: p.s, sx: p.sx, fog: p.fog, par: p.par } };
  }

  // --- pearl helpers ----------------------------------------------------------
  function pearlLandX(fromX: number): number {
    let x = fromX + (Math.random() - 0.5) * 0.16 * w;
    x = Math.min(0.84 * w, Math.max(0.32 * w, x));
    // Keep it clear of the bottle shelf and anything spilled at its feet.
    const pl = pile();
    const a = pl.lg.x - (pl.wide ? 1 : 2.1) * pl.L;
    const b = pl.lg.x + pl.lg.w + (pl.wide ? 1 : 1.3) * pl.L;
    if (x > a && x < b) x = x - a < b - x && a > 0.3 * w ? a - 6 : b + 8;
    return Math.min(0.86 * w, Math.max(0.3 * w, x));
  }

  function pearlScreen(f: WorldFrame | null) {
    if (!pearl) return null;
    if (!f) return { x: pearl.sx, y: pearl.sy };
    const o = f.parallax(pearl.par);
    return { x: pearl.x + o.x, y: pearl.y + o.y };
  }

  function updatePearl(f: WorldFrame) {
    const p = pearl;
    if (!p) return;
    const t = now;
    if (p.collectedAt >= 0) {
      if (t - p.collectedAt > 1.2) pearl = null;
      return;
    }
    const age = t - p.at;
    const k = clamp01(age / PEARL_SINK);
    const e = smoothstep(k);
    const landY = groundAt(p.land.x) - PEARL_R * 0.72;
    p.land.y = landY;
    const sway = Math.sin((TAU * age) / 2.9 + p.sway) * 7 * (1 - k) * clamp01(age / 1.2);
    p.x = lerp(p.from.x, p.land.x, easeInOutSine(k)) + sway;
    p.y = lerp(p.from.y, landY, e);
    p.size = lerp(0.4, 1, easeInOutSine(k));
    p.fog = PEARL_FOG * (1 - k);
    p.par = lerp(PX_WHALE, PX_SEABED, e);
    const so = f.parallax(p.par);
    p.sx = p.x + so.x;
    p.sy = p.y + so.y;
    if (k >= 1 && p.landedAt < 0) {
      p.landedAt = t;
      const s = pearlScreen(f)!;
      if (!reduced) {
        for (let i = 0; i < 6; i++) {
          const a = Math.PI + (i / 5) * Math.PI;
          p.puff.push({ x: p.x, y: landY + PEARL_R * 0.6, vx: Math.cos(a) * (8 + i * 1.5) * (i % 2 ? 1 : -1), vy: -6 - (i % 3) * 3 });
        }
      }
      callbacks.onPearl('landed', s.x, s.y);
    }
    if (p.landedAt >= 0 && t - p.landedAt >= PEARL_AUTO) collect(f);
  }

  function collect(f: WorldFrame | null) {
    const p = pearl;
    if (!p || p.collectedAt >= 0) return;
    p.collectedAt = now;
    const s = pearlScreen(f)!;
    callbacks.onPearl('collected', s.x, s.y);
  }

  // --- drawing helpers ----------------------------------------------------------

  function drawDaily(ctx: CanvasRenderingContext2D, f: WorldFrame) {
    const L0 = bottleLen();
    const p = pose;
    const L = L0 * p.s;
    const o = f.parallax(p.par);
    const x = p.x + o.x;
    const y = p.y + o.y;
    const yN = clamp01(y / h);
    const Lt = f.lighting;
    const level = Math.max(0.35, Lt.glowGain(yN));
    const pulse = lanternPulse(now, 0.13);
    const flash = envelope(now - flashAt);
    // While it settles onto the shelf, its light eases to a kept bottle's so the hand-off is seamless.
    const toKept = state === 'closing' && tween && !reduced ? smoothstep(((now - tween.at) / tween.dur) * 1.3 - 0.3) : 0;
    const bio = Lt.biolum(yN);
    const lit = lerp(
      clamp01((0.12 + 0.5 * level * (0.6 + 0.4 * pulse)) * (1 - p.fog * 0.4) + flash * 0.25),
      keptLit(bio, 0),
      toKept,
    );
    const look = lookFor(Lt, yN, p.fog, lit, now, f.lineWidth);
    if (toKept > 0) {
      look.paper = mixOK(look.paper, Lt.waterAt(yN), 0.3 * (1 - lit) * toKept);
      look.edgeAlpha *= 1 - 0.38 * toKept;
    }
    look.corkOff = corkOffset(now);
    if (openedAt >= 0 && state === 'open') {
      const r = clamp01((now - openedAt) / 0.5);
      look.rollSlide = easeInOutSine(r);
      look.roll = 1 - smoothstep((r - 0.35) / 0.65);
    } else if (state === 'closing' && tween) {
      look.roll = smoothstep((now - tween.at) / 0.4);
    }
    let alpha = fadeIn;
    if (reduced && tween) {
      const q = clamp01((now - tween.at) / tween.dur);
      alpha *= Math.abs(1 - 2 * q);
    }
    if (ghostAt >= 0) alpha *= 1 - clamp01((now - ghostAt) / 0.6);
    if (alpha <= 0.002) return;

    // Lantern inside, under the glass.
    const g = bottlePoint(x, y, p.rot, p.sx, -0.16 * L, 0.04 * L);
    // Once the note is out, the light left in the glass is quieter.
    const ga = lerp(level * (0.55 + 0.45 * pulse) * (1 - p.fog * 0.45) * 0.8 * (0.6 + 0.4 * look.roll), keptGlow(bio, 0), toKept);
    f.glow(C.lantern, g.x, g.y, lerp(L * 0.7 + 8, L * 0.75 + 5, toKept), (ga + flash * 0.5) * alpha);

    const a0 = ctx.globalAlpha;
    ctx.globalAlpha = a0 * alpha;
    drawBottle(ctx, x, y, p.rot, p.sx, L, look);
    ctx.globalAlpha = a0;
  }

  function drawForYou(ctx: CanvasRenderingContext2D, f: WorldFrame) {
    if (state !== 'arriving' && !(textOutAt >= 0 && now - textOutAt < 0.5)) return;
    if (!fontReady || fontReadyAt === null) return;
    const start = Math.max(arrivedAt + WRITE_DELAY, fontReadyAt);
    const age = now - start;
    if (age <= 0) return;
    let alpha = textOutAt >= 0 ? 1 - clamp01((now - textOutAt) / 0.45) : 1;
    if (reduced) alpha *= clamp01(age / 0.6);
    if (alpha <= 0.002) return;

    const Lt = f.lighting;
    const o = f.parallax(PX_SURFACE);
    const L = bottleLen() * pose.s;
    // The note follows the bottle's drift but only half its bob, so it stays easy to read.
    const bx = pose.x + o.x;
    const by = bandY() + (pose.y - bandY()) * 0.45 + o.y;
    const tx = bx + L * 0.5 + 16;
    const ty = by + L * 0.5 + 12;
    const yN = clamp01((ty - 16) / h);
    const base = mixOK(handInk(Lt.from), handInk(Lt.mode), Lt.progressAt(yN));
    const bg = mixOK(Lt.waterAt(yN), Lt.color('ray', yN), Lt.num('rayAlpha', yN));
    const ink = legibleInk(base, bg, 4.5);

    ctx.save();
    ctx.globalAlpha *= alpha;
    ctx.font = HAND_FONT;
    ctx.textBaseline = 'alphabetic';
    const tw = ctx.measureText('for you').width;
    // Write-on: a left-to-right wipe with a short feathered edge.
    const wipe = reduced ? 1 : easeInOutSine(age / WRITE_TIME);
    ctx.translate(tx, ty);
    ctx.rotate(-2.5 * DEG);
    ctx.fillStyle = ink;
    const edge = -2 + wipe * (tw + 10);
    const pass = (x0c: number, x1c: number, a: number) => {
      if (x1c <= x0c || a <= 0) return;
      ctx.save();
      ctx.beginPath();
      ctx.rect(x0c, -26, x1c - x0c, 40);
      ctx.clip();
      ctx.globalAlpha *= a;
      ctx.fillText('for you', 0, 0);
      ctx.restore();
    };
    if (wipe >= 1) ctx.fillText('for you', 0, 0);
    else {
      pass(-4, edge - 6, 1);
      pass(edge - 6, edge - 3, 0.6);
      pass(edge - 3, edge, 0.25);
    }

    // A small hand-drawn arrow curling back up to the bottle.
    const ap = reduced ? 1 : clamp01((age - WRITE_TIME + 0.08) / ARROW_TIME);
    if (ap > 0) {
      ctx.strokeStyle = ink;
      ctx.lineWidth = Math.max(f.lineWidth, 1.25);
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      const sx0 = -5;
      const sy0 = -9;
      const ex = -(tx - bx) + L * 0.3;
      const ey = -(ty - by) + L * 0.2 + 4;
      const cx = (sx0 + ex) / 2 - 2;
      const cy = Math.max(sy0, ey) + 7;
      const qa = (q: number) => ({
        x: (1 - q) * (1 - q) * sx0 + 2 * (1 - q) * q * cx + q * q * ex,
        y: (1 - q) * (1 - q) * sy0 + 2 * (1 - q) * q * cy + q * q * ey,
      });
      const e = easeOutCubic(ap);
      ctx.beginPath();
      ctx.moveTo(sx0, sy0);
      const steps = 14;
      for (let i = 1; i <= steps; i++) {
        const q = (i / steps) * e;
        const pt = qa(q);
        ctx.lineTo(pt.x, pt.y);
      }
      ctx.stroke();
      const hp = clamp01((ap - 0.72) / 0.28);
      if (hp > 0) {
        const tip = qa(1);
        const back = qa(0.86);
        const ang = Math.atan2(tip.y - back.y, tip.x - back.x);
        const h1 = 5.5 * hp;
        const h2 = 4.6 * hp;
        ctx.beginPath();
        ctx.moveTo(tip.x, tip.y);
        ctx.lineTo(tip.x - Math.cos(ang - 0.6) * h1, tip.y - Math.sin(ang - 0.6) * h1);
        ctx.moveTo(tip.x + Math.cos(ang) * 0.4, tip.y + Math.sin(ang) * 0.4);
        ctx.lineTo(tip.x - Math.cos(ang + 0.5) * h2, tip.y - Math.sin(ang + 0.5) * h2);
        ctx.stroke();
      }
    }
    ctx.restore();
  }

  function drawKept(ctx: CanvasRenderingContext2D, f: WorldFrame) {
    if (!kept.size) return;
    const Lt = f.lighting;
    const o = f.parallax(PX_SEABED);
    const L = bottleLen() * KEPT_SCALE;
    const list = [...kept.values()].sort((a, b) => a.depth - b.depth || b.rank - a.rank);
    const yN = clamp01((ledge().y + o.y) / h);
    const bio = Lt.biolum(yN);
    const sand = Lt.color('l5', yN);
    const pr = Lt.progressAt(yN);
    const night5 = Lt.mode === 'midnight' ? (Lt.from === 'midnight' ? 1 : pr) : Lt.from === 'midnight' ? 1 - pr : 0;
    const capA = Lt.num('ridgeCapAlpha', yN) * (1 - FOG_SEABED) * (1 - night5);
    const capC = Lt.color('ridgeCap', yN);

    // Their papers glow faintly at night: the newest few get their own lantern, the rest share one.
    let sprites = 0;
    let gx = 0;
    let gy = 0;
    let gn = 0;
    for (const k of list) {
      if (k.leaving) continue;
      const fl = envelope(now - k.flashAt);
      const a = (keptGlow(bio, k.bury) + fl * Math.max(0.35, Lt.glowGain(yN)) * 0.6) * k.alpha;
      if (a <= 0.004) continue;
      if (k.rank < 4 && sprites < 4) {
        f.glow(C.lantern, k.x + o.x - k.sx * 0.14 * L, k.y + o.y, L * 0.75 + 5, a);
        sprites++;
      } else {
        gx += k.x;
        gy += k.y;
        gn++;
      }
    }
    if (gn > 0) f.glow(C.lantern, gx / gn + o.x, gy / gn + o.y, L * 1.6, 0.18 * bio);

    for (const k of list) {
      if (k.alpha <= 0.003) continue;
      const x = k.x + o.x;
      const y = k.y + o.y;
      const ground = groundAt(k.x) + o.y + k.depth;
      const ext = Math.abs(Math.sin(k.rot)) * L * 0.5 + Math.abs(Math.cos(k.rot)) * B.R * L;
      const age = Math.min(1, k.rank / 6);
      const fl = envelope(now - k.flashAt);
      const lit = clamp01(keptLit(bio, k.bury) + fl * 0.3);
      const look = lookFor(Lt, yN, FOG_SEABED + 0.05 * age, lit, now, f.lineWidth);
      look.glass = mixOK(look.glass, Lt.color('seagrass', yN), 0.22 * age);
      // Small and low in the water: quieter paper and edge than today's bottle.
      look.paper = mixOK(look.paper, Lt.waterAt(yN), 0.3 * (1 - lit));
      look.edgeAlpha *= 0.62;
      look.glassAlpha = 0.25 + 0.06 * age;
      look.capAlpha = capA * (0.25 + 0.75 * age) * (k.bury > 0.05 ? 1 : 0.4);
      look.cap = capC;
      ctx.save();
      ctx.globalAlpha *= k.alpha;
      // Sunk into the sediment: hide what is below the ground line.
      ctx.beginPath();
      ctx.rect(x - L, y - L, L * 2, ground - (y - L) + 0.5);
      ctx.clip();
      drawBottle(ctx, x, y, k.rot, k.sx, L, look);
      ctx.restore();
      if (k.bury > 0.04) {
        // A drift of sand banked against it, with its own sediment cap.
        const hgt = k.bury * 2 * ext * 0.3;
        const half = L * (0.36 + 0.2 * k.bury) * (0.45 + 0.55 * Math.abs(Math.cos(k.rot)));
        const lean = (hashString(k.id) % 7) / 7 - 0.5;
        const px = x + lean * L * 0.25;
        ctx.save();
        ctx.globalAlpha *= k.alpha;
        ctx.beginPath();
        ctx.moveTo(px - half - L * 0.18, ground + 0.5);
        ctx.bezierCurveTo(px - half * 0.55, ground + 0.5, px - half * 0.5, ground - hgt, px, ground - hgt);
        ctx.bezierCurveTo(px + half * 0.55, ground - hgt, px + half * 0.6, ground + 0.5, px + half + L * 0.12, ground + 0.5);
        ctx.closePath();
        ctx.fillStyle = sand;
        ctx.fill();
        if (capA > 0.004) {
          ctx.strokeStyle = withAlpha(capC, capA * 0.8);
          ctx.lineWidth = Math.max(f.lineWidth, 1.2);
          ctx.beginPath();
          ctx.moveTo(px - half * 0.62, ground - hgt * 0.42);
          ctx.bezierCurveTo(px - half * 0.4, ground - hgt * 0.98, px - half * 0.2, ground - hgt, px, ground - hgt);
          ctx.bezierCurveTo(px + half * 0.3, ground - hgt, px + half * 0.45, ground - hgt * 0.7, px + half * 0.62, ground - hgt * 0.36);
          ctx.stroke();
        }
        ctx.restore();
      }
    }
  }

  function drawPearl(ctx: CanvasRenderingContext2D, f: WorldFrame) {
    const p = pearl;
    if (!p) return;
    const o = f.parallax(p.par);
    const x = p.x + o.x;
    let y = p.y + o.y;
    const yN = clamp01(y / h);
    const Lt = f.lighting;
    let alpha = 1;
    let flash = 0;
    if (p.collectedAt >= 0) {
      const c = clamp01((now - p.collectedAt) / 1.1);
      alpha = 1 - easeInOutSine(c);
      y -= 18 * easeOutCubic(c);
      flash = envelope(now - p.collectedAt);
    }
    if (p.landedAt >= 0) flash = Math.max(flash, envelope(now - p.landedAt) * 0.7);
    const r = PEARL_R * p.size;
    const level = Math.max(0.3, Lt.glowGain(yN));
    const shimmer = lanternPulse(now * 0.62, 0.4);
    const halo = (level * (0.4 + 0.25 * shimmer) * (1 - p.fog * 0.5) + flash * 0.7) * alpha;
    // Far lights are big and dim, near ones small and sharp (§4.2).
    f.glow(C.whalePearl1, x, y, r * (3.2 + 1.6 * p.fog), halo);

    ctx.save();
    ctx.globalAlpha *= alpha;
    const pic = art('pearl');
    if (pic) {
      const tint = sceneTint(Lt, yN, p.fog);
      ctx.translate(x, y);
      drawArt(ctx, tinted(pic, tint.color, tint.amount * 0.6), pic, r * 2.2, 0.5, 0.5);
    } else {
      const spr = getPearlSprite();
      const sr = r * ((PEARL_SPRITE_R + 4) / PEARL_SPRITE_R);
      ctx.drawImage(spr, x - sr, y - sr, sr * 2, sr * 2);
      if (p.fog > 0.01) {
        ctx.fillStyle = withAlpha(Lt.waterAt(yN), p.fog);
        ctx.beginPath();
        ctx.arc(x, y, r + 0.3, 0, TAU);
        ctx.fill();
      }
      const dark = Lt.num('bodyDarken', yN);
      if (dark > 0.01) {
        ctx.fillStyle = withAlpha(C.nightFloor, dark * 0.45);
        ctx.beginPath();
        ctx.arc(x, y + r * 0.12, r * 0.98, 0.15 * Math.PI, 0.85 * Math.PI);
        ctx.fill();
      }
    }
    ctx.restore();

    // Settling sediment where it landed.
    if (p.puff.length && p.landedAt >= 0) {
      const age = now - p.landedAt;
      if (age < 1.6) {
        const sedA = 0.5 * (1 - age / 1.6);
        ctx.fillStyle = withAlpha(Lt.color('ridgeCap', yN), sedA * Lt.num('ridgeCapAlpha', yN) * 2.2);
        for (const s of p.puff) {
          const k = 1 - Math.exp(-age * 2.4);
          const px = s.x + o.x + (s.vx / 2.4) * k;
          const py = s.y + o.y + (s.vy / 2.4) * k + 10 * age * age * 0.5;
          ctx.fillRect(px - 0.6, py - 0.6, 1.2, 1.2);
        }
      } else p.puff.length = 0;
    }
  }

  // ---------------------------------------------------------------------------

  const api: WorldObjects = {
    resize(nw, nh, nphone) {
      const kx = nw / Math.max(1, w);
      const ky = nh / Math.max(1, h);
      w = nw;
      h = nh;
      phone = nphone;
      safeTop = measureSafeTop();
      if (state !== 'hidden') {
        x0 *= kx;
        xRest = restX(nw);
        pose.x *= kx;
        pose.y *= ky;
        if (sinkFrom) {
          sinkFrom.x *= kx;
          sinkFrom.y *= ky;
        }
        if (tween) {
          tween.from.x *= kx;
          tween.from.y *= ky;
        }
      }
      if (pearl) {
        pearl.from.x *= kx;
        pearl.from.y *= ky;
        pearl.land.x *= kx;
        pearl.x *= kx;
        pearl.y *= ky;
      }
      if (keptInit) syncKept(true);
    },

    setShelf(s, ids) {
      const moved = s.x !== shelf.x || s.y !== shelf.y || s.w !== shelf.w;
      shelf = { x: s.x, y: s.y, w: s.w };
      keptIds = ids.slice();
      syncKept(!keptInit || moved);
      keptInit = true;
    },

    setSeabed(fn) {
      seabedY = fn;
    },

    get bottleState() {
      return state;
    },

    bottleArrive(f) {
      if (state !== 'hidden' && state !== 'shelved') return;
      reduced = f.lighting.reducedMotion;
      arrivedAt = now;
      bobPhase = Math.random() * TAU;
      const L = bottleLen();
      x0 = -L * 0.32;
      xRest = restX(w);
      phase = 'float';
      tween = null;
      popAt = -1;
      openedAt = -1;
      textOutAt = -1;
      ghostAt = -1;
      sinkFrom = null;
      closeTarget = null;
      fadeIn = reduced ? 0 : 1;
      frozen = keptIds.slice();
      pose = floatPose(now);
      state = 'hidden';
      setState('arriving', f);
    },

    openBottle(f) {
      if (state !== 'arriving' && state !== 'waiting') return;
      reduced = f.lighting.reducedMotion;
      flashAt = now;
      if (state === 'arriving') textOutAt = now;
      const from = { ...pose };
      const fromShelf = from.par > 3;
      tween = { from, at: now, dur: reduced ? 0.8 : fromShelf ? 2.1 : 1.6, kind: 'open' };
      popAt = -1;
      openedAt = -1;
      setState('opening', f);
    },

    closeBottle(f) {
      if (state !== 'open' && state !== 'opening') return;
      reduced = f.lighting.reducedMotion;
      // A full shelf lets its oldest bottle go as today's settles in.
      if (frozen) {
        const latest = new Set(keptIds.slice(-KEPT_MAX));
        frozen = frozen.filter((id) => latest.has(id));
        syncKept(false);
      }
      closeTarget = computeCloseTarget();
      corkOut = popAt >= 0 && now >= popAt;
      tween = { from: { ...pose }, at: now, dur: reduced ? 0.9 : CLOSE_TIME, kind: 'close' };
      setState('closing', f);
    },

    bottlePosition() {
      return { x: screen.x, y: screen.y };
    },

    releasePearl(from, f) {
      reduced = f.lighting.reducedMotion;
      if (pearl && pearl.collectedAt < 0) collect(f);
      const landX = pearlLandX(from.x);
      pearl = {
        from: { x: from.x, y: from.y },
        land: { x: landX, y: groundAt(landX) },
        at: now,
        landedAt: -1,
        collectedAt: -1,
        sway: Math.random() * TAU,
        x: from.x,
        y: from.y,
        size: 0.4,
        fog: PEARL_FOG,
        par: PX_WHALE,
        sx: from.x,
        sy: from.y,
        puff: [],
      };
      const o = f.parallax(PX_WHALE);
      pearl.sx += o.x;
      pearl.sy += o.y;
      callbacks.onPearl('released', from.x + o.x, from.y + o.y);
    },

    collectPearl(f) {
      collect(f);
    },

    pearlPosition() {
      if (!pearl || pearl.collectedAt >= 0) return null;
      return pearlScreen(null);
    },

    keptPosition(id) {
      const k = kept.get(id);
      if (!k || k.leaving) return null;
      const o = parOf(null, PX_SEABED);
      return { x: k.x + o.x, y: k.y + o.y };
    },

    update(f) {
      const dt = Math.min(0.1, Math.max(0, f.dt));
      now += dt;
      reduced = f.lighting.reducedMotion;
      for (const px of [PX_SURFACE, PX_WHALE, PX_SEABED]) par.set(px, f.parallax(px));
      if (fontReady && fontReadyAt === null) fontReadyAt = now;

      if (state === 'arriving' || state === 'waiting') {
        if (reduced && fadeIn < 1) fadeIn = Math.min(1, fadeIn + dt / 1.2);
        if (phase === 'float') {
          pose = floatPose(now);
          if (now - arrivedAt >= SINK_AFTER) {
            phase = 'sink';
            sinkFrom = { ...pose };
            sinkAt = now;
            const dist = Math.abs(restPose().y - pose.y);
            sinkDur = reduced ? 1.6 : Math.min(30, Math.max(16, dist / 20));
            textOutAt = now;
            setState('waiting', f);
          }
        } else if (phase === 'sink') {
          if (reduced) {
            const q = clamp01((now - sinkAt) / sinkDur);
            pose = q < 0.5 ? sinkFrom! : restPose();
            fadeIn = Math.abs(1 - 2 * q);
          } else pose = sinkPose(now);
          if (now - sinkAt >= sinkDur) {
            phase = 'rest';
            fadeIn = 1;
          }
        } else {
          const r = restPose();
          const breathe = Math.sin((TAU * now) / 11.1) * 0.6 * DEG;
          pose = { ...r, rot: r.rot + breathe };
        }
      } else if (state === 'opening' && tween) {
        pose = tweenPose(now);
        const done = now - tween.at >= tween.dur;
        if (done && popAt < 0) {
          popAt = now;
          if (!reduced) {
            const m = mouthOf(pose);
            const o = f.parallax(pose.par);
            f.bubbles(m.x + o.x, m.y + o.y - 2, { count: 5, spread: 3, size: [1.2, 2.6], speed: [26, 38], color: C.lantern });
          }
        }
        if (popAt >= 0 && now - popAt >= POP_TIME) {
          openedAt = now;
          tween = null;
          pose = openPose();
          setState('open', f);
        }
      } else if (state === 'open') {
        pose = openPose();
      } else if (state === 'closing' && tween) {
        if (closeTarget) {
          // Follow the slot if the shelf moved (resize) while closing.
          const fresh = computeCloseTarget();
          closeTarget = { id: closeTarget.id, pose: fresh.pose };
        }
        pose = tweenPose(now);
        if (now - tween.at >= tween.dur) {
          tween = null;
          popAt = -1;
          openedAt = -1;
          pose = { ...closeTarget!.pose };
          const landed = closeTarget!.id;
          frozen = null;
          syncKept(false);
          if (landed) {
            const k = kept.get(landed);
            if (k) {
              const p = slotPose(k.slot, 0, landed);
              k.x = p.x;
              k.y = p.y;
              k.bury = p.bury;
              k.alpha = 1;
            }
            ghostAt = -1;
            fadeIn = 0;
          } else ghostAt = now;
          closeTarget = null;
          setState('shelved', f);
        }
      }

      if (state !== 'hidden') screen = screenOfPose(pose, f);
      updateKept(dt);
      updatePearl(f);
    },

    drawSurfaceBand(ctx, f) {
      if (state === 'arriving') drawDaily(ctx, f);
      drawForYou(ctx, f);
    },

    drawMidwater(ctx, f) {
      if (pearl && pearl.landedAt < 0 && pearl.collectedAt < 0 && pearl.fog > 0.24) drawPearl(ctx, f);
    },

    drawSeabed(ctx, f) {
      drawKept(ctx, f);
      if (state === 'waiting') drawDaily(ctx, f);
      if (state === 'shelved' && ghostAt >= 0) drawDaily(ctx, f);
      if (pearl && !(pearl.landedAt < 0 && pearl.collectedAt < 0 && pearl.fog > 0.24)) drawPearl(ctx, f);
    },

    drawForeground(ctx, f) {
      if (state === 'opening' || state === 'open' || state === 'closing') drawDaily(ctx, f);
    },

    hit(x, y, which = 'all') {
      if (which !== 'kept') {
      // 1. The Guardian pearl (generous: it is small and precious).
      if (pearl && pearl.collectedAt < 0 && pearl.size > 0.5) {
        const s = pearlScreen(null)!;
        if (Math.hypot(x - s.x, y - s.y) <= Math.max(24, PEARL_R * pearl.size + 16)) return { kind: 'pearl' };
      }
      // 2. Today's bottle while it floats, sinks or waits on the ledge.
      if (state === 'arriving' || state === 'waiting') {
        const L = bottleLen() * pose.s;
        if (capsuleDist(x, y, screen.x, screen.y, pose.rot, L * 0.5) <= Math.max(22, B.R * L + 14)) {
          flashAt = now;
          return { kind: 'bottle' };
        }
      }
      }
      if (which === 'live') return null;
      // 3. Kept bottles: the nearest one under the finger.
      const o = parOf(null, PX_SEABED);
      const L = bottleLen() * KEPT_SCALE;
      let best: Kept | null = null;
      let bestD = Infinity;
      for (const k of kept.values()) {
        if (k.leaving || k.alpha < 0.5) continue;
        const d = capsuleDist(x, y, k.x + o.x, k.y + o.y, k.rot, L * 0.5) - (6 - k.rank) * 0.3;
        if (d <= 22 && d < bestD) {
          bestD = d;
          best = k;
        }
      }
      if (best) {
        best.flashAt = now;
        return { kind: 'shelf', messageId: best.id };
      }
      return null;
    },
  };

  function restX(width: number): number {
    return (phone ? 0.3 : 0.3) * width;
  }

  return api;
}

/** Distance from (px, py) to a segment of half-length `half` centred at (cx, cy) along angle `rot`. */
function capsuleDist(px: number, py: number, cx: number, cy: number, rot: number, half: number): number {
  const c = Math.cos(rot);
  const s = Math.sin(rot);
  const dx = px - cx;
  const dy = py - cy;
  const u = Math.max(-half, Math.min(half, dx * c + dy * s));
  return Math.hypot(dx - u * c, dy - u * s);
}
