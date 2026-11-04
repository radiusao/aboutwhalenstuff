/**
 * The landscape of "Quiet Fathoms": the water column, the lit surface, the flat silhouette
 * layers with their sediment caps, the decorations, the near occluders and the vignette.
 * Silhouettes are built once per resize from the seeded sea, so her sea keeps its shape; each
 * frame only fills them with the color the descending light has reached at that layer.
 */
import type { LightingMode } from '../types/sanctuary';
import type { Lighting, SeagrassAnchor, WorldFrame } from './types';
import { C, adjustOK, layerFog, layerHorizon, mixOK } from './palette';
import { range, stream, valueNoise1D } from './rng';
import { art, drawArt, drawSwaying, sceneTint, tinted, type ArtSlot } from './art';
import { causticTintAt, createSurface, createWaterCache, drawCaustics, nightAt } from './surface';
import {
  addCaps,
  buildKelpStalk,
  buildRuins,
  buildSeaFan,
  clockwise,
  drawChest,
  drawKelpStalk,
  drawRuins,
  drawSeaFan,
  easeEnter,
  fanSkew,
  flushDots,
  kelpBladeEdges,
  kelpSway,
  newDots,
  polyPath,
  pushDot,
  ribbon,
  RUINS_MIN_ASPECT,
  spline,
  type DotBatch,
  type Ink,
  type KelpStalk,
  type Ruins,
  type SeaFan,
} from './decorations';

export type DecorationId = 'kelp-forest' | 'glowing-coral' | 'treasure-chest' | 'ancient-ruins';

export interface Scenery {
  /** Rebuild Path2D silhouettes and caches (debounced by the engine). */
  resize(w: number, h: number, phone: boolean, dpr: number): void;
  /** Which decorations to draw; newly added ones crossfade in over 400ms. */
  setDecorations(ids: string[]): void;
  drawWater(ctx: CanvasRenderingContext2D, f: WorldFrame): void;
  drawSurface(ctx: CanvasRenderingContext2D, f: WorldFrame): void;
  drawRidge(ctx: CanvasRenderingContext2D, f: WorldFrame): void;
  drawShelf(ctx: CanvasRenderingContext2D, f: WorldFrame): void;
  drawKelpWall(ctx: CanvasRenderingContext2D, f: WorldFrame): void;
  drawReef(ctx: CanvasRenderingContext2D, f: WorldFrame): void;
  drawSeabed(ctx: CanvasRenderingContext2D, f: WorldFrame): void;
  drawOccluders(ctx: CanvasRenderingContext2D, f: WorldFrame): void;
  drawVignette(ctx: CanvasRenderingContext2D, f: WorldFrame): void;
  /** Seagrass blades (and sea-fan base points) seahorses can anchor to. */
  readonly anchors: SeagrassAnchor[];
  /** The flat rock ledge on L5 where kept bottles rest (CSS px, before parallax). */
  shelf(): { x: number; y: number; w: number };
  /** Top surface y of the seabed at screen x (where the guardian pearl lands). */
  seabedY(x: number): number;
  /** Chest tap target, or null when not owned. */
  chestHit(x: number, y: number): boolean;
  /** Ease the chest lid open 30 degrees over 600ms, then closed again after 2.5s. */
  openChest(): void;
  /** Light front passing: +40% sway on kelp and seagrass within `radius` of (x, y), decaying over 2s. */
  kick(x: number, y: number, radius: number): void;
}

const TAU = Math.PI * 2;
const DEG = Math.PI / 180;
/** Atmospheric fog on the chest: more than its L5 layer (.08), so it belongs to the sea rather than reading as an icon. */
const CHEST_FOG = 0.3;
/** Spare edge on her background so the parallax never shows past it, px. */
const BACKDROP_PAD = 12;
/** How far a single background.png is darkened toward the night floor in each light. */
const BACKDROP_DARKEN: Record<LightingMode, number> = { day: 0, sunset: 0.22, midnight: 0.6 };
/** Her chest picture: width as a share of the drawn chest's, and how much of it the sand hides. */
const CHEST_PICTURE_W = 1.15;
const CHEST_PICTURE_SINK = 0.1;
/** Max parallax per layer, px. */
const PX = { surface: 0.5, l1: 1, l2: 2, l3: 4, l4: 6, l5: 9, l6: 14 } as const;
const H = layerHorizon;
/** At night, how much less fog thins the L1-L3 rims (§2.2: Midnight caps at α .20, not fogged away). */
const NIGHT_RIM_RELIEF = 0.6;

// ---------------------------------------------------------------------------
// Profiles
// ---------------------------------------------------------------------------

interface Profile {
  x0: number;
  step: number;
  ys: Float32Array;
}

function sampleProfile(w: number, pad: number, step: number, fn: (x: number) => number): Profile {
  const n = Math.ceil((w + pad * 2) / step) + 1;
  const ys = new Float32Array(n);
  for (let i = 0; i < n; i++) ys[i] = fn(-pad + i * step);
  return { x0: -pad, step, ys };
}

function yAt(p: Profile, x: number): number {
  const f = (x - p.x0) / p.step;
  const i = Math.max(0, Math.min(p.ys.length - 2, Math.floor(f)));
  const fr = Math.min(1, Math.max(0, f - i));
  return p.ys[i] + (p.ys[i + 1] - p.ys[i]) * fr;
}

function profilePts(p: Profile): number[] {
  const out: number[] = [];
  for (let i = 0; i < p.ys.length; i++) out.push(p.x0 + i * p.step, p.ys[i]);
  return out;
}

function profileFill(p: Profile, bottom: number): Path2D {
  const path = new Path2D();
  const n = p.ys.length;
  path.moveTo(p.x0, bottom);
  for (let i = 0; i < n; i++) path.lineTo(p.x0 + i * p.step, p.ys[i]);
  path.lineTo(p.x0 + (n - 1) * p.step, bottom);
  path.closePath();
  return path;
}

function smooth(e0: number, e1: number, x: number): number {
  const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0)));
  return t * t * (3 - 2 * t);
}

/** Seamount shape 0..1: a rounded summit over concave flanks, asymmetric half widths. */
function seamount(x: number, cx: number, hwL: number, hwR: number): number {
  const d = x < cx ? (cx - x) / hwL : (x - cx) / hwR;
  if (d > 1.8) return 0;
  return 0.5 * Math.exp(-3 * d * d) + 0.5 * Math.pow(Math.max(0, 1 - d), 1.7);
}

function upFacing(pts: number[], closed: boolean, min = 0.6): number[] {
  const out: number[] = [];
  const n = pts.length >> 1;
  for (let i = 0; i < n; i++) {
    const a = i > 0 ? i - 1 : closed ? n - 1 : 0;
    const b = i < n - 1 ? i + 1 : closed ? 0 : n - 1;
    const dx = pts[b * 2] - pts[a * 2];
    const dy = pts[b * 2 + 1] - pts[a * 2 + 1];
    const len = Math.hypot(dx, dy) || 1;
    if (dx / len > min) out.push(pts[i * 2], pts[i * 2 + 1]);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Pieces
// ---------------------------------------------------------------------------

interface Blade {
  x: number;
  y: number;
  h: number;
  lean: number;
  curve: number;
  amp: number;
  period: number;
  phase: number;
  width: number;
  tone: 0 | 1 | 2;
  tip: boolean;
  tw: number;
  kicked: number;
}

interface WallStalk {
  x: number;
  base: number;
  h: number;
  swing: number;
  period: number;
  phase: number;
  lean: number;
  /** Slow kinks along the stipe: amplitude px, waves along it, phase. */
  wig: number;
  wigN: number;
  wigPh: number;
  w0: number;
  /** Blades, WALL_BLADE numbers each: s, side, len, angle, cx, cy, waves, phase. */
  blades: number[];
  kicked: number;
}

const WALL_BLADE = 8;

interface Dot {
  x: number;
  y: number;
  r: number;
  ph: number;
  per: number;
}

interface Built {
  w: number;
  h: number;
  phone: boolean;
  dpr: number;
  sW: number;
  l1: Path2D;
  l1Caps: Path2D;
  l2: Path2D;
  l2Caps: Path2D;
  l2Profile: Profile;
  l3: Path2D;
  l3Caps: Path2D;
  l4: Path2D;
  l4Caps: Path2D;
  arch: Path2D;
  archCaps: Path2D;
  l4Profile: Profile;
  l5: Path2D;
  l5Caps: Path2D;
  l5Profile: Profile;
  l5Face: Path2D;
  l5FaceTop: Path2D;
  l5FaceBounds: { x: number; y: number; w: number; h: number };
  ledge: Path2D;
  ledgeCaps: Path2D;
  ledgeTop: number;
  /** Highest point of each silhouette layer (CSS px), for the size of its cached bitmap. */
  tops: { l1: number; l2: number; l3: number; l4: number; l5: number };
  wall: WallStalk[];
  blades: Blade[];
  dots4: Dot[];
  dots5: Dot[];
  kelp: KelpStalk[];
  kelpKicked: number[];
  fan: SeaFan;
  fanX: number;
  fanY: number;
  fanH: number;
  ruins: Ruins;
  ruinsX0: number;
  ruinsX1: number;
  ruinsY: number;
  ruinsColH: number;
  chestX: number;
  chestY: number;
  chestW: number;
  occ: HTMLCanvasElement;
  occTint: string;
  occFrond: Rect;
  occLip: Rect | null;
  /** L6 coverage 0..1 at a CSS point, so seahorses are never offered a blade behind it. */
  occAlpha: (x: number, y: number) => number;
}

let vignetteCanvas: HTMLCanvasElement | null = null;

/** Spare width the silhouette profiles extend past the screen on each side, px. */
const SILHOUETTE_PAD = 40;

/**
 * The landscape silhouettes (far ridge, shelf, kelp ground, reef and arch, seabed and ledge, with
 * their sediment caps) change only with the light and the window. Once the light has settled each
 * is filled once into a bitmap and blitted after that: one image draw instead of filling a
 * thousand-point path every frame (Safari rasterises such a path anew each time). The blit lands
 * on whole device pixels, so a cached layer sits within half a device pixel of where its path
 * would, with the same edge pixels. While the light descends, the camera shifts for the shop or
 * the pointer parallax moves, the paths are filled directly as before. Set false to always fill.
 */
const CACHE_SILHOUETTES = false;
/** A layer moving faster than this (CSS px per frame) is filled directly: only the slow camera drift is snapped. */
const CACHE_STILL_PX = 0.05;
/** Cached bitmaps stop this far below the screen: no layer is ever shifted up by more. */
const CACHE_BELOW = 64;

interface LayerCache {
  canvas: HTMLCanvasElement | null;
  key: string;
  dx: number;
  dy: number;
  dw: number;
  dh: number;
  sx: number;
  sy: number;
  /** The layer's parallax last frame, to tell drift from motion. */
  lastX: number;
  lastY: number;
}

const newLayerCache = (): LayerCache => ({ canvas: null, key: '', dx: 0, dy: 0, dw: 0, dh: 0, sx: 0, sy: 0, lastX: NaN, lastY: NaN });

const layerOut = { use: false, x: 0, y: 0 };

/**
 * ctx.save() and translate by the layer's parallax, like withPx, and say whether the layer may be
 * drawn from its cache this frame (the light is settled and the layer is still). When it may, the
 * translation is rounded to whole device pixels so the cached bitmap lands exactly. Returns a
 * shared object: read it before the next call.
 */
function beginLayer(ctx: CanvasRenderingContext2D, f: WorldFrame, max: number, cache: LayerCache): typeof layerOut {
  const p = f.parallax(max);
  const L = f.lighting;
  const still = Math.abs(p.x - cache.lastX) <= CACHE_STILL_PX && Math.abs(p.y - cache.lastY) <= CACHE_STILL_PX;
  cache.lastX = p.x;
  cache.lastY = p.y;
  const use = CACHE_SILHOUETTES && still && L.from === L.mode;
  let x = p.x;
  let y = p.y;
  if (use) {
    const m = ctx.getTransform();
    x = Math.round(p.x * m.a) / m.a;
    y = Math.round(p.y * m.d) / m.d;
  }
  ctx.save();
  ctx.translate(x, y);
  layerOut.use = use;
  layerOut.x = x;
  layerOut.y = y;
  return layerOut;
}

/**
 * Paints a silhouette layer whose top is at `top` (CSS px): straight onto ctx when `use` is
 * false, else from the cache, rebuilt when the key, the window or the scale changed.
 */
function drawCached(
  ctx: CanvasRenderingContext2D,
  cache: LayerCache,
  use: boolean,
  key: string,
  bb: Built,
  top: number,
  paint: (g: CanvasRenderingContext2D) => void,
): void {
  if (!use) {
    paint(ctx);
    return;
  }
  const x = -SILHOUETTE_PAD;
  const y = top - 2;
  const w = bb.w + 2 * SILHOUETTE_PAD;
  const h = Math.min(bb.h * 1.12 + 40, bb.h + CACHE_BELOW) - y;
  const m = ctx.getTransform();
  const sx = m.a;
  const sy = m.d;
  const dx = Math.floor(x * sx);
  const dy = Math.floor(y * sy);
  const dw = Math.ceil((x + w) * sx) - dx;
  const dh = Math.ceil((y + h) * sy) - dy;
  let c = cache.canvas;
  if (!c) c = cache.canvas = document.createElement('canvas');
  if (cache.key !== key || cache.dx !== dx || cache.dy !== dy || cache.dw !== dw || cache.dh !== dh || cache.sx !== sx || cache.sy !== sy) {
    if (c.width !== dw) c.width = dw;
    if (c.height !== dh) c.height = dh;
    const g = c.getContext('2d')!;
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.clearRect(0, 0, dw, dh);
    // The same scale as the live context, so the paths rasterise to the same pixels.
    g.setTransform(sx, 0, 0, sy, -dx, -dy);
    g.globalAlpha = 1;
    g.globalCompositeOperation = 'source-over';
    paint(g);
    cache.key = key;
    cache.dx = dx;
    cache.dy = dy;
    cache.dw = dw;
    cache.dh = dh;
    cache.sx = sx;
    cache.sy = sy;
  }
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.drawImage(c, Math.round(m.e) + dx, Math.round(m.f) + dy);
  ctx.setTransform(m);
}

function getVignette(): HTMLCanvasElement {
  if (vignetteCanvas) return vignetteCanvas;
  const S = 128;
  const c = document.createElement('canvas');
  c.width = c.height = S;
  const g = c.getContext('2d')!;
  const img = g.createImageData(S, S);
  const [r, gg, b] = [11, 15, 52];
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      const u = (x + 0.5) / S - 0.5;
      const v = (y + 0.5) / S - 0.5;
      const d = Math.hypot(u, v) / Math.SQRT1_2;
      const a = Math.pow(smooth(0.42, 1, d), 1.3);
      const i = (y * S + x) * 4;
      img.data[i] = r;
      img.data[i + 1] = gg;
      img.data[i + 2] = b;
      img.data[i + 3] = Math.round(a * 255);
    }
  }
  g.putImageData(img, 0, 0);
  vignetteCanvas = c;
  return c;
}

/** Kick envelope: quick rise, then a 2s decay. */
function kickEnv(age: number): number {
  if (age < 0 || age > 2.2) return 0;
  return Math.min(1, age / 0.15) * (1 - smooth(0.15, 2.2, age));
}

const easeOutSine = (x: number) => Math.sin((Math.min(1, Math.max(0, x)) * Math.PI) / 2);

export function createScenery(): Scenery {
  let b: Built | null = null;
  let clock = 0;
  let speed = 1;
  let first = true;
  const owned = new Map<DecorationId, number>();
  const anchors: SeagrassAnchor[] = [];
  const surface = createSurface();
  const water = createWaterCache();
  const dots: DotBatch = newDots();
  let lastKick = -99;
  let chestOpenAt = -99;
  let chestBox: { x: number; y: number; w: number; h: number } | null = null;
  let p5 = { x: 0, y: 0 };
  const caches = {
    ridge: newLayerCache(),
    shelf: newLayerCache(),
    ground: newLayerCache(),
    reef: newLayerCache(),
    sand: newLayerCache(),
    sandCaps: newLayerCache(),
  };

  const has = (id: DecorationId) => owned.has(id);
  const fade = (id: DecorationId) => {
    const s = owned.get(id);
    if (s === undefined) return 0;
    return Math.min(1, Math.max(0, (clock - s) / 0.4));
  };
  const kickMul = (kickedAt: number) => 1 + 0.4 * kickEnv(clock - kickedAt);

  function ensure(f: WorldFrame): Built {
    if (!b || b.w !== f.w || b.h !== f.h) build(f.w, f.h, f.phone, f.dpr);
    return b!;
  }

  function tick(f: WorldFrame) {
    clock = f.t;
    speed = f.lighting.reducedMotion ? 0.5 : 1;
  }

  // -------------------------------------------------------------------------
  // Build (once per resize)
  // -------------------------------------------------------------------------

  function build(w: number, h: number, phone: boolean, dpr: number) {
    const sW = Math.max(w, 0.75 * h);
    const pad = SILHOUETTE_PAD;
    const bottom = h * 1.12 + 40;
    const step = 3;
    const capThick = (name: string) => {
      const n = valueNoise1D(stream(`caps:${name}`), 46);
      return (x: number) => 4.5 + 1.5 * n(x);
    };

    // L1: two seamounts at 22% and 64%; the right one taller with a notch. Pure silhouette.
    const r1 = stream('terrain:l1');
    const n1a = valueNoise1D(r1, 0.35 * sW);
    const n1b = valueNoise1D(r1, 0.08 * sW);
    const j1 = valueNoise1D(r1, 12);
    const l1y = (x: number) => {
      const u = x / w;
      const base = h * (0.528 - 0.045 * u);
      const A = seamount(x, 0.22 * w, 0.2 * sW, 0.13 * sW) * 0.07 * h;
      const nx = 0.64 * w + 0.055 * sW;
      const notch = 0.026 * h * Math.pow(Math.max(0, 1 - Math.abs(x - nx) / (0.016 * sW)), 1.3);
      const shoulder = seamount(x, 0.64 * w + 0.1 * sW, 0.06 * sW, 0.1 * sW) * 0.1 * h;
      const B = Math.max(seamount(x, 0.64 * w, 0.17 * sW, 0.3 * sW) * 0.15 * h, shoulder) - notch;
      return base - Math.max(A, B) - n1a(x) * 0.02 * h - n1b(x) * 0.008 * h - j1(x) * 1.5;
    };
    const p1 = sampleProfile(w, pad, step, l1y);
    const l1 = profileFill(p1, bottom);
    const l1Caps = new Path2D();
    addCaps(l1Caps, profilePts(p1), false, capThick('l1'));

    // L2: a flat shelf from 48% to 92% that carries the ruins.
    const r2 = stream('terrain:l2');
    const n2a = valueNoise1D(r2, 0.35 * sW);
    const n2b = valueNoise1D(r2, 0.08 * sW);
    const j2 = valueNoise1D(r2, 12);
    const shelfTop = h * 0.566;
    const l2y = (x: number) => {
      const u = x / w;
      const base = h * (0.648 - 0.03 * u) - n2a(x) * 0.026 * h - n2b(x) * 0.007 * h - j2(x) * 1.5;
      const top = shelfTop - n2b(x) * 0.002 * h - j2(x) * 1.2;
      const step1 = smooth(0.432, 0.452, u) * 0.45;
      const m = Math.max(step1, smooth(0.462, 0.482, u)) * (1 - smooth(0.918, 0.958, u));
      return base + (top - base) * m;
    };
    const p2 = sampleProfile(w, pad, step, l2y);
    const l2 = profileFill(p2, bottom);
    const l2Caps = new Path2D();
    addCaps(l2Caps, profilePts(p2), false, capThick('l2'));

    // L3: low ground the kelp wall rises from.
    const r3 = stream('terrain:l3');
    const n3a = valueNoise1D(r3, 0.35 * sW);
    const n3b = valueNoise1D(r3, 0.08 * sW);
    const j3 = valueNoise1D(r3, 12);
    const p3 = sampleProfile(w, pad, step, (x) => h * (0.728 - 0.02 * (x / w)) - n3a(x) * 0.02 * h - n3b(x) * 0.006 * h - j3(x) * 1.5);
    const l3 = profileFill(p3, bottom);
    const l3Caps = new Path2D();
    addCaps(l3Caps, profilePts(p3), false, capThick('l3'));

    // L3 kelp wall: one-tone Macrocystis fronds, denser on the left, tops at 55-65%. Sinuous
    // stipes with long wavy blades on short stalks, a float bulb at each blade's base, all
    // streaming with the current and merged into one flat silhouette.
    const rk = stream('kelp');
    const wallN = phone ? 9 : Math.round(10 + 4 * Math.min(1, Math.max(0, (w - 640) / 800)));
    const wall: WallStalk[] = [];
    const ws = Math.min(1.25, Math.max(0.8, sW / 1000));
    for (let i = 0; i < wallN; i++) {
      // Two groves: a dense one on the left, a looser one on the right, open water between.
      const left = i < Math.round(wallN * 0.58);
      const k = left ? i / Math.round(wallN * 0.58) : (i - Math.round(wallN * 0.58)) / (wallN - Math.round(wallN * 0.58));
      const u = left ? -0.03 + 0.4 * (k + range(rk, 0, 0.8) / Math.round(wallN * 0.58)) : 0.64 + 0.4 * (k + range(rk, 0, 0.8) / (wallN - Math.round(wallN * 0.58)));
      const top = h * range(rk, 0.55, 0.65) - (u > 0.55 ? 0.012 * h : 0);
      const base = h * 0.8;
      const sh = base - top;
      const bl: number[] = [];
      let s = range(rk, 0.12, 0.2);
      let side = rk() < 0.5 ? 1 : -1;
      const bk = Math.min(1.15, 150 / Math.max(1, sh));
      while (s < 0.88) {
        const young = smooth(0.62, 0.88, s);
        const up = side < 0 && rk() < 0.35;
        bl.push(
          s,
          side,
          range(rk, 0.2, 0.3) * sh * bk * (1 - 0.4 * young),
          up ? -Math.PI / 2 - range(rk, 0.45, 0.8) : range(rk, -0.25, 0.7) - 0.3 * young,
          up ? range(rk, 0.4, 0.52) : range(rk, 0.08, 0.2),
          up ? range(rk, 0, 0.08) : range(rk, 0.14, 0.3),
          range(rk, 4.5, 6.5),
          rk() * TAU,
        );
        s += range(rk, 0.07, 0.12) * (1 - 0.3 * young);
        side = -side;
      }
      // The growing tip bends over downstream like a sickle.
      bl.push(0.99, 1, range(rk, 0.14, 0.18) * sh * bk, -Math.PI / 2 + range(rk, 0.35, 0.55), range(rk, 0.45, 0.6), range(rk, 0.3, 0.4), 4, rk() * TAU);
      wall.push({
        x: u * w,
        base,
        h: sh,
        swing: range(rk, 6, 10) * ws,
        period: range(rk, 9, 13),
        phase: rk() * TAU,
        lean: range(rk, 0, 0.08),
        wig: range(rk, 0.015, 0.03) * sh,
        wigN: range(rk, 1.4, 2.4),
        wigPh: rk() * TAU,
        w0: range(rk, 2.6, 3.4) * ws,
        blades: bl,
        kicked: -99,
      });
    }

    // L4: reef, boulder cluster at 8-16%, a small natural arch at ~82%.
    const r4 = stream('terrain:l4');
    const n4a = valueNoise1D(r4, 0.35 * sW);
    const n4b = valueNoise1D(r4, 0.08 * sW);
    const j4 = valueNoise1D(r4, 12);
    const boulders: [number, number, number][] = [
      [0.066, 0.036, 0.042],
      [0.1, 0.03, 0.066],
      [0.134, 0.027, 0.048],
      [0.161, 0.018, 0.026],
      [0.04, 0.02, 0.022],
    ];
    const l4base = (x: number) => {
      const u = x / w;
      const basin = 0.01 * h * smooth(0.36, 0.42, u) * (1 - smooth(0.52, 0.6, u));
      return h * (0.752 - 0.03 * u) - n4a(x) * 0.02 * h - n4b(x) * 0.008 * h + basin;
    };
    // Two small outcrops with slanted, broken tops break up the reef line.
    const outcrops: [number, number, number, number][] = [[0.335, 0.045, 0.034, 0.7]];
    const l4y = (x: number) => {
      let dome = 0;
      for (const [cu, cr, ch] of boulders) {
        const dx = (x - cu * w) / (cr * sW);
        if (Math.abs(dx) < 1) dome = Math.max(dome, ch * h * Math.pow(1 - dx * dx, 0.55));
      }
      for (const [cu, cr, ch, slant] of outcrops) {
        const dx = (x - cu * w) / (cr * sW);
        if (Math.abs(dx) < 1) {
          const body = Math.pow(1 - Math.abs(dx), 0.75) * (1 - 0.35 * Math.pow(Math.abs(dx), 0.5) * (dx < 0 ? 1 : 0));
          const crag = n4b(x * 2.3) * 0.006 * h;
          dome = Math.max(dome, ch * h * body * (1 + 0.45 * slant * dx) + crag * body);
        }
      }
      return l4base(x) - dome - j4(x) * 1.5;
    };
    const p4 = sampleProfile(w, pad, step, l4y);
    const l4 = profileFill(p4, bottom);
    const l4Caps = new Path2D();
    addCaps(l4Caps, profilePts(p4), false, capThick('l4'));

    const ax = 0.82 * w;
    const ay = l4base(ax) + 6;
    const aw = 0.12 * sW;
    const ah = 0.105 * h;
    const ra = stream('terrain:arch');
    const jit = () => range(ra, -0.025, 0.025);
    const outerU = [
      -0.74, 0.1, -0.7, -0.18, -0.62, -0.42, -0.5, -0.58, -0.34, -0.68, -0.14, -0.76, 0.06, -0.86, 0.26, -0.96, 0.46, -1, 0.62,
      -0.96, 0.74, -0.88, 0.8, -0.79, 0.79, -0.7, 0.68, -0.64, 0.56, -0.5, 0.52, -0.3, 0.56, -0.1, 0.64, 0.1, 0.4, 0.4, -0.6, 0.4,
    ];
    const outer: number[] = [];
    for (let i = 0; i < outerU.length; i += 2) outer.push(ax + (outerU[i] + jit()) * aw, ay + (outerU[i + 1] + jit()) * ah);
    const outerD = clockwise(spline(outer, true, 6));
    const hole: number[] = [];
    for (let i = 0; i < 9; i++) {
      const a = Math.PI + (i / 8) * Math.PI;
      const lift = 1 + 0.18 * Math.sin(a * 2 + 0.6);
      hole.push(ax + (-0.1 + Math.cos(a) * 0.22) * aw, ay + (0.04 + Math.sin(a) * 0.4 * lift) * ah);
    }
    hole.push(ax + 0.12 * aw, ay + 0.12 * ah, ax - 0.32 * aw, ay + 0.12 * ah);
    const arch = polyPath(outerD);
    polyPath(spline(hole, true, 4), arch);
    const archCaps = new Path2D();
    addCaps(archCaps, outerD, true, capThick('arch'));

    // L5: seabed dune lip rising to the right; a flat rock ledge at 38-52%.
    const r5 = stream('terrain:l5');
    const n5a = valueNoise1D(r5, 0.35 * sW);
    const n5b = valueNoise1D(r5, 0.08 * sW);
    const j5 = valueNoise1D(r5, 12);
    const chestX = 0.78 * w;
    const chestW = phone ? 50 : Math.min(92, Math.max(60, 0.066 * w));
    const pebbles: [number, number, number][] = [
      [0.085, 0.012, 0.007],
      [0.103, 0.007, 0.004],
      [0.6, 0.009, 0.006],
      [0.625, 0.006, 0.0035],
    ];
    const l5base = (x: number) => {
      const u = x / w;
      const dune = 0.074 * Math.pow(smooth(0.55, 0.95, u), 1.15) * (1 - 0.5 * smooth(0.955, 1.07, u));
      return h * (0.872 - dune) - n5a(x) * 0.007 * h - n5b(x) * 0.003 * h;
    };
    // The chest sinks into the dune lip: sand banks up against its low (left) side to a line that
    // follows its 6 degree tilt, so the dune edge crosses its front at an even depth instead of the
    // chest sitting on the slope. With no chest this is just a small terrace in the drift.
    const chestTan = Math.tan(6 * DEG);
    const chestLine0 = l5base(chestX + 0.35 * chestW);
    const chestLine = (x: number) => chestLine0 - (x - chestX - 0.35 * chestW) * chestTan;
    const l5y = (x: number) => {
      let bump = 0;
      for (const [pu, pr, ph] of pebbles) {
        const d = (x - pu * w) / (pr * sW);
        if (Math.abs(d) < 1) bump = Math.max(bump, ph * h * Math.pow(1 - d * d, 0.5));
      }
      const base = l5base(x);
      const dc = Math.abs(x - chestX) / (0.62 * chestW);
      let lift = 0;
      if (dc < 2) {
        const env = 1 - smooth(0.9, 2, dc);
        lift = Math.max(0, base - chestLine(x)) * env + 0.035 * chestW * (1 - smooth(0, 1.6, dc));
      }
      return base - Math.max(bump, lift) - j5(x) * 1;
    };
    const p5p = sampleProfile(w, pad, step, l5y);
    const l5 = profileFill(p5p, bottom);
    const l5Caps = new Path2D();
    addCaps(l5Caps, profilePts(p5p), false, capThick('l5'));
    // Top face bands for the Day caustic dapple (two depths, so it fades down the face).
    const faceDepth = 0.042 * h;
    const faceBand = (depth: number) => {
      const path = new Path2D();
      const pts = profilePts(p5p);
      path.moveTo(pts[0], pts[1]);
      for (let i = 2; i < pts.length; i += 2) path.lineTo(pts[i], pts[i + 1]);
      for (let i = pts.length - 2; i >= 0; i -= 2) path.lineTo(pts[i], pts[i + 1] + depth);
      path.closePath();
      return path;
    };
    const l5Face = faceBand(faceDepth);
    const l5FaceTop = faceBand(faceDepth * 0.45);
    const profileTop = (p: Profile) => {
      let m = Infinity;
      for (const v of p.ys) if (v < m) m = v;
      return m;
    };
    let archTopY = Infinity;
    for (let i = 1; i < outerD.length; i += 2) if (outerD[i] < archTopY) archTopY = outerD[i];
    const minY5 = profileTop(p5p);
    const l5FaceBounds = { x: -pad, y: minY5 - 4, w: w + pad * 2, h: h - minY5 + faceDepth };

    // The bottle shelf (§4.3 L5 landmark): a low, weathered rock ledge rather than a slab. A broken
    // slope up on the left, a nearly level top carrying the same noise and micro-jitter as the
    // terrain, a steeper chipped drop on the right, and a sediment cap along its top only.
    const sandMid = l5y(0.45 * w);
    const ledgeTop = Math.round(sandMid - Math.max(16, 0.028 * h));
    const rl = stream('terrain:ledge');
    const lh = sandMid - ledgeTop;
    const nl = valueNoise1D(rl, 0.05 * sW);
    const jl = valueNoise1D(rl, 12);
    // Shoulders are sized in ledge heights (not screen widths) so they stay steep at any width
    // and the cap runs along the top only.
    const xL = 0.385 * w;
    const xR = 0.516 * w;
    const ledgeRun = spline([
      xL - 0.78 * lh, sandMid + 6,
      xL - 0.52 * lh, ledgeTop + 0.72 * lh,
      xL - 0.3 * lh + range(rl, -1, 1), ledgeTop + 0.34 * lh,
      xL - 0.08 * lh, ledgeTop + 0.07 * lh,
      xL + 0.45 * lh, ledgeTop + 0.5,
      0.45 * w, ledgeTop,
      xR - 0.4 * lh, ledgeTop - 0.3,
      xR, ledgeTop + 0.16 * lh,
      xR + 0.36 * lh + range(rl, -1, 1), ledgeTop + 0.52 * lh,
      xR + 0.75 * lh, sandMid + 6,
    ], false, 6);
    for (let i = 0; i < ledgeRun.length; i += 2) {
      const x = ledgeRun[i];
      // Never more than ~1px off the shelf line on top, so kept bottles still rest on it.
      const top = smooth(xL - 0.1 * lh, xL + 0.5 * lh, x) * (1 - smooth(xR - 0.5 * lh, xR, x));
      ledgeRun[i + 1] += nl(x) * (1.8 - 0.9 * top) + jl(x) * 0.6;
    }
    const ledge = polyPath([...ledgeRun, xR + 0.75 * lh, sandMid + 40, xL - 0.78 * lh, sandMid + 40]);
    let ledgeTopY = Infinity;
    for (let i = 1; i < ledgeRun.length; i += 2) if (ledgeRun[i] < ledgeTopY) ledgeTopY = ledgeRun[i];
    const tops = { l1: profileTop(p1), l2: profileTop(p2), l3: profileTop(p3), l4: Math.min(profileTop(p4), archTopY), l5: Math.min(minY5, ledgeTopY) };
    const ledgeCaps = new Path2D();
    const lcap = valueNoise1D(stream('caps:ledge'), 30);
    // Along the top only: a cap creeping down the shoulders outlines the rock like a bench.
    addCaps(ledgeCaps, ledgeRun, false, (x) =>
      (3.4 + 1.3 * lcap(x)) * smooth(xL - 0.4 * lh, xL + 0.1 * lh, x) * (1 - smooth(xR - 0.15 * lh, xR + 0.3 * lh, x)));

    // Seagrass in clumps along the near flat, rooted just behind the seabed line.
    const rg = stream('seagrass');
    const nBlades = phone ? 28 : 40;
    const clumps = (phone ? [0.215, 0.33, 0.565, 0.69, 0.88, 0.965] : [0.205, 0.315, 0.57, 0.695, 0.875, 0.955]).map(
      (c) => c + range(rg, -0.012, 0.012),
    );
    const weights = clumps.map(() => range(rg, 0.6, 1.4));
    const wsum = weights.reduce((a, v) => a + v, 0);
    const blades: Blade[] = [];
    const bs = Math.min(1.2, Math.max(0.85, h / 850));
    clumps.forEach((c, ci) => {
      const n = Math.max(2, Math.round((weights[ci] / wsum) * nBlades));
      for (let i = 0; i < n && blades.length < nBlades; i++) {
        const x = c * w + range(rg, -1, 1) * range(rg, 0.003, 0.02) * sW;
        const y = Math.max(l5y(x) + range(rg, 1.5, 6), l4y(x) + 6);
        const tone = (rg() < 0.35 ? 0 : rg() < 0.75 ? 1 : 2) as 0 | 1 | 2;
        blades.push({
          x,
          y,
          h: range(rg, 0.055, 0.11) * h * (tone === 0 ? 0.85 : 1) * (phone ? 1 : 1.12),
          lean: range(rg, -0.14, 0.18),
          curve: range(rg, -0.16, 0.2),
          amp: range(rg, 4, 9) * bs,
          period: range(rg, 7, 11),
          phase: rg() * TAU,
          width: range(rg, 3.4, 5) * bs,
          tone,
          tip: false,
          tw: rg() * TAU,
          kicked: -99,
        });
      }
    });
    // One blade in four carries a biolum tip at night.
    blades.forEach((bl, i) => {
      bl.tip = i % 4 === 1;
    });
    blades.sort((a, c) => a.tone - c.tone);

    // Plankton dots along the L4 and L5 tops (night caps).
    const rd = stream('plankton:caps');
    const dots4: Dot[] = [];
    const dots5: Dot[] = [];
    const n4 = Math.round(w / 24);
    for (let i = 0; i < n4; i++) {
      const x = range(rd, 0, w);
      dots4.push({ x, y: l4y(x) + range(rd, 0.5, 4), r: range(rd, 0.8, 1.4), ph: rd() * TAU, per: range(rd, 4, 9) });
    }
    const archTop = upFacing(outerD, true);
    for (let i = 0; i < 6 && archTop.length; i++) {
      const k = Math.floor(rd() * (archTop.length >> 1)) * 2;
      dots4.push({ x: archTop[k], y: archTop[k + 1] + range(rd, 0.5, 3), r: range(rd, 0.8, 1.3), ph: rd() * TAU, per: range(rd, 4, 9) });
    }
    const n5 = Math.round(w / 16);
    for (let i = 0; i < n5; i++) {
      const x = range(rd, 0, w);
      const inLedge = x > 0.39 * w && x < 0.512 * w;
      dots5.push({ x, y: (inLedge ? ledgeTop : l5y(x)) + range(rd, 0.5, 4.5), r: range(rd, 0.8, 1.5), ph: rd() * TAU, per: range(rd, 4, 9) });
    }

    // Swaying kelp decoration: three stalks on L4 at x 10-28%.
    const rkd = stream('kelp-forest');
    const kelp: KelpStalk[] = [];
    const kx = phone ? [0.1, 0.19, 0.275] : [0.125, 0.185, 0.25];
    const kh = phone ? [0.4, 0.34, 0.28] : [0.42, 0.36, 0.3];
    for (let i = 0; i < 3; i++) {
      const x = (kx[i] + range(rkd, -0.01, 0.01)) * w;
      kelp.push(buildKelpStalk(rkd, x, l4base(x) + 8, kh[i] * h * range(rkd, 0.95, 1.05), Math.min(1.15, Math.max(0.8, h / 850)), phone ? 0.7 : 1));
    }

    // Sea fan on L4 at x 62-68%.
    const fan = buildSeaFan(stream('glowing-coral'));
    const fanX = 0.65 * w;
    const fanH = phone ? Math.min(130, 0.14 * h) : Math.min(165, Math.max(110, 0.16 * h));
    const fanY = l4y(fanX) + 4;

    // Ancient ruins on the L2 shelf, x 55-85%.
    const ruinsX0 = 0.55 * w;
    const ruinsX1 = 0.85 * w;
    const ruinsColH = Math.min(0.11 * h, (ruinsX1 - ruinsX0) / RUINS_MIN_ASPECT);
    const ruins = buildRuins(stream('ancient-ruins'), (ruinsX1 - ruinsX0) / ruinsColH);

    // Chest on L5 at x 74-82%, sunk about 35% of its height into the dune lip (drawChest's
    // groundY sits ~0.3 chest widths under the sand line it is drawn behind).
    const chestY = chestLine(chestX) + 0.3 * chestW;

    // L6 occluders: frond mass bottom-left (and a rock lip top-right on desktop), blurred by
    // drawing at 1/8 resolution and upscaling twice.
    const occ = buildOccluders(w, h, phone, dpr, sW);
    // Release the previous cache's backing store now rather than at GC (Safari's canvas budget).
    if (b && b.occ !== occ.canvas) b.occ.width = b.occ.height = 0;

    b = {
      w, h, phone, dpr, sW,
      l1, l1Caps, l2, l2Caps, l2Profile: p2, l3, l3Caps,
      l4, l4Caps, arch, archCaps, l4Profile: p4,
      l5, l5Caps, l5Profile: p5p, l5Face, l5FaceTop, l5FaceBounds, ledge, ledgeCaps, ledgeTop, tops,
      wall, blades, dots4, dots5, kelp, kelpKicked: kelp.map(() => -99),
      fan, fanX, fanY, fanH, ruins, ruinsX0, ruinsX1, ruinsY: shelfTop + 1, ruinsColH,
      chestX, chestY, chestW, occ: occ.canvas, occTint: '', occFrond: occ.frond, occLip: occ.lip, occAlpha: occ.alphaAt,
    };
    rebuildAnchors();
  }

  function rebuildAnchors() {
    anchors.length = 0;
    if (!b) return;
    const bb = b;
    for (const bl of bb.blades) {
      if (bl.y < bb.h * 0.75 || bl.h < bb.h * 0.05) continue;
      if (underOccluder(bb, bl)) continue;
      anchors.push({
        x: bl.x,
        y: bl.y,
        height: bl.h,
        swayAt: (along, t) => bladeSway(bl, along, t * speed),
      });
    }
    if (has('glowing-coral')) {
      const hd = bb.fan.holds;
      const H0 = bb.fanH;
      for (let i = 0; i < hd.length; i += 4) {
        const x0 = bb.fanX + hd[i] * H0;
        const y0 = bb.fanY + hd[i + 1] * H0;
        const len = (hd[i + 1] - hd[i + 3]) * H0;
        const run = (hd[i + 2] - hd[i]) * H0;
        const yBase = hd[i + 1] * H0;
        anchors.push({
          x: x0,
          y: y0,
          height: len,
          seaFan: true,
          swayAt: (along, t) => run * along + fanSkew(t * speed, 0.7, kickMul(fanKicked)) * (yBase - along * len),
        });
      }
    }
  }

  let fanKicked = -99;

  /**
   * True when a seahorse holding this blade could sit behind the L6 fronds: samples the blade's
   * resting curve with a body's width either side, plus room for the occluder's larger parallax
   * and the shop's camera shift.
   */
  function underOccluder(bb: Built, bl: Blade): boolean {
    const mx = 26;
    const my = 30;
    for (let i = 0; i <= 6; i++) {
      const a = i / 6;
      const x = bl.x + bl.lean * bl.h * a + bl.curve * bl.h * a * a;
      const y = bl.y - bl.h * a;
      for (const dx of [-mx, -mx / 2, 0, mx / 2, mx]) {
        for (const dy of [-my, -my / 2, 0, 8]) {
          if (bb.occAlpha(x + dx, y + dy) > 0.05) return true;
        }
      }
    }
    return false;
  }

  function bladeSway(bl: Blade, along: number, ta: number): number {
    const mul = kickMul(bl.kicked);
    const dyn = bl.amp * mul * Math.pow(along, 1.6) * Math.sin((TAU * ta) / bl.period + bl.phase - 1.1 * along);
    return dyn + bl.lean * bl.h * along + bl.curve * bl.h * along * along;
  }

  // -------------------------------------------------------------------------
  // Drawing helpers
  // -------------------------------------------------------------------------

  /**
   * Her painted background replaces the water and the far ridges, shelf and kelp wall; the
   * reef, seagrass and seabed (where the seahorses and her letters live) stay in front of it.
   * A painting per light wins; a single background.png is darkened for sunset and midnight.
   */
  const backdropFor = (mode: LightingMode) => art(`background-${mode}`) ?? art('background');
  const hasBackdrop = () => !!(backdropFor('day') || backdropFor('sunset') || backdropFor('midnight'));
  const drawBackdrop = (ctx: CanvasRenderingContext2D, f: WorldFrame) => {
    const L = f.lighting;
    withPx(ctx, f, PX.l1);
    const paint = (mode: LightingMode, alpha: number) => {
      const own = art(`background-${mode}`);
      const pic = own ?? art('background');
      if (!pic || alpha <= 0) return;
      // Cover the screen, with room for the parallax to move it.
      const k = Math.max((f.w + 2 * BACKDROP_PAD) / pic.w, (f.h + 2 * BACKDROP_PAD) / pic.h);
      const dw = pic.w * k;
      const dh = pic.h * k;
      const src = own ? pic.canvas : tinted(pic, C.nightFloor, BACKDROP_DARKEN[mode]);
      ctx.globalAlpha = alpha;
      ctx.drawImage(src, (f.w - dw) / 2, (f.h - dh) / 2, dw, dh);
      ctx.globalAlpha = 1;
    };
    const k = L.progressAt(0.5);
    if (L.from !== L.mode && k < 1) {
      paint(L.from, 1);
      paint(L.mode, k);
    } else paint(L.mode, 1);
    ctx.restore();
  };

  const withPx = (ctx: CanvasRenderingContext2D, f: WorldFrame, max: number) => {
    const p = f.parallax(max);
    ctx.save();
    ctx.translate(p.x, p.y);
    return p;
  };

  /**
   * Sediment caps: alpha = ridgeCapAlpha x (1 - fog) by day. At night they are the moonlit rims
   * that carry the layering of an otherwise flat indigo stack, so fog thins them far less
   * (far ridge ~.13, shelf ~.15, kelp ground ~.16 at Midnight, still dimming with distance).
   */
  const fillCaps = (ctx: CanvasRenderingContext2D, L: Lighting, path: Path2D, y: number, fog: number, extra = 1) => {
    const night = nightAt(L, y);
    const a = L.num('ridgeCapAlpha', y) * (1 - fog * (1 - NIGHT_RIM_RELIEF * night)) * extra;
    if (a <= 0.003) return;
    ctx.globalAlpha = a;
    ctx.fillStyle = L.color('ridgeCap', y);
    ctx.fill(path);
    ctx.globalAlpha = 1;
  };

  const plankton = (f: WorldFrame, list: Dot[], ta: number) => {
    const L = f.lighting;
    const h = f.h;
    for (const d of list) {
      const lit = L.biolum(d.y / h);
      if (lit <= 0.01) continue;
      const tw = 0.62 + 0.38 * Math.sin((TAU * ta) / d.per + d.ph);
      pushDot(dots, C.biolum, d.x, d.y, d.r * 4.2, 0.45 * lit * tw);
      pushDot(dots, C.biolumCore, d.x, d.y, d.r * 1.6, 0.5 * lit * tw);
    }
  };

  // -------------------------------------------------------------------------
  // Scenery
  // -------------------------------------------------------------------------

  return {
    anchors,

    resize(w, h, phone, dpr) {
      build(w, h, phone, dpr);
      water.resize(w, h, dpr);
      surface.resize(w, h, phone);
    },

    setDecorations(ids) {
      const next = new Set(ids.filter((id): id is DecorationId =>
        id === 'kelp-forest' || id === 'glowing-coral' || id === 'treasure-chest' || id === 'ancient-ruins'));
      for (const id of [...owned.keys()]) if (!next.has(id)) owned.delete(id);
      for (const id of next) if (!owned.has(id)) owned.set(id, first ? -1e9 : clock);
      first = false;
      rebuildAnchors();
    },

    drawWater(ctx, f) {
      tick(f);
      ensure(f);
      if (backdropFor('day') || backdropFor('sunset') || backdropFor('midnight')) drawBackdrop(ctx, f);
      else water.draw(ctx, f);
    },

    drawSurface(ctx, f) {
      tick(f);
      ensure(f);
      const boost = kickEnv(clock - lastKick) > 0 ? 1 - smooth(0.2, 2.2, clock - lastKick) : 0;
      surface.draw(ctx, f, boost, f.t * speed);
    },

    drawRidge(ctx, f) {
      if (hasBackdrop()) return;
      const bb = ensure(f);
      const L = f.lighting;
      const use = beginLayer(ctx, f, PX.l1, caches.ridge).use;
      drawCached(ctx, caches.ridge, use, L.mode, bb, bb.tops.l1, (g) => {
        g.fillStyle = L.color('l1', H.l1);
        g.fill(bb.l1);
        fillCaps(g, L, bb.l1Caps, H.l1, layerFog.l1);
      });
      ctx.restore();
    },

    drawShelf(ctx, f) {
      const bb = ensure(f);
      const L = f.lighting;
      const use = beginLayer(ctx, f, PX.l2, caches.shelf).use;
      const stone = L.color('l2', H.l2);
      if (!hasBackdrop()) {
        drawCached(ctx, caches.shelf, use, L.mode, bb, bb.tops.l2, (g) => {
          g.fillStyle = stone;
          g.fill(bb.l2);
          fillCaps(g, L, bb.l2Caps, H.l2, layerFog.l2);
        });
      }
      const a = fade('ancient-ruins');
      if (a > 0) {
        ctx.globalAlpha = a;
        const night = nightAt(L, H.l2);
        const ruinsPic = art('ruins');
        if (ruinsPic) {
          // Her ruins, standing across the same span of the shelf.
          const tint = sceneTint(L, H.l2, layerFog.l2);
          ctx.save();
          ctx.translate((bb.ruinsX0 + bb.ruinsX1) / 2, bb.ruinsY);
          drawArt(ctx, tinted(ruinsPic, tint.color, tint.amount), ruinsPic, bb.ruinsX1 - bb.ruinsX0, 0.5, 1);
          ctx.restore();
        } else drawRuins(ctx, bb.ruins, bb.ruinsX0, bb.ruinsX1, bb.ruinsY, bb.ruinsColH, {
          stone,
          lit: mixOK(stone, L.color('ridgeCap', H.l2), 0.1 * (1 - night)),
          cap: L.color('ridgeCap', H.l2),
          capAlpha: L.num('ridgeCapAlpha', H.l2) * (1 - layerFog.l2 * (1 - NIGHT_RIM_RELIEF * night)),
        }, { outline: null, lw: f.lineWidth });
        ctx.globalAlpha = 1;
      }
      ctx.restore();
    },

    drawKelpWall(ctx, f) {
      const bb = ensure(f);
      tick(f);
      if (hasBackdrop()) return;
      const L = f.lighting;
      const ta = f.t * speed;
      const use = beginLayer(ctx, f, PX.l3, caches.ground).use;
      const col = L.color('l3', H.l3);
      drawCached(ctx, caches.ground, use, L.mode, bb, bb.tops.l3, (g) => {
        g.fillStyle = col;
        g.fill(bb.l3);
        fillCaps(g, L, bb.l3Caps, H.l3, layerFog.l3);
      });
      // The kelp wall: each frond and its blades merged into one silhouette, built on the
      // context's own path (a fresh Path2D a frame is garbage the collector has to chase).
      ctx.beginPath();
      const path = ctx;
      const N = 14;
      const xs = wallXs;
      const ys = wallYs;
      for (const st of bb.wall) {
        const mul = kickMul(st.kicked);
        const ph = (TAU * ta) / st.period + st.phase;
        for (let i = 0; i < N; i++) {
          const s = i / (N - 1);
          xs[i] = st.x + st.swing * mul * Math.pow(s, 1.4) * Math.sin(ph - 2 * s) + st.lean * st.h * s +
            st.wig * Math.sin(s * Math.PI * st.wigN + st.wigPh) * Math.min(1, s * 3);
          ys[i] = st.base - st.h * s;
        }
        ribbon(path, xs, ys, N, st.w0, st.w0 * 0.5, false);
        const flow = Math.sin(ph - 1.2);
        const bw = st.w0 * 0.55;
        for (let k = 0; k < st.blades.length; k += WALL_BLADE) {
          const bl = st.blades;
          const s = bl[k];
          const fi = Math.min(N - 1.001, s * (N - 1));
          const i0 = Math.floor(fi);
          const fr = fi - i0;
          const sx = xs[i0] + (xs[i0 + 1] - xs[i0]) * fr;
          const sy = ys[i0] + (ys[i0 + 1] - ys[i0]) * fr;
          const tan = Math.atan2(ys[i0 + 1] - ys[i0], xs[i0 + 1] - xs[i0]);
          const a = bl[k + 3] + 0.5 * (tan + Math.PI / 2) + 0.1 * mul * Math.sin(ph - 2 * s - 0.7 + bl[k + 7] * 0.3);
          const ax = Math.cos(a);
          const ay = Math.sin(a);
          const nx = -Math.sin(tan) * bl[k + 1];
          const ny = Math.cos(tan) * bl[k + 1];
          // Short stalk, then the float bulb at the blade's base.
          const bx = sx + (nx * 0.5 + ax * 0.8) * 2.6 * bw;
          const by = sy + (ny * 0.5 + ay * 0.8) * 2.6 * bw;
          wallSeg(path, sx, sy, bx, by, bw * 0.45);
          // Same winding as the blades and stipes, so overlaps never cancel under nonzero fill.
          path.moveTo(bx + bw * 1.15, by);
          path.arc(bx, by, bw * 1.15, 0, -TAU, true);
          kelpBladeEdges(bx + ax * bw, by + ay * bw, a, bl[k + 2], 0.16, bl[k + 4] * (1 + 0.3 * flow * mul), bl[k + 5], bl[k + 6], bl[k + 7] + ta * 0.9, 0.03, 0.3, wallTop, wallBot, 8);
          wallLeaf(path, wallTop, wallBot);
        }
      }
      ctx.fillStyle = col;
      ctx.fill();
      ctx.restore();
    },

    drawReef(ctx, f) {
      const bb = ensure(f);
      tick(f);
      const L = f.lighting;
      const ta = f.t * speed;
      const h = f.h;
      const night4 = nightAt(L, H.l4);
      const use = beginLayer(ctx, f, PX.l4, caches.reef).use;

      // Swaying kelp grows from behind the boulders.
      const ka = fade('kelp-forest');
      if (ka > 0) {
        ctx.globalAlpha = ka;
        const ink: Ink = { outline: null, lw: f.lineWidth };
        const kelpPic = art('kelp');
        bb.kelp.forEach((k, i) => {
          const ym = k.y - k.h * 0.5;
          if (kelpPic) {
            // Her kelp, standing on the stalk's root and bending with its sway; every other one mirrored.
            const tint = sceneTint(L, ym / h, layerFog.l4);
            const mul = kickMul(bb.kelpKicked[i]);
            drawSwaying(ctx, tinted(kelpPic, tint.color, tint.amount), kelpPic, k.x, k.y, k.h, (s) => kelpSway(k, s, ta, mul), i % 2 === 1);
            return;
          }
          const wtr = L.waterAt(ym / h);
          drawKelpStalk(ctx, k, ta, kickMul(bb.kelpKicked[i]), {
            blade: mixOK(L.color('kelpBlade', H.l4), wtr, layerFog.l4),
            edge: mixOK(L.color('kelpEdge', H.l4), wtr, layerFog.l4),
            lantern: (y) => L.biolum(y / h) * ka,
            lanternColor: C.lantern,
          }, ink, dots);
        });
        ctx.globalAlpha = 1;
      }

      const rock = L.color('l4', H.l4);
      drawCached(ctx, caches.reef, use, L.mode, bb, bb.tops.l4, (g) => {
        g.fillStyle = rock;
        g.fill(bb.l4);
        fillCaps(g, L, bb.l4Caps, H.l4, layerFog.l4, 1 - night4);
        g.fillStyle = rock;
        g.fill(bb.arch, 'evenodd');
        fillCaps(g, L, bb.archCaps, H.l4, layerFog.l4, 1 - night4);
      });

      // Sea fan.
      const fa = fade('glowing-coral');
      if (fa > 0) {
        ctx.globalAlpha = fa;
        const wtr = L.waterAt((bb.fanY - bb.fanH * 0.5) / h);
        const coralPic = art('coral');
        if (coralPic) {
          const tint = sceneTint(L, (bb.fanY - bb.fanH * 0.5) / h, layerFog.l4);
          const sk = fanSkew(ta, 0.7, kickMul(fanKicked)) * bb.fanH;
          drawSwaying(ctx, tinted(coralPic, tint.color, tint.amount), coralPic, bb.fanX, bb.fanY, bb.fanH, (s) => sk * s);
        } else drawSeaFan(ctx, bb.fan, bb.fanX, bb.fanY, bb.fanH, fanSkew(ta, 0.7, kickMul(fanKicked)), f.lineWidth, {
          branch: mixOK(L.color('seaFanBranch', H.l4), wtr, layerFog.l4),
          polyp: mixOK(L.color('seaFanPolyp', H.l4), wtr, layerFog.l4 * (1 - L.biolum(H.l4))),
          lantern: (y) => L.biolum(y / h) * fa,
        }, { outline: null, lw: f.lineWidth }, dots, ta);
        ctx.globalAlpha = 1;
      }

      // Seagrass: 5-point blades in three tones, tips lit at night. The blades are sorted by
      // tone, so each tone is one fill on the context path; the points are kept for the tips.
      const sg = L.color('seagrass', H.l4);
      const tones = [mixOK(sg, rock, 0.42), sg, adjustOK(sg, 0.025)];
      let anyTip = false;
      const nb = bb.blades.length;
      if (bladePts.length < nb * 10) bladePts = new Float32Array(nb * 10);
      const pts = bladePts;
      let tone = -1;
      for (let bi = 0; bi < nb; bi++) {
        const bl = bb.blades[bi];
        const o = bi * 10;
        for (let i = 0; i < 5; i++) {
          const a = i / 4;
          pts[o + i * 2] = bl.x + bladeSway(bl, a, ta);
          pts[o + i * 2 + 1] = bl.y - bl.h * a * (1 - 0.04 * a);
        }
        if (bl.tone !== tone) {
          if (tone >= 0) ctx.fill();
          tone = bl.tone;
          ctx.fillStyle = tones[tone];
          ctx.beginPath();
        }
        bladeRibbon(ctx, pts, o, bl.width, 0, 1);
        if (bl.tip && L.biolum(bl.y / h) > 0.01) anyTip = true;
      }
      if (tone >= 0) ctx.fill();
      if (anyTip) {
        for (const bl of bb.blades) {
          if (!bl.tip) continue;
          const lit = L.biolum((bl.y - bl.h) / h);
          if (lit <= 0.01) continue;
          const tw = 0.7 + 0.3 * Math.sin(ta * 0.9 + bl.tw);
          const tx = bl.x + bladeSway(bl, 1, ta);
          const ty = bl.y - bl.h * 0.96;
          pushDot(dots, C.biolum, tx, ty, 9, 0.38 * lit * tw);
          pushDot(dots, C.biolumCore, tx, ty, 3, 0.4 * lit * tw);
        }
        ctx.beginPath();
        for (let bi = 0; bi < nb; bi++) {
          const bl = bb.blades[bi];
          if (bl.tip && L.biolum(bl.y / h) > 0.01) bladeRibbon(ctx, pts, bi * 10, bl.width, 0.84, 1);
        }
        ctx.globalAlpha = Math.min(1, 0.5 * L.biolum(0.8));
        ctx.fillStyle = C.biolum;
        ctx.fill();
        ctx.globalAlpha = 1;
      }
      plankton(f, bb.dots4, ta);
      flushDots(ctx, dots);
      ctx.restore();
    },

    drawSeabed(ctx, f) {
      const bb = ensure(f);
      tick(f);
      const L = f.lighting;
      const ta = f.t * speed;
      const night5 = nightAt(L, H.l5);
      const lo = beginLayer(ctx, f, PX.l5, caches.sand);
      const use = lo.use;
      p5 = { x: lo.x, y: lo.y };
      const sand = L.color('l5', H.l5);
      // The chest sits behind the seabed silhouette, so the drift of sand half-buries it.
      const cha = fade('treasure-chest');
      if (cha > 0) {
        ctx.globalAlpha = cha;
        const age = clock - chestOpenAt;
        let lid = 12;
        if (age >= 0 && age < 0.6) lid = 12 + 18 * easeEnter(age / 0.6);
        else if (age >= 0.6 && age < 3.1) lid = 30;
        else if (age >= 3.1 && age < 4.0) lid = 30 - (18 * (1 - Math.cos(Math.PI * Math.min(1, (age - 3.1) / 0.9)))) / 2;
        const wtr = L.waterAt(bb.chestY / f.h);
        const lit = L.biolum(H.l5) * cha;
        const chestPic = art('chest');
        if (chestPic) {
          // Her chest, sunk a quarter into the sand (the seabed is drawn over its foot). A tap
          // lifts it in a small hop instead of opening the lid.
          const tint = sceneTint(L, bb.chestY / f.h, CHEST_FOG);
          const cw = bb.chestW * CHEST_PICTURE_W;
          const chH = (cw * chestPic.h) / chestPic.w;
          const hop = ((lid - 12) / 18) * chH * 0.08;
          const base = bb.chestY + chH * CHEST_PICTURE_SINK - hop;
          ctx.save();
          ctx.translate(bb.chestX, base);
          drawArt(ctx, tinted(chestPic, tint.color, tint.amount), chestPic, cw, 0.5, 1);
          ctx.restore();
          chestBox = { x: bb.chestX - cw / 2, y: base - chH, w: cw, h: chH };
        } else chestBox = drawChest(ctx, bb.chestX, bb.chestY, bb.chestW, lid, {
          body: mixOK(L.color('chestBody', H.l5), wtr, CHEST_FOG),
          band: mixOK(L.color('chestBand', H.l5), wtr, CHEST_FOG),
          sand,
          cap: L.color('ridgeCap', H.l5),
          capAlpha: L.num('ridgeCapAlpha', H.l5) * (1 - layerFog.l5) * (1 - night5),
          lanternColor: C.lantern,
          leak: lit * (1 + 0.25 * easeOutSine(lid > 12 ? (lid - 12) / 18 : 0)),
          silhouette: night5,
        }, { outline: null, lw: f.lineWidth }, dots, false, 0.08);
        ctx.globalAlpha = 1;
      } else chestBox = null;
      // The bottle ledge: weathered reef rock, its foot buried by the seabed drawn over it. At
      // night its rim stays faintly lit (the shelf is where her letters rest). The caustics
      // play between the sand and its caps, so those are two cached pieces.
      drawCached(ctx, caches.sand, use, L.mode, bb, bb.tops.l5, (g) => {
        g.fillStyle = mixOK(sand, L.color('l4', H.l5), 0.42);
        g.fill(bb.ledge);
        fillCaps(g, L, bb.ledgeCaps, H.l5, layerFog.l5, 1 - night5 * 0.65);
        g.fillStyle = sand;
        g.fill(bb.l5);
      });
      const ca = L.num('causticSeabedAlpha', H.l5);
      if (ca > 0.002 && f.quality > 0.7) {
        const tint = causticTintAt(L, H.l5);
        drawCaustics(ctx, bb.l5Face, bb.l5FaceBounds, ta, tint, ca * 0.55, 1.25, 0.42);
        drawCaustics(ctx, bb.l5FaceTop, bb.l5FaceBounds, ta, tint, ca * 0.45, 1.25, 0.42);
      }
      drawCached(ctx, caches.sandCaps, use, L.mode, bb, bb.tops.l5, (g) => fillCaps(g, L, bb.l5Caps, H.l5, layerFog.l5, 1 - night5));
      plankton(f, bb.dots5, ta);
      flushDots(ctx, dots);
      ctx.restore();
    },

    drawOccluders(ctx, f) {
      const bb = ensure(f);
      if (bb.phone) return;
      const L = f.lighting;
      const col = L.color('l6', H.l6);
      if (bb.occTint !== col) {
        const g = bb.occ.getContext('2d')!;
        g.globalCompositeOperation = 'source-in';
        g.fillStyle = col;
        g.fillRect(0, 0, bb.occ.width, bb.occ.height);
        g.globalCompositeOperation = 'source-over';
        bb.occTint = col;
      }
      const p = f.parallax(PX.l6);
      const ta = f.t * speed;
      const oc = bb.occ;
      const sx = oc.width / (f.w + OCC_PAD.x * 2);
      const sy = oc.height / (f.h * (1 + OCC_PAD.bottom) + OCC_PAD.top);
      const blit = (r: Rect) =>
        ctx.drawImage(oc, (r.x + OCC_PAD.x) * sx, (r.y + OCC_PAD.top) * sy, r.w * sx, r.h * sy, r.x, r.y, r.w, r.h);
      ctx.save();
      // The blur is baked in, so plain bilinear upscaling is enough (and cheap).
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = 'low';
      ctx.translate(p.x, p.y);
      // Frond mass: a slow sway, hinged at the bottom of the screen.
      const k = 0.018 * Math.sin((TAU * ta) / 13.7 + 0.8) + 0.008 * Math.sin((TAU * ta) / 9.1);
      ctx.save();
      ctx.transform(1, 0, k, 1, -k * f.h, 0);
      blit(bb.occFrond);
      ctx.restore();
      if (!bb.phone && bb.occLip) blit(bb.occLip);
      ctx.restore();
    },

    drawVignette(ctx, f) {
      const a = f.lighting.num('vignette', 0.5);
      if (a <= 0.002) return;
      ctx.save();
      ctx.globalAlpha = a;
      ctx.imageSmoothingEnabled = true;
      ctx.drawImage(getVignette(), -2, -2, f.w + 4, f.h + 4);
      ctx.restore();
    },

    shelf() {
      if (!b) return { x: 0, y: 0, w: 0 };
      return { x: 0.39 * b.w, y: b.ledgeTop, w: 0.122 * b.w };
    },

    seabedY(x) {
      if (!b) return 0;
      if (x >= 0.39 * b.w && x <= 0.512 * b.w) return b.ledgeTop;
      return yAt(b.l5Profile, x);
    },

    chestHit(x, y) {
      if (!chestBox || !has('treasure-chest')) return false;
      const bx = chestBox.x + p5.x;
      const by = chestBox.y + p5.y;
      const cx = bx + chestBox.w / 2;
      const cy = by + chestBox.h / 2;
      const hw = Math.max(22, chestBox.w / 2 + 6);
      const hh = Math.max(22, chestBox.h / 2 + 6);
      return Math.abs(x - cx) <= hw && Math.abs(y - cy) <= hh;
    },

    openChest() {
      const age = clock - chestOpenAt;
      if (age >= 0 && age < 0.6) return;
      chestOpenAt = age >= 0.6 && age < 3.1 ? clock - 0.6 : clock;
    },

    kick(x, y, radius) {
      if (!b) return;
      lastKick = clock;
      const r2 = radius * radius;
      const near = (px: number, py: number, kicked: number) =>
        clock - kicked > 2 && (px - x) ** 2 + (py - y) ** 2 <= r2;
      for (const bl of b.blades) if (near(bl.x, bl.y - bl.h * 0.5, bl.kicked)) bl.kicked = clock;
      for (const st of b.wall) if (near(st.x, st.base - st.h * 0.7, st.kicked)) st.kicked = clock;
      b.kelp.forEach((k, i) => {
        if (near(k.x, k.y - k.h * 0.5, b!.kelpKicked[i])) b!.kelpKicked[i] = clock;
      });
      if (near(b.fanX, b.fanY - b.fanH * 0.5, fanKicked)) fanKicked = clock;
    },
  };
}

const wallXs = new Float32Array(14);
const wallYs = new Float32Array(14);
const wallTop: number[] = [];
const wallBot: number[] = [];

/**
 * Appends a closed blade outline from its two edges (base to tip). These silhouettes are only
 * ever filled, so each subpath is closed with an explicit line back to its start: a fill closes
 * every subpath anyway, and closePath() costs Chrome time in proportion to the subpath's length.
 */
function wallLeaf(path: Path2D | CanvasRenderingContext2D, top: number[], bot: number[]): void {
  path.moveTo(top[0], top[1]);
  for (let i = 2; i < top.length; i += 2) path.lineTo(top[i], top[i + 1]);
  for (let i = bot.length - 2; i >= 0; i -= 2) path.lineTo(bot[i], bot[i + 1]);
  path.lineTo(top[0], top[1]);
}

/** Appends a thin straight quad from (x0, y0) to (x1, y1), half width hw (fill only, see wallLeaf). */
function wallSeg(path: Path2D | CanvasRenderingContext2D, x0: number, y0: number, x1: number, y1: number, hw: number): void {
  const dx = x1 - x0;
  const dy = y1 - y0;
  const l = Math.hypot(dx, dy) || 1;
  const px = (-dy / l) * hw;
  const py = (dx / l) * hw;
  path.moveTo(x0 + px, y0 + py);
  path.lineTo(x1 + px, y1 + py);
  path.lineTo(x1 - px, y1 - py);
  path.lineTo(x0 - px, y0 - py);
  path.lineTo(x0 + px, y0 + py);
}

const ribL = new Float32Array(18);
const ribR = new Float32Array(18);
/** This frame's seagrass points, 5 (x, y) pairs per blade; grown to fit on the first draw. */
let bladePts = new Float32Array(0);

/**
 * Appends a tapered ribbon through the 5 points at `o` in pts (from fraction a0 to a1 of its
 * length). Allocation-free, fill only.
 */
function bladeRibbon(path: Path2D | CanvasRenderingContext2D, pts: Float32Array, o: number, width: number, a0: number, a1: number): void {
  const n = 5;
  const L = ribL;
  const R = ribR;
  const steps = 8;
  for (let s = 0; s <= steps; s++) {
    const a = a0 + ((a1 - a0) * s) / steps;
    const f = a * (n - 1);
    const i = Math.min(n - 2, Math.floor(f));
    const fr = f - i;
    // Quadratic smoothing between neighbours.
    const x = pts[o + i * 2] + (pts[o + i * 2 + 2] - pts[o + i * 2]) * fr;
    const y = pts[o + i * 2 + 1] + (pts[o + i * 2 + 3] - pts[o + i * 2 + 1]) * fr;
    const dx = pts[o + i * 2 + 2] - pts[o + i * 2];
    const dy = pts[o + i * 2 + 3] - pts[o + i * 2 + 1];
    const l = Math.hypot(dx, dy) || 1;
    const hw = (width / 2) * Math.pow(1 - a, 0.7) + 0.15;
    L[s * 2] = x - (dy / l) * hw;
    L[s * 2 + 1] = y + (dx / l) * hw;
    R[s * 2] = x + (dy / l) * hw;
    R[s * 2 + 1] = y - (dx / l) * hw;
  }
  path.moveTo(L[0], L[1]);
  for (let i = 2; i < L.length; i += 2) path.lineTo(L[i], L[i + 1]);
  for (let i = R.length - 2; i >= 0; i -= 2) path.lineTo(R[i], R[i + 1]);
  path.lineTo(L[0], L[1]);
}

// ---------------------------------------------------------------------------
// Occluders
// ---------------------------------------------------------------------------

interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Margin the occluder cache covers beyond the screen, so parallax and the shop shift never show its edge. */
const OCC_PAD = { x: 24, top: 24, bottom: 0.1 };

/**
 * L6: two or three out-of-focus giant kelp fronds rising from the bottom-left corner, close to the
 * camera: a stipe, a few long wavy blades streaming with the current, a float bulb at each blade's
 * base. Drawn once at 1/8 resolution, blurred and upscaled to 1/4 (no ctx.filter); the alpha
 * stays a little under 1 so the mass reads soft rather than as a dark smudge.
 */
function buildOccluders(w: number, h: number, phone: boolean, dpr: number, sW: number): { canvas: HTMLCanvasElement; frond: Rect; lip: Rect | null; alphaAt: (x: number, y: number) => number } {
  if (phone) {
    // No frond on a phone (see below): keep only a token cache.
    const c = document.createElement('canvas');
    c.width = c.height = 2;
    return { canvas: c, frond: { x: 0, y: 0, w: 0, h: 0 }, lip: null, alphaAt: () => 0 };
  }
  const cw = w + OCC_PAD.x * 2;
  const ch = h * (1 + OCC_PAD.bottom) + OCC_PAD.top;
  const lo = document.createElement('canvas');
  lo.width = Math.max(2, Math.ceil((cw * dpr) / 8));
  lo.height = Math.max(2, Math.ceil((ch * dpr) / 8));
  const g = lo.getContext('2d')!;
  g.setTransform(lo.width / cw, 0, 0, lo.height / ch, (OCC_PAD.x * lo.width) / cw, (OCC_PAD.top * lo.height) / ch);
  g.fillStyle = '#ffffff';
  const r = stream('occluders');
  const reach = Math.min(0.13 * w, 0.17 * sW);
  const scale = Math.min(1.2, Math.max(0.8, h / 800));
  let minX = 0;
  let maxX = 0;
  let minY = h;
  const note = (pts: number[]) => {
    for (let i = 0; i < pts.length; i += 2) {
      maxX = Math.max(maxX, pts[i]);
      minY = Math.min(minY, pts[i + 1]);
    }
  };
  const top: number[] = [];
  const bot: number[] = [];
  const N = 12;
  const xs = new Float32Array(N);
  const ys = new Float32Array(N);
  // Fronds back to front: stipe base x and tip x (fractions of `reach`), tip y (fraction of h),
  // stipe width, then blades as [s along the stipe, angle, length (fraction of h), current, sag].
  // The stipes stand mostly past the left edge; their blades sweep in against the lighter
  // water and reef, where a near silhouette actually reads as depth. A phone is too narrow for
  // it: the mass either covers the seagrass the seahorses hold or, tucked into the corner under
  // the seabed line, loses its shape and reads as a smudge; so phones get none (the vignette
  // still darkens the corners), and on desktop no seahorse is offered a blade behind it.
  type FrondSpec = [number, number, number, number, number[][]];
  const fronds: FrondSpec[] = [
    [-0.35, 0.02, 0.66, 9, [[0.62, -0.5, 0.15, 0.12, 0.16], [0.82, -Math.PI / 2 - 0.35, 0.11, 0.38, 0.06], [0.99, -Math.PI / 2 + 0.45, 0.12, 0.36, 0.26]]],
    [-0.15, 0.3, 0.76, 10, [[0.55, -0.1, 0.16, 0.12, 0.2], [0.8, -0.65, 0.15, 0.14, 0.12], [0.99, -Math.PI / 2 + 0.55, 0.12, 0.4, 0.3]]],
  ];
  for (const [bu, tu, ty, sw, blades] of fronds) {
    const bx = bu * reach;
    const by = h * 1.06;
    const tx = tu * reach * range(r, 0.92, 1.04);
    const tyy = h * (ty + range(r, -0.015, 0.015));
    const bow = range(r, -0.08, 0.04) * (by - tyy);
    for (let i = 0; i < N; i++) {
      const q = i / (N - 1);
      xs[i] = bx + (tx - bx) * Math.pow(q, 1.3) + bow * 4 * q * (1 - q);
      ys[i] = by + (tyy - by) * q;
    }
    g.globalAlpha = 0.86;
    const stipe = new Path2D();
    ribbon(stipe, xs, ys, N, sw * scale, sw * 0.6 * scale, false);
    g.fill(stipe);
    note([xs[N - 1], ys[N - 1]]);
    for (const [s, a0, lf, cx, cy] of blades) {
      const fi = Math.min(N - 1.001, s * (N - 1));
      const i0 = Math.floor(fi);
      const fr = fi - i0;
      const sx = xs[i0] + (xs[i0 + 1] - xs[i0]) * fr;
      const sy = ys[i0] + (ys[i0 + 1] - ys[i0]) * fr;
      const a = a0 + range(r, -0.08, 0.08);
      const len = lf * h * scale * range(r, 0.92, 1.06);
      const bulbR = sw * 0.8 * scale;
      const ax = Math.cos(a);
      const ay = Math.sin(a);
      const ux = sx + ax * bulbR * 1.5;
      const uy = sy + ay * bulbR * 1.5;
      g.globalAlpha = 0.8;
      g.beginPath();
      g.arc(ux, uy, bulbR, 0, TAU);
      g.fill();
      kelpBladeEdges(ux + ax * bulbR, uy + ay * bulbR, a, len, range(r, 0.27, 0.31), cx, cy, range(r, 2.5, 3.5), r() * TAU, 0, 1.5, top, bot, 16);
      const blade = new Path2D();
      wallLeaf(blade, top, bot);
      g.fill(blade);
      note(top);
      note(bot);
    }
  }
  g.globalAlpha = 1;
  // One low-res pixel of box blur (two passes) on top of the 1/8 sampling: soft, still a frond.
  const alpha = blurAlpha(lo, 1, 2);
  const LW = lo.width;
  const LH = lo.height;
  const q = document.createElement('canvas');
  q.width = Math.max(2, Math.ceil((cw * dpr) / 4));
  q.height = Math.max(2, Math.ceil((ch * dpr) / 4));
  const gq = q.getContext('2d')!;
  gq.imageSmoothingEnabled = true;
  gq.imageSmoothingQuality = 'high';
  gq.drawImage(lo, 0, 0, q.width, q.height);
  // Safari keeps a canvas's backing store until GC; release the temporary one now.
  lo.width = lo.height = 0;
  const blurPad = 32;
  minX = -OCC_PAD.x;
  const frond: Rect = {
    x: minX,
    y: Math.max(-OCC_PAD.top, minY - blurPad),
    w: Math.min(w + OCC_PAD.x, maxX + blurPad) - minX,
    h: h * (1 + OCC_PAD.bottom) - Math.max(-OCC_PAD.top, minY - blurPad),
  };
  /** Occluder coverage 0..1 at a CSS point (at rest, before sway and parallax). */
  const alphaAt = (x: number, y: number) => {
    const lx = Math.floor(((x + OCC_PAD.x) * LW) / cw);
    const ly = Math.floor(((y + OCC_PAD.top) * LH) / ch);
    if (lx < 0 || ly < 0 || lx >= LW || ly >= LH) return 0;
    return alpha[ly * LW + lx] / 255;
  };
  // The desktop rock lip (top-right) read as a stray dark blob over the bright surface; dropped.
  return { canvas: q, frond, lip: null, alphaAt };
}

/** One-off box blur of a small canvas's alpha (built once per resize, never per frame); returns the alpha. */
function blurAlpha(c: HTMLCanvasElement, r: number, passes: number): Uint8Array {
  const g = c.getContext('2d')!;
  const W = c.width;
  const Hh = c.height;
  const img = g.getImageData(0, 0, W, Hh);
  const a = new Float32Array(W * Hh);
  for (let i = 0; i < W * Hh; i++) a[i] = img.data[i * 4 + 3];
  const tmp = new Float32Array(W * Hh);
  const d = 2 * r + 1;
  for (let p = 0; p < passes; p++) {
    for (let y = 0; y < Hh; y++) {
      for (let x = 0; x < W; x++) {
        let sum = 0;
        for (let k = -r; k <= r; k++) sum += a[y * W + Math.min(W - 1, Math.max(0, x + k))];
        tmp[y * W + x] = sum / d;
      }
    }
    for (let y = 0; y < Hh; y++) {
      for (let x = 0; x < W; x++) {
        let sum = 0;
        for (let k = -r; k <= r; k++) sum += tmp[Math.min(Hh - 1, Math.max(0, y + k)) * W + x];
        a[y * W + x] = sum / d;
      }
    }
  }
  const out = new Uint8Array(W * Hh);
  for (let i = 0; i < W * Hh; i++) {
    img.data[i * 4] = img.data[i * 4 + 1] = img.data[i * 4 + 2] = 255;
    img.data[i * 4 + 3] = out[i] = Math.round(a[i]);
  }
  g.putImageData(img, 0, 0);
  return out;
}

// ---------------------------------------------------------------------------
// Shop specimens
// ---------------------------------------------------------------------------

const specimenCache = new Map<string, unknown>();

function cached<T>(key: string, make: () => T): T {
  if (!specimenCache.has(key)) specimenCache.set(key, make());
  return specimenCache.get(key) as T;
}

/** Draws one decoration as a shop specimen centred in a size x size box (shop plates). */
/** Which of her pictures stands in for each decoration. */
const DECORATION_ART = {
  'kelp-forest': 'kelp',
  'glowing-coral': 'coral',
  'treasure-chest': 'chest',
  'ancient-ruins': 'ruins',
} as const satisfies Record<DecorationId, ArtSlot>;

export function drawDecorationSpecimen(
  ctx: CanvasRenderingContext2D,
  id: DecorationId,
  size: number,
  t: number,
  lighting: Lighting,
  opts?: { outline?: boolean; outlineColor?: string },
): void {
  const L = lighting;
  const outline = !!opts?.outline;
  const ink: Ink = { outline: outline ? opts?.outlineColor ?? L.color('inkDeep', 1) : null, lw: 1 };
  const dots = newDots();
  const ta = t * (L.reducedMotion ? 0.5 : 1);
  ctx.save();
  if (outline) ctx.globalAlpha = 0.55;
  /** A small rounded drift of sand under a specimen, with its sediment cap. */
  const ground = (y: number, x0: number, x1: number) => {
    const pts: number[] = [];
    const N = 20;
    for (let i = 0; i <= N; i++) {
      const q = i / N;
      pts.push(x0 + (x1 - x0) * q, size - (size - y) * Math.pow(Math.sin(Math.PI * q), 0.45) + Math.sin(q * 13) * 0.4);
    }
    const p = new Path2D();
    if (outline) {
      p.moveTo(pts[0], pts[1]);
      for (let i = 2; i < pts.length; i += 2) p.lineTo(pts[i], pts[i + 1]);
      ctx.strokeStyle = ink.outline!;
      ctx.lineWidth = 1;
      ctx.stroke(p);
      return;
    }
    p.moveTo(x0, size + 1);
    for (let i = 0; i < pts.length; i += 2) p.lineTo(pts[i], pts[i + 1]);
    p.lineTo(x1, size + 1);
    p.closePath();
    ctx.fillStyle = L.color('l5', H.l5);
    ctx.fill(p);
    const caps = new Path2D();
    addCaps(caps, pts, false, () => 2.5);
    ctx.globalAlpha = L.num('ridgeCapAlpha', H.l5) * 0.92;
    ctx.fillStyle = L.color('ridgeCap', H.l5);
    ctx.fill(caps);
    ctx.globalAlpha = 1;
  };

  const pic = art(DECORATION_ART[id]);
  if (pic) {
    // Her drawing on the plate: fitted inside it, standing on a small drift of sand.
    const fit = Math.min((size * 0.86) / pic.w, (size * 0.8) / pic.h);
    const ph = pic.h * fit;
    const gy = size * 0.93;
    const sways = id === 'kelp-forest' || id === 'glowing-coral';
    const sk = sways ? fanSkew(ta, 0.7, 1) * ph * 1.4 : 0;
    if (outline) ctx.globalAlpha = 0.35;
    drawSwaying(ctx, pic.canvas, pic, size / 2, gy + (id === 'treasure-chest' ? ph * 0.12 : 0), ph, (s) => sk * s);
    ctx.globalAlpha = outline ? 0.55 : 1;
    ground(size * 0.95, size * 0.2, size * 0.8);
    ctx.restore();
    return;
  }

  if (id === 'kelp-forest') {
    const stalks = cached(`kelp2|${size}`, () => {
      const r = stream('kelp-forest');
      const unit = Math.max(0.55, size / 300);
      return [
        buildKelpStalk(r, size * 0.4, size * 0.95, size * 0.86, unit, 1.25, 1.6),
        buildKelpStalk(r, size * 0.56, size * 0.95, size * 0.68, unit, 1.25, 1.6),
        buildKelpStalk(r, size * 0.26, size * 0.95, size * 0.56, unit, 1.25, 1.6),
      ];
    });
    for (const k of stalks) {
      drawKelpStalk(ctx, k, ta, 1, {
        blade: L.color('kelpBlade', H.l4),
        edge: L.color('kelpEdge', H.l4),
        lantern: () => L.biolum(H.l4),
        lanternColor: C.lantern,
      }, ink, dots);
    }
    ground(size * 0.95, size * 0.16, size * 0.8);
  } else if (id === 'glowing-coral') {
    const fan = cached('fan', () => buildSeaFan(stream('glowing-coral')));
    const fh = Math.min(size * 0.8, (size * 0.9) / (2 * fan.halfWidth));
    drawSeaFan(ctx, fan, size * 0.5, size * 0.93, fh, fanSkew(ta, 0.7, 1), 1, {
      branch: L.color('seaFanBranch', H.l4),
      polyp: L.color('seaFanPolyp', H.l4),
      lantern: () => L.biolum(H.l4),
    }, ink, dots, ta);
    ground(size * 0.95, size * 0.3, size * 0.7);
  } else if (id === 'treasure-chest') {
    const night = Math.min(1, L.num('bodyDarken', H.l5) / 0.4);
    // Ground low and the chest a little smaller, so its drift of sand runs off the bottom of the
    // plate instead of stopping in hard edges at the sides.
    // Muted toward the water and sunk a third of its height, as it sits in the sea.
    const wtr = L.waterAt(H.l5);
    drawChest(ctx, size * 0.5, size * 0.8, size * 0.42, 12, {
      body: mixOK(L.color('chestBody', H.l5), wtr, CHEST_FOG * 0.75),
      band: mixOK(L.color('chestBand', H.l5), wtr, CHEST_FOG * 0.75),
      sand: L.color('l5', H.l5),
      cap: L.color('ridgeCap', H.l5),
      capAlpha: L.num('ridgeCapAlpha', H.l5) * 0.92 * (1 - night),
      lanternColor: C.lantern,
      leak: outline ? 0 : L.biolum(H.l5),
      silhouette: night,
    }, ink, dots, true, 0.5);
  } else if (id === 'ancient-ruins') {
    const x0 = size * 0.06;
    const x1 = size * 0.94;
    const colH = (x1 - x0) / RUINS_MIN_ASPECT;
    const ruins = cached(`ruins|${size}`, () => buildRuins(stream('ancient-ruins'), (x1 - x0) / colH));
    const stone = mixOK(L.color('l1', H.l1), L.color('ridgeCap', H.l1), 0.16);
    const gy = size * 0.8;
    if (!outline) {
      // A short length of the shelf with weathered, sloping ends (not a slab cut by the plate).
      const a = size * 0.02;
      const b = size * 0.98;
      const lip = size * 0.05;
      const shelf = new Path2D();
      shelf.moveTo(a, size + 1);
      shelf.quadraticCurveTo(a + lip * 0.15, gy + (size - gy) * 0.25, a + lip, gy);
      shelf.lineTo(b - lip, gy);
      shelf.quadraticCurveTo(b - lip * 0.15, gy + (size - gy) * 0.25, b, size + 1);
      shelf.closePath();
      ctx.fillStyle = L.color('l2', H.l2);
      ctx.fill(shelf);
      ctx.globalAlpha = L.num('ridgeCapAlpha', H.l2) * 0.6;
      ctx.fillStyle = L.color('ridgeCap', H.l2);
      ctx.fillRect(a + lip, gy, b - a - 2 * lip, 2.5);
      ctx.globalAlpha = 1;
    } else {
      ctx.strokeStyle = ink.outline!;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(size * 0.02, gy + 0.5);
      ctx.lineTo(size * 0.98, gy + 0.5);
      ctx.stroke();
    }
    drawRuins(ctx, ruins, x0, x1, gy, colH, {
      stone,
      lit: mixOK(stone, L.color('ridgeCap', H.l1), 0.14),
      cap: L.color('ridgeCap', H.l1),
      capAlpha: L.num('ridgeCapAlpha', H.l1) * 0.8,
    }, ink);
  }
  if (!outline) flushDots(ctx, dots);
  ctx.restore();
}


