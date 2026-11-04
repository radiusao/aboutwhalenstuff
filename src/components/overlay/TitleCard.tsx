/**
 * Title card (§7.4): when she comes back after more than 30 minutes, "Welcome back." and
 * what the sea made while she was away. On the very first visit, a quiet welcome instead.
 * It rises in, stays 4s and fades. Desktop sets it lower-left above the captions; on a
 * phone the lower-left is the seahorses' seagrass, so it is set in the open water under
 * the HUD instead, at whichever height no creature is swimming through.
 */
import { useEffect, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { useSanctuary } from '../../context/SanctuaryContext';
import { useEngine } from '../../world/EngineContext';
import type { Engine } from '../../world/types';
import type { LightingMode } from '../../types/sanctuary';
import { betterInk, cssPx, EASE_ENTER, EASE_EXIT, INK_VAR, textWidth } from './shared';

const AWAY_MS = 30 * 60 * 1000;
const DELAY_MS = 900;
const FIRST_VISIT_DELAY_MS = 1800;
const SHOW_MS = 4000;

type Lines = [string, string];

function linesFor(elapsedMs: number, earned: number): Lines | null {
  if (elapsedMs === 0) return ['Welcome.', 'This sea is yours. It carries on while you’re away.'];
  if (elapsedMs <= AWAY_MS) return null;
  const n = Math.floor(earned);
  if (n < 1) return ['Welcome back.', 'The sea waited for you.'];
  return ['Welcome back.', `While you were away, the sea made ${n} ${n === 1 ? 'pearl' : 'pearls'}.`];
}

export interface TitleState {
  lines: Lines | null;
  show: boolean;
}

/**
 * Decides the card once per load and runs its clock (0.9s in, 4s on screen). Until it shows, the
 * lines follow the idle report, so a cloud save adopted a moment after load (a wiped device)
 * gets "Welcome back" rather than the first-visit card; they freeze once it is on screen.
 */
export function useTitleCard(): TitleState {
  const { idleReport } = useSanctuary();
  const live = linesFor(idleReport.elapsedMs, idleReport.pearlsEarned);
  const latest = useRef(live);
  latest.current = live;
  const [firstVisit] = useState(() => idleReport.elapsedMs === 0);
  const [shown, setShown] = useState<Lines | null>(null);
  const [phase, setPhase] = useState<'wait' | 'show' | 'gone'>('wait');

  useEffect(() => {
    // A first visit waits a little longer, so a cloud save usually answers before it.
    const delay = firstVisit ? FIRST_VISIT_DELAY_MS : DELAY_MS;
    const a = window.setTimeout(() => {
      setShown(latest.current);
      setPhase('show');
    }, delay);
    const b = window.setTimeout(() => setPhase('gone'), delay + SHOW_MS);
    return () => {
      window.clearTimeout(a);
      window.clearTimeout(b);
    };
  }, [firstVisit]);

  const lines = phase === 'wait' ? live : shown;
  return { lines, show: !!lines && phase === 'show' };
}

function TitleBlock({ lines, className, scrim }: { lines: Lines; className: string; scrim?: string }) {
  return (
    <motion.div className={`font-jost font-light ${className}`} exit={{ opacity: 0, transition: { duration: 0.9, ease: EASE_EXIT } }}>
      {scrim && (
        <motion.span
          aria-hidden="true"
          className="qf-scrim -inset-x-16 -inset-y-10"
          style={{ ['--qf-scrim-color' as string]: scrim }}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: 0.9, ease: EASE_ENTER }}
        />
      )}
      <motion.h1
        className="relative m-0 text-[28px] leading-[1.1] font-light tracking-[-0.005em] sm:text-[36px]"
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.9, ease: EASE_ENTER }}
      >
        {lines[0]}
      </motion.h1>
      <motion.p
        className="relative m-0 mt-2.5 max-w-[36ch] text-[16px] leading-[1.4] font-light text-balance sm:text-[17px]"
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.9, ease: EASE_ENTER, delay: 0.25 }}
      >
        {lines[1]}
      </motion.p>
    </motion.div>
  );
}

/** Desktop: in the lower-left column, above the captions. */
export function TitleCard({ lines, show }: TitleState) {
  return <AnimatePresence>{show && lines && <TitleBlock key="title" lines={lines} className="relative mb-5" />}</AnimatePresence>;
}

interface Place {
  top: number;
  ink: 'top' | 'deep';
  water: string;
}

/** Title and subline at phone sizes, with margins; what the card needs to keep clear. */
const BLOCK_H = 31 + 10 + 45;
const CLEAR = 14;

/**
 * Finds a height in the open water below the HUD (and the phone dial label) and above the
 * decorations where the card crosses no creature: the first clear candidate, else the least
 * crowded one.
 */
function openWater(engine: Engine, ids: { id: string; jelly: boolean }[], lines: Lines, mode: LightingMode): Place {
  const w = window.innerWidth;
  const h = window.innerHeight;
  const left = 20;
  const textW = Math.min(
    w - 40,
    Math.max(textWidth(lines[0], '300 28px Jost, Futura, sans-serif'), textWidth(lines[1], '300 16px Jost, Futura, sans-serif')),
  );
  const start = cssPx('var(--sat)') + 6 + 44 + 64;
  const candidates: number[] = [];
  // Stay above the tallest decorations (the kelp forest's tips reach about a third of the way down).
  for (let top = start; candidates.length < 4 && top + BLOCK_H < h * 0.38; top += 56) candidates.push(top);
  if (!candidates.length) candidates.push(start);

  const boxes = ids.flatMap(({ id, jelly }) => {
    const p = engine.creatureAt(id);
    // A jelly's tentacles hang well below its bell.
    return p ? [{ x0: p.x - p.r, x1: p.x + p.r, y0: p.y - p.r, y1: p.y + p.r * (jelly ? 2.2 : 1) }] : [];
  });
  const crowd = (top: number) =>
    boxes.reduce((sum, b) => {
      const ox = Math.min(b.x1, left + textW + CLEAR) - Math.max(b.x0, left - CLEAR);
      const oy = Math.min(b.y1, top + BLOCK_H + CLEAR) - Math.max(b.y0, top - CLEAR);
      return sum + (ox > 0 && oy > 0 ? ox * oy : 0);
    }, 0);

  let top = candidates[0];
  let best = Infinity;
  for (const c of candidates) {
    const score = crowd(c);
    if (score < best) {
      best = score;
      top = c;
    }
    if (score === 0) break;
  }
  const water = engine.waterAt(Math.min(1, (top + BLOCK_H / 2) / h));
  return { top, ink: betterInk(mode, water), water };
}

/** Phone: set in open water under the HUD rather than over the seahorses' seagrass. */
export function TitleCardOpenWater({ lines, show }: TitleState) {
  const engine = useEngine();
  const { state } = useSanctuary();
  const place = useRef<Place | null>(null);
  if (show && lines && !place.current) {
    const ids = state.creatures
      .filter((c) => c.type === 'jellyfish' || c.type === 'seahorse')
      .map((c) => ({ id: c.id, jelly: c.type === 'jellyfish' }));
    place.current = openWater(engine, ids, lines, state.activeLighting);
  }
  const p = place.current;
  if (!p || !lines) return null;

  return (
    <div
      className="pointer-events-none absolute left-[calc(var(--sal)+20px)] max-w-[calc(100%-40px)]"
      style={{ top: p.top, color: INK_VAR[p.ink] }}
    >
      <AnimatePresence>{show && <TitleBlock key="title" lines={lines} className="relative" scrim={p.water} />}</AnimatePresence>
    </div>
  );
}
