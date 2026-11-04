/**
 * The HUD (§7.1): the pearl count and the sound glyph top-left; SHOP, LETTERS and the time dial top-right.
 * Type sits straight on the water with a soft scrim of the local water colour behind each
 * cluster. Words, the dial horizon and the count share one baseline. After 12s without
 * input it fades to 30%, and comes back in 200ms; never while a panel is open. On a phone the
 * row sits a little lower under the Dynamic Island and is drawn 12% larger.
 */
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { motion } from 'framer-motion';
import { useSanctuary } from '../../context/SanctuaryContext';
import { useEngineEvent } from '../../world/EngineContext';
import { useUiState } from '../uiState';
import { PearlCount } from './PearlCount';
import { TimeDial } from './TimeDial';
import { SoundButton } from './SoundButton';
import { EASE_DRIFT, EASE_ENTER, EASE_EXIT, useIsPhone } from './shared';

const IDLE_MS = 12000;
const WAKE_EVENTS = ['pointermove', 'pointerdown', 'keydown', 'touchstart', 'wheel'] as const;

/** True once nothing has happened for 12s; any pointer, touch or key brings it back. */
function useIdleFade(locked: boolean): boolean {
  const [faded, setFaded] = useState(false);
  const last = useRef(0);
  const fadedRef = useRef(false);
  const lockedRef = useRef(locked);
  lockedRef.current = locked;

  const wake = useCallback(() => {
    last.current = performance.now();
    if (fadedRef.current) {
      fadedRef.current = false;
      setFaded(false);
    }
  }, []);

  useEngineEvent('input', wake);

  useEffect(() => {
    last.current = performance.now();
    const opts: AddEventListenerOptions = { passive: true, capture: true };
    for (const e of WAKE_EVENTS) window.addEventListener(e, wake, opts);
    let id = 0;
    const check = () => {
      const idle = performance.now() - last.current;
      if (!lockedRef.current && idle >= IDLE_MS) {
        if (!fadedRef.current) {
          fadedRef.current = true;
          setFaded(true);
        }
        id = window.setTimeout(check, 1000);
      } else {
        id = window.setTimeout(check, Math.max(250, IDLE_MS - idle));
      }
    };
    id = window.setTimeout(check, IDLE_MS);
    return () => {
      window.clearTimeout(id);
      for (const e of WAKE_EVENTS) window.removeEventListener(e, wake, opts);
    };
  }, [wake]);

  useEffect(() => {
    if (locked) wake();
  }, [locked, wake]);

  return faded;
}

/** Soft ellipse of the local water colour at 35%, centred behind a cluster. */
function Scrim({ w, h, color = 'var(--scrim-top)' }: { w: number; h: number; color?: string }) {
  return (
    <span
      aria-hidden="true"
      className="qf-scrim left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2"
      style={{ width: w, height: h, ['--qf-scrim-color' as string]: color }}
    />
  );
}

interface WordButtonProps {
  word: string;
  /** The word shown in the same place while `alt` is true (CLOSE). */
  altWord: string;
  alt: boolean;
  label: string;
  hidden?: boolean;
  onClick: () => void;
}

/** A tracked-caps text control: 44px tall hit area, no background or border. Both words share one grid cell so nothing shifts when they swap. */
function WordButton({ word, altWord, alt, label, hidden, onClick }: WordButtonProps) {
  const fadeWord = (on: boolean) => ({ opacity: on ? 1 : 0, transition: { duration: on ? 0.28 : 0.16, delay: on ? 0.1 : 0 } });
  return (
    <motion.button
      type="button"
      className="qf-control pointer-events-auto relative grid h-11 min-w-11 shrink-0 items-start justify-items-end"
      onClick={onClick}
      aria-label={label}
      aria-hidden={hidden || undefined}
      tabIndex={hidden ? -1 : undefined}
      animate={{ opacity: hidden ? 0 : 1 }}
      transition={{ duration: hidden ? 0.35 : 0.6 }}
      style={{ pointerEvents: hidden ? 'none' : undefined }}
    >
      <motion.span className="qf-caps qf-word qf-focus col-start-1 row-start-1 mt-4 pb-[3px]" animate={fadeWord(!alt)} initial={false}>
        {word}
      </motion.span>
      <motion.span
        className="qf-caps qf-word qf-focus col-start-1 row-start-1 mt-4 pb-[3px]"
        animate={fadeWord(alt)}
        initial={false}
        aria-hidden="true"
      >
        {altWord}
      </motion.span>
    </motion.button>
  );
}

/** One HUD cluster. While a panel lies over it, it steps out of sight (and out of the tab order) instead of showing through. */
function Cluster({ className, covered, children }: { className: string; covered: boolean; children: ReactNode }) {
  return (
    <motion.div
      className={`absolute flex text-(--ink-top) ${className}`}
      initial={false}
      animate={{ opacity: covered ? 0 : 1 }}
      transition={covered ? { duration: 0.2, ease: EASE_EXIT } : { duration: 0.6, ease: EASE_ENTER, delay: 0.15 }}
      inert={covered}
      aria-hidden={covered || undefined}
    >
      {children}
    </motion.div>
  );
}

export function Hud() {
  const { state, pearls } = useSanctuary();
  const ui = useUiState();
  const phone = useIsPhone();
  const faded = useIdleFade(ui.panel !== 'none');
  const shopOpen = ui.panel === 'shop';
  const lettersOpen = ui.panel === 'letters';
  // While a note is being read, only the count and the dial stay.
  const noteOpen = ui.panel === 'note';
  // The letters strip slides over the right cluster (and, on a phone, the whole top row);
  // it carries its own CLOSE where LETTERS was.
  const coveredRight = lettersOpen;
  const coveredLeft = lettersOpen && phone;

  return (
    <motion.div
      className="pointer-events-none absolute inset-x-0 top-0"
      initial={{ opacity: 0 }}
      animate={{ opacity: faded ? 0.3 : 1 }}
      transition={faded ? { duration: 1.2, ease: EASE_DRIFT } : { duration: 0.2 }}
    >
      <Cluster
        covered={coveredLeft}
        className="left-[calc(var(--sal)+20px)] top-[calc(var(--sat)+20px)] h-11 origin-top-left scale-[1.12] items-start pt-[9px] sm:scale-100 sm:left-[max(48px,calc(var(--sal)+20px))] sm:top-[max(38px,calc(var(--sat)+6px))] sm:pt-[6.5px]">
        <Scrim w={240} h={120} />
        <div className="relative">
          <PearlCount value={pearls} />
        </div>
        <SoundButton mode={state.activeLighting} />
      </Cluster>

      <Cluster
        covered={coveredRight}
        className="right-[calc(var(--sar)+20px)] top-[calc(var(--sat)+20px)] origin-top-right scale-[1.12] items-start gap-6 sm:scale-100 sm:right-[max(48px,calc(var(--sar)+20px))] sm:top-[max(38px,calc(var(--sat)+6px))] sm:gap-7">
        <Scrim w={phone ? 280 : 320} h={phone ? 120 : 140} />
        <WordButton
          word="Shop"
          altWord="Close"
          alt={shopOpen}
          hidden={noteOpen}
          label={shopOpen ? 'Close the shop' : 'Shop'}
          onClick={() => (shopOpen ? ui.closePanel() : ui.openShop())}
        />
        <WordButton
          word="Letters"
          altWord="Close"
          alt={lettersOpen}
          hidden={noteOpen}
          label={lettersOpen ? 'Close letters' : 'Letters'}
          onClick={() => (lettersOpen ? ui.closePanel() : ui.openLetters())}
        />
        <TimeDial mode={state.activeLighting} phone={phone} />
      </Cluster>
    </motion.div>
  );
}
