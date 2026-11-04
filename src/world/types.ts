/**
 * Contracts shared by the engine, the scene, the creatures and the React UI.
 * Coordinates are CSS pixels in the viewport unless a name says "Norm" (0..1).
 * y grows downward; yNorm 0 is the water surface (top of screen), 1 the bottom.
 */
import type { LightingMode } from '../types/sanctuary';
import type { ModeColor, ModeNumber } from './palette';

// ---------------------------------------------------------------------------
// Lighting (implemented by the engine; read by everything that draws)
// ---------------------------------------------------------------------------

export interface Lighting {
  /** Target mode (the one being descended into, or the current one when idle). */
  mode: LightingMode;
  /** Mode being left during a descent; equals `mode` when idle. */
  from: LightingMode;
  /**
   * Blend progress 0..1 for something sitting at height yNorm. During "Light descends"
   * the new light reaches deeper things later: delay = yNorm * 2.4s, then a 1.6s blend.
   * Always 1 when idle.
   */
  progressAt(yNorm: number): number;
  /** A mode color token as seen at height yNorm (OKLab blend of from -> to by progressAt). */
  color(token: ModeColor, yNorm: number): string;
  /** A mode number token at height yNorm (linear blend). */
  num(token: ModeNumber, yNorm: number): number;
  /** Water color behind something at height yNorm. */
  waterAt(yNorm: number): string;
  /** Glow gain at yNorm: Day 0.15, Sunset 0.5, Midnight 1.0, blended. Multiply every glow by it. */
  glowGain(yNorm: number): number;
  /**
   * Night lantern activation 0..1 at height yNorm, including the bottom-up "candle catch"
   * flicker when Midnight arrives and the top-down switch-off when it leaves. 0 by day.
   * Use for rim lanterns, polyps, kelp bulbs, seagrass tips, plankton.
   */
  biolum(yNorm: number): number;
  /** Fog for a jelly at depth z (0 far .. 1 near): 0.5 * (1 - z). */
  fogForZ(z: number): number;
  reducedMotion: boolean;
}

// ---------------------------------------------------------------------------
// Per-frame world handed to update() and draw()
// ---------------------------------------------------------------------------

export interface BubbleOptions {
  /** Ring color. Default: white by day, the given hue at night. */
  color?: string;
  count?: number;
  /** Horizontal scatter radius in px. */
  spread?: number;
  /** Rise speed range in px/s, default [30, 45]. */
  speed?: [number, number];
  /** Bubble radius range in px, default [1.5, 3.5]. */
  size?: [number, number];
}

export interface SeagrassAnchor {
  /** Base of the blade on the reef (CSS px, before parallax). */
  x: number;
  y: number;
  /** Height of the blade in px. */
  height: number;
  /** Horizontal sway of the blade at fraction `along` (0 base .. 1 tip), px, at time t. */
  swayAt(along: number, t: number): number;
  /** True if this blade is part of the sea fan (Coral seahorses prefer these). */
  seaFan?: boolean;
}

export interface WorldFrame {
  /** Seconds since the engine started. */
  t: number;
  /** Seconds since the last frame, clamped to 0.05. */
  dt: number;
  /** Viewport size in CSS px. */
  w: number;
  h: number;
  dpr: number;
  /** True on narrow screens (w < 640): phone layout and sizes. */
  phone: boolean;
  /** Thinnest allowed animated stroke: max(0.75, 1 / dpr) CSS px. */
  lineWidth: number;
  lighting: Lighting;
  /** Pointer in CSS px. `active` while a mouse is over the canvas or a finger is down. */
  pointer: { x: number; y: number; active: boolean; down: boolean };
  /** Parallax offset in px for a layer with the given max parallax (e.g. 4 for the jelly zone). */
  parallax(maxPx: number): { x: number; y: number };
  /** Draws a pre-rendered additive glow sprite; silently skipped past the 24-per-frame budget. */
  glow(color: string, x: number, y: number, radius: number, alpha: number): void;
  /** Releases rising bubbles (creature and whale bubbles are the only things that rise). */
  bubbles(x: number, y: number, opts?: BubbleOptions): void;
  /** Spawns one short-lived 3px biolum spark (whale wake, pointer trail). */
  spark(x: number, y: number, vx: number, vy: number, life?: number): void;
  /** Excites ambient plankton within `radius` px (night only has a visible effect). */
  exciteAt(x: number, y: number, radius: number, strength: number): void;
  /** Current jelly positions, for seahorses to look at. */
  jellies: ReadonlyArray<{ id: string; x: number; y: number; z: number }>;
  /** Seagrass blades on the reef that seahorses can wrap their tails around. */
  anchors: ReadonlyArray<SeagrassAnchor>;
  /** 1 = full quality. Lower when the adaptive quality steps down; draw less detail. */
  quality: number;
}

// ---------------------------------------------------------------------------
// Creatures
// ---------------------------------------------------------------------------

export type CreatureKind = 'jellyfish' | 'seahorse';

/** Jellyfish variants: cyan = Moon, lilac = Dream, gold = Sunset, ribbon = Ribbon (gift). */
export type JellyVariant = 'cyan' | 'lilac' | 'gold' | 'ribbon';
/** Seahorse variants: coral, gold, lilac. */
export type SeahorseVariant = 'coral' | 'gold' | 'lilac';

export interface DrawStyle {
  /** Shop "not yet affordable" plates: hairline outline only, no fill, no glow. */
  outline?: boolean;
  /** Stroke color for the outline style. */
  outlineColor?: string;
}

export interface CreatureInit {
  id: string;
  variant: string;
  /** Seed for this creature's own rhythm (pulse period, phases). */
  seed: number;
  /** Home position from saved state, normalized 0..1 of the viewport. */
  home: { x: number; y: number };
  w: number;
  h: number;
  /** Optional start point in CSS px (shop hand-off): the creature appears here and swims home. */
  from?: { x: number; y: number };
  /** Size multiplier; 1 in the sea. Shop plates pass a value that fits their 160px canvas. */
  scale?: number;
  /** Shop plates: stay put around the home point instead of roaming the sea. */
  specimen?: boolean;
}

export interface CreatureEntity {
  readonly id: string;
  readonly kind: CreatureKind;
  readonly variant: string;
  /** Current centre in CSS px (where callouts and focus rings anchor). */
  x: number;
  y: number;
  /** Depth 0 (far) .. 1 (near). Seahorses are always 1. */
  z: number;
  /** 0..100, set by the engine from saved state. Shows as light and behaviour, never faces. */
  happiness: number;
  /** Radius in px of the tap target around (x, y); at least 28. */
  readonly hitRadius: number;
  update(f: WorldFrame): void;
  draw(ctx: CanvasRenderingContext2D, f: WorldFrame, style?: DrawStyle): void;
  hitTest(x: number, y: number): boolean;
  /** Touch / feed reaction. Must answer within 100ms: light first, motion second. */
  tap(f: WorldFrame): void;
  /** The whale's light front reached this creature: play its species display. */
  wake(f: WorldFrame, strength: number): void;
  /** Viewport resized: re-map home and current position. */
  resize(w: number, h: number): void;
}

export type CreatureFactory = (init: CreatureInit) => CreatureEntity;

/** Coordinates the seahorse pair behaviours (greeting, tail-link, courtship twirl). */
export interface SeahorseDirector {
  update(seahorses: CreatureEntity[], f: WorldFrame, idleSeconds: number): void;
  /** Morning greeting: drift together, link tails, promenade ~120px over 6s. Returns false if fewer than 2 seahorses. */
  startGreeting(seahorses: CreatureEntity[], f: WorldFrame): boolean;
  /** True while a greeting is running. */
  readonly greeting: boolean;
  /** Tell the director a seahorse was fed (two within 10s trigger the courtship twirl). */
  noteFed(id: string, f: WorldFrame): void;
}

// ---------------------------------------------------------------------------
// Whale
// ---------------------------------------------------------------------------

export interface WhaleInit {
  seed: number;
  /** Radius's constellation points, or null for 24 seeded points along the dorsal ridge. */
  constellation: [number, number][] | null;
  w: number;
  h: number;
  phone: boolean;
}

export interface WhaleEntity {
  /** True from start() until it has fully left the screen. */
  readonly active: boolean;
  /** Begin a crossing. direction 1 = left to right. */
  start(f: WorldFrame, direction: 1 | -1): void;
  update(f: WorldFrame): void;
  draw(ctx: CanvasRenderingContext2D, f: WorldFrame): void;
  hitTest(x: number, y: number): boolean;
  /** Exhale a column of 12 bubbles from the blowhole. */
  exhale(f: WorldFrame): void;
  /** Where gifts drop from (under the belly), CSS px. */
  releasePoint(): { x: number; y: number };
  /** Optional outline drawing for a shop plate or a11y focus ring centre. */
  center(): { x: number; y: number };
  resize(w: number, h: number, phone: boolean): void;
}

// ---------------------------------------------------------------------------
// Engine (one rAF loop outside React)
// ---------------------------------------------------------------------------

export interface SceneCreature {
  id: string;
  type: CreatureKind;
  variant: string;
  name: string;
  /** Saved home, 0..100 percent of the viewport (from Creature.position). */
  position: { x: number; y: number };
  happiness: number;
}

export interface SceneInput {
  creatures: SceneCreature[];
  /** Decoration ids she owns: 'kelp-forest' | 'glowing-coral' | 'treasure-chest' | 'ancient-ruins'. */
  decorations: string[];
  /** Message ids of opened notes, oldest first; up to the last 7 rest on the shelf as keepsakes. */
  shelf: string[];
  /** True when today's bottle hasn't been opened yet. */
  bottleAvailable: boolean;
  /** True when the seahorse pair hasn't greeted yet today. */
  greetingDue: boolean;
  /** True once she owns the Ribbon Jelly (so the whale never releases another). */
  hasRibbon: boolean;
}

export type BottleState = 'hidden' | 'arriving' | 'waiting' | 'opening' | 'open' | 'closing' | 'shelved';

export type EngineEvent =
  /** A creature was tapped (canvas or a11y). The UI feeds it and shows a callout at (x, y). */
  | { type: 'creatureTap'; id: string; x: number; y: number; r: number }
  /** Keyboard focus moved to a creature (or null). */
  | { type: 'focus'; id: string | null; x: number; y: number; r: number }
  | { type: 'whale'; phase: 'arriving' | 'passing' | 'gone' }
  /** The whale was tapped (once per pass): the Guardian's Wake is playing. */
  | { type: 'whaleTap'; x: number; y: number }
  /** The Guardian pearl landed / was collected (+25 on collect). */
  | { type: 'guardianPearl'; phase: 'released' | 'landed' | 'collected'; x: number; y: number }
  /** The whale released the one-time Ribbon Jelly at this point; the UI adds it to the save. */
  | { type: 'ribbonReleased'; x: number; y: number }
  /** Bottle lifecycle. x, y is the bottle's current screen position (paper anchors to it). */
  | { type: 'bottle'; state: BottleState; x: number; y: number }
  /** The daily bottle was tapped (UI picks the message, then calls engine.openBottle()). */
  | { type: 'bottleTap'; x: number; y: number }
  /** A kept bottle on the shelf was tapped. */
  | { type: 'shelfBottleTap'; messageId: string; x: number; y: number }
  | { type: 'greeting'; phase: 'start' | 'end' }
  /** "Light descends" progress 0..1 (1 = finished). */
  | { type: 'descent'; progress: number; from: LightingMode; to: LightingMode }
  | { type: 'chestTap'; x: number; y: number }
  /** Any pointer or key input (the HUD uses it to un-fade). */
  | { type: 'input' };

export type EngineEventType = EngineEvent['type'];
export type EngineEventOf<T extends EngineEventType> = Extract<EngineEvent, { type: T }>;

export interface Engine {
  /** Attach to a full-viewport canvas and start the loop. */
  mount(canvas: HTMLCanvasElement): void;
  destroy(): void;
  /** Push the latest saved state. Cheap; call on every state change. */
  sync(input: SceneInput): void;
  /** Change time of day with the "Light descends" transition (instant when reduced motion or first call). */
  setMode(mode: LightingMode, opts?: { instant?: boolean }): void;
  /** Shop camera shift 0 (closed) .. 1 (open); the engine eases it over 900ms. */
  setCameraShift(open: boolean): void;
  /** Next sync() that adds this creature id spawns it at this screen point (shop hand-off). */
  spawnHint(id: string, from: { x: number; y: number }): void;
  /** Same as tapping the creature: plays its reaction and emits creatureTap. */
  feed(id: string): void;
  /** Keyboard focus ring + callout anchor. */
  focusCreature(id: string | null): void;
  /** Tap the whale / bottle / pearl from the a11y layer. */
  tapWhale(): void;
  tapGuardianPearl(): void;
  /** Play the bottle-opening move (toward the camera, cork pop). Emits bottle 'open' when the paper should unroll. */
  openBottle(): void;
  /** Re-roll: the bottle drifts back and sinks to the shelf. */
  closeBottle(): void;
  /** Ask for the seahorse greeting through the hero-event queue. */
  queueGreeting(): void;
  /** Current screen position of a creature, for callouts. */
  creatureAt(id: string): { x: number; y: number; r: number } | null;
  /** Water color at height yNorm right now (UI scrims use it). */
  waterAt(yNorm: number): string;
  /** Subscribe; returns an unsubscribe function. */
  on<T extends EngineEventType>(type: T, cb: (e: EngineEventOf<T>) => void): () => void;
  /** Debug/testing: force the whale to start now. */
  summonWhale(): void;
  /** Debug/testing: force the daily bottle to arrive now. */
  summonBottle(): void;
}
