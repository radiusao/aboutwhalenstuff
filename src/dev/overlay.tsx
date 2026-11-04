/**
 * Dev-only page for the DOM overlay, drawn over a static water gradient with a mock Engine.
 * Not part of the app build.
 *
 *   /dev-overlay.html?mode=day                    open on a mode (day | sunset | midnight)
 *   &inset=59,34                                  simulate safe-area insets (top,bottom px)
 *   &descent=midnight                             start "Light descends" after 600ms
 *   &caption=1  (or &caption=Some+text)           fire a caption; &caption2=1 a second one
 *   &callout=Luma                                 tap a creature by pet name after 400ms
 *   &floater=1                                    "+5" at the middle of the screen
 *   &away=45 / &first=1                           seed the save: 45 minutes away / brand new
 *   &panel=shop | letters | note                  open a panel
 *   &whale=1 &pearl=1 &bottle=1                   fire those engine events
 *   &pearls=128                                   set the pearl balance
 *   &scene=1                                      the real scenery (harness iframe) behind
 *   &tools=1 opens the dev buttons; &clean=1 hides their toggle.
 */
import { StrictMode, useEffect, useRef, useState, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import { MotionConfig } from 'framer-motion';
import '../index.css';
import type { LightingMode } from '../types/sanctuary';
import type { Engine, EngineEvent, EngineEventOf, EngineEventType } from '../world/types';
import { mixOK, waterAtMode } from '../world/palette';
import { EngineProvider, useEngine, useEngineEvent } from '../world/EngineContext';
import { SanctuaryProvider, useSanctuary } from '../context/SanctuaryContext';
import { UiStateProvider, useUiState } from '../components/uiState';
import { Overlay } from '../components/overlay';
import { commonName, createInitialState } from '../data/initialData';
import { bottleMessages } from '../data/messages';
import { saveSanctuary, clearSanctuary } from '../utils/storage';

const q = new URLSearchParams(location.search);
const MODES: LightingMode[] = ['day', 'sunset', 'midnight'];
const asMode = (v: string | null): LightingMode | null => (v && (MODES as string[]).includes(v) ? (v as LightingMode) : null);

if (q.get('first')) clearSanctuary();
if (q.get('away')) saveSanctuary(createInitialState(Date.now() - Number(q.get('away')) * 60_000));
if (q.get('inset')) {
  const [top, bottom = '0'] = q.get('inset')!.split(',');
  document.documentElement.style.setProperty('--sat', `${top}px`);
  document.documentElement.style.setProperty('--sab', `${bottom}px`);
}

// ---------------------------------------------------------------------------
// Mock engine: no canvas, a tiny emitter and a descent clock that mirrors lighting.ts
// ---------------------------------------------------------------------------

interface MockEngine extends Engine {
  setPositions(p: { id: string; x: number; y: number }[]): void;
  emit(e: EngineEvent): void;
}

const sine = (s: number) => 0.5 - 0.5 * Math.cos(Math.PI * Math.min(1, Math.max(0, s)));

function createMockEngine(): MockEngine {
  const subs = new Map<EngineEventType, Set<(e: EngineEvent) => void>>();
  let mode: LightingMode = 'midnight';
  let first = true;
  let descent: { from: LightingMode; to: LightingMode; start: number; out: number; duration: number } | null = null;
  let timer = 0;
  let positions = new Map<string, { x: number; y: number }>();
  const t0 = performance.now();

  const emit = (e: EngineEvent) => subs.get(e.type)?.forEach((cb) => cb(e));
  const at = (id: string) => {
    const p = positions.get(id);
    if (!p) return null;
    const t = (performance.now() - t0) / 1000;
    const seed = id.length * 1.7;
    return { x: p.x + Math.sin(t * 0.35 + seed) * 10, y: p.y + Math.sin(t * 0.5 + seed * 2) * 6, r: 30 };
  };

  return {
    mount() {},
    destroy() {},
    sync() {},
    setMode(next, opts) {
      if (first || opts?.instant) {
        first = false;
        mode = next;
        return;
      }
      if (next === mode) return;
      const out = mode === 'midnight' ? 1 : 0;
      descent = { from: mode, to: next, start: performance.now(), out, duration: out + (next === 'midnight' ? 5.3 : 4) };
      mode = next;
      window.clearInterval(timer);
      timer = window.setInterval(() => {
        if (!descent) return;
        const p = (performance.now() - descent.start) / 1000 / descent.duration;
        if (p >= 1) {
          emit({ type: 'descent', progress: 1, from: descent.from, to: descent.to });
          descent = null;
          window.clearInterval(timer);
          return;
        }
        emit({ type: 'descent', progress: p, from: descent.from, to: descent.to });
      }, 50);
      emit({ type: 'descent', progress: 0, from: descent.from, to: descent.to });
    },
    setCameraShift() {},
    spawnHint() {},
    feed(id) {
      const p = at(id);
      if (p) emit({ type: 'creatureTap', id, ...p });
    },
    focusCreature(id) {
      const p = id ? at(id) : null;
      emit(p && id ? { type: 'focus', id, ...p } : { type: 'focus', id: null, x: 0, y: 0, r: 0 });
    },
    tapWhale() {
      emit({ type: 'whaleTap', x: innerWidth * 0.5, y: innerHeight * 0.42 });
      window.setTimeout(() => emit({ type: 'guardianPearl', phase: 'released', x: innerWidth * 0.5, y: innerHeight * 0.45 }), 800);
    },
    tapGuardianPearl() {
      emit({ type: 'guardianPearl', phase: 'collected', x: innerWidth * 0.55, y: innerHeight * 0.84 });
    },
    openBottle() {
      emit({ type: 'bottle', state: 'opening', x: innerWidth * 0.3, y: innerHeight * 0.3 });
    },
    closeBottle() {
      emit({ type: 'bottle', state: 'shelved', x: innerWidth * 0.45, y: innerHeight * 0.85 });
    },
    queueGreeting() {},
    creatureAt: at,
    waterAt(y) {
      if (!descent) return waterAtMode(mode, y);
      const t = (performance.now() - descent.start) / 1000;
      return mixOK(waterAtMode(descent.from, y), waterAtMode(descent.to, y), sine((t - descent.out - y * 2.4) / 1.6));
    },
    on<T extends EngineEventType>(type: T, cb: (e: EngineEventOf<T>) => void) {
      const set = subs.get(type) ?? new Set();
      subs.set(type, set);
      const f = cb as (e: EngineEvent) => void;
      set.add(f);
      return () => set.delete(f);
    },
    summonWhale() {
      emit({ type: 'whale', phase: 'arriving' });
      window.setTimeout(() => emit({ type: 'whale', phase: 'passing' }), 1500);
    },
    summonBottle() {
      emit({ type: 'bottle', state: 'arriving', x: innerWidth * 0.3, y: innerHeight * 0.12 });
    },
    setPositions(list) {
      positions = new Map(list.map((p) => [p.id, { x: p.x, y: p.y }]));
    },
    emit,
  };
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

/** Paints the water gradient (and keeps it in step with the mock descent). */
function Water() {
  const engine = useEngine();
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    let raf = 0;
    const paint = () => {
      const stops = Array.from({ length: 13 }, (_, i) => `${engine.waterAt(i / 12)} ${((i / 12) * 100).toFixed(1)}%`);
      if (ref.current) ref.current.style.background = `linear-gradient(${stops.join(',')})`;
      raf = requestAnimationFrame(paint);
    };
    paint();
    return () => cancelAnimationFrame(raf);
  }, [engine]);
  return <div ref={ref} className="absolute inset-0" />;
}

function Scene({ mode }: { mode: LightingMode }) {
  return (
    <iframe
      title="scene"
      src={`/harness.html?module=scenery&mode=${mode}&decor=${q.get('decor') ?? 'kelp-forest,treasure-chest'}`}
      className="pointer-events-none absolute inset-0 h-full w-full border-0"
    />
  );
}

/** Holds the page until saved state is on the requested mode, so the inks start right. */
function ForceMode({ mode, children }: { mode: LightingMode | null; children: ReactNode }) {
  const { state, toggleLighting } = useSanctuary();
  const [ready, setReady] = useState(!mode || state.activeLighting === mode);
  useEffect(() => {
    if (ready || !mode) return;
    if (state.activeLighting === mode) setReady(true);
    else toggleLighting(mode);
  }, [ready, mode, state.activeLighting, toggleLighting]);
  return ready ? <>{children}</> : null;
}

function sinceLabel(adoptedAt: number | undefined): string {
  if (!adoptedAt) return '';
  return ` · since ${new Date(adoptedAt).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}`;
}

/** The parts of Sanctuary's wiring the overlay needs. */
function Wiring({ engine }: { engine: MockEngine }) {
  const ui = useUiState();
  const { state, feedCreature, addPearls } = useSanctuary();
  const firstMode = useRef(true);

  useEffect(() => {
    engine.setPositions(
      state.creatures.map((c) => ({ id: c.id, x: (c.position.x / 100) * innerWidth, y: (c.position.y / 100) * innerHeight })),
    );
  }, [engine, state.creatures]);

  useEffect(() => {
    engine.setMode(state.activeLighting, { instant: firstMode.current });
    firstMode.current = false;
  }, [engine, state.activeLighting]);

  const showCalloutFor = (id: string, x: number, y: number, r: number) => {
    const c = state.creatures.find((cr) => cr.id === id);
    if (!c) return;
    ui.showCallout({ id, x, y, r, name: c.name, sub: `${commonName(c.type, c.colorVariant)}${sinceLabel(c.adoptedAt)}` });
  };

  useEngineEvent('creatureTap', (e) => {
    const bonus = feedCreature(e.id) || 5;
    ui.floater(`+${bonus}`, e.x, e.y - e.r);
    showCalloutFor(e.id, e.x, e.y, e.r);
  });
  useEngineEvent('focus', (e) => {
    if (e.id) showCalloutFor(e.id, e.x, e.y, e.r);
    else ui.hideCallout();
  });
  useEngineEvent('whale', (e) => {
    if (e.phase === 'arriving') ui.caption('The Guardian is passing.');
  });
  useEngineEvent('guardianPearl', (e) => {
    if (e.phase === 'released') ui.caption('The Guardian left you a pearl.');
    if (e.phase === 'collected') {
      addPearls(25);
      ui.floater('+25', e.x, e.y);
    }
  });
  return null;
}

/** Fires the URL-param scenarios once. */
function Scenarios({ engine }: { engine: MockEngine }) {
  const ui = useUiState();
  const { state, toggleLighting, addPearls, pearls } = useSanctuary();
  const done = useRef(false);
  useEffect(() => {
    if (done.current) return;
    done.current = true;
    const later = (ms: number, f: () => void) => window.setTimeout(f, ms);
    const cap = q.get('caption');
    if (cap) later(300, () => ui.caption(cap === '1' ? 'The Guardian is passing.' : cap));
    const cap2 = q.get('caption2');
    if (cap2) later(700, () => ui.caption(cap2 === '1' ? 'The Guardian left you a pearl.' : cap2));
    const name = q.get('callout');
    if (name) {
      const c = state.creatures.find((cr) => cr.name.toLowerCase() === name.toLowerCase()) ?? state.creatures[0];
      later(400, () => engine.feed(c.id));
    }
    if (q.get('floater')) later(400, () => ui.floater('+5', innerWidth * 0.5, innerHeight * 0.5));
    const to = asMode(q.get('descent'));
    if (to) later(600, () => toggleLighting(to));
    if (q.get('pearls')) addPearls(Number(q.get('pearls')) - pearls);
    const panel = q.get('panel');
    if (panel === 'shop') ui.openShop();
    if (panel === 'letters') ui.openLetters();
    if (panel === 'note') ui.showNote({ message: { ...bottleMessages[0], date: '2026-10-14' }, anchor: { x: 120, y: 200 }, source: 'bottle' });
    if (q.get('whale')) later(200, () => engine.summonWhale());
    if (q.get('bottle')) later(200, () => engine.summonBottle());
    if (q.get('pearl')) later(200, () => engine.emit({ type: 'guardianPearl', phase: 'landed', x: innerWidth * 0.55, y: innerHeight * 0.84 }));
  });
  return null;
}

function Tools({ engine }: { engine: MockEngine }) {
  const ui = useUiState();
  const { state, toggleLighting } = useSanctuary();
  const [open, setOpen] = useState(!!q.get('tools'));
  const lines = ['The Guardian is passing.', 'The Guardian left you a pearl.', 'They do this every morning.', 'Welcome, Pip.'];
  const n = useRef(0);
  if (q.get('clean')) return null;
  const btn = 'block w-full px-2 py-1 text-left font-mono text-[11px] text-white/80 hover:text-white';
  return (
    <div className="pointer-events-auto fixed left-0 top-1/2 z-50 -translate-y-1/2">
      <button className="px-2 py-1 font-mono text-[10px] text-white/50" onClick={() => setOpen((o) => !o)}>
        dev
      </button>
      {open && (
        <div className="bg-black/60 py-1">
          <button className={btn} onClick={() => toggleLighting()}>next mode</button>
          <button className={btn} onClick={() => ui.caption(lines[n.current++ % lines.length])}>caption</button>
          <button className={btn} onClick={() => engine.feed(state.creatures[n.current++ % state.creatures.length].id)}>tap creature</button>
          <button className={btn} onClick={() => ui.floater('+5', innerWidth * 0.5, innerHeight * 0.5)}>floater</button>
          <button className={btn} onClick={() => engine.summonWhale()}>whale</button>
          <button className={btn} onClick={() => engine.summonBottle()}>bottle</button>
          <button className={btn} onClick={() => engine.tapWhale()}>tap whale</button>
          <button className={btn} onClick={() => (ui.panel === 'shop' ? ui.closePanel() : ui.openShop())}>shop panel</button>
        </div>
      )}
    </div>
  );
}

function Page() {
  const [engine] = useState(createMockEngine);
  const mode = asMode(q.get('mode'));
  return (
    <EngineProvider engine={engine}>
      <UiStateProvider>
        <ForceMode mode={mode}>
          <div className="fixed inset-0 overflow-hidden select-none">
            {q.get('scene') ? <Scene mode={mode ?? 'midnight'} /> : <Water />}
            <Wiring engine={engine} />
            <Scenarios engine={engine} />
            <Overlay onBottle={() => engine.openBottle()} />
            <Tools engine={engine} />
          </div>
        </ForceMode>
      </UiStateProvider>
    </EngineProvider>
  );
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <MotionConfig reducedMotion="user">
      <SanctuaryProvider>
        <Page />
      </SanctuaryProvider>
    </MotionConfig>
  </StrictMode>,
);
