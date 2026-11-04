/**
 * Creature callout (§7.2): a leader line draws out of a 4px ring on the creature, 24px on
 * the diagonal then 40px across, and the pet name and "Moon jelly · since 2 Oct" sit at its
 * end. It turns left near the right edge (and downward under the HUD), follows the creature
 * while it shows, and fades after 3s. One at a time.
 */
import { useEffect, useMemo } from 'react';
import { AnimatePresence, motion, useMotionValue } from 'framer-motion';
import { useEngine } from '../../world/EngineContext';
import { useSanctuary } from '../../context/SanctuaryContext';
import { useUiState, type Callout as CalloutData } from '../uiState';
import type { LightingMode } from '../../types/sanctuary';
import { betterInk, EASE_ENTER, EASE_EXIT, INK_VAR, textWidth, useIsPhone } from './shared';

const SHOW_MS = 3000;
const RING_R = 2;
/** The diagonal is 24px long, at 45 degrees. */
const DIAG = 24 / Math.SQRT2;
const RUN = 40;
const RUN_MIN = 14;
const GAP = 8;

interface Layout {
  sx: 1 | -1;
  sy: 1 | -1;
  run: number;
  maxText: number;
  ink: 'top' | 'deep';
  water: string;
}

function layoutFor(c: CalloutData, phone: boolean, mode: LightingMode, waterAt: (y: number) => string): Layout {
  const w = window.innerWidth;
  const h = window.innerHeight;
  const edge = phone ? 12 : 32;
  const nameSize = phone ? 16 : 17;
  const textW = Math.max(
    textWidth(c.name, `400 ${nameSize}px Jost, Futura, sans-serif`),
    textWidth(c.sub, '400 13px Jost, Futura, sans-serif') * 1.01 + c.sub.length * 0.13,
  );
  const start = RING_R * Math.SQRT1_2 + DIAG + GAP;
  const roomRight = w - edge - (c.x + start);
  const roomLeft = c.x - start - edge;
  const fits = (room: number) => room - RUN >= textW;
  const sx: 1 | -1 = fits(roomRight) ? 1 : fits(roomLeft) ? -1 : roomRight >= roomLeft ? 1 : -1;
  const room = sx > 0 ? roomRight : roomLeft;
  const run = Math.max(RUN_MIN, Math.min(RUN, room - textW));
  // Below the HUD row the label would collide with the type, so it hangs downward instead.
  const hudBottom = phone ? 130 : 120;
  const sy: 1 | -1 = c.y - DIAG - 24 < hudBottom ? 1 : -1;
  const textY = c.y + sy * (RING_R + DIAG);
  const water = waterAt(Math.min(1, Math.max(0, textY / h)));
  return { sx, sy, run, maxText: Math.max(120, room - run), ink: betterInk(mode, water), water };
}

function CalloutView({ c, mode }: { c: CalloutData; mode: LightingMode }) {
  const engine = useEngine();
  const phone = useIsPhone();
  const ax = useMotionValue(c.x);
  const ay = useMotionValue(c.y);
  const L = useMemo(() => layoutFor(c, phone, mode, (y) => engine.waterAt(y)), [c, phone, mode, engine]);

  // Follow the creature as it drifts.
  useEffect(() => {
    let raf = 0;
    const follow = () => {
      const p = engine.creatureAt(c.id);
      if (p) {
        ax.set(p.x);
        ay.set(p.y);
      }
      raf = requestAnimationFrame(follow);
    };
    raf = requestAnimationFrame(follow);
    return () => cancelAnimationFrame(raf);
  }, [engine, c.id, ax, ay]);

  const r0 = RING_R * Math.SQRT1_2;
  const ex = L.sx * (r0 + DIAG + L.run);
  const ey = L.sy * (r0 + DIAG);
  const d = `M${L.sx * r0} ${L.sy * r0} L${L.sx * (r0 + DIAG)} ${ey} H${ex}`;
  const textX = ex + L.sx * GAP;
  const nameLine = phone ? 20 : 21;
  const color = INK_VAR[L.ink];

  return (
    <motion.div
      className="pointer-events-none absolute left-0 top-0"
      style={{ x: ax, y: ay, color }}
      initial={{ opacity: 1 }}
      exit={{ opacity: 0, transition: { duration: 0.35, ease: EASE_EXIT } }}
    >
      <svg width="1" height="1" className="absolute left-0 top-0 overflow-visible" aria-hidden="true">
        <motion.circle
          cx={0}
          cy={0}
          r={RING_R}
          fill="none"
          stroke="currentColor"
          strokeWidth={1}
          initial={{ opacity: 0 }}
          animate={{ opacity: 0.9 }}
          transition={{ duration: 0.12 }}
        />
        <motion.path
          d={d}
          fill="none"
          stroke="currentColor"
          strokeOpacity={0.75}
          strokeWidth={1}
          initial={{ pathLength: 0 }}
          animate={{ pathLength: 1 }}
          transition={{ duration: 0.3, ease: EASE_ENTER, delay: 0.06 }}
        />
      </svg>
      <motion.div
        className={`absolute ${L.sx > 0 ? 'text-left' : 'text-right'}`}
        style={{
          left: L.sx > 0 ? textX : undefined,
          right: L.sx < 0 ? -textX : undefined,
          top: ey - nameLine / 2,
          width: 'max-content',
          maxWidth: L.maxText,
        }}
        initial={{ opacity: 0, x: -8 * L.sx }}
        animate={{ opacity: 1, x: 0 }}
        transition={{ duration: 0.5, ease: EASE_ENTER, delay: 0.22 }}
      >
        <span
          aria-hidden="true"
          className="qf-scrim"
          style={{
            ['--qf-scrim-color' as string]: L.water,
            width: 'calc(100% + 80px)',
            height: 110,
            top: -30,
            [L.sx > 0 ? 'left' : 'right']: -40,
          }}
        />
        <div className="relative font-jost text-[16px] leading-[20px] font-normal sm:text-[17px] sm:leading-[21px]">{c.name}</div>
        <div className="relative mt-px font-jost text-[13px] leading-[17px] font-normal tracking-[0.01em] opacity-70">{c.sub}</div>
      </motion.div>
    </motion.div>
  );
}

export function Callout() {
  const ui = useUiState();
  const { state } = useSanctuary();
  const c = ui.callout;
  const { hideCallout } = ui;

  useEffect(() => {
    if (!c) return;
    const id = window.setTimeout(hideCallout, SHOW_MS);
    return () => window.clearTimeout(id);
    // Each new callout (new key) restarts the 3s.
  }, [c?.key]);

  return <AnimatePresence>{c && <CalloutView key={c.key} c={c} mode={state.activeLighting} />}</AnimatePresence>;
}
