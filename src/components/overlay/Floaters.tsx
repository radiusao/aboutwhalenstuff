/**
 * Earn floaters: "+5" in Jost 12px (tabular figures, like the count) rising a little from where the pearls came from.
 * Gold, or gold-deep over Day's pale upper water. Lights up fast, fades slowly.
 */
import { AnimatePresence, motion } from 'framer-motion';
import { useSanctuary } from '../../context/SanctuaryContext';
import { C } from '../../world/palette';
import { useUiState } from '../uiState';
import { EASE_ENTER } from './shared';

export function Floaters() {
  const { floaters } = useUiState();
  const { state } = useSanctuary();
  const day = state.activeLighting === 'day';
  return (
    <AnimatePresence>
      {floaters.map((f) => (
        <motion.span
          key={f.id}
          aria-hidden="true"
          className="pointer-events-none absolute left-0 top-0 font-jost text-[12px] leading-none font-normal tracking-[0.02em] tabular-nums whitespace-nowrap"
          style={{
            x: f.x - 6,
            color: day && f.y < window.innerHeight * 0.3 ? C.goldDeep : C.gold,
          }}
          initial={{ opacity: 0, y: f.y - 6 }}
          animate={{ opacity: [0, 1, 1, 0], y: f.y - 22 }}
          exit={{ opacity: 0 }}
          transition={{
            opacity: { duration: 1.4, times: [0, 0.06, 0.55, 1] },
            y: { duration: 1.4, ease: EASE_ENTER },
          }}
        >
          {f.text}
        </motion.span>
      ))}
    </AnimatePresence>
  );
}
