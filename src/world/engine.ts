/**
 * The scene engine: one rAF loop outside React.
 *
 * It owns the canvas and DPR, the half-resolution far buffer, Lighting ("Light descends"),
 * the per-frame WorldFrame, the glow budget, adaptive quality, input and hit-testing,
 * particles, the camera (drift, desktop pointer parallax, shop shift), the hero-event queue
 * (greeting > bottle > whale) and the Guardian's Wake.
 *
 * Coordinates: entities keep world positions (before parallax) and add their own layer's
 * parallax when drawing and hit-testing. Hit-tests and events use raw screen CSS px.
 */
import { brisbaneHours } from '../utils/day';
import type { LightingMode } from '../types/sanctuary';
import type {
  CreatureEntity,
  CreatureInit,
  Engine,
  EngineEvent,
  EngineEventOf,
  EngineEventType,
  SceneCreature,
  SceneInput,
  WhaleEntity,
  WorldFrame,
} from './types';
import { createLighting } from './lighting';
import { createParticles } from './particles';
import { createScenery } from './scenery';
import { createWorldObjects } from './objects';
import { createJellyfish } from './creatures/jellyfish';
import { createSeahorse, createSeahorseDirector } from './creatures/seahorse';
import { createWhale } from './creatures/whale';
import { drawGlow } from './light';
import { range, stream } from './rng';
import { gift } from '../config/gift';

const MAX_DT = 0.05;
/**
 * Most canvas pixels drawn per frame. A phone (402 x 874 at 2x, 1.4M) is well under it; a
 * MacBook window at 2x (about 6M) is scaled down to it, which the soft scene hardly shows.
 */
const PIXEL_BUDGET = 2.6e6;
/**
 * The sea is drawn at most 60 times a second, also on 120Hz screens (ProMotion MacBooks and
 * iPhones): the motion is slow, and it halves the work there.
 */
const MIN_FRAME_MS = 1000 / 60 - 2;
const GLOW_BUDGET = 24;
const RESIZE_DEBOUNCE_MS = 150;
const TAP_SLOP = 10;
const TAP_MS = 400;
const INPUT_EVERY_MS = 250;
const DESCENT_EVERY = 0.05;

const HERO_GAP = 20;
const HERO_WARMUP = 4;
const WHALE_FIRST = 90;
const WHALE_EVERY: [number, number] = [300, 600];
/** A dial tap waits at most this long for a hero event's climax, so the light starts sinking almost at once. */
const MODE_WAIT = 1;

const WAKE_SPEED = 300;
const WAKE_TIME = 3.2;
const WAKE_EXHALE_AT = 0.6;
const WAKE_RELEASE_AT = 1.4;
const WAKE_KICK_STEP = 24;
const RIBBON_ODDS = 1 / 6;
const RIBBON_MIN_CREATURES = 3;

const SHOP_SHIFT = 0.06;
const SHOP_EASE_S = 0.9;
const DRIFT_PX = 10;
const DRIFT_PERIOD = 120;
const DRIFT_LAYER = 9;
const POINTER_LP = 0.04;

/** Layer parallax (max px), §4.1. */
const PX_WHALE = 1.5;
const PX_SEAHORSE = 6;
const jellyPx = (z: number) => 4 + 4 * z;

/**
 * Adaptive quality (WorldFrame.quality): 1 full, 0.8 particles halved, 0.5 and below caustics
 * dropped, then dpr 1.5 (0.45) and dpr 1 (0.4).
 *
 * It decides on the work a frame costs (script time per frame), not on the frame interval:
 * iOS Low Power Mode caps rAF at 30fps, and a steady ~33ms interval says nothing about load.
 * The display's refresh is taken as the shortest interval seen in a window, so a capped display
 * shows no missed frames. After sustained headroom it steps back up, waiting longer each time a
 * step up had to be undone.
 */
const QUALITY = [1, 0.8, 0.5, 0.45, 0.4];
const QUALITY_WINDOW_MS = 2000;
/** Average script time per frame above this (most of a 60Hz frame) steps down. */
const WORK_DOWN_MS = 11;
/** Missing refreshes on this share of frames while doing real work also steps down. */
const MISS_SHARE = 0.25;
const MISS_WORK_MS = 6;
/**
 * Missing this share of refreshes steps down whatever the script time. On desktop Chrome the
 * canvas is painted on the GPU after the script returns, so a big Retina window can drop frames
 * while the script itself looks cheap.
 */
const MISS_SHARE_ANY = 0.4;
/** Below this, with almost no missed refreshes, counts as headroom. */
const WORK_UP_MS = 5;
/** Windows of headroom in a row before stepping back up (doubles after each undone step up). */
const UP_WINDOWS = 5;
const UP_WINDOWS_MAX = 60;
/** A step down this soon after a step up means the step up did not hold. */
const UP_HOLD_MS = 30000;

const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);

/** CSS cubic-bezier timing function (x -> y), solved by bisection. */
function cubicBezier(x1: number, y1: number, x2: number, y2: number): (x: number) => number {
  const bx = (t: number) => 3 * x1 * t * (1 - t) ** 2 + 3 * x2 * t * t * (1 - t) + t ** 3;
  const by = (t: number) => 3 * y1 * t * (1 - t) ** 2 + 3 * y2 * t * t * (1 - t) + t ** 3;
  return (x) => {
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
const easeEnter = cubicBezier(0.16, 1, 0.3, 1);

type Hero = 'greeting' | 'bottle' | 'whale';

interface Wake {
  x: number;
  y: number;
  age: number;
  amp: number;
  woken: Set<string>;
  kickR: number;
  exhaled: boolean;
  released: boolean;
}

/** Creates the engine. Call mount(canvas) to start it; sync() and setMode() may come first. */
export function createEngine(): Engine {
  const lighting = createLighting();
  const particles = createParticles();
  const scenery = createScenery();
  const director = createSeahorseDirector();
  const listeners = new Map<EngineEventType, Set<(e: EngineEvent) => void>>();

  function emit(e: EngineEvent) {
    const set = listeners.get(e.type);
    if (!set) return;
    for (const fn of [...set]) {
      try {
        fn(e);
      } catch (err) {
        console.error(err);
      }
    }
  }

  const objects = createWorldObjects({
    onBottle: (state, x, y) => emit({ type: 'bottle', state, x, y }),
    onPearl: (phase, x, y) => emit({ type: 'guardianPearl', phase, x, y }),
  });

  // Errors inside one module are logged once and that module is skipped for the frame, so a
  // single bad draw never takes the whole sea down.
  const reported = new Set<string>();
  function guard(name: string, fn: () => void) {
    try {
      fn();
    } catch (err) {
      if (!reported.has(name)) {
        reported.add(name);
        console.error(`[engine] ${name}:`, err);
      }
    }
  }
  // Dev: script time per layer (ms), accumulated until debug() reads and resets it.
  const prof: Map<string, number> | null = import.meta.env.DEV ? new Map() : null;
  let profFrames = 0;
  function timed(name: string, fn: () => void) {
    if (!prof) {
      guard(name, fn);
      return;
    }
    const t0 = performance.now();
    (window as unknown as { __layer?: string }).__layer = name;
    guard(name, fn);
    prof.set(name, (prof.get(name) ?? 0) + performance.now() - t0);
  }
  function layer(name: string, c: CanvasRenderingContext2D, fn: () => void) {
    c.save();
    timed(name, fn);
    c.restore();
  }

  // ---------------------------------------------------------------------------
  // Canvas, size, DPR
  // ---------------------------------------------------------------------------

  let canvas: HTMLCanvasElement | null = null;
  let ctx: CanvasRenderingContext2D | null = null;
  let far: HTMLCanvasElement | null = null;
  let farCtx: CanvasRenderingContext2D | null = null;
  let w = 0;
  let h = 0;
  let dpr = 1;
  let dprCap = 2;
  let phone = false;
  let scaleX = 1;
  let scaleY = 1;
  let farScaleX = 0.5;
  let farScaleY = 0.5;
  let rectLeft = 0;
  let rectTop = 0;
  let sized = false;
  let resizeTimer: ReturnType<typeof setTimeout> | null = null;
  let dprQuery: MediaQueryList | null = null;

  // ---------------------------------------------------------------------------
  // Frame
  // ---------------------------------------------------------------------------

  let t = 0;
  let glowCount = 0;
  let glowTarget: CanvasRenderingContext2D | null = null;
  const pointer = { x: -9999, y: -9999, active: false, down: false };
  const jellyPositions: { id: string; x: number; y: number; z: number }[] = [];

  const camRand = stream('camera');
  const driftPhaseX = range(camRand, 0, Math.PI * 2);
  const driftPhaseY = range(camRand, 0, Math.PI * 2);
  let pnx = 0;
  let pny = 0;
  let ptx = 0;
  let pty = 0;
  let shift = 0;
  let shiftFrom = 0;
  let shiftTo = 0;
  let shiftT = 1;

  function parallax(maxPx: number): { x: number; y: number } {
    let x = 0;
    let y = 0;
    if (!lighting.reducedMotion) {
      const k = maxPx / DRIFT_LAYER;
      x = Math.sin((t * Math.PI * 2) / DRIFT_PERIOD + driftPhaseX) * DRIFT_PX * k - pnx * maxPx;
      y = Math.sin((t * Math.PI * 2) / (DRIFT_PERIOD * 1.37) + driftPhaseY) * DRIFT_PX * 0.35 * k - pny * maxPx * 0.5;
    }
    if (shift > 0) {
      // Far layers move 0.3 of the shift, L6 (14px) the full 6% of H.
      const k = 0.3 + 0.7 * clamp01((maxPx - 1) / 13);
      y -= shift * SHOP_SHIFT * h * k;
    }
    return { x, y };
  }

  const frame: WorldFrame = {
    t: 0,
    dt: 0,
    w: 0,
    h: 0,
    dpr: 1,
    phone: false,
    lineWidth: 1,
    lighting,
    pointer,
    parallax,
    glow(color, x, y, radius, alpha) {
      if (alpha <= 0.003 || radius <= 0 || !glowTarget) return;
      if (glowCount >= GLOW_BUDGET) return;
      glowCount++;
      drawGlow(glowTarget, color, x, y, radius, alpha);
    },
    bubbles: (x, y, opts) => particles.bubbles(x, y, frame, opts),
    spark: (x, y, vx, vy, life) => particles.spark(x, y, vx, vy, life),
    exciteAt: (x, y, radius, strength) => particles.exciteAt(x, y, radius, strength, frame),
    jellies: jellyPositions,
    anchors: [],
    quality: 1,
  };

  // ---------------------------------------------------------------------------
  // Entities
  // ---------------------------------------------------------------------------

  const creatures = new Map<string, CreatureEntity>();
  let jellyList: CreatureEntity[] = [];
  let seahorseList: CreatureEntity[] = [];
  let whale: WhaleEntity | null = null;
  let input: SceneInput | null = null;
  const spawnHints = new Map<string, { x: number; y: number }>();
  let ribbonFrom: { x: number; y: number } | null = null;
  let decoKey = '';
  let shelfKey = '';
  let shelfIds: string[] = [];

  function layerPx(e: CreatureEntity): number {
    return e.kind === 'jellyfish' ? jellyPx(e.z) : PX_SEAHORSE;
  }

  /** Where a creature is on screen right now (callouts, focus ring, wake reach). */
  function screenOf(e: CreatureEntity): { x: number; y: number } {
    const p = parallax(layerPx(e));
    return { x: e.x + p.x, y: e.y + p.y };
  }

  function spawn(c: SceneCreature): CreatureEntity | null {
    const seed = Math.floor(stream('creature:' + c.id)() * 0x100000000) >>> 0;
    let from = spawnHints.get(c.id) ?? null;
    spawnHints.delete(c.id);
    if (!from && c.variant === 'ribbon' && ribbonFrom) from = ribbonFrom;
    if (c.variant === 'ribbon') ribbonFrom = null;
    const p = parallax(c.type === 'jellyfish' ? jellyPx(0.7) : PX_SEAHORSE);
    const init: CreatureInit = {
      id: c.id,
      variant: c.variant,
      seed,
      home: { x: clamp01(c.position.x / 100), y: clamp01(c.position.y / 100) },
      w,
      h,
      from: from ? { x: from.x - p.x, y: from.y - p.y } : undefined,
    };
    let entity: CreatureEntity | null = null;
    guard(`spawn ${c.type}`, () => {
      entity = c.type === 'jellyfish' ? createJellyfish(init) : createSeahorse(init);
    });
    return entity;
  }

  function applyInput() {
    if (!input || !sized) return;
    // A new day while the sea is open: today's bottle and greeting may come again.
    if (input.bottleAvailable && !lastBottleAvailable) bottleArrived = false;
    if (input.greetingDue && !lastGreetingDue) greetingTried = false;
    lastBottleAvailable = input.bottleAvailable;
    lastGreetingDue = input.greetingDue;
    const seen = new Set<string>();
    for (const c of input.creatures) {
      seen.add(c.id);
      let e = creatures.get(c.id);
      if (!e) {
        const made = spawn(c);
        if (!made) continue;
        e = made;
        creatures.set(c.id, e);
      }
      e.happiness = c.happiness;
    }
    for (const id of [...creatures.keys()]) {
      if (seen.has(id)) continue;
      creatures.delete(id);
      if (focusId === id) focusCreature(null);
    }
    jellyList = [...creatures.values()].filter((e) => e.kind === 'jellyfish');
    seahorseList = [...creatures.values()].filter((e) => e.kind === 'seahorse');

    const nextDeco = input.decorations.join(',');
    if (nextDeco !== decoKey) {
      decoKey = nextDeco;
      const ids = input.decorations;
      guard('scenery.setDecorations', () => scenery.setDecorations(ids));
    }
    shelfIds = input.shelf.slice(-7);
    const nextShelf = shelfIds.join(',');
    if (nextShelf !== shelfKey) {
      shelfKey = nextShelf;
      guard('objects.setShelf', () => objects.setShelf(scenery.shelf(), shelfIds));
    }
  }

  // ---------------------------------------------------------------------------
  // Hero events: greeting > bottle > whale, never overlapping, 20s apart
  // ---------------------------------------------------------------------------

  let hero: Hero | null = null;
  let heroEndedAt = -Infinity;
  let greetingRequested = false;
  let greetingTried = false;
  let bottleArrived = false;
  let bottleForced = false;
  let lastBottleAvailable = false;
  let lastGreetingDue = false;
  let whaleDueAt = WHALE_FIRST;
  let whaleForced = false;
  let whalePhase: 'none' | 'arriving' | 'passing' = 'none';
  let whaleTapped = false;
  let ribbonEmitted = false;
  let wake: Wake | null = null;
  let pendingMode: { mode: LightingMode; until: number } | null = null;

  const BOTTLE_BUSY = new Set(['arriving', 'opening', 'open', 'closing']);
  const bottleIdle = () => objects.bottleState === 'hidden' || objects.bottleState === 'shelved';

  function endHero() {
    hero = null;
    heroEndedAt = t;
  }

  function startWhale() {
    if (!whale) return;
    whaleForced = false;
    const w0 = whale;
    let ok = false;
    guard('whale.start', () => {
      w0.start(frame, Math.random() < 0.5 ? 1 : -1);
      ok = true;
    });
    if (!ok) return;
    hero = 'whale';
    whalePhase = 'arriving';
    whaleTapped = false;
    emit({ type: 'whale', phase: 'arriving' });
  }

  function updateHero() {
    if (hero === 'greeting' && !director.greeting) {
      endHero();
      emit({ type: 'greeting', phase: 'end' });
    } else if (hero === 'bottle' && !BOTTLE_BUSY.has(objects.bottleState)) {
      endHero();
    } else if (hero === 'whale' && whale && !whale.active) {
      endHero();
      whaleDueAt = t + range(Math.random, WHALE_EVERY[0], WHALE_EVERY[1]);
    }

    // Whale phase events follow the whale itself.
    if (whale && whalePhase !== 'none') {
      if (!whale.active) {
        whalePhase = 'none';
        emit({ type: 'whale', phase: 'gone' });
      } else if (whalePhase === 'arriving') {
        const c = whale.center();
        if (c.x > w * 0.05 && c.x < w * 0.95) {
          whalePhase = 'passing';
          emit({ type: 'whale', phase: 'passing' });
        }
      }
    }

    if (hero) return;
    // A bottle being opened from the shelf or a note being read is not interrupted either.
    if (BOTTLE_BUSY.has(objects.bottleState) && objects.bottleState !== 'arriving') return;

    const ready = t >= HERO_WARMUP && t - heroEndedAt >= HERO_GAP;

    // Forced (debug) events skip the timers but still never overlap.
    if (whaleForced) {
      startWhale();
      return;
    }
    if (bottleForced && bottleIdle()) {
      startBottle();
      return;
    }
    if (!ready) return;

    if ((input?.greetingDue || greetingRequested) && !greetingTried && seahorseList.length >= 2) {
      greetingTried = true;
      greetingRequested = false;
      let started = false;
      guard('director.startGreeting', () => {
        started = director.startGreeting(seahorseList, frame);
      });
      if (started) {
        hero = 'greeting';
        emit({ type: 'greeting', phase: 'start' });
        return;
      }
    }

    if (input?.bottleAvailable && !bottleArrived && bottleIdle() && brisbaneHours() >= 6) {
      startBottle();
      return;
    }

    if (t >= whaleDueAt) startWhale();
  }

  function startBottle() {
    bottleForced = false;
    bottleArrived = true;
    guard('objects.bottleArrive', () => objects.bottleArrive(frame));
    hero = 'bottle';
  }

  /** A hero event at its peak; a mode change waits for it (at most MODE_WAIT). */
  function climax(): boolean {
    return (wake !== null && wake.age < WAKE_TIME) || director.greeting || objects.bottleState === 'opening';
  }

  // ---------------------------------------------------------------------------
  // The Guardian's Wake
  // ---------------------------------------------------------------------------

  function startWake(x: number, y: number) {
    whaleTapped = true;
    wake = {
      x,
      y,
      age: 0,
      amp: lighting.reducedMotion ? 0.5 : 1,
      woken: new Set(),
      kickR: 0,
      exhaled: false,
      released: false,
    };
    // Light first: the plankton under the finger answer on this very frame.
    particles.exciteAt(x, y, 36, wake.amp, frame);
    emit({ type: 'whaleTap', x, y });
  }

  function kickRing(cx: number, cy: number, r: number) {
    const n = Math.min(160, Math.max(6, Math.ceil((Math.PI * 2 * r) / 48)));
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2;
      const x = cx + Math.cos(a) * r;
      const y = cy + Math.sin(a) * r;
      if (x < -40 || x > w + 40 || y < h * 0.25 || y > h + 40) continue;
      scenery.kick(x, y, 40);
    }
  }

  function releaseGifts() {
    if (!whale) return;
    const p = whale.releasePoint();
    const from = { x: Math.min(w * 0.92, Math.max(w * 0.08, p.x)), y: Math.min(h * 0.6, Math.max(h * 0.12, p.y)) };
    guard('objects.releasePearl', () => objects.releasePearl(from, frame));
    const owned = input?.creatures.length ?? 0;
    const odds = import.meta.env.DEV && /[?&]ribbon=1/.test(location.search) ? 1 : RIBBON_ODDS;
    if (!ribbonEmitted && !input?.hasRibbon && owned >= RIBBON_MIN_CREATURES && Math.random() < odds) {
      ribbonEmitted = true;
      const q = parallax(PX_WHALE);
      const at = { x: from.x + q.x + 18, y: from.y + q.y + 6 };
      ribbonFrom = at;
      emit({ type: 'ribbonReleased', x: at.x, y: at.y });
    }
  }

  function updateWake(dt: number) {
    if (!wake) return;
    const wk = wake;
    wk.age += dt;
    const a = wk.age;
    if (a < WAKE_TIME) {
      const r = WAKE_SPEED * a;
      particles.wakeFront(wk.x, wk.y, r, WAKE_SPEED * dt, a, wk.amp, frame);
      if (r - wk.kickR >= WAKE_KICK_STEP) {
        wk.kickR = r;
        guard('scenery.kick', () => kickRing(wk.x, wk.y, r));
      }
      for (const e of creatures.values()) {
        if (wk.woken.has(e.id)) continue;
        const p = screenOf(e);
        if (Math.hypot(p.x - wk.x, p.y - wk.y) > r) continue;
        wk.woken.add(e.id);
        guard(`wake ${e.kind}`, () => e.wake(frame, wk.amp * (1 - a / WAKE_TIME)));
      }
    }
    if (!wk.exhaled && a >= WAKE_EXHALE_AT) {
      wk.exhaled = true;
      if (whale?.active) guard('whale.exhale', () => whale!.exhale(frame));
    }
    if (!wk.released && a >= WAKE_RELEASE_AT) {
      wk.released = true;
      releaseGifts();
    }
    // (The shafts brighten 20% in Scenery, driven by the kicks above.)
    if (a >= WAKE_TIME && wk.released) wake = null;
  }

  const BAND_POINTS = 200;
  const bandBuf = {
    cos: new Float32Array(BAND_POINTS + 1),
    sin: new Float32Array(BAND_POINTS + 1),
    wob: new Float32Array(BAND_POINTS + 1),
  };

  /**
   * Day and Sunset: the front is a subtle refractive band, a bright crest (peak α .15) with a
   * faint trough trailing it, both wobbling slightly. At night the plankton carry the front.
   */
  function drawWakeBand(c: CanvasRenderingContext2D) {
    if (!wake || wake.age >= WAKE_TIME) return;
    const wk = wake;
    const a = wk.age;
    const r = WAKE_SPEED * a;
    const day = 1 - lighting.biolum(clamp01(wk.y / h));
    const strength = (1 - a / WAKE_TIME) * wk.amp * day;
    if (strength < 0.03 || r < 4) return;
    const n = Math.min(BAND_POINTS, Math.max(36, Math.round(r / 4)));
    const { cos, sin, wob } = bandBuf;
    for (let i = 0; i <= n; i++) {
      const th = (i / n) * Math.PI * 2;
      cos[i] = Math.cos(th);
      sin[i] = Math.sin(th);
      wob[i] = 2.6 * Math.sin(th * 5 + t * 1.7) + 1.5 * Math.sin(th * 9 - t * 2.3);
    }
    // Filled only, so the ring is closed with a line back to its start (closePath() costs Chrome
    // time in proportion to the subpath's length, and a fill closes it regardless).
    const annulus = (o0: number, o1: number) => {
      c.beginPath();
      const r0 = Math.max(0, r + o1 + wob[0]);
      const sx = wk.x + cos[0] * r0;
      const sy = wk.y + sin[0] * r0;
      c.moveTo(sx, sy);
      for (let i = 1; i <= n; i++) {
        const rr = Math.max(0, r + o1 + wob[i]);
        c.lineTo(wk.x + cos[i] * rr, wk.y + sin[i] * rr);
      }
      for (let i = n; i >= 0; i--) {
        const rr = Math.max(0, r + o0 + wob[i]);
        c.lineTo(wk.x + cos[i] * rr, wk.y + sin[i] * rr);
      }
      c.lineTo(sx, sy);
      c.fill();
    };
    const STEP = 2;
    // Trailing trough: light pulled into the crest leaves the water just behind it a touch darker.
    c.globalCompositeOperation = 'source-over';
    c.fillStyle = lighting.waterAt(clamp01(wk.y / h + 0.25));
    for (let o = -40; o < -8; o += STEP) {
      const g = Math.exp(-(((o + STEP / 2 + 22) / 9) ** 2));
      c.globalAlpha = 0.05 * strength * g;
      annulus(o, o + STEP);
    }
    // The crest.
    c.globalCompositeOperation = 'screen';
    c.fillStyle = lighting.color('window', 0.2);
    for (let o = -16; o < 14; o += STEP) {
      const g = Math.exp(-(((o + STEP / 2) / 6.5) ** 2));
      c.globalAlpha = 0.15 * strength * g;
      annulus(o, o + STEP);
    }
  }

  // ---------------------------------------------------------------------------
  // Focus ring (keyboard / a11y)
  // ---------------------------------------------------------------------------

  let focusId: string | null = null;

  function creatureAt(id: string): { x: number; y: number; r: number } | null {
    const e = creatures.get(id);
    if (!e) return null;
    const p = screenOf(e);
    return { x: p.x, y: p.y, r: e.hitRadius };
  }

  function focusCreature(id: string | null) {
    const at = id ? creatureAt(id) : null;
    focusId = at ? id : null;
    if (at && id) emit({ type: 'focus', id, x: at.x, y: at.y, r: at.r });
    else emit({ type: 'focus', id: null, x: 0, y: 0, r: 0 });
  }

  function drawFocusRing(c: CanvasRenderingContext2D) {
    if (!focusId) return;
    const at = creatureAt(focusId);
    if (!at) return;
    const yN = clamp01(at.y / h);
    c.strokeStyle = lighting.color(yN < 0.45 ? 'inkTop' : 'inkDeep', yN);
    c.globalAlpha = 0.9;
    c.lineWidth = 1;
    c.beginPath();
    c.arc(at.x, at.y, at.r, 0, Math.PI * 2);
    c.stroke();
  }

  // ---------------------------------------------------------------------------
  // Input
  // ---------------------------------------------------------------------------

  let down: { id: number; x: number; y: number; at: number } | null = null;
  let lastInputEmit = 0;
  let lastInputT = 0;
  let mouse = false;
  let lastPointer = { x: 0, y: 0, valid: false };

  function noteInput() {
    lastInputT = t;
    const now = performance.now();
    if (now - lastInputEmit >= INPUT_EVERY_MS) {
      lastInputEmit = now;
      emit({ type: 'input' });
    }
  }

  function localXY(e: PointerEvent) {
    return { x: e.clientX - rectLeft, y: e.clientY - rectTop };
  }

  function tapCreature(e: CreatureEntity) {
    guard(`tap ${e.kind}`, () => e.tap(frame));
    if (e.kind === 'seahorse') guard('director.noteFed', () => director.noteFed(e.id, frame));
    const p = screenOf(e);
    emit({ type: 'creatureTap', id: e.id, x: p.x, y: p.y, r: e.hitRadius });
  }

  function tapAt(x: number, y: number) {
    // 1. Guardian pearl, daily bottle, kept bottles.
    let hit: ReturnType<typeof objects.hit> = null;
    guard('objects.hit', () => {
      hit = objects.hit(x, y);
    });
    const oh = hit as ReturnType<typeof objects.hit>;
    if (oh) {
      if (oh.kind === 'pearl') guard('objects.collectPearl', () => objects.collectPearl(frame));
      else if (oh.kind === 'bottle') emit({ type: 'bottleTap', x, y });
      else emit({ type: 'shelfBottleTap', messageId: oh.messageId, x, y });
      return;
    }
    // 2. Creatures: nearest to the finger first; nearer jellies win close calls.
    let best: CreatureEntity | null = null;
    let bestScore = Infinity;
    for (const e of creatures.values()) {
      let inside = false;
      guard(`hit ${e.kind}`, () => {
        inside = e.hitTest(x, y);
      });
      if (!inside) continue;
      const p = screenOf(e);
      const score = Math.hypot(p.x - x, p.y - y) - 20 * e.z;
      if (score < bestScore) {
        bestScore = score;
        best = e;
      }
    }
    if (best) {
      tapCreature(best);
      return;
    }
    // 3. The whale, once per pass.
    if (whale?.active && !whaleTapped) {
      let inside = false;
      guard('whale.hitTest', () => {
        inside = whale!.hitTest(x, y);
      });
      if (inside) {
        startWake(x, y);
        return;
      }
    }
    // 4. The chest.
    let chest = false;
    guard('scenery.chestHit', () => {
      chest = scenery.chestHit(x, y);
    });
    if (chest) {
      guard('scenery.openChest', () => scenery.openChest());
      emit({ type: 'chestTap', x, y });
      return;
    }
    // Open water: at night the plankton under the finger answer.
    particles.exciteAt(x, y, 34, 0.8, frame);
  }

  function onPointerDown(e: PointerEvent) {
    if (!e.isPrimary) return;
    const p = localXY(e);
    mouse = e.pointerType === 'mouse';
    pointer.x = p.x;
    pointer.y = p.y;
    pointer.down = true;
    pointer.active = true;
    lastPointer = { x: p.x, y: p.y, valid: true };
    down = { id: e.pointerId, x: p.x, y: p.y, at: performance.now() };
    try {
      canvas?.setPointerCapture(e.pointerId);
    } catch {
      // Capture is a nicety; some browsers refuse it for synthetic events.
    }
    noteInput();
  }

  function onPointerMove(e: PointerEvent) {
    if (!e.isPrimary) return;
    const p = localXY(e);
    mouse = e.pointerType === 'mouse';
    pointer.x = p.x;
    pointer.y = p.y;
    if (mouse) {
      pointer.active = true;
      if (w > 0 && h > 0) {
        ptx = (p.x / w) * 2 - 1;
        pty = (p.y / h) * 2 - 1;
      }
    }
    noteInput();
  }

  function onPointerUp(e: PointerEvent) {
    if (!e.isPrimary) return;
    const p = localXY(e);
    pointer.down = false;
    if (e.pointerType !== 'mouse') pointer.active = false;
    const d = down;
    down = null;
    noteInput();
    if (!d || d.id !== e.pointerId) return;
    if (Math.hypot(p.x - d.x, p.y - d.y) <= TAP_SLOP && performance.now() - d.at <= TAP_MS) tapAt(p.x, p.y);
  }

  function onPointerCancel(e: PointerEvent) {
    if (!e.isPrimary) return;
    pointer.down = false;
    pointer.active = false;
    down = null;
  }

  function onPointerLeave(e: PointerEvent) {
    if (e.pointerType !== 'mouse') return;
    pointer.active = false;
    ptx = 0;
    pty = 0;
  }

  function onKey() {
    noteInput();
  }

  function onContextMenu(e: Event) {
    e.preventDefault();
  }

  /**
   * Taps are handled on pointerup. A touch would also synthesize a click a moment later, which
   * lands on whatever a tap just opened (a reread note's dismiss layer) and closes it again.
   */
  function onTouchEnd(e: TouchEvent) {
    if (e.cancelable) e.preventDefault();
  }

  // ---------------------------------------------------------------------------
  // Resize
  // ---------------------------------------------------------------------------

  function measure() {
    if (!canvas) return;
    const r = canvas.getBoundingClientRect();
    w = r.width > 0 ? r.width : innerWidth;
    h = r.height > 0 ? r.height : innerHeight;
    rectLeft = r.left;
    rectTop = r.top;
  }

  function resizeNow() {
    if (!canvas || !ctx) return;
    const pw = w;
    const ph = h;
    const pd = dpr;
    const pPhone = phone;
    measure();
    watchDpr();
    dpr = Math.min(window.devicePixelRatio || 1, 2, dprCap, Math.sqrt(PIXEL_BUDGET / Math.max(1, w * h)));
    phone = w < 640;
    const bw = Math.max(1, Math.round(w * dpr));
    const bh = Math.max(1, Math.round(h * dpr));
    if (canvas.width !== bw) canvas.width = bw;
    if (canvas.height !== bh) canvas.height = bh;
    scaleX = bw / w;
    scaleY = bh / h;
    if (!far) {
      far = document.createElement('canvas');
      farCtx = far.getContext('2d', { alpha: false });
    }
    const fw = Math.max(1, Math.round(w * dpr * 0.5));
    const fh = Math.max(1, Math.round(h * dpr * 0.5));
    if (far.width !== fw) far.width = fw;
    if (far.height !== fh) far.height = fh;
    farScaleX = fw / w;
    farScaleY = fh / h;

    frame.w = w;
    frame.h = h;
    frame.dpr = dpr;
    frame.phone = phone;
    frame.lineWidth = Math.max(0.75, 1 / dpr);

    if (sized && pw === w && ph === h && pd === dpr) return;

    guard('scenery.resize', () => scenery.resize(w, h, phone, dpr));
    frame.anchors = scenery.anchors ?? [];
    guard('objects.resize', () => {
      objects.resize(w, h, phone);
      objects.setSeabed((x) => scenery.seabedY(x));
      objects.setShelf(scenery.shelf(), shelfIds);
    });
    if (!whale) {
      guard('createWhale', () => {
        whale = createWhale({
          seed: Math.floor(stream('whale')() * 0x100000000) >>> 0,
          constellation: gift.constellation,
          w,
          h,
          phone,
        });
      });
    } else {
      const wh = whale;
      guard('whale.resize', () => wh.resize(w, h, phone));
    }
    particles.resize(w, h);
    // Jellies are sized for the phone or desktop layout when made; crossing over remakes them.
    if (sized && phone !== pPhone) {
      for (const e of [...creatures.values()]) if (e.kind === 'jellyfish') creatures.delete(e.id);
    }
    for (const e of creatures.values()) guard(`resize ${e.kind}`, () => e.resize(w, h));
    sized = true;
    applyInput();
    qualityWarmUntil = performance.now() + 2500;
  }

  /** Moving a window to a display with another pixel ratio fires no resize event; watch for it. */
  function watchDpr() {
    dprQuery?.removeEventListener('change', scheduleResize);
    dprQuery = typeof matchMedia === 'function' ? matchMedia(`(resolution: ${window.devicePixelRatio || 1}dppx)`) : null;
    dprQuery?.addEventListener('change', scheduleResize);
  }

  function scheduleResize() {
    if (resizeTimer) clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => {
      resizeTimer = null;
      resizeNow();
    }, RESIZE_DEBOUNCE_MS);
  }

  // ---------------------------------------------------------------------------
  // Adaptive quality
  // ---------------------------------------------------------------------------

  let qLevel = 0;
  let qWindowStart = 0;
  let qFrames = 0;
  let qWork = 0;
  let qMinInterval = Infinity;
  const qIntervals = new Float32Array(1024);
  let qUpStreak = 0;
  let qUpNeeded = UP_WINDOWS;
  let qLastUpAt = -Infinity;
  let qualityWarmUntil = 0;
  const stats = { interval: 0, work: 0, sd: 0, refresh: 0, missed: 0 };

  // Dev screenshots: headless Chrome rasterizes slowly, so `?quality=fixed` pins full quality.
  const pinnedQuality = import.meta.env.DEV && /[?&]quality=fixed/.test(location.search);

  function setQuality(level: number) {
    const next = Math.max(0, Math.min(QUALITY.length - 1, level));
    if (pinnedQuality || next === qLevel) return;
    qLevel = next;
    frame.quality = QUALITY[next];
    particles.setDensity(next >= 1 ? 0.5 : 1);
    const cap = next >= 4 ? 1 : next >= 3 ? 1.5 : 2;
    if (cap !== dprCap) {
      dprCap = cap;
      resizeNow();
    }
  }

  function resetQualityWindow(now: number) {
    qWindowStart = now;
    qFrames = qWork = 0;
    qMinInterval = Infinity;
  }

  function monitor(interval: number, work: number, now: number) {
    if (now < qualityWarmUntil) {
      resetQualityWindow(now);
      return;
    }
    if (qFrames < qIntervals.length) qIntervals[qFrames] = interval;
    qFrames++;
    qWork += work;
    if (interval > 1) qMinInterval = Math.min(qMinInterval, interval);
    if (now - qWindowStart < QUALITY_WINDOW_MS) return;
    const n = Math.min(qFrames, qIntervals.length);
    const refresh = Math.max(4, Number.isFinite(qMinInterval) ? qMinInterval : 1000 / 60);
    let sum = 0;
    let sumSq = 0;
    let missed = 0;
    for (let i = 0; i < n; i++) {
      const v = qIntervals[i];
      sum += v;
      sumSq += v * v;
      if (v > refresh * 1.6) missed++;
    }
    const avg = sum / n;
    const avgWork = qWork / qFrames;
    const missShare = missed / n;
    stats.interval = avg;
    stats.work = avgWork;
    stats.sd = Math.sqrt(Math.max(0, sumSq / n - avg * avg));
    stats.refresh = refresh;
    stats.missed = missShare;
    const heavy = avgWork > WORK_DOWN_MS || (missShare > MISS_SHARE && avgWork > MISS_WORK_MS) || missShare > MISS_SHARE_ANY;
    const headroom = avgWork < WORK_UP_MS && missShare < 0.05;
    if (heavy && qLevel < QUALITY.length - 1) {
      // A step up that did not hold: wait twice as long before trying again.
      if (now - qLastUpAt < UP_HOLD_MS) qUpNeeded = Math.min(UP_WINDOWS_MAX, qUpNeeded * 2);
      qUpStreak = 0;
      setQuality(qLevel + 1);
      qualityWarmUntil = Math.max(qualityWarmUntil, now + 1000);
    } else if (headroom && qLevel > 0) {
      if (++qUpStreak >= qUpNeeded) {
        qUpStreak = 0;
        qLastUpAt = now;
        setQuality(qLevel - 1);
        qualityWarmUntil = Math.max(qualityWarmUntil, now + 1000);
      }
    } else {
      qUpStreak = 0;
    }
    resetQualityWindow(now);
  }

  // ---------------------------------------------------------------------------
  // Loop
  // ---------------------------------------------------------------------------

  let raf = 0;
  let running = false;
  let last = 0;
  let mounted = false;
  let descentActive = false;
  let descentFrom: LightingMode = lighting.from;
  let descentTo: LightingMode = lighting.mode;
  let lastDescentEmit = -1;

  function emitDescent() {
    if (lighting.active) {
      if (!descentActive) {
        descentActive = true;
        descentFrom = lighting.from;
        descentTo = lighting.mode;
        lastDescentEmit = -1;
      }
      descentTo = lighting.mode;
      if (t - lastDescentEmit >= DESCENT_EVERY) {
        lastDescentEmit = t;
        emit({ type: 'descent', progress: lighting.progress, from: descentFrom, to: descentTo });
      }
    } else if (descentActive) {
      descentActive = false;
      emit({ type: 'descent', progress: 1, from: descentFrom, to: lighting.mode });
    }
  }

  function updateCamera(dt: number) {
    if (shiftT < 1) {
      shiftT = Math.min(1, shiftT + dt / SHOP_EASE_S);
      shift = shiftFrom + (shiftTo - shiftFrom) * easeEnter(shiftT);
    }
    const k = 1 - Math.pow(1 - POINTER_LP, dt * 60);
    const tx = mouse ? ptx : 0;
    const ty = mouse ? pty : 0;
    pnx += (tx - pnx) * k;
    pny += (ty - pny) * k;
  }

  function updatePointerTrail() {
    if (!lastPointer.valid) {
      lastPointer = { x: pointer.x, y: pointer.y, valid: pointer.active };
      return;
    }
    const dragging = pointer.down || (mouse && pointer.active);
    const dx = pointer.x - lastPointer.x;
    const dy = pointer.y - lastPointer.y;
    if (dragging && dx * dx + dy * dy > 0.25) {
      particles.drag(lastPointer.x, lastPointer.y, pointer.x, pointer.y, pointer.down, frame);
    }
    lastPointer = { x: pointer.x, y: pointer.y, valid: pointer.active };
  }

  function step(dt: number) {
    t += dt;
    frame.t = t;
    frame.dt = dt;
    glowCount = 0;

    lighting.update(dt);
    if (pendingMode && (!climax() || t >= pendingMode.until)) {
      const m = pendingMode.mode;
      pendingMode = null;
      lighting.setMode(m);
    }
    emitDescent();
    updateCamera(dt);
    updatePointerTrail();
    updateHero();
    updateWake(dt);

    // Update.
    timed('update', () => {
      particles.update(frame);
      guard('objects.update', () => objects.update(frame));
      jellyPositions.length = 0;
      for (const e of jellyList) jellyPositions.push({ id: e.id, x: e.x, y: e.y, z: e.z });
      guard('director.update', () => director.update(seahorseList, frame, Math.max(0, t - lastInputT)));
      for (const e of creatures.values()) guard(`update ${e.kind}`, () => e.update(frame));
      if (whale?.active) {
        const wh = whale;
        // Sparks the whale stirs up belong to its lane, behind the shelf and the kelp wall.
        particles.setSparkLayer('far');
        guard('whale.update', () => wh.update(frame));
        particles.setSparkLayer('near');
      }
    });

    profFrames++;
    timed('draw', draw);
  }

  function draw() {
    if (!ctx || !canvas || !far || !farCtx) return;
    const c = ctx;
    const fc = farCtx;
    const f = frame;

    // 1. Far stack into the half-resolution buffer (free depth-of-field softness).
    fc.setTransform(farScaleX, 0, 0, farScaleY, 0, 0);
    fc.globalAlpha = 1;
    fc.globalCompositeOperation = 'source-over';
    glowTarget = fc;
    layer('drawWater', fc, () => scenery.drawWater(fc, f));
    layer('drawSurface', fc, () => scenery.drawSurface(fc, f));
    layer('drawRidge', fc, () => scenery.drawRidge(fc, f));
    layer('farSnow', fc, () => particles.drawFarSnow(fc, f));
    if (whale?.active) {
      const wh = whale;
      particles.setSparkLayer('far');
      layer('whale.draw', fc, () => wh.draw(fc, f));
      particles.setSparkLayer('near');
    }
    layer('farSparks', fc, () => particles.drawFarSparks(fc, f));
    layer('drawShelf', fc, () => scenery.drawShelf(fc, f));

    // 2. Main canvas.
    c.setTransform(1, 0, 0, 1, 0, 0);
    c.globalAlpha = 1;
    c.globalCompositeOperation = 'source-over';
    c.imageSmoothingEnabled = true;
    c.imageSmoothingQuality = 'high';
    c.drawImage(far, 0, 0, canvas.width, canvas.height);
    c.setTransform(scaleX, 0, 0, scaleY, 0, 0);
    glowTarget = c;

    layer('objects.drawSurfaceBand', c, () => objects.drawSurfaceBand(c, f));
    layer('drawKelpWall', c, () => scenery.drawKelpWall(c, f));
    layer('midSnow', c, () => particles.drawMidSnow(c, f));
    jellyList.sort((a, b) => a.z - b.z);
    for (const e of jellyList) layer('jelly.draw', c, () => e.draw(c, f));
    layer('objects.drawMidwater', c, () => objects.drawMidwater(c, f));
    layer('drawReef', c, () => scenery.drawReef(c, f));
    for (const e of seahorseList) layer('seahorse.draw', c, () => e.draw(c, f));
    layer('drawSeabed', c, () => scenery.drawSeabed(c, f));
    layer('objects.drawSeabed', c, () => objects.drawSeabed(c, f));
    layer('bubbles', c, () => particles.drawBubblesAndSparks(c, f));
    layer('wakeBand', c, () => drawWakeBand(c));
    layer('drawOccluders', c, () => scenery.drawOccluders(c, f));
    layer('bokeh', c, () => particles.drawBokeh(c, f));
    layer('objects.drawForeground', c, () => objects.drawForeground(c, f));
    layer('focusRing', c, () => drawFocusRing(c));
    layer('drawVignette', c, () => scenery.drawVignette(c, f));
  }

  function loop(now: number) {
    if (!running) return;
    raf = requestAnimationFrame(loop);
    if (last && now - last < MIN_FRAME_MS) return;
    const interval = last ? now - last : 1000 / 60;
    last = now;
    const start = performance.now();
    guard('frame', () => step(Math.min(MAX_DT, Math.max(0, interval / 1000))));
    monitor(interval, performance.now() - start, now);
  }

  function start() {
    if (running || !mounted || document.hidden) return;
    running = true;
    last = 0;
    qualityWarmUntil = performance.now() + 2500;
    raf = requestAnimationFrame(loop);
  }

  function stop() {
    running = false;
    cancelAnimationFrame(raf);
  }

  function onVisibility() {
    if (document.hidden) stop();
    else start();
  }

  /**
   * A back/forward-cache restore brings the page back with its rAF chain gone but `running`
   * possibly still set (pagehide does not always fire visibilitychange first): restart the loop.
   */
  function onPageShow(e: PageTransitionEvent) {
    if (!e.persisted) return;
    stop();
    scheduleResize();
    start();
  }

  function onPageHide() {
    stop();
  }

  // ---------------------------------------------------------------------------
  // Public API
  // ---------------------------------------------------------------------------

  const engine: Engine = {
    mount(el) {
      if (mounted) engine.destroy();
      canvas = el;
      ctx = el.getContext('2d', { alpha: false });
      if (!ctx) return;
      mounted = true;
      el.style.touchAction = 'none';
      el.addEventListener('pointerdown', onPointerDown);
      el.addEventListener('pointermove', onPointerMove);
      el.addEventListener('pointerup', onPointerUp);
      el.addEventListener('pointercancel', onPointerCancel);
      el.addEventListener('pointerleave', onPointerLeave);
      el.addEventListener('contextmenu', onContextMenu);
      el.addEventListener('touchend', onTouchEnd, { passive: false });
      window.addEventListener('resize', scheduleResize);
      window.visualViewport?.addEventListener('resize', scheduleResize);
      window.addEventListener('keydown', onKey);
      document.addEventListener('visibilitychange', onVisibility);
      window.addEventListener('pageshow', onPageShow);
      window.addEventListener('pagehide', onPageHide);
      resizeNow();
      start();
    },

    destroy() {
      stop();
      if (resizeTimer) clearTimeout(resizeTimer);
      resizeTimer = null;
      const el = canvas;
      if (el) {
        el.removeEventListener('pointerdown', onPointerDown);
        el.removeEventListener('pointermove', onPointerMove);
        el.removeEventListener('pointerup', onPointerUp);
        el.removeEventListener('pointercancel', onPointerCancel);
        el.removeEventListener('pointerleave', onPointerLeave);
        el.removeEventListener('contextmenu', onContextMenu);
        el.removeEventListener('touchend', onTouchEnd);
      }
      window.removeEventListener('resize', scheduleResize);
      window.visualViewport?.removeEventListener('resize', scheduleResize);
      window.removeEventListener('keydown', onKey);
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('pageshow', onPageShow);
      window.removeEventListener('pagehide', onPageHide);
      dprQuery?.removeEventListener('change', scheduleResize);
      dprQuery = null;
      mounted = false;
    },

    sync(next) {
      input = next;
      applyInput();
    },

    setMode(mode, opts) {
      if (opts?.instant || !mounted) {
        pendingMode = null;
        lighting.setMode(mode, { instant: true });
        return;
      }
      if (climax()) {
        pendingMode = { mode, until: t + MODE_WAIT };
        return;
      }
      pendingMode = null;
      lighting.setMode(mode);
    },

    setCameraShift(open) {
      const target = open ? 1 : 0;
      if (target === shiftTo) return;
      shiftFrom = shift;
      shiftTo = target;
      shiftT = 0;
    },

    spawnHint(id, from) {
      spawnHints.set(id, from);
    },

    feed(id) {
      const e = creatures.get(id);
      if (e) tapCreature(e);
    },

    focusCreature,

    tapWhale() {
      if (!whale?.active || whaleTapped) return;
      const c = whale.center();
      const p = parallax(PX_WHALE);
      startWake(Math.min(w - 20, Math.max(20, c.x + p.x)), c.y + p.y);
    },

    tapGuardianPearl() {
      if (objects.pearlPosition()) guard('objects.collectPearl', () => objects.collectPearl(frame));
    },

    openBottle() {
      guard('objects.openBottle', () => objects.openBottle(frame));
    },

    closeBottle() {
      guard('objects.closeBottle', () => objects.closeBottle(frame));
    },

    queueGreeting() {
      greetingRequested = true;
      greetingTried = false;
    },

    creatureAt,

    waterAt: (y) => lighting.waterAt(y),

    on<T extends EngineEventType>(type: T, cb: (e: EngineEventOf<T>) => void) {
      let set = listeners.get(type);
      if (!set) {
        set = new Set();
        listeners.set(type, set);
      }
      const fn = cb as (e: EngineEvent) => void;
      set.add(fn);
      return () => {
        set.delete(fn);
      };
    },

    summonWhale() {
      if (whale?.active) return;
      whaleForced = true;
    },

    summonBottle() {
      if (!bottleIdle()) return;
      bottleForced = true;
    },
  };

  /**
   * Dev: the on-screen point nearest the whale's centre that a tap would give to the whale (its
   * hit test accepts it and no creature or object in front claims it first).
   */
  function whaleTapPoint(cx: number, cy: number): { x: number; y: number; hit: boolean } {
    const wh = whale;
    if (!wh) return { x: cx, y: cy, hit: false };
    const inView = (x: number, y: number) => {
      if (x < 24 || x > w - 24 || y < 24 || y > h - 24 || !wh.hitTest(x, y) || objects.hit(x, y)) return false;
      for (const e of creatures.values()) if (e.hitTest(x, y)) return false;
      return true;
    };
    if (inView(cx, cy)) return { x: cx, y: cy, hit: true };
    for (let r = 12; r < Math.max(w, h); r += 12) {
      for (let a = 0; a < 16; a++) {
        const x = cx + Math.cos((a / 16) * Math.PI * 2) * r;
        const y = cy + Math.sin((a / 16) * Math.PI * 2) * r * 0.5;
        if (inView(x, y)) return { x, y, hit: true };
      }
    }
    return { x: cx, y: cy, hit: false };
  }

  if (import.meta.env.DEV) {
    // Dev-only peek for the harness and screenshot scripts.
    Object.defineProperty(engine, 'debug', {
      value: () => {
        // Live screen positions (CSS px, parallax included) so test scripts can tap things on the canvas.
        const bp = objects.bottlePosition();
        const wc = whale?.active ? whale.center() : null;
        const wp = parallax(PX_WHALE);
        const profile: Record<string, number> = {};
        if (prof) {
          for (const [k, v] of prof) profile[k] = profFrames ? v / profFrames : 0;
          profile.frames = profFrames;
          prof.clear();
          profFrames = 0;
        }
        return {
          t, quality: frame.quality, qLevel, dpr, w, h, profile, ...stats, glows: glowCount, hero, whaleDueAt,
          lighting: { mode: lighting.mode, from: lighting.from, active: lighting.active, progress: lighting.progress },
          pendingMode: pendingMode?.mode ?? null,
          bottle: { state: objects.bottleState, x: bp.x, y: bp.y },
          kept: shelfIds.map((id) => ({ id, ...(objects.keptPosition(id) ?? { x: NaN, y: NaN }) })),
          pearl: objects.pearlPosition(),
          whale: wc ? { phase: whalePhase, tapped: whaleTapped, ...whaleTapPoint(wc.x + wp.x, wc.y + wp.y) } : null,
          jellies: jellyList.map((e) => ({ id: e.id, ...screenOf(e), z: e.z, r: e.hitRadius })),
          seahorses: seahorseList.map((e) => ({ id: e.id, ...screenOf(e), r: e.hitRadius })),
        };
      },
    });
  }

  return engine;
}
