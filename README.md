# Drift & Discover

A quiet idle aquarium, made as a gift. React (Vite) + TypeScript + Tailwind CSS v4 + Framer Motion, with the sea drawn on one Canvas 2D.

```
npm install
npm run dev
```

## Where things live

- `docs/art-direction.md`: the "Quiet Fathoms" brief (palette, type, scene, creatures, motion, iPhone Safari notes). `docs/build-plan.md`: the module map.
- `src/world/`: the canvas engine (light and mode changes, scenery, creatures, the bottle and pearls).
- `src/components/`: the type set on top of the sea (HUD, time dial, shop plates, notes and letters).
- `src/config/gift.ts`: her name, your signature and other personal touches (all optional; the app has quiet fallbacks).
- `public/notes.txt`: the notes that arrive in the daily bottle (one per paragraph). It is read at startup, so on a hosted copy you edit `notes.txt` beside `index.html` without rebuilding. `src/data/messages.ts` holds the built-in fallback.
- `public/art/`: her drawings. A PNG named after a part of the sea (`whale.png`, `jellyfish.png`, `background.png`, ...) replaces it at runtime; `public/art/README.txt` lists the names and how to frame each. Loaded by `src/world/art.ts`.

Saved state lives in localStorage (`drift-and-discover:sanctuary:v1`).

## Shareable single file

`npm run build:single` writes the whole app, fonts included, into one `dist-single/index.html`, with `notes.txt` and `art/` beside it. Those are all GitHub Pages (or any static host) needs.

Dev aids: `/?debug&quality=fixed` exposes `window.__engine` (`summonBottle()`, `summonWhale()`, `debug()`); `harness.html?module=jellyfish|seahorse|whale|scenery|objects` draws one module on its own.

## How to play

- Tap a creature to feed it; hungry ones give a few pearls.
- Happy creatures make pearls on their own, even while the app is closed (up to 24 hours).
- The light follows Brisbane time: Day, Sunset, Midnight. The dial at the top right shows which.
- Once a day a bottle drifts in. Tap it to read the note; kept bottles rest on the seabed and in Letters.
- Now and then the Guardian, a humpback, passes far behind. Tap it and it leaves a pearl.
- Spend pearls in the shop on new creatures and things for the seabed.
