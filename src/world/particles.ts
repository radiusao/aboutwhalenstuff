/**
 * Marine snow (which is also the night plankton), near bokeh, the biolum spark pool and the
 * rising bubble pool. Snow falls; only creature and whale bubbles rise.
 *
 * Snow is a structure-of-arrays in Float32Arrays. Coordinates are stored before parallax; the
 * draw and excite paths add the layer's parallax so pointer and wake tests use screen space.
 */
import type { BubbleOptions, WorldFrame } from './types';
import { C, mixOK } from './palette';
import { envelope, glowSprite } from './light';
import { range, stream } from './rng';

const MAX_SNOW = 180;
const SNOW_PER_PX = 0.00012;
/** Share of the snow that sits in the far layer (the rest is mid). */
const FAR_SHARE = 0.55;
const FAR_FALL = 4;
const MID_FALL = 8;
const BOKEH_FALL = 14;
const DRIFT_PX = 6;
const DRIFT_W = (Math.PI * 2) / 9;
/** Parallax of each particle layer (max px). */
const PX_FAR = 1;
const PX_MID = 4;
const PX_BUBBLES = 6;
const PX_BOKEH = 16;
/** Depth used for glow scattering (far lights big and dim, near small and sharp). */
const Z_FAR = 0.15;
const Z_MID = 0.55;

/** Night: spontaneous plankton flashes per second across the whole screen. */
const SPONTANEOUS_RATE = 0.35;
const TOUCH_RADIUS = 56;
const TOUCH_COOLDOWN = 1.5;
const WAKE_BAND = 30;
const WAKE_TIME = 3.2;
/** Night wake: biolum sparks seeded per px^2 the front sweeps, so the band reads on a phone too. */
const WAKE_SPARK_DENSITY = 0.00045;

const MAX_SPARKS = 400;
const MAX_BUBBLES = 160;
const BUBBLE_FADE = 0.6;

export interface Particles {
  resize(w: number, h: number): void;
  /** 1 = full count; 0.5 halves the snow and bokeh (adaptive quality). */
  setDensity(k: number): void;
  update(f: WorldFrame): void;
  /** Far snow into the half-res far buffer. */
  drawFarSnow(ctx: CanvasRenderingContext2D, f: WorldFrame): void;
  drawMidSnow(ctx: CanvasRenderingContext2D, f: WorldFrame): void;
  drawBubblesAndSparks(ctx: CanvasRenderingContext2D, f: WorldFrame): void;
  drawBokeh(ctx: CanvasRenderingContext2D, f: WorldFrame): void;
  /** Plankton within `radius` of a screen point flash (envelope), keeping the brighter of old and new. */
  exciteAt(x: number, y: number, radius: number, strength: number, f: WorldFrame): void;
  /**
   * Night finger or pointer drag: rate-limited flashes within 56px of the path, plus a faint
   * spark trail when `trail` (a pressed drag, not a desktop hover).
   */
  drag(x0: number, y0: number, x1: number, y1: number, trail: boolean, f: WorldFrame): void;
  /** Guardian's Wake front at radius r: plankton it passes fire with boost (1 - |d - r|/30)(1 - age/3.2). */
  wakeFront(cx: number, cy: number, r: number, dr: number, age: number, amp: number, f: WorldFrame): void;
  spark(x: number, y: number, vx: number, vy: number, life?: number, bright?: number): void;
  /** Which layer new sparks belong to: 'far' (whale lane, drawn into the far buffer) or 'near'. */
  setSparkLayer(layer: 'far' | 'near'): void;
  /** Far sparks into the half-res far buffer, right after the whale. */
  drawFarSparks(ctx: CanvasRenderingContext2D, f: WorldFrame): void;
  bubbles(x: number, y: number, f: WorldFrame, opts?: BubbleOptions): void;
}

interface Bokeh {
  x: number;
  y: number;
  r: number;
  vy: number;
  ph: number;
}

interface Bubble {
  alive: boolean;
  x: number;
  y: number;
  vy: number;
  r: number;
  age: number;
  life: number;
  wobP: number;
  ph: number;
  hue: string | null;
}

let sparkCanvas: HTMLCanvasElement | null = null;

/** A 3px biolum dot with a short falloff (spark pool and plankton cores). */
function sparkSprite(): HTMLCanvasElement {
  if (sparkCanvas) return sparkCanvas;
  const c = document.createElement('canvas');
  c.width = c.height = 32;
  const g = c.getContext('2d')!;
  const grad = g.createRadialGradient(16, 16, 0, 16, 16, 16);
  grad.addColorStop(0, 'rgba(180,255,246,1)');
  grad.addColorStop(0.16, 'rgba(160,252,240,0.95)');
  grad.addColorStop(0.3, 'rgba(95,243,230,0.42)');
  grad.addColorStop(0.6, 'rgba(95,243,230,0.08)');
  grad.addColorStop(1, 'rgba(95,243,230,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 32, 32);
  sparkCanvas = c;
  return c;
}

/** Creates the particle system. Call resize() before the first update. */
export function createParticles(): Particles {
  const rand = stream('particles');

  // Snow / plankton, structure of arrays.
  const sx = new Float32Array(MAX_SNOW);
  const sy = new Float32Array(MAX_SNOW);
  const svx = new Float32Array(MAX_SNOW);
  const svy = new Float32Array(MAX_SNOW);
  const size = new Float32Array(MAX_SNOW);
  const excite = new Float32Array(MAX_SNOW);
  const exT0 = new Float32Array(MAX_SNOW);
  const lastTouch = new Float32Array(MAX_SNOW);
  const phase = new Float32Array(MAX_SNOW);
  let nFar = 0;
  let nMid = 0;
  let farActive = 0;
  let midActive = 0;

  const bokeh: Bokeh[] = [];
  let bokehActive = 0;

  // Sparks: a ring buffer, oldest overwritten when full.
  const kx = new Float32Array(MAX_SPARKS);
  const ky = new Float32Array(MAX_SPARKS);
  const kvx = new Float32Array(MAX_SPARKS);
  const kvy = new Float32Array(MAX_SPARKS);
  const kage = new Float32Array(MAX_SPARKS);
  const klife = new Float32Array(MAX_SPARKS);
  const kbright = new Float32Array(MAX_SPARKS);
  const kfar = new Uint8Array(MAX_SPARKS);
  let sparkLayer = 0;
  let kNext = 0;

  const bubblePool: Bubble[] = Array.from({ length: MAX_BUBBLES }, () => ({
    alive: false,
    x: 0,
    y: 0,
    vy: 0,
    r: 0,
    age: 0,
    life: 0,
    wobP: 1,
    ph: 0,
    hue: null,
  }));

  let w = 0;
  let h = 0;
  let density = 1;
  let trailCarry = 0;

  function seedSnow(i: number, y: number) {
    const far = i < nFar;
    sx[i] = range(rand, -24, w + 24);
    sy[i] = y;
    svx[i] = 0;
    svy[i] = (far ? FAR_FALL : MID_FALL) * range(rand, 0.75, 1.25);
    size[i] = far ? range(rand, 0.35, 0.5) : range(rand, 0.5, 0.75);
    excite[i] = 0;
    exT0[i] = -10;
    lastTouch[i] = -10;
    phase[i] = range(rand, 0, Math.PI * 2);
  }

  function applyDensity() {
    farActive = Math.round(nFar * density);
    midActive = Math.round(nMid * density);
    bokehActive = Math.max(5, Math.round(bokeh.length * density));
  }

  /** Screen position of snow particle i, given this frame's far and mid parallax. */
  function screenX(i: number, t: number, px: number) {
    return sx[i] + DRIFT_PX * Math.sin(t * DRIFT_W + phase[i]) + px;
  }

  function level(i: number, t: number): number {
    const a = excite[i];
    return a > 0 ? a * envelope(t - exT0[i]) : 0;
  }

  /** Fires particle i at strength s without dropping a brighter flash already in progress. */
  function fire(i: number, s: number, t: number) {
    if (s <= 0) return;
    const cur = level(i, t);
    if (s <= cur) return;
    excite[i] = s;
    exT0[i] = t - 0.08 * (cur / s);
  }

  function forEachActive(fn: (i: number) => void) {
    for (let i = 0; i < farActive; i++) fn(i);
    for (let i = nFar; i < nFar + midActive; i++) fn(i);
  }

  /** Visits every active plankton speck with its screen position this frame. */
  function eachOnScreen(f: WorldFrame, fn: (i: number, x: number, y: number) => void) {
    const pf = f.parallax(PX_FAR);
    const pm = f.parallax(PX_MID);
    for (let i = 0; i < farActive; i++) fn(i, screenX(i, f.t, pf.x), sy[i] + pf.y);
    for (let i = nFar; i < nFar + midActive; i++) fn(i, screenX(i, f.t, pm.x), sy[i] + pm.y);
  }

  function spark(x: number, y: number, vx: number, vy: number, life = 1.6, bright = 1) {
    const i = kNext;
    kNext = (kNext + 1) % MAX_SPARKS;
    kx[i] = x;
    ky[i] = y;
    kvx[i] = vx;
    kvy[i] = vy;
    kage[i] = 0;
    klife[i] = Math.max(0.1, life);
    kbright[i] = bright;
    kfar[i] = sparkLayer;
  }

  function drawSparks(ctx: CanvasRenderingContext2D, f: WorldFrame, far: number) {
    const L = f.lighting;
    const sprite = sparkSprite();
    // Far sparks sit in the half-res buffer: a little larger and dimmer (glow scattering).
    const r = far ? 5 : 4;
    const k = far ? 0.8 : 1;
    ctx.globalCompositeOperation = 'lighter';
    for (let i = 0; i < MAX_SPARKS; i++) {
      const age = kage[i];
      const life = klife[i];
      if (age >= life || kfar[i] !== far) continue;
      const n = L.biolum(ky[i] / h);
      if (n <= 0.01) continue;
      const a = Math.min(1, age / 0.06) * Math.pow(1 - age / life, 1.4) * n * kbright[i] * k;
      if (a < 0.01) continue;
      ctx.globalAlpha = a;
      ctx.drawImage(sprite, kx[i] - r, ky[i] - r, r * 2, r * 2);
    }
    ctx.globalCompositeOperation = 'source-over';
    ctx.globalAlpha = 1;
  }

  function drawSnowLayer(ctx: CanvasRenderingContext2D, f: WorldFrame, start: number, end: number, px: number, z: number) {
    const L = f.lighting;
    const p = f.parallax(px);
    const t = f.t;
    // During a descent the snow colour changes with depth, so fill in a few horizontal bands.
    const settled = L.progressAt(0) >= 1 && L.progressAt(1) >= 1;
    const bands = settled ? 1 : 6;
    ctx.globalCompositeOperation = 'source-over';
    for (let b = 0; b < bands; b++) {
      const yN = (b + 0.5) / bands;
      ctx.fillStyle = L.color('snow', yN);
      ctx.globalAlpha = L.num('snowAlpha', yN);
      ctx.beginPath();
      for (let i = start; i < end; i++) {
        const y = sy[i] + p.y;
        if (bands > 1 && Math.min(bands - 1, Math.max(0, Math.floor((y / h) * bands))) !== b) continue;
        const x = screenX(i, t, p.x);
        const r = size[i];
        ctx.moveTo(x + r, y);
        ctx.arc(x, y, r, 0, Math.PI * 2);
      }
      ctx.fill();
    }

    // Excited plankton: biolum at night (halo, then a core as it brightens); a faint sparkle by day.
    const halo = glowSprite(C.biolum, 64);
    const core = sparkSprite();
    const spread = 1 + 0.6 * (1 - z);
    const intensity = 0.5 + 0.5 * z;
    for (let i = start; i < end; i++) {
      const lvl = level(i, t);
      if (lvl < 0.02) continue;
      const x = screenX(i, t, p.x);
      const y = sy[i] + p.y;
      const n = L.biolum(y / h);
      if (n > 0.01) {
        const R = (3 + 6 * lvl) * spread;
        ctx.globalCompositeOperation = 'lighter';
        ctx.globalAlpha = Math.min(1, lvl * n * intensity * 0.8);
        ctx.drawImage(halo, x - R, y - R, R * 2, R * 2);
        const c = 2.2 + 1.6 * lvl;
        ctx.globalAlpha = Math.min(1, lvl * lvl * n * intensity * 1.3);
        ctx.drawImage(core, x - c, y - c, c * 2, c * 2);
      }
      if (n < 0.99) {
        ctx.globalCompositeOperation = 'source-over';
        ctx.fillStyle = L.color('snow', y / h);
        ctx.globalAlpha = Math.min(1, lvl * (1 - n) * 0.45);
        ctx.beginPath();
        ctx.arc(x, y, size[i] * 1.6, 0, Math.PI * 2);
        ctx.fill();
      }
    }
    ctx.globalCompositeOperation = 'source-over';
    ctx.globalAlpha = 1;
  }

  const particles: Particles = {
    resize(nw, nh) {
      w = nw;
      h = nh;
      const n = Math.min(MAX_SNOW, Math.round(w * h * SNOW_PER_PX));
      nFar = Math.round(n * FAR_SHARE);
      nMid = n - nFar;
      for (let i = 0; i < n; i++) seedSnow(i, range(rand, 0, h));
      // 10 to 16 near discs, more on big screens.
      const area = w * h;
      const nb = Math.round(10 + 6 * Math.min(1, Math.max(0, (area - 350_000) / 900_000)));
      bokeh.length = 0;
      for (let i = 0; i < nb; i++) {
        bokeh.push({
          x: range(rand, -20, w + 20),
          y: range(rand, 0, h),
          r: range(rand, 2.5, 6),
          vy: BOKEH_FALL * range(rand, 0.8, 1.2),
          ph: range(rand, 0, Math.PI * 2),
        });
      }
      applyDensity();
    },

    setDensity(k) {
      density = Math.max(0.25, Math.min(1, k));
      applyDensity();
    },

    update(f) {
      const { dt, t } = f;
      const L = f.lighting;
      const slow = L.reducedMotion ? 0.5 : 1;
      const damp = Math.pow(0.3, dt);

      forEachActive((i) => {
        sy[i] += svy[i] * dt * slow;
        sx[i] += svx[i] * dt;
        svx[i] *= damp;
        if (sy[i] > h + 24) seedSnow(i, -24);
        if (sx[i] < -40) sx[i] += w + 80;
        else if (sx[i] > w + 40) sx[i] -= w + 80;
      });

      for (let i = 0; i < bokehActive; i++) {
        const b = bokeh[i];
        b.y += b.vy * dt * slow;
        if (b.y > h + 30) {
          b.y = -30;
          b.x = range(rand, -20, w + 20);
        }
      }

      const sdamp = Math.pow(0.35, dt);
      for (let i = 0; i < MAX_SPARKS; i++) {
        if (kage[i] >= klife[i]) continue;
        kage[i] += dt;
        kx[i] += kvx[i] * dt;
        ky[i] += kvy[i] * dt;
        kvx[i] *= sdamp;
        kvy[i] *= sdamp;
      }

      for (const b of bubblePool) {
        if (!b.alive) continue;
        b.age += dt;
        b.y -= b.vy * dt;
        if (b.age > b.life + BUBBLE_FADE || b.y < -10) b.alive = false;
      }

      // At night a plankton speck now and then flashes on its own (about one every three seconds).
      const night = L.biolum(0.6);
      const total = farActive + midActive;
      if (night > 0.5 && total > 0 && rand() < SPONTANEOUS_RATE * night * dt) {
        const pick = Math.floor(rand() * total);
        fire(pick < farActive ? pick : nFar + (pick - farActive), range(rand, 0.35, 0.7), t);
      }
    },

    drawFarSnow(ctx, f) {
      drawSnowLayer(ctx, f, 0, farActive, PX_FAR, Z_FAR);
    },

    drawMidSnow(ctx, f) {
      drawSnowLayer(ctx, f, nFar, nFar + midActive, PX_MID, Z_MID);
    },

    drawBubblesAndSparks(ctx, f) {
      const L = f.lighting;
      const p = f.parallax(PX_BUBBLES);
      ctx.lineWidth = f.lineWidth;
      ctx.lineCap = 'round';
      for (const b of bubblePool) {
        if (!b.alive) continue;
        const k = b.age > b.life ? Math.min(1, (b.age - b.life) / BUBBLE_FADE) : 0;
        const fadeIn = Math.min(1, b.age / 0.12);
        const s = 1 + 0.3 * k;
        const x = b.x + 3 * Math.sin((b.age / b.wobP) * Math.PI * 2 + b.ph) + p.x;
        const y = b.y + p.y;
        const yN = y / h;
        const n = L.biolum(yN);
        const hue = b.hue ?? L.color('snow', yN);
        const ring = n > 0 ? mixOK('#FFFFFF', hue, n) : '#FFFFFF';
        const a = 0.6 * (1 - k) * fadeIn;
        const r = b.r * s;
        if (n > 0.02 && b.hue) {
          const g = r * 3.2;
          ctx.globalCompositeOperation = 'lighter';
          ctx.globalAlpha = 0.3 * n * (1 - k) * fadeIn;
          ctx.drawImage(glowSprite(b.hue, 64), x - g, y - g, g * 2, g * 2);
          ctx.globalCompositeOperation = 'source-over';
        }
        ctx.strokeStyle = ring;
        ctx.globalAlpha = a;
        ctx.beginPath();
        ctx.arc(x, y, r, 0, Math.PI * 2);
        ctx.stroke();
        // A short highlight arc on the upper left, like light caught in the film.
        ctx.globalAlpha = Math.min(1, a * 1.5);
        ctx.beginPath();
        ctx.arc(x, y, r * 0.55, -2.55, -1.75);
        ctx.stroke();
      }

      ctx.globalAlpha = 1;
      drawSparks(ctx, f, 0);
    },

    drawFarSparks(ctx, f) {
      drawSparks(ctx, f, 1);
    },

    setSparkLayer(layer) {
      sparkLayer = layer === 'far' ? 1 : 0;
    },

    drawBokeh(ctx, f) {
      const L = f.lighting;
      const p = f.parallax(PX_BOKEH);
      const t = f.t;
      ctx.globalCompositeOperation = 'source-over';
      for (let i = 0; i < bokehActive; i++) {
        const b = bokeh[i];
        const x = b.x + DRIFT_PX * Math.sin(t * DRIFT_W * 0.8 + b.ph) + p.x;
        const y = b.y + p.y;
        const yN = Math.min(1, Math.max(0, y / h));
        const a = L.num('bokehAlpha', yN);
        ctx.fillStyle = L.color('bokeh', yN);
        ctx.globalAlpha = a * 0.35;
        ctx.beginPath();
        ctx.arc(x, y, b.r * 1.3, 0, Math.PI * 2);
        ctx.fill();
        ctx.globalAlpha = a * 0.7;
        ctx.beginPath();
        ctx.arc(x, y, b.r, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.globalAlpha = 1;
    },

    exciteAt(x, y, radius, strength, f) {
      if (radius <= 0 || strength <= 0) return;
      const t = f.t;
      const r2 = radius * radius;
      eachOnScreen(f, (i, px, py) => {
        const d2 = (px - x) ** 2 + (py - y) ** 2;
        if (d2 <= r2) fire(i, strength * (1 - (Math.sqrt(d2) / radius) * 0.5), t);
      });
    },

    drag(x0, y0, x1, y1, trail, f) {
      const n = f.lighting.biolum(y1 / h);
      if (n < 0.05) return;
      const t = f.t;
      const ex = x1 - x0;
      const ey = y1 - y0;
      const len2 = ex * ex + ey * ey;
      const len = Math.sqrt(len2);
      eachOnScreen(f, (i, px, py) => {
        if (t - lastTouch[i] < TOUCH_COOLDOWN) return;
        // Distance from the particle to the drag segment.
        let u = len2 > 0 ? ((px - x0) * ex + (py - y0) * ey) / len2 : 0;
        u = u < 0 ? 0 : u > 1 ? 1 : u;
        const d = Math.hypot(px - (x0 + ex * u), py - (y0 + ey * u));
        if (d > TOUCH_RADIUS) return;
        lastTouch[i] = t;
        fire(i, 0.55 + 0.45 * (1 - d / TOUCH_RADIUS), t);
        // A small push along the finger, as if the water moved.
        if (len > 0) svx[i] += (ex / len) * 6;
      });
      if (!trail || len === 0) return;
      // Plankton too small to see as snow light along the finger's path: a sparse, uneven
      // sparkle (one every ~9px of travel), scattered a little to either side.
      trailCarry += len;
      const nx = -ey / len;
      const ny = ex / len;
      while (trailCarry >= 9) {
        trailCarry -= 9;
        const u = rand();
        const side = (rand() + rand() - 1) * 10;
        spark(
          x0 + ex * u + nx * side,
          y0 + ey * u + ny * side,
          nx * side * 0.4 + range(rand, -3, 3),
          ny * side * 0.4 + range(rand, -6, 2),
          range(rand, 0.7, 1.4),
          range(rand, 0.35, 1),
        );
      }
    },

    wakeFront(cx, cy, r, dr, age, amp, f) {
      if (age >= WAKE_TIME) return;
      const t = f.t;
      const fade = 1 - age / WAKE_TIME;
      eachOnScreen(f, (i, px, py) => {
        const dd = Math.abs(Math.hypot(px - cx, py - cy) - r);
        if (dd < WAKE_BAND) fire(i, (1 - dd / WAKE_BAND) * fade * amp, t);
      });
      // At night the front also wakes plankton too small to see as snow: sparks seeded in the band.
      const night = f.lighting.biolum(Math.min(1, Math.max(0, cy / h)));
      if (night < 0.05 || dr <= 0) return;
      // Candidates are spread round the whole ring; only those on screen become sparks, so the
      // density stays even however much of the ring has left the screen.
      const want = 2 * Math.PI * r * dr * WAKE_SPARK_DENSITY * fade * amp * night;
      const count = Math.min(32, Math.floor(want) + (rand() < want % 1 ? 1 : 0));
      for (let k = 0; k < count; k++) {
        const a = rand() * Math.PI * 2;
        const rr = r + (rand() + rand() - 1) * WAKE_BAND * 0.8;
        const x = cx + Math.cos(a) * rr;
        const y = cy + Math.sin(a) * rr;
        if (x < -8 || x > w + 8 || y < -8 || y > h + 8) continue;
        spark(x, y, Math.cos(a) * range(rand, 4, 14), Math.sin(a) * range(rand, 4, 14), range(rand, 0.6, 1.2), range(rand, 0.5, 1));
      }
    },

    spark,

    bubbles(x, y, _f, opts = {}) {
      const n = opts.count ?? 6;
      const [s0, s1] = opts.speed ?? [30, 45];
      const [r0, r1] = opts.size ?? [1.5, 3.5];
      const spread = opts.spread ?? 8;
      let spawned = 0;
      for (const b of bubblePool) {
        if (spawned >= n) break;
        if (b.alive) continue;
        b.alive = true;
        b.x = x + range(rand, -spread, spread);
        b.y = y + range(rand, -2, 2) + spawned * 2.5;
        b.vy = range(rand, s0, s1);
        b.r = range(rand, r0, r1);
        b.age = 0;
        b.life = range(rand, 2, 3);
        b.wobP = range(rand, 1.1, 1.7);
        b.ph = range(rand, 0, Math.PI * 2);
        b.hue = opts.color ?? null;
        spawned++;
      }
    },
  };
  return particles;
}
