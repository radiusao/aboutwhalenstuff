/**
 * Her drawings. Any picture dropped into the `art/` folder beside index.html replaces the
 * matching part of the sea; anything missing keeps the drawn-in-code version. Nothing waits
 * on the pictures: each one swaps in the moment it has loaded.
 *
 * File names (PNG with a transparent background; backgrounds may also be JPG):
 *   whale, jellyfish, jellyfish-cyan|lilac|gold|ribbon, seahorse, seahorse-coral|gold|lilac,
 *   bottle, pearl, kelp, coral, chest, ruins, background, background-day|sunset|midnight.
 * A variant file (jellyfish-gold) wins over the plain one (jellyfish) for that variant.
 * art/README.txt (public/art/README.txt) says how each should face and be framed.
 */
import type { Lighting } from './types';
import { C, mixOK } from './palette';

export interface ArtImage {
  /** Downscaled copy, drawn every frame. */
  canvas: HTMLCanvasElement;
  w: number;
  h: number;
  /** URL the DOM can show (the HUD pearl). */
  url: string;
  /** Tinted copies by colour and amount, most recently used last. */
  tints: Map<string, HTMLCanvasElement>;
}

/** Longest side each picture is kept at: enough for a 3x phone screen, no more. */
const MAX_SIDE: Record<string, number> = {
  whale: 1400,
  background: 2400,
  kelp: 900,
  coral: 900,
  ruins: 1400,
  chest: 700,
  bottle: 600,
  pearl: 160,
};
const MAX_DEFAULT = 640;
const TINT_CACHE = 10;

const SLOTS = [
  'whale',
  'jellyfish',
  'jellyfish-cyan',
  'jellyfish-lilac',
  'jellyfish-gold',
  'jellyfish-ribbon',
  'seahorse',
  'seahorse-coral',
  'seahorse-gold',
  'seahorse-lilac',
  'bottle',
  'pearl',
  'kelp',
  'coral',
  'chest',
  'ruins',
  'background',
  'background-day',
  'background-sunset',
  'background-midnight',
] as const;
export type ArtSlot = (typeof SLOTS)[number];

const images = new Map<string, ArtImage>();
const listeners = new Set<() => void>();
let started = false;
let version = 0;

/** The picture for a slot, or null while it is missing or still loading. */
export function art(slot: ArtSlot): ArtImage | null {
  return images.get(slot) ?? null;
}

/** A variant's own picture, else the species' picture. */
export function artFor(base: 'jellyfish' | 'seahorse', variant: string): ArtImage | null {
  return images.get(`${base}-${variant}`) ?? images.get(base) ?? null;
}

/** Bumps each time a picture arrives (for React). */
export function artVersion(): number {
  return version;
}

export function onArt(cb: () => void): () => void {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

/** Starts looking for every picture. Safe to call more than once. */
export function loadArt(): void {
  if (started || typeof document === 'undefined') return;
  started = true;
  for (const slot of SLOTS) {
    const exts = slot.startsWith('background') ? ['png', 'jpg', 'jpeg'] : ['png'];
    void tryLoad(slot, exts);
  }
}

async function tryLoad(slot: string, exts: string[]): Promise<void> {
  for (const ext of exts) {
    const img = await loadImage(`art/${slot}.${ext}`);
    if (!img) continue;
    images.set(slot, shrink(img, MAX_SIDE[slot.split('-')[0]] ?? MAX_DEFAULT));
    version++;
    listeners.forEach((cb) => cb());
    return;
  }
}

function loadImage(src: string): Promise<HTMLImageElement | null> {
  return new Promise((resolve) => {
    const img = new Image();
    img.decoding = 'async';
    img.onload = () => resolve(img.naturalWidth > 0 ? img : null);
    img.onerror = () => resolve(null);
    img.src = src;
  });
}

function shrink(img: HTMLImageElement, maxSide: number): ArtImage {
  const k = Math.min(1, maxSide / Math.max(img.naturalWidth, img.naturalHeight));
  const w = Math.max(1, Math.round(img.naturalWidth * k));
  const h = Math.max(1, Math.round(img.naturalHeight * k));
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const g = canvas.getContext('2d')!;
  g.imageSmoothingQuality = 'high';
  g.drawImage(img, 0, 0, w, h);
  return { canvas, w, h, url: img.src, tints: new Map() };
}

/**
 * The picture washed toward `color` by `amount` (0 = as drawn), keeping its transparency.
 * Amounts are rounded so a light change reuses a handful of copies.
 */
export function tinted(a: ArtImage, color: string, amount: number): HTMLCanvasElement {
  const q = Math.round(Math.min(1, Math.max(0, amount)) * 32) / 32;
  if (q <= 0) return a.canvas;
  const key = `${color}|${q}`;
  const hit = a.tints.get(key);
  if (hit) {
    a.tints.delete(key);
    a.tints.set(key, hit);
    return hit;
  }
  const c = a.tints.size >= TINT_CACHE ? a.tints.values().next().value! : document.createElement('canvas');
  if (a.tints.size >= TINT_CACHE) a.tints.delete(a.tints.keys().next().value!);
  c.width = a.w;
  c.height = a.h;
  const g = c.getContext('2d')!;
  g.globalCompositeOperation = 'source-over';
  g.globalAlpha = 1;
  g.clearRect(0, 0, a.w, a.h);
  g.drawImage(a.canvas, 0, 0);
  g.globalCompositeOperation = 'source-atop';
  g.globalAlpha = q;
  g.fillStyle = color;
  g.fillRect(0, 0, a.w, a.h);
  a.tints.set(key, c);
  return c;
}

/**
 * How the sea's light falls on a picture at height yNorm: night darkens it toward the night
 * floor (bodyDarken), distance fogs it toward the water. Returns the colour and amount for tinted().
 *
 * While the light descends the water colour changes a little every frame; a fogged picture would
 * then be re-tinted (a full-size copy) on every frame and churn its cache. So during a descent the
 * tint colour is rounded to steps of 4/255 per channel, which keeps the re-tints to a few dozen
 * per descent and changes the picture by no more than 2/255. Settled light is tinted exactly.
 */
export function sceneTint(L: Lighting, yNorm: number, fog = 0): { color: string; amount: number } {
  const dark = L.num('bodyDarken', yNorm);
  const amount = 1 - (1 - dark) * (1 - fog);
  if (amount <= 0.001) return { color: C.nightFloor, amount: 0 };
  let color = fog <= 0 ? C.nightFloor : mixOK(C.nightFloor, L.waterAt(yNorm), fog / (dark + fog));
  if (fog > 0 && L.from !== L.mode) color = coarseHex(color);
  return { color, amount };
}

const coarseCache = new Map<string, string>();

/** `#rrggbb` with each channel rounded to a multiple of 4. */
function coarseHex(color: string): string {
  const hit = coarseCache.get(color);
  if (hit) return hit;
  const n = parseInt(color.slice(1, 7), 16);
  const q = (v: number) => Math.min(252, Math.round(v / 4) * 4).toString(16).padStart(2, '0');
  const out = `#${q((n >> 16) & 255)}${q((n >> 8) & 255)}${q(n & 255)}`;
  if (coarseCache.size > 4096) coarseCache.clear();
  coarseCache.set(color, out);
  return out;
}

/**
 * Draws a picture with its anchor (ax, ay as fractions of the picture, 0.5/0.5 = centre) at
 * the current origin, `width` px wide (height follows the picture), stretched by sx/sy.
 */
export function drawArt(
  ctx: CanvasRenderingContext2D,
  src: CanvasImageSource,
  a: ArtImage,
  width: number,
  ax: number,
  ay: number,
  sx = 1,
  sy = 1,
): void {
  const height = (width * a.h) / a.w;
  ctx.save();
  ctx.scale(sx, sy);
  ctx.drawImage(src, -ax * width, -ay * height, width, height);
  ctx.restore();
}

/** Horizontal slices drawSwaying cuts a picture into. */
const SWAY_SLICES = 14;

/**
 * Draws a picture standing on (x, baseY), `height` px tall, bending like a plant: each
 * horizontal slice is shifted by dx(s), s = 0 at the base .. 1 at the top.
 */
export function drawSwaying(
  ctx: CanvasRenderingContext2D,
  src: CanvasImageSource,
  a: ArtImage,
  x: number,
  baseY: number,
  height: number,
  dx: (s: number) => number,
  flip = false,
): void {
  const width = (height * a.w) / a.h;
  const sh = a.h / SWAY_SLICES;
  const dh = height / SWAY_SLICES;
  for (let i = 0; i < SWAY_SLICES; i++) {
    // Slice i counts down from the top of the picture; overlap a hair so no seams show.
    const s = 1 - (i + 0.5) / SWAY_SLICES;
    const off = dx(s);
    const top = baseY - height + i * dh;
    if (flip) {
      ctx.save();
      ctx.translate(x + off, 0);
      ctx.scale(-1, 1);
      ctx.drawImage(src, 0, i * sh, a.w, Math.min(sh + 1, a.h - i * sh), -width / 2, top, width, dh + 0.6);
      ctx.restore();
    } else {
      ctx.drawImage(src, 0, i * sh, a.w, Math.min(sh + 1, a.h - i * sh), x + off - width / 2, top, width, dh + 0.6);
    }
  }
}
