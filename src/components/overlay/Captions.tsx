/**
 * Captions (§7.3): lower-left, a 20px hairline leading into one line of Jost 300. Each one
 * rises 8px into place over 600ms, holds 3.2s and fades over 900ms; at most two, stacked
 * 8px apart, newest at the bottom.
 */
import { AnimatePresence, motion } from 'framer-motion';
import { useUiState } from '../uiState';
import { EASE_ENTER, EASE_EXIT } from './shared';

const IN = 0.6;
const HOLD = 3.2;
const OUT = 0.9;
const TOTAL = IN + HOLD + OUT;

export function Captions() {
  const { captions } = useUiState();
  return (
    <div className="flex flex-col gap-2" aria-live="polite">
      <AnimatePresence initial={false}>
        {captions.map((c) => (
          <motion.p
            key={c.id}
            layout="position"
            className="relative m-0 flex max-w-[46ch] items-baseline font-jost text-[15px] leading-[1.4] font-light"
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: [0, 1, 1, 0], y: [8, 0, 0, 0] }}
            exit={{ opacity: 0, transition: { duration: 0.35, ease: EASE_EXIT } }}
            transition={{
              duration: TOTAL,
              times: [0, IN / TOTAL, (IN + HOLD) / TOTAL, 1],
              ease: [EASE_ENTER, 'linear', EASE_EXIT],
              layout: { duration: 0.6, ease: EASE_ENTER },
            }}
          >
            <motion.span
              aria-hidden="true"
              className="mr-[10px] inline-block h-px w-5 shrink-0 self-center bg-current opacity-70"
              initial={{ clipPath: 'inset(0 100% 0 0)' }}
              animate={{ clipPath: 'inset(0 0% 0 0)' }}
              transition={{ duration: IN, ease: EASE_ENTER }}
            />
            <span>{c.text}</span>
          </motion.p>
        ))}
      </AnimatePresence>
    </div>
  );
}
