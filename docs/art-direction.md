# Drift & Discover: Final Art Direction Brief (v2)

Supersedes all v1 visuals. Build only from this document.

---

## 1. Direction: **Quiet Fathoms**

**Thesis.** The water column plays the part that the sky plays in Alto's Adventure, and the world is the hero. There is no frame and no panels. One lit surface window sits above seven flat, paper-thin silhouette layers: seamounts, a ruined colonnade, a kelp wall, a reef and the seabed. Each layer is tinted toward the water color by its distance, so far shapes fade into aqua by day, plum at sunset and lifted indigo at night. Time of day is the main visual event. When she changes it, the new light sinks down through the water one layer at a time. At Midnight the living things then light up from the seabed upward, each lantern catching like a candle. Creatures are drawn the way a natural-history illustrator draws them: flat translucent shapes, correct anatomy, no faces. Their warmth comes from behaviour and light. A seahorse turns its head toward her finger, a jelly's rim lights up when she touches it, and the seahorse pair links tails every morning. UI is quiet sentence-case type set straight onto the scene. Small capitals are used for only a few words, and there is no glass, no pills and no shadows. The daily note is a strip of sea-damp paper that unrolls from the bottle inside the world. The aim is that it feels like a place she visits, not an app she uses.

### 1.1 How the three tracks fit together (shared contracts, build these first)

| File | Owner | Contents |
|---|---|---|
| `src/config/gift.ts` | UI (Radius fills in) | `herName: string \| null`, `fromInitial = "R"`, `signaturePath: string \| null` (SVG `d`, traced by Radius), `seaSeed: number \| null` (anniversary as YYYYMMDD), `constellation: [x,y][] \| null` (0–1 coordinates on the whale's back), `ribbonEpithet: string \| null`, `petNames: string[]`. **Never guess or invent any of these.** Every one of them has a fallback (below). |
| `src/world/palette.ts` | Scene | Every token in §2. `modeTokens[mode]`, `waterAt(yNorm, mode)`, `mixOK(a, b, t)` (an OKLab lerp, used for all color mixing and mode transitions), `inkAt(yNorm, mode)` returns `inkTop` or `inkDeep`, `glowGain[mode]`. |
| `src/world/light.ts` | Scene | `envelope(tSinceTrigger)`: 80ms linear attack, then exponential decay with τ = 0.9s. `glowSprite(color, 64\|128)`: a pre-rendered radial sprite. Creatures and UI use this for every flash. |
| `src/world/engine.ts` | Scene | A single rAF loop outside React. API: `setMode(m)`, `setCameraShift(f)`, `spawnCreature(kind, variant, fromScreenXY?)`, `placeDecoration(id, fromScreenXY?)`, `feed(id)`, `focusCreature(id\|null)`, `openBottle()`, `on(event, cb)`. Events: `callout{ id, x, y, name, sub }`, `pearls{ n, x, y }`, `whale{ phase }`, `bottle{ state }`, `greeting`, `descent{ progress }`. |
| `src/world/creatures/*.ts` | Creatures | Pure `draw(ctx, state, t, lighting)` and `update(state, dt, world)` per species. The shop plates use the **same** draw functions. `lighting = { mode, glowGain, rim, waterAt, fogFor(z) }`. |

React and Framer Motion own only the DOM UI. The engine reads sanctuary state from a ref and never causes a React render per frame. Hit-testing lives in the engine. A visually hidden DOM button list calls the same engine methods.

**Build order:** silhouettes and lighting → creatures and their behaviours → UI type → the depth gauge last. Do not let the maths tables crowd out the silhouettes. The silhouettes carry the look.

Delete from v1: the Fredoka, Nunito and Caveat imports; every glass or pill component; every kawaii SVG creature; the single-gradient background; the sine-wave seabed; rising ambient bubbles.

---

## 2. Palette tokens

### 2.1 Constant tokens (identical in every mode)

| Token | Hex | Job |
|---|---|---|
| `biolum` | `#5FF3E6` | Cyan. **Only for living things at night.** Never used for UI chrome. |
| `biolum-core` | `#B4FFF6` | Glow cores, jelly rim lanterns |
| `coral` | `#F2899A` | Coral seahorse, gonad rings, cork string, Ribbon Jelly |
| `coral-deep` | `#C65F78` | Coral seahorse rings |
| `coral-polyp` | `#FF8FA8` | Sea-fan polyps at night |
| `gold` | `#F2C14E` | Prices, pearl numbers in the shop, the active tab underline |
| `gold-deep` | `#B07A1E` | Gold on pale Day water (the "for you" text) |
| `gold-ring` | `#B9832C` | Golden seahorse rings |
| `lantern` | `#FFC86B` | Kelp-bulb lanterns, chest glow, bottle glow, "for you" text at Sunset and Midnight |
| `lilac` | `#B9A7FF` | Dream Jelly, Lilac Seahorse |
| `lilac-light` | `#E3DCFF` | Dream Jelly coronal groove, Lilac Seahorse rings |
| `moon-bell` | `#9FF3F0` | Moon Jelly bell (drawn at α .32) |
| `sunset-bell` | `#F2B65A` | Sunset Jelly bell |
| `seahorse-gold` | `#F0B44C` | Golden seahorse |
| `pearl-1 / 2 / 3` | `#FFF8E7` / `#F3D08A` / `#C9963F` | Pearl radial gradient |
| `whale-pearl-1 / 2 / 3` | `#FFF8E7` / `#F7C6CF` / `#9FE9EC` | Guardian pearl |
| `paper-ink` | `#1D2458` | Fountain-pen indigo for the note |
| `paper-day / sunset / midnight` | `#EEF6F1` / `#F8E3D6` / `#D5DBF2` | Note paper, tinted by mode (never cream `#F4F1EA`) |
| `paper-stain` | `#C9A97A` @ 10% | One water-stain bloom per note |
| `cork` | `#C99A6B` | Bottle cork |
| `haze-midnight` | `#33408F` | Midnight fog lift |

How Radius's four colors are used: **indigo** for floors and night, **cyan** for anything alive at night, **coral** for the sunset band and coral anatomy, **gold** for pearls, prices, lanterns and the chest.

### 2.2 Per-mode tokens (authoritative; use these values, do not recompute them)

The layer values come from `fill = mixOK(BASE, waterAt(horizon), fog)`, then hand-corrected so adjacent layers differ by **ΔL\* ≥ 3**. Fog per layer: L1 .84, whale lane .72, L2 .66, L3 .46, L4 .24, L5 .08, L6 0.

| | **Day** (clear, pale, nothing glows) | **Sunset** (gold surface, plum depths) | **Midnight** (lifted indigo, never black) |
|---|---|---|---|
| Water stops | 0% `#C8F0E6` · 16% `#86D4D4` · 48% `#3E8FB6` · 78% `#28609A` · 100% `#23377C` | 0% `#FFD7A1` · 14% `#F6A58E` · 38% `#C7718F` · 66% `#653D7C` · 100% `#22184E` | 0% `#384592` · 30% `#29317A` · 60% `#1E2566` · 100% `#121644` |
| **Water top / mid / bottom** | `#C8F0E6` / `#3E8FB6` / `#23377C` | `#FFD7A1` / `#C7718F` / `#22184E` | `#384592` / `#1E2566` / `#121644` |
| Surface window | `#F4FFF8` | sun disc `#FFE7B0`, low at x 70% | moon disc `#D8E2FF` α .55, today's real phase, at x 64% |
| L1 far ridge | `#357CA5` | `#8A507B` | `#1F2667` |
| Whale lane | `#36779D` | `#894E75` | `#1B225F` |
| L2 ruins shelf | `#28608E` | `#5D366A` | `#191F59` |
| L3 kelp wall | `#1F4E72` | `#4A2A55` | `#141A4F` |
| L4 reef | `#153967` | `#321C4C` | `#101440` |
| L4 seagrass | `#1D6066` | `#4B2652` | `#0D1139`, 1 blade in 4 tipped `biolum` |
| L5 seabed | `#102D5A` | `#281642` | `#0B0F34` |
| L6 occluder | `#0C2448` | `#201036` | `#070927` |
| Ridge caps (α = .35 × (1 − fog)) | `#DFF7EE` | `#FFC58A` | L1–L3 `#8FA2E8` at α .20; L4–L5 sparse plankton dots `biolum` at α .45 (dots, not a line) |
| Light rays | 5 shafts `#E9FFF6`, α .10–.16, `screen` | 4 shafts `#FFC98A`, α .12, tilted 14°, `screen` | 2 moonbeams `#9FB4FF`, α .05, `lighter` |
| Caustics | `#FFFFFF` α .06 in the window, α .08 on the seabed top face | `#FFD7A1` α .04, window only | none (the moon disc ripples instead) |
| Marine snow (far / mid) | `#F4FFF8` α .30 | `#FFD9B8` α .26 | `#8FA2E8` α .18; excited plankton `biolum` → `biolum-core` |
| Near bokeh | `#E9FFF6` α .10 | `#FFC58A` α .10 | `#8FA2E8` α .08 |
| Creature rim light | none | 1px top rim `#FFC58A` | 1px rim in the creature's own hue, plus a glow sprite |
| Night body darkening | 0 | 0 | bodies `mixOK` 40% toward `#0B0F34` |
| **Glow gain** (multiplies every glow sprite) | **0.15** | **0.5** | **1.0** |
| **inkTop** (HUD, top 45% of screen) | `#0F2346` | `#2A1640` | `#E6EAFF` |
| **inkDeep** (captions, shop, bottom half) | `#E9F7F3` | `#FBE6DA` | `#E6EAFF` |
| Secondary ink | ink at 62% | ink at 62% | ink at 62% |
| Kelp decoration blades / lit edge | `#8A7440` / `#C2A660` | `#7A3F4C` / `#E39A7A` | silhouette `#0D1139`, bulbs `lantern` |
| Sea fan branches / polyps | `#E9798E` / same | `#F59A92` / same | `#2A1A44` / `coral-polyp` glowing |
| Chest body / bands | `#5A3A2E` / `#E2B04A` | `#4A2433` / `#F2B65A` | `#0A0C2C` silhouette, `lantern` light leaking from the lid gap and keyhole |
| Vignette corner darkness | .18 | .28 | .38 |

**Rules.**
- **Day stays pale aqua.** Do not darken it "for contrast". Contrast comes from the ink choice and the local scrim (§7).
- **Midnight never goes below L5 `#0B0F34`**, except the blurred L6 occluder.
- Nothing glows by day. At glow gain 0.15, ambient sprites are effectively invisible, and only tap flashes read.
- During a mode change, every token lerps in OKLab, never in raw sRGB. sRGB lerps turn coral-to-indigo into mud.

---

## 3. Typography

**Load URL** (one `<link>`, with preconnect):
```
https://fonts.googleapis.com/css2?family=DM+Mono:wght@400;500&family=Jost:ital,wght@0,300;0,400;0,500;1,400&family=Nothing+You+Could+Do&display=swap
```

**Why these.**
- **Jost** is a Futura revival. Its cool geometric forms suit flat silhouette art the way 1930s travel-poster type did,. It is not one of the overused default fonts.
- **DM Mono** is used only where digits must not jitter.
- **Nothing You Could Do** is a real person's fine-pen hand. It is not Caveat or Kalam.

Fallbacks: Jost → `Futura, "Avenir Next", sans-serif`. DM Mono → `ui-monospace, monospace`. Nothing You Could Do → `"Segoe Print", cursive`.

Base 1rem = 16px.

| Role | Font / weight | Size desktop · phone | Tracking | Case / notes |
|---|---|---|---|---|
| HUD nav words: SHOP, LETTERS, CLOSE, DAY/SUNSET/MIDNIGHT | Jost 500 | 0.75rem / 12px · 12px | 0.18em | UPPERCASE. **At most 4 tracked-cap words on screen at any time.** CLOSE replaces SHOP while the shop is open. |
| Pearl count | DM Mono 500 | 1.25rem / 20px · 18px | 0.02em | Tabular, no zero padding. Rolls its digits over 600ms. |
| "+3" earn floaters | DM Mono 400 | 12px | 0.02em | `gold` (`gold-deep` over Day water above 30% height) |
| Title card ("Welcome back.") | Jost 300 | 2.25rem / 36px · 1.75rem / 28px | −0.005em | Sentence case, line-height 1.1. **Never weight 200.** |
| Title card subline | Jost 300 | 1.0625rem / 17px · 16px | 0 | Sentence case |
| Captions (toasts) | Jost 300 | 15px · 15px | 0 | Sentence case, line-height 1.4, max 46ch |
| Shop tab words "Life" / "Seabed" | Jost 300 | 1.75rem / 28px · 22px | −0.005em | Inactive tab at 45% ink |
| Plate common name / callout pet name | Jost 400 | 17px · 16px | 0 | Sentence case |
| Plate Latin binomial | Jost 400 italic | 13px | 0 | 70% ink. **Shop plates only** (one exception, §9). |
| Plate blurb | Jost 300 | 15px | 0 | 70% ink, 2 lines max |
| Callout subline ("Moon jelly · since 2 Oct") | Jost 400 | 13px | 0.01em | 70% ink |
| Actions "Adopt", "Place", "Keep it" | Jost 400 | 15px | 0 | Sentence case, 1px underline at a 0.3em offset |
| "12 more pearls", "In your sea" | Jost 400 | 13px | 0 | 55% ink |
| Prices | DM Mono 400 | 14px | 0.02em | `gold` |
| Letter and note dates ("14 Oct 2026") | DM Mono 400 | 11px | 0.06em | 60% ink. No Roman numerals anywhere. |
| Note body | Nothing You Could Do 400 | 22px · 20px | 0.01em | Line-height 36px · 32px, equal to the rule pitch. `paper-ink`. |
| Letters list first lines | Nothing You Could Do 400 | 19px · 18px | 0.01em | `paper-ink` |
| "for you" beside the bottle | Nothing You Could Do 400 | 20px | 0.01em | `gold-deep` by Day, `lantern` at Sunset and Midnight |
| Edition mark | Nothing You Could Do 400 | 15px | 0.01em | inkDeep at 40% |

**Rules.**
- Weights are 300, 400 and 500 only. Jost 300 only at 15px and above. Nothing below 11px.
- Mono is used only for the pearl count, prices, earn floaters and dates.
- Text is left-aligned on a 48px margin on desktop and a 20px margin on phone. **Nothing is centred.**
- Every label must reach **4.5:1** against the brightest pixel beneath it. Test on Day's surface band and Sunset's gold band.

---

## 4. Scene composition

All of this is one full-viewport `<canvas>`.
- `dpr = min(devicePixelRatio, 2)`, backing store `innerWidth × dpr`, `setTransform(dpr, …)`.
- The far stack (rows 0 to L2) renders each frame into a **half-resolution buffer** and is upscaled with `imageSmoothingQuality = 'high'`. That gives free depth-of-field softness.
- Everything from L3 forward renders at full resolution.

All randomness uses `mulberry32(seed)`, with `seed = gift.seaSeed ?? 0x5EA5ED`. Sub-streams are made by hashing the seed with a name (`"terrain"`, `"kelp"`, `"jelly:3"`). Her sea therefore has the same shape on every visit.

### 4.1 Layers, far to near

| # | Layer | Contents | Horizon / band (from top) | Max parallax | Buffer |
|---|---|---|---|---|---|
| 0 | Water column | Vertical gradient from the §2.2 stops, with a 64×64 noise tile at 3% `soft-light` **baked into the cache** to kill banding | full | 0 | Half-res cache, rebuilt only on resize or during a mode change |
| 1 | Surface | Snell's window, caustics, light shafts, sun or moon | top 0–14% | 0.5px | far buffer |
| 2 | L1 far ridge | Two-peak seamount line, pure silhouette, sediment cap | 50% | 1px | far buffer |
| 2a | Far snow | 0.8px specks, falling at 4px/s | full | 1px | far buffer |
| 3 | Whale lane | The Guardian, behind everything below | centre y 34–52% | 1.5px | far buffer |
| 4 | L2 ruins shelf | Flat-topped shelf plus the Ancient Ruins slot | 60% | 2px | far buffer |
| 5 | L3 kelp wall | 9–14 one-tone Macrocystis stalks rising from the bottom to 35–45% of the height. No separate blades. | rises to 55–65% | 4px | full |
| 5a | Mid snow | 1.2px, falling at 8px/s | full | 4px | full |
| 6 | Jelly zone | Jellies with depth z ∈ [0.35, 1]: size × (0.55 + 0.45z), fog = 0.5 × (1 − z) | y 14–72% | 4 + 4z px | full |
| 7 | L4 reef and seagrass | Rock outcrops, 40 blades of seagrass (28 on phone), seahorse anchors, sea fan and kelp decorations. First layer with real hue and detail. | 72% | 6px | full |
| 8 | L5 seabed | Near dune with sediment cap, Day caustic dapple on its top face, chest, landed pearls, the bottle shelf | 84% | 9px | full |
| 9 | L6 occluders | Pre-blurred kelp-frond mass at bottom-left. Rock lip at top-right (desktop only). | edges | 14px | Quarter-res cache, upscaled |
| 9a | Near bokeh | 10–16 discs of 2.5–6px, falling at 14px/s | full | 16px | full |
| 10 | Vignette | Pre-rendered radial, at the §2.2 corner darkness | full | 0 | cache |

### 4.2 Atmospheric perspective
- Landscape layers use the §2.2 tokens.
- Anything dynamic (creatures, decorations, pearls, bottle) uses `fill = mixOK(color, waterAt(y), fog)`. Fog comes from the layer it sits on, or from z for jellies.
- Ridge caps and rims use alpha = .35 × (1 − fog).
- Detail density falls with distance:
  - L1 is pure silhouette.
  - L3 merges its blades into one shape.
  - L4 and nearer get full detail.
- Nothing behind L4 glows on its own. It is lit only by excited plankton.
- **Glow scattering:** sprite radius × (1 + 0.6 × (1 − z)), intensity × (0.5 + 0.5 × z). Far lights are big and dim; near lights are small and sharp.

### 4.3 Silhouettes (no sine-wave terrain)
- Each profile is 2-octave value noise (wavelengths 0.35W and 0.08W), plus hand-placed landmark functions, plus 1.5px micro-jitter at a 12px wavelength.
- Build them as `Path2D` once per resize, debounced 150ms. Per frame the work is just `fill()` with the current lerped color.
- Landmarks. Each layer needs at least one asymmetric landmark, and the composition rises to the right overall.
  - **L1:** two seamounts at x 22% and 64%. The right one is taller and has a notch.
  - **L2:** a flat shelf from x 48% to 92%, carrying the ruins.
  - **L4:** a rock overhang (a small natural arch) at x ~82%, plus a boulder cluster at x 8–16%.
  - **L5:** a dune lip rising to the right, and a flat rock ledge at x 38–52% that serves as the bottle shelf.
  - **L6:** a frond mass reaching up to 70% of the height at the bottom-left.
- **Sediment caps:** a 3–6px band following the top edge of each layer (Alto's snowcap).
- **Occluder blur:** draw the silhouette at 1/8 resolution, upscale to 1/4 with smoothing, and upscale again. No `ctx.filter`.

### 4.4 Light
- **Snell's window.** A soft ellipse centred at y −4%, rx 38% of W, ry 9% of H.
  - Edge alpha is modulated by two sines (periods 7.3s and 11.1s), so the edge visibly ripples. It must not read as a plain radial spotlight.
  - Caustics inside it are a 256² tile made once from a sine-interference field raised to the 6th power. Two copies scroll at 6 and 9px/s in different directions, composited with `lighter` and clipped to the window and the L5 top face.
- **Shafts.** Tapered quads fanning down from the window, 55–80% of H long and fading to 0. Each sways ±3° over 20s with a seeded phase.
- **Moon.** Today's phase: `phase = ((now − Date.UTC(2000,0,6,18,14)) / 86400000 / 29.530588853) mod 1`.
  - The terminator is two arcs.
  - The disc is 18px (14px on phone) and wobbles ±1.5px with the surface ripple.

### 4.5 Marine snow and plankton
- **Snow falls; only bubbles rise.**
  - Particle count = viewport area × 0.00012, capped at 180. Store in a `Float32Array` structure-of-arrays: x, y, vx, vy, size, excite.
  - Lateral drift is ±6px over 9s.
- **Spark pool.** A separate pool of 400 short-lived 3px `biolum` dot sprites, used for the whale wake and the night pointer trail.
- **Night only:** dragging the pointer or a finger excites ambient plankton within 56px through `envelope()`, rate-limited to one flash per particle every 1.5s.

### 4.6 Parallax and camera
- **Desktop:** pointer position normalised to −1..1, low-pass filtered at 0.04 per frame.
- **All devices:** a camera drift of ±10px at L5 over 120s, scaled per layer.
- **No gyro**, so iOS never shows a motion-permission prompt.
- **Shop camera shift:** the world translates up by 6% of H × (0.3 for far layers … 1.0 for L6) over 900ms.

### 4.7 Performance
- **Glow budget:** at most 24 glow sprites per frame, excluding spark dots.
- Never use `shadowBlur`, runtime `ctx.filter` or `backdrop-filter`.
- No per-frame `createRadialGradient`. Every glow is a pre-rendered sprite.
- **Adaptive quality.** Decide on measured script time per frame, not the frame interval (iPhone Low Power Mode caps Safari at 30fps; a steady 33ms interval is a capped display, not a slow one). When frames run over budget, step down in this order: halve the particles, drop the caustics, drop dpr to 1.5, then to 1. Step back up after about 10s of sustained headroom, waiting twice as long after each step up that did not hold.
- Pause rAF on `document.hidden`, and compute idle pearls on return.
- Clamp dt to 50ms.
- **Memory.** Offscreen buffers are: water cache (×2 only during a transition), far buffer (half-res), occluder cache (quarter-res), caustic tile, dither tile, and sprites (5 colors × 64/128px). Nothing else full-screen.

---

## 5. Creatures

**Principle.** No faces, mouths, cheeks or eye highlights. Anatomy is accurate. Happiness shows as **light and behaviour**.

**Stroke rule.** No animated stroke thinner than 1 device pixel: `lineWidth = max(0.75, 1/dpr)` CSS px. To make a line fainter, lower its alpha, not its width. This stops tentacle shimmer on 1× screens.

### 5.1 Jellyfish (Dreamers), Canvas 2D

**Bell.** Rest radius R = 22–40px × the z-scale.
- **Profile:** a dome bezier from (−R, 0) up to (0, −H) and down to (R, 0). H depends on species (below).
- **Margin:** a half-ellipse with rx R and ry 0.18R. Its front edge is scalloped into 8 visible lappets (16 around the bell), each a quadratic bump 0.06R deep.
- **Fill:** flat, at α .30–.35.
- **Margin stroke:** crisp, `mixOK(color, #FFFFFF, .5)` at α .7.
- **Radial canals:** 8 lines from the apex to the margin, slightly curved, α .3.
- **Rim lanterns:** 16 dots of r 1.2px on the margin, in `biolum-core` (or the species accent).

**Tentacles.** 12-node verlet chains pinned to the margin.
- Segment length = tentacle length / 11. Gravity +6px/s². Damping `pow(0.96, dt×60)`. 2 constraint iterations.
- Lateral sine force on node i: `A_i · sin(ωt − 0.45i + φ)`. A_i ramps from 2px at the root to 7px at the tip. ω = 2π × 0.7Hz, φ is seeded.
- The chains lag behind the bell's motion, which gives real follow-through.

**Oral arms.** 4 ribbons of 12 segments each, drawn as quad strips.
- Width = base × |cos(twist + 0.4i)|, where twist advances at 0.8 rad/s.
- Where cos < 0, draw the back face 20% lighter, so the ribbon visibly turns over. α .5.

**Pulse.** Real jelly physics, not a scale loop.
- **Contraction:** scaleX 1 → 0.86 and scaleY 1 → 1.08 over 350ms easeOutCubic, plus an upward velocity impulse of 18px/s.
- **Relax:** 1.2s easeInOutSine, then coast while sinking at 4px/s.
- Pulse period is 2.4–3.6s, seeded per jelly so they never sync. Net rise is about 8–12px/s.
- **Near the top:** above y 10%, a jelly stops pulsing and sinks back down. Nothing pops out of existence.

**Species variants.**

| Shop name | Species | Color | Bell H | Tentacles | Anatomy marks | Tap display |
|---|---|---|---|---|---|---|
| Moon Jelly | *Aurelia aurita* | `moon-bell` | 0.45R (saucer) | 16 short fringe tentacles (0.8R) + 4 short oral arms (1.2R) | 4 horseshoe gonad rings in `coral` at α .7 | **Canal cascade:** a bright 6px segment runs down all 8 canals and then the tentacles at 220px/s |
| Dream Jelly | *Atolla wyvillei* | `lilac` | 0.40R (flat disc) | 22 short + **one** long trailing tentacle (6 × H) | Coronal groove ring at 0.6R in `lilac-light` | **Pinwheel:** a 3-dot bright arc chases round the rim at 2 rev/s for 1.6s |
| Sunset Jelly | *Pelagia noctiluca* | `sunset-bell` | 0.90R (tall bell) | 8 long (3 × H) + 4 oral arms in `coral` | 30 wart dots in `#FFE2A8` | **Sparkle:** each wart fires its own envelope at a random offset within 1.2s |
| Ribbon Jelly (gift only, §9) | *Chrysaora* sp. | `coral` bell | 0.70R | 8 marginal + 4 `gold` ribbon arms at 5 × H | 16 radial stripes in `coral-deep` | **Ribbon run:** light runs down all 4 ribbons |

**Tap.**
- The light envelope fires: the glow sprite peaks at max(0.35, glowGain) × 1.0.
- The rim lanterns light in sequence around the margin at 40ms each.
- The species display plays.
- 6–10 bubbles are released. Each is a 1px ring with a short highlight arc.
  - Day: `#FFFFFF` at α .6.
  - Night: the jelly's own hue, with a tiny sprite.
  - They rise at 30–45px/s with ±3px wobble. After 2–3s each fades while scaling to 1.3×.
- The engine emits `callout` and `pearls`.

**Happiness h (0–100).**
- Lit lanterns = 6 + round(10 × h/100). Never 0, because nothing dies.
- Ambient glow alpha = glowGain × (.25 + .5 × h/100).
- Pulse rate × (0.85 + 0.25 × h/100).

**Night.** Body darkened per §2.2, plus a 1px rim in its own hue and a glow sprite at 1.6R.

**Hit area.** A circle at the bell centre, radius max(28px, 1.4R).

### 5.2 Seahorses (Curious Dwellers)

**Construction** (normalised to total height Hs = 46px desktop, 40px phone).
- **Centerline:** snout tube (0.22Hs, pointing forward and down) → head → coronet → neck → forward-bulging belly → trunk → a logarithmic-spiral tail `r = 0.3Hs · e^(−0.18θ)`, θ from 0 to 3.2π.
- **Width profile:** snout 0.06Hs, head 0.16Hs, neck 0.12Hs, belly 0.22Hs, trunk 0.16Hs, tail tapering to 0.02Hs.
- Offset the profile along the normals and fill it as **one flat silhouette**.
- **Bony rings:** 12 rings as short perpendicular ticks in the ring tone, at α .5.
- **Coronet:** 3 spikes.
- **Dorsal fin:** a translucent 8-ray fan at α .45 that flutters fast (`sin(t·24)` on the ray angles). This is the "alive" cue.
- **Pectoral fin:** small, fluttering at the same rate.
- **Eye:** a 2px pinhole filled with `waterAt(y)`, as if cut through to the water behind. It is anatomy, not expression.
- **Coral variant only:** tubercle bumps (±0.8px) on its outline.

**Variants.**

| Name | Species | Body | Rings |
|---|---|---|---|
| Coral Seahorse | *Hippocampus bargibanti* | `coral` | `coral-deep` |
| Golden Seahorse | *Hippocampus kuda* | `seahorse-gold` | `gold-ring` |
| Lilac Seahorse (shop) | *Hippocampus whitei* | `lilac` | `#8E7FD6` |

**Ambient behaviour.**
- The tail is anchored around a seagrass blade on L4, in the bottom 25% of the screen.
- **Bob:** ±6px over about 7s, body angle ±4°.
- **Head tilt:** a spring (stiffness 60, damping 14) turns the head up to ±12°.
  - Toward the pointer when it is within 160px.
  - Otherwise toward the nearest jelly, every 8–15s.
- **Dart:** every 20–40s it lets go, pitches 20° and travels 40–80px over 1.4s, `cubic-bezier(.2,.8,.2,1)`, fins racing. Then it re-anchors.
- **Tail-link:** after 2 minutes with no input, the pair drift together, link tails for 6s, then return.

**Feeding (tap).**
1. 5 gold brine-shrimp specks (2px, `gold`) drift down near the snout.
2. Three snout lunges, each 160ms out and 240ms back.
3. The **happy spin:** a full 360° pitch roll over 1.1s with spring overshoot under 8%, leaving a spiral of 5 gold bubbles.

If both seahorses are fed within 10s, they instead do a **courtship twirl**: they converge, orbit their midpoint once over 2.4s, and brighten.

**Morning greeting.** On her first visit each day, queued as a hero event:
- They release their seagrass, drift together, link tails, and promenade about 120px over 6s.
- Saturation rises from 70% to 100% during it.
- Caption: "They do this every morning."

**Happiness.** Shown as saturation (70% → 100%) and lightness (+0 → +8%). At night, a rim glow at α .3 + .5h.

**Hit area.** A capsule along the spine with radius 28px.

### 5.3 Whale (Guardian), humpback, *Megaptera novaeangliae*

**Geometry.**
- **Spine:** 12 nodes carrying a travelling sine wave. Amplitude goes from 0 at the head to 0.06L at the fluke; the stroke takes 6s.
- **Outline:** from a width profile, with:
  - a blunt head with 6 tubercle bumps on the rostrum
  - a dorsal hump
  - a crescent fluke that flexes with the wave
  - pectoral fins one third of the body length, with a scalloped leading edge, paddling ±8° over 9s.
- **Underside:** a ventral countershade strip 8% lighter carrying 8 throat-pleat lines at α .3.
- **No eye.** At this distance it is a presence, not a character.

**Size and timing.**
- Size: 55% of viewport width on desktop, **130% on phone**, so on a phone she only ever sees part of it.
- Crossing: 80s on desktop, 50s on phone, on a 3% rising arc, with 6s ease-in and ease-out at the ends.
- First pass **90s after load**, then every 300–600s. It goes through the hero-event queue (§8).

**Per mode.**
- **Day:** the fogged whale-lane fill, plus Day caustic dapple clipped to its back.
- **Sunset:** the same, plus a 1px dorsal rim of `#FFC58A` at α .45.
- **Midnight:** the fill is the whale-lane token, so it is barely there. You see it through what it disturbs:
  - 80 outline samples per frame. Wherever local velocity is high (fluke edge, fin tips, rostrum), spark-pool particles spawn, up to 120 per second, each living 1.6s.
  - Ambient plankton within 30px excite.
  - The `constellation` points (20–30 dots of 1px, plus 4 of 1.6px) twinkle at α .35 on independent noise. If `constellation` is null, place 24 seeded points along the dorsal ridge.

**Tap (once per pass): "the Guardian's Wake".**
1. A light front, **never a stroked circle**, expands from the tap point at 300px/s for 3.2s.
   - Every plankton particle it passes fires `envelope()` with boost `(1 − |d − r|/30) × (1 − t/3.2)`.
   - Kelp and seagrass it passes get a +40% sway kick that decays over 2s.
   - Light shafts brighten 20%.
2. Each jelly the front reaches fires its own species display. Each seahorse rim flares. The whole tank lights in sequence over about 3s and fades back.
   - Day: the front is a subtle refractive band (a brighter strip with α .15 and slight wobble). Reactions are subdued.
3. The whale exhales a column of 12 bubbles.
4. It releases a Guardian pearl (whale-pearl gradient, 9px, with a halo).
   - The pearl sinks *toward the camera* over 8s: fog .72 → 0, size .4 → 1. It crosses every layer and lands on L5.
   - Tap to collect +25. It auto-collects after 30s.
   - Caption: "The Guardian left you a pearl."

**Hit area.** The spine polygon expanded by 12px.

---

## 6. Decorations

Each decoration is bought once and has a fixed seeded slot. Each is drawn in the same flat silhouette language, fogged by the layer it sits on.

**Swaying Kelp (*Macrocystis pyrifera*), on L4, x 10–28%.**
- 3 stalks rising to about 40% of the height.
- 16-point traveling-wave stalks: phase offset by height, periods 9.1–13.7s, tip swing 18px.
- Blades are long flat leaves along the stalk, with a lit edge on the side facing the light.
- A gas bulb (pneumatocyst) at each blade base.
- At Midnight the stalks are silhouettes and the bulbs become `lantern` glows. Those lanterns are part of the candle-catch cascade.

**Glowing Coral (sea fan), on L4, x 62–68%.**
- A flat branching fan with 5 recursion levels, seeded. Branch angle 18–32°, length falls ×0.72 per level, line width 3px tapering to 1 device px.
- 40 polyp dots on the tips.
- By day it is a matte coral fan. At Midnight the branches dim and the polyps glow `coral-polyp`.
- The Coral Seahorse prefers to anchor here once it is placed (true to *H. bargibanti*).

**Sunken Treasure Chest, on L5, x 74–82%.**
- Half-buried in the dune lip, lid ajar 12°, flat planes with 2 metal bands, a keyhole and a sediment cap on the lid.
- At Midnight it is a silhouette with gold light leaking from the lid gap and the keyhole.
- Keep v1's behaviour (where idle pearls collect). Tapping eases the lid open 30° over 600ms with `ease-enter`.

**Ancient Ruins, on the L2 shelf, x 55–85%.**
- 5 columns (2 of them fallen), a broken arch, and 3 steps.
- Fogged at .66 like the landscape, so they read as distant and old. Sediment caps on the capitals.
- No glyphs and no glow.

**Bottle shelf, on the L5 rock ledge, x 38–52%.**
- Opened bottles rest here as keepsakes: up to 7, older ones progressively half-buried.
- At night their paper glows a faint `lantern` (α .25 sprite).
- Tapping one reopens its note.

**Seagrass (base scenery, not sold), on L4.**
- 5-point blades, 7–11s periods, 1 in 4 tipped with `biolum` at Midnight.

---

## 7. UI overlay

**Material.** None. No panels, no `backdrop-filter`, no pills, no rounded cards, no shadows, no emoji.

The UI consists of:
- Type set on the scene.
- 1px rules.
- One solid object: the **pearl glyph**, a 12px circle with the pearl gradient and a 1px crescent highlight.

Icons are 1px hand-drawn SVG strokes.

**Legibility.**
- Use `inkAt(y)`: `inkTop` in the top 45% of the screen, `inkDeep` below.
- Behind each HUD cluster and caption block, draw a soft radial scrim: an ellipse about 240×120px of the local water color at 35%.
- Callouts use whichever ink contrasts better with `waterAt(y)` at that point.

### 7.1 HUD

**Desktop** (48px margins):
- **Top-left:** pearl glyph, an 8px gap, then the count (DM Mono 500, 20px). Earn events float "+3" up from the source and roll the digits.
- **Top-right, left to right:**
  - **SHOP**
  - **LETTERS**
  - the **sound glyph**: 3 vertical hairlines that animate as audio bars when on and lie flat when off. **Only if the build ships audio. Never ship a dead control.**
  - the **time dial**: a 44×22 hairline semicircle (the sun's path) with a 6px marker disc. Day sits at the zenith, Sunset at the right horizon, Midnight as a crescent below the line. The mode name in tracked caps sits beneath it.
  - Items are spaced 28px apart.
  - Every control has a padded **44×44 hit area** with no background or border.
  - The dial cycles Day → Sunset → Midnight. The marker glides along the arc in 1.2s.
- **Right edge, depth gauge:**
  - A 1px vertical line at 25% ink from 14% to 86% of the height, with 9 ticks and **no numerals**.
  - A brighter photic-zone segment at 70% ink: Day 75% of the length, Sunset 30%, Midnight none.
  - **Visible only during a mode descent:** it fades in over 300ms and fades out 1.5s after the descent ends. The photic segment shortens in sync with the descent. It is not permanent chrome.
- **Lower-left:** captions and title cards.
- **Lower-right on the seabed lip:** the edition mark "no. 1 of 1 — for {herName}, from R." If `herName` is null: "no. 1 of 1 — for you, from R."

**Phone:**
- Top row inside the safe-area insets, with 20px margins: pearls on the left; SHOP, LETTERS and the dial on the right.
- The dial label is hidden and appears under the dial for 2s after a change.
- The gauge is ticks only, at x W−8px, and also appears only during a descent.
- Only the bottom-left occluder is drawn.

**Idle fade.**
- After 12s with no input, the HUD fades to 30% over 1.2s. It returns to 100% in 200ms on any pointer move, touch or keypress.
- It never fades while the shop, letters or a note is open.

**Initial mode.** On the first load of each session, match her local clock: 06:00–17:00 Day, 17:00–19:30 Sunset, otherwise Midnight.

**Controls.**
- Hover and focus: a 1px underline grows from 0 to 100% width over 280ms `ease-enter`.
- **Keyboard focus:** a 1px solid outline in the current ink, offset 4px.

### 7.2 Creature callouts (replace v1's creature toasts)
- On tap, a leader line draws out from a 4px ring on the creature: 1px, 24px diagonal then 40px horizontal, via `stroke-dashoffset` over 300ms. It flips to the left near the right edge.
- At its end:
  - the **pet name** (Jost 400, 17px)
  - beneath it, the common name and adoption date: "Moon jelly · since 2 Oct" (Jost 400, 13px, 70%).
- No Latin, no depth, no metres.
- One callout at a time. It fades after 3s with `ease-exit`.

### 7.3 Captions (toasts)
- Lower-left: a 20px hairline leads into one line of Jost 300, 15px, in inkDeep.
- 600ms in (8px rise plus opacity), 3.2s hold, 900ms out. At most 2 stacked, 8px apart.

### 7.4 Title card
- When she returns after more than 30 minutes away: "Welcome back." (Jost 300, 36px), then "While you were away, the sea made 18 pearls." (Jost 300, 17px).
- Lower-left. It leaves after 4s.

### 7.5 Shop, as specimen plates

**Opening.**
- The world keeps running, with no blur.
- SHOP becomes CLOSE in the same position.
- The camera shifts as in §4.6.
- A scrim rises from the bottom: `waterAt(1)` at α .92 at 0%, α .75 at 45%, transparent at 75%.
- The shop occupies the bottom 46% of the viewport on desktop and 62% on phone.

**Desktop layout.**
- **Left column** (x 48px, 200px wide): the words **Life** and **Seabed** stacked (Jost 300, 28px). The inactive word is at 45% ink. A 1px `gold` underline slides between them (Framer `layoutId`).
- **Strip:** a horizontal scroll-snap strip of plates from x 280px to the right edge.
  - Plates are **232px** wide, separated by 1px vertical rules at 12% ink.
  - Hairline chevrons (44×44) at both ends.
  - The vertical mouse wheel maps to horizontal scroll. Arrow keys move between plates.

**Phone layout.**
- Tabs as a row at the top-left of the panel.
- Plates are 72vw wide, so the next plate peeks in.

**Plate anatomy, top to bottom.**
1. A **live specimen** on a 160×160 canvas, using the same draw code at 30fps. At most 5 plates render live; the rest are paused.
2. A 24px hairline specimen pin dropping to the text.
3. The common name (Jost 400, 17px).
4. The Latin binomial (Jost 400 italic, 13px).
5. One blurb line (Jost 300, 15px). Examples: "Lights its rim when you touch it." / "Holds on with its tail. Turns to look at you."
6. A row with the pearl glyph and price (DM Mono, 14px, `gold`) on the left and **Adopt** (or **Place**) underlined on the right.

**States.**
- **Affordable:** full color, animated.
- **Not yet:** the same live creature drawn **as a hairline outline only**: stroke at inkDeep α .55, no fill, no glow. In place of the action: "12 more pearls".
- **Owned decoration:** "In your sea", with no action.
- **Creature cap reached** (8 jellies, 4 seahorses): "No room just now".
- **Ribbon Jelly plate:** always the outline state, with the blurb "Not for sale. The Guardian decides." Once received: "In your sea".

**Buying.** A shared-element handoff:
- The plate's specimen lifts out of its plate.
- The engine spawns the creature at that screen point, converted to world coordinates, and it swims to its home.
- For decorations, a 400ms crossfade happens at the slot.
- Captions: "Welcome, {petName}." or "The kelp has settled in."

**Closing.** CLOSE, Esc, or a tap on the water above the scrim.

### 7.6 The bottle and the note

**In the world.**
- Once a day, after 06:00 local time, the bottle enters the surface band (y 6–12%) from the left, drifting at 10px/s and bobbing ±4px.
- **Bottle drawing:** a flat glass shape with an `#96E6DC` fill at α .25, a 1px light edge on one side, a `cork` cork tied with `coral` string, a rolled paper visible inside, and a `lantern` glow inside pulsing at 0.4Hz.
- After 3s, "for you" in handwriting writes itself on beside it (a left-to-right mask wipe over 700ms) with a small hand-drawn arrow.
- If she does not tap it within 60s, it sinks gently onto the L5 shelf and waits there, glowing.

**Opening.**
1. The bottle drifts toward the camera, scaling 1 → 2.2 with its fog lifting.
   - Desktop: it goes to x 30%, y 34%.
   - Phone: x 24%, y 18%.
2. The cork pops (14px up, 25° rotation, 220ms) with 5 bubbles.
3. The paper slides out of the neck and **unrolls downward**: a `clip-path: inset(0 0 100% 0)` → `inset(0)` over 1100ms `ease-enter`. In sync, a 10px curl cylinder (a gradient: paper, 18% darker, paper) travels down the bottom edge.

**The paper.**
- **Size:** 360px wide on desktop. On phone: `min(360px, 100vw − 40px)`, left-aligned at 20px.
- **Rotation:** −1.2°.
- It is anchored to the bottle, **never to the viewport centre**.
- **Edges:** a deckled top edge (30-point jitter of ±1.5px, an SVG mask) and square sides.
- **Surface:** the mode's paper color. Faint fibre strokes (12 seeded hairlines at 4%). One `paper-stain` bloom in a corner. Faint ruled lines in `paper-ink` at α .10, pitched to the line-height. **Paper texture is used here and nowhere else.**
- **Contents:**
  - The date at the top (DM Mono, 11px).
  - The note in Nothing You Could Do.
    - Each line gets a seeded rotation of ±0.4° and a baseline shift of ±1px.
    - Lines **write themselves in** with a left-to-right mask sweep at 40 characters per second, each line starting when the previous one ends.
    - Notes are capped at about 260 characters.
  - The signature:
    - If `signaturePath` is set, it draws in with `stroke-dashoffset` over 900ms at 1.4px.
    - Otherwise, "— R." in handwriting at 26px.
  - Bottom-right: **Keep it** (an underlined text action).

**Dismissing.** Keep it, a tap outside, or Esc.
- The paper re-rolls over 600ms `ease-exit`.
- The bottle drifts back and sinks to the shelf over 1.6s, where it stays as a keepsake.

### 7.7 Letters (replaces v1's shell menu)
- A tall strip of the same paper slides in from the right edge.
  - Desktop: 380px wide, with a deckled left edge.
  - Phone: full width minus 20px.
  - It is anchored to the edge, not centred.
- **Header:** CLOSE (tracked caps).
- **Entries:** the date (DM Mono, 11px) over the first line in handwriting (19px), with a 1px rule at 15% ink between entries. No cards.
- **Footer** (Jost 300, 15px): "Another bottle drifts in tomorrow."
- **Empty state:** "No letters yet. The first bottle is on its way."
- Tapping an entry closes the strip and unrolls that note beside its shelf bottle.

### 7.8 Accessibility
- A visually hidden `<ul>` of real buttons mirrors every creature, the whale (while it is passing), the bottle and the pearls. Example label: "Luma, moon jelly. Touch."
- Focusing a button calls `focusCreature(id)`: the engine draws a 1px ring (at the hit radius) in the current ink and shows the callout. Enter triggers the tap.

### 7.9 Copy tone and labels
Warm, short, second person, sentence case. Never exclamation marks.

| v1 | v2 |
|---|---|
| "Midnight" pill | dial + MIDNIGHT |
| "Shop" pill | SHOP |
| shell button | LETTERS |
| "Adopt · 30" pill | pearl glyph + 30 · Adopt |
| "A note!" | "for you" (handwritten) |
| "WASHED ASHORE TODAY" style headers | none |
| tabs | Life · Seabed |

Captions:
- "Welcome, Pip."
- "The Guardian is passing."
- "The Guardian left you a pearl."
- "They do this every morning."
- "The Guardian left something new." (and, if `ribbonEpithet` is set) "It's named for you."

---

## 8. Motion

### 8.1 The rule
**Things light up fast and fade slowly.**
- Every flash uses `envelope()`: 80ms linear attack, then exponential decay with τ = 0.9s, so about 5% remains at 2.7s.
- Nothing pulses on a symmetric CSS keyframe loop.

### 8.2 Easing tokens

| Token | Curve | Use |
|---|---|---|
| `ease-enter` | `cubic-bezier(0.16, 1, 0.3, 1)`, 700ms | UI in, paper unroll (1100ms), shop camera (900ms) |
| `ease-exit` | `cubic-bezier(0.7, 0, 0.84, 0)`, 350ms | UI out, paper re-roll (600ms) |
| `ease-drift` | sine | All ambient loops |
| `ease-dart` | `cubic-bezier(.2, .8, .2, 1)`, 1.4s | Seahorse dart |
| Creature springs | stiffness 60, damping 14 | Head tilt, and the spin (overshoot under 8%). **Springs belong to creatures only.** |

**UI movement.**
- UI moves only with opacity plus an 8px translate, coming from its physical origin: captions rise, the letters strip slides from the right, the shop from below.
- **No scale-pop entrances.**
- Leader lines draw over 300ms. The pearl count rolls over 600ms.

### 8.3 Ambient speeds
- Periods are deliberately mismatched (7.3, 9.1, 11.1, 13.7 and 20s, with seeded phases) so nothing syncs.
- **Nothing ambient moves faster than 20px/s**, except whale-wake sparks.
- Speeds:
  - snow: far 4px/s, mid 8px/s, near 14px/s, all falling
  - kelp wall: 9–13s
  - seagrass: 7–11s
  - shafts: ±3° over 20s
  - caustics: 6 and 9px/s
  - jelly pulses: 2.4–3.6s
  - seahorse bob: about 7s
  - fins: about 3.8Hz
  - camera drift: ±10px over 120s
- Every tap answers within 100ms, **light first, motion second**.

### 8.4 Hero-event queue
- The greeting, bottle and whale **never overlap**.
- Priority: greeting, then bottle, then whale, with at least 20s between them.
- A mode change waits if a hero event is mid-climax, for at most 4s.

### 8.5 Signature moment: "Light descends"
1. The dial marker slides along its arc (1.2s). The depth gauge fades in.
2. The new light enters at the surface and **sinks**.
   - Each water stop, layer token and decoration starts its OKLab blend when the descending front reaches its horizon: `delay = horizonY × 2.4s`, then a 1.6s blend. Total about 4s.
   - Sunset literally pours down through the water.
   - `inkTop` switches at 0.3s and `inkDeep` at 2.4s.
   - The photic segment shortens in sync.
   - The water cache is redrawn each frame (half-res) only during this window.
3. **Going to Midnight.** When the front reaches the seabed, bioluminescence switches on **from the bottom up** over 1.5s, in this order:
   - seabed plankton dots
   - sea-fan polyps
   - kelp-bulb lanterns
   - seahorse rims
   - the jellies' rim lanterns, running around their margins
   - the whale constellation, if the whale is passing.

   Each lantern **catches like a candle**: intensity 0.4 → 0.1 → 0.8 → 0.5 → 1.0 over 500ms, then holds.
4. **Leaving Midnight:** the lights go out top-down over 1s, then the new daylight descends.

**`prefers-reduced-motion`.**
- Parallax and camera drift are off. Ambient speeds are halved.
- The descent becomes a 1.2s crossfade. No candle flicker.
- The note appears fully written. The bottle fades in.
- The whale front fires at half amplitude.

---

## 9. Signature subject details (must ship)

1. **The seahorse pair.** The morning greeting, with tails linked and colour rising (§5.2), the idle tail-link, and the shared courtship twirl. This is the emotional centre: a couple in the tank, told through real behaviour.
2. **The Guardian's Wake.** At Midnight the whale is seen only by the plankton it disturbs and by her constellation. A tap sends a light front that sets off every jelly's own display in turn (§5.3). The first pass comes at 90s so she meets it on her first visit.
3. **The real moon** through Snell's window, in tonight's actual phase. When she looks up from the tank, it is the same moon.
4. **Her sea has a fixed shape.** The terrain is seeded from `seaSeed` (their anniversary, if Radius sets it), so the same seamounts greet her on every visit.
5. **Kept bottles.** Every opened note sinks to the seabed shelf and glows faintly at night. Tapping one rereads it.
6. **Edition of one.** "no. 1 of 1 — for {herName}, from R." in handwriting on the seabed lip.
7. **The Ribbon Jelly.**
   - Once she owns 3 or more creatures, about 1 in 6 whale passes also releases a Ribbon Jelly from the wake. It is unique: once only, alongside the pearl.
   - Its callout is the **single exception** to the Latin rule: line 2 reads "*Chrysaora {ribbonEpithet}* · named for you". This applies only if `ribbonEpithet` is set; otherwise it reads "Ribbon jelly · a gift from the Guardian".
   - No backstory text, no "sp. nov.", no historical references.
8. **Species-true touch displays:** Moon canal cascade, Dream pinwheel, Sunset wart sparkle, Ribbon ribbon-run.
9. **Signature.** Radius's real traced signature draws in on every note. Until Radius supplies it, the fallback is a plain handwritten "— R.".

---

## 10. Do-not list

**v1 and generic-UI tells**
- No glassmorphism, frosted pills, `backdrop-filter`, rounded-full buttons with 1px translucent borders, rounded-3xl modals, or rounded cards.
- No drop shadows on UI.
- No centred modals. Do not add a pill or circle button "just for close".
- No yellow "Adopt · 30" pills and no generic list rows.
- No emoji. No icon fonts.
- No Fredoka, Nunito, Caveat, Inter, Space Grotesk, Poppins, Playfair, Cormorant, Courier Prime, Old Standard TT, Cedarville Cursive or Caprasimo. No Jost 200.
- No cream `#F4F1EA` paper, no serif + terracotta, no purple-to-blue hero gradients.

**Clichés we are also avoiding**
- No wall-to-wall tracked caps. There is a 4-word maximum on screen: SHOP, LETTERS, the mode name, CLOSE.
- No plate numbers, "Fig. n", Roman numerals, telemetry readouts (depth, °C, lux), viewfinder corner brackets, or metre labels.
- The depth gauge exists only during a descent and has no numerals.
- Latin appears **only** on shop plates, plus the one Ribbon Jelly line.
- No scrapbook kit: no washi tape, stamps, tags, pockets, binder holes, valances, risograph misregistration, or grain on everything.
- No neon-on-black:
  - Midnight stays lifted indigo, with nothing below L5 `#0B0F34` except the L6 occluder.
  - Cyan is used only on living things, never on UI chrome.
  - Glows always fall off from core to body to halo.
  - Never use flat saturated glow strokes.
  - Nothing glows by day.
- Do not darken Day.

**Creatures and terrain**
- No faces, dot eyes with highlights, smiles or blush. Seahorses get a pinhole eye only. Jellies get nothing.
- Do not ship faceless creatures with only sine bobbing. The head tilt, dart, feeding spin, tail-link, greeting and rim lanterns are required.
- No sine-wave terrain and no mirrored composition. Every layer has a noise profile, a hand-placed asymmetric landmark and a sediment cap.
- Snell's window must never read as a plain radial spotlight.
- No rising ambient bubbles: snow falls, and only creature and whale bubbles rise.
- Seahorses are not jointed puppets, and nothing rubber-squashes.

**Radius's inputs**
- Never invent her name, Radius's signature, the anniversary seed, the constellation or the epithet. Use the config fallbacks.
- No historical backstory about naming species.
- No invented script glyphs on the ruins. No Venus's flower basket.

**Rendering**
- No `shadowBlur` in the loop, no runtime `ctx.filter`, no per-frame gradient creation, no double-draw bloom pipeline, no full-screen per-frame dither pass, no gyro or DeviceOrientation.
- No animated stroke under 1 device pixel.
- No more than 24 glow sprites per frame.
- No full-screen offscreen canvases beyond the §4.7 list.

**Pacing**
- Never overlap the whale, the bottle and the greeting.
- Never swap time of day instantly, except under reduced motion.
- No UI springs and no opacity+scale pop-ins.
- No text-only control with a hit area under 44×44.
---

## 11. iPhone Safari (primary device)

Radius's girlfriend will mostly play on an **iPhone 17 in Safari**. Design and test phone-first.

- Viewport about **402 × 874 CSS px**, devicePixelRatio 3 (the engine caps the canvas at 2).
- **Safe areas:** the Dynamic Island takes about 59–62px at the top and the home indicator about 34px at the bottom. Every HUD element, caption, panel and the edition mark sits inside `env(safe-area-inset-*)` plus the 20px phone margin. The canvas itself runs edge to edge under them.
- **Touch only:** no hover-only affordance anywhere. Tap = pointerup within 10px and 400ms of pointerdown. Every control has a 44 × 44 hit area. The canvas has `touch-action: none` so drags never scroll or zoom; the page never rubber-bands.
- **Safari canvas:** no `ctx.filter`, no `shadowBlur` in the loop, no `OffscreenCanvas` transfer (plain `document.createElement('canvas')` buffers are fine). `Path2D`, `ellipse`, `lighter`/`screen` compositing are fine.
- **Low Power Mode** caps rAF at 30fps, so every animation is driven by `dt`, never by frame counts.
- **Fonts on canvas:** wait for `document.fonts.load('20px "Nothing You Could Do"')` (and Jost) before drawing canvas text.
- **Layout:** the root is `position: fixed; inset: 0`, never `100vh`. Panels that scroll use `overscroll-behavior: contain`.
- The phone layout notes in §7.1, §7.5 and §7.6 are the primary layout, not an afterthought.
- **Fonts ship with the app** (latin woff2 subsets in `src/assets/fonts`, inlined by the single-file build). No third-party font request can block the first paint.
- **Saving:** localStorage (instant, works everywhere). Safari may clear site data after a long time away, so the sea is saved on every change.
