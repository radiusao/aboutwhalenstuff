/**
 * Live specimens for the shop plates. Each plate draws its creature or decoration with the
 * same code as the sea, on its own 160px canvas, from a small mock WorldFrame and a Lighting
 * that follows the time of day. One shared 30fps loop drives every plate; at most five
 * visible plates animate and the rest hold their last frame.
 */
import type { LightingMode } from '../../types/sanctuary';
import type { BubbleOptions, CreatureEntity, CreatureFactory, Lighting, WorldFrame } from '../../world/types';
import { modeTokens, mixOK, waterAtMode, type ModeColor, type ModeNumber } from '../../world/palette';
import { candle, drawGlow } from '../../world/light';
import { hashString } from '../../world/rng';
import { drawDecorationSpecimen } from '../../world/scenery';
import type { SpecimenSpec } from './catalog';

/** CSS size of a specimen canvas. */
export const SPECIMEN_SIZE = 160;
const MAX_LIVE = 5;
const FRAME = 1 / 30;
/** Where the plates sit on screen, so the descending light reaches them when it reaches the seabed. */
const PLATE_Y = 0.8;
const GLOWS_PER_PLATE = 8;
/** Creatures rest with their lowest point here, just above the pin that drops to the label. */
const BASELINE = 150;

// ---------------------------------------------------------------------------
// Creature factories. Loaded lazily so a plate can show a placeholder until its module exists.
// ---------------------------------------------------------------------------

const creatureModules = import.meta.glob(['../../world/creatures/jellyfish.ts', '../../world/creatures/seahorse.ts']);
const factories: Partial<Record<'jellyfish' | 'seahorse', Promise<CreatureFactory | null>>> = {};

function loadFactory(kind: 'jellyfish' | 'seahorse'): Promise<CreatureFactory | null> {
  const hit = factories[kind];
  if (hit) return hit;
  const load = creatureModules[`../../world/creatures/${kind}.ts`];
  const p = load
    ? load()
        .then((m) => {
          const mod = m as Record<string, unknown>;
          const f = kind === 'jellyfish' ? mod.createJellyfish : mod.createSeahorse;
          return typeof f === 'function' ? (f as CreatureFactory) : null;
        })
        .catch(() => null)
    : Promise.resolve(null);
  factories[kind] = p;
  return p;
}

// ---------------------------------------------------------------------------
// Light: the current mode, blended through "Light descends" at the plates' height.
// ---------------------------------------------------------------------------

const reducedQuery = typeof matchMedia === 'function' ? matchMedia('(prefers-reduced-motion: reduce)') : null;

/** Water behind a plate: the deep scrim over the water at the plates' height. */
function plateWater(mode: LightingMode): string {
  return mixOK(waterAtMode(mode, 0.74), waterAtMode(mode, 1), 0.82);
}

/**
 * The light a specimen is drawn in. At Midnight the sea's bodies go to silhouettes, which on a
 * plate reads as nothing at all; a specimen is shown as if under a lamp, in Sunset's colours,
 * with its own night lanterns still lit.
 */
function lampOf(mode: LightingMode): LightingMode {
  return mode === 'midnight' ? 'sunset' : mode;
}

class PlateLight {
  from: LightingMode = 'midnight';
  to: LightingMode = 'midnight';
  private start = -1e9;
  private set = false;
  p = 1;
  bio = 1;
  readonly lighting: Lighting;

  constructor() {
    const self = this;
    this.lighting = {
      get mode() {
        return self.to;
      },
      get from() {
        return self.from;
      },
      progressAt: () => self.p,
      color: (token: ModeColor) =>
        mixOK(modeTokens[lampOf(self.from)].color[token], modeTokens[lampOf(self.to)].color[token], self.p),
      num: (token: ModeNumber) => {
        const a = modeTokens[lampOf(self.from)].num[token];
        return a + (modeTokens[lampOf(self.to)].num[token] - a) * self.p;
      },
      // What lies behind the specimen is still the real water.
      waterAt: () => mixOK(plateWater(self.from), plateWater(self.to), self.p),
      glowGain: () => {
        const a = modeTokens[lampOf(self.from)].num.glowGain;
        return a + (modeTokens[lampOf(self.to)].num.glowGain - a) * self.p;
      },
      biolum: () => self.bio,
      fogForZ: (z: number) => 0.5 * (1 - z),
      get reducedMotion() {
        return !!reducedQuery?.matches;
      },
    };
  }

  setMode(mode: LightingMode, now: number) {
    if (!this.set) {
      this.set = true;
      this.from = this.to = mode;
      this.tick(now);
      return;
    }
    if (mode === this.to) return;
    this.from = this.p >= 1 ? this.to : this.from;
    this.to = mode;
    this.start = now;
    this.tick(now);
  }

  tick(now: number) {
    const e = now - this.start;
    const reduced = !!reducedQuery?.matches;
    if (this.from === this.to) {
      this.p = 1;
    } else if (reduced) {
      this.p = clamp01(e / 1.2);
    } else {
      // Leaving midnight, the lanterns go out first (1s), then the new daylight sinks down.
      const delay = PLATE_Y * 2.4 + (this.from === 'midnight' ? 1 : 0);
      this.p = clamp01((e - delay) / 1.6);
    }
    const fromNight = this.from === 'midnight';
    const toNight = this.to === 'midnight';
    if (fromNight && toNight) this.bio = 1;
    else if (reduced) this.bio = toNight ? this.p : fromNight ? 1 - this.p : 0;
    else if (toNight) this.bio = candle(e - (PLATE_Y * 2.4 + 1.6) - 0.25);
    else if (fromNight) this.bio = clamp01(1 - (e - 0.7) / 0.25);
    else this.bio = 0;
  }
}

const light = new PlateLight();

/** Point the plates' light at a time of day (blends like the sea when it changes). */
export function setPlateMode(mode: LightingMode): void {
  light.setMode(mode, performance.now() / 1000);
}

/** The ink the hairline "not yet" outlines are drawn in (the real inkDeep, not the lamp's). */
function outlineInk(): string {
  return mixOK(modeTokens[light.from].color.inkDeep, modeTokens[light.to].color.inkDeep, light.p);
}

// ---------------------------------------------------------------------------
// Pointer, so a seahorse on a plate can turn toward her finger.
// ---------------------------------------------------------------------------

const pointer = { x: -9999, y: -9999, active: false, down: false };

function onPointerMove(e: PointerEvent) {
  pointer.x = e.clientX;
  pointer.y = e.clientY;
  pointer.active = e.pointerType === 'mouse' || pointer.down;
}
function onPointerDown(e: PointerEvent) {
  pointer.down = true;
  onPointerMove(e);
}
function onPointerUp(e: PointerEvent) {
  pointer.down = false;
  if (e.pointerType !== 'mouse') pointer.active = false;
}
function onPointerOut(e: PointerEvent) {
  if (!e.relatedTarget) pointer.active = false;
}

// ---------------------------------------------------------------------------
// Stage: one plate's canvas.
// ---------------------------------------------------------------------------

interface Bubble {
  x: number;
  y: number;
  vy: number;
  r: number;
  age: number;
  life: number;
  phase: number;
  color: string;
}

export class SpecimenStage {
  readonly canvas: HTMLCanvasElement;
  private readonly ctx: CanvasRenderingContext2D;
  private readonly spec: SpecimenSpec;
  private entity: CreatureEntity | null = null;
  private failed = false;
  private disposed = false;
  private dpr = 1;
  private glows = 0;
  private bubbles: Bubble[] = [];
  private readonly frame: WorldFrame;
  private readonly localPointer = { x: -9999, y: -9999, active: false, down: false };
  /** How far the creature is lowered so it rests on the baseline (CSS px). */
  private drop = 0;
  private downAt: { x: number; y: number; t: number; id: number } | null = null;
  outline = false;
  visible = false;
  /** Set when something changed and a paused plate should draw one fresh frame. */
  stale = true;

  constructor(canvas: HTMLCanvasElement, spec: SpecimenSpec) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d')!;
    this.spec = spec;
    const self = this;
    this.frame = {
      t: hashString(spec.kind === 'decoration' ? spec.id : spec.variant) % 97,
      dt: FRAME,
      w: SPECIMEN_SIZE,
      h: SPECIMEN_SIZE,
      dpr: 1,
      phone: innerWidth < 640,
      lineWidth: 1,
      lighting: light.lighting,
      pointer: this.localPointer,
      parallax: () => ({ x: 0, y: 0 }),
      glow(color, x, y, radius, alpha) {
        if (self.glows++ >= GLOWS_PER_PLATE) return;
        // Keep each halo inside the plate so its falloff never meets the canvas edge.
        const yc = y + self.drop;
        const room = Math.min(x, SPECIMEN_SIZE - x, yc, SPECIMEN_SIZE - yc);
        drawGlow(self.ctx, color, x, y, Math.min(radius, room), alpha);
      },
      bubbles: (x, y, o) => this.addBubbles(x, y, o),
      spark: () => {},
      exciteAt: () => {},
      jellies: [],
      anchors: [],
      quality: 1,
    };
    this.resize();
    if (spec.kind !== 'decoration') {
      void loadFactory(spec.kind).then((factory) => {
        if (this.disposed) return;
        if (!factory) {
          this.failed = true;
        } else {
          this.entity = factory({
            id: `shop:${spec.kind}:${spec.variant}`,
            variant: spec.variant,
            seed: hashString(`shop:${spec.variant}`) % 100000,
            home: { x: 0.5, y: 0.5 },
            w: SPECIMEN_SIZE,
            h: SPECIMEN_SIZE,
            scale: SPECIMEN_SCALE[spec.variant === 'cyan' && spec.kind === 'jellyfish' ? 'moon' : spec.kind] ?? 1,
            specimen: true,
          });
          // Settle the tentacles before the first frame is seen, then set it on the baseline.
          for (let i = 0; i < 45; i++) this.step(FRAME, false);
          this.drop = this.measureDrop();
        }
        this.stale = true;
      });
    }
    canvas.addEventListener('pointerdown', this.onDown);
    canvas.addEventListener('pointerup', this.onUp);
    canvas.addEventListener('pointercancel', this.onCancel);
    register(this);
  }

  /** Re-reads devicePixelRatio and sizes the backing store (capped at 2). */
  resize() {
    this.dpr = Math.min(2, Math.max(1, devicePixelRatio || 1));
    const px = Math.round(SPECIMEN_SIZE * this.dpr);
    if (this.canvas.width !== px) {
      this.canvas.width = px;
      this.canvas.height = px;
    }
    this.frame.dpr = this.dpr;
    this.frame.lineWidth = Math.max(0.75, 1 / this.dpr);
    this.stale = true;
  }

  setOutline(outline: boolean) {
    if (outline === this.outline) return;
    this.outline = outline;
    this.stale = true;
  }

  /** Where the specimen is on screen (where a bought creature leaves the plate for the sea). */
  center(): { x: number; y: number } {
    const r = this.canvas.getBoundingClientRect();
    const k = r.width / SPECIMEN_SIZE;
    const e = this.entity;
    if (!e) return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
    return { x: r.left + e.x * k, y: r.top + (e.y + this.drop) * k };
  }

  dispose() {
    this.disposed = true;
    this.canvas.removeEventListener('pointerdown', this.onDown);
    this.canvas.removeEventListener('pointerup', this.onUp);
    this.canvas.removeEventListener('pointercancel', this.onCancel);
    unregister(this);
    // Safari keeps a detached canvas's backing store alive until its size is zeroed.
    this.canvas.width = 0;
    this.canvas.height = 0;
  }

  /** Advance the creature (and its bubbles) by dt seconds. */
  step(dt: number, track = true) {
    const f = this.frame;
    f.dt = dt;
    f.t += dt;
    if (track) this.trackPointer();
    this.entity?.update(f);
    for (let i = this.bubbles.length - 1; i >= 0; i--) {
      const b = this.bubbles[i];
      b.age += dt;
      b.y -= b.vy * dt;
      if (b.age >= b.life) this.bubbles.splice(i, 1);
    }
  }

  draw() {
    const { ctx, frame: f } = this;
    this.glows = 0;
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.clearRect(0, 0, SPECIMEN_SIZE, SPECIMEN_SIZE);
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, this.dpr * this.drop);
    const ink = outlineInk();
    if (this.spec.kind === 'decoration') {
      drawDecorationSpecimen(ctx, this.spec.id, SPECIMEN_SIZE, f.t, light.lighting, {
        outline: this.outline,
        outlineColor: ink,
      });
    } else if (this.entity) {
      this.entity.draw(ctx, f, this.outline ? { outline: true, outlineColor: ink } : undefined);
      if (!this.outline) this.drawBubbles();
    } else {
      this.drawPlaceholder(ink);
    }
    this.stale = false;
  }

  /** Draws the settled creature once as a plain outline and finds its lowest point. */
  private measureDrop(): number {
    const e = this.entity;
    if (!e) return 0;
    const { ctx, canvas, dpr } = this;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, SPECIMEN_SIZE, SPECIMEN_SIZE);
    e.draw(ctx, this.frame, { outline: true, outlineColor: '#FFFFFF' });
    const w = canvas.width;
    const data = ctx.getImageData(0, 0, w, canvas.height).data;
    ctx.clearRect(0, 0, SPECIMEN_SIZE, SPECIMEN_SIZE);
    for (let y = canvas.height - 1; y >= 0; y--) {
      for (let x = 0, i = y * w * 4 + 3; x < w; x++, i += 4) {
        if (data[i] > 40) return Math.max(0, Math.min(44, BASELINE - (y + 1) / dpr));
      }
    }
    return 0;
  }

  private drawPlaceholder(ink: string) {
    // A faint hairline ring where the specimen will be (its module has not loaded).
    const ctx = this.ctx;
    ctx.save();
    ctx.strokeStyle = ink;
    ctx.globalAlpha = this.failed ? 0.18 : 0.3;
    ctx.lineWidth = this.frame.lineWidth;
    ctx.beginPath();
    ctx.ellipse(SPECIMEN_SIZE / 2, SPECIMEN_SIZE * 0.45, 26, 30, 0, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
  }

  /** Screen point to this specimen's own coordinates. */
  private toLocal(cx: number, cy: number, r: DOMRect): { x: number; y: number } {
    const k = r.width / SPECIMEN_SIZE || 1;
    return { x: (cx - r.left) / k, y: (cy - r.top) / k - this.drop };
  }

  private trackPointer() {
    const r = this.canvas.getBoundingClientRect();
    const lp = this.localPointer;
    const p = this.toLocal(pointer.x, pointer.y, r);
    lp.x = p.x;
    lp.y = p.y;
    lp.active = pointer.active;
    lp.down = pointer.down;
  }

  private addBubbles(x: number, y: number, o: BubbleOptions = {}) {
    const n = Math.min(10, o.count ?? 6);
    const [s0, s1] = o.speed ?? [30, 45];
    const [r0, r1] = o.size ?? [1.5, 3.5];
    const night = light.lighting.num('bodyDarken', PLATE_Y) > 0.2;
    const color = o.color ?? '#FFFFFF';
    for (let i = 0; i < n; i++) {
      this.bubbles.push({
        x: x + (Math.random() - 0.5) * 2 * (o.spread ?? 8),
        y: y - Math.random() * 6,
        vy: s0 + Math.random() * (s1 - s0),
        r: r0 + Math.random() * (r1 - r0),
        age: 0,
        life: 2 + Math.random(),
        phase: Math.random() * 6.28,
        color: night || o.color ? color : '#FFFFFF',
      });
    }
  }

  private drawBubbles() {
    const ctx = this.ctx;
    if (!this.bubbles.length) return;
    ctx.save();
    ctx.lineWidth = this.frame.lineWidth;
    for (const b of this.bubbles) {
      const fade = b.age > b.life - 0.8 ? (b.life - b.age) / 0.8 : 1;
      const s = 1 + 0.3 * Math.max(0, (b.age - (b.life - 0.8)) / 0.8);
      const x = b.x + Math.sin(b.age * 4 + b.phase) * 3;
      ctx.globalAlpha = 0.6 * fade;
      ctx.strokeStyle = b.color;
      ctx.beginPath();
      ctx.arc(x, b.y, b.r * s, 0, Math.PI * 2);
      ctx.stroke();
      ctx.globalAlpha = 0.8 * fade;
      ctx.beginPath();
      ctx.arc(x, b.y, b.r * s * 0.6, -2.4, -1.6);
      ctx.stroke();
    }
    ctx.restore();
  }

  // A tap on a live specimen gets the same reaction as in the sea: light first, then motion.
  private onDown = (e: PointerEvent) => {
    this.downAt = { x: e.clientX, y: e.clientY, t: performance.now(), id: e.pointerId };
  };
  private onUp = (e: PointerEvent) => {
    const d = this.downAt;
    this.downAt = null;
    if (!d || d.id !== e.pointerId || !this.entity || this.outline) return;
    if (Math.hypot(e.clientX - d.x, e.clientY - d.y) > 10 || performance.now() - d.t > 400) return;
    const p = this.toLocal(e.clientX, e.clientY, this.canvas.getBoundingClientRect());
    if (this.entity.hitTest(p.x, p.y) || this.spec.kind === 'jellyfish') {
      this.entity.tap(this.frame);
      wake();
    }
  };
  private onCancel = () => {
    this.downAt = null;
  };
}

/**
 * Size on a plate. Jellies fit themselves to the plate; the moon jelly is a flat saucer and
 * reads small, so it is drawn a little larger. Seahorses are 46px tall in the sea.
 */
const SPECIMEN_SCALE: Record<string, number> = { moon: 1.14, seahorse: 2.2 };

// ---------------------------------------------------------------------------
// Scheduler: one loop at 30fps for every plate.
// ---------------------------------------------------------------------------

const stages = new Set<SpecimenStage>();
let raf = 0;
let last = 0;
let io: IntersectionObserver | null = null;

function observer(): IntersectionObserver {
  if (!io) {
    io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          for (const s of stages) if (s.canvas === e.target) s.visible = e.isIntersecting;
        }
        wake();
      },
      { threshold: 0 },
    );
  }
  return io;
}

function onResize() {
  for (const s of stages) s.resize();
  wake();
}

function register(s: SpecimenStage) {
  if (stages.size === 0) {
    addEventListener('pointermove', onPointerMove, { passive: true });
    addEventListener('pointerdown', onPointerDown, { passive: true });
    addEventListener('pointerup', onPointerUp, { passive: true });
    addEventListener('pointercancel', onPointerUp, { passive: true });
    addEventListener('pointerout', onPointerOut, { passive: true });
    addEventListener('resize', onResize);
  }
  stages.add(s);
  observer().observe(s.canvas);
  wake();
}

function unregister(s: SpecimenStage) {
  stages.delete(s);
  io?.unobserve(s.canvas);
  if (stages.size === 0) {
    removeEventListener('pointermove', onPointerMove);
    removeEventListener('pointerdown', onPointerDown);
    removeEventListener('pointerup', onPointerUp);
    removeEventListener('pointercancel', onPointerUp);
    removeEventListener('pointerout', onPointerOut);
    removeEventListener('resize', onResize);
    cancelAnimationFrame(raf);
    raf = 0;
  }
}

function wake() {
  if (!raf && stages.size) {
    last = performance.now() / 1000;
    raf = requestAnimationFrame(loop);
  }
}

function loop(ms: number) {
  raf = requestAnimationFrame(loop);
  const now = ms / 1000;
  if (now - last < FRAME - 0.004) return;
  const dt = Math.min(0.05, now - last);
  last = now;
  light.tick(now);
  const changing = light.p < 1 || (light.bio > 0 && light.bio < 1);

  const visible: SpecimenStage[] = [];
  for (const s of stages) if (s.visible) visible.push(s);
  if (visible.length > MAX_LIVE) {
    // Animate the plates nearest the start of the strip; hold the rest on their last frame.
    const left = new Map(visible.map((s) => [s, s.canvas.getBoundingClientRect().left]));
    visible.sort((a, b) => left.get(a)! - left.get(b)!);
  }
  visible.forEach((s, i) => {
    if (i < MAX_LIVE) {
      s.step(dt);
      s.draw();
    } else if (s.stale || changing) {
      s.draw();
    }
  });
  if (!visible.length) {
    cancelAnimationFrame(raf);
    raf = 0;
  }
}

function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}
