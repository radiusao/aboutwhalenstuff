/**
 * Dev-only visual harness for one world module at a time, with a static mock Lighting
 * and WorldFrame. Not part of the app build.
 *
 *   /harness.html?module=jellyfish&variant=cyan&mode=midnight&count=3
 *   /harness.html?module=seahorse&variant=coral&mode=day&tap=2   (tap after 2s)
 *   /harness.html?module=whale&mode=midnight
 *   /harness.html?module=scenery&mode=sunset&decor=kelp-forest,glowing-coral,treasure-chest,ancient-ruins
 *   /harness.html?module=objects&mode=midnight&bottle=1&pearl=1
 *   /harness.html?module=engine  (the real engine with a sample SceneInput)
 * Add &t=8 to fast-forward 8 seconds before the first paint (useful for screenshots).
 */
import type { LightingMode } from '../types/sanctuary';
import type { CreatureEntity, Lighting, WorldFrame } from '../world/types';
import { modeTokens, waterAtMode } from '../world/palette';
import { drawGlow } from '../world/light';

const q = new URLSearchParams(location.search);
const mode = (q.get('mode') ?? 'midnight') as LightingMode;
const moduleName = q.get('module') ?? 'jellyfish';
const variant = q.get('variant') ?? '';
const count = Number(q.get('count') ?? 1);
const tapAt = q.get('tap') ? Number(q.get('tap')) : null;
const skip = Number(q.get('t') ?? 0);
const logEl = document.getElementById('log')!;

const canvas = document.getElementById('c') as HTMLCanvasElement;
const ctx = canvas.getContext('2d')!;
const dpr = Math.min(devicePixelRatio || 1, 2);
let w = innerWidth;
let h = innerHeight;
function size() {
  w = innerWidth;
  h = innerHeight;
  canvas.width = Math.round(w * dpr);
  canvas.height = Math.round(h * dpr);
}
size();

const tok = modeTokens[mode];
const lighting: Lighting = {
  mode,
  from: mode,
  progressAt: () => 1,
  color: (t) => tok.color[t],
  num: (t) => tok.num[t],
  waterAt: (y) => waterAtMode(mode, y),
  glowGain: () => tok.num.glowGain,
  biolum: () => (mode === 'midnight' ? 1 : 0),
  fogForZ: (z) => 0.5 * (1 - z),
  reducedMotion: false,
};

interface Bubble { x: number; y: number; vy: number; r: number; life: number; color: string }
const bubbles: Bubble[] = [];
const sparks: { x: number; y: number; vx: number; vy: number; life: number; max: number }[] = [];
let glows = 0;
const pointer = { x: -999, y: -999, active: false, down: false };
canvas.addEventListener('pointermove', (e) => { pointer.x = e.clientX; pointer.y = e.clientY; pointer.active = true; });
canvas.addEventListener('pointerleave', () => { pointer.active = false; });

const frame: WorldFrame = {
  t: 0,
  dt: 1 / 60,
  w,
  h,
  dpr,
  phone: w < 640,
  lineWidth: Math.max(0.75, 1 / dpr),
  lighting,
  pointer,
  parallax: () => ({ x: 0, y: 0 }),
  glow: (color, x, y, r, a) => {
    if (glows++ >= 24) return;
    drawGlow(ctx, color, x, y, r, a);
  },
  bubbles: (x, y, o = {}) => {
    const n = o.count ?? 6;
    for (let i = 0; i < n; i++) {
      const [s0, s1] = o.speed ?? [30, 45];
      const [r0, r1] = o.size ?? [1.5, 3.5];
      bubbles.push({ x: x + (Math.random() - 0.5) * 2 * (o.spread ?? 8), y, vy: s0 + Math.random() * (s1 - s0), r: r0 + Math.random() * (r1 - r0), life: 2.5, color: o.color ?? '#ffffff' });
    }
  },
  spark: (x, y, vx, vy, life = 1.6) => { sparks.push({ x, y, vx, vy, life, max: life }); },
  exciteAt: () => {},
  jellies: [],
  anchors: [],
  quality: 1,
};

function background() {
  const g = ctx.createLinearGradient(0, 0, 0, h);
  for (let i = 0; i <= 8; i++) g.addColorStop(i / 8, waterAtMode(mode, i / 8));
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, w, h);
}

function drawParticles() {
  for (let i = bubbles.length - 1; i >= 0; i--) {
    const b = bubbles[i];
    b.y -= b.vy * frame.dt;
    b.life -= frame.dt;
    if (b.life <= 0) { bubbles.splice(i, 1); continue; }
    ctx.strokeStyle = b.color;
    ctx.globalAlpha = Math.min(1, b.life) * 0.6;
    ctx.lineWidth = frame.lineWidth;
    ctx.beginPath();
    ctx.arc(b.x, b.y, b.r, 0, Math.PI * 2);
    ctx.stroke();
  }
  ctx.globalAlpha = 1;
  for (let i = sparks.length - 1; i >= 0; i--) {
    const s = sparks[i];
    s.x += s.vx * frame.dt; s.y += s.vy * frame.dt; s.life -= frame.dt;
    if (s.life <= 0) { sparks.splice(i, 1); continue; }
    ctx.fillStyle = '#5FF3E6';
    ctx.globalAlpha = s.life / s.max;
    ctx.fillRect(s.x - 1, s.y - 1, 2, 2);
  }
  ctx.globalAlpha = 1;
}

type Step = (now: number) => void;

async function main() {
  const mods = import.meta.glob('../world/**/*.ts');
  const load = async (path: string) => {
    const imp = mods[path];
    if (!imp) throw new Error(`missing module ${path}`);
    return (await imp()) as Record<string, unknown>;
  };

  let step: Step;
  if (moduleName === 'jellyfish' || moduleName === 'seahorse') {
    const m = await load(`../world/creatures/${moduleName}.ts`);
    const factory = (moduleName === 'jellyfish' ? m.createJellyfish : m.createSeahorse) as (i: unknown) => CreatureEntity;
    const variants = variant ? variant.split(',') : moduleName === 'jellyfish' ? ['cyan', 'lilac', 'gold', 'ribbon'] : ['coral', 'gold', 'lilac'];
    const entities: CreatureEntity[] = [];
    let k = 0;
    for (let i = 0; i < count; i++) {
      for (const v of variants) {
        const n = count * variants.length;
        const x = (k + 0.5) / n;
        entities.push(factory({ id: `${v}-${i}`, variant: v, seed: 1234 + k * 77, home: { x, y: moduleName === 'seahorse' ? 0.8 : 0.45 }, w, h }));
        k++;
      }
    }
    const director = moduleName === 'seahorse' && typeof m.createSeahorseDirector === 'function'
      ? (m.createSeahorseDirector as () => { update: (s: CreatureEntity[], f: WorldFrame, idle: number) => void; startGreeting: (s: CreatureEntity[], f: WorldFrame) => boolean })()
      : null;
    if (moduleName === 'seahorse') {
      // Fake seagrass anchors along the bottom so seahorses have something to hold.
      (frame as { anchors: WorldFrame['anchors'] }).anchors = Array.from({ length: 12 }, (_, i) => ({
        x: ((i + 0.5) / 12) * w, y: h * 0.86, height: 70,
        swayAt: (along: number, t: number) => Math.sin(t * 0.7 + i) * 6 * along,
      }));
    }
    if (q.get('greet')) setTimeout(() => director?.startGreeting(entities, frame), Number(q.get('greet')) * 1000);
    canvas.addEventListener('pointerup', (e) => {
      for (const en of entities) if (en.hitTest(e.clientX, e.clientY)) en.tap(frame);
    });
    step = () => {
      (frame as { jellies: WorldFrame['jellies'] }).jellies = entities.filter((e) => e.kind === 'jellyfish').map((e) => ({ id: e.id, x: e.x, y: e.y, z: e.z }));
      director?.update(entities, frame, frame.t);
      for (const en of entities) en.update(frame);
      background();
      if (moduleName === 'seahorse') {
        ctx.fillStyle = tok.color.l4;
        ctx.fillRect(0, h * 0.86, w, h * 0.14);
      }
      for (const en of [...entities].sort((a, b) => a.z - b.z)) en.draw(ctx, frame, q.get('outline') ? { outline: true, outlineColor: '#E9F7F3' } : undefined);
      drawParticles();
    };
    if (tapAt !== null) setTimeout(() => entities.forEach((e) => e.tap(frame)), tapAt * 1000);
  } else if (moduleName === 'whale') {
    const m = await load('../world/creatures/whale.ts');
    const whale = (m.createWhale as (i: unknown) => import('../world/types').WhaleEntity)({ seed: 7, constellation: null, w, h, phone: w < 640 });
    whale.start(frame, 1);
    canvas.addEventListener('pointerup', (e) => { if (whale.hitTest(e.clientX, e.clientY)) whale.exhale(frame); });
    step = () => {
      whale.update(frame);
      background();
      whale.draw(ctx, frame);
      drawParticles();
    };
  } else if (moduleName === 'scenery') {
    const m = await load('../world/scenery.ts');
    const scenery = (m.createScenery as () => import('../world/scenery').Scenery)();
    scenery.resize(w, h, w < 640, dpr);
    scenery.setDecorations((q.get('decor') ?? '').split(',').filter(Boolean));
    (frame as { anchors: WorldFrame['anchors'] }).anchors = scenery.anchors;
    step = () => {
      scenery.drawWater(ctx, frame);
      scenery.drawSurface(ctx, frame);
      scenery.drawRidge(ctx, frame);
      scenery.drawShelf(ctx, frame);
      scenery.drawKelpWall(ctx, frame);
      scenery.drawReef(ctx, frame);
      scenery.drawSeabed(ctx, frame);
      scenery.drawOccluders(ctx, frame);
      scenery.drawVignette(ctx, frame);
    };
  } else if (moduleName === 'objects') {
    const m = await load('../world/objects.ts');
    const objects = (m.createWorldObjects as (cb: unknown) => import('../world/objects').WorldObjects)({
      onBottle: (s: string) => { logEl.textContent = `bottle: ${s}`; },
      onPearl: (p: string) => { logEl.textContent = `pearl: ${p}`; },
    });
    objects.resize(w, h, w < 640);
    objects.setSeabed(() => h * 0.86);
    objects.setShelf({ x: w * 0.38, y: h * 0.85, w: w * 0.14 }, (q.get('kept') ?? 'm1,m2,m3').split(',').filter(Boolean));
    if (q.get('bottle')) objects.bottleArrive(frame);
    if (q.get('pearl')) objects.releasePearl({ x: w * 0.5, y: h * 0.35 }, frame);
    if (q.get('open')) setTimeout(() => objects.openBottle(frame), Number(q.get('open')) * 1000);
    canvas.addEventListener('pointerup', (e) => {
      const hit = objects.hit(e.clientX, e.clientY);
      logEl.textContent = JSON.stringify(hit);
      if (hit?.kind === 'bottle') objects.openBottle(frame);
      if (hit?.kind === 'pearl') objects.collectPearl(frame);
    });
    step = () => {
      objects.update(frame);
      background();
      ctx.fillStyle = tok.color.l5;
      ctx.fillRect(0, h * 0.86, w, h * 0.14);
      objects.drawSurfaceBand(ctx, frame);
      objects.drawMidwater(ctx, frame);
      objects.drawSeabed(ctx, frame);
      drawParticles();
      objects.drawForeground(ctx, frame);
    };
  } else if (moduleName === 'engine') {
    const m = await load('../world/engine.ts');
    const engine = (m.createEngine as () => import('../world/types').Engine)();
    engine.mount(canvas);
    engine.setMode(mode, { instant: true });
    engine.sync({
      creatures: [
        { id: 'j1', type: 'jellyfish', variant: 'cyan', name: 'Luma', position: { x: 58, y: 40 }, happiness: 80 },
        { id: 'j2', type: 'jellyfish', variant: 'lilac', name: 'Wisp', position: { x: 30, y: 30 }, happiness: 60 },
        { id: 'j3', type: 'jellyfish', variant: 'gold', name: 'Sol', position: { x: 75, y: 55 }, happiness: 90 },
        { id: 's1', type: 'seahorse', variant: 'coral', name: 'Pip', position: { x: 30, y: 78 }, happiness: 70 },
        { id: 's2', type: 'seahorse', variant: 'gold', name: 'Mochi', position: { x: 44, y: 80 }, happiness: 70 },
      ],
      decorations: (q.get('decor') ?? 'kelp-forest,glowing-coral,treasure-chest,ancient-ruins').split(',').filter(Boolean),
      shelf: ['m1', 'm2'],
      bottleAvailable: !!q.get('bottle'),
      greetingDue: !!q.get('greet'),
      hasRibbon: false,
    });
    if (q.get('whale')) engine.summonWhale();
    if (q.get('bottle')) engine.summonBottle();
    if (q.get('to')) setTimeout(() => engine.setMode(q.get('to') as LightingMode), 500);
    (window as unknown as { engine: unknown }).engine = engine;
    return;
  } else {
    throw new Error(`unknown module ${moduleName}`);
  }

  let last = performance.now();
  // Fast-forward for screenshots.
  for (let i = 0; i < skip * 60; i++) {
    frame.t += 1 / 60;
    frame.dt = 1 / 60;
    glows = 0;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    step(0);
  }
  const loop = (now: number) => {
    frame.dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    frame.t += frame.dt;
    frame.w = w;
    frame.h = h;
    glows = 0;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    step(now);
    requestAnimationFrame(loop);
  };
  requestAnimationFrame(loop);
}

addEventListener('resize', size);
main().catch((e) => {
  logEl.textContent = String(e?.stack ?? e);
  console.error(e);
});
