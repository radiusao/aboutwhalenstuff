# Build plan: Quiet Fathoms (v2)

Read `docs/art-direction.md` (the brief) for every visual decision. This file says **who owns
which file** and **what each module exports**, so parallel work fits together.

Already written (shared contracts; do not edit unless your task says so; report needed
changes in your final message instead):

- `src/world/types.ts`: `Lighting`, `WorldFrame`, `CreatureEntity`, `CreatureInit`,
  `SeahorseDirector`, `WhaleEntity`, `Engine`, `EngineEvent`, `SceneInput`.
- `src/world/palette.ts`: every color token (§2 of the brief), `mixOK`, `waterAtMode`,
  `withAlpha`, `adjustOK`, `layerFog`, `layerHorizon`, `contrastRatio`.
- `src/world/light.ts`: `envelope`, `candle`, `glowSprite`, `drawGlow`.
- `src/world/rng.ts`: `SEA_SEED`, `mulberry32`, `stream(name)`, `range`, `valueNoise1D`.
- `src/world/moon.ts`: `moonPhase`, `drawMoon` (the scene owner may fix `drawMoon` if wrong).
- `src/world/EngineContext.tsx`: `EngineProvider`, `useEngine()`, `useEngineEvent(type, cb)`.
- `src/components/uiState.tsx`: `UiStateProvider`, `useUiState()` (panel, note, captions,
  callout, floaters).
- `src/context/SanctuaryContext.tsx`: saved state and actions (`useSanctuary()`).
- `src/data/initialData.ts`: `adoptables`, `decorations`, `CREATURE_CAPS`, `RIBBON_JELLY`,
  `commonName(type, variant)`.
- `src/config/gift.ts`: Radius's personal touches, all nullable with fallbacks.
- `src/index.css`: fonts (`font-jost`, `font-mono`, `font-hand`), ink CSS variables
  (`--ink-top`, `--ink-deep`, `--paper`, `--scrim`, `--scrim-top`, `--bg`), `.grow-underline`,
  `.text-action`, `.sr-only-list`.

## Ownership

| Track | Owns (create/edit only these) |
|---|---|
| Engine | `src/world/engine.ts`, `src/world/particles.ts`, `src/world/lighting.ts` |
| Scenery | `src/world/scenery.ts`, `src/world/surface.ts`, `src/world/decorations.ts` (and may fix `src/world/moon.ts`) |
| Objects | `src/world/objects.ts` |
| Jellyfish | `src/world/creatures/jellyfish.ts` |
| Seahorse | `src/world/creatures/seahorse.ts` |
| Whale | `src/world/creatures/whale.ts` |
| HUD | `src/components/overlay/*` |
| Shop | `src/components/shop/*` |
| Letters | `src/components/letters/*` |
| Integration (later) | `src/components/Sanctuary.tsx`, `src/App.tsx`, wiring fixes anywhere |

## Module exports (the seams between tracks)

### `src/world/creatures/jellyfish.ts`
```ts
export const createJellyfish: CreatureFactory;
```
### `src/world/creatures/seahorse.ts`
```ts
export const createSeahorse: CreatureFactory;
export function createSeahorseDirector(): SeahorseDirector;
```
### `src/world/creatures/whale.ts`
```ts
export function createWhale(init: WhaleInit): WhaleEntity;
```

### `src/world/scenery.ts` (Scenery track)
```ts
export type DecorationId = 'kelp-forest' | 'glowing-coral' | 'treasure-chest' | 'ancient-ruins';

export interface Scenery {
  /** Rebuild Path2D silhouettes and caches (debounced by the engine). */
  resize(w: number, h: number, phone: boolean, dpr: number): void;
  /** Which decorations to draw; newly added ones crossfade in over 400ms. */
  setDecorations(ids: string[]): void;

  // Far stack: the engine draws these into a half-resolution buffer, in this order,
  // drawing the whale between drawRidge and drawShelf.
  drawWater(ctx: CanvasRenderingContext2D, f: WorldFrame): void;   // layer 0 water column
  drawSurface(ctx: CanvasRenderingContext2D, f: WorldFrame): void; // Snell's window, caustics, shafts, sun/moon
  drawRidge(ctx: CanvasRenderingContext2D, f: WorldFrame): void;   // L1 far ridge
  drawShelf(ctx: CanvasRenderingContext2D, f: WorldFrame): void;   // L2 shelf + ancient ruins

  // Full-resolution layers, in this order (engine interleaves creatures and particles):
  drawKelpWall(ctx: CanvasRenderingContext2D, f: WorldFrame): void; // L3
  drawReef(ctx: CanvasRenderingContext2D, f: WorldFrame): void;     // L4 rocks, seagrass, kelp + sea fan decorations
  drawSeabed(ctx: CanvasRenderingContext2D, f: WorldFrame): void;   // L5 dune, caustic dapple, chest
  drawOccluders(ctx: CanvasRenderingContext2D, f: WorldFrame): void; // L6 (quarter-res cache)
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
export function createScenery(): Scenery;

/** Draws one decoration as a shop specimen centred in a size x size box (shop plates). */
export function drawDecorationSpecimen(
  ctx: CanvasRenderingContext2D, id: DecorationId, size: number, t: number,
  lighting: Lighting, opts?: { outline?: boolean; outlineColor?: string },
): void;
```
`surface.ts` and `decorations.ts` are internal helpers of the Scenery track.

### `src/world/objects.ts` (Objects track: bottle, kept bottles, guardian pearl)
```ts
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

  update(f: WorldFrame): void;
  /** Bottle while floating in the surface band (drawn after the far stack). */
  drawSurfaceBand(ctx: CanvasRenderingContext2D, f: WorldFrame): void;
  /** Sinking pearl (drawn after the jelly zone so it crosses layers). */
  drawMidwater(ctx: CanvasRenderingContext2D, f: WorldFrame): void;
  /** Kept bottles, waiting bottle, landed pearl (drawn right after Scenery.drawSeabed). */
  drawSeabed(ctx: CanvasRenderingContext2D, f: WorldFrame): void;
  /** The opening bottle in front of everything (drawn after the occluders). */
  drawForeground(ctx: CanvasRenderingContext2D, f: WorldFrame): void;

  hit(x: number, y: number): ObjectHit | null;
}
export function createWorldObjects(callbacks: {
  onBottle: (state: BottleState, x: number, y: number) => void;
  onPearl: (phase: 'released' | 'landed' | 'collected', x: number, y: number) => void;
}): WorldObjects;
```

### Engine (`engine.ts`, `lighting.ts`, `particles.ts`)
```ts
export function createEngine(): Engine;   // from src/world/engine.ts
```
The engine owns: the rAF loop (dt clamp 50ms, pause when `document.hidden`), DPR (cap 2),
canvas sizing, the far half-res buffer, `Lighting` (descent maths and the bottom-up candle
catch), `WorldFrame`, the glow budget (24/frame), adaptive quality, input (pointer events,
tap detection, hit-testing order: whale pearl, bottle, kept bottles, creatures nearest-first,
whale, chest), plankton/snow/bokeh/sparks/bubbles, camera drift and desktop pointer parallax,
the shop camera shift, the hero-event queue (greeting > bottle > whale, 20s apart), whale
scheduling (first pass 90s after load, then every 300–600s), the Guardian's Wake light front,
Ribbon Jelly release odds, and syncing `SceneInput` into entities.

Draw order per frame:
1. Far buffer (half-res): `drawWater`, `drawSurface`, `drawRidge`, far snow, whale, `drawShelf`.
2. Main canvas: far buffer upscaled, `objects.drawSurfaceBand`, `drawKelpWall`, mid snow,
   jellies (sorted by z, far first), `objects.drawMidwater`, `drawReef`, seahorses,
   `drawSeabed`, `objects.drawSeabed`, bubbles + sparks, light front band (day), `drawOccluders`,
   near bokeh, `objects.drawForeground`, focus ring, `drawVignette`.

## Rules for every track

- TypeScript strict, React 19, Tailwind v4, Framer Motion. Match the surrounding code style:
  short doc comments on exports, no comment noise.
- Do not run `npm install` and do not add dependencies.
- Type-check with `npx tsc -p tsconfig.app.json --noEmit` and only fix errors in files you own;
  other tracks are being written at the same time, so their files may be missing or broken.
- No user-facing text about Radius uses he/she pronouns; say "Radius".
- Phone first: see §11 of the brief.
