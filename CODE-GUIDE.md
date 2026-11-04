# Editing Drift & Discover

This is the real source of the sea. You edit these files, commit, and GitHub builds the page
for you (see "Publishing" below). The big `index.html` you had before was the *built* output:
everything squeezed into one file for the browser, not meant to be edited.

The code is TypeScript (`.ts` / `.tsx`). That is JavaScript with type labels added
(`x: number`), so you can read and edit it like JS. The build ignores type mistakes, so a
wrong label never stops the page from publishing (`npm run typecheck` lists them if you want).

## Publishing

1. Put this whole folder in your GitHub Pages repo (replacing the old `index.html`).
2. Once, in the repo: Settings > Pages > Build and deployment > Source: **GitHub Actions**.
3. Every push to `main` now rebuilds and publishes the sea (the Actions tab shows progress,
   about a minute). The workflow is `.github/workflows/pages.yml`.

## Where things are

| You want to change | Edit |
|---|---|
| Bottle notes | `public/notes.txt` |
| Her drawings | `public/art/` (names and framing in `public/art/README.txt`) |
| Her name, signature and other personal touches | `src/config/gift.ts` |
| Colours of the sea for day, sunset and midnight | `src/world/palette.ts` |
| Which hours are day, sunset and midnight | `lightingForClock` in `src/context/SanctuaryContext.tsx` |
| Starting pearls, starting creatures, shop items and prices | `src/data/initialData.ts` |
| How often the whale comes (`WHALE_FIRST`, `WHALE_EVERY`, seconds) | top of `src/world/engine.ts` |
| Bottle drift speed, when it sinks, how many stay on the shelf | constants at the top of `src/world/objects.ts` |
| Words on screen (welcome card, captions, shop text) | `src/components/overlay/`, `src/components/shop/` |
| Fonts and screen-wide styles | `src/index.css` |

## How it is built (the objects)

The sea is one canvas that redraws about 60 times a second. Everything in it is an object with
the same few methods, and the engine calls them every frame:

- `update(frame)` moves it a tiny step (`frame.dt` seconds since last time).
- `draw(ctx, frame)` paints it onto the canvas.
- `hitTest(x, y)` says whether a tap landed on it; `tap(frame)` reacts to the tap.

The pieces:

- `src/world/engine.ts` (`createEngine`): the loop. Each frame it updates and draws, in order:
  water, far ridges, whale, kelp, jellies, reef, seahorses, seabed, bottles and pearls.
- `src/world/creatures/jellyfish.ts`: `class Jellyfish`. Size, swim pulse, glow.
- `src/world/creatures/seahorse.ts`: `class Seahorse` and `class Director` (the pair's morning
  greeting and courtship twirl).
- `src/world/creatures/whale.ts` (`createWhale`): the Guardian's crossing.
- `src/world/objects.ts` (`createWorldObjects`): the daily bottle, kept bottles, the whale's pearl.
- `src/world/scenery.ts` (`createScenery`): water, rocks, kelp, coral, chest, ruins.
- `src/world/lighting.ts`: the slow "light descends" change between times of day.
- `src/world/art.ts`: loads her drawings and draws them in place of the built-in ones.
- `src/world/types.ts`: the shared shapes (`CreatureEntity`, `WorldFrame`, ...). Read this first.

On top of the canvas sit normal web pages parts (React components) in `src/components/`:
the pearl count, the shop, the note paper and the letters list. Saved progress lives in
`src/context/SanctuaryContext.tsx` (stored in the browser's localStorage).

## Trying changes on your Mac first (optional)

Install Node.js 22 from nodejs.org, then in this folder:

```
npm install
npm run dev
```

and open the address it prints. The page reloads as you save files. `/?debug` adds
`window.__engine.summonWhale()` and `summonBottle()` in the browser console, so you don't have
to wait for them.
