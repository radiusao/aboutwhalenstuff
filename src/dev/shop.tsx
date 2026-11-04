/**
 * Dev-only page for the shop, open over a static water gradient with a mock engine.
 *
 *   /dev-shop.html?mode=day&pearls=40
 *   /dev-shop.html?mode=midnight&pearls=500&owned=kelp-forest&tab=seabed
 *   /dev-shop.html?mode=sunset&pearls=500&full=seahorse&ribbon=1&scroll=3
 *
 * Saves never touch the real app's storage. The top bar stands in for the HUD.
 */
import { StrictMode, useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { MotionConfig } from 'framer-motion';
import '../index.css';
import type { LightingMode, SanctuaryState } from '../types/sanctuary';
import type { Engine } from '../world/types';
import { modeTokens, waterAtMode, waterStops } from '../world/palette';
import { EngineProvider } from '../world/EngineContext';
import { SanctuaryProvider, useSanctuary } from '../context/SanctuaryContext';
import { UiStateProvider, useUiState } from '../components/uiState';
import { createInitialState, CREATURE_CAPS, RIBBON_JELLY } from '../data/initialData';
import { Shop } from '../components/shop';

const q = new URLSearchParams(location.search);
const mode = (q.get('mode') ?? 'midnight') as LightingMode;

// Keep this page's saves in memory so it never overwrites the real sanctuary.
const mem = new Map<string, string>();
const realGet = Storage.prototype.getItem;
const realSet = Storage.prototype.setItem;
Storage.prototype.getItem = function (k: string) {
  return k.startsWith('drift-and-discover') ? (mem.get(k) ?? null) : realGet.call(this, k);
};
Storage.prototype.setItem = function (k: string, v: string) {
  if (k.startsWith('drift-and-discover')) mem.set(k, v);
  else realSet.call(this, k, v);
};

// The sanctuary opens on the light matching the clock; pretend the clock agrees with ?mode.
const hour = { day: 12, sunset: 18, midnight: 23 }[mode];
Date.prototype.getHours = () => hour;
Date.prototype.getMinutes = () => 0;

function seed(): SanctuaryState {
  const s = createInitialState();
  s.pearls = Number(q.get('pearls') ?? 40);
  s.unlockedDecorations = (q.get('owned') ?? '').split(',').filter(Boolean);
  const full = q.get('full');
  if (full === 'jellyfish' || full === 'seahorse') {
    const variant = full === 'jellyfish' ? 'cyan' : 'coral';
    while (s.creatures.filter((c) => c.type === full).length < CREATURE_CAPS[full]) {
      const n = s.creatures.length;
      s.creatures.push({ ...s.creatures[0], id: `${full}-dev-${n}`, type: full, colorVariant: variant, name: `Dev ${n}` });
    }
  }
  if (q.get('ribbon')) {
    s.creatures.push({ ...s.creatures[0], id: 'ribbon-dev', colorVariant: RIBBON_JELLY.colorVariant, name: 'Ribbon' });
  }
  return s;
}
mem.set('drift-and-discover:sanctuary:v1', JSON.stringify(seed()));

// What the HUD normally does: mode inks and scrim colours on <html>.
function applyInks(m: LightingMode) {
  const root = document.documentElement.style;
  root.setProperty('--ink-top', modeTokens[m].color.inkTop);
  root.setProperty('--ink-deep', modeTokens[m].color.inkDeep);
  root.setProperty('--scrim', waterAtMode(m, 1));
  root.setProperty('--scrim-top', waterAtMode(m, 0));
  root.setProperty('--bg', waterAtMode(m, 0.5));
}

const log: string[] = [];
const noop = () => {};
const mockEngine: Engine = {
  mount: noop,
  destroy: noop,
  sync: noop,
  setMode: noop,
  setCameraShift: (open) => {
    log.push(`setCameraShift(${open})`);
    console.info('[engine] setCameraShift', open);
  },
  spawnHint: (id, from) => {
    log.push(`spawnHint(${id}, ${Math.round(from.x)}, ${Math.round(from.y)})`);
    console.info('[engine] spawnHint', id, from);
  },
  feed: noop,
  focusCreature: noop,
  tapWhale: noop,
  tapGuardianPearl: noop,
  openBottle: noop,
  closeBottle: noop,
  queueGreeting: noop,
  creatureAt: () => null,
  waterAt: (y) => waterAtMode(mode, y),
  on: () => noop,
  summonWhale: noop,
  summonBottle: noop,
};
(window as unknown as { shopLog: string[] }).shopLog = log;

/** The static sea behind the shop: the mode's water column on a canvas (taps on it close the shop). */
function Water({ m }: { m: LightingMode }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const c = ref.current!;
    const draw = () => {
      const dpr = Math.min(2, devicePixelRatio || 1);
      c.width = innerWidth * dpr;
      c.height = innerHeight * dpr;
      const g = c.getContext('2d')!;
      const grad = g.createLinearGradient(0, 0, 0, c.height);
      for (const [o, col] of waterStops[m]) grad.addColorStop(o, col);
      g.fillStyle = grad;
      g.fillRect(0, 0, c.width, c.height);
    };
    draw();
    addEventListener('resize', draw);
    return () => removeEventListener('resize', draw);
  }, [m]);
  return <canvas ref={ref} className="absolute inset-0 block h-full w-full" style={{ touchAction: 'none' }} />;
}

function DevBar() {
  const ui = useUiState();
  const { pearls, addPearls, state, toggleLighting } = useSanctuary();
  const m = state.activeLighting;
  const [, force] = useState(0);
  useEffect(() => applyInks(m), [m]);
  useEffect(() => {
    ui.openShop();
    const tab = q.get('tab');
    const scroll = Number(q.get('scroll') ?? 0);
    const t = setTimeout(() => {
      if (tab) document.getElementById(`shop-tab-${tab}`)?.click();
      if (scroll) {
        setTimeout(() => {
          const strip = document.getElementById('shop-strip');
          const plate = strip?.children[scroll] as HTMLElement | undefined;
          if (strip && plate) strip.scrollTo({ left: plate.offsetLeft, behavior: 'auto' });
        }, 400);
      }
    }, 300);
    const id = setInterval(() => force((n) => n + 1), 500);
    return () => {
      clearTimeout(t);
      clearInterval(id);
    };
    // Open once on load.
  }, []);
  const open = ui.panel === 'shop';
  const ink = { color: 'var(--ink-top)' };
  return (
    <div
      className="fixed inset-x-0 top-0 z-30 flex items-center justify-between font-jost text-[12px]"
      style={{ padding: 'max(12px, env(safe-area-inset-top)) 20px 0', ...ink }}
    >
      <button type="button" className="min-h-11 font-mono text-[18px]" onClick={() => addPearls(25)}>
        {pearls}
      </button>
      <div className="flex gap-5">
        <button type="button" className="min-h-11 tracking-[0.18em] uppercase" onClick={() => toggleLighting()}>
          {m}
        </button>
        <button
          type="button"
          className="min-h-11 font-medium tracking-[0.18em] uppercase"
          onClick={() => (open ? ui.closePanel() : ui.openShop())}
        >
          {open ? 'Close' : 'Shop'}
        </button>
      </div>
      <div className="fixed left-5 font-mono text-[11px] opacity-60" style={{ top: 'calc(max(12px, env(safe-area-inset-top)) + 48px)' }}>
        {log.slice(-3).map((l, i) => (
          <div key={i}>{l}</div>
        ))}
        {ui.captions.map((c) => (
          <div key={c.id} className="font-jost text-[15px] font-light opacity-100" data-caption>
            {c.text}
          </div>
        ))}
      </div>
    </div>
  );
}

function App() {
  const { state } = useSanctuary();
  return (
    <div className="fixed inset-0 overflow-hidden select-none">
      <Water m={state.activeLighting} />
      <DevBar />
      <Shop />
    </div>
  );
}

applyInks(mode);
createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <MotionConfig reducedMotion="user">
      <SanctuaryProvider>
        <EngineProvider engine={mockEngine}>
          <UiStateProvider>
            <App />
          </UiStateProvider>
        </EngineProvider>
      </SanctuaryProvider>
    </MotionConfig>
  </StrictMode>,
);
