/**
 * Top-left of the HUD: the pearl glyph (the UI's one solid object) and the count in
 * Jost 500 with tabular figures (equal-width digits, and a plain zero rather than DM Mono's
 * slashed one), whose digits roll to their new value over 600ms.
 */
import { useEffect, useId, useRef } from 'react';
import { animate, motion, useMotionValue, useReducedMotion, useTransform } from 'framer-motion';
import { C } from '../../world/palette';
import { useArt } from '../useArt';
import { EASE_ENTER } from './shared';

/** 12px pearl: the pearl radial gradient with a 1px crescent highlight. */
export function PearlGlyph({ size = 12, className }: { size?: number; className?: string }) {
  const id = useId();
  const pic = useArt('pearl');
  if (pic) return <img src={pic.url} width={size} height={size} alt="" aria-hidden="true" className={className} style={{ objectFit: 'contain' }} />;
  return (
    <svg width={size} height={size} viewBox="0 0 12 12" className={className} aria-hidden="true">
      <defs>
        <radialGradient id={id} cx="0.4" cy="0.36" r="0.68">
          <stop offset="0" stopColor={C.pearl1} />
          <stop offset="0.5" stopColor={C.pearl2} />
          <stop offset="1" stopColor={C.pearl3} />
        </radialGradient>
      </defs>
      <circle cx="6" cy="6" r="6" fill={`url(#${id})`} />
      <path
        d="M2.15 5.05 A4.05 4.05 0 0 1 5.05 2.15"
        fill="none"
        stroke={C.pearl1}
        strokeWidth="1"
        strokeLinecap="round"
        opacity="0.95"
      />
    </svg>
  );
}

const CELLS = Array.from({ length: 20 }, (_, i) => i % 10);

function DigitColumn({ digit, dir }: { digit: number; dir: 1 | -1 }) {
  const idx = useMotionValue(digit);
  const y = useTransform(idx, (v) => `${-v * 5}%`);
  const reduced = useReducedMotion();
  const first = useRef(true);

  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    const cur = ((idx.get() % 10) + 10) % 10;
    if (Math.abs(cur - digit) < 1e-3) return;
    if (reduced) {
      idx.set(digit);
      return;
    }
    let from = cur;
    let to: number;
    if (dir > 0) {
      to = cur + ((((digit - cur) % 10) + 10) % 10);
    } else {
      from = cur + 10;
      to = from - ((((cur - digit) % 10) + 10) % 10);
    }
    idx.set(from);
    const a = animate(idx, to, { duration: 0.6, ease: EASE_ENTER, onComplete: () => idx.set(digit) });
    return () => a.stop();
  }, [digit, dir, idx, reduced]);

  return (
    <span className="qf-digit">
      <motion.span style={{ y }}>
        {CELLS.map((d, i) => (
          <span key={i}>{d}</span>
        ))}
      </motion.span>
    </span>
  );
}

/** The pearl count; whole pearls only, no zero padding. */
export function PearlCount({ value }: { value: number }) {
  const shown = Math.max(0, Math.floor(value));
  const last = useRef(shown);
  const dir: 1 | -1 = shown >= last.current ? 1 : -1;
  useEffect(() => {
    last.current = shown;
  }, [shown]);

  const digits = String(shown).split('').map(Number);
  const places = digits.length;

  return (
    <div className="flex items-center gap-2" role="img" aria-label={`${shown} ${shown === 1 ? 'pearl' : 'pearls'}`}>
      <PearlGlyph className="shrink-0" />
      <span
        className="flex font-jost font-medium tabular-nums text-[18px] tracking-[0.02em] sm:text-[20px]"
        aria-hidden="true"
      >
        {digits.map((d, i) => {
          const place = places - 1 - i;
          return (
            <motion.span
              key={place}
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ duration: 0.6, ease: EASE_ENTER }}
              className="inline-flex"
            >
              <DigitColumn digit={d} dir={dir} />
            </motion.span>
          );
        })}
      </span>
    </div>
  );
}
