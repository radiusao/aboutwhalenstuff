/**
 * The depth gauge (§7.1): only during "Light descends". A 1px line on the right edge from
 * 14% to 86% of the height with 9 ticks and no numerals (ticks only on phone, at W - 8px).
 * The photic zone (Day 75%, Sunset 30%, Midnight none) is drawn brighter and shortens in
 * step with the descent. Above 45% of the screen it uses inkTop, below it inkDeep, so the
 * gauge changes ink as the light sinks past it. Fades in over 300ms, out 1.5s after the
 * descent ends.
 */
import { useEffect, useId, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import type { LightingMode } from '../../types/sanctuary';
import { useEngineEvent } from '../../world/EngineContext';
import { EASE_ENTER, EASE_EXIT, useIsPhone } from './shared';

const PHOTIC: Record<LightingMode, number> = { day: 0.75, sunset: 0.3, midnight: 0 };
const TOP = 0.14;
const BOTTOM = 0.86;
/** Where inkTop gives way to inkDeep (45% of the screen), in gauge units 0..1000. */
const SPLIT = ((0.45 - TOP) / (BOTTOM - TOP)) * 1000;
const TICKS = 9;
const HIDE_AFTER_MS = 1500;
const W = 14;

const ease = (p: number) => 0.5 - 0.5 * Math.cos(Math.PI * Math.min(1, Math.max(0, p)));

function GaugeMarks({ photic, phone }: { photic: number; phone: boolean }) {
  const py = photic * 1000;
  const x = W - 0.5;
  return (
    <>
      {!phone && (
        <>
          <line x1={x} x2={x} y1={0} y2={1000} stroke="currentColor" strokeOpacity={0.25} vectorEffect="non-scaling-stroke" />
          {py > 0 && (
            <line x1={x} x2={x} y1={0} y2={py} stroke="currentColor" strokeOpacity={0.7} vectorEffect="non-scaling-stroke" />
          )}
        </>
      )}
      {Array.from({ length: TICKS }, (_, i) => {
        const y = (i / (TICKS - 1)) * 1000;
        const len = i === (TICKS - 1) / 2 ? 6 : 4;
        // A tick brightens as the photic edge passes it (softened over ~4% of the gauge).
        const lit = Math.min(1, Math.max(0, (py - y) / 40 + 0.5));
        const right = phone ? W : x;
        return (
          <line
            key={i}
            x1={right - len}
            x2={right}
            y1={y}
            y2={y}
            stroke="currentColor"
            strokeOpacity={0.25 + 0.45 * lit}
            vectorEffect="non-scaling-stroke"
          />
        );
      })}
    </>
  );
}

export function DepthGauge() {
  const phone = useIsPhone();
  const clip = useId();
  const [visible, setVisible] = useState(false);
  const [photic, setPhotic] = useState(0);
  const hide = useRef(0);

  useEngineEvent('descent', (e) => {
    const k = e.progress >= 1 ? 1 : ease(e.progress);
    setPhotic(PHOTIC[e.from] + (PHOTIC[e.to] - PHOTIC[e.from]) * k);
    if (e.progress >= 1) {
      window.clearTimeout(hide.current);
      hide.current = window.setTimeout(() => setVisible(false), HIDE_AFTER_MS);
    } else {
      window.clearTimeout(hide.current);
      setVisible(true);
    }
  });

  useEffect(() => () => window.clearTimeout(hide.current), []);

  return (
    <AnimatePresence>
      {visible && (
        <motion.div
          aria-hidden="true"
          className={`pointer-events-none absolute top-[14%] bottom-[14%] ${phone ? 'right-[calc(var(--sar)+8px)]' : 'right-[calc(var(--sar)+48px)]'}`}
          style={{ width: W }}
          initial={{ opacity: 0, x: 8 }}
          animate={{ opacity: 1, x: 0, transition: { duration: 0.3, ease: EASE_ENTER } }}
          exit={{ opacity: 0, transition: { duration: 0.6, ease: EASE_EXIT } }}
        >
          <svg width={W} height="100%" viewBox={`0 0 ${W} 1000`} preserveAspectRatio="none" className="block overflow-visible">
            <defs>
              <clipPath id={`${clip}t`}>
                <rect x={-20} y={-20} width={W + 40} height={SPLIT + 20} />
              </clipPath>
              <clipPath id={`${clip}d`}>
                <rect x={-20} y={SPLIT} width={W + 40} height={1020 - SPLIT} />
              </clipPath>
            </defs>
            <g clipPath={`url(#${clip}t)`} className="text-(--ink-top)">
              <GaugeMarks photic={photic} phone={phone} />
            </g>
            <g clipPath={`url(#${clip}d)`} className="text-(--ink-deep)">
              <GaugeMarks photic={photic} phone={phone} />
            </g>
          </svg>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
