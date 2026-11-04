/**
 * The time dial: a 44x22 hairline semicircle (the sun's path) over a horizon line, with a
 * 6px marker that glides along it in 1.2s. Day sits at the zenith, Sunset on the right
 * horizon, Midnight below the line as a crescent. The loop always runs forward, the way
 * the sun goes round. The mode name sits beneath in tracked caps (desktop always; phone
 * for 2s after a change).
 */
import { useEffect, useId, useRef, useState } from 'react';
import { AnimatePresence, animate, motion, useMotionValue, useReducedMotion, useTransform } from 'framer-motion';
import type { LightingMode } from '../../types/sanctuary';
import { EASE_DRIFT, EASE_ENTER, EASE_EXIT, MODE_NAME } from './shared';

const CX = 22;
const HORIZON = 22.5;
const R = 21.5;
/** The marker's path below the horizon is a shallow half-ellipse. */
const RY_BELOW = 7.5;
const MARKER_R = 3;

const ANGLE: Record<LightingMode, number> = { day: Math.PI / 2, sunset: Math.PI, midnight: (3 * Math.PI) / 2 };
const TAU = Math.PI * 2;

function pos(phi: number): { x: number; y: number } {
  const s = Math.sin(phi);
  return { x: CX - R * Math.cos(phi), y: HORIZON - (s >= 0 ? R : RY_BELOW) * s };
}

/** 0 above the horizon, rising to 1 at the bottom of the loop (Midnight). */
function crescentAmount(phi: number): number {
  const s = Math.sin(phi);
  return s >= 0 ? 0 : Math.pow(-s, 0.8);
}

interface TimeDialProps {
  mode: LightingMode;
  phone: boolean;
}

export function TimeDial({ mode, phone }: TimeDialProps) {
  const maskId = useId();
  const reduced = useReducedMotion();
  const phi = useMotionValue(ANGLE[mode]);
  const cx = useTransform(phi, (p) => pos(p).x);
  const cy = useTransform(phi, (p) => pos(p).y);
  const cutX = useTransform(phi, (p) => pos(p).x + (7 - 5.4 * crescentAmount(p)) * 0.78);
  const cutY = useTransform(phi, (p) => pos(p).y - (7 - 5.4 * crescentAmount(p)) * 0.62);
  const shown = useRef(mode);
  const [flash, setFlash] = useState(0);

  useEffect(() => {
    if (shown.current === mode) return;
    shown.current = mode;
    const from = phi.get();
    const delta = (((ANGLE[mode] - from) % TAU) + TAU) % TAU;
    setFlash((f) => f + 1);
    if (reduced) {
      phi.set(from + delta);
      return;
    }
    const a = animate(phi, from + delta, { duration: 1.2, ease: EASE_DRIFT });
    return () => a.stop();
  }, [mode, phi, reduced]);

  // Phone: the label shows for 2s after a change, then leaves.
  const [labelVisible, setLabelVisible] = useState(!phone);
  useEffect(() => {
    if (!phone) {
      setLabelVisible(true);
      return;
    }
    if (flash === 0) {
      setLabelVisible(false);
      return;
    }
    setLabelVisible(true);
    const id = window.setTimeout(() => setLabelVisible(false), 2000);
    return () => window.clearTimeout(id);
  }, [flash, phone]);

  const name = MODE_NAME[mode];

  return (
    <div
      className="qf-control pointer-events-none relative flex h-11 w-[54px] shrink-0 items-start justify-end"
      role="img"
      aria-label={`Brisbane time: ${name}`}
    >
      <svg
        width="54"
        height="36"
        viewBox="-5 0 54 36"
        className="qf-focus mt-[3.5px] block overflow-visible"
        aria-hidden="true"
      >
        <defs>
          <mask id={maskId} maskUnits="userSpaceOnUse" x="-10" y="-10" width="64" height="56">
            <rect x="-10" y="-10" width="64" height="56" fill="#fff" />
            <motion.circle cx={cutX} cy={cutY} r={MARKER_R - 0.45} fill="#000" />
          </mask>
        </defs>
        <path d={`M0.5 ${HORIZON} A${R} ${R} 0 0 1 43.5 ${HORIZON}`} fill="none" stroke="currentColor" strokeOpacity="0.5" strokeWidth="1" />
        <path d={`M-5 ${HORIZON} H49`} fill="none" stroke="currentColor" strokeOpacity="0.8" strokeWidth="1" />
        <motion.circle cx={cx} cy={cy} r={MARKER_R} fill="currentColor" mask={`url(#${maskId})`} />
      </svg>
      <AnimatePresence initial={false}>
        {labelVisible && (
          <motion.span
            key={name}
            className="qf-caps qf-word absolute right-0 top-[47px] whitespace-nowrap pb-[3px]"
            initial={{ opacity: 0, y: -8 }}
            animate={{ opacity: 1, y: 0, transition: { duration: 0.7, ease: EASE_ENTER, delay: phone ? 0 : 0.35 } }}
            exit={{ opacity: 0, transition: { duration: phone ? 0.35 : 0.2, ease: EASE_EXIT } }}
          >
            {name}
          </motion.span>
        )}
      </AnimatePresence>
    </div>
  );
}
