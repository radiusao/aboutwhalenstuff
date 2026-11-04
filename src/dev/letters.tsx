/**
 * Dev-only page for the note paper and the letters strip over a static water gradient,
 * with a mock engine and an in-memory save (the real save on this origin is never touched).
 *
 *   /dev-letters.html?note=1&mode=sunset          today's note unrolling from the bottle
 *   /dev-letters.html?note=1&msg=long&mode=day    a ~250 character note
 *   /dev-letters.html?note=1&src=shelf            a reread note beside the kept bottles
 *   /dev-letters.html?letters=1&mode=midnight     the letters strip
 *   /dev-letters.html?letters=1&empty=1           the empty state
 * Add &sig=1 to test the traced-signature draw-in with a plain test stroke.
 * Add &reduced=1 to emulate prefers-reduced-motion via MotionConfig. Phone widths simulate the
 * Dynamic Island and home indicator (--sat 59px, --sab 34px); &island=0 turns that off.
 * window.__ready is set to performance.now() when the note or strip is asked to open.
 */
import { StrictMode, useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { MotionConfig } from 'framer-motion';
import '../index.css';
import type { LightingMode, SanctuaryState } from '../types/sanctuary';
import type { Engine } from '../world/types';
import { modeTokens, paperFor, waterAtMode, waterStops } from '../world/palette';
import { createInitialState } from '../data/initialData';
import { bottleMessages } from '../data/messages';
import { localDay } from '../utils/day';
import { gift } from '../config/gift';
import { SanctuaryProvider } from '../context/SanctuaryContext';
import { EngineProvider } from '../world/EngineContext';
import { UiStateProvider, useUiState, type OpenNote } from '../components/uiState';
import { Letters, NotePaper } from '../components/letters';

declare global {
  interface Window {
    __ready?: number;
    __log?: string[];
  }
}

const q = new URLSearchParams(location.search);
const mode = (q.get('mode') ?? 'midnight') as LightingMode;
const empty = q.get('empty') === '1';
const log = (s: string) => {
  (window.__log ??= []).push(s);
  console.log(`[mock engine] ${s}`);
};

// In-memory storage so this page never overwrites the real save on the same origin.
const mem = new Map<string, string>();
const memoryStorage: Storage = {
  get length() {
    return mem.size;
  },
  clear: () => mem.clear(),
  getItem: (k) => mem.get(k) ?? null,
  key: (i) => [...mem.keys()][i] ?? null,
  removeItem: (k) => void mem.delete(k),
  setItem: (k, v) => void mem.set(k, String(v)),
};
Object.defineProperty(window, 'localStorage', { configurable: true, value: memoryStorage });

// &sig=1 swaps in a plain test stroke (not a signature) to check the stroke-dashoffset draw-in.
if (q.get('sig') === '1') gift.signaturePath = 'M8 40 C 30 10, 50 10, 60 34 S 90 54, 110 30 S 150 12, 190 26';

const now = Date.now();
const daysAgo = (n: number) => localDay(new Date(now - n * 86400000));
const readIds = empty ? [] : ['msg-3', 'msg-6', 'msg-1', 'msg-7', 'msg-2', 'msg-5', 'msg-4'];
const seeded: SanctuaryState = {
  ...createInitialState(now),
  activeLighting: mode,
  readMessageIds: readIds,
  readMessageDates: Object.fromEntries(readIds.map((id, i) => [id, daysAgo(readIds.length - 1 - i)])),
  lastBottleDay: empty ? null : daysAgo(0),
};
mem.set('drift-and-discover:sanctuary:v1', JSON.stringify(seeded));

// Inks the HUD would normally set on <html>.
const root = document.documentElement.style;
root.setProperty('--paper', paperFor[mode]);
root.setProperty('--ink-top', modeTokens[mode].color.inkTop);
root.setProperty('--ink-deep', modeTokens[mode].color.inkDeep);
root.setProperty('--bg', waterAtMode(mode, 0.5));
root.setProperty('--scrim', waterAtMode(mode, 1));
// Simulate the iPhone's Dynamic Island and home indicator on phone widths (&island=0 turns it off).
if (window.innerWidth < 640 && q.get('island') !== '0') {
  root.setProperty('--sat', '59px');
  root.setProperty('--sab', '34px');
}

const noop = () => {};
const mockEngine: Engine = {
  mount: noop,
  destroy: noop,
  sync: noop,
  setMode: noop,
  setCameraShift: noop,
  spawnHint: noop,
  feed: noop,
  focusCreature: noop,
  tapWhale: noop,
  tapGuardianPearl: noop,
  openBottle: () => log('openBottle'),
  closeBottle: () => log('closeBottle'),
  queueGreeting: noop,
  creatureAt: () => null,
  waterAt: (y) => waterAtMode(mode, y),
  on: () => noop,
  summonWhale: noop,
  summonBottle: noop,
};

const LONG =
  'Some evenings the sea is so still you can hear the kelp grow. I hope today was gentle with you, ' +
  "and if it wasn't, I hope this little ocean is. Feed the jellies, look up at the moon, and come back " +
  'tomorrow. There will be another bottle waiting.';

function sampleNote(): OpenNote {
  const w = window.innerWidth;
  const h = window.innerHeight;
  const phone = w < 640;
  const shelf = q.get('src') === 'shelf';
  const msg = q.get('msg');
  const base = bottleMessages[(Number(msg) || 5) - 1] ?? bottleMessages[0];
  const message = msg === 'long' ? { id: 'dev-long', content: LONG, date: '', readStatus: true } : base;
  const anchor = shelf ? { x: 0.45 * w, y: 0.72 * h } : phone ? { x: 0.24 * w, y: 0.18 * h } : { x: 0.3 * w, y: 0.34 * h };
  return { message: { ...message, date: localDay() }, anchor, source: shelf ? 'shelf' : 'bottle' };
}

/** A rough stand-in for the opened bottle (scale 2.2, neck up and to the right) to judge placement. */
function BottleGhost({ note }: { note: OpenNote | null }) {
  if (!note || note.source !== 'bottle') return null;
  const phone = window.innerWidth < 640;
  const L = (phone ? 40 : 54) * 2.2;
  const R = L * 0.15;
  return (
    <svg className="pointer-events-none fixed left-0 top-0" width="100%" height="100%" aria-hidden="true">
      <g transform={`translate(${note.anchor.x} ${note.anchor.y}) rotate(-26)`} fill="rgba(150,230,220,.25)" stroke="rgba(255,255,255,.5)">
        <path
          d={`M${-L / 2} ${-R} H${L * 0.18} Q${L * 0.28} ${-R} ${L * 0.3} ${-R * 0.42} H${L / 2} V${R * 0.42} H${L * 0.3} Q${L * 0.28} ${R} ${L * 0.18} ${R} H${-L / 2} Z`}
        />
        <rect x={L / 2} y={-R * 0.5} width={L * 0.1} height={R} fill="#C99A6B" stroke="none" transform={`translate(4 -14) rotate(-25 ${L / 2} 0)`} />
      </g>
    </svg>
  );
}

function Stage() {
  const ui = useUiState();
  const [shown, setShown] = useState<OpenNote | null>(null);

  const openNote = () => {
    const n = sampleNote();
    setShown(n);
    ui.showNote(n);
    window.__ready = performance.now();
  };
  const openLetters = () => {
    ui.openLetters();
    window.__ready = performance.now();
  };

  useEffect(() => {
    const fonts = ['22px "Nothing You Could Do"', '11px "DM Mono"', '300 15px Jost', '500 12px Jost'];
    Promise.all(fonts.map((f) => document.fonts.load(f))).finally(() => {
      if (q.get('note') === '1') openNote();
      else if (q.get('letters') === '1') openLetters();
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const stops = waterStops[mode].map(([o, c]) => `${c} ${(o * 100).toFixed(0)}%`).join(', ');
  return (
    <div className="fixed inset-0 overflow-hidden" style={{ background: `linear-gradient(to bottom, ${stops})` }}>
      <BottleGhost note={ui.panel === 'note' ? shown : null} />
      <div
        className="fixed font-mono"
        style={{ left: 20, bottom: 'calc(env(safe-area-inset-bottom) + 12px)', fontSize: 11, color: 'var(--ink-deep)', opacity: 0.6 }}
      >
        <button type="button" style={{ padding: 12 }} onClick={openNote}>
          note
        </button>
        <button type="button" style={{ padding: 12 }} onClick={openLetters}>
          letters
        </button>
      </div>
      <NotePaper />
      <Letters />
    </div>
  );
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <MotionConfig reducedMotion={q.get('reduced') === '1' ? 'always' : 'user'}>
      <SanctuaryProvider>
        <EngineProvider engine={mockEngine}>
          <UiStateProvider>
            <Stage />
          </UiStateProvider>
        </EngineProvider>
      </SanctuaryProvider>
    </MotionConfig>
  </StrictMode>,
);
